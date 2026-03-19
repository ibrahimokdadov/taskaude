import fs from 'fs'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { TaskStore } from './store.js'
import { FileWatcher } from './watcher.js'
import { resolveBaseDir, normalizeOutputRaw } from './utils.js'
import * as db from './db.js'

const __dirname = fileURLToPath(new URL('.', import.meta.url))

// Converts a task record to a JSON-safe object for the frontend.
// - startTime as ISO string (client computes elapsed from it)
// - output ANSI-stripped (server is responsible for clean text)
// - elapsed omitted (client recomputes from startTime every second)
function serialize(task) {
  return {
    id: task.id,
    outputPath: task.outputPath,
    project: task.project,
    session: task.session,
    title: task.title ?? null,
    output: normalizeOutputRaw(task.output),
    status: task.status,
    startTime: task.startTime.toISOString(),
    lastModified: task.lastModified.toISOString(),
  }
}

// Writes a named SSE event to all connected clients.
// Format: "event: <name>\ndata: <json>\n\n"
function broadcastEvent(clients, eventName, payload) {
  const msg = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`
  for (const res of clients) {
    res.write(msg)
  }
}

// Finds a free TCP port starting at `start`.
// In dev mode: always uses `start`, throws if it's taken
// (Vite proxy is hardcoded to 3737 so dev must use that port).
// In prod: increments until a free port is found.
function findFreePort(start, isDev) {
  return new Promise((resolve, reject) => {
    if (isDev) {
      const s = net.createServer()
      s.once('error', () =>
        reject(new Error(
          `Port ${start} is in use. Dev mode requires port ${start} ` +
          `(Vite proxy is hardcoded to it). Stop the other process and try again.`
        ))
      )
      s.once('listening', () => s.close(() => resolve(start)))
      s.listen(start)
      return
    }
    function probe(port) {
      if (port > start + 100) {
        return reject(new Error(`No free port found in range ${start}–${start + 100}`))
      }
      const s = net.createServer()
      s.once('error', () => probe(port + 1))
      s.once('listening', () => s.close(() => resolve(port)))
      s.listen(port)
    }
    probe(start)
  })
}

// Starts the Express server and watcher.
// Returns a Promise<number> that resolves to the listening port.
export function start() {
  return _start()
}

async function _start() {
  const isDev = process.env.NODE_ENV === 'development'
  const baseDir = resolveBaseDir()

  if (!fs.existsSync(baseDir)) {
    throw new Error(
      `Claude task directory not found: ${baseDir}. ` +
      `Make sure Claude Code has been run at least once.`
    )
  }

  const store = new TaskStore()
  const watcher = new FileWatcher()
  const clients = new Set()
  const app = express()

  // Connect to Postgres; gracefully degrade if unavailable
  try {
    await db.connect()
  } catch (err) {
    console.warn('DB connect failed, running without persistence:', err.message)
  }

  // --- Watcher → store + SSE bridge ---
  watcher.on('task:new', ({ id, outputPath }) => {
    store.upsert(id, outputPath)
    const task = store.get(id)
    if (task) broadcastEvent(clients, 'task:new', serialize(task))
  })
  watcher.on('task:update', ({ id, output }) => {
    store.update(id, output)
    const task = store.get(id)
    if (task) broadcastEvent(clients, 'task:update', serialize(task))
  })
  watcher.on('task:idle', ({ id }) => {
    store.markIdle(id)
    const task = store.get(id)
    if (task) {
      broadcastEvent(clients, 'task:idle', serialize(task))
      db.upsert(task).catch(err => console.error('DB upsert failed:', err.message))
    }
  })

  // --- REST endpoints ---
  app.get('/api/tasks', (_req, res) => {
    res.json(store.getAll().map(serialize))
  })

  app.get('/api/history/days', async (_req, res) => {
    try {
      res.json(await db.getDays())
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  app.get('/api/history/tasks', async (req, res) => {
    const { date } = req.query
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' })
    }
    try {
      const tasks = await db.getTasksByDate(date)
      res.json(tasks.map(serialize))
    } catch (err) {
      res.status(500).json({ error: err.message })
    }
  })

  // SSE stream — keeps connection open, pushes events as watcher fires them.
  // On connect: immediately sends full current state as a 'reload' event.
  app.get('/events', (req, res) => {
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache')
    res.setHeader('Connection', 'keep-alive')
    res.flushHeaders()
    clients.add(res)
    req.on('close', () => clients.delete(res))
    broadcastEvent(new Set([res]), 'reload', { tasks: store.getAll().map(serialize) })
  })

  app.post('/api/tasks/:id/clear', (req, res) => {
    const task = store.get(req.params.id)
    if (!task) return res.status(404).json({ error: 'not found' })
    store.clearOutput(req.params.id)
    const updated = store.get(req.params.id)
    if (updated) broadcastEvent(clients, 'task:update', serialize(updated))
    res.json({ ok: true })
  })

  app.post('/api/reload', (_req, res) => {
    store.reloadAll()
    broadcastEvent(clients, 'reload', { tasks: store.getAll().map(serialize) })
    res.json({ ok: true })
  })

  // Static serving — production only. In dev, Vite dev server serves the frontend.
  if (!isDev) {
    const distIndex = path.join(__dirname, '../web/dist/index.html')
    if (!fs.existsSync(distIndex)) {
      throw new Error('Production build not found. Run `npm run build` first.')
    }
    app.use(express.static(path.join(__dirname, '../web/dist')))
  }

  // --- Start watcher ---
  // FileWatcher signals startup failures via emit('error'), not via rejection.
  // Capture any startup error in a variable, check after start() resolves.
  let startupError = null
  const captureStartupError = (err) => { startupError = err }
  watcher.once('error', captureStartupError)

  await watcher.start(baseDir)

  // Remove the startup capture handler (it may have already self-removed via 'once')
  watcher.off('error', captureStartupError)

  if (startupError) {
    throw startupError
  }

  // Replace with permanent log-only handler for runtime chokidar errors
  watcher.on('error', (err) => console.error('Watcher error:', err.message))

  // --- Find port and listen ---
  const port = await findFreePort(3737, isDev)

  return new Promise((resolve, reject) => {
    const server = app.listen(port, () => {
      const shutdown = () => {
        watcher.close()
        server.close(() => process.exit(0))
      }
      process.on('SIGINT', shutdown)
      process.on('SIGTERM', shutdown)
      resolve(port)
    })
    server.on('error', (err) => {
      watcher.close()
      reject(err)
    })
  })
}

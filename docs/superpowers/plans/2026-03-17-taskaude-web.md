# Taskaude Web View Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Ink TUI with a local Express + Vite/React web dashboard that `taskaude` opens automatically in the browser.

**Architecture:** `bin/taskaude.js` calls `src/server.js:start()`, which owns the watcher + store lifecycle and exposes REST + SSE endpoints. The Vite/React frontend at `web/` connects to those endpoints. Existing `src/watcher.js`, `src/store.js`, and `src/utils.js` are untouched.

**Tech Stack:** Node.js + Express 4, Vite 5 + React 18, Tailwind CSS v4, SSE for real-time updates.

---

## File Map

| File | Action | Purpose |
|------|--------|---------|
| `package.json` | Modify | Swap deps, update scripts and bin |
| `src/server.js` | Create | Express server: SSE, REST API, watcher lifecycle |
| `web/index.html` | Create | Vite HTML entry |
| `web/vite.config.js` | Create | Vite config with dev proxy |
| `web/src/main.jsx` | Create | React bootstrap |
| `web/src/index.css` | Create | Tailwind v4 entry |
| `web/src/utils.js` | Create | Browser-safe `formatElapsed` + `statusIcon` |
| `web/src/App.jsx` | Create | Root component: SSE connection, layout |
| `web/src/components/TaskList.jsx` | Create | Left sidebar |
| `web/src/components/Output.jsx` | Create | Right output pane |
| `bin/taskaude.js` | Modify | Replace Ink render with `start()` + browser open |
| `src/app.jsx` | Delete | Ink root (replaced) |
| `src/components/TaskList.jsx` | Delete | Ink component (replaced) |
| `src/components/Output.jsx` | Delete | Ink component (replaced) |
| `tests/TaskList.test.jsx` | Delete | Ink tests (no longer relevant) |
| `tests/Output.test.jsx` | Delete | Ink tests (no longer relevant) |

---

## Task 1: Update `package.json`

**Files:**
- Modify: `package.json`

- [ ] **Step 1: Replace `package.json`**

Write the entire file:

```json
{
  "name": "taskaude",
  "version": "0.1.0",
  "type": "module",
  "description": "Claude Code background task monitor",
  "bin": {
    "taskaude": "./bin/taskaude.js"
  },
  "scripts": {
    "build": "vite build --config web/vite.config.js",
    "start": "node bin/taskaude.js",
    "dev": "concurrently \"NODE_ENV=development node bin/taskaude.js\" \"vite --config web/vite.config.js\"",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "chokidar": "^3.6.0",
    "express": "^4.19.0",
    "open": "^10.1.0",
    "react": "^18.3.1"
  },
  "devDependencies": {
    "@tailwindcss/vite": "^4.0.0",
    "@vitejs/plugin-react": "^4.3.0",
    "concurrently": "^9.0.0",
    "react-dom": "^18.3.1",
    "tailwindcss": "^4.0.0",
    "vite": "^5.0.0",
    "vitest": "^1.6.0"
  }
}
```

Key changes vs current:
- `bin` → `./bin/taskaude.js` (no more dist bundle)
- Removed: `ink`, `ink-testing-library`, `esbuild`, `esbuild-register`, `prepare` script
- Added runtime: `express`, `open`
- Added dev: `vite`, `react-dom`, `tailwindcss`, `@tailwindcss/vite`, `concurrently`

- [ ] **Step 2: Install dependencies**

```bash
cd C:/Users/ibrah/cascadeProjects/taskaude
npm install
```

Expected: no errors, `node_modules` updated.

- [ ] **Step 3: Verify existing backend tests still pass**

```bash
npm test
```

Expected: `utils.test.js`, `store.test.js`, `watcher.test.js` pass (24 tests). `TaskList.test.jsx` and `Output.test.jsx` may fail — that's OK, we're deleting them in a later task.

- [ ] **Step 4: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: swap deps from Ink/esbuild to Express/Vite"
```

---

## Task 2: Create `src/server.js`

**Files:**
- Create: `src/server.js`

- [ ] **Step 1: Create the file**

```js
import fs from 'fs'
import net from 'net'
import path from 'path'
import { fileURLToPath } from 'url'
import express from 'express'
import { TaskStore } from './store.js'
import { FileWatcher } from './watcher.js'
import { resolveBaseDir, normalizeOutput } from './utils.js'

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
    output: normalizeOutput(task.output),
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
    if (task) broadcastEvent(clients, 'task:idle', serialize(task))
  })

  // --- REST endpoints ---
  app.get('/api/tasks', (_req, res) => {
    res.json(store.getAll().map(serialize))
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
    broadcastEvent(clients, 'task:update', serialize(updated))
    res.json({ ok: true })
  })

  app.post('/api/reload', (_req, res) => {
    store.reloadAll()
    broadcastEvent(clients, 'reload', { tasks: store.getAll().map(serialize) })
    res.json({ ok: true })
  })

  // Static serving — production only. In dev, Vite dev server serves the frontend.
  if (!isDev) {
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
```

- [ ] **Step 2: Verify existing backend tests still pass**

```bash
npm test
```

Expected: all 3 backend test files pass. (Ink tests may fail — still fine.)

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: add Express server with SSE and REST API"
```

---

## Task 3: Vite scaffold files

**Files:**
- Create: `web/index.html`
- Create: `web/vite.config.js`
- Create: `web/src/main.jsx`
- Create: `web/src/index.css`
- Create: `web/src/utils.js`

- [ ] **Step 1: Create `web/index.html`**

With `root: 'web'` in vite.config.js, paths in index.html are relative to `web/`.

```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>taskaude</title>
  </head>
  <body>
    <div id="root"></div>
    <script type="module" src="./src/main.jsx"></script>
  </body>
</html>
```

- [ ] **Step 2: Create `web/vite.config.js`**

```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'web',
  build: {
    outDir: '../web/dist',
    emptyOutDir: true,
  },
  server: {
    proxy: {
      '/api': 'http://localhost:3737',
      // timeout: 0 required — SSE is a long-lived connection;
      // http-proxy's default socket timeout silently drops the stream in dev.
      '/events': { target: 'http://localhost:3737', changeOrigin: false, timeout: 0 },
    },
  },
})
```

- [ ] **Step 3: Create `web/src/main.jsx`**

```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'

createRoot(document.getElementById('root')).render(<App />)
```

- [ ] **Step 4: Create `web/src/index.css`**

Tailwind v4 — single import replaces the old `@tailwind base/components/utilities` directives:

```css
@import "tailwindcss";
```

- [ ] **Step 5: Create `web/src/utils.js`**

**Important:** Do NOT import from `src/utils.js` — that file imports `path` and `os` (Node built-ins) which Vite cannot bundle for the browser. Copy only the pure functions here.

```js
// Browser-safe utilities — pure functions only, no Node.js imports.

export function formatElapsed(startTimeMs) {
  const totalSeconds = Math.floor((Date.now() - startTimeMs) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function statusIcon(status) {
  return { running: '⦿', done: '✓', failed: '✗', unknown: '?' }[status] ?? '?'
}
```

- [ ] **Step 6: Commit**

```bash
git add web/index.html web/vite.config.js web/src/main.jsx web/src/index.css web/src/utils.js
git commit -m "feat: add Vite scaffold and browser-safe utils"
```

---

## Task 4: Create `web/src/App.jsx`

**Files:**
- Create: `web/src/App.jsx`

The root component: SSE connection, task state, layout.

- [ ] **Step 1: Create the file**

```jsx
import React, { useState, useEffect } from 'react'
import TaskList from './components/TaskList.jsx'
import Output from './components/Output.jsx'

export default function App() {
  const [tasks, setTasks] = useState(new Map())
  const [selectedId, setSelectedId] = useState(null)

  function mergeSingle(task) {
    setTasks(prev => new Map(prev).set(task.id, task))
    setSelectedId(prev => prev ?? task.id)
  }

  function replaceAll(taskArray) {
    setTasks(new Map(taskArray.map(t => [t.id, t])))
    setSelectedId(prev => {
      // Keep current selection if it still exists; otherwise pick first
      if (prev && taskArray.find(t => t.id === prev)) return prev
      return taskArray[0]?.id ?? null
    })
  }

  useEffect(() => {
    // Initial load
    fetch('/api/tasks')
      .then(r => r.json())
      .then(replaceAll)
      .catch(err => console.error('Failed to load tasks:', err))

    // SSE connection
    const es = new EventSource('/events')

    es.addEventListener('task:new',    e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('task:update', e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('task:idle',   e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('reload',      e => replaceAll(JSON.parse(e.data).tasks))

    es.onerror = () => console.error('SSE connection lost')

    return () => es.close()
  }, [])

  const tasksArray = [...tasks.values()]
  const selectedTask = tasks.get(selectedId) ?? null

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 font-mono">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <span className="text-blue-400 font-bold text-sm tracking-wide">taskaude</span>
        <span className="text-gray-500 text-xs">
          {tasksArray.length} task{tasksArray.length !== 1 ? 's' : ''}
        </span>
      </header>
      <div className="flex flex-row flex-1 overflow-hidden">
        <TaskList
          tasks={tasksArray}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <Output task={selectedTask} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/App.jsx
git commit -m "feat: add App root component with SSE connection"
```

---

## Task 5: Create `web/src/components/TaskList.jsx`

**Files:**
- Create: `web/src/components/TaskList.jsx`

Left sidebar: task list with status, elapsed time ticking every second, project name.

- [ ] **Step 1: Create `web/src/components/` directory and the file**

```jsx
import React, { useState, useEffect } from 'react'
import { formatElapsed, statusIcon } from '../utils.js'

const STATUS_CLASSES = {
  running: 'text-blue-400',
  done:    'text-green-400',
  failed:  'text-red-400',
  unknown: 'text-gray-500',
}

export default function TaskList({ tasks, selectedId, onSelect }) {
  // Tick every second to update elapsed time display
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  if (!tasks.length) {
    return (
      <div className="w-80 flex-shrink-0 border-r border-gray-800 flex flex-col items-center justify-center text-gray-600 text-sm p-6 gap-1">
        <span>No tasks yet.</span>
        <span className="text-xs text-gray-700">Run a background command in Claude Code.</span>
      </div>
    )
  }

  return (
    <div className="w-80 flex-shrink-0 border-r border-gray-800 overflow-y-auto">
      <ul>
        {tasks.map(task => {
          const isSelected = task.id === selectedId
          const colorClass = STATUS_CLASSES[task.status] ?? STATUS_CLASSES.unknown
          const elapsed = formatElapsed(new Date(task.startTime).getTime())

          return (
            <li
              key={task.id}
              onClick={() => onSelect(task.id)}
              className={[
                'px-3 py-2 cursor-pointer border-b border-gray-800/50 select-none',
                isSelected ? 'bg-gray-800' : 'hover:bg-gray-900',
              ].join(' ')}
            >
              {/* Row 1: status icon + task ID */}
              <div className="flex items-center gap-2">
                <span className={`text-sm ${colorClass}`}>{statusIcon(task.status)}</span>
                <span className={`text-sm truncate ${isSelected ? 'text-white font-medium' : 'text-gray-300'}`}>
                  {task.id}
                </span>
              </div>
              {/* Row 2: elapsed + project */}
              <div className="flex items-center gap-2 mt-0.5 pl-5">
                <span className="text-xs text-gray-500">{elapsed}</span>
                <span className="text-xs text-cyan-700">{task.project}</span>
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/TaskList.jsx
git commit -m "feat: add TaskList sidebar component"
```

---

## Task 6: Create `web/src/components/Output.jsx`

**Files:**
- Create: `web/src/components/Output.jsx`

Right pane: output display with auto-scroll, Clear and Reload All buttons.

- [ ] **Step 1: Create the file**

```jsx
import React, { useRef, useEffect, useState } from 'react'
import { formatElapsed, statusIcon } from '../utils.js'

const STATUS_BADGE = {
  running: 'bg-blue-500/20 text-blue-400 border-blue-500/30',
  done:    'bg-green-500/20 text-green-400 border-green-500/30',
  failed:  'bg-red-500/20 text-red-400 border-red-500/30',
  unknown: 'bg-gray-500/20 text-gray-400 border-gray-500/30',
}

export default function Output({ task }) {
  const containerRef = useRef(null)
  // userScrolled: true when the user has scrolled up; suppresses auto-scroll
  const [userScrolled, setUserScrolled] = useState(false)
  // Tick every second so elapsed time in the header stays live
  const [, setTick] = useState(0)
  useEffect(() => {
    const timer = setInterval(() => setTick(t => t + 1), 1000)
    return () => clearInterval(timer)
  }, [])

  // Auto-scroll to bottom when output changes, unless user scrolled up
  useEffect(() => {
    if (!userScrolled && containerRef.current) {
      containerRef.current.scrollTop = containerRef.current.scrollHeight
    }
  }, [task?.output, userScrolled])

  // Reset scroll lock when switching to a different task
  useEffect(() => {
    setUserScrolled(false)
  }, [task?.id])

  function handleScroll() {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 20
    setUserScrolled(!atBottom)
  }

  if (!task) {
    return (
      <div className="flex-1 flex items-center justify-center text-gray-600 text-sm">
        Select a task to view its output.
      </div>
    )
  }

  const badgeClass = STATUS_BADGE[task.status] ?? STATUS_BADGE.unknown
  const elapsed = formatElapsed(new Date(task.startTime).getTime())

  return (
    <div className="flex-1 flex flex-col overflow-hidden min-w-0">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900/50 flex-shrink-0 flex-wrap gap-y-1">
        <span className="text-sm text-gray-200 font-medium truncate max-w-xs">{task.id}</span>
        <span className={`text-xs px-2 py-0.5 rounded border ${badgeClass}`}>
          {statusIcon(task.status)} {task.status}
        </span>
        <span className="text-xs text-gray-500">{elapsed}</span>
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => fetch(`/api/tasks/${task.id}/clear`, { method: 'POST' })}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          >
            Clear
          </button>
          <button
            onClick={() => fetch('/api/reload', { method: 'POST' })}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          >
            Reload All
          </button>
        </div>
      </div>

      {/* Output */}
      <pre
        ref={containerRef}
        onScroll={handleScroll}
        className="flex-1 overflow-auto p-4 text-xs text-gray-300 whitespace-pre-wrap break-words leading-relaxed"
      >
        {task.output
          ? task.output
          : <span className="text-gray-600">No output yet.</span>
        }
      </pre>
    </div>
  )
}
```

- [ ] **Step 2: Commit**

```bash
git add web/src/components/Output.jsx
git commit -m "feat: add Output pane component"
```

---

## Task 7: Update `bin/taskaude.js` and verify full build

**Files:**
- Modify: `bin/taskaude.js`

- [ ] **Step 1: Replace `bin/taskaude.js`**

```js
#!/usr/bin/env node
import { start } from '../src/server.js'
import open from 'open'

let port
try {
  port = await start()
} catch (err) {
  console.error(`Failed to start taskaude: ${err.message}`)
  process.exit(1)
}

console.log(`taskaude running at http://localhost:${port}`)
await open(`http://localhost:${port}`)
// Process stays alive because the HTTP server is listening
```

- [ ] **Step 2: Run the production build**

```bash
npm run build
```

Expected: Vite builds successfully, `web/dist/` is populated with `index.html`, JS, and CSS.

- [ ] **Step 3: Run the backend tests one more time**

```bash
npm test
```

Expected: `utils.test.js`, `store.test.js`, `watcher.test.js` pass. Ink test files (`TaskList.test.jsx`, `Output.test.jsx`) will fail — we delete them next.

- [ ] **Step 4: Commit**

```bash
git add bin/taskaude.js
git commit -m "feat: replace Ink render with Express server start and browser open"
```

---

## Task 8: Delete Ink files, run clean test suite, smoke test

**Files:**
- Delete: `src/app.jsx`
- Delete: `src/components/TaskList.jsx`
- Delete: `src/components/Output.jsx`
- Delete: `tests/TaskList.test.jsx`
- Delete: `tests/Output.test.jsx`

- [ ] **Step 1: Delete the Ink source files**

```bash
cd C:/Users/ibrah/cascadeProjects/taskaude
rm src/app.jsx
rm src/components/TaskList.jsx
rm src/components/Output.jsx
```

Check if `src/components/` is now empty:
```bash
ls src/components/
```
If empty, remove the directory:
```bash
rmdir src/components
```

- [ ] **Step 2: Delete the Ink test files**

```bash
rm tests/TaskList.test.jsx
rm tests/Output.test.jsx
```

- [ ] **Step 3: Run tests — should now be fully clean**

```bash
npm test
```

Expected output: all tests pass, no failures. Should see exactly:
- `tests/utils.test.js` — ✓
- `tests/store.test.js` — ✓
- `tests/watcher.test.js` — ✓

- [ ] **Step 4: Commit the deletions**

```bash
git add -A
git commit -m "chore: remove Ink TUI files and tests"
```

(Using `-A` here is intentional — we're only staging deletions that were just performed. Verify with `git status` first if in doubt.)

- [ ] **Step 5: Smoke test**

```bash
npm start
```

Expected:
1. Terminal prints: `taskaude running at http://localhost:3737`
2. Browser opens automatically at `http://localhost:3737`
3. If Claude Code is running background tasks: they appear in the left sidebar within a few seconds
4. If no tasks: left sidebar shows "No tasks yet."
5. Clicking a task in the sidebar shows its output on the right
6. Output scrolls to bottom automatically as new content arrives
7. "Clear" button clears output for the selected task
8. "Reload All" re-reads all output files from disk

To verify SSE live updates: start a new Claude Code background task while taskaude is running — it should appear in the sidebar without a page refresh.

Press `Ctrl+C` to stop.

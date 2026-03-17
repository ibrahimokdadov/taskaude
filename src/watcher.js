import { EventEmitter } from 'events'
import fs from 'fs'
import path from 'path'
import chokidar from 'chokidar'

export class FileWatcher extends EventEmitter {
  #watcher = null
  #idleTimers = new Map()
  #idleMs

  constructor({ idleMs = 3000 } = {}) {
    super()
    this.#idleMs = idleMs
  }

  async resolveActiveSession(baseDir) {
    let projectEntries
    try {
      projectEntries = await fs.promises.readdir(baseDir)
    } catch {
      return null
    }

    const sessionDirs = []
    for (const proj of projectEntries) {
      const projPath = path.join(baseDir, proj)
      let sessions
      try { sessions = await fs.promises.readdir(projPath) } catch { continue }
      for (const sess of sessions) {
        const tasksDir = path.join(projPath, sess, 'tasks')
        try {
          await fs.promises.access(tasksDir)
          sessionDirs.push(tasksDir)
        } catch { /* no tasks dir */ }
      }
    }

    if (!sessionDirs.length) return null

    const withMtime = await Promise.all(
      sessionDirs.map(async dir => {
        try {
          const stat = await fs.promises.stat(dir)
          return { dir, mtime: stat.mtimeMs }
        } catch {
          return { dir, mtime: 0 }
        }
      })
    )
    withMtime.sort((a, b) => b.mtime - a.mtime)
    return withMtime[0].dir
  }

  async start(baseDir) {
    const sessionDir = await this.resolveActiveSession(baseDir)
    if (!sessionDir) {
      this.emit('error', new Error(`No Claude Code tasks found under ${baseDir}`))
      return
    }

    // Load existing files
    let existing
    try { existing = await fs.promises.readdir(sessionDir) } catch { existing = [] }

    for (const file of existing) {
      if (!file.endsWith('.output')) continue
      const id = path.basename(file, '.output')
      const outputPath = path.join(sessionDir, file)
      this.emit('task:new', { id, outputPath })
      try {
        const output = await fs.promises.readFile(outputPath, 'utf8')
        this.emit('task:update', { id, output })
      } catch { /* ok */ }
      this._resetIdleTimer(id)
    }

    const isWindows = process.platform === 'win32'
    this.#watcher = chokidar.watch(sessionDir, {
      ignoreInitial: true,
      usePolling: isWindows,
      interval: isWindows ? 500 : undefined,
    })

    this.#watcher.on('add', async filePath => {
      if (!filePath.endsWith('.output')) return
      const id = path.basename(filePath, '.output')
      this.emit('task:new', { id, outputPath: filePath })
      try {
        const output = await fs.promises.readFile(filePath, 'utf8')
        this.emit('task:update', { id, output })
      } catch { /* ok */ }
      this._resetIdleTimer(id)
    })

    this.#watcher.on('change', async filePath => {
      if (!filePath.endsWith('.output')) return
      const id = path.basename(filePath, '.output')
      try {
        const output = await fs.promises.readFile(filePath, 'utf8')
        this.emit('task:update', { id, output })
      } catch { /* ok */ }
      this._resetIdleTimer(id)
    })

    this.#watcher.on('error', err => this.emit('error', err))
  }

  _resetIdleTimer(id) {
    const existing = this.#idleTimers.get(id)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.#idleTimers.delete(id)
      this.emit('task:idle', { id })
    }, this.#idleMs)
    this.#idleTimers.set(id, timer)
  }

  close() {
    for (const t of this.#idleTimers.values()) clearTimeout(t)
    this.#idleTimers.clear()
    this.#watcher?.close()
  }
}

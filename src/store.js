import fs from 'fs'
import { inferStatus, formatElapsed } from './utils.js'

export class TaskStore {
  #tasks = new Map()

  upsert(id, outputPath) {
    if (this.#tasks.has(id)) return

    let startTime = new Date()
    try {
      const stat = fs.statSync(outputPath)
      const birth = stat.birthtimeMs
      const useMs = (birth === 0 || birth === stat.ctimeMs) ? stat.mtimeMs : birth
      startTime = new Date(useMs)
    } catch { /* file may not exist yet */ }

    let output = ''
    try { output = fs.readFileSync(outputPath, 'utf8') } catch { /* ok */ }

    this.#tasks.set(id, {
      id,
      outputPath,
      output,
      status: 'running',
      startTime,
      lastModified: new Date(),
      elapsed: formatElapsed(startTime.getTime()),
    })
  }

  update(id, output) {
    const task = this.#tasks.get(id)
    if (!task) return
    task.output = output
    task.lastModified = new Date()
    task.status = 'running'
    task.elapsed = formatElapsed(task.startTime.getTime())
  }

  markIdle(id) {
    const task = this.#tasks.get(id)
    if (!task) return
    task.status = inferStatus(task.lastModified.getTime(), task.output)
    task.elapsed = formatElapsed(task.startTime.getTime())
  }

  clearOutput(id) {
    const t = this.#tasks.get(id)
    if (t) t.output = ''
  }

  reloadAll() {
    for (const task of this.#tasks.values()) {
      try {
        const output = fs.readFileSync(task.outputPath, 'utf8')
        const stat = fs.statSync(task.outputPath)
        // Only mutate after both reads succeed
        task.output = output
        task.lastModified = new Date(stat.mtimeMs)
        task.status = inferStatus(task.lastModified.getTime(), task.output)
      } catch {
        task.status = 'unknown'
      }
      task.elapsed = formatElapsed(task.startTime.getTime())
    }
  }

  get(id) { return this.#tasks.get(id) }
  getAll() { return [...this.#tasks.values()] }
}

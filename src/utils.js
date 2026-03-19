import fs from 'fs'
import path from 'path'
import os from 'os'

export function normalizeOutput(str) {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')       // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

// Like normalizeOutput but keeps ANSI color codes intact — used when the
// frontend will render them via ansi-to-html.
export function normalizeOutputRaw(str) {
  return str
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // strip OSC only (hyperlinks etc.)
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
}

const FAIL_PATTERNS = [
  /exit code [1-9]\d*/i,
  /SIGKILL|SIGTERM|SIGSEGV/,
  /^error:/im,  // i: case-insensitive (matches ERROR:, Error:); m: anchored to line start in tail
  /npm ERR!/,
  /command not found/i,
]

export function inferStatus(lastModifiedMs, output) {
  if (Date.now() - lastModifiedMs < 3000) return 'running'
  const normalized = normalizeOutput(output)
  const lines = normalized.split('\n')
  const tail = lines.slice(-20).join('\n')
  if (FAIL_PATTERNS.some(p => p.test(tail))) return 'failed'
  return 'done'
}

export function formatElapsed(startTimeMs) {
  const totalSeconds = Math.floor((Date.now() - startTimeMs) / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

export function statusIcon(status) {
  return { running: '⦿', done: '✓', failed: '✗', unknown: '?' }[status] ?? '?'
}

// Extracts the session ID from a task output path.
// Path structure: <base>/<project-hash>/<session-id>/tasks/<id>.output
export function extractSessionId(outputPath) {
  return path.basename(path.dirname(path.dirname(outputPath)))
}

// Extracts a human-readable project name from a task output path.
// Path structure: <base>/<project-hash>/<session-id>/tasks/<id>.output
// project-hash encodes the original path with separators replaced by '-'
// e.g. "C--Users-ibrah-cascadeProjects-competitioner" → "competitioner"
export function extractProjectName(outputPath) {
  const projectHash = path.basename(
    path.dirname(path.dirname(path.dirname(outputPath)))
  )
  const parts = projectHash.split('-').filter(Boolean)
  return parts[parts.length - 1] ?? projectHash
}

// Reads the first user message from an agent-<taskId>.jsonl subagent file.
// Path: ~/.claude/projects/<project-hash>/*/subagents/agent-<taskId>.jsonl
// Returns a trimmed string (up to 120 chars) or null if not found.
export function resolveTaskTitle(outputPath) {
  const taskId = path.basename(outputPath, '.output')
  const projectHash = path.basename(path.dirname(path.dirname(path.dirname(outputPath))))
  const claudeDir = path.join(os.homedir(), '.claude', 'projects', projectHash)
  try {
    const sessions = fs.readdirSync(claudeDir)
    for (const session of sessions) {
      const jsonlPath = path.join(claudeDir, session, 'subagents', `agent-${taskId}.jsonl`)
      try {
        const fd = fs.openSync(jsonlPath, 'r')
        const buf = Buffer.alloc(4096)
        const n = fs.readSync(fd, buf, 0, 4096, 0)
        fs.closeSync(fd)
        const firstLine = buf.slice(0, n).toString('utf8').split('\n')[0]
        const obj = JSON.parse(firstLine)
        const content = obj?.message?.content
        if (typeof content === 'string' && content.length > 0) {
          return content.replace(/\n/g, ' ').slice(0, 120).trimEnd()
        }
      } catch { /* file missing or unparseable */ }
    }
  } catch { /* claudeDir missing */ }
  return null
}

export function resolveBaseDir() {
  if (process.platform === 'win32') {
    const base = process.env.LOCALAPPDATA
      ?? path.join(os.homedir(), 'AppData', 'Local')
    return path.join(base, 'Temp', 'claude')
  }
  if (process.platform === 'darwin') {
    return path.join(os.tmpdir(), 'claude')
  }
  // Linux
  const xdg = process.env.XDG_CACHE_HOME ?? path.join(os.homedir(), '.cache')
  return path.join(xdg, 'claude')
}

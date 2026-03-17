import path from 'path'
import os from 'os'

export function normalizeOutput(str) {
  return str
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, '')       // CSI sequences
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '') // OSC sequences
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

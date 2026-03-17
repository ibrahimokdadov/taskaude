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

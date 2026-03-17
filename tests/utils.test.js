import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  normalizeOutput,
  inferStatus,
  formatElapsed,
  statusIcon,
  resolveBaseDir,
} from '../src/utils.js'

describe('normalizeOutput', () => {
  it('strips ANSI escape sequences', () => {
    expect(normalizeOutput('\x1b[32mgreen\x1b[0m')).toBe('green')
  })
  it('normalizes CRLF to LF', () => {
    expect(normalizeOutput('a\r\nb')).toBe('a\nb')
  })
  it('normalizes bare CR to LF', () => {
    expect(normalizeOutput('a\rb')).toBe('a\nb')
  })
  it('handles combined ANSI + CRLF', () => {
    expect(normalizeOutput('\x1b[31mError\x1b[0m\r\nfailed')).toBe('Error\nfailed')
  })
})

describe('inferStatus', () => {
  it('returns running when file modified < 3s ago', () => {
    expect(inferStatus(Date.now() - 100, '')).toBe('running')
  })
  it('returns done when idle and no error patterns', () => {
    expect(inferStatus(Date.now() - 5000, 'Build successful\nDone')).toBe('done')
  })
  it('returns failed for "exit code 1"', () => {
    expect(inferStatus(Date.now() - 5000, 'Process exited with exit code 1')).toBe('failed')
  })
  it('returns failed for "ERROR:" (uppercase)', () => {
    expect(inferStatus(Date.now() - 5000, 'ERROR: Invalid argument')).toBe('failed')
  })
  it('returns failed for "Error:" (mixed case)', () => {
    expect(inferStatus(Date.now() - 5000, 'Error: file not found')).toBe('failed')
  })
  it('returns failed for npm ERR!', () => {
    expect(inferStatus(Date.now() - 5000, 'npm ERR! code ENOENT')).toBe('failed')
  })
  it('returns failed for SIGTERM', () => {
    expect(inferStatus(Date.now() - 5000, 'killed by SIGTERM')).toBe('failed')
  })
  it('returns failed for "command not found"', () => {
    expect(inferStatus(Date.now() - 5000, 'bash: foo: command not found')).toBe('failed')
  })
  it('checks only last 20 lines', () => {
    const lines = Array(25).fill('ok line')
    lines.push('Error: late error')
    // error is in tail, should detect failed
    expect(inferStatus(Date.now() - 5000, lines.join('\n'))).toBe('failed')
  })
})

describe('formatElapsed', () => {
  it('formats seconds', () => {
    expect(formatElapsed(Date.now() - 45000)).toBe('0m 45s')
  })
  it('formats minutes and seconds', () => {
    expect(formatElapsed(Date.now() - 161000)).toBe('2m 41s')
  })
  it('pads single-digit seconds', () => {
    expect(formatElapsed(Date.now() - 65000)).toBe('1m 05s')
  })
})

describe('statusIcon', () => {
  it('maps all statuses', () => {
    expect(statusIcon('running')).toBe('⦿')
    expect(statusIcon('done')).toBe('✓')
    expect(statusIcon('failed')).toBe('✗')
    expect(statusIcon('unknown')).toBe('?')
    expect(statusIcon('anything-else')).toBe('?')
  })
})

describe('resolveBaseDir', () => {
  beforeEach(() => {
    vi.unstubAllEnvs()
  })
  it('returns windows path when LOCALAPPDATA is set', () => {
    vi.stubEnv('LOCALAPPDATA', 'C:\\Users\\test\\AppData\\Local')
    // Only test on all platforms since we mock platform via process
    const original = process.platform
    Object.defineProperty(process, 'platform', { value: 'win32', configurable: true })
    const result = resolveBaseDir()
    Object.defineProperty(process, 'platform', { value: original, configurable: true })
    expect(result).toContain('claude')
  })
})

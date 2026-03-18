import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { FileWatcher } from '../src/watcher.js'

describe('FileWatcher.resolveAllSessions', () => {
  let tmpDir
  let watcher

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'taskaude-test-'))
    watcher = new FileWatcher()
  })

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true })
    watcher.close()
  })

  it('returns empty array when base dir is empty', async () => {
    const result = await watcher.resolveAllSessions(tmpDir)
    expect(result).toEqual([])
  })

  it('returns all session task dirs across all projects', async () => {
    const session1 = path.join(tmpDir, 'proj-a', 'sess-1', 'tasks')
    const session2 = path.join(tmpDir, 'proj-b', 'sess-1', 'tasks')
    fs.mkdirSync(session1, { recursive: true })
    fs.mkdirSync(session2, { recursive: true })

    const result = await watcher.resolveAllSessions(tmpDir)
    expect(result).toHaveLength(2)
    expect(result).toContain(session1)
    expect(result).toContain(session2)
  })

  it('returns empty array when base dir does not exist', async () => {
    const result = await watcher.resolveAllSessions('/nonexistent/path/xyz')
    expect(result).toEqual([])
  })

  it('skips project entries that have no sessions with a tasks dir', async () => {
    // proj-a has a tasks dir; proj-b has a session dir but no tasks subdir
    const session1 = path.join(tmpDir, 'proj-a', 'sess-1', 'tasks')
    fs.mkdirSync(session1, { recursive: true })
    fs.mkdirSync(path.join(tmpDir, 'proj-b', 'sess-1'), { recursive: true })

    const result = await watcher.resolveAllSessions(tmpDir)
    expect(result).toHaveLength(1)
    expect(result).toContain(session1)
  })
})

describe('FileWatcher idle timer', () => {
  it('emits task:idle after timeout of no writes', async () => {
    const watcher = new FileWatcher({ idleMs: 50 }) // short timeout for tests
    const idleEvents = []
    watcher.on('task:idle', e => idleEvents.push(e))

    watcher._resetIdleTimer('testid')
    await new Promise(r => setTimeout(r, 100))

    expect(idleEvents).toHaveLength(1)
    expect(idleEvents[0].id).toBe('testid')
    watcher.close()
  })

  it('resets timer on second call — only one idle fires', async () => {
    const watcher = new FileWatcher({ idleMs: 80 })
    const idleEvents = []
    watcher.on('task:idle', e => idleEvents.push(e))

    watcher._resetIdleTimer('testid')
    await new Promise(r => setTimeout(r, 40))
    watcher._resetIdleTimer('testid') // reset
    await new Promise(r => setTimeout(r, 120))

    expect(idleEvents).toHaveLength(1)
    watcher.close()
  })
})

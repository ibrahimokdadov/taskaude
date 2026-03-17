import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import path from 'path'
import os from 'os'
import fs from 'fs'
import { FileWatcher } from '../src/watcher.js'

describe('FileWatcher.resolveActiveSession', () => {
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

  it('returns null when base dir is empty', async () => {
    const result = await watcher.resolveActiveSession(tmpDir)
    expect(result).toBeNull()
  })

  it('returns the tasks dir of the most recently modified session', async () => {
    const session1 = path.join(tmpDir, 'proj-a', 'sess-1', 'tasks')
    const session2 = path.join(tmpDir, 'proj-a', 'sess-2', 'tasks')
    fs.mkdirSync(session1, { recursive: true })
    fs.mkdirSync(session2, { recursive: true })

    // Write a file to session2 to make it newer
    fs.writeFileSync(path.join(session1, 'task1.output'), 'output1')
    await new Promise(r => setTimeout(r, 10))
    fs.writeFileSync(path.join(session2, 'task2.output'), 'output2')

    const result = await watcher.resolveActiveSession(tmpDir)
    expect(result).toBe(session2)
  })

  it('returns null when base dir does not exist', async () => {
    const result = await watcher.resolveActiveSession('/nonexistent/path/xyz')
    expect(result).toBeNull()
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

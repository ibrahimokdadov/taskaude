import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { TaskStore } from '../src/store.js'

// Mock fs so tests don't need real files
vi.mock('fs', async () => {
  return {
    default: {
      statSync: vi.fn(() => ({ birthtimeMs: 1000, ctimeMs: 2000, mtimeMs: 3000 })),
      readFileSync: vi.fn(() => 'test output\n'),
    },
    statSync: vi.fn(() => ({ birthtimeMs: 1000, ctimeMs: 2000, mtimeMs: 3000 })),
    readFileSync: vi.fn(() => 'test output\n'),
  }
})

describe('TaskStore', () => {
  let store

  beforeEach(() => {
    store = new TaskStore()
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('upsert adds a new task', () => {
    store.upsert('abc123', '/tmp/abc123.output')
    const task = store.get('abc123')
    expect(task).toBeDefined()
    expect(task.id).toBe('abc123')
    expect(task.status).toBe('running')
    expect(task.output).toBe('test output\n')
  })

  it('upsert is idempotent — second call is a no-op', () => {
    store.upsert('abc123', '/tmp/abc123.output')
    store.upsert('abc123', '/tmp/abc123.output')
    expect(store.getAll()).toHaveLength(1)
  })

  it('update changes output and sets status to running', () => {
    store.upsert('abc123', '/tmp/abc123.output')
    store.update('abc123', 'new output\n')
    const task = store.get('abc123')
    expect(task.output).toBe('new output\n')
    expect(task.status).toBe('running')
  })

  it('markIdle transitions status using inferStatus', () => {
    store.upsert('abc123', '/tmp/abc123.output')
    // Force lastModified to be old
    store.get('abc123').lastModified = new Date(Date.now() - 10000)
    store.get('abc123').output = 'Build complete'
    store.markIdle('abc123')
    expect(store.get('abc123').status).toBe('done')
  })

  it('markIdle detects failed status', () => {
    store.upsert('abc123', '/tmp/abc123.output')
    store.get('abc123').lastModified = new Date(Date.now() - 10000)
    store.get('abc123').output = 'npm ERR! code ENOENT'
    store.markIdle('abc123')
    expect(store.get('abc123').status).toBe('failed')
  })

  it('clearOutput empties the output buffer', () => {
    store.upsert('abc123', '/tmp/abc123.output')
    store.clearOutput('abc123')
    expect(store.get('abc123').output).toBe('')
  })

  it('getAll returns all tasks as array', () => {
    store.upsert('a1', '/tmp/a1.output')
    store.upsert('b2', '/tmp/b2.output')
    expect(store.getAll()).toHaveLength(2)
  })
})

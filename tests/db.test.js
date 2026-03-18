import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pg from 'pg'

// Must be set before db.js is imported so connect() reads the test DB name
process.env.PGDATABASE = 'taskaude_test'
const db = await import('../src/db.js')

// Separate pool for test cleanup — bypasses db.js module scope
const cleanPool = new pg.Pool({
  host: 'localhost', port: 5432,
  user: 'postgres', password: 'admin',
  database: 'taskaude_test',
})

const TASK = {
  id: 'test-task-1',
  project: 'testproject',
  session: 'sess-abc123',
  title: 'Test task',
  output: 'some output',
  status: 'done',
  startTime: new Date('2026-03-18T10:00:00Z'),
  lastModified: new Date('2026-03-18T10:05:00Z'),
  outputPath: '/tmp/test.output',
}

beforeEach(async () => {
  await db.connect()
  await cleanPool.query('DELETE FROM tasks')
})

afterAll(async () => {
  await cleanPool.end()
})

describe('db', () => {
  it('connect() creates the tasks table', async () => {
    const result = await cleanPool.query(
      `SELECT table_name FROM information_schema.tables
       WHERE table_schema='public' AND table_name='tasks'`
    )
    expect(result.rows).toHaveLength(1)
  })

  it('upsert() inserts a task with correct column mapping', async () => {
    await db.upsert(TASK)
    const result = await cleanPool.query('SELECT * FROM tasks WHERE id=$1', ['test-task-1'])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].project).toBe('testproject')
    expect(result.rows[0].output_path).toBe('/tmp/test.output')
    expect(result.rows[0].status).toBe('done')
  })

  it('upsert() updates on conflict', async () => {
    await db.upsert(TASK)
    await db.upsert({ ...TASK, status: 'failed', output: 'updated' })
    const result = await cleanPool.query('SELECT * FROM tasks WHERE id=$1', ['test-task-1'])
    expect(result.rows).toHaveLength(1)
    expect(result.rows[0].status).toBe('failed')
    expect(result.rows[0].output).toBe('updated')
  })

  it('getDays() returns date entries with counts', async () => {
    await db.upsert(TASK)
    const days = await db.getDays()
    const march18 = days.find(d => d.date === '2026-03-18')
    expect(march18).toBeDefined()
    expect(march18.count).toBe(1)
  })

  it('getTasksByDate() returns only tasks for the given date', async () => {
    await db.upsert(TASK)
    await db.upsert({
      ...TASK,
      id: 'test-task-2',
      startTime: new Date('2026-03-17T10:00:00Z'),
      lastModified: new Date('2026-03-17T10:05:00Z'),
    })
    const tasks = await db.getTasksByDate('2026-03-18')
    expect(tasks).toHaveLength(1)
    expect(tasks[0].id).toBe('test-task-1')
    expect(tasks[0].startTime).toBeInstanceOf(Date)
    expect(tasks[0].project).toBe('testproject')
  })
})

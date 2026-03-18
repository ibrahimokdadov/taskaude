# Postgres Persistence + Calendar View Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist completed tasks to PostgreSQL and add a Calendar view that lets you browse task history by date.

**Architecture:** A new `src/db.js` module owns the pg pool and all DB operations. `server.js` calls `db.connect()` at startup and `db.upsert()` on each `task:idle` event. Two new endpoints serve history data. The frontend gains a `view` state (live/calendar), a `CalendarPanel` component, and calendar state in `App.jsx`. Live mode is completely unchanged.

**Tech Stack:** Node.js, Express, `pg` (PostgreSQL client), React, Vite, Tailwind CSS, Vitest

---

## File Map

| File | What changes |
|------|-------------|
| `src/db.js` | **New** — pg pool, connect/migrate, upsert, getDays, getTasksByDate |
| `src/server.js` | Import db, connect on startup, upsert on task:idle, add `/api/history/*` endpoints |
| `web/src/App.jsx` | Add `view` state, calendar state, header tabs, calendar render branch |
| `web/src/components/CalendarPanel.jsx` | **New** — month grid with dot indicators, month navigation |
| `web/src/components/Output.jsx` | Add `readOnly` prop — hides Clear/Reload buttons |
| `tests/db.test.js` | **New** — integration tests against `taskaude_test` DB |
| `tests/CalendarPanel.test.jsx` | **New** — component smoke tests |
| `package.json` | Add `pg` dependency |

---

## Task 1: Install `pg` and create `src/db.js`

**Files:**
- Modify: `package.json`
- Create: `src/db.js`
- Create: `tests/db.test.js`

- [ ] **Step 1: Install pg**

```bash
npm install pg
```

Expected: `pg` appears in `package.json` dependencies.

- [ ] **Step 2: Write the failing db tests**

Create `tests/db.test.js`:

```js
import { describe, it, expect, beforeEach, afterAll } from 'vitest'
import pg from 'pg'

// Set before dynamic import so connect() reads the test DB name
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
```

- [ ] **Step 3: Run the tests — confirm they fail**

```bash
npm test -- --reporter=verbose tests/db.test.js
```

Expected: FAIL — "Cannot find module '../src/db.js'"

- [ ] **Step 4: Implement `src/db.js`**

Create `src/db.js`:

```js
import pg from 'pg'

let pool = null

export async function connect() {
  const dbName = process.env.PGDATABASE ?? 'taskaude'

  // Auto-create the database if it doesn't exist
  const admin = new pg.Pool({
    host: 'localhost', port: 5432,
    user: 'postgres', password: 'admin',
    database: 'postgres',
  })
  try {
    await admin.query(`CREATE DATABASE "${dbName}"`)
  } catch (err) {
    if (!err.message.includes('already exists')) throw err
  } finally {
    await admin.end()
  }

  // Close any previous pool (safe for repeated calls in tests)
  if (pool) await pool.end().catch(() => {})

  pool = new pg.Pool({
    host: 'localhost', port: 5432,
    user: 'postgres', password: 'admin',
    database: dbName,
  })

  await pool.query(`
    CREATE TABLE IF NOT EXISTS tasks (
      id            TEXT PRIMARY KEY,
      project       TEXT NOT NULL,
      session       TEXT NOT NULL,
      title         TEXT,
      output        TEXT NOT NULL DEFAULT '',
      status        TEXT NOT NULL,
      start_time    TIMESTAMPTZ NOT NULL,
      last_modified TIMESTAMPTZ NOT NULL,
      output_path   TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS tasks_date_idx
      ON tasks (DATE(start_time AT TIME ZONE 'UTC'));
  `)
}

// Accepts the store's camelCase task object; maps to snake_case columns.
export async function upsert(task) {
  await pool.query(`
    INSERT INTO tasks
      (id, project, session, title, output, status, start_time, last_modified, output_path)
    VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
    ON CONFLICT (id) DO UPDATE SET
      project       = EXCLUDED.project,
      session       = EXCLUDED.session,
      title         = EXCLUDED.title,
      output        = EXCLUDED.output,
      status        = EXCLUDED.status,
      start_time    = EXCLUDED.start_time,
      last_modified = EXCLUDED.last_modified,
      output_path   = EXCLUDED.output_path
  `, [
    task.id, task.project, task.session, task.title ?? null,
    task.output ?? '', task.status,
    task.startTime, task.lastModified, task.outputPath,
  ])
}

// Returns [{ date: 'YYYY-MM-DD', count: number }] for all days, newest first.
export async function getDays() {
  const result = await pool.query(`
    SELECT DATE(start_time AT TIME ZONE 'UTC')::TEXT AS date,
           COUNT(*)::INT AS count
    FROM tasks
    GROUP BY DATE(start_time AT TIME ZONE 'UTC')
    ORDER BY date DESC
  `)
  return result.rows
}

// Returns camelCase task objects for a given date string 'YYYY-MM-DD'.
// Rows are camelCase so they pass directly through server.js serialize().
export async function getTasksByDate(dateStr) {
  const result = await pool.query(`
    SELECT id, project, session, title, output, status,
           start_time, last_modified, output_path
    FROM tasks
    WHERE DATE(start_time AT TIME ZONE 'UTC') = $1
    ORDER BY start_time ASC
  `, [dateStr])
  return result.rows.map(r => ({
    id: r.id,
    project: r.project,
    session: r.session,
    title: r.title,
    output: r.output,
    status: r.status,
    startTime: r.start_time,       // pg returns JS Date for TIMESTAMPTZ
    lastModified: r.last_modified,
    outputPath: r.output_path,
  }))
}
```

- [ ] **Step 5: Run the db tests — confirm they pass**

```bash
npm test -- --reporter=verbose tests/db.test.js
```

Expected: 5 tests pass.

- [ ] **Step 6: Run the full test suite — confirm nothing broke**

```bash
npm test
```

Expected: all existing tests + 5 new db tests pass.

- [ ] **Step 7: Commit**

```bash
git add src/db.js tests/db.test.js package.json package-lock.json
git commit -m "feat: add PostgreSQL persistence layer"
```

---

## Task 2: Wire `db.js` into `server.js`

**Files:**
- Modify: `src/server.js`

- [ ] **Step 1: Add db import, connect on startup, upsert on task:idle, history endpoints**

In `src/server.js`, make the following changes:

**Add import at the top** (after existing imports):

```js
import * as db from './db.js'
```

**Connect before watcher starts** — add this block just after `const app = express()`:

```js
  // --- DB connection (graceful degradation if unavailable) ---
  let dbAvailable = false
  try {
    await db.connect()
    dbAvailable = true
  } catch (err) {
    console.warn('Postgres unavailable — running without persistence:', err.message)
  }
```

**Persist on task:idle** — update the existing `task:idle` handler:

```js
  watcher.on('task:idle', ({ id }) => {
    store.markIdle(id)
    const task = store.get(id)
    if (task) {
      broadcastEvent(clients, 'task:idle', serialize(task))
      if (dbAvailable) db.upsert(task).catch(err => console.error('DB upsert error:', err.message))
    }
  })
```

**Add history endpoints** — add these two routes after the existing `/api/tasks` route:

```js
  app.get('/api/history/days', async (_req, res) => {
    if (!dbAvailable) return res.json([])
    try {
      res.json(await db.getDays())
    } catch (err) {
      console.error('getDays error:', err.message)
      res.status(500).json({ error: 'database error' })
    }
  })

  app.get('/api/history/tasks', async (req, res) => {
    const { date } = req.query
    if (!date || !/^\d{4}-\d{2}-\d{2}$/.test(date)) {
      return res.status(400).json({ error: 'date query param required (YYYY-MM-DD)' })
    }
    if (!dbAvailable) return res.json([])
    try {
      const tasks = await db.getTasksByDate(date)
      res.json(tasks.map(serialize))
    } catch (err) {
      console.error('getTasksByDate error:', err.message)
      res.status(500).json({ error: 'database error' })
    }
  })
```

- [ ] **Step 2: Run all tests — confirm they pass**

```bash
npm test
```

Expected: all tests pass (server.js has no unit tests — verified by the suite staying green).

- [ ] **Step 3: Commit**

```bash
git add src/server.js
git commit -m "feat: persist tasks to postgres on completion, add /api/history/* endpoints"
```

---

## Task 3: Add `readOnly` prop to `Output.jsx`

**Files:**
- Modify: `web/src/components/Output.jsx`

- [ ] **Step 1: Update the function signature and hide buttons when readOnly**

In `web/src/components/Output.jsx`, change line 11:

```jsx
// FROM:
export default function Output({ task }) {

// TO:
export default function Output({ task, readOnly = false }) {
```

Then find the buttons div (the `<div className="ml-auto flex gap-2">` block) and wrap it:

```jsx
// FROM:
        <div className="ml-auto flex gap-2">
          <button
            onClick={() => fetch(`/api/tasks/${task.id}/clear`, { method: 'POST' })}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          >
            Clear
          </button>
          <button
            onClick={() => fetch('/api/reload', { method: 'POST' })}
            className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
          >
            Reload All
          </button>
        </div>

// TO:
        {!readOnly && (
          <div className="ml-auto flex gap-2">
            <button
              onClick={() => fetch(`/api/tasks/${task.id}/clear`, { method: 'POST' })}
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
            >
              Clear
            </button>
            <button
              onClick={() => fetch('/api/reload', { method: 'POST' })}
              className="text-xs px-2 py-1 rounded bg-gray-800 hover:bg-gray-700 text-gray-400 hover:text-gray-200 transition-colors cursor-pointer"
            >
              Reload All
            </button>
          </div>
        )}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/components/Output.jsx
git commit -m "feat: add readOnly prop to Output — hides Clear/Reload in calendar mode"
```

---

## Task 4: Add `CalendarPanel` component

**Files:**
- Create: `web/src/components/CalendarPanel.jsx`
- Create: `tests/CalendarPanel.test.jsx`

- [ ] **Step 1: Write the smoke tests**

Create `tests/CalendarPanel.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import CalendarPanel from '../web/src/components/CalendarPanel.jsx'

describe('CalendarPanel', () => {
  it('exports a default component', () => {
    expect(typeof CalendarPanel).toBe('function')
  })

  it('component name is CalendarPanel', () => {
    expect(CalendarPanel.name).toBe('CalendarPanel')
  })
})
```

- [ ] **Step 2: Run — confirm it fails**

```bash
npm test -- --reporter=verbose tests/CalendarPanel.test.jsx
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `CalendarPanel.jsx`**

Create `web/src/components/CalendarPanel.jsx`:

```jsx
import React, { useState } from 'react'

export default function CalendarPanel({ days, selectedDate, onSelect }) {
  const today = new Date()
  const [year, setYear] = useState(today.getFullYear())
  const [month, setMonth] = useState(today.getMonth()) // 0-indexed

  // O(1) lookup: date string → count
  const dayMap = new Map(days.map(d => [d.date, d.count]))

  const firstOfMonth = new Date(year, month, 1)
  // Monday-first: Sunday (0) → 6, Monday (1) → 0, etc.
  const startCol = (firstOfMonth.getDay() + 6) % 7
  const daysInMonth = new Date(year, month + 1, 0).getDate()
  const monthLabel = firstOfMonth.toLocaleString(undefined, { month: 'long', year: 'numeric' })

  function prevMonth() {
    if (month === 0) { setYear(y => y - 1); setMonth(11) }
    else setMonth(m => m - 1)
  }
  function nextMonth() {
    if (month === 11) { setYear(y => y + 1); setMonth(0) }
    else setMonth(m => m + 1)
  }

  // Build grid: leading empty cells + day numbers
  const cells = [
    ...Array(startCol).fill(null),
    ...Array.from({ length: daysInMonth }, (_, i) => i + 1),
  ]

  return (
    <div className="w-44 flex-shrink-0 border-r border-gray-800 flex flex-col">
      <div className="px-3 py-2 text-xs text-gray-600 font-semibold uppercase tracking-wider">
        Calendar
      </div>
      {/* Month navigation */}
      <div className="flex items-center justify-between px-3 pb-2">
        <button onClick={prevMonth} className="text-gray-500 hover:text-gray-300 text-xs cursor-pointer select-none">◀</button>
        <span className="text-xs text-gray-300 font-medium">{monthLabel}</span>
        <button onClick={nextMonth} className="text-gray-500 hover:text-gray-300 text-xs cursor-pointer select-none">▶</button>
      </div>
      {/* Day-of-week labels */}
      <div className="grid grid-cols-7 px-2 mb-1">
        {['M','T','W','T','F','S','S'].map((d, i) => (
          <div key={i} className="text-center text-gray-700 text-xs">{d}</div>
        ))}
      </div>
      {/* Day cells */}
      <div className="grid grid-cols-7 px-2 gap-y-0.5 overflow-y-auto">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} />
          const mm = String(month + 1).padStart(2, '0')
          const dd = String(day).padStart(2, '0')
          const dateStr = `${year}-${mm}-${dd}`
          const count = dayMap.get(dateStr) ?? 0
          const isSelected = dateStr === selectedDate
          const isToday = day === today.getDate() && month === today.getMonth() && year === today.getFullYear()
          return (
            <div
              key={dateStr}
              onClick={count > 0 ? () => onSelect(dateStr) : undefined}
              className={[
                'flex flex-col items-center py-0.5 rounded text-xs select-none',
                count > 0 ? 'cursor-pointer' : 'cursor-default',
                isSelected ? 'bg-blue-600/40 text-white' : count > 0 ? 'text-gray-300 hover:bg-gray-800' : 'text-gray-700',
                isToday && !isSelected ? 'font-bold' : '',
              ].filter(Boolean).join(' ')}
            >
              <span>{day}</span>
              {count > 0 && <span className="w-1 h-1 rounded-full bg-blue-400" />}
            </div>
          )
        })}
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run CalendarPanel tests — confirm they pass**

```bash
npm test -- --reporter=verbose tests/CalendarPanel.test.jsx
```

Expected: 2 tests pass.

- [ ] **Step 5: Run full suite**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 6: Commit**

```bash
git add web/src/components/CalendarPanel.jsx tests/CalendarPanel.test.jsx
git commit -m "feat: add CalendarPanel component with month grid and dot indicators"
```

---

## Task 5: Wire calendar mode into `App.jsx`

**Files:**
- Modify: `web/src/App.jsx`

- [ ] **Step 1: Replace `App.jsx` with the calendar-enabled version**

```jsx
import React, { useState, useEffect } from 'react'
import ProjectList from './components/ProjectList.jsx'
import TaskList from './components/TaskList.jsx'
import Output from './components/Output.jsx'
import CalendarPanel from './components/CalendarPanel.jsx'

export default function App() {
  const [tasks, setTasks] = useState(new Map())
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [view, setView] = useState('live')

  // Calendar state
  const [calendarDays, setCalendarDays] = useState([])
  const [selectedDate, setSelectedDate] = useState(null)
  const [historyTasks, setHistoryTasks] = useState([])
  const [selectedHistoryId, setSelectedHistoryId] = useState(null)

  const tasksArray = [...tasks.values()]

  const projects = [...new Map(
    tasksArray.map(t => [`${t.project}/${t.session}`, { name: t.project, session: t.session }])
  ).values()]
    .sort((a, b) => `${a.name}/${a.session}`.localeCompare(`${b.name}/${b.session}`))
    .map(({ name, session }) => ({
      name,
      session,
      runningCount: tasksArray.filter(t => t.project === name && t.session === session && t.status === 'running').length,
    }))

  const filteredTasks = tasksArray.filter(t => t.project === selectedProject?.name && t.session === selectedProject?.session)
  const selectedTask = tasks.get(selectedId) ?? null
  const selectedHistoryTask = historyTasks.find(t => t.id === selectedHistoryId) ?? null

  function autoSelectProject(taskArray, current) {
    if (current && taskArray.some(t => t.project === current.name && t.session === current.session)) {
      return current
    }
    const pairs = [...new Map(taskArray.map(t => [`${t.project}/${t.session}`, { name: t.project, session: t.session }])).values()]
      .sort((a, b) => `${a.name}/${a.session}`.localeCompare(`${b.name}/${b.session}`))
    return pairs[0] ?? null
  }

  function mergeSingle(task) {
    setTasks(prev => new Map(prev).set(task.id, task))
    setSelectedProject(prev => prev ?? { name: task.project, session: task.session })
    setSelectedId(prev => prev ?? task.id)
  }

  function replaceAll(taskArray) {
    setTasks(new Map(taskArray.map(t => [t.id, t])))
    setSelectedProject(prev => autoSelectProject(taskArray, prev))
    setSelectedId(prev => {
      if (prev && taskArray.find(t => t.id === prev)) return prev
      return taskArray[0]?.id ?? null
    })
  }

  // Live data via SSE
  useEffect(() => {
    fetch('/api/tasks')
      .then(r => r.json())
      .then(replaceAll)
      .catch(err => console.error('Failed to load tasks:', err))

    const es = new EventSource('/events')
    es.addEventListener('task:new',    e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('task:update', e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('task:idle',   e => mergeSingle(JSON.parse(e.data)))
    es.addEventListener('reload',      e => replaceAll(JSON.parse(e.data).tasks))
    es.onerror = () => console.error('SSE connection lost')
    return () => es.close()
  }, [])

  // Load calendar days when switching to calendar view
  useEffect(() => {
    if (view !== 'calendar') return
    fetch('/api/history/days')
      .then(r => r.json())
      .then(setCalendarDays)
      .catch(err => console.error('Failed to load calendar days:', err))
  }, [view])

  // Load tasks when a date is selected in calendar view
  useEffect(() => {
    if (!selectedDate) return
    fetch(`/api/history/tasks?date=${selectedDate}`)
      .then(r => r.json())
      .then(t => {
        setHistoryTasks(t)
        setSelectedHistoryId(t[0]?.id ?? null)
      })
      .catch(err => console.error('Failed to load history tasks:', err))
  }, [selectedDate])

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 font-mono">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <span className="text-blue-400 font-bold text-sm tracking-wide">taskaude</span>
        <span className="text-gray-500 text-xs">
          {tasksArray.length} task{tasksArray.length !== 1 ? 's' : ''}
        </span>
        <div className="flex gap-1 ml-2">
          <button
            onClick={() => setView('live')}
            className={[
              'text-xs px-2 py-0.5 rounded cursor-pointer',
              view === 'live'
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                : 'text-gray-500 hover:text-gray-300',
            ].join(' ')}
          >
            Live
          </button>
          <button
            onClick={() => setView('calendar')}
            className={[
              'text-xs px-2 py-0.5 rounded cursor-pointer',
              view === 'calendar'
                ? 'bg-blue-600/30 text-blue-300 border border-blue-500/30'
                : 'text-gray-500 hover:text-gray-300',
            ].join(' ')}
          >
            Calendar
          </button>
        </div>
        <span className="ml-auto text-xs text-gray-600">
          {new Date().toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' })}
        </span>
      </header>
      <div className="flex flex-row flex-1 overflow-hidden">
        {view === 'live' ? (
          <>
            <ProjectList
              projects={projects}
              selectedProject={selectedProject}
              onSelect={({ name, session }) => {
                setSelectedProject({ name, session })
                const first = tasksArray.find(t => t.project === name && t.session === session)
                setSelectedId(first?.id ?? null)
              }}
            />
            <TaskList
              tasks={filteredTasks}
              selectedId={selectedId}
              onSelect={setSelectedId}
            />
            <Output task={selectedTask} />
          </>
        ) : (
          <>
            <CalendarPanel
              days={calendarDays}
              selectedDate={selectedDate}
              onSelect={setSelectedDate}
            />
            <TaskList
              tasks={historyTasks}
              selectedId={selectedHistoryId}
              onSelect={setSelectedHistoryId}
            />
            <Output task={selectedHistoryTask} readOnly />
          </>
        )}
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run all tests**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 3: Commit**

```bash
git add web/src/App.jsx
git commit -m "feat: add Live/Calendar header tabs and calendar mode to App"
```

---

## Task 6: Build and smoke test

- [ ] **Step 1: Build production bundle**

```bash
npm run build
```

Expected: build completes with no errors.

- [ ] **Step 2: Start and verify**

```bash
npm start
```

Open http://localhost:3737. Verify:
- **Live tab**: existing 3-panel behaviour unchanged
- **Calendar tab**: month grid appears in left panel; days with tasks have blue dots; clicking a dot day loads tasks in the middle panel; output shows in right panel with no Clear/Reload buttons

If Postgres is not running, the server should still start and the calendar view returns empty arrays gracefully.

- [ ] **Step 3: Final test run**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit build artifact update if needed**

Only needed if `web/dist` is tracked and changed.

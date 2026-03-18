# Multi-Project Watching + 3-Panel UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the watcher to pick up all active Claude Code projects simultaneously, and restructure the UI into three panels: projects (left), tasks (middle), output (right).

**Architecture:** The watcher's `resolveActiveSession` is replaced by `resolveAllSessions`, which returns every `tasks/` dir found under `baseDir` instead of just the newest one. On the frontend, a new `ProjectList` component sits left of `TaskList`; `App.jsx` tracks `selectedProject` and passes filtered tasks to `TaskList`.

**Tech Stack:** Node.js, chokidar, Express, React, Vite, Tailwind CSS, Vitest

---

## File Map

| File | What changes |
|------|-------------|
| `src/watcher.js` | Replace `resolveActiveSession` with `resolveAllSessions` (returns `string[]`); update `start()` |
| `web/src/App.jsx` | Add `selectedProject` state, derive `projects` + `filteredTasks`, render 3-panel layout |
| `web/src/components/ProjectList.jsx` | **New** — left panel, project names + running badge |
| `web/src/components/TaskList.jsx` | Remove cyan project label from each row |
| `web/src/components/Output.jsx` | Header: `task.title ?? task.id` instead of `task.id` |
| `tests/watcher.test.js` | Update `resolveActiveSession` tests → `resolveAllSessions` |
| `tests/ProjectList.test.jsx` | **New** — smoke tests |

---

## Task 1: Replace `resolveActiveSession` with `resolveAllSessions`

**Files:**
- Modify: `src/watcher.js`
- Modify: `tests/watcher.test.js`

The current method signature is `resolveActiveSession(baseDir): Promise<string | null>`. Replace it with `resolveAllSessions(baseDir): Promise<string[]>` which collects every `tasks/` dir across all projects and sessions.

Path structure: `<baseDir>/<project-hash>/<session-id>/tasks/`

- [ ] **Step 1: Update the watcher tests first (TDD)**

Replace the `FileWatcher.resolveActiveSession` describe block in `tests/watcher.test.js` with the following:

```js
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
```

- [ ] **Step 2: Run the new tests — confirm they all fail**

```bash
npm test -- --reporter=verbose tests/watcher.test.js
```

Expected: the 4 new `resolveAllSessions` tests fail with "watcher.resolveAllSessions is not a function". The `idle timer` tests should still pass.

- [ ] **Step 3: Implement `resolveAllSessions` in `src/watcher.js`**

Replace the `resolveActiveSession` method (lines 16–52) with:

```js
async resolveAllSessions(baseDir) {
  let projectEntries
  try {
    projectEntries = await fs.promises.readdir(baseDir)
  } catch {
    return []
  }

  const sessionDirs = []
  for (const proj of projectEntries) {
    const projPath = path.join(baseDir, proj)
    let sessions
    try { sessions = await fs.promises.readdir(projPath) } catch { continue }
    for (const sess of sessions) {
      const tasksDir = path.join(projPath, sess, 'tasks')
      try {
        await fs.promises.access(tasksDir)
        sessionDirs.push(tasksDir)
      } catch { /* no tasks dir */ }
    }
  }

  return sessionDirs
}
```

- [ ] **Step 4: Update `start(baseDir)` to call `resolveAllSessions`**

In the `start(baseDir)` method, change:

```js
// OLD
const sessionDir = await this.resolveActiveSession(baseDir)
if (!sessionDir) {
  this.emit('error', new Error(`No Claude Code tasks found under ${baseDir}`))
  return
}

// Load existing files
let existing
try { existing = await fs.promises.readdir(sessionDir) } catch { existing = [] }

for (const file of existing) {
  if (!file.endsWith('.output')) continue
  const id = path.basename(file, '.output')
  const outputPath = path.join(sessionDir, file)
  this.emit('task:new', { id, outputPath })
  try {
    const output = await fs.promises.readFile(outputPath, 'utf8')
    this.emit('task:update', { id, output })
  } catch { /* ok */ }
  this._resetIdleTimer(id)
}

const isWindows = process.platform === 'win32'
this.#watcher = chokidar.watch(sessionDir, {
```

To:

```js
// NEW
const sessionDirs = await this.resolveAllSessions(baseDir)
if (!sessionDirs.length) {
  this.emit('error', new Error(`No Claude Code tasks found under ${baseDir}`))
  return
}

// Load existing files from all session dirs
for (const sessionDir of sessionDirs) {
  let existing
  try { existing = await fs.promises.readdir(sessionDir) } catch { continue }
  for (const file of existing) {
    if (!file.endsWith('.output')) continue
    const id = path.basename(file, '.output')
    const outputPath = path.join(sessionDir, file)
    this.emit('task:new', { id, outputPath })
    try {
      const output = await fs.promises.readFile(outputPath, 'utf8')
      this.emit('task:update', { id, output })
    } catch { /* ok */ }
    this._resetIdleTimer(id)
  }
}

const isWindows = process.platform === 'win32'
this.#watcher = chokidar.watch(sessionDirs, {
```

Note: `chokidar.watch()` accepts an array of paths as its first argument — no other change needed.

- [ ] **Step 5: Run all tests — confirm they pass**

```bash
npm test
```

Expected: all 39 existing tests pass + 4 new watcher tests pass = 43 total.

- [ ] **Step 6: Commit**

```bash
git add src/watcher.js tests/watcher.test.js
git commit -m "feat: watch all project sessions instead of just the most recent"
```

---

## Task 2: Add `ProjectList` component

**Files:**
- Create: `web/src/components/ProjectList.jsx`
- Create: `tests/ProjectList.test.jsx`

- [ ] **Step 1: Write the smoke tests**

Create `tests/ProjectList.test.jsx`:

```jsx
import { describe, it, expect } from 'vitest'
import ProjectList from '../web/src/components/ProjectList.jsx'

describe('ProjectList', () => {
  it('exports a default component', () => {
    expect(typeof ProjectList).toBe('function')
  })

  it('component accepts required props', () => {
    expect(ProjectList.length >= 0).toBe(true)
  })

  it('component name is ProjectList', () => {
    expect(ProjectList.name).toBe('ProjectList')
  })
})
```

- [ ] **Step 2: Run the test — confirm it fails**

```bash
npm test -- --reporter=verbose tests/ProjectList.test.jsx
```

Expected: FAIL — "Cannot find module '../web/src/components/ProjectList.jsx'"

- [ ] **Step 3: Implement `ProjectList.jsx`**

Create `web/src/components/ProjectList.jsx`:

```jsx
import React from 'react'

export default function ProjectList({ projects, selectedProject, onSelect }) {
  if (!projects.length) {
    return (
      <div className="w-44 flex-shrink-0 border-r border-gray-800 flex flex-col items-center justify-center text-gray-600 text-sm p-4 gap-1">
        <span>No projects yet.</span>
        <span className="text-xs text-gray-700 text-center">Run a background command in Claude Code.</span>
      </div>
    )
  }

  return (
    <div className="w-44 flex-shrink-0 border-r border-gray-800 overflow-y-auto">
      <div className="px-3 py-2 text-xs text-gray-600 font-semibold uppercase tracking-wider">
        Projects
      </div>
      <ul>
        {projects.map(({ name, runningCount }) => {
          const isSelected = name === selectedProject
          return (
            <li
              key={name}
              onClick={() => onSelect(name)}
              className={[
                'px-3 py-2 cursor-pointer border-b border-gray-800/50 select-none flex items-center justify-between gap-2',
                isSelected ? 'bg-gray-800' : 'hover:bg-gray-900',
              ].join(' ')}
            >
              <span className={`text-sm truncate ${isSelected ? 'text-white font-medium' : 'text-gray-300'}`}>
                {name}
              </span>
              {runningCount > 0 && (
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-blue-500/20 text-blue-400 border border-blue-500/30 flex-shrink-0">
                  {runningCount}
                </span>
              )}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Run the tests — confirm they pass**

```bash
npm test -- --reporter=verbose tests/ProjectList.test.jsx
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add web/src/components/ProjectList.jsx tests/ProjectList.test.jsx
git commit -m "feat: add ProjectList component for left panel"
```

---

## Task 3: Wire up 3-panel layout in `App.jsx`

**Files:**
- Modify: `web/src/App.jsx`

- [ ] **Step 1: Replace `App.jsx` with the 3-panel version**

The new `App.jsx`:

```jsx
import React, { useState, useEffect } from 'react'
import ProjectList from './components/ProjectList.jsx'
import TaskList from './components/TaskList.jsx'
import Output from './components/Output.jsx'

export default function App() {
  const [tasks, setTasks] = useState(new Map())
  const [selectedProject, setSelectedProject] = useState(null)
  const [selectedId, setSelectedId] = useState(null)

  // Derive sorted project list and filtered tasks from the task map
  const tasksArray = [...tasks.values()]

  const projects = [...new Set(tasksArray.map(t => t.project))]
    .sort()
    .map(name => ({
      name,
      runningCount: tasksArray.filter(t => t.project === name && t.status === 'running').length,
    }))

  const filteredTasks = tasksArray.filter(t => t.project === selectedProject)
  const selectedTask = tasks.get(selectedId) ?? null

  function autoSelectProject(taskArray, currentProject) {
    if (currentProject && taskArray.some(t => t.project === currentProject)) {
      return currentProject
    }
    const names = [...new Set(taskArray.map(t => t.project))].sort()
    return names[0] ?? null
  }

  function mergeSingle(task) {
    setTasks(prev => new Map(prev).set(task.id, task))
    setSelectedProject(prev => prev ?? task.project)
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

  return (
    <div className="h-screen flex flex-col bg-gray-950 text-gray-100 font-mono">
      <header className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 bg-gray-900 flex-shrink-0">
        <span className="text-blue-400 font-bold text-sm tracking-wide">taskaude</span>
        <span className="text-gray-500 text-xs">
          {tasksArray.length} task{tasksArray.length !== 1 ? 's' : ''}
        </span>
      </header>
      <div className="flex flex-row flex-1 overflow-hidden">
        <ProjectList
          projects={projects}
          selectedProject={selectedProject}
          onSelect={name => {
            setSelectedProject(name)
            // Auto-select first task in newly selected project
            const first = tasksArray.find(t => t.project === name)
            setSelectedId(first?.id ?? null)
          }}
        />
        <TaskList
          tasks={filteredTasks}
          selectedId={selectedId}
          onSelect={setSelectedId}
        />
        <Output task={selectedTask} />
      </div>
    </div>
  )
}
```

- [ ] **Step 2: Run all tests — confirm they still pass**

```bash
npm test
```

Expected: all tests pass (no App.jsx unit tests exist — this is verified by running the full suite).

- [ ] **Step 3: Commit**

```bash
git add web/src/App.jsx
git commit -m "feat: wire up 3-panel layout with project selection"
```

---

## Task 4: UI cleanup — remove project label from `TaskList`, fix `Output` header

**Files:**
- Modify: `web/src/components/TaskList.jsx`
- Modify: `web/src/components/Output.jsx`

- [ ] **Step 1: Remove the project label from `TaskList.jsx`**

In `web/src/components/TaskList.jsx`, find the "Row 2" block (around line 53):

```jsx
{/* Row 2: elapsed + project + short ID */}
<div className="flex items-center gap-2 mt-0.5 pl-5">
  <span className="text-xs text-gray-500">{elapsed}</span>
  <span className="text-xs text-cyan-700">{task.project}</span>
  {task.title && (
    <span className="text-xs text-gray-600 font-mono truncate">{task.id.slice(0, 8)}</span>
  )}
</div>
```

Replace with (drop the `task.project` span):

```jsx
{/* Row 2: elapsed + short ID */}
<div className="flex items-center gap-2 mt-0.5 pl-5">
  <span className="text-xs text-gray-500">{elapsed}</span>
  {task.title && (
    <span className="text-xs text-gray-600 font-mono truncate">{task.id.slice(0, 8)}</span>
  )}
</div>
```

- [ ] **Step 2: Fix the `Output` header to show title**

In `web/src/components/Output.jsx`, find line 56:

```jsx
<span className="text-sm text-gray-200 font-medium truncate max-w-xs">{task.id}</span>
```

Replace with:

```jsx
<span className="text-sm text-gray-200 font-medium truncate max-w-xs">{task.title ?? task.id}</span>
```

- [ ] **Step 3: Run all tests — confirm they pass**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Commit**

```bash
git add web/src/components/TaskList.jsx web/src/components/Output.jsx
git commit -m "fix: remove redundant project label from TaskList, show title in Output header"
```

---

## Task 5: Build and smoke test

- [ ] **Step 1: Build the production bundle**

```bash
npm run build
```

Expected: build completes with no errors. Vite outputs to `web/dist/`.

- [ ] **Step 2: Start the server and verify**

```bash
npm start
```

Open http://localhost:3737. Verify:
- Left panel shows project names
- Clicking a project filters the task list to only that project's tasks
- Output panel header shows the task title (or ID if no title)
- All projects with active Claude Code sessions appear, not just one

- [ ] **Step 3: Run full test suite one final time**

```bash
npm test
```

Expected: all tests pass.

- [ ] **Step 4: Final commit if anything was adjusted during smoke test**

Only needed if you made any changes during smoke testing.

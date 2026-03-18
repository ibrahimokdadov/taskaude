# Multi-Project Watching + 3-Panel UI

**Date:** 2026-03-18

## Problem

1. The watcher picks only the single most recently modified `tasks/` directory across all Claude Code projects. If multiple projects are running simultaneously, only one shows up.
2. The UI has two panels (task list + output). The user wants three: projects on the left, tasks in the middle, output on the right.

## Scope

- Fix multi-project watching in `src/watcher.js`
- Add `ProjectList` component and 3-panel layout to the web UI
- Show `task.title ?? task.id` in the `Output` header (currently shows raw ID only)
- Update tests to match

Out of scope: session recency filtering, persistent project selection across reloads.

---

## Backend: `src/watcher.js`

### `resolveActiveSession` → `resolveAllSessions`

**Signature change:** `resolveActiveSession(baseDir): Promise<string | null>` → `resolveAllSessions(baseDir): Promise<string[]>`

**Behaviour:**
- If `baseDir` itself cannot be read (e.g. does not exist), catch the error and return `[]`. This is the same outcome as "no sessions found" — both result in `start()` emitting `error` and returning early. The distinction between "baseDir unreadable" and "no sessions yet" is not meaningful at the call site.
- Walk every entry under `baseDir`. For each project entry, read its subdirs. For each subdir, check if a `tasks/` directory exists (`fs.promises.access`). Collect all that pass.
- Return the full array unsorted. Order is not meaningful; the store and UI derive their own ordering.
- Each project-dir and session-dir read is wrapped in its own `try/catch` so a failure on one does not abort collection for others.

### `start(baseDir)`

- Calls `resolveAllSessions` instead of `resolveActiveSession`.
- If the returned array is empty, emits `error` with "No Claude Code tasks found" and returns early.
- Loading existing files: iterates over all session dirs. Each dir's `readdir` is in its own `try/catch` — a failure to read one dir does not abort loading for others.
- Passes the full array to `chokidar.watch()` (accepts array natively).

**Assumption confirmed:** `extractProjectName` in `utils.js` derives project name from the segment three levels above the `.output` file (`<base>/<project-hash>/<session-id>/tasks/<id>.output`). This structure is consistent across all sessions regardless of which session dir they come from, so `task.project` is correctly populated for all watched files.

No changes to emitted events (`task:new`, `task:update`, `task:idle`, `error`) or their payloads.

---

## Frontend

### `web/src/App.jsx`

Add `selectedProject` state (string | null), initially null.

**Derived values** (computed from tasks map on each render):
- `projects`: array of `{ name, runningCount }` objects. Unique project names, sorted **alphabetically**. `runningCount` is the count of tasks for that project with `status === 'running'`.
- `filteredTasks`: tasks array filtered to `task.project === selectedProject`.

**`replaceAll` (called on initial load and on `reload` SSE event):**
- Replace the task map.
- If `selectedProject` is still present in the new task set, keep it.
- Otherwise (null, or project no longer has tasks), auto-select the **first project alphabetically** that has at least one task.
- Note: `replaceAll` is also called on SSE reconnect (the `/events` endpoint always sends a `reload` on connect). If the previously selected project's tasks have been cleared by that point, the project selection resets to the first available — this is accepted behaviour.

**`mergeSingle` (called on `task:new`, `task:update`, `task:idle`):**
- If `selectedProject` is null, set it to the incoming task's project.

**Layout:** body row contains three children: `<ProjectList>`, `<TaskList>`, `<Output>`.
- `<TaskList tasks={filteredTasks} ... />` — `filteredTasks` is passed as the `tasks` prop (no prop rename).

### New: `web/src/components/ProjectList.jsx`

Left panel, fixed width ~180px, scrollable.

Props: `projects: { name, runningCount }[]`, `selectedProject: string | null`, `onSelect: (name: string) => void`

Each row:
- Project name (truncated)
- Blue badge showing `runningCount` when > 0, hidden when 0
- Selected state: highlighted background

Empty state (no projects yet): "No projects yet." with a sub-line directing user to run a background command.

### `web/src/components/TaskList.jsx`

Remove the cyan project label (`task.project`) from each task row — redundant when the project panel is visible. No other changes.

### `web/src/components/Output.jsx`

Header currently shows `task.id` as the primary label. Change to `task.title ?? task.id` — consistent with how `TaskList` already renders the task identifier.

---

## Tests

### `tests/watcher.test.js`

Rename the describe block to `FileWatcher.resolveAllSessions`.

Replace existing tests:
- `'returns null when base dir is empty'` → `'returns empty array when base dir is empty'` — assert `[]`
- `'returns the tasks dir of the most recently modified session'` → `'returns all session task dirs across all projects'` — create two sessions in different projects, assert both dirs are returned (no mtime sorting)
- `'returns null when base dir does not exist'` → `'returns empty array when base dir does not exist'` — assert `[]`

The `idle timer` describe block is unaffected.

### New: `tests/ProjectList.test.jsx`

Smoke tests mirroring `tests/Output.test.jsx` and `tests/TaskList.test.jsx`:
- exports a default component
- component accepts required props
- component name is `ProjectList`

---

## File Changeset

| File | Change |
|------|--------|
| `src/watcher.js` | `resolveActiveSession` → `resolveAllSessions`, returns `string[]` |
| `web/src/App.jsx` | Add `selectedProject` state, derive `projects` + `filteredTasks`, 3-panel layout |
| `web/src/components/ProjectList.jsx` | New component |
| `web/src/components/TaskList.jsx` | Remove project label from rows |
| `web/src/components/Output.jsx` | Header: show `task.title ?? task.id` |
| `tests/watcher.test.js` | Update to `resolveAllSessions`, fix assertions |
| `tests/ProjectList.test.jsx` | New smoke tests |

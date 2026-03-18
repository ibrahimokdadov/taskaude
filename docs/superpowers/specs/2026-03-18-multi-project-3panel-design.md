# Multi-Project Watching + 3-Panel UI

**Date:** 2026-03-18

## Problem

1. The watcher picks only the single most recently modified `tasks/` directory across all Claude Code projects. If multiple projects are running simultaneously, only one shows up.
2. The UI has two panels (task list + output). The user wants three: projects on the left, tasks in the middle, output on the right.

## Scope

- Fix multi-project watching in `src/watcher.js`
- Add `ProjectList` component and 3-panel layout to the web UI
- Update tests to match

Out of scope: session recency filtering, persistent project selection across reloads.

---

## Backend: `src/watcher.js`

### Change

Replace `resolveActiveSession(baseDir): Promise<string | null>` with `resolveAllSessions(baseDir): Promise<string[]>`.

**Current behaviour:** walks `baseDir`, collects all `tasks/` subdirs, sorts by mtime, returns the single newest one.

**New behaviour:** same walk, but returns all found `tasks/` dirs as an array (unsorted). Empty array if none found.

`start(baseDir)` is updated to:
- Call `resolveAllSessions` instead of `resolveActiveSession`
- Emit `error` and return early if the array is empty (same as before)
- Load existing `.output` files from all session dirs
- Pass the full array to `chokidar.watch()` (accepts array natively)

No changes to emitted events (`task:new`, `task:update`, `task:idle`, `error`) or their payloads.

---

## Frontend

### `web/src/App.jsx`

Add `selectedProject` state (string | null).

Derive two values from the tasks map:
- `projects`: sorted array of `{ name, runningCount }` objects — unique project names across all tasks, with a count of tasks whose status is `'running'`.
- `filteredTasks`: tasks array filtered to `task.project === selectedProject`.

On `replaceAll` (initial load or SSE reload): if `selectedProject` is null or no longer present in the new task set, auto-select the first project that has tasks.

On `mergeSingle`: if `selectedProject` is null, set it to the incoming task's project.

Layout change: the body row now contains three children — `<ProjectList>`, `<TaskList>`, `<Output>` — instead of two.

### New: `web/src/components/ProjectList.jsx`

Left panel, fixed width ~180px, scrollable.

Props: `projects`, `selectedProject`, `onSelect`

Each row shows:
- Project name (truncated)
- Small badge with running task count (blue, hidden when 0)
- Selected state: highlighted background

Empty state: "No projects yet." with a sub-line.

### `web/src/components/TaskList.jsx`

Remove the cyan project label (`task.project`) from each task row — it's redundant when the project panel is visible.

No other changes.

### `web/src/components/Output.jsx`

No changes.

---

## Tests

- `tests/watcher.test.js`: update any test that calls `resolveActiveSession` to call `resolveAllSessions` and assert an array is returned.
- `tests/TaskList.test.jsx`: smoke tests remain valid (no render tests).
- New smoke test in `tests/ProjectList.test.jsx` mirroring the existing component smoke tests.

---

## File Changeset

| File | Change |
|------|--------|
| `src/watcher.js` | `resolveActiveSession` → `resolveAllSessions`, returns `string[]` |
| `web/src/App.jsx` | Add `selectedProject` state, derive `projects` + `filteredTasks`, 3-panel layout |
| `web/src/components/ProjectList.jsx` | New component |
| `web/src/components/TaskList.jsx` | Remove project label from rows |
| `tests/watcher.test.js` | Update to `resolveAllSessions` |
| `tests/ProjectList.test.jsx` | New smoke tests |

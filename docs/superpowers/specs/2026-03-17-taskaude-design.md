# Taskaude — Design Spec
**Date:** 2026-03-17
**Status:** Approved

## Problem

Claude Code supports running background tasks (bash commands), but provides no persistent visibility into what is running, what finished, and what failed. Developers have to hunt through terminal output or wait for Claude to report back.

## Solution

A terminal UI (TUI) dashboard that watches Claude Code's task output directory and displays live task status — no manual registration, no hooks, no config.

## Users

Solo developers using Claude Code. Primary pain point: kicked off a long background task and have no idea of its current state.

## Architecture

Three layers:

### 1. File Watcher (`src/watcher.js`)

Uses `chokidar` to watch Claude Code's task output directory.

**Path by platform:**
| Platform | Base path |
|---|---|
| Windows | `%LOCALAPPDATA%\Temp\claude\` |
| macOS | `$TMPDIR/claude/` (fallback: `~/.claude/tmp/`) |
| Linux | `$XDG_CACHE_HOME/claude/` (fallback: `~/.cache/claude/`) |

**Directory structure:**
```
<base>/<project-hash>/<session-id>/tasks/<task-id>.output
```
- `project-hash` — derived by Claude Code from the working directory path (e.g. `C--Users-ibrah-cascadeProjects-competitioner`)
- `session-id` — a UUID generated per Claude Code session (e.g. `d7181001-1fc7-433c-927c-54a16dc8f5fb`)
- `task-id` — a variable-length alphanumeric ID per background task. Observed formats: 9-character base36-style (e.g. `b8oc1ww6a`) and 17-character hex (e.g. `a13d89e1d7bda4de6`). Do not assume fixed length or apply length-based validation. (e.g. `b181s8tcr`)

**Session discovery on startup:**
1. Glob `<base>/**/tasks/*.output` to find all output files across all projects and sessions
2. Sort session directories by most recently modified — select the top result as the "active" session
3. Load all `.output` files found in that session directory

Note: "active session" means whichever Claude Code session wrote most recently — regardless of which project the user is currently in. This is intentional: taskaude shows what Claude Code is doing right now, not what it was doing in a specific project directory.

**Watcher events emitted:**
- `task:new` — new `.output` file appeared; payload: `{ id, outputPath }`
- `task:update` — existing `.output` file was modified; payload: `{ id, output }`
- `task:idle` — no write to a task's file for >3 seconds; payload: `{ id }` — triggers status re-evaluation in the store

**`task:idle` timer:** The watcher maintains a `Map<id, NodeJS.Timeout>` of per-task idle timers. On `task:new` or any chokidar `change` event for a task file, the timer for that task is (re)started at 3000ms. When the timer fires, the watcher emits `task:idle` and removes the timer from the map. Timers are cleared on watcher `close()`.

**Chokidar options:** On Windows (`process.platform === 'win32'`), set `usePolling: true` with `interval: 500` to ensure `change` events are reliably received for files in `%LOCALAPPDATA%\Temp`. On macOS/Linux, use the default FSEvents/inotify backend (`usePolling: false`).

### 2. `.output` File Format

Claude Code writes raw stdout/stderr from the background command to this file. The file:
- Contains only plain text output — no embedded metadata, no headers
- Grows incrementally as the process runs
- Is not deleted or truncated when the process ends

**Consequences:**
- `cmd` (the original command string) is **not available** in the file. The UI shows the task ID instead of a command string.
- `startTime` is approximated using `fs.stat(path).birthtimeMs` (file creation time). If `birthtimeMs` is 0 or equals `ctimeMs` (indicating the filesystem does not populate birthtime), fall back to `mtimeMs` of the first observed write event.

### 3. Task Store (`src/store.js`)

In-memory state for all discovered tasks.

**Task record schema:**
```js
{
  id: string,           // task ID (filename without .output, e.g. "b181s8tcr")
  outputPath: string,   // absolute path to .output file
  output: string,       // full output text read from file
  status: 'running' | 'done' | 'failed',
  startTime: Date,      // approximated from file ctime
  lastModified: Date,   // from fs.stat mtime
  elapsed: string,      // human-readable, e.g. "2m 41s"
}
```

**Output normalization (apply before any pattern matching or line splitting):**
1. Strip ANSI/VT escape sequences: replace `/\x1b\[[0-9;]*[a-zA-Z]/g` with `''`
2. Normalize line endings: replace `\r\n` → `\n`, then remaining `\r` → `\n`

**Status inference rules (applied in order):**
1. `running` — file was modified within the last 3 seconds
2. `failed` — file idle >3s AND normalized tail (last 20 lines) matches any of:
   - `/exit code [1-9]\d*/i`
   - `/SIGKILL|SIGTERM|SIGSEGV/`
   - `/^error:/im` ← case-insensitive; matches `Error:`, `ERROR:`, etc.
   - `/npm ERR!/`
   - `/command not found/i`
3. `done` — file idle >3s and none of the above failure patterns matched

**Caveat:** The 3s idle threshold is a heuristic. A task that pauses output for >3s (e.g. waiting on network) will be temporarily mis-classified as `done`. It will self-correct when the file is written again. This limitation is acceptable for v1.

### 4. Ink TUI (`src/app.js` + `src/components/`)

React-based terminal UI using Ink v4 + React 18.

**Layout:** Two-pane side-by-side
```
┌─ taskaude ──────────────────────────────────────────────────┐
│ TASKS (4)              │ b181s8tcr                           │
│ ─────────────────────  │ started: 2m 41s ago                 │
│ ⦿ b181s8tcr  ←        │ ──────────────────────────────────  │
│   running  2m 41s      │ > next build                        │
│                        │   ▲ Next.js 15.2.4                  │
│ ✓ a3f9x2kp             │   ✓ Compiled successfully           │
│   done     1m 12s      │   ✓ Linting and checking types      │
│                        │   ⦿ Collecting page data ...        │
│ ✗ c7d1m8nq             │                                     │
│   failed   0m 45s      │                                     │
│                        │                                     │
│ ↑↓ navigate  Tab focus │ ↑↓ scroll  c clear  q quit          │
└────────────────────────┴─────────────────────────────────────┘
```

**Keyboard controls:**
- `↑` / `↓` — navigate task list (left pane focused)
- `Tab` — switch focus between left and right pane
- `↑` / `↓` — scroll output (right pane focused)
- `c` — clear in-memory output buffer for selected task (does not modify file on disk; output reloads on next file write or `r`)
- `r` — force re-read all output files from disk
- `q` — quit

## Project Structure

```
taskaude/
├── src/
│   ├── watcher.js           # chokidar watcher, emits task events
│   ├── store.js             # in-memory task state + status inference
│   ├── app.js               # Ink root component, wires store → UI
│   ├── components/
│   │   ├── TaskList.jsx     # left pane — scrollable task list
│   │   └── Output.jsx       # right pane — full output + scroll
│   └── utils.js             # elapsed time, status icons, path helpers
├── bin/
│   └── taskaude.js          # CLI entry point (node bin/taskaude.js)
├── docs/
│   └── superpowers/specs/
│       └── 2026-03-17-taskaude-design.md
└── package.json
```

## Dependencies

| Package | Version | Purpose |
|---|---|---|
| `ink` | `^4.4.1` | React-based TUI renderer |
| `react` | `^18.3.1` | Required peer dep for Ink v4 |
| `chokidar` | `^3.6.0` | Cross-platform file watcher |

Note: `ink-use-stdout-dimensions` is not needed — use `useWindowSize` from `ink` (Ink v4 built-in), which returns `{ columns, rows }`.

## Error Handling

| Scenario | Behaviour |
|---|---|
| Base temp dir not found | Show message with expected platform path, exit |
| No tasks found in current session | Show "No tasks yet. Run a background command in Claude Code." |
| Watcher error | Surface error message in status bar, keep running |
| File read error | Mark task status as `unknown`, show error in output pane |
| Unknown platform | Fall back to checking common paths; if none found, exit with guidance |

## Out of Scope (v1)

- Showing the original command string (not available in `.output` files)
- Tracking processes started outside of Claude Code
- Reliable exit code extraction
- Task cancellation / kill
- Persistence across restarts
- Multi-session aggregation (shows most recent session only)

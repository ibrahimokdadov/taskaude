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
Uses `chokidar` to watch Claude Code's task output directory:
```
%LOCALAPPDATA%\Temp\claude\<project-hash>\<session-id>\tasks\*.output
```
- On startup: scans all existing sessions, loads any `.output` files found
- Auto-selects the most recently modified session as current
- Emits events: `task:new`, `task:update`, `task:idle`

### 2. Task Store (`src/store.js`)
In-memory state for all discovered tasks. Each task record:
```js
{
  id: string,           // filename without .output
  outputPath: string,   // full path to .output file
  output: string,       // full output text
  status: 'running' | 'done' | 'failed',
  startTime: Date,
  lastModified: Date,
  elapsed: string,      // human-readable
}
```

**Status inference:**
- `running` — file modified within last 3 seconds
- `done` — file idle >3s, no error signal in output tail
- `failed` — file idle >3s AND output tail contains exit code / error signal

### 3. Ink TUI (`src/app.js` + `src/components/`)
React-based terminal UI using the Ink library.

**Layout:** Two-pane side-by-side
```
┌─ taskaude ──────────────────────────────────────────────────┐
│ TASKS (4)              │ build-validator                     │
│ ─────────────────────  │ cmd: npm run build && node valid... │
│ ⦿ build-validator  ←  │ ──────────────────────────────────  │
│   running  2m 41s      │ > next build                        │
│                        │   ▲ Next.js 15.2.4                  │
│ ✓ test-runner          │   ✓ Compiled successfully           │
│   done     1m 12s      │   ✓ Linting and checking types      │
│                        │   ⦿ Collecting page data ...        │
│ ✗ lint                 │                                     │
│   failed   0m 45s      │                                     │
│                        │                                     │
│ ↑↓ navigate  Tab focus │ ↑↓ scroll  c clear  q quit          │
└────────────────────────┴─────────────────────────────────────┘
```

**Keyboard controls:**
- `↑` / `↓` — navigate task list (left pane focused)
- `Tab` — switch focus between left and right pane
- `↑` / `↓` — scroll output (right pane focused)
- `c` — clear output of selected task
- `r` — force refresh all file reads
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
│   └── taskaude.js          # CLI entry point
├── docs/
│   └── superpowers/specs/
│       └── 2026-03-17-taskaude-design.md
└── package.json
```

## Dependencies

- `ink` — React-based TUI renderer
- `react` — required by Ink
- `chokidar` — cross-platform file watcher
- `ink-use-stdout-dimensions` — responsive layout based on terminal size

## Error Handling

| Scenario | Behaviour |
|---|---|
| Temp dir not found | Friendly message with expected path |
| No tasks yet | "No tasks found. Run a background command in Claude Code." |
| Watcher error | Surface in status bar, keep running |
| File read error | Mark task as unknown, show error in output pane |

## Out of Scope (v1)

- Tracking processes started outside of Claude Code
- Exit code extraction (files don't contain exit codes reliably)
- Task cancellation / kill
- Persistence across restarts
- Multi-session aggregation (shows current/most recent session only)

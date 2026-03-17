# Taskaude Web View Design

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Ink TUI with a local Express + Vite/React web dashboard that the CLI starts automatically.

**Architecture:** The CLI starts an Express server, opens the browser, and keeps the process alive. The server bridges the existing watcher/store to the browser via SSE and a small REST API. The Vite/React frontend renders a two-pane dashboard in the browser.

**Tech Stack:** Node.js + Express, Vite + React 18, Tailwind CSS v4, SSE for real-time updates.

---

## What Changes

### Removed
- `src/app.jsx` — Ink root component
- `src/components/TaskList.jsx` — Ink task list
- `src/components/Output.jsx` — Ink output pane
- `tests/TaskList.test.jsx` — Ink component tests
- `tests/Output.test.jsx` — Ink component tests
- `ink`, `ink-testing-library` dependencies

### Kept Unchanged
- `src/watcher.js`
- `src/store.js`
- `src/utils.js`
- `tests/utils.test.js`
- `tests/store.test.js`
- `tests/watcher.test.js`
- `vitest.config.js` — no changes needed; backend tests remain node environment

### New Files
- `src/server.js` — Express server
- `web/index.html` — Vite entry point
- `web/vite.config.js` — Vite config with dev proxy
- `web/src/main.jsx` — React entry point
- `web/src/index.css` — Tailwind CSS entry
- `web/src/utils.js` — Browser-safe utilities (formatElapsed, statusIcon)
- `web/src/App.jsx` — Root React component
- `web/src/components/TaskList.jsx` — Left sidebar
- `web/src/components/Output.jsx` — Right output pane

### Modified
- `bin/taskaude.js` — replace Ink render with server start + browser open
- `package.json` — update deps and scripts

---

## Dependencies

All dependencies live in the root `package.json`. There is no separate `web/package.json`.

### Add (runtime)
- `express`
- `open` — opens the browser from the CLI

### Add (devDependencies)
- `vite`
- `react-dom` — currently missing (only `react` is present)
- `tailwindcss` — v4
- `@tailwindcss/vite` — Tailwind v4 Vite plugin (replaces PostCSS setup)
- `concurrently` — runs backend + vite in parallel for dev

### Remove
- `ink`
- `ink-testing-library`
- `esbuild` — no longer needed (CLI no longer uses JSX; esbuild bundle step is removed)
- `esbuild-register` — no longer needed

### Kept
- `react` — still needed by the Vite/React frontend
- `@vitejs/plugin-react` — already present, kept
- `chokidar` — kept, used by watcher

---

## Package Scripts

```json
{
  "build": "vite build --config web/vite.config.js",
  "start": "node bin/taskaude.js",
  "dev": "concurrently \"NODE_ENV=development node bin/taskaude.js\" \"vite --config web/vite.config.js\"",
  "test": "vitest run",
  "test:watch": "vitest"
}
```

The `bin` field in `package.json` changes from `./dist/taskaude.mjs` to `./bin/taskaude.js` (plain Node ESM, no bundling needed since there is no JSX in the CLI).

---

## Backend (`src/server.js`)

`server.js` exports a single async `start()` function that returns a Promise resolving to the port number once the server is listening. This is the contract `bin/taskaude.js` uses to learn the final port before opening the browser.

```js
// Usage from bin/taskaude.js:
const port = await start()
open(`http://localhost:${port}`)
```

**Port selection:** Always `3737` in development (if taken, fail fast with a clear error message). In production, probe ports incrementally from `3737` using `net.createServer` until a free one is found. The Vite proxy hardcodes port `3737`, so dev must bind there. Pass `isDev = process.env.NODE_ENV === 'development'` to gate this behavior.

**Lifecycle:**
1. Create Express app
2. Resolve `baseDir` using `resolveBaseDir()` from `src/utils.js`
3. Guard: if `baseDir` does not exist on disk (`fs.existsSync`), reject the `start()` Promise with a descriptive error (e.g. `"Claude task directory not found: <path>"`)
4. Instantiate `TaskStore` and `FileWatcher`
5. Register watcher event handlers (see below)
6. Register a temporary `watcher.once('error', err => reject(err))` **before** calling `watcher.start()` — the watcher signals startup failures via `emit('error')`, not via a rejected Promise. After the server is listening (step 8), remove this startup handler and replace it with a permanent log-only `watcher.on('error', err => console.error(...))` so that subsequent chokidar errors don't attempt to call `reject` on an already-settled Promise.
7. Start watcher: `await watcher.start(baseDir)`
8. Listen on the resolved port
9. Register `SIGINT`/`SIGTERM` handlers: call `watcher.close()` then `server.close()`

**SSE client registry:** Maintain a `Set<Response>` of active SSE connections. On client disconnect (`req.on('close')`), remove from the set.

**SSE wire format:** Use named SSE events so the client can use `addEventListener` per type:
```
event: task:update
data: {"id":"abc","status":"running",...}

```
Each message ends with a blank line (`\n\n`). The event name matches the payload `type` field.

**Watcher → SSE bridge:**
- `task:new` → `store.upsert(id, outputPath)` → broadcast named event `task:new` with `serialize(store.get(id))`
- `task:update` → `store.update(id, output)` → broadcast named event `task:update` with `serialize(store.get(id))`
- `task:idle` → `store.markIdle(id)` → broadcast named event `task:idle` with `serialize(store.get(id))`

**`serialize(task)` helper:** Converts a task record to a JSON-safe object. Critically:
- Include `startTime` as ISO string (for client-side elapsed calculation)
- **Omit `elapsed`** — the client computes elapsed from `startTime` every second; including the server-computed `elapsed` string would cause the frontend to render a frozen value
- Strip ANSI from `output` using `normalizeOutput(task.output)` before sending — the server is responsible for clean output; the frontend receives plain text

**Endpoints:**

`GET /api/tasks`
- Returns `store.getAll().map(serialize)` as JSON array
- Response: `200 application/json`

`GET /events`
- SSE stream (headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`)
- On connect: immediately send current state as named event `reload` with payload `{ tasks: store.getAll().map(serialize) }`
- Then keep connection open; push events as watcher fires them
- On client disconnect: remove from SSE set

`POST /api/tasks/:id/clear`
- Calls `store.clearOutput(id)`
- Broadcasts named SSE event `task:update` with raw payload `serialize(store.get(id))` (no `type`/`task` wrapper — same shape as all other broadcasts)
- Response: `200 { ok: true }`, or `404 { error: 'not found' }` if id unknown

`POST /api/reload`
- Calls `store.reloadAll()`
- Broadcasts a single named event `reload` with payload `{ tasks: store.getAll().map(serialize) }` to all SSE clients
- Response: `200 { ok: true }`

**Static serving (production only):**
```js
if (process.env.NODE_ENV !== 'development') {
  app.use(express.static(path.join(import.meta.dirname, '../web/dist')))
}
```

**No CORS middleware needed.** In dev, all browser requests go through the Vite proxy (same origin). In prod, Express serves the frontend directly (same origin). CORS does not apply.

---

## Frontend (`web/`)

### `web/index.html`
Standard Vite entry. With `root: 'web'` in `vite.config.js`, all paths in `index.html` are relative to `web/`. Script tag:
```html
<script type="module" src="./src/main.jsx"></script>
```

### `web/src/main.jsx`
```jsx
import React from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
createRoot(document.getElementById('root')).render(<App />)
```

### `web/src/index.css`
Tailwind v4 entry (single import, no PostCSS config needed):
```css
@import "tailwindcss";
```

### `web/src/utils.js`
Browser-safe utilities copied from `src/utils.js` — **only the pure functions with no Node.js imports**:
- `formatElapsed(startTimeMs)` — same implementation as in `src/utils.js`
- `statusIcon(status)` — same implementation

Do not import `path` or `os` here. Do not import from `src/utils.js` directly (Vite would fail on Node built-ins).

### `web/vite.config.js`
```js
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: 'web',
  build: { outDir: '../web/dist', emptyOutDir: true },
  server: {
    proxy: {
      '/api': 'http://localhost:3737',
      // timeout: 0 is required — SSE is a long-lived connection; without it,
      // http-proxy's default socket timeout silently drops the stream in dev.
      '/events': { target: 'http://localhost:3737', changeOrigin: false, timeout: 0 },
    },
  },
})
```

### `web/src/App.jsx`
- On mount: fetch `/api/tasks` → initialize `tasks` state (Map keyed by `id`)
- Open `EventSource('/events')` — handles:
  - `task:new` / `task:update` / `task:idle` → merge single task into map
  - `reload` → replace entire map with new tasks array
- State: `tasks` (Map), `selectedId` (string | null)
- Auto-select first task if none selected and tasks arrive
- Layout: `h-screen flex flex-col bg-gray-950 text-gray-100 font-mono`
  - Header bar: "taskaude" title + task count
  - Body: `flex flex-row flex-1 overflow-hidden`
    - `TaskList` at `w-80 flex-shrink-0`
    - `Output` fills remaining width

### `web/src/components/TaskList.jsx`
Props: `tasks` (array), `selectedId`, `onSelect` (callback)

- Renders a scrollable `<ul>` of tasks
- Each row shows:
  - Status icon: `⦿` (blue, running), `✓` (green, done), `✗` (red, failed), `?` (gray)
  - Task ID (truncated if long)
  - Elapsed time — computed client-side from `task.startTime` (ISO string), ticking every second via `setInterval`
  - Project name in cyan/dim
- Selected row: `bg-gray-800` background
- Click → `onSelect(task.id)`

**Elapsed ticking:** A single `setInterval` at the `TaskList` level re-renders the elapsed display every 1000ms. Uses `formatElapsed` from `web/src/utils.js` (the browser-safe copy — do NOT import from `src/utils.js`).

### `web/src/components/Output.jsx`
Props: `task` (object | null)

- Empty state if no task selected
- Header: task ID, status badge, elapsed time
- `<pre>` block with `overflow-auto`, `whitespace-pre-wrap` for output content — output is already ANSI-stripped by the server
- Auto-scroll: `useRef` on the `<pre>` container; `useEffect` scrolls to bottom on `task.output` change, unless user has manually scrolled up (track with `onScroll`)
- "Clear" button → `POST /api/tasks/:task.id/clear`
- "Reload All" button → `POST /api/reload`

---

## CLI Entry Point (`bin/taskaude.js`)

Replace Ink render with:

```js
import { start } from '../src/server.js'
import open from 'open'

const port = await start()
console.log(`taskaude running at http://localhost:${port}`)
await open(`http://localhost:${port}`)
// Process stays alive because the HTTP server is listening
```

Remove all Ink, React, TaskStore, FileWatcher imports from `bin/taskaude.js` — those are now owned by `src/server.js`.

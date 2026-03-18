# Postgres Persistence + Calendar View

**Date:** 2026-03-18

## Problem

1. All task data is in-memory and lost on server restart. No historical record of what ran on previous days.
2. No way to browse past task activity by date.

## Scope

- Add PostgreSQL persistence: tasks written to DB on completion, readable across restarts
- Add Calendar view: header tab switches between Live and Calendar mode; calendar shows a month grid with dots on active days; clicking a day loads tasks from that day

Out of scope: output streaming to DB (only final state persisted), multi-user auth, data retention/pruning policies.

---

## Database

**Connection:** `localhost:5432`, user `postgres`, password `admin`, database controlled by `PGDATABASE` env var (default `taskaude`). Tests set `PGDATABASE=taskaude_test` to avoid touching the production DB. The database is auto-created on first run if missing.

**Schema** — single table, created with `CREATE TABLE IF NOT EXISTS` on startup:

```sql
CREATE TABLE IF NOT EXISTS tasks (
  id           TEXT PRIMARY KEY,
  project      TEXT NOT NULL,
  session      TEXT NOT NULL,
  title        TEXT,
  output       TEXT NOT NULL DEFAULT '',
  status       TEXT NOT NULL,
  start_time   TIMESTAMPTZ NOT NULL,
  last_modified TIMESTAMPTZ NOT NULL,
  output_path  TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS tasks_date_idx ON tasks (DATE(start_time AT TIME ZONE 'UTC'));
```

**Write strategy:** Persist only on `task:idle` (task reaches done/failed/unknown). No DB writes during streaming updates — the in-memory `TaskStore` handles live output. This avoids high-frequency writes during long-running tasks.

**No data is loaded back from DB into the live view on startup.** The live view is always driven by the file watcher. Postgres is for history only.

---

## Backend

### New: `src/db.js`

Owns the pg connection pool (module-scoped) and all DB operations. Exports:

- `connect()` — creates pool (`postgres`/`admin`/`$PGDATABASE`), runs `CREATE TABLE IF NOT EXISTS`. Throws if connection fails. Pool is stored in module scope — callers do not hold a reference to it.
- `upsert(task)` — accepts the store's camelCase task object and maps to snake_case columns internally before issuing `INSERT ... ON CONFLICT (id) DO UPDATE`. Mapping: `outputPath → output_path`, `startTime → start_time`, `lastModified → last_modified`.
- `getDays()` — returns `[{ date: 'YYYY-MM-DD', count: number }]` for all days that have tasks, ordered descending. Returns the full set for all time; month filtering is done client-side.
- `getTasksByDate(dateStr)` — returns task rows where `DATE(start_time AT TIME ZONE 'UTC') = $1`, ordered by `start_time ASC`. Rows are returned in camelCase (mapped from snake_case columns) so they can pass directly through `serialize()`.

### `src/server.js`

- Import `db` and call `db.connect()` at startup (before watcher starts). If connect fails, log a warning and continue without persistence (graceful degradation — live view still works).
- On `task:idle`: after `store.markIdle(id)`, call `db.upsert(store.get(id))` (fire-and-forget, log errors).
- Two new REST endpoints:
  - `GET /api/history/days` → `db.getDays()`
  - `GET /api/history/tasks?date=YYYY-MM-DD` — validates `date` matches `/^\d{4}-\d{2}-\d{2}$/`, returns 400 if absent or malformed. On valid input: `db.getTasksByDate(date)` returns camelCase rows which are passed through `serialize()` before responding, ensuring the frontend receives the same shape as live tasks.

---

## Frontend

### Header tabs

Two tabs added to the header: **Live** and **Calendar**. Clicking switches `view` state in `App.jsx` between `'live'` and `'calendar'`. Current date display stays right-aligned.

### Live mode

Unchanged from current behaviour.

### Calendar mode

Left panel replaced by `CalendarPanel`. Middle + right panels reuse existing `TaskList` and `Output` components unchanged.

`App.jsx` new state in calendar mode:
- `calendarDays: { date, count }[]` — loaded from `/api/history/days` once on tab switch (full history). Month navigation in `CalendarPanel` filters this array client-side — no additional fetches per month.
- `selectedDate: string | null` — the date string clicked in the grid
- `historyTasks: task[]` — loaded from `/api/history/tasks?date=...` when `selectedDate` changes
- `selectedHistoryId: string | null` — selected task in calendar view

### New: `web/src/components/CalendarPanel.jsx`

Props: `days: { date, count }[]`, `selectedDate: string | null`, `onSelect: (date: string) => void`

Renders a month grid. Navigation arrows step month forward/backward. Days that have tasks show a small blue dot beneath the number. Selected day is highlighted. Days in the current month with no tasks are dimmed. Days outside the current month are not rendered (empty cells).

Fixed width matching `ProjectList` (~180px).

### `web/src/App.jsx`

- Add `view` state (`'live' | 'calendar'`), default `'live'`
- Add `calendarDays`, `selectedDate`, `historyTasks`, `selectedHistoryId` state
- On `view` switching to `'calendar'`: fetch `/api/history/days`, set `calendarDays`
- On `selectedDate` change: fetch `/api/history/tasks?date=...`, set `historyTasks`; auto-select first task
- In calendar mode render: `<CalendarPanel>`, `<TaskList tasks={historyTasks} ...>`, `<Output task={selectedHistoryTask}>`
- `Output` clear/reload buttons should be hidden in calendar mode (history is read-only). Pass a `readOnly` prop to `Output`.

### `web/src/components/Output.jsx`

Add `readOnly` prop (default `false`). When `true`, hide the Clear and Reload All buttons.

---

## Dependencies

Add `pg` package: `npm install pg`

---

## Tests

### `tests/db.test.js`

Integration tests against a real local Postgres instance. Tests set `process.env.PGDATABASE = 'taskaude_test'` before importing `db.js`, and drop/recreate the table in `beforeEach` to ensure isolation.

- `connect()` creates the table
- `upsert()` inserts a task row (verify camelCase→snake_case mapping round-trips correctly)
- `upsert()` on same ID updates the row
- `getDays()` returns correct date entries
- `getTasksByDate()` returns tasks for the given date only, not other dates

### `tests/CalendarPanel.test.jsx`

Smoke tests (same pattern as other component tests):
- exports a default component
- component name is `CalendarPanel`

---

## File Changeset

| File | Change |
|------|--------|
| `src/db.js` | New — pool, migrate, upsert, getDays, getTasksByDate |
| `src/server.js` | Import db, connect on startup, upsert on task:idle, add /api/history/* endpoints |
| `web/src/App.jsx` | Add view state, calendar state, header tabs, calendar mode render |
| `web/src/components/CalendarPanel.jsx` | New — month grid with dot indicators |
| `web/src/components/Output.jsx` | Add readOnly prop, hide buttons when true |
| `tests/db.test.js` | New — integration tests |
| `tests/CalendarPanel.test.jsx` | New — smoke tests |
| `package.json` | Add `pg` dependency |

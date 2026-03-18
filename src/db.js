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
    startTime: r.start_time,
    lastModified: r.last_modified,
    outputPath: r.output_path,
  }))
}

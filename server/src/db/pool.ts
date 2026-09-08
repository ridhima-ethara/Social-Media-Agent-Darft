/**
 * The single connection pool, and the query helpers everything else uses.
 *
 * Raw SQL by design — no ORM, no query builder (Part 3). Every call is
 * parameterised; string interpolation into SQL never happens anywhere in this
 * codebase.
 */

import pg from 'pg'
import { config, redactUrl } from '../config'

const { Pool } = pg

let pool: pg.Pool | null = null

/** Lazily constructed so importing this module never opens a socket. */
export function getPool(): pg.Pool {
  if (pool) return pool
  pool = new Pool({
    connectionString: config.core.databaseUrl,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 8_000,
    application_name: 'ethara-socialai',
  })

  pool.on('error', (err) => {
    // A pooled client failing while idle must not take the process down.
    console.error('[db] idle client error:', err.message)
  })

  return pool
}

export type QueryParam =
  | string
  | number
  | boolean
  | null
  | undefined
  | Date
  | string[]
  | number[]
  | Record<string, unknown>
  | Array<Record<string, unknown>>

/** Runs a parameterised query and returns the rows. */
export async function query<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: QueryParam[] = [],
): Promise<T[]> {
  const result = await getPool().query<T>(sql, params as unknown[])
  return result.rows
}

/** Runs a query expected to return at most one row. */
export async function queryOne<T extends pg.QueryResultRow = pg.QueryResultRow>(
  sql: string,
  params: QueryParam[] = [],
): Promise<T | null> {
  const rows = await query<T>(sql, params)
  return rows[0] ?? null
}

/** Runs a statement and returns the affected row count. */
export async function execute(sql: string, params: QueryParam[] = []): Promise<number> {
  const result = await getPool().query(sql, params as unknown[])
  return result.rowCount ?? 0
}

/**
 * Runs a function inside a transaction, rolling back on any throw.
 * Used wherever a multi-row write must not be observable half-applied.
 */
export async function transaction<T>(
  fn: (client: pg.PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect()
  try {
    await client.query('BEGIN')
    const out = await fn(client)
    await client.query('COMMIT')
    return out
  } catch (error) {
    await client.query('ROLLBACK').catch(() => {
      /* the original error is the one worth surfacing */
    })
    throw error
  } finally {
    client.release()
  }
}

/**
 * Asserts the database is reachable, and fails LOUDLY with the exact fix.
 *
 * Silently serving fabricated data would be worse than failing, so the API
 * refuses to start without Postgres (Appendix A, degradation matrix).
 */
export async function assertDb(): Promise<void> {
  try {
    await query('SELECT 1')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      [
        '',
        '  ✗ PostgreSQL is unreachable.',
        '',
        `    Target : ${redactUrl(config.core.databaseUrl)}`,
        `    Error  : ${message}`,
        '',
        '    The API will not start without a database, because serving',
        '    fabricated data would be worse than failing loudly.',
        '',
        '    Fix:',
        '      docker compose up -d db',
        '      npm run db:reset',
        '',
        '    The web app continues to work standalone on bundled demo data.',
        '',
      ].join('\n'),
    )
    throw new Error('Database unreachable')
  }
}

/** True when the database answers. Used by /health, which must never throw. */
export async function databaseReachable(): Promise<boolean> {
  try {
    await query('SELECT 1')
    return true
  } catch {
    return false
  }
}

export async function closePool(): Promise<void> {
  if (!pool) return
  await pool.end()
  pool = null
}

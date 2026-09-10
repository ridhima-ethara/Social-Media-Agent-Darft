/**
 * The single connection pool, and the query helpers everything else uses.
 *
 * Raw SQL by design — no ORM, no query builder (Part 3). Every call is
 * parameterised; string interpolation into SQL never happens anywhere in this
 * codebase.
 */

import pg from 'pg'
import { config, redactUrl } from '../config'

const { Pool, types } = pg

/**
 * Timestamps arrive as strings, not `Date` objects.
 *
 * Every row type in `repo.ts` declares its timestamp columns as `string`, and
 * without this the driver hands back a `Date` — so the types were quietly
 * lying and TypeScript could not catch the difference. It surfaced as
 * `p.published_at?.startsWith is not a function`, which took out the monthly
 * report and the analytics export at run time: `?.` guards a null, and a
 * `Date` is not null.
 *
 * Parsed here, at the one boundary where rows are produced, so the declaration
 * and the value agree for every consumer rather than at each call site that
 * remembers to convert. ISO 8601 is what the API already serialises to and
 * what `src/types.ts` mirrors, so this is the shape the product speaks.
 */
const TIMESTAMPTZ = 1184
const TIMESTAMP = 1114
const DATE = 1082

const asIso = (value: string | null): string | null =>
  value === null ? null : new Date(value).toISOString()

types.setTypeParser(TIMESTAMPTZ, asIso)
types.setTypeParser(TIMESTAMP, asIso)
// A bare `date` has no time and no zone; keeping it as `YYYY-MM-DD` avoids
// inventing a midnight in some timezone that the column never stated.
types.setTypeParser(DATE, (value: string | null) => value)

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

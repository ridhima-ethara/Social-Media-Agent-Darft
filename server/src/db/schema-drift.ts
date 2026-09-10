/**
 * SCHEMA DRIFT — does the live database still match `schema.sql`?
 *
 * WHY THIS EXISTS. `schema.sql` is applied with `CREATE TABLE IF NOT EXISTS`,
 * which is idempotent for tables and blind to columns: a table that already
 * exists is left exactly as it was, so a column added to the schema after that
 * table was created never reaches the database. Nothing complains. The failure
 * arrives later, from inside a pipeline run, as
 *
 *     column "platform" of relation "scraped_items" does not exist
 *
 * — three minutes into a crawl, having already spent the network calls, and
 * naming a column rather than the reset that would fix it.
 *
 * This module turns that into a question that can be asked in milliseconds,
 * before any work starts. It is deliberately read-only: it reports drift and
 * names the command that repairs it, and it never alters a table itself.
 * Auto-adding a column would have to invent a value for the existing rows, and
 * a silently back-filled column is worse than a loud failure.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { query } from './pool'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(HERE, 'schema.sql')

export interface TableDrift {
  table: string
  /** Declared in schema.sql, absent from the database. */
  missingColumns: string[]
  /** The whole table is absent. */
  missingTable: boolean
}

/**
 * The columns `schema.sql` declares, per table.
 *
 * A deliberately small parser rather than a SQL one: it reads the
 * `CREATE TABLE` bodies and takes the first identifier of each line that starts
 * one. Constraint lines are skipped by keyword, comments and blank lines by
 * shape. It only has to understand the schema this repository actually writes,
 * and being wrong is safe — an unrecognised line yields no column name, so the
 * check under-reports rather than inventing drift.
 */
export function declaredColumns(sql = readFileSync(SCHEMA_PATH, 'utf8')): Map<string, Set<string>> {
  const tables = new Map<string, Set<string>>()
  const CONSTRAINT_KEYWORDS = new Set([
    'primary', 'foreign', 'unique', 'check', 'constraint', 'exclude', 'like',
  ])

  const createRe = /CREATE TABLE (?:IF NOT EXISTS )?([a-z_][a-z0-9_]*)\s*\(/gi
  let match: RegExpExecArray | null

  while ((match = createRe.exec(sql)) !== null) {
    const table = (match[1] as string).toLowerCase()

    // Walk forward counting parentheses so a column with its own parens —
    // NUMERIC(10,2), a CHECK (...) list — does not end the body early.
    let depth = 1
    let i = createRe.lastIndex
    for (; i < sql.length && depth > 0; i += 1) {
      const ch = sql[i]
      if (ch === '(') depth += 1
      else if (ch === ')') depth -= 1
    }
    const body = sql.slice(createRe.lastIndex, i - 1)

    const columns = new Set<string>()
    let nesting = 0
    for (const rawLine of body.split('\n')) {
      const line = rawLine.trim()
      // Only lines at the top level of the body can begin a column.
      const atTop = nesting === 0
      for (const ch of rawLine) {
        if (ch === '(') nesting += 1
        else if (ch === ')') nesting -= 1
      }
      if (!atTop || line === '' || line.startsWith('--')) continue

      const first = /^([a-z_][a-z0-9_]*)/i.exec(line)
      if (!first) continue
      const name = (first[1] as string).toLowerCase()
      if (CONSTRAINT_KEYWORDS.has(name)) continue
      columns.add(name)
    }
    tables.set(table, columns)
  }

  return tables
}

/** Every table and column the schema declares but the database does not have. */
export async function findSchemaDrift(): Promise<TableDrift[]> {
  const declared = declaredColumns()
  if (declared.size === 0) return []

  const rows = await query<{ table_name: string; column_name: string }>(
    `SELECT table_name, column_name
       FROM information_schema.columns
      WHERE table_schema = current_schema()`,
  )

  const live = new Map<string, Set<string>>()
  for (const row of rows) {
    const table = row.table_name.toLowerCase()
    if (!live.has(table)) live.set(table, new Set())
    live.get(table)?.add(row.column_name.toLowerCase())
  }

  const drift: TableDrift[] = []
  for (const [table, columns] of declared) {
    const present = live.get(table)
    if (!present) {
      drift.push({ table, missingColumns: [...columns], missingTable: true })
      continue
    }
    const missing = [...columns].filter((c) => !present.has(c))
    if (missing.length > 0) {
      drift.push({ table, missingColumns: missing, missingTable: false })
    }
  }
  return drift
}

/** The operator-facing report. Names the drift and the one command that fixes it. */
export function describeDrift(drift: TableDrift[]): string {
  const lines = [
    'The database no longer matches schema.sql.',
    '',
    ...drift.map((d) =>
      d.missingTable
        ? `  ${d.table}: table is missing entirely`
        : `  ${d.table}: missing ${d.missingColumns.join(', ')}`,
    ),
    '',
    '`db:migrate` cannot repair this: it applies CREATE TABLE IF NOT EXISTS, which',
    'leaves an existing table untouched. Rebuild the schema instead:',
    '',
    '    npm --prefix server run db:migrate -- --fresh && npm run db:seed',
    '',
    'That drops every table this schema owns, so anything captured is lost. Nothing',
    'here is fabricated on your behalf, which is why it stops rather than guessing.',
  ]
  return lines.join('\n')
}

#!/usr/bin/env tsx
/**
 * `npm run db:migrate` — applies schema.sql.
 *
 * The schema is fully idempotent, so this is safe to run repeatedly; the P2
 * gate is that `db:reset` runs clean twice in a row.
 *
 * Passing `--fresh` drops every table this schema owns first. That is
 * destructive and is never part of the default `db:reset`.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config, redactUrl } from '../config'
import { closePool, getPool, query } from './pool'

const HERE = dirname(fileURLToPath(import.meta.url))
const SCHEMA_PATH = join(HERE, 'schema.sql')

/** Every table this schema owns, in dependency order for a clean drop. */
const OWNED_TABLES = [
  'jarvis_briefs',
  'jarvis_confirmations',
  'jarvis_steps',
  'jarvis_turns',
  'jarvis_conversations',
  'lineage_edges',
  'review_queue',
  'activity_events',
  'skill_runs',
  'agent_runs',
  'pipeline_runs',
  'agent_state',
  'agent_skills',
  'knowledge_entries',
  'knowledge_builds',
  'platform_analytics',
  'post_metrics',
  'posts',
  'media_assets',
  'drafts',
  'content_ideas',
  'scraped_items',
  'hashtags',
  'sources',
  'keyword_signals',
  'keywords',
  'workspaces',
]

async function dropAll(): Promise<void> {
  console.log('  Dropping existing tables (--fresh)…')
  for (const table of OWNED_TABLES) {
    await query(`DROP TABLE IF EXISTS ${table} CASCADE`)
  }
}

async function tableCount(): Promise<number> {
  const rows = await query<{ n: string }>(
    `SELECT count(*)::text AS n
       FROM information_schema.tables
      WHERE table_schema = 'public' AND table_type = 'BASE TABLE'`,
  )
  return Number(rows[0]?.n ?? 0)
}

async function main(): Promise<void> {
  const fresh = process.argv.includes('--fresh')

  console.log(`\n  Ethara SocialAI · migrate`)
  console.log(`  target: ${redactUrl(config.core.databaseUrl)}\n`)

  // Fail fast with a useful message rather than a raw socket error.
  try {
    await getPool().query('SELECT 1')
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    console.error(
      [
        '  ✗ Cannot connect to PostgreSQL.',
        '',
        `    Target : ${redactUrl(config.core.databaseUrl)}`,
        `    Error  : ${message}`,
        '',
        '    Fix:',
        '      docker compose up -d db',
        '      npm run db:reset',
        '',
      ].join('\n'),
    )
    process.exit(1)
  }

  if (fresh) await dropAll()

  const sql = readFileSync(SCHEMA_PATH, 'utf8')

  // schema.sql is one idempotent script; pg runs a multi-statement string
  // in an implicit transaction, so a failure leaves nothing half-applied.
  await getPool().query(sql)

  const count = await tableCount()
  console.log(`  ✓ Schema applied. ${count} tables present.\n`)
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('\n  ✗ Migration failed:', error instanceof Error ? error.message : error)
    if (error instanceof Error && error.stack) {
      console.error(error.stack.split('\n').slice(1, 4).join('\n'))
    }
    await closePool().catch(() => undefined)
    process.exit(1)
  })

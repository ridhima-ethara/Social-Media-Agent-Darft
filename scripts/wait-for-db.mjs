#!/usr/bin/env node
/**
 * Blocks until Postgres answers, so `npm run setup` can chain straight into
 * migrate + seed without a race. Prints the exact fix on timeout rather than
 * failing with a bare connection error.
 *
 * IT CONNECTS THE WAY THE APP CONNECTS. This used to shell out to
 * `docker exec ethara-sma-db pg_isready`, which was wrong twice over: it could
 * only ever succeed on the Docker path, so a native Postgres install reported
 * "did not become ready" while serving perfectly and took `npm run setup` down
 * with it; and it asked about database `ethara_sma`, which docker-compose does
 * not create — so even under Docker it waited on a database that did not exist.
 *
 * Using `DATABASE_URL` and the same `pg` driver the server uses means readiness
 * here answers the only question that matters: can the API connect?
 */
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const MAX_ATTEMPTS = 40
const DELAY_MS = 750

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/**
 * `DATABASE_URL` from the environment, else from `server/.env` / `secrets.env`.
 * Read here rather than imported so this stays a dependency-free preflight that
 * runs before anything is built.
 */
function databaseUrl() {
  if (process.env.DATABASE_URL?.trim()) return process.env.DATABASE_URL.trim()

  for (const name of ['.env', 'secrets.env']) {
    const path = join(ROOT, 'server', name)
    if (!existsSync(path)) continue
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*DATABASE_URL\s*=\s*(.+?)\s*$/.exec(line)
      if (match) {
        const value = match[1].replace(/^["']|["']$/g, '').trim()
        if (value) return value
      }
    }
  }
  return 'postgresql://ethara:ethara@localhost:5432/ethara_socialai'
}

function redact(url) {
  return url.replace(/:\/\/([^:]+):[^@]+@/, '://$1:••••@')
}

async function main() {
  const url = databaseUrl()

  // `pg` lives in server/node_modules; resolve from there so this works whether
  // or not the root has its own copy.
  const require = createRequire(join(ROOT, 'server', 'package.json'))
  let Client
  try {
    ;({ Client } = require('pg'))
  } catch {
    console.error('Cannot find the `pg` driver. Run `npm --prefix server install` first.')
    process.exit(1)
  }

  process.stdout.write(`Waiting for PostgreSQL at ${redact(url)}`)

  let lastError = 'no attempt was made'
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    const client = new Client({ connectionString: url, connectionTimeoutMillis: 2000 })
    try {
      await client.connect()
      await client.query('SELECT 1')
      await client.end()
      process.stdout.write(' ready.\n')
      return
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error)
      await client.end().catch(() => undefined)
      process.stdout.write('.')
      await sleep(DELAY_MS)
    }
  }

  process.stdout.write('\n')
  console.error(
    [
      'PostgreSQL did not become ready in time.',
      '',
      `  Target : ${redact(url)}`,
      `  Error  : ${lastError}`,
      '',
      'Start it and try again:',
      '  Docker    : docker compose up -d db && npm run db:reset',
      '  Homebrew  : brew services start postgresql@17 && npm run db:reset',
      '',
      'If the server is running but the database or role is missing, create them:',
      '  createuser -s ethara && createdb -O ethara ethara_socialai',
    ].join('\n'),
  )
  process.exit(1)
}

main()

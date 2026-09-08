#!/usr/bin/env node
/**
 * Blocks until Postgres answers, so `npm run setup` can chain straight into
 * migrate + seed without a race. Prints the exact fix on timeout rather than
 * failing with a bare connection error.
 */
import { execSync } from 'node:child_process'

const CONTAINER = 'ethara-sma-db'
const MAX_ATTEMPTS = 40
const DELAY_MS = 750

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  process.stdout.write('Waiting for PostgreSQL')
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      execSync(`docker exec ${CONTAINER} pg_isready -U ethara -d ethara_sma`, {
        stdio: 'ignore',
      })
      process.stdout.write(' ready.\n')
      return
    } catch {
      process.stdout.write('.')
      await sleep(DELAY_MS)
    }
  }

  process.stdout.write('\n')
  console.error(
    [
      'PostgreSQL did not become ready in time.',
      '',
      'Start it and try again:',
      '  docker compose up -d db',
      '  npm run db:reset',
    ].join('\n'),
  )
  process.exit(1)
}

main()

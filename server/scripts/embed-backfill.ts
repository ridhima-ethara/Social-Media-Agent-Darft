#!/usr/bin/env tsx
/**
 * `npm run db:embed` — embeds every row that has no vector.
 *
 * Rows are written unembedded whenever the embedder is unreachable, because
 * losing a captured page or a cited finding to a restarting daemon would be
 * worse than retrieving it lexically for an hour. This is what closes that gap.
 *
 * Resumable and idempotent: the work queue is "rows where embedding IS NULL, or
 * whose embedding came from a different model", so an interrupted run simply
 * leaves fewer rows for the next one. Safe to run on a schedule.
 *
 * It also re-embeds after a model change, which matters more than it looks: a
 * vector from one model compared against another's returns a confident number
 * that means nothing.
 */

import { closePool } from '../src/db/pool'
import { backfillEmbeddings, embeddingCoverage } from '../src/db/repo'
import { embeddingAdapter } from '../src/integrations/embeddings'
import { config, redactUrl } from '../src/config'

const TABLES = ['knowledge_entries', 'scraped_items'] as const

async function main(): Promise<void> {
  console.log('\n  Ethara SocialAI · embed backfill')
  console.log(`  target: ${redactUrl(config.core.databaseUrl)}`)
  console.log(`  model:  ${config.embeddings.model} (${config.embeddings.dimensions} dims)\n`)

  if (!embeddingAdapter.isConfigured()) {
    console.error(`  ✗ ${embeddingAdapter.unavailableReason()}\n`)
    console.error('    Nothing was embedded. Retrieval stays lexical until this is fixed.\n')
    process.exit(1)
  }

  console.log('  before:')
  for (const row of await embeddingCoverage()) {
    console.log(`    ${row.table.padEnd(18)} ${row.embedded}/${row.total} embedded`)
  }
  console.log('')

  let totalEmbedded = 0
  let totalFailed = 0

  for (const table of TABLES) {
    let pass = 0
    for (;;) {
      const progress = await backfillEmbeddings(table)
      if (progress.found === 0) break

      pass += 1
      totalEmbedded += progress.embedded
      totalFailed += progress.failed
      process.stdout.write(
        `\r  ${table.padEnd(18)} pass ${String(pass).padStart(3)} · ` +
          `${totalEmbedded} embedded, ${totalFailed} failed`,
      )

      if (progress.reason !== undefined) {
        console.log(`\n  ! ${table}: ${progress.reason}`)
      }
      // Every row in the batch failed and the reason is not transient per-row —
      // stop rather than spin through the whole table producing the same error.
      if (progress.embedded === 0 && progress.failed === progress.found) {
        console.log(`\n  ✗ ${table}: the whole batch failed, stopping this table.`)
        break
      }
    }
    process.stdout.write('\n')
  }

  console.log('\n  after:')
  for (const row of await embeddingCoverage()) {
    const models = row.models.length > 0 ? row.models.join(', ') : 'none'
    console.log(`    ${row.table.padEnd(18)} ${row.embedded}/${row.total} embedded — ${models}`)
  }

  console.log(
    totalFailed === 0
      ? `\n  ✓ ${totalEmbedded} row(s) embedded.\n`
      : `\n  ✓ ${totalEmbedded} row(s) embedded, ${totalFailed} could not be — rerun to retry.\n`,
  )
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('\n  ✗ Backfill failed:', error instanceof Error ? error.message : error)
    await closePool().catch(() => undefined)
    process.exit(1)
  })

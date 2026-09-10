/**
 * Verifies the schema-drift checker against the live database, including that
 * it detects the exact fault that broke a pipeline run mid-crawl.
 */
import { closePool, query } from '../src/db/pool'
import { declaredColumns, describeDrift, findSchemaDrift } from '../src/db/schema-drift'

async function main(): Promise<void> {
  const declared = declaredColumns()
  const columns = [...declared.values()].reduce((n, s) => n + s.size, 0)
  console.log(`schema.sql declares ${declared.size} tables and ${columns} columns`)

  let drift = await findSchemaDrift()
  console.log(drift.length === 0 ? '  ok   no drift against the live database' : describeDrift(drift))
  if (drift.length > 0) { await closePool(); process.exit(1) }

  console.log('\ninjecting the original fault (dropping scraped_items.platform):')
  await query('ALTER TABLE scraped_items DROP COLUMN IF EXISTS platform')
  drift = await findSchemaDrift()
  const detected = drift.some((d) => d.table === 'scraped_items' && d.missingColumns.includes('platform'))
  console.log(detected ? '  ok   detected, and names the fix' : '  FAIL not detected')

  await query(`ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS platform TEXT
               CHECK (platform IN ('linkedin','instagram','x','facebook'))`)
  drift = await findSchemaDrift()
  console.log(drift.length === 0 ? '  ok   restored cleanly' : '  FAIL still drifting')

  await closePool()
  process.exit(detected && drift.length === 0 ? 0 : 1)
}

main().catch(async (error: unknown) => {
  console.error(error instanceof Error ? error.message : error)
  await closePool().catch(() => undefined)
  process.exit(1)
})

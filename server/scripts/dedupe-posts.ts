/** Collapses duplicate receipts so the new unique index can be created. */
import { closePool, query } from '../src/db/pool'
async function main() {
  const removed = await query<{id:string}>(
    `DELETE FROM posts p USING posts keep
      WHERE p.workspace_id = keep.workspace_id
        AND p.external_id  = keep.external_id
        AND p.external_id IS NOT NULL
        AND p.ctid > keep.ctid
      RETURNING p.id`)
  console.log(`removed ${removed.length} duplicate post row(s)`)
  await closePool()
}
main().catch(async (e) => { console.error(e); await closePool(); process.exit(1) })

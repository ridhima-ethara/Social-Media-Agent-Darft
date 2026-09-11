/**
 * DOES THIS DATABASE STILL NEED SEEDING?
 *
 * Exit 0 — it is empty, so seed it.
 * Exit 1 — it already holds work, so leave it alone.
 *
 * WHY THIS EXISTS. `db:seed` is a reset: it DELETEs this workspace's ideas,
 * drafts, media, scraped items, hashtags and keyword signals before writing the
 * starting set. That is correct for a development reset and catastrophic on a
 * deployment, because the container entrypoint ran it on every boot — so a
 * `docker compose restart api`, an OOM kill, or a host reboot silently destroyed
 * the calendar the operator had just built and replaced it with fixtures.
 *
 * Emptiness is judged on WORK, not on the workspace row. Migration creates the
 * workspace, so its presence proves nothing; content ideas and captured posts are
 * what an operator would lose. Either one present means this database is in use.
 *
 * Any failure exits 1 — refuse to seed. Wrongly skipping the seed leaves a
 * visibly empty product that one command fixes; wrongly running it destroys work
 * that nothing can recover.
 */

import { closePool, queryOne } from '../src/db/pool'
import { config } from '../src/config'

async function main(): Promise<void> {
  const slug = config.core.workspaceSlug

  // `queryOne` returns the row itself; `query` returns rows, not a QueryResult.
  const row = await queryOne<{ ideas: string; captures: string }>(
    `SELECT
       (SELECT COUNT(*) FROM content_ideas ci
          JOIN workspaces w ON w.id = ci.workspace_id WHERE w.slug = $1)::text AS ideas,
       (SELECT COUNT(*) FROM scraped_items si
          JOIN workspaces w ON w.id = si.workspace_id WHERE w.slug = $1)::text AS captures`,
    [slug],
  )

  const ideas = Number(row?.ideas ?? 0)
  const captures = Number(row?.captures ?? 0)

  if (ideas === 0 && captures === 0) {
    console.log(`  workspace "${slug}" holds no ideas and no captured posts — seeding`)
    process.exit(0)
  }

  console.log(
    `  workspace "${slug}" already holds ${ideas} idea(s) and ${captures} captured post(s) — NOT seeding, ` +
      'because seeding would delete them. Set RUN_SEED=true to overwrite deliberately.',
  )
  process.exit(1)
}

main()
  .catch((error: unknown) => {
    console.log(
      `  could not establish whether the database is empty (${
        error instanceof Error ? error.message : String(error)
      }) — NOT seeding, because the safe answer to "is there work here?" is yes`,
    )
    process.exit(1)
  })
  .finally(() => {
    void closePool()
  })

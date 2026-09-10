import { closePool, query } from '../src/db/pool'
async function main() {
  const ar = await query<{id:string;agent_id:string;started_at:string;status:string;trigger:string}>(
    `SELECT id, agent_id, started_at, status, trigger FROM agent_runs
      WHERE agent_id = 'publishing' ORDER BY started_at DESC LIMIT 6`)
  console.log(`publishing agent_runs: ${ar.length}`)
  for (const r of ar) console.log(`  ${r.started_at} ${r.status} trigger=${r.trigger} id=${r.id}`)

  const sr = await query<{agent_run_id:string;skill_id:string;status:string;n:string}>(
    `SELECT agent_run_id, skill_id, status, count(*)::text n FROM skill_runs
      WHERE skill_id LIKE 'publishing.%' GROUP BY 1,2,3 ORDER BY 1,2`)
  console.log(`\nskill_runs for publishing.*:`)
  for (const r of sr) console.log(`  n=${r.n} ${r.skill_id.padEnd(28)} ${r.status} run=${r.agent_run_id.slice(0,8)}`)

  const posts = await query<{idea_id:string;external_id:string;n:string}>(
    `SELECT idea_id, external_id, count(*)::text n FROM posts GROUP BY 1,2`)
  console.log(`\nposts by (idea, receipt):`)
  for (const r of posts) console.log(`  n=${r.n} idea=${r.idea_id.slice(0,8)} receipt=${r.external_id}`)
  await closePool()
}
main().catch(async (e) => { console.error(e); await closePool(); process.exit(1) })

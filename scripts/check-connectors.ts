/**
 * CONNECTOR AUDIT
 *
 * Prints what every connector's state actually is, and probes the keyless ones
 * to prove reachability rather than asserting it.
 *
 *   npm run connectors
 */

import { connectorHealth } from '../packages/mcp/index'
import { arxivSource, papersWithCodeSource, gdeltSource, semanticScholarSource } from '../packages/mcp/research-sources/index'
import { AGENT_ROSTER, assertToolAllowlists } from '../packages/agents/index'
import { readdirSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const green = (s: string) => `\x1b[32m${s}\x1b[0m`
const red = (s: string) => `\x1b[31m${s}\x1b[0m`
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`
const bold = (s: string) => `\x1b[1m${s}\x1b[0m`

let failures = 0

/* ── Skills ────────────────────────────────────────────────────────────────── */

console.log(bold('\nSkills'))
const skillDir = join(ROOT, 'packages/skills')
const skills = existsSync(skillDir)
  ? readdirSync(skillDir).filter((name) => existsSync(join(skillDir, name, 'SKILL.md')))
  : []

for (const skill of skills) {
  console.log(`  ${green('✓')} ${skill}`)
}
console.log(dim(`  ${skills.length} skills specified`))

const built = existsSync(join(ROOT, 'packages/runtime/.claude/skills'))
console.log(
  built
    ? `  ${green('✓')} built into packages/runtime/.claude/skills/`
    : `  ${red('✗')} not built — run npm run build-skills`,
)
if (!built) failures += 1

/* ── Agents ────────────────────────────────────────────────────────────────── */

console.log(bold('\nAgents'))
for (const agent of AGENT_ROSTER) {
  const tools = agent.tools?.length ?? 0
  console.log(
    `  ${green('✓')} ${agent.id.padEnd(12)} ${dim(`${agent.stage.padEnd(9)} skill=${agent.skill ?? '—'}  tools=${tools}`)}`,
  )
}

const allowlistProblems = assertToolAllowlists()
if (allowlistProblems.length === 0) {
  console.log(`  ${green('✓')} every agent has a skill, and no agent holds a tool its Boundaries forbid`)
} else {
  for (const problem of allowlistProblems) {
    console.log(`  ${red('✗')} ${problem.agentId} ${problem.message}`)
    failures += 1
  }
}

/* ── Connectors ────────────────────────────────────────────────────────────── */

console.log(bold('\nConnectors'))
for (const health of connectorHealth('demo')) {
  const mark = health.configured ? green('✓') : dim('·')
  console.log(`  ${mark} ${health.id.padEnd(22)} ${health.reason}`)
  if (health.envKey) console.log(`    ${dim(health.envKey)}`)
}

/* ── Live probe of the keyless sources ─────────────────────────────────────── */

console.log(bold('\nReachability probe'))
console.log(dim('  Keyless sources are probed, not assumed. A failure here is a network state, not a defect.'))

const query = { topic: 'reinforcement learning', windowDays: 30, maxResults: 2, maxCharsPerResult: 400 }

for (const source of [arxivSource, semanticScholarSource, papersWithCodeSource, gdeltSource]) {
  try {
    const results = await source.search(query)
    console.log(`  ${green('✓')} ${source.id.padEnd(22)} ${results.length} result(s)`)
  } catch (error) {
    console.log(
      `  ${dim('·')} ${source.id.padEnd(22)} unreachable — ${error instanceof Error ? error.message : 'unknown'}`,
    )
  }
}

console.log('')
if (failures === 0) {
  console.log(green(`connectors ok`) + ` — ${skills.length} skills, ${AGENT_ROSTER.length} agents wired.`)
} else {
  console.log(red(`connectors failed`) + ` — ${failures} problem(s).`)
  process.exit(1)
}

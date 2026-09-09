#!/usr/bin/env node
/**
 * THE AGENT SCAFFOLDER
 *
 * Writes the contract before the implementation, which is the order the
 * builder's guidelines demand: registry entry and spec first, handler second.
 * It deliberately prints the registry block rather than editing the registry
 * itself — `shared/agent-registry.ts` is the single source of truth, and a
 * script that rewrote it silently would be the first thing to break it.
 *
 *   npm run agent:new -- <agent-id> "<Agent Name>" <stage>
 */

import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const STAGES = ['command', 'discover', 'assess', 'plan', 'create', 'ship', 'learn']

const [, , id, name, stage] = process.argv

if (!id || !name || !stage) {
  console.error(`
Usage: npm run agent:new -- <agent-id> "<Agent Name>" <stage>

  agent-id   lower-case, hyphen-free, and permanent — it becomes a storage key
  stage      one of: ${STAGES.join(' · ')}

Example:
  npm run agent:new -- sentiment "Sentiment Agent" learn
`)
  process.exit(1)
}

if (!/^[a-z][a-z0-9]*$/.test(id)) {
  console.error(`✗ "${id}" is not a valid agent id. Use lower-case letters and digits only.`)
  process.exit(1)
}

if (!STAGES.includes(stage)) {
  console.error(`✗ "${stage}" is not a stage. Use one of: ${STAGES.join(', ')}`)
  process.exit(1)
}

/* ── 1 · The registry block, to paste into shared/agent-registry.ts ───────── */

const registryBlock = `
/* Paste into AGENTS in shared/agent-registry.ts */
{
  id: '${id}',
  name: '${name}',
  stage: '${stage}',
  role: 'TODO — one sentence, in the operator\\'s language.',
  description:
    'TODO — what it does, and what it refuses to do. A stranger should be able to read this and predict its output.',
  consumes: ['TODO'],
  produces: ['TODO'],
  handsOffTo: [],
},

/* Paste into SKILLS in shared/agent-registry.ts */
{
  id: '${id}.example.step',
  agentId: '${id}',
  name: 'Example step',
  summary: 'TODO — exactly one thing. If this needs "and" twice, split it into two skills.',
  inputs: ['TODO'],
  outputs: ['TODO'],
  order: 1,
  enabledByDefault: true,
  critical: false,
  config: [
    num('threshold', 'Threshold', 50, {
      min: 0,
      max: 100,
      description:
        'TODO — what changes when this moves, in the operator\\'s language. This text is rendered directly in Agent Studio.',
    }),
  ],
},
`

/* ── 2 · The handler stub ─────────────────────────────────────────────────── */

const handlerPath = join(ROOT, 'server/src/agents/skills', `${id}.ts`)

const handler = `/**
 * ${name.toUpperCase()} — skill handlers
 *
 * A handler is a pure function of \`(payload, ctx.config)\`. Every side effect
 * goes through \`ctx\`, and there is no module-level mutable state — that is
 * what makes a run replayable from its logged \`config_used\`.
 */

import { registerSkill } from './_register'

interface ${name.replace(/\W/g, '')}Payload extends Record<string, unknown> {
  // TODO — the accumulator this agent threads through its skills.
  items?: unknown[]
}

registerSkill<${name.replace(/\W/g, '')}Payload>('${id}.example.step', async (payload, ctx) => {
  // Read every tunable from ctx.config. A constant here is a knob the operator
  // cannot see, and therefore a defect.
  const threshold = ctx.num('threshold', 50)

  const items = payload.items ?? []

  ctx.log(\`Scoring \${items.length} items against a threshold of \${threshold}.\`)

  // Fail in the open: catch, record the reason, fall back, stamp the artefact.
  // Never swallow.

  return {
    items,
    // Every decision path writes a reason naming its evidence.
    ${id}Reason: \`TODO — name the specific evidence, not just the verdict.\`,
  }
})
`

if (existsSync(handlerPath)) {
  console.error(`✗ ${handlerPath} already exists. Refusing to overwrite it.`)
  process.exit(1)
}

mkdirSync(dirname(handlerPath), { recursive: true })
writeFileSync(handlerPath, handler, 'utf8')

/* ── 3 · Report ───────────────────────────────────────────────────────────── */

console.log(`
✓ Wrote server/src/agents/skills/${id}.ts

Now, in order:

  1. Paste the blocks below into shared/agent-registry.ts.
  2. Register the handler module in server/src/agents/skills/index.ts.
  3. Wire the hand-off: add '${id}' to the handsOffTo of whichever agent feeds it.
     The orchestrator derives sequencing from that graph — never special-case it.
  4. Run:  npm run agent:check   (it fails if any knob lacks a description)
  5. Run:  npm run specs:build   (specs/ is generated, never hand-edited)
${registryBlock}`)

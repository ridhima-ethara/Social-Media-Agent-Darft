/**
 * ETHARA COMMAND — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Command · The operator speaks; Ethara plans, confirms, dispatches and narrates.
 *
 * Related files:
 *   spec      packages/skills/core-context/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/assistant/handlers.ts         — the 12 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'assistant',
  name: 'Ethara Command',
  stage: 'command',
  role: 'The command plane the operator talks to.',
  description:
    'Parses an utterance into an intent, composes a plan, stops at the confirmation gate for anything irreversible, dispatches through the tool registry, and narrates. It never acts outside a declared tool.',
  consumes: [
    'operator utterance',
    'situational snapshot',
  ],
  produces: [
    'plan',
    'narration',
    'confirmation request',
  ],
  handsOffTo: [],
  skill: 'core-context',
  tools: [
    'state.read',
    'agent.status',
    'run.explain',
    'lineage.trace',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'assistant.context.assemble',
  'assistant.intent.parse',
  'assistant.plan.compose',
  'assistant.confirm.gate',
  'assistant.tool.dispatch',
  'assistant.narrate.stream',
  'assistant.result.verify',
  'assistant.memory.write',
  'assistant.brief.compose',
  'assistant.anomaly.watch',
  'assistant.voice.transcribe',
  'assistant.handoff.route',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/assistant/handlers.ts'

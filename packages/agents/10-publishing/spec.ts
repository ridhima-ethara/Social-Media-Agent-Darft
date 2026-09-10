/**
 * PUBLISHING AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Ship · Validate the format, dispatch to the platform, record the receipt.
 *
 * Related files:
 *   spec      packages/skills/publishing-runbook/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/publishing/handlers.ts         — the 4 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'publishing',
  name: 'Mickey',
  stage: 'ship',
  role: 'Publishing Agent · Validates format, dispatches, records a receipt.',
  description:
    'The only agent that may write a published status, and only after a real dispatch succeeded. Refuses without both approvals. Never retries an irreversible action automatically.',
  consumes: [
    'approved entries',
  ],
  produces: [
    'posts',
    'receipts',
  ],
  handsOffTo: [
    'analytics',
  ],
  skill: 'publishing-runbook',
  tools: [
    'idea.approve.leadership',
    'idea.publish',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'publishing.format.validate',
  'publishing.media.upload',
  'publishing.post.dispatch',
  'publishing.receipt.record',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/publishing/handlers.ts'

/**
 * LEARNING AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Learn · Measure against our own baseline, research the web, write the lesson back.
 *
 * Related files:
 *   spec      packages/skills/knowledge-base/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/learning/handlers.ts         — the 4 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'learning',
  name: 'Velma',
  stage: 'learn',
  role: 'Learning Agent · Turns outcomes and human edits into durable knowledge.',
  description:
    'Raises confidence after repeated confirmation and lowers it after contradiction. The demotion path is not optional.',
  consumes: [
    'metrics',
    'operator instructions',
    'decisions',
  ],
  produces: [
    'knowledge entries',
  ],
  handsOffTo: [
    'knowledge',
  ],
  skill: 'knowledge-base',
  tools: [
    'knowledge.add',
    'knowledge.search',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'learning.pattern.detect',
  'learning.knowledge.write',
  'learning.confidence.promote',
  'learning.confidence.demote',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/learning/handlers.ts'

/**
 * KNOWLEDGE AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Learn · Measure against our own baseline, research the web, write the lesson back.
 *
 * Related files:
 *   spec      packages/skills/knowledge-base/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/knowledge/handlers.ts         — the 8 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'knowledge',
  name: 'Knowledge Agent',
  stage: 'learn',
  role: 'Researches the consolidated set and owns memory.',
  description:
    'Discards any entry citing fewer than the source floor. Merges near-duplicates rather than inserting. Entries deactivate; nothing is deleted.',
  consumes: [
    'consolidated hashtag set',
    'outcomes',
  ],
  produces: [
    'knowledge entries',
  ],
  handsOffTo: [
    'caption',
    'image',
    'calendar',
    'review',
  ],
  skill: 'knowledge-base',
  tools: [
    'knowledge.search',
    'knowledge.build',
    'knowledge.add',
    'knowledge.toggle',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'knowledge.hashtag.select',
  'knowledge.research.search',
  'knowledge.research.extract',
  'knowledge.entry.upsert',
  'knowledge.entry.retrieve',
  'knowledge.entry.rank',
  'knowledge.conflict.resolve',
  'knowledge.priority.tag',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/knowledge/handlers.ts'

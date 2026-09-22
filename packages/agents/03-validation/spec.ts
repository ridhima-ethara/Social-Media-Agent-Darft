/**
 * VALIDATION AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Assess · Decide what is genuinely trending, and turn it into ranked opportunities.
 *
 * Related files:
 *   spec      packages/skills/content-validator/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/validation/handlers.ts         — the 8 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'validation',
  name: 'Dexter',
  stage: 'assess',
  role: 'Validation Agent · Gives every candidate exactly one verdict, with its evidence.',
  description:
    'Ranks keywords on a declared weighted composite, ranks each trending keyword’s hashtags, and routes every candidate through the four-verdict gate. Duplicates are linked, never deleted.',
  consumes: [
    'raw posts',
    'hashtag candidates',
  ],
  produces: [
    'trending keywords',
    'ranked hashtags',
    'verdicts',
    'review queue',
  ],
  handsOffTo: [
    'analysis',
  ],
  skill: 'content-validator',
  tools: [
    'keyword.trending',
    'hashtag.list',
    'hashtag.verdict.set',
    'review.queue.list',
    'review.resolve',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'validation.keyword.trend',
  'validation.hashtag.rank',
  'validation.item.filter',
  'validation.credibility.score',
  'validation.relevance.score',
  'validation.freshness.score',
  'validation.duplicate.detect',
  'validation.signal.repeat',
  'validation.signal.sustained',
  'validation.keyword.emerge',
  'validation.verdict.route',
  'validation.review.queue',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/validation/handlers.ts'

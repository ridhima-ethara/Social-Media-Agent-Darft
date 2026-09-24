/**
 * ANALYSIS AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Assess · Decide what is genuinely trending, and turn it into ranked opportunities.
 *
 * Related files:
 *   spec      packages/skills/content-validator/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/analysis/handlers.ts         — the 8 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'analysis',
  name: 'Analysis Agent',
  stage: 'assess',
  role: 'Clusters validated signal into ranked opportunities.',
  description:
    'Merges the per-keyword hashtag sets, de-duplicates across keywords, and re-ranks globally into the consolidated top set the research build reads.',
  consumes: [
    'verdicts',
    'ranked hashtags',
  ],
  produces: [
    'opportunities',
    'consolidated hashtag set',
  ],
  handsOffTo: [
    'calendar',
  ],
  skill: 'content-validator',
  tools: [
    'hashtag.top',
    'hashtag.list',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'analysis.trend.cluster',
  'analysis.brand.fit',
  'analysis.engagement.predict',
  'analysis.format.recommend',
  'analysis.angle.propose',
  'analysis.competitor.compare',
  'analysis.hashtag.consolidate',
  'analysis.recommendation.explain',
  'analysis.social.listen',
  'analysis.competitor.intel',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/analysis/handlers.ts'

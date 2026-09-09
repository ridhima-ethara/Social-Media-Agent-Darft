/**
 * ANALYTICS AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Learn · Measure against our own baseline, research the web, write the lesson back.
 *
 * Related files:
 *   spec      packages/skills/performance-collection/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/analytics/handlers.ts         — the 8 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'analytics',
  name: 'Analytics Agent',
  stage: 'learn',
  role: 'Measures against this account’s own trailing baseline.',
  description:
    'Appends a reading per pull, never overwrites. A not-yet-reported metric is excluded from every calculation, never counted as zero.',
  consumes: [
    'posts',
  ],
  produces: [
    'metrics',
    'comparisons',
    'explanations',
  ],
  handsOffTo: [
    'learning',
  ],
  skill: 'performance-collection',
  tools: [
    'analytics.query',
    'analytics.compare',
    'post.explain',
    'report.export',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'analytics.metrics.ingest',
  'analytics.metrics.reconcile',
  'analytics.baseline.compute',
  'analytics.sentiment.classify',
  'analytics.period.compare',
  'analytics.post.explain',
  'analytics.report.compose',
  'analytics.export.build',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/analytics/handlers.ts'

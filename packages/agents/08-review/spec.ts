/**
 * REVIEW AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Create · Write the copy, render the creative, apply human edits.
 *
 * Related files:
 *   spec      packages/skills/brand-voice/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/review/handlers.ts         — the 4 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'review',
  name: 'Review Agent',
  stage: 'create',
  role: 'Applies human edits and checks the twenty rules.',
  description:
    'A human instruction always outranks a brand guideline: the edit is applied and the finding is raised alongside it, never resolved silently.',
  consumes: [
    'captions',
    'media assets',
    'operator instructions',
  ],
  produces: [
    'compliance verdicts',
    'extracted preferences',
  ],
  handsOffTo: [
    'knowledge',
    'publishing',
  ],
  skill: 'brand-voice',
  tools: [
    'brand.check',
    'idea.approve.marketing',
    'idea.reject.leadership',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'review.instruction.apply',
  'review.compliance.check',
  'review.preference.extract',
  'review.diff.summarize',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/review/handlers.ts'

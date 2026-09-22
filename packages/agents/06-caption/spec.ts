/**
 * CAPTION CREATOR AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Create · Write the copy, render the creative, apply human edits.
 *
 * Related files:
 *   spec      packages/skills/caption-writing/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/caption/handlers.ts         — the 10 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'caption',
  name: 'SpongeBob',
  stage: 'create',
  role: 'Content Agent · Writes platform copy grounded in cited knowledge.',
  description:
    'Every factual claim traces to a cited entry. Brand-voice enforcement runs unconditionally as the final step, whatever produced the text.',
  consumes: [
    'calendar entries',
    'knowledge entries',
  ],
  produces: [
    'captions',
  ],
  handsOffTo: [
    'image',
  ],
  skill: 'caption-writing',
  tools: [
    'knowledge.search',
    'draft.generate',
    'draft.instruct',
    'brand.check',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'generation.caption.mode',
  'generation.caption.voice',
  'generation.caption.hook',
  'generation.caption.problem',
  'generation.caption.explanation',
  'generation.caption.close',
  'generation.caption.hashtags',
  'generation.caption.adapt',
  'generation.caption.variants',
  'generation.caption.sourceLink',
  // The short-form family (ADR-007). Same agent, same grounding, different
  // artefact — a spoken script and the hooks that open it.
  'caption.voice.derive',
  'caption.script.write',
  'caption.hook.generate',
  'caption.hook.score',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/caption/handlers.ts'

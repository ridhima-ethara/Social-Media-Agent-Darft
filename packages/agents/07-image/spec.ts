/**
 * IMAGE CREATOR AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Create · Write the copy, render the creative, apply human edits.
 *
 * Related files:
 *   spec      packages/skills/visual-rendering/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/image/handlers.ts         — the 9 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'image',
  name: 'Minnie',
  stage: 'create',
  role: 'Image Agent · Produces the shipping creative.',
  description:
    'Two layers, always: an optional painted background under a locally drawn brand layer. No diffusion model is ever asked to draw brand text.',
  consumes: [
    'captions',
    'calendar entries',
  ],
  produces: [
    'media assets',
  ],
  handsOffTo: [
    'review',
  ],
  skill: 'visual-rendering',
  tools: [
    'image.render',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'generation.image.approach',
  'generation.image.reference',
  'generation.image.template',
  'generation.image.tokens',
  'generation.image.render',
  'generation.image.export',
  'generation.image.altText',
  'generation.image.reviewGate',
  'generation.image.video.compose',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/image/handlers.ts'

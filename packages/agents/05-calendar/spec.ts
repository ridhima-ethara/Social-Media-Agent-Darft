/**
 * CALENDAR & IDEAS AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Plan · Form ideas and place them on the week.
 *
 * Related files:
 *   spec      packages/skills/calendar-idea-agent/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/calendar/handlers.ts         — the 8 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'calendar',
  name: 'Dora',
  stage: 'plan',
  role: 'Calendar Agent · Places validated topics on dates, times and platforms, and ranks them.',
  description:
    'Forms topics, places them with evidence-bearing slot reasons, and applies the per-platform cap — no suggestion list. Only today\u2019s post (and tomorrow\u2019s when the schedule requires it) is written; later dates hold the topic in the Topic Queue until Generate Post.',
  consumes: [
    'opportunities',
    'consolidated hashtag set',
  ],
  produces: [
    'calendar entries',
  ],
  handsOffTo: [
    'caption',
  ],
  skill: 'calendar-idea-agent',
  tools: [
    'idea.list',
    'idea.move',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'calendar.idea.form',
  'calendar.idea.dedupe',
  'calendar.slot.optimize',
  'calendar.platform.select',
  'calendar.cadence.balance',
  'calendar.conflict.detect',
  'calendar.crossplatform.adapt',
  'calendar.rank.select',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/calendar/handlers.ts'

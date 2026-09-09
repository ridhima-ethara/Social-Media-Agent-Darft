/**
 * SCRAPING AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Discover · Scrape LinkedIn for movement across the keyword set.
 *
 * Related files:
 *   spec      packages/skills/content-scraper/SKILL.md          — the behavioural specification
 *   prompt    ./prompt.ts                                       — seven blocks, pointing at the spec
 *   handlers  server/src/agents/scraping/handlers.ts         — the 8 skill handlers
 *   registry  shared/agent-registry.ts                          — the same ids, with every knob declared
 */

import type { AgentSpec } from '../../contracts/src/index'

export const spec: AgentSpec = {
  id: 'scraping',
  name: 'Scraping Agent',
  stage: 'discover',
  role: 'Captures public LinkedIn activity for the keyword set.',
  description:
    'Gathers. Does not judge. Every scraped body is wrapped as untrusted evidence before it reaches a model, and every exclusion is counted rather than silently dropped.',
  consumes: [
    'keyword set',
  ],
  produces: [
    'raw posts',
    'hashtag candidates',
  ],
  handsOffTo: [
    'validation',
  ],
  skill: 'content-scraper',
  tools: [
    'keyword.list',
    'pipeline.status',
  ],
}

/** The runtime skills this agent executes, in order. Storage keys — never renamed. */
export const SKILLS = [
  'scraping.keyword.resolve',
  'scraping.source.connect',
  'scraping.linkedin.fetch',
  'scraping.hashtag.harvest',
  'scraping.hashtag.expand',
  'scraping.engagement.capture',
  'scraping.competitor.track',
  'scraping.dedupe.prefilter',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/scraping/handlers.ts'

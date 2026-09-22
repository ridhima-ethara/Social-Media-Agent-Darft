/**
 * SCRAPING AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Discover · Read LinkedIn, Instagram, X and Facebook through Apify
 *                    actors, and the open web through crawl4ai, for movement
 *                    across the keyword set.
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
  name: 'Sherlock',
  stage: 'discover',
  role: 'Scraping Agent · Captures public activity for the keyword set across four platforms via Apify actors, and the open web via crawl4ai.',
  description:
    'Gathers. Does not judge. Reads each platform lane through its Apify actor, which states real engagement figures, and falls back to a crawl4ai search when no token is configured — the same lane, read through a search engine, stamped as carrying no figures rather than as carrying zeros. Admits only what aligns with the brand topic set and the Knowledge Base, wraps every captured body as untrusted evidence before it reaches a model, and counts every exclusion rather than silently dropping it. A lane that returns nothing returns nothing — there is no corpus behind it.',
  consumes: [
    'keyword set',
    'knowledge base',
  ],
  produces: [
    'captured pages, per platform',
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
  'scraping.account.capture',
  'scraping.hashtag.harvest',
  'scraping.hashtag.expand',
  'scraping.engagement.capture',
  'scraping.competitor.track',
  'scraping.dedupe.prefilter',
  'scraping.keyword.discover',
  'scraping.transcript.fetch',
] as const

/** Where this agent's handlers live, relative to the repo root. */
export const HANDLERS = 'server/src/agents/scraping/handlers.ts'

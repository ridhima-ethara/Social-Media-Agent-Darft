/**
 * SCRAPING AGENT — the contract
 *
 * The seven fields every agent conforms to, plus the skill that specifies its
 * behaviour, the tools it may hold, and the runtime skills it executes.
 *
 * Stage: Discover · Find what is trending THIS MONTH, relevant to Ethara's
 *                    Knowledge Base, brand and keywords, on LinkedIn,
 *                    Instagram, Facebook and X — through the Claude Bridge on
 *                    every run — and hand it to the Validation Agent.
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
  role: 'Scraping Agent · The Claude Bridge agent: discovers what is trending this month on LinkedIn, Instagram, Facebook and X, relevant to Ethara\u2019s Knowledge Base, brand and keywords.',
  description:
    'Gathers. Does not judge. On every run, through the Claude Bridge, discovers platform by platform what is being posted this month about Ethara\u2019s field \u2014 the Knowledge Base, the research corpus, the brand topics and every keyword are the reference: one quoted topic per search with the month named, keeping only posts whose date is verified inside the window and that are relevant to Ethara, grouped into trends with their hashtags, URLs and authors, newest first. Facebook, whose posts cannot be dated, is listed for reference only. Rows state no engagement, stamped as carrying no figures rather than as carrying zeros. Writes no content and no calendar; wraps every captured body as untrusted evidence before it reaches a model, and counts every exclusion rather than silently dropping it. A platform that returns nothing returns nothing — there is no corpus behind it.',
  consumes: [
    'keyword set',
    'knowledge base',
  ],
  produces: [
    'platform trends (topic, hashtags, post URLs, dates, authors, matched Ethara keywords, reason)',
    'captured posts, per platform, newest first',
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

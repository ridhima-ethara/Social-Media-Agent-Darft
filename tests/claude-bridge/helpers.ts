/**
 * Shared set-up for the Claude Bridge tests: the real config file, the sample
 * context and fixture posts, "now" pinned to the fixture's reference time.
 * Nothing here touches the network or the database.
 */

import { loadBridgeConfig, type BridgeConfig } from '../../server/src/bridges/claude-bridge/config'
import { loadSampleContext } from '../../server/src/bridges/claude-bridge/context'
import { loadFixtureFile } from '../../server/src/bridges/claude-bridge/adapters/fixture'
import type { SourceCandidate } from '../../server/src/bridges/claude-bridge/adapters/source-types'

export const cfg: BridgeConfig = loadBridgeConfig()
export const context = loadSampleContext(cfg)
export const fixture = loadFixtureFile()
export const NOW = new Date(fixture.reference_time)

/** A LinkedIn activity id whose embedded timestamp is `date`. */
export function activityIdFor(date: Date, low = 12345): string {
  return ((BigInt(date.getTime()) << 22n) | BigInt(low)).toString()
}

export function daysAgo(days: number, from: Date = NOW): Date {
  return new Date(from.getTime() - days * 86_400_000)
}

export function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    adapter: 'fixture',
    query: '"AI agents"',
    keyword: 'AI agents',
    url: null,
    published_at: null,
    title: null,
    text: null,
    hashtags: [],
    author: null,
    engagement: null,
    ...overrides,
  }
}

export function postUrl(handle: string, slug: string, date: Date, low = 12345): string {
  return `https://www.linkedin.com/posts/${handle}_${slug}-activity-${activityIdFor(date, low)}-ab12`
}

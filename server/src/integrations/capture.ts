/**
 * CAPTURE — the contract every scraping source answers, and the selector that
 * decides which one serves a lane.
 *
 * TWO SOURCES, ONE SHAPE. Apify reads the platforms themselves and returns real
 * engagement; crawl4ai reads what a search engine indexed and cannot state a
 * reaction count. Both produce `RawPost`, and each row carries
 * `metricsAvailable` so a consumer can tell a measured zero from an absent one.
 * Nothing downstream needs to know which source ran — except the Validation
 * Agent, which must compute engagement over metric-bearing rows only.
 *
 * WHY THE SELECTOR EXISTS. The Scraping Agent used to name `crawl4aiSearch`
 * directly at every call site, which made the source a property of the code
 * rather than of the configuration. Routing through `captureFor()` means a lane
 * upgrades from a search reading to a platform reading when a token appears,
 * with no edit to the agent.
 */

import type { Platform, ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { apifySearch } from './apify'
import { crawl4aiSearch } from './crawl4ai'

/**
 * What the rest of the pipeline consumes, whichever source produced it.
 *
 * The three count fields are only meaningful when `metricsAvailable` is true.
 * When it is false they are zero in the sense of "not applicable", never in the
 * sense of "this performed badly" — the distinction the whole `N/A is never 0`
 * rule turns on.
 */
export interface RawPost {
  externalId: string
  text: string
  authorName: string
  authorHeadline: string
  authorFollowers: number
  url: string
  postedAt: string
  reactions: number
  comments: number
  reposts: number
  hashtags: string[]
  /** The keyword whose query surfaced this post. */
  keyword: string
  sourceName: string
  /**
   * The platform this row was captured FOR — `null` for the open-web tier.
   * Recorded rather than re-derived from the URL, so a consumer never has to
   * parse a host to know which platform lane an item belongs to.
   */
  platform: Platform | null
  /**
   * Whether the source could state engagement figures. True on an Apify lane,
   * false on a crawl4ai one. Present so that the zeros in the three count
   * fields are readable as "not applicable" rather than "zero".
   */
  metricsAvailable: boolean
}

/**
 * One keyword on one lane.
 *
 * Fields that only one source can honour are still declared here rather than
 * split into two input types: a lane should be describable without knowing
 * which implementation will serve it. Each adapter ignores what it cannot
 * express, and says so where that matters.
 */
export interface CaptureInput {
  keyword: string
  /** `undefined` is the open-web lane — the one lane Apify has no actor for. */
  platform?: Platform
  maxItems: number
  /** crawl4ai only: characters kept per page, so one verbose page cannot crowd out the rest. */
  maxCharsPerPage: number
  /** Apify only: the recency window. crawl4ai cannot express one. */
  datePosted: 'past-24h' | 'past-week' | 'past-month'
  /** Apify only: `date` reads the freshest, `relevance` reads the strongest. */
  sortBy: 'relevance' | 'date'
}

export type CaptureSource = ServiceAdapter<CaptureInput, RawPost[]>

/**
 * crawl4ai behind the capture contract.
 *
 * `datePosted` and `sortBy` are dropped rather than approximated: a `site:`
 * query cannot express either, and silently reading a month of results as
 * though they were the last 24 hours would make the trend window a lie.
 */
const crawl4aiCapture: CaptureSource = {
  id: 'capture.crawl4ai',
  label: crawl4aiSearch.label,

  isConfigured(): boolean {
    return crawl4aiSearch.isConfigured()
  },

  unavailableReason(): string {
    return crawl4aiSearch.unavailableReason()
  },

  async run(input: CaptureInput): Promise<RawPost[]> {
    return crawl4aiSearch.run({
      keyword: input.keyword,
      ...(input.platform === undefined ? {} : { platform: input.platform }),
      // The operator's per-keyword cap still applies, bounded by the crawler's
      // own page ceiling — fifty browser page-loads per keyword per lane is not
      // a reasonable ask of a local machine.
      maxItems: Math.min(input.maxItems, config.crawl4ai.maxPagesPerKeyword),
      maxCharsPerPage: input.maxCharsPerPage,
    })
  },
}

/**
 * Which source serves a lane.
 *
 * The open web has no actor, so it is always crawl4ai. A platform lane prefers
 * Apify and falls back to crawl4ai — a degradation, not a substitution: the
 * same lane still answers, with search-indexed pages instead of platform posts
 * and `metricsAvailable` false to say so.
 */
export function captureFor(platform: Platform | undefined): CaptureSource {
  if (platform === undefined) return crawl4aiCapture
  return apifySearch.isConfigured() ? apifySearch : crawl4aiCapture
}

/** One link in a lane's chain: the source to try, and whether it is the backup. */
export interface CaptureAttempt {
  source: CaptureSource
  /** True for a source only reached because the one before it failed. */
  isBackup: boolean
}

/**
 * The ORDERED sources a lane may be served by, primary first.
 *
 * `captureFor()` answers "which source owns this lane", which is the right
 * question when the token is absent and the wrong one when the token is present
 * but the actor fails. An actor is a third-party artefact: it gets deprecated,
 * rate-limited, repriced and occasionally just breaks, and on any of those days
 * a keyword that crawl4ai could have read would have returned nothing at all
 * because the lane had already been decided.
 *
 * So a platform lane is a chain: the Apify actor, then crawl4ai behind it
 * whenever crawl4ai is actually configured. The caller tries each in turn and
 * records which one answered, so a run that fell through to the backup says so
 * on every row it produced rather than looking like a run that chose it.
 *
 * The open web is a chain of one. There is no second reader of the open web,
 * and inventing one would mean inventing its results.
 */
export function captureChainFor(platform: Platform | undefined): CaptureAttempt[] {
  if (platform === undefined) return [{ source: crawl4aiCapture, isBackup: false }]

  if (!apifySearch.isConfigured()) {
    // Not a backup in this case: with no token the crawler IS the lane's source,
    // and calling it a fallback here would report a degradation twice — once at
    // connect time, where it belongs, and again per keyword, where it reads as a
    // failure that did not happen.
    return [{ source: crawl4aiCapture, isBackup: false }]
  }

  const chain: CaptureAttempt[] = [{ source: apifySearch, isBackup: false }]
  if (crawl4aiCapture.isConfigured()) chain.push({ source: crawl4aiCapture, isBackup: true })
  return chain
}

/**
 * Why a platform lane is not reading the platform itself, or an empty string
 * when it is. Surfaced on the run console so the mode is visible at capture
 * time rather than inferred later from missing counts.
 */
export function platformLaneDowngradeReason(): string {
  if (apifySearch.isConfigured()) return ''
  return (
    `${apifySearch.unavailableReason()} — the platform lanes are reading search-indexed ` +
    'pages through crawl4ai instead, which state no engagement figures'
  )
}

/**
 * CAPTURE — the contract every scraping source answers, and the selector that
 * decides which one serves a lane.
 *
 * ONE SOURCE, EVERY LANE. The Claude Bridge (`server/src/bridges/claude-bridge/`)
 * serves all five lanes — LinkedIn, Instagram, X, Facebook and the open web. It
 * acquires public posts and pages through Claude Code's web search, keeps only
 * real post URLs, dates each item from what the platform or page states, and
 * de-duplicates and filters against the Knowledge Base, brand voice and keyword
 * configuration. Every row carries `metricsAvailable` so a consumer can tell a
 * measured zero from an absent one; a web search states no engagement, so
 * bridge rows carry `false`.
 *
 * NO THIRD-PARTY SCRAPER. Apify and Parallel are not Scraping Agent sources.
 * A lane the bridge cannot serve reports why rather than reaching for another.
 *
 * WHY THE SELECTOR EXISTS. The Scraping Agent used to name a source directly at
 * every call site, which made the source a property of the code rather than of
 * the configuration. Routing through `captureFor()` keeps that decision in one
 * place.
 */

import { PLATFORMS, type Platform, type ServiceAdapter } from '../../../shared/agent-contract'
import { bridgeUnavailableReason, claudeBridgeCapture } from '../bridges/claude-bridge/capture-source'

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
  /**
   * Plays, for the lanes that state them. Meaningful ONLY when
   * `viewsAvailable` is true — see below.
   */
  views: number
  /**
   * Whether the source stated a view or play count.
   *
   * Separate from `metricsAvailable` on purpose (ADR-009). Views are a property
   * of video, and the two absences are different facts: an Instagram Reel can
   * state plays and reactions both, a LinkedIn text post states reactions and
   * has no plays to state, and an open-web citation states neither. Riding one
   * flag would make `views = 0` mean three things at once.
   *
   * False means NOT STATED. It never means "nobody watched".
   */
  viewsAvailable: boolean
  hashtags: string[]
  /** The keyword whose query surfaced this post. */
  keyword: string
  sourceName: string
  /**
   * The platform this row was captured FOR — `null` for the open-web lane.
   * Recorded rather than re-derived from the URL, so a consumer never has to
   * parse a host to know which platform lane an item belongs to.
   */
  platform: Platform | null
  /**
   * Whether the source could state engagement figures. True only when the source stated them,
   * false on the open-web lane. Present so that the zeros in the three count
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
  /** `undefined` is the open-web lane. */
  platform?: Platform
  maxItems: number
  /** Open-web lane only: characters kept per page, so one verbose page cannot crowd out the rest. */
  maxCharsPerPage: number
  /** The recency window. The Claude Bridge filters on verified post dates; the open-web lane maps it to a research window. */
  datePosted: 'current-month' | 'past-24h' | 'past-48h' | 'past-week' | 'past-month' | 'past-quarter'
  /** `date` reads the freshest, `relevance` the strongest. The bridge always sorts newest first; the open-web lane cannot express it. */
  sortBy: 'relevance' | 'date'
}

export type CaptureSource = ServiceAdapter<CaptureInput, RawPost[]>

/**
 * Which source serves a lane: always the Claude Bridge. `undefined` is the
 * open web, which the bridge serves through its `web` module. The bridge says
 * through `isConfigured()` / `unavailableReason()` whether it can run.
 */
export function captureFor(platform: Platform | undefined): CaptureSource {
  return claudeBridgeCapture(platform)
}

/**
 * Why the platform lanes cannot run, or an empty string when at least one can.
 * Surfaced on the run console so the mode is visible at capture time rather
 * than inferred later from missing rows.
 */
export function platformLaneUnavailableReason(): string {
  const reasons = PLATFORMS.map((p) => bridgeUnavailableReason(p))
  if (reasons.some((r) => r === '')) return ''
  return `${reasons.find((r) => r !== '') ?? 'The Claude Bridge is unavailable'} — no platform lane can run.`
}

/** Why the open-web lane cannot run, or an empty string when it can. */
export function openWebLaneUnavailableReason(): string {
  const reason = bridgeUnavailableReason(undefined)
  return reason === '' ? '' : `${reason} — the open-web lane cannot run.`
}

/**
 * CAPTURE — the contract every scraping source answers, and the selector that
 * decides which one serves a lane.
 *
 * TWO SOURCES, ONE SHAPE. Apify reads the four platforms themselves and returns
 * real engagement; Parallel reads the open web and returns cited pages, which
 * carry no reaction count and never did. Both produce `RawPost`, and each row
 * carries `metricsAvailable` so a consumer can tell a measured zero from an
 * absent one. Nothing downstream needs to know which source ran — except the
 * Validation Agent, which must compute engagement over metric-bearing rows only.
 *
 * ONE SOURCE PER LANE, BY DESIGN. There was a third source: crawl4ai, a headless
 * browser spawned as a local sidecar, which read the open web AND sat behind each
 * platform actor as a fallback. That fallback was the problem. A failed actor
 * downgraded a measured lane into a volume-only one, so the same numbers appeared
 * on screen meaning something quietly different. Now each lane has the one source
 * that can honestly answer it, and a lane that cannot reach its source reports
 * that rather than substituting a weaker reading.
 *
 * WHY THE SELECTOR EXISTS. The Scraping Agent used to name a source directly at
 * every call site, which made the source a property of the code rather than of
 * the configuration. Routing through `captureFor()` keeps that decision in one
 * place.
 */

import type { Platform, ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { apifySearch } from './apify'
import { parallelResearch, RESEARCH_DOMAIN } from './parallel'

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
   * The platform this row was captured FOR — `null` for the open-web lane.
   * Recorded rather than re-derived from the URL, so a consumer never has to
   * parse a host to know which platform lane an item belongs to.
   */
  platform: Platform | null
  /**
   * Whether the source could state engagement figures. True on an Apify lane,
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
  /** `undefined` is the open-web lane — the one lane Apify has no actor for. */
  platform?: Platform
  maxItems: number
  /** Open-web lane only: characters kept per page, so one verbose page cannot crowd out the rest. */
  maxCharsPerPage: number
  /** The recency window. Apify honours it exactly; the open-web lane maps it to a research window. */
  datePosted: 'past-24h' | 'past-week' | 'past-month'
  /** Apify only: `date` reads the freshest, `relevance` reads the strongest. The open-web lane cannot express it. */
  sortBy: 'relevance' | 'date'
}

export type CaptureSource = ServiceAdapter<CaptureInput, RawPost[]>

/**
 * Parallel behind the capture contract — the open-web lane.
 *
 * WHY PARALLEL AND NOT A CRAWLER. The open web used to be read by crawl4ai, a
 * headless-browser sidecar spawned as a local process. That made the lane depend
 * on a Python interpreter, a Chromium install and a machine willing to run both,
 * and it read only what a search engine had already indexed. Parallel answers the
 * same question over HTTP with cited results, so the lane needs no local process
 * and no second runtime.
 *
 * WHAT IT STILL CANNOT DO, STATED RATHER THAN PAPERED OVER. Parallel returns
 * research citations, not platform posts: there is no reaction count behind a
 * cited page and there never was. So every row it produces carries
 * `metricsAvailable: false`, exactly as the crawler's rows did, and the
 * Validation Agent continues to compute engagement over metric-bearing rows only.
 * `sortBy` is dropped because a research query cannot express it; `datePosted` is
 * translated into the research window, which Parallel does honour.
 */
const parallelCapture: CaptureSource = {
  id: 'capture.parallel',
  label: 'Parallel Web Systems · open-web reading',

  isConfigured(): boolean {
    return parallelResearch.isConfigured()
  },

  unavailableReason(): string {
    return parallelResearch.unavailableReason()
  },

  async run(input: CaptureInput): Promise<RawPost[]> {
    const windowDays =
      input.datePosted === 'past-24h' ? 1 : input.datePosted === 'past-week' ? 7 : 30

    const findings = await parallelResearch.run({
      hashtag: input.keyword,
      domain: RESEARCH_DOMAIN,
      windowDays,
      processor: config.parallel.processor,
      maxResults: input.maxItems,
    })

    /*
     * One row per CITATION, not per finding. A finding is Parallel's synthesis
     * across several pages; the capture contract is a page. Flattening to the
     * citation keeps one row one source, which is what the dedupe and the
     * lineage both assume, and it keeps the URL on the row that claims it.
     */
    const rows: RawPost[] = []
    const seen = new Set<string>()

    for (const finding of findings) {
      for (const citation of finding.citations) {
        if (citation.url === '' || seen.has(citation.url)) continue
        seen.add(citation.url)
        rows.push({
          externalId: citation.url,
          // The finding's prose is the evidence behind this citation; the
          // citation's own title is the page. Both travel, trimmed to the lane's
          // per-page budget so one verbose finding cannot crowd out the rest.
          text: `${citation.title}\n\n${finding.content}`.slice(0, input.maxCharsPerPage),
          authorName: '',
          authorHeadline: '',
          authorFollowers: 0,
          url: citation.url,
          postedAt: citation.publishedAt ?? new Date().toISOString(),
          // Not applicable, never "performed badly" — see `metricsAvailable`.
          reactions: 0,
          comments: 0,
          reposts: 0,
          hashtags: [],
          keyword: input.keyword,
          sourceName: 'Parallel',
          platform: null,
          metricsAvailable: false,
        })
        if (rows.length >= input.maxItems) return rows
      }
    }

    return rows
  },
}

/**
 * Which source serves a lane.
 *
 * The four platform lanes are Apify and only Apify: an actor reads the platform
 * itself and states real reaction, comment and repost counts, and three of the
 * four components of `trend_score` are engagement maths that go inert without
 * them. There is deliberately no second reader behind it — a lane that cannot
 * reach its actor reports that it could not, rather than quietly returning
 * search results with no engagement and letting a volume-only score pass as a
 * measured one.
 *
 * The open web has no actor and is always Parallel.
 */
export function captureFor(platform: Platform | undefined): CaptureSource {
  return platform === undefined ? parallelCapture : apifySearch
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
 * Every lane is now a chain of ONE, and that is the point rather than a
 * limitation left over from removing the crawler. Each lane has exactly one
 * source that can honestly answer it: Apify reads a platform, Parallel reads the
 * open web, and neither can stand in for the other. The previous arrangement put
 * the crawler behind each platform actor, which meant a failed actor silently
 * downgraded a measured lane into a volume-only one — the same numbers on the
 * screen, quietly meaning something different.
 *
 * The chain shape is kept because the caller records which link answered and
 * whether it was a backup, and because a future second reader of a lane would
 * slot in here rather than at every call site.
 */
export function captureChainFor(platform: Platform | undefined): CaptureAttempt[] {
  return [{ source: captureFor(platform), isBackup: false }]
}

/**
 * Why a platform lane cannot run, or an empty string when it can. Surfaced on
 * the run console so the mode is visible at capture time rather than inferred
 * later from missing rows.
 *
 * This used to describe a DOWNGRADE — the lanes falling back to a crawler that
 * states no engagement. There is no fallback now, so there is no downgrade to
 * describe: without the token the four platform lanes do not run at all, and
 * saying so plainly is the honest report. The open-web lane is unaffected; it is
 * served by Parallel and has its own reason.
 */
export function platformLaneUnavailableReason(): string {
  if (apifySearch.isConfigured()) return ''
  return (
    `${apifySearch.unavailableReason()} — the four platform lanes cannot run without it. ` +
    'They read the platforms themselves, and nothing else can state a reaction count, ' +
    'so no substitute is attempted. The open-web lane still runs through Parallel.'
  )
}

/**
 * Why the open-web lane cannot run, or an empty string when it can.
 *
 * Declared beside the platform reason rather than folded into it: the two lanes
 * now have different sources and fail independently, and an operator needs to
 * know which half of a run is missing.
 */
export function openWebLaneUnavailableReason(): string {
  if (parallelResearch.isConfigured()) return ''
  return `${parallelResearch.unavailableReason()} — the open-web lane cannot run without it.`
}

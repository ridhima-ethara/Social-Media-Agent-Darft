/**
 * THE ACQUISITION CONTRACT
 *
 * Everything after acquisition — normalisation, de-duplication, freshness,
 * relevance, ranking, output — depends on this interface and on nothing else.
 * Swapping how data is obtained (Claude Code's web search today; an official
 * platform API, an approved data provider or an operator-maintained URL list
 * tomorrow) means writing another implementation of it.
 *
 * WHAT AN ADAPTER MAY RETURN. Only what its source actually stated. A field the
 * source did not give is `null` or `[]`; an adapter never estimates a date,
 * invents a hashtag, or fills in engagement. The normaliser derives what can be
 * derived honestly (a date decoded from a post id) and nothing more.
 *
 * WHAT AN ADAPTER MUST NOT DO. Bypass authentication, CAPTCHA, robots rules,
 * rate limits or any other access control. None of the implementations here
 * fetches a platform page at all.
 */

import type { AdapterId } from '../config'
import type { PlatformModule } from '../platforms'

export type QueryKind = 'post' | 'topic' | 'hashtag'

export interface DiscoveryQuery {
  /** The text sent to the source. */
  text: string
  kind: QueryKind
  /** The configured keyword this query was generated from; `null` for a query planned by Claude. */
  keyword: string | null
  /** Which query form produced it, or `planned` / `topic` for the other origins. */
  origin: string
}

export interface SourceEngagement {
  reactions: number | null
  comments: number | null
  reposts: number | null
  /** Views or plays, when the source states them (video, or X impressions). */
  views?: number | null
}

/** One item exactly as a source stated it. */
export interface SourceCandidate {
  adapter: AdapterId
  /** The query that surfaced it, as actually executed; `null` for a directly supplied URL. */
  query: string | null
  keyword: string | null
  url: string | null
  /** A timestamp the SOURCE stated, as given. Never computed by the adapter. */
  published_at: string | null
  title: string | null
  text: string | null
  /** Hashtags the source stated separately from the text. Tags inside the text are extracted later. */
  hashtags: string[]
  author: string | null
  /** `null` when the source states no engagement at all. */
  engagement: SourceEngagement | null
}

export interface SearchRequest {
  query: DiscoveryQuery
  maxResults: number
  window: { from: Date; to: Date }
  /** The window in words, in the workspace's time zone ("September 2026 — 1 September 2026 to 24 September 2026 (today)"). */
  windowText?: string
  /** The month to name in searches ("September 2026"). */
  month?: string
}

export interface AdapterAvailability {
  available: boolean
  /** Why not, in a sentence naming the fix. Empty when available. */
  reason: string
}

/**
 * The adapter interface the brief calls `LinkedInSourceAdapter`, generalised
 * over the platform module it is bound to so the same implementations serve
 * any platform the bridge gains later.
 */
export interface TrendSourceAdapter {
  readonly id: AdapterId
  readonly label: string
  /** `live` reads the world; `store` reads data the SMA holds; `manual` is operator-supplied; `fixture` is test data. */
  readonly kind: 'live' | 'store' | 'manual' | 'fixture'
  readonly platform: PlatformModule

  availability(): AdapterAvailability

  search_topics(req: SearchRequest): Promise<SourceCandidate[]>
  search_posts(req: SearchRequest): Promise<SourceCandidate[]>
  search_hashtags(req: SearchRequest): Promise<SourceCandidate[]>
  /** One item by URL, from what the adapter already holds or was given. Never a page fetch. */
  get_post(url: string): Promise<SourceCandidate | null>

  /**
   * Optional batch path. An adapter whose source has a per-session cost (a
   * Claude Code process) answers several queries at once; the pipeline uses
   * this when present and the per-query methods otherwise.
   */
  searchBatch?(reqs: SearchRequest[]): Promise<BatchOutcome>
}

export interface BatchOutcome {
  candidates: SourceCandidate[]
  /** The queries the source actually executed — may differ in wording from those requested. */
  executed: string[]
  errors: string[]
  /** What the source did, per source, when it is worth saying (the news lane's robots and verification notes). */
  notes?: string[]
  /**
   * Claude's own trend analysis from a research session (`claude_code`), kept
   * only where its evidence URLs were returned by a search in that session.
   * A separate, labelled layer: it never feeds the posts or trends the bridge
   * computes itself.
   */
  claudeTrends?: ClaudeTrend[]
  /** Platforms Claude reported it could not verify trend data for, in its words. */
  insufficientData?: string[]
}

export interface ClaudeTrendEvidence {
  title: string
  /** A URL a search in the session actually returned — any other is dropped. */
  url: string
  source: string
  /** Decoded from the platform's post id when it carries one; otherwise the date Claude stated, marked as such. */
  publishedAt: string | null
  dateSource: 'platform_id' | 'claude_stated' | 'none'
}

export interface ClaudeTrend {
  topic: string
  trendType: string
  platform: string
  relatedKeywords: string[]
  hashtags: string[]
  whyTrending: string
  evidence: ClaudeTrendEvidence[]
  confidence: 'high' | 'medium' | 'low'
  /** current_month: evidence from the window · latest_available: the newest found, older than the window. Checked against decoded dates. */
  windowStatus: 'current_month' | 'latest_available' | 'unstated'
  /** True when Claude said current_month but every decoded date was older, so the bridge relabelled it. */
  windowStatusCorrected: boolean
  /** The corpus theme (A–E, KEYWORD_INSTRUCTION_MAP.md) Claude matched it to, or null when it gave none. */
  corpusTheme: string | null
  /** Evidence Claude cited that no search in the session returned: dropped, and counted here. */
  unverifiedEvidenceDropped: number
}

/** The adapter-facing name the brief uses. */
export type LinkedInSourceAdapter = TrendSourceAdapter

/** Thrown by an adapter for a failure an operator must act on. */
export class SourceError extends Error {
  readonly adapter: AdapterId
  /** True when retrying the next query cannot help (auth, budget, missing binary). */
  readonly fatal: boolean

  constructor(adapter: AdapterId, message: string, fatal = false) {
    super(message)
    this.name = 'SourceError'
    this.adapter = adapter
    this.fatal = fatal
  }
}

/** Lower-cased, hyphen/space-insensitive text used for matching a query term against stored text. */
export function matchable(text: string): string {
  return ` ${text.toLowerCase().replace(/[-_/]+/g, ' ').replace(/[^\p{L}\p{N}#\s]+/gu, ' ').replace(/\s+/g, ' ').trim()} `
}

/**
 * The bare terms of a discovery query: quotes, site: operators and the
 * leading `#` removed, camelCase split. Used by the offline adapters to decide
 * whether an item they hold answers a query.
 */
export function queryTerms(query: string): string {
  return query
    .replace(/\bsite:\S+/gi, ' ')
    .replace(/["“”]/g, ' ')
    .replace(/#([\p{L}\p{N}_]+)/gu, (_m, tag: string) => tag.replace(/([a-z])([A-Z])/g, '$1 $2'))
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * Whether stored text answers a query: every quoted phrase must appear as a
 * phrase, and every remaining word must appear somewhere. A `#Tag` counts as
 * its words, so `#AIAgents` matches "AI agents".
 */
export function textAnswersQuery(haystack: string, query: string): boolean {
  const hay = matchable(haystack)
  const withoutSite = query.replace(/\bsite:\S+/gi, ' ')
  const phrases: string[] = []
  const rest = withoutSite.replace(/["“]([^"”]+)["”]/g, (_m, phrase: string) => {
    phrases.push(phrase)
    return ' '
  })
  const words = matchable(queryTerms(rest)).trim().split(' ').filter((w) => w !== '')
  const needles = [...phrases.map((p) => matchable(queryTerms(p)).trim()), ...words].filter(
    (n) => n !== '',
  )
  if (needles.length === 0) return false
  return needles.every((n) => hay.includes(` ${n} `))
}

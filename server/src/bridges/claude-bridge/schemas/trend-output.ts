/**
 * THE BRIDGE'S PUBLIC SHAPES — tool input (validated) and tool output (typed).
 *
 * The output separates two kinds of field, and the separation is the point:
 *
 *   OBSERVED  — copied from the acquisition source: post_url, published_at
 *               (when the source or the post id states it), hashtags written in
 *               the post, the snippet, engagement when the source stated it.
 *   COMPUTED  — produced by this bridge from the observed fields with
 *               deterministic rules: topic, trend_score, brand_relevance,
 *               relevance_reason, trend_reason, freshness.
 *
 * Neither is Claude's interpretation. Claude's own analysis is a third layer,
 * written in the conversation and labelled as such (see the tool description).
 */

import { z } from 'zod'
import { ADAPTER_IDS, RELEVANCE_LEVELS, type AdapterId, type RelevanceLevel } from '../config'
import type { ContentType, PlatformId } from '../platforms'

/* ═══════════════════════════════════════════════════════════════════════════
   INPUT
   ═══════════════════════════════════════════════════════════════════════════ */

const dateInput = z
  .string()
  .trim()
  .refine((v) => !Number.isNaN(new Date(v).getTime()), 'must be an ISO-8601 date or timestamp')

export const trendToolInputSchema = z
  .object({
    /** Overrides the configured keywords for this call. Empty/absent → project keywords. */
    keywords: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
    /** Extra discovery queries planned by Claude, run verbatim before generated ones. */
    queries: z.array(z.string().trim().min(1).max(200)).max(50).optional(),
    /** Post URLs supplied by a person (or found by Claude). Never fetched — analysed from the URL alone. */
    post_urls: z.array(z.string().trim().url()).max(100).optional(),
    date_from: dateInput.nullable().optional(),
    date_to: dateInput.nullable().optional(),
    max_results: z.number().int().min(1).max(100).optional(),
    include_hashtags: z.boolean().optional(),
    include_post_urls: z.boolean().optional(),
    brand_context: z.boolean().optional(),
    adapters: z.array(z.enum(ADAPTER_IDS)).min(1).optional(),
    min_brand_relevance: z.enum(RELEVANCE_LEVELS).optional(),
    /** Which lane to read. Default `linkedin`; `web` is the open web. */
    platform: z.enum(['linkedin', 'instagram', 'x', 'facebook', 'web']).optional(),
  })
  .strict()

export type TrendToolInput = z.infer<typeof trendToolInputSchema>

/* ═══════════════════════════════════════════════════════════════════════════
   OUTPUT
   ═══════════════════════════════════════════════════════════════════════════ */

export type DateStatus = 'verified' | 'unknown'
/**
 * Where a verified date came from:
 *   `platform_id`  decoded from the timestamp the platform embeds in the post id
 *                  (LinkedIn activity id, X snowflake, Instagram shortcode);
 *   `url_path`     a full date written in the page's URL;
 *   `page_metadata` the page's own published-date tag (open web, robots-permitted);
 *   `source`       stated by the acquisition source.
 */
export type DateSource = 'platform_id' | 'url_path' | 'page_metadata' | 'source' | null
export type Freshness = 'very_recent' | 'recent' | 'current' | 'aging' | 'stale' | 'unknown'

/**
 * `ok` — at least one adapter answered with LinkedIn data.
 * `partial` — some adapters answered, some could not.
 * `unavailable` — no adapter could run (unconfigured, exhausted, down).
 * `empty` — adapters ran and returned nothing usable.
 * `fixture` — the answer comes from test fixtures, never from LinkedIn.
 */
export type SourceStatus = 'ok' | 'partial' | 'unavailable' | 'empty' | 'fixture'

export interface Engagement {
  reactions: number | null
  comments: number | null
  reposts: number | null
  /** Views or plays, when the source states them. */
  views?: number | null
}

export interface ScoreBreakdown {
  /** Each component in 0–1, or null when it could not be measured and was left out. */
  recency: number
  keyword_relevance: number
  topic_relevance: number
  hashtag_signal: number
  cross_query: number
  source_signal: number
  engagement: number | null
}

export interface TrendResult {
  rank: number
  topic: string
  published_at: string | null
  date_status: DateStatus
  date_source: DateSource
  freshness: Freshness
  age_days: number | null
  hashtags: string[]
  post_url: string | null
  source_type: PlatformId
  content_type: ContentType
  author: string | null
  snippet: string | null
  matched_keywords: string[]
  matched_queries: string[]
  sources: AdapterId[]
  engagement_available: boolean
  engagement: Engagement | null
  trend_score: number
  score_breakdown: ScoreBreakdown
  brand_relevance: RelevanceLevel
  relevance_score: number
  relevance_reason: string
  trend_reason: string
}

export interface TrendingTopic {
  topic: string
  post_count: number
  latest_published_at: string | null
  hashtags: string[]
  matched_queries: string[]
  mean_trend_score: number
  best_brand_relevance: RelevanceLevel
  post_urls: string[]
}

export interface TrendingHashtag {
  hashtag: string
  post_count: number
  latest_published_at: string | null
  /** True for reach-bait tags the brand voice excludes (#AI, #Innovation…). Reported, not hidden. */
  generic: boolean
}

export interface AdapterReport {
  adapter: AdapterId
  label: string
  kind: string
  status: 'ok' | 'empty' | 'unavailable' | 'error' | 'skipped'
  reason: string | null
  queries_executed: number
  candidates: number
}

export interface ContextReport {
  knowledge_base: { source: string; entries: number; vocabulary_terms: number }
  brand_voice: { sources: string[]; positioning: string | null; audience: string | null }
  keywords: { source: string; count: number; used: string[] }
}

export interface Diagnostics {
  queries_generated: number
  queries_executed: number
  candidates_found: number
  invalid_removed: number
  duplicates_removed: number
  stale_results_removed: number
  out_of_window_removed: number
  below_relevance_removed: number
  undated_results: number
  errors: string[]
  notes: string[]
}

export interface TrendIntelligenceOutput {
  status: 'ok' | 'configuration_error'
  execution_id: string
  generated_at: string
  source: PlatformId
  source_status: SourceStatus
  search_window: { from: string; to: string }
  sort: string
  total_candidates: number
  results: TrendResult[]
  trending_topics: TrendingTopic[]
  trending_hashtags: TrendingHashtag[]
  queries: Array<{ text: string; kind: string; keyword: string | null; origin: string }>
  adapters: AdapterReport[]
  context: ContextReport | null
  diagnostics: Diagnostics
  data_provenance: {
    observed_fields: string[]
    computed_fields: string[]
    statement: string
  }
  error?: string
}

export const OBSERVED_FIELDS = [
  'post_url',
  'published_at',
  'hashtags',
  'snippet',
  'author',
  'engagement',
  'content_type',
]

export const COMPUTED_FIELDS = [
  'rank',
  'topic',
  'freshness',
  'age_days',
  'matched_keywords',
  'trend_score',
  'score_breakdown',
  'brand_relevance',
  'relevance_score',
  'relevance_reason',
  'trend_reason',
  'trending_topics',
  'trending_hashtags',
]

export const PROVENANCE_STATEMENT =
  'Observed fields are copied from the acquisition source — for claude_code, verbatim from the raw ' +
  'web-search results, never from model prose. published_at is decoded from the timestamp the ' +
  'platform embeds in the post id (date_source "platform_id"), read from a full date in the URL ' +
  '("url_path") or from the page\'s own published-date tag ("page_metadata"), or stated by the source. Computed ' +
  'fields are deterministic bridge analysis of those observations — not LinkedIn data and not ' +
  'model judgement. Nothing is invented: a value the source did not state is null or "unknown".'

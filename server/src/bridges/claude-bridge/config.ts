/**
 * CLAUDE BRIDGE CONFIGURATION
 *
 * One JSON file (`config/bridge.config.json`) holds every tunable the bridge
 * has — limits, thresholds, weights, query forms. Nothing in the processing
 * modules carries its own number; they all read the object this returns.
 *
 * Environment variables override the handful of limits an operator is most
 * likely to change per deployment, without editing the file. They are read at
 * call time (never captured at import) so a long-running MCP server notices an
 * edited `.env` on the next call after a restart, the same contract
 * `server/src/config.ts` keeps.
 *
 * No secret is read here. Credentials stay where the rest of the server keeps
 * them — `server/secrets.env`, through `server/src/config.ts`.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const HERE = dirname(fileURLToPath(import.meta.url))

/** The repository root — four levels above this file (server/src/bridges/linkedin-trends). */
export const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')

export const DEFAULT_CONFIG_PATH = join(HERE, 'config', 'bridge.config.json')

/**
 * The acquisition adapters. There is deliberately no third-party scraping
 * service among them: live acquisition is Claude Code's own web search
 * (`claude_code`), and the rest read data the SMA already holds, data a person
 * supplied, or test fixtures.
 */
export const ADAPTER_IDS = ['claude_code', 'socialfetch', 'sma_captures', 'manual_urls', 'fixture'] as const
export type AdapterId = (typeof ADAPTER_IDS)[number]

export const RELEVANCE_LEVELS = ['high', 'medium', 'low'] as const
export type RelevanceLevel = (typeof RELEVANCE_LEVELS)[number]

const unit = z.number().min(0).max(1)
const positiveInt = z.number().int().positive()

const perAdapterSchema = z.object({
  max_queries: positiveInt,
  max_results_per_query: positiveInt,
  concurrency: positiveInt,
  timeout_ms: positiveInt.optional(),
})

const queryFormSchema = z.object({
  id: z.string().min(1),
  kind: z.enum(['post', 'topic', 'hashtag']),
  /** Placeholders: {keyword} {keyword_hashtag} {synonym} {qualifier}. */
  template: z.string().min(1),
})

export const bridgeConfigSchema = z.object({
  trend_window_days: positiveInt,
  max_keywords: positiveInt,
  max_queries_per_keyword: positiveInt,
  max_results_per_query: positiveInt,
  max_total_queries: positiveInt,
  default_result_limit: positiveInt,
  minimum_brand_relevance: z.enum(RELEVANCE_LEVELS),
  sort: z.enum(['published_at_desc', 'trend_score_desc']),
  sort_date_granularity: z.enum(['day', 'exact']),
  include_undated: z.boolean(),
  include_author_names: z.boolean(),
  snippet_max_chars: positiveInt,
  require_knowledge_base: z.boolean(),
  freshness_bands: z.object({
    very_recent_max_days: z.number().int().min(0),
    recent_max_days: z.number().int().min(0),
    current_max_days: z.number().int().min(0),
    aging_max_days: z.number().int().min(0),
  }),
  query_forms: z.array(queryFormSchema).min(1),
  query_qualifiers: z.array(z.string()),
  include_brand_domains_as_topics: z.boolean(),
  acquisition: z.object({
    /** Used by the Claude Code tool and the REST route. */
    adapters: z.array(z.enum(ADAPTER_IDS)).min(1),
    /** Used when the Scraping Agent's LinkedIn lane calls the bridge. */
    scraping_agent_adapters: z.array(z.enum(ADAPTER_IDS)).min(1),
    stop_after_consecutive_failures: positiveInt,
    per_adapter: z.record(z.enum(ADAPTER_IDS), perAdapterSchema),
    /** Per-call budget when the Scraping Agent calls the bridge once per keyword per lane. */
    scraping_agent: z.object({ max_queries_per_keyword: positiveInt }),
    claude_code: z.object({
      model: z.string().min(1),
      queries_per_session: positiveInt,
      max_budget_usd_per_session: z.number().positive(),
      allowed_tools: z.array(z.string().min(1)).min(1),
      /**
       * Platforms scoped with WebSearch's own `allowed_domains` filter instead of
       * a `site:` operator in the query. Tested 2026-09-24: on X it returned
       * 14 of 30 results from the current month against about 4 of 40 with
       * `site:x.com`, and on LinkedIn the first current-month post any form
       * found. On Instagram it returned profile pages, so Instagram keeps
       * `site:instagram.com/p`. A platform not listed uses its `site:` filters.
       */
      allowed_domains_by_platform: z.record(z.string(), z.array(z.string().min(1)).min(1)).default({}),
      /**
       * THE RESEARCH SESSION (adapters/claude-code.ts). Claude is given the
       * session's topics as a trend-research brief and may run its own related
       * searches. Every search it runs is harvested (raw results only), up to
       * `max_searches_per_session`; its JSON analysis is kept as a separate,
       * verified layer.
       */
      research: z
        .object({
          /** Filled into the brief's "Region" field. */
          region: z.string().min(1).default('Global'),
          /** Filled into the brief's "Required number of trends" field. */
          trend_count: positiveInt.default(10),
          /** Stated to Claude as a limit, and enforced: searches after this many are not used. */
          max_searches_per_session: positiveInt.default(16),
          /**
           * Reference documents given to Claude with the brief, as the reference
           * for what is relevant and how to classify it (paths from the repo root).
           * Read on every run, so an edit takes effect without a restart. A missing
           * file is reported in the platform's notes, never silently skipped.
           */
          reference_files: z
            .array(z.union([z.string().min(1), z.object({ role: z.string().min(1), path: z.string().min(1) })]))
            .default([]),
          /** Platform-specific instructions added to that platform's brief. */
          platform_notes: z.record(z.string(), z.string().min(1)).default({}),
        })
        .default({}),
    }),
    manual_urls_file: z.string().nullable(),
  }),
  context: z.object({
    knowledge_base: z.object({
      sources: z.array(z.enum(['database', 'file'])).min(1),
      search_paths: z.array(z.string()),
      subject_categories: z.array(z.string()),
      exclusion_categories: z.array(z.string()),
      max_entries: positiveInt,
      max_vocabulary_terms: positiveInt,
    }),
    keywords: z.object({
      sources: z.array(z.enum(['database', 'seed'])).min(1),
      /** Merge every source (table + seed) rather than taking the first that answers. */
      merge_sources: z.boolean().default(false),
      prioritise_schedule: z.boolean(),
    }),
    excluded_terms: z.array(z.string()),
  }),
  relevance: z.object({
    weights: z.object({ keyword: unit, topic: unit, knowledge_base: unit }),
    high_threshold: unit,
    medium_threshold: unit,
    topic_saturation: positiveInt,
    kb_saturation: positiveInt,
    /** Added per extra matched keyword, as a fraction of the best keyword's weight. */
    multi_keyword_bonus: unit,
    /**
     * Credit, as a fraction of the keyword's weight, for an item a search for
     * the keyword returned but whose visible text does not state the keyword.
     */
    query_match_factor: unit,
    /** Subtracted per distinct hype/pitch pattern the text uses, up to the cap. */
    hype_penalty_per_hit: unit,
    hype_penalty_cap: unit,
    restriction_penalty: unit,
  }),
  ranking: z.object({
    weights: z.object({
      recency: unit,
      keyword_relevance: unit,
      topic_relevance: unit,
      hashtag_signal: unit,
      cross_query: unit,
      source_signal: unit,
      engagement: unit,
    }),
    undated_recency_score: unit,
  }),
  deduplication: z.object({ similarity_threshold: unit }),
  /**
   * The Scraping Agent's capture: platform-level trend discovery. The two
   * budget numbers are CEILINGS — a caller may ask for fewer, never more.
   */
  platform_trends: z.object({
    platforms: z.array(z.enum(['linkedin', 'instagram', 'x', 'facebook', 'web'])).min(1),
    /**
     * The default window when a caller names none. `current_month`: from the
     * first day of the current month (workspace time zone) to now — "what is
     * trending this month". `hours`: the last `window_hours`.
     */
    window: z.enum(['current_month', 'hours']).default('current_month'),
    window_hours: positiveInt,
    max_searches_per_platform: positiveInt,
    /**
     * The default search budget per platform when a caller names none (the
     * Scraping Agent passes its own knob). At most `max_searches_per_platform`.
     */
    default_searches_per_platform: positiveInt.default(16),
    /**
     * ONE TOPIC PER SEARCH. Tested 2026-09-24 against Claude Code WebSearch: an
     * OR of quoted phrases scoped to a platform returned nothing newer than
     * 2025 on LinkedIn, while a single quoted topic with the month named
     * ("\"AI agents\" September 2026") returned this month's posts on X.
     * Of the keyword searches, this share goes to the highest-priority keywords
     * every run; the rest rotate daily through the remaining keywords so every
     * keyword is searched over successive runs.
     */
    fixed_keyword_share: z.number().min(0).max(1).default(0.5),
    /**
     * PLATFORM TREND VS PLATFORM ACTIVITY (system prompt §8, §15). A group of
     * current-month posts on one topic is a `platform_trend` only when at least
     * this many INDEPENDENT authors posted it; fewer is `platform_activity`.
     * Several URLs from one author are one source.
     */
    platform_trend_min_authors: positiveInt.default(2),
    /** How many searches the broad field terms (`broad_terms`) fill, one term each. */
    broad_searches: z.number().int().min(0).default(1),
    /**
     * Keywords naming the brand itself ("Ethara RLaaS") are left out of the
     * SEARCHES — they find the brand's own posts, not what the field is
     * discussing. They still count for relevance.
     */
    exclude_brand_named_searches: z.boolean().default(true),
    terms_per_search: positiveInt,
    /** Broad terms search better: keywords longer than this come after the shorter ones. */
    max_words_per_term: positiveInt,
    max_results_per_search: positiveInt,
    max_posts_per_trend: positiveInt,
    analysis_batch_size: positiveInt,
    minimum_brand_relevance: z.enum(RELEVANCE_LEVELS),
    /**
     * Add the current month and year ("September 2026") to the keyword
     * searches. Search engines rank by relevance, not date; naming the month
     * measurably surfaces recent posts (tested on X). The hashtag search is left
     * unhinted so recall does not suffer.
     */
    recency_hint: z.boolean().default(true),
    /**
     * Keep posts RELATED to Ethara's field, not only those naming a configured
     * keyword: a post with no keyword match is kept when it carries at least
     * `related_min_signals` brand-topic / Knowledge Base signals and reaches
     * `related_minimum_relevance`. Such posts are flagged `related`.
     */
    accept_related: z.boolean().default(true),
    related_min_signals: positiveInt.default(2),
    related_minimum_relevance: z.enum(RELEVANCE_LEVELS).default('medium'),
    /** Hashtags learned into the Knowledge Base on earlier runs, added to the hashtag search. */
    learned_hashtags_per_search: z.number().int().min(0).default(2),
    /** Search EVERY keyword (redundant ones dropped), not only the run's rota subset. */
    search_all_keywords: z.boolean().default(true),
    /**
     * THE CORPUS AS REFERENCE. Topics, methods and benchmarks of the papers in
     * `corpus/` (ingested as Brand Corpus), derived once per corpus by Claude
     * (context/corpus-topics.ts): they fill `corpus_searches` of each
     * platform's searches (rotating daily through the list), join the hashtag
     * search, and count as brand topics for relevance.
     */
    corpus_topics: z
      .object({
        enabled: z.boolean().default(true),
        max_terms: positiveInt.default(32),
        max_hashtags: positiveInt.default(16),
        corpus_searches: z.number().int().min(0).default(2),
        hashtags_per_search: z.number().int().min(0).default(2),
        model: z.string().default('sonnet'),
        max_budget_usd: z.number().positive().default(0.4),
      })
      .default({}),
    /**
     * Broad Ethara-domain terms searched alongside the week's keywords. The
     * rota is often niche ("RLVR", "agent environments") and few indexed posts
     * use those exact phrases; one broad search per platform keeps every
     * platform returning something relevant. Relevance is still decided by the
     * full keyword set.
     */
    broad_terms: z.array(z.string().min(1)).default([]),
    broad_hashtags: z.array(z.string().min(1)).default([]),
    /**
     * When a platform has no relevant post verified INSIDE the window, list its
     * newest relevant posts from before it — real posts with real dates,
     * labelled "older than the window", never presented as current.
     */
    fallback_to_latest: z.boolean().default(false),
    /** How far back that fallback may reach. */
    fallback_max_age_days: positiveInt.default(365),
    fallback_max_posts: positiveInt.default(5),
    /**
     * Platforms whose posts cannot be dated (Facebook) are searched anyway and
     * their relevant posts listed with "date not stated" — never passed on as
     * dated evidence.
     */
    include_undated: z.boolean().default(false),
    max_undated_posts: positiveInt.default(5),
    /**
     * Each platform's own source adapter, by id — so one platform's source can
     * be replaced without touching the others (e.g. LinkedIn on an official
     * API adapter while X stays on Claude Code search). A platform not listed
     * uses `claude_code`.
     */
    /**
     * Used for a platform whose own source adapter is unavailable or runs out.
     * Unset by default (2026-09-24): trends come from `claude_code` alone, and a
     * platform that returns nothing reports why rather than falling back.
     */
    fallback_adapter: z.enum(ADAPTER_IDS).optional(),
    source_adapters: z
      .object({
        linkedin: z.enum(ADAPTER_IDS).optional(),
        instagram: z.enum(ADAPTER_IDS).optional(),
        facebook: z.enum(ADAPTER_IDS).optional(),
        x: z.enum(ADAPTER_IDS).optional(),
        web: z.enum(ADAPTER_IDS).optional(),
      })
      .default({}),
  }),
  /** Open-web pages only: reading a page's own published date, under robots.txt. */
  page_metadata: z.object({
    enabled: z.boolean(),
    max_pages_per_run: z.number().int().min(0),
    concurrency: positiveInt,
    timeout_ms: positiveInt,
    max_bytes: positiveInt,
    user_agent: z.string().min(1),
  }),
})

export type BridgeConfig = z.infer<typeof bridgeConfigSchema>
export type PerAdapterConfig = z.infer<typeof perAdapterSchema>
export type QueryForm = z.infer<typeof queryFormSchema>

/** Thrown when the config file is missing or malformed. Names the file and the field. */
export class BridgeConfigError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'BridgeConfigError'
  }
}

function envInt(key: string): number | undefined {
  const raw = process.env[key]?.split('#')[0]?.trim()
  if (raw === undefined || raw === '') return undefined
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) && n > 0 ? n : undefined
}

function envStr(key: string): string | undefined {
  const raw = process.env[key]?.split('#')[0]?.trim()
  return raw === undefined || raw === '' ? undefined : raw
}

/** Resolves a configured path against the repository root, never the cwd. */
export function repoPath(path: string): string {
  return isAbsolute(path) ? path : join(REPO_ROOT, path)
}

/**
 * Reads, validates and env-overlays the bridge configuration.
 *
 * `LINKEDIN_TRENDS_CONFIG` points at an alternative file. The overrides below
 * are applied after validation and re-validated, so an env value can never
 * produce a config the schema would refuse.
 */
export function loadBridgeConfig(path?: string): BridgeConfig {
  const file = path ?? envStr('LINKEDIN_TRENDS_CONFIG') ?? DEFAULT_CONFIG_PATH
  const resolved = repoPath(file)
  if (!existsSync(resolved)) {
    throw new BridgeConfigError(`Bridge config not found at ${resolved}`)
  }

  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolved, 'utf8'))
  } catch (error) {
    throw new BridgeConfigError(
      `Bridge config at ${resolved} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`,
    )
  }

  const parsed = bridgeConfigSchema.safeParse(raw)
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    throw new BridgeConfigError(
      `Bridge config at ${resolved} is invalid: ${issue?.path.join('.') || '(root)'} — ${issue?.message ?? 'invalid'}`,
    )
  }

  const cfg = parsed.data
  const adaptersEnv = envStr('LINKEDIN_TRENDS_ADAPTERS')
  const minRelevance = envStr('LINKEDIN_TRENDS_MIN_RELEVANCE')

  const overlaid = {
    ...cfg,
    trend_window_days: envInt('LINKEDIN_TRENDS_WINDOW_DAYS') ?? cfg.trend_window_days,
    max_keywords: envInt('LINKEDIN_TRENDS_MAX_KEYWORDS') ?? cfg.max_keywords,
    max_queries_per_keyword:
      envInt('LINKEDIN_TRENDS_MAX_QUERIES_PER_KEYWORD') ?? cfg.max_queries_per_keyword,
    max_results_per_query:
      envInt('LINKEDIN_TRENDS_MAX_RESULTS_PER_QUERY') ?? cfg.max_results_per_query,
    max_total_queries: envInt('LINKEDIN_TRENDS_MAX_TOTAL_QUERIES') ?? cfg.max_total_queries,
    default_result_limit: envInt('LINKEDIN_TRENDS_RESULT_LIMIT') ?? cfg.default_result_limit,
    minimum_brand_relevance: minRelevance ?? cfg.minimum_brand_relevance,
    acquisition: {
      ...cfg.acquisition,
      adapters:
        adaptersEnv === undefined
          ? cfg.acquisition.adapters
          : adaptersEnv.split(',').map((s) => s.trim()).filter((s) => s !== ''),
      manual_urls_file: envStr('LINKEDIN_TRENDS_MANUAL_URLS_FILE') ?? cfg.acquisition.manual_urls_file,
      claude_code: {
        ...cfg.acquisition.claude_code,
        model: envStr('CLAUDE_BRIDGE_MODEL') ?? cfg.acquisition.claude_code.model,
      },
    },
  }

  const final = bridgeConfigSchema.safeParse(overlaid)
  if (!final.success) {
    const issue = final.error.issues[0]
    throw new BridgeConfigError(
      `A LINKEDIN_TRENDS_* environment override is invalid: ${issue?.path.join('.') || '(root)'} — ${issue?.message ?? 'invalid'}`,
    )
  }
  return final.data
}

/** The per-adapter limits, falling back to the global ones when an adapter has no entry. */
export function adapterLimits(cfg: BridgeConfig, id: AdapterId): PerAdapterConfig {
  return (
    cfg.acquisition.per_adapter[id] ?? {
      max_queries: cfg.max_total_queries,
      max_results_per_query: cfg.max_results_per_query,
      concurrency: 2,
    }
  )
}

/** Where a structured execution log is appended, if anywhere. */
export function logFilePath(): string | undefined {
  const raw = envStr('LINKEDIN_TRENDS_LOG_FILE')
  return raw === undefined ? undefined : repoPath(raw)
}

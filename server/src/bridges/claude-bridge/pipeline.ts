/**
 * THE CLAUDE BRIDGE PIPELINE
 *
 *   context (KB · brand voice · keywords)
 *     → discovery queries
 *     → acquisition adapters
 *     → normalise + validate → de-duplicate → freshness
 *     → brand relevance → trend ranking → date-first sort
 *     → structured output (+ Markdown elsewhere)
 *
 * Used by three callers: the Claude Code tool (MCP), the REST route, and the
 * Scraping Agent's LinkedIn lane (`capture-source.ts`, via `acquire()`).
 *
 * Never fills a gap. No source → empty results with the reason. No date → the
 * item says `unknown`. Fewer results than asked for → fewer results.
 */

import { randomUUID } from 'node:crypto'
import { synonymsFor } from '../../../../shared/keywords'
import { mapWithConcurrency } from '../../integrations/adapter'
import { createAdapter } from './adapters/linkedin-source-adapter'
import { suppliedCandidates } from './adapters/manual-urls'
import {
  SourceError,
  type DiscoveryQuery,
  type SearchRequest,
  type SourceCandidate,
  type TrendSourceAdapter,
} from './adapters/source-types'
import { redact } from './adapters/claude-cli'
import {
  adapterLimits,
  BridgeConfigError,
  loadBridgeConfig,
  type AdapterId,
  type BridgeConfig,
  type RelevanceLevel,
} from './config'
import {
  ContextError,
  loadProjectContext,
  prioritiseKeywords,
  type BridgeContext,
  type KeywordEntry,
} from './context'
import { buildQueries } from './discovery/query-builder'
import { writeExecutionLog, type LogSink } from './logging'
import { platformModule, type PlatformModule } from './platforms'
import { deduplicate } from './processing/deduplicator'
import { ageInDays, applyFreshness, classifyFreshness, resolveWindow, type SearchWindow } from './processing/freshness'
import { normalizeCandidates, type NormalizedCandidate } from './processing/normalizer'
import { enrichFromPageMetadata } from './processing/page-metadata'
import { analyzeRelevance, buildRelevanceModel, meetsMinimum } from './processing/relevance'
import { aggregateHashtags, aggregateTopics, topicFor } from './processing/topics'
import { hashtagFrequency, scoreItems, sortScored } from './processing/trend-ranking'
import {
  COMPUTED_FIELDS,
  OBSERVED_FIELDS,
  PROVENANCE_STATEMENT,
  trendToolInputSchema,
  type AdapterReport,
  type ContextReport,
  type Diagnostics,
  type SourceStatus,
  type TrendIntelligenceOutput,
  type TrendResult,
  type TrendToolInput,
} from './schemas/trend-output'

export interface RunOptions {
  input?: TrendToolInput
  config?: BridgeConfig
  /** Injected context (sample mode, tests). Project context is loaded otherwise. */
  context?: BridgeContext
  /** Injected adapters (tests). Built from ids otherwise. */
  adapters?: TrendSourceAdapter[]
  /** `tool` uses `acquisition.adapters`; `scraping_agent` uses `acquisition.scraping_agent_adapters`. */
  mode?: 'tool' | 'scraping_agent'
  now?: Date
  fixturePath?: string
  /** Where the execution log line goes; `null` silences it (tests). */
  logSink?: LogSink | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACQUISITION
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AcquisitionOutcome {
  candidates: SourceCandidate[]
  reports: AdapterReport[]
  queriesExecuted: number
  errors: string[]
}

function methodFor(adapter: TrendSourceAdapter, query: DiscoveryQuery): (req: SearchRequest) => Promise<SourceCandidate[]> {
  switch (query.kind) {
    case 'hashtag':
      return (req) => adapter.search_hashtags(req)
    case 'topic':
      return (req) => adapter.search_topics(req)
    case 'post':
      return (req) => adapter.search_posts(req)
  }
}

async function runAdapter(
  adapter: TrendSourceAdapter,
  queries: readonly DiscoveryQuery[],
  window: SearchWindow,
  cfg: BridgeConfig,
  suppliedUrls: readonly string[],
): Promise<{ candidates: SourceCandidate[]; report: AdapterReport; executed: number; errors: string[] }> {
  const report: AdapterReport = {
    adapter: adapter.id,
    label: adapter.label,
    kind: adapter.kind,
    status: 'ok',
    reason: null,
    queries_executed: 0,
    candidates: 0,
  }

  const availability = adapter.availability()
  if (!availability.available) {
    report.status = adapter.kind === 'manual' ? 'skipped' : 'unavailable'
    report.reason = availability.reason
    return { candidates: [], report, executed: 0, errors: adapter.kind === 'manual' ? [] : [`${adapter.label}: ${availability.reason}`] }
  }

  const limits = adapterLimits(cfg, adapter.id)
  const perQuery = Math.min(limits.max_results_per_query, cfg.max_results_per_query)
  const toRun = queries.slice(0, limits.max_queries)
  const requests: SearchRequest[] = toRun.map((query) => ({ query, maxResults: perQuery, window }))
  const candidates: SourceCandidate[] = []
  const errors: string[] = []
  let executed = 0
  /** Queries that returned without error, found something or not. */
  let succeeded = 0
  let fatal: string | null = null

  // Directly supplied URLs are analysed whether or not any query matches them.
  if (adapter.id === 'manual_urls' && suppliedUrls.length > 0) {
    candidates.push(...suppliedCandidates(suppliedUrls))
  }

  if (adapter.searchBatch) {
    try {
      const outcome = await adapter.searchBatch(requests)
      candidates.push(...outcome.candidates)
      executed = outcome.executed.length
      succeeded = outcome.errors.length === 0 ? executed : Math.max(0, executed - outcome.errors.length)
      errors.push(...outcome.errors)
    } catch (error) {
      fatal = error instanceof Error ? error.message : String(error)
    }
  } else {
    let consecutive = 0
    await mapWithConcurrency(requests, limits.concurrency, async (req) => {
      if (fatal !== null || consecutive >= cfg.acquisition.stop_after_consecutive_failures) return
      try {
        const found = await methodFor(adapter, req.query)(req)
        executed += 1
        succeeded += 1
        consecutive = 0
        candidates.push(...found)
      } catch (error) {
        executed += 1
        consecutive += 1
        const message = error instanceof Error ? error.message : String(error)
        if (error instanceof SourceError && error.fatal) fatal = message
        else errors.push(`“${req.query.text}”: ${message}`)
      }
    })
    if (fatal === null && consecutive >= cfg.acquisition.stop_after_consecutive_failures && requests.length > executed) {
      errors.push(`Stopped after ${consecutive} consecutive failures; ${requests.length - executed} queries not attempted.`)
    }
  }

  report.queries_executed = executed
  report.candidates = candidates.length
  const allErrors = fatal === null ? errors : [fatal, ...errors]
  if (candidates.length === 0) {
    // Nothing found: an error when no query got an answer at all, empty when
    // the source answered and simply had nothing.
    report.status = fatal !== null || (succeeded === 0 && allErrors.length > 0) ? 'error' : 'empty'
  }
  if (allErrors.length > 0) report.reason = redact(allErrors.slice(0, 3).join(' · '))

  return { candidates, report, executed, errors: allErrors.map((e) => redact(`${adapter.label}: ${e}`)) }
}

/** Runs every adapter over the queries. Adapters run concurrently; each honours its own limits. */
export async function acquire(
  adapters: readonly TrendSourceAdapter[],
  queries: readonly DiscoveryQuery[],
  window: SearchWindow,
  cfg: BridgeConfig,
  suppliedUrls: readonly string[] = [],
): Promise<AcquisitionOutcome> {
  const runs = await Promise.all(adapters.map((a) => runAdapter(a, queries, window, cfg, suppliedUrls)))
  return {
    candidates: runs.flatMap((r) => r.candidates),
    reports: runs.map((r) => r.report),
    queriesExecuted: runs.reduce((n, r) => n + r.executed, 0),
    errors: runs.flatMap((r) => r.errors),
  }
}

function sourceStatusOf(reports: readonly AdapterReport[]): SourceStatus {
  const considered = reports.filter((r) => r.status !== 'skipped')
  if (considered.some((r) => r.kind === 'fixture' && (r.status === 'ok' || r.status === 'empty'))) return 'fixture'
  const ok = considered.filter((r) => r.status === 'ok').length
  const problems = considered.filter((r) => r.status === 'unavailable' || r.status === 'error').length
  const empty = considered.filter((r) => r.status === 'empty').length
  if (ok > 0) return problems > 0 ? 'partial' : 'ok'
  if (empty > 0) return 'empty'
  return 'unavailable'
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE FULL RUN
   ═══════════════════════════════════════════════════════════════════════════ */

function emptyDiagnostics(): Diagnostics {
  return {
    queries_generated: 0,
    queries_executed: 0,
    candidates_found: 0,
    invalid_removed: 0,
    duplicates_removed: 0,
    stale_results_removed: 0,
    out_of_window_removed: 0,
    below_relevance_removed: 0,
    undated_results: 0,
    errors: [],
    notes: [],
  }
}

function provenance(): TrendIntelligenceOutput['data_provenance'] {
  return { observed_fields: OBSERVED_FIELDS, computed_fields: COMPUTED_FIELDS, statement: PROVENANCE_STATEMENT }
}

function configurationError(
  message: string,
  executionId: string,
  now: Date,
  platform: PlatformModule | undefined,
  window: SearchWindow | null,
  startedAt: number,
  mode: string,
  logSink: LogSink | null | undefined,
): TrendIntelligenceOutput {
  const out: TrendIntelligenceOutput = {
    status: 'configuration_error',
    execution_id: executionId,
    generated_at: now.toISOString(),
    source: platform?.id ?? 'linkedin',
    source_status: 'unavailable',
    search_window: { from: (window?.from ?? now).toISOString(), to: (window?.to ?? now).toISOString() },
    sort: 'published_at_desc',
    total_candidates: 0,
    results: [],
    trending_topics: [],
    trending_hashtags: [],
    queries: [],
    adapters: [],
    context: null,
    diagnostics: { ...emptyDiagnostics(), errors: [redact(message)] },
    data_provenance: provenance(),
    error: redact(message),
  }
  writeExecutionLog(
    {
      event: 'claude_bridge.execution',
      execution_id: executionId,
      platform: out.source,
      mode,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      queries_generated: 0,
      queries_executed: 0,
      candidates_found: 0,
      duplicates_removed: 0,
      stale_results_removed: 0,
      final_results: 0,
      source_status: 'configuration_error',
      adapters: [],
      errors: [message],
    },
    logSink,
  )
  return out
}

export async function runTrendIntelligence(opts: RunOptions = {}): Promise<TrendIntelligenceOutput> {
  const startedAt = Date.now()
  const executionId = randomUUID()
  const now = opts.now ?? new Date()
  const mode = opts.mode ?? 'tool'

  const parsedInput = trendToolInputSchema.safeParse(opts.input ?? {})
  if (!parsedInput.success) {
    const issue = parsedInput.error.issues[0]
    return configurationError(
      `Invalid input: ${issue?.path.join('.') || '(root)'} — ${issue?.message ?? 'invalid'}`,
      executionId, now, undefined, null, startedAt, mode, opts.logSink,
    )
  }
  const input = parsedInput.data

  let cfg: BridgeConfig
  try {
    cfg = opts.config ?? loadBridgeConfig()
  } catch (error) {
    const message =
      error instanceof BridgeConfigError ? error.message : `Bridge config could not be loaded — ${String(error)}`
    return configurationError(message, executionId, now, undefined, null, startedAt, mode, opts.logSink)
  }

  const platform = platformModule(input.platform ?? 'linkedin')
  if (platform === undefined) {
    return configurationError(`No platform module for ${input.platform}`, executionId, now, undefined, null, startedAt, mode, opts.logSink)
  }

  const window = resolveWindow(cfg, now, input.date_from, input.date_to)
  if (window.from.getTime() >= window.to.getTime()) {
    return configurationError('date_from must be earlier than date_to', executionId, now, platform, window, startedAt, mode, opts.logSink)
  }

  let context: BridgeContext
  try {
    context = opts.context ?? (await loadProjectContext(cfg, now))
  } catch (error) {
    const message =
      error instanceof ContextError
        ? error.message
        : `Context could not be loaded — ${error instanceof Error ? error.message : String(error)}`
    return configurationError(message, executionId, now, platform, window, startedAt, mode, opts.logSink)
  }

  const diagnostics = emptyDiagnostics()

  /* ── keywords and queries ─────────────────────────────────────────────── */
  const override: KeywordEntry[] = (input.keywords ?? []).map((term) => ({
    term,
    weight: 100,
    category: 'Requested',
    synonyms: synonymsFor(term),
    scheduled: null,
  }))
  const keywords = override.length > 0 ? override : prioritiseKeywords(context.keywords, cfg)
  const plan = buildQueries(
    { keywords, brandVoice: context.brandVoice, plannedQueries: input.queries, includeDomainTopics: override.length === 0 },
    cfg,
  )
  diagnostics.queries_generated = plan.generatedBeforeBudget
  if (plan.generatedBeforeBudget > plan.queries.length) {
    diagnostics.notes.push(`${plan.generatedBeforeBudget - plan.queries.length} generated queries exceeded max_total_queries (${cfg.max_total_queries}) and were not run.`)
  }

  /* ── acquisition ──────────────────────────────────────────────────────── */
  const suppliedUrls = input.post_urls ?? []
  let adapters: TrendSourceAdapter[]
  if (opts.adapters) {
    adapters = opts.adapters
  } else {
    const ids: AdapterId[] = [...(input.adapters ?? (mode === 'scraping_agent' ? cfg.acquisition.scraping_agent_adapters : cfg.acquisition.adapters))]
    if (suppliedUrls.length > 0 && !ids.includes('manual_urls')) ids.push('manual_urls')
    try {
      adapters = ids.map((id) => createAdapter(id, { platform, config: cfg, suppliedUrls, fixturePath: opts.fixturePath }))
    } catch (error) {
      return configurationError(error instanceof Error ? error.message : String(error), executionId, now, platform, window, startedAt, mode, opts.logSink)
    }
  }

  const acquired = await acquire(adapters, plan.queries, window, cfg, suppliedUrls)
  diagnostics.queries_executed = acquired.queriesExecuted
  diagnostics.candidates_found = acquired.candidates.length
  diagnostics.errors.push(...acquired.errors)

  /* ── processing ───────────────────────────────────────────────────────── */
  const normalized = normalizeCandidates(acquired.candidates, platform, cfg, now)
  diagnostics.invalid_removed = normalized.rejected.off_platform + normalized.rejected.not_a_post + normalized.rejected.empty
  if (normalized.rejected.not_a_post > 0) {
    diagnostics.notes.push(
      `${normalized.rejected.not_a_post} ${platform.label} URLs were profiles, pages or other non-post URLs and were not used.`,
    )
  }
  if (normalized.rejected.off_platform > 0) {
    diagnostics.notes.push(`${normalized.rejected.off_platform} results were not on ${platform.label} and were not used.`)
  }

  const deduped = deduplicate(normalized.items, cfg.deduplication.similarity_threshold)
  diagnostics.duplicates_removed = deduped.duplicates_removed

  // Open web only: an undated page may state its own published date.
  if (platform.readsPageDates) {
    const pm = await enrichFromPageMetadata(deduped.items, cfg, now)
    if (pm.attempted > 0) {
      diagnostics.notes.push(
        `Read ${pm.attempted} page(s) for their own published date: ${pm.dated} dated, ` +
          `${pm.blockedByRobots} not read because robots.txt disallows it, ${pm.failed} unreachable.`,
      )
    }
  }

  const fresh = applyFreshness(deduped.items, window, cfg.include_undated)
  diagnostics.stale_results_removed = fresh.stale_removed
  diagnostics.out_of_window_removed = fresh.out_of_window_removed
  if (fresh.undated_removed > 0) diagnostics.notes.push(`${fresh.undated_removed} undated items were left out (include_undated is off).`)
  if (fresh.stale_removed > 0 && fresh.kept.every((i) => i.published_at === null)) {
    // Say how far outside the window the evidence was, so "nothing recent" is
    // a measured statement rather than a blank table.
    const freshest = deduped.items
      .map((i) => i.published_at)
      .filter((d): d is string => d !== null && Date.parse(d) < window.from.getTime())
      .sort()
      .at(-1)
    if (freshest) {
      const days = Math.floor((window.to.getTime() - Date.parse(freshest)) / 86_400_000)
      diagnostics.notes.push(
        `Every dated post found was older than the window; the freshest was published ${freshest.slice(0, 10)} (${days} days before its end). ` +
          `Public search indexes often lag ${platform.label} by weeks — widen date_from, or supply recent post URLs, to see more.`,
      )
    }
  }

  const model = buildRelevanceModel(context, cfg, override)
  const minimum: RelevanceLevel = input.brand_context === false ? 'low' : (input.min_brand_relevance ?? cfg.minimum_brand_relevance)
  const analysed = fresh.kept.map((item) => ({ item, relevance: analyzeRelevance(item, model, cfg) }))
  const relevant = analysed.filter((a) => meetsMinimum(a.relevance.level, minimum))
  diagnostics.below_relevance_removed = analysed.length - relevant.length

  const genericTags = new Set(context.brandVoice.generic_hashtags.map((t) => t.toLowerCase().replace(/^#/, '')))
  const relevantItems: NormalizedCandidate[] = relevant.map((a) => a.item)
  const scored = sortScored(scoreItems(relevant, relevantItems, window, genericTags, cfg, now), cfg)
  const freq = hashtagFrequency(relevantItems)

  const includeTags = input.include_hashtags !== false
  const includeUrls = input.include_post_urls !== false
  const all: TrendResult[] = scored.map((s, index) => {
    const age = ageInDays(s.item.published_at, now)
    return {
      rank: index + 1,
      topic: topicFor(s.relevance.topic_keywords, s.relevance.matched_topics, s.item.hashtags, freq, genericTags),
      published_at: s.item.published_at,
      date_status: s.item.date_status,
      date_source: s.item.date_source,
      freshness: classifyFreshness(age, cfg.freshness_bands),
      age_days: age,
      hashtags: includeTags ? s.item.hashtags.map((h) => h.display) : [],
      post_url: includeUrls ? s.item.url : null,
      source_type: platform.id,
      content_type: s.item.contentType,
      author: s.item.author,
      snippet: s.item.snippet,
      matched_keywords: s.relevance.matched_keywords,
      matched_queries: [...s.item.queries],
      sources: [...s.item.adapters],
      engagement_available: s.engagement_available,
      engagement: s.engagement_available ? s.item.engagement : null,
      trend_score: s.trend_score,
      score_breakdown: s.breakdown,
      brand_relevance: s.relevance.level,
      relevance_score: s.relevance.relevance_score,
      relevance_reason: s.relevance.reason,
      trend_reason: s.trend_reason,
    }
  })
  const limit = input.max_results ?? cfg.default_result_limit
  const results = all.slice(0, limit)
  diagnostics.undated_results = results.filter((r) => r.date_status === 'unknown').length

  const sourceStatus = sourceStatusOf(acquired.reports)
  const contextReport: ContextReport | null =
    input.brand_context === false
      ? null
      : {
          knowledge_base: { source: context.knowledgeBase.source, entries: context.knowledgeBase.entries.length, vocabulary_terms: model.kbVocabulary.size },
          brand_voice: { sources: context.brandVoice.sources, positioning: context.brandVoice.positioning, audience: context.brandVoice.audience },
          keywords: { source: override.length > 0 ? 'input:keywords' : context.keywords.source, count: keywords.length, used: plan.keywordsUsed },
        }

  const output: TrendIntelligenceOutput = {
    status: 'ok',
    execution_id: executionId,
    generated_at: now.toISOString(),
    source: platform.id,
    source_status: sourceStatus,
    search_window: { from: window.from.toISOString(), to: window.to.toISOString() },
    sort: cfg.sort === 'published_at_desc' ? `published_at desc (by ${cfg.sort_date_granularity}), trend_score desc, brand_relevance desc` : 'trend_score desc, published_at desc',
    total_candidates: deduped.items.length,
    results,
    trending_topics: aggregateTopics(all),
    trending_hashtags: aggregateHashtags(all, genericTags),
    queries: plan.queries.map((q) => ({ text: q.text, kind: q.kind, keyword: q.keyword, origin: q.origin })),
    adapters: acquired.reports,
    context: contextReport,
    diagnostics,
    data_provenance: provenance(),
  }

  writeExecutionLog(
    {
      event: 'claude_bridge.execution',
      execution_id: executionId,
      platform: platform.id,
      mode,
      started_at: new Date(startedAt).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - startedAt,
      queries_generated: diagnostics.queries_generated,
      queries_executed: diagnostics.queries_executed,
      candidates_found: diagnostics.candidates_found,
      duplicates_removed: diagnostics.duplicates_removed,
      stale_results_removed: diagnostics.stale_results_removed,
      final_results: results.length,
      source_status: sourceStatus,
      adapters: acquired.reports.map(({ adapter, status, queries_executed, candidates }) => ({ adapter, status, queries_executed, candidates })),
      errors: diagnostics.errors,
    },
    opts.logSink,
  )

  return output
}

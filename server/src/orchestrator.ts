/**
 * THE ORCHESTRATOR
 *
 * The ONLY module that sequences agents. Cron, the REST API and Ethara all arrive
 * here, so an operator-triggered run is indistinguishable from a scheduled one in
 * telemetry. There is no second execution path.
 *
 * Sequencing is derived from the registry's `handsOffTo` graph, never hardcoded
 * per caller: if the order is wrong, the graph is wrong.
 */

import type {
  AgentId,
  CalendarSlot,
  IdeaStatus,
  Platform,
} from '../../shared/agent-contract'
import { AGENT_BY_ID, SKILL_BY_ID } from '../../shared/agent-registry'
import { canvasFor, canvasKey, type ImageModelId } from '../../shared/image-models'
import { config } from './config'
import { publish, publishActivity } from './events'
import {
  appendIdeaFeedback,
  countPipelineRuns,
  finishKnowledgeBuild,
  finishPipelineRun,
  getDraft,
  getIdea,
  getMediaAsset,
  insertActivity,
  insertKnowledgeEntry,
  insertLineage,
  insertReviewQueueRow,
  latestKeywordSignals,
  linkDuplicateHashtag,
  linkDuplicateItem,
  listHashtags,
  listIdeas,
  listKeywords,
  listPosts,
  listSkillOverrides,
  insertKeywordSignal,
  persistHashtagCandidates,
  persistIdeas,
  persistScrapedItems,
  recordScrapedTopicsAsKnowledge,
  replaceTopHashtagSet,
  setAgentState,
  setLeadershipDecision,
  setMarketingApproval,
  startKnowledgeBuild,
  startPipelineRun,
  updateIdea,
  upsertDraft,
  upsertMediaAsset,
  type IdeaRow,
} from './db/repo'
import { resolveConfig, runAgent } from './agents/runtime'
import type {
  AnalyticsPayload,
  CaptionPayload,
  ImagePayload,
  KnowledgePayload,
  LearningPayload,
  PipelinePayload,
  PublishPayload,
  ReviewPayload,
} from './agents/skills/index'
import { PLATFORM_LABEL } from './agents/corpus'

/* ═══════════════════════════════════════════════════════════════════════════
   TRIGGERS
   ═══════════════════════════════════════════════════════════════════════════ */

export type Trigger = 'cron' | 'manual' | 'assistant' | 'api'

export interface OrchestratorContext {
  workspaceId: string
  trigger: Trigger
  /** The command plane turn that caused this, recorded on every row it produces. */
  turnId?: string | null
  paceMs?: number
  configOverrides?: Record<string, Record<string, unknown>>
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DISCOVERY PIPELINE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PipelineSummary {
  keywordsScanned: number
  postsScraped: number
  hashtagsFound: number
  trending: number
  validated: number
  needsReview: number
  duplicate: number
  rejected: number
  topHashtags: number
  opportunities: number
  ideas: number
  primaryIdeas: number
  suggestionIdeas: number
  source: 'live' | 'fixture'
  fallbackReasons: string[]
  /** Posts handed to the Content and Image Agents because they took a slot. */
  written: number
  writeFailed: number
}

export interface PipelineResult {
  pipelineRunId: string
  status: 'completed' | 'failed'
  summary: PipelineSummary
  trendingKeywords: Array<{ term: string; trendScore: number; rank: number; reason: string }>
  topHashtags: Array<{ tag: string; rank: number; score: number }>
  ideas: Array<{ id: string; title: string; platform: Platform; slot: CalendarSlot; rank: number | null }>
  error?: string
}

/**
 * A skill's effective configuration, resolved OUTSIDE a skill run.
 *
 * The orchestrator needs two of `calendar.rank.select`'s knobs to decide whether
 * to walk the graph into the write stage, and it is not inside a `ctx`. Resolved
 * through the same precedence the runtime uses — registry default < workspace
 * override — so the operator's setting in Agent Studio governs the hand-off
 * exactly as it governs the skill, rather than the orchestrator carrying a second
 * copy of the default.
 */
async function resolveSkillConfig(
  workspaceId: string,
  skillId: string,
): Promise<Record<string, string | number | boolean>> {
  const skill = SKILL_BY_ID[skillId]
  if (!skill) return {}
  // A Map keyed by skill id, so this is a lookup rather than a scan.
  const overrides = await listSkillOverrides(workspaceId)
  return resolveConfig(skill, overrides.get(skillId)?.config, undefined)
}

export async function runDiscoveryPipeline(
  ctx: OrchestratorContext & { keywordIds?: string[] },
): Promise<PipelineResult> {
  const { workspaceId, trigger, turnId = null, paceMs = 0, configOverrides = {} } = ctx

  const run = await startPipelineRun(workspaceId, trigger, turnId ?? undefined)

  // The offset rotates the fixture corpus, so a repeat run surfaces new items
  // rather than replaying the first one.
  const runOffset = await countPipelineRuns(workspaceId)

  publish({
    type: 'pipeline.started',
    runId: run.id,
    ...(turnId === null ? {} : { turnId }),
    message: 'Discovery pipeline started',
    data: { trigger, runOffset },
  })
  await insertActivity({
    workspaceId,
    agentId: 'scraping',
    message: `Discovery run started (${trigger})`,
    status: 'running',
  })

  const shared = {
    workspaceId,
    pipelineRunId: run.id,
    trigger,
    turnId,
    paceMs,
    configOverrides,
  }

  const seed: PipelinePayload = { runId: run.id, runOffset, ...(ctx.keywordIds ? { keywordIds: ctx.keywordIds } : {}) }

  /* ── ① Scraping ─────────────────────────────────────────────────────────── */
  const scraping = await runAgent<PipelinePayload>('scraping', seed, {
    ...shared,
    currentTask: 'Scanning LinkedIn',
    inputCount: 0,
  })

  if (scraping.status === 'failed') {
    // A critical failure finishes the run failed with NO partial hand-off.
    return failRun(run.id, scraping.error ?? `${AGENT_BY_ID.scraping.name} failed.`, emptySummary(), turnId)
  }

  const afterScrape = scraping.payload
  const itemIdByExternal = await persistCorpus(workspaceId, run.id, afterScrape)

  // Record the scraped keywords, hashtags and topics into the Knowledge Base on
  // every scrape — as `origin='learned'`, category 'Signals', citing the pages
  // that carried them. Distinct from the human-vetted research layer, so it can
  // be filtered or switched off without touching curated findings. Failure here
  // is non-fatal: a signal we could not record must never fail a capture we did.
  try {
    const signals = (afterScrape.posts ?? [])
      .filter((p) => !p.isDuplicate && p.keyword)
      .map((p) => ({
        keyword: p.keyword,
        topics: p.alignedTopics ?? [],
        hashtags: p.hashtags ?? [],
        title: p.title,
        url: p.url,
        ...(p.postedAt ? { publishedAt: p.postedAt } : {}),
        brandRelevance: p.brandRelevance ?? 0,
      }))
    const recorded = await recordScrapedTopicsAsKnowledge(workspaceId, signals)
    if (recorded.written > 0 || recorded.merged > 0) {
      await insertActivity({
        workspaceId,
        agentId: 'scraping',
        message: `Scrape signals recorded to Knowledge Base · ${recorded.written} new, ${recorded.merged} merged`,
        status: 'ok',
      })
    }
  } catch (err) {
    await insertActivity({
      workspaceId,
      agentId: 'scraping',
      message: `Could not record scrape signals to Knowledge Base: ${err instanceof Error ? err.message : String(err)}`,
      status: 'error',
    })
  }

  /* ── ② Validation ───────────────────────────────────────────────────────── */
  const validation = await runAgent<PipelinePayload>('validation', afterScrape, {
    ...shared,
    currentTask: 'Scoring candidates',
    inputCount: afterScrape.posts?.length ?? 0,
  })

  if (validation.status === 'failed') {
    return failRun(run.id, validation.error ?? `${AGENT_BY_ID.validation.name} failed.`, emptySummary(), turnId)
  }

  const afterValidation = validation.payload
  const { hashtagIdByTag } = await persistVerdicts(workspaceId, run.id, afterValidation, itemIdByExternal)
  await persistKeywordSignals(workspaceId, run.id, afterValidation)
  await materialiseReviewQueue(workspaceId, afterValidation, itemIdByExternal, hashtagIdByTag)

  /* ── ③ Analysis ─────────────────────────────────────────────────────────── */
  const analysis = await runAgent<PipelinePayload>('analysis', afterValidation, {
    ...shared,
    currentTask: 'Clustering opportunities',
    inputCount: afterValidation.posts?.filter((p) => p.validation === 'validated').length ?? 0,
  })

  if (analysis.status === 'failed') {
    return failRun(run.id, analysis.error ?? 'The Analysis Agent failed.', emptySummary(), turnId)
  }

  const afterAnalysis = analysis.payload
  const topSet = await replaceTopHashtagSet(
    workspaceId,
    (afterAnalysis.topHashtags ?? [])
      .map((h) => hashtagIdByTag.get(h.tag))
      .filter((id): id is string => typeof id === 'string'),
  )

  if (!topSet.replaced) {
    // The run consolidated nothing, so the previous generation still stands.
    // Said out loud, because an operator looking at an unchanged hashtag set
    // after a run needs to know it is the old one rather than a new one that
    // happens to match.
    await insertActivity({
      workspaceId,
      agentId: 'analysis',
      message:
        topSet.size === 0
          ? 'No hashtags could be consolidated this run, and there was no previous top set to keep.'
          : `No hashtags could be consolidated this run — the previous top set of ${topSet.size} is unchanged, not cleared.`,
      status: 'warn',
    })
  }

  /* ── ④ Calendar ─────────────────────────────────────────────────────────── */
  const calendar = await runAgent<PipelinePayload>('calendar', afterAnalysis, {
    ...shared,
    currentTask: 'Placing ideas',
    inputCount: afterAnalysis.opportunities?.length ?? 0,
  })

  if (calendar.status === 'failed') {
    return failRun(run.id, calendar.error ?? `${AGENT_BY_ID.calendar.name} failed.`, emptySummary(), turnId)
  }

  const final = calendar.payload
  const persistedIdeas = await persistPlannedIdeas(
    workspaceId,
    final,
    itemIdByExternal,
    hashtagIdByTag,
    turnId,
  )

  /* ── ⑤ Write what took a slot ────────────────────────────────────────────
   *
   * THE STAGE THAT MAKES THE CALENDAR APPEAR.
   *
   * The grid deliberately renders only posts that have actually been written —
   * `calendar_slot === 'primary' && status !== 'suggested'` — because a placed
   * but unwritten idea sitting beside a finished post looks equally ready to
   * publish, and once twenty-one of twenty-nine cards were in that state.
   *
   * Nothing, however, closed the gap. Planning ended at `calendar`, and drafting
   * was a per-card action an operator had to find, so a complete and correct run
   * left a calendar that rendered empty. Three agents looked broken — calendar,
   * caption, image — for one missing hand-off.
   *
   * So the pipeline now walks the graph one stage further and hands each newly
   * placed post to the Content and Image Agents. Bounded by a declared knob,
   * because each post is two model calls; a failure is reported per post and
   * never fails the run, because a written calendar with four of five posts is
   * worth more than a failed pipeline.
   */
  const rankConfig = await resolveSkillConfig(workspaceId, 'calendar.rank.select')
  const autoWrite = rankConfig.autoWriteCalendar !== false
  const maxWrites = Math.max(0, Number(rankConfig.maxAutoWrites ?? 5))

  let written = 0
  let writeFailed = 0

  if (autoWrite && maxWrites > 0) {
    const onCalendar = await listIdeas(workspaceId, { limit: 400 })
    const pending = onCalendar
      .filter((row) => row.calendar_slot === 'primary')
      .filter((row) => row.status === 'suggested')
      .sort((a, b) => Number(b.priority_score ?? 0) - Number(a.priority_score ?? 0))

    const queue: IdeaRow[] = []
    for (const row of pending) {
      if (queue.length >= maxWrites) break
      // Already written by an earlier run or by hand — nothing to redo.
      const existing = await getDraft(row.id, row.platform as Platform)
      if (existing) continue
      queue.push(row)
    }

    if (queue.length > 0) {
      await insertActivity({
        workspaceId,
        agentId: 'caption',
        message: `Writing ${queue.length} post(s) that took a calendar slot`,
        status: 'running',
      })
    }

    for (const row of queue) {
      try {
        await generateDraft({
          workspaceId,
          trigger,
          turnId,
          paceMs,
          configOverrides,
          ideaId: row.id,
          platform: row.platform as Platform,
          // One call covers both agents, so a card never appears written but
          // unillustrated.
          withImage: true,
        })
        written += 1
      } catch (error) {
        writeFailed += 1
        const message = error instanceof Error ? error.message : String(error)
        // Named per post. A caption that could not be written is a fact about
        // that post, not about the run.
        await insertActivity({
          workspaceId,
          agentId: 'caption',
          message: `Could not write “${row.title.slice(0, 60)}” — ${message}`,
          status: 'error',
        })
      }
    }

    if (written > 0 || writeFailed > 0) {
      await insertActivity({
        workspaceId,
        agentId: 'image',
        message:
          `${written} post(s) written and illustrated, now on the calendar` +
          (writeFailed > 0 ? ` · ${writeFailed} could not be written and keep their slot unwritten` : ''),
        status: writeFailed > 0 ? 'warn' : 'ok',
      })
    }
  }

  /* ── Finish ─────────────────────────────────────────────────────────────── */
  const buckets = final.buckets ?? { validated: 0, needs_review: 0, duplicate: 0, rejected: 0 }
  const ideas = final.ideas ?? []

  const summary: PipelineSummary = {
    keywordsScanned: final.keywords?.length ?? 0,
    postsScraped: final.posts?.length ?? 0,
    hashtagsFound: final.hashtagCandidates?.length ?? 0,
    trending: final.trendingKeywords?.length ?? 0,
    validated: buckets.validated,
    needsReview: buckets.needs_review,
    duplicate: buckets.duplicate,
    rejected: buckets.rejected,
    topHashtags: final.topHashtags?.length ?? 0,
    opportunities: final.opportunities?.length ?? 0,
    ideas: ideas.length,
    primaryIdeas: ideas.filter((i) => i.calendarSlot === 'primary').length,
    suggestionIdeas: ideas.filter((i) => i.calendarSlot === 'suggestion').length,
    source: final.captureSource ?? 'fixture',
    fallbackReasons: final.captureFallbackReasons ?? [],
    written,
    writeFailed,
  }

  await finishPipelineRun(run.id, 'completed', summary as unknown as Record<string, unknown>)
  publish({
    type: 'pipeline.finished',
    runId: run.id,
    ...(turnId === null ? {} : { turnId }),
    message: `Pipeline complete · ${summary.trending} trending keywords, ${summary.topHashtags} hashtags, ${summary.ideas} ideas`,
    data: summary as unknown as Record<string, unknown>,
  })
  await insertActivity({
    workspaceId,
    agentId: 'calendar',
    message: `Discovery complete · ${summary.trending} trending keywords, top ${summary.topHashtags} hashtags, ${summary.primaryIdeas} ideas on the calendar`,
    status: summary.needsReview > 0 ? 'warn' : 'ok',
  })

  return {
    pipelineRunId: run.id,
    status: 'completed',
    summary,
    trendingKeywords: (final.trendingKeywords ?? []).map((t) => ({
      term: t.term,
      trendScore: t.trendScore,
      rank: t.rank,
      reason: t.trendReason,
    })),
    topHashtags: (final.topHashtags ?? []).map((h) => ({
      tag: h.displayTag,
      rank: h.rank ?? 0,
      score: h.hashtagScore,
    })),
    ideas: persistedIdeas,
  }
}

function emptySummary(): PipelineSummary {
  return {
    keywordsScanned: 0,
    postsScraped: 0,
    hashtagsFound: 0,
    trending: 0,
    validated: 0,
    needsReview: 0,
    duplicate: 0,
    rejected: 0,
    topHashtags: 0,
    opportunities: 0,
    ideas: 0,
    primaryIdeas: 0,
    suggestionIdeas: 0,
    source: 'fixture',
    fallbackReasons: [],
    written: 0,
    writeFailed: 0,
  }
}

async function failRun(
  runId: string,
  error: string,
  summary: PipelineSummary,
  turnId: string | null,
): Promise<PipelineResult> {
  await finishPipelineRun(runId, 'failed', { error, ...summary })
  publish({
    type: 'pipeline.finished',
    runId,
    ...(turnId === null ? {} : { turnId }),
    message: `Pipeline failed — ${error}`,
    data: { error, status: 'failed' },
  })
  return { pipelineRunId: runId, status: 'failed', summary, trendingKeywords: [], topHashtags: [], ideas: [], error }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PERSISTENCE STEPS
   ═══════════════════════════════════════════════════════════════════════════ */

async function persistCorpus(
  workspaceId: string,
  runId: string,
  payload: PipelinePayload,
): Promise<Map<string, string>> {
  const posts = payload.posts ?? []
  if (posts.length === 0) return new Map()

  const idByExternal = await persistScrapedItems(
    workspaceId,
    runId,
    posts.map((p) => ({
      keywordId: p.keywordId,
      externalId: p.externalId,
      title: p.title,
      snippet: p.snippet,
      url: p.url,
      sourceName: p.sourceName,
      sourceType: p.sourceType,
      authorName: p.authorName,
      authorHeadline: p.authorHeadline,
      authorFollowers: p.authorFollowers,
      hashtags: p.hashtags,
      engagement: p.engagement,
      reactions: p.reactions,
      comments: p.comments,
      reposts: p.reposts,
      relevance: p.relevance,
      credibility: p.credibility,
      freshness: p.freshness,
      isDuplicate: p.isDuplicate,
      validation: p.validation,
      verdictReason: p.verdictReason,
      captureSource: p.captureSource,
      platform: p.platform,
      metricsAvailable: p.metricsAvailable,
      brandRelevance: p.brandRelevance,
      postedAt: p.postedAt,
    })),
  )

  // Lineage: keyword → scraped_item, so a post can be traced back to what found it.
  for (const post of posts) {
    const itemId = idByExternal.get(post.externalId)
    if (!itemId || !post.keywordId) continue
    await insertLineage({
      workspaceId,
      fromType: 'keyword',
      fromId: post.keywordId,
      toType: 'scraped_item',
      toId: itemId,
      agentId: 'scraping',
    })
  }

  return idByExternal
}

async function persistVerdicts(
  workspaceId: string,
  runId: string,
  payload: PipelinePayload,
  itemIdByExternal: Map<string, string>,
): Promise<{ hashtagIdByTag: Map<string, string> }> {
  // The corpus is re-written with its verdicts now attached.
  await persistCorpus(workspaceId, runId, payload)

  // Duplicates are LINKED, never deleted.
  for (const post of payload.posts ?? []) {
    if (!post.isDuplicate || !post.duplicateOfExternalId) continue
    const id = itemIdByExternal.get(post.externalId)
    const originalId = itemIdByExternal.get(post.duplicateOfExternalId)
    if (id && originalId && id !== originalId) await linkDuplicateItem(id, originalId)
  }

  const candidates = payload.hashtagCandidates ?? []
  const hashtagIdByTag = await persistHashtagCandidates(
    workspaceId,
    runId,
    candidates.map((c) => ({
      tag: c.tag,
      displayTag: c.displayTag,
      keywordId: c.keywordId,
      postCount: c.postCount,
      totalEngagement: c.totalEngagement,
      engagementPerPost: c.engagementPerPost,
      brandRelevance: c.brandRelevance,
      platforms: c.platforms,
      relevance: c.relevance,
      credibility: c.credibility,
      freshness: c.freshness,
      hashtagScore: c.hashtagScore,
      rank: c.rank,
      validation: c.validation,
      verdictReason: c.verdictReason,
      inTopSet: c.inTopSet,
      firstSeenAt: c.firstSeenAt,
      lastSeenAt: c.lastSeenAt,
      feedUrl: c.feedUrl,
      topPostUrl: c.topPostUrl,
      topPostTitle: c.topPostTitle,
    })),
  )

  for (const candidate of candidates) {
    if (!candidate.duplicateOfTag) continue
    const id = hashtagIdByTag.get(candidate.tag)
    const originalId = hashtagIdByTag.get(candidate.duplicateOfTag)
    if (id && originalId && id !== originalId) await linkDuplicateHashtag(id, originalId)
  }

  // Lineage: keyword → hashtag.
  for (const candidate of candidates) {
    const id = hashtagIdByTag.get(candidate.tag)
    if (!id || !candidate.keywordId) continue
    await insertLineage({
      workspaceId,
      fromType: 'keyword',
      fromId: candidate.keywordId,
      toType: 'hashtag',
      toId: id,
      agentId: 'validation',
    })
  }

  return { hashtagIdByTag }
}

async function persistKeywordSignals(
  workspaceId: string,
  runId: string,
  payload: PipelinePayload,
): Promise<void> {
  for (const trend of payload.trends ?? []) {
    await insertKeywordSignal(workspaceId, {
      keywordId: trend.keywordId,
      runId,
      postCount: trend.postCount,
      totalEngagement: trend.totalEngagement,
      avgEngagement: trend.avgEngagement,
      velocity: trend.velocity,
      growthPct: trend.growthPct,
      trendScore: trend.trendScore,
      rank: trend.rank,
      isTrending: trend.isTrending,
      trendReason: trend.trendReason,
      searchUrl: trend.searchUrl,
      topPostUrl: trend.topPostUrl,
      topPostTitle: trend.topPostTitle,
    })
  }
}

async function materialiseReviewQueue(
  workspaceId: string,
  payload: PipelinePayload,
  itemIdByExternal: Map<string, string>,
  hashtagIdByTag: Map<string, string>,
): Promise<void> {
  for (const request of payload.reviewRequests ?? []) {
    const entityId =
      request.kind === 'scraped_item'
        ? itemIdByExternal.get(request.reference)
        : hashtagIdByTag.get(request.reference)
    if (!entityId) continue

    await insertReviewQueueRow({
      workspaceId,
      kind: request.kind,
      entityId,
      reason: request.reason,
      decisionRequested: request.decisionRequested,
      options: request.options,
    })
  }

  const count = payload.reviewRequests?.length ?? 0
  if (count > 0) {
    await setAgentState(workspaceId, 'validation', {
      status: 'needs_review',
      currentTask: `${count} item(s) awaiting a verdict`,
    })
  }
}

async function persistPlannedIdeas(
  workspaceId: string,
  payload: PipelinePayload,
  itemIdByExternal: Map<string, string>,
  hashtagIdByTag: Map<string, string>,
  turnId: string | null,
): Promise<Array<{ id: string; title: string; platform: Platform; slot: CalendarSlot; rank: number | null }>> {
  const ideas = payload.ideas ?? []
  if (ideas.length === 0) return []

  const written = await persistIdeas(
    workspaceId,
    ideas.map((idea) => ({
      sourceItemId: idea.sourceExternalId ? itemIdByExternal.get(idea.sourceExternalId) ?? null : null,
      hashtagId: idea.hashtag ? hashtagIdByTag.get(idea.hashtag.toLowerCase()) ?? null : null,
      title: idea.title,
      description: idea.description,
      sourceTopic: idea.sourceTopic,
      platform: idea.platform,
      altPlatforms: idea.altPlatforms,
      scheduledDate: idea.scheduledDate,
      scheduledTime: idea.scheduledTime,
      confidence: idea.confidence,
      priorityScore: idea.priorityScore,
      platformRank: idea.platformRank,
      calendarSlot: idea.calendarSlot,
      status: 'suggested' as IdeaStatus,
      analysis: {
        format: idea.format,
        angle: idea.angle,
        audience: idea.audience,
        brandRelevance: idea.brandRelevance,
        trendScore: idea.trendScore,
        slotReasons: idea.slotReasons,
        conflicts: idea.conflicts,
        ...(idea.variantOf ? { variantOf: idea.variantOf } : {}),
      },
      isNewTrend: idea.isNewTrend,
    })),
  )

  const out: Array<{ id: string; title: string; platform: Platform; slot: CalendarSlot; rank: number | null }> = []

  for (let i = 0; i < written.length; i += 1) {
    const record = written[i]
    const planned = ideas[i]
    if (!record || !planned) continue

    out.push({
      id: record.id,
      title: record.title,
      platform: planned.platform,
      slot: planned.calendarSlot,
      rank: planned.platformRank,
    })

    if (planned.sourceExternalId) {
      const sourceId = itemIdByExternal.get(planned.sourceExternalId)
      if (sourceId) {
        await insertLineage({
          workspaceId,
          fromType: 'scraped_item',
          fromId: sourceId,
          toType: 'content_idea',
          toId: record.id,
          agentId: 'calendar',
        })
      }
    }

    if (turnId) {
      await insertLineage({
        workspaceId,
        fromType: 'assistant_turn',
        fromId: turnId,
        toType: 'content_idea',
        toId: record.id,
        agentId: 'assistant',
      })
    }
  }

  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE KNOWLEDGE BUILD
   ═══════════════════════════════════════════════════════════════════════════ */

export interface KnowledgeBuildResult {
  buildId: string
  status: 'completed' | 'failed'
  hashtagsResearched: number
  entriesWritten: number
  entriesMerged: number
  sourcesCited: number
  researchSource: 'live' | 'fixture'
  fallbackReason?: string
  discarded: Array<{ title: string; reason: string }>
  error?: string
}

export async function buildKnowledge(
  ctx: OrchestratorContext & { hashtagCount?: number; forceRefresh?: boolean },
): Promise<KnowledgeBuildResult> {
  const { workspaceId, turnId = null, paceMs = 0 } = ctx
  const trigger: 'cron' | 'manual' | 'assistant' =
    ctx.trigger === 'cron' ? 'cron' : ctx.trigger === 'assistant' ? 'assistant' : 'manual'

  const build = await startKnowledgeBuild(workspaceId, trigger)
  if (!build) throw new Error('Could not open a knowledge build.')

  publish({
    type: 'knowledge.build.started',
    agentId: 'knowledge',
    ...(turnId === null ? {} : { turnId }),
    message: 'Knowledge build started',
    data: { buildId: build.id, trigger },
  })

  const overrides: Record<string, Record<string, unknown>> = { ...(ctx.configOverrides ?? {}) }
  if (ctx.hashtagCount !== undefined || ctx.forceRefresh !== undefined) {
    overrides['knowledge.hashtag.select'] = {
      ...(overrides['knowledge.hashtag.select'] ?? {}),
      ...(ctx.hashtagCount === undefined ? {} : { hashtagCount: ctx.hashtagCount }),
      ...(ctx.forceRefresh === undefined ? {} : { forceRefresh: ctx.forceRefresh }),
    }
  }

  const result = await runAgent<KnowledgePayload>(
    'knowledge',
    { buildId: build.id, trigger },
    {
      workspaceId,
      trigger: ctx.trigger,
      turnId,
      paceMs,
      configOverrides: overrides,
      currentTask: 'Researching the top hashtags',
    },
  )

  const payload = result.payload
  const researchSource = payload.researchSource ?? 'fixture'

  const out: KnowledgeBuildResult = {
    buildId: build.id,
    status: result.status,
    hashtagsResearched: payload.targets?.length ?? 0,
    entriesWritten: payload.written?.length ?? 0,
    entriesMerged: payload.merged?.length ?? 0,
    sourcesCited: payload.sourcesCited ?? 0,
    researchSource,
    ...(payload.researchFallbackReason === undefined
      ? {}
      : { fallbackReason: payload.researchFallbackReason }),
    discarded: payload.discarded ?? [],
    ...(result.error === undefined ? {} : { error: result.error }),
  }

  await finishKnowledgeBuild(build.id, {
    status: result.status,
    hashtagsResearched: out.hashtagsResearched,
    entriesWritten: out.entriesWritten,
    entriesMerged: out.entriesMerged,
    sourcesCited: out.sourcesCited,
    researchSource,
    summary: {
      discarded: out.discarded.length,
      conflicts: payload.conflicts?.length ?? 0,
      escalations: payload.escalations ?? 0,
      ...(out.fallbackReason ? { fallbackReason: out.fallbackReason } : {}),
    },
    ...(result.error === undefined ? {} : { error: result.error }),
  })

  publish({
    type: 'knowledge.build.finished',
    agentId: 'knowledge',
    ...(turnId === null ? {} : { turnId }),
    message: `Knowledge build ${result.status} · ${out.entriesWritten} written, ${out.entriesMerged} merged, ${out.sourcesCited} sources cited`,
    data: out as unknown as Record<string, unknown>,
  })
  await insertActivity({
    workspaceId,
    agentId: 'knowledge',
    message: `Knowledge build ${result.status} · ${out.entriesWritten} entries from ${out.hashtagsResearched} hashtags (${researchSource})`,
    status: result.status === 'completed' ? 'ok' : 'error',
  })

  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   DRAFT AND CREATIVE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface DraftResult {
  ideaId: string
  platform: Platform
  body: string
  revision: number
  source: 'live' | 'fixture'
  model: string
  fallbackReason?: string
  grounding: Array<{ title: string; confidence: string }>
  media: MediaResult | null
  skills: Array<{ skillId: string; name: string; status: string; durationMs: number }>
}

export interface MediaResult {
  dataUri: string
  model: string
  renderMode: 'demo' | 'live'
  concept: string
  canvas: string
  width: number
  height: number
  altText: string
  fallbackReason: string | null
  findings: string[]
}

/**
 * Caption → image, with the whole caption payload passed into the image agent so
 * the creative is drawn from what actually shipped rather than from the title.
 */
export async function generateDraft(
  ctx: OrchestratorContext & { ideaId: string; platform?: Platform; withImage?: boolean },
): Promise<DraftResult> {
  const { workspaceId, turnId = null } = ctx
  const idea = await getIdea(workspaceId, ctx.ideaId)
  if (!idea) throw new Error('No such idea.')

  const platform = ctx.platform ?? idea.platform
  const analysis = idea.analysis as Record<string, unknown>

  const caption = await runAgent<CaptionPayload>(
    'caption',
    {
      ideaId: idea.id,
      platform,
      title: idea.title,
      description: idea.description ?? '',
      sourceTopic: idea.source_topic ?? idea.title,
      hashtag: idea.hashtag_display,
      angle: typeof analysis.angle === 'string' ? analysis.angle : 'Explain the mechanism behind the result',
      audience: typeof analysis.audience === 'string' ? analysis.audience : 'ML engineers and research leads',
      format: typeof analysis.format === 'string' ? analysis.format : 'Thought Leadership',
    },
    {
      workspaceId,
      trigger: ctx.trigger,
      turnId,
      paceMs: ctx.paceMs ?? 0,
      configOverrides: ctx.configOverrides ?? {},
      currentTask: `Writing the ${PLATFORM_LABEL[platform]} caption`,
      inputCount: 1,
    },
  )

  if (caption.status === 'failed') {
    throw new Error(caption.error ?? 'The Caption Agent failed.')
  }

  const payload = caption.payload
  const body = payload.caption ?? payload.captionBody ?? idea.description ?? idea.title

  /*
   * THE CARD TAKES OUR OWN LINE, NOT THE SOURCE'S.
   *
   * `analysis.trend.cluster` titles an opportunity with `headlineFrom(seed.text)`
   * — the first line of the scraped post that surfaced the topic. That is the
   * right thing for a piece of evidence and the wrong thing for a card: the
   * calendar showed other people's headlines as our subjects, including news
   * copy like "NPCI is stepping up its AI and digital banking push at GFF 2026".
   *
   * The hook is the first line of the post we actually wrote, brand-enforced and
   * ours. Once it exists it is the honest title for the card.
   *
   * Only while the idea is still in planning. From `in_review` onward a person
   * has read the title that was in front of them, and changing it underneath them
   * would misrepresent what they reviewed.
   */
  const hook = (payload.hook ?? '').trim()
  const retitleable = idea.status === 'suggested' || idea.status === 'drafted'
  if (hook !== '' && retitleable && hook !== idea.title) {
    await updateIdea(workspaceId, idea.id, { title: hook })
    await insertActivity({
      workspaceId,
      agentId: 'caption',
      message: `Card retitled to the post's own first line: “${hook.slice(0, 70)}”`,
      status: 'ok',
    })
  }

  const draft = await upsertDraft({
    ideaId: idea.id,
    platform,
    body,
    generatedBy: 'caption',
    model: payload.captionModel ?? 'ethara-template-writer',
    source: payload.captionSource ?? 'fixture',
  })

  await insertLineage({
    workspaceId,
    fromType: 'content_idea',
    fromId: idea.id,
    toType: 'draft',
    toId: draft?.id ?? idea.id,
    agentId: 'caption',
  })

  if (idea.status === 'suggested') {
    await updateIdea(workspaceId, idea.id, { status: 'drafted' })
  }

  publish({
    type: 'draft.generated',
    agentId: 'caption',
    ...(turnId === null ? {} : { turnId }),
    message: `Draft written for “${idea.title}”`,
    data: { ideaId: idea.id, platform, revision: draft?.revision ?? 1, source: payload.captionSource },
  })

  const media =
    ctx.withImage === false
      ? null
      : await renderIdeaImage({ ...ctx, ideaId: idea.id, platform, captionBody: body })

  return {
    ideaId: idea.id,
    platform,
    body,
    revision: draft?.revision ?? 1,
    source: payload.captionSource ?? 'fixture',
    model: payload.captionModel ?? 'ethara-template-writer',
    ...(payload.captionFallbackReason === undefined
      ? {}
      : { fallbackReason: payload.captionFallbackReason }),
    grounding: (payload.grounding ?? []).map((g) => ({ title: g.title, confidence: g.confidence })),
    media,
    skills: caption.skills.map((s) => ({
      skillId: s.skillId,
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
    })),
  }
}

export async function renderIdeaImage(
  ctx: OrchestratorContext & {
    ideaId: string
    platform: Platform
    captionBody?: string
    model?: ImageModelId
    prompt?: string
    instruction?: string
  },
): Promise<MediaResult> {
  const { workspaceId, turnId = null } = ctx
  const idea = await getIdea(workspaceId, ctx.ideaId)
  if (!idea) throw new Error('No such idea.')

  const existingDraft = ctx.captionBody ?? (await getDraft(idea.id, ctx.platform))?.body ?? idea.description ?? idea.title

  const overrides: Record<string, Record<string, unknown>> = { ...(ctx.configOverrides ?? {}) }
  if (ctx.model) {
    overrides['generation.image.render'] = {
      ...(overrides['generation.image.render'] ?? {}),
      model: ctx.model,
    }
  }

  // An instruction on the creative is a token adjustment, not a re-prompt of the
  // brand layer: the operator's words steer the palette and the depth.
  if (ctx.instruction) {
    const lower = ctx.instruction.toLowerCase()
    const tokens: Record<string, unknown> = {}
    if (/bright|light/.test(lower)) tokens.paletteRole = 'Light'
    if (/dark|deep/.test(lower)) tokens.paletteRole = 'Deep'
    if (/accent|violet|purple/.test(lower)) tokens.accentIntensity = 92
    if (/simple|clean|minimal/.test(lower)) {
      overrides['generation.image.template'] = {
        ...(overrides['generation.image.template'] ?? {}),
        layout: 'Minimal',
      }
    }
    if (/depth|dimension|3d/.test(lower)) {
      overrides['generation.image.approach'] = {
        ...(overrides['generation.image.approach'] ?? {}),
        concept: 'reward-surface',
      }
    }
    if (Object.keys(tokens).length > 0) {
      overrides['generation.image.tokens'] = {
        ...(overrides['generation.image.tokens'] ?? {}),
        ...tokens,
      }
    }
  }

  const result = await runAgent<ImagePayload>(
    'image',
    {
      ideaId: idea.id,
      platform: ctx.platform,
      title: idea.title,
      caption: existingDraft,
      sourceTopic: idea.source_topic ?? idea.title,
      ...(ctx.prompt ? { backgroundPrompt: ctx.prompt } : {}),
    },
    {
      workspaceId,
      trigger: ctx.trigger,
      turnId,
      paceMs: ctx.paceMs ?? 0,
      configOverrides: overrides,
      currentTask: `Rendering the ${PLATFORM_LABEL[ctx.platform]} creative`,
      inputCount: 1,
    },
  )

  if (result.status === 'failed') throw new Error(result.error ?? `${AGENT_BY_ID.image.name} failed.`)

  const payload = result.payload
  const canvas = canvasFor(ctx.platform)

  const asset = await upsertMediaAsset({
    ideaId: idea.id,
    platform: ctx.platform,
    concept: payload.concept ?? 'gradient-field',
    canvas: payload.canvas ?? canvasKey(ctx.platform),
    width: payload.width ?? canvas.width,
    height: payload.height ?? canvas.height,
    altText: payload.altText ?? '',
    renderMode: payload.renderMode ?? 'demo',
    model: payload.model ?? 'brand-svg',
    prompt: payload.backgroundPrompt ?? '',
    fallbackReason: payload.fallbackReason ?? null,
    dataUri: payload.dataUri ?? '',
  })

  await insertLineage({
    workspaceId,
    fromType: 'content_idea',
    fromId: idea.id,
    toType: 'media_asset',
    toId: asset?.id ?? idea.id,
    agentId: 'image',
  })

  return {
    dataUri: payload.dataUri ?? '',
    model: payload.model ?? 'brand-svg',
    renderMode: payload.renderMode ?? 'demo',
    concept: payload.concept ?? 'gradient-field',
    canvas: payload.canvas ?? canvasKey(ctx.platform),
    width: payload.width ?? canvas.width,
    height: payload.height ?? canvas.height,
    altText: payload.altText ?? '',
    fallbackReason: payload.fallbackReason ?? null,
    findings: payload.visualFindings ?? [],
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE HUMAN INSTRUCTION
   ═══════════════════════════════════════════════════════════════════════════ */

export interface InstructionResult {
  ideaId: string
  platform: Platform
  /** Mirrors the client's Draft: dropping model/source rendered "Revision 4 · undefined · undefined". */
  draft: { body: string; revision: number; model: string; source: 'live' | 'fixture' }
  /** False when the instruction produced no change; the panel must not report an edit. */
  applied: boolean
  note: string
  conflicts: string[]
  compliance: ReviewPayload['compliance']
  preference: ReviewPayload['preference']
  diffSummary: string
  skills: Array<{ skillId: string; name: string; status: string; durationMs: number }>
}

export async function applyInstruction(
  ctx: OrchestratorContext & {
    ideaId: string
    platform: Platform
    instruction: string
    /** The caption model the operator chose in the review panel. */
    captionModel?: string
    /** Files the operator attached for the model to work from. */
    references?: Array<{ name: string; mimeType: string; text?: string; note?: string }>
  },
): Promise<InstructionResult> {
  const { workspaceId, turnId = null } = ctx
  const idea = await getIdea(workspaceId, ctx.ideaId)
  if (!idea) throw new Error('No such idea.')

  const draft = await getDraft(idea.id, ctx.platform)
  if (!draft) throw new Error('There is no draft on that post yet. I can write one first.')

  const asset = await getMediaAsset(idea.id, ctx.platform)

  const result = await runAgent<ReviewPayload>(
    'review',
    {
      ideaId: idea.id,
      platform: ctx.platform,
      title: idea.title,
      sourceTopic: idea.source_topic ?? idea.title,
      body: draft.body,
      instruction: ctx.instruction,
      hasImage: asset !== null,
      ...(ctx.captionModel === undefined ? {} : { captionModel: ctx.captionModel }),
      ...(ctx.references === undefined || ctx.references.length === 0
        ? {}
        : { references: ctx.references }),
      ...(asset?.alt_text ? { altText: asset.alt_text } : {}),
      ...(asset?.canvas ? { canvas: asset.canvas } : {}),
    },
    {
      workspaceId,
      trigger: ctx.trigger,
      turnId,
      paceMs: ctx.paceMs ?? 0,
      configOverrides: ctx.configOverrides ?? {},
      currentTask: 'Applying the instruction',
      inputCount: 1,
    },
  )

  if (result.status === 'failed') throw new Error(result.error ?? 'The Review Agent failed.')

  const payload = result.payload
  const body = payload.revisedBody ?? draft.body
  // Nothing changed means nothing to version. Bumping the revision on a no-op
  // makes the panel read "Revision 5" over the same text the operator just saw.
  const changed = payload.revisionApplied !== false && body.trim() !== draft.body.trim()

  const saved = changed
    ? await upsertDraft({
        ideaId: idea.id,
        platform: ctx.platform,
        body,
        generatedBy: 'review',
        model: payload.revisionModel ?? 'ethara-template-writer',
        source: payload.revisionSource ?? 'fixture',
      })
    : null

  // The ask is recorded either way — law 4, nothing is ever deleted, and an
  // instruction that could not be carried out is part of the post's history.
  await appendIdeaFeedback(workspaceId, idea.id, {
    instruction: ctx.instruction,
    note: payload.appliedNote ?? '',
    platform: ctx.platform,
    revision: saved?.revision ?? draft.revision,
  })

  if (changed && (idea.status === 'suggested' || idea.status === 'drafted')) {
    await updateIdea(workspaceId, idea.id, { status: 'in_review' })
  }

  await insertActivity({
    workspaceId,
    agentId: 'review',
    message: changed
      ? `“${idea.title}” revised — ${payload.appliedNote ?? ctx.instruction}`
      : `“${idea.title}” unchanged — ${payload.appliedNote ?? ctx.instruction}`,
    status: !changed || (payload.conflictNotes?.length ?? 0) > 0 ? 'warn' : 'ok',
  })

  return {
    ideaId: idea.id,
    platform: ctx.platform,
    draft: {
      body,
      revision: saved?.revision ?? draft.revision,
      // `model` is nullable on the row; the client's Draft is not.
      model: saved?.model ?? draft.model ?? 'ethara-template-writer',
      source: saved?.source ?? draft.source,
    },
    applied: changed,
    note: payload.appliedNote ?? '',
    conflicts: payload.conflictNotes ?? [],
    compliance: payload.compliance,
    preference: payload.preference ?? null,
    diffSummary: payload.diffSummary ?? '',
    skills: result.skills.map((s) => ({
      skillId: s.skillId,
      name: s.name,
      status: s.status,
      durationMs: s.durationMs,
    })),
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   APPROVAL — TWO STAGES, NO OFF SWITCH
   ═══════════════════════════════════════════════════════════════════════════ */

export async function approveMarketing(
  ctx: OrchestratorContext & { ideaId: string; by: string },
): Promise<IdeaRow> {
  const idea = await getIdea(ctx.workspaceId, ctx.ideaId)
  if (!idea) throw new Error('No such idea.')

  const updated = await setMarketingApproval(ctx.workspaceId, idea.id, ctx.by)
  if (!updated) throw new Error('The approval could not be recorded.')

  await insertActivity({
    workspaceId: ctx.workspaceId,
    agentId: 'review',
    message: `“${idea.title}” approved by ${ctx.by} and sent to Leadership`,
    status: 'ok',
  })
  publishActivity('review', `“${idea.title}” is with Leadership`, 'warn', { ideaId: idea.id })

  return updated
}

export async function decideLeadership(
  ctx: OrchestratorContext & {
    ideaId: string
    decision: 'approved' | 'rejected'
    by: string
    reason?: string
    publish?: boolean
  },
): Promise<{ idea: IdeaRow; published: PublishResult | null }> {
  const idea = await getIdea(ctx.workspaceId, ctx.ideaId)
  if (!idea) throw new Error('No such idea.')

  if (idea.status !== 'pending_leadership' && ctx.decision === 'approved') {
    throw new Error(
      `“${idea.title}” has not been approved by Marketing yet. Nothing publishes without both signatures.`,
    )
  }

  const reason =
    ctx.reason ??
    (ctx.decision === 'approved'
      ? 'Approved as submitted.'
      : '')

  if (ctx.decision === 'rejected' && reason.trim().length === 0) {
    throw new Error('A rejection needs a reason — it is what the agents learn from.')
  }

  const updated = await setLeadershipDecision(
    ctx.workspaceId,
    idea.id,
    ctx.decision,
    ctx.by,
    reason,
  )
  if (!updated) throw new Error('The decision could not be recorded.')

  // Both outcomes are written to the Knowledge Base. A rejection teaches as much
  // as an approval, and the Learning Agent reads both.
  await insertKnowledgeEntry({
    workspaceId: ctx.workspaceId,
    title: `${ctx.decision === 'approved' ? 'Approved' : 'Rejected'}: ${idea.title}`,
    category: ctx.decision === 'approved' ? 'Approved Post' : 'Rejected Post',
    content: `${PLATFORM_LABEL[idea.platform]} post on ${idea.source_topic ?? idea.title}. ${ctx.by} ${ctx.decision === 'approved' ? 'approved' : 'rejected'} it: ${reason}`,
    source: 'Leadership decision',
    sources: [],
    hashtagId: idea.hashtag_id,
    confidence: 'High',
    origin: 'learned',
    buildId: null,
    tags: [ctx.decision],
  })

  await insertActivity({
    workspaceId: ctx.workspaceId,
    agentId: ctx.decision === 'approved' ? 'publishing' : 'review',
    message: `“${idea.title}” ${ctx.decision} by ${ctx.by} — ${reason}`,
    status: ctx.decision === 'approved' ? 'ok' : 'warn',
  })

  let published: PublishResult | null = null
  if (ctx.decision === 'approved' && ctx.publish !== false) {
    published = await publishIdea({ ...ctx, ideaId: idea.id })
  }

  const finalIdea = (await getIdea(ctx.workspaceId, idea.id)) ?? updated
  return { idea: finalIdea, published }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLISH — THE IRREVERSIBLE ACT, THEN ANALYTICS AND LEARNING
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PublishResult {
  postId: string
  externalId: string
  platform: Platform
  publishMode: 'demo' | 'live'
  publishedAt: string
  formatFindings: string[]
  analysis: { summary: string; recommendation: string } | null
  lessons: number
}

export async function publishIdea(
  ctx: OrchestratorContext & { ideaId: string; platform?: Platform },
): Promise<PublishResult> {
  const { workspaceId, turnId = null } = ctx
  const idea = await getIdea(workspaceId, ctx.ideaId)
  if (!idea) throw new Error('No such idea.')

  const platform = ctx.platform ?? idea.platform

  /*
   * DEMO MODE DOES NOT PUBLISH.
   *
   * The simulator used to accept a publish and write a real `posts` row with a
   * seeded receipt id. Everything downstream then treated that row as a
   * publication: the idea moved to `published`, the Analytics Agent measured it,
   * and the Learning Agent wrote lessons from an audience that never saw
   * anything. The stamp said `demo`, but a stamp is not much defence when the
   * status, the receipt and the metrics all read as real.
   *
   * So the refusal is here, at the one function every caller reaches — the REST
   * route, the command plane's publish tool and the operator's button all arrive
   * through it, so none of them can route around this.
   *
   * This is a refusal, not a silent no-op: nothing is marked published, and the
   * reason names exactly what would make publishing possible.
   */
  if (config.core.publishMode !== 'live') {
    throw new Error(
      `Publishing is disabled in demo mode, so “${idea.title}” was not published and nothing was ` +
        `recorded. A simulated receipt would be indistinguishable from a real one downstream. ` +
        `To publish for real, set PUBLISH_MODE=live and supply the ${PLATFORM_LABEL[platform]} ` +
        `access token; the two human approvals on this post remain valid and do not need repeating.`,
    )
  }

  // Both signatures, checked here rather than trusted from the caller.
  if (idea.marketing_approved_at === null) {
    throw new Error(
      `“${idea.title}” has no Marketing approval. Nothing publishes without Marketing, then Leadership.`,
    )
  }
  const decision = idea.leadership_decision
  if (!decision || decision.decision !== 'approved') {
    throw new Error(
      `“${idea.title}” has no Leadership approval. That checkpoint has no off switch.`,
    )
  }

  /*
   * Publishing is the one irreversible act, so it is also the one that must not
   * happen twice. A retried request, a double-clicked button or two concurrent
   * calls would otherwise each dispatch and each record a receipt — and in demo
   * mode the receipt id is seeded, so the duplicates are indistinguishable.
   * The status is the intent check; the unique index on (workspace_id,
   * external_id) is the backstop underneath it.
   */
  if (idea.status === 'published') {
    throw new Error(
      `“${idea.title}” is already published. Publishing is irreversible, so it is never repeated automatically.`,
    )
  }

  const draft = await getDraft(idea.id, platform)
  if (!draft) throw new Error('There is no draft to publish.')
  const asset = await getMediaAsset(idea.id, platform)

  const result = await runAgent<PublishPayload>(
    'publishing',
    {
      ideaId: idea.id,
      platform,
      title: idea.title,
      body: draft.body,
      altText: asset?.alt_text ?? '',
      mediaAssetId: asset?.id ?? null,
      mediaDataUri: asset?.data_uri ?? null,
      publishMode: config.core.publishMode,
    },
    {
      workspaceId,
      trigger: ctx.trigger,
      turnId,
      paceMs: ctx.paceMs ?? 0,
      configOverrides: ctx.configOverrides ?? {},
      currentTask: `Publishing to ${PLATFORM_LABEL[platform]}`,
      inputCount: 1,
    },
  )

  if (result.status === 'failed') throw new Error(result.error ?? `${AGENT_BY_ID.publishing.name} failed.`)

  const payload = result.payload
  const postId = payload.postId
  if (!postId) throw new Error('The publish completed without a receipt.')

  await updateIdea(workspaceId, idea.id, { status: 'published' })

  if (turnId) {
    await insertLineage({
      workspaceId,
      fromType: 'assistant_turn',
      fromId: turnId,
      toType: 'post',
      toId: postId,
      agentId: 'assistant',
    })
  }

  // Hand off synchronously to analytics, then learning, in this same call. The
  // loop closes before the operator sees the receipt.
  const analytics = await runAgent<AnalyticsPayload>(
    'analytics',
    { postId, platform },
    {
      workspaceId,
      trigger: ctx.trigger,
      turnId,
      configOverrides: ctx.configOverrides ?? {},
      currentTask: 'Reading the first metrics',
      inputCount: 1,
    },
  )

  const learning = await runAgent<LearningPayload>(
    'learning',
    {},
    {
      workspaceId,
      trigger: ctx.trigger,
      turnId,
      configOverrides: ctx.configOverrides ?? {},
      currentTask: 'Writing the lesson back',
      inputCount: 1,
    },
  )

  const explanation = analytics.payload.explanation ?? null

  return {
    postId,
    externalId: payload.externalId ?? '',
    platform,
    publishMode: config.core.publishMode,
    publishedAt: payload.receipt?.publishedAt ?? new Date().toISOString().slice(0, 10),
    formatFindings: payload.formatFindings ?? [],
    analysis: explanation ? { summary: explanation.summary, recommendation: explanation.recommendation } : null,
    lessons: learning.payload.learned?.length ?? 0,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS REFRESH
   ═══════════════════════════════════════════════════════════════════════════ */

export async function refreshAnalytics(
  ctx: OrchestratorContext & { platform?: Platform; month?: string },
): Promise<AnalyticsPayload> {
  const result = await runAgent<AnalyticsPayload>(
    'analytics',
    {
      ...(ctx.platform ? { platform: ctx.platform } : {}),
      ...(ctx.month ? { month: ctx.month } : {}),
    },
    {
      workspaceId: ctx.workspaceId,
      trigger: ctx.trigger,
      turnId: ctx.turnId ?? null,
      configOverrides: ctx.configOverrides ?? {},
      currentTask: 'Refreshing analytics',
    },
  )
  return result.payload
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE HAND-OFF GRAPH
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The declared successors of an agent. The orchestrator's sequencing above is a
 * walk of this graph; the Orchestration screen draws the same edges. If the order
 * looks wrong, the graph is wrong — never special-case this.
 */
export function successorsOf(agentId: AgentId): AgentId[] {
  return AGENT_BY_ID[agentId]?.handsOffTo ?? []
}

/** A quick read of what a run produced, for the console and Ethara. */
export async function pipelineSnapshot(workspaceId: string): Promise<{
  keywords: number
  trending: number
  topHashtags: number
  primaryIdeas: number
  published: number
}> {
  const [keywords, signals, top, ideas, posts] = await Promise.all([
    listKeywords(workspaceId, true),
    latestKeywordSignals(workspaceId),
    listHashtags(workspaceId, { top: true, limit: 25 }),
    listIdeas(workspaceId, { slot: 'primary', limit: 60 }),
    listPosts(workspaceId, { limit: 200 }),
  ])
  return {
    keywords: keywords.length,
    trending: signals.filter((s) => s.is_trending).length,
    topHashtags: top.length,
    primaryIdeas: ideas.length,
    published: posts.length,
  }
}

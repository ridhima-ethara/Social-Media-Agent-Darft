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
  ContentFormat,
  IdeaStatus,
  Platform,
} from '../../shared/agent-contract'
import { AGENT_BY_ID, SKILL_BY_ID } from '../../shared/agent-registry'
import { canvasFor, canvasKey, type ImageModelId } from '../../shared/image-models'
import { isWithinPostReady, resolveCalendarHorizon } from './calendar-horizon'
import { config } from './config'
import { publish, publishActivity } from './events'
import { buildDiscoveryResults } from './discovery-results'
import {
  appendIdeaFeedback,
  countPipelineRuns,
  mergePipelineRunSummary,
  recordDiscoveredHashtags,
  type DiscoveredHashtag,
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
  replaceHookVariants,
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
  ScoredHook,
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
  /** Placed topics dated after the post-ready horizon — in the Topic Queue, no post yet. */
  topicsQueued: number
  source: 'live' | 'fixture'
  fallbackReasons: string[]
  /** Post-ready topics (today, and tomorrow when required) handed to the Content and Image Agents. */
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
    currentTask: 'Claude Bridge · discovering trends on LinkedIn, Instagram, Facebook and X',
    inputCount: 0,
  })

  if (scraping.status === 'failed') {
    // Nothing to validate, but the operator is still shown the result — an
    // empty one, with each platform's reason already on the run's summary.
    const empty = buildDiscoveryResults(run.id, {}, new Date(), config.core.tz)
    await mergePipelineRunSummary(run.id, { discoveryResults: empty })
    publish({
      type: 'discovery.results',
      runId: run.id,
      ...(turnId === null ? {} : { turnId }),
      message: 'Discovery found no post to validate',
      data: { total: 0 },
    })
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

  /*
   * NEW HASHTAGS → KNOWLEDGE BASE.
   *
   * Hashtags on VALIDATED posts that Ethara does not track yet (the bridge
   * flags them `newHashtags`) are learned as "Discovered Hashtag" entries, so
   * the next run searches them too. Only validated posts count — a tag seen on
   * a rejected post is not evidence of anything. Failure never fails the run.
   */
  try {
    const scrapeKnobs = await resolveSkillConfig(workspaceId, 'scraping.linkedin.fetch')
    if (scrapeKnobs.learnNewHashtags !== false) {
      const cap = Math.max(0, Number(scrapeKnobs.maxNewHashtagsPerRun ?? 10))
      const validatedUrls = new Set((afterValidation.posts ?? []).filter((p) => p.validation === 'validated').map((p) => p.url))
      const byTag = new Map<string, DiscoveredHashtag & { count: number }>()
      for (const t of afterValidation.platformTrends ?? []) {
        for (const p of t.posts) {
          if (!validatedUrls.has(p.url)) continue
          for (const tag of t.newHashtags) {
            const key = tag.toLowerCase()
            const entry = byTag.get(key) ?? { display: tag, urls: [], platforms: [], topics: [], count: 0 }
            if (!entry.urls.some((u) => u.url === p.url)) entry.urls.push({ url: p.url, title: t.trend, publishedAt: p.publishedAt })
            if (!entry.platforms.includes(t.platform)) entry.platforms.push(t.platform)
            if (!entry.topics.includes(t.trend)) entry.topics.push(t.trend)
            entry.count += 1
            byTag.set(key, entry)
          }
        }
      }
      const best = [...byTag.values()].sort((a, b) => b.count - a.count).slice(0, cap)
      if (best.length > 0) {
        const learned = await recordDiscoveredHashtags(workspaceId, best)
        await mergePipelineRunSummary(run.id, { learnedHashtags: { written: learned.written, merged: learned.merged } })
        await insertActivity({
          workspaceId,
          agentId: 'scraping',
          message:
            `New hashtags learned into the Knowledge Base: ${learned.written.join(' ') || 'none new'}` +
            (learned.merged.length > 0 ? ` · seen again: ${learned.merged.join(' ')}` : '') +
            ' — the next run searches them too.',
          status: 'ok',
        })
      }
    }
  } catch (err) {
    await insertActivity({
      workspaceId,
      agentId: 'scraping',
      message: `Could not learn new hashtags into the Knowledge Base: ${err instanceof Error ? err.message : String(err)}`,
      status: 'warn',
    })
  }

  /*
   * SCRAPING AND VALIDATION ARE DONE — SHOW WHAT WAS FOUND.
   *
   * Topic + Date + Hashtags + Post URL + Platform, one row per captured post
   * with the Validation Agent's verdict beside it, newest first. Recorded on the
   * run so it can be reopened, and announced so the app opens it now, while the
   * rest of the pipeline carries on.
   */
  const discoveryResults = buildDiscoveryResults(run.id, afterValidation, new Date(), config.core.tz)
  await mergePipelineRunSummary(run.id, { discoveryResults })
  publish({
    type: 'discovery.results',
    runId: run.id,
    ...(turnId === null ? {} : { turnId }),
    message: `Discovery results · ${discoveryResults.counts.total} post(s), ${discoveryResults.counts.validated} validated`,
    data: { total: discoveryResults.counts.total, validated: discoveryResults.counts.validated },
  })

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

  /* ── ⑤ Write what is due ─────────────────────────────────────────────────
   *
   * TODAY → POST READY · TOMORROW → POST READY IF REQUIRED · LATER → TOPIC.
   *
   * The Calendar Agent places validated topics on dates; it writes nothing. The
   * pipeline then hands ONLY the post-ready topics — today's, and tomorrow's
   * when the posting schedule requires it (`shared/calendar-horizon.ts`) — to
   * the Content and Image Agents. Every later date keeps its topic in the
   * Topic Queue with no caption, image or hashtags, until someone presses
   * Generate Post for it. Writing the whole week up front spent two model calls
   * a post on topics that later runs routinely displaced.
   *
   * Bounded by a declared knob; a failure is reported per post and never fails
   * the run, because a written today with one post missing is worth more than a
   * failed pipeline.
   */
  const { written, writeFailed, topicsQueued } = await writeCalendarBacklog({ workspaceId, trigger, turnId, paceMs, configOverrides })

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
    topicsQueued,
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
    topicsQueued: 0,
    source: 'fixture',
    fallbackReasons: [],
    written: 0,
    writeFailed: 0,
  }
}

/**
 * Write every POST-READY calendar topic that has no post yet — today's, and
 * tomorrow's when the posting schedule requires it. Later topics are counted
 * as queued and left alone.
 *
 * The pipeline calls this as its last stage. It is also called once when the
 * API starts, because a run cut off mid-write — a deploy, a crash, a restart —
 * used to leave its remaining slots placed but unwritten until the next full
 * run, and the calendar showed them as "No caption yet" for all that time.
 * Idempotent: a post that already has a draft is skipped, so running it twice
 * writes nothing twice.
 */
/*
 * One backlog write at a time. The boot-time recovery and a pipeline run that
 * reaches its last stage could otherwise both pick the same unwritten post and
 * write it twice. A caller that arrives mid-write waits, then looks again —
 * so a run's freshly placed posts are still covered.
 */
let backlogInFlight: Promise<unknown> | null = null

export async function writeCalendarBacklog(
  ctx: OrchestratorContext,
): Promise<BacklogResult> {
  while (backlogInFlight !== null) await backlogInFlight.catch(() => undefined)
  const pending = writeCalendarBacklogNow(ctx)
  backlogInFlight = pending
  try {
    return await pending
  } finally {
    backlogInFlight = null
  }
}

interface BacklogResult {
  written: number
  writeFailed: number
  /** Placed topics after the post-ready horizon, waiting in the Topic Queue. */
  topicsQueued: number
}

async function writeCalendarBacklogNow(ctx: OrchestratorContext): Promise<BacklogResult> {
  const { workspaceId, trigger, turnId = null, paceMs = 0, configOverrides = {} } = ctx
  const rankConfig = await resolveSkillConfig(workspaceId, 'calendar.rank.select')
  const autoWrite = rankConfig.autoWriteCalendar !== false
  const maxWrites = Math.max(0, Number(rankConfig.maxAutoWrites ?? 8))
  const horizon = await resolveCalendarHorizon(workspaceId)

  let written = 0
  let writeFailed = 0

  const onCalendar = await listIdeas(workspaceId, { limit: 400 })
  const unwritten = onCalendar
    .filter((row) => row.calendar_slot === 'primary')
    .filter((row) => row.status === 'suggested')
  /*
   * ONLY THE POST-READY DATES ARE WRITTEN.
   *
   * Today's topic, and tomorrow's when `postReadyHorizon` includes it and
   * tomorrow is a posting day. Everything later stays a topic — no caption, no
   * image, no hashtags — in the Topic Queue. Nothing here rewrites a post that
   * already exists: `status === 'suggested'` and the draft check below both
   * guard that.
   */
  const pending = unwritten
    .filter((row) => isWithinPostReady(String(row.scheduled_date ?? ''), horizon))
    .sort((a, b) => Number(b.priority_score ?? 0) - Number(a.priority_score ?? 0))
  const topicsQueued = unwritten.filter((row) => {
    const date = String(row.scheduled_date ?? '').slice(0, 10)
    return date > horizon.today && !isWithinPostReady(date, horizon)
  }).length

  if (autoWrite && maxWrites > 0) {
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
        message: `Writing ${queue.length} post-ready post(s) for ${horizon.postReadyDates.join(' and ')}`,
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
          `${written} post-ready post(s) written and illustrated` +
          (writeFailed > 0 ? ` · ${writeFailed} could not be written and keep their topic` : ''),
        status: writeFailed > 0 ? 'warn' : 'ok',
      })
    }

    /*
     * A CAPTION WITH NO CREATIVE.
     *
     * A post is written in two steps — caption, then image — and a run cut off
     * between them leaves a written post with no creative, which nothing above
     * picks up because it is no longer `suggested`. On the post-ready dates each
     * such post gets its image now. Never re-renders an existing one: only a
     * post with NO media asset qualifies.
     */
    const writtenPosts = onCalendar
      .filter((row) => row.calendar_slot === 'primary')
      .filter((row) => row.status !== 'suggested' && row.status !== 'rejected' && row.status !== 'published')
      .filter((row) => row.content_format !== 'short_form_script')
      .filter((row) => isWithinPostReady(String(row.scheduled_date ?? ''), horizon))
    let illustrated = 0
    for (const row of writtenPosts) {
      const platform = row.platform as Platform
      if ((await getMediaAsset(row.id, platform)) !== null) continue
      if ((await getDraft(row.id, platform)) === null) continue
      try {
        await renderIdeaImage({ workspaceId, trigger, turnId, paceMs, configOverrides, ideaId: row.id, platform })
        illustrated += 1
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        await insertActivity({
          workspaceId,
          agentId: 'image',
          message: `Could not draw the creative for “${row.title.slice(0, 60)}” — ${message}`,
          status: 'error',
        })
      }
    }
    if (illustrated > 0) {
      await insertActivity({
        workspaceId,
        agentId: 'image',
        message: `${illustrated} written post(s) were missing their creative and now have one`,
        status: 'ok',
      })
    }
  }

  // Said out loud, so a topic with no post reads as queued by design, not failed.
  if (topicsQueued > 0) {
    await insertActivity({
      workspaceId,
      agentId: 'calendar',
      message: `${topicsQueued} future topic(s) in the Topic Queue — no post is written for them until Generate Post is pressed`,
      status: 'ok',
    })
  }

  return { written, writeFailed, topicsQueued }
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
      views: p.views,
      viewsAvailable: p.viewsAvailable,
      hook: p.hook,
      engagementRate: p.engagementRate,
      mediaFormat: p.mediaFormat,
      signalFlags: p.signalFlags,
      transcript: p.transcript,
      transcriptSource: p.transcriptSource,
      transcriptConfidence: p.transcriptConfidence,
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
      measuredCount: trend.measuredCount,
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
  // Plan keys (`idea-1`…) repeat every run; the run tag makes a plan group unique.
  const runTag = payload.runId || new Date().toISOString()

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
        // The plan group ties a topic's per-platform entries together; the Meta twin shares one post.
        planGroup: `${runTag}:${idea.variantOf ?? idea.key}`,
        ...(idea.sharesPostWith ? { sharesPostWith: idea.sharesPostWith } : {}),
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
  /** Which kind of artefact was written (ADR-007). A script never publishes. */
  contentFormat: ContentFormat
  /**
   * The hook variants, for a script. Always `[]` for a post, so a caller never
   * has to test the format before reading it.
   */
  hooks: ScoredHook[]
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
 * GENERATE POST — the Topic Queue's on-demand action.
 *
 * A future calendar date holds a validated topic and nothing else. This writes
 * the complete post — caption, hashtags and creative — for that ONE topic, and
 * nothing for any other. It never overwrites: a topic that already has a post
 * returns that post untouched unless `regenerate` is set, because a rewrite is
 * a decision a person makes explicitly, not a side effect of pressing a button
 * twice.
 */
export interface GeneratePostResult {
  ideaId: string
  platform: Platform
  /** False when the topic already had a post and `regenerate` was not asked for. */
  generated: boolean
  reason: string
  draft: DraftResult | null
}

export async function generatePostForTopic(
  ctx: OrchestratorContext & { ideaId: string; regenerate?: boolean },
): Promise<GeneratePostResult> {
  const idea = await getIdea(ctx.workspaceId, ctx.ideaId)
  if (!idea) throw new Error('No such topic.')
  if (idea.status === 'rejected') throw new Error(`“${idea.title}” was withdrawn from the calendar; restore it before generating a post.`)
  if (idea.status === 'published') throw new Error(`“${idea.title}” is already published — a post is never rewritten after it went out.`)
  const platform = idea.platform

  const existing = await getDraft(idea.id, platform)
  if (existing && ctx.regenerate !== true) {
    return {
      ideaId: idea.id,
      platform,
      generated: false,
      reason: `“${idea.title}” already has a post (revision ${existing.revision}); nothing was regenerated. Ask to regenerate it to rewrite it.`,
      draft: null,
    }
  }

  const draft = await generateDraft({ ...ctx, ideaId: idea.id, platform, withImage: true })
  await insertActivity({
    workspaceId: ctx.workspaceId,
    agentId: 'caption',
    message: `${existing ? 'Regenerated' : 'Generated'} the ${PLATFORM_LABEL[platform]} post for the topic “${idea.title.slice(0, 60)}” on ${String(idea.scheduled_date).slice(0, 10)}`,
    status: 'ok',
  })
  return {
    ideaId: idea.id,
    platform,
    generated: true,
    reason: existing ? `Regenerated as revision ${draft.revision}, as asked.` : 'Post generated for this topic only.',
    draft,
  }
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

  /*
   * THE SHORT-FORM BRANCH (ADR-007), AND WHY IT LIVES HERE.
   *
   * Sequencing lives only in the orchestrator. The Caption Agent holds fourteen
   * skills — ten that compose a written post and four that produce a spoken
   * script with its hooks — and which set runs is a property of the ARTEFACT
   * being made, not of the agent.
   *
   * Expressed as `onlySkills` rather than as fourteen `if` statements inside
   * fourteen handlers: a skill that no-ops on the wrong format still records a
   * `skill_runs` row claiming it ran, and a run console full of those is a run
   * console nobody reads.
   *
   * `generation.caption.voice` is in BOTH lists deliberately. It is the
   * grounding retrieval, and a script is held to the same evidence standard as
   * a post — an ungrounded script is not a cheaper script, it is an unfounded
   * one.
   */
  const shortForm = idea.content_format === 'short_form_script'
  const scriptSkills = [
    'generation.caption.voice',
    'caption.voice.derive',
    'caption.script.write',
    'caption.hook.generate',
    'caption.hook.score',
  ]

  /*
   * FACEBOOK ↔ INSTAGRAM SHARE ONE POST.
   *
   * The calendar plans a topic's Facebook and Instagram entries as twins
   * (`analysis.sharesPostWith`). When the twin is already written, this entry
   * takes the same caption instead of writing a second one; its own image is
   * still rendered at its own platform's size.
   */
  const twinPlatform = analysis.sharesPostWith
  if (!shortForm && (twinPlatform === 'facebook' || twinPlatform === 'instagram') && twinPlatform !== platform) {
    const twin = await findPlanTwin(workspaceId, idea, twinPlatform)
    const twinDraft = twin ? await getDraft(twin.id, twinPlatform) : null
    if (twin && twinDraft) return shareTwinDraft(ctx, idea, platform, twin, twinDraft)
  }

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
      contentFormat: idea.content_format,
    },
    {
      ...(shortForm ? { onlySkills: scriptSkills } : {}),
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
  const body = shortForm
    ? (payload.script ?? idea.description ?? idea.title)
    : (payload.caption ?? payload.captionBody ?? idea.description ?? idea.title)

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
  // A script has no single first line of its own — it has five competing hooks
  // and no chosen one yet — so the card keeps the title it was planned under.
  const hook = shortForm ? '' : (payload.hook ?? '').trim()
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
    model: (shortForm ? payload.scriptModel : payload.captionModel) ?? 'ethara-template-writer',
    source: (shortForm ? payload.scriptSource : payload.captionSource) ?? 'fixture',
    contentFormat: idea.content_format,
  })

  /*
   * THE HOOKS, WRITTEN AS ROWS.
   *
   * One row per variant, never a blob on the draft: each carries its own
   * pattern, its own matched evidence and its own outcome, and a JSON array
   * could not be joined, counted or asked which pattern wins for this account.
   *
   * `replaceHookVariants` rewrites the set rather than appending a second one —
   * a double-clicked Generate must not produce ten hooks — and it leaves a
   * variant the operator has already selected alone, because that is a human
   * decision about this idea.
   */
  if (shortForm) {
    const scored = payload.scoredHooks ?? []
    if (scored.length > 0) {
      await replaceHookVariants(
        workspaceId,
        idea.id,
        draft?.id ?? null,
        scored.map((h) => ({
          body: h.body,
          pattern: h.pattern,
          rank: h.rank,
          confidence: h.confidence,
          confidenceBasis: h.confidenceBasis,
          matchedPostId: h.matchedPostId,
          matchedItemId: h.matchedItemId,
          source: payload.hookSource ?? 'fixture',
          model: payload.hookModel ?? null,
          fallbackReason: payload.hookFallbackReason ?? null,
        })),
      )
    }
    for (const note of payload.hookNotes ?? []) {
      await insertActivity({ workspaceId, agentId: 'caption', message: note, status: 'warn' })
    }
  }

  /*
   * THE FIRST STEP ON THE THREAD.
   *
   * `drafts` keeps one row per post and platform, so the body it holds is only
   * ever the CURRENT one — the revision number climbs while the text it
   * replaced is gone. Every instruction was already recorded here; the writing
   * they were applied to was not, so reopening the panel showed a thread whose
   * first entry could not be returned to.
   *
   * `instruction` stays null: this is the agent's own writing, nobody asked for
   * it, and the Learning Agent reads a non-empty `instruction` as an operator
   * preference. A generated draft is not a preference.
   */
  await appendIdeaFeedback(workspaceId, idea.id, {
    instruction: null,
    // Revision 1 is the first writing; anything above it is a regeneration,
    // which discards the previous text and so is worth saying plainly.
    note: (draft?.revision ?? 1) > 1 ? 'Rewritten from scratch.' : 'First draft.',
    platform,
    revision: draft?.revision ?? 1,
    target: 'caption',
    body,
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

  /*
   * NO CREATIVE FOR A SCRIPT.
   *
   * A brand card is the artwork attached to a written post. A reel's visual is
   * the footage a human has not shot yet, and rendering a card for it would put
   * an asset on the idea that nothing will ever publish — and that the review
   * screens would then show as though it were the post's image.
   */
  const media =
    ctx.withImage === false || shortForm
      ? null
      : await renderIdeaImage({ ...ctx, ideaId: idea.id, platform, captionBody: body })

  return {
    ideaId: idea.id,
    platform,
    body,
    revision: draft?.revision ?? 1,
    source: (shortForm ? payload.scriptSource : payload.captionSource) ?? 'fixture',
    model: (shortForm ? payload.scriptModel : payload.captionModel) ?? 'ethara-template-writer',
    ...(shortForm
      ? payload.scriptFallbackReason === undefined
        ? {}
        : { fallbackReason: payload.scriptFallbackReason }
      : payload.captionFallbackReason === undefined
        ? {}
        : { fallbackReason: payload.captionFallbackReason }),
    contentFormat: idea.content_format,
    hooks: payload.scoredHooks ?? [],
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

/** The same topic's entry on `platform`, planned in the same group on the same day — the Meta twin. */
async function findPlanTwin(workspaceId: string, idea: IdeaRow, platform: Platform): Promise<IdeaRow | null> {
  const group = (idea.analysis as Record<string, unknown>).planGroup
  if (typeof group !== 'string' || group === '') return null
  const rows = await listIdeas(workspaceId, { platform, date: String(idea.scheduled_date ?? '').slice(0, 10), limit: 100 })
  return rows.find((r) => r.id !== idea.id && (r.analysis as Record<string, unknown>).planGroup === group) ?? null
}

/** Writes this entry's draft as its twin's caption, then renders its own image. */
async function shareTwinDraft(
  ctx: OrchestratorContext & { ideaId: string; platform?: Platform; withImage?: boolean },
  idea: IdeaRow,
  platform: Platform,
  twin: IdeaRow,
  twinDraft: NonNullable<Awaited<ReturnType<typeof getDraft>>>,
): Promise<DraftResult> {
  const { workspaceId, turnId = null } = ctx
  const body = twinDraft.body
  const source = twinDraft.source === 'live' ? 'live' : 'fixture'
  const model = twinDraft.model ?? 'shared'
  if ((idea.status === 'suggested' || idea.status === 'drafted') && twin.title !== idea.title) {
    await updateIdea(workspaceId, idea.id, { title: twin.title })
  }
  const draft = await upsertDraft({ ideaId: idea.id, platform, body, generatedBy: 'caption', model, source, contentFormat: idea.content_format })
  await appendIdeaFeedback(workspaceId, idea.id, {
    instruction: null,
    note: `Shares one post with the ${PLATFORM_LABEL[twin.platform as Platform]} entry — same caption.`,
    platform,
    revision: draft?.revision ?? 1,
    target: 'caption',
    body,
  })
  await insertLineage({ workspaceId, fromType: 'content_idea', fromId: twin.id, toType: 'draft', toId: draft?.id ?? idea.id, agentId: 'caption' })
  if (idea.status === 'suggested') await updateIdea(workspaceId, idea.id, { status: 'drafted' })
  await insertActivity({
    workspaceId,
    agentId: 'caption',
    message: `${PLATFORM_LABEL[platform]} post shares the ${PLATFORM_LABEL[twin.platform as Platform]} caption for “${twin.title.slice(0, 60)}”`,
    status: 'ok',
  })
  publish({
    type: 'draft.generated',
    agentId: 'caption',
    ...(turnId === null ? {} : { turnId }),
    message: `Draft shared from the ${PLATFORM_LABEL[twin.platform as Platform]} post for “${twin.title}”`,
    data: { ideaId: idea.id, platform, revision: draft?.revision ?? 1, source, sharedFrom: twin.id },
  })
  const media = ctx.withImage === false ? null : await renderIdeaImage({ ...ctx, ideaId: idea.id, platform, captionBody: body })
  return {
    ideaId: idea.id,
    platform,
    body,
    revision: draft?.revision ?? 1,
    source,
    model,
    contentFormat: idea.content_format,
    hooks: [],
    grounding: [],
    media,
    skills: [],
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

  /*
   * An image instruction joins the same thread as a caption instruction.
   *
   * Only when one was given: this function also runs as the last step of
   * `generateDraft`, and recording "re-rendered" for a creative nobody asked
   * about would put a turn in the thread that no operator took.
   *
   * No `body` — reverting means returning the CAPTION to a point, and a render
   * is not a point in the caption's history. `target` says which agent was
   * spoken to so the thread can label the turn.
   */
  if (ctx.instruction) {
    await appendIdeaFeedback(workspaceId, idea.id, {
      instruction: ctx.instruction,
      note: payload.fallbackReason
        ? `Re-rendered with ${payload.model ?? 'brand-svg'} — ${payload.fallbackReason}`
        : `Re-rendered with ${payload.model ?? 'brand-svg'}.`,
      platform: ctx.platform,
      target: 'image',
      model: payload.model ?? 'brand-svg',
    })
  }

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
  /** Whether the ask was met, as evidence rather than assumption. */
  honoured: ReviewPayload['honoured']
  /** Per-attachment: which the chosen model actually read. */
  referenceNotes: string[]
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
    /**
     * `image` carries the attachment's bytes. It has to be declared here or the
     * data URI is dropped in transit and the review skill sees a name — which
     * is exactly how an attached moodboard used to reach the writer as a
     * filename.
     */
    references?: Array<{
      name: string
      mimeType: string
      text?: string
      note?: string
      image?: string
    }>
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
  //
  // `body` is the text AS IT STOOD AFTER this step, which is what makes the
  // thread revertable: returning to a step means writing its body back. An
  // instruction that changed nothing still carries the body it left in place,
  // so every entry is a point the draft can be returned to.
  await appendIdeaFeedback(workspaceId, idea.id, {
    instruction: ctx.instruction,
    note: payload.appliedNote ?? '',
    platform: ctx.platform,
    revision: saved?.revision ?? draft.revision,
    target: 'caption',
    applied: changed,
    body,
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
    honoured: payload.honoured,
    referenceNotes: payload.referenceNotes ?? [],
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
   REVERT — GOING BACK IS ITSELF A STEP FORWARD
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RevertResult {
  ideaId: string
  platform: Platform
  draft: { body: string; revision: number; model: string; source: 'live' | 'fixture' }
  /** Names the step returned to, so the panel can say so without guessing. */
  note: string
}

/**
 * Returns a caption to the text it held at an earlier step on the thread.
 *
 * REVERTING DOES NOT REWIND. Law 4 — nothing is ever deleted — applies to a
 * revert as much as to a rejection: the steps taken after the one being
 * returned to stay on the thread, and the revert is appended as a further step
 * rather than truncating the history behind it. An operator who reverts and
 * then changes their mind can go forward again, because the later text is still
 * recorded. Dropping those entries would make the undo itself un-undoable.
 *
 * The step is addressed by its `at` stamp, which is what `appendIdeaFeedback`
 * writes and the only identifier a feedback entry has. A revision NUMBER would
 * be ambiguous: an instruction that changed nothing leaves the number where it
 * was, so two entries can share one.
 */
export async function revertDraft(
  ctx: OrchestratorContext & { ideaId: string; platform: Platform; at: string },
): Promise<RevertResult> {
  const { workspaceId } = ctx
  const idea = await getIdea(workspaceId, ctx.ideaId)
  if (!idea) throw new Error('No such idea.')

  const step = idea.feedback.find(
    (entry) =>
      String(entry.at) === ctx.at &&
      (entry.platform === undefined || entry.platform === ctx.platform),
  )
  if (!step) throw new Error('That step is no longer on this post’s history.')

  const body = typeof step.body === 'string' ? step.body : ''
  if (body.trim().length === 0) {
    // Image turns and entries written before bodies were recorded carry no text
    // to return to. Saying which is true beats writing an empty caption.
    throw new Error('That step did not change the caption, so there is nothing to return to.')
  }

  const current = await getDraft(idea.id, ctx.platform)
  if (current && current.body.trim() === body.trim()) {
    throw new Error('The caption already reads exactly as it did at that step.')
  }

  const saved = await upsertDraft({
    ideaId: idea.id,
    platform: ctx.platform,
    body,
    generatedBy: 'review',
    model: typeof step.model === 'string' ? step.model : (current?.model ?? 'ethara-template-writer'),
    // A revert restores text this workspace already held; it calls no model, so
    // it is never `live` on its own account.
    source: 'fixture',
  })

  const revertedTo = typeof step.revision === 'number' ? `R${step.revision}` : 'an earlier step'
  const note = `Reverted to ${revertedTo}. The steps after it are still on the thread.`

  // `instruction` stays null deliberately: the Learning Agent reads a non-empty
  // instruction as an operator preference, and "undo" is not a preference about
  // how posts should read.
  await appendIdeaFeedback(workspaceId, idea.id, {
    instruction: null,
    note,
    platform: ctx.platform,
    revision: saved?.revision ?? current?.revision ?? 1,
    target: 'caption',
    revertedFrom: ctx.at,
    body,
  })

  await insertActivity({
    workspaceId,
    agentId: 'review',
    message: `“${idea.title}” reverted to ${revertedTo}`,
    status: 'warn',
  })

  return {
    ideaId: idea.id,
    platform: ctx.platform,
    draft: {
      body,
      revision: saved?.revision ?? current?.revision ?? 1,
      model: saved?.model ?? current?.model ?? 'ethara-template-writer',
      source: saved?.source ?? current?.source ?? 'fixture',
    },
    note,
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
   * A SHORT-FORM SCRIPT DOES NOT PUBLISH (ADR-010).
   *
   * Publishing a reel means uploading a video file, and there is no video file
   * — nothing in this product records, edits or uploads one. The closest the
   * platform could do is post the SCRIPT TEXT as a caption, which is a
   * different artefact in a different register, shipped under an approval that
   * was given for something else.
   *
   * So a script terminates at `approved` and is exported for a human to film.
   * The refusal is here, at the one function every caller reaches, rather than
   * in the UI: the REST route, the command plane's `idea.publish` tool and the
   * operator's button all arrive through this, so none can route around it.
   */
  if (idea.content_format === 'short_form_script') {
    throw new Error(
      `“${idea.title}” is a short-form script, and a script is not published by this platform — ` +
        `it is exported for a human to film. There is no video artefact to dispatch, and posting ` +
        `the script text as a caption would publish a different thing from the one that was approved. ` +
        `The approvals on it remain valid; read the script and its hooks from the idea itself.`,
    )
  }

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

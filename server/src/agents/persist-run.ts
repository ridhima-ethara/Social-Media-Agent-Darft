/**
 * WRITING A PYTHON AGENT RUN INTO POSTGRES
 *
 * The agents in `backend/` are a separate process with their own JSON store.
 * The web app reads state from Postgres and only from Postgres (law 8: state is
 * server-truth, events are notifications). Without this module a run would
 * narrate itself perfectly on the event stream and leave nothing behind — the
 * calendar would still be empty when the stream went quiet.
 *
 * So this takes the `workflow.output` frame and lands it: the scored keywords
 * and their signals, the ranked hashtags and the consolidated top set, and the
 * placed ideas with their slots. Nothing is invented on the way across. A field
 * the Python tier does not measure is not filled in here to make a row look
 * complete.
 */

import type {
  AgentId,
  CalendarSlot,
  Platform,
  ResolvedConfig,
  ValidationVerdict,
} from '../../../shared/agent-contract'
import {
  createKeyword,
  currentWorkspaceId,
  finishAgentRun,
  finishPipelineRun,
  insertKeywordSignal,
  insertSkillRun,
  persistHashtagCandidates,
  persistIdeas,
  persistScrapedItems,
  replaceTopHashtagSet,
  startAgentRun,
  startPipelineRun,
  upsertDraft,
  upsertMediaAsset,
} from '../db/repo'

/* ═══════════════════════════════════════════════════════════════════════════
   READING THE FRAME
   ═══════════════════════════════════════════════════════════════════════════ */

type Row = Record<string, unknown>

const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'x', 'facebook']
const VERDICTS: ValidationVerdict[] = ['pending', 'validated', 'needs_review', 'duplicate', 'rejected']

function rows(value: unknown): Row[] {
  return Array.isArray(value) ? (value.filter((v) => v && typeof v === 'object') as Row[]) : []
}

function str(row: Row, key: string, fallback = ''): string {
  const value = row[key]
  return typeof value === 'string' && value.trim() ? value : fallback
}

function num(row: Row, key: string, fallback = 0): number {
  const value = Number(row[key])
  return Number.isFinite(value) ? value : fallback
}

/** A URL or nothing. An empty string in a URL column reads as a link that goes nowhere. */
function url(row: Row, key: string): string | null {
  const value = row[key]
  return typeof value === 'string' && value.trim() ? value : null
}

/** A nested object, or an empty one. Keeps `str()`/`num()` usable on it. */
function asRow(value: unknown): Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Row)
    : {}
}

/**
 * Platforms are constrained by a CHECK on the table. An unrecognised one is
 * routed to LinkedIn rather than thrown, because losing an idea over a typo in
 * a platform name would be the worse failure — and the idea keeps its own
 * `platform_reason`, which still names what the agent chose.
 */
function platform(value: unknown): Platform {
  return PLATFORMS.find((p) => p === value) ?? 'linkedin'
}

function verdict(value: unknown): ValidationVerdict {
  return VERDICTS.find((v) => v === value) ?? 'pending'
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE WRITE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PersistedRun {
  runId: string
  keywords: number
  signals: number
  hashtags: number
  topSet: number
  ideasCreated: number
  ideasUpdated: number
  /** Scraped pages written. Content Intelligence renders from these. */
  captures: number
  /** Captions written. A calendar card without one has no post behind it. */
  drafts: number
  /** Creatives written. */
  media: number
  /** Per-agent timing rows. Agent Activity renders from these. */
  agentRuns: number
  /** Named so an operator can see what the run did not carry, not just what it did. */
  skipped: string[]
}

export async function persistAgentRun(output: Record<string, unknown>): Promise<PersistedRun> {
  const workspaceId = await currentWorkspaceId()
  const run = await startPipelineRun(workspaceId, 'agents')
  const skipped: string[] = []

  const scored = rows(output.keywords_scored)
  const rankedHashtags = rows(output.ranked_hashtags)
  const topHashtags = rows(output.top_hashtags)
  const ideas = rows(output.ranked_ideas)

  /* ── Keywords and their signals ─────────────────────────────────────────── */

  const keywordIdByTerm = new Map<string, string>()
  let signals = 0

  for (const row of scored) {
    const term = str(row, 'term')
    if (!term) continue

    // `createKeyword` upserts on `lower(term)`, so a term the operator already
    // tracks keeps its own weight and category rather than being reset by a run.
    const keyword = await createKeyword(workspaceId, term, 'Core', num(row, 'trend_score', 50))
    if (!keyword) continue
    keywordIdByTerm.set(term.toLowerCase(), keyword.id)

    await insertKeywordSignal(workspaceId, {
      keywordId: keyword.id,
      runId: run.id,
      postCount: num(row, 'post_count'),
      totalEngagement: num(row, 'total_engagement'),
      // The Python bridge does not report how many posts were measured, so this
      // path records none rather than claiming the total is a measurement.
      measuredCount: num(row, 'measured_count'),
      avgEngagement: num(row, 'velocity'),
      velocity: num(row, 'velocity'),
      // The Python validator scores growth at a neutral 50 because there is no
      // prior run in the batch to compare against, and says so in its reason.
      // Zero here is the column's floor, not a measured decline — the reason
      // text is what carries the truth, and it travels with the row.
      growthPct: 0,
      trendScore: num(row, 'trend_score'),
      rank: num(row, 'rank', 1),
      isTrending: row.is_trending === true,
      trendReason: str(row, 'reason'),
      searchUrl: str(row, 'search_url'),
      topPostUrl: url(row, 'top_post_url'),
      topPostTitle: url(row, 'top_post_title'),
    })
    signals += 1
  }

  /* ── Hashtags ───────────────────────────────────────────────────────────── */

  const topTags = new Set(topHashtags.map((h) => str(h, 'tag')))
  const now = new Date().toISOString()
  let hashtagIdByTag = new Map<string, string>()

  if (rankedHashtags.length > 0) {
    hashtagIdByTag = await persistHashtagCandidates(
      workspaceId,
      run.id,
      rankedHashtags.map((row) => ({
        tag: str(row, 'tag'),
        displayTag: str(row, 'display_tag', str(row, 'tag')),
        keywordId: keywordIdByTerm.get(str(row, 'keyword').toLowerCase()) ?? null,
        postCount: num(row, 'post_count'),
        totalEngagement: num(row, 'total_engagement'),
        engagementPerPost: num(row, 'engagement_per_post'),
        brandRelevance: num(row, 'brand_relevance'),
        // Which lane surfaced it. The Python scrape reads Hacker News and the
        // open web (Reddit was removed — it answered 403 to this crawler), so the
        // tag is claimed for none of the publishing platforms — it was seen where
        // it was seen.
        platforms: ['open-web'],
        // What the verdict actually ran on, not a second opinion of it.
        relevance: num(row, 'hashtag_score'),
        credibility: 'Medium',
        freshness: num(row, 'freshness'),
        hashtagScore: num(row, 'hashtag_score'),
        rank: num(row, 'rank', 0) || null,
        validation: verdict(row.verdict),
        verdictReason: str(row, 'reason'),
        inTopSet: topTags.has(str(row, 'tag')),
        firstSeenAt: str(row, 'last_seen_at', now),
        lastSeenAt: str(row, 'last_seen_at', now),
        feedUrl: str(row, 'feed_url'),
        topPostUrl: url(row, 'top_post_url'),
        topPostTitle: url(row, 'top_post_title'),
      })),
    )
    await replaceTopHashtagSet(
      workspaceId,
      topHashtags.map((h) => hashtagIdByTag.get(str(h, 'tag'))).filter((id): id is string => !!id),
    )
  } else {
    skipped.push(
      'No hashtags were written: the scrape harvested no candidates that met the ' +
        'minimum-occurrences floor, so there was nothing to rank.',
    )
  }

  /* ── Ideas ──────────────────────────────────────────────────────────────── */

  const written = await persistIdeas(
    workspaceId,
    ideas.map((row) => ({
      // The Python tier has no `scraped_items` row to point at — its corpus
      // lives in its own store — so ideas de-duplicate on title and platform.
      sourceItemId: null,
      hashtagId: hashtagIdByTag.get(str(row, 'hashtag')) ?? null,
      title: str(row, 'title', 'Untitled idea'),
      description: str(row, 'description'),
      sourceTopic: str(row, 'source_topic'),
      platform: platform(row.platform),
      altPlatforms: [],
      scheduledDate: str(row, 'scheduled_date', now.slice(0, 10)),
      scheduledTime: str(row, 'scheduled_time', '10:00'),
      confidence: num(row, 'confidence'),
      priorityScore: num(row, 'priority_score'),
      platformRank: num(row, 'platform_rank', 0) || null,
      // Every idea the calendar keeps is a dated topic — there is no suggestion list.
      calendarSlot: 'primary' as CalendarSlot,
      status: 'suggested' as const,
      // Every reason the agent gave, kept with the row. This is what the
      // calendar card shows when an operator asks why a post is where it is.
      analysis: {
        platformReason: str(row, 'platform_reason'),
        slotReasons: Array.isArray(row.slot_reasons) ? row.slot_reasons : [],
        knowledgeGroundedIn: Array.isArray(row.knowledge_grounded_in) ? row.knowledge_grounded_in : [],
        knowledgeTitles: Array.isArray(row.knowledge_titles) ? row.knowledge_titles : [],
        platformFit: num(row, 'platform_fit'),
        trendScore: num(row, 'trend_score'),
        producedBy: 'backend/agents/calendar_agent',
      },
      isNewTrend: false,
    })),
  )

  if (ideas.length === 0) {
    skipped.push('No ideas were written: the run produced no placed ideas to write.')
  }

  /* ── The captured corpus ────────────────────────────────────────────────── */
  /*
   * The Python tier's captures used to stop at the process boundary: the
   * Scraping Agent reported "captured 16 posts" and `scraped_items` stayed
   * empty, so Content Intelligence showed nothing after a run that had just
   * read sixteen pages. `artefacts()` now carries them; this writes them.
   *
   * `metricsAvailable` is false and the count columns stay at zero because this
   * tier captures through the Claude Bridge — web search results only — and a
   * search-indexed page states no reaction count. Zero here means "not
   * applicable", never "performed badly", exactly as on the Node side.
   */
  const posts = rows(output.posts)
  let captures = 0
  if (posts.length > 0) {
    const items = posts.map((row) => {
      const body = str(row, 'text')
      const keyword = str(row, 'keyword')
      return {
        keywordId: keywordIdByTerm.get(keyword.toLowerCase()) ?? null,
        externalId: str(row, 'external_id') || str(row, 'url'),
        // The Python capture carries one body; the first line is its title.
        title: (body.split('\n').find((l) => l.trim() !== '') ?? keyword)
          .replace(/^#+\s*/, '')
          .slice(0, 300),
        snippet: body.slice(0, 4000),
        url: str(row, 'url'),
        sourceName: str(row, 'source_name', 'crawl4ai'),
        sourceType: 'web',
        authorName: str(row, 'author_name'),
        authorHeadline: str(row, 'author_headline'),
        authorFollowers: num(row, 'author_followers'),
        hashtags: Array.isArray(row.hashtags) ? (row.hashtags as string[]) : [],
        engagement: 0,
        reactions: num(row, 'reactions'),
        comments: num(row, 'comments'),
        reposts: num(row, 'reposts'),
        relevance: 0,
        credibility: 'Medium',
        freshness: 0,
        isDuplicate: false,
        validation: 'pending' as ValidationVerdict,
        verdictReason: '',
        captureSource: 'live' as const,
        platform: PLATFORMS.find((p) => p === row.platform) ?? null,
        metricsAvailable: false,
        brandRelevance: 0,
        postedAt: str(row, 'posted_at', now),
      }
    })
    const idByExternal = await persistScrapedItems(workspaceId, run.id, items)
    captures = idByExternal.size
  } else {
    skipped.push('No captures were written: the run reported no posts.')
  }

  /* ── The caption and the creative ───────────────────────────────────────── */
  /*
   * The Content Agent spends roughly 90 seconds writing and the Image Agent 220
   * seconds painting. Both used to be discarded here, so the calendar card the
   * run produced had neither a caption nor an image — five minutes of the run's
   * ten spent on work nothing could see.
   *
   * Attached to the primary idea, which is the one the create stage worked on.
   */
  /*
   * `written` carries only `{ id, title, created }`, so the platform and slot
   * come from the source rows, which `persistIdeas` maps in order.
   */
  const primaryIndex = Math.max(
    0,
    ideas.findIndex((row) => row.calendar_slot === 'primary'),
  )
  const primary = written[primaryIndex]
  const primaryPlatform = platform(ideas[primaryIndex]?.platform)
  const caption = asRow(output.caption)
  const asset = asRow(output.asset)
  let drafts = 0
  let media = 0

  if (primary !== undefined && str(caption, 'body') !== '') {
    await upsertDraft({
      ideaId: primary.id,
      platform: primaryPlatform,
      body: str(caption, 'body'),
      generatedBy: 'backend/agents/content_agent',
      model: str(caption, 'model', 'backend/agents/content_agent'),
      source: 'live',
    })
    drafts = 1
  } else if (primary !== undefined) {
    skipped.push('No caption was written: the run carried no caption body.')
  }

  if (primary !== undefined && str(asset, 'data_uri') !== '') {
    await upsertMediaAsset({
      ideaId: primary.id,
      platform: primaryPlatform,
      concept: str(asset, 'concept', 'gradient-field'),
      canvas: str(asset, 'canvas', 'linkedin:square'),
      width: num(asset, 'width', 1080),
      height: num(asset, 'height', 1080),
      altText: str(asset, 'alt_text'),
      renderMode: 'live',
      model: str(asset, 'renderer', 'brand-svg'),
      prompt: str(asset, 'prompt'),
      fallbackReason: str(asset, 'fallback_reason') || null,
      dataUri: str(asset, 'data_uri'),
    })
    media = 1
  } else if (primary !== undefined) {
    skipped.push('No creative was written: the run carried no rendered asset.')
  }

  /* ── Per-agent timings and the resolved configuration ───────────────────── */
  /*
   * `agent_runs` is what Agent Activity renders, and `skill_runs.config_used` is
   * what keeps a past run explainable after the knobs change. Neither was
   * written, so the screen was empty and the rule was aspirational.
   *
   * Opened and closed in one pass: these agents have already finished, so there
   * is no running state to represent. `config_used` lives on `skill_runs`, so
   * each agent contributes one row there carrying the knobs it resolved.
   */
  const agentRuns = rows(output.agent_runs)
  let timings = 0
  for (const row of agentRuns) {
    const agentId = str(row, 'agent_id')
    if (agentId === '') continue

    // The Python roster suffixes its ids with `_agent`; the registry does not.
    const registryId = agentId.replace(/_agent$/, '') as AgentId
    const status = str(row, 'status', 'completed') === 'failed' ? 'failed' : 'completed'
    const durationMs = num(row, 'duration_ms')

    const opened = await startAgentRun({
      workspaceId,
      pipelineRunId: run.id,
      agentId: registryId,
      trigger: 'agents',
      turnId: null,
      inputCount: 0,
    })

    /*
     * A synthetic, namespaced skill id. The eight Python agents are not the 91
     * registry skills, so borrowing a registry id here would put a row into
     * another skill's history. `<agent>.agents.run` cannot collide with a
     * declared id and states plainly which engine produced it.
     */
    await insertSkillRun({
      workspaceId,
      agentRunId: opened.id,
      skillId: `${registryId}.agents.run`,
      agentId: registryId,
      status: status === 'failed' ? 'failed' : 'completed',
      durationMs,
      configUsed: asRow(row.config_used) as ResolvedConfig,
      note: str(row, 'summary').slice(0, 500),
    })

    await finishAgentRun(opened.id, { status, durationMs, outputCount: 0 })
    timings += 1
  }
  if (timings === 0) {
    skipped.push('No per-agent timings were written: the run carried no agent_runs.')
  }

  const persisted: PersistedRun = {
    runId: run.id,
    keywords: keywordIdByTerm.size,
    signals,
    hashtags: hashtagIdByTag.size,
    topSet: topHashtags.length,
    ideasCreated: written.filter((w) => w.created).length,
    ideasUpdated: written.filter((w) => !w.created).length,
    captures,
    drafts,
    media,
    agentRuns: timings,
    skipped,
  }

  await finishPipelineRun(
    run.id,
    output.status === 'failed' ? 'failed' : 'completed',
    { ...persisted, source: 'backend/agents' },
  )
  return persisted
}

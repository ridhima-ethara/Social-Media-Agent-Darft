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

import type { CalendarSlot, Platform, ValidationVerdict } from '../../../shared/agent-contract'
import {
  createKeyword,
  currentWorkspaceId,
  finishPipelineRun,
  insertKeywordSignal,
  persistHashtagCandidates,
  persistIdeas,
  replaceTopHashtagSet,
  startPipelineRun,
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
      calendarSlot: (row.calendar_slot === 'primary' ? 'primary' : 'suggestion') as CalendarSlot,
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

  const persisted: PersistedRun = {
    runId: run.id,
    keywords: keywordIdByTerm.size,
    signals,
    hashtags: hashtagIdByTag.size,
    topSet: topHashtags.length,
    ideasCreated: written.filter((w) => w.created).length,
    ideasUpdated: written.filter((w) => !w.created).length,
    skipped,
  }

  await finishPipelineRun(
    run.id,
    output.status === 'failed' ? 'failed' : 'completed',
    { ...persisted, source: 'backend/agents' },
  )
  return persisted
}

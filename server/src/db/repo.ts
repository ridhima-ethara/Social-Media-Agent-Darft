/**
 * THE REPOSITORY LAYER
 *
 * Every SQL statement in the product lives here or in the skill handlers that
 * own their own domain. Raw, parameterised SQL by design.
 *
 * Two conventions worth knowing:
 *   · Latest metrics are always read with a LATERAL join ordered by
 *     `captured_at DESC LIMIT 1`, never by overwriting a row.
 *   · Nothing is deleted. `deactivate`, `link`, and status changes replace what
 *     a DELETE would otherwise do.
 */

import type {
  ActivityStatus,
  AgentId,
  AgentRunStatus,
  CalendarSlot,
  IdeaStatus,
  Platform,
  ResolvedConfig,
  SkillRunStatus,
  ValidationVerdict,
} from '../../../shared/agent-contract'
import { config } from '../config'
import {
  embedMany,
  embedOne,
  embeddableText,
  embeddingModelId,
  toSqlVector,
} from '../integrations/embeddings'
import { query, queryOne } from './pool'

/* ═══════════════════════════════════════════════════════════════════════════
   WORKSPACE
   ═══════════════════════════════════════════════════════════════════════════ */

let cachedWorkspaceId: string | null = null
let cachedWorkspaceAt = 0

/**
 * Resolves the current workspace from `WORKSPACE_SLUG`, creating it if absent
 * so a fresh database is never a hard error.
 */
/**
 * How long a resolved workspace id is trusted before it is re-read.
 *
 * WHY THIS EXISTS. `db:migrate --fresh` recreates the workspace row with a new
 * UUID. A memo held for the process lifetime would then point at a row that no
 * longer exists, and every write would fail with a foreign-key violation until
 * someone restarted the API — a failure whose message says nothing about the
 * reset that caused it. Re-reading by slug on a short interval makes a reset
 * self-healing instead, at the cost of one indexed lookup every thirty seconds.
 */
const WORKSPACE_TTL_MS = 30_000

export async function currentWorkspaceId(): Promise<string> {
  if (cachedWorkspaceId && Date.now() - cachedWorkspaceAt < WORKSPACE_TTL_MS) {
    return cachedWorkspaceId
  }

  const slug = config.core.workspaceSlug
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM workspaces WHERE slug = $1',
    [slug],
  )
  if (existing) {
    cachedWorkspaceId = existing.id
    cachedWorkspaceAt = Date.now()
    return existing.id
  }

  const created = await queryOne<{ id: string }>(
    `INSERT INTO workspaces (name, slug) VALUES ($1, $2)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name
     RETURNING id`,
    [`Ethara.AI · ${slug}`, slug],
  )
  if (!created) throw new Error(`Could not resolve workspace "${slug}"`)
  cachedWorkspaceId = created.id
  cachedWorkspaceAt = Date.now()
  return created.id
}

/** Clears the memo. Used by tests and after a reseed. */
export function forgetWorkspace(): void {
  cachedWorkspaceId = null
  cachedWorkspaceAt = 0
}

export interface WorkspaceRow {
  id: string
  name: string
  slug: string
  brand_voice: string | null
  audience: string | null
  settings: Record<string, unknown>
}

export async function getWorkspace(workspaceId: string): Promise<WorkspaceRow | null> {
  return queryOne<WorkspaceRow>('SELECT * FROM workspaces WHERE id = $1', [workspaceId])
}

/* ═══════════════════════════════════════════════════════════════════════════
   KEYWORDS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface KeywordRow {
  id: string
  term: string
  category: string
  weight: number
  active: boolean
  created_at: string
}

export async function listKeywords(
  workspaceId: string,
  activeOnly = false,
): Promise<KeywordRow[]> {
  return query<KeywordRow>(
    `SELECT id, term, category, weight, active, created_at
       FROM keywords
      WHERE workspace_id = $1 ${activeOnly ? 'AND active = true' : ''}
      ORDER BY weight DESC, term ASC`,
    [workspaceId],
  )
}

export async function createKeyword(
  workspaceId: string,
  term: string,
  category: string,
  weight: number,
): Promise<KeywordRow | null> {
  return queryOne<KeywordRow>(
    `INSERT INTO keywords (workspace_id, term, category, weight)
     VALUES ($1, $2, $3, $4)
     ON CONFLICT (workspace_id, lower(term)) DO UPDATE
       SET weight = EXCLUDED.weight, category = EXCLUDED.category, active = true
     RETURNING id, term, category, weight, active, created_at`,
    [workspaceId, term.trim(), category, weight],
  )
}

export async function updateKeyword(
  workspaceId: string,
  id: string,
  patch: { term?: string; category?: string; weight?: number; active?: boolean },
): Promise<KeywordRow | null> {
  return queryOne<KeywordRow>(
    `UPDATE keywords SET
       term     = COALESCE($3, term),
       category = COALESCE($4, category),
       weight   = COALESCE($5, weight),
       active   = COALESCE($6, active)
     WHERE workspace_id = $1 AND id = $2
     RETURNING id, term, category, weight, active, created_at`,
    [
      workspaceId,
      id,
      patch.term ?? null,
      patch.category ?? null,
      patch.weight ?? null,
      patch.active ?? null,
    ],
  )
}

export async function findKeywordByTerm(
  workspaceId: string,
  term: string,
): Promise<KeywordRow | null> {
  return queryOne<KeywordRow>(
    `SELECT id, term, category, weight, active, created_at
       FROM keywords WHERE workspace_id = $1 AND lower(term) = lower($2)`,
    [workspaceId, term],
  )
}

/**
 * Deactivates rather than deletes, so historical signals keep a valid parent.
 * There is no hard delete for a keyword anywhere in the product.
 */
export async function deactivateKeyword(workspaceId: string, id: string): Promise<boolean> {
  const row = await queryOne<{ id: string }>(
    `UPDATE keywords SET active = false
      WHERE workspace_id = $1 AND id = $2 RETURNING id`,
    [workspaceId, id],
  )
  return row !== null
}

/* ═══════════════════════════════════════════════════════════════════════════
   KEYWORD SIGNALS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface KeywordSignalRow {
  id: string
  keyword_id: string
  term: string
  run_id: string | null
  post_count: number
  total_engagement: number
  avg_engagement: string
  velocity: string
  growth_pct: string
  trend_score: number
  rank: number | null
  is_trending: boolean
  trend_reason: string | null
  search_url: string | null
  top_post_url: string | null
  top_post_title: string | null
  captured_at: string
}

/** The most recent signal per keyword. */
export async function latestKeywordSignals(
  workspaceId: string,
): Promise<KeywordSignalRow[]> {
  return query<KeywordSignalRow>(
    `SELECT DISTINCT ON (ks.keyword_id)
            ks.id, ks.keyword_id, k.term, ks.run_id, ks.post_count, ks.total_engagement,
            ks.avg_engagement, ks.velocity, ks.growth_pct, ks.trend_score, ks.rank,
            ks.is_trending, ks.trend_reason, ks.search_url, ks.top_post_url, ks.top_post_title,
            ks.captured_at
       FROM keyword_signals ks
       JOIN keywords k ON k.id = ks.keyword_id
      WHERE ks.workspace_id = $1
      ORDER BY ks.keyword_id, ks.captured_at DESC`,
    [workspaceId],
  )
}

/** The current trending set, ordered by rank. */
export async function trendingKeywords(
  workspaceId: string,
  limit = 5,
): Promise<KeywordSignalRow[]> {
  const all = await latestKeywordSignals(workspaceId)
  return all
    .filter((s) => s.is_trending)
    .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
    .slice(0, limit)
}

/**
 * The prior-run averages that `validation.keyword.trend` computes growth from.
 * Excludes the run being written, so a run never compares against itself.
 */
export async function priorKeywordAverages(
  workspaceId: string,
  windowRuns: number,
  excludeRunId?: string,
): Promise<Map<string, { avgEngagement: number; avgPosts: number; runs: number }>> {
  const rows = await query<{
    keyword_id: string
    total_engagement: number
    post_count: number
    captured_at: string
  }>(
    `SELECT keyword_id, total_engagement, post_count, captured_at
       FROM keyword_signals
      WHERE workspace_id = $1 ${excludeRunId ? 'AND (run_id IS NULL OR run_id <> $2)' : ''}
      ORDER BY captured_at DESC`,
    excludeRunId ? [workspaceId, excludeRunId] : [workspaceId],
  )

  const byKeyword = new Map<string, Array<{ engagement: number; posts: number }>>()
  for (const row of rows) {
    const list = byKeyword.get(row.keyword_id) ?? []
    if (list.length < windowRuns) {
      list.push({ engagement: row.total_engagement, posts: row.post_count })
      byKeyword.set(row.keyword_id, list)
    }
  }

  const out = new Map<string, { avgEngagement: number; avgPosts: number; runs: number }>()
  for (const [keywordId, list] of byKeyword) {
    if (list.length === 0) continue
    out.set(keywordId, {
      avgEngagement: list.reduce((n, r) => n + r.engagement, 0) / list.length,
      avgPosts: list.reduce((n, r) => n + r.posts, 0) / list.length,
      runs: list.length,
    })
  }
  return out
}

export interface KeywordSignalInsert {
  keywordId: string
  runId: string
  postCount: number
  totalEngagement: number
  avgEngagement: number
  velocity: number
  growthPct: number
  trendScore: number
  rank: number
  isTrending: boolean
  trendReason: string
  searchUrl: string
  topPostUrl: string | null
  topPostTitle: string | null
}

export async function insertKeywordSignal(
  workspaceId: string,
  s: KeywordSignalInsert,
): Promise<void> {
  await query(
    `INSERT INTO keyword_signals
       (workspace_id, keyword_id, run_id, post_count, total_engagement, avg_engagement,
        velocity, growth_pct, trend_score, rank, is_trending, trend_reason,
        search_url, top_post_url, top_post_title)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)`,
    [
      workspaceId,
      s.keywordId,
      s.runId,
      s.postCount,
      s.totalEngagement,
      s.avgEngagement,
      s.velocity,
      s.growthPct,
      s.trendScore,
      s.rank,
      s.isTrending,
      s.trendReason,
      s.searchUrl,
      s.topPostUrl,
      s.topPostTitle,
    ],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   SOURCES
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SourceRow {
  id: string
  name: string
  kind: string
  source_type: string
  url: string | null
  trusted: boolean
  enabled: boolean
}

export async function listSources(workspaceId: string): Promise<SourceRow[]> {
  return query<SourceRow>(
    `SELECT id, name, kind, source_type, url, trusted, enabled
       FROM sources WHERE workspace_id = $1 ORDER BY name`,
    [workspaceId],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCRAPED ITEMS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ScrapedItemRow {
  id: string
  keyword_id: string | null
  keyword_term: string | null
  run_id: string | null
  external_id: string | null
  title: string
  snippet: string | null
  url: string | null
  source_name: string | null
  source_type: string | null
  author_name: string | null
  author_headline: string | null
  author_followers: number | null
  hashtags: string[]
  engagement: number
  reactions: number
  comments: number
  reposts: number
  relevance: number
  credibility: string
  freshness: number
  is_duplicate: boolean
  duplicate_of_id: string | null
  validation: ValidationVerdict
  verdict_reason: string | null
  capture_source: 'live' | 'fixture'
  /** The lane that captured it. `null` IS the open-web lane, not a gap. */
  platform: Platform | null
  /** False for everything a search-indexed crawl returns — see the schema note. */
  metrics_available: boolean
  brand_relevance: number
  posted_at: string | null
  scraped_at: string
}

export async function listScrapedItems(
  workspaceId: string,
  opts: { limit?: number; validation?: ValidationVerdict } = {},
): Promise<ScrapedItemRow[]> {
  const params: Array<string | number> = [workspaceId]
  let where = 'si.workspace_id = $1'
  if (opts.validation) {
    params.push(opts.validation)
    where += ` AND si.validation = $${params.length}`
  }
  params.push(opts.limit ?? 200)

  return query<ScrapedItemRow>(
    `SELECT si.*, k.term AS keyword_term
       FROM scraped_items si
       LEFT JOIN keywords k ON k.id = si.keyword_id
      WHERE ${where}
      ORDER BY si.scraped_at DESC
      LIMIT $${params.length}`,
    params,
  )
}

/** External ids captured within the look-back window, for the dedupe pre-filter. */
export interface RecentCapture {
  id: string
  /** When the page was first captured. */
  scrapedAt: string
  title: string
  /** The verdict the earlier run gave it, so a repeat can show it rather than hide it. */
  validation: ValidationVerdict
  verdictReason: string | null
}

/**
 * Pages captured inside the look-back window, keyed by external id AND by
 * URL so a repeat is recognised by either. The original's capture date and
 * title travel with it, so a run can say how long a page has been on record
 * rather than only that it is.
 */
export async function recentCaptures(
  workspaceId: string,
  historyDays: number,
): Promise<Map<string, RecentCapture>> {
  const rows = await query<{
    id: string
    external_id: string | null
    url: string | null
    scraped_at: string
    title: string
    validation: ValidationVerdict
    verdict_reason: string | null
  }>(
    `SELECT id, external_id, url, scraped_at, title, validation, verdict_reason FROM scraped_items
      WHERE workspace_id = $1 AND scraped_at > now() - ($2 || ' days')::interval`,
    [workspaceId, String(historyDays)],
  )
  const index = new Map<string, RecentCapture>()
  for (const r of rows) {
    const capture: RecentCapture = {
      id: r.id,
      scrapedAt: r.scraped_at,
      title: r.title,
      validation: r.validation,
      verdictReason: r.verdict_reason,
    }
    if (r.external_id) index.set(r.external_id, capture)
    if (r.url) index.set(r.url, capture)
  }
  return index
}

export async function setItemValidation(
  workspaceId: string,
  id: string,
  validation: ValidationVerdict,
  reason?: string,
): Promise<ScrapedItemRow | null> {
  return queryOne<ScrapedItemRow>(
    `UPDATE scraped_items
        SET validation = $3,
            verdict_reason = COALESCE($4, verdict_reason),
            validated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING *`,
    [workspaceId, id, validation, reason ?? null],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   HASHTAGS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface HashtagRow {
  id: string
  tag: string
  display_tag: string
  keyword_id: string | null
  keyword_term: string | null
  run_id: string | null
  post_count: number
  total_engagement: number
  engagement_per_post: string
  relevance: number
  credibility: string
  freshness: number
  hashtag_score: number
  rank: number | null
  validation: ValidationVerdict
  verdict_reason: string | null
  duplicate_of_id: string | null
  duplicate_of_tag: string | null
  in_top_set: boolean
  researched_at: string | null
  first_seen_at: string
  last_seen_at: string
  feed_url: string | null
  top_post_url: string | null
  top_post_title: string | null
}

export async function listHashtags(
  workspaceId: string,
  opts: { status?: ValidationVerdict; keywordId?: string; top?: boolean; limit?: number } = {},
): Promise<HashtagRow[]> {
  const params: Array<string | number> = [workspaceId]
  let where = 'h.workspace_id = $1'

  if (opts.status) {
    params.push(opts.status)
    where += ` AND h.validation = $${params.length}`
  }
  if (opts.keywordId) {
    params.push(opts.keywordId)
    where += ` AND h.keyword_id = $${params.length}`
  }
  if (opts.top) where += ' AND h.in_top_set = true'

  params.push(opts.limit ?? 300)

  return query<HashtagRow>(
    `SELECT h.*, k.term AS keyword_term, o.display_tag AS duplicate_of_tag
       FROM hashtags h
       LEFT JOIN keywords k ON k.id = h.keyword_id
       LEFT JOIN hashtags o ON o.id = h.duplicate_of_id
      WHERE ${where}
      ORDER BY h.rank NULLS LAST, h.hashtag_score DESC
      LIMIT $${params.length}`,
    params,
  )
}

export async function findHashtagByTag(
  workspaceId: string,
  tag: string,
): Promise<HashtagRow | null> {
  const normalised = tag.replace(/^#/, '').toLowerCase()
  return queryOne<HashtagRow>(
    `SELECT h.*, k.term AS keyword_term, o.display_tag AS duplicate_of_tag
       FROM hashtags h
       LEFT JOIN keywords k ON k.id = h.keyword_id
       LEFT JOIN hashtags o ON o.id = h.duplicate_of_id
      WHERE h.workspace_id = $1 AND h.tag = $2
      ORDER BY h.last_seen_at DESC
      LIMIT 1`,
    [workspaceId, normalised],
  )
}

export async function setHashtagValidation(
  workspaceId: string,
  id: string,
  validation: ValidationVerdict,
  reason?: string,
): Promise<HashtagRow | null> {
  return queryOne<HashtagRow>(
    `UPDATE hashtags
        SET validation = $3,
            verdict_reason = COALESCE($4, verdict_reason),
            validated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING *, NULL::text AS keyword_term, NULL::text AS duplicate_of_tag`,
    [workspaceId, id, validation, reason ?? null],
  )
}

export async function markHashtagResearched(
  workspaceId: string,
  id: string,
): Promise<void> {
  await query(
    'UPDATE hashtags SET researched_at = now() WHERE workspace_id = $1 AND id = $2',
    [workspaceId, id],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTENT IDEAS, DRAFTS AND MEDIA
   ═══════════════════════════════════════════════════════════════════════════ */

export interface IdeaRow {
  id: string
  source_item_id: string | null
  hashtag_id: string | null
  hashtag_display: string | null
  /** The captured page this idea was formed from, joined from scraped_items. */
  source_url: string | null
  source_title: string | null
  source_name: string | null
  /** The strongest post carrying the originating hashtag, when the idea came from a tag. */
  hashtag_url: string | null
  title: string
  description: string | null
  source_topic: string | null
  platform: Platform
  alt_platforms: Array<{ platform: Platform; score: number }>
  scheduled_date: string
  scheduled_time: string
  confidence: number
  priority_score: number
  platform_rank: number | null
  calendar_slot: CalendarSlot
  status: IdeaStatus
  analysis: Record<string, unknown>
  feedback: Array<Record<string, unknown>>
  is_new_trend: boolean
  marketing_approved_by: string | null
  marketing_approved_at: string | null
  leadership_decision: Record<string, unknown> | null
  created_at: string
  updated_at: string
}

export async function listIdeas(
  workspaceId: string,
  opts: {
    platform?: Platform
    status?: IdeaStatus
    slot?: CalendarSlot
    date?: string
    limit?: number
  } = {},
): Promise<IdeaRow[]> {
  const params: Array<string | number> = [workspaceId]
  let where = 'ci.workspace_id = $1'

  if (opts.platform) {
    params.push(opts.platform)
    where += ` AND ci.platform = $${params.length}`
  }
  if (opts.status) {
    params.push(opts.status)
    where += ` AND ci.status = $${params.length}`
  }
  if (opts.slot) {
    params.push(opts.slot)
    where += ` AND ci.calendar_slot = $${params.length}`
  }
  if (opts.date) {
    params.push(opts.date)
    where += ` AND ci.scheduled_date = $${params.length}::date`
  }
  params.push(opts.limit ?? 200)

  return query<IdeaRow>(
    `SELECT ci.*, h.display_tag AS hashtag_display, h.top_post_url AS hashtag_url,
            si.url AS source_url, si.title AS source_title, si.source_name AS source_name
       FROM content_ideas ci
       LEFT JOIN hashtags h ON h.id = ci.hashtag_id
       LEFT JOIN scraped_items si ON si.id = ci.source_item_id
      WHERE ${where}
      ORDER BY ci.scheduled_date ASC, ci.platform_rank NULLS LAST, ci.scheduled_time ASC
      LIMIT $${params.length}`,
    params,
  )
}

export async function getIdea(workspaceId: string, id: string): Promise<IdeaRow | null> {
  return queryOne<IdeaRow>(
    `SELECT ci.*, h.display_tag AS hashtag_display, h.top_post_url AS hashtag_url,
            si.url AS source_url, si.title AS source_title, si.source_name AS source_name
       FROM content_ideas ci
       LEFT JOIN hashtags h ON h.id = ci.hashtag_id
       LEFT JOIN scraped_items si ON si.id = ci.source_item_id
      WHERE ci.workspace_id = $1 AND ci.id = $2`,
    [workspaceId, id],
  )
}

/**
 * Fuzzy title lookup, for Ethara resolving "publish the reward models post".
 * The Dice threshold lives with the caller; this returns candidates in order.
 */
export async function findIdeasByTitle(
  workspaceId: string,
  fragment: string,
  limit = 8,
): Promise<IdeaRow[]> {
  return query<IdeaRow>(
    `SELECT ci.*, h.display_tag AS hashtag_display, h.top_post_url AS hashtag_url,
            si.url AS source_url, si.title AS source_title, si.source_name AS source_name
       FROM content_ideas ci
       LEFT JOIN hashtags h ON h.id = ci.hashtag_id
       LEFT JOIN scraped_items si ON si.id = ci.source_item_id
      WHERE ci.workspace_id = $1 AND ci.title ILIKE '%' || $2 || '%'
      ORDER BY ci.scheduled_date DESC
      LIMIT $3`,
    [workspaceId, fragment, limit],
  )
}

export async function updateIdea(
  workspaceId: string,
  id: string,
  patch: {
    scheduledDate?: string
    scheduledTime?: string
    platform?: Platform
    status?: IdeaStatus
    calendarSlot?: CalendarSlot
    platformRank?: number
    analysis?: Record<string, unknown>
    /**
     * The card's own line. Set by the Caption Agent once the post has been
     * written, replacing the headline that `analysis.trend.cluster` lifted from
     * the source post. `upsertIdea` matches on title + platform, so this is a
     * rename of an existing row rather than a route to a second copy.
     */
    title?: string
  },
): Promise<IdeaRow | null> {
  return queryOne<IdeaRow>(
    `UPDATE content_ideas SET
       scheduled_date = COALESCE($3::date, scheduled_date),
       scheduled_time = COALESCE($4, scheduled_time),
       platform       = COALESCE($5, platform),
       status         = COALESCE($6, status),
       calendar_slot  = COALESCE($7, calendar_slot),
       platform_rank  = COALESCE($8, platform_rank),
       analysis       = COALESCE($9::jsonb, analysis),
       title          = COALESCE($10, title),
       updated_at     = now()
     WHERE workspace_id = $1 AND id = $2
     RETURNING *, NULL::text AS hashtag_display`,
    [
      workspaceId,
      id,
      patch.scheduledDate ?? null,
      patch.scheduledTime ?? null,
      patch.platform ?? null,
      patch.status ?? null,
      patch.calendarSlot ?? null,
      patch.platformRank ?? null,
      patch.analysis ? JSON.stringify(patch.analysis) : null,
      patch.title ?? null,
    ],
  )
}

/** Primary ideas on one platform, weakest rank last — used by the promote rule. */
export async function primaryIdeasForPlatform(
  workspaceId: string,
  platform: Platform,
): Promise<IdeaRow[]> {
  return query<IdeaRow>(
    `SELECT ci.*, NULL::text AS hashtag_display
       FROM content_ideas ci
      WHERE ci.workspace_id = $1 AND ci.platform = $2 AND ci.calendar_slot = 'primary'
      ORDER BY ci.platform_rank NULLS LAST`,
    [workspaceId, platform],
  )
}

export interface DraftRow {
  id: string
  idea_id: string
  platform: Platform
  body: string
  revision: number
  generated_by: string | null
  model: string | null
  source: 'live' | 'fixture'
  updated_at: string
}

export async function getDraft(
  ideaId: string,
  platform: Platform,
): Promise<DraftRow | null> {
  return queryOne<DraftRow>(
    'SELECT * FROM drafts WHERE idea_id = $1 AND platform = $2',
    [ideaId, platform],
  )
}

/**
 * Upserts a draft, INCREMENTING the revision rather than overwriting silently.
 * A draft versions; it is never replaced in a way that loses what came before.
 */
export async function upsertDraft(d: {
  ideaId: string
  platform: Platform
  body: string
  generatedBy: string
  model: string
  source: 'live' | 'fixture'
}): Promise<DraftRow | null> {
  return queryOne<DraftRow>(
    `INSERT INTO drafts (idea_id, platform, body, revision, generated_by, model, source)
     VALUES ($1,$2,$3,1,$4,$5,$6)
     ON CONFLICT (idea_id, platform) DO UPDATE
       SET body = EXCLUDED.body,
           revision = drafts.revision + 1,
           generated_by = EXCLUDED.generated_by,
           model = EXCLUDED.model,
           source = EXCLUDED.source,
           updated_at = now()
     RETURNING *`,
    [d.ideaId, d.platform, d.body, d.generatedBy, d.model, d.source],
  )
}

export async function listDraftsForIdeas(ideaIds: string[]): Promise<DraftRow[]> {
  if (ideaIds.length === 0) return []
  return query<DraftRow>('SELECT * FROM drafts WHERE idea_id = ANY($1::uuid[])', [ideaIds])
}

export interface MediaAssetRow {
  id: string
  idea_id: string
  platform: Platform
  kind: string
  concept: string | null
  canvas: string | null
  width: number | null
  height: number | null
  alt_text: string | null
  render_mode: 'demo' | 'live'
  model: string
  prompt: string | null
  fallback_reason: string | null
  data_uri: string
  variants: unknown[]
}

export async function upsertMediaAsset(a: {
  ideaId: string
  platform: Platform
  concept: string
  canvas: string
  width: number
  height: number
  altText: string
  renderMode: 'demo' | 'live'
  model: string
  prompt: string
  fallbackReason: string | null
  dataUri: string
}): Promise<MediaAssetRow | null> {
  return queryOne<MediaAssetRow>(
    `INSERT INTO media_assets
       (idea_id, platform, kind, concept, canvas, width, height, alt_text,
        render_mode, model, prompt, fallback_reason, data_uri)
     VALUES ($1,$2,'single',$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
     ON CONFLICT (idea_id, platform) DO UPDATE
       SET concept = EXCLUDED.concept, canvas = EXCLUDED.canvas,
           width = EXCLUDED.width, height = EXCLUDED.height,
           alt_text = EXCLUDED.alt_text, render_mode = EXCLUDED.render_mode,
           model = EXCLUDED.model, prompt = EXCLUDED.prompt,
           fallback_reason = EXCLUDED.fallback_reason, data_uri = EXCLUDED.data_uri,
           updated_at = now()
     RETURNING *`,
    [
      a.ideaId,
      a.platform,
      a.concept,
      a.canvas,
      a.width,
      a.height,
      a.altText,
      a.renderMode,
      a.model,
      a.prompt,
      a.fallbackReason,
      a.dataUri,
    ],
  )
}

export async function getMediaAsset(
  ideaId: string,
  platform: Platform,
): Promise<MediaAssetRow | null> {
  return queryOne<MediaAssetRow>(
    'SELECT * FROM media_assets WHERE idea_id = $1 AND platform = $2',
    [ideaId, platform],
  )
}

/**
 * One creative by its own id.
 *
 * Exists for the public media route, which is addressed by asset id rather than
 * by idea and platform — Buffer fetches a URL and knows nothing about either.
 */
export async function mediaAssetById(id: string): Promise<MediaAssetRow | null> {
  return queryOne<MediaAssetRow>('SELECT * FROM media_assets WHERE id = $1', [id])
}

export async function listMediaForIdeas(ideaIds: string[]): Promise<MediaAssetRow[]> {
  if (ideaIds.length === 0) return []
  return query<MediaAssetRow>(
    'SELECT * FROM media_assets WHERE idea_id = ANY($1::uuid[])',
    [ideaIds],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   POSTS AND METRICS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PostRow {
  id: string
  idea_id: string | null
  title: string
  platform: Platform
  content: string
  status: string
  external_id: string | null
  publish_mode: 'demo' | 'live'
  published_at: string | null
  history: Array<Record<string, unknown>>
  media_asset_id: string | null
  analysis_summary: string | null
  analysis_recommendation: string | null
  reach: number | null
  impressions: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  engagement_rate: string | null
  metrics_captured_at: string | null
  data_uri: string | null
}

/**
 * Published posts with their LATEST metrics reading.
 * The LATERAL join is how metrics are always read — never by overwriting.
 */
export async function listPosts(
  workspaceId: string,
  opts: { platform?: Platform; limit?: number } = {},
): Promise<PostRow[]> {
  const params: Array<string | number> = [workspaceId]
  let where = 'p.workspace_id = $1'
  if (opts.platform) {
    params.push(opts.platform)
    where += ` AND p.platform = $${params.length}`
  }
  params.push(opts.limit ?? 100)

  return query<PostRow>(
    `SELECT p.*, m.reach, m.impressions, m.likes, m.comments, m.shares,
            m.engagement_rate, m.captured_at AS metrics_captured_at,
            ma.data_uri
       FROM posts p
       LEFT JOIN LATERAL (
         SELECT reach, impressions, likes, comments, shares, engagement_rate, captured_at
           FROM post_metrics
          WHERE post_id = p.id
          ORDER BY captured_at DESC
          LIMIT 1
       ) m ON true
       LEFT JOIN media_assets ma ON ma.id = p.media_asset_id
      WHERE ${where}
      ORDER BY p.published_at DESC NULLS LAST, p.created_at DESC
      LIMIT $${params.length}`,
    params,
  )
}

export async function getPost(workspaceId: string, id: string): Promise<PostRow | null> {
  const rows = await query<PostRow>(
    `SELECT p.*, m.reach, m.impressions, m.likes, m.comments, m.shares,
            m.engagement_rate, m.captured_at AS metrics_captured_at, ma.data_uri
       FROM posts p
       LEFT JOIN LATERAL (
         SELECT reach, impressions, likes, comments, shares, engagement_rate, captured_at
           FROM post_metrics WHERE post_id = p.id ORDER BY captured_at DESC LIMIT 1
       ) m ON true
       LEFT JOIN media_assets ma ON ma.id = p.media_asset_id
      WHERE p.workspace_id = $1 AND p.id = $2`,
    [workspaceId, id],
  )
  return rows[0] ?? null
}

export async function insertPost(p: {
  workspaceId: string
  ideaId: string | null
  title: string
  platform: Platform
  content: string
  externalId: string
  publishMode: 'demo' | 'live'
  publishedAt: string
  history: Array<Record<string, unknown>>
  mediaAssetId: string | null
}): Promise<{ id: string } | null> {
  /*
   * ON CONFLICT DO NOTHING against the unique receipt index: if two concurrent
   * publishes reach here with the same external_id, the second inserts nothing
   * and the existing row is returned below. One dispatch, one post, and the
   * caller still gets an id rather than an error it cannot act on.
   */
  const inserted = await queryOne<{ id: string }>(
    `INSERT INTO posts
       (workspace_id, idea_id, title, platform, content, status, external_id,
        publish_mode, published_at, history, media_asset_id)
     VALUES ($1,$2,$3,$4,$5,'published',$6,$7,$8::date,$9,$10)
     ON CONFLICT (workspace_id, external_id) WHERE external_id IS NOT NULL
       DO NOTHING
     RETURNING id`,
    [
      p.workspaceId,
      p.ideaId,
      p.title,
      p.platform,
      p.content,
      p.externalId,
      p.publishMode,
      p.publishedAt,
      JSON.stringify(p.history),
      p.mediaAssetId,
    ],
  )
  if (inserted) return inserted

  // The receipt was already recorded. Return the row that holds it.
  return queryOne<{ id: string }>(
    'SELECT id FROM posts WHERE workspace_id = $1 AND external_id = $2',
    [p.workspaceId, p.externalId],
  )
}

/** Appends a metrics reading. Never updates an existing row. */
export async function insertPostMetrics(m: {
  postId: string
  reach: number
  impressions: number
  likes: number
  comments: number
  shares: number
  engagementRate: number
}): Promise<void> {
  await query(
    `INSERT INTO post_metrics
       (post_id, reach, impressions, likes, comments, shares, engagement_rate)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [m.postId, m.reach, m.impressions, m.likes, m.comments, m.shares, m.engagementRate],
  )
}

export async function setPostAnalysis(
  workspaceId: string,
  postId: string,
  summary: string,
  recommendation: string,
): Promise<void> {
  await query(
    `UPDATE posts SET analysis_summary = $3, analysis_recommendation = $4
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, postId, summary, recommendation],
  )
}

/** The trailing baseline for a platform, from THIS account's own history. */
export async function postBaseline(
  workspaceId: string,
  platform: Platform,
  windowPosts: number,
): Promise<{ avgReach: number; avgEngagementRate: number; samples: number }> {
  const rows = await query<{ reach: number; engagement_rate: string }>(
    `SELECT m.reach, m.engagement_rate
       FROM posts p
       JOIN LATERAL (
         SELECT reach, engagement_rate FROM post_metrics
          WHERE post_id = p.id ORDER BY captured_at DESC LIMIT 1
       ) m ON true
      WHERE p.workspace_id = $1 AND p.platform = $2 AND p.status = 'published'
      ORDER BY p.published_at DESC
      LIMIT $3`,
    [workspaceId, platform, windowPosts],
  )
  if (rows.length === 0) return { avgReach: 0, avgEngagementRate: 0, samples: 0 }
  return {
    avgReach: rows.reduce((n, r) => n + r.reach, 0) / rows.length,
    avgEngagementRate:
      rows.reduce((n, r) => n + Number(r.engagement_rate), 0) / rows.length,
    samples: rows.length,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLATFORM ANALYTICS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PlatformAnalyticsRow {
  id: string
  platform: Platform
  month: string
  label: string | null
  is_reported: boolean
  metrics: Record<string, number>
  daily: Array<{ date: string; value: number }>
}

export async function listPlatformAnalytics(
  workspaceId: string,
  opts: { platform?: Platform; month?: string } = {},
): Promise<PlatformAnalyticsRow[]> {
  const params: string[] = [workspaceId]
  let where = 'workspace_id = $1'
  if (opts.platform) {
    params.push(opts.platform)
    where += ` AND platform = $${params.length}`
  }
  if (opts.month) {
    params.push(opts.month)
    where += ` AND month = $${params.length}`
  }
  return query<PlatformAnalyticsRow>(
    `SELECT * FROM platform_analytics WHERE ${where} ORDER BY month DESC, platform`,
    params,
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   KNOWLEDGE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface KnowledgeEntryRow {
  id: string
  title: string
  category: string
  content: string
  source: string
  sources: Array<{ title: string; url: string; publishedAt?: string }>
  hashtag_id: string | null
  hashtag_display: string | null
  tags: string[]
  confidence: 'High' | 'Medium' | 'Low'
  evidence_count: number
  active: boolean
  origin: string
  build_id: string | null
  created_at: string
}

export async function listKnowledge(
  workspaceId: string,
  opts: {
    activeOnly?: boolean
    category?: string
    limit?: number
    /** Restricts to one origin, e.g. `'brand'` for the brand corpus. */
    origin?: string
    /** Every listed entry must carry this tag. Used to separate corpus from rules. */
    tag?: string
    /** Excludes entries carrying this tag. */
    withoutTag?: string
  } = {},
): Promise<KnowledgeEntryRow[]> {
  const params: Array<string | number> = [workspaceId]
  let where = 'ke.workspace_id = $1'
  if (opts.activeOnly) where += ' AND ke.active = true'
  if (opts.category) {
    params.push(opts.category)
    where += ` AND ke.category = $${params.length}`
  }
  if (opts.origin) {
    params.push(opts.origin)
    where += ` AND ke.origin = $${params.length}`
  }
  if (opts.tag) {
    params.push(opts.tag)
    where += ` AND $${params.length} = ANY(ke.tags)`
  }
  if (opts.withoutTag) {
    params.push(opts.withoutTag)
    where += ` AND NOT ($${params.length} = ANY(ke.tags))`
  }
  params.push(opts.limit ?? 500)

  return query<KnowledgeEntryRow>(
    `SELECT ke.*, h.display_tag AS hashtag_display
       FROM knowledge_entries ke
       LEFT JOIN hashtags h ON h.id = ke.hashtag_id
      WHERE ${where}
      ORDER BY
        CASE ke.confidence WHEN 'High' THEN 0 WHEN 'Medium' THEN 1 ELSE 2 END,
        ke.created_at DESC
      LIMIT $${params.length}`,
    params,
  )
}

/**
 * How many knowledge entries there actually are.
 *
 * `/state` sends a capped page of entries (400) for rendering, and the Dashboard
 * counted the length of that page — so once the corpus pushed the store past the
 * cap, the "Knowledge base" figure silently became the cap rather than the truth.
 * A count is one cheap query and cannot be truncated.
 */
export async function countKnowledge(
  workspaceId: string,
): Promise<{ total: number; active: number }> {
  const row = await queryOne<{ total: string; active: string }>(
    `SELECT count(*)::text AS total,
            count(*) FILTER (WHERE active)::text AS active
       FROM knowledge_entries WHERE workspace_id = $1`,
    [workspaceId],
  )
  return { total: Number(row?.total ?? 0), active: Number(row?.active ?? 0) }
}

export async function insertKnowledgeEntry(e: {
  workspaceId: string
  title: string
  category: string
  content: string
  source: string
  sources: Array<{ title: string; url: string; publishedAt?: string }>
  hashtagId: string | null
  confidence: 'High' | 'Medium' | 'Low'
  origin: string
  buildId: string | null
  tags: string[]
}): Promise<{ id: string } | null> {
  /*
   * EMBEDDED ON WRITE, BUT NEVER AT THE COST OF THE WRITE.
   *
   * `embedOne` does not throw — an unreachable embedder yields `null`, the row
   * lands with a NULL embedding, and `npm run db:embed` picks it up later. The
   * alternative, letting an embedding failure reject the insert, would lose a
   * cited finding because a model was restarting. Retrieval degrades; the
   * corpus does not.
   */
  const { vector } = await embedOne(embeddableText(e.title, e.content), 'document')

  return queryOne<{ id: string }>(
    `INSERT INTO knowledge_entries
       (workspace_id, title, category, content, source, sources, hashtag_id,
        confidence, evidence_count, active, origin, build_id, tags,
        embedding, embedding_model, embedded_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,true,$10,$11,$12,
        $13::vector, $14, CASE WHEN $13 IS NULL THEN NULL ELSE now() END)
     RETURNING id`,
    [
      e.workspaceId,
      e.title,
      e.category,
      e.content,
      e.source,
      JSON.stringify(e.sources),
      e.hashtagId,
      e.confidence,
      Math.max(1, e.sources.length),
      e.origin,
      e.buildId,
      e.tags,
      vector === null ? null : toSqlVector(vector),
      vector === null ? null : embeddingModelId(),
    ],
  )
}

/** Merges evidence into an existing entry rather than inserting a duplicate. */
export async function mergeKnowledgeEntry(
  id: string,
  addSources: Array<{ title: string; url: string; publishedAt?: string }>,
  promote: boolean,
): Promise<void> {
  await query(
    `UPDATE knowledge_entries
        SET sources = (
              SELECT jsonb_agg(DISTINCT s)
                FROM jsonb_array_elements(sources || $2::jsonb) s
            ),
            evidence_count = evidence_count + $3,
            confidence = CASE
              WHEN $4 AND confidence = 'Low' THEN 'Medium'
              WHEN $4 AND confidence = 'Medium' THEN 'High'
              ELSE confidence END,
            updated_at = now()
      WHERE id = $1`,
    [id, JSON.stringify(addSources), addSources.length, promote],
  )
}

/** Deactivates rather than deleting. There is no delete route for knowledge. */
export async function setKnowledgeActive(
  workspaceId: string,
  id: string,
  active: boolean,
): Promise<KnowledgeEntryRow | null> {
  return queryOne<KnowledgeEntryRow>(
    `UPDATE knowledge_entries SET active = $3, updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING *, NULL::text AS hashtag_display`,
    [workspaceId, id, active],
  )
}

export async function setKnowledgeConfidence(
  id: string,
  confidence: 'High' | 'Medium' | 'Low',
): Promise<void> {
  await query(
    'UPDATE knowledge_entries SET confidence = $2, updated_at = now() WHERE id = $1',
    [id, confidence],
  )
}

export interface KnowledgeBuildRow {
  id: string
  trigger: string
  status: string
  hashtags_researched: number
  entries_written: number
  entries_merged: number
  sources_cited: number
  research_source: 'live' | 'fixture'
  started_at: string
  finished_at: string | null
  summary: Record<string, unknown>
  error: string | null
}

export async function startKnowledgeBuild(
  workspaceId: string,
  trigger: 'cron' | 'manual' | 'assistant',
): Promise<KnowledgeBuildRow | null> {
  return queryOne<KnowledgeBuildRow>(
    `INSERT INTO knowledge_builds (workspace_id, trigger, status)
     VALUES ($1,$2,'running') RETURNING *`,
    [workspaceId, trigger],
  )
}

export async function finishKnowledgeBuild(
  id: string,
  patch: {
    status: 'completed' | 'failed'
    hashtagsResearched: number
    entriesWritten: number
    entriesMerged: number
    sourcesCited: number
    researchSource: 'live' | 'fixture'
    summary: Record<string, unknown>
    error?: string
  },
): Promise<void> {
  await query(
    `UPDATE knowledge_builds SET
       status = $2, hashtags_researched = $3, entries_written = $4,
       entries_merged = $5, sources_cited = $6, research_source = $7,
       summary = $8::jsonb, error = $9, finished_at = now()
     WHERE id = $1`,
    [
      id,
      patch.status,
      patch.hashtagsResearched,
      patch.entriesWritten,
      patch.entriesMerged,
      patch.sourcesCited,
      patch.researchSource,
      JSON.stringify(patch.summary),
      patch.error ?? null,
    ],
  )
}

export async function listKnowledgeBuilds(
  workspaceId: string,
  limit = 20,
): Promise<KnowledgeBuildRow[]> {
  return query<KnowledgeBuildRow>(
    `SELECT * FROM knowledge_builds WHERE workspace_id = $1
      ORDER BY started_at DESC LIMIT $2`,
    [workspaceId, limit],
  )
}

export async function latestKnowledgeBuild(
  workspaceId: string,
): Promise<KnowledgeBuildRow | null> {
  const rows = await listKnowledgeBuilds(workspaceId, 1)
  return rows[0] ?? null
}

/* ═══════════════════════════════════════════════════════════════════════════
   AGENT STATE, SKILLS AND RUNS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AgentStateRow {
  agent_id: AgentId
  status: AgentRunStatus
  current_task: string
  last_run: string | null
  processed: number
  success_rate: number
}

export async function listAgentState(workspaceId: string): Promise<AgentStateRow[]> {
  return query<AgentStateRow>(
    `SELECT agent_id, status, current_task, last_run, processed, success_rate
       FROM agent_state WHERE workspace_id = $1`,
    [workspaceId],
  )
}

export async function setAgentState(
  workspaceId: string,
  agentId: AgentId,
  patch: {
    status?: AgentRunStatus
    currentTask?: string
    lastRun?: boolean
    processed?: number
    successRate?: number
  },
): Promise<void> {
  await query(
    `INSERT INTO agent_state
       (workspace_id, agent_id, status, current_task, last_run, processed, success_rate)
     VALUES ($1,$2,COALESCE($3,'idle'),COALESCE($4,'Idle'),
             CASE WHEN $5 THEN now() ELSE NULL END,
             COALESCE($6,0), COALESCE($7,100))
     ON CONFLICT (workspace_id, agent_id) DO UPDATE SET
       status       = COALESCE($3, agent_state.status),
       current_task = COALESCE($4, agent_state.current_task),
       last_run     = CASE WHEN $5 THEN now() ELSE agent_state.last_run END,
       processed    = COALESCE($6, agent_state.processed),
       success_rate = COALESCE($7, agent_state.success_rate)`,
    [
      workspaceId,
      agentId,
      patch.status ?? null,
      patch.currentTask ?? null,
      patch.lastRun ?? false,
      patch.processed ?? null,
      patch.successRate ?? null,
    ],
  )
}

export interface SkillOverrideRow {
  skill_id: string
  agent_id: string
  enabled: boolean
  config: Record<string, unknown>
  updated_at: string
}

export async function listSkillOverrides(
  workspaceId: string,
): Promise<Map<string, SkillOverrideRow>> {
  const rows = await query<SkillOverrideRow>(
    'SELECT skill_id, agent_id, enabled, config, updated_at FROM agent_skills WHERE workspace_id = $1',
    [workspaceId],
  )
  return new Map(rows.map((r) => [r.skill_id, r]))
}

export async function upsertSkillOverride(
  workspaceId: string,
  skillId: string,
  agentId: string,
  patch: { enabled?: boolean; config?: Record<string, unknown> },
): Promise<SkillOverrideRow | null> {
  return queryOne<SkillOverrideRow>(
    `INSERT INTO agent_skills (workspace_id, skill_id, agent_id, enabled, config)
     VALUES ($1,$2,$3,COALESCE($4,true),COALESCE($5::jsonb,'{}'::jsonb))
     ON CONFLICT (workspace_id, skill_id) DO UPDATE SET
       enabled = COALESCE($4, agent_skills.enabled),
       config  = COALESCE($5::jsonb, agent_skills.config),
       updated_at = now()
     RETURNING skill_id, agent_id, enabled, config, updated_at`,
    [
      workspaceId,
      skillId,
      agentId,
      patch.enabled ?? null,
      patch.config ? JSON.stringify(patch.config) : null,
    ],
  )
}

export async function deleteSkillOverride(
  workspaceId: string,
  skillId: string,
): Promise<boolean> {
  const rows = await query<{ skill_id: string }>(
    'DELETE FROM agent_skills WHERE workspace_id = $1 AND skill_id = $2 RETURNING skill_id',
    [workspaceId, skillId],
  )
  return rows.length > 0
}

/** Aggregated run statistics per skill, for the Studio cards. */
export async function skillStats(
  workspaceId: string,
): Promise<Map<string, { runs: number; failures: number; avgMs: number }>> {
  const rows = await query<{
    skill_id: string
    runs: string
    failures: string
    avg_ms: string | null
  }>(
    `SELECT skill_id,
            count(*)::text AS runs,
            count(*) FILTER (WHERE status = 'failed')::text AS failures,
            round(avg(duration_ms))::text AS avg_ms
       FROM skill_runs
      WHERE workspace_id = $1
      GROUP BY skill_id`,
    [workspaceId],
  )
  return new Map(
    rows.map((r) => [
      r.skill_id,
      {
        runs: Number(r.runs),
        failures: Number(r.failures),
        avgMs: Number(r.avg_ms ?? 0),
      },
    ]),
  )
}

export async function startPipelineRun(
  workspaceId: string,
  trigger: string,
  turnId?: string,
): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO pipeline_runs (workspace_id, trigger, status, turn_id)
     VALUES ($1,$2,'running',$3) RETURNING id`,
    [workspaceId, trigger, turnId ?? null],
  )
  if (!row) throw new Error('Could not open a pipeline run')
  return row
}

export async function finishPipelineRun(
  id: string,
  status: 'completed' | 'failed',
  summary: Record<string, unknown>,
): Promise<void> {
  await query(
    `UPDATE pipeline_runs SET status = $2, summary = $3::jsonb, finished_at = now()
      WHERE id = $1`,
    [id, status, JSON.stringify(summary)],
  )
}

export async function countPipelineRuns(workspaceId: string): Promise<number> {
  const row = await queryOne<{ n: string }>(
    'SELECT count(*)::text AS n FROM pipeline_runs WHERE workspace_id = $1',
    [workspaceId],
  )
  return Number(row?.n ?? 0)
}

export interface PipelineRunRow {
  id: string
  trigger: string
  status: string
  turn_id: string | null
  started_at: string
  finished_at: string | null
  summary: Record<string, unknown>
}

export async function latestPipelineRun(
  workspaceId: string,
): Promise<PipelineRunRow | null> {
  return queryOne<PipelineRunRow>(
    `SELECT * FROM pipeline_runs WHERE workspace_id = $1
      ORDER BY started_at DESC LIMIT 1`,
    [workspaceId],
  )
}

export async function startAgentRun(a: {
  workspaceId: string
  pipelineRunId: string | null
  agentId: AgentId
  trigger: string
  turnId: string | null
  inputCount: number
}): Promise<{ id: string }> {
  const row = await queryOne<{ id: string }>(
    `INSERT INTO agent_runs
       (workspace_id, pipeline_run_id, agent_id, status, trigger, turn_id, input_count)
     VALUES ($1,$2,$3,'running',$4,$5,$6) RETURNING id`,
    [a.workspaceId, a.pipelineRunId, a.agentId, a.trigger, a.turnId, a.inputCount],
  )
  if (!row) throw new Error('Could not open an agent run')
  return row
}

export async function finishAgentRun(
  id: string,
  patch: {
    status: 'completed' | 'failed'
    durationMs: number
    outputCount: number
    error?: string
  },
): Promise<void> {
  await query(
    `UPDATE agent_runs SET status = $2, duration_ms = $3, output_count = $4,
            error = $5, finished_at = now()
      WHERE id = $1`,
    [id, patch.status, patch.durationMs, patch.outputCount, patch.error ?? null],
  )
}

export async function insertSkillRun(s: {
  workspaceId: string
  agentRunId: string
  skillId: string
  agentId: AgentId
  status: SkillRunStatus
  durationMs: number
  configUsed: ResolvedConfig
  note?: string
}): Promise<void> {
  await query(
    `INSERT INTO skill_runs
       (workspace_id, agent_run_id, skill_id, agent_id, status, duration_ms, config_used, note)
     VALUES ($1,$2,$3,$4,$5,$6,$7::jsonb,$8)`,
    [
      s.workspaceId,
      s.agentRunId,
      s.skillId,
      s.agentId,
      s.status,
      s.durationMs,
      JSON.stringify(s.configUsed),
      s.note ?? null,
    ],
  )
}

export interface AgentRunRow {
  id: string
  pipeline_run_id: string | null
  agent_id: string
  status: string
  trigger: string
  turn_id: string | null
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  input_count: number
  output_count: number
  error: string | null
}

export async function listAgentRuns(
  workspaceId: string,
  limit = 40,
): Promise<AgentRunRow[]> {
  return query<AgentRunRow>(
    `SELECT * FROM agent_runs WHERE workspace_id = $1
      ORDER BY started_at DESC LIMIT $2`,
    [workspaceId, limit],
  )
}

export interface SkillRunRow {
  id: string
  agent_run_id: string
  skill_id: string
  agent_id: string
  status: SkillRunStatus
  duration_ms: number
  config_used: ResolvedConfig
  note: string | null
  started_at: string
}

export async function listSkillRuns(
  workspaceId: string,
  limit = 300,
): Promise<SkillRunRow[]> {
  return query<SkillRunRow>(
    `SELECT * FROM skill_runs WHERE workspace_id = $1
      ORDER BY started_at DESC LIMIT $2`,
    [workspaceId, limit],
  )
}

/** The resolved config a past run actually used — the explainability path. */
export async function skillRunsForRun(
  workspaceId: string,
  pipelineRunId: string,
): Promise<SkillRunRow[]> {
  return query<SkillRunRow>(
    `SELECT sr.* FROM skill_runs sr
       JOIN agent_runs ar ON ar.id = sr.agent_run_id
      WHERE sr.workspace_id = $1 AND ar.pipeline_run_id = $2
      ORDER BY sr.started_at ASC`,
    [workspaceId, pipelineRunId],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACTIVITY AND THE REVIEW QUEUE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ActivityRow {
  id: string
  agent_id: string | null
  message: string
  status: ActivityStatus
  entity_type: string | null
  entity_id: string | null
  created_at: string
}

export async function insertActivity(a: {
  workspaceId: string
  agentId: string | null
  message: string
  status: ActivityStatus
  entityType?: string
  entityId?: string
}): Promise<void> {
  await query(
    `INSERT INTO activity_events
       (workspace_id, agent_id, message, status, entity_type, entity_id)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [
      a.workspaceId,
      a.agentId,
      a.message,
      a.status,
      a.entityType ?? null,
      a.entityId ?? null,
    ],
  )
}

export async function listActivity(
  workspaceId: string,
  limit = 60,
): Promise<ActivityRow[]> {
  return query<ActivityRow>(
    `SELECT * FROM activity_events WHERE workspace_id = $1
      ORDER BY created_at DESC LIMIT $2`,
    [workspaceId, limit],
  )
}

export interface ReviewQueueRow {
  id: string
  kind: string
  entity_id: string | null
  reason: string
  decision_requested: string
  options: string[]
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  outcome: string | null
  created_at: string
  /** Joined for display, so the queue row is answerable without a second call. */
  entity_title: string | null
}

export async function listReviewQueue(
  workspaceId: string,
  resolved = false,
): Promise<ReviewQueueRow[]> {
  return query<ReviewQueueRow>(
    `SELECT rq.*,
            COALESCE(si.title, '#' || h.display_tag, ke.title) AS entity_title
       FROM review_queue rq
       LEFT JOIN scraped_items si ON si.id = rq.entity_id AND rq.kind = 'scraped_item'
       LEFT JOIN hashtags h ON h.id = rq.entity_id AND rq.kind = 'hashtag'
       LEFT JOIN knowledge_entries ke ON ke.id = rq.entity_id AND rq.kind = 'knowledge_conflict'
      WHERE rq.workspace_id = $1 AND rq.resolved = $2
      ORDER BY rq.created_at ASC`,
    [workspaceId, resolved],
  )
}

export async function insertReviewQueueRow(r: {
  workspaceId: string
  kind: 'scraped_item' | 'hashtag' | 'knowledge_conflict'
  entityId: string
  reason: string
  decisionRequested: string
  options: string[]
}): Promise<void> {
  await query(
    `INSERT INTO review_queue
       (workspace_id, kind, entity_id, reason, decision_requested, options)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [r.workspaceId, r.kind, r.entityId, r.reason, r.decisionRequested, r.options],
  )
}

export async function resolveReviewQueueRow(
  workspaceId: string,
  id: string,
  outcome: string,
  by: string,
): Promise<ReviewQueueRow | null> {
  return queryOne<ReviewQueueRow>(
    `UPDATE review_queue
        SET resolved = true, outcome = $3, resolved_by = $4, resolved_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING *, NULL::text AS entity_title`,
    [workspaceId, id, outcome, by],
  )
}

/** Closes the queue row attached to an entity, when its verdict is set directly. */
export async function resolveQueueForEntity(
  workspaceId: string,
  entityId: string,
  outcome: string,
  by: string,
): Promise<void> {
  await query(
    `UPDATE review_queue
        SET resolved = true, outcome = $3, resolved_by = $4, resolved_at = now()
      WHERE workspace_id = $1 AND entity_id = $2 AND resolved = false`,
    [workspaceId, entityId, outcome, by],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   LINEAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export async function insertLineage(e: {
  workspaceId: string
  fromType: string
  fromId: string
  toType: string
  toId: string
  agentId: string | null
}): Promise<void> {
  await query(
    `INSERT INTO lineage_edges
       (workspace_id, from_type, from_id, to_type, to_id, agent_id)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT DO NOTHING`,
    [e.workspaceId, e.fromType, e.fromId, e.toType, e.toId, e.agentId],
  )
}

export interface LineageEdge {
  from_type: string
  from_id: string
  to_type: string
  to_id: string
  agent_id: string | null
  depth: number
  direction: 'forward' | 'backward'
}

/**
 * Traces both directions from a node with a recursive CTE, capped at depth 8.
 * Backward answers "where did this come from"; forward answers "what became of it".
 */
export async function traceLineage(
  workspaceId: string,
  type: string,
  id: string,
  maxDepth = 8,
): Promise<LineageEdge[]> {
  const forward = await query<LineageEdge>(
    `WITH RECURSIVE walk AS (
       SELECT from_type, from_id, to_type, to_id, agent_id, 1 AS depth
         FROM lineage_edges
        WHERE workspace_id = $1 AND from_type = $2 AND from_id = $3
       UNION ALL
       SELECT e.from_type, e.from_id, e.to_type, e.to_id, e.agent_id, w.depth + 1
         FROM lineage_edges e
         JOIN walk w ON e.from_type = w.to_type AND e.from_id = w.to_id
        WHERE e.workspace_id = $1 AND w.depth < $4
     )
     SELECT DISTINCT *, 'forward'::text AS direction FROM walk ORDER BY depth`,
    [workspaceId, type, id, maxDepth],
  )

  const backward = await query<LineageEdge>(
    `WITH RECURSIVE walk AS (
       SELECT from_type, from_id, to_type, to_id, agent_id, 1 AS depth
         FROM lineage_edges
        WHERE workspace_id = $1 AND to_type = $2 AND to_id = $3
       UNION ALL
       SELECT e.from_type, e.from_id, e.to_type, e.to_id, e.agent_id, w.depth + 1
         FROM lineage_edges e
         JOIN walk w ON e.to_type = w.from_type AND e.to_id = w.from_id
        WHERE e.workspace_id = $1 AND w.depth < $4
     )
     SELECT DISTINCT *, 'backward'::text AS direction FROM walk ORDER BY depth`,
    [workspaceId, type, id, maxDepth],
  )

  return [...backward, ...forward]
}

/* ═══════════════════════════════════════════════════════════════════════════
   PIPELINE PERSISTENCE
   The write side of a discovery run. Every one of these is an UPSERT keyed on
   something stable, so a re-run links to what already exists rather than
   duplicating it — and nothing is ever deleted to make room.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ScrapedItemInsert {
  keywordId: string | null
  externalId: string
  title: string
  snippet: string
  url: string
  sourceName: string
  sourceType: string
  authorName: string
  authorHeadline: string
  authorFollowers: number
  hashtags: string[]
  engagement: number
  reactions: number
  comments: number
  reposts: number
  relevance: number
  credibility: string
  freshness: number
  isDuplicate: boolean
  validation: ValidationVerdict
  verdictReason: string
  captureSource: 'live' | 'fixture'
  platform: Platform | null
  metricsAvailable: boolean
  brandRelevance: number
  postedAt: string
}

/**
 * Writes the scraped corpus and returns `externalId → row id`, which is what the
 * duplicate links and the lineage edges are resolved against.
 */
export async function persistScrapedItems(
  workspaceId: string,
  runId: string,
  items: ScrapedItemInsert[],
): Promise<Map<string, string>> {
  const idByExternal = new Map<string, string>()
  if (items.length === 0) return idByExternal

  const sourceRows = await listSources(workspaceId)
  const sourceIdByName = new Map(sourceRows.map((s) => [s.name, s.id]))

  /*
   * ONE BATCHED EMBED FOR THE WHOLE CAPTURE, BEFORE THE INSERT LOOP.
   *
   * A crawl returns tens of items at once; embedding them one-per-INSERT would
   * make the round trips serial and dominate the stage's wall clock. `embedMany`
   * batches and never rejects, so an unreachable embedder yields a column of
   * nulls rather than losing the capture — the rows still land, `db:embed`
   * reaches them later, and retrieval is lexical until it does.
   */
  const embedded = await embedMany(
    items.map((item) => embeddableText(item.title, item.snippet ?? '')),
    'document',
  )
  const modelId = embeddingModelId()

  for (const [index, item] of items.entries()) {
    const vector = embedded.vectors[index] ?? null
    const row = await queryOne<{ id: string }>(
      `INSERT INTO scraped_items (
         workspace_id, source_id, keyword_id, run_id, external_id, title, snippet, url,
         source_name, source_type, author_name, author_headline, author_followers,
         hashtags, engagement, reactions, comments, reposts,
         relevance, credibility, freshness, is_duplicate,
         validation, verdict_reason, capture_source,
         platform, metrics_available, brand_relevance,
         posted_at, validated_at,
         embedding, embedding_model, embedded_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7, $8,
         $9, $10, $11, $12, $13,
         $14, $15, $16, $17, $18,
         $19, $20, $21, $22,
         $23, $24, $25,
         $26, $27, $28,
         $29,
         CASE WHEN $23 = 'pending' THEN NULL ELSE now() END,
         $30::vector, $31, CASE WHEN $30 IS NULL THEN NULL ELSE now() END
       )
       ON CONFLICT (workspace_id, external_id) DO UPDATE SET
         run_id = EXCLUDED.run_id,
         engagement = EXCLUDED.engagement,
         reactions = EXCLUDED.reactions,
         comments = EXCLUDED.comments,
         reposts = EXCLUDED.reposts,
         relevance = EXCLUDED.relevance,
         credibility = EXCLUDED.credibility,
         freshness = EXCLUDED.freshness,
         is_duplicate = EXCLUDED.is_duplicate,
         validation = EXCLUDED.validation,
         verdict_reason = EXCLUDED.verdict_reason,
         capture_source = EXCLUDED.capture_source,
         platform = EXCLUDED.platform,
         metrics_available = EXCLUDED.metrics_available,
         brand_relevance = EXCLUDED.brand_relevance,
         validated_at = CASE WHEN EXCLUDED.validation = 'pending' THEN NULL ELSE now() END,
         -- A re-capture keeps the vector it already has when this pass could not
         -- produce one. COALESCE rather than overwrite: losing an embedding
         -- because the daemon blinked would silently drop the row out of every
         -- semantic result while leaving it visible everywhere else.
         embedding = COALESCE(EXCLUDED.embedding, scraped_items.embedding),
         embedding_model = COALESCE(EXCLUDED.embedding_model, scraped_items.embedding_model),
         embedded_at = COALESCE(EXCLUDED.embedded_at, scraped_items.embedded_at)
       RETURNING id`,
      [
        workspaceId,
        sourceIdByName.get(item.sourceName) ?? null,
        item.keywordId,
        runId,
        item.externalId,
        item.title,
        item.snippet,
        item.url,
        item.sourceName,
        item.sourceType,
        item.authorName,
        item.authorHeadline,
        item.authorFollowers,
        item.hashtags,
        item.engagement,
        item.reactions,
        item.comments,
        item.reposts,
        item.relevance,
        item.credibility,
        item.freshness,
        item.isDuplicate,
        item.validation,
        item.verdictReason,
        item.captureSource,
        item.platform,
        item.metricsAvailable,
        item.brandRelevance,
        item.postedAt,
        vector === null ? null : toSqlVector(vector),
        vector === null ? null : modelId,
      ],
    )
    if (row) idByExternal.set(item.externalId, row.id)
  }

  return idByExternal
}

/**
 * A page carried through the scrape stage, reduced to what a knowledge entry
 * needs. `keyword` and `topics` are what found it; `hashtags` are what it
 * carried; `url`/`title` become the citation.
 */
export interface ScrapedTopicSignal {
  keyword: string
  topics: string[]
  hashtags: string[]
  title: string
  url: string
  publishedAt?: string
  brandRelevance: number
}

/**
 * RECORD WHAT WAS SCRAPED AS KNOWLEDGE, ON EVERY SCRAPE — but as a distinct,
 * labelled origin, never dressed up as vetted research.
 *
 * One entry per keyword. Its content lists the topics and hashtags the scrape
 * associated with that keyword this run, and its `sources` cite the actual
 * pages that carried them, so the entry obeys the same "cited, never invented"
 * rule the research build does. `origin='learned'` and `category='Signals'`
 * keep these filterable and deactivatable in the Knowledge Base, and distinct
 * from the human-vetted `origin='research'` entries — so an operator can switch
 * the auto-captured layer off without touching curated findings.
 *
 * Re-scraping the same keyword MERGES new citations into the existing signal
 * entry rather than stacking duplicates, matching the deactivate-never-delete
 * and merge-don't-duplicate invariants the rest of knowledge already honours.
 */
export async function recordScrapedTopicsAsKnowledge(
  workspaceId: string,
  signals: ScrapedTopicSignal[],
): Promise<{ written: number; merged: number }> {
  if (signals.length === 0) return { written: 0, merged: 0 }

  // Group every scraped page by the keyword that found it.
  const byKeyword = new Map<string, ScrapedTopicSignal[]>()
  for (const s of signals) {
    const key = s.keyword.trim()
    if (!key) continue
    const list = byKeyword.get(key) ?? []
    list.push(s)
    byKeyword.set(key, list)
  }

  let written = 0
  let merged = 0

  for (const [keyword, rows] of byKeyword) {
    const topics = [...new Set(rows.flatMap((r) => r.topics))].filter(Boolean)
    const hashtags = [...new Set(rows.flatMap((r) => r.hashtags))].filter(Boolean)

    // The citations: distinct URLs, deduped, with the strongest title kept.
    const sourceByUrl = new Map<string, { title: string; url: string; publishedAt?: string }>()
    for (const r of rows) {
      if (!r.url || sourceByUrl.has(r.url)) continue
      sourceByUrl.set(r.url, {
        title: r.title || keyword,
        url: r.url,
        ...(r.publishedAt ? { publishedAt: r.publishedAt } : {}),
      })
    }
    const sources = [...sourceByUrl.values()]
    // No citable page means no entry — the same floor knowledge already enforces.
    if (sources.length === 0) continue

    const title = `Signal · ${keyword}`
    const content = [
      `Scraped signal for "${keyword}".`,
      topics.length ? `Topics: ${topics.join(', ')}.` : '',
      hashtags.length ? `Hashtags: ${hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}.` : '',
      `Seen on ${sources.length} page${sources.length === 1 ? '' : 's'} this scrape.`,
    ]
      .filter(Boolean)
      .join(' ')

    const avgRelevance =
      rows.reduce((n, r) => n + (r.brandRelevance || 0), 0) / rows.length
    const confidence: 'High' | 'Medium' | 'Low' =
      sources.length >= 3 && avgRelevance >= 70
        ? 'High'
        : sources.length >= 2 || avgRelevance >= 50
          ? 'Medium'
          : 'Low'

    // Merge into the existing signal entry for this keyword if one is live.
    const existing = await queryOne<{ id: string }>(
      `SELECT id FROM knowledge_entries
        WHERE workspace_id = $1 AND origin = 'learned' AND category = 'Signals'
          AND title = $2 AND active = true
        LIMIT 1`,
      [workspaceId, title],
    )

    if (existing) {
      await mergeKnowledgeEntry(existing.id, sources, false)
      merged += 1
    } else {
      const inserted = await insertKnowledgeEntry({
        workspaceId,
        title,
        category: 'Signals',
        content,
        source: 'Scrape',
        sources,
        hashtagId: null,
        confidence,
        origin: 'learned',
        buildId: null,
        tags: [...new Set([keyword, ...topics, ...hashtags.map((h) => h.replace(/^#/, ''))])].slice(0, 20),
      })
      if (inserted) written += 1
    }
  }

  return { written, merged }
}

/** Links a duplicate to its original. The duplicate row itself stays. */
export async function linkDuplicateItem(id: string, duplicateOfId: string): Promise<void> {
  await query(`UPDATE scraped_items SET duplicate_of_id = $2 WHERE id = $1`, [id, duplicateOfId])
}

export interface HashtagInsert {
  tag: string
  displayTag: string
  keywordId: string | null
  postCount: number
  totalEngagement: number
  engagementPerPost: number
  brandRelevance: number
  platforms: string[]
  relevance: number
  credibility: string
  freshness: number
  hashtagScore: number
  rank: number | null
  validation: ValidationVerdict
  verdictReason: string
  inTopSet: boolean
  firstSeenAt: string
  lastSeenAt: string
  feedUrl: string
  topPostUrl: string | null
  topPostTitle: string | null
}

/** Writes the hashtag candidates and returns `tag → row id`. */
export async function persistHashtagCandidates(
  workspaceId: string,
  runId: string,
  candidates: HashtagInsert[],
): Promise<Map<string, string>> {
  const idByTag = new Map<string, string>()

  for (const c of candidates) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO hashtags (
         workspace_id, tag, display_tag, keyword_id, run_id,
         post_count, total_engagement, engagement_per_post, brand_relevance, platforms,
         relevance, credibility, freshness, hashtag_score, rank,
         validation, verdict_reason, in_top_set,
         first_seen_at, last_seen_at, feed_url, top_post_url, top_post_title, validated_at
       ) VALUES (
         $1, $2, $3, $4, $5,
         $6, $7, $8, $22, $23,
         $9, $10, $11, $12, $13,
         $14, $15, $16,
         $17, $18, $19, $20, $21,
         CASE WHEN $14 = 'pending' THEN NULL ELSE now() END
       )
       ON CONFLICT (workspace_id, tag, run_id) DO UPDATE SET
         display_tag = EXCLUDED.display_tag,
         keyword_id = COALESCE(EXCLUDED.keyword_id, hashtags.keyword_id),
         post_count = EXCLUDED.post_count,
         total_engagement = EXCLUDED.total_engagement,
         engagement_per_post = EXCLUDED.engagement_per_post,
         brand_relevance = EXCLUDED.brand_relevance,
         platforms = EXCLUDED.platforms,
         relevance = EXCLUDED.relevance,
         credibility = EXCLUDED.credibility,
         freshness = EXCLUDED.freshness,
         hashtag_score = EXCLUDED.hashtag_score,
         rank = EXCLUDED.rank,
         validation = EXCLUDED.validation,
         verdict_reason = EXCLUDED.verdict_reason,
         in_top_set = EXCLUDED.in_top_set,
         last_seen_at = EXCLUDED.last_seen_at,
         feed_url = EXCLUDED.feed_url,
         top_post_url = COALESCE(EXCLUDED.top_post_url, hashtags.top_post_url),
         top_post_title = COALESCE(EXCLUDED.top_post_title, hashtags.top_post_title),
         validated_at = CASE WHEN EXCLUDED.validation = 'pending' THEN NULL ELSE now() END
       RETURNING id`,
      [
        workspaceId,
        c.tag,
        c.displayTag,
        c.keywordId,
        runId,
        c.postCount,
        c.totalEngagement,
        c.engagementPerPost,
        c.relevance,
        c.credibility,
        c.freshness,
        c.hashtagScore,
        c.rank,
        c.validation,
        c.verdictReason,
        c.inTopSet,
        c.firstSeenAt,
        c.lastSeenAt,
        c.feedUrl,
        c.topPostUrl,
        c.topPostTitle,
        c.brandRelevance,
        c.platforms,
      ],
    )
    if (row) idByTag.set(c.tag, row.id)
  }

  return idByTag
}

export async function linkDuplicateHashtag(id: string, duplicateOfId: string): Promise<void> {
  await query(`UPDATE hashtags SET duplicate_of_id = $2 WHERE id = $1`, [id, duplicateOfId])
}

/**
 * Marks the consolidated top set. The previous set is cleared first so exactly
 * one generation of `in_top_set` is live at a time — the rows themselves remain.
 *
 * AN EMPTY SET IS NOT A REPLACEMENT. The clear used to run before the empty
 * check, so a run that captured nothing — a keyword the crawler could not reach,
 * a lane that returned no usable pages — cleared the whole top set and put
 * nothing back. The consolidated top 25 is measured work that the Knowledge
 * Agent researches from and the UI shows as the hashtag set; wiping it because
 * one run came back empty deletes a real result on the strength of no evidence
 * at all, which is the opposite of what an empty run means.
 *
 * So an empty `ids` leaves the previous generation in place and reports that it
 * did. The caller says so; nothing is silently kept OR silently dropped. The
 * return value is what was actually done, because "the set is unchanged" is a
 * different outcome from "the set was replaced" and the run summary must be able
 * to tell an operator which happened.
 */
export async function replaceTopHashtagSet(
  workspaceId: string,
  ids: string[],
): Promise<{ replaced: boolean; size: number }> {
  if (ids.length === 0) {
    const kept = await queryOne<{ count: string }>(
      `SELECT COUNT(*)::text AS count FROM hashtags WHERE workspace_id = $1 AND in_top_set`,
      [workspaceId],
    )
    return { replaced: false, size: Number(kept?.count ?? 0) }
  }

  await query(`UPDATE hashtags SET in_top_set = false WHERE workspace_id = $1 AND in_top_set`, [
    workspaceId,
  ])
  await query(`UPDATE hashtags SET in_top_set = true WHERE id = ANY($1::uuid[])`, [ids])
  return { replaced: true, size: ids.length }
}

export interface IdeaInsert {
  sourceItemId: string | null
  hashtagId: string | null
  title: string
  description: string
  sourceTopic: string
  platform: Platform
  altPlatforms: Array<{ platform: Platform; score: number }>
  scheduledDate: string
  scheduledTime: string
  confidence: number
  priorityScore: number
  platformRank: number | null
  calendarSlot: CalendarSlot
  status: IdeaStatus
  analysis: Record<string, unknown>
  isNewTrend: boolean
}

/**
 * Writes the planned ideas, de-duplicating on `(source_item_id, platform)` so a
 * repeat run updates the placement rather than stacking a second copy.
 */
export async function persistIdeas(
  workspaceId: string,
  ideas: IdeaInsert[],
): Promise<Array<{ id: string; title: string; created: boolean }>> {
  const out: Array<{ id: string; title: string; created: boolean }> = []

  for (const idea of ideas) {
    const existing = idea.sourceItemId
      ? await queryOne<{ id: string }>(
          `SELECT id FROM content_ideas
            WHERE workspace_id = $1 AND source_item_id = $2 AND platform = $3
            LIMIT 1`,
          [workspaceId, idea.sourceItemId, idea.platform],
        )
      : await queryOne<{ id: string }>(
          `SELECT id FROM content_ideas
            WHERE workspace_id = $1 AND lower(title) = lower($2) AND platform = $3
            LIMIT 1`,
          [workspaceId, idea.title, idea.platform],
        )

    if (existing) {
      await query(
        `UPDATE content_ideas
            SET scheduled_date = $2, scheduled_time = $3, confidence = $4,
                priority_score = $5, platform_rank = $6, calendar_slot = $7,
                alt_platforms = $8::jsonb, analysis = $9::jsonb,
                is_new_trend = $10, updated_at = now()
          WHERE id = $1`,
        [
          existing.id,
          idea.scheduledDate,
          idea.scheduledTime,
          idea.confidence,
          idea.priorityScore,
          idea.platformRank,
          idea.calendarSlot,
          JSON.stringify(idea.altPlatforms),
          JSON.stringify(idea.analysis),
          idea.isNewTrend,
        ],
      )
      out.push({ id: existing.id, title: idea.title, created: false })
      continue
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO content_ideas (
         workspace_id, source_item_id, hashtag_id, title, description, source_topic,
         platform, alt_platforms, scheduled_date, scheduled_time,
         confidence, priority_score, platform_rank, calendar_slot, status,
         analysis, is_new_trend
       ) VALUES (
         $1, $2, $3, $4, $5, $6,
         $7, $8::jsonb, $9, $10,
         $11, $12, $13, $14, $15,
         $16::jsonb, $17
       )
       RETURNING id`,
      [
        workspaceId,
        idea.sourceItemId,
        idea.hashtagId,
        idea.title,
        idea.description,
        idea.sourceTopic,
        idea.platform,
        JSON.stringify(idea.altPlatforms),
        idea.scheduledDate,
        idea.scheduledTime,
        idea.confidence,
        idea.priorityScore,
        idea.platformRank,
        idea.calendarSlot,
        idea.status,
        JSON.stringify(idea.analysis),
        idea.isNewTrend,
      ],
    )
    if (row) out.push({ id: row.id, title: idea.title, created: true })
  }

  return out
}

/** Appends one entry to an idea's feedback history. Never overwrites. */
export async function appendIdeaFeedback(
  workspaceId: string,
  id: string,
  entry: Record<string, unknown>,
): Promise<void> {
  await query(
    `UPDATE content_ideas
        SET feedback = COALESCE(feedback, '[]'::jsonb) || $3::jsonb,
            updated_at = now()
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, JSON.stringify([{ ...entry, at: new Date().toISOString() }])],
  )
}

/** Records the Marketing approval — the first of the two required signatures. */
export async function setMarketingApproval(
  workspaceId: string,
  id: string,
  by: string,
): Promise<IdeaRow | null> {
  await query(
    `UPDATE content_ideas
        SET marketing_approved_by = $3,
            marketing_approved_at = now(),
            status = 'pending_leadership',
            updated_at = now()
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id, by],
  )
  return getIdea(workspaceId, id)
}

/** Records the Leadership decision. A rejection cannot be written without a reason. */
export async function setLeadershipDecision(
  workspaceId: string,
  id: string,
  decision: 'approved' | 'rejected',
  by: string,
  reason: string,
): Promise<IdeaRow | null> {
  if (decision === 'rejected' && reason.trim().length === 0) {
    throw new Error('A rejection needs a reason — it is what the agents learn from.')
  }

  await query(
    `UPDATE content_ideas
        SET leadership_decision = $3::jsonb,
            status = $4,
            updated_at = now()
      WHERE workspace_id = $1 AND id = $2`,
    [
      workspaceId,
      id,
      JSON.stringify({ decision, by, reason, at: new Date().toISOString() }),
      decision === 'approved' ? 'approved' : 'rejected',
    ],
  )
  return getIdea(workspaceId, id)
}

/** Deletes nothing: an idea is withdrawn by status, and its history survives. */
export async function withdrawIdea(workspaceId: string, id: string): Promise<boolean> {
  const rows = await query(
    `UPDATE content_ideas
        SET status = 'rejected',
            leadership_decision = COALESCE(leadership_decision, '{}'::jsonb) ||
              jsonb_build_object('decision','withdrawn','reason','Removed from the calendar by the operator','at', now()),
            calendar_slot = 'suggestion',
            updated_at = now()
      WHERE workspace_id = $1 AND id = $2
      RETURNING id`,
    [workspaceId, id],
  )
  return rows.length > 0
}

/** Every published caption on a platform, for the similarity cap. */
export async function publishedCaptions(
  workspaceId: string,
  platform: Platform,
  limit = 40,
): Promise<string[]> {
  const rows = await query<{ content: string }>(
    `SELECT content FROM posts
      WHERE workspace_id = $1 AND platform = $2
      ORDER BY published_at DESC NULLS LAST
      LIMIT $3`,
    [workspaceId, platform, limit],
  )
  return rows.map((r) => r.content)
}

/* ═══════════════════════════════════════════════════════════════════════════
   SEMANTIC RETRIEVAL — HYBRID, DEGRADING TO LEXICAL

   Two scorers over one corpus, because they fail in opposite directions.

   LEXICAL matches the words actually written. It is exact, explainable — you
   can name which terms matched — and it cannot see a paraphrase. Measured
   against this corpus it also SATURATES: dozens of entries score a perfect
   1.0 on a five-word query, so its ranking among them is arbitrary.

   VECTOR matches meaning. It finds "reinforcement learning from human feedback"
   from "RLHF", ranks continuously so ties are rare, and it cannot tell you why
   in words a person can check.

   So both run, and the LEXICAL overlap is what supplies the operator-facing
   reason (rule 6: every automated decision carries a plain-language reason
   naming its evidence). A cosine of 0.71 is not a reason; "matched on
   'rubric', 'reward'" is.

   WHAT THIS DELIBERATELY DOES NOT TOUCH. `similarity()` in `shared/brand-voice`
   still governs every THRESHOLD — caption ≤0.70, image ≤0.85, dedupe 0.72 —
   because those numbers are product invariants that `verify.ts` asserts and the
   seed data is built around. Cosine lives on a different scale, and letting it
   near a threshold would silently change what that threshold means. Vectors
   improve RECALL here and nothing else.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SemanticHit {
  row: KnowledgeEntryRow
  /** 0–1. Cosine similarity, or 0 when this hit came from the lexical side. */
  vectorScore: number
  /** 0–1. Share of the query's content words present in title or body. */
  lexicalScore: number
  /** The blend the ranking used. */
  score: number
  /** Which scorer(s) surfaced it — for the reason, and for honesty. */
  matchedBy: 'vector' | 'lexical' | 'both'
  /** The query words this entry actually contains. The human-checkable part. */
  matchedTerms: string[]
}

export interface SemanticSearchOutcome {
  hits: SemanticHit[]
  /** `hybrid` when vectors were used, `lexical` when they could not be. */
  mode: 'hybrid' | 'lexical'
  /** Why it is lexical-only, when it is. Shown on the card, never swallowed. */
  degradedReason?: string
}

/** The query's content words — the same rule the lexical scorer has always used. */
function contentWords(queryText: string): string[] {
  return [...new Set(queryText.toLowerCase().match(/[a-z0-9]{4,}/g) ?? [])]
}

/**
 * Searches the Knowledge Base by meaning and by wording at once.
 *
 * Always returns rows if any match either way. When the embedder is
 * unreachable this is exactly the previous lexical behaviour plus a stated
 * reason, so no caller has to branch on whether vectors are available.
 */
export async function searchKnowledgeSemantic(
  workspaceId: string,
  queryText: string,
  opts: {
    limit?: number
    activeOnly?: boolean
    categories?: string[]
    /** Weight given to the vector score, 0–1. The rest goes to lexical. */
    vectorWeight?: number
  } = {},
): Promise<SemanticSearchOutcome> {
  const limit = Math.max(1, opts.limit ?? 8)
  const activeOnly = opts.activeOnly ?? true
  const vectorWeight = Math.min(1, Math.max(0, opts.vectorWeight ?? 0.6))
  const words = contentWords(queryText)

  const filters: string[] = ['ke.workspace_id = $1']
  const params: Array<string | number | string[]> = [workspaceId]
  if (activeOnly) filters.push('ke.active = true')
  if (opts.categories && opts.categories.length > 0) {
    params.push(opts.categories)
    filters.push(`ke.category = ANY($${params.length}::text[])`)
  }
  const where = filters.join(' AND ')

  const { vector, reason } = await embedOne(queryText, 'query')

  /*
   * Over-fetch from each side before blending. Taking `limit` from the vector
   * side alone would let a strong lexical match that the embedder ranked 12th
   * be dropped before the blend could ever see it.
   */
  const pool = limit * 4

  const rows = vector === null
    ? await query<KnowledgeEntryRow>(
        `SELECT ke.* FROM knowledge_entries ke WHERE ${where}
         ORDER BY ke.evidence_count DESC, ke.created_at DESC
         LIMIT ${pool}`,
        params,
      )
    : await query<KnowledgeEntryRow & { vector_score: string | null }>(
        `WITH scored AS (
           SELECT ke.*,
                  CASE WHEN ke.embedding IS NULL THEN NULL
                       ELSE 1 - (ke.embedding <=> $${params.length + 1}::vector)
                  END AS vector_score
             FROM knowledge_entries ke
            WHERE ${where}
         )
         SELECT * FROM scored
          ORDER BY vector_score DESC NULLS LAST, evidence_count DESC
          LIMIT ${pool}`,
        [...params, toSqlVector(vector)],
      )

  const hits: SemanticHit[] = []
  for (const row of rows) {
    const haystack = `${row.title} ${row.content}`.toLowerCase()
    const matchedTerms = words.filter((w) => haystack.includes(w))
    const lexicalScore = words.length === 0 ? 0 : matchedTerms.length / words.length

    const rawVector = (row as { vector_score?: string | null }).vector_score
    const vectorScore = rawVector === null || rawVector === undefined ? 0 : Number(rawVector)

    // Nothing matched either way — not a result, just a row that was fetched.
    if (vectorScore <= 0 && lexicalScore <= 0) continue

    const matchedBy: SemanticHit['matchedBy'] =
      vectorScore > 0 && lexicalScore > 0 ? 'both' : vectorScore > 0 ? 'vector' : 'lexical'

    hits.push({
      row,
      vectorScore,
      lexicalScore,
      score: vector === null
        ? lexicalScore
        : vectorScore * vectorWeight + lexicalScore * (1 - vectorWeight),
      matchedBy,
      matchedTerms,
    })
  }

  hits.sort((a, b) => b.score - a.score)

  const outcome: SemanticSearchOutcome = {
    hits: hits.slice(0, limit),
    mode: vector === null ? 'lexical' : 'hybrid',
  }
  if (vector === null && reason !== undefined) outcome.degradedReason = reason
  return outcome
}

/**
 * The plain-language reason a hit was returned.
 *
 * Built from the LEXICAL side wherever it can be, because that is the part a
 * person can verify by reading the entry. The cosine is reported as corroboration
 * and never as the whole explanation.
 */
export function describeSemanticHit(hit: SemanticHit): string {
  const terms = hit.matchedTerms.slice(0, 4)
  if (hit.matchedBy === 'lexical') {
    return `matched on ${terms.map((t) => `“${t}”`).join(', ')}`
  }
  if (hit.matchedBy === 'vector') {
    return `no query term appears in it, but it is semantically close (${hit.vectorScore.toFixed(2)} cosine)`
  }
  return `matched on ${terms.map((t) => `“${t}”`).join(', ')}, and is semantically close (${hit.vectorScore.toFixed(2)} cosine)`
}

/* ═══════════════════════════════════════════════════════════════════════════
   BACKFILL — embedding rows that predate the embedder
   ═══════════════════════════════════════════════════════════════════════════ */

export interface BackfillProgress {
  table: 'knowledge_entries' | 'scraped_items'
  found: number
  embedded: number
  failed: number
  reason?: string
}

/**
 * Embeds one batch of rows that have no vector, or whose vector came from a
 * different model. Returns what it did so the caller can loop until `found` is 0.
 *
 * Resumable by construction: the work queue is "rows where embedding IS NULL",
 * so an interrupted backfill simply leaves fewer rows next time. There is no
 * cursor to lose.
 */
export async function backfillEmbeddings(
  table: 'knowledge_entries' | 'scraped_items',
  batchSize = 32,
): Promise<BackfillProgress> {
  const model = embeddingModelId()
  const bodyColumn = table === 'knowledge_entries' ? 'content' : 'snippet'

  const rows = await query<{ id: string; title: string; body: string | null }>(
    `SELECT id, title, ${bodyColumn} AS body
       FROM ${table}
      WHERE embedding IS NULL OR embedding_model IS DISTINCT FROM $1
      LIMIT ${Math.max(1, batchSize)}`,
    [model],
  )

  if (rows.length === 0) return { table, found: 0, embedded: 0, failed: 0 }

  const outcome = await embedMany(
    rows.map((r) => embeddableText(r.title, r.body ?? '')),
    'document',
  )

  let embedded = 0
  let failed = 0
  for (const [index, row] of rows.entries()) {
    const vector = outcome.vectors[index] ?? null
    if (vector === null) {
      failed += 1
      continue
    }
    await query(
      `UPDATE ${table}
          SET embedding = $2::vector, embedding_model = $3, embedded_at = now()
        WHERE id = $1`,
      [row.id, toSqlVector(vector), model],
    )
    embedded += 1
  }

  const progress: BackfillProgress = { table, found: rows.length, embedded, failed }
  if (outcome.reason !== undefined) progress.reason = outcome.reason
  return progress
}

/** How much of each table is embedded. Reported at /api/health. */
export async function embeddingCoverage(): Promise<
  Array<{ table: string; total: number; embedded: number; models: string[] }>
> {
  const out: Array<{ table: string; total: number; embedded: number; models: string[] }> = []
  for (const table of ['knowledge_entries', 'scraped_items'] as const) {
    const [row] = await query<{ total: string; embedded: string; models: string[] | null }>(
      `SELECT count(*)::text AS total,
              count(embedding)::text AS embedded,
              array_remove(array_agg(DISTINCT embedding_model), NULL) AS models
         FROM ${table}`,
    )
    out.push({
      table,
      total: Number(row?.total ?? 0),
      embedded: Number(row?.embedded ?? 0),
      models: row?.models ?? [],
    })
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE KEYWORD SCHEDULE — a rotating rota of weeks

   `shared/keyword-schedule.ts` is the declared rota; these functions are how it
   reaches a run. The selection question a scrape asks is "what am I looking for
   this week", and the answer is the constants plus the current week's set.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The keywords scheduled for one cycle week: every constant, plus that week's
 * rotating set, ordered so a run that can only take N takes the intended N.
 *
 * Returns `[]` when nothing is scheduled — which the caller treats as a real
 * finding and applies its fallback to, rather than as an error.
 */
export async function keywordsForCycleWeek(
  workspaceId: string,
  cycleWeek: number,
): Promise<KeywordRow[]> {
  return query<KeywordRow>(
    `SELECT DISTINCT ON (k.id) k.*
       FROM keyword_schedule s
       JOIN keywords k ON k.id = s.keyword_id
      WHERE s.workspace_id = $1
        AND s.active = true
        AND k.active = true
        AND (s.cycle_week IS NULL OR s.cycle_week = $2)
      ORDER BY k.id,
               -- Constants first: they are the standing interests and must never
               -- be the ones dropped when a run's ceiling is reached.
               (s.cycle_week IS NULL) DESC,
               s.slot_rank`,
    [workspaceId, cycleWeek],
  )
}

/** What a week is about, for reporting which rota a run followed. */
export async function cycleWeekTopic(
  workspaceId: string,
  cycleWeek: number,
): Promise<string> {
  const row = await queryOne<{ topic: string }>(
    `SELECT topic FROM keyword_schedule
      WHERE workspace_id = $1 AND cycle_week = $2 AND topic <> ''
      LIMIT 1`,
    [workspaceId, cycleWeek],
  )
  return row?.topic ?? ''
}

/** How many rows the rota holds. Used by the gate and by Settings. */
export async function keywordScheduleSize(workspaceId: string): Promise<{
  constants: number
  rotating: number
  weeks: number
}> {
  const row = await queryOne<{ constants: string; rotating: string; weeks: string }>(
    `SELECT
       count(*) FILTER (WHERE cycle_week IS NULL)::text     AS constants,
       count(*) FILTER (WHERE cycle_week IS NOT NULL)::text AS rotating,
       count(DISTINCT cycle_week)::text                     AS weeks
     FROM keyword_schedule WHERE workspace_id = $1`,
    [workspaceId],
  )
  return {
    constants: Number(row?.constants ?? 0),
    rotating: Number(row?.rotating ?? 0),
    weeks: Number(row?.weeks ?? 0),
  }
}

/**
 * Writes the declared rota, creating any keyword it references.
 *
 * Idempotent: the unique indexes make a re-seed an update rather than a second
 * copy, so this is safe on every migrate. Keywords are upserted through
 * `createKeyword`, which matches on `lower(term)` — so a term the operator
 * already tracks keeps its own weight and category rather than being reset.
 */
export async function seedKeywordSchedule(
  workspaceId: string,
  constants: string[],
  weeks: Array<{ week: number; topic: string; keywords: string[] }>,
): Promise<{ keywords: number; constants: number; rotating: number }> {
  const idFor = new Map<string, string>()

  const ensure = async (term: string, weight: number): Promise<string | null> => {
    const key = term.toLowerCase()
    const known = idFor.get(key)
    if (known !== undefined) return known
    const row = await createKeyword(workspaceId, term, 'Core', weight)
    if (!row) return null
    idFor.set(key, row.id)
    return row.id
  }

  let constantRows = 0
  for (const [index, term] of constants.entries()) {
    const id = await ensure(term, 90)
    if (id === null) continue
    await query(
      `INSERT INTO keyword_schedule (workspace_id, keyword_id, kind, cycle_week, topic, slot_rank)
       VALUES ($1, $2, 'constant', NULL, 'Every week', $3)
       ON CONFLICT (workspace_id, keyword_id) WHERE cycle_week IS NULL
       DO UPDATE SET slot_rank = EXCLUDED.slot_rank, active = true`,
      [workspaceId, id, index + 1],
    )
    constantRows += 1
  }

  let rotatingRows = 0
  for (const week of weeks) {
    for (const [index, term] of week.keywords.entries()) {
      const id = await ensure(term, 70)
      if (id === null) continue
      await query(
        `INSERT INTO keyword_schedule (workspace_id, keyword_id, kind, cycle_week, topic, slot_rank)
         VALUES ($1, $2, 'rotating', $3, $4, $5)
         ON CONFLICT (workspace_id, cycle_week, keyword_id) WHERE cycle_week IS NOT NULL
         DO UPDATE SET topic = EXCLUDED.topic, slot_rank = EXCLUDED.slot_rank, active = true`,
        [workspaceId, id, week.week, week.topic, index + 1],
      )
      rotatingRows += 1
    }
  }

  return { keywords: idFor.size, constants: constantRows, rotating: rotatingRows }
}

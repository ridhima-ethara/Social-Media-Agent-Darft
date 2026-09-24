/**
 * SOCIALFETCH as a Claude Bridge source — platform search with a real date
 * filter and real engagement.
 *
 * Public web search (the `claude_code` adapter) cannot see last week's
 * LinkedIn or Instagram posts — search engines index them months late — and a
 * search result states no engagement. SocialFetch searches the platforms
 * themselves, with a `last-week` filter, and returns each post's reactions,
 * comments and views. The bridge still plans the searches (≤3 per platform),
 * judges relevance and groups the trends; this adapter only fetches.
 *
 *   LinkedIn   GET /v1/linkedin/posts/search      query, datePosted   (1 credit)
 *   Instagram  GET /v1/instagram/search/hashtags  hashtag, datePosted (1 credit)
 *   X          GET /v1/twitter/search             query + since:DATE, section=top (1 credit)
 *   Facebook   — no post search: unavailable (the fallback adapter answers)
 *
 * Only what SocialFetch returned is used; nothing is estimated. After an
 * "insufficient credits" answer no further call is made.
 */

import { socialFetchConfigured, socialFetchGet, socialFetchUnavailableReason } from '../../../integrations/socialfetch'
import { adapterLimits, type AdapterId, type BridgeConfig } from '../config'
import type { PlatformModule } from '../platforms'
import type { BatchOutcome, SearchRequest, SourceCandidate, TrendSourceAdapter } from './source-types'

const ID: AdapterId = 'socialfetch'
const SUPPORTED = new Set(['linkedin', 'instagram', 'x'])

function rec(v: unknown): Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Record<string, unknown>) : {}
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}
function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null
}

/** SocialFetch's `datePosted` for a window. */
export function datePostedFor(window: { from: Date; to: Date }): 'last-day' | 'last-week' | 'last-month' | 'last-year' {
  const hours = (window.to.getTime() - window.from.getTime()) / 3_600_000
  return hours <= 24 ? 'last-day' : hours <= 168 ? 'last-week' : hours <= 744 ? 'last-month' : 'last-year'
}

/** The bridge's planned query without the web-search dressing: no month hint, no outer parentheses. */
export function plainQuery(text: string): string {
  return text
    .replace(/\b(January|February|March|April|May|June|July|August|September|October|November|December) \d{4}\b/g, '')
    .replace(/[()]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** The terms of an OR query, unquoted. */
function terms(text: string): string[] {
  return plainQuery(text)
    .split(/\s+OR\s+/)
    .map((t) => t.replace(/"/g, '').trim())
    .filter((t) => t !== '')
}

function firstLine(text: string): string {
  const line = text.split('\n').map((l) => l.trim()).find((l) => l !== '') ?? ''
  return line.length > 200 ? `${line.slice(0, 199)}…` : line
}

export function createSocialFetchAdapter(platform: PlatformModule, cfg: BridgeConfig): TrendSourceAdapter {
  const limits = adapterLimits(cfg, ID)

  async function searchOne(req: SearchRequest, state: { outOfCredits: boolean }): Promise<{ candidates: SourceCandidate[]; error: string | null }> {
    if (state.outOfCredits) return { candidates: [], error: null }
    const datePosted = datePostedFor(req.window)
    const cap = Math.min(req.maxResults, limits.max_results_per_query)
    let result: Awaited<ReturnType<typeof socialFetchGet>>
    if (platform.id === 'linkedin') {
      result = await socialFetchGet('/v1/linkedin/posts/search', { query: plainQuery(req.query.text), datePosted })
    } else if (platform.id === 'instagram') {
      // Hashtag search takes one tag: the query's leading term, as a tag.
      const tag = (terms(req.query.text)[0] ?? '').replace(/^#/, '').replace(/[^\p{L}\p{N}_]/gu, '')
      if (tag === '') return { candidates: [], error: null }
      result = await socialFetchGet('/v1/instagram/search/hashtags', { hashtag: tag, datePosted, mediaType: 'all' })
    } else {
      const since = req.window.from.toISOString().slice(0, 10)
      result = await socialFetchGet('/v1/twitter/search', { query: `${plainQuery(req.query.text)} since:${since}`, section: 'top', limit: Math.min(20, cap) })
    }
    if (result.status === 'error') {
      if (/insufficient credits/i.test(result.reason ?? '')) state.outOfCredits = true
      return { candidates: [], error: `SocialFetch: ${result.reason ?? 'request failed'}` }
    }
    if (!result.data) return { candidates: [], error: null }

    const out: SourceCandidate[] = []
    if (platform.id === 'linkedin') {
      for (const raw of arr(result.data.posts).slice(0, cap)) {
        const p = rec(raw)
        const text = str(p.text) ?? ''
        const m = rec(p.metrics)
        out.push({
          adapter: ID,
          query: req.query.text,
          keyword: req.query.keyword,
          url: str(p.url),
          published_at: str(p.publishedAt),
          title: firstLine(text) || null,
          text,
          hashtags: [],
          author: str(rec(p.author).name),
          engagement: { reactions: num(m.reactions), comments: num(m.comments), reposts: num(m.reposts), views: null },
        })
      }
    } else if (platform.id === 'instagram') {
      for (const raw of arr(result.data.posts).slice(0, cap)) {
        const p = rec(raw)
        const text = str(p.caption) ?? ''
        const m = rec(p.metrics)
        out.push({
          adapter: ID,
          query: req.query.text,
          keyword: req.query.keyword,
          url: str(p.url),
          published_at: str(p.createdAt),
          title: firstLine(text) || null,
          text,
          hashtags: [],
          author: str(rec(p.owner).handle),
          engagement: { reactions: num(m.likes), comments: num(m.comments), reposts: null, views: num(m.plays) ?? num(m.views) },
        })
      }
    } else {
      for (const raw of arr(result.data.tweets).slice(0, cap)) {
        const t = rec(raw)
        if (t.isRetweet === true) continue
        const text = str(t.text) ?? ''
        const m = rec(t.metrics)
        const rt = num(m.retweets)
        const qt = num(m.quotes)
        out.push({
          adapter: ID,
          query: req.query.text,
          keyword: req.query.keyword,
          url: str(t.url),
          published_at: str(t.createdAt),
          title: firstLine(text) || null,
          text,
          hashtags: [],
          author: str(rec(t.author).handle),
          engagement: {
            reactions: num(m.likes),
            comments: num(m.replies),
            reposts: rt === null && qt === null ? null : (rt ?? 0) + (qt ?? 0),
            views: num(m.views),
          },
        })
      }
    }
    return { candidates: out, error: null }
  }

  const adapter: TrendSourceAdapter = {
    id: ID,
    label: `SocialFetch · ${platform.label}`,
    kind: 'live',
    platform,
    availability() {
      if (!socialFetchConfigured()) return { available: false, reason: socialFetchUnavailableReason() ?? 'SocialFetch is not configured.' }
      if (!SUPPORTED.has(platform.id)) return { available: false, reason: `SocialFetch has no post search for ${platform.label}.` }
      return { available: true, reason: '' }
    },
    async search_topics() {
      return []
    },
    async search_posts(req) {
      return (await searchOne(req, { outOfCredits: false })).candidates
    },
    async search_hashtags(req) {
      return (await searchOne(req, { outOfCredits: false })).candidates
    },
    async get_post() {
      return null
    },
    async searchBatch(reqs: SearchRequest[]): Promise<BatchOutcome> {
      const state = { outOfCredits: false }
      const candidates: SourceCandidate[] = []
      const executed: string[] = []
      const errors: string[] = []
      for (const req of reqs.slice(0, limits.max_queries)) {
        const { candidates: found, error } = await searchOne(req, state)
        if (error) errors.push(error)
        else if (!state.outOfCredits) executed.push(req.query.text)
        candidates.push(...found)
      }
      return { candidates, executed, errors }
    },
  }
  return adapter
}

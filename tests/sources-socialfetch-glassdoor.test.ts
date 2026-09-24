/**
 * The bridge's SocialFetch source (last-week platform search with engagement),
 * its fallback to Claude Code web search, and the Glassdoor read through
 * FetchLayer. Every network call is stubbed — no credits are spent.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { datePostedFor, plainQuery } from '../server/src/bridges/claude-bridge/adapters/socialfetch'
import { withFallback } from '../server/src/bridges/claude-bridge/adapters/fallback'
import type { SearchRequest, TrendSourceAdapter } from '../server/src/bridges/claude-bridge/adapters/source-types'
import { platformModule } from '../server/src/bridges/claude-bridge/platforms'
import { fetchGlassdoor } from '../server/src/agents/analysis/social-listener/glassdoor'

const DAY = 86_400_000

describe('SocialFetch as a bridge source', () => {
  it('maps the window to SocialFetch’s date filter', () => {
    const to = new Date('2026-09-24T00:00:00Z')
    expect(datePostedFor({ from: new Date(to.getTime() - DAY), to })).toBe('last-day')
    expect(datePostedFor({ from: new Date(to.getTime() - 7 * DAY), to })).toBe('last-week')
    expect(datePostedFor({ from: new Date(to.getTime() - 30 * DAY), to })).toBe('last-month')
  })
  it('drops the web-search month hint and parentheses', () => {
    expect(plainQuery('("AI agents" OR RLHF) September 2026')).toBe('"AI agents" OR RLHF')
  })
})

describe('a platform source with a fallback', () => {
  const li = platformModule('linkedin')!
  const req: SearchRequest = { query: { text: '(RLHF)', kind: 'post', keyword: null, origin: 'phrase' }, maxResults: 5, window: { from: new Date(0), to: new Date() } }
  const fake = (id: 'socialfetch' | 'claude_code', available: boolean, answer: 'ok' | 'fail'): TrendSourceAdapter => ({
    id,
    label: id,
    kind: 'live',
    platform: li,
    availability: () => ({ available, reason: available ? '' : `${id} has no key` }),
    search_topics: async () => [],
    search_posts: async () => [],
    search_hashtags: async () => [],
    get_post: async () => null,
    searchBatch: async (reqs) =>
      answer === 'ok'
        ? { candidates: [{ adapter: id, query: reqs[0]!.query.text, keyword: null, url: `https://x/${id}`, published_at: null, title: id, text: null, hashtags: [], author: null, engagement: null }], executed: reqs.map((r) => r.query.text), errors: [] }
        : { candidates: [], executed: [], errors: ['SocialFetch: insufficient credits'] },
  })

  it('uses the fallback when the primary is unavailable, and says so', async () => {
    const out = await withFallback(fake('socialfetch', false, 'ok'), fake('claude_code', true, 'ok')).searchBatch!([req])
    expect(out.candidates[0]!.adapter).toBe('claude_code')
    expect(out.errors[0]).toMatch(/unavailable.*answered instead/)
  })
  it('uses the fallback when every primary search fails (credits)', async () => {
    const out = await withFallback(fake('socialfetch', true, 'fail'), fake('claude_code', true, 'ok')).searchBatch!([req])
    expect(out.candidates[0]!.adapter).toBe('claude_code')
    expect(out.errors[0]).toMatch(/insufficient credits/)
  })
  it('keeps the primary’s answer when it has one', async () => {
    const out = await withFallback(fake('socialfetch', true, 'ok'), fake('claude_code', true, 'ok')).searchBatch!([req])
    expect(out.candidates[0]!.adapter).toBe('socialfetch')
  })
})

describe('Glassdoor through FetchLayer', () => {
  const calls: Array<{ path: string; body: unknown; auth: string | null; method: string }> = []
  beforeEach(() => {
    process.env.FETCHLAYER_API_KEY = 'fl_test_only'
    calls.length = 0
    vi.stubGlobal('fetch', async (input: string | URL, init?: RequestInit) => {
      const url = new URL(String(input))
      const headers = new Headers(init?.headers)
      calls.push({ path: url.pathname, body: init?.body ? JSON.parse(String(init.body)) : null, auth: headers.get('authorization'), method: init?.method ?? 'GET' })
      const reply = (b: unknown) => new Response(JSON.stringify(b), { status: 200, headers: { 'content-type': 'application/json' } })
      if (url.pathname === '/glassdoor/search-companies') {
        return reply({ companies: [
          { employerId: '111', name: 'Ethara AI', overallRating: 4.4, reviewCount: 88, glassdoorUrl: 'https://www.glassdoor.com/Overview/x-EI_IE111.htm' },
          { employerId: '222', name: 'Ethara.AI', overallRating: 1.5, reviewCount: 7, glassdoorUrl: 'https://www.glassdoor.com/Overview/y-EI_IE222.htm' },
          { employerId: '333', name: 'Something Else', overallRating: 3, reviewCount: 500 },
        ] })
      }
      if (url.pathname === '/glassdoor/company-profile') {
        return reply({ profile: { name: 'Ethara AI', reviewCount: 37, ratings: { overall: 4.4, cultureAndValues: 4.1 }, recommendToFriendRate: 0.84, ceoApprovalRate: null, businessOutlookRate: 0.82 }, scrapedAt: '2026-09-24T00:00:00Z' })
      }
      if (url.pathname === '/glassdoor/company-reviews') {
        return reply({ reviews: [
          { reviewId: 'a', summary: 'Great culture', pros: 'Supportive team culture', cons: 'Long hours', ratingOverall: 5, reviewedAt: '2026-07-03T00:00:00Z', isCurrentJob: true },
          { reviewId: 'b', summary: 'Hard', pros: null, cons: 'Poor communication', ratingOverall: 2, reviewedAt: '2026-05-01T00:00:00Z', isCurrentJob: false },
        ], pagesScraped: 1 })
      }
      return new Response('{"error":"Unknown endpoint"}', { status: 404 })
    })
  })
  afterEach(() => vi.unstubAllGlobals())

  it('searches by name, reads the best match by POST with a Bearer key, and names the other listing', async () => {
    const g = await fetchGlassdoor({ employer: 'Ethara.AI', reviewLimit: 15 })
    expect(calls.map((c) => c.path)).toEqual(['/glassdoor/search-companies', '/glassdoor/company-profile', '/glassdoor/company-reviews'])
    expect(calls.every((c) => c.method === 'POST' && c.auth === 'Bearer fl_test_only')).toBe(true)
    expect(calls[1]!.body).toEqual({ company: '111' })
    expect(g.status).toBe('ok')
    expect(g.employer_id).toBe('111')
    expect(g.overall_rating).toBe(4.4)
    // Rates are fractions: 0.84 is 84%, never 1%.
    expect(g.recommend_percent).toBe(84)
    expect(g.business_outlook_percent).toBe(82)
    expect(g.ceo_approval_percent).toBeNull()
    expect(g.reviews_analyzed).toBe(2)
    expect(g.recent_reviews[0]!.reviewerRole).toBe('Current employee')
    expect(g.sentiment).toMatchObject({ positive: 1, negative: 1, classified: 2 })
    expect(g.other_listings?.map((o) => o.employerId)).toEqual(['222'])
    expect(g.insights.join(' ')).toMatch(/second Glassdoor listing/)
    expect(g.credits_used).toBe(3)
  })

  it('reads a Glassdoor URL directly, without a search', async () => {
    const g = await fetchGlassdoor({ employer: 'https://www.glassdoor.com/Overview/Working-at-Ethara-AI-EI_IE111.11,20.htm', reviewLimit: 5 })
    expect(calls[0]!.path).toBe('/glassdoor/company-profile')
    expect(g.employer_id).toBe('111')
  })
})

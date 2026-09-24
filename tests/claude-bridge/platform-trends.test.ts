import { loadBridgeConfig } from '../../server/src/bridges/claude-bridge/config'
/**
 * Platform-level trend discovery — the Scraping Agent's capture — driven by an
 * injected search source, so nothing leaves the machine.
 */

import { describe, expect, it } from 'vitest'
import { discoverPlatformTrends, platformSearches } from '../../server/src/bridges/claude-bridge/trends/platform-trends'
import type { BatchOutcome, SearchRequest, SourceCandidate, TrendSourceAdapter } from '../../server/src/bridges/claude-bridge/adapters/source-types'
import type { PlatformModule } from '../../server/src/bridges/claude-bridge/platforms'
import { prioritiseKeywords } from '../../server/src/bridges/claude-bridge/context'
import { NOW, activityIdFor, cfg, context } from './helpers'

const HOUR = 3_600_000

function linkedinUrl(handle: string, slug: string, hoursAgo: number, low: number): string {
  return `https://www.linkedin.com/posts/${handle}_${slug}-activity-${activityIdFor(new Date(NOW.getTime() - hoursAgo * HOUR), low)}-ab12`
}

/** X status id whose snowflake timestamp is `hoursAgo` before NOW. */
function xUrl(handle: string, hoursAgo: number, low: number): string {
  const ms = BigInt(NOW.getTime() - hoursAgo * HOUR - 1288834974657)
  return `https://x.com/${handle}/status/${((ms << 22n) | BigInt(low)).toString()}`
}

interface Canned {
  url: string
  title: string
}

/** A search source that answers every planned search with the same canned results, and runs one unplanned search. */
function fakeAdapter(results: Record<string, Canned[]>, searchesSeen: string[]) {
  return (platform: PlatformModule): TrendSourceAdapter => ({
    id: 'claude_code',
    label: `fake ${platform.label}`,
    kind: 'live',
    platform,
    availability: () => ({ available: true, reason: '' }),
    search_topics: async () => [],
    search_posts: async () => [],
    search_hashtags: async () => [],
    get_post: async () => null,
    async searchBatch(reqs: SearchRequest[]): Promise<BatchOutcome> {
      searchesSeen.push(...reqs.map((r) => `${platform.id}:${r.query.text}`))
      const canned = results[platform.id] ?? []
      const candidates: SourceCandidate[] = reqs.flatMap((r) =>
        canned.map((c) => ({
          adapter: 'claude_code' as const,
          query: r.query.text,
          keyword: null,
          url: c.url,
          published_at: null,
          title: c.title,
          text: null,
          hashtags: [],
          author: null,
          engagement: null,
        })),
      )
      // A search the plan never asked for — its results must not be used.
      candidates.push({
        adapter: 'claude_code',
        query: 'an unplanned search',
        keyword: null,
        url: linkedinUrl('sneaky', 'rlvr-extra', 1, 99),
        published_at: null,
        title: 'RLVR extra post from an unplanned search',
        text: null,
        hashtags: [],
        author: null,
        engagement: null,
      })
      return { candidates, executed: reqs.map((r) => r.query.text), errors: [] }
    },
  })
}

const LINKEDIN: Canned[] = [
  { url: linkedinUrl('researcher-a', 'rlvr-results', 3, 1), title: 'RLVR removed reward hacking in our post-training runs #RLVR #PostTraining' },
  { url: linkedinUrl('researcher-b', 'rlvr-notes', 20, 2), title: 'Notes on RLVR for code agents #RLVR' },
  { url: linkedinUrl('researcher-b', 'rlvr-notes', 20, 2).replace('www.', 'in.') + '?utm_source=share', title: 'Notes on RLVR for code agents #RLVR' },
  { url: linkedinUrl('old-poster', 'rlvr-old', 24 * 40, 3), title: 'An old RLVR post' },
  { url: linkedinUrl('sales-person', 'q3-tips', 5, 4), title: 'Five sales tips for the quarter' },
  { url: 'https://www.linkedin.com/in/someone-profile/', title: 'Someone — RLVR researcher' },
  ...Array.from({ length: 7 }, (_, i) => ({
    url: linkedinUrl(`agent-${i}`, 'ai-agents-evals', 30 + i, 10 + i),
    title: `AI agent evaluation lesson ${i}: long-horizon tasks need rubric scoring #AIAgents`,
  })),
]

describe('platform trend discovery', async () => {
  const seen: string[] = []
  const report = await discoverPlatformTrends({
    config: cfg,
    context,
    now: NOW,
    windowHours: 48,
    platforms: ['linkedin', 'x', 'facebook'],
    adapterFor: fakeAdapter({ linkedin: LINKEDIN, x: [{ url: xUrl('ml_person', 2, 5), title: 'ML Person on X: "AI agents need real evaluation harnesses" #AIAgents' }] }, seen),
    logSink: null,
  })

  it('runs at most the configured ceiling of focused searches per platform, and never uses an unplanned one', () => {
    const ceiling = loadBridgeConfig().platform_trends.max_searches_per_platform
    for (const p of ['linkedin', 'x']) expect(seen.filter((s) => s.startsWith(`${p}:`)).length).toBeLessThanOrEqual(ceiling)
    expect(report.posts.some((p) => p.url.includes('sneaky'))).toBe(false)
  })

  it('keeps only posts verifiably inside the last 48 hours', () => {
    const cutoff = NOW.getTime() - 48 * HOUR
    expect(report.posts.length).toBeGreaterThan(0)
    for (const p of report.posts) expect(Date.parse(p.publishedAt)).toBeGreaterThanOrEqual(cutoff)
    expect(report.posts.some((p) => p.url.includes('rlvr-old'))).toBe(false)
    const li = report.platforms.find((p) => p.platformId === 'linkedin')!
    expect(li.outsideWindow).toBeGreaterThanOrEqual(1)
  })

  it('keeps only Ethara-relevant posts, and never profiles', () => {
    expect(report.posts.some((p) => p.url.includes('q3-tips'))).toBe(false)
    expect(report.posts.some((p) => p.url.includes('/in/'))).toBe(false)
    for (const p of report.posts) expect(p.matchedEtharaKeywords.length).toBeGreaterThan(0)
  })

  it('de-duplicates reposted and re-linked content', () => {
    const urls = report.posts.map((p) => p.url)
    expect(new Set(urls).size).toBe(urls.length)
    expect(urls.filter((u) => u.includes('rlvr-notes'))).toHaveLength(1)
  })

  it('returns trends in the requested shape, at most five posts each, newest first', () => {
    expect(report.trends.length).toBeGreaterThan(0)
    for (const t of report.trends) {
      expect(Object.keys(t).sort()).toEqual(['engagement', 'evidenceLevel', 'hashtags', 'independentAuthors', 'matchedEtharaKeywords', 'newHashtags', 'period', 'platform', 'posts', 'postsToday', 'reason', 'related', 'trend'])
      // A web search result states no engagement, so none is invented.
      expect(t.engagement).toBeNull()
      expect(t.posts.length).toBeLessThanOrEqual(5)
      for (const post of t.posts) expect(Object.keys(post).sort()).toEqual(['author', 'engagement', 'period', 'publishedAt', 'url'])
      const dates = t.posts.map((p) => p.publishedAt)
      expect([...dates].sort().reverse()).toEqual(dates)
    }
    const agents = report.trends.find((t) => t.trend === 'AI Agent Evaluation')!
    expect(agents.posts).toHaveLength(5)
    const newest = report.trends.map((t) => t.posts[0]!.publishedAt)
    expect([...newest].sort().reverse()).toEqual(newest)
    const all = report.posts.map((p) => p.publishedAt)
    expect([...all].sort().reverse()).toEqual(all)
  })

  it('calls a group a platform trend only with enough independent authors (system prompt §8, §15)', () => {
    const agents = report.trends.find((t) => t.trend === 'AI Agent Evaluation')!
    expect(agents.independentAuthors).toBeGreaterThanOrEqual(2)
    expect(agents.evidenceLevel).toBe('platform_trend')
    // Two URLs of one author's post are one source.
    const rlvr = report.trends.find((t) => t.trend === 'RLVR' && t.platform === 'LinkedIn')!
    expect(rlvr.independentAuthors).toBe(2)
    for (const t of report.trends.filter((x) => x.independentAuthors < 2)) {
      expect(t.evidenceLevel).toBe('platform_activity')
      expect(t.reason).toMatch(/Platform activity, not a platform trend/)
    }
  })

  it('labels what is trending today and lists it first', () => {
    const today = report.today
    expect(today).toMatch(/^\d{4}-\d{2}-\d{2}$/)
    for (const t of report.trends) {
      expect(t.period).toBe(t.postsToday > 0 ? 'today' : 'earlier')
      for (const post of t.posts) expect(['today', 'earlier']).toContain(post.period)
    }
    const periods = report.trends.map((t) => t.period)
    const firstEarlier = periods.indexOf('earlier')
    if (firstEarlier >= 0) expect(periods.slice(firstEarlier)).not.toContain('today')
    for (const post of report.posts) {
      const sameDay = new Date(post.publishedAt).toLocaleDateString('en-CA') === today
      expect(post.period).toBe(sameDay ? 'today' : 'earlier')
    }
  })

  it('extracts hashtags, authors and platforms from what the post itself shows', () => {
    const rlvr = report.trends.find((t) => t.platform === 'LinkedIn' && t.trend === 'RLVR')!
    expect(rlvr.hashtags).toContain('#RLVR')
    expect(rlvr.posts[0]!.author).toBe('@researcher-a')
    const x = report.trends.find((t) => t.platform === 'X')!
    expect(x.posts[0]!.author).toBe('@ml_person')
    expect(x.reason).toMatch(/last 48 hours/)
    expect(x.reason).toMatch(/no engagement/)
  })

  it('attempts Facebook (include_undated) but never passes its posts on as dated evidence', () => {
    const fb = report.platforms.find((p) => p.platformId === 'facebook')!
    // `include_undated` is on, so Facebook is searched rather than skipped. Its
    // posts carry no date, so they are listed in `undated[]` and never enter
    // `posts` as dated evidence.
    expect(fb.status).not.toBe('skipped')
    expect(report.posts.some((p) => p.platformId === 'facebook')).toBe(false)
  })

  it('never shows posts from before the window by default', () => {
    for (const p of report.posts) expect(p.period).not.toBe('older')
  })
})

describe('when a platform has nothing inside the window', async () => {
  const seen: string[] = []
  const FB_URL = 'https://www.facebook.com/groups/DeepNetGroup/posts/2195923854133818/'
  const report = await discoverPlatformTrends({
    config: cfg,
    context,
    now: NOW,
    windowHours: 48,
    platforms: ['linkedin', 'facebook'],
    // Opted in: both are off by default.
    fallbackToLatest: true,
    includeUndated: true,
    adapterFor: fakeAdapter(
      {
        // Everything relevant is 3–10 days old — outside a 48-hour window.
        linkedin: [
          { url: linkedinUrl('researcher-a', 'rlvr-late', 24 * 3, 51), title: 'RLVR removed reward hacking in our post-training runs #RLVR' },
          { url: linkedinUrl('researcher-b', 'rlvr-later', 24 * 10, 52), title: 'Notes on RLVR for code agents #RLVR' },
        ],
        facebook: [{ url: FB_URL, title: 'RLVR and AI agents reading group #RLVR' }],
      },
      seen,
    ),
    logSink: null,
  })

  it('lists the newest relevant posts, labelled older than the window', () => {
    const li = report.platforms.find((p) => p.platformId === 'linkedin')!
    expect(li.status).toBe('older')
    expect(li.reason).toMatch(/newest relevant post/)
    expect(report.posts.length).toBeGreaterThan(0)
    for (const p of report.posts) expect(p.period).toBe('older')
    for (const t of report.trends) expect(t.period).toBe('older')
    // Previous-month evidence is supporting context only, never a current trend (system prompt §5).
    for (const t of report.trends) expect(t.evidenceLevel).toBe('supporting_context')
    expect(li.reason).toMatch(/supporting historical context only/)
    expect(report.posts[0]!.url).toContain('rlvr-late')
  })

  it('lists a relevant Facebook post with no date', () => {
    const fb = report.platforms.find((p) => p.platformId === 'facebook')!
    expect(fb.status).toBe('undated')
    expect(report.undated.some((u) => u.url.includes('2195923854133818'))).toBe(true)
    expect(report.posts.some((p) => p.url.includes('2195923854133818'))).toBe(false)
  })

  it('reports empty, not older, when the fallback is switched off', async () => {
    const off = await discoverPlatformTrends({
      config: cfg,
      context,
      now: NOW,
      windowHours: 48,
      platforms: ['linkedin', 'facebook'],
      fallbackToLatest: false,
      includeUndated: false,
      adapterFor: fakeAdapter({ linkedin: [{ url: linkedinUrl('researcher-a', 'rlvr-late', 24 * 3, 51), title: 'RLVR notes #RLVR' }] }, []),
      logSink: null,
    })
    expect(off.platforms.find((p) => p.platformId === 'linkedin')!.status).toBe('empty')
    expect(off.platforms.find((p) => p.platformId === 'facebook')!.status).toBe('skipped')
    expect(off.posts).toHaveLength(0)
  })

  it('names the current month in the keyword searches, not the hashtag one', () => {
    const li = seen.filter((q) => q.startsWith('linkedin:'))
    const month = new Date(`${report.today}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
    expect(li.some((q) => q.endsWith(month))).toBe(true)
    expect(li.some((q) => q.includes('#') && q.endsWith(month))).toBe(false)
    expect(report.keywordsUsed.some((k) => k.includes(month))).toBe(false)
  })
})

describe('the focused search plan', () => {
  const keywords = prioritiseKeywords(context.keywords, cfg)
  const base = { maxWords: 2, recencyHint: 'September 2026', hashtagTerms: 4, fixedShare: 0.5, rotation: 0 }

  it('builds at most N searches, one quoted topic each with the month named, the last as hashtags', () => {
    const plan = platformSearches(keywords, 4, base)
    expect(plan).toHaveLength(4)
    for (const q of plan.slice(0, 3)) {
      expect(q.text).not.toMatch(/ OR /)
      expect(q.text.endsWith('September 2026')).toBe(true)
    }
    // A multi-word topic is quoted so the post must name it.
    expect(plan.slice(0, 3).some((q) => /^"[^"]+ [^"]+" September 2026$/.test(q.text))).toBe(true)
    expect(plan[3]!.kind).toBe('hashtag')
    expect(plan[3]!.text).toMatch(/#/)
    // A term of more than two words never leads while shorter ones remain.
    expect(plan[0]!.text).not.toMatch(/"AI agent evaluation"/)
    expect(platformSearches(keywords, 1, base)).toHaveLength(1)
  })

  it('always searches the top keywords and rotates the rest by day, so every keyword is covered', () => {
    const day0 = platformSearches(keywords, 4, base).slice(0, 3).map((q) => q.text)
    const day1 = platformSearches(keywords, 4, { ...base, rotation: 1 }).slice(0, 3).map((q) => q.text)
    expect(day0.slice(0, 2)).toEqual(day1.slice(0, 2))
    if (keywords.length > 3) expect(day0[2]).not.toEqual(day1[2])
  })

  it('gives corpus topics and broad terms their own searches', () => {
    const plan = platformSearches(keywords, 6, { ...base, corpusTerms: ['rubrics as rewards'], broadTerms: ['agentic AI'], broadSearches: 1 })
    expect(plan.map((q) => q.text)).toContain('"rubrics as rewards" September 2026')
    expect(plan.map((q) => q.text)).toContain('"agentic AI" September 2026')
  })
})

describe('related posts and new hashtags', async () => {
  const seen: string[] = []
  const withLearned = {
    ...context,
    knowledgeBase: {
      ...context.knowledgeBase,
      entries: [...context.knowledgeBase.entries, { id: 'kb-learned', title: '#AgenticRL', category: 'Discovered Hashtag', content: 'learned', tags: ['AgenticRL'] }],
    },
  }
  const report = await discoverPlatformTrends({
    config: cfg,
    context: withLearned,
    now: NOW,
    windowHours: 48,
    platforms: ['linkedin'],
    adapterFor: fakeAdapter(
      { linkedin: [{ url: linkedinUrl('researcher-a', 'rlvr-results', 3, 1), title: 'RLVR removed reward hacking in our post-training runs #RLVR #RewardHackingWatch' }] },
      seen,
    ),
    logSink: null,
  })

  it('flags hashtags Ethara does not track yet as new', () => {
    const post = report.posts.find((p) => p.url.includes('rlvr-results'))!
    expect(post.newHashtags).toContain('#RewardHackingWatch')
    expect(post.newHashtags).not.toContain('#RLVR')
    expect(post.related).toBe(false)
  })

  it('adds learned hashtags to the hashtag search', () => {
    expect(seen.some((q) => q.includes('#AgenticRL'))).toBe(true)
  })
})

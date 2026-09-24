/**
 * The Analysis Agent's Social Media Listener: computed parts are exact, unstated
 * metrics stay unstated, a missing platform never breaks the report, and a run
 * stops calling SocialFetch once credits run out. SocialFetch is stubbed — no
 * credits are spent by these tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { engagementRate, runSocialListener, sentimentOf, totalEngagement, type ListenerConfig } from '../server/src/agents/analysis/social-listener'
import { loadTopicRules, topicsFor } from '../server/src/agents/analysis/social-listener/topics'

type Routes = Record<string, { status?: number; body: unknown }>

function stubSocialFetch(routes: Routes): string[] {
  const calls: string[] = []
  vi.stubGlobal('fetch', async (input: string | URL) => {
    const url = new URL(String(input))
    calls.push(url.pathname)
    const hit = routes[url.pathname]
    const res = hit ?? { status: 404, body: { error: { message: 'no route' } } }
    return new Response(JSON.stringify(res.body), { status: res.status ?? 200, headers: { 'content-type': 'application/json' } })
  })
  return calls
}

const cfg = (over: Partial<ListenerConfig> = {}): ListenerConfig => ({
  company: 'Ethara.AI',
  targets: { linkedin: '', instagram: 'ethara.ai', facebook: '', x: '' },
  platforms: ['linkedin', 'instagram', 'facebook', 'x'],
  postsPerPlatform: 10,
  commentPostsPerPlatform: 2,
  commentsPerPost: 20,
  topPosts: 2,
  lowestPosts: 1,
  includeReposts: true,
  claude: { enabled: false, model: 'sonnet', maxBudgetUsd: 0.1, timeoutMs: 1000, batchSize: 40 },
  glassdoor: { enabled: false, employer: 'Ethara.AI', reviewLimit: 15 },
  ...over,
})

const IG_PROFILE = { data: { lookupStatus: 'found', profile: { handle: 'ethara.ai', displayName: 'Ethara.AI', profileUrl: 'https://www.instagram.com/ethara.ai/' }, metrics: { followers: 1000 } }, meta: { creditsCharged: 1 } }
const IG_POSTS = {
  data: {
    lookupStatus: 'found',
    posts: [
      { id: 'a', url: 'https://www.instagram.com/p/a/', caption: 'Our MoU with a university #AI', createdAt: '2026-09-08T13:08:52.000Z', mediaType: 'image', likeCount: 96, commentCount: 2 },
      { id: 'b', url: 'https://www.instagram.com/p/b/', caption: 'The climb to AGI starts here', createdAt: '2026-07-03T10:00:00.000Z', mediaType: 'video', likeCount: 99, commentCount: 0, playCount: 5000 },
      { id: 'c', url: 'https://www.instagram.com/p/c/', caption: 'Team photo', createdAt: '2026-06-01T10:00:00.000Z', mediaType: 'image', likeCount: '…', commentCount: 1 },
    ],
  },
  meta: { creditsCharged: 1 },
}
const IG_COMMENTS = { data: { lookupStatus: 'found', comments: [{ id: 'c1', text: 'Congratulations!', createdAt: '2026-09-08T14:00:00.000Z', likeCount: 1 }, { id: 'c2', text: 'How do I apply?', likeCount: 0 }] }, meta: { creditsCharged: 1 } }

beforeEach(() => {
  process.env.SOCIALFETCH_API_KEY = 'sfk_test_only'
})
afterEach(() => {
  vi.unstubAllGlobals()
})

describe('computed metrics', () => {
  it('engagement is reactions + comments + video views, and null when a count is unstated', () => {
    expect(totalEngagement({ reactions: 10, comments: 2, views: null })).toBe(12)
    expect(totalEngagement({ reactions: 10, comments: 2, views: 100 })).toBe(112)
    expect(totalEngagement({ reactions: null, comments: 2, views: 100 })).toBeNull()
  })
  it('engagement rate needs a follower count and never counts views', () => {
    expect(engagementRate({ reactions: 90, comments: 10 }, 1000)).toBe(10)
    expect(engagementRate({ reactions: 90, comments: 10 }, null)).toBeNull()
  })
  it('sentiment percentages are over the comments actually read', () => {
    const s = sentimentOf([
      { sentiment: 'positive', kinds: [], topic: 'Other' },
      { sentiment: 'positive', kinds: [], topic: 'Other' },
      { sentiment: 'negative', kinds: [], topic: 'Other' },
      null,
    ])
    expect(s).toMatchObject({ positive: 2, negative: 1, neutral: 0, classified: 3, positive_percent: 66.7, negative_percent: 33.3 })
    expect(sentimentOf([null])).toBeNull()
  })
  it('topics come from the configurable map, styled text included', () => {
    const rules = loadTopicRules()
    expect(topicsFor('Ethara AI has signed a 𝐌𝐞𝐦𝐨𝐫𝐚𝐧𝐝𝐮𝐦 (MoU) with LPU', [], rules)).toContain('Partnerships / MoU')
    expect(topicsFor("We're hiring interns", [], rules)).toContain('Hiring / HR / POSH')
    expect(topicsFor('lunch', [], rules)).toEqual(['Other'])
  })
})

describe('the listener run', () => {
  it('analyses a platform, ranks its posts, and leaves unconfigured platforms out without failing', async () => {
    const calls = stubSocialFetch({
      '/v1/instagram/profiles/ethara.ai': { body: IG_PROFILE },
      '/v1/instagram/profiles/ethara.ai/posts': { body: IG_POSTS },
      '/v1/instagram/posts/comments': { body: IG_COMMENTS },
    })
    const r = await runSocialListener(cfg())
    const ig = r.platforms.instagram!
    expect(ig.status).toBe('ok')
    expect(ig.posts_analyzed).toBe(3)
    // Video views count; the post with an unstated like count is not ranked.
    expect(ig.top_posts.map((p) => p.post_id)).toEqual(['b', 'a'])
    expect(ig.posts.find((p) => p.post_id === 'c')?.total_engagement).toBeNull()
    expect(ig.posts.find((p) => p.post_id === 'a')?.engagement_rate).toBe(9.8)
    // Comments are fetched only for posts that have some, most-commented first.
    expect(calls.filter((c) => c.endsWith('/comments'))).toHaveLength(2)
    expect(ig.comments_analyzed).toBe(4)
    // Without Claude, sentiment is not measured — never guessed.
    expect(ig.sentiment).toBeNull()
    expect(r.analysis.sentiment_by).toBe('unavailable')
    expect(r.platforms.linkedin?.status).toBe('not_configured')
    expect(r.platforms.x?.status).toBe('not_configured')
    expect(r.sample_size).toMatchObject({ posts: 3, comments: 4, platforms_with_data: 1 })
    expect(r.credits_used).toBe(4)
    expect(r.cross_platform_insights.summary).toMatch(/3 posts and 4 comments/)
  })

  it('reports a not_found account and carries on', async () => {
    stubSocialFetch({
      '/v1/instagram/profiles/ethara.ai': { body: { data: { lookupStatus: 'not_found' }, meta: { creditsCharged: 1 } } },
    })
    const r = await runSocialListener(cfg())
    expect(r.platforms.instagram?.status).toBe('not_found')
    expect(r.sample_size.posts).toBe(0)
  })

  it('stops calling SocialFetch once credits run out, and says so', async () => {
    const calls = stubSocialFetch({
      '/v1/instagram/profiles/ethara.ai': { body: IG_PROFILE },
      '/v1/instagram/profiles/ethara.ai/posts': { body: IG_POSTS },
      '/v1/instagram/posts/comments': { status: 402, body: { error: { code: 'insufficient_credits', message: 'Insufficient credits' } } },
    })
    const r = await runSocialListener(cfg())
    expect(calls.filter((c) => c.endsWith('/comments'))).toHaveLength(1)
    expect(r.fetch_log.filter((e) => e.status === 'skipped')).toHaveLength(1)
    expect(r.warnings.join(' ')).toMatch(/ran out of credits/)
  })
})

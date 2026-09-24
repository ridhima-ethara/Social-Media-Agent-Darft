/**
 * The popup's rows: Topic + Date + Hashtags + Post URL + Platform, joined from
 * the validated posts and the platform trends — computed, newest first, and
 * never invented for a post the bridge did not return.
 */
import { describe, expect, it } from 'vitest'
import { buildDiscoveryResults } from '../server/src/discovery-results'
import type { PipelinePayload } from '../server/src/agents/skills/index'

type Post = NonNullable<PipelinePayload['posts']>[number]
const post = (over: Partial<Post>): Post => ({ hashtags: [], keyword: 'agentic AI', ...over }) as Post

describe('discovery results', () => {
  const payload: Pick<PipelinePayload, 'posts' | 'platformTrends'> = {
    posts: [
      post({ url: 'https://www.linkedin.com/posts/a-1', postedAt: '2026-09-22T08:00:00Z', platform: 'linkedin', hashtags: ['#AgenticAI', '#AgenticAI'], validation: 'validated', verdictReason: 'ok' }),
      post({ url: 'https://x.com/b/status/2', postedAt: '2026-09-23T06:00:00Z', platform: 'x', keyword: 'RLHF', validation: 'needs_review', verdictReason: 'thin' }),
      post({ url: 'https://example.com/undated', postedAt: '', platform: null, validation: 'validated', verdictReason: '' }),
    ],
    platformTrends: [
      { platform: 'LinkedIn', trend: 'Agentic AI', evidenceLevel: 'platform_activity', independentAuthors: 1, period: 'today', postsToday: 1, hashtags: ['#AgenticAI'], newHashtags: [], related: false, engagement: null, posts: [{ url: 'https://www.linkedin.com/posts/a-1', publishedAt: '2026-09-22T08:00:00Z', author: 'a', period: 'today', engagement: null }], matchedEtharaKeywords: ['agentic AI'], reason: '1 post in the last 48 hours.' },
    ],
  }

  const results = buildDiscoveryResults('run-1', payload, new Date('2026-09-23T12:00:00Z'))

  it('orders rows newest first and names the platform', () => {
    expect(results.rows.map((r) => r.platform)).toEqual(['X', 'LinkedIn'])
    expect(results.rows[0]?.publishedAt).toBe('2026-09-23T06:00:00Z')
  })

  it('takes the topic and reason from the trend, the verdict from validation', () => {
    const li = results.rows.find((r) => r.platformId === 'linkedin')
    expect(li).toMatchObject({ topic: 'Agentic AI', reason: '1 post in the last 48 hours.', validation: 'validated', hashtags: ['#AgenticAI'] })
    const x = results.rows.find((r) => r.platformId === 'x')
    expect(x).toMatchObject({ topic: 'RLHF', matchedKeyword: 'RLHF', validation: 'needs_review' })
  })

  it('leaves out a post with no verified date rather than dating it', () => {
    expect(results.rows.some((r) => r.url.includes('undated'))).toBe(false)
    expect(results.counts).toMatchObject({ total: 2, validated: 1, needs_review: 1 })
  })

  it('is empty, not padded, when nothing was captured', () => {
    expect(buildDiscoveryResults('run-2', {}).rows).toEqual([])
  })
})

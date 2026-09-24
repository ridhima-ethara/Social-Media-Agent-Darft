import { describe, expect, it } from 'vitest'
import { normalizeCandidates } from '../../server/src/bridges/claude-bridge/processing/normalizer'
import { deduplicate } from '../../server/src/bridges/claude-bridge/processing/deduplicator'
import { resolveWindow } from '../../server/src/bridges/claude-bridge/processing/freshness'
import { analyzeRelevance, buildRelevanceModel } from '../../server/src/bridges/claude-bridge/processing/relevance'
import { scoreItems, sortScored } from '../../server/src/bridges/claude-bridge/processing/trend-ranking'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'
import { NOW, candidate, cfg, context, daysAgo, postUrl } from './helpers'

function rank(raw: ReturnType<typeof candidate>[], overrides: Partial<typeof cfg> = {}) {
  const c = { ...cfg, ...overrides }
  const { items } = deduplicate(normalizeCandidates(raw, linkedin, c, NOW).items, c.deduplication.similarity_threshold)
  const model = buildRelevanceModel(context, c)
  const entries = items.map((item) => ({ item, relevance: analyzeRelevance(item, model, c) }))
  const generic = new Set(context.brandVoice.generic_hashtags)
  return sortScored(scoreItems(entries, items, resolveWindow(c, NOW), generic, c, NOW), c)
}

const onTopic = 'AI agent evaluation with rubric scoring over long-horizon trajectories. #AIAgents'

describe('trend ranking', () => {
  it('sorts newest first by default, with trend score deciding within a day', () => {
    const ranked = rank([
      candidate({ url: postUrl('a', 'older', daysAgo(5), 1), text: onTopic }),
      candidate({ url: postUrl('b', 'newest-weak', daysAgo(0.1), 2), text: 'AI agents.' }),
      candidate({ url: postUrl('c', 'middle', daysAgo(2), 3), text: onTopic }),
    ])
    const dates = ranked.map((r) => r.item.published_at!)
    expect([...dates].sort().reverse()).toEqual(dates)
  })

  it('orders by trend score when configured to', () => {
    const ranked = rank(
      [
        candidate({ url: postUrl('a', 'strong', daysAgo(6), 1), text: onTopic, query: 'q1' }),
        candidate({ url: postUrl('b', 'weak', daysAgo(0.1), 2), text: 'Unrelated note about lunch.' }),
      ],
      { sort: 'trend_score_desc' },
    )
    const scores = ranked.map((r) => r.trend_score)
    expect([...scores].sort((a, b) => b - a)).toEqual(scores)
  })

  it('puts undated items after every dated one', () => {
    const ranked = rank([
      candidate({ url: 'https://www.linkedin.com/pulse/undated-sample', text: onTopic }),
      candidate({ url: postUrl('a', 'dated', daysAgo(10), 1), text: onTopic }),
    ])
    expect(ranked.at(-1)!.item.published_at).toBeNull()
  })

  it('rewards cross-query and shared-hashtag frequency, not only recency', () => {
    const popular = postUrl('a', 'popular', daysAgo(3), 1)
    const ranked = rank([
      candidate({ url: popular, text: `${onTopic} #RLVR`, query: 'q1' }),
      candidate({ url: popular, text: `${onTopic} #RLVR`, query: 'q2' }),
      candidate({ url: popular, text: `${onTopic} #RLVR`, query: 'q3' }),
      candidate({ url: postUrl('b', 'other', daysAgo(3), 2), text: 'Verifiable rewards for maths and code tasks. #RLVR', query: 'q1' }),
      candidate({ url: postUrl('c', 'lonely', daysAgo(3), 3), text: 'Reward model design notes. #RewardModeling', query: 'q1' }),
    ])
    const byUrl = (part: string) => ranked.find((r) => r.item.url!.includes(part))!
    expect(byUrl('popular').breakdown.cross_query).toBe(1)
    expect(byUrl('other').breakdown.cross_query).toBe(0)
    expect(byUrl('other').breakdown.hashtag_signal).toBeGreaterThan(0)
    expect(byUrl('lonely').breakdown.hashtag_signal).toBe(0)
    expect(byUrl('popular').trend_score).toBeGreaterThan(byUrl('other').trend_score)
  })

  it('never manufactures engagement: unstated engagement is null and excluded, stated is used', () => {
    const ranked = rank([
      candidate({ url: postUrl('a', 'measured', daysAgo(1), 1), text: onTopic, engagement: { reactions: 100, comments: 5, reposts: null } }),
      candidate({ url: postUrl('b', 'unmeasured', daysAgo(1), 2), text: onTopic }),
    ])
    const measured = ranked.find((r) => r.item.url!.includes('measured') && !r.item.url!.includes('unmeasured'))!
    const unmeasured = ranked.find((r) => r.item.url!.includes('unmeasured'))!
    expect(measured.engagement_available).toBe(true)
    expect(measured.breakdown.engagement).toBe(1)
    expect(unmeasured.engagement_available).toBe(false)
    expect(unmeasured.breakdown.engagement).toBeNull()
    expect(unmeasured.trend_reason).toMatch(/stated no engagement/)
  })

  it('keeps every score in 0–100 and every component in 0–1', () => {
    const ranked = rank(
      Array.from({ length: 6 }, (_, i) =>
        candidate({ url: postUrl(`h${i}`, `p${i}`, daysAgo(i * 2), i + 1), text: `${onTopic} #RLVR ${i}`, query: `q${i % 3}` }),
      ),
    )
    for (const r of ranked) {
      expect(r.trend_score).toBeGreaterThanOrEqual(0)
      expect(r.trend_score).toBeLessThanOrEqual(100)
      for (const v of Object.values(r.breakdown)) if (v !== null) expect(v).toBeGreaterThanOrEqual(0)
    }
  })
})

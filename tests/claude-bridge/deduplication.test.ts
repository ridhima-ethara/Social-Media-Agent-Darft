import { describe, expect, it } from 'vitest'
import { normalizeCandidates } from '../../server/src/bridges/claude-bridge/processing/normalizer'
import { deduplicate } from '../../server/src/bridges/claude-bridge/processing/deduplicator'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'
import { NOW, activityIdFor, candidate, cfg, daysAgo, postUrl } from './helpers'

describe('deduplication', () => {
  const date = daysAgo(1)
  const id = activityIdFor(date)
  const canonical = postUrl('sample-a', 'ai-agents-evals', date)

  it('returns one post however it was reached, and keeps every matched query', () => {
    const raw = [
      candidate({ url: canonical, query: '"AI agents"', keyword: 'AI agents', title: 'AI agents evals' }),
      candidate({ url: `https://www.linkedin.com/feed/update/urn:li:activity:${id}/`, query: '#AIAgents', keyword: 'AI agents' }),
      candidate({ url: `${canonical.replace('www.', 'in.')}?utm_source=share&rcm=x`, query: '"agent evaluation"', keyword: 'AI agent evaluation', adapter: 'manual_urls' }),
    ]
    const { items } = normalizeCandidates(raw, linkedin, cfg, NOW)
    const { items: unique, duplicates_removed } = deduplicate(items, cfg.deduplication.similarity_threshold)

    expect(unique).toHaveLength(1)
    expect(duplicates_removed).toBe(2)
    expect([...unique[0]!.queries].sort()).toEqual(['"AI agents"', '"agent evaluation"', '#AIAgents'].sort())
    expect([...unique[0]!.adapters].sort()).toEqual(['fixture', 'manual_urls'])
    expect([...unique[0]!.keywords].sort()).toEqual(['AI agent evaluation', 'AI agents'])
  })

  it('merges a near-identical repost under a different URL by computed text similarity', () => {
    const body =
      'Reinforcement learning environments are the bottleneck for training AI agents; stateful verifiable environments with tool use measure long-horizon behaviour.'
    const raw = [
      candidate({ url: postUrl('sample-a', 'rl-envs', daysAgo(2), 1), text: body }),
      candidate({ url: postUrl('sample-b', 'repost', daysAgo(2), 2), text: `${body} #RLEnvironments` }),
    ]
    const { items } = normalizeCandidates(raw, linkedin, cfg, NOW)
    expect(deduplicate(items, cfg.deduplication.similarity_threshold).items).toHaveLength(1)
  })

  it('does not merge distinct posts that merely share a topic', () => {
    const raw = [
      candidate({ url: postUrl('sample-a', 'x', daysAgo(2), 1), text: 'AI agent evaluation needs rubric scoring across long-horizon trajectories and partial credit.' }),
      candidate({ url: postUrl('sample-b', 'y', daysAgo(2), 2), text: 'Our RLVR runs removed reward hacking on maths and code, but checkers do not exist for open tasks.' }),
    ]
    const { items } = normalizeCandidates(raw, linkedin, cfg, NOW)
    expect(deduplicate(items, cfg.deduplication.similarity_threshold).items).toHaveLength(2)
  })

  it('keeps stated engagement and hashtags from whichever copy carried them', () => {
    const raw = [
      candidate({ url: canonical, hashtags: ['AIAgents'] }),
      candidate({ url: canonical, hashtags: ['LLM'], engagement: { reactions: 10, comments: 2, reposts: null } }),
    ]
    const { items } = normalizeCandidates(raw, linkedin, cfg, NOW)
    const [merged] = deduplicate(items, cfg.deduplication.similarity_threshold).items
    expect(merged!.hashtags.map((h) => h.display).sort()).toEqual(['#AIAgents', '#LLM'])
    expect(merged!.engagement).toEqual({ reactions: 10, comments: 2, reposts: null })
  })
})

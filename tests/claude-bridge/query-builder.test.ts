import { describe, expect, it } from 'vitest'
import { buildQueries, toHashtagBody, topicsFromDomains } from '../../server/src/bridges/claude-bridge/discovery/query-builder'
import { prioritiseKeywords } from '../../server/src/bridges/claude-bridge/context'
import { cfg, context } from './helpers'

describe('query builder', () => {
  const keywords = prioritiseKeywords(context.keywords, cfg)

  it('generates several discovery forms per keyword from the configured templates', () => {
    const plan = buildQueries({ keywords, brandVoice: context.brandVoice }, { ...cfg, max_total_queries: 500 })
    const forRlvr = plan.queries.filter((q) => q.keyword === 'RLVR').map((q) => q.text)
    expect(forRlvr).toContain('"RLVR"')
    expect(forRlvr).toContain('#RLVR')
    expect(forRlvr).toContain('"verifiable rewards"')
    expect(forRlvr).toContain('"RLVR" research')
  })

  it('never exceeds max_queries_per_keyword, max_keywords or max_total_queries', () => {
    const tight = { ...cfg, max_keywords: 3, max_queries_per_keyword: 2, max_total_queries: 5, include_brand_domains_as_topics: false }
    const plan = buildQueries({ keywords, brandVoice: context.brandVoice }, tight)
    expect(plan.queries.length).toBeLessThanOrEqual(5)
    expect(plan.keywordsUsed).toHaveLength(3)
    const perKeyword = new Map<string, number>()
    for (const q of plan.queries) perKeyword.set(q.keyword ?? '', (perKeyword.get(q.keyword ?? '') ?? 0) + 1)
    for (const n of perKeyword.values()) expect(n).toBeLessThanOrEqual(2)
  })

  it('spends a tight budget breadth-first, so every keyword is queried once before any twice', () => {
    const tight = { ...cfg, max_keywords: 4, max_total_queries: 4, include_brand_domains_as_topics: false }
    const plan = buildQueries({ keywords, brandVoice: context.brandVoice }, tight)
    expect(new Set(plan.queries.map((q) => q.keyword)).size).toBe(4)
  })

  it('puts this week’s rota keywords first', () => {
    expect(keywords.slice(0, 3).every((k) => k.scheduled === 'constant')).toBe(true)
    expect(keywords[3]?.scheduled).toBe('this_week')
  })

  it('runs planned queries first and verbatim, and de-duplicates case-insensitively', () => {
    const plan = buildQueries(
      { keywords, brandVoice: context.brandVoice, plannedQueries: ['agentic RL evaluation', '"rlvr"'] },
      cfg,
    )
    expect(plan.queries[0]).toMatchObject({ text: 'agentic RL evaluation', origin: 'planned', keyword: null })
    expect(plan.queries.filter((q) => q.text.toLowerCase() === '"rlvr"')).toHaveLength(1)
  })

  it('reports how many queries the budget cut', () => {
    const plan = buildQueries({ keywords, brandVoice: context.brandVoice }, { ...cfg, max_total_queries: 3 })
    expect(plan.generatedBeforeBudget).toBeGreaterThan(3)
    expect(plan.queries).toHaveLength(3)
  })

  it('builds hashtags and topics without hardcoded terms', () => {
    expect(toHashtagBody('AI agents')).toBe('AIAgents')
    expect(toHashtagBody('post-training')).toBe('PostTraining')
    expect(toHashtagBody('RLHF')).toBe('RLHF')
    expect(topicsFromDomains(['Model evaluation, benchmarks and environments'])).toEqual(['Model evaluation'])
  })
})

/**
 * The whole pipeline over the fixture adapter — no network, no database.
 */

import { describe, expect, it } from 'vitest'
import { runTrendIntelligence } from '../../server/src/bridges/claude-bridge/pipeline'
import { renderMarkdown } from '../../server/src/bridges/claude-bridge/output/markdown'
import { createFixtureAdapter } from '../../server/src/bridges/claude-bridge/adapters/fixture'
import type { TrendSourceAdapter } from '../../server/src/bridges/claude-bridge/adapters/source-types'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'
import { toRawPost } from '../../server/src/bridges/claude-bridge/capture-source'
import { NOW, cfg, context, fixture } from './helpers'

const base = { config: cfg, context, now: NOW, logSink: null } as const

describe('the pipeline, end to end on fixtures', async () => {
  const out = await runTrendIntelligence({ ...base, input: { adapters: ['fixture'] } })

  it('returns the documented schema, labelled as fixture data', () => {
    expect(out.status).toBe('ok')
    expect(out.source).toBe('linkedin')
    expect(out.source_status).toBe('fixture')
    expect(out.results.length).toBeGreaterThan(0)
    for (const r of out.results) {
      expect(r).toEqual(
        expect.objectContaining({
          rank: expect.any(Number),
          topic: expect.any(String),
          date_status: expect.stringMatching(/^(verified|unknown)$/),
          hashtags: expect.any(Array),
          source_type: 'linkedin',
          matched_keywords: expect.any(Array),
          matched_queries: expect.any(Array),
          trend_score: expect.any(Number),
          brand_relevance: expect.stringMatching(/^(high|medium|low)$/),
          relevance_reason: expect.any(String),
          trend_reason: expect.any(String),
        }),
      )
    }
    expect(out.data_provenance.observed_fields).toContain('post_url')
    expect(out.data_provenance.computed_fields).toContain('trend_score')
  })

  it('sorts by date, newest first, with undated results last', () => {
    const dates = out.results.map((r) => r.published_at?.slice(0, 10) ?? '')
    const dated = dates.filter((d) => d !== '')
    expect([...dated].sort().reverse()).toEqual(dated)
    expect(dates.slice(dated.length).every((d) => d === '')).toBe(true)
    expect(out.results.map((r) => r.rank)).toEqual(out.results.map((_, i) => i + 1))
  })

  it('removes duplicates, stale posts, non-posts and off-brand material, and counts each', () => {
    const urls = out.results.map((r) => r.post_url)
    expect(new Set(urls).size).toBe(urls.length)
    expect(out.diagnostics.duplicates_removed).toBeGreaterThan(0)
    expect(out.diagnostics.stale_results_removed).toBe(1)
    expect(out.diagnostics.invalid_removed).toBe(4)
    expect(out.diagnostics.below_relevance_removed).toBeGreaterThanOrEqual(1)
    expect(out.results.some((r) => r.snippet?.includes('Game-changing'))).toBe(false)
  })

  it('invents nothing: every URL, date and hashtag traces to the fixture', () => {
    const fixtureText = JSON.stringify(fixture)
    for (const r of out.results) {
      if (r.post_url !== null) {
        const id = r.post_url.match(/activity[-:](\d+)/)?.[1]
        expect(id === undefined ? fixtureText.includes(r.post_url) : fixtureText.includes(id)).toBe(true)
      }
      for (const tag of r.hashtags) expect(fixtureText.toLowerCase()).toContain(tag.toLowerCase())
      if (r.date_status === 'unknown') expect(r.published_at).toBeNull()
      if (!r.engagement_available) expect(r.engagement).toBeNull()
    }
  })

  it('aggregates trending topics and hashtags from the results', () => {
    expect(out.trending_topics.length).toBeGreaterThan(0)
    expect(out.trending_hashtags.find((h) => h.hashtag === '#AIAgents')?.post_count).toBeGreaterThan(1)
    expect(out.trending_hashtags.find((h) => h.hashtag === '#AI')?.generic ?? true).toBe(true)
  })

  it('renders a date-first Markdown table with the fixture banner and the reasons', () => {
    const md = renderMarkdown(out)
    expect(md).toMatch(/FIXTURE DATA/)
    expect(md).toMatch(/\| # \| Date \| Trending Topic \| Hashtags \| Relevance \| LinkedIn Post \|/)
    expect(md).toMatch(/Why this is relevant:/)
    expect(md).toMatch(/Why it is trending:/)
  })

  it('honours max_results, include_hashtags and include_post_urls', async () => {
    const trimmed = await runTrendIntelligence({
      ...base,
      input: { adapters: ['fixture'], max_results: 2, include_hashtags: false, include_post_urls: false },
    })
    expect(trimmed.results).toHaveLength(2)
    expect(trimmed.results.every((r) => r.hashtags.length === 0 && r.post_url === null)).toBe(true)
  })
})

describe('the pipeline, when things are missing', () => {
  it('returns an empty, explained result when no source can run — never synthetic rows', async () => {
    const dead: TrendSourceAdapter = {
      ...createFixtureAdapter(linkedin, fixture),
      id: 'claude_code',
      kind: 'live',
      label: 'Unavailable source',
      availability: () => ({ available: false, reason: 'The Claude Code CLI was not found.' }),
    }
    const out = await runTrendIntelligence({ ...base, adapters: [dead] })
    expect(out.status).toBe('ok')
    expect(out.source_status).toBe('unavailable')
    expect(out.results).toEqual([])
    expect(out.adapters[0]).toMatchObject({ status: 'unavailable', reason: 'The Claude Code CLI was not found.' })
    expect(renderMarkdown(out)).toMatch(/Nothing has been substituted/)
  })

  it('reports "empty" when a source ran and found nothing', async () => {
    const empty: TrendSourceAdapter = { ...createFixtureAdapter(linkedin, { ...fixture, posts: [] }), kind: 'store', id: 'sma_captures' }
    const out = await runTrendIntelligence({ ...base, adapters: [empty] })
    expect(out.source_status).toBe('empty')
    expect(out.results).toEqual([])
  })

  it('stops a failing adapter early and still returns what other adapters found', async () => {
    let calls = 0
    const failing: TrendSourceAdapter = {
      ...createFixtureAdapter(linkedin, fixture),
      id: 'sma_captures',
      kind: 'store',
      label: 'Failing',
      search_posts: async () => {
        calls += 1
        throw new Error('boom')
      },
      search_topics: async () => {
        calls += 1
        throw new Error('boom')
      },
      search_hashtags: async () => {
        calls += 1
        throw new Error('boom')
      },
    }
    const out = await runTrendIntelligence({ ...base, adapters: [failing, createFixtureAdapter(linkedin, fixture)] })
    expect(calls).toBeLessThan(10)
    expect(out.results.length).toBeGreaterThan(0)
    expect(out.adapters.find((a) => a.label === 'Failing')?.status).toBe('error')
    expect(out.diagnostics.errors.length).toBeGreaterThan(0)
  })

  it('returns an explicit configuration error for invalid input or an unloadable context', async () => {
    const bad = await runTrendIntelligence({ ...base, input: { date_from: '2026-09-20', date_to: '2026-09-01', adapters: ['fixture'] } })
    expect(bad.status).toBe('configuration_error')
    expect(bad.results).toEqual([])
    const unknown = await runTrendIntelligence({ ...base, input: { nonsense: true } as never })
    expect(unknown.status).toBe('configuration_error')
  })
})

describe('the Scraping Agent capture contract', () => {
  it('maps a bridge result to a RawPost without inventing a date or engagement', async () => {
    const out = await runTrendIntelligence({ ...base, input: { adapters: ['fixture'] } })
    const dated = out.results.find((r) => r.date_status === 'verified' && !r.engagement_available)!
    const row = toRawPost(dated, 'AI agents', 'linkedin', 'Claude Bridge · LinkedIn')!
    expect(row.postedAt).toBe(dated.published_at)
    expect(row.metricsAvailable).toBe(false)
    expect(row.reactions).toBe(0)
    expect(row.platform).toBe('linkedin')
    expect(row.authorName.startsWith('@sample-')).toBe(true)

    const undated = out.results.find((r) => r.date_status === 'unknown')!
    expect(toRawPost(undated, 'AI agents', 'linkedin', 'x')).toBeNull()
  })
})

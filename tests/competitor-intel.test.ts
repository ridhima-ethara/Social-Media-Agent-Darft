import { describe, expect, it } from 'vitest'
import { NOT_AVAILABLE, type Competitor, type CompetitorProfile } from '../shared/competitor-intel'
import { toClaim } from '../server/src/agents/analysis/competitor-intel/claims'
import { diffProfiles } from '../server/src/agents/analysis/competitor-intel/changes'
import { isDue } from '../server/src/agents/analysis/competitor-intel/index'
import { loadSkill, section, toolBindings } from '../server/src/agents/analysis/competitor-intel/marketing-skills'
import { generateProfile } from '../server/src/agents/analysis/competitor-intel/profile'
import { htmlToText, pickKeyPages, wikipediaText, type GatheredSource } from '../server/src/agents/analysis/competitor-intel/sources'
import { parseFeed } from '../server/src/integrations/web-reader'

const NOW = new Date('2026-09-24T06:00:00Z')

const competitor: Competitor = {
  id: '00000000-0000-0000-0000-000000000001',
  slug: 'acme-ai',
  name: 'Acme AI',
  tier: 'P0',
  category: 'Training / Evaluations',
  description: 'Training data, evaluations',
  website_url: 'https://acme.example',
  social_urls: [],
  keywords: ['evaluations'],
  status: 'active',
  monitoring_frequency: 'weekly',
  created_at: NOW.toISOString(),
  updated_at: NOW.toISOString(),
  last_analyzed_at: null,
  is_self: false,
}

const sources: GatheredSource[] = [
  { id: 's1', source_url: 'https://acme.example', source_type: 'website', title: 'Acme AI', source_date: null, retrieved_at: NOW.toISOString(), text: 'Acme AI — evaluation data for frontier labs.' },
  { id: 's2', source_url: 'https://acme.example/pricing', source_type: 'pricing', title: 'Pricing', source_date: null, retrieved_at: NOW.toISOString(), text: 'Starter $99/mo. Enterprise: contact us.' },
  { id: 's3', source_url: 'https://news.example/acme-raises', source_type: 'news', title: 'Acme raises $50M', source_date: '2026-09-20T10:00:00.000Z', retrieved_at: NOW.toISOString(), text: 'Acme raises $50M' },
]

const seo = { status: 'not_configured' as const, reason: 'x', domain_rank: null, organic_keywords: null, estimated_organic_traffic: null, organic_traffic_value_usd: null, backlinks: null, referring_domains: null, top_pages: [], organic_competitors: [], retrieved_at: null }

function claudeReturning(json: unknown) {
  return async () => ({ text: JSON.stringify(json), costUsd: 0.01, isError: false, errorMessage: null })
}

describe('the marketing-skills adapter', () => {
  it('reads the vendored competitor-profiling skill at run time', () => {
    const skill = loadSkill('competitor-profiling')
    expect(skill).not.toBeNull()
    expect(skill?.version).toMatch(/^\d+\.\d+/)
    expect(section(skill?.body ?? '', 'Core Principles')).toContain('Facts Over Opinions')
    expect(skill?.references['tool-reference.md']).toContain('firecrawl_scrape')
  })
  it('binds every skill tool to an SMA source and says which are unavailable', () => {
    const off = toolBindings(false)
    expect(off.find((t) => t.tool === 'firecrawl_scrape')?.available).toBe(true)
    expect(off.find((t) => t.tool === 'backlinks_summary')?.available).toBe(false)
    expect(toolBindings(true).every((t) => t.available)).toBe(true)
  })
})

describe('claims', () => {
  const known = new Set(['s1', 's2'])
  it('keeps cited facts and relabels an unsourced fact as inference', () => {
    expect(toClaim({ text: 'Founded in 2020', kind: 'fact', source_ids: ['s1', 's9'] }, known)).toEqual({ text: 'Founded in 2020', kind: 'fact', source_ids: ['s1'] })
    expect(toClaim({ text: 'Probably 200 staff', kind: 'fact', source_ids: ['s9'] }, known)?.kind).toBe('inference')
  })
  it('drops ranking language', () => {
    expect(toClaim({ text: 'Acme is the best competitor in evals', kind: 'analysis', source_ids: [] }, known)).toBeNull()
    expect(toClaim({ text: 'The clear winner of the category', kind: 'analysis', source_ids: [] }, known)).toBeNull()
    expect(toClaim({ text: 'Competitor score: 8/10', kind: 'analysis', source_ids: [] }, known)).toBeNull()
  })
})

describe('sources', () => {
  it('picks the key pages by path, shortest first, same site only', () => {
    const pages = pickKeyPages('https://acme.example', ['/pricing/enterprise', '/pricing', 'https://acme.example/about', 'https://other.example/blog', '/blog/post-1', '/blog'])
    expect(pages).toEqual([
      { url: 'https://acme.example/pricing', type: 'pricing' },
      { url: 'https://acme.example/about', type: 'about' },
      { url: 'https://acme.example/blog', type: 'blog' },
    ])
  })
  it('turns a page into readable text without scripts', () => {
    const t = htmlToText('<html><head><title>Acme</title><meta name="description" content="Evals"></head><body><script>evil()</script><h1>Hello</h1><p>World &amp; more</p></body></html>', 1000)
    expect(t.title).toBe('Acme')
    expect(t.description).toBe('Evals')
    expect(t.text).toContain('World & more')
    expect(t.text).not.toContain('evil')
  })
  it('reads a Wikipedia infobox', () => {
    const html = '<table class="infobox vcard"><tr><th>Founded</th><td>2015<sup>[1]</sup></td></tr><tr><th>Headquarters</th><td>San Francisco</td></tr></table><div id="mw-content-text"><p>Acme is an artificial intelligence company that builds evaluation datasets for labs.</p></div>'
    const text = wikipediaText(html, 2000)
    expect(text).toContain('Founded: 2015')
    expect(text).toContain('Headquarters: San Francisco')
  })
  it('dates news only by the feed', () => {
    const items = parseFeed('<rss><item><title>Acme ships evals</title><link>https://n.example/a</link><pubDate>Tue, 22 Sep 2026 10:00:00 GMT</pubDate></item></rss>', NOW)
    expect(items[0]?.publishedAt).toBe('2026-09-22T10:00:00.000Z')
  })
})

describe('profile generation (Claude mocked)', () => {
  process.env.CLAUDE_CODE_BIN = '/bin/true'
  it('keeps only what the evidence supports', async () => {
    const { profile } = await generateProfile(
      { competitor, depth: 'quick', sources, seo, reviews: [], coverageNotes: [], version: 1, now: NOW },
      { model: 'sonnet', maxBudgetUsd: 0.1, timeoutMs: 1000 },
      claudeReturning({
        overview: [{ text: 'Acme sells evaluation data.', kind: 'fact', source_ids: ['s1'] }],
        at_a_glance: { tagline: { text: 'Evaluation data for frontier labs', kind: 'fact', source_ids: ['s1'] }, founded: { text: '2019', kind: 'inference', source_ids: [] }, headquarters: null, team_size: null, funding: { text: '$50M raised', kind: 'fact', source_ids: ['s3'] } },
        pricing: { tiers: [{ name: 'Starter', price: '$99/mo', inclusions: [], source_ids: ['s2'] }, { name: 'Pro', price: '$499/mo', inclusions: [], source_ids: [] }] },
        capabilities: [{ capability: 'Evaluations', evidence: { text: 'Evaluation data', kind: 'fact', source_ids: ['s1'] } }, { capability: 'Made Up', evidence: { text: 'x', kind: 'fact', source_ids: ['s1'] } }],
        recent_developments: [{ title: 'Acme raises $50M', summary: { text: 'Funding round', kind: 'fact', source_ids: ['s3'] }, source_ids: ['s3'] }, { title: 'Undated rumour', source_ids: [] }],
        strengths: [{ text: 'Acme is the #1 competitor', kind: 'analysis', source_ids: [] }],
      }),
    )
    expect(profile.by).toBe('claude')
    expect(profile.at_a_glance.tagline.value).toBe('Evaluation data for frontier labs')
    // An inference never fills a fact field.
    expect(profile.at_a_glance.founded.value).toBe(NOT_AVAILABLE)
    expect(profile.at_a_glance.headquarters.value).toBe(NOT_AVAILABLE)
    // A price without a source is dropped.
    expect(profile.pricing.tiers.map((t) => t.name)).toEqual(['Starter'])
    expect(profile.capabilities.map((c) => c.capability)).toEqual(['Evaluations'])
    // Dated by the source's own date; undated development dropped.
    expect(profile.recent_developments).toHaveLength(1)
    expect(profile.recent_developments[0]?.date).toBe('2026-09-20T10:00:00.000Z')
    expect(profile.strengths).toHaveLength(0)
    expect(profile.seo.status).toBe('not_configured')
  })
  it('states when Claude could not answer, keeping the sources', async () => {
    const { profile } = await generateProfile(
      { competitor, depth: 'quick', sources, seo, reviews: [], coverageNotes: [], version: 1, now: NOW },
      { model: 'sonnet', maxBudgetUsd: 0.1, timeoutMs: 1000 },
      async () => ({ text: null, costUsd: null, isError: true, errorMessage: 'budget exceeded' }),
    )
    expect(profile.by).toBe('unavailable')
    expect(profile.error).toBe('budget exceeded')
    expect(profile.sources).toHaveLength(3)
  })
})

describe('change tracking', () => {
  it('lists pricing, product and development changes', () => {
    const base = { by: 'claude', pricing: { tiers: [{ name: 'Starter', price: '$99/mo', inclusions: [], source_ids: ['s2'] }], model: null, free_tier: null, enterprise: null, note: null }, products: [{ name: 'Evals', description: { text: 'x', kind: 'fact', source_ids: ['s1'] } }], capabilities: [], positioning: { value_proposition: null, target_audience: [], positioning_angle: null, messaging_themes: [], core_claims: [] }, at_a_glance: { tagline: { value: NOT_AVAILABLE, claim: null } }, recent_developments: [], content: { themes: [], formats: [], strategy_signals: [] }, sources: [{ id: 's2', source_type: 'pricing', source_url: 'https://acme.example/pricing' }], seo } as unknown as CompetitorProfile
    const next = { ...base, pricing: { ...base.pricing, tiers: [{ name: 'Starter', price: '$129/mo', inclusions: [], source_ids: ['s2'] }, { name: 'Team', price: '$999/mo', inclusions: [], source_ids: ['s2'] }] }, products: [], recent_developments: [{ title: 'Launched Agents', date: '2026-09-21', summary: null, source_ids: ['s3'] }], sources: [] } as unknown as CompetitorProfile
    const changes = diffProfiles(base, next)
    expect(changes).toEqual(
      expect.arrayContaining([
        { kind: 'changed', area: 'Pricing', detail: 'Starter: $99/mo → $129/mo' },
        { kind: 'added', area: 'Pricing', detail: 'New pricing tier: Team ($999/mo)' },
        { kind: 'removed', area: 'Product', detail: 'Product no longer found: Evals' },
        { kind: 'added', area: 'Recent developments', detail: '2026-09-21 Launched Agents' },
        { kind: 'removed', area: 'Website', detail: 'Previous pricing page not found this time: https://acme.example/pricing' },
      ]),
    )
    expect(diffProfiles(null, next)).toEqual([])
  })
})

describe('monitoring frequency', () => {
  it('is due when never analysed or past its interval, never when manual or inactive', () => {
    expect(isDue(competitor, NOW)).toBe(true)
    expect(isDue({ ...competitor, last_analyzed_at: '2026-09-22T06:00:00Z' }, NOW)).toBe(false)
    expect(isDue({ ...competitor, last_analyzed_at: '2026-09-15T06:00:00Z' }, NOW)).toBe(true)
    expect(isDue({ ...competitor, monitoring_frequency: 'manual' }, NOW)).toBe(false)
    expect(isDue({ ...competitor, status: 'inactive' }, NOW)).toBe(false)
  })
})

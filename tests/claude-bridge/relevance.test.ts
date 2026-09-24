import { describe, expect, it } from 'vitest'
import { normalizeCandidates } from '../../server/src/bridges/claude-bridge/processing/normalizer'
import { analyzeRelevance, buildRelevanceModel, meetsMinimum, termPattern } from '../../server/src/bridges/claude-bridge/processing/relevance'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'
import { NOW, candidate, cfg, context, daysAgo, postUrl } from './helpers'

const model = buildRelevanceModel(context, cfg)

function relevanceOf(over: Parameters<typeof candidate>[0]) {
  const [item] = normalizeCandidates([candidate({ url: postUrl('a', 'x', daysAgo(1)), ...over })], linkedin, cfg, NOW).items
  return analyzeRelevance(item!, model, cfg)
}

describe('brand relevance', () => {
  it('never reads a keyword out of a LinkedIn URL\'s random suffix', () => {
    const [item] = normalizeCandidates(
      [candidate({ url: 'https://www.linkedin.com/posts/pyramexsafety_employee-voices-trusted-partner-activity-7462548945869811712-rLvr', text: 'Employee voices: a trusted partner', keyword: null, query: null })],
      linkedin,
      cfg,
      NOW,
    ).items
    expect(analyzeRelevance(item!, model, cfg).matched_keywords).not.toContain('RLVR')
  })

  it('counts a bare acronym only when another signal places the post in the field', () => {
    expect(relevanceOf({ text: 'Programme de la RLVR 2026 : inscriptions ouvertes', keyword: null, query: null }).matched_keywords).not.toContain('RLVR')
    expect(relevanceOf({ text: 'RLVR removed reward hacking in our post-training runs', keyword: null, query: null }).matched_keywords).toContain('RLVR')
  })

  it('classes an on-brand post high and names the keyword, topics and KB terms behind it', () => {
    const r = relevanceOf({
      text: 'RLVR in practice: verifiable rewards removed reward hacking in our post-training runs. #RLVR',
      keyword: 'RLVR',
    })
    expect(r.level).toBe('high')
    expect(r.matched_keywords).toContain('RLVR')
    expect(r.reason).toMatch(/RLVR/)
    expect(r.reason).toMatch(/Knowledge Base/)
  })

  it('classes an off-brand post low', () => {
    const r = relevanceOf({ text: 'Five sales tips to close the quarter strong. #Sales', keyword: null, query: null })
    expect(r.level).toBe('low')
    expect(r.reason).toMatch(/none of the configured keywords/)
  })

  it('penalises language the brand voice rejects, and says so', () => {
    const clean = relevanceOf({ text: 'AI agents need long-horizon evaluation environments.' })
    const hype = relevanceOf({ text: 'Game-changing, revolutionary AI agents will 10x your team. Book a demo! Long-horizon evaluation environments.' })
    expect(hype.relevance_score).toBeLessThan(clean.relevance_score)
    expect(hype.hype_hits.length).toBeGreaterThan(1)
    expect(hype.reason).toMatch(/hype/)
  })

  it('flags sensitive subjects and forces excluded terms to low', () => {
    expect(relevanceOf({ text: 'We raised a seed round to build AI agents.' }).restriction_hits).toContain('Unannounced funding')
    // "Crypto trading bots" is an Excluded Topic entry in the sample Knowledge Base.
    const excluded = relevanceOf({ text: 'Crypto trading bots built on AI agents and RLVR evaluation environments.' })
    expect(excluded.level).toBe('low')
    expect(excluded.reason).toMatch(/excluded subject/)
  })

  it('credits a search match at reduced strength when the visible text omits the keyword', () => {
    const r = relevanceOf({ title: 'Five lessons from last quarter', text: null, keyword: 'RLVR' })
    expect(r.matched_keywords).toEqual(['RLVR'])
    expect(r.keyword_score).toBeCloseTo((90 / 100) * cfg.relevance.query_match_factor, 3)
    expect(r.reason).toMatch(/returned by a search/)
  })

  it('matches terms across hyphens, spaces and plurals', () => {
    expect(termPattern('post-training').test('post training at scale')).toBe(true)
    expect(termPattern('AI agent').test('AI agents are')).toBe(true)
    expect(termPattern('RL').test('world')).toBe(false)
    expect(meetsMinimum('medium', 'medium')).toBe(true)
    expect(meetsMinimum('low', 'medium')).toBe(false)
  })
})

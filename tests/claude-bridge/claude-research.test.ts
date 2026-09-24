/**
 * The research session's two layers: Claude's JSON analysis is kept only where
 * its evidence URLs were returned by a search in the same session.
 */
import { describe, expect, it } from 'vitest'
import { SYSTEM_PROMPT, dedupeTrends, loadReferences, sessionPrompt, systemPromptWith, topicOf, verifiedAnalysis } from '../../server/src/bridges/claude-bridge/adapters/claude-code'
import { x } from '../../server/src/bridges/claude-bridge/platforms/x'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'

const REAL = 'https://x.com/EpochAIResearch/status/2100704765332394255'
const searches = [{ query: '"AI benchmarks" September 2026', links: [{ url: REAL, title: 'Epoch AI on X: "Introducing Benchmark Reviews"' }] }]

describe('the research session', () => {
  it('keeps evidence a search returned, dates it from the post id, and drops invented URLs', () => {
    const reply = '```json\n' + JSON.stringify({
      trends: [
        { topic: 'Benchmark audits', trend_type: 'Emerging trend', platform: 'X', related_keywords: ['AI benchmarks'], hashtags: [], why_trending: 'New audit initiative', confidence: 'medium',
          evidence: [{ title: 'Epoch', url: REAL + '/', source: 'X', published_at: '2020-01-01' }, { title: 'made up', url: 'https://x.com/nobody/status/1', source: 'X', published_at: '' }] },
        { topic: 'Invented', trend_type: 'Active trend', platform: 'X', related_keywords: [], hashtags: [], why_trending: '', confidence: 'high',
          evidence: [{ title: 'x', url: 'https://x.com/ghost/status/2', source: 'X', published_at: '' }] },
      ],
      platforms_with_insufficient_data: ['Instagram'],
    }) + '\n```'
    const a = verifiedAnalysis(reply, searches, x)
    expect(a.parsed).toBe(true)
    expect(a.trends).toHaveLength(1)
    expect(a.trends[0]!.evidence).toHaveLength(1)
    expect(a.trends[0]!.unverifiedEvidenceDropped).toBe(1)
    expect(a.trends[0]!.evidence[0]!.dateSource).toBe('platform_id')
    expect(a.trends[0]!.evidence[0]!.publishedAt!.startsWith('2026-09')).toBe(true)
    expect(a.insufficient).toEqual(['Instagram'])
  })

  it('keeps nothing from a reply that is not JSON', () => {
    expect(verifiedAnalysis('I could not find anything.', searches, x)).toEqual({ trends: [], insufficient: [], parsed: false })
  })

  it('fills the brief and states the search limit', () => {
    expect(topicOf('"post-training" September 2026')).toBe('post-training')
    const p = sessionPrompt({ keywords: ['RLVR'], platforms: 'X (x.com)', region: 'Global', timeWindow: '2026-09-01 to 2026-09-24', trendCount: 10, brandContext: 'Ethara', maxSearches: 16 })
    expect(p).toContain('- RLVR')
    expect(p).toContain('run at most 16 searches')
    expect(SYSTEM_PROMPT).toContain('Trend Intelligence Acquisition Agent')
  })

  it('names the month, lists hashtags apart from topics, and carries the platform notes', () => {
    const p = sessionPrompt({ keywords: ['RLVR'], hashtags: ['#RLVR', '#AgenticAI'], month: 'September 2026', platformNotes: 'Cite LinkedIn post URLs only.',
      platforms: 'LinkedIn', region: 'Global', timeWindow: 'September 2026 — 1 September 2026 to 24 September 2026 (today)', trendCount: 10, brandContext: 'Ethara', maxSearches: 16 })
    expect(p).toContain('**Hashtags to check:**\n#RLVR, #AgenticAI')
    expect(p).toContain('"RLVR" September 2026')
    expect(p).toContain('platform research strategy in the system prompt')
    expect(p).toContain('corpus_theme')
    expect(p).toContain('window_status')
  })

  it('puts the platform research strategy in the system prompt', () => {
    const sys = systemPromptWith([], { platform: 'LinkedIn', text: 'Cite LinkedIn post URLs only.' })
    expect(sys.startsWith(SYSTEM_PROMPT)).toBe(true)
    expect(sys).toContain('### Platform research strategy: LinkedIn')
    expect(sys).toContain('Cite LinkedIn post URLs only.')
  })

  it('relabels a "current_month" trend whose every decoded date is older', () => {
    const old = 'https://www.linkedin.com/posts/zhavoronkov_reinforcement-learning-just-got-a-principled-activity-7487036913904795650-7rzu'
    const reply = JSON.stringify({ trends: [{ topic: 'RLVR', trend_type: 'Active trend', platform: 'LinkedIn', related_keywords: [], hashtags: [], why_trending: 'x', confidence: 'low', window_status: 'current_month',
      evidence: [{ title: 'RL post', url: old, source: 'LinkedIn', published_at: '' }] }], platforms_with_insufficient_data: [] })
    const a = verifiedAnalysis(reply, [{ query: 'q', links: [{ url: old, title: 'RL post' }] }], linkedin, new Date('2026-08-31T18:30:00Z'))
    expect(a.trends[0]!.windowStatus).toBe('latest_available')
    expect(a.trends[0]!.windowStatusCorrected).toBe(true)
  })

  it('loads the reference documents into the system prompt and reports a missing one', () => {
    const refs = loadReferences(['corpus/reference/CORPUS_SUMMARY.md', 'corpus/reference/NOPE.md'])
    expect(refs.missing).toEqual(['corpus/reference/NOPE.md'])
    const sys = systemPromptWith(refs.docs)
    expect(sys.startsWith(SYSTEM_PROMPT)).toBe(true)
    expect(sys).toContain('<reference name="CORPUS_SUMMARY.md">')
  })

  it('drops a trend whose evidence an earlier trend already cites', () => {
    const t = (topic: string, urls: string[]) => ({ topic, trendType: '', platform: 'LinkedIn', relatedKeywords: [], hashtags: [], whyTrending: '', confidence: 'low' as const,
      windowStatus: 'latest_available' as const, windowStatusCorrected: false, corpusTheme: 'A', unverifiedEvidenceDropped: 0,
      evidence: urls.map((url) => ({ title: '', url, source: '', publishedAt: null, dateSource: 'none' as const })) })
    const out = dedupeTrends([t('RLVR', ['https://x.com/a/status/1']), t('RLVR again', ['https://x.com/a/status/1/']), t('Other', ['https://x.com/a/status/1', 'https://x.com/b/status/2'])])
    expect(out.map((x) => x.topic)).toEqual(['RLVR', 'Other'])
  })
})

/**
 * The research session: the operator's system prompt, the three input files,
 * and the bridge's checks on Claude's JSON (evidence must come from the
 * session's own searches; previous-month evidence cannot establish a trend).
 */
import { describe, expect, it } from 'vitest'
import {
  SYSTEM_PROMPT,
  dedupeTrends,
  loadReferences,
  sessionPrompt,
  systemPromptWith,
  topicOf,
  verifiedAnalysis,
} from '../../server/src/bridges/claude-bridge/adapters/claude-code'
import { loadBridgeConfig } from '../../server/src/bridges/claude-bridge/config'
import { x } from '../../server/src/bridges/claude-bridge/platforms/x'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'

const SEPT = 'https://x.com/EpochAIResearch/status/2100704765332394255' // decodes to 2026-09-17
const JULY = 'https://www.linkedin.com/posts/zhavoronkov_reinforcement-learning-just-got-a-principled-activity-7487036913904795650-7rzu' // 2026-07-26
const WINDOW_FROM = new Date('2026-08-31T18:30:00Z') // 1 September, Asia/Kolkata

const trend = (over: Record<string, unknown>) => ({
  topic: 'Benchmark audits',
  trend_type: 'news_event',
  trend_status: 'emerging',
  platform: 'X',
  related_keywords: ['AI benchmarks'],
  hashtags: [],
  why_trending: 'New audit initiative',
  observed_signals: ['Epoch AI announcement'],
  brand_relevance: { relevance: 'high', reason: 'Evaluation & benchmarks domain' },
  confidence: 'medium',
  evidence: [{ title: 'Epoch', url: SEPT, source: 'X', published_at: '', evidence_summary: 'Launch post' }],
  ...over,
})
const reply = (trends: unknown[], extra: Record<string, unknown> = {}) =>
  JSON.stringify({ query_context: {}, trends, platforms_with_insufficient_data: [], search_limitations: [], ...extra })

describe('the system prompt', () => {
  it('is the operator\'s text, and the files follow it labelled File 1/2/3', () => {
    expect(SYSTEM_PROMPT.startsWith('You are the **Trend Intelligence Acquisition Agent**')).toBe(true)
    expect(SYSTEM_PROMPT).toContain('# 31. OUTPUT')
    const refs = loadReferences(loadBridgeConfig().acquisition.claude_code.research.reference_files)
    expect(refs.missing).toEqual([])
    expect(refs.docs.map((d) => d.role)).toEqual(['File 1 — Keywords', 'File 2 — Knowledge Base', 'File 3 — Brand Voice'])
    const sys = systemPromptWith(refs.docs, { platform: 'LinkedIn', text: 'Search linkedin.com first.' })
    expect(sys.startsWith(SYSTEM_PROMPT)).toBe(true)
    expect(sys).toContain('# PLATFORM RESEARCH STRATEGY — LinkedIn')
    expect(sys).toContain('<input_file role="File 1 — Keywords" name="KEYWORD_INSTRUCTION_MAP.md">')
    expect(sys.indexOf('PLATFORM RESEARCH STRATEGY')).toBeLessThan(sys.indexOf('# INPUT FILES PROVIDED'))
  })

  it('reports a missing input file rather than skipping it silently', () => {
    expect(loadReferences(['corpus/reference/NOPE.md']).missing).toEqual(['corpus/reference/NOPE.md'])
  })
})

describe('the session prompt', () => {
  it('states the current month, the window, max_trends and the search limit', () => {
    expect(topicOf('"post-training" September 2026')).toBe('post-training')
    const p = sessionPrompt({
      keywords: ['RLVR'],
      hashtags: ['#RLVR', '#AgenticAI'],
      month: 'September 2026',
      platformNotes: 'x',
      platforms: 'LinkedIn',
      region: 'Global',
      timeWindow: 'September 2026 — the current month: 1 September 2026 to 24 September 2026 (today)',
      trendCount: 10,
      brandContext: 'Ethara',
      maxSearches: 16,
    })
    expect(p).toContain('**Current month:**\nSeptember 2026')
    expect(p).toContain('**Maximum number of trends (max_trends):**\n10')
    expect(p).toContain('**Hashtags to check:**\n#RLVR, #AgenticAI')
    expect(p).toContain('"RLVR" September 2026')
    expect(p).toContain('platform research strategy in the system prompt')
    expect(p).toContain('run at most 16 searches')
    // Fields outside the schema the system prompt fixes ("use exactly") are not asked for.
    expect(p).not.toContain('window_status')
    expect(p).not.toContain('corpus_theme')
  })
})

describe("the bridge's checks on Claude's JSON", () => {
  it('keeps the new schema fields and evidence a search returned; drops invented URLs', () => {
    const a = verifiedAnalysis(
      '```json\n' +
        reply(
          [trend({ evidence: [{ title: 'Epoch', url: SEPT + '/', source: 'X', published_at: '', evidence_summary: 'Launch post' }, { title: 'made up', url: 'https://x.com/nobody/status/1', source: 'X', published_at: '', evidence_summary: '' }] })],
          { platforms_with_insufficient_data: ['Instagram'], search_limitations: ['X search is not a trending feed'] },
        ) +
        '\n```',
      [{ query: 'q', links: [{ url: SEPT, title: 'Epoch AI on X' }] }],
      x,
      WINDOW_FROM,
    )
    expect(a.parsed).toBe(true)
    const t = a.trends[0]!
    expect(t.trendType).toBe('news_event')
    expect(t.trendStatus).toBe('emerging')
    expect(t.observedSignals).toEqual(['Epoch AI announcement'])
    expect(t.brandRelevance).toEqual({ relevance: 'high', reason: 'Evaluation & benchmarks domain' })
    expect(t.evidence).toHaveLength(1)
    expect(t.evidence[0]!.summary).toBe('Launch post')
    expect(t.evidence[0]!.dateSource).toBe('platform_id')
    expect(t.unverifiedEvidenceDropped).toBe(1)
    expect(t.windowStatus).toBe('current_month')
    expect(a.insufficient).toEqual(['Instagram'])
    expect(a.limitations).toEqual(['X search is not a trending feed'])
  })

  it('drops a trend whose evidence all predates the current month (section 5)', () => {
    const a = verifiedAnalysis(
      reply([trend({ platform: 'LinkedIn', evidence: [{ title: 'RL post', url: JULY, source: 'LinkedIn', published_at: '2026-09-20', evidence_summary: '' }] })]),
      [{ query: 'q', links: [{ url: JULY, title: 'RL post' }] }],
      linkedin,
      WINDOW_FROM,
    )
    // Claude's stated date is overridden by the one decoded from the activity id.
    expect(a.trends).toHaveLength(0)
    expect(a.droppedOutsideWindow).toBe(1)
  })

  it('accepts a month-level stated date inside the window, and labels undated evidence unverified', () => {
    const arxiv = 'https://arxiv.org/abs/2609.16816'
    const undated = 'https://example.org/post'
    const links = [{ query: 'q', links: [{ url: arxiv, title: 'paper' }, { url: undated, title: 'post' }] }]
    const month = verifiedAnalysis(reply([trend({ evidence: [{ title: 'p', url: arxiv, source: 'arXiv', published_at: '2026-09', evidence_summary: '' }] })]), links, x, WINDOW_FROM)
    expect(month.trends[0]!.windowStatus).toBe('current_month')
    const none = verifiedAnalysis(reply([trend({ evidence: [{ title: 'p', url: undated, source: 'blog', published_at: '', evidence_summary: '' }] })]), links, x, WINDOW_FROM)
    expect(none.trends[0]!.windowStatus).toBe('unverified')
  })

  it('dates arXiv evidence from its id, and drops a paper from before the month', () => {
    const sept = 'https://arxiv.org/abs/2609.16816v1'
    const july = 'https://arxiv.org/pdf/2607.01234'
    const links = [{ query: 'q', links: [{ url: sept, title: 'paper' }, { url: july, title: 'old paper' }] }]
    const a = verifiedAnalysis(reply([trend({ evidence: [{ title: 'p', url: sept, source: 'arXiv', published_at: '', evidence_summary: '' }] })]), links, x, WINDOW_FROM)
    expect(a.trends[0]!.evidence[0]!.dateSource).toBe('arxiv_id')
    expect(a.trends[0]!.evidence[0]!.publishedAt).toBe('2026-09')
    expect(a.trends[0]!.windowStatus).toBe('current_month')
    const b = verifiedAnalysis(reply([trend({ evidence: [{ title: 'p', url: july, source: 'arXiv', published_at: '2026-09-20', evidence_summary: '' }] })]), links, x, WINDOW_FROM)
    expect(b.droppedOutsideWindow).toBe(1)
  })

  it('keeps nothing from a reply that is not JSON', () => {
    expect(verifiedAnalysis('I could not find anything.', [], x, WINDOW_FROM).parsed).toBe(false)
  })

  it('drops a trend whose evidence an earlier trend already cites', () => {
    const a = verifiedAnalysis(
      reply([trend({ topic: 'A' }), trend({ topic: 'A again' })]),
      [{ query: 'q', links: [{ url: SEPT, title: 't' }] }],
      x,
      WINDOW_FROM,
    )
    expect(dedupeTrends(a.trends).map((t) => t.topic)).toEqual(['A'])
  })
})

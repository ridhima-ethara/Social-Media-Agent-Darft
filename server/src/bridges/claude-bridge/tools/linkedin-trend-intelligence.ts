/**
 * THE CLAUDE CODE TOOLS
 *
 * `linkedin_trend_intelligence` runs the whole pipeline and returns the JSON
 * plus its Markdown rendering. `linkedin_trend_context` returns only what the
 * bridge read and the queries it would run — cheap, no acquisition — so Claude
 * can plan extra queries before spending a search.
 *
 * Division of labour, stated in the description Claude reads: the bridge
 * acquires, validates, dates, de-duplicates and scores; Claude interprets,
 * explains and summarises, and labels its own interpretation as such.
 */

import { ADAPTER_IDS, loadBridgeConfig } from '../config'
import { loadProjectContext, prioritiseKeywords } from '../context'
import { createAdapter } from '../adapters/linkedin-source-adapter'
import { buildQueries } from '../discovery/query-builder'
import { renderMarkdown } from '../output/markdown'
import { runTrendIntelligence } from '../pipeline'
import { PLATFORM_IDS, platformModule } from '../platforms'
import { trendToolInputSchema, type TrendIntelligenceOutput } from '../schemas/trend-output'
import { z } from 'zod'
import { synonymsFor } from '../../../../../shared/keywords'
import { discoverPlatformTrends, type PlatformTrendReport } from '../trends/platform-trends'

export const TREND_TOOL_NAME = 'linkedin_trend_intelligence'
/** The same tool under a platform-neutral name, for Instagram, X, Facebook and the open web. */
export const SOCIAL_TOOL_NAME = 'social_trend_intelligence'
export const CONTEXT_TOOL_NAME = 'linkedin_trend_context'
/** Platform-level discovery: what is trending on each platform in the last 48 hours. */
export const PLATFORM_TRENDS_TOOL_NAME = 'platform_trend_discovery'

export const PLATFORM_TRENDS_TOOL_DESCRIPTION = [
  'What is trending, relevant to Ethara, on LinkedIn, Instagram, Facebook and X in the last 48 hours (the Scraping Agent\'s capture).',
  'Call it with no arguments. For each platform it runs at most 3 focused web searches built from the Knowledge Base, brand context',
  'and keywords; keeps only posts whose date is verified inside the window (decoded from the post id) and that mention an Ethara',
  'keyword; groups them into trends (at most 5 posts each) with hashtags, URLs, dates, authors, matched keywords and a computed reason;',
  'newest first. It writes no content and no calendar. Search engines index social posts late, so an empty platform is common and is',
  'reported with its reason and the newest date that was found — say so plainly; never fill the gap.',
].join(' ')

export const PLATFORM_TRENDS_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    hours: { type: 'integer', minimum: 1, maximum: 2160, description: 'The window in hours. Default 48.' },
    platforms: {
      type: 'array',
      items: { type: 'string', enum: ['linkedin', 'instagram', 'facebook', 'x'] },
      description: 'Default: all four.',
    },
    keywords: { type: 'array', items: { type: 'string' }, maxItems: 50, description: 'Override the SMA keyword set.' },
  },
} as const

const platformTrendsArgs = z
  .object({
    hours: z.number().int().min(1).max(2160).optional(),
    platforms: z.array(z.enum(['linkedin', 'instagram', 'facebook', 'x', 'web'])).min(1).optional(),
    keywords: z.array(z.string().trim().min(1).max(120)).max(50).optional(),
  })
  .strict()

export type PlatformTrendsArgs = z.infer<typeof platformTrendsArgs>
export { platformTrendsArgs }

/** A short Markdown rendering: per-platform outcome, then the trends newest first. */
export function renderPlatformTrends(report: PlatformTrendReport): string {
  const today = report.trends.filter((t) => t.period === 'today').length
  const lines = [
    `## Platform trend discovery · trending today (${report.today}) and ${report.windowName}`,
    '',
    `${today} trend(s) trending today, listed first.`,
    '',
  ]
  lines.push(`${report.searchesRun} searches · keywords: ${report.keywordsUsed.join(', ')}`, '')
  for (const p of report.platforms) {
    lines.push(`- **${p.platform}**: ${p.status}${p.status === 'ok' ? ` · ${p.kept} post(s)` : ''}${p.reason ? ` — ${p.reason}` : ''}`)
  }
  lines.push('')
  if (report.trends.length === 0) {
    lines.push('_No Ethara-relevant post was verifiably published in the window. Nothing has been substituted._')
  } else {
    lines.push('| When | Newest | Platform | Trend | Hashtags | Posts | Matched keywords |', '|---|---|---|---|---|---|---|')
    for (const t of report.trends) {
      const newest = t.posts[0]?.publishedAt.slice(0, 16).replace('T', ' ') ?? ''
      const links = t.posts.map((p, i) => `[${i + 1}](${p.url})`).join(' ')
      const when = t.period === 'today' ? `**Today** (${t.postsToday})` : t.period === 'older' ? 'Before the window' : 'This month'
      lines.push(`| ${when} | ${newest} | ${t.platform} | ${t.trend} | ${t.hashtags.join(' ') || '—'} | ${links} | ${t.matchedEtharaKeywords.join(', ')} |`)
    }
    lines.push('', '_Dates, URLs, hashtags and authors are verified source data; trend names and reasons are computed by the bridge._')
  }
  const claude = report.platforms.flatMap((p) => p.claudeTrends ?? [])
  if (claude.length > 0) {
    lines.push(
      '',
      "### Claude's trend intelligence (research session)",
      '',
      '| Platform | Topic | Type | Status | Month | Brand relevance | Confidence | Why trending | Evidence |',
      '|---|---|---|---|---|---|---|---|---|',
    )
    const cell = (t: string): string => t.replace(/\|/g, '/').replace(/\n+/g, ' ')
    for (const t of claude) {
      const ev = t.evidence
        .map((e, i) => `[${i + 1}](${e.url})${e.publishedAt ? ` ${e.publishedAt.slice(0, 10)}${e.dateSource === 'claude_stated' ? '*' : ''}` : ''} ${cell(e.source)}`)
        .join(' · ')
      const month = t.windowStatus === 'current_month' ? 'this month' : 'date not verified'
      lines.push(
        `| ${cell(t.platform)} | ${cell(t.topic)} | ${t.trendType || '—'} | ${t.trendStatus || '—'} | ${month} | ${t.brandRelevance.relevance}${t.brandRelevance.reason ? `: ${cell(t.brandRelevance.reason)}` : ''} | ${t.confidence} | ${cell(t.whyTrending)} | ${ev} |`,
      )
    }
    lines.push('', "_Claude's findings. Every evidence URL was returned by a search in the same session. Dates marked * are as Claude stated them; the rest are decoded from the post id or, for arXiv, the id's month. Trends whose evidence all predates the month are dropped._")
  }
  const insufficient = report.platforms.flatMap((p) => p.insufficientData ?? [])
  if (insufficient.length > 0) lines.push('', `**Platforms with insufficient data (Claude):** ${insufficient.join(' · ')}`)
  const limits = report.platforms.flatMap((p) => p.searchLimitations ?? [])
  if (limits.length > 0) lines.push('', `**Search limitations (Claude):** ${limits.join(' · ')}`)
  const notes = report.platforms.flatMap((p) => p.notes ?? [])
  if (notes.length > 0) lines.push('', `**Bridge notes:** ${notes.join(' · ')}`)
  return lines.join('\n')
}

export async function callPlatformTrendsTool(args: unknown): Promise<ToolResult> {
  const parsed = platformTrendsArgs.safeParse(args ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return { text: `Invalid arguments: ${issue?.path.join('.') || '(root)'} — ${issue?.message ?? 'invalid'}`, data: null, isError: true }
  }
  const a = parsed.data
  const report = await discoverPlatformTrends({
    ...(process.env.TZ ? { timeZone: process.env.TZ } : {}),
    ...(a.hours ? { windowHours: a.hours } : {}),
    ...(a.platforms ? { platforms: a.platforms } : {}),
    ...(a.keywords
      ? { keywords: a.keywords.map((term) => ({ term, weight: 100, category: 'Requested', synonyms: synonymsFor(term), scheduled: null })) }
      : {}),
  })
  return {
    text: `${renderPlatformTrends(report)}\n\n---\nStructured JSON:\n\`\`\`json\n${JSON.stringify({ trends: report.trends, platforms: report.platforms, window: report.window })}\n\`\`\``,
    data: report,
    isError: false,
  }
}

export const TREND_TOOL_DESCRIPTION = [
  'Latest trends relevant to the Ethara SMA brand on LinkedIn (default), Instagram, X, Facebook or the open web — set `platform`.',
  'Results are sorted newest first.',
  'Call it with no arguments for the normal case: it reads the Knowledge Base, brand voice and configured keywords from the SMA itself,',
  'generates discovery queries, acquires public posts through Claude Code web search, keeps only real post URLs,',
  'dates each post from the timestamp the platform encodes in its id (LinkedIn, X, Instagram) or from a web page\'s own published date,',
  'removes duplicates and stale items, scores brand relevance and trend strength,',
  'and returns structured JSON plus a Markdown table (Date | Trending Topic | Hashtags | Relevance | Post).',
  'Facebook posts cannot be dated from their ids, so they appear as undated.',
  'Live runs take a minute or two and spend a few cents of Claude usage per search session.',
  '',
  'HOW TO PRESENT THE RESULT: show the Markdown table as returned. Keep three layers distinct —',
  '(1) verified source data: post_url, published_at (date_status "verified"), hashtags, snippet;',
  '(2) bridge analysis, computed deterministically: topic, trend_score, brand_relevance and the reasons;',
  '(3) your own interpretation, which you must label as yours. Never present inferred trends as observed LinkedIn data,',
  'never add URLs, dates, hashtags or engagement figures that are not in the output, and if source_status is',
  '"unavailable", "empty" or "fixture", say so plainly instead of filling the gap.',
].join(' ')

export const CONTEXT_TOOL_DESCRIPTION =
  'Shows what the LinkedIn trend bridge would work from, without acquiring anything: the Knowledge Base, brand voice and keyword ' +
  'sources it read, the keywords in priority order, the discovery queries it would run, and which acquisition adapters are ' +
  'available. Use it to plan extra `queries` for linkedin_trend_intelligence.'

/** JSON Schema for the MCP `inputSchema`. Mirrors `trendToolInputSchema`, which validates every call. */
export const TREND_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    keywords: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 50,
      description: 'Override the configured keywords for this call. Omit to use the SMA keyword set.',
    },
    queries: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 50,
      description: 'Extra discovery queries you planned; run verbatim before the generated ones.',
    },
    post_urls: {
      type: 'array',
      items: { type: 'string' },
      maxItems: 100,
      description: 'LinkedIn post URLs to include in the analysis (e.g. ones a person shared). They are not fetched.',
    },
    date_from: { type: ['string', 'null'], description: 'ISO-8601 start of the window. Default: trend_window_days ago.' },
    date_to: { type: ['string', 'null'], description: 'ISO-8601 end of the window. Default: now.' },
    max_results: { type: 'integer', minimum: 1, maximum: 100, description: 'Default from config (20).' },
    include_hashtags: { type: 'boolean', default: true },
    include_post_urls: { type: 'boolean', default: true },
    brand_context: {
      type: 'boolean',
      default: true,
      description: 'False skips the brand-relevance filter and omits the context report.',
    },
    adapters: {
      type: 'array',
      items: { type: 'string', enum: [...ADAPTER_IDS] },
      description: 'Override the acquisition adapters. "fixture" returns test data only.',
    },
    min_brand_relevance: { type: 'string', enum: ['high', 'medium', 'low'] },
    platform: {
      type: 'string',
      enum: [...PLATFORM_IDS],
      description: 'Which lane to read. Default linkedin; "web" is the open web.',
    },
  },
} as const

export const CONTEXT_TOOL_INPUT_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    keywords: { type: 'array', items: { type: 'string' }, description: 'Preview queries for these keywords instead.' },
    platform: { type: 'string', enum: [...PLATFORM_IDS], description: 'Which lane’s adapters to report. Default linkedin.' },
  },
} as const

export interface ToolResult {
  /** What the MCP client receives: Markdown, then the JSON. */
  text: string
  /** The same result as data, for in-process callers and tests. */
  data: unknown
  isError: boolean
}

export async function callTrendTool(args: unknown): Promise<ToolResult> {
  const parsed = trendToolInputSchema.safeParse(args ?? {})
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    return {
      text: `Invalid arguments: ${issue?.path.join('.') || '(root)'} — ${issue?.message ?? 'invalid'}`,
      data: null,
      isError: true,
    }
  }
  const output: TrendIntelligenceOutput = await runTrendIntelligence({ input: parsed.data, mode: 'tool' })
  const markdown = renderMarkdown(output)
  return {
    text: `${markdown}\n\n---\nStructured JSON:\n\`\`\`json\n${JSON.stringify(output)}\n\`\`\``,
    data: output,
    isError: output.status === 'configuration_error',
  }
}

export async function callContextTool(args: unknown): Promise<ToolResult> {
  const cfg = loadBridgeConfig()
  const now = new Date()
  const requestedPlatform =
    args !== null && typeof args === 'object' && typeof (args as { platform?: unknown }).platform === 'string'
      ? (args as { platform: string }).platform
      : 'linkedin'
  const platform = platformModule(requestedPlatform)
  if (platform === undefined) return { text: `No platform module "${requestedPlatform}".`, data: null, isError: true }
  try {
    const ctx = await loadProjectContext(cfg, now)
    const requested =
      args !== null && typeof args === 'object' && Array.isArray((args as { keywords?: unknown }).keywords)
        ? ((args as { keywords: unknown[] }).keywords.filter((k): k is string => typeof k === 'string'))
        : []
    const keywords =
      requested.length > 0
        ? requested.map((term) => ({ term, weight: 100, category: 'Requested', synonyms: [], scheduled: null }))
        : prioritiseKeywords(ctx.keywords, cfg)
    const plan = buildQueries({ keywords, brandVoice: ctx.brandVoice }, cfg)
    const adapters = cfg.acquisition.adapters.map((id) => {
      const a = createAdapter(id, { platform, config: cfg })
      const availability = a.availability()
      return { adapter: id, label: a.label, available: availability.available, reason: availability.reason || null }
    })
    const structured = {
      knowledge_base: {
        source: ctx.knowledgeBase.source,
        entries: ctx.knowledgeBase.entries.length,
        categories: [...new Set(ctx.knowledgeBase.entries.map((e) => e.category))],
      },
      brand_voice: {
        sources: ctx.brandVoice.sources,
        positioning: ctx.brandVoice.positioning,
        audience: ctx.brandVoice.audience,
        voice_words: ctx.brandVoice.voice_words,
        domains: ctx.brandVoice.domains,
        excluded_terms: ctx.brandVoice.excluded_terms,
      },
      keywords: {
        source: requested.length > 0 ? 'input:keywords' : ctx.keywords.source,
        in_priority_order: keywords.slice(0, cfg.max_keywords).map((k) => ({ term: k.term, weight: k.weight, scheduled: k.scheduled })),
      },
      planned_queries: plan.queries,
      limits: {
        trend_window_days: cfg.trend_window_days,
        max_keywords: cfg.max_keywords,
        max_queries_per_keyword: cfg.max_queries_per_keyword,
        max_results_per_query: cfg.max_results_per_query,
        max_total_queries: cfg.max_total_queries,
      },
      adapters,
    }
    return { text: JSON.stringify(structured, null, 2), data: structured, isError: false }
  } catch (error) {
    return {
      text: `Configuration error: ${error instanceof Error ? error.message : String(error)}`,
      data: null,
      isError: true,
    }
  }
}

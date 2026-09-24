/**
 * `claude_code` — live acquisition through Claude Code's own web search.
 *
 * Claude Code runs a TREND-RESEARCH SESSION per batch of topics: it is given
 * the topics, the platform, the region, the window and the brand context (the
 * brief below), may run its own related searches with WebSearch, and replies
 * with a JSON trend analysis.
 *
 * TWO LAYERS COME BACK, AND THEY ARE KEPT APART.
 *
 *   1. The RAW SEARCH RESULTS of every search Claude ran (see `claude-cli.ts`):
 *      each result's URL and title. These are the observed data. They become
 *      candidates, are dated from the post id and judged for relevance by the
 *      bridge's own deterministic code — exactly as before.
 *
 *   2. CLAUDE'S ANALYSIS: its JSON trends. Kept as `claudeTrends`, a separate,
 *      labelled layer. Every evidence URL in it must have been returned by a
 *      search in that same session; one that was not is dropped and counted,
 *      so a URL Claude made up cannot get through. A trend left with no
 *      verified evidence is dropped. Its dates come from the post id where the
 *      platform encodes one, otherwise they are marked as Claude-stated.
 *
 * THE BUDGET. The brief states `max_searches_per_session`, and only that many
 * searches (the first ones run) are used, whatever the session did.
 *
 * WHAT IT CANNOT STATE, AND SAYS SO. A search result carries no engagement,
 * so `engagement` is always `null`. Claude is not asked to open the posts:
 * fetching platform pages is outside what this bridge does.
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { AdapterId, BridgeConfig } from '../config'
import { adapterLimits, REPO_ROOT } from '../config'
import { platformModule, type PlatformModule } from '../platforms'
import { BRAND } from '../../../../../shared/brand-voice'
import { resolveClaudeBinary, runClaudeSession, type ClaudeSessionResult, type ExecutedSearch } from './claude-cli'
import {
  SourceError,
  type AdapterAvailability,
  type BatchOutcome,
  type ClaudeTrend,
  type ClaudeTrendEvidence,
  type SearchRequest,
  type SourceCandidate,
  type TrendSourceAdapter,
} from './source-types'

const ID: AdapterId = 'claude_code'

/** Failures after which another session cannot succeed. */
const FATAL_PATTERNS = [
  /not logged in|authentication|unauthori[sz]ed|invalid api key|oauth|login/i,
  /credit balance|billing|quota|usage limit/i,
  /Could not start Claude Code/i,
]

/* ═══════════════════════════════════════════════════════════════════════════
   THE PROMPTS
   ═══════════════════════════════════════════════════════════════════════════ */

export const SYSTEM_PROMPT = `### System Prompt

You are the **Trend Intelligence Acquisition Agent** for a social-media intelligence system.

Your job is to research **current and recent trends** using the available WebSearch tool and return structured, evidence-based trend data.

The input will contain:

* Target keywords/topics
* Target platforms
* Geographic region
* Time window
* Number of trends required
* Optional brand/context information

### Core requirements

1. Search for **recent and currently active trends**, not general evergreen information.
2. Use the exact keywords/topics provided as the starting point, but expand the search when necessary to discover related terminology, emerging discussions, hashtags, news, posts, and conversations.
3. Do not rely on a single search query or a single source.
4. Search across the requested platforms and relevant public web sources.
5. Prioritize information from the requested time window.
6. Prefer sources showing actual recent activity, such as:

   * Recent posts
   * Recent discussions
   * Recent news
   * Rapidly increasing interest
   * Frequently discussed topics
   * Emerging hashtags
   * Recent announcements/releases
7. Do not treat a search result merely mentioning a keyword as a trend.
8. A topic should have evidence of **recent activity or momentum** before being classified as trending.
9. Deduplicate similar topics and hashtags.
10. Do not invent metrics, engagement numbers, timestamps, posts, URLs, or trend rankings.
11. If a platform does not expose reliable public trend information, explicitly mark the platform data as unavailable rather than fabricating it.
12. Distinguish between:

* Emerging trend
* Active trend
* High-volume/established topic
* News/event-driven topic

13. Capture the source URL whenever available.
14. Capture the date/time of the source whenever available.
15. Return the collected evidence in structured JSON.

### Search strategy

For each input keyword/topic, investigate:

* Exact keyword
* Related terms
* Emerging terminology
* Recent discussions
* Platform-specific posts
* Hashtags
* News/events
* Industry developments
* Questions/problems people are discussing
* Competitor or adjacent discussions when relevant

Use multiple searches where required to establish whether a topic is genuinely active.

For platform-specific searches, prioritize the requested platform domain.

Examples:

* X → \`x.com\`
* LinkedIn → \`linkedin.com\`
* Instagram → \`instagram.com\`
* Facebook → \`facebook.com\`

Do not assume that a platform's public search results represent its complete internal trending feed.

### Evidence requirements

Every returned trend must contain evidence.

A trend without supporting recent evidence must not be returned as a confirmed trend.

Use this confidence model:

* \`high\` → multiple recent sources/signals
* \`medium\` → at least one strong recent signal
* \`low\` → weak or indirect evidence

Do not manufacture confidence.

### Output

Return only valid JSON using this structure:

{
"query_context": {
"keywords": [],
"platforms": [],
"region": "",
"time_window": ""
},
"trends": [
{
"topic": "",
"trend_type": "",
"platform": "",
"related_keywords": [],
"hashtags": [],
"why_trending": "",
"evidence": [
{
"title": "",
"url": "",
"source": "",
"published_at": ""
}
],
"confidence": "high|medium|low"
}
],
"platforms_with_insufficient_data": []
}

Do not return fabricated data.

Do not return explanations outside the JSON.`

/* ═══════════════════════════════════════════════════════════════════════════
   REFERENCE DOCUMENTS — the brand, corpus and keyword maps Claude researches against
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ReferenceDoc {
  name: string
  text: string
}

/** Reads the configured reference documents now — an edit takes effect on the next run. */
export function loadReferences(files: readonly string[]): { docs: ReferenceDoc[]; missing: string[] } {
  const docs: ReferenceDoc[] = []
  const missing: string[] = []
  for (const f of files) {
    const path = isAbsolute(f) ? f : join(REPO_ROOT, f)
    if (!existsSync(path)) {
      missing.push(f)
      continue
    }
    docs.push({ name: f.split('/').pop() ?? f, text: readFileSync(path, 'utf8').trim() })
  }
  return { docs, missing }
}

/** The system prompt with the reference documents appended, each in its own tag. */
export function systemPromptWith(docs: readonly ReferenceDoc[], strategy?: { platform: string; text: string }): string {
  const withStrategy = strategy
    ? `${SYSTEM_PROMPT}\n\n### Platform research strategy: ${strategy.platform}\n\nThis session researches ${strategy.platform}. Follow this strategy. Where it asks for something more specific than the requirements above, it takes precedence. The evidence rules and the output schema still apply.\n\n${strategy.text}`
    : SYSTEM_PROMPT
  if (docs.length === 0) return withStrategy
  return [
    withStrategy,
    '',
    '### Reference documents',
    '',
    'The documents below are the reference point for this research. Use them to decide what is relevant and how to classify it:',
    '',
    '* **BRAND_VOICE_INSTRUCTION_MAP.md**: the brand, its six domains and audience. What to prefer, what to penalise (hype and pitch language), which hashtags are generic and never count, and which subjects are sensitive.',
    '* **CORPUS_SUMMARY.md**: the research papers Ethara writes from. A trend is relevant when it connects to one of these themes.',
    '* **KEYWORD_INSTRUCTION_MAP.md**: the keywords, synonyms, corpus phrasings and corpus themes A to E. Use the synonyms and corpus phrasings to expand your searches, and tag each trend with the theme it matches.',
    '',
    'Only search for and return trends related to this reference. A trend outside these domains is not relevant, however popular it is. These documents describe relevance and the brand; they do not change the output schema or the evidence rules above.',
    '',
    ...docs.map((d) => `<reference name="${d.name}">\n${d.text}\n</reference>\n`),
  ].join('\n')
}

export interface ResearchBrief {
  keywords: readonly string[]
  /** Hashtags to check, separately from the topics. */
  hashtags?: readonly string[]
  /** The month to name in searches ("September 2026"). */
  month?: string
  /** Platform-specific instructions (bridge config `research.platform_notes`). */
  platformNotes?: string
  platforms: string
  region: string
  timeWindow: string
  trendCount: number
  brandContext: string
  /** Stated as the session's search limit — the bridge uses no more than this many. */
  maxSearches: number
}

export function sessionPrompt(b: ResearchBrief): string {
  return `### Session Prompt

Research the following trend request using the WebSearch tool.

**Keywords/topics:**
${b.keywords.map((k) => `- ${k}`).join('\n')}
${b.hashtags && b.hashtags.length > 0 ? `\n**Hashtags to check:**\n${b.hashtags.join(', ')}\n` : ''}
**Platforms:**
${b.platforms}

**Region:**
${b.region}

**Time window:**
${b.timeWindow}

**Required number of trends:**
${b.trendCount}

**Brand/context:**
${b.brandContext}
The reference documents in the system prompt (brand voice, corpus summary, keyword map) are the reference point: search for what is trending in relation to them.

### Instructions

For every keyword/topic:

1. Search for recent activity related to the keyword.
2. Search for related emerging topics and terminology.
3. Search the requested platforms individually where possible.
4. Search for recent hashtags associated with the topic.
5. Search recent news and industry discussions that may be driving the trend.
6. Look for evidence of momentum rather than simply keyword presence.
7. Compare multiple sources before classifying something as a trend.
8. Remove duplicate or near-duplicate topics.
9. Return only trends supported by recent evidence.
10. Include the source URL and publication date whenever available.
11. Do not invent engagement metrics.
12. Do not claim that something is an official platform trend unless the source explicitly establishes that.
13. If platform-specific trend data cannot be verified through public search, report that limitation in \`platforms_with_insufficient_data\`.

### Important

The goal is **not to find articles that contain the keyword**.

The goal is to identify **topics that are currently gaining attention or receiving significant recent discussion** and provide evidence explaining why they qualify as trends.

### Current month
${b.month ? `Search for what is trending in **${b.month}**, the current month. Put the month in your searches (for example: "${b.keywords[0] ?? 'agentic AI'}" ${b.month}), and treat a post or article from before ${b.month} as background, not as a current trend, unless the platform research strategy asks for the latest available activity (then label it as such).` : 'Search for what is trending in the current time window only.'}
${b.platformNotes ? `\n### Platform research strategy\nFollow the platform research strategy in the system prompt for this platform. It sets which trends to return and how to label them.\n` : ''}
### Window status
Add a \`window_status\` field to every trend: "current_month" when its evidence is from the current month, "latest_available" when it is the newest activity found but older than the current month.

### Reference themes
Add a \`corpus_theme\` field to every trend: the letter of the corpus theme it matches, from KEYWORD_INSTRUCTION_MAP.md (A: rubrics as reward signals, B: SWE agents and benchmarks, C: agentic RL and post-training, D: evaluation and benchmarks, E: adjacent). Use "none" if it matches none of them; such a trend is out of scope and should normally not be returned.

Search budget: run at most ${b.maxSearches} searches in this session.

Return the final result using the JSON schema defined in the system prompt.`
}

/* ═══════════════════════════════════════════════════════════════════════════
   QUERIES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The query as sent to the search engine: the platform's site filters first.
 * Positive filters (`site:x.com`) are OR-ed when there are several; negative
 * ones (`-site:…`, the open web's exclusions) are all applied.
 */
export function scopedQuery(platform: PlatformModule, text: string): string {
  const include = platform.siteFilters.filter((f) => !f.startsWith('-'))
  const exclude = platform.siteFilters.filter((f) => f.startsWith('-'))
  const scope = include.length === 0 ? '' : include.length === 1 ? (include[0] as string) : `(${include.join(' OR ')})`
  return [scope, text, ...exclude].filter((p) => p !== '').join(' ')
}

/** Strips the scope back off, so `matched_queries` shows the discovery query, not the operator syntax. */
function unscoped(executed: string): string {
  return executed
    .replace(/-site:\S+/gi, ' ')
    .replace(/\(?\s*(?:site:\S+\s*(?:OR\s+)?)+\)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A planned topic without its month hint ("\"post-training\" September 2026" → "post-training"): the brief states the window itself. */
export function topicOf(queryText: string): string {
  return queryText
    .replace(/\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i, '')
    .replace(/^"(.*)"$/, '$1')
    .trim()
}

/** How two URLs are compared when verifying Claude's evidence: host without www, path without trailing slash. */
function urlKey(raw: string): string {
  try {
    const u = new URL(raw.trim())
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return raw.trim().toLowerCase()
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLAUDE'S ANALYSIS — parsed, then verified against the session's own results
   ═══════════════════════════════════════════════════════════════════════════ */

const str = z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string())
const strList = z.preprocess((v) => (Array.isArray(v) ? v.map(String) : []), z.array(z.string()))
const analysisSchema = z.object({
  trends: z
    .array(
      z.object({
        topic: str,
        trend_type: str,
        platform: str,
        related_keywords: strList,
        hashtags: strList,
        why_trending: str,
        evidence: z.array(z.object({ title: str, url: str, source: str, published_at: str })).catch([]),
        confidence: z.enum(['high', 'medium', 'low']).catch('low'),
        corpus_theme: str.optional(),
        window_status: str.optional(),
      }),
    )
    .catch([]),
  platforms_with_insufficient_data: z.array(z.unknown()).catch([]),
})

/** The JSON object in Claude's reply — fenced or bare — or null. */
function jsonOf(text: string | null): unknown {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

/** The module that can date a URL: the session's platform first, then any social platform whose host it is. */
function daterFor(url: string, platform: PlatformModule): PlatformModule | null {
  if (platform.isPlatformHost(url)) return platform
  for (const id of ['linkedin', 'x', 'instagram'] as const) {
    const m = platformModule(id)
    if (m?.isPlatformHost(url)) return m
  }
  return null
}

export function verifiedAnalysis(
  resultText: string | null,
  searches: readonly ExecutedSearch[],
  platform: PlatformModule,
  /** The window's start: a trend labelled current_month whose every date is decoded and older is relabelled. */
  windowFrom?: Date,
): { trends: ClaudeTrend[]; insufficient: string[]; parsed: boolean } {
  const parsed = analysisSchema.safeParse(jsonOf(resultText))
  if (!parsed.success) return { trends: [], insufficient: [], parsed: false }

  // Every URL any search in this session returned, with the title it showed.
  const returned = new Map<string, string>()
  for (const s of searches) for (const l of s.links) returned.set(urlKey(l.url), l.title)

  const trends: ClaudeTrend[] = []
  for (const t of parsed.data.trends) {
    let dropped = 0
    const evidence: ClaudeTrendEvidence[] = []
    for (const e of t.evidence) {
      if (e.url.trim() === '' || !returned.has(urlKey(e.url))) {
        dropped += 1
        continue
      }
      const dater = daterFor(e.url, platform)
      const classified = dater?.classifyUrl(e.url) ?? null
      const decoded = dater && classified?.itemId ? dater.dateFromItemId(classified.itemId) : null
      evidence.push({
        title: e.title.trim() || (returned.get(urlKey(e.url)) ?? ''),
        url: e.url.trim(),
        source: e.source.trim(),
        publishedAt: decoded ? decoded.toISOString() : e.published_at.trim() || null,
        dateSource: decoded ? 'platform_id' : e.published_at.trim() ? 'claude_stated' : 'none',
      })
    }
    // "Every returned trend must contain evidence": one with none left is not kept.
    if (evidence.length === 0 || t.topic.trim() === '') continue
    /*
     * THE LABEL IS CHECKED, NOT TRUSTED. "current_month" stands only if some
     * evidence is from the window or undated by id; when every date is decoded
     * from a post id and all are older, the trend is relabelled latest_available.
     */
    const claimed = (t.window_status ?? '').trim().toLowerCase()
    const allDecodedOlder =
      windowFrom !== undefined && evidence.every((e) => e.dateSource === 'platform_id' && e.publishedAt !== null && Date.parse(e.publishedAt) < windowFrom.getTime())
    const windowStatus: ClaudeTrend['windowStatus'] =
      claimed === 'current_month' ? (allDecodedOlder ? 'latest_available' : 'current_month') : claimed === 'latest_available' ? 'latest_available' : allDecodedOlder ? 'latest_available' : 'unstated'
    trends.push({
      windowStatus,
      windowStatusCorrected: claimed === 'current_month' && windowStatus === 'latest_available',
      topic: t.topic.trim(),
      trendType: t.trend_type.trim(),
      platform: t.platform.trim() || platform.label,
      relatedKeywords: t.related_keywords,
      hashtags: t.hashtags,
      whyTrending: t.why_trending.trim(),
      evidence,
      confidence: t.confidence,
      corpusTheme: (t.corpus_theme ?? '').trim() || null,
      unverifiedEvidenceDropped: dropped,
    })
  }
  const insufficient = parsed.data.platforms_with_insufficient_data.map((p) => (typeof p === 'string' ? p : JSON.stringify(p)))
  return { trends, insufficient, parsed: true }
}

/**
 * Parallel sessions can find the same evidence. A trend whose evidence URLs are
 * all already cited by an earlier trend is the same finding twice, so it is dropped.
 */
export function dedupeTrends(trends: readonly ClaudeTrend[]): ClaudeTrend[] {
  const seen = new Set<string>()
  const out: ClaudeTrend[] = []
  for (const t of trends) {
    const keys = t.evidence.map((e) => urlKey(e.url))
    if (keys.every((k) => seen.has(k))) continue
    for (const k of keys) seen.add(k)
    out.push(t)
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ADAPTER
   ═══════════════════════════════════════════════════════════════════════════ */

export function createClaudeCodeAdapter(platform: PlatformModule, cfg: BridgeConfig): TrendSourceAdapter {
  const limits = adapterLimits(cfg, ID)
  const cc = cfg.acquisition.claude_code
  const research = cc.research
  // The platform's domains for the brief: WebSearch's own domain filter where configured, else its `site:` filters.
  const domains = cc.allowed_domains_by_platform[platform.id] ?? null
  const platformLine = domains
    ? `${platform.label} (${domains.join(', ')} — use allowed_domains ${JSON.stringify(domains)} for platform-specific searches)`
    : `${platform.label} (${platform.siteFilters.filter((f) => !f.startsWith('-')).join(' OR ')})`
  const brandContext = `${BRAND.name}: ${BRAND.positioning}. Audience: ${BRAND.audience}`
  const platformNotes = research.platform_notes[platform.id]

  function availability(): AdapterAvailability {
    const bin = resolveClaudeBinary()
    if (bin.path === null) {
      return {
        available: false,
        reason:
          `The Claude Code CLI was not found (looked in ${bin.tried}). Install Claude Code, or set ` +
          'CLAUDE_CODE_BIN in server/.env to the `claude` executable.',
      }
    }
    return { available: true, reason: '' }
  }

  /** Raw results of the searches USED — only this platform's hosts. Page type is judged by the normaliser. */
  function toCandidates(used: readonly ExecutedSearch[], requested: SearchRequest[]): SourceCandidate[] {
    const byText = new Map(requested.map((r) => [r.query.text.toLowerCase(), r]))
    const out: SourceCandidate[] = []
    for (const search of used) {
      const discovery = unscoped(search.query)
      const req = byText.get(discovery.toLowerCase())
      const perQuery = req?.maxResults ?? limits.max_results_per_query
      let taken = 0
      for (const link of search.links) {
        if (!platform.isPlatformHost(link.url)) continue
        if (taken >= perQuery) break
        taken += 1
        out.push({
          adapter: ID,
          query: discovery,
          keyword: req?.query.keyword ?? null,
          url: link.url,
          published_at: null,
          title: link.title.trim() === '' ? null : link.title.trim(),
          text: null,
          hashtags: [],
          author: null,
          engagement: null,
        })
      }
    }
    return out
  }

  async function searchBatch(reqs: SearchRequest[]): Promise<BatchOutcome> {
    const binPath = resolveClaudeBinary().path
    if (binPath === null) throw new SourceError(ID, availability().reason, true)

    const candidates: SourceCandidate[] = []
    const executed: string[] = []
    const errors: string[] = []
    const notes: string[] = []
    const claudeTrends: ClaudeTrend[] = []
    const insufficientData: string[] = []
    // Read now, so an edited reference document is used on the next run without a restart.
    const refs = loadReferences(research.reference_files)
    if (refs.missing.length > 0) notes.push(`${platform.label}: reference document(s) not found and not given to Claude: ${refs.missing.join(', ')}.`)
    const systemPrompt = systemPromptWith(refs.docs, platformNotes ? { platform: platform.label, text: platformNotes } : undefined)

    // Sessions of `queries_per_session` topics, `concurrency` of them at a time.
    const chunks: SearchRequest[][] = []
    for (let i = 0; i < reqs.length; i += cc.queries_per_session) chunks.push(reqs.slice(i, i + cc.queries_per_session))
    let fatal: SourceError | null = null
    const runChunk = async (chunk: SearchRequest[]): Promise<void> => {
      if (fatal) return
      const first = chunk[0]
      const window = first?.window
      const brief: ResearchBrief = {
        keywords: [...new Set(chunk.filter((r) => r.query.kind !== 'hashtag').map((r) => topicOf(r.query.text)))],
        hashtags: [...new Set(chunk.filter((r) => r.query.kind === 'hashtag').flatMap((r) => r.query.text.match(/#[\p{L}\p{N}_]+/gu) ?? []))],
        ...(first?.month ? { month: first.month } : {}),
        ...(platformNotes ? { platformNotes } : {}),
        platforms: platformLine,
        region: research.region,
        timeWindow: first?.windowText
          ? `${first.windowText} (only activity inside this window counts as current)`
          : window
            ? `${window.from.toISOString().slice(0, 10)} to ${window.to.toISOString().slice(0, 10)} (only activity inside this window counts as current)`
            : 'the current month',
        trendCount: research.trend_count,
        brandContext,
        maxSearches: research.max_searches_per_session,
      }
      const session: ClaudeSessionResult = await runClaudeSession({
        bin: binPath,
        prompt: sessionPrompt(brief),
        systemPrompt,
        model: cc.model,
        allowedTools: cc.allowed_tools,
        maxBudgetUsd: cc.max_budget_usd_per_session,
        timeoutMs: limits.timeout_ms ?? 480_000,
      })

      // The budget is enforced on what is USED: the first N searches the session ran.
      const used = session.searches.slice(0, research.max_searches_per_session)
      if (session.searches.length > used.length) {
        notes.push(`${platform.label}: the session ran ${session.searches.length} searches; only the first ${used.length} were used (the per-session limit).`)
      }
      executed.push(...used.map((s) => unscoped(s.query)))
      candidates.push(...toCandidates(used, chunk))

      const analysis = verifiedAnalysis(session.resultText, used, platform, window?.from)
      claudeTrends.push(...analysis.trends)
      insufficientData.push(...analysis.insufficient)
      const droppedTotal = analysis.trends.reduce((n, t) => n + t.unverifiedEvidenceDropped, 0)
      if (!analysis.parsed && !session.isError) notes.push(`${platform.label}: Claude's reply was not valid JSON, so no analysis was kept; its search results were still used.`)
      if (droppedTotal > 0) notes.push(`${platform.label}: ${droppedTotal} evidence URL(s) Claude cited were not returned by any search in the session and were dropped.`)

      if (session.isError) {
        const message = session.errorMessage ?? 'Claude Code reported an error'
        // Searches that completed before the failure are kept — they are real results.
        if (FATAL_PATTERNS.some((p) => p.test(message))) {
          fatal = new SourceError(ID, message, true)
          return
        }
        errors.push(message)
      }
    }
    const queue = [...chunks]
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(limits.concurrency, chunks.length)) }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) await runChunk(c)
      }),
    )
    if (fatal) throw fatal

    return { candidates, executed, errors, notes, claudeTrends: dedupeTrends(claudeTrends), insufficientData }
  }

  async function searchOne(req: SearchRequest): Promise<SourceCandidate[]> {
    const outcome = await searchBatch([req])
    if (outcome.errors.length > 0 && outcome.candidates.length === 0) {
      throw new SourceError(ID, outcome.errors[0] ?? 'search failed')
    }
    return outcome.candidates
  }

  return {
    id: ID,
    label: `Claude Code · trend research (${platform.label})`,
    kind: 'live',
    platform,
    availability,
    search_topics: searchOne,
    search_posts: searchOne,
    search_hashtags: searchOne,
    // A single post is not searched for by URL — that would be a page fetch in disguise.
    async get_post(): Promise<SourceCandidate | null> {
      return null
    },
    searchBatch,
  }
}

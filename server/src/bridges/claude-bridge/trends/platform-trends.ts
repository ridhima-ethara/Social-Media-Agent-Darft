/**
 * PLATFORM-LEVEL TREND DISCOVERY — the Scraping Agent's capture.
 *
 *   Knowledge Base + Ethara brand context + every keyword + the research corpus
 *     → Claude Bridge: focused searches per platform, ONE TOPIC EACH, naming the month
 *     → LinkedIn · Instagram · Facebook · X, each separately
 *     → keep only posts verifiably published inside the window (default: the current month)
 *     → Ethara relevance filter (a configured keyword must appear in the post)
 *     → group into trends; extract posts, hashtags, URLs, authors
 *     → newest first
 *     → handed to the Validation Agent (this module writes no content, no calendar)
 *
 * WHAT A "TREND" IS HERE, AND WHY. A trend is a cluster of recent posts on one
 * platform that mention the same Ethara keyword. Its name is that keyword, its
 * hashtags are the ones those posts actually wrote, and its reason is computed
 * from the evidence (how many posts, how recent, which searches surfaced them).
 * Nothing about it is written by a model: Claude Code runs the searches and the
 * bridge reads only the raw search results.
 *
 * WHAT IS NEVER INVENTED. A post without a verifiable date is left out — it
 * cannot be shown to be inside the window. There is no engagement in a search
 * result, so none is reported. An author is the handle the post URL itself
 * carries, or null.
 *
 * TOKENS. One Claude Code session per platform, running only that platform's
 * searches (never more than the cap). Relevance and grouping are local and
 * deterministic — they cost no tokens — and are done over the de-duplicated
 * results in fixed-size batches.
 */

import { loadBridgeConfig, type AdapterId, type BridgeConfig, type RelevanceLevel } from '../config'
import { loadProjectContext, prioritiseKeywords, type BridgeContext, type KeywordEntry } from '../context'
import { createAdapter } from '../adapters/linkedin-source-adapter'
import { withFallback } from '../adapters/fallback'
import type { ClaudeTrend, DiscoveryQuery, SearchRequest, SourceCandidate, TrendSourceAdapter } from '../adapters/source-types'
import { toHashtagBody } from '../discovery/query-builder'
import { platformModule, type PlatformId, type PlatformModule } from '../platforms'
import { deduplicate } from '../processing/deduplicator'
import { normalizeCandidates, type NormalizedCandidate } from '../processing/normalizer'
import { enrichFromPageMetadata } from '../processing/page-metadata'
import { analyzeRelevance, buildRelevanceModel, compact, meetsMinimum, type RelevanceResult } from '../processing/relevance'
import { DISCOVERED_HASHTAG_CATEGORY } from '../../../../../shared/agent-contract'
import { writeExecutionLog, type LogSink } from '../logging'
import { randomUUID } from 'node:crypto'
import { localIsoDate } from '../../../../../shared/calendar-horizon'
import { BRAND } from '../../../../../shared/brand-voice'
import { loadCorpusTopics, type CorpusTopics } from '../context/corpus-topics'

/* ═══════════════════════════════════════════════════════════════════════════
   SHAPES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * When a post or trend is from: the current date (in the workspace's time
 * zone), earlier in the window, or — only when a platform had nothing verified
 * inside the window — `older`: its newest relevant posts from before the
 * window, labelled as such and never presented as current.
 */
export type TrendPeriod = 'today' | 'earlier' | 'older'

/** Engagement the source stated — `null` when it stated none (a web search result). */
export interface TrendEngagement {
  reactions: number | null
  comments: number | null
  reposts: number | null
  views: number | null
}

export interface TrendPost {
  platform: string
  platformId: PlatformId
  url: string
  publishedAt: string
  period: TrendPeriod
  engagement: TrendEngagement | null
  /** Which source adapter returned it (`claude_code`, `socialfetch`…). */
  source: string
  /** True when kept as RELATED to Ethara's field (brand topics / Knowledge Base) without naming a keyword. */
  related: boolean
  /** Its hashtags that are neither a configured keyword nor already learned — candidates for the Knowledge Base. */
  newHashtags: string[]
  author: string | null
  /** What the search result showed — its title, usually the post's opening line. */
  text: string
  hashtags: string[]
  matchedEtharaKeywords: string[]
  trend: string
}

/**
 * How strong a group's evidence is (system prompt §5, §8):
 *   platform_trend      — current-month posts from at least `platform_trend_min_authors` independent authors
 *   platform_activity   — current-month posts, but too few independent authors to call it a platform trend
 *   supporting_context  — posts from before the window: historical context only, never a current trend
 */
export type EvidenceLevel = 'platform_trend' | 'platform_activity' | 'supporting_context'

export interface PlatformTrend {
  platform: string
  trend: string
  evidenceLevel: EvidenceLevel
  /** Distinct authors among its posts — several URLs from one author are one source. */
  independentAuthors: number
  /** `today` when at least one of its posts was published on the current date. */
  period: TrendPeriod
  /** How many of its posts are from the current date. */
  postsToday: number
  hashtags: string[]
  /** Hashtags on its posts that Ethara does not track yet. */
  newHashtags: string[]
  /** True when every post in it was kept as related rather than for a keyword. */
  related: boolean
  posts: Array<{ url: string; publishedAt: string; author: string | null; period: TrendPeriod; engagement: TrendEngagement | null }>
  /** Summed reactions + comments + reposts of its posts, when stated; null when none stated any. */
  engagement: number | null
  matchedEtharaKeywords: string[]
  reason: string
}

/** A relevant post from a platform whose posts cannot be dated (Facebook). Listed, never passed on as dated evidence. */
export interface UndatedPost {
  platform: string
  platformId: PlatformId
  url: string
  title: string
  hashtags: string[]
  matchedEtharaKeywords: string[]
  trend: string
}

export interface PlatformReport {
  platform: string
  platformId: PlatformId
  /** Which source adapter this platform ran on (`platform_trends.source_adapters`). */
  adapter: AdapterId
  /**
   * `older` — nothing relevant inside the window, so the newest relevant posts
   * from before it are listed; `undated` — the platform's posts cannot be
   * dated, so relevant posts are listed with no date.
   */
  status: 'ok' | 'older' | 'undated' | 'empty' | 'skipped' | 'error'
  reason: string | null
  searches: string[]
  found: number
  notPosts: number
  duplicates: number
  undated: number
  outsideWindow: number
  notRelevant: number
  kept: number
  /** The newest verified date seen on this platform, in or out of the window. */
  freshestSeen: string | null
  /** Per-source notes from the adapter (the news lane: which sources were read, skipped by robots.txt, verified). */
  notes?: string[]
  /** Claude's own trend analysis for this platform — verified evidence URLs only. A separate layer from `trends`. */
  claudeTrends?: ClaudeTrend[]
  /** What Claude said it could not verify on this platform. */
  insufficientData?: string[]
  /** Claude's search_limitations for this platform. */
  searchLimitations?: string[]
}

/** The three sections the bridge took its context from, as it read them. */
export interface DiscoveryContext {
  knowledgeBase: { source: string; entries: number; vocabularyTerms: number }
  brand: { sources: string[]; positioning: string | null; audience: string | null; topics: number }
  keywords: { source: string; count: number }
}

export interface PlatformTrendReport {
  executionId: string
  context: DiscoveryContext
  generatedAt: string
  /** The current date the periods were judged against, and its time zone. */
  today: string
  timeZone: string | null
  windowHours: number
  window: { from: string; to: string }
  /** The window in words: "this month (since 1 September 2026)" or "the last 7 days". */
  windowName: string
  keywordsUsed: string[]
  /** The research corpus as reference: its topics and hashtags, and how many papers they came from. */
  corpus: { papers: number; terms: string[]; hashtags: string[]; searched: string[]; source: CorpusTopics['source']; reason: string | null }
  platforms: PlatformReport[]
  /** Newest first by their newest post. */
  trends: PlatformTrend[]
  /** Every kept post, newest first. */
  posts: TrendPost[]
  /** Relevant posts that could not be dated (Facebook) — shown, never used as dated evidence. */
  undated: UndatedPost[]
  searchesRun: number
}

export interface DiscoverOptions {
  platforms?: PlatformId[]
  /** A rolling window of this many hours. Wins over `currentMonth`. */
  windowHours?: number
  /** The current calendar month so far, in `timeZone`. Default: the bridge config's `window`. */
  currentMonth?: boolean
  maxSearchesPerPlatform?: number
  maxPostsPerTrend?: number
  /** Keywords to search for, in priority order. Default: the SMA's keywords, rota first. */
  keywords?: KeywordEntry[]
  now?: Date
  /** The workspace's time zone, for "today". Default: the process's local zone. */
  timeZone?: string
  config?: BridgeConfig
  context?: BridgeContext
  /** List older relevant posts when a platform has none inside the window. Default: bridge config. */
  fallbackToLatest?: boolean
  /** Search platforms that cannot be dated and list their relevant posts undated. Default: bridge config. */
  includeUndated?: boolean
  /** The corpus topics to use (tests). Default: derived from the Knowledge Base's research corpus. */
  corpusTopics?: CorpusTopics
  /** Injected acquisition (tests). Default: each platform's configured source adapter. */
  adapterFor?: (platform: PlatformModule, cfg: BridgeConfig) => TrendSourceAdapter
  logSink?: LogSink | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   QUERY PLAN — at most N focused searches per platform
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The focused searches for one platform, from the keywords in priority order.
 *
 * Broad terms first: an OR of four long exact phrases ("long-horizon AI
 * agents") matches almost nothing a search engine has indexed, while the
 * short Ethara keywords ("AI agents", "RLVR", "post-training") find real
 * posts. So keywords of at most `maxWords` words lead, in their priority
 * order, and longer ones follow. The phrase searches OR groups of them; the
 * last search asks for the leading short keywords as hashtags. Never more
 * than `max` searches.
 */
/**
 * EVERY KEYWORD, NOTHING REDUNDANT.
 *
 * The search reference is every keyword the SMA holds — the run's priority
 * order first (this week's rota), then the rest by weight — not only the
 * rota's subset. A keyword whose text contains a shorter keyword as a phrase
 * ("reinforcement learning environments for LLMs" ⊃ "reinforcement learning
 * environments") is dropped from the SEARCHES: a post matching the longer one
 * also matches the shorter, so searching both spends a search for nothing.
 * Relevance still reads every keyword.
 */
export function searchKeywordsOf(priority: readonly KeywordEntry[], all: readonly KeywordEntry[]): KeywordEntry[] {
  const norm = (t: string): string => ` ${t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim()} `
  const seen = new Set<string>()
  const ordered: KeywordEntry[] = []
  for (const k of [...priority, ...[...all].sort((a, b) => b.weight - a.weight || a.term.localeCompare(b.term))]) {
    const key = norm(k.term)
    if (key.trim() === '' || seen.has(key)) continue
    seen.add(key)
    ordered.push(k)
  }
  return ordered.filter((k) => {
    const mine = norm(k.term)
    return !ordered.some((o) => o !== k && norm(o.term) !== mine && mine.includes(norm(o.term)))
  })
}

export interface SearchPlanOptions {
  /** Keywords of more than this many words come after the shorter ones. */
  maxWords: number
  /** e.g. "September 2026" — appended to every topic search, not the hashtag one. */
  recencyHint?: string
  /** Today's research-corpus topics, one search each. */
  corpusTerms?: readonly string[]
  /** Broad field terms ("agentic AI"); `broadSearches` of them, one search each. */
  broadTerms?: readonly string[]
  broadSearches?: number
  /** Hashtags for the tail of the hashtag search (learned, corpus, broad), after the leading keywords' own. */
  hashtags?: readonly string[]
  /** How many tags the hashtag search ORs. */
  hashtagTerms: number
  /** Share of the keyword searches that always go to the highest-priority keywords. */
  fixedShare: number
  /** A day number: the remaining keyword searches rotate through the rest of the list by it. */
  rotation: number
}

/**
 * The focused searches for one platform — ONE TOPIC PER SEARCH, never more than `max`.
 *
 * An OR of quoted phrases scoped to a platform ("site:linkedin.com/posts
 * ("A" OR "B" OR "C") September 2026") returns almost nothing recent: tested
 * 2026-09-24, nothing newer than 2025 on LinkedIn. A single topic with the
 * month named returned this month's posts on X and Instagram, and quoting it
 * ("\"AI agents\" September 2026") kept them on topic — unquoted, the month
 * alone matched cricket squads and game codes dated September. So each
 * keyword, corpus topic and broad field term gets its own quoted search with
 * the month appended, and one last search ORs the leading hashtags (unhinted,
 * so recall does not suffer).
 *
 * WHICH KEYWORDS. `fixedShare` of the keyword searches go to the first
 * keywords in priority order (this week's rota, then weight) on every run; the
 * rest rotate through the remaining keywords by `rotation` (the day), so every
 * keyword is searched over successive runs. Relevance always reads all of them.
 */
export function platformSearches(keywords: readonly KeywordEntry[], max: number, o: SearchPlanOptions): DiscoveryQuery[] {
  const words = (t: string): number => t.trim().split(/\s+/).length
  const seen = new Set<string>()
  const ordered = [...keywords.filter((k) => words(k.term) <= o.maxWords), ...keywords.filter((k) => words(k.term) > o.maxWords)]
    .map((k) => k.term.trim())
    .filter((t) => (seen.has(t.toLowerCase()) ? false : (seen.add(t.toLowerCase()), true)))
  const corpusTerms = (o.corpusTerms ?? []).filter((t) => !seen.has(t.toLowerCase()))
  const broadTerms = (o.broadTerms ?? []).filter((t) => !seen.has(t.toLowerCase()))
  if (max <= 0 || ordered.length + corpusTerms.length + broadTerms.length === 0) return []

  const hashtagSlot = max >= 2 ? 1 : 0
  const slots = max - hashtagSlot
  // At least one keyword search whenever there is a keyword.
  const keep = ordered.length > 0 ? 1 : 0
  const corpusN = Math.min(corpusTerms.length, Math.max(0, slots - keep))
  const broadN = Math.min(o.broadSearches ?? 0, broadTerms.length, Math.max(0, slots - keep - corpusN))
  const kwSlots = Math.min(ordered.length, slots - corpusN - broadN)
  const fixedN = Math.min(kwSlots, Math.max(keep, Math.ceil(kwSlots * o.fixedShare)))
  const rest = ordered.slice(fixedN)
  const rotN = kwSlots - fixedN
  const offset = rest.length > 0 ? (Math.max(0, o.rotation) * Math.max(1, rotN)) % rest.length : 0
  const rotated = [...rest.slice(offset), ...rest.slice(0, offset)].slice(0, rotN)
  const kwPicks = [...ordered.slice(0, fixedN), ...rotated]

  const hint = o.recencyHint ? ` ${o.recencyHint}` : ''
  // A multi-word or hyphenated topic is quoted so the post must name it; the month alone otherwise drags in any post dated this month.
  const quote = (t: string): string => (/\s|-/.test(t) ? `"${t}"` : t)
  const topic = (t: string): DiscoveryQuery => ({ text: `${quote(t)}${hint}`, kind: 'post', keyword: null, origin: 'phrase' })
  const out: DiscoveryQuery[] = [...kwPicks.map(topic), ...corpusTerms.slice(0, corpusN).map(topic), ...broadTerms.slice(0, broadN).map(topic)]

  if (hashtagSlot > 0) {
    const leading = kwPicks.filter((t) => words(t) <= o.maxWords)
    const own = (leading.length > 0 ? leading : kwPicks).map((t) => `#${toHashtagBody(t)}`)
    const extra = o.hashtags ?? []
    // The leading keywords' own tags first (two when extra tags exist), then the extra ones.
    const ownCount = extra.length === 0 ? o.hashtagTerms : Math.max(1, o.hashtagTerms - Math.min(o.hashtagTerms - 1, extra.length))
    const tags = [...new Set([...own.slice(0, ownCount), ...extra])].filter((t) => t.length > 1).slice(0, o.hashtagTerms)
    if (tags.length > 0) out.push({ text: tags.length === 1 ? (tags[0] as string) : `(${tags.join(' OR ')})`, kind: 'hashtag', keyword: null, origin: 'hashtag' })
  }
  const unique = new Set<string>()
  return out.filter((q) => (unique.has(q.text.toLowerCase()) ? false : (unique.add(q.text.toLowerCase()), true))).slice(0, max)
}

/**
 * Midnight at the start of `isoDate` in `timeZone` (or the process's zone), as an instant.
 * Unit conversion only: the offset is read back from Intl for that date.
 */
export function zonedMidnight(isoDate: string, timeZone?: string): Date {
  if (!timeZone) return new Date(`${isoDate}T00:00:00`)
  const guess = Date.parse(`${isoDate}T00:00:00Z`)
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
      .formatToParts(new Date(guess))
      .map((p) => [p.type, p.value]),
  )
  const seenAsUtc = Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day), Number(parts.hour), Number(parts.minute), Number(parts.second))
  return new Date(guess - (seenAsUtc - guess))
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRENDS
   ═══════════════════════════════════════════════════════════════════════════ */

function titleCase(phrase: string): string {
  return phrase
    .split(' ')
    .map((w) => (w.length > 0 && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

/** "48 hours" / "90 days" — hours below three days, days above. */
export function windowLabel(hours: number): string {
  return hours < 72 ? `${hours} hours` : `${Math.round(hours / 24)} days`
}

function hoursAgo(iso: string, now: Date): string {
  const h = Math.max(0, Math.round((now.getTime() - Date.parse(iso)) / 3_600_000))
  if (h < 1) return 'under an hour ago'
  if (h < 72) return h === 1 ? '1 hour ago' : `${h} hours ago`
  return `${Math.round(h / 24)} days ago`
}

interface Kept {
  item: NormalizedCandidate
  relevance: RelevanceResult
  author: string | null
}

/** The engagement a kept item's source stated, or null. */
function engagementOf(k: { item: { engagement: { reactions: number | null; comments: number | null; reposts: number | null; views?: number | null } | null } }): TrendEngagement | null {
  const e = k.item.engagement
  if (!e) return null
  return { reactions: e.reactions, comments: e.comments, reposts: e.reposts, views: e.views ?? null }
}

/** today → earlier in the window → older than the window. */
export function periodRank(p: TrendPeriod): number {
  return p === 'today' ? 0 : p === 'earlier' ? 1 : 2
}

function buildTrends(
  kept: readonly Kept[],
  platform: PlatformModule,
  searches: readonly string[],
  /** The window in words, e.g. "this month (since 1 September 2026)". */
  span: string,
  maxPostsPerTrend: number,
  now: Date,
  day: { today: string; timeZone: string | undefined },
  /** `older` for the fallback set: everything in it predates the window. */
  forcePeriod?: TrendPeriod,
  /** Compact forms of every keyword and learned hashtag — a tag outside it is new. */
  knownTags: ReadonlySet<string> = new Set(),
  /** Independent authors needed to call a group a platform trend. */
  minAuthors = 2,
): { trends: PlatformTrend[]; posts: TrendPost[] } {
  const isNew = (display: string): boolean => {
    const key = compact(display.replace(/^#/, ''))
    return key.length >= 3 && !/^\d+$/.test(key) && !knownTags.has(key)
  }
  // A related post names no keyword: it is grouped under the brand topic it matched.
  const leadOf = (k: Kept): string | undefined =>
    k.relevance.topic_keywords[0] ?? k.relevance.matched_keywords[0] ?? k.relevance.matched_topics[0]

  const periodOf = (iso: string): TrendPeriod =>
    forcePeriod ?? (localIsoDate(new Date(iso), day.timeZone) === day.today ? 'today' : 'earlier')

  /*
   * ONE TREND PER TOPIC. Posts are grouped by their lead term, and a lead that
   * is a longer form of another ("agentic reinforcement learning" ⊃
   * "reinforcement learning", "AI agents" vs "AI agent") joins the shorter
   * one's trend, so the same topic is never listed twice under two names.
   */
  const topicKey = (t: string): string => compact(t).replace(/s$/, '')
  const byLead = new Map<string, { name: string; list: Kept[] }>()
  for (const k of kept) {
    const lead = leadOf(k)
    if (!lead) continue
    const key = topicKey(lead)
    const entry = byLead.get(key) ?? { name: lead, list: [] }
    entry.list.push(k)
    byLead.set(key, entry)
  }
  const keys = [...byLead.keys()].sort((a, b) => a.length - b.length)
  const groups = new Map<string, Kept[]>()
  const nameOf = new Map<string, string>()
  for (const key of keys) {
    const entry = byLead.get(key) as { name: string; list: Kept[] }
    const home = [...groups.keys()].find((g) => key.includes(g))
    if (home) (groups.get(home) as Kept[]).push(...entry.list)
    else {
      groups.set(key, [...entry.list])
      nameOf.set(key, entry.name)
    }
  }

  const trends: Array<PlatformTrend & { newest: string }> = []
  const posts: TrendPost[] = []
  for (const [groupKey, list] of groups) {
    list.sort((a, b) => (b.item.published_at as string).localeCompare(a.item.published_at as string))
    const lead = nameOf.get(groupKey) ?? leadOf(list[0] as Kept) ?? ''
    const name = titleCase(lead)
    const top = list.slice(0, maxPostsPerTrend)

    const tagCounts = new Map<string, { display: string; n: number }>()
    for (const k of list) {
      for (const h of k.item.hashtags) {
        const e = tagCounts.get(h.key) ?? { display: h.display, n: 0 }
        e.n += 1
        tagCounts.set(h.key, e)
      }
    }
    const hashtags = [...tagCounts.values()].sort((a, b) => b.n - a.n).map((t) => t.display)
    const matched = [...new Set(list.flatMap((k) => k.relevance.matched_keywords))]
    const queriesHit = new Set(list.flatMap((k) => [...k.item.queries]))
    const shared = [...tagCounts.values()].filter((t) => t.n > 1).sort((a, b) => b.n - a.n)[0]
    const newest = list[0]?.item.published_at as string
    const postsToday = list.filter((k) => periodOf(k.item.published_at as string) === 'today').length

    // Independent sources: one author is one source however many URLs; an unattributed post counts on its own.
    const independentAuthors = new Set(list.map((k) => k.author ?? `url:${k.item.url}`)).size
    const evidenceLevel: EvidenceLevel =
      forcePeriod === 'older' ? 'supporting_context' : independentAuthors >= minAuthors ? 'platform_trend' : 'platform_activity'
    const levelNote =
      evidenceLevel === 'supporting_context'
        ? ' Supporting historical context only: evidence from before the current month cannot establish a current trend.'
        : evidenceLevel === 'platform_trend'
          ? ` Platform trend: ${independentAuthors} independent authors this month.`
          : ` Platform activity, not a platform trend: ${independentAuthors} independent author${independentAuthors === 1 ? '' : 's'}, fewer than the ${minAuthors} needed. Current activity is observable, but increasing momentum could not be independently verified.`
    const reason =
      (forcePeriod === 'older'
        ? `From before ${span} — no relevant ${platform.label} post from inside the window was indexed, so these are the newest relevant ones found. `
        : '') +
      (postsToday > 0 ? `Trending today: ${postsToday} published on ${day.today}. ` : '') +
      `${list.length} ${platform.label} post${list.length === 1 ? '' : 's'} ${forcePeriod === 'older' ? 'from before' : 'in'} ${span} ` +
      `mention${list.length === 1 ? 's' : ''} “${lead}”` +
      ` (newest ${hoursAgo(newest, now)})` +
      (shared ? `; ${shared.display} appears on ${shared.n} of them` : '') +
      `; surfaced by ${queriesHit.size} of ${searches.length} search${searches.length === 1 ? '' : 'es'}.` +
      (platform.id === 'web'
        ? ' News stories state no engagement, so this is ranked by recency and volume only.'
        : ' Search results state no engagement, so this is ranked by recency and volume only.') +
      levelNote

    const newHashtags = hashtags.filter(isNew)
    const allRelated = list.every((k) => k.relevance.matched_keywords.length === 0)
    trends.push({
      platform: platform.label,
      trend: name,
      evidenceLevel,
      independentAuthors,
      newHashtags,
      related: allRelated,
      period: forcePeriod ?? (postsToday > 0 ? 'today' : 'earlier'),
      postsToday,
      hashtags,
      posts: top.map((k) => ({
        url: k.item.url as string,
        publishedAt: k.item.published_at as string,
        author: k.author,
        period: periodOf(k.item.published_at as string),
        engagement: engagementOf(k),
      })),
      engagement: (() => {
        const stated = list.map((k) => engagementOf(k)).filter((e): e is TrendEngagement => e !== null)
        return stated.length === 0 ? null : stated.reduce((n, e) => n + (e.reactions ?? 0) + (e.comments ?? 0) + (e.reposts ?? 0), 0)
      })(),
      matchedEtharaKeywords: matched,
      reason,
      newest,
    })
    for (const k of top) {
      posts.push({
        platform: platform.label,
        platformId: platform.id,
        url: k.item.url as string,
        publishedAt: k.item.published_at as string,
        period: periodOf(k.item.published_at as string),
        engagement: engagementOf(k),
        source: [...k.item.adapters][0] ?? 'claude_code',
        related: k.relevance.matched_keywords.length === 0,
        newHashtags: k.item.hashtags.map((h) => h.display).filter(isNew),
        author: k.author,
        text: k.item.title ?? k.item.snippet ?? '',
        hashtags: k.item.hashtags.map((h) => h.display),
        matchedEtharaKeywords: k.relevance.matched_keywords,
        trend: name,
      })
    }
  }

  // Trending today first, then newest first.
  // Today first, then the rest of the window, then older; within each, the most engaged (when stated), then newest.
  trends.sort(
    (a, b) =>
      periodRank(a.period) - periodRank(b.period) ||
      (b.engagement ?? -1) - (a.engagement ?? -1) ||
      b.newest.localeCompare(a.newest) ||
      b.posts.length - a.posts.length,
  )
  return { trends: trends.map(({ newest: _newest, ...t }) => t), posts }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ONE PLATFORM
   ═══════════════════════════════════════════════════════════════════════════ */

async function discoverOnPlatform(
  platform: PlatformModule,
  searches: DiscoveryQuery[],
  adapter: TrendSourceAdapter,
  cfg: BridgeConfig,
  window: { from: Date; to: Date },
  span: string,
  /** The window as the research brief states it, and the month to name in searches. */
  brief: { windowText: string; month: string },
  minimum: RelevanceLevel,
  maxPostsPerTrend: number,
  model: ReturnType<typeof buildRelevanceModel>,
  now: Date,
  day: { today: string; timeZone: string | undefined },
  opts: { fallbackToLatest: boolean; includeUndated: boolean },
  knownTags: ReadonlySet<string>,
): Promise<{ report: PlatformReport; trends: PlatformTrend[]; posts: TrendPost[]; undated: UndatedPost[]; searchesRun: number }> {
  const report: PlatformReport = {
    platform: platform.label,
    platformId: platform.id,
    adapter: adapter.id,
    status: 'ok',
    reason: null,
    searches: searches.map((s) => s.text),
    found: 0,
    notPosts: 0,
    duplicates: 0,
    undated: 0,
    outsideWindow: 0,
    notRelevant: 0,
    kept: 0,
    freshestSeen: null,
  }

  const availability = adapter.availability()
  if (!availability.available) {
    return { report: { ...report, status: 'skipped', reason: availability.reason, searches: [] }, trends: [], posts: [], undated: [], searchesRun: 0 }
  }
  if (!platform.canDateItems && !opts.includeUndated) {
    return {
      report: {
        ...report,
        status: 'skipped',
        searches: [],
        reason:
          `${platform.label} post ids carry no date and a search result states none, so no post can be shown to be ` +
          `inside ${span}. The platform is skipped rather than spending searches it cannot use.`,
      },
      trends: [],
      posts: [],
      undated: [],
      searchesRun: 0,
    }
  }

  const pt = cfg.platform_trends
  const requests: SearchRequest[] = searches.map((query) => ({ query, maxResults: pt.max_results_per_search, window, ...brief }))
  let candidates: SourceCandidate[] = []
  /** Searches the adapter reports it ran and used — a research session's own, beyond the plan. */
  const executedByAdapter: string[] = []
  let searchesRun = 0
  try {
    if (adapter.searchBatch) {
      const outcome = await adapter.searchBatch(requests)
      candidates = outcome.candidates
      searchesRun = outcome.executed.length
      if (outcome.errors.length > 0) report.reason = outcome.errors.join(' · ')
      if (outcome.notes && outcome.notes.length > 0) report.notes = outcome.notes
      if (outcome.claudeTrends) report.claudeTrends = outcome.claudeTrends
      if (outcome.insufficientData && outcome.insufficientData.length > 0) report.insufficientData = outcome.insufficientData
      if (outcome.searchLimitations && outcome.searchLimitations.length > 0) report.searchLimitations = outcome.searchLimitations
      executedByAdapter.push(...outcome.executed)
    } else {
      for (const req of requests) {
        candidates.push(...(await adapter.search_posts(req)))
        searchesRun += 1
      }
    }
  } catch (error) {
    return {
      report: { ...report, status: 'error', reason: error instanceof Error ? error.message : String(error) },
      trends: [],
      posts: [],
      undated: [],
      searchesRun,
    }
  }

  // The budget is enforced on what is USED: a result from a search that was
  // not in the plan is discarded, whatever the session did.
  // A research session may run its own related searches; the adapter reports
  // which it ran and USED (bounded by its per-session limit), and those count too.
  const planned = new Set([...searches.map((s) => s.text), ...executedByAdapter].map((t) => t.toLowerCase()))
  candidates = candidates.filter((c) => c.query !== null && planned.has(c.query.toLowerCase()))
  report.found = candidates.length

  const normalized = normalizeCandidates(candidates, platform, cfg, now)
  report.notPosts = normalized.rejected.not_a_post + normalized.rejected.off_platform + normalized.rejected.empty
  const deduped = deduplicate(normalized.items, cfg.deduplication.similarity_threshold)
  report.duplicates = deduped.duplicates_removed
  if (platform.readsPageDates) await enrichFromPageMetadata(deduped.items, cfg, now)

  const inWindow: NormalizedCandidate[] = []
  const beforeWindow: NormalizedCandidate[] = []
  const dateless: NormalizedCandidate[] = []
  const oldestFallback = now.getTime() - pt.fallback_max_age_days * 86_400_000
  for (const item of deduped.items) {
    if (item.published_at === null) {
      report.undated += 1
      dateless.push(item)
      continue
    }
    if (report.freshestSeen === null || item.published_at > report.freshestSeen) report.freshestSeen = item.published_at
    const t = Date.parse(item.published_at)
    if (t < window.from.getTime() || t > window.to.getTime()) {
      report.outsideWindow += 1
      if (t < window.from.getTime() && t >= oldestFallback) beforeWindow.push(item)
    } else inWindow.push(item)
  }

  /** Relevant means a configured Ethara keyword appears in the post itself, and the brand level clears the floor. */
  const relevantOf = (items: readonly NormalizedCandidate[], count: boolean): Kept[] => {
    const out: Kept[] = []
    for (let i = 0; i < items.length; i += pt.analysis_batch_size) {
      for (const item of items.slice(i, i + pt.analysis_batch_size)) {
        const relevance = analyzeRelevance(item, model, cfg)
        const textMatched = relevance.topic_keywords.length > 0 && relevance.matched_keywords.length > 0
        const byKeyword = textMatched && meetsMinimum(relevance.level, minimum)
        // Related: no keyword, but enough brand-topic and Knowledge Base signal to be in Ethara's field.
        const byRelation =
          !textMatched &&
          pt.accept_related &&
          relevance.matched_topics.length + relevance.kb_terms.length >= pt.related_min_signals &&
          relevance.matched_topics.length > 0 &&
          meetsMinimum(relevance.level, pt.related_minimum_relevance) &&
          relevance.excluded_hits.length === 0
        if (!byKeyword && !byRelation) {
          if (count) report.notRelevant += 1
          continue
        }
        const handle = item.url === null ? null : platform.authorHandleFromUrl(item.url)
        // A news story names its publisher, not a handle.
        const author = handle !== null ? `@${handle}` : platform.id === 'web' ? item.author : null
        out.push({ item, relevance, author })
      }
    }
    return out
  }

  // Relevance, in fixed-size batches over the de-duplicated, in-window posts.
  const kept = relevantOf(inWindow, true)
  report.kept = kept.length

  const why = (): string => {
    const parts: string[] = [`${report.found} result${report.found === 1 ? '' : 's'} from ${searchesRun} search${searchesRun === 1 ? '' : 'es'}`]
    if (report.notPosts > 0) parts.push(`${report.notPosts} not posts`)
    if (report.outsideWindow > 0) parts.push(`${report.outsideWindow} from before ${span}`)
    if (report.undated > 0) parts.push(`${report.undated} undated`)
    if (report.notRelevant > 0) parts.push(`${report.notRelevant} not relevant to Ethara`)
    return parts.join(', ')
  }

  /* A platform whose posts cannot be dated: list the relevant ones, undated. */
  if (!platform.canDateItems) {
    const relevant = relevantOf(dateless, true).slice(0, pt.max_undated_posts)
    const undated: UndatedPost[] = relevant.map((k) => ({
      platform: platform.label,
      platformId: platform.id,
      url: k.item.url as string,
      title: k.item.title ?? k.item.snippet ?? '',
      hashtags: k.item.hashtags.map((h) => h.display),
      matchedEtharaKeywords: k.relevance.matched_keywords,
      trend: titleCase(k.relevance.topic_keywords[0] ?? k.relevance.matched_keywords[0] ?? ''),
    }))
    report.kept = undated.length
    report.status = undated.length > 0 ? 'undated' : 'empty'
    report.reason =
      undated.length > 0
        ? `${undated.length} relevant ${platform.label} post${undated.length === 1 ? '' : 's'} found (${why()}). ${platform.label} post ids carry no date and a search result states none, so they are listed with no date and are not passed on as dated evidence.`
        : `No relevant ${platform.label} post found: ${why()}. ${platform.label} posts cannot be dated in any case.`
    return { report, trends: [], posts: [], undated, searchesRun }
  }

  let { trends, posts } = buildTrends(kept, platform, report.searches, span, maxPostsPerTrend, now, day, undefined, knownTags, cfg.platform_trends.platform_trend_min_authors)
  if (kept.length === 0) {
    const detail = why()
    // Nothing verified inside the window: list the newest relevant posts from before it, labelled.
    const older = opts.fallbackToLatest
      ? relevantOf(beforeWindow, false)
          .sort((a, b) => (b.item.published_at as string).localeCompare(a.item.published_at as string))
          .slice(0, pt.fallback_max_posts)
      : []
    if (older.length > 0) {
      ;({ trends, posts } = buildTrends(older, platform, report.searches, span, maxPostsPerTrend, now, day, 'older', knownTags, cfg.platform_trends.platform_trend_min_authors))
      report.status = 'older'
      report.kept = older.length
      report.reason =
        `No relevant post verifiably from ${span} (${detail}). ` +
        `Listing the ${older.length} newest relevant post${older.length === 1 ? '' : 's'} found as supporting historical context only, newest ${(older[0]?.item.published_at as string).slice(0, 10)}. They are not current evidence and are not passed on as current posts.` +
        (report.reason ? ` ${report.reason}` : '')
    } else {
      report.status = 'empty'
      report.reason =
        `No relevant post verifiably from ${span}: ${detail}.` +
        (report.freshestSeen ? ` The newest post found was published ${report.freshestSeen}.` : '') +
        (report.reason ? ` ${report.reason}` : '')
    }
  }
  return { report, trends, posts, undated: [], searchesRun }
}

/* ═══════════════════════════════════════════════════════════════════════════
   ALL PLATFORMS
   ═══════════════════════════════════════════════════════════════════════════ */

export async function discoverPlatformTrends(opts: DiscoverOptions = {}): Promise<PlatformTrendReport> {
  const started = Date.now()
  const cfg = opts.config ?? loadBridgeConfig()
  const pt = cfg.platform_trends
  const now = opts.now ?? new Date()
  // A ceiling the caller cannot raise; the plan below uses only as many as the topics need.
  const searchCeiling = Math.min(pt.max_searches_per_platform, opts.maxSearchesPerPlatform ?? pt.default_searches_per_platform)
  const maxPostsPerTrend = Math.min(pt.max_posts_per_trend, opts.maxPostsPerTrend ?? pt.max_posts_per_trend)
  const day = { today: localIsoDate(now, opts.timeZone), timeZone: opts.timeZone }
  /*
   * THE WINDOW. A caller's `windowHours` is a rolling window. Otherwise — and
   * by default — it is the CURRENT MONTH so far: from midnight on the 1st, in
   * the workspace's time zone, to now. "What is trending this month."
   */
  const monthName = new Date(`${day.today}T12:00:00Z`).toLocaleDateString('en-GB', { month: 'long', year: 'numeric', timeZone: 'UTC' })
  const byMonth = opts.windowHours === undefined && (opts.currentMonth ?? pt.window === 'current_month')
  const window = byMonth
    ? { from: zonedMidnight(`${day.today.slice(0, 7)}-01`, opts.timeZone), to: now }
    : { from: new Date(now.getTime() - (opts.windowHours ?? pt.window_hours) * 3_600_000), to: now }
  const windowHours = byMonth ? Math.max(1, Math.ceil((now.getTime() - window.from.getTime()) / 3_600_000)) : (opts.windowHours ?? pt.window_hours)
  const span = byMonth ? `this month (since 1 ${monthName})` : `the last ${windowLabel(windowHours)}`
  // The window as the research brief states it — dates in the workspace's zone, so the 1st reads as the 1st.
  const longDate = (d: Date): string => d.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', ...(opts.timeZone ? { timeZone: opts.timeZone } : {}) })
  const brief = {
    month: monthName,
    windowText: byMonth
      ? `${monthName} — the current month: ${longDate(window.from)} to ${longDate(now)} (today)${opts.timeZone ? `, ${opts.timeZone}` : ''}`
      : `the last ${windowLabel(windowHours)} — ${longDate(window.from)} to ${longDate(now)} (today)${opts.timeZone ? `, ${opts.timeZone}` : ''}`,
  }

  const context = opts.context ?? (await loadProjectContext(cfg, now))
  // Every keyword, the run's priority order first, redundant ones removed (see searchKeywordsOf).
  const keywords = pt.search_all_keywords
    ? searchKeywordsOf(opts.keywords ?? [], [...context.keywords.keywords, ...(opts.keywords ?? [])])
    : (opts.keywords ?? prioritiseKeywords(context.keywords, cfg))
  /*
   * THE REFERENCE: the Knowledge Base (with the research corpus), every
   * keyword the SMA holds, and the corpus's own topics. The corpus topics fill
   * `corpus_searches` of each platform's searches — rotating daily through the
   * list so successive runs cover all of it — join the hashtag search, and
   * count as Ethara's field when judging relevance.
   */
  const ct = pt.corpus_topics
  const corpus: CorpusTopics =
    opts.corpusTopics ??
    (ct.enabled
      ? await loadCorpusTopics(context.knowledgeBase.entries, {
          maxTerms: ct.max_terms,
          maxHashtags: ct.max_hashtags,
          model: ct.model,
          maxBudgetUsd: ct.max_budget_usd,
          exclude: new Set([...context.keywords.keywords, ...(opts.keywords ?? [])].map((k) => k.term.toLowerCase())),
        })
      : { terms: [], hashtags: [], papers: [], source: 'none', reason: 'Corpus topics are switched off.' })
  const model = buildRelevanceModel(context, cfg, opts.keywords ?? [], corpus.terms)
  // One corpus topic per search, rotating daily through the list.
  const dayNumber = Math.floor(now.getTime() / 86_400_000)
  const perDay = ct.corpus_searches
  const offset = corpus.terms.length > perDay ? (dayNumber * perDay) % corpus.terms.length : 0
  const corpusToday = [...corpus.terms.slice(offset), ...corpus.terms.slice(0, offset)].slice(0, Math.max(0, perDay))
  // "September 2026" — in the workspace's zone, so a run just after midnight names the right month.
  const monthHint = pt.recency_hint ? monthName : undefined
  // Keywords naming the brand itself find the brand's own posts, not the field's — not searched (still relevant).
  const brandNames = [BRAND.name, BRAND.wordmark].map((n) => n.toLowerCase())
  const searchable = pt.exclude_brand_named_searches
    ? keywords.filter((k) => !brandNames.some((n) => k.term.toLowerCase().includes(n)))
    : keywords
  /*
   * HASHTAGS LEARNED ON EARLIER RUNS.
   *
   * New hashtags found on validated posts are written to the Knowledge Base as
   * "Discovered Hashtag" entries (the orchestrator does that after validation).
   * The strongest of them join this run's hashtag search, so each run looks a
   * little wider than the configured keywords — and every tag Ethara already
   * tracks (keywords + learned) is what makes a tag "new" below.
   */
  const learned = context.knowledgeBase.entries
    .filter((e) => e.category === DISCOVERED_HASHTAG_CATEGORY)
    .map((e) => e.title.trim())
    .filter((t) => t.startsWith('#'))
  const knownTags = new Set<string>([
    ...model.keywords.flatMap((k) => k.compacts),
    ...learned.map((t) => compact(t.replace(/^#/, ''))),
  ])
  // One search per topic — every searchable keyword, today's corpus topics, the broad ones — plus the hashtag search, up to the ceiling.
  const maxSearches = Math.min(searchCeiling, searchable.length + corpusToday.length + pt.broad_searches + 1)
  const searchesPlan = platformSearches(searchable, maxSearches, {
    maxWords: pt.max_words_per_term,
    ...(monthHint ? { recencyHint: monthHint } : {}),
    corpusTerms: corpusToday,
    broadTerms: pt.broad_terms,
    broadSearches: pt.broad_searches,
    hashtags: [...learned.slice(0, pt.learned_hashtags_per_search), ...corpus.hashtags.slice(0, ct.hashtags_per_search), ...pt.broad_hashtags],
    hashtagTerms: pt.terms_per_search,
    fixedShare: pt.fixed_keyword_share,
    rotation: dayNumber,
  })
  const platformOpts = {
    fallbackToLatest: opts.fallbackToLatest ?? pt.fallback_to_latest,
    includeUndated: opts.includeUndated ?? pt.include_undated,
  }

  const platforms = (opts.platforms ?? pt.platforms)
    .map((id) => platformModule(id))
    .filter((m): m is PlatformModule => m !== undefined)

  // Each platform on its own adapter, chosen in config — replaceable one platform at a time.
  const adapterFor =
    opts.adapterFor ??
    ((p: PlatformModule, c: BridgeConfig) => {
      const id = c.platform_trends.source_adapters[p.id] ?? 'claude_code'
      const primary = createAdapter(id, { platform: p, config: c })
      const fb = c.platform_trends.fallback_adapter
      return fb && fb !== id ? withFallback(primary, createAdapter(fb, { platform: p, config: c })) : primary
    })

  const sessionCfg: BridgeConfig = { ...cfg, acquisition: { ...cfg.acquisition, claude_code: { ...cfg.acquisition.claude_code, queries_per_session: Math.max(1, Math.min(maxSearches, cfg.acquisition.claude_code.queries_per_session)) } } }
  const runOn = (platform: PlatformModule, plan: DiscoveryQuery[]) =>
    discoverOnPlatform(platform, plan, adapterFor(platform, sessionCfg), cfg, window, span, brief, pt.minimum_brand_relevance, maxPostsPerTrend, model, now, day, platformOpts, knownTags)

  // One session per platform, all platforms at once.
  const results = await Promise.all(platforms.map((platform) => runOn(platform, searchesPlan)))

  // Trending today first, then everything else newest first.
  const trends = results
    .flatMap((r) => r.trends.map((t) => ({ t, newest: t.posts[0]?.publishedAt ?? '' })))
    .sort((a, b) => periodRank(a.t.period) - periodRank(b.t.period) || b.newest.localeCompare(a.newest))
    .map(({ t }) => t)
  const posts = results.flatMap((r) => r.posts).sort((a, b) => b.publishedAt.localeCompare(a.publishedAt))
  const searchesRun = results.reduce((n, r) => n + r.searchesRun, 0)

  const report: PlatformTrendReport = {
    executionId: randomUUID(),
    context: {
      knowledgeBase: {
        source: context.knowledgeBase.source,
        entries: context.knowledgeBase.entries.length,
        vocabularyTerms: model.kbVocabulary.size,
      },
      brand: {
        sources: context.brandVoice.sources,
        positioning: context.brandVoice.positioning,
        audience: context.brandVoice.audience,
        topics: context.brandVoice.topics.length,
      },
      keywords: { source: opts.keywords ? 'this run' : context.keywords.source, count: keywords.length },
    },
    generatedAt: now.toISOString(),
    today: day.today,
    timeZone: opts.timeZone ?? null,
    windowHours,
    window: { from: window.from.toISOString(), to: window.to.toISOString() },
    windowName: span,
    corpus: { papers: corpus.papers.length, terms: corpus.terms, hashtags: corpus.hashtags, searched: corpusToday, source: corpus.source, reason: corpus.reason },
    keywordsUsed: [
      ...new Set(
        searchesPlan.flatMap((q) =>
          (monthHint ? q.text.replace(monthHint, '') : q.text).replace(/[()"]/g, '').split(' OR ').map((t) => t.trim()),
        ),
      ),
    ],
    platforms: results.map((r) => r.report),
    trends,
    posts,
    undated: results.flatMap((r) => r.undated),
    searchesRun,
  }

  writeExecutionLog(
    {
      event: 'claude_bridge.execution',
      execution_id: report.executionId,
      platform: platforms.map((p) => p.id).join(','),
      mode: 'platform_trends',
      started_at: new Date(started).toISOString(),
      completed_at: new Date().toISOString(),
      duration_ms: Date.now() - started,
      queries_generated: searchesPlan.length * platforms.length,
      queries_executed: searchesRun,
      candidates_found: results.reduce((n, r) => n + r.report.found, 0),
      duplicates_removed: results.reduce((n, r) => n + r.report.duplicates, 0),
      stale_results_removed: results.reduce((n, r) => n + r.report.outsideWindow, 0),
      final_results: posts.length,
      source_status: posts.length > 0 || results.some((r) => r.undated.length > 0) ? 'ok' : 'empty',
      // The log's adapter status is about the SOURCE: `older`/`undated` both mean it answered.
      adapters: results.map((r) => ({ adapter: r.report.adapter, status: r.report.status === 'older' || r.report.status === 'undated' ? 'ok' : r.report.status, queries_executed: r.searchesRun, candidates: r.report.found })),
      errors: results.filter((r) => r.report.status === 'error').map((r) => `${r.report.platform}: ${r.report.reason}`),
    },
    opts.logSink,
  )

  return report
}

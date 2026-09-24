/**
 * BRAND RELEVANCE — computed, never judged.
 *
 * Every candidate is compared with four things read from the SMA:
 *   · the configured KEYWORDS (and their synonyms), weighted as configured;
 *   · the brand's TOPIC vocabulary and domains;
 *   · the KNOWLEDGE BASE — content-word bigrams from its subject categories;
 *   · the brand voice's RESTRICTIONS — hype/pitch language the voice rejects,
 *     sensitive subjects, and excluded terms.
 *
 * The result is a 0–1 score, a high/medium/low level from configured
 * thresholds, and a reason that names the evidence (which keyword, which
 * topics, which KB terms, which penalty). Claude may interpret the result
 * further; this layer only measures.
 */

import type { BridgeConfig, RelevanceLevel } from '../config'
import type { BridgeContext, KeywordEntry } from '../context/types'
import type { NormalizedCandidate } from './normalizer'

const STOPWORDS = new Set(
  (
    'a an the and or but if then than of in on at to for from by with without about into over under ' +
    'is are was were be been being it its this that these those as not no so we you they he she i our ' +
    'your their his her them us me my can could should would will may might must do does did done have ' +
    'has had more most less very just also how what why when where which who whom all any each every ' +
    'some such only own same other new one two via per vs'
  ).split(' '),
)

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/#([\p{L}\p{N}_]+)/gu, ' $1 ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 1 && !STOPWORDS.has(w) && !/^\d+$/.test(w))
}

function bigramsOf(text: string): string[] {
  const words = contentWords(text)
  const out: string[] = []
  for (let i = 0; i < words.length - 1; i += 1) out.push(`${words[i]} ${words[i + 1]}`)
  return out
}

function escape(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** A term as a boundary-aware, hyphen/space-tolerant, plural-tolerant pattern. */
export function termPattern(term: string): RegExp {
  const body = term
    .trim()
    .split(/[\s\-_]+/)
    .map(escape)
    .join('[\\s\\-_]?')
  return new RegExp(`(?<![\\p{L}\\p{N}])${body}s?(?![\\p{L}\\p{N}])`, 'iu')
}

export function compact(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '')
}

export interface RelevanceModel {
  keywords: Array<{ entry: KeywordEntry; patterns: RegExp[]; compacts: string[] }>
  topics: Array<{ topic: string; pattern: RegExp }>
  kbVocabulary: Set<string>
  hype: Array<{ pattern: RegExp; why: string }>
  restrictions: Array<{ label: string; pattern: RegExp }>
  excluded: Array<{ term: string; pattern: RegExp }>
}

/** Precomputes matchers once per run. */
export function buildRelevanceModel(
  ctx: BridgeContext,
  cfg: BridgeConfig,
  extraKeywords: readonly KeywordEntry[] = [],
  /** Further topics that count as Ethara's field — the corpus's topics. */
  extraTopics: readonly string[] = [],
): RelevanceModel {
  const byTerm = new Map<string, KeywordEntry>()
  for (const k of [...extraKeywords, ...ctx.keywords.keywords]) {
    if (!byTerm.has(k.term.toLowerCase())) byTerm.set(k.term.toLowerCase(), k)
  }

  const topicSet = new Set<string>()
  for (const t of ctx.brandVoice.topics) topicSet.add(t.toLowerCase().trim())
  for (const t of extraTopics) topicSet.add(t.toLowerCase().trim())
  for (const d of ctx.brandVoice.domains) {
    for (const part of d.split(/,|\band\b|&/i)) {
      const p = part.trim().toLowerCase()
      if (p.split(/\s+/).length >= 2) topicSet.add(p)
    }
  }

  const subject = new Set(cfg.context.knowledge_base.subject_categories.map((c) => c.toLowerCase()))
  const counts = new Map<string, number>()
  for (const e of ctx.knowledgeBase.entries) {
    if (subject.size > 0 && !subject.has(e.category.toLowerCase())) continue
    for (const g of new Set(bigramsOf(`${e.title}\n${e.tags.join(' ')}\n${e.content.slice(0, 4000)}`))) {
      counts.set(g, (counts.get(g) ?? 0) + 1)
    }
  }
  const kbVocabulary = new Set(
    [...counts.entries()]
      .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
      .slice(0, cfg.context.knowledge_base.max_vocabulary_terms)
      .map(([g]) => g),
  )

  return {
    keywords: [...byTerm.values()].map((entry) => ({
      entry,
      patterns: [entry.term, ...entry.synonyms].map(termPattern),
      compacts: [entry.term, ...entry.synonyms].map(compact),
    })),
    topics: [...topicSet].filter((t) => t !== '').map((topic) => ({ topic, pattern: termPattern(topic) })),
    kbVocabulary,
    hype: ctx.brandVoice.hype_patterns.map((p) => ({ pattern: new RegExp(p.source, p.flags.replace('g', '')), why: p.why })),
    restrictions: ctx.brandVoice.restrictions.map((r) => ({ label: r.label, pattern: new RegExp(r.source, r.flags.replace('g', '')) })),
    excluded: ctx.brandVoice.excluded_terms.filter((t) => t.trim() !== '').map((term) => ({ term, pattern: termPattern(term) })),
  }
}

export interface RelevanceResult {
  matched_keywords: string[]
  /**
   * The matched keywords in topic order: earliest in the title first, then the
   * more specific (longer) term, then weight. The first names the item's topic.
   */
  topic_keywords: string[]
  /** Highest matched keyword weight, 0–100; 0 when none matched. */
  best_keyword_weight: number
  matched_topics: string[]
  kb_terms: string[]
  hype_hits: string[]
  restriction_hits: string[]
  excluded_hits: string[]
  keyword_score: number
  topic_score: number
  kb_score: number
  relevance_score: number
  level: RelevanceLevel
  reason: string
}

const LEVEL_ORDER: Record<RelevanceLevel, number> = { high: 3, medium: 2, low: 1 }

export function meetsMinimum(level: RelevanceLevel, minimum: RelevanceLevel): boolean {
  return LEVEL_ORDER[level] >= LEVEL_ORDER[minimum]
}

export function relevanceRank(level: RelevanceLevel): number {
  return LEVEL_ORDER[level]
}

function round(n: number, places = 3): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

function quoteList(items: readonly string[], max = 3): string {
  const shown = items.slice(0, max).map((s) => `“${s}”`)
  const more = items.length > max ? ` and ${items.length - max} more` : ''
  return `${shown.join(', ')}${more}`
}

function topicOrder(
  matched: readonly KeywordEntry[],
  viaQuery: readonly KeywordEntry[],
  title: string,
  model: RelevanceModel,
): string[] {
  const flat = title.replace(/[-_]/g, ' ')
  // Position of the keyword's earliest match in the title; Infinity when absent.
  const position = (k: KeywordEntry): number => {
    const patterns = model.keywords.find((m) => m.entry === k)?.patterns ?? []
    const hits = patterns.map((p) => flat.search(p)).filter((i) => i >= 0)
    return hits.length === 0 ? Number.POSITIVE_INFINITY : Math.min(...hits)
  }
  const ordered = [...matched].sort((a, b) => {
    const pa = position(a)
    const pb = position(b)
    if (pa !== pb) return pa < pb ? -1 : 1
    return b.term.length - a.term.length || b.weight - a.weight
  })
  return [...ordered, ...viaQuery].map((k) => k.term)
}

/**
 * The words a URL's path states. The host, query string and platform ids are
 * dropped: LinkedIn's `-activity-<id>-<4 random characters>` suffix once read
 * as "rLvr" and matched the keyword RLVR, and an Instagram shortcode or X
 * status id is random in the same way.
 */
export function urlWords(url: string | null): string {
  if (!url) return ''
  try {
    return new URL(url).pathname
      .replace(/-activity-\d+-[A-Za-z0-9]+/g, ' ')
      .replace(/\/(?:p|reel|reels|tv|status|statuses|article)\/[^/]+/gi, ' ')
      .replace(/\/+/g, ' ')
  } catch {
    return ''
  }
}

/** An all-capitals keyword ("SFT", "RLVR") — an acronym, which may stand for something else entirely. */
function isAcronym(term: string): boolean {
  return /^[A-Z][A-Z0-9]+$/.test(term.trim())
}

export function analyzeRelevance(item: NormalizedCandidate, model: RelevanceModel, cfg: BridgeConfig): RelevanceResult {
  const text = `${item.analysisText}\n${urlWords(item.url)}`.replace(/[-_]/g, ' ')
  const tagKeys = item.hashtags.map((h) => h.key)
  const rc = cfg.relevance

  let matched: KeywordEntry[] = []
  for (const k of model.keywords) {
    const inText = k.patterns.some((p) => p.test(text))
    const inTags = k.compacts.some((c) => tagKeys.includes(c))
    if (inText || inTags) matched.push(k.entry)
  }
  matched.sort((a, b) => b.weight - a.weight)

  /*
   * AN ACRONYM ALONE IS AMBIGUOUS. "SFT" matched the Société Française de
   * Traumatologie. When every keyword a post names is an acronym, it counts
   * only when another signal places the post in Ethara's field: a brand topic
   * other than the acronym itself, or a Knowledge Base term.
   */
  if (matched.length > 0 && matched.every((k) => isAcronym(k.term))) {
    const own = new Set(matched.map((k) => compact(k.term)))
    const corroborated =
      model.topics.some((t) => !own.has(compact(t.topic)) && t.pattern.test(text)) ||
      bigramsOf(item.analysisText).some((g) => model.kbVocabulary.has(g))
    if (!corroborated) matched = []
  }

  // Keywords whose search returned this item although its visible text does
  // not state them. Real evidence (a search engine matched the page), but
  // weaker than seeing the term, so credited at `query_match_factor`.
  const seen = new Set(matched.map((k) => k.term.toLowerCase()))
  const viaQuery: KeywordEntry[] = [...item.keywords]
    .map((term) => model.keywords.find((k) => k.entry.term.toLowerCase() === term.toLowerCase())?.entry)
    .filter((k): k is KeywordEntry => k !== undefined && !seen.has(k.term.toLowerCase()))
    .sort((a, b) => b.weight - a.weight)

  const best = matched[0]?.weight ?? 0
  const bestViaQuery = (viaQuery[0]?.weight ?? 0) * rc.query_match_factor
  const effective = Math.max(best, bestViaQuery)
  const count = matched.length + viaQuery.length
  const keyword_score = count === 0 ? 0 : Math.min(1, (effective / 100) * (1 + rc.multi_keyword_bonus * (count - 1)))

  const matched_topics = model.topics.filter((t) => t.pattern.test(text)).map((t) => t.topic)
  const topic_score = Math.min(1, matched_topics.length / rc.topic_saturation)

  const itemGrams = new Set(bigramsOf(item.analysisText))
  const kb_terms = [...itemGrams].filter((g) => model.kbVocabulary.has(g))
  const kb_score = Math.min(1, kb_terms.length / rc.kb_saturation)

  const hype_hits = model.hype.filter((h) => h.pattern.test(item.analysisText)).map((h) => {
    const m = item.analysisText.match(h.pattern)
    return m?.[0] ?? h.why
  })
  const restriction_hits = model.restrictions.filter((r) => r.pattern.test(item.analysisText)).map((r) => r.label)
  const excluded_hits = model.excluded.filter((e) => e.pattern.test(text)).map((e) => e.term)

  const w = rc.weights
  const weightSum = w.keyword + w.topic + w.knowledge_base || 1
  let score = (w.keyword * keyword_score + w.topic * topic_score + w.knowledge_base * kb_score) / weightSum
  score -= Math.min(rc.hype_penalty_cap, hype_hits.length * rc.hype_penalty_per_hit)
  if (restriction_hits.length > 0) score -= rc.restriction_penalty
  score = Math.max(0, Math.min(1, score))

  let level: RelevanceLevel = score >= rc.high_threshold ? 'high' : score >= rc.medium_threshold ? 'medium' : 'low'
  if (excluded_hits.length > 0) level = 'low'

  const parts: string[] = []
  const schedNote = (k: KeywordEntry): string =>
    k.scheduled === 'constant' ? ', a standing rota keyword' : k.scheduled === 'this_week' ? ', on this week’s rota' : ''
  if (matched.length > 0) {
    const lead = matched[0] as KeywordEntry
    parts.push(`Mentions configured keyword ${quoteList(matched.map((k) => k.term))} (top weight ${lead.weight}${schedNote(lead)})`)
  }
  if (viaQuery.length > 0) {
    const lead = viaQuery[0] as KeywordEntry
    parts.push(
      `was returned by a search for configured keyword ${quoteList(viaQuery.map((k) => k.term))} (weight ${lead.weight}${schedNote(lead)}), ` +
        'though the visible text does not state it',
    )
  }
  if (count === 0) parts.push('Matches none of the configured keywords')
  if (matched_topics.length > 0) parts.push(`touches brand topics ${quoteList(matched_topics)}`)
  if (kb_terms.length > 0) parts.push(`shares ${kb_terms.length} term${kb_terms.length === 1 ? '' : 's'} with the Knowledge Base (${quoteList(kb_terms)})`)
  const joined = parts.join('; ')
  let reason = `${joined.charAt(0).toUpperCase()}${joined.slice(1)}.`
  if (hype_hits.length > 0) reason += ` Uses language the brand voice rejects as hype (${quoteList(hype_hits, 2)}), so it scores lower.`
  if (restriction_hits.length > 0) reason += ` Touches a subject the brand treats as sensitive (${restriction_hits.slice(0, 2).join(', ')}).`
  if (excluded_hits.length > 0) reason += ` Mentions an excluded subject (${quoteList(excluded_hits, 2)}), so it is classed low.`

  return {
    matched_keywords: [...matched, ...viaQuery].map((k) => k.term),
    topic_keywords: topicOrder(matched, viaQuery, item.title ?? '', model),
    best_keyword_weight: Math.max(best, viaQuery[0]?.weight ?? 0),
    matched_topics,
    kb_terms,
    hype_hits,
    restriction_hits,
    excluded_hits,
    keyword_score: round(keyword_score),
    topic_score: round(topic_score),
    kb_score: round(kb_score),
    relevance_score: round(score),
    level,
    reason,
  }
}

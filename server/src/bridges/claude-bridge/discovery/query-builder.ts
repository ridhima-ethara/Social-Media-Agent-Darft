/**
 * DISCOVERY QUERY BUILDER
 *
 * Turns keywords (+ their synonyms), brand-domain topics and any queries
 * Claude planned into a bounded list of discovery queries. The forms are
 * templates from the config — nothing about a particular campaign lives here.
 *
 * BOUNDED THREE WAYS: `max_keywords`, `max_queries_per_keyword`, and
 * `max_total_queries` across the whole call. The budget is spent BREADTH
 * FIRST — every keyword's first form, then every keyword's second form — so a
 * tight budget still covers every keyword once instead of exhausting itself on
 * the first few.
 */

import type { DiscoveryQuery } from '../adapters/source-types'
import type { BridgeConfig, QueryForm } from '../config'
import type { BrandVoice, KeywordEntry } from '../context/types'

export interface QueryPlanInput {
  /** Already in priority order. */
  keywords: KeywordEntry[]
  brandVoice: BrandVoice
  /** Queries planned by Claude for this call; run first, verbatim. */
  plannedQueries?: readonly string[]
  /**
   * Whether brand-domain topics may fill unused keyword slots. Off when the
   * caller named its keywords: a request about one subject is not widened to
   * the whole brand.
   */
  includeDomainTopics?: boolean
}

export interface QueryPlan {
  queries: DiscoveryQuery[]
  /** Keywords the plan drew on, after `max_keywords`. */
  keywordsUsed: string[]
  /** How many queries were generated before the total budget was applied. */
  generatedBeforeBudget: number
}

/** `AI agents` → `AIAgents`, `post-training` → `PostTraining`, `RLHF` → `RLHF`. */
export function toHashtagBody(term: string): string {
  return term
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w !== '')
    .map((w) => (w === w.toUpperCase() ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join('')
}

/**
 * Brand domains split into short topic phrases usable as queries. Single
 * words ("benchmarks") are dropped as too broad to search on their own.
 */
export function topicsFromDomains(domains: readonly string[]): string[] {
  const out = new Map<string, string>()
  for (const domain of domains) {
    for (const part of domain.split(/,|\band\b|&/i)) {
      const phrase = part.replace(/\s+/g, ' ').trim()
      const words = phrase.split(' ').length
      if (words >= 2 && words <= 4 && !out.has(phrase.toLowerCase())) out.set(phrase.toLowerCase(), phrase)
    }
  }
  return [...out.values()]
}

function expandForm(form: QueryForm, keyword: KeywordEntry, qualifiers: readonly string[]): string[] {
  const needsSynonym = form.template.includes('{synonym}')
  const needsQualifier = form.template.includes('{qualifier}')
  const synonyms = needsSynonym ? keyword.synonyms : ['']
  const quals = needsQualifier ? qualifiers : ['']
  const out: string[] = []
  for (const synonym of synonyms) {
    for (const qualifier of quals) {
      out.push(
        form.template
          .replaceAll('{keyword}', keyword.term)
          .replaceAll('{keyword_hashtag}', toHashtagBody(keyword.term))
          .replaceAll('{synonym}', synonym)
          .replaceAll('{qualifier}', qualifier)
          .replace(/\s+/g, ' ')
          .trim(),
      )
    }
  }
  return out.filter((q) => q !== '' && q !== '""' && q !== '#')
}

export function buildQueries(input: QueryPlanInput, cfg: BridgeConfig): QueryPlan {
  const seen = new Set<string>()
  const queries: DiscoveryQuery[] = []
  const push = (q: DiscoveryQuery): void => {
    const key = q.text.toLowerCase()
    if (seen.has(key)) return
    seen.add(key)
    queries.push(q)
  }

  for (const text of input.plannedQueries ?? []) {
    push({ text: text.trim(), kind: 'post', keyword: null, origin: 'planned' })
  }

  const keywords = input.keywords.slice(0, cfg.max_keywords)

  // Per keyword, its forms in configured order, capped per keyword.
  const perKeyword: DiscoveryQuery[][] = keywords.map((keyword) => {
    const list: DiscoveryQuery[] = []
    for (const form of cfg.query_forms) {
      for (const text of expandForm(form, keyword, cfg.query_qualifiers)) {
        if (list.length >= cfg.max_queries_per_keyword) break
        list.push({ text, kind: form.kind, keyword: keyword.term, origin: form.id })
      }
      if (list.length >= cfg.max_queries_per_keyword) break
    }
    return list
  })

  // Brand-domain topics fill any keyword slots the configured set left empty.
  if (cfg.include_brand_domains_as_topics && input.includeDomainTopics !== false && keywords.length < cfg.max_keywords) {
    const known = new Set(keywords.map((k) => k.term.toLowerCase()))
    const topics = topicsFromDomains(input.brandVoice.domains).filter((t) => !known.has(t.toLowerCase()))
    for (const topic of topics.slice(0, cfg.max_keywords - keywords.length)) {
      perKeyword.push([{ text: `"${topic}"`, kind: 'topic', keyword: topic, origin: 'brand_domain' }])
    }
  }

  const generated = perKeyword.reduce((n, list) => n + list.length, 0) + queries.length

  // Breadth first: round i takes the i-th query of every keyword.
  const rounds = Math.max(0, ...perKeyword.map((l) => l.length))
  for (let i = 0; i < rounds && queries.length < cfg.max_total_queries; i += 1) {
    for (const list of perKeyword) {
      const q = list[i]
      if (q) push(q)
      if (queries.length >= cfg.max_total_queries) break
    }
  }

  return {
    queries: queries.slice(0, cfg.max_total_queries),
    keywordsUsed: keywords.map((k) => k.term),
    generatedBeforeBudget: generated,
  }
}

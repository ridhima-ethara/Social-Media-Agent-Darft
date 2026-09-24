/**
 * TREND RANKING
 *
 * "Trending" is not "recent". Each item gets configured-weight components,
 * each in 0–1:
 *
 *   recency           — position of its date within the search window
 *   keyword_relevance — the relevance stage's keyword score
 *   topic_relevance   — the relevance stage's topic score
 *   hashtag_signal    — how many OTHER candidates carry its (non-generic) tags
 *   cross_query       — how many distinct discovery queries surfaced it
 *   source_signal     — how many distinct adapters surfaced it
 *   engagement        — log-scaled stated engagement, ONLY when the source
 *                       stated it
 *
 * N/A IS NEVER 0. When engagement was not stated it is left out and the
 * remaining weights are renormalised, so an unmeasured post is neither
 * rewarded nor punished for a number nobody observed. The reason says so.
 */

import type { BridgeConfig, RelevanceLevel } from '../config'
import type { Engagement, ScoreBreakdown } from '../schemas/trend-output'
import { recencyScore, type SearchWindow } from './freshness'
import type { Hashtag, NormalizedCandidate } from './normalizer'
import type { RelevanceResult } from './relevance'
import { relevanceRank } from './relevance'

export interface ScoredItem {
  item: NormalizedCandidate
  relevance: RelevanceResult
  breakdown: ScoreBreakdown
  trend_score: number
  trend_reason: string
  engagement_available: boolean
}

export function engagementTotal(e: Engagement | null): number | null {
  if (e === null) return null
  const parts = [e.reactions, e.comments, e.reposts].filter((n): n is number => n !== null)
  return parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0)
}

/** Tag key → number of candidates carrying it. Generic tags are counted but not scored. */
export function hashtagFrequency(items: readonly NormalizedCandidate[]): Map<string, number> {
  const freq = new Map<string, number>()
  for (const item of items) for (const h of item.hashtags) freq.set(h.key, (freq.get(h.key) ?? 0) + 1)
  return freq
}

function round(n: number, places = 3): number {
  const f = 10 ** places
  return Math.round(n * f) / f
}

function describeAge(publishedAt: string | null, now: Date): string {
  if (publishedAt === null) return 'Publication date unknown, so it earns no recency credit'
  const days = Math.max(0, Math.floor((now.getTime() - Date.parse(publishedAt)) / 86_400_000))
  return days === 0 ? 'Published today' : `Published ${days} day${days === 1 ? '' : 's'} ago`
}

export function scoreItems(
  entries: ReadonlyArray<{ item: NormalizedCandidate; relevance: RelevanceResult }>,
  allItems: readonly NormalizedCandidate[],
  window: SearchWindow,
  genericTags: ReadonlySet<string>,
  cfg: BridgeConfig,
  now: Date,
): ScoredItem[] {
  const w = cfg.ranking.weights
  const freq = hashtagFrequency(allItems)
  const maxTagFreq = Math.max(1, ...[...freq.entries()].filter(([k]) => !genericTags.has(k)).map(([, n]) => n))
  const maxQueries = Math.max(1, ...allItems.map((i) => i.queries.size))
  const totalAdapters = new Set(allItems.flatMap((i) => [...i.adapters])).size
  const totals = allItems.map((i) => engagementTotal(i.engagement)).filter((n): n is number => n !== null)
  const maxEngagement = Math.max(0, ...totals)

  return entries.map(({ item, relevance }) => {
    const specific = item.hashtags.filter((h: Hashtag) => !genericTags.has(h.key))
    const sharedTags = specific.map((h) => (freq.get(h.key) ?? 1) - 1)
    const hashtag_signal = maxTagFreq <= 1 || sharedTags.length === 0 ? 0 : Math.max(...sharedTags) / (maxTagFreq - 1)
    const cross_query = maxQueries <= 1 ? 0 : (item.queries.size - 1) / (maxQueries - 1)
    const source_signal = totalAdapters <= 1 ? 0 : (item.adapters.size - 1) / (totalAdapters - 1)
    const total = engagementTotal(item.engagement)
    const engagement = total === null ? null : maxEngagement <= 0 ? 0 : Math.log1p(total) / Math.log1p(maxEngagement)

    const breakdown: ScoreBreakdown = {
      recency: round(recencyScore(item.published_at, window, cfg.ranking.undated_recency_score)),
      keyword_relevance: relevance.keyword_score,
      topic_relevance: relevance.topic_score,
      hashtag_signal: round(hashtag_signal),
      cross_query: round(cross_query),
      source_signal: round(source_signal),
      engagement: engagement === null ? null : round(engagement),
    }

    const components: Array<[number, number]> = [
      [w.recency, breakdown.recency],
      [w.keyword_relevance, breakdown.keyword_relevance],
      [w.topic_relevance, breakdown.topic_relevance],
      [w.hashtag_signal, breakdown.hashtag_signal],
      [w.cross_query, breakdown.cross_query],
      [w.source_signal, breakdown.source_signal],
      ...(breakdown.engagement === null ? [] : [[w.engagement, breakdown.engagement] as [number, number]]),
    ]
    const weightSum = components.reduce((s, [wt]) => s + wt, 0) || 1
    const trend_score = round((100 * components.reduce((s, [wt, v]) => s + wt * v, 0)) / weightSum, 1)

    const reasons: string[] = [describeAge(item.published_at, now)]
    if (item.queries.size > 1) reasons.push(`surfaced by ${item.queries.size} discovery queries`)
    const topShared = specific
      .map((h) => ({ h, n: freq.get(h.key) ?? 1 }))
      .filter((x) => x.n > 1)
      .sort((a, b) => b.n - a.n)[0]
    if (topShared) reasons.push(`${topShared.h.display} also appears on ${topShared.n - 1} other candidate post${topShared.n - 1 === 1 ? '' : 's'}`)
    if (item.adapters.size > 1) reasons.push(`found by ${item.adapters.size} independent sources`)
    if (total !== null) reasons.push(`${total} stated engagements`)
    let trend_reason = `${reasons.join('; ')}.`
    if (total === null) trend_reason += ' The source stated no engagement, so the score is computed without it.'

    return { item, relevance, breakdown, trend_score, trend_reason, engagement_available: total !== null }
  })
}

function dayOf(iso: string | null): string {
  return iso === null ? '' : iso.slice(0, 10)
}

/**
 * The output order. `published_at_desc` (the default): newest first — by
 * calendar day when `sort_date_granularity` is `day`, so trend score decides
 * the order within a day — then trend score, then relevance. Undated items
 * sort after every dated one. `trend_score_desc` puts the score first.
 */
export function sortScored(items: ScoredItem[], cfg: BridgeConfig): ScoredItem[] {
  const dateKey = (s: ScoredItem): string =>
    cfg.sort_date_granularity === 'day' ? dayOf(s.item.published_at) : (s.item.published_at ?? '')
  const byDate = (a: ScoredItem, b: ScoredItem): number => {
    const da = dateKey(a)
    const db = dateKey(b)
    if (da === db) return 0
    if (da === '') return 1
    if (db === '') return -1
    return da < db ? 1 : -1
  }
  const byScore = (a: ScoredItem, b: ScoredItem): number => b.trend_score - a.trend_score
  const byRelevance = (a: ScoredItem, b: ScoredItem): number =>
    relevanceRank(b.relevance.level as RelevanceLevel) - relevanceRank(a.relevance.level as RelevanceLevel)
  const byStable = (a: ScoredItem, b: ScoredItem): number => a.item.key.localeCompare(b.item.key)

  return [...items].sort((a, b) =>
    cfg.sort === 'trend_score_desc'
      ? byScore(a, b) || byDate(a, b) || byRelevance(a, b) || byStable(a, b)
      : byDate(a, b) || byScore(a, b) || byRelevance(a, b) || byStable(a, b),
  )
}

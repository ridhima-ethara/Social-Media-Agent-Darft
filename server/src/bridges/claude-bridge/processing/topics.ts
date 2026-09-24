/**
 * TOPICS AND HASHTAGS — the aggregate view over the ranked items.
 *
 * An item's topic is computed, in order: its highest-weight matched keyword;
 * else its first matched brand topic; else its most-shared hashtag spelled as
 * words; else "Unclassified". It is a label derived from the observed text,
 * never a summary written by a model.
 */

import type { RelevanceLevel } from '../config'
import type { TrendingHashtag, TrendingTopic, TrendResult } from '../schemas/trend-output'
import type { Hashtag } from './normalizer'
import { relevanceRank } from './relevance'

/** Capitalises lower-case words only, so `AI`, `RLHF` and `LLM` keep their casing. */
function titleCase(phrase: string): string {
  return phrase
    .split(' ')
    .map((w) => (w.length > 0 && w === w.toLowerCase() ? w.charAt(0).toUpperCase() + w.slice(1) : w))
    .join(' ')
}

function tagAsWords(tag: Hashtag): string {
  return tag.display.replace(/^#/, '').replace(/([a-z])([A-Z])/g, '$1 $2').replace(/_/g, ' ')
}

export function topicFor(
  matchedKeywords: readonly string[],
  matchedTopics: readonly string[],
  hashtags: readonly Hashtag[],
  hashtagFreq: ReadonlyMap<string, number>,
  genericTags: ReadonlySet<string>,
): string {
  if (matchedKeywords[0]) return titleCase(matchedKeywords[0])
  if (matchedTopics[0]) return titleCase(matchedTopics[0])
  const tag = hashtags
    .filter((h) => !genericTags.has(h.key))
    .sort((a, b) => (hashtagFreq.get(b.key) ?? 0) - (hashtagFreq.get(a.key) ?? 0))[0]
  return tag ? tagAsWords(tag) : 'Unclassified'
}

function latest(a: string | null, b: string | null): string | null {
  if (a === null) return b
  if (b === null) return a
  return a > b ? a : b
}

export function aggregateTopics(results: readonly TrendResult[]): TrendingTopic[] {
  const groups = new Map<string, TrendResult[]>()
  for (const r of results) {
    const list = groups.get(r.topic) ?? []
    list.push(r)
    groups.set(r.topic, list)
  }
  const topics: TrendingTopic[] = [...groups.entries()].map(([topic, list]) => {
    const tagCounts = new Map<string, number>()
    for (const r of list) for (const h of r.hashtags) tagCounts.set(h, (tagCounts.get(h) ?? 0) + 1)
    const best = list.reduce<RelevanceLevel>(
      (acc, r) => (relevanceRank(r.brand_relevance) > relevanceRank(acc) ? r.brand_relevance : acc),
      'low',
    )
    return {
      topic,
      post_count: list.length,
      latest_published_at: list.reduce<string | null>((acc, r) => latest(acc, r.published_at), null),
      hashtags: [...tagCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5).map(([h]) => h),
      matched_queries: [...new Set(list.flatMap((r) => r.matched_queries))],
      mean_trend_score: Math.round((10 * list.reduce((s, r) => s + r.trend_score, 0)) / list.length) / 10,
      best_brand_relevance: best,
      post_urls: list.map((r) => r.post_url).filter((u): u is string => u !== null).slice(0, 3),
    }
  })
  return topics.sort(
    (a, b) =>
      (b.latest_published_at ?? '').localeCompare(a.latest_published_at ?? '') ||
      b.post_count - a.post_count ||
      b.mean_trend_score - a.mean_trend_score,
  )
}

export function aggregateHashtags(results: readonly TrendResult[], genericTags: ReadonlySet<string>): TrendingHashtag[] {
  const map = new Map<string, TrendingHashtag>()
  for (const r of results) {
    for (const display of r.hashtags) {
      const key = display.replace(/^#/, '').toLowerCase()
      const existing = map.get(key)
      if (existing) {
        existing.post_count += 1
        existing.latest_published_at = latest(existing.latest_published_at, r.published_at)
      } else {
        map.set(key, { hashtag: display, post_count: 1, latest_published_at: r.published_at, generic: genericTags.has(key) })
      }
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      Number(a.generic) - Number(b.generic) ||
      b.post_count - a.post_count ||
      (b.latest_published_at ?? '').localeCompare(a.latest_published_at ?? ''),
  )
}

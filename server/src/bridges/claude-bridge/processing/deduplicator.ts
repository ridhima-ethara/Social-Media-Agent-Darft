/**
 * DEDUPLICATION
 *
 * Two passes:
 *   1. Exact identity — the platform post id when the URL carries one, the
 *      canonical URL otherwise. The same post reached through three queries,
 *      two adapters, or a country subdomain collapses to one item.
 *   2. Near-duplicate text — for items with text of their own, a Dice
 *      similarity at or above the configured threshold (the computed
 *      `similarity()` the whole SMA uses, never a judged one). Catches a
 *      repost or cross-post under a different URL.
 *
 * A merge loses nothing: queries, keywords, adapters and hashtags are unioned
 * — `matched_queries` is itself a trend signal — and a verified date or stated
 * engagement from either side is kept.
 */

import { similarity } from '../../../../../shared/brand-voice'
import type { NormalizedCandidate } from './normalizer'

export interface DedupeOutcome {
  items: NormalizedCandidate[]
  duplicates_removed: number
}

function merge(into: NormalizedCandidate, from: NormalizedCandidate): void {
  for (const a of from.adapters) into.adapters.add(a)
  for (const q of from.queries) into.queries.add(q)
  for (const k of from.keywords) into.keywords.add(k)
  const tags = new Map(into.hashtags.map((h) => [h.key, h]))
  for (const h of from.hashtags) if (!tags.has(h.key)) tags.set(h.key, h)
  into.hashtags = [...tags.values()]

  if (into.date_status === 'unknown' && from.date_status === 'verified') {
    into.published_at = from.published_at
    into.date_status = from.date_status
    into.date_source = from.date_source
  } else if (into.date_source !== 'platform_id' && from.date_source === 'platform_id') {
    // A decoded id outranks a stated date.
    into.published_at = from.published_at
    into.date_source = from.date_source
  }

  if (into.engagement === null && from.engagement !== null) into.engagement = from.engagement
  if (into.url === null && from.url !== null) {
    into.url = from.url
    into.itemId = from.itemId
    into.contentType = from.contentType
  }
  if (from.analysisText.length > into.analysisText.length) {
    into.analysisText = from.analysisText
    into.snippet = from.snippet ?? into.snippet
    into.title = from.title ?? into.title
  }
  if (into.author === null) into.author = from.author
}

export function deduplicate(items: readonly NormalizedCandidate[], similarityThreshold: number): DedupeOutcome {
  const byKey = new Map<string, NormalizedCandidate>()
  let removed = 0

  for (const item of items) {
    const existing = byKey.get(item.key)
    if (existing) {
      merge(existing, item)
      removed += 1
    } else {
      // Copies, so merging never mutates the caller's objects.
      byKey.set(item.key, {
        ...item,
        hashtags: [...item.hashtags],
        adapters: new Set(item.adapters),
        queries: new Set(item.queries),
        keywords: new Set(item.keywords),
      })
    }
  }

  const unique: NormalizedCandidate[] = []
  for (const item of byKey.values()) {
    // Titles alone are too short to compare meaningfully; require some body.
    const comparable = item.analysisText.split(/\s+/).length >= 12
    const twin = comparable
      ? unique.find(
          (u) =>
            u.analysisText.split(/\s+/).length >= 12 &&
            similarity(u.analysisText, item.analysisText) >= similarityThreshold,
        )
      : undefined
    if (twin) {
      merge(twin, item)
      removed += 1
    } else {
      unique.push(item)
    }
  }

  return { items: unique, duplicates_removed: removed }
}

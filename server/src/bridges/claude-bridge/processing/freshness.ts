/**
 * FRESHNESS
 *
 * Age bands and the search window come from the config. An item is removed
 * when its verified date falls outside the window (older than `from` → stale;
 * newer than `to` → out of window). An undated item is kept or dropped per
 * `include_undated` — never given a date to decide it.
 */

import type { BridgeConfig } from '../config'
import type { Freshness } from '../schemas/trend-output'
import type { NormalizedCandidate } from './normalizer'

const DAY_MS = 24 * 60 * 60 * 1000

export interface SearchWindow {
  from: Date
  to: Date
}

/** The window: explicit bounds when given, otherwise the last `trend_window_days` up to now. */
export function resolveWindow(cfg: BridgeConfig, now: Date, from?: string | null, to?: string | null): SearchWindow {
  const end = to ? new Date(to) : now
  const start = from ? new Date(from) : new Date(end.getTime() - cfg.trend_window_days * DAY_MS)
  // A date-only upper bound means "through the end of that day".
  if (to && /^\d{4}-\d{2}-\d{2}$/.test(to.trim())) end.setUTCHours(23, 59, 59, 999)
  return { from: start, to: end }
}

/** Whole days between publication and now; `null` when undated. */
export function ageInDays(publishedAt: string | null, now: Date): number | null {
  if (publishedAt === null) return null
  return Math.max(0, Math.floor((now.getTime() - Date.parse(publishedAt)) / DAY_MS))
}

export function classifyFreshness(ageDays: number | null, bands: BridgeConfig['freshness_bands']): Freshness {
  if (ageDays === null) return 'unknown'
  if (ageDays <= bands.very_recent_max_days) return 'very_recent'
  if (ageDays <= bands.recent_max_days) return 'recent'
  if (ageDays <= bands.current_max_days) return 'current'
  if (ageDays <= bands.aging_max_days) return 'aging'
  return 'stale'
}

/** 1 for published now, falling linearly to 0 at the window's start. */
export function recencyScore(publishedAt: string | null, window: SearchWindow, undatedScore: number): number {
  if (publishedAt === null) return undatedScore
  const span = window.to.getTime() - window.from.getTime()
  if (span <= 0) return 1
  const position = (Date.parse(publishedAt) - window.from.getTime()) / span
  return Math.min(1, Math.max(0, position))
}

export interface FreshnessOutcome {
  kept: NormalizedCandidate[]
  stale_removed: number
  out_of_window_removed: number
  undated_removed: number
  undated_kept: number
}

export function applyFreshness(
  items: readonly NormalizedCandidate[],
  window: SearchWindow,
  includeUndated: boolean,
): FreshnessOutcome {
  const out: FreshnessOutcome = { kept: [], stale_removed: 0, out_of_window_removed: 0, undated_removed: 0, undated_kept: 0 }
  for (const item of items) {
    if (item.published_at === null) {
      if (includeUndated) {
        out.kept.push(item)
        out.undated_kept += 1
      } else {
        out.undated_removed += 1
      }
      continue
    }
    const t = Date.parse(item.published_at)
    if (t < window.from.getTime()) {
      out.stale_removed += 1
    } else if (t > window.to.getTime()) {
      out.out_of_window_removed += 1
    } else {
      out.kept.push(item)
    }
  }
  return out
}

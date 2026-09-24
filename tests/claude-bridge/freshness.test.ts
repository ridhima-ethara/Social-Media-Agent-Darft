import { describe, expect, it } from 'vitest'
import {
  ageInDays,
  applyFreshness,
  classifyFreshness,
  recencyScore,
  resolveWindow,
} from '../../server/src/bridges/claude-bridge/processing/freshness'
import { normalizeCandidates, parseSourceDate } from '../../server/src/bridges/claude-bridge/processing/normalizer'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'
import { NOW, activityIdFor, candidate, cfg, daysAgo, postUrl } from './helpers'

describe('freshness', () => {
  const bands = cfg.freshness_bands

  it('classifies ages into the configured bands', () => {
    expect(classifyFreshness(0, bands)).toBe('very_recent')
    expect(classifyFreshness(1, bands)).toBe('very_recent')
    expect(classifyFreshness(2, bands)).toBe('recent')
    expect(classifyFreshness(3, bands)).toBe('recent')
    expect(classifyFreshness(4, bands)).toBe('current')
    expect(classifyFreshness(7, bands)).toBe('current')
    expect(classifyFreshness(8, bands)).toBe('aging')
    expect(classifyFreshness(14, bands)).toBe('aging')
    expect(classifyFreshness(15, bands)).toBe('stale')
    expect(classifyFreshness(null, bands)).toBe('unknown')
  })

  it('uses the configured window, or explicit bounds', () => {
    const w = resolveWindow(cfg, NOW)
    expect(Math.round((w.to.getTime() - w.from.getTime()) / 86_400_000)).toBe(cfg.trend_window_days)
    const explicit = resolveWindow(cfg, NOW, '2026-09-01', '2026-09-10')
    expect(explicit.from.toISOString()).toBe('2026-09-01T00:00:00.000Z')
    expect(explicit.to.toISOString()).toBe('2026-09-10T23:59:59.999Z')
  })

  it('removes stale items, keeps undated ones as unknown, and never invents a date', () => {
    const raw = [
      candidate({ url: postUrl('a', 'fresh', daysAgo(1), 1) }),
      candidate({ url: postUrl('b', 'old', daysAgo(40), 2) }),
      candidate({ url: 'https://www.linkedin.com/pulse/undated-article-sample' }),
    ]
    const { items } = normalizeCandidates(raw, linkedin, cfg, NOW)
    const undated = items.find((i) => i.contentType === 'article')!
    expect(undated.published_at).toBeNull()
    expect(undated.date_status).toBe('unknown')

    const out = applyFreshness(items, resolveWindow(cfg, NOW), true)
    expect(out.kept).toHaveLength(2)
    expect(out.stale_removed).toBe(1)
    expect(out.undated_kept).toBe(1)
    expect(applyFreshness(items, resolveWindow(cfg, NOW), false).undated_removed).toBe(1)
  })

  it('decodes the date from the LinkedIn activity id, and prefers it over a stated one', () => {
    const when = daysAgo(2)
    const [item] = normalizeCandidates(
      [candidate({ url: `https://www.linkedin.com/feed/update/urn:li:activity:${activityIdFor(when)}`, published_at: '2020-01-01T00:00:00Z' })],
      linkedin,
      cfg,
      NOW,
    ).items
    expect(item!.published_at).toBe(when.toISOString())
    expect(item!.date_source).toBe('platform_id')
    expect(item!.date_status).toBe('verified')
  })

  it('accepts a stated date only when it is a real, past instant', () => {
    expect(parseSourceDate('2026-09-20T10:00:00Z', NOW)).toBe('2026-09-20T10:00:00.000Z')
    expect(parseSourceDate(1_790_000_000, NOW)).not.toBeNull()
    expect(parseSourceDate('3d ago', NOW)).toBeNull()
    expect(parseSourceDate('next week', NOW)).toBeNull()
    expect(parseSourceDate('2031-01-01T00:00:00Z', NOW)).toBeNull()
  })

  it('scores recency linearly across the window and gives undated items no credit', () => {
    const w = resolveWindow(cfg, NOW)
    expect(recencyScore(NOW.toISOString(), w, cfg.ranking.undated_recency_score)).toBe(1)
    expect(recencyScore(w.from.toISOString(), w, cfg.ranking.undated_recency_score)).toBe(0)
    expect(recencyScore(null, w, cfg.ranking.undated_recency_score)).toBe(cfg.ranking.undated_recency_score)
    expect(ageInDays(daysAgo(3).toISOString(), NOW)).toBe(3)
  })
})

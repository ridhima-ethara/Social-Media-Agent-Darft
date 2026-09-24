/**
 * The post-ready horizon (ADR-016): today → post ready, tomorrow → post ready
 * only when the posting schedule requires it, later → topic only. And the
 * content pillar a Topic Queue row shows.
 */
import { describe, expect, it } from 'vitest'
import { isPostingDay, isTopicDate, postReadyDates } from '../shared/calendar-horizon'
import { contentPillarFor } from '../shared/content-pillars'

// Noon UTC so the local date is the same in every CI time zone we use.
const at = (iso: string): Date => new Date(`${iso}T12:00:00Z`)

describe('post-ready dates', () => {
  it('writes today and tomorrow on a weekday', () => {
    expect(postReadyDates({ now: at('2026-09-23'), timeZone: 'UTC', horizon: 'today-and-tomorrow', avoidWeekends: true }))
      .toEqual(['2026-09-23', '2026-09-24'])
  })

  it('does not write ahead when tomorrow is not a posting day', () => {
    // Friday → Saturday is skipped under avoidWeekends.
    expect(postReadyDates({ now: at('2026-09-25'), timeZone: 'UTC', horizon: 'today-and-tomorrow', avoidWeekends: true }))
      .toEqual(['2026-09-25'])
    // …but is a posting day when weekends are allowed.
    expect(postReadyDates({ now: at('2026-09-25'), timeZone: 'UTC', horizon: 'today-and-tomorrow', avoidWeekends: false }))
      .toEqual(['2026-09-25', '2026-09-26'])
  })

  it('writes only today under the "today" horizon', () => {
    expect(postReadyDates({ now: at('2026-09-23'), timeZone: 'UTC', horizon: 'today', avoidWeekends: true }))
      .toEqual(['2026-09-23'])
  })

  it('treats every later date as a topic only', () => {
    const opts = { now: at('2026-09-23'), timeZone: 'UTC', horizon: 'today-and-tomorrow' as const, avoidWeekends: true }
    expect(isTopicDate('2026-09-23', opts)).toBe(false)
    expect(isTopicDate('2026-09-24', opts)).toBe(false)
    expect(isTopicDate('2026-09-25', opts)).toBe(true)
    expect(isTopicDate('2026-10-01', opts)).toBe(true)
    // A past date is neither post-ready nor in the queue.
    expect(isTopicDate('2026-09-22', opts)).toBe(false)
  })

  it('reads the posting schedule for weekends', () => {
    expect(isPostingDay('2026-09-26', true)).toBe(false)
    expect(isPostingDay('2026-09-26', false)).toBe(true)
    expect(isPostingDay('2026-09-28', true)).toBe(true)
  })
})

describe('content pillar', () => {
  it('files a topic under the brand domain it names', () => {
    expect(contentPillarFor('Why RLHF reward models drift')).toBe('Reinforcement learning and reward modelling')
    expect(contentPillarFor('Agentic AI needs better tool use', 'multi-agent orchestration')).toBe(
      'Agentic systems and multi-agent orchestration',
    )
    expect(contentPillarFor('A new benchmark for evaluation harnesses')).toBe('Model evaluation, benchmarks and environments')
  })

  it('says none rather than filing a topic arbitrarily', () => {
    expect(contentPillarFor('Office party photos')).toBeNull()
  })
})

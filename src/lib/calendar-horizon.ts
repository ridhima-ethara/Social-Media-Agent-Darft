/**
 * The post-ready horizon, as the screen reads it.
 *
 *   Today → post ready · Tomorrow → post ready when the schedule requires it ·
 *   Later → a topic in the Topic Queue, generated on demand.
 *
 * The server resolves the horizon from the operator's knobs and the workspace
 * time zone and sends it with `/api/state`; this only reads it. Standalone, with
 * no server, it is computed from the registry defaults by the same shared rule,
 * so the two can never label a card differently.
 */

import { postReadyDates, localIsoDate, type PostReadyHorizon } from '@shared/calendar-horizon'
import type { CalendarHorizonView, Idea } from '../types'

export type { CalendarHorizonView }

/** The server's horizon, or — standalone — the registry defaults applied locally. */
export function resolveHorizon(fromServer: CalendarHorizonView | null | undefined, now: Date = new Date()): CalendarHorizonView {
  if (fromServer && Array.isArray(fromServer.postReadyDates) && typeof fromServer.today === 'string') return fromServer
  const horizon: PostReadyHorizon = 'today-and-tomorrow'
  return {
    today: localIsoDate(now),
    postReadyDates: postReadyDates({ now, horizon, avoidWeekends: true }),
    horizon,
    avoidWeekends: true,
    timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  }
}

const dayOf = (idea: Pick<Idea, 'scheduled_date'>): string => String(idea.scheduled_date).slice(0, 10)

/** True when the idea's date is post-ready: its post is written now (or already was). */
export function isPostReadyDay(idea: Pick<Idea, 'scheduled_date'>, h: CalendarHorizonView): boolean {
  return h.postReadyDates.includes(dayOf(idea))
}

/**
 * A topic in the Topic Queue: placed on a date after the post-ready horizon and
 * holding no post yet. It carries no caption, image or hashtags until someone
 * presses Generate Post.
 */
export function isQueuedTopic(idea: Idea, h: CalendarHorizonView): boolean {
  if (idea.calendar_slot !== 'primary' || idea.status !== 'suggested') return false
  if (idea.draft?.body) return false
  const day = dayOf(idea)
  return day > h.today && !h.postReadyDates.includes(day)
}

/** "10:30 AM" → minutes past midnight, so a queue's slots sort by clock time. */
export function minutesOf(label: string): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)?$/i.exec(label.trim())
  if (!m) return 0
  let hour = Number(m[1]) % 12
  if ((m[3] ?? '').toUpperCase() === 'PM') hour += 12
  if (!m[3]) hour = Number(m[1])
  return hour * 60 + Number(m[2])
}

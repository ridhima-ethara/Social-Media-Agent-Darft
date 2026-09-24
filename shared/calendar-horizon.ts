/**
 * THE POST-READY HORIZON — which calendar dates get a written post, and which
 * hold a topic only.
 *
 *   Validated topics → Calendar Agent
 *     → today:     create the post (when a post is placed today)
 *     → tomorrow:  create the post only when the posting schedule requires it
 *                  (a post is placed tomorrow AND tomorrow is a posting day)
 *     → later:     topic only, in the Topic Queue, until someone presses
 *                  "Generate Post"
 *
 * Shared by both tiers so the server that writes posts and the screen that
 * labels cards can never disagree about which is which. Zero dependencies.
 */

/** Configured by `postReadyHorizon` on `calendar.rank.select`. */
export type PostReadyHorizon = 'today' | 'today-and-tomorrow'

export const POST_READY_HORIZONS: readonly PostReadyHorizon[] = ['today', 'today-and-tomorrow']

/** `YYYY-MM-DD` for an instant, in a time zone (the workspace's), or the process's local zone. */
export function localIsoDate(at: Date, timeZone?: string): string {
  // en-CA formats as YYYY-MM-DD.
  return at.toLocaleDateString('en-CA', timeZone ? { timeZone } : {})
}

/** The calendar day after `iso`. */
export function nextIsoDate(iso: string): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + 1)
  return d.toISOString().slice(0, 10)
}

/** Whether the posting schedule posts on this date at all. */
export function isPostingDay(iso: string, avoidWeekends: boolean): boolean {
  if (!avoidWeekends) return true
  const day = new Date(`${iso}T12:00:00Z`).getUTCDay()
  return day !== 0 && day !== 6
}

export interface HorizonOptions {
  now: Date
  timeZone?: string
  horizon: PostReadyHorizon
  /** From `calendar.slot.optimize` — the posting schedule's day rule. */
  avoidWeekends: boolean
}

/**
 * The dates whose placed posts are written now. Today always; tomorrow only
 * under `today-and-tomorrow` and only when tomorrow is a posting day — a post
 * placed on a day the schedule does not post on is not required.
 */
export function postReadyDates(opts: HorizonOptions): string[] {
  const today = localIsoDate(opts.now, opts.timeZone)
  const dates = [today]
  if (opts.horizon === 'today-and-tomorrow') {
    const tomorrow = nextIsoDate(today)
    if (isPostingDay(tomorrow, opts.avoidWeekends)) dates.push(tomorrow)
  }
  return dates
}

/** True when a post placed on `iso` is written now rather than held as a topic. */
export function isPostReadyDate(iso: string, opts: HorizonOptions): boolean {
  return postReadyDates(opts).includes(iso)
}

/** True for a date after the post-ready horizon: such a placement is a topic until generated. */
export function isTopicDate(iso: string, opts: HorizonOptions): boolean {
  const dates = postReadyDates(opts)
  const today = dates[0] as string
  return iso > today && !dates.includes(iso)
}

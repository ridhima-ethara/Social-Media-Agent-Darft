/**
 * The post-ready horizon, resolved for a workspace (the rule itself is
 * `shared/calendar-horizon.ts`).
 *
 * Two knobs decide it — `postReadyHorizon` on `calendar.rank.select` and the
 * posting schedule's `avoidWeekends` on `calendar.slot.optimize` — and both are
 * resolved through the same precedence the runtime uses (registry default <
 * workspace override), so the operator's settings govern the orchestrator's
 * writer, the Generate Post route and the screen exactly as they govern the
 * skills.
 */

import { SKILL_BY_ID } from '../../shared/agent-registry'
import {
  localIsoDate,
  POST_READY_HORIZONS,
  postReadyDates,
  type PostReadyHorizon,
} from '../../shared/calendar-horizon'
import { resolveConfig } from './agents/runtime'
import { config } from './config'
import { listSkillOverrides } from './db/repo'

export interface CalendarHorizon {
  /** Today in the workspace's time zone. */
  today: string
  /** The dates whose placed topics are written now — today, and tomorrow when required. */
  postReadyDates: string[]
  horizon: PostReadyHorizon
  avoidWeekends: boolean
  timeZone: string
}

function isHorizon(value: unknown): value is PostReadyHorizon {
  return typeof value === 'string' && (POST_READY_HORIZONS as readonly string[]).includes(value)
}

export async function resolveCalendarHorizon(workspaceId: string, now: Date = new Date()): Promise<CalendarHorizon> {
  const overrides = await listSkillOverrides(workspaceId)
  const resolve = (skillId: string): Record<string, string | number | boolean> => {
    const skill = SKILL_BY_ID[skillId]
    return skill ? resolveConfig(skill, overrides.get(skillId)?.config, undefined) : {}
  }
  const rank = resolve('calendar.rank.select')
  const slot = resolve('calendar.slot.optimize')
  const horizon: PostReadyHorizon = isHorizon(rank.postReadyHorizon) ? rank.postReadyHorizon : 'today-and-tomorrow'
  const avoidWeekends = slot.avoidWeekends !== false
  const timeZone = config.core.tz
  return {
    today: localIsoDate(now, timeZone),
    postReadyDates: postReadyDates({ now, timeZone, horizon, avoidWeekends }),
    horizon,
    avoidWeekends,
    timeZone,
  }
}

/** True when a topic dated `iso` is written now rather than held in the Topic Queue. */
export function isWithinPostReady(iso: string, h: CalendarHorizon): boolean {
  return h.postReadyDates.includes(String(iso).slice(0, 10))
}

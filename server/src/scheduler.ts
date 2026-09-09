/**
 * THE SCHEDULER
 *
 * node-cron, and every scheduled job is also manually triggerable through a
 * route — nothing in this product happens only on a timer.
 *
 * Jobs go through the same orchestrator and the same command plane as an operator
 * action. The only difference is the `trigger` label on the row.
 */

import cron, { type ScheduledTask } from 'node-cron'

import { config } from './config'
import { publishNotices, composeBrief, sweepForNotices } from './assistant/watch'
import { buildKnowledge } from './orchestrator'
import { currentWorkspaceId } from './db/repo'
import { publishActivity } from './events'

export interface RegisteredJob {
  id: string
  description: string
  schedule: string
  timezone: string
  task: ScheduledTask | null
  /** Every job can be fired by hand. */
  runNow: () => Promise<void>
}

const jobs: RegisteredJob[] = []

/* ═══════════════════════════════════════════════════════════════════════════
   JOBS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Sunday 06:00 in TZ — the research build. */
async function runKnowledgeBuild(): Promise<void> {
  const workspaceId = await currentWorkspaceId()
  await buildKnowledge({ workspaceId, trigger: 'cron', hashtagCount: config.knowledge.hashtagCount })
}

/** Weekday 09:00 — the proactive briefing. */
async function runBriefing(): Promise<void> {
  const workspaceId = await currentWorkspaceId()
  const brief = await composeBrief(workspaceId, {
    trigger: 'cron',
    role: 'marketing',
    changesToReport: 3,
    includeRecommendation: true,
  })
  publishActivity('assistant', brief.narration, 'ok', { briefId: brief.id })
}

/** The ambient sweep. Notices are never modal; they land in the rail. */
async function runWatch(): Promise<void> {
  const workspaceId = await currentWorkspaceId()
  const notices = await sweepForNotices(workspaceId)
  publishNotices(notices)
}

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRATION
   ═══════════════════════════════════════════════════════════════════════════ */

function guard(id: string, fn: () => Promise<void>): () => Promise<void> {
  return async () => {
    try {
      await fn()
    } catch (error) {
      // A failing job must never take the process down.
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[scheduler] ${id} failed — ${message}`)
      publishActivity('assistant', `Scheduled job ${id} failed — ${message}`, 'error')
    }
  }
}

export function startScheduler(): RegisteredJob[] {
  const timezone = config.core.tz

  register({
    id: 'knowledge.build',
    description: 'Research the top hashtags and write cited Knowledge Base entries',
    schedule: config.knowledge.buildCron,
    timezone,
    fn: runKnowledgeBuild,
  })

  register({
    id: 'assistant.brief',
    description: 'The proactive briefing: three changes and one recommendation',
    schedule: config.assistant.briefCron,
    timezone,
    fn: runBriefing,
  })

  // The ambient sweep runs on an interval rather than a cron expression, because
  // it is measured in seconds.
  const interval = Math.max(10_000, config.assistant.watchIntervalMs)
  const watcher = setInterval(guard('assistant.watch', runWatch), interval)
  watcher.unref()
  jobs.push({
    id: 'assistant.watch',
    description: `The ambient anomaly sweep, every ${Math.round(interval / 1000)}s`,
    schedule: `every ${Math.round(interval / 1000)}s`,
    timezone,
    task: null,
    runNow: guard('assistant.watch', runWatch),
  })

  return jobs
}

function register(spec: {
  id: string
  description: string
  schedule: string
  timezone: string
  fn: () => Promise<void>
}): void {
  const runNow = guard(spec.id, spec.fn)

  if (!cron.validate(spec.schedule)) {
    // A bad expression is named and skipped rather than crashing the boot; the
    // job stays manually triggerable.
    console.warn(
      `[scheduler] ${spec.id} has an invalid cron expression “${spec.schedule}” — it will not run on a timer, but it is still triggerable by hand.`,
    )
    jobs.push({ ...spec, task: null, runNow })
    return
  }

  const task = cron.schedule(spec.schedule, runNow, { timezone: spec.timezone })
  jobs.push({ ...spec, task, runNow })
}

export function scheduledJobs(): Array<{
  id: string
  description: string
  schedule: string
  timezone: string
}> {
  return jobs.map(({ id, description, schedule, timezone }) => ({
    id,
    description,
    schedule,
    timezone,
  }))
}

export async function triggerJob(id: string): Promise<boolean> {
  const job = jobs.find((j) => j.id === id)
  if (!job) return false
  await job.runNow()
  return true
}

export function stopScheduler(): void {
  for (const job of jobs) job.task?.stop()
  jobs.length = 0
}

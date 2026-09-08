/**
 * AMBIENT AWARENESS — the sweep, and the morning briefing.
 *
 * JARVIS says something unprompted only when it has something worth saying. Six
 * signals, each with its own threshold knob and its own sentence naming the
 * evidence. Notices are never modal.
 */

import { PLATFORMS, type Platform } from '../../../shared/agent-contract'
import { addressOperator } from '../../../shared/jarvis-persona'
import { enforceJarvisVoice } from '../../../shared/jarvis-persona'
import { config } from '../config'
import { publish } from '../events'
import {
  latestKnowledgeBuild,
  latestPipelineRun,
  listIdeas,
  listPlatformAnalytics,
  listPosts,
  listReviewQueue,
  postBaseline,
} from '../db/repo'
import { insertBrief, latestBrief, type JarvisBriefRow } from '../db/jarvis-repo'
import { mean, monthLabelOf, PLATFORM_LABEL, stdev, startOfWeek, addDays, isoDate } from '../agents/corpus'

/* ═══════════════════════════════════════════════════════════════════════════
   SIGNALS
   ═══════════════════════════════════════════════════════════════════════════ */

export type NoticeSeverity = 'info' | 'warn' | 'serious'

export interface AmbientNotice {
  id: string
  signal:
    | 'review-queue-age'
    | 'leadership-age'
    | 'metric-anomaly'
    | 'pipeline-failure'
    | 'knowledge-conflict'
    | 'calendar-gap'
  severity: NoticeSeverity
  message: string
  /** A one-click action: the utterance JARVIS would run. */
  action?: { label: string; utterance: string }
  data: Record<string, unknown>
}

export interface WatchThresholds {
  anomalySigma: number
  queueAgeMinutes: number
  approvalAgeHours: number
  minPerWeek: number
}

export const DEFAULT_THRESHOLDS: WatchThresholds = {
  anomalySigma: 1.5,
  queueAgeMinutes: 30,
  approvalAgeHours: 6,
  minPerWeek: 3,
}

export async function sweepForNotices(
  workspaceId: string,
  thresholds: WatchThresholds = DEFAULT_THRESHOLDS,
): Promise<AmbientNotice[]> {
  const notices: AmbientNotice[] = []

  /* ── 1 · Items waiting on a verdict ────────────────────────────────────── */
  const queue = await listReviewQueue(workspaceId, false)
  if (queue.length > 0) {
    const oldest = queue.reduce((o, q) =>
      new Date(q.created_at).getTime() < new Date(o.created_at).getTime() ? q : o,
    )
    const ageMinutes = Math.round((Date.now() - new Date(oldest.created_at).getTime()) / 60_000)
    if (ageMinutes >= thresholds.queueAgeMinutes) {
      notices.push({
        id: `queue-${oldest.id}`,
        signal: 'review-queue-age',
        severity: 'serious',
        message: `${queue.length} item${queue.length === 1 ? ' has' : 's have'} been waiting on a verdict for ${describeAge(ageMinutes)}. I can walk you through them.`,
        action: { label: 'Walk me through them', utterance: 'show me everything waiting on me' },
        data: { count: queue.length, oldestId: oldest.id, ageMinutes },
      })
    }
  }

  /* ── 2 · Posts awaiting Leadership ─────────────────────────────────────── */
  const pending = await listIdeas(workspaceId, { status: 'pending_leadership', limit: 40 })
  if (pending.length > 0) {
    const oldest = pending.reduce((o, i) => {
      const a = new Date(i.marketing_approved_at ?? i.updated_at).getTime()
      const b = new Date(o.marketing_approved_at ?? o.updated_at).getTime()
      return a < b ? i : o
    })
    const ageHours =
      (Date.now() - new Date(oldest.marketing_approved_at ?? oldest.updated_at).getTime()) / 3_600_000

    if (ageHours >= thresholds.approvalAgeHours) {
      notices.push({
        id: `leadership-${oldest.id}`,
        signal: 'leadership-age',
        severity: 'warn',
        message: `${pending.length} post${pending.length === 1 ? ' has' : 's have'} been with Leadership since ${ageHours >= 24 ? 'yesterday' : `${Math.round(ageHours)} hours ago`}.`,
        action: { label: 'Show me', utterance: 'show me everything waiting on me' },
        data: { count: pending.length, ageHours: Math.round(ageHours) },
      })
    }
  }

  /* ── 3 · A metric outside its own trailing band ────────────────────────── */
  for (const platform of PLATFORMS) {
    const anomaly = await detectMetricAnomaly(workspaceId, platform, thresholds.anomalySigma)
    if (anomaly) notices.push(anomaly)
  }

  /* ── 4 · A failed pipeline run ─────────────────────────────────────────── */
  const run = await latestPipelineRun(workspaceId)
  if (run?.status === 'failed') {
    const error = typeof run.summary.error === 'string' ? run.summary.error : 'no reason was recorded'
    notices.push({
      id: `pipeline-${run.id}`,
      signal: 'pipeline-failure',
      severity: 'serious',
      message: `The last discovery run failed — ${error}. Everything it had already written stands.`,
      action: { label: 'Explain the run', utterance: 'explain the last run' },
      data: { runId: run.id, error },
    })
  }

  /* ── 5 · An escalated knowledge conflict ───────────────────────────────── */
  const conflicts = queue.filter((q) => q.kind === 'knowledge_conflict')
  if (conflicts.length > 0) {
    const first = conflicts[0] as (typeof conflicts)[number]
    notices.push({
      id: `conflict-${first.id}`,
      signal: 'knowledge-conflict',
      severity: 'warn',
      message: `${conflicts.length === 1 ? 'Two research entries disagree on a figure' : `${conflicts.length} pairs of research entries disagree on a figure`}. I have held both — neither is cited more strongly than the other.`,
      action: { label: 'Show the conflict', utterance: 'what is waiting on me' },
      data: { count: conflicts.length, queueId: first.id },
    })
  }

  /* ── 6 · A calendar gap ────────────────────────────────────────────────── */
  const weekStart = startOfWeek(new Date())
  const weekStartIso = isoDate(weekStart)
  const weekEndIso = isoDate(addDays(weekStart, 7))
  const ideas = await listIdeas(workspaceId, { limit: 200 })
  const thisWeek = ideas.filter(
    (i) => i.calendar_slot === 'primary' && i.scheduled_date >= weekStartIso && i.scheduled_date < weekEndIso,
  )

  for (const platform of PLATFORMS) {
    const count = thisWeek.filter((i) => i.platform === platform).length
    if (count < thresholds.minPerWeek) {
      notices.push({
        id: `gap-${platform}`,
        signal: 'calendar-gap',
        severity: 'info',
        message: `${PLATFORM_LABEL[platform]} has ${count} post${count === 1 ? '' : 's'} this week against a target of ${thresholds.minPerWeek}.`,
        action: {
          label: 'Promote a suggestion',
          utterance: `show me the ${platform} suggestions`,
        },
        data: { platform, count, target: thresholds.minPerWeek },
      })
    }
  }

  return notices
}

async function detectMetricAnomaly(
  workspaceId: string,
  platform: Platform,
  sigma: number,
): Promise<AmbientNotice | null> {
  const rows = (await listPlatformAnalytics(workspaceId, { platform }))
    .filter((r) => r.is_reported)
    .sort((a, b) => a.month.localeCompare(b.month))

  if (rows.length < 3) return null

  const key = platform === 'instagram' ? 'views' : 'impressions'
  const series = rows
    .map((r) => Number(r.metrics[key] ?? 0))
    .filter((v) => v > 0)

  if (series.length < 3) return null

  const current = series[series.length - 1] as number
  const trailing = series.slice(0, -1)
  const avg = mean(trailing)
  const sd = stdev(trailing)

  if (sd === 0 || avg === 0) return null

  const z = (current - avg) / sd
  if (Math.abs(z) < sigma) return null

  const deltaPct = Math.round(((current - avg) / avg) * 100)
  const latest = rows[rows.length - 1] as (typeof rows)[number]

  // Name where the movement is concentrated, not merely that it moved.
  const nonFollower = Number(latest.metrics.nonFollowerShare ?? latest.metrics.non_follower_share ?? 0)
  const detail =
    nonFollower > 0
      ? ` The movement is concentrated in non-follower views, which sit at ${nonFollower}%.`
      : ''

  return {
    id: `anomaly-${platform}-${latest.month}`,
    signal: 'metric-anomaly',
    severity: deltaPct < 0 ? 'serious' : 'info',
    message:
      `${PLATFORM_LABEL[platform]} ${key} ${deltaPct < 0 ? 'is' : 'is'} ${Math.abs(deltaPct)}% ${deltaPct < 0 ? 'below' : 'above'} its ` +
      `${trailing.length}-period average in ${monthLabelOf(latest.month)} — ${Math.abs(z).toFixed(1)}σ outside the band.${detail}`,
    action: {
      label: 'Explain it',
      utterance: `why did ${platform} ${deltaPct < 0 ? 'drop' : 'rise'} last month`,
    },
    data: { platform, month: latest.month, metric: key, current, average: Math.round(avg), deltaPct, sigma: z },
  }
}

function describeAge(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`
  const hours = Math.round(minutes / 60)
  if (hours === 1) return 'an hour'
  if (hours < 24) return `${hours} hours`
  const days = Math.round(hours / 24)
  return days === 1 ? 'a day' : `${days} days`
}

/** Emits notices onto the bus. The UI raises the core to `attention`. */
export function publishNotices(notices: AmbientNotice[]): void {
  for (const notice of notices) {
    publish({
      type: 'jarvis.notice',
      message: notice.message,
      data: notice as unknown as Record<string, unknown>,
    })
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BRIEFING — time, three changes, one recommendation
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Brief {
  id: string
  at: string
  trigger: 'cron' | 'manual'
  signals: Array<{ label: string; detail: string; severity: string }>
  recommendation: string
  narration: string
}

export async function composeBrief(
  workspaceId: string,
  opts: {
    trigger: 'cron' | 'manual'
    role: 'marketing' | 'leadership'
    changesToReport: number
    includeRecommendation: boolean
    thresholds?: WatchThresholds
  },
): Promise<Brief> {
  const notices = await sweepForNotices(workspaceId, opts.thresholds ?? DEFAULT_THRESHOLDS)
  const build = await latestKnowledgeBuild(workspaceId)
  const posts = await listPosts(workspaceId, { limit: 10 })
  const pending = await listIdeas(workspaceId, { status: 'pending_leadership', limit: 40 })

  const changes: Array<{ label: string; detail: string; severity: string }> = []

  if (pending.length > 0) {
    changes.push({
      label: `${pending.length} post${pending.length === 1 ? '' : 's'} await Leadership`,
      detail: pending.map((p) => p.title).slice(0, 3).join('; '),
      severity: 'warn',
    })
  }

  if (build && build.entries_written > 0) {
    changes.push({
      label: `The research build added ${build.entries_written} cited entr${build.entries_written === 1 ? 'y' : 'ies'}`,
      detail: `${build.hashtags_researched} hashtags researched, ${build.sources_cited} sources cited, ${build.research_source === 'fixture' ? 'from the bundled fixtures' : 'from the live web'}`,
      severity: 'info',
    })
  }

  // The strongest ambient signal earns the third slot.
  const ranked = [...notices].sort((a, b) => severityRank(b.severity) - severityRank(a.severity))
  for (const notice of ranked) {
    if (changes.length >= opts.changesToReport) break
    if (changes.some((c) => c.label.includes('await Leadership') && notice.signal === 'leadership-age')) continue
    changes.push({ label: notice.message, detail: notice.action?.label ?? '', severity: notice.severity })
  }

  if (changes.length === 0 && posts.length > 0) {
    const latest = posts[0] as (typeof posts)[number]
    changes.push({
      label: 'Nothing is blocked',
      detail: `The most recent post, “${latest.title}”, is at ${latest.reach ?? 0} reach.`,
      severity: 'info',
    })
  }

  const recommendation = opts.includeRecommendation
    ? await recommend(workspaceId, notices)
    : ''

  const time = new Date().toTimeString().slice(0, 5)
  const address = addressOperator(opts.role, config.jarvis.addressStyle)

  const narration = enforceJarvisVoice(
    [
      `${time}. ${changes.length === 0 ? `Nothing has changed, ${address}.` : ''}`,
      changes
        .slice(0, opts.changesToReport)
        .map((c) => c.label)
        .join(', ') + (changes.length > 0 ? '.' : ''),
      recommendation,
    ]
      .filter((s) => s.trim().length > 0)
      .join(' '),
  )

  const row = await insertBrief({
    workspaceId,
    trigger: opts.trigger,
    signals: changes,
    recommendation,
    narration,
  })

  return {
    id: row?.id ?? `brief-${Date.now()}`,
    at: row?.created_at ?? new Date().toISOString(),
    trigger: opts.trigger,
    signals: changes,
    recommendation,
    narration,
  }
}

function severityRank(severity: string): number {
  return severity === 'serious' ? 3 : severity === 'warn' ? 2 : 1
}

/** One recommendation, actionable in a single click through the confirm gate. */
async function recommend(workspaceId: string, notices: AmbientNotice[]): Promise<string> {
  const gap = notices.find((n) => n.signal === 'calendar-gap')
  if (gap) {
    const platform = String(gap.data.platform)
    return `I would promote a ${PLATFORM_LABEL[platform as Platform]} suggestion to close the gap.`
  }

  const anomaly = notices.find((n) => n.signal === 'metric-anomaly')
  if (anomaly) {
    const platform = String(anomaly.data.platform)
    return `I would look at why ${PLATFORM_LABEL[platform as Platform]} moved before scheduling anything new there.`
  }

  const queue = notices.find((n) => n.signal === 'review-queue-age')
  if (queue) {
    return 'I would clear the review queue first — the Analysis Agent is holding for those verdicts.'
  }

  const ideas = await listIdeas(workspaceId, { status: 'suggested', limit: 5 })
  const strongest = ideas.sort((a, b) => b.priority_score - a.priority_score)[0]
  if (strongest) {
    return `I would draft “${strongest.title}” next — it is the strongest unwritten idea at ${strongest.priority_score}.`
  }

  const baseline = await postBaseline(workspaceId, 'linkedin', 8)
  return baseline.samples > 0
    ? `I would keep the current cadence; LinkedIn is holding at ${Math.round(baseline.avgReach)} average reach.`
    : 'I would run discovery to refresh the calendar.'
}

export async function lastBrief(workspaceId: string): Promise<JarvisBriefRow | null> {
  return latestBrief(workspaceId)
}

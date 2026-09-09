/**
 * PERCEIVE — the situational snapshot.
 *
 * Ethara knows the state of everything without being asked, and this is where
 * that knowledge comes from. One assembly per command, capped in size, so the
 * intent parser and the narrator are both reasoning about the same picture.
 */

import type { OperatorRole, Platform } from '../../../shared/agent-contract'
import { PLATFORMS } from '../../../shared/agent-contract'
import { AGENTS } from '../../../shared/agent-registry'
import { config } from '../config'
import {
  latestKnowledgeBuild,
  latestPipelineRun,
  listActivity,
  listAgentState,
  listIdeas,
  listKeywords,
  listKnowledge,
  listPosts,
  listReviewQueue,
  trendingKeywords,
  listHashtags,
} from '../db/repo'
import { latestBrief, lastReferencedEntity, listTurns } from '../db/assistant-repo'
import { integrationReport } from '../integrations'
import { PLATFORM_LABEL, startOfWeek, addDays, isoDate } from '../agents/corpus'

/* ═══════════════════════════════════════════════════════════════════════════
   THE SNAPSHOT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SnapshotCounts {
  keywords: number
  activeKeywords: number
  trendingKeywords: number
  hashtags: number
  topHashtags: number
  reviewQueue: number
  pendingLeadership: number
  scheduledThisWeek: number
  published: number
  knowledgeEntries: number
  activeKnowledge: number
  agentsOnline: number
  agentsFailed: number
}

export interface SnapshotIdea {
  id: string
  title: string
  platform: Platform
  status: string
  date: string
  time: string
  slot: string
  rank: number | null
}

export interface SnapshotTurn {
  speaker: 'operator' | 'assistant'
  utterance: string
  narration: string | null
}

export interface SituationSnapshot {
  workspaceId: string
  operator: { name: string; role: OperatorRole }
  at: string
  counts: SnapshotCounts
  pipeline: {
    status: string
    trigger: string | null
    startedAt: string | null
    finishedAt: string | null
    summary: Record<string, unknown>
  }
  agents: Array<{ id: string; name: string; status: string; task: string; lastRun: string | null }>
  trending: Array<{ term: string; score: number; rank: number; reason: string }>
  topHashtags: Array<{ tag: string; rank: number; score: number }>
  thisWeek: SnapshotIdea[]
  awaitingLeadership: SnapshotIdea[]
  reviewQueue: Array<{ id: string; title: string; reason: string; decision: string; options: string[]; ageMinutes: number }>
  knowledge: { total: number; active: number; lastBuild: string | null; lastBuildSource: string | null; entriesWritten: number }
  knowledgeHighlights: Array<{ title: string; confidence: string; category: string }>
  recentActivity: Array<{ agentId: string | null; message: string; status: string; at: string }>
  platformThisWeek: Array<{ platform: Platform; count: number }>
  history: SnapshotTurn[]
  lastEntity: Record<string, unknown> | null
  brief: { at: string; recommendation: string | null } | null
  mode: {
    publishMode: 'demo' | 'live'
    assistantProvider: string
    integrations: Array<{ id: string; label: string; configured: boolean; reason: string }>
  }
  /** A compact text rendering for the model prompt, clamped to the knob. */
  text: string
}

export interface AssembleOptions {
  workspaceId: string
  operator: { name: string; role: OperatorRole }
  conversationId?: string
  historyTurns: number
  includeKnowledge: boolean
  maxSnapshotChars: number
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSEMBLY
   ═══════════════════════════════════════════════════════════════════════════ */

export async function assembleSnapshot(opts: AssembleOptions): Promise<SituationSnapshot> {
  const { workspaceId } = opts

  const weekStart = startOfWeek(new Date())
  const weekEnd = addDays(weekStart, 7)
  const weekStartIso = isoDate(weekStart)
  const weekEndIso = isoDate(weekEnd)

  const [
    keywords,
    trending,
    hashtags,
    topHashtags,
    ideas,
    posts,
    knowledge,
    build,
    agentStates,
    activity,
    queue,
    run,
    brief,
  ] = await Promise.all([
    listKeywords(workspaceId, false),
    trendingKeywords(workspaceId, 5),
    listHashtags(workspaceId, { limit: 400 }),
    listHashtags(workspaceId, { top: true, limit: 25 }),
    listIdeas(workspaceId, { limit: 200 }),
    listPosts(workspaceId, { limit: 60 }),
    opts.includeKnowledge ? listKnowledge(workspaceId, { activeOnly: false, limit: 400 }) : Promise.resolve([]),
    latestKnowledgeBuild(workspaceId),
    listAgentState(workspaceId),
    listActivity(workspaceId, 10),
    listReviewQueue(workspaceId, false),
    latestPipelineRun(workspaceId),
    latestBrief(workspaceId),
  ])

  const history: SnapshotTurn[] = []
  let lastEntity: Record<string, unknown> | null = null
  if (opts.conversationId) {
    const turns = await listTurns(opts.conversationId, Math.max(2, opts.historyTurns))
    for (const turn of turns.slice(-opts.historyTurns)) {
      history.push({
        speaker: turn.speaker,
        utterance: turn.utterance ?? '',
        narration: turn.narration,
      })
    }
    lastEntity = await lastReferencedEntity(opts.conversationId)
  }

  const thisWeek = ideas
    .filter((i) => i.scheduled_date >= weekStartIso && i.scheduled_date < weekEndIso)
    .map(toSnapshotIdea)
    .sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time))

  const awaitingLeadership = ideas
    .filter((i) => i.status === 'pending_leadership')
    .map(toSnapshotIdea)

  const activeKnowledge = knowledge.filter((k) => k.active)
  const failedAgents = agentStates.filter((a) => a.status === 'failed')

  const counts: SnapshotCounts = {
    keywords: keywords.length,
    activeKeywords: keywords.filter((k) => k.active).length,
    trendingKeywords: trending.length,
    hashtags: hashtags.length,
    topHashtags: topHashtags.length,
    reviewQueue: queue.length,
    pendingLeadership: awaitingLeadership.length,
    scheduledThisWeek: thisWeek.filter((i) => i.slot === 'primary').length,
    published: posts.length,
    knowledgeEntries: knowledge.length,
    activeKnowledge: activeKnowledge.length,
    agentsOnline: AGENTS.length,
    agentsFailed: failedAgents.length,
  }

  const integrations = integrationReport().adapters

  const snapshot: SituationSnapshot = {
    workspaceId,
    operator: opts.operator,
    at: new Date().toISOString(),
    counts,
    pipeline: {
      status: run?.status ?? 'idle',
      trigger: run?.trigger ?? null,
      startedAt: run?.started_at ?? null,
      finishedAt: run?.finished_at ?? null,
      summary: run?.summary ?? {},
    },
    agents: agentStates.map((a) => ({
      id: a.agent_id,
      name: AGENTS.find((spec) => spec.id === a.agent_id)?.name ?? a.agent_id,
      status: a.status,
      task: a.current_task,
      lastRun: a.last_run,
    })),
    trending: trending.map((t) => ({
      term: t.term,
      score: t.trend_score,
      rank: t.rank ?? 0,
      reason: t.trend_reason ?? '',
    })),
    topHashtags: topHashtags.map((h) => ({
      tag: h.display_tag,
      rank: h.rank ?? 0,
      score: h.hashtag_score,
    })),
    thisWeek,
    awaitingLeadership,
    reviewQueue: queue.map((q) => ({
      id: q.id,
      title: q.entity_title ?? q.kind,
      reason: q.reason,
      decision: q.decision_requested,
      options: q.options,
      ageMinutes: Math.round((Date.now() - new Date(q.created_at).getTime()) / 60_000),
    })),
    knowledge: {
      total: knowledge.length,
      active: activeKnowledge.length,
      lastBuild: build?.finished_at ?? build?.started_at ?? null,
      lastBuildSource: build?.research_source ?? null,
      entriesWritten: build?.entries_written ?? 0,
    },
    knowledgeHighlights: activeKnowledge
      .filter((k) => k.origin === 'research' || k.origin === 'learned')
      .slice(0, 6)
      .map((k) => ({ title: k.title, confidence: k.confidence, category: k.category })),
    recentActivity: activity.map((a) => ({
      agentId: a.agent_id,
      message: a.message,
      status: a.status,
      at: a.created_at,
    })),
    platformThisWeek: PLATFORMS.map((platform) => ({
      platform,
      count: thisWeek.filter((i) => i.platform === platform && i.slot === 'primary').length,
    })),
    history,
    lastEntity,
    brief: brief ? { at: brief.created_at, recommendation: brief.recommendation } : null,
    mode: {
      publishMode: config.core.publishMode,
      assistantProvider: config.assistant.provider,
      integrations: integrations.map((a) => ({
        id: a.id,
        label: a.label,
        configured: a.configured,
        reason: a.reason,
      })),
    },
    text: '',
  }

  snapshot.text = renderSnapshotText(snapshot, opts.maxSnapshotChars)
  return snapshot
}

function toSnapshotIdea(i: {
  id: string
  title: string
  platform: Platform
  status: string
  scheduled_date: string
  scheduled_time: string
  calendar_slot: string
  platform_rank: number | null
}): SnapshotIdea {
  return {
    id: i.id,
    title: i.title,
    platform: i.platform,
    status: i.status,
    date: i.scheduled_date,
    time: i.scheduled_time,
    slot: i.calendar_slot,
    rank: i.platform_rank,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TEXT RENDERING — what the model actually reads
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A compact rendering, ordered most useful first, so the clamp cuts the least
 * important lines rather than the most.
 */
export function renderSnapshotText(snapshot: SituationSnapshot, maxChars: number): string {
  const lines: string[] = []

  lines.push(`Operator: ${snapshot.operator.name} (${snapshot.operator.role}).`)
  lines.push(
    `Counts: ${snapshot.counts.reviewQueue} in the review queue, ${snapshot.counts.pendingLeadership} awaiting Leadership, ` +
      `${snapshot.counts.scheduledThisWeek} on the calendar this week, ${snapshot.counts.published} published, ` +
      `${snapshot.counts.activeKnowledge} active Knowledge Base entries of ${snapshot.counts.knowledgeEntries}.`,
  )
  lines.push(
    `Pipeline: ${snapshot.pipeline.status}${snapshot.pipeline.trigger ? ` (triggered by ${snapshot.pipeline.trigger})` : ''}.`,
  )
  lines.push(`Mode: publish ${snapshot.mode.publishMode}, Ethara ${snapshot.mode.assistantProvider}.`)

  if (snapshot.trending.length > 0) {
    lines.push(
      `Trending: ${snapshot.trending.map((t) => `${t.term} (${t.score})`).join(', ')}.`,
    )
  }
  if (snapshot.topHashtags.length > 0) {
    lines.push(`Top hashtags: ${snapshot.topHashtags.slice(0, 10).map((h) => `#${h.tag}`).join(' ')}.`)
  }
  if (snapshot.thisWeek.length > 0) {
    lines.push(
      'This week: ' +
        snapshot.thisWeek
          .slice(0, 12)
          .map((i) => `“${i.title}” ${PLATFORM_LABEL[i.platform]} ${i.date} ${i.time} [${i.status}]`)
          .join('; ') +
        '.',
    )
  }
  if (snapshot.awaitingLeadership.length > 0) {
    lines.push(
      `Awaiting Leadership: ${snapshot.awaitingLeadership.map((i) => `“${i.title}”`).join(', ')}.`,
    )
  }
  if (snapshot.reviewQueue.length > 0) {
    lines.push(
      `Review queue: ${snapshot.reviewQueue.slice(0, 6).map((q) => `${q.title} — ${q.decision}`).join('; ')}.`,
    )
  }
  if (snapshot.knowledgeHighlights.length > 0) {
    lines.push(
      `Recent knowledge: ${snapshot.knowledgeHighlights.map((k) => `${k.title} (${k.confidence})`).join('; ')}.`,
    )
  }
  const unconfigured = snapshot.mode.integrations.filter((i) => !i.configured)
  if (unconfigured.length > 0) {
    lines.push(`Unconfigured: ${unconfigured.map((i) => `${i.label} — ${i.reason}`).join('; ')}.`)
  }
  if (snapshot.lastEntity) {
    lines.push(`Last referenced: ${JSON.stringify(snapshot.lastEntity)}.`)
  }
  if (snapshot.history.length > 0) {
    lines.push(
      'Recent turns: ' +
        snapshot.history
          .map((t) => `${t.speaker}: ${(t.speaker === 'operator' ? t.utterance : t.narration ?? '').slice(0, 140)}`)
          .join(' | '),
    )
  }

  let text = ''
  for (const line of lines) {
    if (text.length + line.length + 1 > maxChars) break
    text += `${line}\n`
  }
  return text.trimEnd()
}

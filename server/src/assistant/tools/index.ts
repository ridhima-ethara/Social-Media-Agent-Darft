/**
 * THE TOOL SURFACE
 *
 * Ethara acts ONLY through these handlers. There is no path from an utterance to
 * the database that does not pass through this table, and `auditToolCoverage()`
 * refuses to boot if a declared tool has no handler here.
 *
 * Every handler validates its arguments with the tool's own zod schema before it
 * runs, returns a plain-language `summary` naming the evidence, and returns the
 * structured `data` the rail renders.
 */

import type { CalendarSlot, IdeaStatus, Platform } from '../../../../shared/agent-contract'
import { TOOLS, TOOL_BY_ID, type ToolSpec } from '../../../../shared/tool-registry'
import {
  checkBrandCompliance,
  BRAND_RULES,
} from '../../../../shared/brand-voice'
import { AGENTS, AGENT_BY_ID, SKILL_BY_ID, defaultSkillConfig } from '../../../../shared/agent-registry'
import { config } from '../../config'
import { PLATFORM_LABEL, monthLabelOf } from '../../agents/corpus'
import { detectDay, detectMonth, detectTime } from '../intent'
import { availableImageModels } from '../../agents/image/image-models/index'
import { retrieveKnowledge } from '../../agents/knowledge/handlers'
import { rememberDirective } from '../../agents/brain-bridge'
import {
  applyInstruction,
  approveMarketing,
  buildKnowledge,
  decideLeadership,
  generateDraft,
  publishIdea,
  renderIdeaImage,
  runDiscoveryPipeline,
  type Trigger,
} from '../../orchestrator'
import {
  createKeyword,
  findHashtagByTag,
  findIdeasByTitle,
  getDraft,
  getIdea,
  getMediaAsset,
  insertActivity,
  insertKnowledgeEntry,
  latestPipelineRun,
  listAgentRuns,
  listAgentState,
  listHashtags,
  listIdeas,
  listKeywords,
  listPlatformAnalytics,
  listPosts,
  listReviewQueue,
  primaryIdeasForPlatform,
  resolveQueueForEntity,
  resolveReviewQueueRow,
  setHashtagValidation,
  setKnowledgeActive,
  skillRunsForRun,
  traceLineage,
  trendingKeywords,
  updateIdea,
  updateKeyword,
  upsertSkillOverride,
} from '../../db/repo'
import { assembleSnapshot } from '../context'

/* ═══════════════════════════════════════════════════════════════════════════
   THE HANDLER CONTRACT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ToolContext {
  workspaceId: string
  actor: string
  role: 'marketing' | 'leadership'
  trigger: Trigger
  turnId: string | null
  /** Results of the earlier steps in this plan, keyed by tool id. */
  prior: Map<string, ToolResult>
}

export interface ToolResult {
  /** One sentence naming the outcome and the number it rests on. */
  summary: string
  /** The structured payload the rail renders. */
  data: Record<string, unknown>
  /** How the rail should render it. */
  render?: 'table' | 'kpi' | 'draft' | 'chart' | 'lineage' | 'text' | 'preview'
  /** Present when this ran on a fixture rather than a live service. */
  fallbackReason?: string
  /** What "it" means on the next turn. */
  entity?: Record<string, unknown>
  /** A postcondition the verifier checks, described in plain language. */
  postcondition?: { description: string; satisfied: boolean }
}

export type ToolHandler = (args: Record<string, unknown>, ctx: ToolContext) => Promise<ToolResult>

const HANDLERS = new Map<string, ToolHandler>()

function tool(id: string, handler: ToolHandler): void {
  if (!TOOL_BY_ID[id]) {
    throw new Error(`tool('${id}') — not declared in shared/tool-registry.ts. Law 1.`)
  }
  HANDLERS.set(id, handler)
}

export function toolHandler(id: string): ToolHandler | undefined {
  return HANDLERS.get(id)
}

export function registeredToolIds(): string[] {
  return [...HANDLERS.keys()].sort()
}

/** Boot audit: a declared tool with no handler would fail at dispatch time. */
export function auditToolCoverage(): { total: number; missing: string[] } {
  const missing = TOOLS.filter((t) => !HANDLERS.has(t.id)).map((t) => t.id)
  if (missing.length > 0) {
    throw new Error(
      `Tool coverage audit failed — ${missing.length} declared tool(s) have no handler:\n` +
        missing.map((id) => `  · ${id}`).join('\n') +
        `\n\nRegister them in server/src/assistant/tools/index.ts.`,
    )
  }
  return { total: TOOLS.length, missing }
}

/** Validates arguments against the tool's declared schema. Never skipped. */
export function validateArgs(spec: ToolSpec, args: unknown): Record<string, unknown> {
  const parsed = spec.args.safeParse(args ?? {})
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    const path = first?.path.join('.') ?? 'argument'
    throw new Error(`${spec.name}: ${path} — ${first?.message ?? 'invalid argument'}`)
  }
  return (parsed.data ?? {}) as Record<string, unknown>
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHARED RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Resolves the subject of a command: an id, a fuzzy title, or a day. */
async function resolveIdea(
  args: Record<string, unknown>,
  ctx: ToolContext,
): Promise<{ id: string; title: string; platform: Platform; status: string }> {
  if (typeof args.id === 'string') {
    const idea = await getIdea(ctx.workspaceId, args.id)
    if (idea) return { id: idea.id, title: idea.title, platform: idea.platform, status: idea.status }
  }

  if (typeof args.title === 'string' && args.title.trim().length > 0) {
    const matches = await findIdeasByTitle(ctx.workspaceId, args.title, 5)
    const first = matches[0]
    if (first) return { id: first.id, title: first.title, platform: first.platform, status: first.status }
  }

  if (typeof args.day === 'string') {
    const { date, unreadable } = resolveDay(args.day)
    if (unreadable) throw unreadableDay(unreadable)
    const onDay = await listIdeas(ctx.workspaceId, { date, limit: 20 })
    const wanted = typeof args.platform === 'string' ? (args.platform as Platform) : undefined
    const filtered = wanted ? onDay.filter((i) => i.platform === wanted) : onDay
    const chosen = filtered.find((i) => i.calendar_slot === 'primary') ?? filtered[0]
    if (chosen) {
      return { id: chosen.id, title: chosen.title, platform: chosen.platform, status: chosen.status }
    }
  }

  // A prior read in this same plan already found it.
  const prior = ctx.prior.get('idea.list')
  const candidates = prior?.data.ideas
  if (Array.isArray(candidates) && candidates.length > 0) {
    const first = candidates[0] as { id?: string; title?: string; platform?: string; status?: string }
    if (typeof first.id === 'string') {
      return {
        id: first.id,
        title: first.title ?? 'that post',
        platform: (first.platform as Platform) ?? 'linkedin',
        status: first.status ?? 'suggested',
      }
    }
  }

  throw new Error(
    'I could not work out which post you mean. Name it, or give me the day and the platform.',
  )
}

function fmt(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(Math.round(n))
}

/* ═══════════════════════════════════════════════════════════════════════════
   SITUATION AND TELEMETRY
   ═══════════════════════════════════════════════════════════════════════════ */

tool('state.read', async (_args, ctx) => {
  const snapshot = await assembleSnapshot({
    workspaceId: ctx.workspaceId,
    operator: { name: ctx.actor, role: ctx.role },
    historyTurns: 0,
    includeKnowledge: true,
    maxSnapshotChars: 6000,
  })

  return {
    summary:
      `${snapshot.counts.agentsOnline} agents online. ${snapshot.counts.reviewQueue} item(s) awaiting a verdict, ` +
      `${snapshot.counts.pendingLeadership} post(s) with Leadership, ${snapshot.counts.scheduledThisWeek} on the calendar this week, ` +
      `${snapshot.counts.activeKnowledge} active Knowledge Base entries. Pipeline is ${snapshot.pipeline.status}.`,
    data: {
      counts: snapshot.counts,
      pipeline: snapshot.pipeline,
      agents: snapshot.agents,
      mode: snapshot.mode,
      platformThisWeek: snapshot.platformThisWeek,
    },
    render: 'kpi',
  }
})

tool('agent.status', async (args, ctx) => {
  const states = await listAgentState(ctx.workspaceId)
  const runs = await listAgentRuns(ctx.workspaceId, 60)

  const wanted = typeof args.agentId === 'string' ? args.agentId : null
  const rows = (wanted ? states.filter((s) => s.agent_id === wanted) : states).map((s) => {
    const own = runs.filter((r) => r.agent_id === s.agent_id)
    const failures = own.filter((r) => r.status === 'failed').length
    return {
      agentId: s.agent_id,
      name: AGENT_BY_ID[s.agent_id]?.name ?? s.agent_id,
      stage: AGENT_BY_ID[s.agent_id]?.stage ?? '',
      status: s.status,
      task: s.current_task,
      lastRun: s.last_run,
      processed: s.processed,
      successRate: s.success_rate,
      runs: own.length,
      failures,
    }
  })

  const failing = rows.filter((r) => r.status === 'failed')
  return {
    summary:
      failing.length === 0
        ? `All ${rows.length} agent(s) are healthy. ${rows.filter((r) => r.status === 'running').length} running, ${rows.filter((r) => r.status === 'needs_review').length} waiting on a human.`
        : `${failing.length} agent(s) failed: ${failing.map((f) => f.name).join(', ')}.`,
    data: { agents: rows },
    render: 'table',
  }
})

tool('pipeline.status', async (_args, ctx) => {
  const run = await latestPipelineRun(ctx.workspaceId)
  if (!run) {
    return {
      summary: 'No pipeline run on record yet. I can start one.',
      data: { status: 'idle' },
      render: 'text',
    }
  }

  const skills = await skillRunsForRun(ctx.workspaceId, run.id)
  const summary = run.summary as Record<string, unknown>

  return {
    summary:
      run.status === 'running'
        ? `The run started ${minutesAgo(run.started_at)} and is still going — ${skills.length} skill(s) executed so far.`
        : `The last run ${run.status} ${minutesAgo(run.finished_at ?? run.started_at)}: ${String(summary.trending ?? 0)} trending keywords, ${String(summary.topHashtags ?? 0)} hashtags, ${String(summary.primaryIdeas ?? 0)} ideas on the calendar.`,
    data: {
      runId: run.id,
      status: run.status,
      trigger: run.trigger,
      startedAt: run.started_at,
      finishedAt: run.finished_at,
      summary,
      skills: skills.length,
    },
    render: 'kpi',
  }
})

tool('run.explain', async (args, ctx) => {
  const runId = typeof args.runId === 'string' ? args.runId : (await latestPipelineRun(ctx.workspaceId))?.id
  if (!runId) {
    return { summary: 'There is no run on record to explain.', data: {}, render: 'text' }
  }

  const all = await skillRunsForRun(ctx.workspaceId, runId)
  const rows = typeof args.skillId === 'string' ? all.filter((r) => r.skill_id === args.skillId) : all

  if (rows.length === 0) {
    return {
      summary: `That run has no record for ${typeof args.skillId === 'string' ? args.skillId : 'any skill'}.`,
      data: { runId },
      render: 'text',
    }
  }

  const failed = rows.filter((r) => r.status === 'failed')
  const skipped = rows.filter((r) => r.status === 'skipped')

  return {
    summary:
      `${rows.length} skill execution(s) on that run — ${rows.length - failed.length - skipped.length} completed, ` +
      `${skipped.length} skipped, ${failed.length} failed. Each row carries the exact resolved config it used, ` +
      `so the run stays explainable even though the knobs have changed since.`,
    data: {
      runId,
      skills: rows.map((r) => ({
        skillId: r.skill_id,
        name: SKILL_BY_ID[r.skill_id]?.name ?? r.skill_id,
        agentId: r.agent_id,
        status: r.status,
        durationMs: r.duration_ms,
        note: r.note,
        configUsed: r.config_used,
      })),
    },
    render: 'table',
  }
})

tool('lineage.trace', async (args, ctx) => {
  const type = String(args.type)
  const id = String(args.id)
  const edges = await traceLineage(ctx.workspaceId, type, id, 8)

  const backward = edges.filter((e) => e.direction === 'backward')
  const forward = edges.filter((e) => e.direction === 'forward')

  return {
    summary:
      edges.length === 0
        ? `Nothing is linked to that ${type.replace('_', ' ')} yet.`
        : `${backward.length} step(s) back to the source and ${forward.length} forward to everything it became.`,
    data: { type, id, edges, backward, forward },
    render: 'lineage',
    entity: { id, type },
  }
})

function minutesAgo(iso: string): string {
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`
  return `${Math.round(hours / 24)} day(s) ago`
}

/* ═══════════════════════════════════════════════════════════════════════════
   PIPELINE
   ═══════════════════════════════════════════════════════════════════════════ */

tool('pipeline.run', async (args, ctx) => {
  let keywordIds = Array.isArray(args.keywordIds) ? (args.keywordIds as string[]) : undefined

  // Named keywords resolve to ids, so a scoped run is auditable.
  if (!keywordIds && Array.isArray(args.keywords)) {
    const all = await listKeywords(ctx.workspaceId, true)
    const wanted = (args.keywords as string[]).map((k) => k.toLowerCase())
    keywordIds = all.filter((k) => wanted.some((w) => k.term.toLowerCase().includes(w))).map((k) => k.id)
  }

  const result = await runDiscoveryPipeline({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    paceMs: typeof args.paceMs === 'number' ? args.paceMs : 0,
    ...(keywordIds && keywordIds.length > 0 ? { keywordIds } : {}),
  })

  if (result.status === 'failed') {
    throw new Error(result.error ?? 'The pipeline failed.')
  }

  const s = result.summary
  const lead = result.trendingKeywords[0]

  return {
    summary:
      `${s.trending} keyword${s.trending === 1 ? '' : 's'} are trending across ${s.postsScraped} posts` +
      (lead ? `. ${lead.term} leads at ${lead.trendScore}` : '') +
      `. ${s.topHashtags} hashtags are queued for research and ${s.primaryIdeas} idea(s) took a calendar slot, ` +
      `${s.suggestionIdeas} went to More suggestions` +
      (s.needsReview > 0 ? `, and ${s.needsReview} item(s) need a human verdict` : '') +
      '.',
    data: {
      pipelineRunId: result.pipelineRunId,
      summary: s,
      trendingKeywords: result.trendingKeywords,
      topHashtags: result.topHashtags,
      ideas: result.ideas,
    },
    render: 'kpi',
    // Lanes that returned nothing are named even on a successful run: a
    // platform that indexed no page for a keyword is a real finding about that
    // platform, not a hidden degradation.
    ...(s.fallbackReasons.length > 0
      ? {
          fallbackReason: `Some capture lanes returned nothing — ${s.fallbackReasons[0]}.`,
        }
      : {}),
    postcondition: {
      description: `${s.trending} trending keywords written to keyword_signals`,
      satisfied: s.trending > 0,
    },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   KEYWORDS
   ═══════════════════════════════════════════════════════════════════════════ */

tool('keyword.list', async (args, ctx) => {
  const activeOnly = args.activeOnly !== false
  const rows = await listKeywords(ctx.workspaceId, activeOnly)
  return {
    summary: `${rows.length} keyword${rows.length === 1 ? '' : 's'}${activeOnly ? ' active' : ' on record'}, ranging from weight ${Math.min(...rows.map((r) => r.weight))} to ${Math.max(...rows.map((r) => r.weight))}.`,
    data: {
      keywords: rows.map((r) => ({
        id: r.id,
        term: r.term,
        category: r.category,
        weight: r.weight,
        active: r.active,
      })),
    },
    render: 'table',
  }
})

tool('keyword.add', async (args, ctx) => {
  const term = String(args.term).trim()
  const weight = typeof args.weight === 'number' ? args.weight : 50
  const category = typeof args.category === 'string' ? args.category : 'Adjacent'

  const created = await createKeyword(ctx.workspaceId, term, category, weight)
  if (!created) {
    throw new Error(`“${term}” is already in the keyword set.`)
  }

  await insertActivity({
    workspaceId: ctx.workspaceId,
    agentId: 'scraping',
    message: `“${term}” added to the keyword set at weight ${weight} (${category})`,
    status: 'ok',
  })

  return {
    summary: `“${term}” is in the keyword set at weight ${weight}, category ${category}. It joins the next discovery run.`,
    data: { keyword: { id: created.id, term: created.term, weight: created.weight, category: created.category } },
    render: 'text',
    entity: { id: created.id, term: created.term, type: 'keyword' },
    postcondition: { description: 'Keyword row written', satisfied: true },
  }
})

tool('keyword.update', async (args, ctx) => {
  let id = typeof args.id === 'string' ? args.id : null
  if (!id && typeof args.term === 'string') {
    const all = await listKeywords(ctx.workspaceId, false)
    const match = all.find((k) => k.term.toLowerCase() === (args.term as string).toLowerCase())
    id = match?.id ?? null
  }
  if (!id) throw new Error('I could not find that keyword. Name it exactly and I will change it.')

  const patch: { weight?: number; active?: boolean; category?: string } = {}
  if (typeof args.weight === 'number') patch.weight = args.weight
  if (typeof args.active === 'boolean') patch.active = args.active
  if (typeof args.category === 'string') patch.category = args.category

  if (Object.keys(patch).length === 0) {
    throw new Error('Tell me what to change — the weight, the category, or whether it is active.')
  }

  const updated = await updateKeyword(ctx.workspaceId, id, patch)
  if (!updated) throw new Error('The keyword could not be updated.')

  const changes = Object.entries(patch).map(([k, v]) => `${k} ${String(v)}`).join(', ')
  return {
    summary: `“${updated.term}” updated: ${changes}.`,
    data: { keyword: updated },
    render: 'text',
    entity: { id: updated.id, term: updated.term, type: 'keyword' },
    postcondition: { description: 'Keyword row updated', satisfied: true },
  }
})

tool('keyword.trending', async (args, ctx) => {
  const limit = typeof args.limit === 'number' ? args.limit : 5
  const rows = await trendingKeywords(ctx.workspaceId, limit)

  if (rows.length === 0) {
    return {
      summary: 'No keyword has been ranked yet. Run discovery and I will have an answer.',
      data: { trending: [] },
      render: 'text',
    }
  }

  const lead = rows[0] as (typeof rows)[number]
  return {
    summary:
      `${rows.length} keyword${rows.length === 1 ? '' : 's'} are trending. ${lead.term} leads at ${lead.trend_score} — ` +
      `${lead.trend_reason ?? `${lead.post_count} posts, ${fmt(lead.total_engagement)} engagements`}`,
    data: {
      trending: rows.map((r) => ({
        term: r.term,
        rank: r.rank,
        trendScore: r.trend_score,
        postCount: r.post_count,
        totalEngagement: r.total_engagement,
        velocity: Number(r.velocity),
        growthPct: Number(r.growth_pct),
        reason: r.trend_reason,
        searchUrl: r.search_url,
        topPostUrl: r.top_post_url,
        topPostTitle: r.top_post_title,
      })),
    },
    render: 'table',
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   HASHTAGS
   ═══════════════════════════════════════════════════════════════════════════ */

tool('hashtag.list', async (args, ctx) => {
  const rows = await listHashtags(ctx.workspaceId, {
    ...(typeof args.status === 'string' ? { status: args.status as 'validated' } : {}),
    limit: typeof args.limit === 'number' ? args.limit : 60,
  })

  const filtered =
    typeof args.keyword === 'string'
      ? rows.filter((r) => (r.keyword_term ?? '').toLowerCase().includes((args.keyword as string).toLowerCase()))
      : rows

  const counts = {
    validated: filtered.filter((r) => r.validation === 'validated').length,
    needsReview: filtered.filter((r) => r.validation === 'needs_review').length,
    duplicate: filtered.filter((r) => r.validation === 'duplicate').length,
    rejected: filtered.filter((r) => r.validation === 'rejected').length,
  }

  return {
    summary: `${filtered.length} hashtag${filtered.length === 1 ? '' : 's'} — ${counts.validated} validated, ${counts.needsReview} awaiting a verdict, ${counts.duplicate} linked as duplicates, ${counts.rejected} rejected.`,
    data: {
      hashtags: filtered.map((r) => ({
        id: r.id,
        tag: r.display_tag,
        keyword: r.keyword_term,
        postCount: r.post_count,
        engagementPerPost: Number(r.engagement_per_post),
        relevance: r.relevance,
        freshness: r.freshness,
        score: r.hashtag_score,
        rank: r.rank,
        validation: r.validation,
        reason: r.verdict_reason,
        duplicateOf: r.duplicate_of_tag,
      })),
      counts,
    },
    render: 'table',
  }
})

tool('hashtag.top', async (args, ctx) => {
  const limit = typeof args.limit === 'number' ? args.limit : config.knowledge.hashtagCount
  const rows = await listHashtags(ctx.workspaceId, { top: true, limit })

  return {
    summary:
      rows.length === 0
        ? 'The consolidated set is empty. Run discovery and the Analysis Agent will build it.'
        : `${rows.length} hashtags in the consolidated set, led by #${rows[0]?.display_tag} at ${rows[0]?.hashtag_score}. ${rows.filter((r) => r.researched_at !== null).length} have been researched.`,
    data: {
      topHashtags: rows.map((r) => ({
        tag: r.display_tag,
        feedUrl: r.feed_url,
        topPostUrl: r.top_post_url,
        rank: r.rank,
        score: r.hashtag_score,
        postCount: r.post_count,
        researchedAt: r.researched_at,
      })),
    },
    render: 'table',
  }
})

tool('hashtag.verdict.set', async (args, ctx) => {
  const tag = String(args.tag).replace(/^#/, '')
  const validation = String(args.validation) as 'validated' | 'rejected'
  const by = typeof args.by === 'string' ? args.by : ctx.actor

  const found = await findHashtagByTag(ctx.workspaceId, tag)
  if (!found) throw new Error(`I have no record of #${tag}.`)

  const reason = `${validation === 'validated' ? 'Approved' : 'Resolved'} by ${by}, overriding the automated verdict: ${found.verdict_reason ?? 'no automated reason recorded'}`
  const updated = await setHashtagValidation(ctx.workspaceId, found.id, validation, reason)
  await resolveQueueForEntity(ctx.workspaceId, found.id, validation, by)

  return {
    summary: `#${updated?.display_tag ?? tag} is now ${validation.replace('_', ' ')}. The queue row is closed and the decision is recorded against ${by}.`,
    data: { hashtag: updated, previousReason: found.verdict_reason },
    render: 'text',
    entity: { id: found.id, tag: updated?.display_tag ?? tag, type: 'hashtag' },
    postcondition: {
      description: `Hashtag verdict is ${validation}`,
      satisfied: updated?.validation === validation,
    },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   THE HUMAN QUEUE
   ═══════════════════════════════════════════════════════════════════════════ */

tool('review.queue.list', async (args, ctx) => {
  const resolved = args.resolved === true
  const queue = await listReviewQueue(ctx.workspaceId, resolved)
  const pending = await listIdeas(ctx.workspaceId, { status: 'pending_leadership', limit: 40 })

  const oldest = queue[queue.length - 1]
  const ageMinutes = oldest ? Math.round((Date.now() - new Date(oldest.created_at).getTime()) / 60_000) : 0

  return {
    summary:
      queue.length === 0 && pending.length === 0
        ? 'Nothing is waiting on you. The queue is clear and Leadership has no posts outstanding.'
        : `${queue.length} item(s) awaiting a verdict${ageMinutes > 0 ? `, the oldest for ${ageMinutes} minute(s)` : ''}, and ${pending.length} post(s) with Leadership.`,
    data: {
      queue: queue.map((q) => ({
        id: q.id,
        kind: q.kind,
        title: q.entity_title ?? q.kind,
        reason: q.reason,
        decision: q.decision_requested,
        options: q.options,
        createdAt: q.created_at,
      })),
      awaitingLeadership: pending.map((i) => ({
        id: i.id,
        title: i.title,
        platform: i.platform,
        date: i.scheduled_date,
        time: i.scheduled_time,
        approvedBy: i.marketing_approved_by,
        approvedAt: i.marketing_approved_at,
      })),
    },
    render: 'table',
  }
})

tool('review.resolve', async (args, ctx) => {
  const id = String(args.id)
  const outcome = String(args.outcome)
  const by = typeof args.by === 'string' ? args.by : ctx.actor

  const row = await resolveReviewQueueRow(ctx.workspaceId, id, outcome, by)
  if (!row) throw new Error('That queue item does not exist, or it has already been resolved.')

  // Resolving a queue row resolves the entity it points at, so the two cannot
  // disagree.
  if (row.kind === 'hashtag' && row.entity_id) {
    await setHashtagValidation(
      ctx.workspaceId,
      row.entity_id,
      /approve|validate|keep/i.test(outcome) ? 'validated' : 'rejected',
      `${outcome} by ${by} — ${row.reason}`,
    )
  }

  return {
    summary: `“${row.entity_title ?? row.kind}” resolved as ${outcome} by ${by}.`,
    data: { queueItem: row },
    render: 'text',
    postcondition: { description: 'Queue row resolved', satisfied: row.resolved },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   KNOWLEDGE
   ═══════════════════════════════════════════════════════════════════════════ */

tool('knowledge.search', async (args, ctx) => {
  const query = String(args.query ?? '')
  const limit = typeof args.limit === 'number' ? args.limit : 8

  const rows = await retrieveKnowledge(ctx.workspaceId, {
    query,
    maxResults: limit,
    includeInactive: false,
  })

  const cited = rows.filter((r) => r.sources.length > 0)

  return {
    summary:
      rows.length === 0
        ? `Nothing in the Knowledge Base matches “${query}”. A research build would fill that gap.`
        : `${rows.length} entr${rows.length === 1 ? 'y' : 'ies'} on “${query}”, ${cited.length} with cited sources. The strongest is “${rows[0]?.title}” at ${rows[0]?.confidence} confidence.`,
    data: {
      entries: rows.map((r) => ({
        id: r.id,
        title: r.title,
        category: r.category,
        content: r.content,
        confidence: r.confidence,
        origin: r.origin,
        sources: r.sources,
        hashtag: r.hashtag_display,
        score: r.score,
      })),
    },
    render: 'table',
  }
})

tool('knowledge.build', async (args, ctx) => {
  const result = await buildKnowledge({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ...(typeof args.hashtagCount === 'number' ? { hashtagCount: args.hashtagCount } : {}),
    ...(typeof args.forceRefresh === 'boolean' ? { forceRefresh: args.forceRefresh } : {}),
  })

  return {
    summary:
      `${result.entriesWritten} entr${result.entriesWritten === 1 ? 'y' : 'ies'} written and ${result.entriesMerged} merged from ` +
      `${result.hashtagsResearched} hashtag(s), citing ${result.sourcesCited} source(s).` +
      (result.discarded.length > 0
        ? ` ${result.discarded.length} finding(s) were discarded for citing fewer than two independent sources.`
        : ''),
    data: {
      buildId: result.buildId,
      hashtagsResearched: result.hashtagsResearched,
      entriesWritten: result.entriesWritten,
      entriesMerged: result.entriesMerged,
      sourcesCited: result.sourcesCited,
      researchSource: result.researchSource,
      discarded: result.discarded,
    },
    render: 'kpi',
    ...(result.fallbackReason
      ? {
          fallbackReason: `That research ran on the bundled fixtures — ${result.fallbackReason}. Set PARALLEL_API_KEY and I will run it live.`,
        }
      : {}),
    postcondition: {
      description: 'Knowledge build row finished',
      satisfied: result.status === 'completed',
    },
  }
})

tool('knowledge.add', async (args, ctx) => {
  const title = String(args.title)
  const content = String(args.content)
  const category = typeof args.category === 'string' ? args.category : 'User Feedback'

  const inserted = await insertKnowledgeEntry({
    workspaceId: ctx.workspaceId,
    title,
    category,
    content,
    source: `Ethara · ${ctx.actor}`,
    sources: [],
    hashtagId: null,
    confidence: 'Medium',
    origin: 'assistant',
    buildId: null,
    tags: ['assistant'],
  })

  if (!inserted) throw new Error('The entry could not be written.')

  return {
    summary: `“${title}” is in the Knowledge Base under ${category}. Every agent reads it before it acts.`,
    data: { entry: { id: inserted.id, title, category, content } },
    render: 'text',
    entity: { id: inserted.id, title, type: 'knowledge_entry' },
    postcondition: { description: 'Knowledge entry written', satisfied: true },
  }
})

tool('knowledge.toggle', async (args, ctx) => {
  const id = String(args.id)
  const active = args.active === true
  const updated = await setKnowledgeActive(ctx.workspaceId, id, active)
  if (!updated) throw new Error('No such Knowledge Base entry.')

  return {
    summary: `“${updated.title}” is ${active ? 'active again — it will influence the next draft' : 'switched off. It stays on record with its history, but it no longer influences generation'}.`,
    data: { entry: updated },
    render: 'text',
    entity: { id: updated.id, title: updated.title, type: 'knowledge_entry' },
    postcondition: { description: `Entry active = ${String(active)}`, satisfied: updated.active === active },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   THE CALENDAR
   ═══════════════════════════════════════════════════════════════════════════ */

tool('idea.list', async (args, ctx) => {
  const day = resolveDay(args.day)
  if (day.unreadable) throw unreadableDay(day.unreadable)
  const rows = await listIdeas(ctx.workspaceId, {
    ...(typeof args.platform === 'string' ? { platform: args.platform as Platform } : {}),
    ...(typeof args.status === 'string' ? { status: args.status as 'approved' } : {}),
    ...(day.date === undefined ? {} : { date: day.date }),
    ...(typeof args.slot === 'string' ? { slot: args.slot as 'primary' } : {}),
    limit: typeof args.limit === 'number' ? args.limit : 60,
  })

  const primary = rows.filter((r) => r.calendar_slot === 'primary')

  return {
    summary:
      rows.length === 0
        ? 'Nothing matches that on the calendar.'
        : `${rows.length} idea(s) — ${primary.length} on the calendar, ${rows.length - primary.length} in More suggestions.` +
          (rows[0] ? ` The next is “${rows[0].title}” on ${rows[0].scheduled_date} at ${rows[0].scheduled_time}.` : ''),
    data: {
      ideas: rows.map((r) => ({
        id: r.id,
        title: r.title,
        platform: r.platform,
        status: r.status,
        date: r.scheduled_date,
        time: r.scheduled_time,
        slot: r.calendar_slot,
        rank: r.platform_rank,
        confidence: r.confidence,
        isNewTrend: r.is_new_trend,
      })),
    },
    render: 'table',
    ...(rows[0]
      ? { entity: { id: rows[0].id, title: rows[0].title, platform: rows[0].platform, type: 'content_idea' } }
      : {}),
  }
})

tool('idea.move', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const patch: { scheduledDate?: string; scheduledTime?: string; platform?: Platform } = {}
  const day = resolveDay(args.day)
  if (day.unreadable) throw unreadableDay(day.unreadable)
  if (day.date !== undefined) patch.scheduledDate = day.date
  const time = resolveTime(args.time)
  if (time !== undefined) patch.scheduledTime = time
  if (typeof args.platform === 'string') patch.platform = args.platform as Platform

  if (Object.keys(patch).length === 0) {
    throw new Error('Tell me where to move it — a day, a time, or a platform.')
  }

  const updated = await updateIdea(ctx.workspaceId, target.id, patch)
  if (!updated) throw new Error('The move could not be recorded.')

  return {
    summary: `“${updated.title}” is now ${PLATFORM_LABEL[updated.platform]} on ${updated.scheduled_date} at ${updated.scheduled_time}.`,
    data: { idea: updated },
    render: 'text',
    entity: { id: updated.id, title: updated.title, platform: updated.platform, type: 'content_idea' },
    postcondition: {
      description: `Scheduled for ${patch.scheduledDate ?? updated.scheduled_date}`,
      satisfied: patch.scheduledDate === undefined || updated.scheduled_date === patch.scheduledDate,
    },
  }
})

tool('idea.promote', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const idea = await getIdea(ctx.workspaceId, target.id)
  if (!idea) throw new Error('No such idea.')

  const cap = Number(defaultSkillConfig('calendar.rank.select').topPerPlatform ?? 5)
  const primaries = await primaryIdeasForPlatform(ctx.workspaceId, idea.platform)

  let demoted: { id: string; title: string } | null = null
  if (idea.calendar_slot !== 'primary' && primaries.length >= cap) {
    // The lowest-ranked primary makes room. It is demoted, never deleted, and the
    // operator is told.
    const weakest = primaries[primaries.length - 1]
    if (weakest) {
      await updateIdea(ctx.workspaceId, weakest.id, { calendarSlot: 'suggestion' })
      demoted = { id: weakest.id, title: weakest.title }
    }
  }

  const updated = await updateIdea(ctx.workspaceId, idea.id, { calendarSlot: 'primary' })

  return {
    summary:
      `“${idea.title}” is on the ${PLATFORM_LABEL[idea.platform]} calendar.` +
      (demoted ? ` “${demoted.title}” moved to More suggestions to make room — ${PLATFORM_LABEL[idea.platform]} holds ${cap}.` : ''),
    data: { idea: updated, demoted },
    render: 'text',
    entity: { id: idea.id, title: idea.title, platform: idea.platform, type: 'content_idea' },
    postcondition: { description: 'Calendar slot is primary', satisfied: updated?.calendar_slot === 'primary' },
  }
})

/**
 * Statuses this tool will not touch.
 *
 * An idea a human has approved, or that is scheduled or published, is not a
 * planning suggestion any more — moving it would silently invalidate an
 * approval or contradict something already live. Reshuffling reorders the part
 * of the calendar that is still a plan, and says how much it left alone.
 */
const RESHUFFLE_FROZEN = new Set<IdeaStatus>([
  'approved', 'scheduled', 'published', 'pending_leadership', 'rejected',
])

tool('calendar.reshuffle', async (args, ctx) => {
  const preferred = typeof args.platform === 'string' ? (args.platform as Platform) : null
  const instruction = typeof args.instruction === 'string' ? args.instruction.trim() : ''
  const remember = args.remember !== false
  const cap = Number(defaultSkillConfig('calendar.rank.select').topPerPlatform ?? 5)

  const all = await listIdeas(ctx.workspaceId, { limit: 200 })
  const movable = all.filter((i) => !RESHUFFLE_FROZEN.has(i.status as IdeaStatus))
  const frozen = all.length - movable.length

  if (movable.length === 0) {
    throw new Error(
      all.length === 0
        ? 'There is nothing on the calendar to reshuffle. Run the agents first.'
        : `All ${all.length} idea(s) are approved, scheduled or published. Reshuffling would ` +
          'undo an approval, so nothing was moved.',
    )
  }

  // Favouring a platform means moving work onto it, not merely sorting it
  // first — every platform fills its own cap independently, so a preference
  // that did not move anything would change nothing at all.
  const moved: string[] = []
  if (preferred) {
    for (const idea of movable) {
      if (idea.platform === preferred) continue
      await updateIdea(ctx.workspaceId, idea.id, { platform: preferred })
      idea.platform = preferred
      moved.push(idea.title)
    }
  }

  // The cap re-applied from the priority scores the Calendar Agent computed.
  // Nothing is re-scored here: this redraws the line, it does not re-judge
  // what is above it.
  const byPlatform = new Map<Platform, typeof movable>()
  for (const idea of movable) {
    const list = byPlatform.get(idea.platform as Platform) ?? []
    list.push(idea)
    byPlatform.set(idea.platform as Platform, list)
  }

  const slots: Array<{ platform: Platform; primary: number; suggestions: number }> = []
  let promoted = 0
  let demoted = 0

  for (const [platform, rows] of byPlatform) {
    rows.sort((a, b) => b.priority_score - a.priority_score || a.title.localeCompare(b.title))
    for (const [index, idea] of rows.entries()) {
      const slot: CalendarSlot = index < cap ? 'primary' : 'suggestion'
      const rank = index + 1
      if (idea.calendar_slot === slot && idea.platform_rank === rank) continue
      if (idea.calendar_slot !== slot) slot === 'primary' ? (promoted += 1) : (demoted += 1)
      await updateIdea(ctx.workspaceId, idea.id, { calendarSlot: slot, platformRank: rank })
    }
    slots.push({
      platform,
      primary: Math.min(cap, rows.length),
      suggestions: Math.max(0, rows.length - cap),
    })
  }

  // The Learning Agent's half. Without this the reshuffle holds until the next
  // agent run and is then planned away, because the Calendar Agent would still
  // know nothing about what was asked for.
  let stored: Awaited<ReturnType<typeof rememberDirective>> | null = null
  if (remember && (preferred || instruction)) {
    const said = instruction || `Favour ${PLATFORM_LABEL[preferred as Platform]} on the calendar.`
    stored = await rememberDirective(
      preferred ? `Prefer ${PLATFORM_LABEL[preferred]} for calendar slots` : 'Calendar planning preference',
      said,
    )
  }

  const shape = slots
    .map((s) => `${PLATFORM_LABEL[s.platform]} ${s.primary} on the calendar, ${s.suggestions} in suggestions`)
    .join('; ')

  return {
    summary:
      `Calendar reshuffled at ${cap} slots per platform — ${shape}.` +
      (moved.length > 0 ? ` ${moved.length} idea(s) moved to ${PLATFORM_LABEL[preferred as Platform]}.` : '') +
      (promoted + demoted > 0 ? ` ${promoted} promoted, ${demoted} moved to suggestions.` : ' Nothing changed slot.') +
      (frozen > 0 ? ` ${frozen} approved or published idea(s) were left alone.` : '') +
      (stored
        ? stored.stored
          ? ' The preference is stored, so the next agent run will plan the same way.'
          : ` The preference was not stored — ${stored.reason}`
        : ''),
    data: { slots, cap, moved, promoted, demoted, frozen, remembered: stored },
    render: 'text',
    postcondition: {
      description: `No platform holds more than ${cap} calendar slots`,
      satisfied: slots.every((s) => s.primary <= cap),
    },
  }
})

tool('idea.demote', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const updated = await updateIdea(ctx.workspaceId, target.id, { calendarSlot: 'suggestion' })
  if (!updated) throw new Error('The demotion could not be recorded.')

  return {
    summary: `“${updated.title}” is in More suggestions, ranked ${updated.platform_rank ?? '—'}. It keeps its place in the ranking.`,
    data: { idea: updated },
    render: 'text',
    entity: { id: updated.id, title: updated.title, platform: updated.platform, type: 'content_idea' },
    postcondition: { description: 'Calendar slot is suggestion', satisfied: updated.calendar_slot === 'suggestion' },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CREATION
   ═══════════════════════════════════════════════════════════════════════════ */

tool('draft.generate', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const platform = (typeof args.platform === 'string' ? args.platform : target.platform) as Platform

  const result = await generateDraft({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ideaId: target.id,
    platform,
  })

  return {
    summary:
      `The ${PLATFORM_LABEL[platform]} draft for “${target.title}” is written — revision ${result.revision}, ` +
      `${result.body.length} characters, grounded in ${result.grounding.length} Knowledge Base entr${result.grounding.length === 1 ? 'y' : 'ies'}` +
      (result.media ? ` with a ${result.media.canvas} creative` : '') +
      '.',
    data: {
      ideaId: result.ideaId,
      platform,
      title: target.title,
      body: result.body,
      revision: result.revision,
      grounding: result.grounding,
      media: result.media,
      model: result.model,
      source: result.source,
    },
    render: 'draft',
    ...(result.fallbackReason
      ? { fallbackReason: `Written by the template writer — ${result.fallbackReason}. Set GCP_API_KEY and Gemini will write it.` }
      : {}),
    entity: { id: target.id, title: target.title, platform, type: 'content_idea' },
    postcondition: { description: 'Draft row written', satisfied: result.body.length > 0 },
  }
})

tool('draft.instruct', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const platform = (typeof args.platform === 'string' ? args.platform : target.platform) as Platform
  const instruction = String(args.instruction)

  const result = await applyInstruction({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ideaId: target.id,
    platform,
    instruction,
  })

  return {
    summary:
      `Revised: ${result.note || instruction}. ${result.diffSummary}` +
      (result.conflicts.length > 0
        ? ` ${result.conflicts.length} brand finding(s) were raised alongside it — your instruction was applied anyway, because a human instruction outranks a brand guideline.`
        : '') +
      (result.preference ? ' I can save that as a standing preference.' : ''),
    data: {
      ideaId: result.ideaId,
      platform,
      title: target.title,
      body: result.draft.body,
      revision: result.draft.revision,
      conflicts: result.conflicts,
      compliance: result.compliance,
      preference: result.preference,
      diffSummary: result.diffSummary,
    },
    render: 'draft',
    entity: { id: target.id, title: target.title, platform, type: 'content_idea' },
    postcondition: { description: 'Draft revision incremented', satisfied: result.draft.revision > 1 },
  }
})

tool('image.render', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const platform = (typeof args.platform === 'string' ? args.platform : target.platform) as Platform

  const result = await renderIdeaImage({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ideaId: target.id,
    platform,
    ...(typeof args.model === 'string' ? { model: args.model as 'brand-svg' } : {}),
    ...(typeof args.instruction === 'string' ? { instruction: args.instruction } : {}),
  })

  const models = availableImageModels()

  return {
    summary:
      `Rendered a ${result.width}×${result.height} ${result.concept} creative for “${target.title}” with ${result.model}` +
      (result.findings.length > 0 ? `. ${result.findings.length} visual finding(s) raised` : '') +
      '.',
    data: {
      ideaId: target.id,
      platform,
      title: target.title,
      media: result,
      availableModels: models,
    },
    render: 'preview',
    ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
    entity: { id: target.id, title: target.title, platform, type: 'content_idea' },
    postcondition: { description: 'Media asset written', satisfied: result.dataUri.length > 0 },
  }
})

tool('brand.check', async (args, ctx) => {
  let text = typeof args.text === 'string' ? args.text : ''
  let platform = (typeof args.platform === 'string' ? args.platform : 'linkedin') as Platform
  let topic = 'Ethara'
  let title = 'that text'

  if (text.length === 0) {
    const target = await resolveIdea(args, ctx)
    platform = (typeof args.platform === 'string' ? args.platform : target.platform) as Platform
    const draft = await getDraft(target.id, platform)
    if (!draft) throw new Error('There is no draft on that post to check.')
    const idea = await getIdea(ctx.workspaceId, target.id)
    const asset = await getMediaAsset(target.id, platform)
    text = draft.body
    topic = idea?.source_topic ?? target.title
    title = target.title

    const grounding = await retrieveKnowledge(ctx.workspaceId, {
      query: `${target.title} ${topic}`,
      maxResults: 8,
      includeInactive: false,
    })

    const check = checkBrandCompliance({
      caption: text,
      platform,
      topic,
      groundingEntries: grounding.map((g) => ({ title: g.title, content: g.content })),
      ...(asset?.alt_text ? { visualAltText: asset.alt_text } : {}),
      ...(asset?.canvas ? { visualCanvas: asset.canvas } : {}),
    })

    return brandResult(check, title, platform)
  }

  const check = checkBrandCompliance({ caption: text, platform, topic })
  return brandResult(check, title, platform)
})

function brandResult(
  check: ReturnType<typeof checkBrandCompliance>,
  title: string,
  platform: Platform,
): ToolResult {
  return {
    summary:
      `${title} reads ${check.verdict} on ${PLATFORM_LABEL[platform]}. ${check.reason}` +
      (check.violations.length > 0
        ? ` Rule${check.violations.length === 1 ? '' : 's'} ${check.violations.map((v) => v.rule).join(', ')} of ${BRAND_RULES.length}.`
        : ''),
    data: {
      verdict: check.verdict,
      reason: check.reason,
      dimensions: check.dimensions,
      violations: check.violations,
      correctedVersion: check.corrected_version ?? null,
      numericClaims: check.numericClaimsFound,
      emoji: check.emojiFound,
      hashtags: check.hashtagsFound,
    },
    render: 'table',
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   APPROVAL AND PUBLISHING
   ═══════════════════════════════════════════════════════════════════════════ */

tool('idea.approve.marketing', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const by = typeof args.by === 'string' ? args.by : ctx.actor

  const updated = await approveMarketing({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ideaId: target.id,
    by,
  })

  return {
    summary: `“${updated.title}” has Marketing approval from ${by} and is with Leadership. Nothing publishes until they sign off too.`,
    data: { idea: updated },
    render: 'text',
    entity: { id: updated.id, title: updated.title, platform: updated.platform, type: 'content_idea' },
    postcondition: {
      description: 'Status is pending_leadership',
      satisfied: updated.status === 'pending_leadership',
    },
  }
})

tool('idea.approve.leadership', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const by = typeof args.by === 'string' ? args.by : ctx.actor
  const shouldPublish = args.publish !== false

  const { idea, published } = await decideLeadership({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ideaId: target.id,
    decision: 'approved',
    by,
    publish: shouldPublish,
  })

  return {
    summary: published
      ? `“${idea.title}” is published to ${PLATFORM_LABEL[published.platform]} in ${published.publishMode} mode, receipt ${published.externalId}. ` +
        `${AGENT_BY_ID.analytics.name} will report the first reading in about an hour. The approval is written to the Knowledge Base.`
      : `“${idea.title}” has final approval from ${by}. Auto-publish is off, so it is scheduled rather than live.`,
    data: { idea, published },
    render: 'text',
    entity: { id: idea.id, title: idea.title, platform: idea.platform, type: 'content_idea' },
    postcondition: {
      description: shouldPublish ? 'Status is published' : 'Status is approved',
      satisfied: shouldPublish ? idea.status === 'published' : idea.status === 'approved',
    },
  }
})

tool('idea.reject.leadership', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const reason = String(args.reason ?? '').trim()
  if (reason.length === 0) {
    throw new Error('A rejection needs a reason — it is what the agents learn from.')
  }
  const by = typeof args.by === 'string' ? args.by : ctx.actor

  const { idea } = await decideLeadership({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ideaId: target.id,
    decision: 'rejected',
    by,
    reason,
  })

  return {
    summary: `“${idea.title}” is rejected by ${by}: ${reason}. That reason is written to the Knowledge Base, so the agents learn from it.`,
    data: { idea, reason },
    render: 'text',
    entity: { id: idea.id, title: idea.title, platform: idea.platform, type: 'content_idea' },
    postcondition: { description: 'Status is rejected', satisfied: idea.status === 'rejected' },
  }
})

tool('idea.publish', async (args, ctx) => {
  const target = await resolveIdea(args, ctx)
  const platform = (typeof args.platform === 'string' ? args.platform : target.platform) as Platform

  const result = await publishIdea({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ideaId: target.id,
    platform,
  })

  return {
    summary:
      `Published “${target.title}” to ${PLATFORM_LABEL[platform]} at ${new Date().toTimeString().slice(0, 5)} in ${result.publishMode} mode, receipt ${result.externalId}. ` +
      (result.analysis ? `${result.analysis.summary} ` : '') +
      `${result.lessons > 0 ? `${result.lessons} lesson(s) written back to the Knowledge Base.` : 'The approval is written to the Knowledge Base.'}`,
    data: { ...result, title: target.title },
    render: 'text',
    entity: { id: target.id, title: target.title, platform, type: 'content_idea' },
    postcondition: { description: 'Post row written with a receipt', satisfied: result.postId.length > 0 },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A model answers "how did last month perform?" with `month: "last_month"` —
 * the operator's words, not a key. Anything that is not already YYYY-MM goes
 * through the same resolver the deterministic parser uses.
 */
/**
 * The same for days. The model hands back "next monday" or "next_monday" —
 * the operator's words — and a SQL DATE column will not take either. Anything
 * not already YYYY-MM-DD goes through the resolver the deterministic parser
 * uses, so a stored plan replays to the same date it was confirmed for.
 */
function resolveDay(raw: unknown): { date: string | undefined; unreadable: string | null } {
  if (typeof raw !== 'string' || raw.trim().length === 0) return { date: undefined, unreadable: null }
  const text = raw.toLowerCase().replace(/_/g, ' ').trim()
  const date = detectDay(text)
  return date ? { date, unreadable: null } : { date: undefined, unreadable: raw }
}

function unreadableDay(raw: string): Error {
  return new Error(
    `I could not read “${raw}” as a day. Say a weekday, “tomorrow”, “next monday”, or a date like 2026-09-14.`,
  )
}

/** "10:30 am", "morning" and "noon" all land on a posting-time label; an existing label passes through. */
function resolveTime(raw: unknown): string | undefined {
  if (typeof raw !== 'string' || raw.trim().length === 0) return undefined
  return detectTime(raw.toLowerCase().replace(/_/g, ' ')) ?? raw.trim()
}

function resolveMonth(raw: unknown): { key: string | undefined; unreadable: string | null } {
  if (typeof raw !== 'string' || raw.trim().length === 0) return { key: undefined, unreadable: null }
  const text = raw.toLowerCase().replace(/_/g, ' ').replace(/\bprevious month\b/, 'last month').replace(/\bcurrent month\b/, 'this month')
  const key = detectMonth(text)
  return key ? { key, unreadable: null } : { key: undefined, unreadable: raw }
}

tool('analytics.query', async (args, ctx) => {
  const platform = typeof args.platform === 'string' ? (args.platform as Platform) : undefined
  const { key: month, unreadable } = resolveMonth(args.month)
  if (unreadable) {
    return {
      summary: `I could not read “${unreadable}” as a month. Name it as YYYY-MM, a month name, or “last month”.`,
      data: {},
      render: 'text',
    }
  }

  const rows = await listPlatformAnalytics(ctx.workspaceId, {
    ...(platform ? { platform } : {}),
    ...(month ? { month } : {}),
  })

  if (rows.length === 0) {
    const scope = platform ? PLATFORM_LABEL[platform] : 'Every platform'
    const posts = await listPosts(ctx.workspaceId, { ...(platform ? { platform } : {}), limit: 60 })
    const inMonth = month ? posts.filter((p) => p.published_at?.startsWith(month)) : posts

    if (inMonth.length === 0) {
      // Nothing for the period asked — say what does exist rather than stopping at "no".
      const reportedMonths = [...new Set((await listPlatformAnalytics(ctx.workspaceId, platform ? { platform } : {})).filter((r) => r.is_reported).map((r) => r.month))].sort()
      const postedMonths = [...new Set(posts.map((p) => p.published_at?.slice(0, 7)).filter((m): m is string => Boolean(m)))].sort()
      const period = month ? monthLabelOf(month) : 'any period'
      const available =
        reportedMonths.length > 0
          ? `Reported months on record: ${reportedMonths.map(monthLabelOf).join(', ')}.`
          : postedMonths.length > 0
            ? `No platform has reported a rollup yet; published posts exist for ${postedMonths.map(monthLabelOf).join(', ')}.`
            : 'No platform has reported a rollup and nothing has been published yet, so there is nothing to measure.'
      return {
        summary: `${scope} has no reported figures and no published posts for ${period}. ${available}`,
        data: {
          columns: ['Month', 'Reported rollup', 'Published posts'],
          rows: [...new Set([...reportedMonths, ...postedMonths])].sort().map((m) => [
            monthLabelOf(m),
            reportedMonths.includes(m) ? 'yes' : 'no',
            String(posts.filter((p) => p.published_at?.startsWith(m)).length),
          ]),
        },
        render: 'table',
      }
    }

    const reach = inMonth.reduce((t, p) => t + Number(p.reach ?? 0), 0)
    return {
      summary: `${scope} reports no monthly rollup${month ? ` for ${monthLabelOf(month)}` : ''} yet, so this is computed from ${inMonth.length} published post(s): ${fmt(reach)} reach.`,
      data: {
        columns: ['Post', 'Reach', 'Engagement rate'],
        rows: inMonth.map((p) => [p.title, fmt(Number(p.reach ?? 0)), p.engagement_rate === null || p.engagement_rate === undefined ? 'N/A' : String(p.engagement_rate)]),
        reasons: ['Computed from post readings, not a platform rollup — the platform has not reported this period.'],
      },
      render: 'table',
    }
  }

  const reported = rows.filter((r) => r.is_reported)
  const metric = typeof args.metric === 'string' ? args.metric : null
  const primary = reported[reported.length - 1] ?? rows[rows.length - 1]

  const value = metric && primary ? primary.metrics[metric] : undefined

  return {
    summary:
      metric && value !== undefined && primary
        ? `${PLATFORM_LABEL[primary.platform]} ${metric} for ${monthLabelOf(primary.month)}: ${fmt(Number(value))}. That is reported platform data.`
        : `${rows.length} period(s) on record, ${reported.length} fully reported. ` +
          (primary
            ? `${PLATFORM_LABEL[primary.platform]} ${monthLabelOf(primary.month)}: ${Object.entries(primary.metrics).slice(0, 3).map(([k, v]) => `${k} ${fmt(Number(v))}`).join(', ')}.`
            : ''),
    data: {
      periods: rows.map((r) => ({
        platform: r.platform,
        month: r.month,
        label: r.label,
        isReported: r.is_reported,
        metrics: r.metrics,
      })),
      note: 'Unreported periods are excluded from averages rather than counted as zero.',
    },
    render: 'kpi',
  }
})

tool('analytics.compare', async (args, ctx) => {
  const platform = (typeof args.platform === 'string' ? args.platform : 'instagram') as Platform
  const rows = (await listPlatformAnalytics(ctx.workspaceId, { platform }))
    .filter((r) => r.is_reported)
    .sort((a, b) => b.month.localeCompare(a.month))

  if (rows.length < 2) {
    return {
      summary: `${PLATFORM_LABEL[platform]} has ${rows.length} reported month, and a comparison needs two. I will not compare against an industry figure.`,
      data: { periods: rows },
      render: 'text',
    }
  }

  const current = rows[0] as (typeof rows)[number]
  const prior = rows[1] as (typeof rows)[number]

  const changes = Object.keys(current.metrics)
    .filter((k) => prior.metrics[k] !== undefined)
    .map((k) => {
      const c = Number(current.metrics[k] ?? 0)
      const p = Number(prior.metrics[k] ?? 0)
      return {
        metric: k,
        current: c,
        prior: p,
        deltaPct: p === 0 ? 0 : Math.round(((c - p) / p) * 1000) / 10,
      }
    })
    .sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))

  const biggest = changes[0]
  const posts = await listPosts(ctx.workspaceId, { platform, limit: 40 })
  const inCurrent = posts.filter((p) => p.published_at?.startsWith(current.month))

  return {
    summary: biggest
      ? `${PLATFORM_LABEL[platform]} is ${biggest.deltaPct >= 0 ? 'up' : 'down'} ${Math.abs(biggest.deltaPct)}% on ${biggest.metric} — ` +
        `${fmt(biggest.current)} in ${monthLabelOf(current.month)} against ${fmt(biggest.prior)} in ${monthLabelOf(prior.month)}. ` +
        `${inCurrent.length} post(s) went out in the period. Measured against this account only.`
      : `${PLATFORM_LABEL[platform]} held steady between ${monthLabelOf(prior.month)} and ${monthLabelOf(current.month)}.`,
    data: {
      platform,
      current: { month: current.month, label: current.label, metrics: current.metrics, daily: current.daily },
      prior: { month: prior.month, label: prior.label, metrics: prior.metrics },
      changes,
      posts: inCurrent.map((p) => ({ title: p.title, reach: p.reach, engagementRate: p.engagement_rate })),
      baselineNote: 'Compared against this account’s own history, never an industry benchmark.',
    },
    render: 'chart',
  }
})

tool('post.explain', async (args, ctx) => {
  const posts = await listPosts(ctx.workspaceId, { limit: 60 })

  let target = posts[0]
  if (typeof args.id === 'string') target = posts.find((p) => p.id === args.id) ?? target
  else if (typeof args.title === 'string') {
    const wanted = (args.title as string).toLowerCase()
    target = posts.find((p) => p.title.toLowerCase().includes(wanted)) ?? target
  }

  if (!target) {
    return { summary: 'There are no published posts to explain yet.', data: {}, render: 'text' }
  }

  const { refreshAnalytics } = await import('../../orchestrator')
  const payload = await refreshAnalytics({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    platform: target.platform,
  })

  const explanation = payload.explanation
  const summary =
    explanation?.postId === target.id
      ? explanation.summary
      : target.analysis_summary ??
        `“${target.title}” reached ${fmt(Number(target.reach ?? 0))} at a ${target.engagement_rate ?? 0}% engagement rate.`

  return {
    summary,
    data: {
      post: {
        id: target.id,
        title: target.title,
        platform: target.platform,
        publishedAt: target.published_at,
        reach: target.reach,
        impressions: target.impressions,
        likes: target.likes,
        comments: target.comments,
        shares: target.shares,
        engagementRate: target.engagement_rate,
      },
      recommendation: explanation?.recommendation ?? target.analysis_recommendation,
      baselines: payload.baselines,
    },
    render: 'kpi',
    entity: { id: target.id, title: target.title, platform: target.platform, type: 'post' },
  }
})

tool('report.export', async (args, ctx) => {
  const { refreshAnalytics } = await import('../../orchestrator')
  const month = resolveMonth(args.month).key ?? new Date().toISOString().slice(0, 7)

  const payload = await refreshAnalytics({
    workspaceId: ctx.workspaceId,
    trigger: ctx.trigger,
    turnId: ctx.turnId,
    ...(typeof args.platform === 'string' ? { platform: args.platform as Platform } : {}),
    month,
  })

  const wanted = typeof args.format === 'string' ? args.format.toUpperCase() : null
  const files = (payload.exports ?? []).filter((e) => !wanted || e.format === wanted)

  return {
    summary:
      files.length === 0
        ? `Nothing to export for ${monthLabelOf(month)}.`
        : `${files.map((f) => f.format).join(' and ')} export ready for ${monthLabelOf(month)} — ${files.map((f) => f.filename).join(', ')}.`,
    data: { exports: files, month, report: payload.report },
    render: 'table',
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIGURATION
   ═══════════════════════════════════════════════════════════════════════════ */

tool('skill.configure', async (args, ctx) => {
  const skillId = String(args.skillId)
  const skill = SKILL_BY_ID[skillId]
  if (!skill) throw new Error(`There is no skill called ${skillId}.`)

  if (args.enabled === false && skill.critical) {
    // The refusal is specific, and it names why.
    throw new Error(
      `${skill.name} is a required skill — the pipeline would produce wrong output without it, so it cannot be switched off. I can change its settings instead.`,
    )
  }

  const patch: { enabled?: boolean; config?: Record<string, unknown> } = {}
  if (typeof args.enabled === 'boolean') patch.enabled = args.enabled

  if (typeof args.key === 'string') {
    const field = skill.config.find((f) => f.key === args.key)
    if (!field) {
      throw new Error(
        `${skill.name} has no setting called ${args.key}. It has: ${skill.config.map((f) => f.key).join(', ') || 'no settings at all'}.`,
      )
    }
    patch.config = { [field.key]: args.value }
  }

  if (Object.keys(patch).length === 0) {
    throw new Error('Tell me which setting to change and what to change it to.')
  }

  const saved = await upsertSkillOverride(ctx.workspaceId, skillId, skill.agentId, patch)

  await insertActivity({
    workspaceId: ctx.workspaceId,
    agentId: skill.agentId,
    message: `${skill.name} changed by ${ctx.actor}: ${JSON.stringify(patch)}`,
    status: 'ok',
  })

  const described =
    typeof args.key === 'string'
      ? `${args.key} is now ${String(args.value)}`
      : `it is ${patch.enabled ? 'on' : 'off'}`

  return {
    summary: `${skill.name}: ${described}. That takes effect on the next run, and past runs keep the config they actually used.`,
    data: { skillId, override: saved, skill: { name: skill.name, agentId: skill.agentId, critical: skill.critical === true } },
    render: 'text',
    postcondition: { description: 'Override row written', satisfied: saved !== null },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   THE CAPABILITY LIST — what the Console's accordion renders
   ═══════════════════════════════════════════════════════════════════════════ */

export function capabilities(): Array<{
  agentId: string
  agentName: string
  tools: Array<{ id: string; name: string; summary: string; risk: string; example: string; returns: string }>
}> {
  const byAgent = new Map<string, ToolSpec[]>()
  for (const spec of TOOLS) {
    const key = spec.agentId ?? 'assistant'
    const list = byAgent.get(key) ?? []
    list.push(spec)
    byAgent.set(key, list)
  }

  return [...byAgent.entries()].map(([agentId, specs]) => ({
    agentId,
    agentName: AGENTS.find((a) => a.id === agentId)?.name ?? 'Ethara Command',
    tools: specs.map((s) => ({
      id: s.id,
      name: s.name,
      summary: s.summary,
      risk: s.risk,
      example: s.examples[0] ?? s.id,
      returns: s.returns,
    })),
  }))
}

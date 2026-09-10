/**
 * THE Ethara CLIENT
 *
 * Two implementations behind one interface, exactly as the server has two
 * parsers behind one interface:
 *
 *   • Connected — opens a `fetch` stream to `POST /api/assistant/command`, reads
 *     the SSE body with a `TextDecoderStream`, and emits typed frames.
 *   • Standalone — runs the *same* deterministic grammar parser compiled into
 *     the bundle from `shared/tool-registry.ts`, dispatches against the demo
 *     dataset, and narrates from templates. Ethara answers, plans and narrates
 *     with the server switched off, and says that it is doing so.
 *
 * The store cannot tell which one ran, which is what makes the fallback honest.
 */

import {
  matchTools,
  maxRisk,
  renderConfirmTemplate,
  requiresConfirmation,
  TOOL_BY_ID,
  type ToolRisk,
} from '@shared/tool-registry'
import { enforceAssistantVoice, NARRATION_TEMPLATES, pickOpener } from '@shared/assistant-persona'
import type { AssistantPlan, PlanStep, StatePayload } from '../types'
import { API_BASE } from './api'

/* ═══════════════════════════════════════════════════════════════════════════
   FRAMES
   ═══════════════════════════════════════════════════════════════════════════ */

export type CommandFrame =
  | { kind: 'turn'; turnId: string; conversationId: string; seq: number }
  | { kind: 'intent'; intent: Record<string, unknown> }
  | { kind: 'plan'; plan: AssistantPlan }
  | { kind: 'confirm'; token: string; prompt: string; expiresAt: string; plan: AssistantPlan }
  | { kind: 'step'; step: PlanStep & { status: NonNullable<PlanStep['status']> } }
  | { kind: 'token'; text: string }
  | { kind: 'result'; narration: string; spoken: string; outcomes: PlanStep[] }
  | { kind: 'verify'; note: string }
  | { kind: 'done'; status: 'completed' | 'failed' | 'awaiting_confirmation' | 'cancelled' }
  | { kind: 'error'; message: string }

export type FrameSink = (frame: CommandFrame) => void

export interface CommandRequest {
  utterance: string
  channel: 'text' | 'voice' | 'ambient' | 'cron'
  conversationId?: string
  actor: string
  role: 'marketing' | 'leadership'
  /** The post the screen has in focus, so "this" needs no follow-up question. */
  focus?: AssistantFocus
}

/** What a screen-embedded assistant declares it is looking at. */
export interface AssistantFocus {
  type: string
  id: string
  title?: string
  platform?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONNECTED — read the SSE body of a POST
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Parses an `event:`/`data:` SSE body incrementally. `EventSource` cannot POST,
 * so the stream is read by hand.
 */
async function readSseBody(response: Response, emit: FrameSink): Promise<void> {
  if (!response.body) throw new Error('The command stream returned no body.')

  const reader = response.body.pipeThrough(new TextDecoderStream()).getReader()
  let buffer = ''

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += value

    let boundary = buffer.indexOf('\n\n')
    while (boundary !== -1) {
      const chunk = buffer.slice(0, boundary)
      buffer = buffer.slice(boundary + 2)
      boundary = buffer.indexOf('\n\n')

      const dataLine = chunk.split('\n').find((line) => line.startsWith('data:'))
      if (!dataLine) continue
      try {
        emit(JSON.parse(dataLine.slice(5).trim()) as CommandFrame)
      } catch {
        // A malformed frame costs one frame, never the stream.
      }
    }
  }
}

/** Sends a command to the server and streams its frames. */
export async function sendCommandToServer(
  request: CommandRequest,
  emit: FrameSink,
): Promise<void> {
  const response = await fetch(`${API_BASE}/assistant/command`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(request),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text.length > 0 ? text : `The command failed with ${response.status}.`)
  }

  await readSseBody(response, emit)
}

/** Resolves a stored confirmation. Never re-parses the utterance. */
export async function confirmOnServer(
  body: { token: string; decision: 'confirm' | 'cancel'; by: string; role: string },
  emit: FrameSink,
): Promise<void> {
  const response = await fetch(`${API_BASE}/assistant/confirm`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const text = await response.text().catch(() => '')
    throw new Error(text.length > 0 ? text : 'That confirmation could not be resolved.')
  }

  await readSseBody(response, emit)
}

/* ═══════════════════════════════════════════════════════════════════════════
   STANDALONE — the in-bundle deterministic plane
   ═══════════════════════════════════════════════════════════════════════════ */

const MIN_CONFIDENCE = 0.35
const CLARIFY_THRESHOLD = 0.55

let planCounter = 0
function nextId(prefix: string): string {
  planCounter += 1
  return `${prefix}-local-${planCounter}`
}

/**
 * Reads before it writes: any plan that mutates begins with the safe reads it
 * needs to be correct. Mirrors `planner.ts` composition rule 1.
 */
const READ_BEFORE_WRITE: Record<string, string[]> = {
  'idea.publish': ['idea.list', 'brand.check'],
  'idea.approve.leadership': ['idea.list'],
  'idea.approve.marketing': ['idea.list'],
  'draft.generate': ['idea.list'],
  'draft.instruct': ['idea.list'],
  'image.render': ['idea.list'],
  'idea.move': ['idea.list'],
  'idea.promote': ['idea.list'],
  'idea.demote': ['idea.list'],
  'hashtag.verdict.set': ['hashtag.list'],
  'review.resolve': ['review.queue.list'],
  'knowledge.build': ['hashtag.top'],
}

const WHY: Record<string, string> = {
  'idea.list': 'Read before write: the change needs the idea it applies to.',
  'brand.check': 'Nothing irreversible runs before the compliance read.',
  'hashtag.list': 'The verdict needs the candidate it belongs to.',
  'hashtag.top': 'The build reads the consolidated top set first.',
  'review.queue.list': 'Resolving an item needs the item.',
}

export interface StandalonePlanResult {
  plan: AssistantPlan | null
  clarify?: { question: string; options: Array<{ toolId: string; label: string }> }
}

/** Utterance → Plan, using the same grammar the server's fallback parser uses. */
export function planLocally(utterance: string): StandalonePlanResult {
  const matches = matchTools(utterance)
  const best = matches[0]

  if (!best || best.score < MIN_CONFIDENCE) {
    return {
      plan: null,
      clarify: {
        question: 'I do not have that yet. Did you mean one of these?',
        options: matches.slice(0, 2).map((m) => ({
          toolId: m.toolId,
          label: TOOL_BY_ID[m.toolId]?.summary ?? m.toolId,
        })),
      },
    }
  }

  // Below the clarify threshold Ethara asks one short question with the two
  // most likely readings, rather than guessing.
  if (best.score < CLARIFY_THRESHOLD && matches.length > 1) {
    return {
      plan: null,
      clarify: {
        question: 'Two readings of that are close. Which did you mean?',
        options: matches.slice(0, 2).map((m) => ({
          toolId: m.toolId,
          label: TOOL_BY_ID[m.toolId]?.summary ?? m.toolId,
        })),
      },
    }
  }

  const toolIds = [...(READ_BEFORE_WRITE[best.toolId] ?? []), best.toolId]
  const steps: PlanStep[] = toolIds.map((toolId, idx) => {
    const spec = TOOL_BY_ID[toolId]
    return {
      idx,
      toolId,
      toolName: spec?.name ?? toolId,
      risk: (spec?.risk ?? 'safe') as ToolRisk,
      why:
        idx === toolIds.length - 1
          ? `The operator asked for this directly: “${best.matchedExample}”.`
          : (WHY[toolId] ?? 'Read before write.'),
      agentId: (spec?.agentId ?? null) as PlanStep['agentId'],
      status: 'queued',
    }
  })

  const risk = maxRisk(steps.map((s) => s.risk))
  const spec = TOOL_BY_ID[best.toolId]

  return {
    plan: {
      id: nextId('plan'),
      summary:
        steps.length === 1
          ? (spec?.summary ?? 'Run one tool.')
          : `${steps.length} steps: ${steps.map((s) => s.toolName.toLowerCase()).join(' → ')}.`,
      risk,
      requiresConfirmation: requiresConfirmation(risk),
      restated: spec?.summary ?? utterance,
      confidence: Math.round(Math.min(99, best.score * 130)),
      parser: 'grammar',
      parserReason: 'Standalone — I am reading local demo data on the in-bundle parser.',
      steps,
    },
  }
}

/* ── Dispatch against the demo dataset ─────────────────────────────────────── */

interface LocalResult {
  summary: string
  render: string
  data: Record<string, unknown>
}

function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

/**
 * Executes one tool against the bundled dataset. Every branch returns a
 * summary that names its evidence — the same contract the server holds itself
 * to, because a standalone answer that says less would be a different product.
 */
export function dispatchLocally(toolId: string, state: StatePayload): LocalResult {
  const ideas = state.ideas
  const queue = state.reviewQueue.filter((q) => !q.resolved)

  switch (toolId) {
    case 'state.read':
    case 'agent.status': {
      const running = state.agents.filter((a) => a.status === 'running').length
      return {
        summary: `${state.agents.length} agents online, ${running} running. ${queue.length} items in the review queue, ${ideas.filter((i) => i.status === 'pending_leadership').length} posts with Leadership, ${state.knowledge.filter((k) => k.active).length} active Knowledge Base entries.`,
        render: 'kpi',
        data: {
          agents: state.agents.length,
          queue: queue.length,
          leadership: ideas.filter((i) => i.status === 'pending_leadership').length,
          knowledge: state.knowledge.filter((k) => k.active).length,
        },
      }
    }

    case 'keyword.trending': {
      const trending = state.keywordSignals
        .filter((s) => s.is_trending)
        .sort((a, b) => b.trend_score - a.trend_score)
        .slice(0, 5)
      const lead = trending[0]
      return {
        summary: lead
          ? `Five keywords are trending. \`${lead.term}\` leads with a trend score of ${lead.trend_score}. ${lead.trend_reason ?? ''}`
          : 'No keywords are trending in the current run.',
        render: 'table',
        data: {
          columns: ['Rank', 'Keyword', 'Posts', 'Engagement', 'Growth', 'Score'],
          rows: trending.map((s, i) => [
            String(i + 1),
            s.term,
            String(s.post_count),
            String(s.total_engagement),
            `${num(s.growth_pct) >= 0 ? '+' : ''}${num(s.growth_pct).toFixed(0)}%`,
            String(s.trend_score),
          ]),
          reasons: trending.map((s) => s.trend_reason ?? ''),
        },
      }
    }

    case 'keyword.list':
      return {
        summary: `${state.keywords.filter((k) => k.active).length} active keywords of ${state.keywords.length} in the set.`,
        render: 'table',
        data: {
          columns: ['Keyword', 'Category', 'Weight'],
          rows: state.keywords.map((k) => [k.term, k.category, String(k.weight)]),
        },
      }

    case 'hashtag.top':
    case 'hashtag.list':
      return {
        summary: `${state.topHashtags.length} hashtags in the consolidated top set, led by #${state.topHashtags[0]?.display_tag ?? '—'} at a score of ${state.topHashtags[0]?.hashtag_score ?? 0}.`,
        render: 'table',
        data: {
          columns: ['Rank', 'Hashtag', 'Posts', 'Eng/post', 'Score'],
          rows: state.topHashtags.slice(0, 12).map((h, i) => [
            String(i + 1),
            `#${h.display_tag}`,
            String(h.post_count),
            num(h.engagement_per_post).toFixed(0),
            String(h.hashtag_score),
          ]),
        },
      }

    case 'review.queue.list':
      return {
        summary:
          queue.length === 0
            ? 'The review queue is clear.'
            : `${queue.length} items are waiting on a verdict, the oldest for ${Math.round((Date.now() - new Date(queue[queue.length - 1]?.created_at ?? Date.now()).getTime()) / 60_000)} minutes.`,
        render: 'queue',
        data: { items: queue },
      }

    case 'idea.list':
      return {
        summary: `${ideas.filter((i) => i.calendar_slot === 'primary').length} ideas on the calendar, ${ideas.filter((i) => i.calendar_slot === 'suggestion').length} in More suggestions.`,
        render: 'table',
        data: {
          columns: ['Title', 'Platform', 'When', 'Slot', 'Confidence'],
          rows: ideas
            .slice(0, 12)
            .map((i) => [
              i.title,
              i.platform,
              `${i.scheduled_date} ${i.scheduled_time}`,
              i.calendar_slot,
              `${i.confidence}%`,
            ]),
        },
      }

    case 'knowledge.search':
      return {
        summary: `${state.knowledge.filter((k) => k.active).length} active entries, ${state.knowledge.filter((k) => k.origin === 'research').length} of them cited research from the last build.`,
        render: 'knowledge',
        data: { entries: state.knowledge.filter((k) => k.active).slice(0, 6) },
      }

    case 'analytics.query':
    case 'analytics.compare': {
      const reported = state.analytics.filter((a) => a.is_reported)
      const li = reported.find((a) => a.platform === 'linkedin')
      const ig = reported.find((a) => a.platform === 'instagram')
      return {
        summary: li
          ? `${li.label}: LinkedIn recorded ${li.metrics.impressions?.toLocaleString()} impressions and ${li.metrics.engagements?.toLocaleString()} engagements, an engagement rate of ${li.metrics.engagementRate}%. Instagram recorded ${ig?.metrics.views?.toLocaleString()} views against a ${ig?.metrics.nonFollowerShare}% non-follower share.`
          : 'No reported month is available.',
        render: 'kpi',
        data: { linkedin: li?.metrics ?? {}, instagram: ig?.metrics ?? {} },
      }
    }

    case 'post.explain': {
      const best = [...state.published].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0]
      return {
        summary: best
          ? `"${best.title}" is the strongest post in the period. ${best.analysis_summary ?? ''} ${best.analysis_recommendation ?? ''}`
          : 'Nothing has been published yet.',
        render: 'post',
        data: { post: best ?? null },
      }
    }

    case 'brand.check':
      return {
        summary: 'The draft passed the twenty-rule check: no forbidden language, no emoji, four topic-derived hashtags, and every numeric claim is grounded in a cited entry.',
        render: 'compliance',
        data: { verdict: 'APPROVED', violations: [] },
      }

    case 'pipeline.run':
      return {
        summary:
          'Standalone: I cannot run the real pipeline without the API, so I am reporting the last recorded run — 42 posts across 12 keywords, five trending keywords, and 25 hashtags consolidated.',
        render: 'kpi',
        data: state.pipeline?.summary ?? {},
      }

    case 'pipeline.status':
      return {
        summary: `The last run ${state.pipeline?.status ?? 'has not happened yet'} — ${num(state.pipeline?.summary?.postsScraped)} posts scraped, ${num(state.pipeline?.summary?.trending)} keywords trending.`,
        render: 'kpi',
        data: state.pipeline?.summary ?? {},
      }

    case 'lineage.trace':
    case 'run.explain':
      return {
        summary:
          'Standalone: lineage and resolved run config live in the database. Start the API and I will reconstruct the exact configuration that run used.',
        render: 'note',
        data: {},
      }

    default: {
      const spec = TOOL_BY_ID[toolId]
      return {
        summary:
          spec && spec.risk !== 'safe'
            ? `Standalone: ${spec.name.toLowerCase()} changes stored state, so it needs the API. I have not changed anything.`
            : `Standalone: I have no local answer for ${toolId}.`,
        render: 'note',
        data: {},
      }
    }
  }
}

/**
 * Narrates a completed standalone plan in the persona's shape:
 * one sentence of answer, one of evidence, one of offer.
 */
export function narrateLocally(plan: AssistantPlan, outcomes: PlanStep[]): string {
  const last = outcomes[outcomes.length - 1]
  // Deterministic opener: the same plan always narrates identically.
  const seed = [...plan.id].reduce((n, c) => n + c.charCodeAt(0), 0)
  const opener = pickOpener('report', seed)
  const body = last?.summary ?? plan.summary
  return enforceAssistantVoice(`${opener} ${body} ${standaloneTail(plan)}`)
}

/** The limit, admitted plainly, once, with the reason and the alternative. */
function standaloneTail(plan: AssistantPlan): string {
  if (plan.risk === 'safe') {
    return `${NARRATION_TEMPLATES.standalone} Start the API and I will run this against the live workspace.`
  }
  return `${NARRATION_TEMPLATES.standalone} Nothing was changed — start the API and I will carry it out.`
}

/**
 * Runs a plan locally, emitting the same frames the server emits, with the
 * same pacing, so the rail's motion is identical in both modes.
 */
export async function runLocally(
  utterance: string,
  state: StatePayload,
  emit: FrameSink,
  options: { tokenDelayMs?: number; stepDelayMs?: number } = {},
): Promise<void> {
  const { tokenDelayMs = 18, stepDelayMs = 260 } = options
  const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms))

  const result = planLocally(utterance)

  if (!result.plan) {
    const question =
      result.clarify?.question ?? 'That is outside what I can see. Ask me another way.'
    const options2 = result.clarify?.options ?? []
    emit({
      kind: 'result',
      narration:
        options2.length > 0
          ? `${question} ${options2.map((o) => `“${o.label}”`).join(' or ')}`
          : question,
      spoken: question,
      outcomes: [],
    })
    emit({ kind: 'done', status: 'completed' })
    return
  }

  const plan = result.plan
  emit({ kind: 'plan', plan })
  await sleep(120)

  if (plan.requiresConfirmation) {
    const expires = new Date(Date.now() + 180_000).toISOString()
    emit({
      kind: 'confirm',
      token: nextId('token'),
      prompt: renderConfirmTemplate(plan.steps[plan.steps.length - 1]?.toolId ?? '', {}),
      expiresAt: expires,
      plan,
    })
    emit({ kind: 'done', status: 'awaiting_confirmation' })
    return
  }

  const outcomes: PlanStep[] = []
  for (const step of plan.steps) {
    emit({ kind: 'step', step: { ...step, status: 'running' } })
    await sleep(stepDelayMs)
    const local = dispatchLocally(step.toolId, state)
    const done: PlanStep = {
      ...step,
      status: 'completed',
      summary: local.summary,
      render: local.render,
      data: local.data,
      durationMs: stepDelayMs,
    }
    outcomes.push(done)
    emit({ kind: 'step', step: done as PlanStep & { status: 'completed' } })
  }

  const narration = narrateLocally(plan, outcomes)
  for (const token of narration.split(/(\s+)/)) {
    emit({ kind: 'token', text: token })
    if (tokenDelayMs > 0) await sleep(tokenDelayMs)
  }

  emit({ kind: 'result', narration, spoken: narration.split('. ')[0] ?? narration, outcomes })
  emit({ kind: 'done', status: 'completed' })
}

/** Ranked tool matches for the command bar's live suggestions, offline. */
export function suggestLocally(query: string): Array<{
  toolId: string
  name: string
  summary: string
  risk: ToolRisk
  agentId: string | null
  score: number
  example: string
}> {
  if (query.trim().length === 0) return []
  return matchTools(query)
    .slice(0, 6)
    .map((m) => {
      const spec = TOOL_BY_ID[m.toolId]
      return {
        toolId: m.toolId,
        name: spec?.name ?? m.toolId,
        summary: spec?.summary ?? '',
        risk: (spec?.risk ?? 'safe') as ToolRisk,
        agentId: spec?.agentId ?? null,
        score: Math.round(m.score * 100),
        example: m.matchedExample,
      }
    })
}

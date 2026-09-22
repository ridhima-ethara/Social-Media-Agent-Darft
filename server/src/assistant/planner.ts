/**
 * PLAN — Intent → an ordered list of ToolCalls, each with a declared purpose.
 *
 * Composition rules, in force:
 *   1. Read before write. A mutating plan begins with the safe reads it needs.
 *   2. Smallest sufficient plan. No speculative steps.
 *   3. Multi-step is normal and must work.
 *   4. Risk propagates upward — one irreversible step makes the plan irreversible.
 *   5. The plan is shown before it runs, always, even when it is safe.
 */

import {
  maxRisk,
  renderConfirmTemplate,
  anyStepConfirmsAlways,
  requiresConfirmation,
  TOOL_BY_ID,
  type ToolRisk,
  type ToolSpec,
} from '../../../shared/tool-registry'
import { PLATFORM_LABEL } from '../agents/corpus'
import type { Platform } from '../../../shared/agent-contract'
import type { SituationSnapshot } from './context'
import type { Intent } from './intent'

/* ═══════════════════════════════════════════════════════════════════════════
   THE PLAN
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ToolCall {
  toolId: string
  args: Record<string, unknown>
  /** Why this step exists, in the operator's language. Shown on the step row. */
  why: string
}

export interface Plan {
  id: string
  intent: Intent
  steps: ToolCall[]
  risk: ToolRisk
  /** One sentence, shown before anything runs. */
  summary: string
  requiresConfirmation: boolean
  /** The rendered confirmation prompt, when one is required. */
  confirmPrompt?: string
  /** Steps dropped by the step cap, named so the operator knows. */
  trimmed?: string[]
}

export interface ComposeOptions {
  intent: Intent
  snapshot: SituationSnapshot
  maxSteps: number
  readBeforeWrite: boolean
  explainEveryStep: boolean
  alsoConfirmMutating: boolean
}

/* ═══════════════════════════════════════════════════════════════════════════
   READ-BEFORE-WRITE PRELUDES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The safe reads a mutating tool needs to be correct.
 *
 * These are not decoration: publishing without a brand check would skip the last
 * automated gate before the irreversible act, and moving an idea without reading
 * the calendar would let the operator collide with something already there.
 */
const PRELUDES: Record<string, Array<{ toolId: string; why: string }>> = {
  'idea.publish': [
    { toolId: 'idea.list', why: 'Confirm which post you mean and what state it is in' },
    { toolId: 'brand.check', why: 'Run the twenty-rule compliance check before anything goes out' },
  ],
  'idea.approve.leadership': [
    { toolId: 'idea.list', why: 'Confirm the post and that Marketing has already approved it' },
    { toolId: 'brand.check', why: 'Check it against the brand rules one last time' },
  ],
  'idea.approve.marketing': [
    { toolId: 'idea.list', why: 'Confirm which post is being approved' },
  ],
  'idea.reject.leadership': [
    { toolId: 'idea.list', why: 'Confirm which post is being rejected' },
  ],
  'idea.move': [{ toolId: 'idea.list', why: 'Read the week so the new slot does not collide' }],
  'idea.promote': [
    { toolId: 'idea.list', why: 'Read the platform’s current top ten to see what would be displaced' },
  ],
  'idea.demote': [{ toolId: 'idea.list', why: 'Read the current calendar slot' }],
  'draft.generate': [{ toolId: 'idea.list', why: 'Find the idea to write for' }],
  'draft.instruct': [{ toolId: 'idea.list', why: 'Locate the draft being revised' }],
  'image.render': [{ toolId: 'idea.list', why: 'Locate the post the creative belongs to' }],
  'review.resolve': [{ toolId: 'review.queue.list', why: 'Read the queue to identify the item' }],
  'hashtag.verdict.set': [
    { toolId: 'hashtag.list', why: 'Find the hashtag and read its current verdict' },
  ],
  'keyword.update': [{ toolId: 'keyword.list', why: 'Read the keyword set to find the one to change' }],
  'knowledge.toggle': [{ toolId: 'knowledge.search', why: 'Locate the entry' }],
  'skill.configure': [{ toolId: 'agent.status', why: 'Read the agent’s current state before changing a knob' }],
}

/**
 * Follow-on reads that make a mutating result legible. A publish is only
 * meaningful once its explanation exists.
 */
const FOLLOW_ONS: Record<string, Array<{ toolId: string; why: string }>> = {
  'pipeline.run': [
    { toolId: 'keyword.trending', why: 'Report which keywords came out on top' },
    { toolId: 'hashtag.top', why: 'Report the consolidated hashtag set' },
  ],
  'knowledge.build': [
    { toolId: 'knowledge.search', why: 'Show a sample of what was written' },
  ],
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPOSITION
   ═══════════════════════════════════════════════════════════════════════════ */

export function composePlan(opts: ComposeOptions): Plan {
  const { intent, snapshot } = opts
  const id = `plan_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`

  const tool = TOOL_BY_ID[intent.action]
  if (!tool) {
    // 'answer' | 'clarify' | 'chitchat' — a conversational turn with no steps.
    return {
      id,
      intent,
      steps: [],
      risk: 'safe',
      summary: intent.restated,
      requiresConfirmation: false,
    }
  }

  const steps: ToolCall[] = []

  /* ── 1 · Read before write ─────────────────────────────────────────────── */
  if (opts.readBeforeWrite && tool.risk !== 'safe') {
    for (const prelude of PRELUDES[tool.id] ?? []) {
      const preludeTool = TOOL_BY_ID[prelude.toolId]
      if (!preludeTool || preludeTool.risk !== 'safe') continue
      steps.push({
        toolId: prelude.toolId,
        args: narrowArgs(preludeTool, intent.entities),
        why: prelude.why,
      })
    }
  }

  /* ── 2 · The act itself ────────────────────────────────────────────────── */
  steps.push({
    toolId: tool.id,
    args: narrowArgs(tool, intent.entities),
    why: opts.explainEveryStep ? whyFor(tool, intent, snapshot) : tool.summary,
  })

  /* ── 3 · Follow-on reads that make the result legible ──────────────────── */
  for (const follow of FOLLOW_ONS[tool.id] ?? []) {
    const followTool = TOOL_BY_ID[follow.toolId]
    if (!followTool || followTool.risk !== 'safe') continue
    steps.push({
      toolId: follow.toolId,
      args: narrowArgs(followTool, intent.entities),
      why: follow.why,
    })
  }

  /* ── 4 · The step cap ──────────────────────────────────────────────────── */
  const cap = Math.max(1, opts.maxSteps)
  let trimmed: string[] = []
  let kept = steps

  if (steps.length > cap) {
    // The act itself is never trimmed. Reads around it are.
    const actIndex = steps.findIndex((s) => s.toolId === tool.id)
    const act = steps[actIndex] as ToolCall
    const preludeSteps = steps.slice(0, actIndex)
    const followSteps = steps.slice(actIndex + 1)

    const room = cap - 1
    const keptPreludes = preludeSteps.slice(Math.max(0, preludeSteps.length - room))
    const remaining = room - keptPreludes.length
    const keptFollows = followSteps.slice(0, Math.max(0, remaining))

    kept = [...keptPreludes, act, ...keptFollows]
    trimmed = steps
      .filter((s) => !kept.includes(s))
      .map((s) => TOOL_BY_ID[s.toolId]?.name ?? s.toolId)
  }

  /* ── 5 · Risk propagates upward ────────────────────────────────────────── */
  const risk = maxRisk(kept.map((s) => TOOL_BY_ID[s.toolId]?.risk ?? 'safe'))
  /*
   * A calendar edit is reversible, so its risk class stays `mutating` — calling
   * it irreversible to force the gate would put it in the same class as
   * publishing and make that class mean nothing.
   *
   * But reversible is not harmless. "Move all LinkedIn posts to mornings"
   * rewrites a week in one step, and nobody can picture its blast radius from
   * the sentence. So those tools declare `confirmsAlways` and reach the gate on
   * their own terms, with the exact before/after in front of the operator.
   */
  const needsConfirm =
    requiresConfirmation(risk, opts.alsoConfirmMutating) ||
    anyStepConfirmsAlways(kept.map((s) => s.toolId))

  const plan: Plan = {
    id,
    intent,
    steps: kept,
    risk,
    summary: summarise(tool, intent, snapshot),
    requiresConfirmation: needsConfirm,
    ...(trimmed.length > 0 ? { trimmed } : {}),
  }

  if (needsConfirm) {
    plan.confirmPrompt = renderConfirmPrompt(kept, intent, snapshot)
  }

  return plan
}

/* ═══════════════════════════════════════════════════════════════════════════
   ARGUMENT NARROWING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Passes through only the keys a tool declares, so a `platform` extracted for
 * the act does not leak into a read that means something else by it.
 */
function narrowArgs(tool: ToolSpec, entities: Record<string, unknown>): Record<string, unknown> {
  const shape = (tool.args as unknown as { shape?: Record<string, unknown> }).shape
  if (!shape) return {}
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(shape)) {
    if (entities[key] !== undefined) out[key] = entities[key]
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   LANGUAGE
   ═══════════════════════════════════════════════════════════════════════════ */

function whyFor(tool: ToolSpec, intent: Intent, snapshot: SituationSnapshot): string {
  const e = intent.entities

  switch (tool.id) {
    case 'pipeline.run': {
      const scope = Array.isArray(e.keywords)
        ? `${(e.keywords as string[]).length} named keyword(s)`
        : `${snapshot.counts.activeKeywords} active keywords`
      return `Run discovery across ${scope}, through Scraping, Validation, Analysis and Calendar`
    }
    case 'keyword.trending':
      return 'Read the current trending set with its scores and reasons'
    case 'review.queue.list':
      return `Read the ${snapshot.counts.reviewQueue} item(s) waiting on a verdict`
    case 'idea.list':
      return e.day
        ? `Read what is scheduled for ${e.day}`
        : `Read the ${snapshot.counts.scheduledThisWeek} post(s) on this week's calendar`
    case 'draft.generate':
      return `Write the ${e.platform ? PLATFORM_LABEL[e.platform as Platform] : 'platform'} caption, grounded in the Knowledge Base`
    case 'draft.instruct':
      return `Apply “${String(e.instruction ?? '').slice(0, 60)}” to the draft`
    case 'image.render':
      return 'Render the creative — vector brand layer over an optional painted background'
    case 'idea.publish':
      return `Publish to ${e.platform ? PLATFORM_LABEL[e.platform as Platform] : 'the platform'} now`
    case 'idea.approve.leadership':
      return 'Give the final approval that releases the post'
    case 'knowledge.build':
      return `Research the top ${e.hashtagCount ?? snapshot.counts.topHashtags} hashtags and write cited entries`
    case 'analytics.compare':
      return 'Compare the period against this account’s own trailing baseline'
    case 'analytics.query':
      return 'Read the reported figures, and say whether the platform has actually reported the period'
    case 'post.explain':
      return 'Explain the post against our own baseline, not an industry figure'
    case 'lineage.trace':
      return 'Trace back to the source item and forward to everything it became'
    case 'skill.configure':
      return `Change ${String(e.key ?? 'the setting')} on ${String(e.skillId ?? 'the skill')}`
    default:
      return tool.summary
  }
}

function summarise(
  tool: ToolSpec,
  intent: Intent,
  snapshot: SituationSnapshot,
): string {
  const e = intent.entities
  const platform = typeof e.platform === 'string' ? PLATFORM_LABEL[e.platform as Platform] : null
  const title = typeof e.title === 'string' ? e.title : null

  switch (tool.id) {
    case 'pipeline.run':
      return `Running the discovery pipeline across ${snapshot.counts.activeKeywords} keywords. I will report as each agent finishes.`
    case 'keyword.trending':
      return 'Reading the trending keyword set with its scores and the evidence behind each.'
    case 'review.queue.list':
      return snapshot.counts.reviewQueue === 0 && snapshot.counts.pendingLeadership === 0
        ? 'Checking what is waiting on you.'
        : `Gathering the ${snapshot.counts.reviewQueue} queue item(s) and ${snapshot.counts.pendingLeadership} post(s) awaiting Leadership.`
    case 'draft.generate':
      return `Writing the ${platform ?? 'platform'} caption${title ? ` for “${title}”` : ''}, grounded in the Knowledge Base.`
    case 'draft.instruct':
      return `Revising the draft: ${String(e.instruction ?? 'as asked')}.`
    case 'idea.publish':
      return `Publishing${title ? ` “${title}”` : ''} to ${platform ?? 'the platform'}. This needs your sign-off first.`
    case 'idea.approve.leadership':
      return `Giving final approval${title ? ` to “${title}”` : ''}. This needs your sign-off first.`
    case 'knowledge.build':
      return `Rebuilding the Knowledge Base from the top ${e.hashtagCount ?? snapshot.counts.topHashtags} hashtags.`
    case 'analytics.compare':
      return `Comparing ${platform ?? 'the platform'} against its own trailing baseline.`
    case 'keyword.add':
      return `Adding “${String(e.term ?? '')}” to the keyword set${e.weight ? ` at weight ${String(e.weight)}` : ''}.`
    case 'lineage.trace':
      return 'Tracing the lineage in both directions.'
    case 'analytics.query': {
      const period = typeof e.month === 'string' ? ` for ${e.month.replace(/_/g, ' ')}` : ''
      const figure = typeof e.metric === 'string' ? e.metric : 'figures'
      return `Reading ${platform ?? 'every platform'}’s ${figure}${period}, with whether the platform has reported the period.`
    }
    case 'report.export':
      return `Preparing the ${platform ?? 'analytics'} export${typeof e.month === 'string' ? ` for ${e.month.replace(/_/g, ' ')}` : ''}.`
    default:
      return intent.restated.trim().length > 0 ? intent.restated : tool.summary
  }
}

/**
 * The confirmation prompt: what will happen, what cannot be undone, and the two
 * answers. Rendered from the tool's own `confirmTemplate`.
 */
/**
 * The confirm card for a calendar change: what is in scope, and what is not.
 *
 * It states the SELECTION rather than a per-post list, because the selection is
 * what the operator can still get wrong — "all LinkedIn posts" and "all
 * LinkedIn posts this week" are different instructions, and the difference is
 * invisible once the moves have happened. Per-post before/after follows on the
 * result, where it is a record rather than a prediction.
 *
 * It also says plainly that the change is reversible. A confirm gate that
 * implies permanence for something that is not is a gate people learn to
 * dismiss.
 */
function renderCalendarPrompt(step: ToolCall, snapshot: SituationSnapshot): string {
  const a = step.args
  const label = (key: string): string | null => (typeof a[key] === 'string' ? (a[key] as string) : null)

  const scope: string[] = []
  const platform = label('platform')
  if (platform) scope.push(`${platform} posts only`)
  const topic = label('topic')
  if (topic) scope.push(`matching “${topic}”`)
  const fromDay = label('fromDay')
  if (fromDay) scope.push(`currently on ${fromDay}`)
  if (scope.length === 0) scope.push('every scheduled post that matches')

  const destination: string[] = []
  const day = label('day')
  if (day) destination.push(`to ${day}`)
  const time = label('time') ?? label('timeOfDay')
  if (time) destination.push(`at ${time}`)
  if (Array.isArray(a.days) && a.days.length > 0) {
    destination.push(`spread across ${(a.days as unknown[]).join(', ')}`)
  }
  const firstDay = label('firstDay')
  const secondDay = label('secondDay')
  if (firstDay && secondDay) destination.push(`swapping ${firstDay} with ${secondDay}`)

  const placed = snapshot.thisWeek.length

  /*
   * TWO CLAUSES, NOT A PARAGRAPH.
   *
   * This card is read with a finger already on Confirm. It previously spent
   * three sentences describing the diff it was about to show and promising to
   * re-read the calendar — both of which the operator then sees happen, so the
   * prose only delayed the thing it was describing. What genuinely cannot be
   * recovered from the buttons is the scope: what moves, and how much.
   * Reversibility stays because it is the reason this is a pause and not a
   * warning.
   */
  return (
    `${scope.join(', ')}${destination.length > 0 ? ' ' + destination.join(' ') : ''}` +
    ` — ${placed} post${placed === 1 ? '' : 's'} on the calendar this week. Reversible.`
  )
}

export function renderConfirmPrompt(
  steps: ToolCall[],
  intent: Intent,
  snapshot: SituationSnapshot,
): string {
  const irreversible = steps.find((s) => TOOL_BY_ID[s.toolId]?.risk === 'irreversible')

  /*
   * A CALENDAR CHANGE GETS ITS OWN PROMPT.
   *
   * The generic line — "This cannot be undone" — would be false for a calendar
   * edit, and a confirm card that overstates what it is asking about teaches an
   * operator to click through confirms without reading them. This names the
   * scope instead, which is the thing actually worth pausing over.
   */
  if (!irreversible) {
    const bulk = steps.find((s) => TOOL_BY_ID[s.toolId]?.confirmsAlways === true)
    if (bulk) return renderCalendarPrompt(bulk, snapshot)
    return 'This cannot be undone. Confirm, or cancel.'
  }

  const args = irreversible.args
  const title =
    (typeof args.title === 'string' ? args.title : null) ??
    (typeof intent.entities.title === 'string' ? intent.entities.title : null) ??
    resolveTitleFromSnapshot(args.id, snapshot) ??
    'this post'

  const platformKey =
    (typeof args.platform === 'string' ? args.platform : null) ??
    (typeof intent.entities.platform === 'string' ? intent.entities.platform : null) ??
    resolvePlatformFromSnapshot(args.id, snapshot) ??
    'linkedin'

  return renderConfirmTemplate(irreversible.toolId, {
    title,
    platform: PLATFORM_LABEL[platformKey as Platform] ?? platformKey,
  })
}

function resolveTitleFromSnapshot(id: unknown, snapshot: SituationSnapshot): string | null {
  if (typeof id !== 'string') return null
  const found =
    snapshot.thisWeek.find((i) => i.id === id) ?? snapshot.awaitingLeadership.find((i) => i.id === id)
  return found?.title ?? null
}

function resolvePlatformFromSnapshot(id: unknown, snapshot: SituationSnapshot): string | null {
  if (typeof id !== 'string') return null
  const found =
    snapshot.thisWeek.find((i) => i.id === id) ?? snapshot.awaitingLeadership.find((i) => i.id === id)
  return found?.platform ?? null
}

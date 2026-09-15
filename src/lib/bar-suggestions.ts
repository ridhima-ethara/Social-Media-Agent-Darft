/**
 * WHAT THE COMMAND BAR OFFERS
 *
 * Five things the command plane can do for the screen the operator is on,
 * each with a cost note and a one-line plan shown before Enter is pressed.
 *
 * Nothing here is invented:
 *
 * - Every utterance is one of the tool registry's own examples, so the
 *   server's grammar resolves it to the same tool this file says it will.
 * - The plan line comes from the in-bundle planner, which shares that
 *   grammar: who does what, in what order, and whether anything publishes.
 * - A cost note is a structural fact (the plan's own confirmation gate, a
 *   read that changes nothing) or a measured one (a free calendar slot
 *   counted from the calendar, the duration of a run timed this session).
 *   Where nothing is measured, nothing is claimed.
 */

import { planLocally } from './assistant'
import { requiresConfirmation } from '../../shared/tool-registry'
import { PLATFORMS } from '../../shared/agent-contract'
import { agentDisplayName } from '../components/orchestration-diagram'
import type { Idea, Keyword, PageId } from '../types'

export type BarKind = 'ask' | 'do' | 'gate' | 'open'

export interface BarSuggestion {
  id: string
  /** The exact utterance that will be sent, or the thing that will be opened. */
  label: string
  kind: BarKind
  /** The mono note on the right: ASK · STOPS TO CONFIRM · FREE SLOT · ~4 MIN · ↗ */
  note: string
  /** One line: who does what, in order, and whether it publishes. */
  plan: string
  /** For `open` suggestions: the client-side destination. Runs no tool. */
  nav?: { page?: PageId; reviewId?: string; theater?: boolean }
}

export interface BarContext {
  page: PageId
  ideas: Idea[]
  keywords: Keyword[]
  topPerPlatform: number
  confirmMutating: boolean
  /** Seconds the last pipeline run took, if one was timed in this session. */
  lastRunSeconds: number | null
  reviewIdeaId: string | null
}

const PUBLISHING_TOOLS = new Set(['idea.publish', 'idea.approve.leadership'])

/** A primary slot still open on at least one platform, counted from the calendar itself. */
function freeSlot(ctx: BarContext): boolean {
  return PLATFORMS.some((platform) => {
    const taken = ctx.ideas.filter(
      (i) => i.platform === platform && i.calendar_slot === 'primary' && i.status !== 'rejected',
    ).length
    return taken < ctx.topPerPlatform
  })
}

/**
 * What an utterance would do, before it is sent. Uses the same grammar the
 * server falls back to, so the preview and the plan card agree.
 */
export function describeUtterance(text: string, ctx: BarContext): Pick<BarSuggestion, 'kind' | 'note' | 'plan'> {
  const utterance = text.trim()
  if (utterance.length === 0) return { kind: 'ask', note: '', plan: '' }
  const result = planLocally(utterance)
  const plan = result.plan
  if (!plan) {
    const options = result.clarify?.options ?? []
    return {
      kind: 'ask',
      note: 'ASK',
      plan:
        options.length > 0
          ? `No single tool matches. Ethara will ask which you meant: ${options.map((o) => o.label.toLowerCase()).join(' or ')}.`
          : 'No tool matches this. Ethara will say so rather than guess.',
    }
  }
  const chain = plan.steps
    .map((step) => `${step.agentId ? agentDisplayName(step.agentId) : 'Ethara'} · ${step.toolName.toLowerCase()}`)
    .join(' → ')
  const publishes = plan.steps.some((s) => PUBLISHING_TOOLS.has(s.toolId))
  const gate = requiresConfirmation(plan.risk, ctx.confirmMutating)
  const tail = `.${publishes ? ' May publish.' : ' Publishes nothing.'}${gate ? ' Stops to confirm first.' : ''}`
  const lead = plan.steps[0]?.toolId

  if (gate) return { kind: 'gate', note: 'STOPS TO CONFIRM', plan: chain + tail }
  if (plan.risk === 'safe') return { kind: 'ask', note: 'ASK', plan: chain + tail }
  if (lead === 'pipeline.run') {
    return {
      kind: 'do',
      note: ctx.lastRunSeconds === null ? 'RUNS THE PIPELINE' : `~${Math.max(1, Math.round(ctx.lastRunSeconds / 60))} MIN · LAST RUN`,
      plan: chain + tail,
    }
  }
  if (lead === 'idea.promote') return { kind: 'do', note: freeSlot(ctx) ? 'FREE SLOT' : 'NO FREE SLOT', plan: chain + tail }
  return { kind: 'do', note: 'CHANGES STATE', plan: chain + tail }
}

function utterance(id: string, label: string, ctx: BarContext): BarSuggestion {
  return { id, label, ...describeUtterance(label, ctx) }
}

function weekday(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'long' })
}

/** The next drafted post on the calendar, in slot order. */
function nextDraft(ctx: BarContext): Idea | undefined {
  return [...ctx.ideas]
    .filter((i) => i.status === 'drafted' && i.calendar_slot === 'primary')
    .sort((a, b) => `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time}`))[0]
}

function openReview(ctx: BarContext): BarSuggestion | null {
  const next = nextDraft(ctx)
  if (!next) return null
  return {
    id: `open-review-${next.id}`,
    label: `Open the review panel for ${weekday(next.scheduled_date)}`,
    kind: 'open',
    note: '↗',
    plan: `Opens “${next.title.length > 64 ? `${next.title.slice(0, 64)}…` : next.title}”. Runs nothing.`,
    nav: { reviewId: next.id },
  }
}

function openPage(page: PageId, label: string, what: string): BarSuggestion {
  return { id: `open-${page}`, label, kind: 'open', note: '↗', plan: `Opens ${what}. Runs nothing.`, nav: { page } }
}

/** Five things for this screen, ranked. Empty query only; a typed query is matched by the grammar instead. */
export function screenSuggestions(ctx: BarContext): BarSuggestion[] {
  const term = ctx.keywords.find((k) => k.active)?.term
  const hasSuggestion = ctx.ideas.some((i) => i.calendar_slot === 'suggestion' && i.status !== 'rejected')
  const list: Array<BarSuggestion | null> = []

  switch (ctx.page) {
    case 'dashboard':
      list.push(
        utterance('run', 'run discovery', ctx),
        utterance('waiting', 'what is waiting on me', ctx),
        utterance('explain-run', 'explain the last run', ctx),
        utterance('trending', 'what is trending this week', ctx),
        openReview(ctx),
      )
      break
    case 'calendar':
      list.push(
        hasSuggestion ? utterance('promote', 'promote that suggestion to the calendar', ctx) : null,
        utterance('on-calendar', 'what is on the calendar', ctx),
        ctx.reviewIdeaId ? utterance('brand', 'check this against the brand rules', ctx) : null,
        utterance('reshuffle', 'reshuffle the calendar', ctx),
        openReview(ctx),
        utterance('waiting', 'what is waiting on me', ctx),
      )
      break
    case 'published':
      list.push(
        utterance('beat', "why did tuesday's post beat thursday's", ctx),
        utterance('compare', 'compare this month to last month', ctx),
        utterance('reach', 'what was linkedin reach last month', ctx),
        utterance('export', 'export the analytics', ctx),
        openPage('calendar', 'Open the weekly calendar', 'the weekly calendar'),
      )
      break
    case 'intelligence':
      list.push(
        utterance('trending', 'what is trending this week', ctx),
        utterance('hashtags', 'show me the top 25 hashtags', ctx),
        utterance('waiting', 'what is waiting on me', ctx),
        utterance('explain-run', 'explain the last run', ctx),
        utterance('run', 'run discovery', ctx),
      )
      break
    case 'leadership':
      list.push(
        utterance('waiting', 'what is waiting on me', ctx),
        ctx.reviewIdeaId ? utterance('lineage', 'where did this post come from', ctx) : null,
        ctx.reviewIdeaId ? utterance('brand', 'check this against the brand rules', ctx) : null,
        utterance('on-calendar', 'what is on the calendar', ctx),
        utterance('agents', 'how are the agents doing', ctx),
        openPage('calendar', 'Open the weekly calendar', 'the weekly calendar'),
      )
      break
    default:
      list.push(
        utterance('agents', 'how are the agents doing', ctx),
        utterance('status', 'is the pipeline running', ctx),
        utterance('explain-run', 'explain the last run', ctx),
        term ? utterance('know', `what do we know about ${term}`, ctx) : null,
        openPage('dashboard', 'Open the dashboard', 'the dashboard'),
      )
  }

  return list.filter((s): s is BarSuggestion => s !== null).slice(0, 5)
}

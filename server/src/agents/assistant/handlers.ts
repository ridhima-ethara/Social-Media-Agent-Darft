/**
 * THE COMMAND PLANE'S OWN SKILLS — stage `command`
 *
 * The twelve stages of the command loop, declared and executed exactly like any
 * other agent's skills. Ethara is not special-cased in the runtime, so every
 * knob it reads is visible in Agent Studio and every execution writes a
 * `skill_runs` row with its resolved config.
 *
 * The implementations live in `server/src/assistant/*`; these handlers are the
 * registry's contract over them.
 */

import type { OperatorRole } from '../../../../shared/agent-contract'
import { spokenSummary } from '../../../../shared/assistant-persona'
import { assembleSnapshot } from '../../assistant/context'
import { parseIntent } from '../../assistant/intent'
import { composePlan } from '../../assistant/planner'
import { gatePlan } from '../../assistant/confirm'
import { dispatchPlan, verifyOutcomes } from '../../assistant/dispatch'
import { narratePlan, narrateResult, tokenise } from '../../assistant/narrator'
import { composeBrief, sweepForNotices } from '../../assistant/watch'
import { insertKnowledgeEntry, listKnowledge } from '../../db/repo'
import { similarity } from '../corpus'
import { registerSkill } from '../runtime'

/** What a Ethara skill run threads between stages. */
interface AssistantPayload extends Record<string, unknown> {
  utterance?: string
  actor?: string
  role?: OperatorRole
  conversationId?: string
  turnId?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · assistant.context.assemble
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.context.assemble', async (payload, ctx) => {
  const snapshot = await assembleSnapshot({
    workspaceId: ctx.workspaceId,
    operator: {
      name: payload.actor ?? 'Operator',
      role: payload.role ?? 'marketing',
    },
    ...(payload.conversationId ? { conversationId: payload.conversationId } : {}),
    historyTurns: ctx.num('historyTurns', 12),
    includeKnowledge: ctx.bool('includeKnowledge', true),
    maxSnapshotChars: ctx.num('maxSnapshotChars', 6000),
  })

  ctx.log(
    `Snapshot assembled · ${snapshot.counts.reviewQueue} in the queue, ${snapshot.counts.pendingLeadership} with Leadership, ` +
      `${snapshot.counts.activeKnowledge} active entries, ${snapshot.text.length} characters of context`,
  )

  return { snapshot }
})

/* ═══════════════════════════════════════════════════════════════════════════
   2 · assistant.intent.parse
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.intent.parse', async (payload, ctx) => {
  const utterance = payload.utterance ?? ''
  if (utterance.trim().length === 0) {
    throw new Error('There is no utterance to parse.')
  }

  const snapshot =
    (payload.snapshot as Awaited<ReturnType<typeof assembleSnapshot>> | undefined) ??
    (await assembleSnapshot({
      workspaceId: ctx.workspaceId,
      operator: { name: payload.actor ?? 'Operator', role: payload.role ?? 'marketing' },
      historyTurns: 0,
      includeKnowledge: false,
      maxSnapshotChars: 4000,
    }))

  const intent = await parseIntent({
    workspaceId: ctx.workspaceId,
    utterance,
    snapshot,
    clarifyThreshold: ctx.num('clarifyThreshold', 55),
    minConfidence: ctx.num('minConfidence', 35),
    useModel: ctx.bool('useModel', true),
    synonymsEnabled: ctx.bool('synonymsEnabled', true),
  })

  ctx.log(
    `“${utterance}” → ${intent.action} at ${intent.confidence}% via the ${intent.parser} parser` +
      (intent.missing && intent.missing.length > 0 ? ` · missing ${intent.missing.join(', ')}` : ''),
  )

  return { intent, snapshot }
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · assistant.plan.compose
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.plan.compose', (payload, ctx) => {
  const intent = payload.intent as Parameters<typeof composePlan>[0]['intent'] | undefined
  const snapshot = payload.snapshot as Parameters<typeof composePlan>[0]['snapshot'] | undefined
  if (!intent || !snapshot) throw new Error('There is no intent to plan from.')

  const plan = composePlan({
    intent,
    snapshot,
    maxSteps: ctx.num('maxSteps', 8),
    readBeforeWrite: ctx.bool('readBeforeWrite', true),
    explainEveryStep: ctx.bool('explainEveryStep', true),
    alsoConfirmMutating: false,
  })

  ctx.log(
    `${plan.steps.length} step(s), risk ${plan.risk}${plan.requiresConfirmation ? ' — needs a confirmation' : ''}`,
  )

  return { plan }
})

/* ═══════════════════════════════════════════════════════════════════════════
   4 · assistant.confirm.gate — CANNOT BE DISABLED
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.confirm.gate', async (payload, ctx) => {
  const plan = payload.plan as Parameters<typeof gatePlan>[1] | undefined
  const turnId = payload.turnId
  if (!plan) throw new Error('There is no plan to gate.')

  if (ctx.bool('alsoConfirmMutating', false) && plan.risk === 'mutating') {
    plan.requiresConfirmation = true
    plan.confirmPrompt =
      plan.confirmPrompt ??
      `This runs ${plan.steps.length} step(s) and changes state: ${plan.summary} Confirm, or cancel.`
  }

  if (!plan.requiresConfirmation) {
    ctx.log('Nothing irreversible in this plan — no confirmation needed')
    return { gate: { blocked: false } }
  }

  if (!turnId) throw new Error('A confirmation needs a turn to attach to.')

  const gate = await gatePlan(turnId, plan, ctx.num('ttlSeconds', 180))
  ctx.log(`Held for confirmation · token valid ${ctx.num('ttlSeconds', 180)}s`)

  return { gate }
})

/* ═══════════════════════════════════════════════════════════════════════════
   5 · assistant.tool.dispatch
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.tool.dispatch', async (payload, ctx) => {
  const plan = payload.plan as Parameters<typeof dispatchPlan>[0]['plan'] | undefined
  const turnId = payload.turnId
  if (!plan || !turnId) throw new Error('There is no plan to dispatch.')

  const gate = payload.gate as { blocked?: boolean } | undefined
  if (gate?.blocked) {
    ctx.log('Dispatch held at the confirmation gate — nothing was executed')
    return { outcomes: [] }
  }

  const result = await dispatchPlan({
    turnId,
    plan,
    ctx: {
      workspaceId: ctx.workspaceId,
      actor: payload.actor ?? 'Operator',
      role: payload.role ?? 'marketing',
      trigger: 'assistant',
      turnId,
    },
    stepTimeoutMs: ctx.num('stepTimeoutMs', 60_000),
    haltOnStepFailure: ctx.bool('haltOnStepFailure', true),
  })

  const completed = result.outcomes.filter((o) => o.status === 'completed').length
  ctx.log(
    `${completed} of ${result.outcomes.length} step(s) completed` +
      (result.status === 'failed' ? ` · halted at step ${(result.failedAt ?? 0) + 1}` : ''),
  )

  return { outcomes: result.outcomes, dispatchStatus: result.status, lastEntity: result.lastEntity }
})

/* ═══════════════════════════════════════════════════════════════════════════
   6 · assistant.narrate.stream
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.narrate.stream', async (payload, ctx) => {
  const plan = payload.plan as Parameters<typeof narratePlan>[0] | undefined
  const outcomes = (payload.outcomes as Parameters<typeof verifyOutcomes>[0] | undefined) ?? []
  const snapshot = payload.snapshot as Parameters<typeof assembleSnapshot> extends never
    ? never
    : Awaited<ReturnType<typeof assembleSnapshot>> | undefined

  if (!plan || !snapshot) throw new Error('There is nothing to narrate.')

  const options = {
    verbosity: ctx.str('verbosity', 'normal') as 'terse' | 'normal' | 'detailed',
    speakSummaryOnly: ctx.bool('speakSummaryOnly', true),
    tokenDelayMs: ctx.num('tokenDelayMs', 18),
    maxSpokenChars: 320,
  }

  const acknowledgement = narratePlan(plan, options)
  const result = await narrateResult({ plan, outcomes, snapshot, options })

  ctx.log(
    `Narration written by ${result.source === 'model' ? 'the reasoning model' : 'the template narrator'} · ${tokenise(result.text).length} tokens`,
  )

  return {
    acknowledgement,
    narration: result.text,
    spoken: result.spoken,
    narrationSource: result.source,
    ...(result.fallbackReason === undefined ? {} : { narrationFallbackReason: result.fallbackReason }),
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   7 · assistant.result.verify
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.result.verify', (payload, ctx) => {
  if (!ctx.bool('enabled', true)) return {}

  const outcomes = (payload.outcomes as Parameters<typeof verifyOutcomes>[0] | undefined) ?? []
  const verification = verifyOutcomes(outcomes, ctx.bool('strict', false))

  ctx.log(
    verification.note ??
      `${verification.findings.length} postcondition(s) checked, all satisfied`,
  )

  if (verification.note && ctx.bool('strict', false)) {
    throw new Error(verification.note)
  }

  return { verification }
})

/* ═══════════════════════════════════════════════════════════════════════════
   8 · assistant.memory.write
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.memory.write', async (payload, ctx) => {
  const learnAfter = ctx.num('learnAfterCorrections', 2)
  const askBeforeSaving = ctx.bool('askBeforeSaving', true)

  const utterance = payload.utterance ?? ''
  if (utterance.trim().length === 0) return { preference: null }

  // A durable preference is extracted only when the operator has corrected
  // Ethara on the same thing more than once.
  const history = await listKnowledge(ctx.workspaceId, {
    activeOnly: true,
    category: 'User Feedback',
    limit: 60,
  })

  const echoes = history.filter((row) => similarity(row.content, utterance) >= 0.6).length
  const occurrences = echoes + 1

  if (occurrences < learnAfter) {
    ctx.log(`Turn recorded. “${utterance.slice(0, 40)}” seen ${occurrences} time(s); a preference is offered at ${learnAfter}`)
    return { preference: null }
  }

  const candidate = {
    title: `Preference: ${utterance.slice(0, 56)}`,
    content: `The operator has asked for this ${occurrences} times: “${utterance}”.`,
    category: 'User Feedback',
  }

  if (askBeforeSaving) {
    ctx.log(`Preference offered after ${occurrences} occurrences — awaiting the operator's answer`)
    return { preference: candidate }
  }

  await insertKnowledgeEntry({
    workspaceId: ctx.workspaceId,
    title: candidate.title,
    category: candidate.category,
    content: candidate.content,
    source: 'Ethara · learned from repetition',
    sources: [],
    hashtagId: null,
    confidence: 'Medium',
    origin: 'assistant',
    buildId: null,
    tags: ['preference'],
  })

  ctx.log(`Preference saved after ${occurrences} occurrences`)
  return { preference: null }
})

/* ═══════════════════════════════════════════════════════════════════════════
   9 · assistant.brief.compose
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.brief.compose', async (payload, ctx) => {
  const brief = await composeBrief(ctx.workspaceId, {
    trigger: payload.trigger === 'cron' ? 'cron' : 'manual',
    role: payload.role ?? 'marketing',
    changesToReport: ctx.num('changesToReport', 3),
    includeRecommendation: ctx.bool('includeRecommendation', true),
  })

  ctx.log(`Briefing composed · ${brief.signals.length} change(s)${brief.recommendation ? ' and one recommendation' : ''}`)

  return { brief }
})

/* ═══════════════════════════════════════════════════════════════════════════
   10 · assistant.anomaly.watch
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.anomaly.watch', async (_payload, ctx) => {
  const notices = await sweepForNotices(ctx.workspaceId, {
    anomalySigma: ctx.num('anomalySigma', 1.5),
    queueAgeMinutes: ctx.num('queueAgeMinutes', 30),
    approvalAgeHours: ctx.num('approvalAgeHours', 6),
    minPerWeek: ctx.num('minPerWeek', 3),
  })

  ctx.log(
    notices.length === 0
      ? 'Nothing worth saying unprompted'
      : `${notices.length} ambient notice(s): ${notices.map((n) => n.signal).join(', ')}`,
  )

  return { notices }
})

/* ═══════════════════════════════════════════════════════════════════════════
   11 · assistant.voice.transcribe
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.voice.transcribe', (payload, ctx) => {
  if (!ctx.bool('enabled', true)) return { spoken: '' }

  const narration = typeof payload.narration === 'string' ? payload.narration : ''
  const spoken = spokenSummary(narration, ctx.num('maxSpokenChars', 320))

  ctx.log(
    spoken.length === 0
      ? 'Nothing to speak'
      : `Spoken summary shaped to ${spoken.length} characters — the browser does the audio`,
  )

  return { spoken }
})

/* ═══════════════════════════════════════════════════════════════════════════
   12 · assistant.handoff.route
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AssistantPayload>('assistant.handoff.route', (payload, ctx) => {
  const trigger = ctx.str('recordAsTrigger', 'assistant')
  const outcomes = (payload.outcomes as Array<{ toolId: string }> | undefined) ?? []

  // Nothing to do beyond recording the label: the tool handlers already route
  // through the one orchestrator, which is what makes an operator-triggered run
  // indistinguishable from a scheduled one.
  ctx.log(
    outcomes.length === 0
      ? `No hand-off to route · runs would be recorded as “${trigger}”`
      : `${outcomes.length} step(s) routed to their owning agents, recorded as “${trigger}”`,
  )

  return { handoffTrigger: trigger }
})

/**
 * THE COMMAND LOOP
 *
 * perceive → interpret → plan → confirm → dispatch → narrate → verify → remember
 *
 * Every stage is a declared skill in the registry with its own knobs, and every
 * stage is persisted. Ethara is not special-cased in the runtime: the same
 * `runSkill` path that executes a scraping skill executes these.
 */

import type { OperatorRole } from '../../../shared/agent-contract'
import { defaultSkillConfig, SKILL_BY_ID } from '../../../shared/agent-registry'
import { TOOL_BY_ID } from '../../../shared/tool-registry'
import {
  enforceAssistantVoice,
  NARRATION_TEMPLATES,
  pickOpener,
  renderTemplate,
  spokenSummary,
} from '../../../shared/assistant-persona'
import { config } from '../config'
import { publish } from '../events'
import {
  insertTurn,
  listSteps,
  listTurns,
  nextTurnSeq,
  resolveConversation,
  touchConversation,
  updateTurn,
} from '../db/assistant-repo'
import { listSkillOverrides } from '../db/repo'
import { assembleSnapshot, type SituationSnapshot } from './context'
import { clarifyQuestion, missingArgQuestion, parseIntent, type Intent } from './intent'
import { composePlan, type Plan } from './planner'
import { gatePlan, redeemConfirmation } from './confirm'
import { dispatchPlan, verifyOutcomes, type StepOutcome } from './dispatch'
import {
  narratePlan,
  narrateResult,
  tokenise,
  type NarratorOptions,
  type Verbosity,
} from './narrator'
import type { ToolContext } from './tools/index'

/* ═══════════════════════════════════════════════════════════════════════════
   THE FRAME VOCABULARY — what a client receives
   ═══════════════════════════════════════════════════════════════════════════ */

export type CommandFrame =
  | { kind: 'turn'; turnId: string; conversationId: string; seq: number }
  | { kind: 'intent'; intent: Intent }
  | { kind: 'plan'; plan: SerialisedPlan }
  | { kind: 'confirm'; token: string; prompt: string; expiresAt: string; plan: SerialisedPlan }
  | { kind: 'step'; step: StepOutcome }
  | { kind: 'token'; text: string }
  | { kind: 'result'; narration: string; spoken: string; outcomes: StepOutcome[] }
  | { kind: 'verify'; note: string }
  | { kind: 'done'; status: 'completed' | 'failed' | 'awaiting_confirmation' | 'cancelled' }
  | { kind: 'error'; message: string }

export interface SerialisedPlan {
  id: string
  summary: string
  risk: string
  requiresConfirmation: boolean
  restated: string
  confidence: number
  parser: string
  parserReason?: string
  steps: Array<{ idx: number; toolId: string; toolName: string; risk: string; why: string; agentId: string | null }>
  trimmed?: string[]
}

function serialisePlan(plan: Plan): SerialisedPlan {
  return {
    id: plan.id,
    summary: plan.summary,
    risk: plan.risk,
    requiresConfirmation: plan.requiresConfirmation,
    restated: plan.intent.restated,
    confidence: plan.intent.confidence,
    parser: plan.intent.parser,
    ...(plan.intent.parserReason === undefined ? {} : { parserReason: plan.intent.parserReason }),
    steps: plan.steps.map((s, idx) => ({
      idx,
      toolId: s.toolId,
      toolName: TOOL_BY_ID[s.toolId]?.name ?? s.toolId,
      risk: TOOL_BY_ID[s.toolId]?.risk ?? 'safe',
      why: s.why,
      agentId: TOOL_BY_ID[s.toolId]?.agentId ?? null,
    })),
    ...(plan.trimmed === undefined ? {} : { trimmed: plan.trimmed }),
  }
}

export type FrameSink = (frame: CommandFrame) => void

/* ═══════════════════════════════════════════════════════════════════════════
   RESOLVED KNOBS
   ═══════════════════════════════════════════════════════════════════════════ */

interface AssistantKnobs {
  historyTurns: number
  includeKnowledge: boolean
  maxSnapshotChars: number
  clarifyThreshold: number
  minConfidence: number
  useModel: boolean
  synonymsEnabled: boolean
  maxSteps: number
  readBeforeWrite: boolean
  explainEveryStep: boolean
  ttlSeconds: number
  alsoConfirmMutating: boolean
  stepTimeoutMs: number
  haltOnStepFailure: boolean
  verbosity: Verbosity
  speakSummaryOnly: boolean
  tokenDelayMs: number
  verifyEnabled: boolean
  verifyStrict: boolean
  learnAfterCorrections: number
  askBeforeSaving: boolean
  maxSpokenChars: number
  recordAsTrigger: string
}

/**
 * Resolves every Ethara knob through the same layering the runtime uses:
 * registry default < workspace override < environment.
 */
async function resolveKnobs(workspaceId: string): Promise<AssistantKnobs> {
  const overrides = await listSkillOverrides(workspaceId).catch(() => new Map())

  function get(skillId: string, key: string): unknown {
    const spec = SKILL_BY_ID[skillId]
    if (!spec) return undefined
    const base = defaultSkillConfig(skillId)
    const row = overrides.get(skillId)
    const stored = (row?.config ?? {}) as Record<string, unknown>
    return stored[key] !== undefined ? stored[key] : base[key]
  }

  const num = (skillId: string, key: string, fallback: number): number => {
    const v = get(skillId, key)
    const n = typeof v === 'number' ? v : Number(v)
    return Number.isFinite(n) ? n : fallback
  }
  const bool = (skillId: string, key: string, fallback: boolean): boolean => {
    const v = get(skillId, key)
    return typeof v === 'boolean' ? v : fallback
  }
  const str = (skillId: string, key: string, fallback: string): string => {
    const v = get(skillId, key)
    return typeof v === 'string' ? v : fallback
  }

  return {
    historyTurns: Math.min(num('assistant.context.assemble', 'historyTurns', 12), config.assistant.historyTurns),
    includeKnowledge: bool('assistant.context.assemble', 'includeKnowledge', true),
    maxSnapshotChars: num('assistant.context.assemble', 'maxSnapshotChars', 6000),
    clarifyThreshold: num('assistant.intent.parse', 'clarifyThreshold', 55),
    minConfidence: num('assistant.intent.parse', 'minConfidence', 35),
    useModel: bool('assistant.intent.parse', 'useModel', true),
    synonymsEnabled: bool('assistant.intent.parse', 'synonymsEnabled', true),
    // The environment caps the registry: an operator cannot raise the plan size
    // above what the deployment allows.
    maxSteps: Math.min(num('assistant.plan.compose', 'maxSteps', 8), config.assistant.maxPlanSteps),
    readBeforeWrite: bool('assistant.plan.compose', 'readBeforeWrite', true),
    explainEveryStep: bool('assistant.plan.compose', 'explainEveryStep', true),
    ttlSeconds: num('assistant.confirm.gate', 'ttlSeconds', config.assistant.confirmTtlSeconds),
    alsoConfirmMutating: bool('assistant.confirm.gate', 'alsoConfirmMutating', false),
    stepTimeoutMs: num('assistant.tool.dispatch', 'stepTimeoutMs', 60_000),
    haltOnStepFailure: bool('assistant.tool.dispatch', 'haltOnStepFailure', true),
    verbosity: str('assistant.narrate.stream', 'verbosity', 'normal') as Verbosity,
    speakSummaryOnly: bool('assistant.narrate.stream', 'speakSummaryOnly', true),
    tokenDelayMs: num('assistant.narrate.stream', 'tokenDelayMs', 18),
    verifyEnabled: bool('assistant.result.verify', 'enabled', true),
    verifyStrict: bool('assistant.result.verify', 'strict', false),
    learnAfterCorrections: num('assistant.memory.write', 'learnAfterCorrections', 2),
    askBeforeSaving: bool('assistant.memory.write', 'askBeforeSaving', true),
    maxSpokenChars: num('assistant.voice.transcribe', 'maxSpokenChars', 320),
    recordAsTrigger: str('assistant.handoff.route', 'recordAsTrigger', 'assistant'),
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   runCommand
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RunCommandOptions {
  workspaceId: string
  utterance: string
  channel: 'text' | 'voice' | 'ambient' | 'cron'
  conversationId?: string
  actor: string
  role: OperatorRole
  /**
   * What the operator was looking at. Lets a screen-embedded surface resolve
   * "this post" without asking, and is ignored once the conversation has its own
   * referenced entity.
   */
  focus?: Record<string, unknown> | null
  /** Streams frames as they happen. */
  emit: FrameSink
}

export interface RunCommandResult {
  turnId: string
  conversationId: string
  status: 'completed' | 'failed' | 'awaiting_confirmation' | 'cancelled'
  narration: string
  outcomes: StepOutcome[]
}

export async function runCommand(opts: RunCommandOptions): Promise<RunCommandResult> {
  const knobs = await resolveKnobs(opts.workspaceId)

  const conversation = await resolveConversation(
    opts.workspaceId,
    opts.conversationId,
    opts.actor,
    opts.role,
    opts.utterance,
  )

  const seq = await nextTurnSeq(conversation.id)
  const turn = await insertTurn({
    conversationId: conversation.id,
    seq,
    speaker: 'operator',
    utterance: opts.utterance,
    channel: opts.channel,
    status: 'planning',
  })

  opts.emit({ kind: 'turn', turnId: turn.id, conversationId: conversation.id, seq })
  publish({
    type: 'assistant.command.received',
    turnId: turn.id,
    message: opts.utterance,
    data: { channel: opts.channel, actor: opts.actor, conversationId: conversation.id },
  })

  const narratorOptions: NarratorOptions = {
    verbosity: knobs.verbosity,
    speakSummaryOnly: knobs.speakSummaryOnly,
    tokenDelayMs: knobs.tokenDelayMs,
    maxSpokenChars: knobs.maxSpokenChars,
  }

  try {
    /* ── 1 · PERCEIVE ────────────────────────────────────────────────────── */
    const snapshot = await assembleSnapshot({
      workspaceId: opts.workspaceId,
      operator: { name: opts.actor, role: opts.role },
      conversationId: conversation.id,
      historyTurns: knobs.historyTurns,
      includeKnowledge: knobs.includeKnowledge,
      maxSnapshotChars: knobs.maxSnapshotChars,
      ...(opts.focus === undefined ? {} : { focus: opts.focus }),
    })

    /* ── 2 · INTERPRET ───────────────────────────────────────────────────── */
    const intent = await parseIntent({
      workspaceId: opts.workspaceId,
      utterance: opts.utterance,
      snapshot,
      clarifyThreshold: knobs.clarifyThreshold,
      minConfidence: knobs.minConfidence,
      useModel: knobs.useModel,
      synonymsEnabled: knobs.synonymsEnabled,
    })

    await updateTurn(turn.id, {
      intent: intent as unknown as Record<string, unknown>,
      confidence: intent.confidence,
    })
    opts.emit({ kind: 'intent', intent })

    /* ── A conversational turn: clarify, answer, or chitchat ─────────────── */
    if (intent.action === 'clarify' || (intent.missing && intent.missing.length > 0)) {
      const question =
        intent.missing && intent.missing.length > 0
          ? missingArgQuestion(intent.action, intent.missing)
          : clarifyQuestion(intent)

      return finishConversational(
        turn.id,
        conversation.id,
        question,
        narratorOptions,
        opts,
        'completed',
        intent,
      )
    }

    if (intent.action === 'answer' || intent.action === 'chitchat' || !TOOL_BY_ID[intent.action]) {
      const answer = answerFromSnapshot(intent, snapshot)
      return finishConversational(
        turn.id,
        conversation.id,
        answer,
        narratorOptions,
        opts,
        'completed',
        intent,
      )
    }

    /* ── 3 · PLAN ────────────────────────────────────────────────────────── */
    const plan = composePlan({
      intent,
      snapshot,
      maxSteps: knobs.maxSteps,
      readBeforeWrite: knobs.readBeforeWrite,
      explainEveryStep: knobs.explainEveryStep,
      alsoConfirmMutating: knobs.alsoConfirmMutating,
    })

    const serialised = serialisePlan(plan)
    await updateTurn(turn.id, { plan: serialised as unknown as Record<string, unknown> })

    opts.emit({ kind: 'plan', plan: serialised })
    publish({
      type: 'assistant.plan.composed',
      turnId: turn.id,
      message: plan.summary,
      data: serialised as unknown as Record<string, unknown>,
    })

    // The acknowledgement streams before anything runs.
    const acknowledgement = narratePlan(plan, narratorOptions)
    for (const token of tokenise(acknowledgement)) {
      opts.emit({ kind: 'token', text: token })
      publish({ type: 'assistant.token', turnId: turn.id, message: token })
    }

    /* ── 4 · CONFIRM ─────────────────────────────────────────────────────── */
    const gate = await gatePlan(turn.id, plan, knobs.ttlSeconds)
    if (gate.blocked) {
      const prompt = renderTemplate(NARRATION_TEMPLATES.confirmRequired, {
        prompt: gate.prompt ?? '',
      })
      await updateTurn(turn.id, { narration: prompt, status: 'awaiting_confirmation' })

      opts.emit({
        kind: 'confirm',
        token: gate.token as string,
        prompt: gate.prompt as string,
        expiresAt: gate.expiresAt as string,
        plan: serialised,
      })
      opts.emit({ kind: 'done', status: 'awaiting_confirmation' })
      await touchConversation(conversation.id)

      return {
        turnId: turn.id,
        conversationId: conversation.id,
        status: 'awaiting_confirmation',
        narration: prompt,
        outcomes: [],
      }
    }

    /* ── 5–8 · DISPATCH, NARRATE, VERIFY, REMEMBER ───────────────────────── */
    return await executePlan({
      plan,
      turnId: turn.id,
      conversationId: conversation.id,
      snapshot,
      knobs,
      narratorOptions,
      opts,
    })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    const narration = enforceAssistantVoice(`That failed. ${message}`)

    await updateTurn(turn.id, { status: 'failed', narration })
    opts.emit({ kind: 'error', message: narration })
    opts.emit({ kind: 'done', status: 'failed' })
    publish({ type: 'assistant.command.finished', turnId: turn.id, message: narration, data: { status: 'failed' } })

    return {
      turnId: turn.id,
      conversationId: conversation.id,
      status: 'failed',
      narration,
      outcomes: [],
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXECUTION
   ═══════════════════════════════════════════════════════════════════════════ */

interface ExecuteOptions {
  plan: Plan
  turnId: string
  conversationId: string
  snapshot: SituationSnapshot
  knobs: AssistantKnobs
  narratorOptions: NarratorOptions
  opts: RunCommandOptions
}

async function executePlan(input: ExecuteOptions): Promise<RunCommandResult> {
  const { plan, turnId, conversationId, knobs, narratorOptions, opts } = input

  await updateTurn(turnId, { status: 'running' })

  const toolCtx: Omit<ToolContext, 'prior'> = {
    workspaceId: opts.workspaceId,
    actor: opts.actor,
    role: opts.role,
    // What the operator said, verbatim. A tool that records a durable preference
    // reads it from here rather than trusting the parser's extraction.
    utterance: opts.utterance,
    // Recorded so an operator-triggered run is indistinguishable from a scheduled
    // one in telemetry, apart from this label and the turn id.
    trigger: knobs.recordAsTrigger === 'assistant' ? 'assistant' : 'api',
    turnId,
  }

  const dispatch = await dispatchPlan({
    turnId,
    plan,
    ctx: toolCtx,
    stepTimeoutMs: knobs.stepTimeoutMs,
    haltOnStepFailure: knobs.haltOnStepFailure,
    onStep: (step) => opts.emit({ kind: 'step', step }),
  })

  /* ── 6 · NARRATE ───────────────────────────────────────────────────────── */
  const narration = await narrateResult({
    plan,
    outcomes: dispatch.outcomes,
    snapshot: input.snapshot,
    options: narratorOptions,
  })

  for (const token of tokenise(narration.text)) {
    opts.emit({ kind: 'token', text: token })
    publish({ type: 'assistant.token', turnId, message: token })
  }

  /* ── 7 · VERIFY ────────────────────────────────────────────────────────── */
  let finalNarration = narration.text
  if (knobs.verifyEnabled) {
    const verification = verifyOutcomes(dispatch.outcomes, knobs.verifyStrict)
    if (verification.note) {
      finalNarration = enforceAssistantVoice(`${finalNarration} ${verification.note}`)
      opts.emit({ kind: 'verify', note: verification.note })
    }
  }

  /* ── 8 · REMEMBER ──────────────────────────────────────────────────────── */
  const status = dispatch.status
  await updateTurn(turnId, {
    status: status === 'completed' ? 'completed' : 'failed',
    narration: finalNarration,
    ...(dispatch.lastEntity === null ? {} : { lastEntity: dispatch.lastEntity }),
  })
  await touchConversation(conversationId)

  opts.emit({
    kind: 'result',
    narration: finalNarration,
    spoken: spokenSummary(finalNarration, knobs.maxSpokenChars),
    outcomes: dispatch.outcomes,
  })
  opts.emit({ kind: 'done', status })

  publish({
    type: status === 'completed' ? 'assistant.command.finished' : 'assistant.command.cancelled',
    turnId,
    message: finalNarration,
    data: {
      status,
      steps: dispatch.outcomes.length,
      narrationSource: narration.source,
      ...(narration.fallbackReason ? { narrationFallback: narration.fallbackReason } : {}),
    },
  })

  return { turnId, conversationId, status, narration: finalNarration, outcomes: dispatch.outcomes }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESUMING A CONFIRMED PLAN
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResumeOptions {
  workspaceId: string
  token: string
  decision: 'confirm' | 'cancel'
  by: string
  role: OperatorRole
  emit: FrameSink
}

/**
 * Resumes the STORED plan. There is no re-parse here by design: what the human
 * approved is exactly what runs.
 */
export async function resumeConfirmed(opts: ResumeOptions): Promise<RunCommandResult> {
  const knobs = await resolveKnobs(opts.workspaceId)
  const outcome = await redeemConfirmation(opts.token, opts.decision, opts.by)

  if (outcome.status !== 'confirmed') {
    opts.emit({ kind: 'result', narration: outcome.message, spoken: outcome.message, outcomes: [] })
    opts.emit({
      kind: 'done',
      status: outcome.status === 'cancelled' ? 'cancelled' : 'failed',
    })
    return {
      turnId: 'row' in outcome ? outcome.row.turn_id : '',
      conversationId: '',
      status: outcome.status === 'cancelled' ? 'cancelled' : 'failed',
      narration: outcome.message,
      outcomes: [],
    }
  }

  const turnId = outcome.row.turn_id
  const plan = outcome.plan

  const turns = await listTurns(turnId, 1).catch(() => [])
  void turns

  const snapshot = await assembleSnapshot({
    workspaceId: opts.workspaceId,
    operator: { name: opts.by, role: opts.role },
    historyTurns: 0,
    includeKnowledge: false,
    maxSnapshotChars: knobs.maxSnapshotChars,
  })

  const narratorOptions: NarratorOptions = {
    verbosity: knobs.verbosity,
    speakSummaryOnly: knobs.speakSummaryOnly,
    tokenDelayMs: knobs.tokenDelayMs,
    maxSpokenChars: knobs.maxSpokenChars,
  }

  opts.emit({ kind: 'plan', plan: serialisePlan(plan) })

  return executePlan({
    plan,
    turnId,
    conversationId: '',
    snapshot,
    knobs,
    narratorOptions,
    opts: {
      workspaceId: opts.workspaceId,
      utterance: plan.intent.restated,
      channel: 'text',
      actor: opts.by,
      role: opts.role,
      emit: opts.emit,
    },
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONVERSATIONAL TURNS
   ═══════════════════════════════════════════════════════════════════════════ */

async function finishConversational(
  turnId: string,
  conversationId: string,
  text: string,
  narratorOptions: NarratorOptions,
  opts: RunCommandOptions,
  status: 'completed' | 'failed',
  intent: Intent,
): Promise<RunCommandResult> {
  const narration = enforceAssistantVoice(text)

  for (const token of tokenise(narration)) {
    opts.emit({ kind: 'token', text: token })
    publish({ type: 'assistant.token', turnId, message: token })
  }

  await updateTurn(turnId, { status, narration })
  await touchConversation(conversationId)

  opts.emit({
    kind: 'result',
    narration,
    spoken: spokenSummary(narration, narratorOptions.maxSpokenChars),
    outcomes: [],
  })
  opts.emit({ kind: 'done', status })
  publish({
    type: 'assistant.command.finished',
    turnId,
    message: narration,
    data: { status, conversational: true, action: intent.action },
  })

  return { turnId, conversationId, status, narration, outcomes: [] }
}

/** Answers straight from the snapshot when no tool is needed. */
function answerFromSnapshot(intent: Intent, snapshot: SituationSnapshot): string {
  const c = snapshot.counts

  if (intent.action === 'chitchat') {
    const opener = pickOpener('acknowledge', intent.confidence)
    return `${opener} ${c.reviewQueue} item(s) await a verdict and ${c.pendingLeadership} post(s) are with Leadership. Ask me for anything the twelve agents can do.`
  }

  return (
    `${c.agentsOnline} agents are online. ${c.reviewQueue} item(s) await a verdict, ` +
    `${c.pendingLeadership} post(s) are with Leadership, ${c.scheduledThisWeek} post(s) are on this week's calendar, ` +
    `and the Knowledge Base holds ${c.activeKnowledge} active entries. The pipeline is ${snapshot.pipeline.status}.`
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSCRIPT
   ═══════════════════════════════════════════════════════════════════════════ */

/** The rail's state on reload: turns plus their steps. */
export async function conversationTranscript(
  conversationId: string,
  limit = 40,
): Promise<{
  turns: Array<{
    id: string
    seq: number
    speaker: string
    utterance: string | null
    narration: string | null
    channel: string
    status: string
    confidence: number | null
    plan: Record<string, unknown> | null
    steps: Array<Record<string, unknown>>
    /**
     * snake_case to mirror the row, which is the convention that lets
     * `/state` flow into the store with no adapter. It was `createdAt`, which
     * `src/types.ts` never reads — so every timestamp in the transcript
     * rendered as an em dash.
     */
    created_at: string
  }>
}> {
  const turns = await listTurns(conversationId, limit)
  const out = []

  for (const turn of turns) {
    const steps = await listSteps(turn.id)
    out.push({
      id: turn.id,
      seq: turn.seq,
      speaker: turn.speaker,
      utterance: turn.utterance,
      narration: turn.narration,
      channel: turn.channel,
      status: turn.status,
      confidence: turn.confidence,
      plan: turn.plan,
      steps: steps.map((s) => ({
        idx: s.idx,
        toolId: s.tool_id,
        toolName: TOOL_BY_ID[s.tool_id]?.name ?? s.tool_id,
        risk: s.risk,
        why: s.why,
        status: s.status,
        summary: s.result_summary,
        result: s.result,
        durationMs: s.duration_ms,
        error: s.error,
      })),
      created_at: turn.created_at,
    })
  }

  return { turns: out }
}

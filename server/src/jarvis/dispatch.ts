/**
 * DISPATCH — executes a Plan against the tool registry, streaming each result.
 *
 * Every step opens a `jarvis_steps` row and emits over SSE. A failed step halts
 * the plan, records the error, and reports plainly. An irreversible step is never
 * retried automatically.
 */

import { TOOL_BY_ID } from '../../../shared/tool-registry'
import { finishStep, insertStep, startStep } from '../db/jarvis-repo'
import { publish } from '../events'
import { toolHandler, validateArgs, type ToolContext, type ToolResult } from './tools/index'
import type { Plan, ToolCall } from './planner'

export interface StepOutcome {
  idx: number
  stepId: string
  toolId: string
  toolName: string
  risk: string
  why: string
  status: 'completed' | 'failed' | 'skipped'
  summary: string
  data: Record<string, unknown>
  render: string
  durationMs: number
  error?: string
  fallbackReason?: string
  entity?: Record<string, unknown>
  postcondition?: { description: string; satisfied: boolean }
}

export interface DispatchOptions {
  turnId: string
  plan: Plan
  ctx: Omit<ToolContext, 'prior'>
  stepTimeoutMs: number
  haltOnStepFailure: boolean
  /** Called as each step finishes, so the caller can stream it. */
  onStep?: (outcome: StepOutcome) => void
}

export interface DispatchResult {
  outcomes: StepOutcome[]
  status: 'completed' | 'failed'
  failedAt?: number
  lastEntity: Record<string, unknown> | null
}

export async function dispatchPlan(opts: DispatchOptions): Promise<DispatchResult> {
  const { plan, turnId } = opts
  const prior = new Map<string, ToolResult>()
  const outcomes: StepOutcome[] = []
  let lastEntity: Record<string, unknown> | null = null

  for (let idx = 0; idx < plan.steps.length; idx += 1) {
    const step = plan.steps[idx] as ToolCall
    const spec = TOOL_BY_ID[step.toolId]

    const row = await insertStep({
      turnId,
      idx,
      toolId: step.toolId,
      risk: spec?.risk ?? 'safe',
      args: step.args,
      why: step.why,
    })

    if (!spec) {
      const outcome = failedOutcome(idx, row.id, step, 'safe', `No such tool: ${step.toolId}.`)
      await finishStep(row.id, { status: 'failed', error: outcome.error, durationMs: 0 })
      emitFailed(turnId, outcome)
      outcomes.push(outcome)
      opts.onStep?.(outcome)
      return { outcomes, status: 'failed', failedAt: idx, lastEntity }
    }

    publish({
      type: 'jarvis.step.started',
      turnId,
      agentId: spec.agentId ?? 'jarvis',
      message: step.why,
      data: { idx, toolId: spec.id, toolName: spec.name, risk: spec.risk, why: step.why },
    })
    await startStep(row.id)

    const started = Date.now()

    try {
      const handler = toolHandler(spec.id)
      if (!handler) throw new Error(`${spec.name} has no handler registered.`)

      // Arguments are validated against the tool's own schema, always.
      const args = validateArgs(spec, step.args)

      const result = await withTimeout(
        handler(args, { ...opts.ctx, prior }),
        opts.stepTimeoutMs,
        spec.name,
      )

      prior.set(spec.id, result)
      if (result.entity) lastEntity = result.entity

      const outcome: StepOutcome = {
        idx,
        stepId: row.id,
        toolId: spec.id,
        toolName: spec.name,
        risk: spec.risk,
        why: step.why,
        status: 'completed',
        summary: result.summary,
        data: result.data,
        render: result.render ?? 'text',
        durationMs: Date.now() - started,
        ...(result.fallbackReason === undefined ? {} : { fallbackReason: result.fallbackReason }),
        ...(result.entity === undefined ? {} : { entity: result.entity }),
        ...(result.postcondition === undefined ? {} : { postcondition: result.postcondition }),
      }

      await finishStep(row.id, {
        status: 'completed',
        resultSummary: result.summary,
        result: result.data,
        durationMs: outcome.durationMs,
      })

      publish({
        type: 'jarvis.step.finished',
        turnId,
        agentId: spec.agentId ?? 'jarvis',
        message: result.summary,
        data: {
          idx,
          toolId: spec.id,
          toolName: spec.name,
          summary: result.summary,
          render: outcome.render,
          result: result.data,
          durationMs: outcome.durationMs,
          ...(result.fallbackReason ? { fallbackReason: result.fallbackReason } : {}),
        },
      })

      outcomes.push(outcome)
      opts.onStep?.(outcome)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const outcome = failedOutcome(idx, row.id, step, spec.risk, message, Date.now() - started)

      await finishStep(row.id, {
        status: 'failed',
        error: message,
        durationMs: outcome.durationMs,
      })
      emitFailed(turnId, outcome, spec.agentId ?? 'jarvis')

      outcomes.push(outcome)
      opts.onStep?.(outcome)

      if (opts.haltOnStepFailure) {
        // Remaining steps are recorded as skipped, so the transcript shows what
        // did NOT happen rather than leaving a gap.
        for (let rest = idx + 1; rest < plan.steps.length; rest += 1) {
          const skipped = plan.steps[rest] as ToolCall
          const skippedRow = await insertStep({
            turnId,
            idx: rest,
            toolId: skipped.toolId,
            risk: TOOL_BY_ID[skipped.toolId]?.risk ?? 'safe',
            args: skipped.args,
            why: skipped.why,
          })
          await finishStep(skippedRow.id, {
            status: 'skipped',
            resultSummary: 'Not run — an earlier step failed.',
            durationMs: 0,
          })
          outcomes.push({
            idx: rest,
            stepId: skippedRow.id,
            toolId: skipped.toolId,
            toolName: TOOL_BY_ID[skipped.toolId]?.name ?? skipped.toolId,
            risk: TOOL_BY_ID[skipped.toolId]?.risk ?? 'safe',
            why: skipped.why,
            status: 'skipped',
            summary: 'Not run — an earlier step failed.',
            data: {},
            render: 'text',
            durationMs: 0,
          })
        }

        return { outcomes, status: 'failed', failedAt: idx, lastEntity }
      }
    }
  }

  return { outcomes, status: 'completed', lastEntity }
}

function failedOutcome(
  idx: number,
  stepId: string,
  step: ToolCall,
  risk: string,
  error: string,
  durationMs = 0,
): StepOutcome {
  return {
    idx,
    stepId,
    toolId: step.toolId,
    toolName: TOOL_BY_ID[step.toolId]?.name ?? step.toolId,
    risk,
    why: step.why,
    status: 'failed',
    summary: error,
    data: {},
    render: 'text',
    durationMs,
    error,
  }
}

function emitFailed(turnId: string, outcome: StepOutcome, agentId = 'jarvis'): void {
  publish({
    type: 'jarvis.step.failed',
    turnId,
    agentId,
    message: outcome.error ?? outcome.summary,
    data: { idx: outcome.idx, toolId: outcome.toolId, toolName: outcome.toolName, error: outcome.error },
  })
}

async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  if (ms <= 0) return promise
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} exceeded its ${ms}ms step timeout.`)), ms)
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   VERIFY — postconditions, not optimism
   ═══════════════════════════════════════════════════════════════════════════ */

export interface VerificationFinding {
  toolId: string
  description: string
  satisfied: boolean
}

/**
 * Checks each step's declared postcondition. A mismatch is reported rather than
 * papered over — JARVIS never claims a success a check contradicts.
 */
export function verifyOutcomes(
  outcomes: StepOutcome[],
  strict: boolean,
): { findings: VerificationFinding[]; note: string | null } {
  const findings: VerificationFinding[] = []

  for (const outcome of outcomes) {
    if (outcome.status !== 'completed' || !outcome.postcondition) continue
    findings.push({
      toolId: outcome.toolId,
      description: outcome.postcondition.description,
      satisfied: outcome.postcondition.satisfied,
    })
  }

  const unmet = findings.filter((f) => !f.satisfied)
  if (unmet.length === 0) return { findings, note: null }

  const note =
    `${unmet.length} postcondition(s) did not hold: ` +
    unmet.map((f) => `${f.description} (${f.toolId})`).join('; ') +
    (strict ? '. I am treating that as a failure.' : '. The step reported success, so I am flagging the mismatch rather than claiming it worked.')

  return { findings, note }
}

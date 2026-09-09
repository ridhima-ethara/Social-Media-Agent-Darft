/**
 * THE SINGLE RUNNER
 *
 * One path from an agent spec to a result. There is deliberately no second
 * execution path — a scheduled run and an operator-triggered run go through
 * this same function, which is what makes them indistinguishable in telemetry.
 */

import type { AgentSpec, EvidenceAware, InjectionAttempt } from '../../contracts/src/index'
import { AGENT_BY_ID, assertToolAllowlists } from '../../agents/index'
import { prepareEvidence, type EvidenceItem } from './evidence'

export interface RunContext {
  /** Resolved configuration for this run. Every number comes from here. */
  config: Record<string, string | number | boolean>
  /** Tools this agent may call, already filtered by its allowlist. */
  tools: string[]
  /** Untrusted content this run must reason over, if any. */
  evidence?: EvidenceItem[]
  log(message: string): void
}

export interface RunResult<T = Record<string, unknown>> extends EvidenceAware {
  agentId: string
  status: 'completed' | 'failed' | 'refused'
  payload: T
  durationMs: number
  /** The fully resolved config, so the run stays explainable after knobs move. */
  configUsed: Record<string, string | number | boolean>
  error?: string
}

export type AgentHandler<T = Record<string, unknown>> = (
  input: Record<string, unknown>,
  ctx: RunContext & { evidenceText?: string },
) => Promise<T>

const handlers = new Map<string, AgentHandler>()

export function registerAgent<T extends Record<string, unknown>>(
  agentId: string,
  handler: AgentHandler<T>,
): void {
  handlers.set(agentId, handler as AgentHandler)
}

/** Fails loudly at boot rather than at the first request. */
export function auditAgentCoverage(): string[] {
  const problems = assertToolAllowlists().map((p) => `${p.agentId} ${p.message}`)
  for (const agent of Object.values(AGENT_BY_ID)) {
    if (!handlers.has(agent.id)) {
      problems.push(`${agent.id} has no registered handler.`)
    }
  }
  return problems
}

/**
 * Runs one agent.
 *
 * Untrusted evidence is wrapped before the handler sees it, and any injection
 * attempt is carried out on the result rather than logged and forgotten — the
 * caller needs to know somebody tried.
 */
export async function runAgent<T extends Record<string, unknown>>(
  agentId: string,
  input: Record<string, unknown>,
  ctx: RunContext,
): Promise<RunResult<T>> {
  const started = Date.now()
  const spec: AgentSpec | undefined = AGENT_BY_ID[agentId]

  const base = {
    agentId,
    configUsed: ctx.config,
    injectionAttempts: [] as InjectionAttempt[],
  }

  if (!spec) {
    return {
      ...base,
      status: 'failed',
      payload: {} as T,
      durationMs: Date.now() - started,
      error: `No agent declared with id "${agentId}".`,
    }
  }

  const handler = handlers.get(agentId)
  if (!handler) {
    return {
      ...base,
      status: 'failed',
      payload: {} as T,
      durationMs: Date.now() - started,
      error: `${spec.name} has no registered handler.`,
    }
  }

  // Constraint 5: untrusted content is wrapped, escaped, and scanned.
  let evidenceText: string | undefined
  let injectionAttempts: InjectionAttempt[] = []

  if (ctx.evidence && ctx.evidence.length > 0) {
    const prepared = prepareEvidence(ctx.evidence)
    evidenceText = prepared.text
    injectionAttempts = prepared.injectionAttempts

    if (prepared.dropped.length > 0) {
      ctx.log(
        `${prepared.dropped.length} evidence item(s) did not fit and were excluded: ${prepared.dropped.join(', ')}.`,
      )
    }
    if (injectionAttempts.length > 0) {
      ctx.log(
        `${injectionAttempts.length} possible injection attempt(s) found in scraped content. Reported, not followed.`,
      )
    }
  }

  try {
    const payload = (await handler(input, { ...ctx, ...(evidenceText ? { evidenceText } : {}) })) as T
    return {
      ...base,
      status: 'completed',
      payload,
      injectionAttempts,
      durationMs: Date.now() - started,
    }
  } catch (error) {
    // Fail in the open: record the reason, never swallow it.
    return {
      ...base,
      status: 'failed',
      payload: {} as T,
      injectionAttempts,
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : String(error),
    }
  }
}

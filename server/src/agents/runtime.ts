/**
 * THE SKILL RUNTIME
 *
 * One execution path for every agent, whether a run was started by cron, by an
 * operator clicking Run Discovery, or by JARVIS acting on an utterance. There is
 * no second path — which is what makes a JARVIS-triggered run indistinguishable
 * from a scheduled one in telemetry.
 *
 * The mechanics:
 *   · `payload` is a mutable accumulator threaded through every skill. A skill
 *     returns a patch; the runtime merges it. That is how skills compose.
 *   · `config` is resolved per skill as registryDefault < workspace < run, and
 *     the resolved set is written to `skill_runs.config_used`. That is what keeps
 *     a past run explainable after the knobs have changed.
 *   · A failing CRITICAL skill breaks the loop. A non-critical failure is
 *     recorded and the run continues. Nothing is swallowed.
 */

import {
  SKILLS_BY_AGENT,
  SKILL_BY_ID,
  coerceConfigValue,
  defaultSkillConfig,
  CRITICAL_SKILL_IDS,
  SKILLS,
} from '../../../shared/agent-registry'
import type {
  AgentId,
  AgentRunResult,
  ConfigValue,
  ResolvedConfig,
  SkillContext,
  SkillHandler,
  SkillRunRecord,
  SkillSpec,
} from '../../../shared/agent-contract'
import { publish, publishActivity, sleep } from '../events'
import {
  finishAgentRun,
  insertActivity,
  insertSkillRun,
  listSkillOverrides,
  setAgentState,
  startAgentRun,
  type SkillOverrideRow,
} from '../db/repo'
import { migrateStoredConfig } from './legacy-knobs'

/* ═══════════════════════════════════════════════════════════════════════════
   THE HANDLER TABLE
   ═══════════════════════════════════════════════════════════════════════════ */

const HANDLERS = new Map<string, SkillHandler<Record<string, unknown>>>()

/**
 * Registers one handler. Called from `skills/_register.ts` at import time.
 * A duplicate registration is a programming error and throws immediately —
 * silently keeping one of two handlers would be worse.
 */
export function registerSkill<TPayload extends Record<string, unknown>>(
  skillId: string,
  handler: SkillHandler<TPayload>,
): void {
  if (!SKILL_BY_ID[skillId]) {
    throw new Error(
      `registerSkill('${skillId}') — no such skill in the registry. Law 1: declare it first.`,
    )
  }
  if (HANDLERS.has(skillId)) {
    throw new Error(`registerSkill('${skillId}') — already registered.`)
  }
  HANDLERS.set(skillId, handler as SkillHandler<Record<string, unknown>>)
}

export function hasHandler(skillId: string): boolean {
  return HANDLERS.has(skillId)
}

export function registeredSkillIds(): string[] {
  return [...HANDLERS.keys()].sort()
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BOOT AUDIT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CoverageReport {
  total: number
  registered: number
  missingCritical: string[]
  missingOptional: string[]
}

export function skillCoverage(): CoverageReport {
  const missingCritical: string[] = []
  const missingOptional: string[] = []
  for (const skill of SKILLS) {
    if (HANDLERS.has(skill.id)) continue
    if (skill.critical) missingCritical.push(skill.id)
    else missingOptional.push(skill.id)
  }
  return {
    total: SKILLS.length,
    registered: HANDLERS.size,
    missingCritical,
    missingOptional,
  }
}

/**
 * Fails loudly at boot when a critical skill has no handler.
 *
 * A critical skill with no handler would record as `skipped` and the pipeline
 * would produce quietly wrong output. Refusing to start is the honest response.
 */
export function auditSkillCoverage(): CoverageReport {
  const report = skillCoverage()
  if (report.missingCritical.length > 0) {
    const list = report.missingCritical.map((id) => `  · ${id}`).join('\n')
    throw new Error(
      `Skill coverage audit failed — ${report.missingCritical.length} CRITICAL skill(s) have no handler:\n${list}\n\n` +
        `A critical skill without a handler would silently skip and the pipeline would produce wrong output.\n` +
        `Register it in server/src/agents/skills/_register.ts.`,
    )
  }
  return report
}

export const criticalSkillIds = CRITICAL_SKILL_IDS

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * registryDefault < workspaceOverride < runOverride, with every value validated
 * against its declared type and bounds. An out-of-range stored value falls back
 * to the default rather than reaching a handler as nonsense.
 */
export function resolveConfig(
  skill: SkillSpec,
  workspaceOverride: Record<string, unknown> | undefined,
  runOverride: Record<string, unknown> | undefined,
): ResolvedConfig {
  const resolved: ResolvedConfig = defaultSkillConfig(skill.id)

  const migrated = workspaceOverride ? migrateStoredConfig(skill.id, workspaceOverride).config : {}
  const layers: Array<Record<string, unknown>> = [migrated, runOverride ?? {}]

  for (const layer of layers) {
    for (const field of skill.config) {
      if (!(field.key in layer)) continue
      resolved[field.key] = coerceConfigValue(field, layer[field.key])
    }
  }

  return resolved
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CONTEXT
   ═══════════════════════════════════════════════════════════════════════════ */

interface ContextOptions {
  workspaceId: string
  agentId: AgentId
  skillId: string
  config: ResolvedConfig
  runId?: string
  turnId?: string
  /** Collected so the caller can persist the log lines with the run. */
  logs: string[]
}

function buildContext(opts: ContextOptions): SkillContext {
  const { config } = opts

  function raw(key: string): ConfigValue | undefined {
    return config[key]
  }

  return {
    workspaceId: opts.workspaceId,
    config,
    num(key, fallback = 0) {
      const value = raw(key)
      if (typeof value === 'number' && Number.isFinite(value)) return value
      if (typeof value === 'string') {
        const parsed = Number(value)
        if (Number.isFinite(parsed)) return parsed
      }
      return fallback
    },
    bool(key, fallback = false) {
      const value = raw(key)
      if (typeof value === 'boolean') return value
      if (typeof value === 'string') return value === 'true'
      return fallback
    },
    str(key, fallback = '') {
      const value = raw(key)
      return typeof value === 'string' ? value : value === undefined ? fallback : String(value)
    },
    log(message) {
      opts.logs.push(message)
      publish({
        type: 'activity',
        agentId: opts.agentId,
        skillId: opts.skillId,
        runId: opts.runId,
        turnId: opts.turnId,
        message,
        data: { status: 'running' },
      })
    },
    emit(type, message, data) {
      publish({
        // The type is declared by the caller and validated by the bus vocabulary
        // at the type level; an unknown string simply arrives as an activity.
        type: type as Parameters<typeof publish>[0]['type'],
        agentId: opts.agentId,
        skillId: opts.skillId,
        runId: opts.runId,
        turnId: opts.turnId,
        message,
        data,
      })
    },
    ...(opts.runId === undefined ? {} : { runId: opts.runId }),
    ...(opts.turnId === undefined ? {} : { turnId: opts.turnId }),
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RUNNING AN AGENT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RunAgentOptions {
  workspaceId: string
  /** The pipeline run this agent belongs to, when it belongs to one. */
  pipelineRunId?: string | null
  /** 'cron' | 'manual' | 'jarvis' | 'api' — recorded on the agent run. */
  trigger?: string
  /** The JARVIS turn that caused this, when applicable. */
  turnId?: string | null
  /** Restrict to these sections of the agent's skill list. */
  sections?: string[]
  /** Restrict to these skill ids, in registry order. */
  onlySkills?: string[]
  /** Per-skill knob overrides for this run only. */
  configOverrides?: Record<string, Record<string, unknown>>
  /** Deliberate pacing between skills, so a run can be watched. */
  paceMs?: number
  /** How many input items this run received, for the telemetry row. */
  inputCount?: number
  /** A task line for the agent state row while it runs. */
  currentTask?: string
}

/**
 * Runs one agent end to end.
 *
 * Returns rather than throws: a failed agent is a recorded outcome the
 * orchestrator decides what to do about, not an exception that unwinds a
 * half-finished pipeline.
 */
export async function runAgent<TPayload extends Record<string, unknown>>(
  agentId: AgentId,
  input: TPayload,
  opts: RunAgentOptions,
): Promise<AgentRunResult<TPayload & Record<string, unknown>>> {
  const {
    workspaceId,
    pipelineRunId = null,
    trigger = 'manual',
    turnId = null,
    sections,
    onlySkills,
    configOverrides = {},
    paceMs = 0,
    inputCount = 0,
  } = opts

  const startedAt = Date.now()
  const agentRun = await startAgentRun({
    workspaceId,
    pipelineRunId,
    agentId,
    trigger,
    turnId,
    inputCount,
  })

  await setAgentState(workspaceId, agentId, {
    status: 'running',
    currentTask: opts.currentTask ?? 'Starting',
  })

  publish({
    type: 'agent.started',
    agentId,
    runId: pipelineRunId ?? agentRun.id,
    ...(turnId === null ? {} : { turnId }),
    message: `${agentId} started`,
    data: { agentRunId: agentRun.id, trigger },
  })

  // Loaded once per agent run, not once per skill.
  let overrides: Map<string, SkillOverrideRow>
  try {
    overrides = await listSkillOverrides(workspaceId)
  } catch {
    overrides = new Map()
  }

  const payload = { ...input } as TPayload & Record<string, unknown>
  const records: SkillRunRecord[] = []

  let skills = (SKILLS_BY_AGENT[agentId] ?? []).slice().sort((a, b) => a.order - b.order)
  if (sections && sections.length > 0) {
    skills = skills.filter((s) => s.section !== undefined && sections.includes(s.section))
  }
  if (onlySkills && onlySkills.length > 0) {
    const wanted = new Set(onlySkills)
    skills = skills.filter((s) => wanted.has(s.id))
  }

  let failure: string | undefined
  let attempted = 0
  let succeeded = 0

  for (const skill of skills) {
    const override = overrides.get(skill.id)
    const config = resolveConfig(
      skill,
      override?.config as Record<string, unknown> | undefined,
      configOverrides[skill.id],
    )

    // A disabled non-critical skill is skipped. A critical skill runs regardless:
    // `PATCH /skills/:id` refuses to disable one, but a hand-edited row must not
    // be able to silently remove a load-bearing step.
    const enabled = override ? override.enabled : skill.enabledByDefault
    if (!enabled && !skill.critical) {
      records.push({
        skillId: skill.id,
        agentId,
        name: skill.name,
        status: 'skipped',
        durationMs: 0,
        configUsed: config,
        note: 'Switched off in Agent Studio',
      })
      await insertSkillRun({
        workspaceId,
        agentRunId: agentRun.id,
        skillId: skill.id,
        agentId,
        status: 'skipped',
        durationMs: 0,
        configUsed: config,
        note: 'Switched off in Agent Studio',
      })
      publish({
        type: 'skill.skipped',
        agentId,
        skillId: skill.id,
        runId: pipelineRunId ?? agentRun.id,
        message: `${skill.name} is switched off`,
        data: { reason: 'disabled' },
      })
      continue
    }

    const handler = HANDLERS.get(skill.id)
    if (!handler) {
      // The boot audit guarantees this cannot be a critical skill.
      const note = 'No handler registered'
      records.push({
        skillId: skill.id,
        agentId,
        name: skill.name,
        status: 'skipped',
        durationMs: 0,
        configUsed: config,
        note,
      })
      await insertSkillRun({
        workspaceId,
        agentRunId: agentRun.id,
        skillId: skill.id,
        agentId,
        status: 'skipped',
        durationMs: 0,
        configUsed: config,
        note,
      })
      publish({
        type: 'skill.skipped',
        agentId,
        skillId: skill.id,
        runId: pipelineRunId ?? agentRun.id,
        message: `${skill.name} — ${note}`,
        data: { reason: 'no-handler' },
      })
      continue
    }

    const logs: string[] = []
    const ctx = buildContext({
      workspaceId,
      agentId,
      skillId: skill.id,
      config,
      ...(pipelineRunId === null ? {} : { runId: pipelineRunId }),
      ...(turnId === null ? {} : { turnId }),
      logs,
    })

    publish({
      type: 'skill.started',
      agentId,
      skillId: skill.id,
      runId: pipelineRunId ?? agentRun.id,
      message: skill.name,
      data: { order: skill.order, config },
    })

    await setAgentState(workspaceId, agentId, { status: 'running', currentTask: skill.name })
    if (paceMs > 0) await sleep(paceMs)

    const skillStart = Date.now()
    attempted += 1

    try {
      const patch = await handler(payload, ctx)
      if (patch && typeof patch === 'object') Object.assign(payload, patch)

      const durationMs = Date.now() - skillStart
      succeeded += 1
      const note = logs.length > 0 ? (logs[logs.length - 1] as string) : undefined

      records.push({
        skillId: skill.id,
        agentId,
        name: skill.name,
        status: 'completed',
        durationMs,
        configUsed: config,
        ...(note === undefined ? {} : { note }),
      })
      await insertSkillRun({
        workspaceId,
        agentRunId: agentRun.id,
        skillId: skill.id,
        agentId,
        status: 'completed',
        durationMs,
        configUsed: config,
        ...(note === undefined ? {} : { note }),
      })
      publish({
        type: 'skill.finished',
        agentId,
        skillId: skill.id,
        runId: pipelineRunId ?? agentRun.id,
        message: note ?? skill.name,
        data: { durationMs, order: skill.order },
      })
    } catch (error) {
      const durationMs = Date.now() - skillStart
      const reason = error instanceof Error ? error.message : String(error)

      records.push({
        skillId: skill.id,
        agentId,
        name: skill.name,
        status: 'failed',
        durationMs,
        configUsed: config,
        note: reason,
      })
      await insertSkillRun({
        workspaceId,
        agentRunId: agentRun.id,
        skillId: skill.id,
        agentId,
        status: 'failed',
        durationMs,
        configUsed: config,
        note: reason,
      })
      publish({
        type: 'skill.failed',
        agentId,
        skillId: skill.id,
        runId: pipelineRunId ?? agentRun.id,
        message: `${skill.name} failed — ${reason}`,
        data: { durationMs, critical: skill.critical === true },
      })
      await insertActivity({
        workspaceId,
        agentId,
        message: `${skill.name} failed — ${reason}`,
        status: 'error',
      })

      if (skill.critical) {
        failure = `${skill.id} failed — ${reason}`
        break
      }
    }
  }

  const durationMs = Date.now() - startedAt
  const status: 'completed' | 'failed' = failure ? 'failed' : 'completed'
  const outputCount = countOutputs(payload)

  await finishAgentRun(agentRun.id, {
    status,
    durationMs,
    outputCount,
    ...(failure === undefined ? {} : { error: failure }),
  })

  await setAgentState(workspaceId, agentId, {
    status: failure ? 'failed' : 'completed',
    currentTask: failure ? 'Failed' : 'Idle',
    lastRun: true,
    processed: outputCount,
    successRate: attempted === 0 ? 100 : Math.round((succeeded / attempted) * 100),
  })

  publish({
    type: failure ? 'agent.failed' : 'agent.finished',
    agentId,
    runId: pipelineRunId ?? agentRun.id,
    ...(turnId === null ? {} : { turnId }),
    message: failure ?? `${agentId} completed in ${durationMs}ms`,
    data: { agentRunId: agentRun.id, durationMs, outputCount, skills: records.length },
  })

  if (failure) {
    publishActivity(agentId, failure, 'error')
  }

  return {
    agentId,
    agentRunId: agentRun.id,
    status,
    payload,
    skills: records,
    durationMs,
    ...(failure === undefined ? {} : { error: failure }),
  }
}

/**
 * A rough count of what the agent produced, for the telemetry row.
 * The largest array on the payload is a good enough proxy and needs no
 * per-agent special-casing.
 */
function countOutputs(payload: Record<string, unknown>): number {
  let largest = 0
  for (const value of Object.values(payload)) {
    if (Array.isArray(value) && value.length > largest) largest = value.length
  }
  return largest
}

/* ═══════════════════════════════════════════════════════════════════════════
   RUNNING A SINGLE SKILL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Runs one skill in isolation, still writing a `skill_runs` row so the
 * execution is as explainable as one inside a pipeline. Used by the tools that
 * do one focused thing — a caption rewrite, a compliance check, a re-render.
 */
export async function runSkill<TPayload extends Record<string, unknown>>(
  skillId: string,
  input: TPayload,
  opts: RunAgentOptions,
): Promise<{ payload: TPayload & Record<string, unknown>; record: SkillRunRecord }> {
  const skill = SKILL_BY_ID[skillId]
  if (!skill) throw new Error(`runSkill('${skillId}') — no such skill in the registry.`)

  const result = await runAgent(skill.agentId, input, {
    ...opts,
    onlySkills: [skillId],
    currentTask: skill.name,
  })

  const record =
    result.skills[0] ??
    ({
      skillId,
      agentId: skill.agentId,
      name: skill.name,
      status: 'skipped',
      durationMs: 0,
      configUsed: defaultSkillConfig(skillId),
      note: 'Not executed',
    } satisfies SkillRunRecord)

  return { payload: result.payload as TPayload & Record<string, unknown>, record }
}

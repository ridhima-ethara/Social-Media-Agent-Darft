/**
 * REPLAY — reconstructing a past run after the knobs have changed.
 *
 * `skill_runs.config_used` carries the fully resolved configuration for that
 * exact execution. This module diffs it against the registry defaults and the
 * current workspace values, so "why was #GenAI rejected?" is answerable years
 * later even though the thresholds have since moved.
 */

import { SKILL_BY_ID, defaultSkillConfig } from '@shared/agent-registry'
import type { SkillRun } from '../types'

export interface KnobDelta {
  key: string
  label: string
  description: string
  used: string | number | boolean
  current: string | number | boolean
  changed: boolean
  unit?: string
}

export interface RunExplanation {
  skillId: string
  skillName: string
  agentId: string
  status: SkillRun['status']
  durationMs: number | null
  startedAt: string
  note: string | null
  knobs: KnobDelta[]
  /** How many knobs differ between then and now. */
  changedCount: number
  /** One plain sentence naming what would run differently today. */
  summary: string
}

/**
 * Explains one recorded skill run against today's configuration.
 *
 * `current` is the live workspace value where one is supplied, otherwise the
 * registry default — the same precedence the runtime resolves with.
 */
export function explainRun(
  run: SkillRun,
  currentValues?: Record<string, string | number | boolean>,
): RunExplanation {
  const spec = SKILL_BY_ID[run.skill_id]
  const defaults = spec ? defaultSkillConfig(run.skill_id) : {}
  const current = { ...defaults, ...(currentValues ?? {}) }

  const knobs: KnobDelta[] = (spec?.config ?? []).map((field) => {
    const used = run.config_used?.[field.key] ?? field.default
    const now = current[field.key] ?? field.default
    return {
      key: field.key,
      label: field.label,
      description: field.description,
      used,
      current: now,
      changed: String(used) !== String(now),
      ...(field.unit ? { unit: field.unit } : {}),
    }
  })

  const changed = knobs.filter((k) => k.changed)

  const summary =
    changed.length === 0
      ? 'Nothing has changed since that run: the same settings would produce the same verdict today.'
      : `${changed.length} setting${changed.length === 1 ? '' : 's'} ${changed.length === 1 ? 'has' : 'have'} changed since that run — ${changed
          .map((k) => `${k.label} was ${k.used}, it is now ${k.current}`)
          .join('; ')}. The verdict was correct for the configuration in force at the time.`

  return {
    skillId: run.skill_id,
    skillName: spec?.name ?? run.skill_id,
    agentId: run.agent_id,
    status: run.status,
    durationMs: run.duration_ms,
    startedAt: run.started_at,
    note: run.note,
    knobs,
    changedCount: changed.length,
    summary,
  }
}

/**
 * Groups a run's skill executions by agent, in registry order, so the console
 * can print a run the way it actually happened.
 */
export function groupByAgent(runs: SkillRun[]): Array<{ agentId: string; runs: SkillRun[] }> {
  const groups = new Map<string, SkillRun[]>()
  for (const run of runs) {
    const bucket = groups.get(run.agent_id) ?? []
    bucket.push(run)
    groups.set(run.agent_id, bucket)
  }
  return [...groups.entries()].map(([agentId, list]) => ({
    agentId,
    runs: list.sort((a, b) => (SKILL_BY_ID[a.skill_id]?.order ?? 0) - (SKILL_BY_ID[b.skill_id]?.order ?? 0)),
  }))
}

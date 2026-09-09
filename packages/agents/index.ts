/**
 * THE AGENT ROSTER
 *
 * Each agent's seven-field contract, plus the skill that specifies its
 * behaviour and the tool allowlist that enforces its Boundaries.
 *
 * Constraint 6: if a skill says an agent must not do X, that agent gets no tool
 * capable of X. The allowlist is the first line of defence; the prompt is the
 * second. An agent with a tool its skill forbids is a defect, and
 * `assertToolAllowlists()` below is what catches it.
 */

import type { AgentSpec } from '../contracts/src/index'
import { SKILLS_BY_AGENT } from '../../shared/agent-registry'

import { AGENT_MODULES } from './roster'

/** One entry per folder, in pipeline order. The folders are the source; this is the view. */
export const AGENT_ROSTER: AgentSpec[] = AGENT_MODULES.map((module) => module.spec)

/** Runtime skill ids per agent, as each folder declares them. */
export const SKILLS_BY_FOLDER: Record<string, readonly string[]> = Object.fromEntries(
  AGENT_MODULES.map((module) => [module.spec.id, module.SKILLS]),
)

/** Where each agent's handlers live, as each folder declares it. */
export const HANDLERS_BY_AGENT: Record<string, string> = Object.fromEntries(
  AGENT_MODULES.map((module) => [module.spec.id, module.HANDLERS]),
)

export const AGENT_BY_ID: Record<string, AgentSpec> = Object.fromEntries(
  AGENT_ROSTER.map((agent) => [agent.id, agent]),
)

/* ═══════════════════════════════════════════════════════════════════════════
   ENFORCEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AllowlistProblem {
  agentId: string
  message: string
}

/**
 * Tools no agent may hold except the one named — the Boundaries that matter
 * most, expressed as an allowlist rather than a prompt instruction.
 */
const EXCLUSIVE: Record<string, string> = {
  'idea.publish': 'publishing',
  'idea.approve.leadership': 'publishing',
}

export function assertToolAllowlists(): AllowlistProblem[] {
  const problems: AllowlistProblem[] = []

  for (const agent of AGENT_ROSTER) {
    for (const tool of agent.tools ?? []) {
      const owner = EXCLUSIVE[tool]
      if (owner && owner !== agent.id) {
        problems.push({
          agentId: agent.id,
          message: `holds "${tool}", which only ${owner} may hold. A Boundary must be an absent tool, not a prompt instruction.`,
        })
      }
    }
    if (!agent.skill) {
      problems.push({ agentId: agent.id, message: 'has no skill specification.' })
    }
  }

  return problems
}

/**
 * The folder and the registry must agree on which skills an agent runs. A
 * folder that lists a skill the registry does not declare, or misses one it
 * does, is the drift this check exists to catch.
 */
export function assertFoldersMatchRegistry(): AllowlistProblem[] {
  const problems: AllowlistProblem[] = []
  for (const agent of AGENT_ROSTER) {
    const declared = (SKILLS_BY_AGENT[agent.id as keyof typeof SKILLS_BY_AGENT] ?? []).map((s) => s.id).sort()
    const folder = [...(SKILLS_BY_FOLDER[agent.id] ?? [])].sort()
    if (declared.join(',') !== folder.join(',')) {
      const missing = declared.filter((id) => !folder.includes(id))
      const extra = folder.filter((id) => !declared.includes(id))
      problems.push({
        agentId: agent.id,
        message: `folder SKILLS drift from the registry — missing: ${missing.join(', ') || 'none'}; extra: ${extra.join(', ') || 'none'}`,
      })
    }
  }
  return problems
}

/**
 * CONTRACTS — the folder-level agent contract, and nothing else.
 *
 * This package has **zero dependencies** and must keep it that way. Everything
 * else in the repo may depend on it; it depends on nothing, so it can never
 * introduce a cycle and can always be imported from either tier.
 *
 * No runtime behaviour lives here. No numbers live here either — a threshold in
 * a contract is a threshold nobody can tune (Constraint 1).
 *
 * WHAT IS DELIBERATELY NOT HERE. This file once also declared `Platform`,
 * `ValidationVerdict`, `Sourced`, `Reported`, `MemoryEntry`, `CoreContext`,
 * `Connector` and `EvidenceAware`. Every one of those had a second, richer
 * declaration in `shared/agent-contract.ts` — the one both tiers actually
 * import — and the copies here were read by nothing after the parallel
 * connector layer was removed. Two declarations of one contract is the failure
 * mode this package exists to prevent, so the duplicates are gone rather than
 * kept "in case". If a shape is needed by both tiers it belongs in
 * `shared/agent-contract.ts`.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   THE AGENT CONTRACT — the seven fields every agent folder declares
   ═══════════════════════════════════════════════════════════════════════════ */

export type StageId =
  | 'command'
  | 'discover'
  | 'assess'
  | 'plan'
  | 'create'
  | 'ship'
  | 'learn'

/**
 * What `packages/agents/NN-<id>/spec.ts` exports.
 *
 * Intentionally NOT the same type as `AgentSpec` in `shared/agent-contract.ts`.
 * That one is the operator-facing registry entry — it carries an `icon`, closed
 * `AgentId` / `StageId` unions and the Agent Studio sections. This one is the
 * architectural declaration: which skill specifies the agent and which tools it
 * is allowed to hold. `packages/agents/index.ts` audits the two against each
 * other, which only works because they are separate statements of the same
 * agent rather than one type doing both jobs.
 */
export interface AgentSpec {
  /** Permanent. This is a storage key; renaming it orphans history. */
  id: string
  name: string
  stage: StageId
  /** One sentence, in the operator's language. */
  role: string
  /** What it does, and what it refuses to do. */
  description: string
  consumes: string[]
  produces: string[]
  /** The hand-off graph. Sequencing is derived from this, never hard-coded. */
  handsOffTo: string[]
  /** The skill this agent's behaviour is specified by, under packages/skills/. */
  skill?: string
  /**
   * The tools this agent may call. A Boundary in the skill must correspond to
   * an absent tool here — the allowlist is the first line of defence, the
   * prompt is the second (Constraint 6).
   */
  tools?: string[]
}

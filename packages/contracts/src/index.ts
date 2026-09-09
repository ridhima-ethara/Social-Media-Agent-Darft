/**
 * CONTRACTS — types and shapes, and nothing else.
 *
 * This package has **zero dependencies** and must keep it that way. Everything
 * else in the repo may depend on it; it depends on nothing, so it can never
 * introduce a cycle and can always be imported from either tier.
 *
 * No runtime behaviour lives here. No numbers live here either — a threshold in
 * a contract is a threshold nobody can tune (Constraint 1).
 */

/* ═══════════════════════════════════════════════════════════════════════════
   THE AGENT CONTRACT — the seven fields every agent conforms to
   ═══════════════════════════════════════════════════════════════════════════ */

export type StageId =
  | 'command'
  | 'discover'
  | 'assess'
  | 'plan'
  | 'create'
  | 'ship'
  | 'learn'

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

/* ═══════════════════════════════════════════════════════════════════════════
   MEMORY
   ═══════════════════════════════════════════════════════════════════════════ */

export type Confidence = 'High' | 'Medium' | 'Low'

export type KnowledgeOrigin = 'brand' | 'research' | 'learned' | 'manual' | 'assistant'

export interface Citation {
  title: string
  url: string
  publishedAt?: string
}

export interface MemoryEntry {
  id: string
  title: string
  category: string
  content: string
  /** Empty is only legal for brand and manual origins. Research must cite. */
  sources: Citation[]
  confidence: Confidence
  /** How many independent confirmations stand behind it. */
  evidenceCount: number
  active: boolean
  origin: KnowledgeOrigin
  createdAt: string
}

export interface MemoryQuery {
  topic: string
  limit?: number
  categories?: string[]
  /** Inactive entries are never returned to a generation path. */
  includeInactive?: boolean
}

/* ═══════════════════════════════════════════════════════════════════════════
   CORE CONTEXT — the one situational snapshot every agent reads
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A metric that may legitimately be absent.
 *
 * Constraint 2: `N/A` is never `0`. This type makes that unrepresentable — a
 * consumer cannot read the value without acknowledging it may not be there.
 */
export type Reported<T> = { reported: true; value: T } | { reported: false; reason: string }

export function reported<T>(value: T): Reported<T> {
  return { reported: true, value }
}

export function unreported<T = never>(reason: string): Reported<T> {
  return { reported: false, reason }
}

/** Reads a reported value or a fallback. Never coerces absence to zero. */
export function valueOr<T>(metric: Reported<T>, fallback: T): T {
  return metric.reported ? metric.value : fallback
}

export interface CoreContext {
  counts: {
    keywords: number
    hashtags: number
    ideas: number
    published: number
    knowledge: number
  }
  queues: {
    validationReview: number
    awaitingLeadership: number
    knowledgeConflicts: number
  }
  agentStates: Array<{ agentId: string; status: string; currentTask: string }>
  lastRun: {
    id: string
    status: string
    finishedAt: string | null
    summary: Record<string, unknown>
  } | null
  operator: { name: string; role: 'marketing' | 'leadership' }
  /** Active entries only, ranked for the requested topic. */
  knowledge: MemoryEntry[]
  /** Anything omitted to fit the budget, named. Never silently dropped. */
  truncated: string[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SOURCING STAMP — what makes a fallback honest
   ═══════════════════════════════════════════════════════════════════════════ */

export type SourceMode = 'live' | 'fixture'

export type Sourced<T> = T & {
  source: SourceMode
  /** Required whenever `source` is `fixture`. Names the env key that fixes it. */
  fallbackReason?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONNECTOR HEALTH — every connector reports the same shape
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ConnectorHealth {
  id: string
  label: string
  configured: boolean
  /** A human sentence, e.g. "CRAWL4AI_PYTHON is not set". */
  reason: string
  /** The env key that would switch it on. Empty for purely local connectors. */
  envKey: string
}

export interface Connector {
  readonly id: string
  readonly label: string
  health(): ConnectorHealth
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESULTS
   ═══════════════════════════════════════════════════════════════════════════ */

export type Platform = 'linkedin' | 'instagram' | 'x' | 'facebook'

export type ValidationVerdict = 'validated' | 'needs_review' | 'duplicate' | 'rejected'

export interface Verdict {
  verdict: ValidationVerdict
  /** Names the specific evidence. "Low confidence" alone is a defect. */
  reason: string
  /** Set for duplicates. Points at a real surviving row — never deleted. */
  duplicateOfId?: string
}

export interface InjectionAttempt {
  itemId: string
  patternId: string
  label: string
  excerpt: string
}

/** Anything an agent returns that read untrusted content carries this. */
export interface EvidenceAware {
  injectionAttempts: InjectionAttempt[]
}

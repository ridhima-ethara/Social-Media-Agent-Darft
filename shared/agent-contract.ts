/**
 * THE CONTRACT
 *
 * These types are the single shared vocabulary of the platform. They are
 * imported by the server runtime, the web app and the spec generator, so the
 * declaration cannot fork between the three consumers.
 *
 * Law 1: the registry is the single source of truth. Nothing may exist in code
 * that is not declared here first.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   STAGES AND AGENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/** The seven pipeline stages, in execution order. */
export const STAGE_IDS = [
  'command',
  'discover',
  'assess',
  'plan',
  'create',
  'ship',
  'learn',
] as const

export type StageId = (typeof STAGE_IDS)[number]

/** The twelve agents. `assistant` is the command plane; the other eleven are specialists. */
export const AGENT_IDS = [
  'assistant',
  'scraping',
  'validation',
  'analysis',
  'calendar',
  'caption',
  'image',
  'review',
  'knowledge',
  'publishing',
  'analytics',
  'learning',
] as const

export type AgentId = (typeof AGENT_IDS)[number]

/**
 * The icon vocabulary. Names are semantic rather than pictorial so the web app
 * can change which glyph it draws without the contract changing meaning.
 */
export const AGENT_ICON_IDS = [
  'command',
  'search',
  'flask',
  'chart-cluster',
  'calendar',
  'pen',
  'palette',
  'check-shield',
  'book',
  'send',
  'bar-chart',
  'graduation',
] as const

export type AgentIconId = (typeof AGENT_ICON_IDS)[number]

export interface StageSpec {
  id: StageId
  name: string
  /** One line the UI shows under the stage name. */
  summary: string
  agents: AgentId[]
}

export interface AgentSpec {
  id: AgentId
  name: string
  /**
   * The icon the UI renders beside this agent's name.
   *
   * A stable id, not a component and not a glyph: `shared/` is imported by the
   * server as well as the web app, so it may not depend on a React icon set.
   * The web app maps this to a real icon in `components/agent-icon.tsx`.
   *
   * Deliberately NOT an emoji. Rule 5 sets the emoji budget to zero, and a
   * platform that renders its own agents as emoji while stripping them from
   * captions is holding two standards at once.
   */
  icon: AgentIconId
  stage: StageId
  /** A short noun phrase: what this agent is for. */
  role: string
  /** Two or three sentences of plain language, rendered directly in Agent Studio. */
  description: string
  /** What arrives at this agent. */
  consumes: string[]
  /** What leaves it. */
  produces: string[]
  /** The hand-off graph. The orchestration screen draws its edges from this. */
  handsOffTo: AgentId[]
  /** Optional grouping labels for the skill list in Agent Studio. */
  sections?: string[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   SKILLS AND THEIR KNOBS
   ═══════════════════════════════════════════════════════════════════════════ */

export type ConfigType = 'number' | 'percent' | 'boolean' | 'enum' | 'text'

export type ConfigValue = string | number | boolean

/**
 * One operator-visible knob.
 *
 * Law 2: no hardcoded tunables. Every number a reasonable operator might want
 * to change is declared here and read through `ctx.config`. A constant buried
 * in a handler is a knob the operator cannot see, and therefore a defect.
 */
export interface ConfigField {
  key: string
  label: string
  type: ConfigType
  default: ConfigValue
  /**
   * MANDATORY. Rendered directly to the operator beneath the control.
   * A field without a description is an invalid registry entry and
   * `npm run agent:check` fails on it.
   */
  description: string
  min?: number
  max?: number
  step?: number
  unit?: string
  options?: string[]
}

export interface SkillSpec {
  /**
   * Namespaced, e.g. 'validation.hashtag.rank'.
   * This is a STORAGE KEY written into `skill_runs` and `agent_skills`.
   * Renaming it orphans history. One id, forever.
   */
  id: string
  agentId: AgentId
  /** Grouping label within the agent, matched against `AgentSpec.sections`. */
  section?: string
  name: string
  /**
   * What this skill does, in one sentence.
   * Law: a skill does exactly one thing. If the summary needs "and" twice,
   * it should have been two skills.
   */
  summary: string
  inputs: string[]
  outputs: string[]
  config: ConfigField[]
  order: number
  enabledByDefault: boolean
  /**
   * A critical skill runs even when disabled, and the boot-time coverage audit
   * fails loudly if it has no registered handler. `PATCH /skills/:id` refuses
   * to disable it.
   */
  critical?: boolean
}

/* ═══════════════════════════════════════════════════════════════════════════
   RUNTIME SURFACE
   ═══════════════════════════════════════════════════════════════════════════ */

/** Resolved knob values for one skill execution: defaults < workspace < run. */
export type ResolvedConfig = Record<string, ConfigValue>

export type ActivityStatus = 'ok' | 'running' | 'warn' | 'error'

/**
 * Everything a skill handler is allowed to touch beyond its input payload.
 *
 * Law: a skill is pure with respect to (input, ctx.config). Same in, same out.
 * Every side effect goes through this context. No module-level mutable state.
 * That is what makes a run replayable from its logged `config_used`.
 */
export interface SkillContext {
  workspaceId: string
  /** The fully resolved knob set for this exact run. */
  config: ResolvedConfig
  /** Typed accessors that fall back to the registry default when absent. */
  num(key: string, fallback?: number): number
  bool(key: string, fallback?: boolean): boolean
  str(key: string, fallback?: string): string
  /** A human line for the run console. */
  log(message: string): void
  /** A structured event onto the SSE bus. */
  emit(type: string, message: string, data?: Record<string, unknown>): void
  /** Pipeline run id, when this skill is running inside one. */
  runId?: string
  /** The command plane turn that triggered this, when applicable. */
  turnId?: string
}

/** A skill handler mutates nothing; it returns the patch to merge into the payload. */
export type SkillHandler<
  TPayload extends Record<string, unknown> = Record<string, unknown>,
> = (
  payload: TPayload,
  ctx: SkillContext,
) => Promise<Record<string, unknown>> | Record<string, unknown>

export type SkillRunStatus = 'completed' | 'skipped' | 'failed'

export interface SkillRunRecord {
  skillId: string
  agentId: AgentId
  name: string
  status: SkillRunStatus
  durationMs: number
  /** The resolved config this run actually used — the key to explainability. */
  configUsed: ResolvedConfig
  note?: string
}

export type AgentRunStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'waiting'
  | 'needs_review'
  | 'failed'

export interface AgentRunResult<TPayload = Record<string, unknown>> {
  agentId: AgentId
  agentRunId: string
  status: Extract<AgentRunStatus, 'completed' | 'failed'>
  payload: TPayload
  skills: SkillRunRecord[]
  durationMs: number
  error?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   SERVICE ADAPTERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Law 3: every external service sits behind this interface, with a
 * deterministic offline fallback. The product must be fully explorable and
 * demoable with a completely empty `.env`.
 */
export interface ServiceAdapter<TIn, TOut> {
  readonly id: string
  readonly label: string
  /** Reads env LAZILY, at call time — never at import time. */
  isConfigured(): boolean
  /** A human sentence, e.g. "CRAWL4AI_PYTHON is not set". */
  unavailableReason(): string
  /** Throws on non-2xx or an unparseable body. Callers catch and fall back. */
  run(input: TIn): Promise<TOut>
}

/** Every artefact records which implementation produced it, and why. */
export type Sourced<T> = T & {
  source: 'live' | 'fixture'
  fallbackReason?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   DOMAIN VOCABULARY
   ═══════════════════════════════════════════════════════════════════════════ */

export const PLATFORMS = ['linkedin', 'instagram', 'x', 'facebook'] as const
export type Platform = (typeof PLATFORMS)[number]

/**
 * WHAT KIND OF ARTEFACT AN IDEA BECOMES (ADR-007).
 *
 * A closed union, like `Platform`, and anything switching on it must be
 * exhaustive. `'post'` is the default on every row so the column arrives
 * without a backfill and every pre-existing idea stays valid.
 *
 * NOT to be confused with `EditorialFormat` in `server/src/agents/corpus.ts`,
 * which is the editorial SHAPE of a post — Thought Leadership, Carousel, Case
 * Study. That one used to be called `ContentFormat` too; ADR-007 renamed it,
 * because two types with one name meaning different things is a landmine.
 *
 * `short_form_script` terminates at export and never enters the publish state
 * machine (ADR-010).
 */
export const CONTENT_FORMATS = ['post', 'short_form_script'] as const
export type ContentFormat = (typeof CONTENT_FORMATS)[number]

/** What an operator sees. Kept beside the union so a rename cannot orphan it. */
export const CONTENT_FORMAT_LABEL: Record<ContentFormat, string> = {
  post: 'Post',
  short_form_script: 'Short-form script',
}

/**
 * THE HOOK PATTERN VOCABULARY.
 *
 * Each variant a run produces is tagged with the pattern it used, so "give me
 * another curiosity-gap one" is answerable and "we only ever write pain-point
 * hooks" is detectable. A closed union because `hook_variants.pattern` carries a
 * CHECK constraint over exactly these values.
 *
 * The source specification names its five patterns in Hinglish and in terms of
 * a creator's own reels. These are the same five structures, named for what
 * they DO rather than for the phrase that opens them — a pattern named after
 * its own example stops being a pattern the first time the example is reworded.
 */
export const HOOK_PATTERNS = [
  'aspirational',
  'pain_point',
  'insider',
  'specific_claim',
  'curiosity_gap',
] as const
export type HookPattern = (typeof HOOK_PATTERNS)[number]

export const HOOK_PATTERN_LABEL: Record<HookPattern, string> = {
  aspirational: 'Aspirational',
  pain_point: 'Pain point',
  insider: 'Insider knowledge',
  specific_claim: 'Specific claim',
  curiosity_gap: 'Curiosity gap',
}

/** One line an operator can read, describing what each pattern is for. */
export const HOOK_PATTERN_BRIEF: Record<HookPattern, string> = {
  aspirational: 'Shows the better version of the thing the viewer already has.',
  pain_point: 'Names a frustration the viewer is feeling right now.',
  insider: 'Frames the content as something most people in the field do not know.',
  specific_claim: 'States one measured number and what it produced. Needs stored evidence.',
  curiosity_gap: 'Asks something the viewer cannot answer without watching.',
}

/** Exactly one of these lands on every candidate. Nothing is ever deleted. */
export const VALIDATION_VERDICTS = [
  'pending',
  'validated',
  'needs_review',
  'duplicate',
  'rejected',
] as const
export type ValidationVerdict = (typeof VALIDATION_VERDICTS)[number]

export const IDEA_STATUSES = [
  'suggested',
  'drafted',
  'in_review',
  'pending_leadership',
  'approved',
  'scheduled',
  'published',
  'rejected',
] as const
export type IdeaStatus = (typeof IDEA_STATUSES)[number]

/** The per-platform cap (`topPerPlatform`, 5 by default): only `primary` ideas take a calendar slot. */
export type CalendarSlot = 'primary' | 'suggestion'

/**
 * The Knowledge Base category holding the scrape's own record of itself.
 *
 * `recordScrapedTopicsAsKnowledge` writes one `Signal · <keyword>` entry per
 * capture, listing the topics and hashtags it saw and citing every page URL. It
 * exists so an operator can see what a run scraped.
 *
 * It is bookkeeping, not a finding, and three readers have to agree on that:
 * retrieval excludes it from grounding (it would otherwise match every keyword
 * query, since the keyword is its title, and then hand a raw social URL to a
 * caption as its "Source:"), the duplicate check excludes it (a run would
 * otherwise mark its own capture redundant against the entry it just wrote), and
 * the Knowledge Base screen includes it (that is the point of writing it).
 *
 * One home for the name, so a rename cannot make the writer and those readers
 * disagree silently.
 */
export const SIGNALS_CATEGORY = 'Signals'

/**
 * The two entries in the roster that are NOT operational agents.
 *
 * The registry declares twelve, and `scripts/check-agents.ts` asserts exactly
 * twelve, because twelve is what the graph is built from. But two of them are not
 * things an operator watches run:
 *
 *   · `assistant`  — Ethara Command. The command plane: the query or instruction
 *                    the human passes in. It directs the others; it is not a
 *                    pipeline stage that sits idle waiting for work.
 *   · `knowledge`  — the Knowledge Base itself. A cited store that is read from
 *                    and written to, not a worker with a run of its own.
 *
 * So "all N agents idle" counts TEN. Deriving it by exclusion rather than writing
 * `10` keeps the number honest: add a real agent to the registry and the line
 * follows, and the reason each one is excluded stays attached to the exclusion.
 */
export const NON_OPERATIONAL_AGENT_IDS = ['assistant', 'knowledge'] as const

/** The agents an operator actually watches run — the roster minus the two above. */
export function operationalAgents<T extends { agent_id: string }>(all: readonly T[]): T[] {
  return all.filter((a) => !(NON_OPERATIONAL_AGENT_IDS as readonly string[]).includes(a.agent_id))
}
export type Confidence = 'High' | 'Medium' | 'Low'

export type OperatorRole = 'marketing' | 'leadership'

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS — used by the registry itself, so they live with the contract
   ═══════════════════════════════════════════════════════════════════════════ */

/** Declare a number knob. */
export function num(
  key: string,
  label: string,
  def: number,
  description: string,
  opts: { min?: number; max?: number; step?: number; unit?: string } = {},
): ConfigField {
  return { key, label, type: 'number', default: def, description, ...opts }
}

/** Declare a 0–100 percentage knob. */
export function pct(
  key: string,
  label: string,
  def: number,
  description: string,
  opts: { min?: number; max?: number; step?: number } = {},
): ConfigField {
  return {
    key,
    label,
    type: 'percent',
    default: def,
    description,
    min: opts.min ?? 0,
    max: opts.max ?? 100,
    step: opts.step ?? 1,
    unit: '%',
  }
}

/** Declare a boolean knob. */
export function bool(
  key: string,
  label: string,
  def: boolean,
  description: string,
): ConfigField {
  return { key, label, type: 'boolean', default: def, description }
}

/** Declare an enumerated knob. */
export function enumField(
  key: string,
  label: string,
  options: string[],
  def: string,
  description: string,
): ConfigField {
  return { key, label, type: 'enum', default: def, description, options }
}

/** Declare a free-text knob. */
export function text(
  key: string,
  label: string,
  def: string,
  description: string,
): ConfigField {
  return { key, label, type: 'text', default: def, description }
}

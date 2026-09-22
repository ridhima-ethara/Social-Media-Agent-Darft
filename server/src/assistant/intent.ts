/**
 * INTERPRET — utterance → Intent.
 *
 * Two implementations behind one interface, and BOTH ship:
 *
 *   A · Model-backed, when `ASSISTANT_MODEL_PROVIDER=gcp` and GCP is configured.
 *       One call, a system prompt assembled from the tool registry, strict JSON out.
 *   B · A deterministic grammar built FROM the registry's own `examples` arrays,
 *       always available, and the fallback. Blunter, fully working.
 *
 * Confidence below `clarifyThreshold` asks one short question with the two most
 * likely readings. It never guesses. Missing required arguments are asked for
 * individually, and never re-asked for something already given.
 */

import {
  matchTools,
  TOOLS,
  TOOL_BY_ID,
  grammarTokens,
  type ToolSpec,
} from '../../../shared/tool-registry'
import type { Platform } from '../../../shared/agent-contract'
import { PLATFORMS } from '../../../shared/agent-contract'
import { similarity } from '../../../shared/brand-voice'
import { config } from '../config'
import { textAdapter } from '../integrations'
import { findIdeasByTitle, listKeywords } from '../db/repo'
import { addDays, isoDate, nearestPostingTime, startOfWeek } from '../agents/corpus'
import type { SituationSnapshot } from './context'

/* ═══════════════════════════════════════════════════════════════════════════
   THE INTENT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Intent {
  /** A tool id, or one of the three conversational actions. */
  action: string
  entities: Record<string, unknown>
  /** 0–100. */
  confidence: number
  /** the command plane's own restatement, shown in the plan card. */
  restated: string
  /** Required args it could not fill. */
  missing?: string[]
  /** Present when `action === 'clarify'`. */
  candidates?: Array<{ toolId: string; label: string; utterance: string }>
  /** Which implementation produced this. */
  parser: 'model' | 'grammar'
  parserReason?: string
}

export interface ParseOptions {
  workspaceId: string
  utterance: string
  snapshot: SituationSnapshot
  clarifyThreshold: number
  minConfidence: number
  useModel: boolean
  synonymsEnabled: boolean
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ENTRY POINT
   ═══════════════════════════════════════════════════════════════════════════ */

export async function parseIntent(opts: ParseOptions): Promise<Intent> {
  // The planner runs on whichever provider the operator named — Gemini or a
  // local Qwen3 — and on the deterministic grammar when neither is reachable.
  const planner = textAdapter()
  const modelReady =
    opts.useModel && config.assistant.provider !== 'deterministic' && planner.isConfigured()

  if (modelReady) {
    try {
      const fromModel = await parseWithModel(opts)
      if (fromModel) return await enrich(fromModel, opts)
    } catch (error) {
      // Fail in the open: the grammar is always there, and the reason is kept.
      const reason = error instanceof Error ? error.message : String(error)
      const grammar = parseWithGrammar(opts)
      grammar.parserReason = `The reasoning model failed (${reason}); the deterministic parser handled it.`
      return await enrich(grammar, opts)
    }
  }

  const grammar = parseWithGrammar(opts)
  if (!modelReady && opts.useModel) {
    grammar.parserReason =
      config.assistant.provider !== 'deterministic'
        ? `ASSISTANT_MODEL_PROVIDER is ${config.assistant.provider} but ${planner.unavailableReason()}`
        : 'ASSISTANT_MODEL_PROVIDER is not set, so the deterministic parser is in use.'
  }
  return enrich(grammar, opts)
}

/* ═══════════════════════════════════════════════════════════════════════════
   A · THE MODEL PARSER
   ═══════════════════════════════════════════════════════════════════════════ */

/** The system prompt is assembled from the registry, so it cannot drift. */
export function buildParserSystemPrompt(snapshot: SituationSnapshot): string {
  const catalogue = TOOLS.map((tool) => {
    const args = describeArgs(tool)
    return `· ${tool.id} (${tool.risk}) — ${tool.summary}\n  args: ${args}\n  e.g. ${tool.examples.slice(0, 3).join(' | ')}`
  }).join('\n')

  return [
    'You are the intent parser for Ethara SocialAI. You map one operator utterance onto exactly one tool.',
    '',
    'Return STRICT JSON and nothing else, in this shape:',
    '{"action":"<tool id | answer | clarify | chitchat>","entities":{},"confidence":<0-100>,"restated":"<your restatement>","missing":["<arg>"]}',
    '',
    'Rules:',
    '· `action` must be a tool id from the catalogue, or "answer" when the snapshot already contains the answer, or "clarify" when two readings are equally likely, or "chitchat".',
    '· `entities` uses the exact argument names from the catalogue.',
    '· `restated` is one short sentence in the operator’s own terms. No emoji, no exclamation marks.',
    '· `confidence` is your honest reading, not a flourish.',
    '· Resolve pronouns against the "Last referenced" line in the situation.',
    '· Never add a platform, metric or period the operator did not name; leave the argument out and the tool reports across all of them.',
    '',
    'THE TOOL CATALOGUE',
    catalogue,
    '',
    'THE SITUATION',
    snapshot.text,
  ].join('\n')
}

function describeArgs(tool: ToolSpec): string {
  const shape = (tool.args as { _def?: { typeName?: string } })._def
  if (shape?.typeName !== 'ZodObject') return '{}'
  const shapeMap = (tool.args as unknown as { shape: Record<string, { description?: string }> }).shape
  const keys = Object.keys(shapeMap)
  if (keys.length === 0) return '{}'
  return `{ ${keys.map((key) => (shapeMap[key]?.description ? `${key} (${shapeMap[key].description})` : key)).join(', ')} }`
}

/** Reads where a platform or metric the operator never named is a narrowed guess, not a resolution. */
const ANALYTICS_SCOPE_TOOLS = new Set(['analytics.query', 'analytics.compare', 'report.export'])
/** Tools that take a day: the model's phrase is resolved to a date before the plan is stored. */
const DAY_TOOLS = new Set(['idea.list', 'idea.move', 'draft.generate'])

async function parseWithModel(opts: ParseOptions): Promise<Intent | null> {
  const raw = await textAdapter().run({
    systemInstruction: buildParserSystemPrompt(opts.snapshot),
    prompt: opts.utterance,
    temperature: 0,
    maxOutputTokens: 700,
  })

  const parsed = extractJson(raw)
  if (!parsed) return null

  const action = typeof parsed.action === 'string' ? parsed.action : ''
  if (action.length === 0) return null

  // A model that names a tool that does not exist is treated as a miss, not
  // trusted. The registry is the source of truth.
  if (!['answer', 'clarify', 'chitchat'].includes(action) && !TOOL_BY_ID[action]) {
    return null
  }

  const entities: Record<string, unknown> = isRecord(parsed.entities) ? { ...parsed.entities } : {}
  if (ANALYTICS_SCOPE_TOOLS.has(action)) {
    // Qwen answers "how did last month perform?" with LinkedIn and engagement
    // rate it was never asked for. A scope the operator did not say is dropped,
    // so the read reports across everything rather than a narrowed guess.
    const lower = opts.utterance.toLowerCase()
    if (typeof entities.platform === 'string' && !/\b(linkedin|instagram|insta|facebook|fb|twitter|x)\b/.test(lower)) delete entities.platform
    if (typeof entities.metric === 'string') {
      const head = entities.metric.toLowerCase().split(/[\s_]+/)[0] ?? ''
      if (head.length === 0 || !lower.includes(head)) delete entities.metric
    }
    // And a period the operator did say is never lost to the model omitting it.
    if (typeof entities.month !== 'string') {
      const month = detectMonth(lower)
      if (month) entities.month = month
    }
  }

  if (DAY_TOOLS.has(action)) {
    // "next monday" is what the operator said, not a date. Resolve it here so
    // the confirm card and the stored plan both name the actual day; and if the
    // model dropped the day entirely, take it from the utterance.
    const lower = opts.utterance.toLowerCase()
    const fromEntity =
      typeof entities.day === 'string' ? detectDay(entities.day.toLowerCase().replace(/_/g, ' ')) : null
    const day = fromEntity ?? detectDay(lower)
    if (day) entities.day = day
    else if (typeof entities.day === 'string' && !/^\d{4}-\d{2}-\d{2}$/.test(entities.day)) delete entities.day
    if (action === 'idea.move') {
      const fromTime =
        typeof entities.time === 'string' ? detectTime(entities.time.toLowerCase().replace(/_/g, ' ')) : null
      const time = fromTime ?? detectTime(lower)
      if (time) entities.time = time
    }
  }

  return {
    action,
    entities,
    confidence: clampConfidence(parsed.confidence),
    restated: typeof parsed.restated === 'string' ? parsed.restated : opts.utterance,
    ...(Array.isArray(parsed.missing)
      ? { missing: parsed.missing.filter((m): m is string => typeof m === 'string') }
      : {}),
    parser: 'model',
  }
}

function extractJson(raw: string): Record<string, unknown> | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? (fenced[1] as string) : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed: unknown = JSON.parse(body.slice(start, end + 1))
    return isRecord(parsed) ? parsed : null
  } catch {
    return null
  }
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

function clampConfidence(v: unknown): number {
  const n = typeof v === 'number' ? v : Number(v)
  if (!Number.isFinite(n)) return 50
  return Math.max(0, Math.min(100, Math.round(n)))
}

/* ═══════════════════════════════════════════════════════════════════════════
   B · THE DETERMINISTIC GRAMMAR
   ═══════════════════════════════════════════════════════════════════════════ */

export function parseWithGrammar(opts: ParseOptions): Intent {
  const matches = matchTools(opts.utterance)
  const best = matches[0]
  const second = matches[1]

  if (!best || best.score === 0) {
    return {
      action: 'clarify',
      entities: {},
      confidence: 0,
      restated: opts.utterance,
      candidates: suggestClosest(opts.utterance),
      parser: 'grammar',
    }
  }

  // The token-similarity score is a 0–1 Dice reading. Scaling it to a percentage
  // and lifting a clean match keeps the thresholds meaningful without inflating
  // a weak one.
  const raw = Math.round(best.score * 100)
  const confidence = raw >= 62 ? Math.min(96, raw + 22) : raw >= 40 ? raw + 12 : raw

  // Two readings within a hair of each other is exactly when to ask.
  const ambiguous =
    second !== undefined && best.score - second.score < 0.06 && confidence < opts.clarifyThreshold + 20

  if (confidence < opts.minConfidence || (ambiguous && confidence < opts.clarifyThreshold)) {
    return {
      action: 'clarify',
      entities: extractEntities(opts.utterance, best.toolId),
      confidence,
      restated: opts.utterance,
      candidates: [best, second]
        .filter((m): m is NonNullable<typeof m> => m !== undefined)
        .map((m) => ({
          toolId: m.toolId,
          label: TOOL_BY_ID[m.toolId]?.summary ?? m.toolId,
          utterance: m.matchedExample,
        })),
      parser: 'grammar',
    }
  }

  const tool = TOOL_BY_ID[best.toolId]
  return {
    action: best.toolId,
    entities: extractEntities(opts.utterance, best.toolId),
    confidence,
    restated: restate(tool, opts.utterance),
    parser: 'grammar',
  }
}

function suggestClosest(utterance: string): Array<{ toolId: string; label: string; utterance: string }> {
  return TOOLS.map((tool) => ({
    tool,
    score: Math.max(...tool.examples.map((e) => similarity(e, utterance))),
  }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 2)
    .map(({ tool }) => ({
      toolId: tool.id,
      label: tool.summary,
      utterance: tool.examples[0] ?? tool.id,
    }))
}

function restate(tool: ToolSpec | undefined, utterance: string): string {
  if (!tool) return utterance
  return tool.name
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENTITY EXTRACTION
   ═══════════════════════════════════════════════════════════════════════════ */

const DAY_NAMES = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday']

const MONTH_NAMES = [
  'january', 'february', 'march', 'april', 'may', 'june',
  'july', 'august', 'september', 'october', 'november', 'december',
]

/** Everything the grammar can pull out of an utterance without a model. */
export function extractEntities(utterance: string, toolId: string): Record<string, unknown> {
  const lower = utterance.toLowerCase()
  const entities: Record<string, unknown> = {}
  const tool = TOOL_BY_ID[toolId]
  const argKeys = tool ? Object.keys((tool.args as unknown as { shape?: Record<string, unknown> }).shape ?? {}) : []
  const wants = (key: string) => argKeys.includes(key)

  /* ── Platform ─────────────────────────────────────────────────────────── */
  if (wants('platform')) {
    const platform = detectPlatform(lower)
    if (platform) entities.platform = platform
  }

  /* ── Day / relative date ──────────────────────────────────────────────── */
  if (wants('day')) {
    const day = detectDay(lower)
    if (day) entities.day = day
  }

  /* ── Bulk calendar arguments ──────────────────────────────────────────── */
  /*
   * These exist only on the bulk tools. `wants()` is keyed on the tool's own
   * schema, so a tool that does not declare them never receives them and no
   * single-idea instruction is changed by anything below.
   */
  if (wants('firstDay') || wants('days') || wants('fromDay')) {
    const named = detectDays(lower)

    if (wants('firstDay') && named.length >= 2) {
      entities.firstDay = named[0]
      entities.secondDay = named[1]
    }

    if (wants('days')) {
      // An explicit list wins; "across the week" fills in only when none was given.
      const span = named.length > 0 ? named : detectWeekSpan(lower)
      if (span.length > 0) entities.days = span
    }

    if (wants('fromDay') && wants('day') && named.length >= 2) {
      // "move everything on tuesday to wednesday" — the first day is the
      // source, the second the destination. With one day named it is the
      // destination, which `detectDay` below already handles.
      entities.fromDay = named[0]
      entities.day = named[1]
    }
  }

  if (wants('timeOfDay')) {
    const band = /\bmornings?\b/.test(lower)
      ? 'morning'
      : /\bafternoons?\b/.test(lower)
        ? 'afternoon'
        : /\bevenings?\b/.test(lower)
          ? 'evening'
          : null
    if (band) entities.timeOfDay = band
  }

  /* ── Time ─────────────────────────────────────────────────────────────── */
  if (wants('time')) {
    const time = detectTime(lower)
    if (time) entities.time = time
  }

  /* ── Month ────────────────────────────────────────────────────────────── */
  if (wants('month')) {
    const month = detectMonth(lower)
    if (month) entities.month = month
  }

  /* ── Hashtag ──────────────────────────────────────────────────────────── */
  if (wants('tag')) {
    const tag = lower.match(/#([\p{L}\p{N}_]+)/u)?.[1]
    if (tag) entities.tag = tag
    else {
      // "approve the RLHF hashtag" — the word before or after "hashtag".
      const named = lower.match(/(?:hashtag|tag)\s+([a-z0-9_]+)|([a-z0-9_]+)\s+hashtag/)
      const candidate = named?.[1] ?? named?.[2]
      if (candidate) entities.tag = candidate
    }
  }

  /* ── Verdict ──────────────────────────────────────────────────────────── */
  if (wants('validation')) {
    if (/\b(approve|validate|accept)\b/.test(lower)) entities.validation = 'validated'
    else if (/\b(reject|decline|turn down)\b/.test(lower)) entities.validation = 'rejected'
    else if (/\bneeds? review\b/.test(lower)) entities.validation = 'needs_review'
    else if (/\bduplicate\b/.test(lower)) entities.validation = 'duplicate'
  }

  /* ── Rank / limit / weight / count ────────────────────────────────────── */
  const numbers = [...lower.matchAll(/\b(\d{1,4})\b/g)].map((m) => Number(m[1]))
  if (wants('weight')) {
    const weighted = lower.match(/(?:weight|at)\s*(?:of\s*)?(\d{1,3})/)
    if (weighted) entities.weight = Number(weighted[1])
  }
  if (wants('limit') && numbers.length > 0) {
    const explicit = lower.match(/\b(?:top|first|last)\s+(\d{1,3})\b/)
    if (explicit) entities.limit = Number(explicit[1])
  }
  if (wants('hashtagCount')) {
    const explicit = lower.match(/\b(\d{1,3})\s+hashtags?\b/)
    if (explicit) entities.hashtagCount = Number(explicit[1])
  }

  /* ── Quoted subject — the most reliable title signal ──────────────────── */
  const quoted = utterance.match(/['"“”‘’]([^'"“”‘’]{3,120})['"“”‘’]/)
  if (quoted) {
    const value = (quoted[1] as string).trim()
    if (wants('term')) entities.term = value
    else if (wants('title')) entities.title = value
    else if (wants('text')) entities.text = value
    else if (wants('query')) entities.query = value
  }

  /* ── Free-text arguments ──────────────────────────────────────────────── */
  if (wants('instruction') && entities.instruction === undefined) {
    entities.instruction = stripLeadingVerb(utterance)
  }
  if (wants('reason') && entities.reason === undefined) {
    const because = utterance.match(/(?:because|since|as|reason:)\s+(.{4,240})/i)
    if (because) entities.reason = (because[1] as string).trim()
    else {
      const comma = utterance.match(/,\s*(.{6,240})$/)
      if (comma) entities.reason = (comma[1] as string).trim()
    }
  }
  if (wants('query') && entities.query === undefined) {
    entities.query = stripQuestionFrame(utterance)
  }
  if (wants('term') && entities.term === undefined) {
    const after = utterance.match(/\b(?:add|track|include)\s+(?:the\s+)?(?:keyword\s+)?(.{3,60}?)(?:\s+(?:as|at|with)\b|$)/i)
    if (after) entities.term = (after[1] as string).replace(/['"]/g, '').trim()
  }

  /* ── Category ─────────────────────────────────────────────────────────── */
  if (wants('category')) {
    if (/\bcore\b/.test(lower)) entities.category = 'Core'
    else if (/\badjacent\b/.test(lower)) entities.category = 'Adjacent'
    else if (/\bpositioning\b/.test(lower)) entities.category = 'Positioning'
  }

  /* ── Active / boolean flags ───────────────────────────────────────────── */
  if (wants('active')) {
    if (/\b(deactivate|turn off|switch off|disable|stop tracking)\b/.test(lower)) entities.active = false
    else if (/\b(activate|turn on|switch on|enable|start tracking)\b/.test(lower)) entities.active = true
  }
  if (wants('forceRefresh') && /\b(force|again|from scratch|regardless)\b/.test(lower)) {
    entities.forceRefresh = true
  }
  if (wants('resolved') && /\b(resolved|answered|done)\b/.test(lower)) {
    entities.resolved = true
  }
  if (wants('activeOnly') && /\b(all|including inactive|inactive)\b/.test(lower)) {
    entities.activeOnly = false
  }

  /* ── Slot / status ────────────────────────────────────────────────────── */
  if (wants('slot')) {
    if (/\bsuggestions?\b/.test(lower)) entities.slot = 'suggestion'
    else if (/\b(calendar|primary|scheduled)\b/.test(lower)) entities.slot = 'primary'
  }
  if (wants('status')) {
    if (/\bawaiting leadership|with leadership|pending leadership\b/.test(lower)) {
      entities.status = 'pending_leadership'
    } else if (/\bapproved\b/.test(lower)) entities.status = 'approved'
    else if (/\bpublished\b/.test(lower)) entities.status = 'published'
    else if (/\brejected\b/.test(lower)) entities.status = 'rejected'
    else if (/\bdraft(ed)?\b/.test(lower)) entities.status = 'drafted'
  }

  /* ── Export format ────────────────────────────────────────────────────── */
  if (wants('format')) {
    if (/\bcsv\b/.test(lower)) entities.format = 'csv'
    else if (/\bjson\b/.test(lower)) entities.format = 'json'
  }

  /* ── Image model ──────────────────────────────────────────────────────── */
  if (wants('model')) {
    if (/\bimagen\b/.test(lower)) entities.model = 'gcp-imagen'
    else if (/\bgemini\b/.test(lower)) entities.model = 'gcp-gemini-image'
    else if (/\bz-?image\b/.test(lower)) entities.model = 'z-image-turbo'
    else if (/\bbrand\b/.test(lower)) entities.model = 'brand-svg'
  }

  /* ── Skill configuration ──────────────────────────────────────────────── */
  if (wants('skillId')) {
    if (/\btop keywords?\b/.test(lower)) {
      entities.skillId = 'validation.keyword.trend'
      entities.key = 'topKeywords'
    } else if (/\btop hashtags? per keyword\b/.test(lower)) {
      entities.skillId = 'validation.hashtag.rank'
      entities.key = 'topHashtagsPerKeyword'
    } else if (/\bcompetitor\b/.test(lower)) {
      entities.skillId = 'scraping.competitor.track'
      entities.enabled = !/\b(off|disable|stop)\b/.test(lower)
    } else if (/\bknowledge (base )?hashtags?\b/.test(lower)) {
      entities.skillId = 'knowledge.hashtag.select'
      entities.key = 'hashtagCount'
    } else if (/\bposts? per platform|calendar posts?\b/.test(lower)) {
      entities.skillId = 'calendar.rank.select'
      entities.key = 'topPerPlatform'
    }
    if (entities.key !== undefined && numbers.length > 0) {
      entities.value = numbers[numbers.length - 1]
    }
  }

  /* ── Publish flag ─────────────────────────────────────────────────────── */
  if (wants('publish')) {
    entities.publish = !/\b(do not publish|don't publish|without publishing|hold)\b/.test(lower)
  }

  /* ── Lineage type ─────────────────────────────────────────────────────── */
  if (wants('type')) {
    if (/#/.test(lower) || /\bhashtag\b/.test(lower)) entities.type = 'hashtag'
    else if (/\bpost\b/.test(lower)) entities.type = 'post'
    else if (/\bidea\b/.test(lower)) entities.type = 'content_idea'
    else if (/\bkeyword\b/.test(lower)) entities.type = 'keyword'
    else if (/\bentry|knowledge\b/.test(lower)) entities.type = 'knowledge_entry'
  }

  return entities
}

export function detectPlatform(lower: string): Platform | null {
  if (/\blinked\s?in\b|\bli\b/.test(lower)) return 'linkedin'
  if (/\binsta(gram)?\b|\big\b/.test(lower)) return 'instagram'
  if (/\bon x\b|\btwitter\b|\btweet\b|\bx post\b/.test(lower)) return 'x'
  for (const platform of PLATFORMS) {
    if (lower.includes(platform)) return platform
  }
  return null
}

/** Resolves a weekday name or a relative phrase to an ISO date. */
export function detectDay(lower: string, now = new Date()): string | null {
  if (/\btoday\b/.test(lower)) return isoDate(now)
  if (/\btomorrow\b/.test(lower)) return isoDate(addDays(now, 1))
  if (/\byesterday\b/.test(lower)) return isoDate(addDays(now, -1))

  const explicit = lower.match(/\b(\d{4}-\d{2}-\d{2})\b/)
  if (explicit) return explicit[1] as string

  for (let i = 0; i < DAY_NAMES.length; i += 1) {
    const name = DAY_NAMES[i] as string
    if (!new RegExp(`\\b${name}|\\b${name.slice(0, 3)}\\b`).test(lower)) continue

    const weekStart = startOfWeek(now)
    // Monday-first offset: the table is Sunday-first, so Sunday wraps to the end.
    const offset = i === 0 ? 6 : i - 1
    let date = addDays(weekStart, offset)
    if (/\bnext\b/.test(lower)) date = addDays(date, 7)
    if (/\blast\b/.test(lower)) date = addDays(date, -7)
    return isoDate(date)
  }
  return null
}

/**
 * Every day named in an utterance, in the order they were said.
 *
 * `detectDay` answers "which day is this about" and stops at the first hit,
 * which is right for "move it to Thursday" and useless for "swap Tuesday and
 * Thursday" or "spread these across Tuesday, Thursday and Friday" — the whole
 * point of those is the second and third name.
 *
 * Scans by POSITION rather than by iterating the weekday table, so the order
 * returned is the order the operator said them. "Swap Thursday and Tuesday"
 * has to mean something different from "swap Tuesday and Thursday" for the
 * first/second arguments to carry any information at all.
 */
export function detectDays(lower: string, now = new Date()): string[] {
  const hits: Array<{ at: number; token: string }> = []

  for (const token of ['today', 'tomorrow', 'yesterday']) {
    const at = lower.indexOf(token)
    if (at >= 0) hits.push({ at, token })
  }

  const iso = /\b\d{4}-\d{2}-\d{2}\b/g
  let m: RegExpExecArray | null
  while ((m = iso.exec(lower)) !== null) hits.push({ at: m.index, token: m[0] })

  for (const name of DAY_NAMES) {
    const re = new RegExp(`\\b(${name}|${name.slice(0, 3)})\\b`, 'g')
    let hit: RegExpExecArray | null
    while ((hit = re.exec(lower)) !== null) hits.push({ at: hit.index, token: hit[0] })
  }

  hits.sort((a, b) => a.at - b.at)

  const out: string[] = []
  for (const hit of hits) {
    // Each token is resolved through `detectDay` so "next"/"last" handling and
    // the week-start arithmetic stay in exactly one place.
    const date = detectDay(hit.token, now)
    if (date !== null && !out.includes(date)) out.push(date)
  }
  return out
}

/**
 * "Across the week" and its relatives, expanded to the working week.
 *
 * Returned only when no explicit days were named — an operator who lists days
 * has already answered this question, and overriding them with Monday-to-Friday
 * would ignore what they said.
 */
export function detectWeekSpan(lower: string, now = new Date()): string[] {
  if (!/\b(the week|this week|across the week|next week|working week|weekdays)\b/.test(lower)) return []
  const base = startOfWeek(now)
  const start = /\bnext week\b/.test(lower) ? addDays(base, 7) : base
  return [0, 1, 2, 3, 4].map((offset) => isoDate(addDays(start, offset)))
}

export function detectTime(lower: string): string | null {
  const explicit = lower.match(/\b(\d{1,2})(?::(\d{2}))?\s*(am|pm)\b/)
  if (explicit) {
    const hour = Number(explicit[1]) % 12 + ((explicit[3] as string) === 'pm' ? 12 : 0)
    const minute = explicit[2] ? Number(explicit[2]) : 0
    return nearestPostingTime(hour + minute / 60)
  }
  if (/\bmorning\b/.test(lower)) return nearestPostingTime(9)
  if (/\b(midday|noon|lunch)\b/.test(lower)) return nearestPostingTime(12.5)
  if (/\bafternoon\b/.test(lower)) return nearestPostingTime(16)
  if (/\bevening\b/.test(lower)) return nearestPostingTime(18.5)
  return null
}

export function detectMonth(lower: string, now = new Date()): string | null {
  const explicit = lower.match(/\b(\d{4})-(\d{2})\b/)
  if (explicit) return `${explicit[1]}-${explicit[2]}`

  if (/\blast month\b/.test(lower)) {
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
    return d.toISOString().slice(0, 7)
  }
  if (/\bthis month\b/.test(lower)) return now.toISOString().slice(0, 7)

  for (let i = 0; i < MONTH_NAMES.length; i += 1) {
    const name = MONTH_NAMES[i] as string
    if (!new RegExp(`\\b${name}\\b|\\b${name.slice(0, 3)}\\b`).test(lower)) continue
    // The most recent occurrence of that month, never a future one.
    const year = i > now.getUTCMonth() ? now.getUTCFullYear() - 1 : now.getUTCFullYear()
    return `${year}-${String(i + 1).padStart(2, '0')}`
  }
  return null
}

function stripLeadingVerb(utterance: string): string {
  return utterance
    .replace(/^\s*(?:please\s+)?(?:can you\s+)?(?:make it|rewrite it|revise it|change it|edit it|make this)\s*/i, '')
    .replace(/^\s*(?:and|then)\s+/i, '')
    .trim()
}

function stripQuestionFrame(utterance: string): string {
  return utterance
    .replace(/^(what do we know about|what does the knowledge base say about|search the knowledge base for|search for|tell me about|what is|whats)\s*/i, '')
    .replace(/\?+$/, '')
    .trim()
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENRICHMENT — pronouns, fuzzy titles, and missing arguments
   ═══════════════════════════════════════════════════════════════════════════ */

const PRONOUNS = /\b(it|that|this|those|the same|again)\b/i

/** Dice threshold for matching a spoken fragment to an idea title. */
export const TITLE_MATCH_THRESHOLD = 0.62

async function enrich(intent: Intent, opts: ParseOptions): Promise<Intent> {
  const tool = TOOL_BY_ID[intent.action]
  if (!tool) return intent

  const entities = { ...intent.entities }
  const argKeys = Object.keys((tool.args as unknown as { shape?: Record<string, unknown> }).shape ?? {})

  /* ── Pronoun resolution ───────────────────────────────────────────────── */
  const needsSubject = argKeys.includes('id') || argKeys.includes('title')
  const hasSubject = typeof entities.id === 'string' || typeof entities.title === 'string'

  if (needsSubject && !hasSubject && PRONOUNS.test(opts.utterance)) {
    const last = opts.snapshot.lastEntity
    if (last && typeof last.id === 'string') {
      entities.id = last.id
      if (typeof last.title === 'string') entities.title = last.title
      if (typeof last.platform === 'string' && argKeys.includes('platform') && entities.platform === undefined) {
        entities.platform = last.platform
      }
    }
  }

  /* ── The screen's focus ───────────────────────────────────────────────────
     Applied without requiring a pronoun. An operator with a post open who types
     "shorten the caption" has named the subject by looking at it, and asking
     which post they meant would be asking them to retype what is on screen.
     It never overrides a subject the utterance itself carries. */
  if (needsSubject && typeof entities.id !== 'string') {
    const focus = opts.snapshot.focus
    if (focus && typeof focus.id === 'string') {
      entities.id = focus.id
      if (typeof focus.title === 'string' && typeof entities.title !== 'string') {
        entities.title = focus.title
      }
      if (
        typeof focus.platform === 'string' &&
        argKeys.includes('platform') &&
        entities.platform === undefined
      ) {
        entities.platform = focus.platform
      }
    }
  }

  /* ── Fuzzy title → id ─────────────────────────────────────────────────── */
  if (argKeys.includes('id') && typeof entities.id !== 'string') {
    const fragment =
      typeof entities.title === 'string' ? entities.title : titleFragment(opts.utterance)

    if (fragment && fragment.length >= 3) {
      const candidates = await findIdeasByTitle(opts.workspaceId, fragment, 8)
      const scored = candidates
        .map((c) => ({ c, score: similarity(c.title, fragment) }))
        .sort((a, b) => b.score - a.score)
      const winner = scored[0]
      if (winner && winner.score >= TITLE_MATCH_THRESHOLD) {
        entities.id = winner.c.id
        entities.title = winner.c.title
        if (argKeys.includes('platform') && entities.platform === undefined) {
          entities.platform = winner.c.platform
        }
      }
    }

    // A day plus a platform is also a subject: "Thursday's LinkedIn post".
    if (typeof entities.id !== 'string' && typeof entities.day === 'string') {
      const onDay = opts.snapshot.thisWeek.filter(
        (i) =>
          i.date === entities.day &&
          (entities.platform === undefined || i.platform === entities.platform),
      )
      const chosen = onDay.find((i) => i.slot === 'primary') ?? onDay[0]
      if (chosen) {
        entities.id = chosen.id
        entities.title = chosen.title
        if (argKeys.includes('platform')) entities.platform = chosen.platform
      }
    }
  }

  /* ── Keyword id resolution ────────────────────────────────────────────── */
  if (argKeys.includes('id') && intent.action.startsWith('keyword.') && typeof entities.id !== 'string') {
    const term = typeof entities.term === 'string' ? entities.term : keywordFragment(opts.utterance)
    if (term) {
      const all = await listKeywords(opts.workspaceId, false)
      const match = all
        .map((k) => ({ k, score: similarity(k.term, term) }))
        .sort((a, b) => b.score - a.score)[0]
      if (match && match.score >= 0.5) {
        entities.id = match.k.id
        entities.term = match.k.term
      }
    }
  }

  /* ── Missing required arguments ─────────────────────────────────────────
     The schema decides this, not the model.

     `parseWithModel` copies the model's own `missing` array onto the intent, and
     a conditional spread here left that claim in place whenever this recount
     found nothing — so a model that decided an OPTIONAL argument was required
     got its way. "What is trending this week?" answered "I need limit before I
     can trending keywords", asking an operator to supply a number the tool
     already defaults.

     `missing` is therefore always assigned, so the recount can clear a stale
     claim as well as add a real one. */
  const missing = requiredArgs(tool).filter((key) => entities[key] === undefined)

  return {
    ...intent,
    entities,
    missing,
  }
}

function titleFragment(utterance: string): string | null {
  const patterns = [
    /(?:the|that)\s+(.{4,60}?)\s+(?:post|idea|draft|carousel)/i,
    /(?:post|idea|draft)\s+(?:about|on|titled)\s+(.{4,60})/i,
    /(?:publish|approve|reject|promote|demote|move|draft|render)\s+(?:the\s+)?(.{4,60})$/i,
  ]
  for (const pattern of patterns) {
    const match = utterance.match(pattern)
    if (match) return (match[1] as string).replace(/['"]/g, '').trim()
  }
  return null
}

function keywordFragment(utterance: string): string | null {
  const match = utterance.match(
    /(?:keyword|term)\s+(.{3,50}?)(?:\s+(?:to|at|weight)\b|$)|(?:set|deactivate|activate|turn off|turn on)\s+(.{3,50}?)(?:\s+(?:weight|to)\b|$)/i,
  )
  const value = match?.[1] ?? match?.[2]
  return value ? value.replace(/['"]/g, '').trim() : null
}

/** Which args a tool genuinely cannot run without. */
export function requiredArgs(tool: ToolSpec): string[] {
  const shape = (tool.args as unknown as { shape?: Record<string, { isOptional?: () => boolean }> }).shape
  if (!shape) return []
  return Object.entries(shape)
    .filter(([, schema]) => {
      try {
        return schema.isOptional?.() !== true
      } catch {
        return false
      }
    })
    .map(([key]) => key)
}

/** A short question naming exactly what is missing, and nothing already given. */
export function missingArgQuestion(toolId: string, missing: string[]): string {
  const tool = TOOL_BY_ID[toolId]
  const labels: Record<string, string> = {
    reason: 'a reason — a rejection needs one, it is what the agents learn from',
    instruction: 'what you want changed',
    query: 'what to search for',
    term: 'the keyword',
    title: 'which one',
    id: 'which one',
    text: 'the text to check',
    tag: 'which hashtag',
    validation: 'the verdict',
    content: 'the content of the entry',
    outcome: 'the outcome',
    skillId: 'which setting',
    type: 'what kind of object',
  }
  const asked = missing.map((m) => labels[m] ?? m)
  return `I need ${asked.join(' and ')} before I can ${tool ? tool.name.toLowerCase() : 'run that'}.`
}

/** The two-reading question for a `clarify` intent. */
export function clarifyQuestion(intent: Intent): string {
  const candidates = intent.candidates ?? []
  if (candidates.length < 2) {
    return `I did not follow that. Try one of these: “${TOOLS[0]?.examples[0] ?? 'run the pipeline'}” or “what is waiting on me”.`
  }
  return `Two readings of that. ${candidates[0]?.label}, or ${(candidates[1]?.label ?? '').toLowerCase()}?`
}

/** Exposed for the standalone client and the verification script. */
export { grammarTokens }

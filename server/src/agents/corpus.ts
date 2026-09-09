/**
 * THE CORPUS — deterministic maths and vocabulary shared by the skill handlers.
 *
 * Everything here is a pure function. No module-level mutable state, no clock
 * reads that are not passed in, no randomness that is not seeded. That is what
 * lets a run be replayed from its logged `config_used` and come out the same.
 *
 * Anything that a reasonable operator might want to change does NOT live here —
 * it lives in the registry as a knob. What lives here is the arithmetic those
 * knobs are fed into, and the vocabulary the arithmetic reads.
 */

import type { Confidence, Platform } from '../../../shared/agent-contract'
import { BRAND_TOPICS, similarity } from '../../../shared/brand-voice'

/* ═══════════════════════════════════════════════════════════════════════════
   DETERMINISTIC PRNG
   ═══════════════════════════════════════════════════════════════════════════ */

/** mulberry32 — small, fast, identical across runs for a given seed. */
export function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable 32-bit hash of a string — the seed for anything keyed by name. */
export function hashString(input: string): number {
  let h = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    h ^= input.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

/** A seeded generator for one named thing, so the same name always agrees. */
export function seededFor(name: string, salt = 0): () => number {
  return mulberry32(hashString(name) + salt)
}

/* ═══════════════════════════════════════════════════════════════════════════
   ARITHMETIC
   ═══════════════════════════════════════════════════════════════════════════ */

export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value))
}

/** 0–100 against a batch maximum. A zero maximum reads as zero, never NaN. */
export function normalise(value: number, max: number): number {
  if (!Number.isFinite(value) || !Number.isFinite(max) || max <= 0) return 0
  return clamp(Math.round((value / max) * 100), 0, 100)
}

export function round(value: number, dp = 0): number {
  const f = 10 ** dp
  return Math.round(value * f) / f
}

export function sum(values: readonly number[]): number {
  return values.reduce((a, b) => a + b, 0)
}

export function mean(values: readonly number[]): number {
  return values.length === 0 ? 0 : sum(values) / values.length
}

export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0
    ? ((sorted[mid - 1] as number) + (sorted[mid] as number)) / 2
    : (sorted[mid] as number)
}

export function stdev(values: readonly number[]): number {
  if (values.length < 2) return 0
  const m = mean(values)
  return Math.sqrt(mean(values.map((v) => (v - m) ** 2)))
}

/** Percentage change, guarded against a zero base. */
export function growthPercent(current: number, prior: number): number {
  const base = Math.max(prior, 1)
  return clamp(round(((current - base) / base) * 100, 2), -100, 100)
}

/** Rescales a −100…100 growth reading onto 0…100 so it can join a weighted sum. */
export function rescaleGrowth(growthPct: number): number {
  return clamp(Math.round((growthPct + 100) / 2), 0, 100)
}

/** Exponential decay: 100 · 0.5^(age / halfLife). */
export function halfLifeScore(ageHours: number, halfLifeHours: number): number {
  if (halfLifeHours <= 0) return ageHours <= 0 ? 100 : 0
  return clamp(Math.round(100 * 0.5 ** (Math.max(0, ageHours) / halfLifeHours)), 0, 100)
}

export function hoursSince(iso: string, now: Date): number {
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return 0
  return Math.max(0, (now.getTime() - then) / 3_600_000)
}

/* ═══════════════════════════════════════════════════════════════════════════
   ENGAGEMENT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The engagement formula used everywhere in the product:
 * reactions + comments·3 + reposts·5. Comments and reposts cost the audience
 * more, so they are worth more.
 */
export function engagementOf(p: {
  reactions: number
  comments: number
  reposts: number
}): number {
  return p.reactions + p.comments * 3 + p.reposts * 5
}

/** Engagement per hour since posting, floored at a one-hour window. */
export function velocityOf(engagement: number, ageHours: number, windowHours: number): number {
  const window = clamp(ageHours, 1, Math.max(1, windowHours))
  return round(engagement / window, 2)
}

/* ═══════════════════════════════════════════════════════════════════════════
   TEXT
   ═══════════════════════════════════════════════════════════════════════════ */

export { similarity }

export function normaliseTag(tag: string): string {
  return tag.replace(/^#/, '').toLowerCase()
}

/**
 * Pulls `#tokens` out of a body.
 *
 * A SOCIAL affordance only. In a post a `#token` is a hashtag the author chose;
 * on a rendered web page it is a URL fragment, and treating Wikipedia's footnote
 * anchors as audience vocabulary once put `#cite_note` into a caption. Callers
 * gate this on the item actually being a social artefact — see the note in
 * `integrations/crawl4ai.ts`.
 *
 * Leading digits are rejected because `#1` is a rank, not a topic.
 */
export function extractHashtagsFromText(text: string): string[] {
  const found = text.match(/#[A-Za-z][A-Za-z0-9_]{1,48}/g) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of found) {
    const key = normaliseTag(raw)
    if (seen.has(key)) continue
    seen.add(key)
    out.push(raw.replace(/^#/, ''))
  }
  return out
}

export function titleCaseWords(input: string): string {
  return input
    .split(/\s+/)
    .map((w) => (w.length === 0 ? w : w[0]!.toUpperCase() + w.slice(1)))
    .join(' ')
}

/** A headline from a body of text: the first sentence, clamped to N words. */
export function headlineFrom(text: string, maxWords: number): string {
  const firstLine = text.split(/\n+/).find((l) => l.trim().length > 0) ?? text
  const sentence = firstLine.split(/(?<=[.!?])\s/)[0] ?? firstLine
  const cleaned = sentence.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/\s+/g, ' ').trim()
  const words = cleaned.split(' ').filter(Boolean)
  return words.slice(0, maxWords).join(' ').replace(/[,;:]$/, '')
}

export function clampWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean)
  return words.length <= maxWords ? text.trim() : `${words.slice(0, maxWords).join(' ')}`
}

export function clampChars(text: string, maxChars: number): string {
  if (text.length <= maxChars) return text
  const cut = text.slice(0, maxChars)
  const lastStop = Math.max(cut.lastIndexOf('. '), cut.lastIndexOf('\n'))
  return lastStop > maxChars * 0.55 ? cut.slice(0, lastStop + 1).trim() : `${cut.trim()}…`
}

/** Content words only — the unit both relevance and similarity are measured in. */
const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'for', 'with',
  'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that', 'these',
  'those', 'as', 'at', 'by', 'from', 'has', 'have', 'had', 'not', 'no', 'we',
  'you', 'they', 'he', 'she', 'i', 'our', 'your', 'their', 'what', 'which',
  'when', 'how', 'why', 'than', 'then', 'so', 'if', 'can', 'will', 'would',
])

export function contentWords(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s#]/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOPWORDS.has(w))
}

/**
 * How many brand topics a text touches.
 * Presence raises relevance; absence is NOT evidence of irrelevance, which is
 * why this only ever counts matches and never subtracts.
 */
export function countTopicMatches(text: string): number {
  const haystack = text.toLowerCase()
  let hits = 0
  for (const topic of BRAND_TOPICS) {
    if (haystack.includes(topic.toLowerCase())) hits += 1
  }
  return hits
}

/** Which brand topics a text touches, for naming the evidence in a reason. */
export function matchedTopics(text: string, limit = 3): string[] {
  const haystack = text.toLowerCase()
  const out: string[] = []
  for (const topic of BRAND_TOPICS) {
    if (haystack.includes(topic.toLowerCase())) out.push(topic)
    if (out.length >= limit) break
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   HASHTAG ALIASES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Semantic aliases. `#RL` and `#ReinforcementLearning` are the same idea, and
 * treating them as two candidates would double-count a trend.
 * Written as canonical → members, resolved into a flat lookup below.
 */
const ALIAS_GROUPS: Record<string, string[]> = {
  reinforcementlearning: ['rl', 'reinforcementlearning', 'deeprl', 'rlearning'],
  generativeai: ['genai', 'generativeai', 'gen_ai'],
  largelanguagemodels: ['llm', 'llms', 'largelanguagemodels', 'languagemodels'],
  rlhf: ['rlhf', 'humanfeedback', 'reinforcementlearningfromhumanfeedback'],
  aiagents: ['aiagents', 'agents', 'agenticai', 'agentic'],
  posttraining: ['posttraining', 'post_training', 'finetuning', 'llmfinetuning'],
  modelevaluation: ['modelevaluation', 'evals', 'eval', 'aievaluation', 'benchmarking'],
  syntheticdata: ['syntheticdata', 'syntheticdatasets'],
  machinelearning: ['ml', 'machinelearning'],
  artificialintelligence: ['ai', 'artificialintelligence'],
  aiinfrastructure: ['aiinfra', 'aiinfrastructure', 'mlinfra'],
  aisafety: ['aisafety', 'alignment', 'aialignment'],
  multiagentsystems: ['multiagent', 'multiagentsystems', 'mas'],
  inferenceoptimization: ['inference', 'inferenceoptimization', 'inferenceeconomics'],
  rewardmodeling: ['rewardmodeling', 'rewardmodels', 'rewardmodel'],
}

const ALIAS_LOOKUP: Map<string, string> = (() => {
  const map = new Map<string, string>()
  for (const [canonical, members] of Object.entries(ALIAS_GROUPS)) {
    for (const member of members) map.set(member, canonical)
  }
  return map
})()

/** The canonical key for a tag, or the tag itself when it has no alias group. */
export function aliasKey(tag: string): string {
  const norm = normaliseTag(tag)
  return ALIAS_LOOKUP.get(norm) ?? norm
}

/** True when two tags are the same idea wearing different words. */
export function isAlias(a: string, b: string): boolean {
  const ka = aliasKey(a)
  const kb = aliasKey(b)
  return ka === kb && normaliseTag(a) !== normaliseTag(b)
}

/** A readable name for an alias group, for the verdict reason. */
export function aliasGroupLabel(tag: string): string {
  const key = aliasKey(tag)
  const members = ALIAS_GROUPS[key]
  return members ? members.slice(0, 3).map((m) => `#${m}`).join(' ≡ ') : `#${key}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREDIBILITY
   ═══════════════════════════════════════════════════════════════════════════ */

/** Base credibility by source tier, before the trusted bonus or community penalty. */
export function credibilityBase(sourceType: string): number {
  switch (sourceType) {
    case 'News':
    case 'Website':
      return 80
    case 'Social':
    case 'Competitor':
      return 55
    case 'Community':
      return 30
    default:
      return 55
  }
}

/** The label is always re-derived from the score, never carried independently. */
export function credibilityLabel(score: number): Confidence {
  if (score >= 70) return 'High'
  if (score >= 45) return 'Medium'
  return 'Low'
}

/** Confidence from independent source count: 3+ High, 2 Medium, 1 Low. */
export function confidenceFromSources(count: number): Confidence {
  if (count >= 3) return 'High'
  if (count === 2) return 'Medium'
  return 'Low'
}

export function confidenceRank(confidence: Confidence): number {
  return confidence === 'High' ? 100 : confidence === 'Medium' ? 65 : 30
}

export function promoteConfidence(current: Confidence): Confidence {
  return current === 'Low' ? 'Medium' : 'High'
}

export function demoteConfidence(current: Confidence): Confidence {
  return current === 'High' ? 'Medium' : 'Low'
}

/* ═══════════════════════════════════════════════════════════════════════════
   SCHEDULING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hour weights for a B2B research audience, 0–23.
 * Mid-morning and early evening carry the audience; the small hours do not.
 * The window knobs filter this table; they do not replace it.
 */
export const HOUR_WEIGHTS: readonly number[] = [
  2, 1, 1, 1, 2, 4, 12, 26, 52, 78, 96, 88,
  70, 62, 74, 82, 76, 64, 48, 34, 24, 16, 8, 4,
]

export const POSTING_TIMES: readonly string[] = [
  '7:00 AM', '8:00 AM', '8:30 AM', '9:00 AM', '9:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '12:30 PM', '2:00 PM', '4:00 PM', '5:30 PM', '6:30 PM',
]

export function hourToLabel(hour: number, minute = 0): string {
  const h24 = clamp(Math.round(hour), 0, 23)
  const suffix = h24 < 12 ? 'AM' : 'PM'
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12
  return `${h12}:${minute.toString().padStart(2, '0')} ${suffix}`
}

export function labelToHour(label: string): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim())
  if (!m) return 10
  const h = Number(m[1]) % 12
  const pm = (m[3] as string).toUpperCase() === 'PM'
  return h + (pm ? 12 : 0)
}

export function labelToMinutes(label: string): number {
  const m = /^(\d{1,2}):(\d{2})\s*(AM|PM)$/i.exec(label.trim())
  if (!m) return 630
  return labelToHour(label) * 60 + Number(m[2])
}

/** The nearest declared posting time to an hour, so slots stay on the grid. */
export function nearestPostingTime(hour: number): string {
  let best = POSTING_TIMES[0] as string
  let bestGap = Number.POSITIVE_INFINITY
  for (const label of POSTING_TIMES) {
    const gap = Math.abs(labelToHour(label) + (labelToMinutes(label) % 60) / 60 - hour)
    if (gap < bestGap) {
      bestGap = gap
      best = label
    }
  }
  return best
}

export function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setUTCDate(out.getUTCDate() + days)
  return out
}

export function isWeekend(dateIso: string): boolean {
  const day = new Date(`${dateIso}T12:00:00Z`).getUTCDay()
  return day === 0 || day === 6
}

/** Monday of the week containing `d`, in UTC. */
export function startOfWeek(d: Date): Date {
  const out = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()))
  const day = out.getUTCDay()
  out.setUTCDate(out.getUTCDate() - ((day + 6) % 7))
  return out
}

export function weekdayName(dateIso: string): string {
  return ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][
    new Date(`${dateIso}T12:00:00Z`).getUTCDay()
  ] as string
}

export function monthKeyOf(dateIso: string): string {
  return dateIso.slice(0, 7)
}

export function monthLabelOf(monthKey: string): string {
  const [y, m] = monthKey.split('-')
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December']
  return `${names[Number(m) - 1] ?? monthKey} ${y}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORMATS AND PLATFORMS
   ═══════════════════════════════════════════════════════════════════════════ */

export const FORMATS = [
  'Thought Leadership',
  'Carousel',
  'Short Post',
  'Video',
  'Case Study',
] as const
export type ContentFormat = (typeof FORMATS)[number]

/**
 * How well each format lands on each platform, 0–100.
 * The Calendar Agent's platform choice is a lookup in this matrix plus brand
 * fit — never a coin toss, and always explainable.
 */
export const FORMAT_PLATFORM_FIT: Record<ContentFormat, Record<Platform, number>> = {
  'Thought Leadership': { linkedin: 96, instagram: 46, x: 72, facebook: 74 },
  Carousel: { linkedin: 82, instagram: 94, x: 38, facebook: 68 },
  'Short Post': { linkedin: 64, instagram: 58, x: 92, facebook: 70 },
  Video: { linkedin: 70, instagram: 88, x: 60, facebook: 82 },
  'Case Study': { linkedin: 92, instagram: 52, x: 54, facebook: 66 },
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X',
  facebook: 'Facebook',
}

/** Expected engagement level from a predicted index. */
export function engagementLevel(index: number): 'Low' | 'Medium' | 'High' | 'Very High' {
  if (index >= 82) return 'Very High'
  if (index >= 62) return 'High'
  if (index >= 40) return 'Medium'
  return 'Low'
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANGLES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The angle vocabulary. Each is a way of framing a finding that suits a research
 * lab rather than a vendor: mechanism over promise, evidence over enthusiasm.
 */
export const ANGLES: readonly string[] = [
  'Explain the mechanism behind the result',
  'Separate what is measured from what is claimed',
  'Show the failure mode everyone skips',
  'Trace the cost that makes the approach viable',
  'Contrast the benchmark with production behaviour',
  'Name the assumption the field has stopped testing',
  'Follow the incentive the reward function actually creates',
  'Put a number on the trade-off',
]

export const CONTRARIAN_ANGLES: readonly string[] = [
  'Name the assumption the field has stopped testing',
  'Separate what is measured from what is claimed',
  'Show the failure mode everyone skips',
]

export function angleFor(seedName: string, preferContrarian: boolean): string {
  const pool = preferContrarian ? CONTRARIAN_ANGLES : ANGLES
  const rand = seededFor(seedName, 991)
  return pool[Math.floor(rand() * pool.length)] as string
}

/** The audience an angle is aimed at, so the caption knows who it is talking to. */
export const AUDIENCES: readonly string[] = [
  'ML engineers and research leads',
  'Heads of AI and platform engineering',
  'CTOs evaluating post-training capability',
  'Applied researchers shipping agents',
]

export function audienceFor(seedName: string): string {
  const rand = seededFor(seedName, 337)
  return AUDIENCES[Math.floor(rand() * AUDIENCES.length)] as string
}

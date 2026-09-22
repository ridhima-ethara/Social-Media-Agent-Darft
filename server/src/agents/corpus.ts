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
/**
 * Words a truncated line must not end on.
 *
 * A hard word-count cut lands wherever the count runs out, which is how a
 * headline ends up reading "…models that are helpful, harmless and" or
 * "…machine learning separate from psychological". The text is grammatically
 * unfinished but is presented as a finished line, and it then travels: the
 * idea title becomes the caption's hook and the image headline. Dropping the
 * dangling tail costs a word or two and always reads as a complete phrase.
 *
 * These are closed-class function words, not a tunable — the list is a fact
 * about English, so it is not a knob.
 */
const DANGLING_TAIL = new Set([
  'a', 'an', 'the',
  'and', 'or', 'but', 'nor', 'so', 'yet',
  'of', 'to', 'in', 'on', 'for', 'with', 'from', 'by', 'at', 'as', 'into',
  'onto', 'over', 'under', 'about', 'against', 'between', 'through', 'during',
  'before', 'after', 'above', 'below', 'across', 'behind', 'beyond', 'within',
  'without', 'upon', 'toward', 'towards', 'per', 'via',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'has', 'have', 'had', 'do', 'does', 'did',
  'can', 'could', 'will', 'would', 'shall', 'should', 'may', 'might', 'must',
  'that', 'which', 'who', 'whom', 'whose', 'what', 'when', 'where', 'while',
  'because', 'if', 'than', 'then', 'though', 'although', 'unless', 'until',
  'its', 'their', 'our', 'your', 'his', 'her', 'this', 'these', 'those', 'it',
  'not', 'no', 'more', 'most', 'very', 'such', 'both', 'each', 'every',
])

/**
 * Removes a trailing run of function words left behind by a hard truncation,
 * so a clamped line ends on a word that can actually end a phrase.
 *
 * Never empties the string: a line made only of function words is returned as
 * it was, because reporting nothing is worse than reporting an awkward line.
 */
export function trimDanglingTail(text: string): string {
  const words = text.trim().split(/\s+/).filter(Boolean)
  while (words.length > 1) {
    const last = words[words.length - 1]
    if (last === undefined) break
    const bare = last.toLowerCase().replace(/[^\p{L}\p{N}]+$/gu, '')
    if (!DANGLING_TAIL.has(bare)) break
    words.pop()
  }
  return words.join(' ').replace(/[,;:]+$/, '')
}

/**
 * A headline from the body of a post.
 *
 * WHY IT WALKS THE LINES. Hashtags are stripped, because a headline made of tags
 * is not a headline. That used to be applied to the FIRST non-empty line only, so
 * a post opening with a tag line — `#UITStudentNote` above a real paragraph, which
 * is an ordinary way to write on LinkedIn — cleaned down to the empty string and
 * produced an idea with a zero-length title. One reached the calendar.
 *
 * So each line is tried in turn, and the whole body is the last resort. An empty
 * return now means something real: there is no prose here at all, only tags and
 * emoji. The caller must refuse to build an idea from that rather than storing a
 * blank one — `calendar.idea.form` does.
 */
export function headlineFrom(text: string, maxWords: number): string {
  const strip = (value: string): string =>
    value
      .replace(/#[\p{L}\p{N}_]+/gu, '')
      .replace(/\s+/g, ' ')
      .trim()

  const candidates = [...text.split(/\n+/).filter((l) => l.trim().length > 0), text]

  for (const candidate of candidates) {
    const sentence = candidate.split(/(?<=[.!?])\s/)[0] ?? candidate
    const cleaned = strip(sentence)
    // A fragment of punctuation or a lone emoji is not prose either.
    if (!/\p{L}/u.test(cleaned)) continue
    const words = cleaned.split(' ').filter(Boolean)
    if (words.length <= maxWords) return cleaned.replace(/[,;:]+$/, '')
    return trimDanglingTail(words.slice(0, maxWords).join(' '))
  }

  return ''
}

export function clampWords(text: string, maxWords: number): string {
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return text.trim()
  return trimDanglingTail(words.slice(0, maxWords).join(' '))
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
/**
 * The first day the planner may place a post on.
 *
 * The week's Monday, unless the week is already underway, in which case today.
 *
 * WHY THIS EXISTS. Spreading from the week's Monday means a run on Thursday
 * places its first ideas on Monday and Tuesday — days that have already gone.
 * Those slots can never be published: the calendar looks full, the approval
 * queue fills up, and nothing can ship from the first third of it. Planning
 * from today costs nothing and makes every slot reachable.
 */
export function planningStart(now: Date = new Date()): Date {
  const monday = startOfWeek(now)
  const today = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()))
  return monday.getTime() > today.getTime() ? monday : today
}

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
  if (!/^\d{4}-\d{2}$/.test(monthKey)) return monthKey
  const [y, m] = monthKey.split('-')
  const names = ['January', 'February', 'March', 'April', 'May', 'June', 'July',
    'August', 'September', 'October', 'November', 'December']
  return `${names[Number(m) - 1] ?? monthKey} ${y}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   EDITORIAL FORMATS AND PLATFORMS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The editorial SHAPE of a post — how it is built, not what kind of artefact it
 * is. Read by the Analysis Agent when it recommends a format and by the
 * Calendar Agent when it scores platform fit.
 *
 * Called `ContentFormat` until ADR-007, which needed that name for the closed
 * union in `shared/agent-contract.ts` distinguishing a written post from a
 * spoken script. The two meant genuinely different things, and one name for
 * both was a defect waiting for a careless import.
 */
export const EDITORIAL_FORMATS = [
  'Thought Leadership',
  'Carousel',
  'Short Post',
  'Video',
  'Case Study',
] as const
export type EditorialFormat = (typeof EDITORIAL_FORMATS)[number]

/**
 * How well each format lands on each platform, 0–100.
 * The Calendar Agent's platform choice is a lookup in this matrix plus brand
 * fit — never a coin toss, and always explainable.
 */
export const FORMAT_PLATFORM_FIT: Record<EditorialFormat, Record<Platform, number>> = {
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

/* ═══════════════════════════════════════════════════════════════════════════
   IS THIS PROSE THE BRAND CAN ACTUALLY USE?

   Brand alignment answers "is this about our subject". It does not answer "can we
   read it", and with real platform capture those came apart immediately: the
   Facebook and LinkedIn lanes returned Vietnamese workshop and recruitment posts
   that scored 46–66 on alignment — legitimately, because "Agentic AI", "AI" and
   "data" appear in them verbatim — and they became calendar ideas for an
   English-language brand.

   Measured, not judged. The share of tokens that are English function words is a
   property of the text: English prose sits around 25–40%, and a language that
   does not share those words sits near zero. No model is asked, so the same body
   scores the same every time and the number can be put on the record.

   Function words only. Topic nouns are deliberately excluded — they are exactly
   the loanwords that appear in every language's technology writing, and counting
   them would let the filter pass the posts it exists to catch.
   ═══════════════════════════════════════════════════════════════════════════ */

const ENGLISH_FUNCTION_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'if', 'then', 'than', 'that', 'this', 'these', 'those',
  'is', 'are', 'was', 'were', 'be', 'been', 'being', 'am',
  'to', 'of', 'in', 'on', 'for', 'with', 'without', 'from', 'into', 'onto', 'about', 'as', 'at',
  'by', 'over', 'under', 'between', 'through', 'during', 'before', 'after',
  'it', 'its', 'we', 'our', 'you', 'your', 'they', 'their', 'them', 'he', 'she', 'his', 'her',
  'not', 'no', 'nor', 'so', 'because', 'while', 'when', 'where', 'why', 'how', 'what', 'which',
  'who', 'whom', 'can', 'could', 'will', 'would', 'should', 'may', 'might', 'must', 'do', 'does',
  'did', 'have', 'has', 'had', 'there', 'here', 'more', 'most', 'much', 'many', 'some', 'any',
  'all', 'both', 'each', 'every', 'other', 'another', 'such', 'only', 'just', 'also', 'very',
  'too', 'own', 'same', 'up', 'down', 'out', 'off', 'again', 'once', 'now', 'still', 'yet',
])

/** Below this many words there is not enough text to judge, and the caller exempts it. */
export const ENGLISH_RATIO_MIN_WORDS = 12

/**
 * The percentage of word tokens that are English function words, 0–100.
 * Returns -1 when the text is too short to judge, so "unknown" is distinguishable
 * from "zero" — the same rule the metrics obey.
 */
export function englishRatio(text: string): number {
  const words = text
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^\p{L}\p{N}\s']/gu, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 0)

  if (words.length < ENGLISH_RATIO_MIN_WORDS) return -1

  let hits = 0
  for (const word of words) if (ENGLISH_FUNCTION_WORDS.has(word)) hits += 1
  return Math.round((hits / words.length) * 100)
}

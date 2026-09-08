/**
 * THE BRAND VOICE ENGINE
 *
 * Ethara is positioned as a frontier AI research lab, not a startup pitching a
 * product. This module is the machine-readable form of that position: the
 * vocabulary, the twenty numbered rules, and the compliance checker every
 * caption passes through.
 *
 * Rule 20 is structural: the checker VALIDATES AND REPORTS. It does not rewrite
 * behind the operator's back. A `corrected_version` is offered only when every
 * violation is mechanical, and a human instruction always outranks a guideline.
 */

import type { Platform } from './agent-contract'

/* ═══════════════════════════════════════════════════════════════════════════
   THE BRAND
   ═══════════════════════════════════════════════════════════════════════════ */

export const BRAND = {
  name: 'Ethara',
  wordmark: 'Ethara.AI',
  positioning: 'a frontier AI research lab, not a startup pitching a product',
  domains: [
    'Reinforcement learning and reward modelling',
    'Post-training and alignment',
    'Agentic systems and multi-agent orchestration',
    'Model evaluation, benchmarks and environments',
    'Synthetic data generation',
    'Inference and serving economics',
  ],
  voiceWords: [
    'research-credible',
    'anti-hype',
    'confident',
    'declarative',
    'plain natural English',
  ],
  audience:
    'AI researchers, ML engineers, heads of AI and CTOs evaluating frontier capability',
  /** Zero. No knob may raise this. */
  emojiBudget: 0,
  /** Applies on every platform, identically. */
  hashtags: { min: 3, max: 5 },
  /** The nine-stage caption skeleton. */
  captionStructure: [
    'Hook',
    'Context',
    'Problem',
    'Reframe',
    'Mechanism',
    'Evidence',
    'Implication',
    'Ethara connection',
    'Close',
  ],
  hookMaxWords: 18,
  visual: {
    accent: '#8B2CF5',
    family: ['#8B2CF5', '#A855F7', '#C084FC', '#5E1BC7'],
    displayFont: 'Roboto',
    bodyFont: 'DM Sans',
  },
  /** Above these, a candidate is too close to something already published. */
  similarityCap: { caption: 0.7, image: 0.85 },
} as const

/** Topic vocabulary used by `validation.relevance.score`. */
export const BRAND_TOPICS: string[] = [
  'reinforcement learning',
  'rlhf',
  'reward model',
  'reward modeling',
  'post-training',
  'alignment',
  'agentic',
  'agent',
  'multi-agent',
  'evaluation',
  'eval',
  'benchmark',
  'environment',
  'synthetic data',
  'fine-tuning',
  'inference',
  'frontier model',
  'foundation model',
  'llm',
  'training',
  'policy',
  'preference',
  'safety',
  'red team',
  'interpretability',
  'scaling',
  'dataset',
  'tokenizer',
  'transformer',
  'reasoning',
]

/* ═══════════════════════════════════════════════════════════════════════════
   VOCABULARIES
   ═══════════════════════════════════════════════════════════════════════════ */

/** Mechanically replaceable. `enforceBrandVoice` applies these. */
export const FORBIDDEN_LANGUAGE: Array<{ pattern: RegExp; replacement: string; why: string }> = [
  {
    pattern: /\bexcited to announce\b/gi,
    replacement: 'We are publishing',
    why: 'Announcement excitement reads as a startup, not a research lab',
  },
  {
    pattern: /\bthrilled to\b/gi,
    replacement: 'We',
    why: 'Emotional intensifier',
  },
  {
    pattern: /\bdelighted to\b/gi,
    replacement: 'We',
    why: 'Emotional intensifier',
  },
  {
    pattern: /\bproud to announce\b/gi,
    replacement: 'We are publishing',
    why: 'Announcement excitement',
  },
  {
    pattern: /\bgame[- ]?chang(er|ing)\b/gi,
    replacement: 'material shift',
    why: 'Hype vocabulary',
  },
  {
    pattern: /\brevolutionary\b/gi,
    replacement: 'substantively new',
    why: 'Hype vocabulary',
  },
  {
    pattern: /\bgroundbreaking\b/gi,
    replacement: 'novel',
    why: 'Hype vocabulary',
  },
  {
    pattern: /\bcutting[- ]edge\b/gi,
    replacement: 'current',
    why: 'Hype vocabulary',
  },
  {
    pattern: /\bstate[- ]of[- ]the[- ]art\b/gi,
    replacement: 'leading',
    why: 'Overused claim; prefer the measured figure',
  },
  {
    pattern: /\bunlock(s|ing)? the power of\b/gi,
    replacement: 'uses',
    why: 'Marketing cliché',
  },
  {
    pattern: /\bsupercharge(s|d)?\b/gi,
    replacement: 'improves',
    why: 'Hype vocabulary',
  },
  {
    pattern: /\bmind[- ]blowing\b/gi,
    replacement: 'notable',
    why: 'Hype vocabulary',
  },
  {
    pattern: /\bwe['’]re on a mission to\b/gi,
    replacement: 'We',
    why: 'Mission language reads as a pitch',
  },
  {
    pattern: /\bdive (deep )?into\b/gi,
    replacement: 'examine',
    why: 'Filler verb',
  },
  {
    pattern: /\bin today['’]s (fast[- ]paced )?world\b/gi,
    replacement: '',
    why: 'Empty opener',
  },
  {
    pattern: /\bthe future of \w+ is here\b/gi,
    replacement: '',
    why: 'Empty claim',
  },
]

/** Flagged, never auto-fixed — these need a human judgement. */
export const PITCH_LANGUAGE: Array<{ pattern: RegExp; why: string }> = [
  { pattern: /\bbook a demo\b/gi, why: 'Direct sales CTA' },
  { pattern: /\bget started (today|now)\b/gi, why: 'Direct sales CTA' },
  { pattern: /\bsign up (today|now)\b/gi, why: 'Direct sales CTA' },
  { pattern: /\blimited time\b/gi, why: 'Urgency tactic' },
  { pattern: /\bbest[- ]in[- ]class\b/gi, why: 'Unverifiable superlative' },
  { pattern: /\bindustry[- ]leading\b/gi, why: 'Unverifiable superlative' },
  { pattern: /\bnumber one\b/gi, why: 'Unverifiable superlative' },
  { pattern: /\bguarantee(d|s)?\b/gi, why: 'Promise the lab cannot make' },
  { pattern: /\b10x\b/gi, why: 'Unsubstantiated multiplier' },
  { pattern: /\beveryone (needs|should)\b/gi, why: 'Overreach' },
]

/** Reach-bait. Always excluded from generated hashtag blocks. */
export const GENERIC_HASHTAGS: string[] = [
  'ai',
  'artificialintelligence',
  'tech',
  'technology',
  'innovation',
  'future',
  'digital',
  'data',
  'business',
  'startup',
  'entrepreneur',
  'motivation',
  'success',
  'growth',
  'trending',
  'viral',
]

/**
 * Any hit forces NEEDS_INTERNAL_APPROVAL, which outranks every other verdict.
 * These are things only a human inside the company may confirm.
 */
export const SENSITIVE_TOPICS: Array<{ id: string; label: string; pattern: RegExp }> = [
  {
    id: 'funding',
    label: 'Unannounced funding',
    pattern: /\b(raise[sd]?|raising|funding|series [a-e]|seed round|valuation|investor)\b/gi,
  },
  {
    id: 'partnership',
    label: 'Unannounced partnership',
    pattern: /\b(partner(ship|ing|ed)?|collaborat(e|ion|ing) with|joint venture)\b/gi,
  },
  {
    id: 'customer',
    label: 'Named customer or logo',
    pattern: /\b(customer|client|deployed at|used by|case study with)\b/gi,
  },
  {
    id: 'hiring',
    label: 'Unannounced hire',
    pattern: /\b(join(s|ed|ing)? (us|the team)|new (cto|ceo|vp|head of)|welcome to the team)\b/gi,
  },
  {
    id: 'unpublished-numbers',
    label: 'Unpublished internal numbers',
    pattern: /\b(revenue|arr|mrr|headcount|burn rate|internal benchmark|our results show)\b/gi,
  },
  {
    id: 'legal',
    label: 'Legal or regulatory position',
    pattern: /\b(lawsuit|litigation|patent|regulatory|compliance ruling|gdpr position)\b/gi,
  },
  {
    id: 'competitor',
    label: 'Named competitor comparison',
    pattern:
      /\b(openai|anthropic|deepmind|google ai|meta ai|mistral|cohere|xai)\b[^.]*\b(worse|better|beat|behind|ahead|outperform)/gi,
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   THE TWENTY RULES
   Four areas. Each carries its enforcement mode, which the Review Agent and
   the Knowledge Base both read.
   ═══════════════════════════════════════════════════════════════════════════ */

export type RuleArea =
  | 'Voice & Positioning'
  | 'Factual & Content'
  | 'Visual'
  | 'Candidate & Risk'

export type RuleEnforcement = 'automatic' | 'assisted' | 'human'

export interface BrandRule {
  n: number
  area: RuleArea
  title: string
  text: string
  enforcement: RuleEnforcement
}

export const BRAND_RULES: BrandRule[] = [
  // ── Voice & Positioning 1–5 ──────────────────────────────────────────────
  {
    n: 1,
    area: 'Voice & Positioning',
    title: 'Research lab, never a pitch',
    text: 'Write as a frontier research lab reporting findings, not as a company selling software. No sales CTAs, no urgency, no superlatives about ourselves.',
    enforcement: 'assisted',
  },
  {
    n: 2,
    area: 'Voice & Positioning',
    title: 'Declarative and plain',
    text: 'State the finding directly in plain natural English. Avoid hedging stacks ("might potentially perhaps"), and avoid academic throat-clearing.',
    enforcement: 'assisted',
  },
  {
    n: 3,
    area: 'Voice & Positioning',
    title: 'No hype vocabulary',
    text: 'The forbidden-language list is replaced mechanically: revolutionary, game-changing, cutting-edge, unlock the power of, excited to announce, and their kin.',
    enforcement: 'automatic',
  },
  {
    n: 4,
    area: 'Voice & Positioning',
    title: 'Confidence without overreach',
    text: 'Claim exactly what the evidence supports. "Reward models are the product" is confident. "Reward models will replace all fine-tuning" is overreach.',
    enforcement: 'human',
  },
  {
    n: 5,
    area: 'Voice & Positioning',
    title: 'Zero emoji',
    text: 'The emoji budget is zero on every platform. Emoji are stripped mechanically before publication.',
    enforcement: 'automatic',
  },

  // ── Factual & Content 6–11 ───────────────────────────────────────────────
  {
    n: 6,
    area: 'Factual & Content',
    title: 'Grounded in the Knowledge Base',
    text: 'Every factual claim traces to an active Knowledge Base entry or a cited source. Ungrounded claims are reported as CANNOT_VERIFY.',
    enforcement: 'assisted',
  },
  {
    n: 7,
    area: 'Factual & Content',
    title: 'Numbers carry their source',
    text: 'Any figure in a caption names where it came from, or is removed. An unsourced number is a liability.',
    enforcement: 'assisted',
  },
  {
    n: 8,
    area: 'Factual & Content',
    title: 'No competitor disparagement',
    text: 'Never position by attacking a named lab. Compare mechanisms and results, not organisations.',
    enforcement: 'human',
  },
  {
    n: 9,
    area: 'Factual & Content',
    title: 'Our own baseline only',
    text: 'Performance claims compare against this account\u2019s own trailing baseline, never against an industry benchmark we did not measure.',
    enforcement: 'automatic',
  },
  {
    n: 10,
    area: 'Factual & Content',
    title: 'Nine-stage structure',
    text: 'Long-form posts follow Hook → Context → Problem → Reframe → Mechanism → Evidence → Implication → Ethara connection → Close. Short posts may compress but never reorder.',
    enforcement: 'assisted',
  },
  {
    n: 11,
    area: 'Factual & Content',
    title: 'Three to five topical hashtags',
    text: 'Every post carries 3–5 hashtags derived from its own topic. Generic reach-bait tags are excluded. No knob may raise the ceiling above five.',
    enforcement: 'automatic',
  },

  // ── Visual 12–16 ─────────────────────────────────────────────────────────
  {
    n: 12,
    area: 'Visual',
    title: 'Brand text is drawn locally',
    text: 'No diffusion model is ever asked to render brand text. Headline, kicker, logomark and footer are drawn as vectors over any generated background.',
    enforcement: 'automatic',
  },
  {
    n: 13,
    area: 'Visual',
    title: 'The accent family only',
    text: 'Creative uses the declared purple family. Status colours are reserved for status and never appear as decoration.',
    enforcement: 'automatic',
  },
  {
    n: 14,
    area: 'Visual',
    title: 'Correct canvas per platform',
    text: 'LinkedIn 1200×627, Instagram 1080×1350, X 1600×900. A post is never shipped on the wrong canvas.',
    enforcement: 'automatic',
  },
  {
    n: 15,
    area: 'Visual',
    title: 'Caption and visual must agree',
    text: 'The headline on the creative restates the caption\u2019s hook. A visual that says something the caption does not is a defect.',
    enforcement: 'assisted',
  },
  {
    n: 16,
    area: 'Visual',
    title: 'Alt text always',
    text: 'Every asset ships with alt text describing the content, not the styling. An asset without alt text cannot be published.',
    enforcement: 'automatic',
  },

  // ── Candidate & Risk 17–20 ───────────────────────────────────────────────
  {
    n: 17,
    area: 'Candidate & Risk',
    title: 'Sensitive topics escalate',
    text: 'Funding, partnerships, named customers, hires, unpublished numbers, legal positions and competitor comparisons force NEEDS_INTERNAL_APPROVAL, which outranks every other verdict.',
    enforcement: 'automatic',
  },
  {
    n: 18,
    area: 'Candidate & Risk',
    title: 'Not too close to a published post',
    text: 'A caption above 0.7 similarity to something already published, or a visual above 0.85, is held. Repetition erodes the account.',
    enforcement: 'automatic',
  },
  {
    n: 19,
    area: 'Candidate & Risk',
    title: 'Two human approvals before publication',
    text: 'Marketing approves, then Leadership approves. This checkpoint has no off switch. A rejection cannot be recorded without a reason.',
    enforcement: 'human',
  },
  {
    n: 20,
    area: 'Candidate & Risk',
    title: 'No silent correction',
    text: 'The checker reports and offers; it never rewrites behind the operator\u2019s back. A human instruction outranks a brand guideline — apply the instruction and raise the finding alongside it.',
    enforcement: 'human',
  },
]

export const RULE_BY_NUMBER: Record<number, BrandRule> = Object.fromEntries(
  BRAND_RULES.map((r) => [r.n, r]),
)

/* ═══════════════════════════════════════════════════════════════════════════
   TEXT UTILITIES
   ═══════════════════════════════════════════════════════════════════════════ */

const STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'but', 'of', 'to', 'in', 'on', 'at', 'for',
  'with', 'is', 'are', 'was', 'were', 'be', 'been', 'it', 'its', 'this', 'that',
  'as', 'by', 'from', 'we', 'you', 'they', 'not', 'has', 'have', 'had', 'will',
  'can', 'could', 'would', 'should', 'do', 'does', 'did', 'more', 'most', 'than',
])

function contentWords(input: string): string[] {
  return input
    .toLowerCase()
    .replace(/https?:\/\/\S+/g, ' ')
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !STOP_WORDS.has(w))
}

function bigrams(words: string[]): Set<string> {
  const out = new Set<string>()
  if (words.length === 1) out.add(words[0] as string)
  for (let i = 0; i < words.length - 1; i += 1) out.add(`${words[i]} ${words[i + 1]}`)
  return out
}

/**
 * Dice coefficient over content-word bigrams. Returns 0–1.
 * Used for duplicate detection, knowledge de-duplication and the similarity cap.
 */
export function similarity(a: string, b: string): number {
  const A = bigrams(contentWords(a))
  const B = bigrams(contentWords(b))
  if (A.size === 0 || B.size === 0) return 0
  let shared = 0
  for (const g of A) if (B.has(g)) shared += 1
  return (2 * shared) / (A.size + B.size)
}

/** Every numeric claim in a text, for rule 7. */
export function numericClaims(text: string): string[] {
  const matches = text.match(
    /\b\d+(?:[.,]\d+)?\s*(?:%|percent|x|×|bn|billion|mn|million|k\b|points?|pp\b)?/gi,
  )
  if (!matches) return []
  return matches
    .map((m) => m.trim())
    .filter((m) => /\d/.test(m))
    .filter((m) => !/^\d{4}$/.test(m)) // bare years are not claims
}

/**
 * Emoji detection. The variation selector U+FE0F is matched by alternation
 * rather than inside the class: a combining mark in a character class is
 * ambiguous, because it would also match as part of a grapheme cluster.
 */
const EMOJI_PATTERN =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{1F1E6}-\u{1F1FF}]|\u{FE0F}/gu

function countEmoji(text: string): number {
  const m = text.match(EMOJI_PATTERN)
  return m ? m.length : 0
}

function stripEmoji(text: string): string {
  return text.replace(EMOJI_PATTERN, '').replace(/\s{2,}/g, ' ').trim()
}

/** Hashtags present in a text, normalised to lower case without the hash. */
export function extractHashtags(text: string): string[] {
  const m = text.match(/#[\p{L}\p{N}_]+/gu)
  if (!m) return []
  return m.map((h) => h.slice(1).toLowerCase())
}

/**
 * Derive 3–5 topical hashtags from a topic string.
 * Never emits a generic tag. Deterministic for a given input.
 */
export function deriveHashtags(topic: string, count = 4): string[] {
  const clamped = Math.max(BRAND.hashtags.min, Math.min(BRAND.hashtags.max, count))

  const seedFromTopic = contentWords(topic)
    .map((w) => w.replace(/-/g, ''))
    .filter((w) => !GENERIC_HASHTAGS.includes(w))

  // PascalCase multi-word concepts read better as tags than raw words.
  const phrases: string[] = []
  const words = topic
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
  for (let i = 0; i < words.length - 1; i += 1) {
    const pair = `${words[i]}${words[i + 1]}`.replace(/-/g, '')
    if (pair.length > 6 && !GENERIC_HASHTAGS.includes(pair)) phrases.push(pair)
  }

  const canonical = [
    'ReinforcementLearning',
    'RewardModeling',
    'PostTraining',
    'AgenticAI',
    'ModelEvaluation',
    'SyntheticData',
    'AIResearch',
    'MachineLearning',
    'LLMOps',
    'AIAlignment',
  ]

  const pascal = (w: string) => w.charAt(0).toUpperCase() + w.slice(1)

  const pool: string[] = []
  for (const p of phrases) pool.push(p.split(/(?=[a-z])/).length ? pascalPhrase(p, words) : pascal(p))
  for (const w of seedFromTopic) if (w.length > 4) pool.push(pascal(w))
  for (const c of canonical) pool.push(c)

  const seen = new Set<string>()
  const out: string[] = []
  for (const tag of pool) {
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    if (GENERIC_HASHTAGS.includes(key)) continue
    if (tag.length < 4) continue
    seen.add(key)
    out.push(tag)
    if (out.length === clamped) break
  }
  return out
}

function pascalPhrase(joined: string, words: string[]): string {
  // Rebuild "rewardmodeling" as "RewardModeling" using the original word split.
  for (let i = 0; i < words.length - 1; i += 1) {
    const a = words[i] as string
    const b = words[i + 1] as string
    if (`${a}${b}`.replace(/-/g, '') === joined) {
      const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1).replace(/-/g, '')
      return `${cap(a)}${cap(b)}`
    }
  }
  return joined.charAt(0).toUpperCase() + joined.slice(1)
}

/* ═══════════════════════════════════════════════════════════════════════════
   enforceBrandVoice — runs unconditionally as the final step of caption
   generation, whatever produced the text (model or template).
   ═══════════════════════════════════════════════════════════════════════════ */

export interface EnforceResult {
  text: string
  changed: boolean
  /** Rule numbers whose mechanical enforcement fired. */
  rulesApplied: number[]
  notes: string[]
}

export function enforceBrandVoice(caption: string, topic: string): EnforceResult {
  const notes: string[] = []
  const rulesApplied = new Set<number>()
  const original = caption

  let body = caption

  // Rule 3 — forbidden language replacements.
  for (const { pattern, replacement, why } of FORBIDDEN_LANGUAGE) {
    if (pattern.test(body)) {
      body = body.replace(pattern, replacement)
      rulesApplied.add(3)
      notes.push(`Replaced forbidden phrasing (${why}).`)
    }
    pattern.lastIndex = 0
  }

  // Rule 5 — emoji budget is zero.
  const emoji = countEmoji(body)
  if (emoji > 0) {
    body = stripEmoji(body)
    rulesApplied.add(5)
    notes.push(`Removed ${emoji} emoji — the budget is zero on every platform.`)
  }

  // Rule 11 — clamp the hashtag block to exactly 3–5 topic-derived tags.
  const existing = extractHashtags(body)
  const withoutTags = body.replace(/#[\p{L}\p{N}_]+/gu, '').replace(/[ \t]{2,}/g, ' ')
  const kept = existing
    .filter((t) => !GENERIC_HASHTAGS.includes(t))
    .map((t) => t.charAt(0).toUpperCase() + t.slice(1))

  const target = Math.max(
    BRAND.hashtags.min,
    Math.min(BRAND.hashtags.max, kept.length || 4),
  )
  let tags = dedupeCaseInsensitive(kept).slice(0, BRAND.hashtags.max)
  if (tags.length < BRAND.hashtags.min) {
    for (const t of deriveHashtags(topic, target)) {
      if (!tags.some((x) => x.toLowerCase() === t.toLowerCase())) tags.push(t)
      if (tags.length >= target) break
    }
  }
  tags = tags.slice(0, BRAND.hashtags.max)

  const droppedGeneric = existing.length - kept.length
  if (droppedGeneric > 0) {
    rulesApplied.add(11)
    notes.push(`Dropped ${droppedGeneric} generic reach-bait hashtag(s).`)
  }
  if (existing.length > BRAND.hashtags.max) {
    rulesApplied.add(11)
    notes.push(`Clamped the hashtag block to ${BRAND.hashtags.max}.`)
  }
  if (existing.length < BRAND.hashtags.min) {
    rulesApplied.add(11)
    notes.push(`Added topical hashtags to reach the minimum of ${BRAND.hashtags.min}.`)
  }

  const trimmedBody = withoutTags
    .split('\n')
    .map((l) => l.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  const text = `${trimmedBody}\n\n${tags.map((t) => `#${t}`).join(' ')}`.trim()

  return {
    text,
    changed: text !== original,
    rulesApplied: [...rulesApplied].sort((a, b) => a - b),
    notes,
  }
}

function dedupeCaseInsensitive(list: string[]): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of list) {
    const k = item.toLowerCase()
    if (seen.has(k)) continue
    seen.add(k)
    out.push(item)
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   checkBrandCompliance — the twenty-rule checker
   ═══════════════════════════════════════════════════════════════════════════ */

export type BrandVerdict =
  | 'APPROVED'
  | 'REVISE'
  | 'CANNOT_VERIFY'
  | 'NEEDS_INTERNAL_APPROVAL'

/** Priority order. NEEDS_INTERNAL_APPROVAL outranks everything. */
const VERDICT_PRIORITY: Record<BrandVerdict, number> = {
  NEEDS_INTERNAL_APPROVAL: 4,
  CANNOT_VERIFY: 3,
  REVISE: 2,
  APPROVED: 1,
}

export type BrandDimension =
  | 'grounding'
  | 'voice'
  | 'structure'
  | 'platform'
  | 'visual'
  | 'captionVisual'

export interface DimensionResult {
  dimension: BrandDimension
  label: string
  pass: boolean
  /** Names the specific evidence. "Low confidence" alone is a bug. */
  detail: string
}

export interface Violation {
  rule: number
  title: string
  detail: string
  required_action: string
  /** Mechanical violations (3, 5, 11) can be auto-corrected; others cannot. */
  mechanical: boolean
}

export interface BrandCheck {
  verdict: BrandVerdict
  /** One sentence, naming evidence. */
  reason: string
  dimensions: DimensionResult[]
  violations: Violation[]
  /** Present only when every violation is mechanical. Rule 20. */
  corrected_version?: string
  numericClaimsFound: string[]
  emojiFound: number
  hashtagsFound: string[]
}

export interface BrandCandidate {
  caption: string
  topic: string
  platform: Platform
  /** Active Knowledge Base entries the caption was grounded in. */
  groundingEntries?: Array<{ title: string; content: string }>
  /** Headline drawn on the creative, for the caption↔visual check. */
  visualHeadline?: string
  visualCanvas?: string
  visualAltText?: string
  /** Previously published captions, for the similarity cap. */
  publishedCaptions?: string[]
}

const CANVAS_BY_PLATFORM: Record<Platform, string> = {
  linkedin: '1200x627',
  instagram: '1080x1350',
  x: '1600x900',
}

export function checkBrandCompliance(candidate: BrandCandidate): BrandCheck {
  const {
    caption,
    topic,
    platform,
    groundingEntries = [],
    visualHeadline,
    visualCanvas,
    visualAltText,
    publishedCaptions = [],
  } = candidate

  const violations: Violation[] = []
  const dimensions: DimensionResult[] = []

  /*
   * The verdict lives in a holder rather than a bare `let`. `raise` mutates it
   * from inside a closure, and a bare local would be narrowed to its initial
   * literal type by control-flow analysis, making later comparisons look
   * unreachable to the compiler.
   */
  const state: { verdict: BrandVerdict } = { verdict: 'APPROVED' }

  const raise = (v: BrandVerdict) => {
    if (VERDICT_PRIORITY[v] > VERDICT_PRIORITY[state.verdict]) state.verdict = v
  }

  const claims = numericClaims(caption)
  const emoji = countEmoji(caption)
  const tags = extractHashtags(caption)

  /* ── Rule 17 — sensitive topics. Checked first; outranks everything. ──── */
  const sensitiveHits: string[] = []
  for (const topicRule of SENSITIVE_TOPICS) {
    topicRule.pattern.lastIndex = 0
    if (topicRule.pattern.test(caption)) sensitiveHits.push(topicRule.label)
    topicRule.pattern.lastIndex = 0
  }
  if (sensitiveHits.length > 0) {
    violations.push({
      rule: 17,
      title: RULE_BY_NUMBER[17]!.title,
      detail: `The caption touches ${sensitiveHits.join(', ')}. Only someone inside the company can confirm this is cleared to publish.`,
      required_action: 'Route to internal approval before this can proceed.',
      mechanical: false,
    })
    raise('NEEDS_INTERNAL_APPROVAL')
  }

  /* ── Grounding · rules 6 and 7 ────────────────────────────────────────── */
  const groundedTerms = groundingEntries
    .flatMap((e) => contentWords(`${e.title} ${e.content}`))
    .slice(0, 4000)
  const groundedSet = new Set(groundedTerms)

  if (claims.length > 0 && groundingEntries.length === 0) {
    violations.push({
      rule: 7,
      title: RULE_BY_NUMBER[7]!.title,
      detail: `The caption carries ${claims.length} figure(s) — ${claims.slice(0, 3).join(', ')} — with no Knowledge Base entry behind them.`,
      required_action: 'Cite the source for each figure, or remove the figures.',
      mechanical: false,
    })
    raise('CANNOT_VERIFY')
    dimensions.push({
      dimension: 'grounding',
      label: 'Grounding',
      pass: false,
      detail: `${claims.length} unsourced figure(s) and no grounding entries supplied.`,
    })
  } else if (groundingEntries.length === 0) {
    dimensions.push({
      dimension: 'grounding',
      label: 'Grounding',
      pass: false,
      detail:
        'No Knowledge Base entries were retrieved for this caption, so nothing in it is verifiable.',
    })
    raise('CANNOT_VERIFY')
    violations.push({
      rule: 6,
      title: RULE_BY_NUMBER[6]!.title,
      detail: 'The caption was written without any active Knowledge Base entry behind it.',
      required_action:
        'Run the research build for this topic, or attach a grounding entry, then regenerate.',
      mechanical: false,
    })
  } else {
    const captionTerms = contentWords(caption)
    const overlap = captionTerms.filter((w) => groundedSet.has(w)).length
    const ratio = captionTerms.length === 0 ? 0 : overlap / captionTerms.length
    const pass = ratio >= 0.12
    dimensions.push({
      dimension: 'grounding',
      label: 'Grounding',
      pass,
      detail: pass
        ? `${overlap} of ${captionTerms.length} content words trace to ${groundingEntries.length} active entry/entries.`
        : `Only ${overlap} of ${captionTerms.length} content words trace to the ${groundingEntries.length} entry/entries retrieved.`,
    })
    if (!pass) {
      raise('CANNOT_VERIFY')
      violations.push({
        rule: 6,
        title: RULE_BY_NUMBER[6]!.title,
        detail: `The caption diverges from its grounding: ${Math.round(ratio * 100)}% term overlap against the retrieved entries.`,
        required_action: 'Regenerate against the retrieved entries, or attach the missing source.',
        mechanical: false,
      })
    }
  }

  /* ── Voice · rules 3 and 5 (mechanical) and 1 (assisted) ──────────────── */
  const forbiddenHits: string[] = []
  for (const f of FORBIDDEN_LANGUAGE) {
    f.pattern.lastIndex = 0
    const m = caption.match(f.pattern)
    if (m) forbiddenHits.push(m[0])
    f.pattern.lastIndex = 0
  }
  const pitchHits: string[] = []
  for (const p of PITCH_LANGUAGE) {
    p.pattern.lastIndex = 0
    const m = caption.match(p.pattern)
    if (m) pitchHits.push(m[0])
    p.pattern.lastIndex = 0
  }

  if (forbiddenHits.length > 0) {
    violations.push({
      rule: 3,
      title: RULE_BY_NUMBER[3]!.title,
      detail: `Hype vocabulary present: ${forbiddenHits.slice(0, 4).join(', ')}.`,
      required_action: 'Replace with the plain equivalent.',
      mechanical: true,
    })
    raise('REVISE')
  }
  if (emoji > 0) {
    violations.push({
      rule: 5,
      title: RULE_BY_NUMBER[5]!.title,
      detail: `${emoji} emoji present against a budget of ${BRAND.emojiBudget}.`,
      required_action: 'Strip every emoji.',
      mechanical: true,
    })
    raise('REVISE')
  }
  if (pitchHits.length > 0) {
    violations.push({
      rule: 1,
      title: RULE_BY_NUMBER[1]!.title,
      detail: `Sales language present: ${pitchHits.slice(0, 4).join(', ')}. This reads as a pitch, not a research finding.`,
      required_action: 'Rewrite as a finding. This one needs a human judgement, not a substitution.',
      mechanical: false,
    })
    raise('REVISE')
  }

  dimensions.push({
    dimension: 'voice',
    label: 'Voice',
    pass: forbiddenHits.length === 0 && emoji === 0 && pitchHits.length === 0,
    detail:
      forbiddenHits.length === 0 && emoji === 0 && pitchHits.length === 0
        ? 'No hype vocabulary, no sales language and no emoji.'
        : `${forbiddenHits.length} hype phrase(s), ${pitchHits.length} sales phrase(s), ${emoji} emoji.`,
  })

  /* ── Structure · rules 10 and 2 ───────────────────────────────────────── */
  const firstLine = caption.trim().split('\n')[0] ?? ''
  const hookWords = firstLine.trim().split(/\s+/).filter(Boolean).length
  const paragraphs = caption
    .split(/\n{2,}/)
    .map((p) => p.trim())
    .filter(Boolean)
  const hookOk = hookWords > 0 && hookWords <= BRAND.hookMaxWords
  const depthOk = platform === 'x' ? paragraphs.length >= 1 : paragraphs.length >= 3

  dimensions.push({
    dimension: 'structure',
    label: 'Structure',
    pass: hookOk && depthOk,
    detail: hookOk
      ? `Hook is ${hookWords} words (limit ${BRAND.hookMaxWords}); ${paragraphs.length} paragraph(s).`
      : `Hook is ${hookWords} words against a limit of ${BRAND.hookMaxWords}.`,
  })
  if (!hookOk) {
    violations.push({
      rule: 10,
      title: RULE_BY_NUMBER[10]!.title,
      detail: `The hook runs to ${hookWords} words; the limit is ${BRAND.hookMaxWords}.`,
      required_action: `Cut the first line to ${BRAND.hookMaxWords} words or fewer.`,
      mechanical: false,
    })
    raise('REVISE')
  }
  if (!depthOk) {
    violations.push({
      rule: 10,
      title: RULE_BY_NUMBER[10]!.title,
      detail: `Only ${paragraphs.length} paragraph(s) for ${platform}; the nine-stage structure needs at least three.`,
      required_action: 'Expand toward Hook → Context → Problem → Reframe → Mechanism → Evidence.',
      mechanical: false,
    })
    raise('REVISE')
  }

  /* ── Platform · rule 11 ───────────────────────────────────────────────── */
  const genericTags = tags.filter((t) => GENERIC_HASHTAGS.includes(t))
  const tagCountOk = tags.length >= BRAND.hashtags.min && tags.length <= BRAND.hashtags.max
  const platformPass = tagCountOk && genericTags.length === 0

  dimensions.push({
    dimension: 'platform',
    label: 'Platform',
    pass: platformPass,
    detail: platformPass
      ? `${tags.length} topical hashtags, within the ${BRAND.hashtags.min}–${BRAND.hashtags.max} range.`
      : `${tags.length} hashtag(s)${genericTags.length ? `, ${genericTags.length} of them generic (${genericTags.slice(0, 3).join(', ')})` : ''}.`,
  })
  if (!platformPass) {
    violations.push({
      rule: 11,
      title: RULE_BY_NUMBER[11]!.title,
      detail: !tagCountOk
        ? `${tags.length} hashtags against a required ${BRAND.hashtags.min}–${BRAND.hashtags.max}.`
        : `${genericTags.length} generic reach-bait tag(s): ${genericTags.join(', ')}.`,
      required_action: `Carry ${BRAND.hashtags.min}–${BRAND.hashtags.max} topic-derived hashtags and drop the generic ones.`,
      mechanical: true,
    })
    raise('REVISE')
  }

  /* ── Visual · rules 14 and 16 ─────────────────────────────────────────── */
  const expectedCanvas = CANVAS_BY_PLATFORM[platform]
  const canvasOk = !visualCanvas || visualCanvas === expectedCanvas
  const altOk = visualHeadline ? Boolean(visualAltText && visualAltText.trim().length > 0) : true

  dimensions.push({
    dimension: 'visual',
    label: 'Visual',
    pass: canvasOk && altOk,
    detail: !visualHeadline
      ? 'No creative attached to check.'
      : canvasOk && altOk
        ? `Canvas ${visualCanvas ?? expectedCanvas} is correct for ${platform}, and alt text is present.`
        : !canvasOk
          ? `Canvas ${visualCanvas} is wrong for ${platform}; expected ${expectedCanvas}.`
          : 'The asset has no alt text.',
  })
  if (!canvasOk) {
    violations.push({
      rule: 14,
      title: RULE_BY_NUMBER[14]!.title,
      detail: `Canvas ${visualCanvas} does not match ${platform} (${expectedCanvas}).`,
      required_action: `Re-render on ${expectedCanvas}.`,
      mechanical: true,
    })
    raise('REVISE')
  }
  if (!altOk) {
    violations.push({
      rule: 16,
      title: RULE_BY_NUMBER[16]!.title,
      detail: 'The creative has no alt text, so it cannot be published.',
      required_action: 'Generate alt text describing the content.',
      mechanical: true,
    })
    raise('REVISE')
  }

  /* ── Caption ↔ visual · rule 15 ───────────────────────────────────────── */
  if (visualHeadline) {
    const agreement = similarity(firstLine, visualHeadline)
    const pass = agreement >= 0.18
    dimensions.push({
      dimension: 'captionVisual',
      label: 'Caption↔visual',
      pass,
      detail: pass
        ? `The headline restates the hook (${Math.round(agreement * 100)}% agreement).`
        : `The headline and the hook agree on only ${Math.round(agreement * 100)}% of their terms.`,
    })
    if (!pass) {
      violations.push({
        rule: 15,
        title: RULE_BY_NUMBER[15]!.title,
        detail: `The creative says "${visualHeadline}" while the caption opens "${firstLine.slice(0, 70)}".`,
        required_action: 'Re-render the headline from the caption hook, or rewrite the hook.',
        mechanical: false,
      })
      raise('REVISE')
    }
  } else {
    dimensions.push({
      dimension: 'captionVisual',
      label: 'Caption↔visual',
      pass: true,
      detail: 'No creative attached to compare.',
    })
  }

  /* ── Rule 18 — similarity cap against what already shipped ────────────── */
  let closest = 0
  let closestCaption = ''
  for (const prev of publishedCaptions) {
    const s = similarity(caption, prev)
    if (s > closest) {
      closest = s
      closestCaption = prev
    }
  }
  if (closest > BRAND.similarityCap.caption) {
    violations.push({
      rule: 18,
      title: RULE_BY_NUMBER[18]!.title,
      detail: `${Math.round(closest * 100)}% similar to a published post ("${closestCaption.slice(0, 60)}…"), above the ${Math.round(BRAND.similarityCap.caption * 100)}% cap.`,
      required_action: 'Take a different angle, or retire the earlier post from consideration.',
      mechanical: false,
    })
    raise('REVISE')
  }

  /* ── Compose the reason, naming evidence ──────────────────────────────── */
  const finalVerdict = state.verdict
  let reason: string
  if (finalVerdict === 'APPROVED') {
    reason = `Clean against all twenty rules: ${tags.length} topical hashtags, no hype vocabulary, ${groundingEntries.length} grounding entry/entries, hook at ${hookWords} words.`
  } else if (finalVerdict === 'NEEDS_INTERNAL_APPROVAL') {
    reason = `Held for internal approval: the caption touches ${sensitiveHits.join(', ')}. This outranks every other finding.`
  } else if (finalVerdict === 'CANNOT_VERIFY') {
    reason =
      claims.length > 0
        ? `Cannot verify ${claims.length} figure(s) — ${claims.slice(0, 3).join(', ')} — against the Knowledge Base.`
        : 'Cannot verify: nothing in this caption traces to an active Knowledge Base entry.'
  } else {
    const ruleList = [...new Set(violations.map((v) => v.rule))].sort((a, b) => a - b)
    reason = `Revise: ${violations.length} finding(s) against rule${ruleList.length > 1 ? 's' : ''} ${ruleList.join(', ')}.`
  }

  /* ── Rule 20 — a corrected version ONLY when every violation is mechanical */
  const allMechanical = violations.length > 0 && violations.every((v) => v.mechanical)
  const check: BrandCheck = {
    verdict: finalVerdict,
    reason,
    dimensions,
    violations,
    numericClaimsFound: claims,
    emojiFound: emoji,
    hashtagsFound: tags,
  }
  if (finalVerdict === 'REVISE' && allMechanical) {
    check.corrected_version = enforceBrandVoice(caption, topic).text
  }
  return check
}

/** The brand rules as Knowledge Base rows, seeded with `origin='brand'`. */
export function brandRulesAsKnowledge(): Array<{
  title: string
  category: string
  content: string
  confidence: 'High'
}> {
  return BRAND_RULES.map((r) => ({
    title: `Rule ${r.n} · ${r.title}`,
    category:
      r.area === 'Visual'
        ? 'Visual Identity'
        : r.area === 'Candidate & Risk'
          ? 'Compliance Rule'
          : r.area === 'Factual & Content'
            ? 'Brand Guideline'
            : 'Brand Voice',
    content: `${r.text} (Enforcement: ${r.enforcement}.)`,
    confidence: 'High' as const,
  }))
}

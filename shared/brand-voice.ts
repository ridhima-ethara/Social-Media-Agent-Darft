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
  /*
   * 5–7, raised from 3–5 by the caption-writing specification.
   *
   * The spec states the change explicitly: "This replaces the original 3-5 rule
   * everywhere, including output validation." Both tiers, the publishing
   * validator and `npm run verify` read this, so raising it here moves all of
   * them together rather than leaving a validator that rejects what the writer
   * was told to produce.
   */
  hashtags: { min: 5, max: 7 },
  /**
   * The nine-stage caption skeleton (rule 8).
   *
   * The stages must be FUNCTIONALLY present, not each in its own sentence or
   * paragraph. A short post may carry several stages in one line and still
   * comply; what fails is a post that never establishes the problem, never
   * shows the mechanism, or never lands the implication.
   */
  captionStructure: [
    'Hook',
    'Context',
    'Problem',
    'Reframe',
    'Mechanism',
    'Evidence',
    'Implication',
    'Ethara AI connection',
    'Closing line or question',
  ],
  /**
   * Rules 4 and 8. The Ethara connection is the one stage that may be dropped:
   * forcing company promotion into an otherwise research-focused post is
   * itself a violation, so omitting it is the compliant choice rather than a
   * structural gap.
   */
  etharaConnectionOptional: true,
  hookMaxWords: 18,
  /**
   * Rule 3 carries an explicit carve-out: these words are NOT hype and must
   * never be added to `FORBIDDEN_LANGUAGE`, because they are load-bearing in
   * Ethara's own positioning. Enforcing them would put the compliance layer in
   * conflict with the brand it exists to protect. Only the team may lift this.
   */
  neverForbidden: ['infrastructure'],
  visual: {
    accent: '#8B2CF5',
    family: ['#8B2CF5', '#A855F7', '#C084FC', '#5E1BC7'],
    displayFont: 'Roboto',
    bodyFont: 'DM Sans',
  },
  /** Above these, a candidate is too close to something already published. */
  similarityCap: { caption: 0.7, image: 0.85 },
} as const

/**
 * Topic vocabulary used by `validation.relevance.score` and by the Scraping
 * Agent's alignment scoring. This is the fixed declaration of the rule 1 and
 * rule 7 domain; the Knowledge Base corpus is what keeps it current.
 */
export const BRAND_TOPICS: string[] = [
  'reinforcement learning',
  'rlhf',
  'agentic ai',
  'ai agents',
  'benchmarks',
  'evaluation harness',
  'ai environments',
  'post training',
  'preference optimization',
  'tool use',
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
  | 'Platform Invariant'

export type RuleEnforcement = 'automatic' | 'assisted' | 'human'

export interface BrandRule {
  n: number
  area: RuleArea
  title: string
  text: string
  enforcement: RuleEnforcement
}

/**
 * THE TWENTY RULES — numbered exactly as the brand-voice skill numbers them.
 *
 * The numbers are the contract. Rule 6 is factual grounding here because rule 6
 * is factual grounding in the skill, and a failure report that cites "rule 6"
 * has to mean the same thing to the operator reading it as it does to the
 * person who wrote the standard. Renumbering these is a breaking change to
 * every compliance report the platform has ever produced.
 */
export const BRAND_RULES: BrandRule[] = [
  // ── Voice & Positioning 1–5 ──────────────────────────────────────────────
  {
    n: 1,
    area: 'Voice & Positioning',
    title: 'Brand positioning',
    text: 'Ethara.AI communicates as a frontier AI research lab, not as a startup pitching a product. Content stays relevant to Ethara.AI\u2019s domain: reinforcement learning, agentic AI, evaluation, benchmarks, post-training and the AI environments around them.',
    enforcement: 'assisted',
  },
  {
    n: 2,
    area: 'Voice & Positioning',
    title: 'Voice',
    text: 'Research-credible, anti-hype, confident, declarative, plain natural English. Prefer precise claims and clear explanations over promotional framing, and set out the trends that actually matter now.',
    enforcement: 'assisted',
  },
  {
    n: 3,
    area: 'Voice & Positioning',
    title: 'Forbidden language',
    text: 'No motivational clich\u00e9s, generic AI hype or promotional openers: "excited to announce", "thrilled to share", "game-changing", "revolutionize", "unlock the power". "Infrastructure" is explicitly NOT forbidden \u2014 it conflicts with existing Ethara positioning and only the team may change that.',
    enforcement: 'automatic',
  },
  {
    n: 4,
    area: 'Voice & Positioning',
    title: 'Ethara connection',
    text: 'Include an Ethara AI connection only when it follows naturally from the subject and the available evidence. Never force company promotion into an otherwise research-focused post.',
    enforcement: 'assisted',
  },
  {
    n: 5,
    area: 'Voice & Positioning',
    title: 'Emoji and punctuation',
    text: 'Zero emoji. Avoid promotional punctuation and stylistic choices that make the content read as hype rather than research communication.',
    enforcement: 'automatic',
  },

  // ── Factual & Content 6–11 ───────────────────────────────────────────────
  {
    n: 6,
    area: 'Factual & Content',
    title: 'Factual grounding',
    text: 'Every load-bearing factual, performance, capability or comparative claim traces to a cited source or a Knowledge Base key point. Never invent numbers, broaden a finding beyond its evidence, convert an interpretation into a factual claim, or present an unsupported comparison as established. An unverifiable material claim cannot be APPROVED.',
    enforcement: 'assisted',
  },
  {
    n: 7,
    area: 'Factual & Content',
    title: 'Relevance',
    text: 'The topic and angle must have meaningful relevance to Ethara AI\u2019s domain and positioning. A generic AI connection alone is insufficient.',
    enforcement: 'assisted',
  },
  {
    n: 8,
    area: 'Factual & Content',
    title: 'Caption structure',
    text: 'A full caption functionally contains Hook → Context → Problem → Reframe → Mechanism → Evidence → Implication → Ethara AI connection → Closing line or question. Not every stage needs its own sentence, and the Ethara connection may be omitted when including it would force promotion.',
    enforcement: 'assisted',
  },
  {
    n: 9,
    area: 'Factual & Content',
    title: 'Hook integrity',
    text: 'The hook must be supported by the available evidence. Do not exaggerate a result, manufacture tension, or make a stronger claim simply to produce a more arresting opening.',
    enforcement: 'human',
  },
  {
    n: 10,
    area: 'Factual & Content',
    title: 'Platform differentiation',
    text: 'LinkedIn, Instagram, Facebook and X variants are adapted to their platform rather than reused verbatim. Variants differ meaningfully in treatment, length, pacing or presentation while preserving the same factual thesis.',
    enforcement: 'assisted',
  },
  {
    n: 11,
    area: 'Factual & Content',
    title: 'Hashtags',
    text: 'Exactly 3–5 topic-specific hashtags per post, derived from the actual subject rather than generic reach-oriented tags. No knob may raise the ceiling above five.',
    enforcement: 'automatic',
  },

  // ── Visual 12–16 ─────────────────────────────────────────────────────────
  {
    n: 12,
    area: 'Visual',
    title: 'Brand palette',
    text: 'Creatives use the Ethara Purple family with primary accent #8B2CF5. Supporting colours stay consistent with the approved Ethara visual system.',
    enforcement: 'automatic',
  },
  {
    n: 13,
    area: 'Visual',
    title: 'Typography',
    text: 'Roboto for display and headline treatment, DM Sans for body and supporting text. Nothing else names a typeface.',
    enforcement: 'automatic',
  },
  {
    n: 14,
    area: 'Visual',
    title: 'Visual style',
    text: 'The creative supports the same thesis as the caption and avoids generic or clich\u00e9 AI imagery. Visuals communicate the underlying research, system, comparison, mechanism, evidence or concept rather than decorating the post with stock technology imagery.',
    enforcement: 'assisted',
  },
  {
    n: 15,
    area: 'Visual',
    title: 'Logo compliance',
    text: 'Apply the approved Ethara AI logo and its placement rules. Never distort, reconstruct, approximate or inconsistently apply the brand mark.',
    enforcement: 'automatic',
  },
  {
    n: 16,
    area: 'Visual',
    title: 'Caption–visual consistency',
    text: 'The creative\u2019s central visual thesis must agree with the caption\u2019s central thesis. A factually correct caption paired with a misleading or unrelated creative fails compliance.',
    enforcement: 'assisted',
  },

  // ── Candidate & Risk 17–20 ───────────────────────────────────────────────
  {
    n: 17,
    area: 'Candidate & Risk',
    title: 'Option distinctness',
    text: 'When multiple options are produced they must be genuinely different: captions at most 0.70 similarity, images at most 0.85. Differences must come from framing, argument, composition, visual approach or information hierarchy — not synonym swaps.',
    enforcement: 'automatic',
  },
  {
    n: 18,
    area: 'Candidate & Risk',
    title: 'Confidentiality and reputational gate',
    text: 'Never automatically approve unannounced funding, customers, partnerships or hires, unpublished performance numbers, legal or policy positions, or sensitive competitor claims. These require internal review.',
    enforcement: 'automatic',
  },
  {
    n: 19,
    area: 'Candidate & Risk',
    title: 'Independent caption and creative judgement',
    text: 'When both a caption and a creative are supplied, evaluate each independently and then evaluate their consistency together. A compliant caption does not make a non-compliant creative acceptable, and the reverse holds too.',
    enforcement: 'assisted',
  },
  {
    n: 20,
    area: 'Candidate & Risk',
    title: 'No silent correction',
    text: 'Brand Voice validates; it does not quietly rewrite. Name the rule that failed rather than changing a candidate and presenting it as approved. On REVISE a corrected version may be supplied, but the original failure stays explicit. A human instruction outranks a guideline — apply it and raise the finding alongside it.',
    enforcement: 'human',
  },
]

/**
 * PLATFORM INVARIANTS — 21 upward.
 *
 * These are not brand-voice rules; they are the mechanisms that make several of
 * the twenty hold, plus the platform's own non-negotiables. They live outside
 * 1–20 so the twenty stay exactly as the brand standard numbers them, and they
 * are numbered rather than unlabelled so a violation can still cite something
 * specific instead of reporting an anonymous failure.
 */
export const PLATFORM_INVARIANTS: BrandRule[] = [
  {
    n: 21,
    area: 'Platform Invariant',
    title: 'Brand text is drawn locally',
    text: 'No diffusion model is ever asked to render brand text. Headline, kicker, logomark and footer are drawn as vectors over any generated background. This is what makes rules 12, 13 and 15 hold even when a model ignores its prompt.',
    enforcement: 'automatic',
  },
  {
    n: 22,
    area: 'Platform Invariant',
    title: 'Correct canvas per platform',
    text: 'LinkedIn 1200×627, Instagram 1080×1350, X 1600×900, Facebook 1200×630. A post is never shipped on the wrong canvas. This is the measurable half of rule 10.',
    enforcement: 'automatic',
  },
  {
    n: 23,
    area: 'Platform Invariant',
    title: 'Alt text always',
    text: 'Every asset ships with alt text describing the content rather than the styling. An asset without alt text cannot be published.',
    enforcement: 'automatic',
  },
  {
    n: 24,
    area: 'Platform Invariant',
    title: 'Our own trailing baseline only',
    text: 'Performance comparisons use this account\u2019s own trailing baseline, never an industry benchmark we did not measure. A metric that has not been reported is excluded, never counted as zero.',
    enforcement: 'automatic',
  },
  {
    n: 25,
    area: 'Platform Invariant',
    title: 'Two human approvals before publication',
    text: 'Marketing approves, then Leadership approves. This checkpoint has no off switch, and a rejection cannot be recorded without a reason.',
    enforcement: 'human',
  },
  {
    n: 26,
    area: 'Platform Invariant',
    title: 'Numbers name their source',
    text: 'Any figure in a caption names where it came from, or it is removed. This is the operational form of rule 6: an unsourced number is a liability even when it happens to be true.',
    enforcement: 'assisted',
  },
  {
    n: 27,
    area: 'Platform Invariant',
    title: 'No competitor disparagement',
    text: 'Never position by attacking a named lab. Compare mechanisms and results, not organisations. Rule 18 gates sensitive competitor claims; this forbids the disparaging register outright.',
    enforcement: 'human',
  },
]

/**
 * Every numbered rule the checker may cite, brand rules and invariants alike.
 * A violation carrying a number that is not in here is a defect.
 */
export const ALL_RULES: BrandRule[] = [...BRAND_RULES, ...PLATFORM_INVARIANTS]

export const RULE_BY_NUMBER: Record<number, BrandRule> = Object.fromEntries(
  ALL_RULES.map((r) => [r.n, r]),
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
 * The same tags with their ORIGINAL casing kept.
 *
 * `extractHashtags` lower-cases because every comparison it feeds is
 * case-insensitive. Rebuilding the visible block from that loses the internal
 * capital — `#ReinforcementLearning` comes back as `#Reinforcementlearning`,
 * which reads as a typo on a research account. The enforcer needs the author's
 * casing, so it reads the tags through this instead.
 */
export function extractHashtagsPreservingCase(text: string): string[] {
  const m = text.match(/#[\p{L}\p{N}_]+/gu)
  if (!m) return []
  return m.map((h) => h.slice(1))
}

/**
 * Derive 3–5 topical hashtags from a topic string.
 * Never emits a generic tag. Deterministic for a given input.
 */
/**
 * The topic in running-prose case, with acronyms left alone.
 *
 * `sourceTopic.toLowerCase()` produced "Most teams treat rlhf as a tuning
 * exercise" and "anyone shipping ai evaluation" — six of eleven stored drafts
 * carried a lowercased acronym mid-sentence, which reads as a typo and, for a
 * research audience, undercuts the claim.
 *
 * Only the acronyms the brand vocabulary actually uses are special-cased; every
 * other word lowercases as before, because a topic is a phrase inside a sentence
 * and should not shout.
 */
const ACRONYMS = new Set([
  'ai', 'agi', 'api', 'cot', 'dpo', 'gpu', 'grpo', 'kl', 'llm', 'llms', 'mcp',
  'ml', 'nlp', 'ppo', 'rag', 'rl', 'rlaif', 'rlhf', 'sft', 'sota', 'tpu',
])

export function topicInProse(topic: string): string {
  return topic
    .split(/(\s+)/)
    .map((part) => {
      const bare = part.replace(/[^A-Za-z]/g, '').toLowerCase()
      if (bare.length > 0 && ACRONYMS.has(bare)) {
        return part.replace(/[A-Za-z]+/g, (w) => w.toUpperCase())
      }
      return part.toLowerCase()
    })
    .join('')
}

export function deriveHashtags(topic: string, count = 4): string[] {
  const clamped = Math.max(BRAND.hashtags.min, Math.min(BRAND.hashtags.max, count))

  const seedFromTopic = contentWords(topic)
    .map((w) => w.replace(/-/g, ''))
    .filter((w) => !GENERIC_HASHTAGS.includes(w))

  /*
   * PascalCase multi-word concepts read better as tags than raw words — but
   * only when both halves carry meaning. Pairing raw adjacent words turns
   * "learning from human feedback" into #LearningFrom and #FromHuman, which is
   * how a research account ends up publishing tags that mean nothing. Pairing
   * CONTENT words instead drops the function words first, and the canonical
   * list below is preferred over any generated pair.
   */
  const phrases: string[] = []
  const words = contentWords(topic).map((w) => w.replace(/-/g, ''))
  for (let i = 0; i < words.length - 1; i += 1) {
    const a = words[i] as string
    const b = words[i + 1] as string
    const pair = `${a}${b}`
    if (a.length < 4 || b.length < 4) continue
    if (pair.length > 8 && !GENERIC_HASHTAGS.includes(pair)) phrases.push(pair)
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

  /*
   * An acronym is upper-cased whole. `pascal()` alone produced #Rlhf and
   * #AiEnvironments — a research audience reads those as carelessness, and the
   * tag no longer matches what anyone actually searches for.
   */
  const pascal = (w: string): string =>
    ACRONYMS.has(w.toLowerCase())
      ? w.toUpperCase()
      : w.charAt(0).toUpperCase() + w.slice(1)

  /*
   * Order matters, and it is deliberate: a canonical concept the topic actually
   * mentions is the best tag available, a strong single word is the safe
   * fallback, and a generated pair is the last resort rather than the first.
   */
  const haystack = topic.toLowerCase().replace(/[^a-z0-9]/g, '')
  const prose = topic.toLowerCase()

  /*
   * A tag has to be about the subject, and "the subject" is a declared thing
   * here — BRAND_TOPICS is the domain vocabulary the whole pipeline scores
   * against. Deriving from raw words instead produces #Learns and #Helpfulness
   * from a sentence about reward models: grammatically fine, worthless as tags,
   * and precisely the reach-oriented noise rule 11 forbids. So a single word
   * earns a tag only by being domain vocabulary; anything else falls through to
   * the canonical concepts, which are on-brand by construction.
   */
  const domainPhrases = BRAND_TOPICS
    .filter((term) => term.length > 3 && prose.includes(term))
    .sort((a, b) => b.length - a.length)

  const isDomainWord = (w: string): boolean =>
    BRAND_TOPICS.some((term) => term === w || term.split(/\s+/).includes(w)) ||
    canonical.some((c) => c.toLowerCase() === w)

  const pool: string[] = []
  for (const c of canonical) if (haystack.includes(c.toLowerCase())) pool.push(c)
  for (const term of domainPhrases) {
    pool.push(term.split(/[\s-]+/).map((w) => pascal(w)).join(''))
  }
  for (const w of seedFromTopic) if (w.length > 4 && isDomainWord(w)) pool.push(pascal(w))
  // Canonical concepts before generated pairs: an on-brand tag the post did not
  // literally contain beats a grammatical pair that means nothing (#ModelLearns).
  for (const c of canonical) pool.push(c)
  for (const phrase of phrases) pool.push(pascalPhrase(phrase, words))

  /*
   * A tag must not be a fragment of one already chosen.
   *
   * Deduping on exact equality let `#ReinforcementLearning`, `#Reinforcement`
   * and `#Learning` all through — the concept plus both of its halves, three
   * slots spent saying one thing. It also passed `#Environment` beside
   * `#Environments` and `#Agent` beside `#Agentic`. Eight of eleven stored
   * drafts carried a pair like that.
   *
   * `subsumes` treats a tag as redundant when it is contained in a tag already
   * taken, or differs from it only by a plural `s`. The pool is ordered longest
   * concept first, so the specific tag is the one that survives.
   */
  const singular = (key: string): string => key.replace(/s$/, '')

  const taken: string[] = []
  const subsumes = (key: string): boolean =>
    taken.some(
      (other) =>
        other.includes(key) || key.includes(other) || singular(other) === singular(key),
    )

  const out: string[] = []
  for (const tag of pool) {
    const key = tag.toLowerCase()
    if (GENERIC_HASHTAGS.includes(key)) continue
    if (tag.length < 4) continue
    if (subsumes(key)) continue
    taken.push(key)
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
      const cap = (w: string): string => {
        const bare = w.replace(/-/g, '')
        return ACRONYMS.has(bare.toLowerCase())
          ? bare.toUpperCase()
          : bare.charAt(0).toUpperCase() + bare.slice(1)
      }
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

/**
 * SPLITS PARAGRAPH BLOCKS INTO ONE THOUGHT PER LINE.
 *
 * The caption specification asks for short connected lines with a blank line
 * between thoughts. A language model treats that as stylistic advice and complies
 * unevenly — measured across nine regenerated captions, every hard constraint
 * (hashtag count, prohibited phrases, single close) was honoured and the line
 * layout was not.
 *
 * So it is enforced rather than requested, exactly as the emoji budget is: this
 * strips, it does not warn.
 *
 * WHAT IT DOES NOT DO. It does not split on every comma or clause — the
 * specification explicitly forbids turning prose into fragments. It splits only at
 * sentence boundaries, and only inside a block that is long enough to be a
 * paragraph. A block already under the threshold is left exactly as written,
 * because a deliberate two-sentence pairing is not a defect.
 *
 * Hashtag lines and list items are passed through untouched: they are not prose
 * and re-flowing them would break the block the platform reads.
 */
export function enforceShortLines(
  body: string,
  opts: { maxWordsPerLine?: number } = {},
): { body: string; changed: boolean } {
  const threshold = opts.maxWordsPerLine ?? 28
  const blocks = body.split(/\n{2,}/)
  let changed = false

  const rewritten = blocks.map((block) => {
    const trimmed = block.trim()
    if (trimmed === '') return block

    // Not prose — leave it alone.
    if (trimmed.startsWith('#') || /^\s*(?:[-*•]|\d+[.)])\s/.test(trimmed)) return block

    // Already short enough to be one thought.
    if (trimmed.split(/\s+/).length <= threshold) return block

    /*
     * Split after `.`, `?` or `!` when followed by whitespace and a capital or a
     * digit. The lookahead matters: `2.5` and `e.g.` would otherwise break mid
     * token, and an abbreviation is far more likely inside technical copy than a
     * sentence starting lowercase.
     */
    const sentences = trimmed
      .replace(/\s+/g, ' ')
      .split(/(?<=[.?!])\s+(?=[A-Z0-9"'“'])/g)
      .map((x) => x.trim())
      .filter((x) => x !== '')

    if (sentences.length < 2) return block
    changed = true
    return sentences.join('\n\n')
  })

  return { body: rewritten.join('\n\n'), changed }
}

export function enforceBrandVoice(caption: string, topic: string): EnforceResult {
  const notes: string[] = []
  const rulesApplied = new Set<number>()
  const original = caption

  let body = caption

  // Short-line layout, enforced mechanically because the model complies unevenly.
  const lines = enforceShortLines(body)
  if (lines.changed) {
    body = lines.body
    rulesApplied.add(8)
    notes.push('Split paragraph blocks into one thought per line.')
  }

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
  // Cased as the author wrote them; only the generic ones are dropped. A tag
  // that arrived all-lower still gets its first letter raised.
  const kept = extractHashtagsPreservingCase(body)
    .filter((tag) => !GENERIC_HASHTAGS.includes(tag.toLowerCase()))
    .map((tag) => (/[A-Z]/.test(tag) ? tag : tag.charAt(0).toUpperCase() + tag.slice(1)))

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
  /**
   * Mechanical violations — forbidden phrasing (3), emoji and promotional
   * punctuation (5), the hashtag block (11), canvas (22) and alt text (23) —
   * can be corrected without judgement. Everything else needs a human, and
   * rule 20 forbids attaching a corrected version when any violation does.
   */
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
  facebook: '1200x630',
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

  /* ── Rule 18 — the confidentiality gate. Checked first; outranks all. ──── */
  const sensitiveHits: string[] = []
  for (const topicRule of SENSITIVE_TOPICS) {
    topicRule.pattern.lastIndex = 0
    if (topicRule.pattern.test(caption)) sensitiveHits.push(topicRule.label)
    topicRule.pattern.lastIndex = 0
  }
  if (sensitiveHits.length > 0) {
    violations.push({
      rule: 18,
      title: RULE_BY_NUMBER[18]!.title,
      detail: `The caption touches ${sensitiveHits.join(', ')}. Only someone inside the company can confirm this is cleared to publish.`,
      required_action: 'Route to internal approval before this can proceed.',
      mechanical: false,
    })
    raise('NEEDS_INTERNAL_APPROVAL')
  }

  /* ── Grounding · rule 6, with invariant 26 for unsourced figures ──────── */
  const groundedTerms = groundingEntries
    .flatMap((e) => contentWords(`${e.title} ${e.content}`))
    .slice(0, 4000)
  const groundedSet = new Set(groundedTerms)

  if (claims.length > 0 && groundingEntries.length === 0) {
    violations.push({
      rule: 26,
      title: RULE_BY_NUMBER[26]!.title,
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

  /* ── Rule 7 — relevance to the declared domain ────────────────────────── */
  const subject = `${topic} ${caption}`.toLowerCase()
  const domainHits = BRAND_TOPICS.filter((t) => subject.includes(t))
  if (domainHits.length === 0) {
    violations.push({
      rule: 7,
      title: RULE_BY_NUMBER[7]!.title,
      detail: `Neither the topic "${topic}" nor the caption touches a declared Ethara domain term. A generic AI connection is not relevance.`,
      required_action:
        'Reframe onto a declared domain — reinforcement learning, agentic AI, evaluation, benchmarks, post-training or AI environments — or drop the topic.',
      mechanical: false,
    })
    raise('REVISE')
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

  /*
   * Rule 5's second half. Promotional punctuation is the register tell that
   * survives every vocabulary substitution: an exclamation mark, a shouted
   * word, or a trailing ellipsis-as-teaser reads as marketing however plain
   * the words around it are.
   */
  const punctuationHits: string[] = []
  if (/!/.test(caption)) punctuationHits.push('exclamation mark')
  if (/\b[A-Z]{4,}\b/.test(caption.replace(/\b(?:RLHF|LLM|LLMS|GPU|GPUS|API|APIS|AI|ML|RL|SOTA|MLOPS|CTO|CEO)\b/g, '')))
    punctuationHits.push('shouted capitals')
  if (/(?:\.\.\.|…)\s*$/.test(caption.trim())) punctuationHits.push('teaser ellipsis')

  /*
   * Rule 4. A forced connection is a brand mention wearing promotional framing;
   * a natural one reports what the lab found. The test is the framing around
   * the mention, not the mention itself, because rule 4 permits the connection
   * whenever it follows from the subject.
   */
  const promotionalFraming =
    /\b(?:at|here at)\s+ethara(?:\.ai)?\s*,?\s*we(?:'re| are)?\s+(?:building|helping|empowering|enabling|transforming|revolutioni[sz]ing)\b/i
  const forcedConnection = promotionalFraming.test(caption)
  if (forcedConnection) {
    violations.push({
      rule: 4,
      title: RULE_BY_NUMBER[4]!.title,
      detail:
        'The Ethara connection is framed as promotion ("at Ethara we are building…") rather than following from the evidence.',
      required_action:
        'State what the work found and let the connection follow, or omit the connection — rule 8 allows it to be dropped.',
      mechanical: false,
    })
    raise('REVISE')
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
  if (punctuationHits.length > 0) {
    violations.push({
      rule: 5,
      title: RULE_BY_NUMBER[5]!.title,
      detail: `Promotional punctuation present: ${punctuationHits.join(', ')}.`,
      required_action: 'Remove it. Research communication carries its weight in the claim, not the punctuation.',
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

  /* ── Structure · rule 8, with rule 9 on hook integrity ───────────────── */
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
      rule: 8,
      title: RULE_BY_NUMBER[8]!.title,
      detail: `The hook runs to ${hookWords} words; the limit is ${BRAND.hookMaxWords}.`,
      required_action: `Cut the first line to ${BRAND.hookMaxWords} words or fewer.`,
      mechanical: false,
    })
    raise('REVISE')
  }
  if (!depthOk) {
    violations.push({
      rule: 8,
      title: RULE_BY_NUMBER[8]!.title,
      detail: `Only ${paragraphs.length} paragraph(s) for ${platform}; the nine-stage structure needs at least three.`,
      required_action: 'Expand toward Hook → Context → Problem → Reframe → Mechanism → Evidence.',
      mechanical: false,
    })
    raise('REVISE')
  }

  /* ── Rule 9 — hook integrity ──────────────────────────────────────────── */
  /*
   * The hook is where exaggeration pays off, so it is checked against the
   * evidence separately from the body. Two tells: a figure that appears in the
   * opening but nowhere in the grounding, and an absolute claim the evidence
   * cannot carry. Both are reported rather than corrected — inventing a
   * weaker hook would be exactly the silent rewrite rule 20 forbids.
   */
  const hookClaims = numericClaims(firstLine)
  const ungroundedHookClaims =
    groundingEntries.length > 0
      ? hookClaims.filter((c) => {
          const figure = c.replace(/[^\d.,]/g, '')
          return figure.length > 0 && !groundingEntries.some((e) => `${e.title} ${e.content}`.includes(figure))
        })
      : []
  const absoluteClaim = /\b(?:every|all|never|always|nobody|no one|guaranteed|proves|proof that)\b/i.exec(firstLine)

  if (ungroundedHookClaims.length > 0) {
    violations.push({
      rule: 9,
      title: RULE_BY_NUMBER[9]!.title,
      detail: `The hook leads on ${ungroundedHookClaims.join(', ')}, which does not appear in the ${groundingEntries.length} grounding entry/entries behind this post.`,
      required_action: 'Lead on a figure the evidence carries, or attach the source that carries this one.',
      mechanical: false,
    })
    raise('CANNOT_VERIFY')
  }
  if (absoluteClaim && groundingEntries.length === 0) {
    violations.push({
      rule: 9,
      title: RULE_BY_NUMBER[9]!.title,
      detail: `The hook makes an absolute claim ("${absoluteClaim[0]}") with no evidence attached.`,
      required_action: 'Qualify the hook to what the evidence supports, or attach the evidence.',
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

  /* ── Visual · invariants 22 and 23 ───────────────────────────────────── */
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
      rule: 22,
      title: RULE_BY_NUMBER[22]!.title,
      detail: `Canvas ${visualCanvas} does not match ${platform} (${expectedCanvas}).`,
      required_action: `Re-render on ${expectedCanvas}.`,
      mechanical: true,
    })
    raise('REVISE')
  }
  if (!altOk) {
    violations.push({
      rule: 23,
      title: RULE_BY_NUMBER[23]!.title,
      detail: 'The creative has no alt text, so it cannot be published.',
      required_action: 'Generate alt text describing the content.',
      mechanical: true,
    })
    raise('REVISE')
  }

  /* ── Caption ↔ visual · rule 16, judged after each side alone (rule 19) ─ */
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
        rule: 16,
        title: RULE_BY_NUMBER[16]!.title,
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

  /* ── Rule 17 — option distinctness against what already shipped ───────── */
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
      rule: 17,
      title: RULE_BY_NUMBER[17]!.title,
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
    // Rule 19: when a creative is attached it was judged on its own before the
    // consistency check, so the reason says so rather than implying one pass.
    reason =
      `Clean against all ${BRAND_RULES.length} brand rules: relevant to ${domainHits.slice(0, 2).join(' and ') || 'the declared domain'}, ` +
      `${tags.length} topical hashtags, no hype vocabulary, ${groundingEntries.length} grounding entry/entries, hook at ${hookWords} words` +
      (visualHeadline ? ', and the creative passed independently before the caption↔visual check.' : '.')
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

/* ═══════════════════════════════════════════════════════════════════════════
   THE BRAND CORPUS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The brand as DOMAIN KNOWLEDGE, distinct from the brand as RULES.
 *
 * Why both exist and why they must not be mixed: the twenty rules describe how
 * to write. This corpus describes what we know and talk about. The Scraping
 * Agent scores a captured page against the live Knowledge Base, so seeding only
 * the rules would teach it that words like "vocabulary", "hashtag" and
 * "punctuation" are on-brand subject matter — which is how a compliance
 * document ends up deciding what counts as a relevant article.
 *
 * Each entry therefore carries domain-bearing `tags` and `keyPoints`. The tags
 * are what alignment scoring reads; the key points are what rule 6 means by a
 * Knowledge Base key point, so a caption can trace a claim to one.
 */
export interface BrandCorpusEntry {
  title: string
  category: string
  content: string
  /** Vocabulary for this entry. Lower-cased, and matched literally. */
  tags: string[]
  /** Rule 6 evidence. A caption may cite one of these as its grounding. */
  keyPoints: string[]
  confidence: 'High' | 'Medium' | 'Low'
  /**
   * Whether this entry is SUBJECT MATTER, and therefore whether its vocabulary
   * may decide that a captured page is on topic.
   *
   * True for the domains the lab works in. False for entries that describe the
   * brand itself — voice, audience, visual identity — because "typography" and
   * "declarative" are facts about how we publish, not subjects we publish about.
   * An article about typography is not an AI research article, and letting the
   * identity entries vote on relevance is how it would come to look like one.
   *
   * Both kinds stay in the Knowledge Base and both remain available as grounding.
   * Only the domain half reaches the Scraping Agent's alignment scoring.
   */
  domain: boolean
}

export const BRAND_CORPUS: BrandCorpusEntry[] = [
  {
    title: 'Ethara.AI positioning · a frontier AI research lab',
    category: 'Brand Corpus',
    content:
      'Ethara.AI communicates as a frontier AI research lab reporting findings, not as a startup pitching a product. Published work is expected to read as research communication: a claim, the mechanism behind it, and the evidence that supports it.',
    tags: ['positioning', 'frontier ai', 'research lab', 'frontier model', 'ai research'],
    keyPoints: [
      'Ethara.AI is positioned as a frontier AI research lab, not a product company.',
      'A promotional register is a positioning failure, not a matter of taste.',
    ],
    confidence: 'High',
    domain: false,
  },
  {
    title: 'Domain · reinforcement learning and reward modelling',
    category: 'Brand Corpus',
    content:
      'Reinforcement learning, RLHF and reward modelling are core Ethara domains. Work here covers policy optimisation, preference data, reward-model drift and the failure modes that appear when a reward signal is optimised past the point it measures anything useful.',
    tags: [
      'reinforcement learning',
      'rlhf',
      'reward model',
      'reward modeling',
      'policy optimization',
      'preference data',
    ],
    keyPoints: [
      'Reinforcement learning, RLHF and reward modelling are core Ethara domains.',
      'Reward-model drift is a named area of interest, not a peripheral topic.',
    ],
    confidence: 'High',
    domain: true,
  },
  {
    title: 'Domain · post-training and alignment',
    category: 'Brand Corpus',
    content:
      'Post-training covers instruction tuning, preference optimisation and alignment work applied after pre-training. Ethara treats post-training as where most deployed capability is actually decided.',
    tags: ['post-training', 'alignment', 'instruction tuning', 'fine-tuning', 'preference optimization'],
    keyPoints: [
      'Post-training and alignment are core Ethara domains.',
      'Ethara treats post-training as the stage where deployed capability is largely determined.',
    ],
    confidence: 'High',
    domain: true,
  },
  {
    title: 'Domain · agentic AI and multi-agent orchestration',
    category: 'Brand Corpus',
    content:
      'Agentic AI covers tool-using agents, long-horizon task execution, multi-agent orchestration and the reliability questions that only appear once an agent runs unattended across many steps.',
    tags: ['agentic ai', 'ai agents', 'multi-agent', 'agent orchestration', 'tool use', 'long horizon'],
    keyPoints: [
      'Agentic AI and multi-agent orchestration are core Ethara domains.',
      'Agent reliability over long horizons is a named area of interest.',
    ],
    confidence: 'High',
    domain: true,
  },
  {
    title: 'Domain · evaluation, benchmarks and AI environments',
    category: 'Brand Corpus',
    content:
      'Evaluation covers benchmarks, evaluation harnesses and the AI environments agents are measured in. Ethara holds that an aggregate score can hide diverging failure modes, which is why environment design and per-failure analysis matter as much as the headline number.',
    tags: [
      'evaluation',
      'eval',
      'benchmark',
      'benchmarks',
      'evaluation harness',
      'ai environments',
      'environment',
    ],
    keyPoints: [
      'Evaluation, benchmarks and AI environments are core Ethara domains.',
      'An aggregate benchmark score can hide diverging failure modes between systems.',
    ],
    confidence: 'High',
    domain: true,
  },
  {
    title: 'Domain · synthetic data generation',
    category: 'Brand Corpus',
    content:
      'Synthetic data generation covers dataset construction, coverage of rare cases and the contamination risks that follow when generated data re-enters training.',
    tags: ['synthetic data', 'data generation', 'dataset', 'data coverage', 'contamination'],
    keyPoints: [
      'Synthetic data generation is a core Ethara domain.',
      'Contamination risk is treated as a first-order concern in synthetic data work.',
    ],
    confidence: 'High',
    domain: true,
  },
  {
    title: 'Domain · inference economics and AI infrastructure',
    category: 'Brand Corpus',
    content:
      'Inference and serving economics cover latency, throughput and cost per solved task. "Infrastructure" is deliberately part of Ethara\u2019s own vocabulary here and is never treated as hype language.',
    tags: ['inference', 'serving', 'latency', 'throughput', 'cost per task', 'ai infrastructure'],
    keyPoints: [
      'Inference and serving economics are an Ethara domain, measured as cost per solved task.',
      '"Infrastructure" is approved Ethara vocabulary and is not forbidden language.',
    ],
    confidence: 'High',
    domain: true,
  },
  {
    title: 'Voice · research-credible, anti-hype, declarative',
    category: 'Brand Voice',
    content:
      'The voice is research-credible, anti-hype, confident, declarative and written in plain natural English. Precise claims and clear explanations are preferred over promotional framing, and content should set out the trends that actually matter now.',
    tags: ['voice', 'anti-hype', 'declarative', 'plain english', 'research credible'],
    keyPoints: [
      'The approved voice is research-credible, anti-hype, confident, declarative and plain.',
      'Precise claims are preferred over promotional framing.',
    ],
    confidence: 'High',
    domain: false,
  },
  {
    title: 'Audience · researchers, ML engineers, heads of AI and CTOs',
    category: 'Brand Corpus',
    content:
      'The audience is AI researchers, ML engineers, heads of AI and CTOs evaluating frontier capability. They distrust promotional framing and read for mechanism and evidence.',
    tags: ['audience', 'researchers', 'ml engineers', 'cto', 'head of ai'],
    keyPoints: [
      'The audience is researchers, ML engineers, heads of AI and CTOs evaluating frontier capability.',
      'This audience distrusts promotional framing.',
    ],
    confidence: 'High',
    domain: false,
  },
  {
    title: 'Visual identity · Ethara purple, Roboto and DM Sans',
    category: 'Visual Identity',
    content:
      'Creatives use the Ethara Purple family with primary accent #8B2CF5, Roboto for display and headline treatment, and DM Sans for body and supporting text. Visuals communicate the underlying research rather than decorating the post with stock technology imagery.',
    tags: ['visual identity', 'palette', 'typography', 'ethara purple', 'creative'],
    keyPoints: [
      'The primary brand accent is #8B2CF5, within the Ethara Purple family.',
      'Roboto is the display typeface and DM Sans is the body typeface.',
    ],
    confidence: 'High',
    domain: false,
  },
]

/**
 * The tag every brand RULE entry carries, so consumers that want domain
 * vocabulary (the Scraping Agent above all) can exclude the compliance
 * documents without having to pattern-match their titles.
 */
export const BRAND_RULE_TAG = 'brand-rule'

/** The tag every brand CORPUS entry carries. */
export const BRAND_CORPUS_TAG = 'brand-corpus'

/**
 * Carried only by corpus entries that are SUBJECT MATTER. This is the tag the
 * Scraping Agent's alignment vocabulary is built from, so an entry describing
 * the brand rather than the field cannot decide what counts as relevant.
 */
export const BRAND_DOMAIN_TAG = 'brand-domain'

export interface BrandKnowledgeSeed {
  title: string
  category: string
  content: string
  confidence: 'High' | 'Medium' | 'Low'
  tags: string[]
}

/**
 * The brand rules as Knowledge Base rows, seeded with `origin='brand'`.
 * Invariants are included: an operator reading the Knowledge Base should be
 * able to find every numbered thing the checker can cite.
 */
export function brandRulesAsKnowledge(): BrandKnowledgeSeed[] {
  return ALL_RULES.map((r) => ({
    title: `Rule ${r.n} · ${r.title}`,
    category:
      r.area === 'Visual'
        ? 'Visual Identity'
        : r.area === 'Candidate & Risk' || r.area === 'Platform Invariant'
          ? 'Compliance Rule'
          : r.area === 'Factual & Content'
            ? 'Brand Guideline'
            : 'Brand Voice',
    content: `${r.text} (Enforcement: ${r.enforcement}.)`,
    confidence: 'High' as const,
    tags: ['brand', BRAND_RULE_TAG, `rule-${r.n}`],
  }))
}

/**
 * The brand corpus as Knowledge Base rows. Key points are written into the body
 * under a labelled heading so rule 6 has something concrete to trace a claim
 * to, and so an operator can read what the agents are grounding on.
 */
export function brandCorpusAsKnowledge(): BrandKnowledgeSeed[] {
  return BRAND_CORPUS.map((entry) => ({
    title: entry.title,
    category: entry.category,
    content:
      `${entry.content}\n\nKey points:\n` +
      entry.keyPoints.map((point) => `- ${point}`).join('\n'),
    confidence: entry.confidence,
    tags: [
      'brand',
      BRAND_CORPUS_TAG,
      ...(entry.domain ? [BRAND_DOMAIN_TAG] : []),
      ...entry.tags,
    ],
  }))
}

/* ═══════════════════════════════════════════════════════════════════════════
   PER-PLATFORM VOICE

   The same finding is not the same post on four channels. This is the declared
   difference, in one place, so the caption writer, the review rewriter and the
   Python content agent all shape copy the same way — and so changing a post's
   platform in the review panel visibly changes the copy rather than returning
   near-identical text with a different label.

   Kept as guidance rather than thresholds on purpose: the numeric limits that
   must be enforced are already ConfigFields the operator can see. This is the
   register, the structure and the reason for each.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PlatformVoice {
  /** How the post should read. */
  register: string
  /** The shape it should take. */
  structure: string
  /** What earns attention on this channel specifically. */
  opens: string
  /** What actively fails here. */
  avoid: string
}

export const PLATFORM_VOICE: Record<Platform, PlatformVoice> = {
  linkedin: {
    register: 'Peer-to-peer and specific. Written for a practitioner who will recognise a shortcut.',
    structure:
      'A claim, then the mechanism in short paragraphs, then the implication. Line breaks between every beat — a wall of text is not read.',
    opens: 'A correction of something conventional practice gets wrong.',
    avoid: 'Engagement bait, a question as the opening line, and any call to follow.',
  },
  instagram: {
    register: 'Plainer and shorter. The image carries the argument; the caption anchors it.',
    structure:
      'One or two sentences that state what the visual shows, then the single takeaway. No multi-paragraph exposition.',
    opens: 'The concrete thing in the picture, named.',
    avoid: 'Long reasoning chains, and text that only makes sense if the reader zooms into the creative.',
  },
  x: {
    register: 'Compressed and declarative. One idea, no preamble.',
    structure:
      'A single claim that stands alone. If it needs a second sentence, the second sentence is the evidence and nothing else.',
    opens: 'The claim itself, first word.',
    avoid: 'Threads implied but not written, hedging clauses, and hashtags beyond one.',
  },
  facebook: {
    register: 'Explanatory and unhurried. Assume less shared vocabulary than LinkedIn.',
    structure:
      'Say what happened, then why it matters, in complete sentences. Define the term the first time it appears.',
    opens: 'The plain-language consequence, before the terminology.',
    avoid: 'Unexplained jargon, and the assumption that the reader already follows the field.',
  },
}

/** The per-platform voice as prompt lines. One renderer, so it cannot drift. */
export function platformVoiceInstruction(platform: Platform): string {
  const voice = PLATFORM_VOICE[platform]
  return [
    `Writing for ${platform}. This platform is not interchangeable with the others:`,
    `· Register: ${voice.register}`,
    `· Structure: ${voice.structure}`,
    `· Open on: ${voice.opens}`,
    `· Never: ${voice.avoid}`,
  ].join('\n')
}

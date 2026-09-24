/**
 * The context the bridge reasons from — read from the SMA, never hardcoded.
 *
 * Regular expressions are carried as `{ source, flags }` so the same shapes
 * load from `shared/brand-voice.ts` (project mode) and from JSON fixtures
 * (sample mode) without a second code path.
 */

export interface KeywordEntry {
  term: string
  /** 0–100, as configured in the SMA. */
  weight: number
  category: string
  synonyms: string[]
  /** Whether the SMA's weekly rota schedules it now. */
  scheduled: 'constant' | 'this_week' | null
}

export interface KeywordSet {
  /** Where the set came from, e.g. `database:keywords` or `seed:shared/keywords.ts`. */
  source: string
  keywords: KeywordEntry[]
}

export interface KnowledgeEntry {
  id: string
  title: string
  category: string
  content: string
  tags: string[]
}

export interface KnowledgeBase {
  source: string
  entries: KnowledgeEntry[]
}

export interface SerializedPattern {
  source: string
  flags: string
  why: string
}

export interface BrandVoice {
  sources: string[]
  name: string | null
  positioning: string | null
  audience: string | null
  voice_words: string[]
  domains: string[]
  /** Vocabulary of the brand's subject area; a match is topical relevance. */
  topics: string[]
  /** Reach-bait hashtags the brand excludes (lower-case, no `#`). */
  generic_hashtags: string[]
  /** Language the brand voice rejects as hype or pitch. */
  hype_patterns: SerializedPattern[]
  /** Subjects that need a human's judgement (funding, customers, legal…). */
  restrictions: Array<{ id: string; label: string; source: string; flags: string }>
  /** Titles of the brand-voice and guideline entries in the Knowledge Base. */
  guidelines: string[]
  /** Subjects to leave out entirely. */
  excluded_terms: string[]
}

export interface BridgeContext {
  knowledgeBase: KnowledgeBase
  brandVoice: BrandVoice
  keywords: KeywordSet
}

/** Raised when a required piece of context cannot be read. Reported as a configuration error. */
export class ContextError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ContextError'
  }
}

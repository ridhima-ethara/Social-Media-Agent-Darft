/**
 * THE PAYLOAD CONTRACT
 *
 * A pipeline run is one mutable accumulator threaded through ~92 skills. Each
 * skill reads the fields it needs and returns a patch; the runtime merges it.
 * These are the shapes those patches speak in.
 *
 * This module imports no handler, so it can be imported by every handler
 * without a cycle. `_register.ts` is where the handlers are actually loaded.
 */

import type { PlatformTrend } from '../../bridges/claude-bridge/trends/platform-trends'
import type { SocialMediaListener } from '../analysis/social-listener/types'
import type {
  Confidence,
  ContentFormat,
  HookPattern,
  Platform,
  ValidationVerdict,
} from '../../../../shared/agent-contract'
import type { ImageConcept, ImageModelId } from '../../../../shared/image-models'
import type { BrandCheck } from '../../../../shared/brand-voice'
import type { EditorialFormat } from '../corpus'

/* ═══════════════════════════════════════════════════════════════════════════
   DISCOVER
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResolvedKeyword {
  id: string
  term: string
  category: string
  weight: number
  /** Synonyms the query was expanded with, when expansion is on. */
  synonyms: string[]
}

export interface ScrapedPost {
  externalId: string
  text: string
  title: string
  snippet: string
  authorName: string
  authorHeadline: string
  authorFollowers: number
  url: string
  postedAt: string
  reactions: number
  comments: number
  reposts: number
  hashtags: string[]
  /** The keyword whose query surfaced this post. */
  keyword: string
  keywordId: string | null
  sourceName: string
  sourceType: string
  /**
   * Which platform lane captured it — `null` for the open-web lane. Recorded
   * at capture rather than re-derived from the URL downstream.
   */
  platform: Platform | null
  /**
   * Whether the source stated engagement figures. False for everything a
   * search-indexed crawl returns, which is what makes the three count fields
   * readable as "not applicable" rather than as zero (constraint 2).
   */
  metricsAvailable: boolean
  /**
   * Plays, and whether the lane stated any. A THIRD state, deliberately not
   * folded into `metricsAvailable` — see `capture.ts` and ADR-009. Every
   * view-derived figure runs over `viewsAvailable` rows only.
   */
  views: number
  viewsAvailable: boolean
  /** The post's own opening line — what a reader decides on. */
  hook: string
  /**
   * (reactions + comments) / views, as a percentage, or `null`.
   *
   * `null` means NOT COMPUTABLE — the post stated one of the two figures and
   * not the other. It never means zero, which would be the much stronger claim
   * that the post was seen and ignored.
   */
  engagementRate: number | null
  /** reel | short | video | post | article. */
  mediaFormat: string
  /**
   * The spoken words of a captured video, or `null` for "not transcribed".
   *
   * `null` and `''` are different facts and stay different all the way to the
   * column: `''` would mean the transcriber ran and heard nothing. Filled by
   * `scraping.transcript.fetch`; stays `null` when the Whisper sidecar is not
   * configured, which is a supported configuration (ADR-011).
   *
   * UNTRUSTED. It goes through `prepareEvidence()` before any model sees it.
   */
  transcript: string | null
  transcriptSource: string | null
  transcriptConfidence: number | null
  /**
   * Flags raised by `validation.item.filter` — `high-signal-views`, `viral-er`.
   * A flag is an observation with a stated threshold behind it, never a verdict.
   */
  signalFlags: string[]
  /**
   * 0–100. How well the body aligns with the brand topic set and the live
   * Knowledge Base, scored at capture by `scraping.linkedin.fetch`. Anything
   * below the run's floor never became a record at all.
   */
  brandRelevance: number
  /** Which brand topics the body actually touched — the evidence for the score. */
  alignedTopics: string[]
  /** How many Knowledge Base terms it echoed. */
  knowledgeHits: number
  /** Filled by `scraping.engagement.capture`. */
  engagement: number
  engagementScore: number
  velocity: number
  /**
   * Which implementation produced it. Always `'live'` now that crawl4ai is the
   * only source; `'fixture'` survives as a persisted storage value on
   * `scraped_items` for rows written before that was true.
   */
  captureSource: 'live' | 'fixture'
  fallbackReason?: string
  /* Scored by the Validation Agent. */
  relevance: number
  credibility: Confidence
  credibilityScore: number
  freshness: number
  isDuplicate: boolean
  duplicateOfExternalId: string | null
  /**
   * Set when this item matches something rejected on a previous run. It routes
   * straight to `rejected` with the original reason, ahead of the duplicate
   * check — a decision a human already made is not re-litigated. `null` means
   * no prior rejection matched.
   */
  priorRejection: { reason: string; title: string; when: string } | null
  validation: ValidationVerdict
  verdictReason: string
}

export interface HashtagCandidate {
  tag: string
  displayTag: string
  keyword: string
  keywordId: string | null
  postCount: number
  totalEngagement: number
  engagementPerPost: number
  /** Mean brand alignment of the pages carrying the tag, 0–100. */
  brandRelevance: number
  /** Which lanes surfaced it — `'open-web'` for the unscoped tier. */
  platforms: string[]
  firstSeenAt: string
  lastSeenAt: string
  /** Every keyword whose query surfaced this tag. */
  surfacedBy: string[]
  /** The tag's own LinkedIn feed — a URL the operator can open. */
  feedUrl: string
  /** The strongest post that carried it, by engagement. */
  topPostUrl: string | null
  topPostTitle: string | null
  /** Set by `scraping.hashtag.expand` when the tag was read independently. */
  independentPostCount?: number
  independentEngagement?: number
  expandedSource?: 'live' | 'fixture'
  /* Scored by the Validation Agent. */
  relevance: number
  credibility: Confidence
  credibilityScore: number
  freshness: number
  hashtagScore: number
  rank: number | null
  validation: ValidationVerdict
  verdictReason: string
  duplicateOfTag: string | null
  inTopSet: boolean
}

/**
 * A term the corpus surfaced that is not in the keyword set (ADR-012).
 *
 * Every count here travels with the number of rows it was measured over, so the
 * emergence score can divide by what was actually measured rather than by the
 * post count. A candidate surfaced entirely by open-web captures has
 * `measuredPosts: 0`, and its engagement is absent rather than zero.
 */
export interface KeywordCandidate {
  term: string
  /** Distinct captured posts carrying it. A repeat inside one post is not two. */
  posts: number
  /** Distinct authors. Unattributed posts count as one shared unknown. */
  distinctAuthors: number
  totalEngagement: number
  measuredPosts: number
  totalViews: number
  viewedPosts: number
  /** Mean brand alignment of the posts carrying it, 0-100. */
  brandRelevance: number
  /** Up to three URLs, so the candidate can be checked rather than trusted. */
  examples: string[]
  /* Written by `validation.keyword.emerge`. */
  emergenceScore?: number
  emergenceReason?: string
  stored?: boolean
  activated?: boolean
}

export interface CompetitorPostRecord {
  competitor: string
  text: string
  format: string
  engagementIndex: number
  postedAt: string
  topics: string[]
  tier: string
}

export interface SourceConnection {
  name: string
  kind: string
  sourceType: string
  reachable: boolean
  reason: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASSESS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface KeywordTrend {
  keywordId: string
  term: string
  postCount: number
  totalEngagement: number
  /**
   * How many of this keyword's posts stated an engagement figure.
   *
   * Zero means the total is N/A, not nil. Travels beside `totalEngagement`
   * rather than being inferred from it, because `0` is a legitimate measured
   * total and indistinguishable from an unmeasured one otherwise.
   */
  measuredCount: number
  avgEngagement: number
  velocity: number
  growthPct: number
  volumeScore: number
  engagementScore: number
  velocityScore: number
  growthScore: number
  trendScore: number
  rank: number
  isTrending: boolean
  trendReason: string
  priorRuns: number
  /**
   * "This has come up N times." Set by `validation.signal.repeat` from stored
   * `keyword_signals` rows, never inferred from this run alone.
   */
  isRepeatSignal?: boolean
  repeatCount?: number
  /**
   * "This held its rank." A DIFFERENT claim from the one above — recurrence is
   * not continuity — which is why two skills write two fields.
   */
  isSustainedSignal?: boolean
  sustainedRuns?: number
  /** LinkedIn content search for the term — a URL the operator can open. */
  searchUrl: string
  /** The strongest post for the keyword this run, by engagement. */
  topPostUrl: string | null
  topPostTitle: string | null
}

export interface RankedHashtagGroup {
  keywordId: string
  term: string
  keywordRank: number
  hashtags: HashtagCandidate[]
}

export interface BucketCounts {
  validated: number
  needs_review: number
  duplicate: number
  rejected: number
}

export interface ReviewRequest {
  kind: 'scraped_item' | 'hashtag' | 'knowledge_conflict'
  /** The externalId or tag, resolved to a row id when persisted. */
  reference: string
  title: string
  reason: string
  decisionRequested: string
  options: string[]
}

export interface Opportunity {
  id: string
  title: string
  description: string
  sourceTopic: string
  sourceExternalId: string | null
  hashtag: string | null
  members: number
  trendScore: number
  brandRelevance: number
  /**
   * The MEAN measured brand relevance of the cluster's own pages, 0–100.
   *
   * Scored at capture against the brand topic set and the live Knowledge Base,
   * so it is evidence rather than a re-derivation. Carried here because
   * `analysis.brand.fit` runs after the cluster has been reduced to a single
   * opportunity and can no longer see the members it came from.
   */
  capturedRelevance: number
  predictedEngagement: number
  engagementLevel: string
  format: EditorialFormat
  angle: string
  audience: string
  saturation: number
  saturationNote: string
  reason: string
  isNewTrend: boolean
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLAN
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PlannedIdea {
  /** Stable within a run; the database assigns the real id on persist. */
  key: string
  title: string
  description: string
  sourceTopic: string
  sourceExternalId: string | null
  hashtag: string | null
  platform: Platform
  altPlatforms: Array<{ platform: Platform; score: number }>
  scheduledDate: string
  scheduledTime: string
  confidence: number
  priorityScore: number
  platformRank: number | null
  /** Every placed idea is a dated calendar topic; an unplaced one is dropped, never kept aside. */
  calendarSlot: 'primary'
  isNewTrend: boolean
  format: EditorialFormat
  angle: string
  audience: string
  brandRelevance: number
  trendScore: number
  slotReasons: string[]
  conflicts: string[]
  /** A cross-platform variant points back at the idea it was adapted from. */
  variantOf?: string
  /**
   * The Meta twin this entry shares ONE post with — Facebook ↔ Instagram. The
   * second of the two to be written reuses the first one's caption.
   */
  sharesPostWith?: Platform
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE — CAPTION
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GroundingEntry {
  id: string
  title: string
  content: string
  confidence: Confidence
  category: string
  sources: Array<{ title: string; url: string; publishedAt?: string }>
}

export interface CaptionPayload extends Record<string, unknown> {
  ideaId: string
  platform: Platform
  title: string
  description: string
  sourceTopic: string
  hashtag: string | null
  angle: string
  audience: string
  format: string
  /* Produced along the way. */
  writingMode?: string
  /**
   * The argumentative shape of the post, resolved before the hook is written.
   * Separate from `writingMode`: the stance decides what the post argues, the
   * mode decides how plainly it is expressed. See the caption-writing skill.
   */
  stance?: 'default' | 'how-ethara-thinks' | 'problem-solution-trajectory'
  /**
   * Why the resolved stance is not the one that was asked for — set only when a
   * stance degraded for want of grounding, never when it was honoured.
   */
  stanceDegradedReason?: string
  grounding?: GroundingEntry[]
  voiceInstruction?: string
  hook?: string
  problem?: string
  explanation?: string
  close?: string
  /**
   * The "At Ethara AI, …" line: what the lab works on and how it thinks about
   * this post's subject, drawn from one Brand Corpus domain entry. Sits between
   * the explanation and the close.
   */
  etharaLine?: string
  /** Set when the hook step wrote the whole post in one pass; later steps keep its parts. */
  wholePost?: boolean
  /** The one insight the whole post argues, identified before its hook (rule 1). */
  centralClaim?: string
  /** The Brand Corpus entry the Ethara line rests on. */
  etharaEntryId?: string
  hashtagBlock?: string
  /** Instagram only: the bracketed 7–8 keyword footer. */
  keywordBlock?: string
  captionBody?: string
  caption?: string
  variants?: string[]
  citation?: string
  captionSource?: 'live' | 'fixture'
  captionModel?: string
  captionFallbackReason?: string
  brandNotes?: string[]

  /* ── The short-form branch (ADR-007) ──────────────────────────────────────
   * Present on the same payload rather than a second one: the two paths share
   * grounding retrieval, and splitting the type would mean two retrievals or a
   * cast between them.
   */
  contentFormat?: ContentFormat
  /** `null` with a reason when the sample floor was not met. Never a stub. */
  voiceProfile?: VoiceProfileShape | null
  voiceProfileReason?: string | null
  voiceProfileId?: string | null
  script?: string
  scriptSource?: 'live' | 'fixture'
  scriptModel?: string
  scriptFallbackReason?: string
  hooks?: Array<{ pattern: HookPattern; body: string; rank: number }>
  /** Written by `caption.hook.score`. A null confidence is a real outcome. */
  scoredHooks?: ScoredHook[]
  hookSource?: 'live' | 'fixture'
  hookModel?: string
  hookFallbackReason?: string
  /** Patterns that were not written, each with the reason. */
  hookNotes?: string[]
}

/** What a derived voice profile looks like once it has crossed the payload. */
export interface VoiceProfileShape {
  id: string
  name: string
  content_format: ContentFormat
  sample_count: number
  derived_at: string
}

/**
 * A hook with its evidence, or with the stated absence of any.
 *
 * `confidence: null` is a FIRST-CLASS OUTCOME, not a missing value — it means
 * no stored post resembled this hook closely enough to say anything about it.
 * `confidenceBasis` is always present and always names either the evidence or
 * its absence, which is what stops a score being a bare assertion.
 */
export interface ScoredHook {
  pattern: HookPattern
  body: string
  rank: number
  confidence: number | null
  confidenceBasis: string
  matchedPostId: string | null
  matchedItemId: string | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE — IMAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ImagePayload extends Record<string, unknown> {
  ideaId: string
  platform: Platform
  title: string
  caption: string
  sourceTopic: string
  /** Produced along the way. */
  concept?: ImageConcept
  references?: string[]
  /** Licensed by `agents/image/annotations.ts`; drawn as vectors, never prompted. */
  annotations?: Array<{ label: string; citation: string; reason: string }>
  labelCitations?: Array<{ label: string; citation: string }>
  unsupportedLabels?: string[]
  showHeadline?: boolean
  layout?: string
  headline?: string
  kicker?: string
  footer?: string
  backgroundPrompt?: string
  width?: number
  height?: number
  canvas?: string
  paletteRole?: string
  accentIntensity?: number
  showLogomark?: boolean
  safeMargin?: number
  dataUri?: string
  model?: ImageModelId
  renderMode?: 'demo' | 'live'
  fallbackReason?: string | null
  altText?: string
  visualFindings?: string[]
  variants?: string[]
  videoBrief?: { durationSeconds: number; shots: string[] } | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   CREATE — REVIEW
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ReviewPayload extends Record<string, unknown> {
  ideaId: string
  platform: Platform
  title: string
  sourceTopic: string
  body: string
  instruction?: string
  altText?: string
  hasImage?: boolean
  imageHeadline?: string
  /** The caption model the operator chose in the review panel, if any. */
  captionModel?: string
  /** Files the operator attached for the model to work from. */
  /**
   * Files the operator attached.
   *
   * `image` carries the actual bytes as a `data:` URI, and is the difference
   * between a model being TOLD an image exists and being able to see it. It is
   * present only for image attachments, and only survives to a model that can
   * accept image parts — a text-only writer still receives the name and a note
   * saying it could not be read, exactly as before.
   */
  references?: Array<{
    name: string
    mimeType: string
    text?: string
    note?: string
    image?: string
  }>
  /** Produced along the way. */
  revisedBody?: string
  appliedNote?: string
  conflictNotes?: string[]
  compliance?: BrandCheck
  preference?: { title: string; content: string; category: string } | null
  diffSummary?: string
  revisionSource?: 'live' | 'fixture'
  revisionModel?: string
  /** False when the revised body came back identical — a no-op, not a revision. */
  revisionApplied?: boolean
  /** Why the text model was not used, when it was not. */
  revisionFallbackReason?: string
  /**
   * One line per attachment saying whether the chosen model actually read it.
   *
   * The panel renders these on the chips. Without them "Attached by name only"
   * was the only label available, and it was shown whether the file was
   * unreadable or the model simply could not see pictures — two different
   * facts with two different fixes.
   */
  referenceNotes?: string[]
  /**
   * Whether the revision did what was asked — measured where measurable, and
   * stated as unverifiable where not. Distinct from `revisionApplied`, which
   * only reports that the text changed.
   */
  honoured?: {
    verdict: 'honoured' | 'not-honoured' | 'unverifiable'
    reason: string
    measured: string | null
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LEARN — KNOWLEDGE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResearchTarget {
  hashtagId: string | null
  tag: string
  displayTag: string
  rank: number
  lastResearchedAt: string | null
}

export interface RawResearch {
  hashtag: string
  hashtagId: string | null
  title: string
  content: string
  category: string
  citations: Array<{ title: string; url: string; publishedAt?: string }>
}

export interface CandidateEntry {
  hashtag: string
  hashtagId: string | null
  title: string
  content: string
  category: string
  confidence: Confidence
  sources: Array<{ title: string; url: string; publishedAt?: string }>
}

export interface KnowledgePayload extends Record<string, unknown> {
  buildId: string
  trigger: 'cron' | 'manual' | 'assistant'
  targets?: ResearchTarget[]
  raw?: RawResearch[]
  researchSource?: 'live' | 'fixture'
  researchFallbackReason?: string
  candidates?: CandidateEntry[]
  discarded?: Array<{ title: string; reason: string }>
  written?: Array<{ id: string; title: string; hashtag: string }>
  merged?: Array<{ id: string; title: string }>
  sourcesCited?: number
  conflicts?: Array<{ a: string; b: string; outcome: string }>
  escalations?: number
}

/* ═══════════════════════════════════════════════════════════════════════════
   SHIP
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PublishPayload extends Record<string, unknown> {
  ideaId: string
  platform: Platform
  title: string
  body: string
  altText: string
  mediaAssetId: string | null
  mediaDataUri: string | null
  publishMode: 'demo' | 'live'
  /** Produced along the way. */
  formatValid?: boolean
  formatFindings?: string[]
  mediaHandle?: string | null
  externalId?: string
  dispatchedAt?: string
  postId?: string
  receipt?: {
    externalId: string
    publishMode: 'demo' | 'live'
    publishedAt: string
    platform: Platform
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   LEARN — ANALYTICS AND LEARNING
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AnalyticsPayload extends Record<string, unknown> {
  postId?: string
  platform?: Platform
  month?: string
  ingested?: number
  reportedPeriods?: Array<{ platform: Platform; month: string; reported: boolean }>
  baselines?: Record<string, { avgReach: number; avgEngagementRate: number; stdev: number; samples: number }>
  sentiment?: { label: string; score: number; reason: string }
  comparison?: {
    platform: Platform
    month: string
    priorMonth: string
    changes: Array<{ metric: string; current: number; prior: number; deltaPct: number; material: boolean }>
    summary: string
  }
  explanation?: { summary: string; recommendation: string; postId: string }
  report?: Record<string, unknown>
  exports?: Array<{ format: string; filename: string; body: string }>
}

export interface LearningPayload extends Record<string, unknown> {
  patterns?: Array<{ signal: string; occurrences: number; evidence: string[]; category: string }>
  learned?: Array<{ id: string; title: string }>
  promoted?: Array<{ id: string; title: string; to: Confidence }>
  demoted?: Array<{ id: string; title: string; to: Confidence; deactivated: boolean }>
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE RUN PAYLOAD
   ═══════════════════════════════════════════════════════════════════════════ */

/** Everything a discovery run accumulates, from keyword resolution to ideas. */
export interface PipelinePayload extends Record<string, unknown> {
  runId: string
  runOffset: number
  keywordIds?: string[]
  keywords?: ResolvedKeyword[]
  mode?: 'live' | 'fixture'
  sources?: SourceConnection[]
  unreachable?: string[]
  posts?: ScrapedPost[]
  postsBeforeDedupe?: number
  /** Terms the corpus surfaced that nobody seeded (ADR-012). */
  keywordCandidates?: KeywordCandidate[]
  discoveredKeywords?: Array<{ id: string; term: string; score: number; active: boolean }>
  hashtagCandidates?: HashtagCandidate[]
  competitorPosts?: CompetitorPostRecord[]
  captureSource?: 'live' | 'fixture'
  captureFallbackReasons?: string[]
  /**
   * What the Claude Bridge found trending on each platform in the capture
   * window — topic, hashtags, post URLs, dates, authors, matched Ethara
   * keywords and a computed reason. Carried to the Validation Agent beside
   * `posts`, which holds the same posts in the capture contract.
   */
  platformTrends?: PlatformTrend[]
  /** The Analysis Agent's Social Media Listener report (SocialFetch + Claude). */
  socialMediaListener?: SocialMediaListener
  /** Set by the "Run listener" action: fetch fresh even when a recent report exists. */
  listenerForceRefresh?: boolean
  /** Competitor Intelligence: these competitors now (the tab's Run action); absent = the due ones, capped per pipeline run. */
  competitorIds?: string[]
  /** Competitor Intelligence: run even inside a pipeline, whatever the per-run cap. */
  competitorForce?: boolean
  /** Competitor Intelligence: override the depth knob for this run. */
  competitorDepth?: 'quick' | 'deep'
  trends?: KeywordTrend[]
  trendingKeywords?: KeywordTrend[]
  hashtagGroups?: RankedHashtagGroup[]
  buckets?: BucketCounts
  /** Hashtag verdicts, kept apart from item verdicts so neither count lies about the other. */
  hashtagBuckets?: BucketCounts
  reviewRequests?: ReviewRequest[]
  opportunities?: Opportunity[]
  topHashtags?: HashtagCandidate[]
  ideas?: PlannedIdea[]
  /** The platforms `calendar.platform.select` planned for this run. */
  platformsInPlay?: Platform[]
  weightWarning?: string
}

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

import type {
  Confidence,
  Platform,
  ValidationVerdict,
} from '../../../../shared/agent-contract'
import type { ImageConcept, ImageModelId } from '../../../../shared/image-models'
import type { BrandCheck } from '../../../../shared/brand-voice'
import type { ContentFormat } from '../corpus'

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
  predictedEngagement: number
  engagementLevel: string
  format: ContentFormat
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
  calendarSlot: 'primary' | 'suggestion'
  isNewTrend: boolean
  format: ContentFormat
  angle: string
  audience: string
  brandRelevance: number
  trendScore: number
  slotReasons: string[]
  conflicts: string[]
  /** A cross-platform variant points back at the idea it was adapted from. */
  variantOf?: string
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
  grounding?: GroundingEntry[]
  voiceInstruction?: string
  hook?: string
  problem?: string
  explanation?: string
  close?: string
  hashtagBlock?: string
  captionBody?: string
  caption?: string
  variants?: string[]
  citation?: string
  captionSource?: 'live' | 'fixture'
  captionModel?: string
  captionFallbackReason?: string
  brandNotes?: string[]
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
  /** Produced along the way. */
  revisedBody?: string
  appliedNote?: string
  conflictNotes?: string[]
  compliance?: BrandCheck
  preference?: { title: string; content: string; category: string } | null
  diffSummary?: string
  revisionSource?: 'live' | 'fixture'
  revisionModel?: string
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
  hashtagCandidates?: HashtagCandidate[]
  competitorPosts?: CompetitorPostRecord[]
  captureSource?: 'live' | 'fixture'
  captureFallbackReasons?: string[]
  trends?: KeywordTrend[]
  trendingKeywords?: KeywordTrend[]
  hashtagGroups?: RankedHashtagGroup[]
  buckets?: BucketCounts
  reviewRequests?: ReviewRequest[]
  opportunities?: Opportunity[]
  topHashtags?: HashtagCandidate[]
  ideas?: PlannedIdea[]
  weightWarning?: string
}

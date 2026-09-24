/**
 * SOCIAL MEDIA LISTENER — the shapes.
 *
 * Normalised records carry exactly what SocialFetch returned, with `null` for
 * anything it did not state (N/A is never 0). The output mirrors the Analysis
 * Agent's `social_media_listener` contract, snake_case, as specified.
 */

export const LISTENER_PLATFORMS = ['linkedin', 'instagram', 'facebook', 'x'] as const
export type ListenerPlatform = (typeof LISTENER_PLATFORMS)[number]

export const PLATFORM_NAME: Record<ListenerPlatform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  facebook: 'Facebook',
  x: 'X',
}

export type Sentiment = 'positive' | 'neutral' | 'negative'
export const FEEDBACK_KINDS = ['question', 'complaint', 'praise', 'suggestion', 'request', 'concern'] as const
export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]

/** What one platform call did — kept so every number is traceable to SocialFetch. */
export interface FetchLogEntry {
  platform: ListenerPlatform
  route: string
  status: 'found' | 'not_found' | 'private' | 'error' | 'skipped'
  credits: number
  reason: string | null
}

export interface ListenerAccount {
  platform: ListenerPlatform
  name: string | null
  handle: string | null
  url: string | null
  followers: number | null
  description: string | null
  /** The platform's own id for the account, when a later route needs it (LinkedIn's organisation id). */
  sourceId: string | null
}

export interface ListenerPost {
  platform: ListenerPlatform
  id: string
  url: string
  publishedAt: string | null
  text: string
  mediaType: string | null
  hashtags: string[]
  reactions: number | null
  comments: number | null
  shares: number | null
  views: number | null
  /** A repost of someone else's content, as the platform labels it. */
  isRepost: boolean
  /** The identifier the platform's comment route takes (activity id, URL…). */
  commentRef: string
}

export interface ListenerComment {
  platform: ListenerPlatform
  id: string
  postId: string
  text: string
  publishedAt: string | null
  likes: number | null
  author: string | null
}

/** Claude's reading of one comment — an analytical signal, not a fact. */
export interface CommentReading {
  sentiment: Sentiment
  kinds: FeedbackKind[]
  topic: string
}

export interface SentimentCounts {
  positive: number
  neutral: number
  negative: number
  /** Comments with text that could be classified. */
  classified: number
  positive_percent: number | null
  neutral_percent: number | null
  negative_percent: number | null
}

export interface AnalysedPost {
  platform: ListenerPlatform
  post_id: string
  post_url: string
  published_at: string | null
  text: string
  media_type: string | null
  hashtags: string[]
  reactions: number | null
  comments: number | null
  shares: number | null
  video_views: number | null
  /** reactions + comments + video views (when stated); null when reactions or comments are unstated. */
  total_engagement: number | null
  /** (reactions + comments) / followers × 100; null without a follower count. */
  engagement_rate: number | null
  is_repost: boolean
  topics: string[]
  rank_on_platform: number | null
  comments_analysed: number
  comment_sentiment: SentimentCounts | null
}

/** One comment as stored in the report: the audience's words, and Claude's reading of them. */
export interface AnalysedComment {
  post_id: string
  post_url: string
  text: string
  published_at: string | null
  likes: number | null
  /** Claude's reading — null when it could not be read. */
  sentiment: Sentiment | null
  kinds: FeedbackKind[]
  topic: string | null
}

export interface TopicStat {
  topic: string
  posts: number
  comments: number
  /** Summed total engagement of the posts carrying the topic (stated posts only). */
  engagement: number
  positive_comments: number
  negative_comments: number
}

export interface FeedbackItem {
  kind: FeedbackKind | 'topic'
  summary: string
  /** How many comments this rests on. */
  count: number
  post_urls: string[]
}

export interface PlatformListening {
  platform: ListenerPlatform
  label: string
  status: 'ok' | 'empty' | 'not_found' | 'not_configured' | 'error'
  reason: string | null
  account: ListenerAccount | null
  posts_analyzed: number
  comments_analyzed: number
  engagement: {
    total: number | null
    average_per_post: number | null
    average_rate: number | null
    posts_with_metrics: number
  }
  sentiment: SentimentCounts | null
  posts: AnalysedPost[]
  comments: AnalysedComment[]
  top_posts: AnalysedPost[]
  lowest_posts: AnalysedPost[]
  topics: TopicStat[]
  audience_feedback: FeedbackItem[]
  signals: string[]
  insights: string[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   GLASSDOOR — employer reviews and ratings, read through FetchLayer.

   A DIFFERENT KIND OF SIGNAL from the social channels above. Where the
   platform listening answers "what is the audience saying about our content",
   Glassdoor answers "what do people who worked here say about the company". It
   is attached to the same report because both are "what people are saying about
   Ethara.AI", but every figure is Glassdoor's own, read via FetchLayer, and an
   unstated figure is `null` — never a measured zero.
   ═══════════════════════════════════════════════════════════════════════════ */

/** One review theme (a recurring pro or con), counted from the reviews read. */
export interface GlassdoorTheme {
  /** The theme in a few words, e.g. "work-life balance", "compensation". */
  label: string
  /** How many reviews this theme was drawn from. */
  count: number
  /** A short representative quote, when one is available. */
  example: string | null
}

/** One recent review, exactly as Glassdoor stated it — absent fields are null. */
export interface GlassdoorReview {
  /** 1–5, or null when the review carried no overall star rating. */
  rating: number | null
  title: string | null
  /** "Current Employee", "Former Employee", or whatever Glassdoor labelled. */
  reviewerRole: string | null
  jobTitle: string | null
  location: string | null
  pros: string | null
  cons: string | null
  advice: string | null
  publishedAt: string | null
  /** Claude's reading of the review, when comment analysis is on. */
  sentiment: Sentiment | null
  url: string | null
}

/**
 * The Glassdoor block of the Social Media Listener report.
 *
 * `status` states whether it could be read; when it is not `ok`, `reason` says
 * why and the figures are empty. This mirrors `PlatformListening.status` so the
 * UI treats a missing Glassdoor the same way it treats a missing platform.
 */
export interface GlassdoorAnalysis {
  status: 'ok' | 'not_found' | 'not_configured' | 'error'
  reason: string | null
  /** The employer name/id read, echoed so the report says what it looked up. */
  employer: string | null
  employerUrl: string | null
  /** The overall company rating on Glassdoor, 1–5, or null when unstated. */
  overall_rating: number | null
  /** How many reviews the overall rating rests on, when Glassdoor stated it. */
  review_count: number | null
  /** % of reviewers who would recommend to a friend, 0–100, or null. */
  recommend_percent: number | null
  /** % who approve of the CEO, 0–100, or null. */
  ceo_approval_percent: number | null
  /** Sub-ratings Glassdoor breaks out, each 1–5 or null. Only stated ones appear. */
  category_ratings: Array<{ label: string; rating: number | null }>
  /** Sentiment of the reviews read, from Claude when enabled — a signal, not certainty. */
  sentiment: SentimentCounts | null
  /** The recurring positives across the reviews read. */
  pros_themes: GlassdoorTheme[]
  /** The recurring negatives across the reviews read. */
  cons_themes: GlassdoorTheme[]
  /** The most recent reviews read, newest first. */
  recent_reviews: GlassdoorReview[]
  /** How many reviews were actually read this run (the sample the themes rest on). */
  reviews_analyzed: number
  /** FetchLayer credits this Glassdoor read spent. */
  credits_used: number
  /** Plain-language takeaways, computed from the figures (Claude when enabled). */
  insights: string[]
  /** Glassdoor's employer id the figures belong to. Absent on reports stored before it was recorded. */
  employer_id?: string | null
  /**
   * Other Glassdoor listings the name search matched, which were NOT read —
   * named so a second (or impostor) page is never silently ignored.
   */
  other_listings?: Array<{ employerId: string; name: string; rating: number | null; reviewCount: number | null; url: string | null }>
  /** % of reviewers with a positive six-month business outlook, 0–100, or null. */
  business_outlook_percent?: number | null
  /** When FetchLayer read the page — Glassdoor's figures are as of this moment. */
  read_at?: string | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE QUESTIONS THE LISTENER ANSWERS, AND THE ORM LAYER

   Listening answers three questions — what are people saying about Ethara,
   how are they reacting, what topics are getting attention. The ORM
   (online reputation management) layer answers a fourth — what is Ethara's
   online reputation, and what should we do about positive and negative
   feedback? — as: Reputation Overview → Positive / Negative Issues →
   Emerging Risks → Recommended Responses.

   Claude is the sentiment analyser (it read every comment) and writes the
   answers from the report's own figures and the audience's own words; the
   reputation score and status are COMPUTED from those readings and the
   Glassdoor star ratings, never judged. Evidence URLs are only ever URLs the
   report already holds.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ListenerAnswer {
  question: string
  answer: string
  /** The figures or quotes the answer rests on, stated. */
  evidence: string[]
}

export interface ListenerAnswers {
  what_people_say: ListenerAnswer
  how_they_react: ListenerAnswer
  topics_getting_attention: ListenerAnswer
}

export type ReputationStatus = 'positive' | 'mixed' | 'negative' | 'insufficient_data'

export interface ReputationIssue {
  summary: string
  /** Where it was heard: a platform, Glassdoor, or across channels. */
  source: string
  /** How many comments / reviews it rests on. */
  count: number
  /** A short quote in the audience's own words, when one exists. */
  quote: string | null
  /** Post URLs from the report that carry it. */
  evidence_urls: string[]
}

export interface ReputationRisk {
  risk: string
  severity: 'low' | 'medium' | 'high'
  why: string
  evidence_urls: string[]
}

export interface ReputationResponse {
  /** The issue or risk it answers. */
  addresses: string
  action: string
  /** Where to act: a platform, Glassdoor, the careers page, internal… */
  channel: string
  priority: 'now' | 'this_week' | 'monitor'
  /** A reply Ethara could post, when a public reply fits — a draft for a person to approve, never sent. */
  draft_reply: string | null
}

export interface ReputationReport {
  question: string
  generated_at: string
  /** Claude wrote the analysis; `computed` when Claude was unavailable. */
  by: 'claude' | 'computed'
  error: string | null
  overview: {
    status: ReputationStatus
    /** Net sentiment, −100…100: positive% − negative% over every classified comment and rated review. Null without any. */
    net_sentiment: number | null
    /** What the score rests on. */
    basis: { comments_classified: number; reviews_rated: number; positive: number; neutral: number; negative: number }
    summary: string
  }
  positive_issues: ReputationIssue[]
  negative_issues: ReputationIssue[]
  emerging_risks: ReputationRisk[]
  recommended_responses: ReputationResponse[]
}

export interface SocialMediaListener {
  generated_at: string
  company: string
  sample_size: { posts: number; comments: number; platforms_with_data: number }
  /** How the qualitative parts were produced, stated rather than implied. */
  analysis: {
    sentiment_by: 'claude' | 'unavailable'
    insights_by: 'claude' | 'computed'
    note: string
  }
  /** SocialFetch credits this run spent, summed from each response's own `meta.creditsCharged`. */
  credits_used: number
  /** Anything that limited this run (credits running out, a platform failing), stated plainly. */
  warnings: string[]
  /** What Claude cost for the comment readings and insights, as the CLI reported it. */
  claude_cost_usd: number
  fetch_log: FetchLogEntry[]
  platforms: Partial<Record<ListenerPlatform, PlatformListening>>
  /**
   * The Glassdoor employer analysis, read through FetchLayer. Optional so a
   * report stored before Glassdoor existed still parses; when present it always
   * states its own `status`.
   */
  glassdoor?: GlassdoorAnalysis
  /** The three listening questions, answered. Absent on reports stored before they were. */
  answers?: ListenerAnswers
  /** The ORM layer. Absent on reports stored before it existed. */
  reputation?: ReputationReport
  cross_platform_insights: {
    overall_sentiment: SentimentCounts | null
    top_topics: TopicStat[]
    most_engaging_topics: TopicStat[]
    audience_feedback: FeedbackItem[]
    positive_signals: string[]
    negative_signals: string[]
    repeated_questions: string[]
    important_observations: string[]
    summary: string
  }
}

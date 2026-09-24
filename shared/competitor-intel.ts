/**
 * COMPETITOR INTELLIGENCE — the shapes (Analysis Agent · analysis.competitor.intel).
 *
 * The methodology is the `competitor-profiling` skill from
 * coreyhaines31/marketingskills (vendored in packages/marketing-skills/); the
 * SMA owns the universe, the sources, storage, history and the UI.
 *
 * Every claim carries a KIND and the ids of the sources it rests on:
 *   fact             stated by a source, quoted or restated
 *   source_derived   an observation drawn from a source (e.g. "the blog posts weekly")
 *   inference        a reasonable conclusion the sources do not state
 *   analysis         interpretation for Ethara (why it matters, implications)
 * A fact or source-derived claim with no valid source is relabelled inference.
 * Nothing is scored or ranked; a value no source gave is NOT_AVAILABLE.
 */

export const NOT_AVAILABLE = 'Not available from current sources'

export const COMPETITOR_TIERS = ['P0', 'P1'] as const
export type CompetitorTier = (typeof COMPETITOR_TIERS)[number]
export const COMPETITOR_STATUSES = ['active', 'inactive'] as const
export type CompetitorStatus = (typeof COMPETITOR_STATUSES)[number]
export const MONITORING_FREQUENCIES = ['weekly', 'monthly', 'manual'] as const
export type MonitoringFrequency = (typeof MONITORING_FREQUENCIES)[number]

/** One company in the Competitor Universe — configured data, never code. */
export interface Competitor {
  id: string
  /** Stable lowercase slug ("openai") — the profile's and the raw data's key. */
  slug: string
  name: string
  tier: CompetitorTier
  category: string
  /** Its focus, as the operator described it. */
  description: string
  website_url: string
  social_urls: string[]
  keywords: string[]
  status: CompetitorStatus
  monitoring_frequency: MonitoringFrequency
  created_at: string
  updated_at: string
  last_analyzed_at: string | null
  /** Ethara.AI's own entry: profiled like a competitor so it can be compared, never counted as one. */
  is_self: boolean
}

export const CLAIM_KINDS = ['fact', 'source_derived', 'inference', 'analysis'] as const
export type ClaimKind = (typeof CLAIM_KINDS)[number]
export const CLAIM_LABEL: Record<ClaimKind, string> = {
  fact: 'FACT',
  source_derived: 'SOURCE-DERIVED OBSERVATION',
  inference: 'INFERENCE',
  analysis: 'ANALYSIS',
}

/** A statement in a profile, with what it rests on. */
export interface Claim {
  text: string
  kind: ClaimKind
  /** Ids into the profile's `sources`. */
  source_ids: string[]
}

export type SourceType =
  | 'website'
  | 'pricing'
  | 'about'
  | 'blog'
  | 'research'
  | 'docs'
  | 'changelog'
  | 'customers'
  | 'careers'
  | 'news'
  | 'review'
  | 'seo'
  /** Ethara's own public social posts (from the Social Media Listener). */
  | 'social'
  /** Ethara's own Knowledge Base — internal, not a public page. */
  | 'internal'

/** Where a claim came from — retrievable, dated. */
export interface CompetitorSource {
  id: string
  source_url: string
  source_type: SourceType
  title: string | null
  /** The date the source states for itself (a news story's date), when it states one. */
  source_date: string | null
  retrieved_at: string
}

export interface AtAGlanceField {
  /** A value from the sources, or NOT_AVAILABLE. */
  value: string
  claim: Claim | null
}

export interface PricingTier {
  name: string
  price: string
  inclusions: string[]
  source_ids: string[]
}

/** SEO / market data — only from an SEO data source (DataForSEO), never estimated. */
export interface SeoData {
  status: 'ok' | 'not_configured' | 'error'
  reason: string | null
  domain_rank: number | null
  organic_keywords: number | null
  estimated_organic_traffic: number | null
  organic_traffic_value_usd: number | null
  backlinks: number | null
  referring_domains: number | null
  top_pages: Array<{ url: string; traffic: number | null }>
  organic_competitors: string[]
  retrieved_at: string | null
}

export interface ReviewSourceStatus {
  source: string
  status: 'ok' | 'blocked_by_robots' | 'not_found' | 'unavailable'
  reason: string | null
  url: string | null
}

export interface RecentDevelopment {
  title: string
  date: string | null
  summary: Claim | null
  source_ids: string[]
}

export interface CapabilityEvidence {
  capability: string
  evidence: Claim
}

export interface ProfileChange {
  kind: 'added' | 'changed' | 'removed'
  area: string
  detail: string
}

/** One competitor's profile — the competitor-profiling skill's template, structured. */
export interface CompetitorProfile {
  competitor_id: string
  slug: string
  name: string
  tier: CompetitorTier
  category: string
  website_url: string
  generated_at: string
  profile_version: number
  depth: 'quick' | 'deep'
  /** The methodology it followed: skill, version and upstream commit. */
  methodology: { skill: string; version: string | null; commit: string | null }
  by: 'claude' | 'unavailable'
  error: string | null

  overview: Claim[]
  at_a_glance: {
    tagline: AtAGlanceField
    founded: AtAGlanceField
    headquarters: AtAGlanceField
    team_size: AtAGlanceField
    funding: AtAGlanceField
  }
  positioning: {
    value_proposition: Claim | null
    target_audience: Claim[]
    positioning_angle: Claim | null
    messaging_themes: Claim[]
    core_claims: Claim[]
  }
  products: Array<{ name: string; description: Claim }>
  capabilities: CapabilityEvidence[]
  differentiators: Claim[]
  integrations: Claim[]
  product_direction: Claim[]
  pricing: { tiers: PricingTier[]; model: Claim | null; free_tier: Claim | null; enterprise: Claim | null; note: string | null }
  content: { themes: Claim[]; formats: Claim[]; strategy_signals: Claim[] }
  seo: SeoData
  customer_signals: { reviews: ReviewSourceStatus[]; praise: Claim[]; complaints: Claim[]; requests: Claim[] }
  strengths: Claim[]
  weaknesses: Claim[]
  competitive_implications: { where_they_lead: Claim[]; where_ethara_leads: Claim[]; opportunities: Claim[]; threats: Claim[] }
  recent_developments: RecentDevelopment[]
  sources: CompetitorSource[]
  /** Changes since the previous profile version; empty on the first. */
  changes: ProfileChange[]
  /** Pages / sources that could not be read, and why. */
  coverage_notes: string[]
  injection_attempts: number
}

export const CAPABILITIES = [
  'Foundation Models',
  'Agents',
  'Reasoning',
  'RL',
  'RLHF',
  'Evaluations',
  'Agent Evaluation',
  'Observability',
  'Coding Agents',
  'Inference',
  'Training Infrastructure',
  'Open Models',
  'Enterprise AI',
  'Research',
  'Developer Ecosystem',
] as const

export interface MarketTrend {
  trend: string
  companies: string[]
  evidence: Claim[]
  date: string | null
  /** ANALYSIS — kept apart from the evidence. */
  why_it_matters: string
}

export interface MarketGap {
  /** Worded as observed / potential / limited evidence — never certain. */
  gap: string
  evidence: Claim[]
  competitors_affected: string[]
  current_coverage: string
  potential_opportunity: string
  confidence: 'low' | 'medium' | 'high'
}

export interface MarketReport {
  generated_at: string
  competitors_analyzed: Array<{ id: string; name: string; tier: CompetitorTier; profile_version: number }>
  by: 'claude' | 'unavailable'
  error: string | null
  market_analysis: {
    landscape: { summary: Claim[]; segments: Array<{ segment: string; companies: string[]; note: string }>; adjacent_moves: Claim[]; emerging_categories: Claim[] }
    /** Company → Capability → Evidence → Source. No scores. */
    capability_analysis: Array<{ company: string; capability: string; evidence: Claim }>
    emerging_trends: MarketTrend[]
    market_gaps: MarketGap[]
    content_trends: MarketTrend[]
    positioning_patterns: Claim[]
  }
  ethara_analysis: {
    competitor_activity: Claim[]
    market_opportunities: Claim[]
    competitive_threats: Claim[]
    positioning_observations: Claim[]
    content_opportunities: Claim[]
  }
  /** Every source the market claims cite, pooled from the profiles (ids are `slug:sN`). */
  sources: CompetitorSource[]
}

/** The normalized output the Analysis Agent hands on (spec §11). */
export interface CompetitorIntelligence {
  generated_at: string
  competitors: Array<{
    id: string
    name: string
    tier: CompetitorTier
    category: string
    profile: CompetitorProfile | null
  }>
  market_analysis: MarketReport['market_analysis'] | null
  ethara_analysis: MarketReport['ethara_analysis'] | null
}

/** A run in progress or just finished — what the UI polls. */
export interface CompetitorRunStatus {
  running: boolean
  started_at: string | null
  finished_at: string | null
  step: string | null
  done: number
  total: number
  errors: string[]
}

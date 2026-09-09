/**
 * THE UI TYPE CONTRACT
 *
 * These mirror the server's repository rows exactly (snake_case where the row
 * is snake_case), so the same object flows from `/api/state` into the store
 * and from `src/data/demo.ts` into the store with no adapter in between.
 * Law 8: state is server-truth. This file is that truth's shape.
 */

import type {
  AgentId,
  AgentRunStatus,
  CalendarSlot,
  Confidence,
  IdeaStatus,
  OperatorRole,
  Platform,
  StageId,
  ValidationVerdict,
} from '@shared/agent-contract'
import type { ToolRisk } from '@shared/tool-registry'

export type {
  AgentId,
  AgentRunStatus,
  CalendarSlot,
  Confidence,
  IdeaStatus,
  OperatorRole,
  Platform,
  StageId,
  ToolRisk,
  ValidationVerdict,
}

/* ═══════════════════════════════════════════════════════════════════════════
   NAVIGATION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Screens are components selected by this field. There is no router (Part 3). */
export type PageId =
  | 'dashboard'
  | 'calendar'
  | 'published'
  | 'leadership'
  | 'orchestration'
  | 'intelligence'
  | 'studio'
  | 'console'
  | 'assistant'
  | 'knowledge'
  | 'settings'

export type Theme = 'dark' | 'light'

export interface User {
  name: string
  title: string
  email: string
  role: OperatorRole
  initial: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   DISCOVERY
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Keyword {
  id: string
  term: string
  category: string
  weight: number
  active: boolean
  created_at: string
}

export interface KeywordSignal {
  id: string
  keyword_id: string
  term: string
  run_id: string | null
  post_count: number
  total_engagement: number
  avg_engagement: string
  velocity: string
  growth_pct: string
  trend_score: number
  rank: number | null
  is_trending: boolean
  trend_reason: string | null
  /** LinkedIn content search for the term. */
  search_url?: string | null
  /** The strongest captured post for it, by engagement. */
  top_post_url?: string | null
  top_post_title?: string | null
  captured_at: string
}

export interface Source {
  id: string
  name: string
  kind: string
  source_type: string
  url: string | null
  trusted: boolean
  enabled: boolean
}

export interface ScrapedItem {
  id: string
  keyword_id: string | null
  keyword_term: string | null
  run_id: string | null
  external_id: string | null
  title: string
  snippet: string | null
  url: string | null
  source_name: string | null
  source_type: string | null
  author_name: string | null
  author_headline: string | null
  author_followers: number | null
  hashtags: string[]
  engagement: number
  reactions: number
  comments: number
  reposts: number
  relevance: number
  credibility: string
  freshness: number
  is_duplicate: boolean
  duplicate_of_id: string | null
  validation: ValidationVerdict
  verdict_reason: string | null
  capture_source: 'live' | 'fixture'
  posted_at: string | null
  scraped_at: string
}

export interface Hashtag {
  id: string
  tag: string
  display_tag: string
  keyword_id: string | null
  keyword_term: string | null
  run_id: string | null
  post_count: number
  total_engagement: number
  engagement_per_post: string
  relevance: number
  credibility: string
  freshness: number
  hashtag_score: number
  rank: number | null
  validation: ValidationVerdict
  verdict_reason: string | null
  duplicate_of_id: string | null
  duplicate_of_tag: string | null
  in_top_set: boolean
  researched_at: string | null
  first_seen_at: string
  last_seen_at: string
  /** The tag's own LinkedIn feed. */
  feed_url?: string | null
  top_post_url?: string | null
  top_post_title?: string | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTENT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface IdeaAnalysis {
  format?: string
  angle?: string
  audience?: string
  brandRelevance?: number
  trendScore?: number
  engagementLevel?: string
  bestDay?: string
  platformScore?: number
  slotReasons?: string[]
  altPlatforms?: Array<{ platform: Platform; score: number }>
  [key: string]: unknown
}

export interface Draft {
  body: string
  revision: number
  model: string
  source: 'live' | 'fixture'
  updatedAt?: string
}

export interface MediaAsset {
  dataUri: string
  model: string
  renderMode: 'demo' | 'live'
  concept: string | null
  canvas: string | null
  width: number | null
  height: number | null
  altText: string | null
  fallbackReason: string | null
}

export interface LeadershipDecision {
  decision: 'approved' | 'rejected'
  by: string
  at: string
  reason?: string
  published?: boolean
}

export interface Idea {
  id: string
  source_item_id: string | null
  hashtag_id: string | null
  hashtag_display: string | null
  title: string
  description: string | null
  source_topic: string | null
  platform: Platform
  alt_platforms: Array<{ platform: Platform; score: number }>
  scheduled_date: string
  scheduled_time: string
  confidence: number
  priority_score: number
  platform_rank: number | null
  calendar_slot: CalendarSlot
  status: IdeaStatus
  analysis: IdeaAnalysis
  feedback: Array<Record<string, unknown>>
  is_new_trend: boolean
  marketing_approved_by: string | null
  marketing_approved_at: string | null
  leadership_decision: LeadershipDecision | null
  created_at: string
  updated_at: string

  /** Joined onto the row by `/api/state` — the draft and media for `platform`. */
  calendarSlot?: CalendarSlot
  platformRank?: number | null
  draft?: Draft | null
  media?: MediaAsset | null
}

export interface PublishedPost {
  id: string
  idea_id: string | null
  title: string
  platform: Platform
  content: string
  status: string
  external_id: string | null
  publish_mode: 'demo' | 'live'
  published_at: string | null
  history: Array<Record<string, unknown>>
  media_asset_id: string | null
  analysis_summary: string | null
  analysis_recommendation: string | null
  reach: number | null
  impressions: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  engagement_rate: string | null
  metrics_captured_at: string | null
  data_uri: string | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   KNOWLEDGE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface KnowledgeSource {
  title: string
  url: string
  publishedAt?: string
}

export interface KnowledgeEntry {
  id: string
  title: string
  category: string
  content: string
  source: string
  sources: KnowledgeSource[]
  hashtag_id: string | null
  hashtag_display: string | null
  tags: string[]
  confidence: Confidence
  evidence_count: number
  active: boolean
  origin: string
  build_id: string | null
  created_at: string
}

export interface KnowledgeBuild {
  id: string
  trigger: string
  status: string
  hashtags_researched: number
  entries_written: number
  entries_merged: number
  sources_cited: number
  research_source: 'live' | 'fixture'
  started_at: string
  finished_at: string | null
  summary: Record<string, unknown>
  error: string | null
}

/* ═══════════════════════════════════════════════════════════════════════════
   RUNTIME AND TELEMETRY
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AgentState {
  agent_id: AgentId
  status: AgentRunStatus
  current_task: string
  last_run: string | null
  processed: number
  success_rate: number
}

export interface ActivityEvent {
  id: string
  agent_id: AgentId | null
  message: string
  status: 'ok' | 'running' | 'warn' | 'error'
  entity_type: string | null
  entity_id: string | null
  created_at: string
}

export interface ReviewQueueItem {
  id: string
  kind: string
  entity_id: string | null
  reason: string
  decision_requested: string
  options: string[]
  resolved: boolean
  resolved_by: string | null
  resolved_at: string | null
  outcome: string | null
  created_at: string
  entity_title: string | null
}

export interface PlatformAnalytics {
  id: string
  platform: Platform
  month: string
  label: string | null
  is_reported: boolean
  metrics: Record<string, number>
  daily: Array<{ date: string; value: number }>
}

export interface PipelineRun {
  id: string
  trigger: string
  status: string
  turn_id: string | null
  started_at: string
  finished_at: string | null
  summary: Record<string, unknown>
}

export interface AgentRun {
  id: string
  pipeline_run_id: string | null
  agent_id: AgentId
  status: AgentRunStatus
  started_at: string
  finished_at: string | null
  duration_ms: number | null
  input_count: number
  output_count: number
  error: string | null
}

export interface SkillRun {
  id: string
  agent_run_id: string | null
  skill_id: string
  agent_id: AgentId
  status: 'completed' | 'skipped' | 'failed'
  duration_ms: number | null
  config_used: Record<string, string | number | boolean>
  note: string | null
  started_at: string
}

export interface LineageEdge {
  from_type: string
  from_id: string
  to_type: string
  to_id: string
  agent_id: string | null
  depth: number
  direction: 'forward' | 'backward'
}

/* ═══════════════════════════════════════════════════════════════════════════
   Ethara
   ═══════════════════════════════════════════════════════════════════════════ */

export type AssistantCoreState =
  | 'dormant'
  | 'listening'
  | 'thinking'
  | 'working'
  | 'speaking'
  | 'attention'
  | 'error'

export type AssistantTurnStatus =
  | 'planning'
  | 'awaiting_confirmation'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface PlanStep {
  idx: number
  toolId: string
  toolName: string
  risk: ToolRisk
  why: string
  agentId: AgentId | null
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'skipped'
  summary?: string
  render?: string
  data?: Record<string, unknown>
  durationMs?: number
  error?: string
  fallbackReason?: string
  /** The object this step named, so a later pronoun can resolve against it. */
  entity?: { type?: string; id?: string; title?: string }
  postcondition?: { description: string; satisfied: boolean }
}

export interface AssistantPlan {
  id: string
  summary: string
  risk: ToolRisk
  requiresConfirmation: boolean
  restated: string
  confidence: number
  parser: string
  parserReason?: string
  steps: PlanStep[]
  trimmed?: string[]
}

export interface AssistantTurn {
  id: string
  seq: number
  speaker: 'operator' | 'assistant'
  utterance: string
  channel: 'text' | 'voice' | 'ambient' | 'cron'
  narration: string | null
  confidence: number | null
  status: AssistantTurnStatus
  created_at: string
  plan?: AssistantPlan | null
  steps?: PlanStep[]
  intent?: Record<string, unknown> | null
}

export interface AssistantConversation {
  id: string
  actor: string
  role: OperatorRole
  title: string | null
  started_at: string
  last_at: string
  turn_count?: number
  tool_count?: number
}

export interface PendingConfirm {
  token: string
  prompt: string
  expiresAt: string
  plan: AssistantPlan
}

export interface AssistantNotice {
  id: string
  signal: string
  message: string
  severity: 'info' | 'warn' | 'serious'
  action?: { label: string; utterance: string }
  at: string
}

export interface AssistantBrief {
  id: string
  trigger: string
  signals: Array<{ label: string; detail: string }>
  recommendation: string | null
  narration: string | null
  created_at: string
}

export interface ToolSuggestion {
  toolId: string
  name: string
  summary: string
  risk: ToolRisk
  agentId: AgentId | null
  score: number
  example?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRY (as served, registry merged with workspace overrides)
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SkillStats {
  runs: number
  failures: number
  avgMs: number
}

export interface RegistrySkill {
  id: string
  agentId: AgentId
  section?: string
  name: string
  summary: string
  inputs: string[]
  outputs: string[]
  config: Array<{
    key: string
    label: string
    type: 'number' | 'percent' | 'boolean' | 'enum' | 'text'
    default: string | number | boolean
    description: string
    min?: number
    max?: number
    step?: number
    unit?: string
    options?: string[]
  }>
  order: number
  enabledByDefault: boolean
  critical?: boolean
  enabled: boolean
  values: Record<string, string | number | boolean>
  isOverridden: boolean
  stats: SkillStats
}

export interface ToolListEntry {
  id: string
  name: string
  summary: string
  agentId: AgentId
  risk: ToolRisk
  returns: string
  confirmTemplate: string | null
  examples: string[]
}

/* ═══════════════════════════════════════════════════════════════════════════
   HEALTH AND MODE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface IntegrationStatus {
  id: string
  label: string
  configured: boolean
  reason: string
}

export interface ApiHealth {
  ok: boolean
  database: string
  publishMode: string
  registry: { agents: number; skills: number; stages: number; knobs: number }
  tools: { total: number; safe: number; mutating: number; irreversible: number }
  integrations: Record<string, { configured: boolean; reason: string }>
  assistant?: { provider: string; configured: boolean; reason: string }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE AGGREGATE STATE PAYLOAD — what `/api/state` and `demo.ts` both produce
   ═══════════════════════════════════════════════════════════════════════════ */

export interface StatePayload {
  workspace: {
    name: string
    slug: string
    brandVoice: string
    audience: string
    settings: Record<string, unknown>
  }
  keywords: Keyword[]
  keywordSignals: KeywordSignal[]
  hashtags: Hashtag[]
  topHashtags: Hashtag[]
  scraped: ScrapedItem[]
  ideas: Idea[]
  drafts: Record<string, Draft>
  media: Record<string, MediaAsset>
  published: PublishedPost[]
  knowledge: KnowledgeEntry[]
  knowledgeBuild: KnowledgeBuild | null
  agents: AgentState[]
  activity: ActivityEvent[]
  analytics: PlatformAnalytics[]
  reviewQueue: ReviewQueueItem[]
  sources: Source[]
  pipeline: PipelineRun | null
  platformLabels: Record<string, string>
  assistant: {
    conversation: AssistantConversation | null
    turns: AssistantTurn[]
    brief: AssistantBrief | null
    pendingConfirm: PendingConfirm | null
  }
  mode: {
    publishMode: string
    assistantProvider: string
    integrations: IntegrationStatus[]
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSIENT UI STATE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Toast {
  id: string
  message: string
  tone: 'neutral' | 'good' | 'warn' | 'critical'
  hint?: string
}

export interface ScrapeRunState {
  running: boolean
  progress: number
  currentSource: string
  currentKeyword: string
  found: number
}

export type PublishPhase =
  | null
  | 'Preparing content'
  | 'Validating platform format'
  | 'Uploading media'
  | 'Publishing'
  | 'Published successfully'

export interface Settings {
  tone: string
  audience: string
  creativity: number
  approvalRequired: boolean
  autoScheduling: boolean
  autoPublish: boolean
  imageModel: string
  topKeywords: number
  topHashtagsPerKeyword: number
  knowledgeHashtagCount: number
  topPerPlatform: number
  assistantVoice: boolean
  assistantProactive: boolean
  assistantWakePhrase: boolean
  assistantVerbosity: 'terse' | 'normal' | 'detailed'
  assistantConfirmMutating: boolean
  assistantAddressStyle: 'surname' | 'firstname' | 'role'
  assistantPushToTalk: boolean
}

/** A pipeline SSE frame, as delivered by `/api/events`. */
export interface RuntimeEvent {
  type: string
  at: string
  agentId?: string
  skillId?: string
  runId?: string
  turnId?: string
  message?: string
  data?: Record<string, unknown>
}

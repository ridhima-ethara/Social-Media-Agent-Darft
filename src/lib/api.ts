/**
 * THE API CLIENT
 *
 * Law 9 — degrade, never fail. Every method here either returns a value or
 * throws a plain `Error` with a human sentence; `detectApi()` never throws at
 * all, so the app can decide once, at boot, whether it is connected, and then
 * carry on either way.
 *
 * Law 8 — the client reconciles by refetching `/state`, never by replaying the
 * event log. `subscribeToEvents` is liveness only.
 */

import type { SocialMediaListener } from '@shared/social-listener'
import type { Competitor, CompetitorIntelligence, CompetitorProfile, CompetitorRunStatus, MarketReport } from '@shared/competitor-intel'
import type {
  ApiHealth,
  Draft,
  Hashtag,
  Idea,
  AssistantBrief,
  AssistantConversation,
  AssistantNotice,
  AssistantTurn,
  Keyword,
  KnowledgeEntry,
  LineageEdge,
  MediaAsset,
  ModelReference,
  Platform,
  RegistrySkill,
  ReviewQueueItem,
  RuntimeEvent,
  StatePayload,
  ToolListEntry,
  ToolSuggestion,
  ValidationVerdict,
  HookVariant,
  TrackedAccount,
  VoiceProfile,
  VoiceSample,
} from '../types'

/**
 * THE API BASE IS RELATIVE BY DEFAULT.
 *
 * `/api` — not `http://localhost:4001/api`. The Vite dev server proxies `/api`
 * to the API, and nginx does the same in the container image, so a relative base
 * resolves correctly from whatever host served the bundle. An absolute default
 * would break the moment a second device opened the app: `localhost` on a phone
 * is the phone. Hard-coding a LAN IP only moves the problem to the next DHCP
 * lease.
 *
 * `VITE_API_URL` remains available as an override, for pointing the app at an
 * API on a genuinely different origin.
 */
export const API_BASE = (import.meta.env.VITE_API_URL as string | undefined)?.trim() || '/api'

/* ═══════════════════════════════════════════════════════════════════════════
   THE TRANSPORT
   ═══════════════════════════════════════════════════════════════════════════ */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  timeoutMs?: number
}

/*
 * How long the browser waits on a route that writes or renders with a model.
 * A caption plus its creative on Gemini 2.5 Pro can run past two minutes; the
 * server keeps the connection alive with a heartbeat meanwhile, so the only
 * limit that matters is this one.
 */
const LONG_MS = 300_000

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 30_000 } = options

  const response = await fetch(`${API_BASE}${path}`, {
    method,
    // The session is an httpOnly cookie, so it only travels when credentials are
    // included. Without this every mutating request would answer 401.
    credentials: 'include',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    signal: AbortSignal.timeout(timeoutMs),
  })

  const text = await response.text()
  let parsed: unknown = null
  try {
    parsed = text.length > 0 ? JSON.parse(text) : null
  } catch {
    throw new Error(`The API returned something that is not JSON (${response.status}).`)
  }

  if (!response.ok) {
    const message =
      parsed !== null && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : `Request failed with ${response.status}.`
    throw new Error(message)
  }

  // A slow route that kept the connection alive with a heartbeat has already
  // committed a 200, so a failure after that arrives in the body instead.
  if (parsed !== null && typeof parsed === 'object' && (parsed as { failed?: unknown }).failed === true) {
    throw new Error(String((parsed as { error?: unknown }).error ?? 'The request failed.'))
  }

  return parsed as T
}

/* ═══════════════════════════════════════════════════════════════════════════
   DETECTION — the one call that is allowed to fail silently
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Probes `/health` with a short abort timeout. Returns `null` on any failure —
 * unreachable, wrong port, DNS, CORS, malformed body — and never throws, so a
 * missing server costs the app nothing but a banner.
 */
export async function detectApi(timeoutMs = 1_500): Promise<ApiHealth | null> {
  try {
    const response = await fetch(`${API_BASE}/health`, {
      signal: AbortSignal.timeout(timeoutMs),
    })
    if (!response.ok) return null
    const health = (await response.json()) as ApiHealth
    // Another service can answer on the same port. Only this product's API
    // reports its registry and tool summaries; anything else is a stranger,
    // and a stranger is treated as "no API" rather than half-trusted.
    if (health.ok !== true || !health.registry || typeof health.registry.agents !== 'number') return null
    return health
  } catch {
    return null
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ROUTES — one typed method each
   ═══════════════════════════════════════════════════════════════════════════ */

export const api = {
  health: (): Promise<ApiHealth> => request<ApiHealth>('/health'),

  state: (): Promise<StatePayload> => request<StatePayload>('/state'),

  registry: (): Promise<{
    stages: unknown[]
    agents: unknown[]
    summary: { agents: number; skills: number; stages: number; knobs: number }
    skills: RegistrySkill[]
  }> => request('/registry'),

  tools: (): Promise<{
    summary: { total: number; safe: number; mutating: number; irreversible: number }
    registered: string[]
    tools: ToolListEntry[]
  }> => request('/tools'),

  patchSkill: (
    skillId: string,
    patch: { enabled?: boolean; config?: Record<string, string | number | boolean> },
  ): Promise<{ ok: boolean; values: Record<string, string | number | boolean> }> =>
    request(`/skills/${encodeURIComponent(skillId)}`, { method: 'PATCH', body: patch }),

  resetSkill: (
    skillId: string,
  ): Promise<{ ok: boolean; values: Record<string, string | number | boolean> }> =>
    request(`/skills/${encodeURIComponent(skillId)}/reset`, { method: 'POST' }),

  /* ── Keywords and hashtags ─────────────────────────────────────────────── */

  keywords: (): Promise<{ keywords: Keyword[] }> => request('/keywords'),

  addKeyword: (body: {
    term: string
    category: string
    weight: number
  }): Promise<{ keyword: Keyword }> => request('/keywords', { method: 'POST', body }),

  updateKeyword: (
    id: string,
    body: { term?: string; category?: string; weight?: number; active?: boolean },
  ): Promise<{ keyword: Keyword }> => request(`/keywords/${id}`, { method: 'PATCH', body }),

  deleteKeyword: (id: string): Promise<{ deactivated: boolean }> =>
    request(`/keywords/${id}`, { method: 'DELETE' }),

  trendingKeywords: (): Promise<{ trending: unknown[] }> => request('/keywords/trending'),

  hashtags: (params: { status?: string; keywordId?: string; top?: boolean } = {}): Promise<{
    hashtags: Hashtag[]
  }> => {
    const query = new URLSearchParams()
    if (params.status) query.set('status', params.status)
    if (params.keywordId) query.set('keywordId', params.keywordId)
    if (params.top) query.set('top', 'true')
    const suffix = query.toString()
    return request(`/hashtags${suffix ? `?${suffix}` : ''}`)
  },

  topHashtags: (): Promise<{ topHashtags: Hashtag[] }> => request('/hashtags/top'),

  setHashtagValidation: (
    id: string,
    validation: ValidationVerdict,
    by: string,
  ): Promise<{ hashtag: Hashtag }> =>
    request(`/hashtags/${id}/validation`, { method: 'PATCH', body: { validation, by } }),

  setItemValidation: (
    id: string,
    validation: ValidationVerdict,
    by: string,
  ): Promise<{ item: unknown }> =>
    request(`/items/${id}/validation`, { method: 'PATCH', body: { validation, by } }),

  /* ── Pipeline ──────────────────────────────────────────────────────────── */

  runPipeline: (body: { paceMs?: number; keywordIds?: string[] } = {}): Promise<{
    pipelineRunId: string
    status: string
    summary: Record<string, unknown>
  }> => request('/pipeline/run', { method: 'POST', body, timeoutMs: 1_200_000 }),

  runs: (): Promise<{ agentRuns: unknown[]; skillRuns: unknown[]; latest: unknown }> =>
    request('/runs'),

  /* ── The Python agent backend ──────────────────────────────────────────── */

  agentRoster: (): Promise<AgentRosterResponse> => request('/agents', { timeoutMs: 30_000 }),

  agentBrain: (): Promise<{ entries: unknown[]; stats: Record<string, number> }> =>
    request('/agents/brain', { timeoutMs: 30_000 }),

  /* ── Knowledge ─────────────────────────────────────────────────────────── */

  buildKnowledge: (body: { hashtagCount?: number; forceRefresh?: boolean } = {}): Promise<
    Record<string, unknown>
  > => request('/knowledge/build', { method: 'POST', body, timeoutMs: 300_000 }),

  knowledgeBuilds: (): Promise<{ builds: unknown[]; latest: unknown }> =>
    request('/knowledge/builds'),

  addKnowledge: (body: {
    title: string
    category: string
    content: string
    confidence?: string
    tags?: string[]
  }): Promise<{ entry: KnowledgeEntry }> => request('/knowledge', { method: 'POST', body }),

  /* ── The brand corpus ──────────────────────────────────────────────────── */

  knowledgeCorpus: (): Promise<{
    entries: KnowledgeEntry[]
    stats: {
      total: number
      active: number
      domain: number
      rules: number
      brandTopics: number
      corpusTerms: number
      keywordTerms: number
      alignmentTerms: number
    }
    available: Array<{ title: string; category: string; tags: string[]; keyPoints: string[]; domain: boolean }>
  }> => request('/knowledge/corpus'),

  addCorpusEntry: (body: {
    title: string
    category?: string
    content: string
    confidence?: string
    tags: string[]
    keyPoints?: string[]
    domain?: boolean
  }): Promise<{ entry: KnowledgeEntry; appliesTo: string }> =>
    request('/knowledge/corpus', { method: 'POST', body }),

  uploadCorpusFiles: (
    files: Array<{ name: string; content: string }>,
  ): Promise<{
    inserted: number
    skipped: number
    deactivated: number
    files: Array<{ file: string; sections: number; outcome: 'inserted' | 'unchanged' | 'unreadable'; detail: string | null }>
    summary: string
  }> => request('/knowledge/corpus/upload', { method: 'POST', body: { files }, timeoutMs: 300_000 }),

  restoreCorpus: (): Promise<{ restored: string[]; skipped: number; reason: string }> =>
    request('/knowledge/corpus/restore', { method: 'POST', body: {} }),

  toggleKnowledge: (id: string, active: boolean): Promise<{ entry: KnowledgeEntry }> =>
    request(`/knowledge/${id}`, { method: 'PATCH', body: { active } }),

  /* ── Ideas and content ─────────────────────────────────────────────────── */

  /** The published post's own page on the platform, when the platform has returned one. */
  postLink: (id: string): Promise<{ url: string | null; status: string; reason: string | null }> =>
    request(`/posts/${id}/link`),

  generateDraft: (
    id: string,
    body: { platform?: Platform; withImage?: boolean } = {},
  ): Promise<{ draft?: Draft; media?: MediaAsset; [key: string]: unknown }> =>
    request(`/ideas/${id}/draft`, { method: 'POST', body, timeoutMs: LONG_MS }),

  renderImage: (
    id: string,
    body: {
      platform: Platform
      model?: string
      prompt?: string
      instruction?: string
      references?: ModelReference[]
    },
  ): Promise<{ media: MediaAsset }> =>
    request(`/ideas/${id}/image`, { method: 'POST', body, timeoutMs: LONG_MS }),

  instruct: (
    id: string,
    body: {
      platform: Platform
      instruction: string
      model?: string
      references?: ModelReference[]
    },
  ): Promise<{
    draft: Draft
    /** False when the instruction produced no change. */
    applied: boolean
    note: string
    compliance: unknown
    preference: { title: string; content: string } | null
    skills: unknown[]
  }> => request(`/ideas/${id}/instruct`, { method: 'POST', body, timeoutMs: LONG_MS }),

  /**
   * Returns the caption to the text it held at an earlier step on the thread.
   * The step is addressed by its `at` stamp — a revision number can address two
   * entries, because an instruction that changed nothing leaves it where it was.
   */
  revert: (
    id: string,
    body: { platform: Platform; at: string },
  ): Promise<{ draft: Draft; note: string }> =>
    request(`/ideas/${id}/revert`, { method: 'POST', body }),

  updateIdea: (
    id: string,
    body: {
      date?: string
      time?: string
      platform?: Platform
      status?: string
      draft?: string
      /** A topic's own line, edited in the Topic Queue. Never writes a post. */
      title?: string
    },
  ): Promise<{ ok: boolean; idea: Idea }> =>
    request(`/ideas/${id}`, { method: 'PATCH', body }),

  /**
   * Generate Post — the complete post (caption, hashtags, creative) for ONE
   * topic. An existing post comes back untouched unless `regenerate` is sent.
   */
  generatePost: (
    id: string,
    body: { regenerate?: boolean } = {},
  ): Promise<{ ideaId: string; platform: Platform; generated: boolean; reason: string }> =>
    request(`/ideas/${id}/generate-post`, { method: 'POST', body }),

  /** Re-reads only Glassdoor (FetchLayer) and attaches it to the latest listener report. */
  refreshGlassdoor: (): Promise<{ glassdoor: { status: string; reason: string | null }; saved: boolean; reason?: string }> =>
    request('/analysis/social-listener/glassdoor', { method: 'POST', body: {}, timeoutMs: 180_000 }),

  /** Re-runs the ORM layer (reputation + the three answers) over the latest report — Claude only, no SocialFetch call. */
  analyseReputation: (): Promise<{ report: SocialMediaListener; createdAt: string }> =>
    request('/analysis/social-listener/reputation', { method: 'POST', body: {}, timeoutMs: 300_000 }),

  /* ── Competitor Intelligence (Analysis Agent) ── */
  competitors: (): Promise<CompetitorsState> => request('/analysis/competitors', { timeoutMs: 60_000 }),
  competitorStatus: (): Promise<{ status: CompetitorRunStatus }> => request('/analysis/competitors/status'),
  competitorProfile: (id: string, version?: number): Promise<{ competitor: Competitor; profile: CompetitorProfile | null; versions: Array<{ version: number; generated_at: string; changes: number }> }> =>
    request(`/analysis/competitors/${encodeURIComponent(id)}/profile${version ? `?version=${version}` : ''}`),
  createCompetitor: (body: CompetitorDraft): Promise<{ competitor: Competitor }> => request('/analysis/competitors', { method: 'POST', body }),
  updateCompetitor: (id: string, body: Partial<CompetitorDraft>): Promise<{ competitor: Competitor }> =>
    request(`/analysis/competitors/${encodeURIComponent(id)}`, { method: 'PATCH', body }),
  deleteCompetitor: (id: string): Promise<{ removed: boolean }> => request(`/analysis/competitors/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  runCompetitors: (body: { competitorIds?: string[]; depth?: 'quick' | 'deep'; dueOnly?: boolean }): Promise<{ started: boolean; competitors: number }> =>
    request('/analysis/competitors/run', { method: 'POST', body }),

  /** Runs the Analysis Agent's Social Media Listener now, always fresh (SocialFetch + Claude). */
  runSocialListener: (): Promise<{ report: SocialMediaListener; status: string }> =>
    request('/analysis/social-listener/run', { method: 'POST', body: {} }),

  /** Hands the Topic Queue's dates to its topics in this order. */
  reorderTopicQueue: (ids: string[]): Promise<{ ok: boolean; moved: number }> =>
    request('/calendar/topic-queue/order', { method: 'POST', body: { ids } }),

  deleteIdea: (id: string): Promise<{ withdrawn: boolean }> =>
    request(`/ideas/${id}`, { method: 'DELETE' }),

  approveIdea: (id: string, by: string): Promise<{ idea: Idea }> =>
    request(`/ideas/${id}/approve`, { method: 'POST', body: { by } }),

  leadershipApprove: (
    id: string,
    by: string,
    publish = true,
  ): Promise<Record<string, unknown>> =>
    request(`/ideas/${id}/leadership/approve`, {
      method: 'POST',
      body: { by, publish },
      timeoutMs: 120_000,
    }),

  leadershipReject: (id: string, by: string, reason: string): Promise<Record<string, unknown>> =>
    request(`/ideas/${id}/leadership/reject`, { method: 'POST', body: { by, reason } }),

  publishIdea: (id: string, platform?: Platform): Promise<Record<string, unknown>> =>
    request(`/ideas/${id}/publish`, {
      method: 'POST',
      body: platform ? { platform } : {},
      timeoutMs: 120_000,
    }),

  /* ── Analytics, images, lineage, review ────────────────────────────────── */

  /* ── Short-form: scripts, hooks and the learned voice (ADR-007) ───────── */

  voiceProfiles: (): Promise<{ profiles: VoiceProfile[]; sampleCount: number }> =>
    request('/voice-profiles'),

  voiceSamples: (): Promise<{ samples: VoiceSample[] }> => request('/voice-samples'),

  addVoiceSamples: (
    samples: Array<{ body: string; label?: string }>,
  ): Promise<{ inserted: number; duplicates: number; total: number }> =>
    request('/voice-samples', { method: 'POST', body: { samples } }),

  /**
   * Derives a profile. Answers 422 with the count it has when there are too few
   * samples — a well-formed request whose answer is no, not a breakage.
   */
  deriveVoiceProfile: (): Promise<{ profile: VoiceProfile }> =>
    request('/voice-profiles/derive', { method: 'POST', body: {} }),

  setVoiceProfileActive: (id: string, active: boolean): Promise<{ profile: VoiceProfile }> =>
    request(`/voice-profiles/${id}`, { method: 'PATCH', body: { active } }),

  trackedAccounts: (): Promise<{ accounts: TrackedAccount[] }> => request('/tracked-accounts'),

  addTrackedAccount: (body: {
    platform: Platform
    handle: string
    label?: string
  }): Promise<{ account: TrackedAccount }> =>
    request('/tracked-accounts', { method: 'POST', body }),

  setTrackedAccountActive: (id: string, active: boolean): Promise<{ account: TrackedAccount }> =>
    request(`/tracked-accounts/${id}`, { method: 'PATCH', body: { active } }),

  hooks: (ideaId: string): Promise<{ hooks: HookVariant[] }> =>
    request(`/ideas/${ideaId}/hooks`),

  generateHooks: (ideaId: string): Promise<{ hooks: HookVariant[]; note?: string }> =>
    request(`/ideas/${ideaId}/hooks`, { method: 'POST', body: {}, timeoutMs: LONG_MS }),

  // Selects one and unselects the rest. The others are kept — "the four we did
  // not pick" is evidence about what this account decided.
  selectHook: (hookId: string): Promise<{ hooks: HookVariant[] }> =>
    request(`/hooks/${hookId}/select`, { method: 'PATCH', body: {} }),

  writeScript: (
    ideaId: string,
  ): Promise<{ script: string; source: string; model: string; hooks: unknown[] }> =>
    request(`/ideas/${ideaId}/script`, { method: 'POST', body: {}, timeoutMs: LONG_MS }),

  refreshAnalytics: (body: { platform?: Platform; month?: string } = {}): Promise<
    Record<string, unknown>
  > => request('/analytics/refresh', { method: 'POST', body, timeoutMs: 120_000 }),

  imageModels: (): Promise<{
    models: Array<{ id: string; label: string; configured: boolean; reason: string; [k: string]: unknown }>
  }> => request('/image-models'),

  lineage: (type: string, id: string): Promise<{ edges: LineageEdge[] }> =>
    request(`/lineage/${type}/${id}`),

  reviewQueue: (resolved = false): Promise<{ queue: ReviewQueueItem[] }> =>
    request(`/review-queue?resolved=${resolved}`),

  resolveQueueItem: (id: string, outcome: string, by: string): Promise<{ queueItem: ReviewQueueItem }> =>
    request(`/review-queue/${id}/resolve`, { method: 'POST', body: { outcome, by } }),

  /* ── Ethara ────────────────────────────────────────────────────────────── */

  conversation: (id: string): Promise<{ turns: AssistantTurn[] }> =>
    request(`/assistant/conversation/${id}`),

  conversations: (): Promise<{ conversations: AssistantConversation[] }> =>
    request('/assistant/conversations'),

  brief: (): Promise<{ brief: AssistantBrief | null; notices: AssistantNotice[] }> =>
    request('/assistant/brief'),

  composeBrief: (role: string): Promise<{ brief: AssistantBrief }> =>
    request('/assistant/brief', { method: 'POST', body: { role }, timeoutMs: 60_000 }),

  suggestions: (q: string): Promise<{ suggestions: ToolSuggestion[] }> =>
    request(`/assistant/suggestions?q=${encodeURIComponent(q)}`),
}

/* ═══════════════════════════════════════════════════════════════════════════
   SSE — liveness, never correctness
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Opens an `EventSource` on `/events`. Malformed frames are ignored rather
 * than thrown; the browser reconnects on its own. Returns an unsubscribe.
 */
export function subscribeToEvents(onEvent: (event: RuntimeEvent) => void): () => void {
  let source: EventSource | null = null

  try {
    source = new EventSource(`${API_BASE}/events`)
  } catch {
    return () => {}
  }

  const handle = (raw: MessageEvent<string>): void => {
    try {
      const parsed = JSON.parse(raw.data) as RuntimeEvent
      if (typeof parsed?.type === 'string') onEvent(parsed)
    } catch {
      // A malformed frame costs one event, never the connection.
    }
  }

  source.onmessage = handle
  source.onerror = () => {
    // EventSource reconnects by itself. Nothing to do, and nothing to log:
    // a dropped connection costs liveness, never correctness.
  }

  return () => {
    source?.close()
  }
}


/* ═══════════════════════════════════════════════════════════════════════════
   THE AGENT PIPELINE, STREAMED

   `/agents/run` is a POST that answers with an SSE stream, which `EventSource`
   cannot do — it only ever issues a GET. So the body is read off `fetch` and
   the frames are parsed by hand.

   Every frame is handed over the moment it arrives. A run takes as long as the
   scrape takes, and an operator watching a progress bar that only moves at the
   end has been told nothing.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AgentFrame {
  event: string
  [key: string]: unknown
}

export interface AgentRosterResponse {
  event?: string
  order?: string[]
  model?: { configured: boolean; reason: string }
  agents?: unknown[]
  error?: string
}

/**
 * Runs the eight-agent pipeline, calling `onFrame` for each event.
 *
 * Resolves when the stream ends. Rejects only when the run could not be
 * started — once frames are arriving, a failure is reported *in* the stream,
 * because a run that produced six agents' work before stopping did produce it.
 */
export async function runAgentPipeline(
  body: {
    keywords: string[]
    overrides?: Record<string, Record<string, string | number | boolean>>
    stopAfter?: string
  },
  onFrame: (frame: AgentFrame) => void,
  signal?: AbortSignal,
): Promise<void> {
  const response = await fetch(`${API_BASE}/agents/run`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok || !response.body) {
    throw new Error(
      `The agent backend answered ${response.status}. Is the API running on ${API_BASE}?`,
    )
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  const drain = (chunk: string): void => {
    buffer += chunk
    // SSE frames are separated by a blank line; a partial frame stays buffered.
    const frames = buffer.split('\n\n')
    buffer = frames.pop() ?? ''
    for (const frame of frames) {
      const line = frame.split('\n').find((l) => l.startsWith('data:'))
      if (!line) continue
      try {
        onFrame(JSON.parse(line.slice(5).trim()) as AgentFrame)
      } catch {
        // A malformed frame costs one event, never the run.
      }
    }
  }

  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    drain(decoder.decode(value, { stream: true }))
  }
  drain(decoder.decode())
}

/* ═══════════════════════════════════════════════════════════════════════════
   SESSION
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SessionInfo {
  role: 'marketing' | 'leadership' | null
  actor: string | null
  /** False when no OPERATOR_PASSWORD is configured — the gate is open, and says so. */
  enforced: boolean
}

/**
 * The server said no. Distinct from the API being unreachable, because the
 * two mean opposite things at the sign-in screen: a refusal must be shown
 * and block; an absent API means the product runs standalone.
 */
export class SignInRefused extends Error {}

/** Signs in. Throws `SignInRefused` with the server's own sentence when refused. */
export async function signIn(
  role: 'marketing' | 'leadership',
  password: string,
): Promise<SessionInfo> {
  const response = await fetch(`${API_BASE}/session`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ role, password }),
  })
  if (response.status === 400 || response.status === 401) {
    const parsed: unknown = await response.json().catch(() => null)
    const reason =
      parsed !== null && typeof parsed === 'object' && 'error' in parsed
        ? String((parsed as { error: unknown }).error)
        : 'Sign-in was refused.'
    throw new SignInRefused(reason)
  }
  if (!response.ok) throw new Error(`Request failed with ${response.status}.`)
  return (await response.json()) as SessionInfo
}

/** The current session, or `role: null`. Never throws on absence. */
export async function currentSession(): Promise<SessionInfo | null> {
  try {
    return await request<SessionInfo>('/session')
  } catch {
    return null
  }
}

export async function signOut(): Promise<void> {
  await request('/session', { method: 'DELETE' })
}

/** What the Competitor Intelligence tab reads. */
export interface CompetitorsState {
  universe: Competitor[]
  intelligence: CompetitorIntelligence
  market: MarketReport | null
  status: CompetitorRunStatus
  methodology: {
    repository: string | null
    commit: string | null
    synced_at: string | null
    skills: Array<{ name: string; version: string | null }>
    available: { available: boolean; reason: string | null }
    tools: Array<{ tool: string; bound_to: string; available: boolean; note: string }>
  }
}

/** A competitor as the add / edit form sends it. */
export type CompetitorDraft = Omit<Competitor, 'id' | 'slug' | 'created_at' | 'updated_at' | 'last_analyzed_at' | 'is_self'> & { slug?: string }

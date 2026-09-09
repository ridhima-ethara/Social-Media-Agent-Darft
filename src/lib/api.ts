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
  Platform,
  RegistrySkill,
  ReviewQueueItem,
  RuntimeEvent,
  StatePayload,
  ToolListEntry,
  ToolSuggestion,
  ValidationVerdict,
} from '../types'

export const API_BASE =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:4000/api'

/* ═══════════════════════════════════════════════════════════════════════════
   THE TRANSPORT
   ═══════════════════════════════════════════════════════════════════════════ */

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  timeoutMs?: number
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const { method = 'GET', body, timeoutMs = 30_000 } = options

  const response = await fetch(`${API_BASE}${path}`, {
    method,
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
  }> => request('/pipeline/run', { method: 'POST', body, timeoutMs: 300_000 }),

  runs: (): Promise<{ agentRuns: unknown[]; skillRuns: unknown[]; latest: unknown }> =>
    request('/runs'),

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
  }): Promise<{ entry: KnowledgeEntry }> => request('/knowledge', { method: 'POST', body }),

  toggleKnowledge: (id: string, active: boolean): Promise<{ entry: KnowledgeEntry }> =>
    request(`/knowledge/${id}`, { method: 'PATCH', body: { active } }),

  /* ── Ideas and content ─────────────────────────────────────────────────── */

  generateDraft: (
    id: string,
    body: { platform?: Platform; withImage?: boolean } = {},
  ): Promise<{ draft?: Draft; media?: MediaAsset; [key: string]: unknown }> =>
    request(`/ideas/${id}/draft`, { method: 'POST', body, timeoutMs: 120_000 }),

  renderImage: (
    id: string,
    body: { platform: Platform; model?: string; prompt?: string; instruction?: string },
  ): Promise<{ media: MediaAsset }> =>
    request(`/ideas/${id}/image`, { method: 'POST', body, timeoutMs: 120_000 }),

  instruct: (
    id: string,
    body: { platform: Platform; instruction: string },
  ): Promise<{
    draft: Draft
    note: string
    compliance: unknown
    preference: { title: string; content: string } | null
    skills: unknown[]
  }> => request(`/ideas/${id}/instruct`, { method: 'POST', body, timeoutMs: 120_000 }),

  updateIdea: (
    id: string,
    body: {
      date?: string
      time?: string
      platform?: Platform
      status?: string
      draft?: string
      calendarSlot?: 'primary' | 'suggestion'
    },
  ): Promise<{ ok: boolean; idea: Idea; demoted: { id: string; title: string } | null }> =>
    request(`/ideas/${id}`, { method: 'PATCH', body }),

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

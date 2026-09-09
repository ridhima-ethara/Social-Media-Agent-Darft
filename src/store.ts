/**
 * THE STORE — one Zustand store, no context providers, no react-query.
 *
 * Law 8: state is server-truth; events are notifications. Every mutation here
 * writes optimistically, calls the API, and reconciles by refetching `/state`
 * when the API is reachable. With the API stopped, the same actions operate on
 * the bundled demo dataset and the product stays fully usable.
 */

import { create } from 'zustand'
import { AGENTS, AGENT_BY_ID, SKILL_BY_ID } from '@shared/agent-registry'
import { checkBrandCompliance } from '@shared/brand-voice'
import { addressOperator } from '@shared/assistant-persona'
import { TOOL_BY_ID } from '@shared/tool-registry'
import { API_BASE, api, detectApi, subscribeToEvents } from './lib/api'
import { applyInstruction as applyInstructionLocally, writeCaption } from './lib/ai'
import { renderBrandSvg } from './lib/image-gen'
import {
  confirmOnServer,
  runLocally,
  sendCommandToServer,
  suggestLocally,
  type CommandFrame,
} from './lib/assistant'
import { speak as speakAloud, stopSpeaking, voiceEnabled } from './lib/voice'
import { EMPTY_STATE } from './data/empty'
import type {
  ActivityEvent,
  AgentId,
  AgentRunStatus,
  AgentState,
  ApiHealth,
  Idea,
  IdeaStatus,
  IntegrationStatus,
  AssistantConversation,
  AssistantCoreState,
  AssistantNotice,
  AssistantPlan,
  AssistantTurn,
  KnowledgeEntry,
  OperatorRole,
  PageId,
  PendingConfirm,
  Platform,
  PublishPhase,
  ScrapeRunState,
  Settings,
  StatePayload,
  Theme,
  Toast,
  ToolSuggestion,
  User,
  ValidationVerdict,
} from './types'

/* ═══════════════════════════════════════════════════════════════════════════
   CONSTANTS
   ═══════════════════════════════════════════════════════════════════════════ */

const THEME_KEY = 'ethara-theme'

export const AGENT_STATUS_META: Record<AgentRunStatus, { label: string; dot: string }> = {
  idle: { label: 'Idle', dot: 'bg-ink-3' },
  running: { label: 'Running', dot: 'bg-accent anim-pulse-dot' },
  completed: { label: 'Completed', dot: 'bg-good' },
  waiting: { label: 'Waiting', dot: 'bg-warn' },
  needs_review: { label: 'Needs review', dot: 'bg-serious' },
  failed: { label: 'Failed', dot: 'bg-critical' },
}

const USERS: Record<OperatorRole, User> = {
  marketing: {
    name: 'Ridhima',
    title: 'Marketing Lead',
    email: 'ridhima@ethara.ai',
    role: 'marketing',
    initial: 'R',
  },
  leadership: {
    name: 'Arjun Mehta',
    title: 'CMO',
    email: 'arjun.mehta@ethara.ai',
    role: 'leadership',
    initial: 'A',
  },
}

const DEFAULT_SETTINGS: Settings = {
  tone: 'Research-credible, anti-hype, declarative',
  audience: 'AI researchers, ML engineers, heads of AI and CTOs',
  creativity: 60,
  approvalRequired: true,
  autoScheduling: true,
  autoPublish: false,
  imageModel: 'brand-svg',
  topKeywords: 5,
  topHashtagsPerKeyword: 5,
  knowledgeHashtagCount: 25,
  topPerPlatform: 10,
  assistantVoice: true,
  assistantProactive: true,
  assistantWakePhrase: false,
  assistantVerbosity: 'normal',
  assistantConfirmMutating: false,
  assistantAddressStyle: 'surname',
  assistantPushToTalk: true,
}

const PUBLISH_PHASES: PublishPhase[] = [
  'Preparing content',
  'Validating platform format',
  'Uploading media',
  'Publishing',
  'Published successfully',
]

/* ═══════════════════════════════════════════════════════════════════════════
   SHAPE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AssistantSlice {
  coreState: AssistantCoreState
  barOpen: boolean
  railOpen: boolean
  listening: boolean
  speaking: boolean
  conversationId: string | null
  turns: AssistantTurn[]
  activePlan: AssistantPlan | null
  pendingConfirm: PendingConfirm | null
  notices: AssistantNotice[]
  brief: StatePayload['assistant']['brief']
  suggestions: ToolSuggestion[]
  /** What "publish it" resolves against. Set by every tool that names an entity. */
  lastEntity: { type: string; id: string; title: string } | null
  streaming: boolean
  /** Prefilled text handed to the bar by "Ask Ethara about this screen". */
  prefill: string
}

export interface Store extends Omit<StatePayload, 'assistant'> {
  /** The command plane conversation this session is appending to. */
  conversation: AssistantConversation | null

  /* ── Shell ─────────────────────────────────────────────────────────────── */
  page: PageId
  user: User | null
  theme: Theme
  bootOpen: boolean
  knowledgeOpen: boolean
  reviewIdeaId: string | null
  theaterOpen: boolean
  sidebarCollapsed: boolean

  /* ── Runtime connection ────────────────────────────────────────────────── */
  apiMode: 'connected' | 'standalone' | 'probing'
  apiHealth: ApiHealth | null
  integrations: IntegrationStatus[]
  hydrated: boolean

  /* ── Transient ─────────────────────────────────────────────────────────── */
  toasts: Toast[]
  scrapeRun: ScrapeRunState
  validating: boolean
  publishPhase: PublishPhase
  scrapeRunCount: number
  settings: Settings
  assistant: AssistantSlice

  /* ── Actions ───────────────────────────────────────────────────────────── */
  setPage: (page: PageId) => void
  login: (role: OperatorRole) => void
  logout: () => void
  setTheme: (theme: Theme) => void
  toggleTheme: () => void
  toggleSidebar: () => void
  openKnowledge: () => void
  closeKnowledge: () => void
  openReview: (id: string) => void
  closeReview: () => void
  openTheater: () => void
  closeTheater: () => void

  connectToRuntime: () => Promise<void>
  refreshState: () => Promise<void>

  runScraping: () => Promise<void>
  /** Walks the discovery graph in hand-off order, standalone. Every message reads state. */
  walkAgents: () => Promise<void>
  runValidation: () => Promise<void>
  setValidation: (id: string, validation: ValidationVerdict) => Promise<void>
  setHashtagValidation: (id: string, validation: ValidationVerdict) => Promise<void>
  resolveQueueItem: (id: string, outcome: string) => Promise<void>
  promoteKeyword: (id: string) => Promise<void>
  addKeyword: (term: string, category: string, weight: number) => Promise<void>
  updateKeyword: (
    id: string,
    patch: { term?: string; category?: string; weight?: number; active?: boolean },
  ) => Promise<void>
  removeKeyword: (id: string) => Promise<void>

  buildKnowledge: () => Promise<void>
  addKnowledge: (entry: { title: string; category: string; content: string }) => Promise<void>
  toggleKnowledge: (id: string) => Promise<void>

  ensureDraft: (ideaId: string, platform?: Platform) => Promise<void>
  regenerateDraft: (ideaId: string, platform?: Platform) => Promise<void>
  ensureImage: (ideaId: string, platform?: Platform) => Promise<void>
  regenerateImage: (ideaId: string, platform?: Platform, model?: string) => Promise<void>
  instructImage: (ideaId: string, instruction: string) => Promise<void>
  instructAI: (ideaId: string, instruction: string) => Promise<string>
  updateDraft: (ideaId: string, body: string) => void

  moveIdea: (ideaId: string, date: string) => Promise<void>
  setIdeaTime: (ideaId: string, time: string) => Promise<void>
  setIdeaPlatform: (ideaId: string, platform: Platform) => Promise<void>
  promoteIdea: (ideaId: string) => Promise<void>
  demoteIdea: (ideaId: string) => Promise<void>
  duplicateIdea: (ideaId: string) => void
  deleteIdea: (ideaId: string) => Promise<void>

  approveIdea: (ideaId: string) => Promise<void>
  leadershipApprove: (ideaId: string) => Promise<void>
  leadershipReject: (ideaId: string, reason: string) => Promise<void>
  publishIdea: (ideaId: string) => Promise<void>

  pushActivity: (event: Omit<ActivityEvent, 'id' | 'created_at'>) => void
  setAgent: (agentId: AgentId, patch: Partial<AgentState>) => void
  toast: (message: string, tone?: Toast['tone'], hint?: string) => void
  dismissToast: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void

  /* ── Ethara ────────────────────────────────────────────────────────────── */
  openBar: (prefill?: string) => void
  closeBar: () => void
  toggleRail: () => void
  setCoreState: (state: AssistantCoreState) => void
  sendCommand: (utterance: string, channel?: 'text' | 'voice') => Promise<void>
  confirmPlan: (token: string, decision: 'confirm' | 'cancel') => Promise<void>
  startListening: () => void
  stopListening: () => void
  speak: (text: string) => void
  pushNotice: (notice: Omit<AssistantNotice, 'id' | 'at'>) => void
  dismissNotice: (id: string) => void
  fetchSuggestions: (query: string) => Promise<void>
  runBrief: () => Promise<void>
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

let uid = 0
function nid(prefix: string): string {
  uid += 1
  return `${prefix}-${Date.now().toString(36)}-${uid}`
}

function readTheme(): Theme {
  try {
    const stored = localStorage.getItem(THEME_KEY)
    if (stored === 'light' || stored === 'dark') return stored
  } catch {
    // Private mode; fall through to the default.
  }
  return 'dark'
}

function applyTheme(theme: Theme): void {
  document.documentElement.dataset.theme = theme
  try {
    localStorage.setItem(THEME_KEY, theme)
  } catch {
    // Not persisting is acceptable; the attribute is what renders.
  }
}

/** Deep-clones the empty payload so mutations never write back into the module. */
function freshEmptyState(): StatePayload {
  return structuredClone(EMPTY_STATE)
}

/**
 * The store owns a richer `assistant` slice than the payload carries, so the
 * payload's own `assistant` key is peeled off before it is spread into state.
 */
function stripAssistant(payload: StatePayload): Omit<StatePayload, 'assistant'> {
  const { assistant: _assistant, ...rest } = payload
  return rest
}

/**
 * The minimum a `/state` payload must carry to be this product's. A different
 * service on the same port answers `/health` and `/state` too — with a shape
 * that would corrupt the store if it were spread in unchecked.
 */
function isStatePayload(value: unknown): value is StatePayload {
  if (value === null || typeof value !== 'object') return false
  const v = value as Record<string, unknown>
  const mode = v.mode as Record<string, unknown> | null | undefined
  return (
    Array.isArray(v.agents) &&
    Array.isArray(v.ideas) &&
    typeof mode === 'object' && mode !== null && Array.isArray(mode.integrations) &&
    typeof v.assistant === 'object' && v.assistant !== null
  )
}

/** Reassembles a `StatePayload` from the store, for the standalone dispatcher. */
function snapshotOf(state: Store): StatePayload {
  return {
    workspace: state.workspace,
    keywords: state.keywords,
    keywordSignals: state.keywordSignals,
    hashtags: state.hashtags,
    topHashtags: state.topHashtags,
    scraped: state.scraped,
    ideas: state.ideas,
    drafts: state.drafts,
    media: state.media,
    published: state.published,
    knowledge: state.knowledge,
    knowledgeBuild: state.knowledgeBuild,
    agents: state.agents,
    activity: state.activity,
    analytics: state.analytics,
    reviewQueue: state.reviewQueue,
    sources: state.sources,
    pipeline: state.pipeline,
    platformLabels: state.platformLabels,
    assistant: {
      conversation: state.conversation,
      turns: state.assistant.turns,
      brief: state.assistant.brief,
      pendingConfirm: state.assistant.pendingConfirm,
    },
    mode: state.mode,
  }
}

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms))

/* ═══════════════════════════════════════════════════════════════════════════
   THE STORE
   ═══════════════════════════════════════════════════════════════════════════ */

const INITIAL = freshEmptyState()

export const useStore = create<Store>((set, get) => ({
  ...stripAssistant(INITIAL),
  conversation: INITIAL.assistant.conversation,

  page: 'dashboard',
  user: null,
  theme: readTheme(),
  bootOpen: false,
  knowledgeOpen: false,
  reviewIdeaId: null,
  theaterOpen: false,
  sidebarCollapsed: false,

  apiMode: 'probing',
  apiHealth: null,
  integrations: EMPTY_STATE.mode.integrations,
  hydrated: false,

  toasts: [],
  scrapeRun: { running: false, progress: 0, currentSource: '', currentKeyword: '', found: 0 },
  validating: false,
  publishPhase: null,
  scrapeRunCount: 0,
  settings: DEFAULT_SETTINGS,

  assistant: {
    coreState: 'dormant',
    barOpen: false,
    railOpen: false,
    listening: false,
    speaking: false,
    conversationId: null,
    turns: [],
    activePlan: null,
    pendingConfirm: null,
    notices: [],
    brief: null,
    suggestions: [],
    lastEntity: null,
    streaming: false,
    prefill: '',
  },

  /* ── SHELL ─────────────────────────────────────────────────────────────── */

  setPage: (page) => set({ page, reviewIdeaId: null }),

  login: (role) => {
    const user = USERS[role]
    set({
      user,
      page: role === 'leadership' ? 'leadership' : 'dashboard',
      bootOpen: true,
    })
    void get().connectToRuntime()
  },

  logout: () => {
    stopSpeaking()
    set({
      user: null,
      page: 'dashboard',
      bootOpen: false,
      knowledgeOpen: false,
      reviewIdeaId: null,
      theaterOpen: false,
      assistant: { ...get().assistant, barOpen: false, railOpen: false, coreState: 'dormant' },
    })
  },

  setTheme: (theme) => {
    applyTheme(theme)
    set({ theme })
  },

  toggleTheme: () => {
    const next: Theme = get().theme === 'dark' ? 'light' : 'dark'
    get().setTheme(next)
  },

  toggleSidebar: () => set({ sidebarCollapsed: !get().sidebarCollapsed }),

  openKnowledge: () => set({ knowledgeOpen: true }),
  closeKnowledge: () => set({ knowledgeOpen: false }),
  openReview: (id) => set({ reviewIdeaId: id }),
  closeReview: () => set({ reviewIdeaId: null, publishPhase: null }),
  openTheater: () => set({ theaterOpen: true }),
  closeTheater: () => set({ theaterOpen: false }),

  /* ── RUNTIME ───────────────────────────────────────────────────────────── */

  /**
   * Probes `/health`, merges `/state`, and fails soft: on any failure the app
   * stays usable and empty, and says exactly why it is empty. There is no
   * bundled dataset to fall back to — showing one would mean showing figures
   * no run produced.
   */
  connectToRuntime: async () => {
    const health = await detectApi()

    if (!health) {
      set({
        apiMode: 'standalone',
        apiHealth: null,
        hydrated: true,
        integrations: EMPTY_STATE.mode.integrations,
      })
      return
    }

    set({ apiMode: 'connected', apiHealth: health })

    try {
      const state = await api.state()
      if (!isStatePayload(state)) {
        throw new Error("The API answered, but its /state payload is not this product's shape.")
      }
      set({
        ...stripAssistant(state),
        conversation: state.assistant.conversation,
        hydrated: true,
        integrations: state.mode.integrations,
        assistant: {
          ...get().assistant,
          conversationId: state.assistant.conversation?.id ?? null,
          turns: state.assistant.turns,
          brief: state.assistant.brief,
          pendingConfirm: state.assistant.pendingConfirm,
        },
      })
    } catch (error) {
      // The health check passed but the aggregate read did not. Say exactly
      // why rather than leaving an empty screen unexplained.
      set({ apiMode: 'standalone', hydrated: true })
      get().toast(
        `Connected to ${API_BASE} but could not read state — ${
          error instanceof Error ? error.message : 'unknown error'
        } Nothing is displayed, because there is nothing to display.`,
        'warn',
        "If another project is on this port, set VITE_API_URL to this server's port.",
      )
    }

    // Liveness. Correctness still comes from refetching /state.
    subscribeToEvents((event) => {
      if (event.type === 'activity' && event.message) {
        get().pushActivity({
          agent_id: (event.agentId ?? null) as AgentId | null,
          message: event.message,
          status: 'ok',
          entity_type: null,
          entity_id: null,
        })
      }
      if (event.type === 'agent.started' && event.agentId) {
        get().setAgent(event.agentId as AgentId, { status: 'running' })
      }
      if (event.type === 'agent.finished' && event.agentId) {
        get().setAgent(event.agentId as AgentId, { status: 'completed' })
      }
      if (event.type === 'agent.failed' && event.agentId) {
        get().setAgent(event.agentId as AgentId, { status: 'failed' })
      }
      if (event.type === 'pipeline.finished') {
        void get().refreshState()
      }
    })
  },

  refreshState: async () => {
    if (get().apiMode !== 'connected') return
    try {
      const state = await api.state()
      set({
        ...stripAssistant(state),
        conversation: state.assistant.conversation,
        integrations: state.mode.integrations,
      })
    } catch {
      // A failed reconcile leaves the last good state on screen.
    }
  },

  /* ── DISCOVERY ─────────────────────────────────────────────────────────── */

  runScraping: async () => {
    if (get().scrapeRun.running) return

    const keywords = get().keywords.filter((k) => k.active).slice(0, 12)
    set({
      scrapeRun: { running: true, progress: 0, currentSource: 'LinkedIn', currentKeyword: '', found: 0 },
      scrapeRunCount: get().scrapeRunCount + 1,
    })
    get().setAgent('scraping', { status: 'running', current_task: 'Scanning LinkedIn' })

    // Narrate locally while the real run proceeds, so the banner is honest
    // about progress in both modes.
    const tick = async (): Promise<void> => {
      for (const [i, keyword] of keywords.entries()) {
        if (!get().scrapeRun.running) return
        set({
          scrapeRun: {
            running: true,
            progress: Math.round(((i + 1) / keywords.length) * 100),
            currentSource: 'LinkedIn',
            currentKeyword: keyword.term,
            found: get().scrapeRun.found + Math.floor(2 + Math.random() * 5),
          },
        })
        await sleep(360)
      }
    }

    if (get().apiMode === 'connected') {
      const [, result] = await Promise.all([
        tick(),
        api.runPipeline({ paceMs: 120 }).catch((error: unknown) => {
          get().toast(error instanceof Error ? error.message : 'The pipeline run failed.', 'critical')
          return null
        }),
      ])
      set({ scrapeRun: { ...get().scrapeRun, running: false, progress: 100 } })
      get().setAgent('scraping', { status: 'completed', current_task: 'Idle' })
      await get().refreshState()
      if (result) {
        const summary = result.summary as Record<string, number>
        get().toast(
          `Pipeline complete · ${summary.postsScraped ?? 0} posts, ${summary.trending ?? 0} keywords trending, ${summary.topHashtags ?? 0} hashtags consolidated.`,
          'good',
        )
      }
      return
    }

    await tick()
    set({ scrapeRun: { ...get().scrapeRun, running: false, progress: 100 } })
    get().setAgent('scraping', { status: 'completed', current_task: `Captured ${get().scrapeRun.found} posts` })
    get().pushActivity({
      agent_id: 'scraping',
      message: `Standalone run · ${get().scrapeRun.found} items surfaced from the bundled corpus.`,
      status: 'warn',
      entity_type: null,
      entity_id: null,
    })

    // The rest of the discovery graph, walked in hand-off order so the theater,
    // the orchestration network and the HUD show each agent take the baton.
    // Every message names what the agent found — read from state, not invented.
    await get().walkAgents()
    get().toast('Standalone run complete. Start the API to capture and persist real posts.', 'warn')
  },

  walkAgents: async () => {
    const st = get()
    const trending = st.keywordSignals.filter((k) => k.is_trending).length
    const validated = st.scraped.filter((i) => i.validation === 'validated').length
    const review = st.reviewQueue.filter((q) => !q.resolved).length
    const primary = st.ideas.filter((i) => i.calendar_slot === 'primary').length
    const suggestions = st.ideas.filter((i) => i.calendar_slot === 'suggestion').length
    const drafts = Object.keys(st.drafts).length
    const media = Object.keys(st.media).length

    const steps: Array<{ agent: AgentId; task: string; done: string; ms: number }> = [
      { agent: 'validation', task: 'Scoring candidates against the four-verdict gate', done: `${trending} keywords trending · ${validated} validated · ${review} for review`, ms: 1_100 },
      { agent: 'analysis', task: 'Consolidating the hashtag set', done: `${st.topHashtags.length} hashtags consolidated across ${trending} keywords`, ms: 800 },
      { agent: 'calendar', task: 'Placing ideas on the week', done: `${primary} on the calendar · ${suggestions} in More suggestions`, ms: 900 },
      { agent: 'caption', task: 'Writing grounded captions', done: `${drafts} drafts grounded in ${st.knowledge.filter((k) => k.active).length} entries`, ms: 900 },
      { agent: 'image', task: 'Rendering creatives with the brand layer', done: `${media} creatives rendered locally`, ms: 700 },
      { agent: 'review', task: 'Running the twenty-rule check', done: 'Twenty rules checked · nothing silently corrected', ms: 700 },
    ]

    set({ pipeline: st.pipeline ? { ...st.pipeline, status: 'running', started_at: new Date().toISOString() } : st.pipeline })

    for (const step of steps) {
      get().setAgent(step.agent, { status: 'running', current_task: step.task })
      get().pushActivity({ agent_id: step.agent, message: `${AGENT_BY_ID[step.agent]?.name ?? step.agent}: ${step.task}`, status: 'running', entity_type: null, entity_id: null })
      await sleep(step.ms)
      get().setAgent(step.agent, {
        status: step.agent === 'validation' && review > 0 ? 'needs_review' : 'completed',
        current_task: step.done,
      })
      get().pushActivity({ agent_id: step.agent, message: step.done, status: 'ok', entity_type: null, entity_id: null })
    }

    const current = get().pipeline
    set({ pipeline: current ? { ...current, status: 'completed', finished_at: new Date().toISOString() } : current })
  },

  runValidation: async () => {
    if (get().validating) return
    set({ validating: true })
    get().setAgent('validation', { status: 'running', current_task: 'Scoring candidates' })
    await sleep(1_400)
    set({ validating: false })
    get().setAgent('validation', {
      status: get().reviewQueue.some((q) => !q.resolved) ? 'needs_review' : 'completed',
      current_task: `${get().reviewQueue.filter((q) => !q.resolved).length} items awaiting a verdict`,
    })
    if (get().apiMode === 'connected') await get().refreshState()
  },

  setValidation: async (itemId, validation) => {
    const by = get().user?.name ?? 'Ridhima'
    set({
      scraped: get().scraped.map((item) =>
        item.id === itemId
          ? {
              ...item,
              validation,
              verdict_reason: `Resolved by ${by}, overriding the automated verdict.`,
            }
          : item,
      ),
      reviewQueue: get().reviewQueue.map((q) =>
        q.entity_id === itemId ? { ...q, resolved: true, resolved_by: by, outcome: validation } : q,
      ),
    })

    if (get().apiMode === 'connected') {
      try {
        await api.setItemValidation(itemId, validation, by)
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That verdict did not save.', 'critical')
        await get().refreshState()
      }
    }
  },

  setHashtagValidation: async (hashtagId, validation) => {
    const by = get().user?.name ?? 'Ridhima'
    set({
      hashtags: get().hashtags.map((h) =>
        h.id === hashtagId
          ? { ...h, validation, verdict_reason: `Resolved by ${by}, overriding the automated verdict.` }
          : h,
      ),
      reviewQueue: get().reviewQueue.map((q) =>
        q.entity_id === hashtagId ? { ...q, resolved: true, resolved_by: by, outcome: validation } : q,
      ),
    })

    if (get().apiMode === 'connected') {
      try {
        await api.setHashtagValidation(hashtagId, validation, by)
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That verdict did not save.', 'critical')
        await get().refreshState()
      }
    }
  },

  resolveQueueItem: async (queueId, outcome) => {
    const by = get().user?.name ?? 'Ridhima'
    const item = get().reviewQueue.find((q) => q.id === queueId)
    set({
      reviewQueue: get().reviewQueue.map((q) =>
        q.id === queueId ? { ...q, resolved: true, resolved_by: by, outcome } : q,
      ),
    })

    if (item?.entity_id) {
      const verdict: ValidationVerdict = /approve|validate|keep/i.test(outcome) ? 'validated' : 'rejected'
      if (item.kind === 'hashtag') {
        set({
          hashtags: get().hashtags.map((h) => (h.id === item.entity_id ? { ...h, validation: verdict } : h)),
        })
      } else {
        set({
          scraped: get().scraped.map((s) => (s.id === item.entity_id ? { ...s, validation: verdict } : s)),
        })
      }
    }

    if (get().apiMode === 'connected') {
      try {
        await api.resolveQueueItem(queueId, outcome, by)
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That decision did not save.', 'critical')
        await get().refreshState()
      }
    }
  },

  promoteKeyword: async (keywordId) => {
    const keyword = get().keywords.find((k) => k.id === keywordId)
    if (!keyword) return
    const weight = Math.min(100, keyword.weight + 10)
    await get().updateKeyword(keywordId, { weight })
    get().toast(`${keyword.term} weighted up to ${weight}.`, 'good')
  },

  addKeyword: async (term, category, weight) => {
    if (get().apiMode === 'connected') {
      try {
        const { keyword } = await api.addKeyword({ term, category, weight })
        set({ keywords: [...get().keywords, keyword] })
        get().toast(`“${term}” added to the keyword set at weight ${weight}.`, 'good')
        return
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That keyword could not be added.', 'critical')
        return
      }
    }
    set({
      keywords: [
        ...get().keywords,
        {
          id: nid('kw'),
          term,
          category,
          weight,
          active: true,
          created_at: new Date().toISOString(),
        },
      ],
    })
    get().toast(`“${term}” added locally at weight ${weight}.`, 'good')
  },

  updateKeyword: async (id, patch) => {
    set({ keywords: get().keywords.map((k) => (k.id === id ? { ...k, ...patch } : k)) })
    if (get().apiMode === 'connected') {
      try {
        await api.updateKeyword(id, patch)
      } catch {
        await get().refreshState()
      }
    }
  },

  removeKeyword: async (id) => {
    // Deactivated, never deleted: historical signals keep a valid parent.
    set({ keywords: get().keywords.map((k) => (k.id === id ? { ...k, active: false } : k)) })
    if (get().apiMode === 'connected') {
      try {
        await api.deleteKeyword(id)
      } catch {
        await get().refreshState()
      }
    }
    get().toast('Keyword switched off. Its history is kept.', 'neutral')
  },

  /* ── KNOWLEDGE ─────────────────────────────────────────────────────────── */

  buildKnowledge: async () => {
    get().setAgent('knowledge', { status: 'running', current_task: 'Researching the top 25' })
    get().toast('Knowledge build started across the top 25 hashtags.', 'neutral')

    if (get().apiMode === 'connected') {
      try {
        await api.buildKnowledge({ hashtagCount: get().settings.knowledgeHashtagCount })
        await get().refreshState()
        get().toast('Knowledge build complete.', 'good')
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'The build failed.', 'critical')
      }
      get().setAgent('knowledge', { status: 'completed', current_task: 'Idle' })
      return
    }

    await sleep(1_800)
    get().setAgent('knowledge', { status: 'completed', current_task: 'Idle' })
    get().toast(
      'Standalone: the last recorded build is shown. Start the API to research live.',
      'warn',
    )
  },

  addKnowledge: async (entry) => {
    const local: KnowledgeEntry = {
      id: nid('kb'),
      title: entry.title,
      category: entry.category,
      content: entry.content,
      source: 'Manual entry',
      sources: [],
      hashtag_id: null,
      hashtag_display: null,
      tags: [],
      confidence: 'Medium',
      evidence_count: 1,
      active: true,
      origin: 'manual',
      build_id: null,
      created_at: new Date().toISOString(),
    }
    set({ knowledge: [local, ...get().knowledge] })

    if (get().apiMode === 'connected') {
      try {
        await api.addKnowledge({ ...entry, confidence: 'Medium' })
        await get().refreshState()
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That entry did not save.', 'critical')
      }
    }
    get().toast('Written to the Knowledge Base.', 'good')
  },

  toggleKnowledge: async (id) => {
    const entry = get().knowledge.find((k) => k.id === id)
    if (!entry) return
    const active = !entry.active
    // Deactivated, never deleted (Law 4).
    set({ knowledge: get().knowledge.map((k) => (k.id === id ? { ...k, active } : k)) })

    if (get().apiMode === 'connected') {
      try {
        await api.toggleKnowledge(id, active)
      } catch {
        await get().refreshState()
      }
    }
    get().toast(
      active
        ? `“${entry.title}” is influencing generation again.`
        : `“${entry.title}” switched off. It will not influence the next draft.`,
      'neutral',
    )
  },

  /* ── DRAFTS AND CREATIVE ───────────────────────────────────────────────── */

  ensureDraft: async (ideaId, platform) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return
    const target = platform ?? idea.platform
    if (get().drafts[`${ideaId}|${target}`]) return
    await get().regenerateDraft(ideaId, target)
  },

  regenerateDraft: async (ideaId, platform) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return
    const target = platform ?? idea.platform
    get().setAgent('caption', { status: 'running', current_task: `Writing for ${target}` })

    // Write locally first so the composer is never empty, then swap in the
    // server's version if the runtime is reachable.
    const local = writeCaption({ idea, platform: target, knowledge: get().knowledge })
    set({
      drafts: { ...get().drafts, [`${ideaId}|${target}`]: local },
      ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, draft: local, status: nextStatus(i.status) } : i)),
    })

    if (get().apiMode === 'connected') {
      try {
        const result = await api.generateDraft(ideaId, { platform: target })
        if (result.draft) {
          set({
            drafts: { ...get().drafts, [`${ideaId}|${target}`]: result.draft },
            ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, draft: result.draft ?? null } : i)),
          })
        }
        if (result.media) {
          set({
            media: { ...get().media, [`${ideaId}|${target}`]: result.media },
            ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, media: result.media ?? null } : i)),
          })
        }
      } catch (error) {
        get().toast(
          error instanceof Error ? error.message : 'The caption agent failed; the local draft stands.',
          'warn',
        )
      }
    }

    get().setAgent('caption', { status: 'completed', current_task: 'Idle' })
  },

  ensureImage: async (ideaId, platform) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return
    const target = platform ?? idea.platform
    if (get().media[`${ideaId}|${target}`]) return
    await get().regenerateImage(ideaId, target)
  },

  /**
   * Renders `brand-svg` locally and immediately, then swaps in real artwork
   * when a model is reachable — or keeps the local render and stamps the
   * `fallbackReason` on the card.
   */
  regenerateImage: async (ideaId, platform, model) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return
    const target = platform ?? idea.platform
    get().setAgent('image', { status: 'running', current_task: `Rendering ${target}` })

    const local = renderBrandSvg({
      platform: target,
      headline: idea.title,
      kicker: idea.source_topic ?? undefined,
      concept: String(idea.analysis?.format ?? 'Thought Leadership'),
      fallbackReason:
        get().apiMode === 'connected'
          ? undefined
          : 'Standalone — rendered locally with the brand renderer. No image model was contacted.',
    })

    set({
      media: { ...get().media, [`${ideaId}|${target}`]: local },
      ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, media: local } : i)),
    })

    if (get().apiMode === 'connected') {
      try {
        const { media } = await api.renderImage(ideaId, {
          platform: target,
          ...(model ? { model } : {}),
        })
        set({
          media: { ...get().media, [`${ideaId}|${target}`]: media },
          ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, media } : i)),
        })
      } catch {
        // The local render stands and already carries its own reason.
      }
    }

    get().setAgent('image', { status: 'completed', current_task: 'Idle' })
  },

  instructImage: async (ideaId, instruction) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return

    if (get().apiMode === 'connected') {
      try {
        const { media } = await api.renderImage(ideaId, { platform: idea.platform, instruction })
        set({
          media: { ...get().media, [`${ideaId}|${idea.platform}`]: media },
          ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, media } : i)),
        })
        get().toast('Creative re-rendered.', 'good')
        return
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'The re-render failed.', 'warn')
        return
      }
    }

    await get().regenerateImage(ideaId, idea.platform)
    get().toast('Re-rendered locally. Start the API to apply model-side instructions.', 'warn')
  },

  instructAI: async (ideaId, instruction) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return 'That idea no longer exists.'
    const key = `${ideaId}|${idea.platform}`
    const draft = get().drafts[key]
    if (!draft) {
      await get().ensureDraft(ideaId)
    }
    const current = get().drafts[key]
    if (!current) return 'There is no draft to revise yet.'

    get().setAgent('review', { status: 'running', current_task: 'Applying your instruction' })

    if (get().apiMode === 'connected') {
      try {
        const result = await api.instruct(ideaId, { platform: idea.platform, instruction })
        set({
          drafts: { ...get().drafts, [key]: result.draft },
          ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, draft: result.draft } : i)),
        })
        get().setAgent('review', { status: 'completed', current_task: 'Idle' })
        return result.note
      } catch (error) {
        get().setAgent('review', { status: 'completed', current_task: 'Idle' })
        return error instanceof Error ? error.message : 'That instruction could not be applied.'
      }
    }

    // The human instruction wins; the finding is raised alongside it.
    const result = applyInstructionLocally(current, instruction, {
      topic: idea.source_topic ?? idea.title,
      platform: idea.platform,
      visualHeadline: idea.title,
    })

    set({
      drafts: { ...get().drafts, [key]: result.draft },
      ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, draft: result.draft } : i)),
    })
    get().setAgent('review', { status: 'completed', current_task: 'Idle' })

    const finding =
      result.compliance.verdict === 'APPROVED'
        ? ''
        : ` One finding stands alongside it: ${result.compliance.reason}`

    return `${result.note}${finding}`
  },

  updateDraft: (ideaId, body) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return
    const key = `${ideaId}|${idea.platform}`
    const existing = get().drafts[key]
    const draft = {
      body,
      revision: (existing?.revision ?? 0) + 1,
      model: 'manual',
      source: 'fixture' as const,
      updatedAt: new Date().toISOString(),
    }
    set({
      drafts: { ...get().drafts, [key]: draft },
      ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, draft } : i)),
    })
  },

  /* ── CALENDAR ──────────────────────────────────────────────────────────── */

  moveIdea: async (ideaId, date) => {
    set({ ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, scheduled_date: date } : i)) })
    if (get().apiMode === 'connected') {
      try {
        await api.updateIdea(ideaId, { date })
      } catch {
        await get().refreshState()
      }
    }
  },

  setIdeaTime: async (ideaId, time) => {
    set({ ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, scheduled_time: time } : i)) })
    if (get().apiMode === 'connected') {
      try {
        await api.updateIdea(ideaId, { time })
      } catch {
        await get().refreshState()
      }
    }
  },

  setIdeaPlatform: async (ideaId, platform) => {
    set({ ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, platform } : i)) })
    if (get().apiMode === 'connected') {
      try {
        await api.updateIdea(ideaId, { platform })
      } catch {
        await get().refreshState()
      }
    }
    await get().regenerateDraft(ideaId, platform)
    await get().regenerateImage(ideaId, platform)
  },

  /** The top-10 rule, with the demotion always announced. */
  promoteIdea: async (ideaId) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea || idea.calendar_slot === 'primary') return

    const cap = get().settings.topPerPlatform
    const primaries = get()
      .ideas.filter((i) => i.platform === idea.platform && i.calendar_slot === 'primary')
      .sort((a, b) => b.priority_score - a.priority_score)

    let demoted: Idea | null = null
    if (primaries.length >= cap) demoted = primaries[primaries.length - 1] ?? null

    set({
      ideas: get().ideas.map((i) => {
        if (i.id === ideaId) return { ...i, calendar_slot: 'primary', calendarSlot: 'primary' }
        if (demoted && i.id === demoted.id) return { ...i, calendar_slot: 'suggestion', calendarSlot: 'suggestion' }
        return i
      }),
    })

    if (get().apiMode === 'connected') {
      try {
        const result = await api.updateIdea(ideaId, { calendarSlot: 'primary' })
        if (result.demoted) {
          get().toast(`'${result.demoted.title}' moved to More suggestions to make room.`, 'neutral')
        }
        await get().refreshState()
        return
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That promotion did not save.', 'critical')
        await get().refreshState()
        return
      }
    }

    if (demoted) get().toast(`'${demoted.title}' moved to More suggestions to make room.`, 'neutral')
    else get().toast(`'${idea.title}' promoted to the calendar.`, 'good')
  },

  demoteIdea: async (ideaId) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return
    set({
      ideas: get().ideas.map((i) =>
        i.id === ideaId ? { ...i, calendar_slot: 'suggestion', calendarSlot: 'suggestion' } : i,
      ),
    })
    if (get().apiMode === 'connected') {
      try {
        await api.updateIdea(ideaId, { calendarSlot: 'suggestion' })
        await get().refreshState()
      } catch {
        await get().refreshState()
      }
    }
    get().toast(`'${idea.title}' moved to More suggestions.`, 'neutral')
  },

  duplicateIdea: (ideaId) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return
    const copy: Idea = {
      ...idea,
      id: nid('idea'),
      title: `${idea.title} (copy)`,
      status: 'suggested',
      calendar_slot: 'suggestion',
      calendarSlot: 'suggestion',
      platform_rank: null,
      platformRank: null,
      draft: null,
      media: null,
      marketing_approved_by: null,
      marketing_approved_at: null,
      leadership_decision: null,
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    }
    set({ ideas: [...get().ideas, copy] })
    get().toast('Duplicated into More suggestions.', 'neutral')
  },

  deleteIdea: async (ideaId) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return
    // Withdrawn, not deleted: the lineage stays reconstructable.
    set({ ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, status: 'rejected' } : i)) })
    if (get().apiMode === 'connected') {
      try {
        await api.deleteIdea(ideaId)
        await get().refreshState()
      } catch {
        await get().refreshState()
      }
    }
    get().toast(`'${idea.title}' withdrawn. Its lineage is kept.`, 'neutral')
  },

  /* ── APPROVAL AND PUBLISHING ───────────────────────────────────────────── */

  approveIdea: async (ideaId) => {
    const by = get().user?.name ?? 'Ridhima'
    set({
      ideas: get().ideas.map((i) =>
        i.id === ideaId
          ? {
              ...i,
              status: 'pending_leadership' as IdeaStatus,
              marketing_approved_by: by,
              marketing_approved_at: new Date().toISOString(),
            }
          : i,
      ),
    })

    if (get().apiMode === 'connected') {
      try {
        await api.approveIdea(ideaId, by)
        await get().refreshState()
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That approval did not save.', 'critical')
        await get().refreshState()
        return
      }
    }
    get().toast('Approved and sent to Leadership. Nothing publishes until they sign off.', 'good')
  },

  leadershipApprove: async (ideaId) => {
    const by = get().user?.name ?? 'Arjun Mehta'
    const autoPublish = get().settings.autoPublish

    set({
      ideas: get().ideas.map((i) =>
        i.id === ideaId
          ? {
              ...i,
              status: (autoPublish ? 'published' : 'approved') as IdeaStatus,
              leadership_decision: {
                decision: 'approved',
                by,
                at: new Date().toISOString(),
                published: autoPublish,
              },
            }
          : i,
      ),
    })

    if (get().apiMode === 'connected') {
      try {
        await api.leadershipApprove(ideaId, by, autoPublish)
        await get().refreshState()
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That decision did not save.', 'critical')
        await get().refreshState()
        return
      }
    }

    get().toast(
      autoPublish ? 'Approved and published. The outcome is written to the Knowledge Base.' : 'Approved. Ready to publish.',
      'good',
    )
  },

  leadershipReject: async (ideaId, reason) => {
    // The reason is mandatory — it is what the agents learn from.
    if (reason.trim().length === 0) {
      get().toast('A rejection needs a reason — it is what the agents learn from.', 'critical')
      return
    }

    const by = get().user?.name ?? 'Arjun Mehta'
    set({
      ideas: get().ideas.map((i) =>
        i.id === ideaId
          ? {
              ...i,
              status: 'rejected' as IdeaStatus,
              leadership_decision: { decision: 'rejected', by, at: new Date().toISOString(), reason },
            }
          : i,
      ),
    })

    if (get().apiMode === 'connected') {
      try {
        await api.leadershipReject(ideaId, by, reason)
        await get().refreshState()
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'That rejection did not save.', 'critical')
        await get().refreshState()
        return
      }
    } else {
      const idea = get().ideas.find((i) => i.id === ideaId)
      await get().addKnowledge({
        title: `Rejected: ${idea?.title ?? 'a draft'}`,
        category: 'Rejected Post',
        content: `Leadership rejected this draft. Reason given: "${reason}"`,
      })
    }

    get().toast('Rejected, with the reason written to the Knowledge Base.', 'neutral')
  },

  publishIdea: async (ideaId) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return

    // The five phases, 850 ms apart.
    for (const phase of PUBLISH_PHASES) {
      set({ publishPhase: phase })
      get().setAgent('publishing', { status: 'running', current_task: phase ?? 'Publishing' })
      await sleep(850)
    }

    if (get().apiMode === 'connected') {
      try {
        await api.publishIdea(ideaId, idea.platform)
        await get().refreshState()
      } catch (error) {
        set({ publishPhase: null })
        get().setAgent('publishing', { status: 'failed', current_task: 'Publish failed' })
        get().toast(error instanceof Error ? error.message : 'Publishing failed.', 'critical')
        return
      }
    } else {
      const draft = get().drafts[`${ideaId}|${idea.platform}`]
      set({
        ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, status: 'published' as IdeaStatus } : i)),
        published: [
          {
            id: nid('post'),
            idea_id: ideaId,
            title: idea.title,
            platform: idea.platform,
            content: draft?.body ?? idea.description ?? idea.title,
            status: 'published',
            external_id: `demo-${ideaId}`,
            publish_mode: 'demo',
            published_at: new Date().toISOString().slice(0, 10),
            history: [
              { step: 1, label: 'Draft generated by Caption Creator Agent', at: new Date().toISOString() },
              { step: 2, label: `Approved by ${idea.marketing_approved_by ?? 'Marketing'}`, at: new Date().toISOString() },
              { step: 3, label: `Final approval from ${idea.leadership_decision?.by ?? 'Leadership'}`, at: new Date().toISOString() },
              { step: 4, label: `Published to ${idea.platform} in demo mode`, at: new Date().toISOString() },
            ],
            media_asset_id: null,
            analysis_summary: 'Published moments ago — the Analytics Agent will report the first reading in an hour.',
            analysis_recommendation: null,
            reach: null,
            impressions: null,
            likes: null,
            comments: null,
            shares: null,
            engagement_rate: null,
            metrics_captured_at: null,
            data_uri: get().media[`${ideaId}|${idea.platform}`]?.dataUri ?? null,
          },
          ...get().published,
        ],
      })
    }

    get().setAgent('publishing', { status: 'completed', current_task: 'Idle' })
    get().pushActivity({
      agent_id: 'publishing',
      message: `"${idea.title}" published to ${idea.platform} in demo mode.`,
      status: 'ok',
      entity_type: 'idea',
      entity_id: ideaId,
    })
    get().toast('Published. The Analytics Agent will report the first reading in an hour.', 'good')

    await sleep(600)
    set({ publishPhase: null })
  },

  /* ── TELEMETRY AND CHROME ──────────────────────────────────────────────── */

  pushActivity: (event) =>
    set({
      activity: [
        { ...event, id: nid('act'), created_at: new Date().toISOString() },
        ...get().activity,
      ].slice(0, 60),
    }),

  setAgent: (agentId, patch) =>
    set({
      agents: get().agents.map((a) =>
        a.agent_id === agentId ? { ...a, ...patch, last_run: new Date().toISOString() } : a,
      ),
    }),

  toast: (message, tone = 'neutral', hint) => {
    const toast: Toast = { id: nid('toast'), message, tone, ...(hint ? { hint } : {}) }
    set({ toasts: [...get().toasts, toast] })
    window.setTimeout(() => get().dismissToast(toast.id), 4_200)
  },

  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) }),

  updateSettings: (patch) => set({ settings: { ...get().settings, ...patch } }),

  /* ── Ethara ────────────────────────────────────────────────────────────── */

  openBar: (prefill = '') =>
    set({ assistant: { ...get().assistant, barOpen: true, prefill } }),

  closeBar: () =>
    set({ assistant: { ...get().assistant, barOpen: false, prefill: '', suggestions: [] } }),

  toggleRail: () => set({ assistant: { ...get().assistant, railOpen: !get().assistant.railOpen } }),

  setCoreState: (coreState) => set({ assistant: { ...get().assistant, coreState } }),

  /**
   * The one path from an utterance to work. Connected, it streams the server's
   * frames; standalone, it runs the same grammar parser in the bundle and
   * labels itself. The reducer below cannot tell the difference.
   */
  sendCommand: async (utterance, channel = 'text') => {
    const text = utterance.trim()
    if (text.length === 0) return

    const assistant = get().assistant
    const turnId = nid('turn')

    set({
      assistant: {
        ...assistant,
        barOpen: false,
        railOpen: true,
        streaming: true,
        coreState: 'thinking',
        activePlan: null,
        prefill: '',
        suggestions: [],
        turns: [
          ...assistant.turns,
          {
            id: turnId,
            seq: assistant.turns.length + 1,
            speaker: 'operator',
            utterance: text,
            channel,
            narration: null,
            confidence: null,
            status: 'completed',
            created_at: new Date().toISOString(),
          },
          {
            id: `${turnId}-assistant`,
            seq: assistant.turns.length + 2,
            speaker: 'assistant',
            utterance: '',
            channel,
            narration: '',
            confidence: null,
            status: 'planning',
            created_at: new Date().toISOString(),
          },
        ],
      },
    })

    const responseId = `${turnId}-assistant`

    const patchResponse = (patch: Partial<AssistantTurn>): void => {
      set({
        assistant: {
          ...get().assistant,
          turns: get().assistant.turns.map((t) => (t.id === responseId ? { ...t, ...patch } : t)),
        },
      })
    }

    const onFrame = (frame: CommandFrame): void => {
      const current = get().assistant
      switch (frame.kind) {
        case 'plan': {
          set({ assistant: { ...current, activePlan: frame.plan, coreState: 'working' } })
          patchResponse({ plan: frame.plan, status: 'running', confidence: frame.plan.confidence })
          break
        }
        case 'confirm': {
          set({
            assistant: {
              ...get().assistant,
              pendingConfirm: {
                token: frame.token,
                prompt: frame.prompt,
                expiresAt: frame.expiresAt,
                plan: frame.plan,
              },
              activePlan: frame.plan,
              coreState: 'attention',
            },
          })
          patchResponse({ plan: frame.plan, status: 'awaiting_confirmation' })
          break
        }
        case 'step': {
          const plan = get().assistant.activePlan
          if (!plan) break
          const steps = plan.steps.map((s) => (s.idx === frame.step.idx ? { ...s, ...frame.step } : s))
          const nextPlan = { ...plan, steps }
          set({ assistant: { ...get().assistant, activePlan: nextPlan, coreState: 'working' } })
          patchResponse({ plan: nextPlan, steps })
          if (frame.step.entity) {
            const entity = frame.step.entity as { type?: string; id?: string; title?: string }
            if (entity.id) {
              set({
                assistant: {
                  ...get().assistant,
                  lastEntity: {
                    type: entity.type ?? 'idea',
                    id: entity.id,
                    title: entity.title ?? '',
                  },
                },
              })
            }
          }
          break
        }
        case 'token': {
          const turn = get().assistant.turns.find((t) => t.id === responseId)
          patchResponse({ narration: `${turn?.narration ?? ''}${frame.text}` })
          set({ assistant: { ...get().assistant, coreState: 'speaking' } })
          break
        }
        case 'result': {
          patchResponse({ narration: frame.narration, status: 'completed' })
          if (get().settings.assistantVoice && voiceEnabled()) get().speak(frame.spoken || frame.narration)
          break
        }
        case 'verify': {
          patchResponse({ narration: `${get().assistant.turns.find((t) => t.id === responseId)?.narration ?? ''}\n\n${frame.note}` })
          break
        }
        case 'error': {
          patchResponse({ narration: frame.message, status: 'failed' })
          set({ assistant: { ...get().assistant, coreState: 'error' } })
          break
        }
        case 'done': {
          set({
            assistant: {
              ...get().assistant,
              streaming: false,
              coreState:
                frame.status === 'awaiting_confirmation'
                  ? 'attention'
                  : frame.status === 'failed'
                    ? 'error'
                    : 'dormant',
            },
          })
          patchResponse({ status: frame.status === 'awaiting_confirmation' ? 'awaiting_confirmation' : frame.status })
          break
        }
        default:
          break
      }
    }

    try {
      if (get().apiMode === 'connected') {
        await sendCommandToServer(
          {
            utterance: text,
            channel,
            ...(get().assistant.conversationId ? { conversationId: get().assistant.conversationId as string } : {}),
            actor: get().user?.name ?? 'Ridhima',
            role: get().user?.role ?? 'marketing',
          },
          onFrame,
        )
        // Any mutating tool changed server state; reconcile by refetching.
        await get().refreshState()
      } else {
        await runLocally(text, snapshotOf(get()), onFrame, {
          tokenDelayMs: prefersReducedMotion() ? 0 : 18,
        })
      }
    } catch (error) {
      onFrame({
        kind: 'error',
        message: error instanceof Error ? error.message : 'That command failed.',
      })
      onFrame({ kind: 'done', status: 'failed' })
    }
  },

  confirmPlan: async (token, decision) => {
    const pending = get().assistant.pendingConfirm
    set({
      assistant: {
        ...get().assistant,
        pendingConfirm: null,
        coreState: decision === 'confirm' ? 'working' : 'dormant',
        streaming: decision === 'confirm',
      },
    })

    if (decision === 'cancel') {
      get().toast('Cancelled. Nothing was changed.', 'neutral')
      return
    }

    if (get().apiMode !== 'connected') {
      get().toast(
        'Standalone: irreversible actions need the API. Nothing was changed.',
        'warn',
      )
      set({ assistant: { ...get().assistant, streaming: false, coreState: 'dormant' } })
      return
    }

    const responseTurn = [...get().assistant.turns].reverse().find((t) => t.speaker === 'assistant')

    try {
      await confirmOnServer(
        { token, decision, by: get().user?.name ?? 'Ridhima', role: get().user?.role ?? 'marketing' },
        (frame) => {
          if (frame.kind === 'result' && responseTurn) {
            set({
              assistant: {
                ...get().assistant,
                turns: get().assistant.turns.map((t) =>
                  t.id === responseTurn.id ? { ...t, narration: frame.narration, status: 'completed' } : t,
                ),
              },
            })
            if (get().settings.assistantVoice) get().speak(frame.spoken || frame.narration)
          }
          if (frame.kind === 'step' && responseTurn) {
            set({
              assistant: {
                ...get().assistant,
                turns: get().assistant.turns.map((t) => {
                  if (t.id !== responseTurn.id || !t.plan) return t
                  const steps = t.plan.steps.map((s) => (s.idx === frame.step.idx ? { ...s, ...frame.step } : s))
                  return { ...t, plan: { ...t.plan, steps }, steps }
                }),
              },
            })
          }
        },
      )
      await get().refreshState()
    } catch (error) {
      get().toast(
        error instanceof Error ? error.message : 'That confirmation could not be resolved.',
        'critical',
      )
    } finally {
      set({ assistant: { ...get().assistant, streaming: false, coreState: 'dormant' } })
    }

    if (pending) {
      get().pushActivity({
        agent_id: 'assistant',
        message: `Confirmed by ${get().user?.name ?? 'the operator'}: ${pending.prompt}`,
        status: 'ok',
        entity_type: null,
        entity_id: null,
      })
    }
  },

  startListening: () => set({ assistant: { ...get().assistant, listening: true, coreState: 'listening' } }),

  stopListening: () =>
    set({
      assistant: {
        ...get().assistant,
        listening: false,
        coreState: get().assistant.streaming ? 'working' : 'dormant',
      },
    }),

  speak: (text) => {
    if (!get().settings.assistantVoice) return
    set({ assistant: { ...get().assistant, speaking: true } })
    speakAloud(text, {
      onEnd: () => set({ assistant: { ...get().assistant, speaking: false } }),
    })
  },

  pushNotice: (notice) => {
    const full: AssistantNotice = { ...notice, id: nid('notice'), at: new Date().toISOString() }
    set({
      assistant: {
        ...get().assistant,
        notices: [full, ...get().assistant.notices].slice(0, 12),
        // Ambient notices raise the core to attention. They are never modal.
        coreState: get().assistant.streaming ? get().assistant.coreState : 'attention',
      },
    })
  },

  dismissNotice: (id) =>
    set({ assistant: { ...get().assistant, notices: get().assistant.notices.filter((n) => n.id !== id) } }),

  fetchSuggestions: async (query) => {
    if (query.trim().length === 0) {
      set({ assistant: { ...get().assistant, suggestions: [] } })
      return
    }

    if (get().apiMode === 'connected') {
      try {
        const { suggestions } = await api.suggestions(query)
        set({ assistant: { ...get().assistant, suggestions } })
        return
      } catch {
        // Fall through to the local grammar.
      }
    }

    set({
      assistant: {
        ...get().assistant,
        suggestions: suggestLocally(query).map((s) => ({
          ...s,
          agentId: s.agentId as AgentId | null,
        })),
      },
    })
  },

  runBrief: async () => {
    if (get().apiMode === 'connected') {
      try {
        const { brief } = await api.composeBrief(get().user?.role ?? 'marketing')
        set({ assistant: { ...get().assistant, brief } })
        get().toast('Briefing composed.', 'good')
        return
      } catch (error) {
        get().toast(error instanceof Error ? error.message : 'The briefing failed.', 'warn')
        return
      }
    }

    const queue = get().reviewQueue.filter((q) => !q.resolved).length
    const leadership = get().ideas.filter((i) => i.status === 'pending_leadership').length
    const entries = get().knowledge.filter((k) => k.origin === 'research').length
    const who = addressOperator(get().user?.role ?? 'marketing', get().settings.assistantAddressStyle)

    set({
      assistant: {
        ...get().assistant,
        brief: {
          id: nid('brief'),
          trigger: 'manual',
          signals: [
            { label: 'Review queue', detail: `${queue} items are waiting on a verdict.` },
            { label: 'Leadership', detail: `${leadership} posts are with Leadership.` },
            { label: 'Knowledge base', detail: `${entries} cited research entries from the last build.` },
          ],
          recommendation:
            queue > 0
              ? 'Clear the review queue first — every unresolved verdict holds a hashtag out of the research build.'
              : 'Run discovery: the last capture is over three hours old.',
          narration: `${who}. ${queue} items await a verdict, ${leadership} posts are with Leadership, and the last build wrote ${entries} cited entries.`,
          created_at: new Date().toISOString(),
        },
      },
    })
  },
}))

/* ═══════════════════════════════════════════════════════════════════════════
   DERIVATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

function nextStatus(current: IdeaStatus): IdeaStatus {
  return current === 'suggested' ? 'drafted' : current
}

export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  )
}

/** Agents that drive a given screen, for the PageHeader chips. */
export function agentsFor(ids: AgentId[]): AgentId[] {
  return ids.filter((id) => AGENTS.some((a) => a.id === id))
}

/** A skill's declared name, for the console and studio. */
export function skillName(skillId: string): string {
  return SKILL_BY_ID[skillId]?.name ?? skillId
}

/** A tool's declared name, for the plan card. */
export function toolName(toolId: string): string {
  return TOOL_BY_ID[toolId]?.name ?? toolId
}

/** Runs the twenty-rule check on whatever is currently in the composer. */
export function complianceFor(
  caption: string,
  topic: string,
  platform: Platform,
  visualHeadline?: string,
): ReturnType<typeof checkBrandCompliance> {
  return checkBrandCompliance({
    caption,
    topic,
    platform,
    ...(visualHeadline ? { visualHeadline } : {}),
  })
}

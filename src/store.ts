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
import { BRAND_TOPICS, checkBrandCompliance } from '@shared/brand-voice'
import { addressOperator } from '@shared/assistant-persona'
import { TOOL_BY_ID } from '@shared/tool-registry'
import { API_BASE, api, detectApi, runAgentPipeline, subscribeToEvents } from './lib/api'
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
  AgentRunState,
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
  LiveCapture,
  LiveLane,
  LiveNote,
  LiveVerdict,
  ModelReference,
  OperatorRole,
  PageId,
  PendingConfirm,
  Platform,
  PublishPhase,
  RuntimeEvent,
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

export interface CorpusStats {
  total: number
  active: number
  /** Subject-matter entries. Only these reach the Scraping Agent. */
  domain: number
  rules: number
  brandTopics: number
  corpusTerms: number
  keywordTerms: number
  /** Everything the next discovery run will judge a captured page against. */
  alignmentTerms: number
}

/** A corpus view with nothing in it yet. Zeroes, never invented figures. */
export const EMPTY_CORPUS_STATS: CorpusStats = {
  total: 0,
  active: 0,
  domain: 0,
  rules: 0,
  brandTopics: BRAND_TOPICS.length,
  corpusTerms: 0,
  keywordTerms: 0,
  alignmentTerms: BRAND_TOPICS.length,
}

export interface CorpusState {
  entries: KnowledgeEntry[]
  stats: CorpusStats
}

/**
 * Derives the corpus view from whatever entries are in hand.
 *
 * Used standalone, and as the optimistic answer before the server replies. The
 * keyword-term count is the one figure the browser cannot know on its own, so it
 * is reported as zero rather than guessed at.
 */
function corpusFromEntries(entries: KnowledgeEntry[]): CorpusState {
  const corpus = entries.filter((e) => e.tags.includes('brand-corpus'))
  const terms = new Set<string>()
  for (const entry of corpus) {
    if (!entry.active) continue
    // Identity entries are corpus but not subject matter, so they contribute no
    // alignment vocabulary. Mirrors BRAND_DOMAIN_TAG on the server.
    if (!entry.tags.includes('brand-domain')) continue
    for (const tag of entry.tags) {
      if (tag === 'brand' || tag === 'brand-corpus' || tag === 'brand-domain') continue
      terms.add(tag.toLowerCase())
    }
  }
  return {
    entries: corpus,
    stats: {
      total: corpus.length,
      active: corpus.filter((e) => e.active).length,
      domain: corpus.filter((e) => e.tags.includes('brand-domain')).length,
      rules: entries.filter((e) => e.tags.includes('brand-rule')).length,
      brandTopics: BRAND_TOPICS.length,
      corpusTerms: terms.size,
      keywordTerms: 0,
      alignmentTerms: BRAND_TOPICS.length + terms.size,
    },
  }
}

export const AGENT_STATUS_META: Record<AgentRunStatus, { label: string; dot: string }> = {
  idle: { label: 'Idle', dot: 'bg-ink-3' },
  running: { label: 'Running', dot: 'bg-accent anim-pulse-dot' },
  completed: { label: 'Completed', dot: 'bg-good' },
  waiting: { label: 'Waiting', dot: 'bg-warn' },
  needs_review: { label: 'Needs review', dot: 'bg-serious' },
  failed: { label: 'Failed', dot: 'bg-critical' },
}

/**
 * The Python backend names its agents in its own namespace, one folder each.
 * This is the only place the two vocabularies meet.
 *
 * `content_agent` is the odd one: the UI has always called that agent
 * `caption`, and the id is a storage key elsewhere in the product, so it is the
 * mapping that bends rather than either side's name.
 *
 * An agent with no entry here is not an error. The backend roster can grow
 * ahead of the UI, and an unmapped agent simply narrates itself in the run log
 * without claiming a tile it has no tile for.
 */
const UI_AGENT_ID: Record<string, AgentId> = {
  scraping_agent: 'scraping',
  validation_agent: 'validation',
  calendar_agent: 'calendar',
  content_agent: 'caption',
  image_agent: 'image',
  publishing_agent: 'publishing',
  analytics_agent: 'analytics',
  learning_agent: 'learning',
}

function uiAgentId(raw: unknown): AgentId | null {
  return UI_AGENT_ID[String(raw ?? '')] ?? null
}

/** Enough of the run log to read back, bounded so a long run cannot grow without limit. */
const FRAME_BUFFER = 200

/**
 * What to tell the operator when the run stops.
 *
 * Deliberately reports the write, not just the work. "Four ideas on the
 * calendar" is only true if four ideas reached the database, and those are two
 * different facts — a run can succeed and still fail to land.
 */
function runReport(run: AgentRunState): [string, Toast['tone'], string?] {
  if (run.error) return [run.error, 'critical']
  if (!run.summary) return ['The run ended before it reported a summary.', 'warn']

  const n = (key: string): number => Number(run.summary?.[key] ?? 0)
  const wrote = run.persisted
  const headline =
    `${n('posts_captured')} posts captured · ${n('keywords_trending')} keywords trending · ` +
    `${n('ideas_on_calendar')} on the calendar, ${n('ideas_in_suggestions')} in suggestions`

  if (!wrote) return [headline, 'warn', 'Nothing was written to the database, so the screen is unchanged.']

  const created = Number(wrote.ideasCreated ?? 0)
  const updated = Number(wrote.ideasUpdated ?? 0)
  const skipped = Array.isArray(wrote.skipped) ? (wrote.skipped as string[]) : []
  return [
    headline,
    run.summary.status === 'completed' ? 'good' : 'warn',
    `${created} idea(s) written, ${updated} updated, ${Number(wrote.hashtags ?? 0)} hashtag(s) recorded.` +
      (skipped.length ? ` ${skipped.join(' ')}` : ''),
  ]
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
  captionModel: 'ethara-writer',
  topKeywords: 5,
  topHashtagsPerKeyword: 5,
  knowledgeHashtagCount: 25,
  topPerPlatform: 5,
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
  /** Prefilled text handed to the bar by a caller that knows what to ask. */
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
  agentRun: AgentRunState
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
  /** Runs the Python agent backend, narrated from its own events. */
  runAgentPipeline: () => Promise<void>
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

  /**
   * The brand corpus: the domain half of the Knowledge Base, and the vocabulary
   * the Scraping Agent scores captured pages against. Held separately from
   * `knowledge` because the counts come from the server, which knows the
   * keyword synonyms the browser does not.
   */
  corpus: CorpusState
  loadCorpus: () => Promise<void>
  addCorpusEntry: (entry: {
    title: string
    content: string
    tags: string[]
    keyPoints?: string[]
    domain?: boolean
  }) => Promise<void>
  restoreCorpus: () => Promise<void>
  /** Uploads files into `corpus/uploads/` and ingests them; resolves to the server's summary. */
  uploadCorpusFiles: (files: File[]) => Promise<void>

  ensureDraft: (ideaId: string, platform?: Platform) => Promise<void>
  regenerateDraft: (ideaId: string, platform?: Platform) => Promise<void>
  ensureImage: (ideaId: string, platform?: Platform) => Promise<void>
  regenerateImage: (ideaId: string, platform?: Platform, model?: string) => Promise<void>
  instructImage: (ideaId: string, instruction: string, references?: ModelReference[]) => Promise<void>
  instructAI: (ideaId: string, instruction: string, references?: ModelReference[]) => Promise<string>
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
  /**
   * Whether a real publication can happen right now.
   *
   * Live mode AND a reachable API. Standalone counts as disabled because the
   * client cannot dispatch to a platform by itself — it could only fabricate the
   * receipt, which is the thing being prevented.
   */
  publishingEnabled: () => boolean
  publishIdea: (ideaId: string) => Promise<void>

  pushActivity: (event: Omit<ActivityEvent, 'id' | 'created_at'>) => void
  /** Records one captured page exactly as the run reported it. */
  recordCapture: (event: RuntimeEvent) => void
  /** Records what one keyword-on-one-lane reported. */
  recordScrapeLane: (event: RuntimeEvent) => void
  /** Records one verdict from the validation agent. */
  recordVerdict: (event: RuntimeEvent) => void
  /** Marks a capture the scraping stage held back as already on record. */
  recordHeld: (event: RuntimeEvent) => void
  /** Records an agent-level conclusion, including the reason a stage was empty. */
  recordRunNote: (event: RuntimeEvent) => void
  setAgent: (agentId: AgentId, patch: Partial<AgentState>) => void
  toast: (message: string, tone?: Toast['tone'], hint?: string) => void
  dismissToast: (id: string) => void
  updateSettings: (patch: Partial<Settings>) => void

  /* ── Ethara ────────────────────────────────────────────────────────────── */
  openBar: (prefill?: string) => void
  closeBar: () => void
  toggleRail: () => void
  setCoreState: (state: AssistantCoreState) => void
  sendCommand: (
    utterance: string,
    channel?: 'text' | 'voice',
    focus?: { type: string; id: string; title?: string; platform?: string },
  ) => Promise<void>
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

/**
 * Whether an event belongs to the run the theater is already showing.
 *
 * Runs can overlap — a scheduled run and an operator-triggered one, or two
 * servers against one database. Once a run is latched, events from any other
 * are ignored rather than merged, because a feed that mixes two runs reports a
 * total that describes neither of them.
 */
/** Stages whose conclusions the run theater narrates. */
const RUN_NOTE_AGENTS = new Set(['scraping', 'validation', 'analysis', 'calendar'])

function sameRun(run: ScrapeRunState, event: RuntimeEvent): boolean {
  if (run.runId === null) return true
  if (event.runId === undefined) return true
  return event.runId === run.runId
}

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
  scrapeRun: {
    running: false, progress: 0, currentSource: '', currentKeyword: '',
    found: 0, runId: null, captures: [], lanes: [], verdicts: [], notes: [], summary: null,
  },
  agentRun: {
    running: false, order: [], done: [], current: null,
    frames: [], summary: null, persisted: null, error: null,
  },
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
    // Probed twice before believing the answer. The first probe races the
    // page's own start-up: in dev the module graph is unbundled and parsing it
    // blocks the main thread long enough for the abort timeout to fire against
    // a server that is answering in milliseconds — and the operator is then
    // told the API is unreachable when it is running. A second probe costs one
    // timeout on a machine that genuinely has no server, and nothing at all on
    // a machine that has one.
    const health = (await detectApi()) ?? (await detectApi())

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
        // The run states its own status. Stamping 'ok' over a 'warn' turns an
        // empty lane — a real finding about that lane — into a success line.
        const stated = event.data?.status
        const status: ActivityEvent['status'] =
          stated === 'warn' || stated === 'error' || stated === 'running' ? stated : 'ok'
        get().pushActivity({
          agent_id: (event.agentId ?? null) as AgentId | null,
          message: event.message,
          status,
          entity_type: null,
          entity_id: null,
        })
        if (event.agentId === 'scraping') get().recordScrapeLane(event)
        // The stage-level conclusions travel too, so the theater can say WHY a
        // stage produced nothing instead of showing an unexplained zero.
        if (RUN_NOTE_AGENTS.has(event.agentId ?? '')) get().recordRunNote(event)
      }
      if (event.type === 'item.scraped') get().recordCapture(event)
      if (event.type === 'item.validated') get().recordVerdict(event)
      if (event.type === 'item.held') get().recordHeld(event)
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

  /**
   * Runs the eight-agent Python pipeline and narrates it from its own events.
   *
   * The distinction from `runScraping` is the whole point. `runScraping` drives
   * the TypeScript orchestrator and animates a progress bar on a timer while it
   * waits. This drives the agents themselves and moves only when an agent
   * actually starts or finishes, so the banner cannot claim progress that has
   * not happened.
   *
   * Each agent's own summary becomes its activity line — the scrape reports what
   * it captured, the validation reports what it accepted, the calendar reports
   * what took a slot and what went to suggestions. None of it is written here.
   */
  runAgentPipeline: async () => {
    if (get().agentRun.running) return

    const keywords = get().keywords.filter((k) => k.active).map((k) => k.term)
    if (keywords.length === 0) {
      get().toast('No active keywords. Add one before running the agents.', 'warn')
      return
    }
    if (get().apiMode !== 'connected') {
      get().toast(
        'The agent backend runs inside the API process, so it needs the API.',
        'warn',
        'Start it with `npm run dev:server`.',
      )
      return
    }

    const patch = (next: Partial<AgentRunState>): void =>
      set({ agentRun: { ...get().agentRun, ...next } })

    set({
      agentRun: {
        running: true, order: [], done: [], current: null,
        frames: [], summary: null, persisted: null, error: null,
      },
      scrapeRunCount: get().scrapeRunCount + 1,
    })

    try {
      await runAgentPipeline({ keywords }, (frame) => {
        patch({ frames: [...get().agentRun.frames, frame].slice(-FRAME_BUFFER) })

        switch (frame.event) {
          case 'workflow.started':
            patch({ order: Array.isArray(frame.agents) ? (frame.agents as string[]) : [] })
            break

          case 'agent.started': {
            const id = uiAgentId(frame.agent_id)
            patch({ current: id })
            if (id) get().setAgent(id, { status: 'running', current_task: String(frame.name ?? '') })
            break
          }

          case 'agent.finished': {
            const id = uiAgentId(frame.agent_id)
            const failed = frame.status === 'failed'
            patch({ current: null, done: [...get().agentRun.done, String(frame.agent_id ?? '')] })
            if (!id) break
            get().setAgent(id, {
              status: failed ? 'failed' : 'completed',
              current_task: 'Idle',
              last_run: new Date().toISOString(),
            })
            // The agent's own summary, verbatim. Rewriting it here would put the
            // UI's opinion of the run on screen instead of the run.
            get().pushActivity({
              agent_id: id,
              message: String(frame.summary ?? ''),
              status: failed ? 'error' : 'ok',
              entity_type: null,
              entity_id: null,
            })
            break
          }

          case 'agents.persisted':
            patch({ persisted: frame })
            break

          case 'agents.persist_failed':
          case 'error':
            patch({ error: String(frame.message ?? 'The run reported an error with no message.') })
            break

          case 'workflow.failed':
            patch({ error: String(frame.error ?? `${String(frame.agent_id)} failed.`) })
            break

          case 'workflow.finished':
            patch({ summary: frame })
            break
        }
      })

      patch({ running: false, current: null })
      // Law 8: the stream said what happened, the database says what is. The
      // calendar renders from this refetch, never from the frames above.
      await get().refreshState()
      get().toast(...runReport(get().agentRun))
    } catch (error) {
      const message = error instanceof Error ? error.message : 'The agent backend could not be reached.'
      patch({ running: false, current: null, error: message })
      get().toast(message, 'critical')
    }
  },

  runScraping: async () => {
    if (get().scrapeRun.running) return

    const keywords = get().keywords.filter((k) => k.active).slice(0, 12)
    set({
      scrapeRun: {
        running: true, progress: 0, currentSource: '', currentKeyword: '',
        found: 0, runId: null, captures: [], lanes: [], verdicts: [], notes: [], summary: null,
      },
      scrapeRunCount: get().scrapeRunCount + 1,
    })
    get().setAgent('scraping', { status: 'running', current_task: 'Scanning LinkedIn' })

    // Connected runs narrate themselves: `item.scraped` and the per-lane
    // activity lines arrive over the event stream and are recorded as they
    // land. Nothing is invented to fill the wait — a run that has captured
    // nothing yet reads as nothing yet, which is the truth about it.
    const tick = async (): Promise<void> => {
      for (const [i, keyword] of keywords.entries()) {
        if (!get().scrapeRun.running) return
        set({
          scrapeRun: {
            ...get().scrapeRun,
            progress: Math.round(((i + 1) / keywords.length) * 100),
            ...(get().scrapeRun.currentKeyword === '' ? { currentKeyword: keyword.term } : {}),
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
      // The run's own numbers ride along, so the theater can say what this
      // run did rather than replay what the store already held.
      set({
        scrapeRun: {
          ...get().scrapeRun,
          running: false,
          progress: 100,
          summary: result ? (result.summary as Record<string, number>) : null,
        },
      })
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
    // Standalone captures nothing: it surfaces what the bundled corpus already
    // holds. The count therefore comes from that corpus, and the line says so.
    const held = get().scraped.length
    set({
      scrapeRun: { ...get().scrapeRun, running: false, progress: 100, found: held, summary: null },
    })
    get().setAgent('scraping', { status: 'completed', current_task: `${held} items held` })
    get().pushActivity({
      agent_id: 'scraping',
      message: `Standalone run · ${held} items surfaced from the bundled corpus. Nothing was captured live.`,
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

  corpus: { entries: [], stats: EMPTY_CORPUS_STATS },

  loadCorpus: async () => {
    // Standalone still shows a real corpus: the bundled entries carry the same
    // tags, so the same derivation applies with the keyword count absent.
    if (get().apiMode !== 'connected') {
      set({ corpus: corpusFromEntries(get().knowledge) })
      return
    }
    try {
      const payload = await api.knowledgeCorpus()
      set({ corpus: { entries: payload.entries, stats: payload.stats } })
    } catch {
      set({ corpus: corpusFromEntries(get().knowledge) })
    }
  },

  addCorpusEntry: async (entry) => {
    if (get().apiMode !== 'connected') {
      get().toast('Standalone — start the API to add a corpus entry that scraping will read.', 'warn')
      return
    }
    try {
      const { appliesTo } = await api.addCorpusEntry(entry)
      await get().refreshState()
      await get().loadCorpus()
      get().toast(`Added to the brand corpus. ${appliesTo}`, 'good')
    } catch (error) {
      get().toast(error instanceof Error ? error.message : 'That corpus entry did not save.', 'critical')
    }
  },

  uploadCorpusFiles: async (files) => {
    if (get().apiMode !== 'connected') {
      get().toast('Standalone — start the API to upload into the Knowledge Base.', 'warn')
      return
    }
    if (files.length === 0) return
    const total = files.reduce((sum, f) => sum + f.size, 0)
    if (total > 10 * 1024 * 1024) {
      get().toast('That is over 10 MB in one go. Upload fewer files at a time.', 'warn')
      return
    }
    try {
      const encoded = await Promise.all(
        files.map(
          (file) =>
            new Promise<{ name: string; content: string }>((resolveFile, reject) => {
              const reader = new FileReader()
              reader.onerror = () => reject(new Error(`Could not read ${file.name}.`))
              reader.onload = () => {
                const result = String(reader.result ?? '')
                resolveFile({ name: file.name, content: result.slice(result.indexOf(',') + 1) })
              }
              reader.readAsDataURL(file)
            }),
        ),
      )
      get().toast(`Reading ${files.length} file${files.length === 1 ? '' : 's'}…`, 'neutral')
      const report = await api.uploadCorpusFiles(encoded)
      await get().refreshState()
      await get().loadCorpus()
      const bad = report.files.filter((f) => f.outcome === 'unreadable')
      get().toast(report.summary, report.inserted > 0 ? 'good' : bad.length > 0 ? 'warn' : 'neutral')
      for (const f of bad) get().toast(`${f.file} — ${f.detail ?? 'could not be read'}`, 'warn')
    } catch (error) {
      get().toast(error instanceof Error ? error.message : 'The upload did not complete.', 'critical')
    }
  },

  restoreCorpus: async () => {
    if (get().apiMode !== 'connected') {
      get().toast('Standalone — start the API to restore the declared corpus.', 'warn')
      return
    }
    try {
      const { reason } = await api.restoreCorpus()
      await get().refreshState()
      await get().loadCorpus()
      get().toast(reason, 'good')
    } catch (error) {
      get().toast(error instanceof Error ? error.message : 'The corpus restore failed.', 'critical')
    }
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

  instructImage: async (ideaId, instruction, references = []) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return

    if (get().apiMode === 'connected') {
      try {
        const { media } = await api.renderImage(ideaId, {
          platform: idea.platform,
          instruction,
          ...(references.length === 0 ? {} : { references }),
        })
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

  instructAI: async (ideaId, instruction, references = []) => {
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
        const result = await api.instruct(ideaId, {
          platform: idea.platform,
          instruction,
          model: get().settings.captionModel,
          ...(references.length === 0 ? {} : { references }),
        })
        // An unchanged draft is still written back: the revision and model on it
        // are the server's truth, and the panel reconciles its textarea from it.
        set({
          drafts: { ...get().drafts, [key]: result.draft },
          ideas: get().ideas.map((i) => (i.id === ideaId ? { ...i, draft: result.draft } : i)),
        })
        get().setAgent('review', { status: 'completed', current_task: 'Idle' })
        if (result.applied === false) get().toast('The caption was not changed.', 'warn')
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

    // The local template writer reads no attachments. Saying so is the honest
    // answer; letting the operator assume the file was used is not.
    const ignored =
      references.length === 0
        ? ''
        : ` ${references.length} attached reference(s) were not read — the local template writer cannot use them. Start the API to apply them.`

    return `${result.note}${finding}${ignored}`
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

  /** The per-platform cap, with the demotion always announced. */
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
    // Auto-publish cannot publish what publishing refuses. In demo mode the
    // approval still lands; the post simply stops at `approved`.
    const autoPublish = get().settings.autoPublish && get().publishingEnabled()

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

  publishingEnabled: () => get().apiMode === 'connected' && get().mode.publishMode === 'live',

  publishIdea: async (ideaId) => {
    const idea = get().ideas.find((i) => i.id === ideaId)
    if (!idea) return

    /*
     * DEMO MODE DOES NOT PUBLISH.
     *
     * The server refuses this too, at `publishIdea` in the orchestrator, and that
     * refusal is the one that matters. This check exists because the standalone
     * branch below never reaches the server: it used to mint a `posts` row with
     * a `demo-` receipt entirely in the browser, so with the API stopped a post
     * could be "published" with nothing anywhere having sent it.
     *
     * Refused before the phase animation runs, so the UI never plays a publish
     * sequence for something that is not going to happen.
     */
    if (!get().publishingEnabled()) {
      get().toast(
        'Publishing is disabled in demo mode. Nothing was published or recorded.',
        'warn',
        'Set PUBLISH_MODE=live on the server and supply the platform token to publish for real.',
      )
      return
    }

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
              { step: 1, label: 'Draft generated by SpongeBob', at: new Date().toISOString() },
              { step: 2, label: `Approved by ${idea.marketing_approved_by ?? 'Marketing'}`, at: new Date().toISOString() },
              { step: 3, label: `Final approval from ${idea.leadership_decision?.by ?? 'Leadership'}`, at: new Date().toISOString() },
              { step: 4, label: `Published to ${idea.platform} in demo mode`, at: new Date().toISOString() },
            ],
            media_asset_id: null,
            analysis_summary: 'Published moments ago — Jerry will report the first reading in an hour.',
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
    get().toast('Published. Jerry will report the first reading in an hour.', 'good')

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

  recordCapture: (event) => {
    const d = event.data ?? {}
    const run = get().scrapeRun
    if (!sameRun(run, event)) return
    const id = String(d.externalId ?? event.message ?? nid('cap'))
    if (run.captures.some((c) => c.id === id)) return
    const relevance = typeof d.brandRelevance === 'number' ? d.brandRelevance : null
    const capture: LiveCapture = {
      id,
      title: event.message ?? 'Untitled page',
      keyword: typeof d.keyword === 'string' ? d.keyword : '',
      platform: typeof d.platform === 'string' ? d.platform : 'open-web',
      // Whichever source the run named. Two sources answer now — an Apify actor
      // on a platform lane, crawl4ai on the open web — so naming one of them by
      // default would attribute a row to an implementation that may not have
      // produced it.
      source:
        typeof d.source === 'string'
          ? d.source
          : typeof d.via === 'string'
            ? d.via
            : 'Source not named',
      relevance,
      held: null,
    }
    // `found` counts captures the run actually reported. It is never estimated.
    const captures = [...run.captures, capture].slice(-400)
    set({
      scrapeRun: {
        ...run,
        runId: run.runId ?? event.runId ?? null,
        captures,
        found: captures.length,
        currentKeyword: capture.keyword || run.currentKeyword,
        currentSource: capture.platform,
      },
    })
  },

  recordRunNote: (event) => {
    const d = event.data ?? {}
    // A per-lane line is already a lane row; only the stage-level ones are notes.
    if (typeof d.platform === 'string') return
    const message = event.message
    if (message === undefined || message === '') return
    const run = get().scrapeRun
    if (!sameRun(run, event)) return
    const id = `${event.skillId ?? event.agentId ?? 'run'}::${message}`
    if (run.notes.some((n) => n.id === id)) return
    const note: LiveNote = {
      id,
      agentId: event.agentId ?? '',
      message,
      status: d.status === 'warn' || d.status === 'error' ? 'warn' : 'ok',
    }
    set({
      scrapeRun: {
        ...run,
        runId: run.runId ?? event.runId ?? null,
        notes: [...run.notes, note].slice(-120),
      },
    })
  },

  recordHeld: (event) => {
    const d = event.data ?? {}
    const run = get().scrapeRun
    if (!sameRun(run, event)) return
    const id = String(d.externalId ?? event.message ?? '')
    if (id === '') return
    const verdict = d.verdict
    const held: NonNullable<LiveCapture['held']> = {
      since: typeof d.heldSince === 'string' ? d.heldSince : '',
      originalId: typeof d.originalId === 'string' ? d.originalId : '',
      originalTitle: typeof d.originalTitle === 'string' ? d.originalTitle : '',
      verdict:
        verdict === 'validated' || verdict === 'needs_review' || verdict === 'duplicate' || verdict === 'rejected'
          ? verdict
          : 'pending',
      reason: typeof d.reason === 'string' ? d.reason : '',
    }
    const known = run.captures.some((c) => c.id === id)
    const captures = known
      ? run.captures.map((c) => (c.id === id ? { ...c, held } : c))
      : [
          ...run.captures,
          {
            id,
            title: event.message ?? 'Untitled page',
            keyword: typeof d.keyword === 'string' ? d.keyword : '',
            platform: typeof d.platform === 'string' ? d.platform : 'open-web',
            // A held item arrives from the validation event, which does not
            // restate which source captured it. Saying so is honest; naming a
            // source would be a guess.
            source: typeof d.source === 'string' ? d.source : 'Source not named',
            relevance: null,
            held,
          },
        ]
    set({
      scrapeRun: {
        ...run,
        runId: run.runId ?? event.runId ?? null,
        captures,
        found: captures.length,
      },
    })
  },

  recordVerdict: (event) => {
    const d = event.data ?? {}
    const run = get().scrapeRun
    if (!sameRun(run, event)) return
    const verdict = d.validation
    if (typeof verdict !== 'string') return
    const id = String(d.externalId ?? event.message ?? nid('ver'))
    if (run.verdicts.some((v) => v.id === id)) return
    const row: LiveVerdict = {
      id,
      title: event.message ?? 'Untitled page',
      verdict: verdict as LiveVerdict['verdict'],
      // Rule 6: the verdict arrives with the reason that produced it.
      reason: typeof d.reason === 'string' ? d.reason : '',
      relevance: typeof d.relevance === 'number' ? d.relevance : null,
      credibility: typeof d.credibility === 'string' ? d.credibility : null,
    }
    set({
      scrapeRun: {
        ...run,
        runId: run.runId ?? event.runId ?? null,
        verdicts: [...run.verdicts, row].slice(-400),
      },
    })
  },

  recordScrapeLane: (event) => {
    const d = event.data ?? {}
    const keyword = typeof d.keyword === 'string' ? d.keyword : ''
    const platform = typeof d.platform === 'string' ? d.platform : ''
    // Only the per-lane lines carry both. Agent-level notes are left to the feed.
    if (keyword === '' || platform === '') return
    const stated = d.status
    const status: LiveLane['status'] = stated === 'warn' ? 'warn' : stated === 'running' ? 'running' : 'ok'
    const lane: LiveLane = {
      id: `${platform}::${keyword}`,
      keyword,
      platform,
      status,
      kept: typeof d.count === 'number' ? d.count : null,
      captured: typeof d.captured === 'number' ? d.captured : null,
      reason: typeof d.reason === 'string' ? d.reason : null,
    }
    const run = get().scrapeRun
    if (!sameRun(run, event)) return
    const lanes = run.lanes.some((l) => l.id === lane.id)
      ? run.lanes.map((l) => (l.id === lane.id ? lane : l))
      : [...run.lanes, lane]
    set({
      scrapeRun: {
        ...run,
        runId: run.runId ?? event.runId ?? null,
        lanes,
        ...(status === 'running' ? { currentKeyword: keyword, currentSource: platform } : {}),
      },
    })
  },

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
  sendCommand: async (utterance, channel = 'text', focus) => {
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
            ...(focus === undefined ? {} : { focus }),
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

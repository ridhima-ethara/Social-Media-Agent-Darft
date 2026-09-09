/**
 * THE GLOBAL SHELL
 *
 * `h-screen overflow-hidden` flex row. The page itself never scrolls; panes
 * scroll. The command-plane surfaces — core, bar, rail and HUD — are present on every
 * screen except sign-in.
 */

import { useEffect, type ReactNode } from 'react'
import {
  Bell,
  Brain,
  CalendarDays,
  ChevronLeft,
  Command,
  Gauge,
  LayoutDashboard,
  LogOut,
  Network,
  ScrollText,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  Sparkles,
  Sliders,
  Volume2,
  VolumeX,
} from 'lucide-react'
import { AGENT_BY_ID } from '@shared/agent-registry'
import { useStore } from '../store'
import { Badge, Btn } from './ui'
import { Logo, Wordmark } from './logo'
import { ThemeToggle } from './theme-toggle'
import { AssistantCore } from './assistant/core'
import { AssistantBar } from './assistant/bar'
import { AssistantRail } from './assistant/rail'
import { AssistantHud, LiveBackground } from './assistant/hud'
import { Holo } from './tilt'
import { setVoiceEnabled, voiceSupport } from '../lib/voice'
import type { AgentId, PageId } from '../types'

/* ═══════════════════════════════════════════════════════════════════════════
   THE EIGHT STAGES — shared by the boot sequence and the header chips
   ═══════════════════════════════════════════════════════════════════════════ */

export interface StageSpec {
  id: string
  label: string
  agents: AgentId[]
}

export const STAGES: StageSpec[] = [
  { id: 'scrape', label: 'Scrape', agents: ['scraping'] },
  { id: 'validate', label: 'Validate', agents: ['validation'] },
  { id: 'analyze', label: 'Analyze', agents: ['analysis'] },
  { id: 'ideas', label: 'Ideas', agents: ['calendar'] },
  { id: 'create', label: 'Create', agents: ['caption', 'image', 'review'] },
  { id: 'publish', label: 'Publish', agents: ['publishing'] },
  { id: 'measure', label: 'Measure', agents: ['analytics'] },
  { id: 'learn', label: 'Learn', agents: ['knowledge', 'learning'] },
]

/* ═══════════════════════════════════════════════════════════════════════════
   NAVIGATION — role-filtered
   ═══════════════════════════════════════════════════════════════════════════ */

interface NavItem {
  page: PageId
  label: string
  icon: typeof LayoutDashboard
  badge?: 'leadership'
}

const MARKETING_NAV: NavItem[] = [
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'calendar', label: 'Weekly Calendar', icon: CalendarDays },
  { page: 'published', label: 'Published Posts', icon: Send },
  { page: 'orchestration', label: 'Agent Orchestration', icon: Network },
  { page: 'intelligence', label: 'Content Intelligence', icon: Gauge },
  { page: 'studio', label: 'Agent Studio', icon: Sliders },
  { page: 'console', label: 'Run Console', icon: ScrollText },
  { page: 'assistant', label: 'Command Console', icon: Command },
  { page: 'settings', label: 'Settings', icon: SettingsIcon },
]

const LEADERSHIP_NAV: NavItem[] = [
  { page: 'leadership', label: 'Final Approval', icon: ShieldCheck, badge: 'leadership' },
  { page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { page: 'published', label: 'Published Posts', icon: Send },
  { page: 'orchestration', label: 'Agent Orchestration', icon: Network },
  { page: 'assistant', label: 'Command Console', icon: Command },
]

/* ═══════════════════════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════════════════════ */

function Sidebar() {
  const page = useStore((s) => s.page)
  const setPage = useStore((s) => s.setPage)
  const user = useStore((s) => s.user)
  const collapsed = useStore((s) => s.sidebarCollapsed)
  const toggleSidebar = useStore((s) => s.toggleSidebar)
  const agents = useStore((s) => s.agents)
  const ideas = useStore((s) => s.ideas)
  const reviewQueue = useStore((s) => s.reviewQueue)

  const nav = user?.role === 'leadership' ? LEADERSHIP_NAV : MARKETING_NAV
  const awaitingLeadership = ideas.filter((i) => i.status === 'pending_leadership').length

  const running = agents.some((a) => a.status === 'running')
  const needsReview = agents.some((a) => a.status === 'needs_review') || reviewQueue.some((q) => !q.resolved)

  const healthDot = running
    ? 'bg-accent anim-pulse-dot'
    : needsReview
      ? 'bg-serious'
      : 'bg-good'
  const healthText = running
    ? 'Agents running'
    : needsReview
      ? `${reviewQueue.filter((q) => !q.resolved).length} awaiting a verdict`
      : 'All twelve healthy'

  return (
    <nav
      className="glass relative z-20 flex h-full shrink-0 flex-col border-r border-line transition-[width] duration-300 ease-[var(--ease-out-soft)]"
      style={{ width: collapsed ? 64 : 236 }}
      aria-label="Primary"
    >
      <div className="flex items-center gap-2.5 px-3 py-4">
        <Logo size={28} />
        {!collapsed ? (
          <div className="min-w-0">
            <Wordmark className="block text-[15px] leading-tight" />
            <span className="block text-[10px] leading-tight text-ink-3">Social Media Agent</span>
          </div>
        ) : null}
      </div>

      {!collapsed ? (
        <div className="mx-3 mb-3 rounded-lg border border-line bg-surface-2 px-2.5 py-2">
          <div className="flex items-center justify-between gap-2">
            <span className="truncate text-[11px] text-ink-2">Ethara.AI · Main</span>
            <Badge tone="magenta">DEMO</Badge>
          </div>
        </div>
      ) : null}

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {nav.map((item) => {
          const active = page === item.page
          return (
            <li key={item.page}>
              <button
                type="button"
                onClick={() => setPage(item.page)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[12.5px] font-medium transition-colors duration-[var(--dur-fast)] ${
                  active ? 'text-ink' : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2'
                }`}
                style={
                  active
                    ? {
                        background:
                          'linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 18%, transparent), color-mix(in srgb, var(--color-magenta) 8%, transparent))',
                      }
                    : undefined
                }
              >
                {active ? (
                  <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" aria-hidden="true" />
                ) : null}
                <item.icon size={15} className={active ? 'text-accent-bright' : ''} aria-hidden="true" />
                {!collapsed ? <span className="truncate">{item.label}</span> : null}
                {item.badge === 'leadership' && awaitingLeadership > 0 ? (
                  <span className="tabular ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[9px] font-semibold text-ink">
                    {awaitingLeadership}
                  </span>
                ) : null}
              </button>
            </li>
          )
        })}
      </ul>

      <div className="border-t border-line px-3 py-2.5">
        <div className="flex items-center gap-2">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${healthDot}`} aria-hidden="true" />
          {!collapsed ? <span className="truncate text-[11px] text-ink-3">{healthText}</span> : null}
          <button
            type="button"
            onClick={toggleSidebar}
            aria-label={collapsed ? 'Expand the sidebar' : 'Collapse the sidebar'}
            className="ml-auto rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
          >
            <ChevronLeft
              size={14}
              className="transition-transform duration-300"
              style={{ transform: collapsed ? 'rotate(180deg)' : undefined }}
            />
          </button>
        </div>
      </div>
    </nav>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   HEADER
   ═══════════════════════════════════════════════════════════════════════════ */

function Header() {
  const user = useStore((s) => s.user)
  const logout = useStore((s) => s.logout)
  const setPage = useStore((s) => s.setPage)
  const openKnowledge = useStore((s) => s.openKnowledge)
  const knowledge = useStore((s) => s.knowledge)
  const ideas = useStore((s) => s.ideas)
  const reviewQueue = useStore((s) => s.reviewQueue)
  const coreState = useStore((s) => s.assistant.coreState)
  const notices = useStore((s) => s.assistant.notices)
  const activePlan = useStore((s) => s.assistant.activePlan)
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const apiMode = useStore((s) => s.apiMode)
  const publishMode = useStore((s) => s.mode.publishMode)

  const awaitingLeadership = ideas.filter((i) => i.status === 'pending_leadership').length
  const openQueue = reviewQueue.filter((q) => !q.resolved).length
  const needsAttention = awaitingLeadership > 0 || openQueue > 0

  const progress = activePlan
    ? (activePlan.steps.filter((s) => s.status === 'completed').length / Math.max(1, activePlan.steps.length)) * 100
    : 0

  return (
    <header className="glass relative z-20 flex h-14 shrink-0 items-center justify-end gap-2 border-b border-line px-4">
      <Holo size={44}>
        <AssistantCore
          state={coreState}
          size={44}
          progress={progress}
          badge={notices.length}
          onClick={() => setPage('assistant')}
        />
      </Holo>

      <button
        type="button"
        onClick={() => useStore.getState().openBar()}
        className="mono hidden rounded-md border border-line px-2 py-1 text-[10px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2 xl:block"
      >
        ⌘K
      </button>

      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

      <ThemeToggle />

      <Badge tone="magenta">{apiMode === 'connected' ? `${publishMode.toUpperCase()} MODE` : 'STANDALONE'}</Badge>

      <button
        type="button"
        onClick={openKnowledge}
        title="Open the Knowledge Base"
        className="relative flex items-center gap-1.5 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-line-strong hover:text-ink"
      >
        <span className="relative flex h-5 w-5 items-center justify-center rounded-full border border-accent/50">
          <Brain size={11} className="text-accent-bright" aria-hidden="true" />
          <span className="anim-ping-slow absolute inset-0 rounded-full border border-accent" aria-hidden="true" />
        </span>
        <span className="tabular">{knowledge.filter((k) => k.active).length}</span>
      </button>

      <button
        type="button"
        onClick={() => setPage(user?.role === 'leadership' ? 'leadership' : 'orchestration')}
        aria-label="Notifications"
        className="relative rounded-lg border border-line p-1.5 text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
      >
        <Bell size={15} />
        {needsAttention ? (
          <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-critical" aria-hidden="true" />
        ) : null}
      </button>

      {voiceSupport.any ? (
        <button
          type="button"
          onClick={() => {
            const next = !settings.assistantVoice
            updateSettings({ assistantVoice: next })
            setVoiceEnabled(next)
          }}
          aria-label={settings.assistantVoice ? 'Mute Ethara' : 'Unmute Ethara'}
          title={settings.assistantVoice ? 'Mute Ethara' : 'Unmute Ethara'}
          className="rounded-lg border border-line p-1.5 text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
        >
          {settings.assistantVoice ? <Volume2 size={15} /> : <VolumeX size={15} />}
        </button>
      ) : null}

      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full text-[12px] font-semibold text-on-accent"
          style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-magenta))' }}
          aria-hidden="true"
        >
          {user?.initial}
        </span>
        <span className="hidden leading-tight lg:block">
          <span className="block text-[12px] font-medium text-ink">{user?.name}</span>
          <span className="block text-[10px] text-ink-3">{user?.title}</span>
        </span>
        <button
          type="button"
          onClick={logout}
          aria-label="Sign out"
          title="Sign out"
          className="rounded-lg border border-line p-1.5 text-ink-3 transition-colors hover:border-critical/50 hover:text-critical-ink"
        >
          <LogOut size={15} />
        </button>
      </div>
    </header>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   PAGE HEADER
   ═══════════════════════════════════════════════════════════════════════════ */

export function AgentChips({ agents }: { agents: AgentId[] }) {
  const states = useStore((s) => s.agents)
  const setPage = useStore((s) => s.setPage)

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <span className="text-[10px] uppercase tracking-[0.1em] text-ink-3">Powered by</span>
      {agents.map((agentId) => {
        const state = states.find((s) => s.agent_id === agentId)
        const spec = AGENT_BY_ID[agentId]
        const dot =
          state?.status === 'running'
            ? 'bg-accent anim-pulse-dot'
            : state?.status === 'needs_review'
              ? 'bg-serious'
              : state?.status === 'failed'
                ? 'bg-critical'
                : state?.status === 'waiting'
                  ? 'bg-warn'
                  : 'bg-ink-3'

        return (
          <button
            key={agentId}
            type="button"
            onClick={() => setPage('orchestration')}
            title={state?.current_task ?? spec?.role}
            className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
          >
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
            {spec?.name.replace(' Agent', '') ?? agentId}
          </button>
        )
      })}
    </div>
  )
}

export function PageHeader({
  title,
  subtitle,
  agents,
  actions,
  askPrompt,
}: {
  title: string
  subtitle: string
  agents?: AgentId[]
  actions?: ReactNode
  /** Pre-fills the command bar with a prompt appropriate to this screen. */
  askPrompt?: string
}) {
  const openBar = useStore((s) => s.openBar)

  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display text-3xl">{title}</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-3">{subtitle}</p>
        {agents && agents.length > 0 ? <div className="mt-2.5">{<AgentChips agents={agents} />}</div> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {askPrompt ? (
          <Btn variant="ghost" onClick={() => openBar(askPrompt)}>
            <Sparkles size={13} /> Ask Ethara about this screen
          </Btn>
        ) : null}
        {actions}
      </div>
    </header>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SHELL
   ═══════════════════════════════════════════════════════════════════════════ */

export function Shell({ children }: { children: ReactNode }) {
  const openBar = useStore((s) => s.openBar)
  const closeBar = useStore((s) => s.closeBar)
  const toggleRail = useStore((s) => s.toggleRail)
  const barOpen = useStore((s) => s.assistant.barOpen)
  const apiMode = useStore((s) => s.apiMode)
  const page = useStore((s) => s.page)

  /** ⌘K / Ctrl-K opens the bar; ⌥J toggles the rail; hold-Space is push-to-talk. */
  useEffect(() => {
    const isTyping = (target: EventTarget | null): boolean => {
      const element = target as HTMLElement | null
      if (!element) return false
      return (
        element.tagName === 'INPUT' ||
        element.tagName === 'TEXTAREA' ||
        element.tagName === 'SELECT' ||
        element.isContentEditable
      )
    }

    const onKeyDown = (event: KeyboardEvent): void => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (barOpen) closeBar()
        else openBar()
        return
      }
      if (event.altKey && event.key.toLowerCase() === 'j') {
        event.preventDefault()
        toggleRail()
        return
      }
      // Push-to-talk: hold Space, but never while the operator is typing.
      if (event.code === 'Space' && !barOpen && !isTyping(event.target) && !event.repeat) {
        event.preventDefault()
        openBar()
      }
    }

    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [barOpen, openBar, closeBar, toggleRail])

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-page text-ink">
      <LiveBackground />
      <AssistantHud />

      <Sidebar />

      <div className="relative z-10 flex min-w-0 flex-1 flex-col">
        <Header />

        {apiMode === 'standalone' ? (
          <div className="shrink-0 border-b border-warn/40 bg-warn/10 px-4 py-1.5 text-[11px] text-warn">
            The API is unreachable, so this is the bundled demo dataset. Ethara is answering on the
            in-bundle deterministic parser. Start the server with{' '}
            <code className="mono rounded bg-surface-2 px-1">npm run dev:server</code> to run for real.
          </div>
        ) : null}

        <main className="stage-3d flex-1 overflow-y-auto overflow-x-hidden px-6 py-5">
          <div key={page} className="anim-page-enter-3d">{children}</div>
        </main>
      </div>

      <AssistantBar />
      <AssistantRail />
    </div>
  )
}

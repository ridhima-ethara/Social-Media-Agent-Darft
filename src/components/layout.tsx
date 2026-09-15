/**
 * THE GLOBAL SHELL
 *
 * `h-screen overflow-hidden` flex row. The page itself never scrolls; panes
 * scroll. The command-plane surfaces — core, bar, rail and HUD — are present on every
 * screen except sign-in.
 */

import { useEffect, type ReactNode } from 'react'
import {
  Brain,
  CalendarDays,
  ChevronLeft,
  Gauge,
  LayoutDashboard,
  LogOut,
  Network,
  ScrollText,
  Search,
  Send,
  Settings as SettingsIcon,
  ShieldCheck,
  Sliders,
} from 'lucide-react'
import { AGENT_BY_ID } from '@shared/agent-registry'
import { useStore } from '../store'
import { Logo, Wordmark } from './logo'
import { ThemeToggle } from './theme-toggle'
import { AssistantBar } from './assistant/bar'
import { AssistantRail } from './assistant/rail'
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

/**
 * The nav is grouped by what the operator is doing, not by where a screen
 * happens to live in the code: command the system, watch the pipeline, do the
 * work, control the machine.
 */
interface NavGroup {
  label: string
  items: NavItem[]
}

/**
 * Agent Orchestration is Leadership's screen, not Marketing's: it is where the
 * roster and the hand-offs are inspected, which is an oversight question
 * rather than a production one. Marketing watches the same work through the
 * pipeline theater and Content Intelligence.
 */
const MARKETING_NAV: NavGroup[] = [
  {
    label: 'Command',
    items: [{ page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Pipeline',
    items: [{ page: 'intelligence', label: 'Content Intelligence', icon: Gauge }],
  },
  {
    label: 'Work',
    items: [
      { page: 'calendar', label: 'Weekly Calendar', icon: CalendarDays },
      { page: 'published', label: 'Published Posts', icon: Send },
    ],
  },
  {
    label: 'Control',
    items: [
      { page: 'studio', label: 'Agent Studio', icon: Sliders },
      { page: 'console', label: 'Run Console', icon: ScrollText },
      { page: 'settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
]

const LEADERSHIP_NAV: NavGroup[] = [
  {
    label: 'Work',
    items: [
      { page: 'leadership', label: 'Final Approval', icon: ShieldCheck, badge: 'leadership' },
      { page: 'published', label: 'Published Posts', icon: Send },
    ],
  },
  {
    label: 'Command',
    items: [{ page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Pipeline',
    items: [{ page: 'orchestration', label: 'Agent Orchestration', icon: Network }],
  },
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
  const openBar = useStore((s) => s.openBar)

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

      {/* The mode is stated once, in the header. It was also badged here and
          in the dashboard's footer — three "DEMO"s on one screen. */}
      {!collapsed ? (
        <div className="mx-3 mb-3 rounded-lg border border-line bg-surface-2 px-2.5 py-2">
          <span className="block truncate text-[11.5px] text-ink-2">Ethara.AI · Main</span>
        </div>
      ) : null}

      {/* The command bar is the way to ask for anything, so it sits above the
          nav rather than behind a keybinding nobody is told about. */}
      <button
        type="button"
        onClick={() => openBar()}
        title={collapsed ? 'Ask or command · ⌘K' : undefined}
        className="mx-2 mb-2 flex items-center gap-2 rounded-md border border-line-strong bg-surface px-2.5 py-[7px] text-left text-[12px] text-ink-2 transition-colors duration-[var(--dur-fast)] hover:border-accent/60 hover:text-ink"
      >
        <Search size={13} className="shrink-0 text-magenta" aria-hidden="true" />
        {!collapsed ? (
          <>
            <span className="flex-1 truncate">Ask or command…</span>
            <span className="mono rounded-[3px] border border-line-strong px-1 text-[11px] text-ink-3">⌘K</span>
          </>
        ) : null}
      </button>

      <ul className="flex-1 space-y-0.5 overflow-y-auto px-2">
        {nav.flatMap((group) => [
          <li key={`h-${group.label}`} aria-hidden={collapsed}>
            {collapsed ? (
              <span className="mx-auto my-2 block h-px w-4 bg-line" />
            ) : (
              <span className="mono block px-2 pb-1.5 pt-3 text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{group.label}</span>
            )}
          </li>,
          ...group.items.map((item) => {
          const active = page === item.page
          return (
            <li key={item.page}>
              <button
                type="button"
                onClick={() => setPage(item.page)}
                title={collapsed ? item.label : undefined}
                aria-current={active ? 'page' : undefined}
                className={`relative flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition-colors duration-[var(--dur-fast)] ${
                  active ? 'text-ink' : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2'
                }`}
              >
                {/* The highlight is its own element, named for the View
                    Transition, so on a page change it glides to the new entry
                    instead of vanishing here and appearing there. The icon and
                    label are positioned so they paint above it. */}
                {active ? (
                  <span
                    aria-hidden="true"
                    className="absolute inset-0 rounded-lg"
                    style={{
                      background:
                        'linear-gradient(90deg, color-mix(in srgb, var(--color-accent) 18%, transparent), color-mix(in srgb, var(--color-magenta) 8%, transparent))',
                      viewTransitionName: 'nav-active',
                    }}
                  >
                    <span className="absolute left-0 top-1/2 h-5 w-0.5 -translate-y-1/2 rounded-full bg-accent" />
                  </span>
                ) : null}
                <item.icon size={15} className={`relative ${active ? 'text-accent-bright' : ''}`} aria-hidden="true" />
                {!collapsed ? <span className="relative truncate">{item.label}</span> : null}
                {item.badge === 'leadership' && awaitingLeadership > 0 ? (
                  <span className="tabular relative ml-auto flex h-4 min-w-4 items-center justify-center rounded-full bg-critical px-1 text-[10.5px] font-semibold text-ink">
                    {awaitingLeadership}
                  </span>
                ) : null}
              </button>
            </li>
          )
          }),
        ])}
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
  const openKnowledge = useStore((s) => s.openKnowledge)
  const knowledge = useStore((s) => s.knowledge)
  const apiMode = useStore((s) => s.apiMode)
  const publishMode = useStore((s) => s.mode.publishMode)

  return (
    <header className="glass relative z-20 flex h-14 shrink-0 items-center justify-end gap-2 border-b border-line px-4">
      <ThemeToggle />

      {/* The mode, as a fact rather than a highlight. */}
      <span className="mono hidden rounded-md border border-line-strong px-2 py-[4px] text-[10.5px] uppercase tracking-[0.1em] text-ink-2 sm:inline-block">
        {apiMode === 'connected' ? `${publishMode} mode` : 'standalone'}
      </span>

      <button
        type="button"
        onClick={openKnowledge}
        title="Open the Knowledge Base"
        className="flex items-center gap-1.5 rounded-md border border-line-strong px-2 py-[4px] text-ink-2 transition-colors hover:border-accent hover:text-ink"
      >
        <Brain size={12} className="text-accent-bright" aria-hidden="true" />
        {/* A count is a machine figure; nothing here loops, because nothing here is running. */}
        <span className="mono text-[11px]">{knowledge.filter((k) => k.active).length}</span>
        <span className="mono hidden text-[10.5px] uppercase tracking-[0.1em] text-ink-3 xl:inline">knowledge</span>
      </button>

      <span className="mx-1 h-5 w-px bg-line" aria-hidden="true" />

      <div className="flex items-center gap-2">
        <span
          className="flex h-7 w-7 items-center justify-center rounded-full bg-accent text-[12px] font-semibold text-on-accent"
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
          className="rounded-md border border-line-strong p-1.5 text-ink-3 transition-colors hover:border-critical/50 hover:text-critical-ink"
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
  // Orchestration is Leadership's screen. For everyone else the chip still
  // reports what the agent is doing, but it does not offer a door that is
  // not there — a click that goes nowhere is worse than no click.
  const canOpenOrchestration = useStore((s) => s.user?.role === 'leadership')

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

        const label = (
          <>
            <span className={`h-1.5 w-1.5 rounded-full ${dot}`} aria-hidden="true" />
            {spec?.name.replace(' Agent', '') ?? agentId}
          </>
        )
        const shell = 'flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-3'

        return canOpenOrchestration ? (
          <button
            key={agentId}
            type="button"
            onClick={() => setPage('orchestration')}
            title={state?.current_task ?? spec?.role}
            className={`${shell} transition-colors hover:border-line-strong hover:text-ink-2`}
          >
            {label}
          </button>
        ) : (
          <span key={agentId} title={state?.current_task ?? spec?.role} className={shell}>
            {label}
          </span>
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
}: {
  title: string
  subtitle: string
  agents?: AgentId[]
  actions?: ReactNode
}) {

  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      <div className="min-w-0">
        <h1 className="display text-3xl">{title}</h1>
        <p className="mt-1 max-w-3xl text-[13px] leading-relaxed text-ink-3">{subtitle}</p>
        {agents && agents.length > 0 ? <div className="mt-2.5">{<AgentChips agents={agents} />}</div> : null}
      </div>

      <div className="flex flex-wrap items-center gap-2">
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
      {/* The drifting orbs, panning grid, corner brackets and scan line used to
          sit behind every screen. They moved without a referent and competed
          with the data in front of them, so the only things that move are live
          processes. What remains is a still wash of light — depth, not motion:
          the accent from the top-left, the brand magenta from the bottom-right,
          faint enough that the panels read as glass over it. */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 z-0"
        style={{
          background:
            'radial-gradient(56% 48% at 6% 0%, var(--color-hud) 0%, transparent 62%), radial-gradient(46% 40% at 100% 100%, var(--color-hud-glow) 0%, transparent 60%)',
          opacity: 0.6,
        }}
      />
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

        {/* Bottom padding lives on the page, not the scroller, so a sticky
            strip along the bottom of a page can sit flush with the edge. */}
        <main className="stage-3d flex-1 overflow-y-auto overflow-x-hidden px-6 pt-5">
          <div key={page} className="anim-page-enter-3d pb-5">{children}</div>
        </main>
      </div>

      <AssistantBar />
      <AssistantRail />
    </div>
  )
}

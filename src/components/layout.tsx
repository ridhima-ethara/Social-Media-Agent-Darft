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
  ChevronLeft,
  CalendarDays,
  Gauge,
  Radio,
  LayoutDashboard,
  LogOut,
  Network,
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
export const MARKETING_NAV: NavGroup[] = [
  {
    label: 'Command',
    items: [{ page: 'dashboard', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Pipeline',
    items: [
      { page: 'intelligence', label: 'Content Intelligence', icon: Gauge },
      { page: 'listener', label: 'Analysis', icon: Radio },
    ],
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
      { page: 'settings', label: 'Settings', icon: SettingsIcon },
    ],
  },
]

export const LEADERSHIP_NAV: NavGroup[] = [
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
    items: [
      { page: 'orchestration', label: 'Agent Orchestration', icon: Network },
      { page: 'listener', label: 'Analysis', icon: Radio },
    ],
  },
]

/** The screens a role may open, in the order the hub lists them. */
export function navFor(role: 'marketing' | 'leadership'): NavGroup[] {
  return role === 'leadership' ? LEADERSHIP_NAV : MARKETING_NAV
}

/**
 * Back to the command centre.
 *
 * The dashboard is the hub every screen is reached from, so every screen
 * carries the way back to it. The emblem in the top bar does the same thing,
 * but a control on the page is where a person looks for it.
 */
export function BackToHub({ className = '' }: { className?: string }) {
  const setPage = useStore((s) => s.setPage)
  return (
    <button
      type="button"
      onClick={() => setPage('dashboard')}
      className={`mono mb-1.5 inline-flex items-center gap-1.5 text-[10px] uppercase tracking-[0.1em] text-ink-3 transition-colors hover:text-accent-bright ${className}`}
    >
      <ChevronLeft size={12} aria-hidden="true" />
      Command centre
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   SIDEBAR
   ═══════════════════════════════════════════════════════════════════════════ */

/* The sidebar is gone: the dashboard is the hub, every card a door, and the
   header carries the emblem (home) and the command bar. */

/* ═══════════════════════════════════════════════════════════════════════════
   HEADER
   ═══════════════════════════════════════════════════════════════════════════ */

function Header() {
  const user = useStore((s) => s.user)
  const page = useStore((s) => s.page)
  const setPage = useStore((s) => s.setPage)
  const pageTitle = navFor(user?.role ?? 'marketing').flatMap((g) => g.items).find((i) => i.page === page)?.label ?? 'Ethara'
  const logout = useStore((s) => s.logout)
  const openKnowledge = useStore((s) => s.openKnowledge)
  const knowledge = useStore((s) => s.knowledge)

  return (
    <header className="glass relative z-20 flex h-14 shrink-0 items-center gap-2 border-b border-line px-4">
      <button
        type="button"
        onClick={() => setPage('dashboard')}
        title="Command centre"
        className="flex items-center gap-2.5 rounded-md py-1 pr-2 text-left transition-colors hover:bg-surface-2"
      >
        <Logo size={26} />
        <span className="hidden min-w-0 sm:block">
          <Wordmark className="block text-[14px] leading-tight" />
          <span className="block text-[9.5px] leading-tight text-ink-3">{page === 'dashboard' ? 'Command centre' : pageTitle}</span>
        </span>
      </button>
      <span className="flex-1" />
      <ThemeToggle />

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
        <BackToHub />
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
    <div className="app-h relative flex w-full overflow-hidden bg-page text-ink">
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
        <main className="stage-3d flex min-h-0 flex-1 flex-col overflow-y-auto overflow-x-hidden px-4 pt-4">
          {/*
            NO `min-h-0` ON THE PAGE WRAPPER.

            `main` above is the scroller — `flex-1 min-h-0 overflow-y-auto` is
            correct there. Repeating `min-h-0` here was not: on a flex item it
            means "you may shrink below your content", so a page taller than the
            viewport was squeezed to the viewport's height and its overflow was
            clipped rather than growing the wrapper. `main` then had nothing to
            scroll, and pages like Content Intelligence — five trend cards and a
            120-row keyword table — simply ended at the fold.

            Dropping it restores the flex default, `min-height: auto`: the
            wrapper never shrinks below its content, so tall pages grow and
            `main` scrolls them. `flex-1` stays, so a short page still fills the
            column instead of collapsing to its text.
          */}
          <div key={page} className="anim-page-enter-3d flex flex-1 flex-col pb-2">{children}</div>
        </main>
      </div>

      <AssistantBar />
      <AssistantRail />
    </div>
  )
}

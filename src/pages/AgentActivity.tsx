/**
 * AGENT ORCHESTRATION
 *
 * Twelve agents in seven stages, one network. The scene is drawn directly
 * from `handsOffTo`, so the picture *is* the spec — if the network is wrong,
 * the registry is wrong.
 *
 * The 3D network is the hero. Everything the operator reads — labels, the
 * hover HUD, the right rail, the completion card — is HTML, and everything
 * the operator does — run, validate, simulate a failure, tour, pin, reset —
 * is the same control it always was. Only the visualisation changed.
 */

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, List, Network, Play, RotateCcw } from 'lucide-react'
import { AGENTS, AGENT_BY_ID, SKILLS_BY_AGENT } from '@shared/agent-registry'
import { AGENT_STATUS_META, useStore } from '../store'
import { AgentIcon } from '../components/agent-icon'
import { PageHeader } from '../components/layout'
import { PlayButton } from '../components/play-button'
import {
  OrchestrationDiagram,
  SCENE_AGENT_COUNT,
  SCENE_STAGE_COUNT,
  agentDisplayName,
  agentRealName,
} from '../components/orchestration-diagram'
import { Badge, Btn, Metric, Tabs, timeAgo } from '../components/ui'
import type { AgentId } from '../types'

/** How long the completion sequence holds the screen before the live state returns. */
const CELEBRATION_MS = 5_600

/** A run is worth celebrating when it moved through this many agents, not one. */
const CELEBRATION_MIN_AGENTS = 3

/**
 * How long the network must be still before a run counts as over. Agents
 * arrive as separate `started` / `finished` frames with a hand-off gap between
 * them; deciding at the first gap would judge every agent alone.
 */
const SETTLE_MS = 1_800

export function AgentActivity() {
  const agents = useStore((s) => s.agents)
  const activity = useStore((s) => s.activity)
  const setAgent = useStore((s) => s.setAgent)
  const runScraping = useStore((s) => s.runScraping)
  const runValidation = useStore((s) => s.runValidation)
  const setPage = useStore((s) => s.setPage)
  const scrapeRun = useStore((s) => s.scrapeRun)
  const agentRun = useStore((s) => s.agentRun)

  const [view, setView] = useState<'network' | 'list'>('network')
  const [pinned, setPinned] = useState<AgentId | null>(null)
  const [touring, setTouring] = useState(false)
  const [tourIndex, setTourIndex] = useState(0)
  const [inFlight, setInFlight] = useState(false)
  const [hovered, setHovered] = useState<AgentId | null>(null)
  const [pointer, setPointer] = useState<{ x: number; y: number; width: number }>({ x: 0, y: 0, width: 0 })
  const [celebrating, setCelebrating] = useState(false)
  const stageRef = useRef<HTMLDivElement | null>(null)

  const running = agents.find((a) => a.status === 'running')
  const failed = agents.find((a) => a.status === 'failed')

  // A running agent takes precedence over the tour and the pin.
  const focused: AgentId = running?.agent_id ?? pinned ?? (AGENTS[tourIndex]?.id as AgentId) ?? 'assistant'

  // The command plane is live while this client has a run in flight,
  // whichever engine is driving it. The server's pipeline row is deliberately
  // not consulted here: it is a snapshot that refreshes on refetch, and a row
  // left at `running` by a crashed run would hold the dispatch — and the
  // completion sequence's falling edge — open forever.
  const commandActive = scrapeRun.running || agentRun.running
  const anyRunning = commandActive || agents.some((a) => a.status === 'running')

  useEffect(() => {
    if (!touring || pinned) return
    const timer = window.setInterval(() => setTourIndex((i) => (i + 1) % AGENTS.length), 3_200)
    return () => window.clearInterval(timer)
  }, [touring, pinned])

  // 900ms virtual transit: the rail shows the signal in flight before it lands.
  useEffect(() => {
    setInFlight(true)
    const timer = window.setTimeout(() => setInFlight(false), 900)
    return () => window.clearTimeout(timer)
  }, [focused])

  /**
   * The completion sequence plays when a run that moved through several
   * agents comes to rest with none of them failed. "Run validation" alone
   * finishes one agent and is not a workflow; a failure is not a completion.
   * The store never says "the run finished" in one place for both engines,
   * so the falling edge of "anything is running" is the honest trigger.
   */
  const touched = useRef<Set<AgentId>>(new Set())
  const settle = useRef<number | null>(null)
  useEffect(() => {
    for (const a of agents) if (a.status === 'running') touched.current.add(a.agent_id)
    if (anyRunning) {
      if (settle.current !== null) window.clearTimeout(settle.current)
      settle.current = null
      return
    }
    if (touched.current.size === 0 || settle.current !== null) return
    settle.current = window.setTimeout(() => {
      settle.current = null
      const ran = touched.current
      touched.current = new Set()
      // Only this run's agents count. A failure left over from an earlier run
      // is still on screen — honestly — but it is not this run's verdict.
      const latest = useStore.getState().agents
      const failedNow = latest.some((a) => ran.has(a.agent_id) && a.status === 'failed')
      if (ran.size >= CELEBRATION_MIN_AGENTS && !failedNow) {
        setCelebrating(true)
      }
    }, SETTLE_MS)
  }, [agents, anyRunning])

  useEffect(
    () => () => {
      if (settle.current !== null) window.clearTimeout(settle.current)
    },
    [],
  )

  useEffect(() => {
    if (!celebrating) return
    const timer = window.setTimeout(() => setCelebrating(false), CELEBRATION_MS)
    return () => window.clearTimeout(timer)
  }, [celebrating])

  const spec = AGENT_BY_ID[focused]
  const state = agents.find((a) => a.agent_id === focused)
  const skills = SKILLS_BY_AGENT[focused] ?? []
  const recent = activity.filter((event) => event.agent_id === focused).slice(0, 4)

  const hoveredSpec = hovered ? AGENT_BY_ID[hovered] : null
  const hoveredState = hovered ? agents.find((a) => a.agent_id === hovered) : null

  return (
    <>
      <PageHeader
        title="Agent Orchestration"
        subtitle="Twelve agents in seven stages, one network. Work travels along the synapses; start the tour to follow the signal, or click any agent to hold it."
        actions={
          <>
            <Btn
              variant="ghost"
              onClick={() => {
                setAgent('scraping', { status: 'failed', current_task: 'The crawl4ai sidecar timed out twice on reward modeling' })
              }}
            >
              Simulate failure
            </Btn>
            <Btn variant="subtle" onClick={() => void runValidation()}>
              Run validation
            </Btn>
            <PlayButton
              label="Run SocialAI"
              hint="Watch the signal travel"
              running={scrapeRun.running}
              onClick={() => {
                // The run itself is unchanged. It plays out here, in the
                // network, rather than behind the theater overlay.
                void runScraping()
              }}
            />
          </>
        }
      />

      {failed ? (
        <section className="anim-fade-in mb-4 flex flex-wrap items-center gap-3 rounded-xl border border-critical/40 bg-critical/10 px-4 py-2.5">
          <AlertTriangle size={15} className="text-critical-ink" aria-hidden="true" />
          <p className="min-w-0 flex-1 text-[12px] text-critical-ink">
            {AGENT_BY_ID[failed.agent_id]?.name} failed — {failed.current_task}. The rest of the run has not
            completed.
          </p>
          <Btn
            variant="ghost"
            onClick={() => setAgent(failed.agent_id, { status: 'idle', current_task: 'Idle' })}
          >
            <RotateCcw size={12} /> Retry
          </Btn>
        </section>
      ) : null}

      <div className="grid items-start gap-4 xl:grid-cols-[1fr_380px]">
        {/* ── The network ───────────────────────────────────────────────── */}
        <section className="card overflow-hidden">
          <header className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
            <Tabs<'network' | 'list'>
              active={view}
              onChange={setView}
              tabs={[
                { id: 'network', label: 'Network' },
                { id: 'list', label: 'List' },
              ]}
            />
            <div className="flex items-center gap-1.5">
              <Btn
                variant="ghost"
                onClick={() => {
                  setTouring(!touring)
                  setPinned(null)
                }}
              >
                {touring ? <List size={12} /> : <Play size={12} />}
                {touring ? 'End tour' : 'Start tour'}
              </Btn>
            </div>
          </header>

          {view === 'network' ? (
            <>
              <div
                ref={stageRef}
                className="orch-stage p-4"
                role="img"
                aria-label="The hand-off network: Ethara commands, Sherlock scrapes, Dexter validates, Analysis consolidates, Dora plans, SpongeBob writes, Minnie illustrates, Review checks, Mickey publishes, Jerry measures, Velma learns, and the Knowledge Base is read and written by every stage."
                onPointerMove={(event) => {
                  const rect = stageRef.current?.getBoundingClientRect()
                  if (!rect) return
                  setPointer({ x: event.clientX - rect.left, y: event.clientY - rect.top, width: rect.width })
                }}
              >
                <OrchestrationDiagram
                  agents={agents}
                  focused={focused}
                  focusExplicit={pinned !== null || touring || running !== undefined}
                  commandActive={commandActive}
                  onSelect={(id) => {
                    setPinned(id)
                    setTouring(false)
                  }}
                  onHover={setHovered}
                />

                {hoveredSpec ? (
                  <div
                    className="orch-hud"
                    style={{
                      left: Math.max(8, Math.min(pointer.x + 18, pointer.width - 256)),
                      top: Math.max(12, pointer.y - 24),
                    }}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[12.5px] font-semibold text-ink">{hoveredSpec.name}</span>
                      <span className="text-[10.5px] text-ink-3">{agentRealName(hoveredSpec.id)}</span>
                      <Badge
                        tone={
                          hoveredState?.status === 'running'
                            ? 'accent'
                            : hoveredState?.status === 'failed'
                              ? 'critical'
                              : hoveredState?.status === 'needs_review'
                                ? 'serious'
                                : hoveredState?.status === 'completed'
                                  ? 'good'
                                  : 'neutral'
                        }
                      >
                        {AGENT_STATUS_META[hoveredState?.status ?? 'idle'].label}
                      </Badge>
                    </div>
                    <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">{hoveredSpec.role}</p>
                    {hoveredState?.current_task ? (
                      <p className="mt-1 truncate text-[10.5px] text-ink-2">{hoveredState.current_task}</p>
                    ) : null}
                    <div className="mt-2 grid grid-cols-3 gap-1.5 text-[10px]">
                      <span>
                        <span className="block uppercase tracking-[0.08em] text-ink-3">Processed</span>
                        <span className="tabular text-ink">{hoveredState?.processed ?? 0}</span>
                      </span>
                      <span>
                        <span className="block uppercase tracking-[0.08em] text-ink-3">Success</span>
                        <span className="tabular text-ink">{hoveredState?.success_rate ?? 100}%</span>
                      </span>
                      <span>
                        <span className="block uppercase tracking-[0.08em] text-ink-3">Last run</span>
                        <span className="tabular text-ink">{timeAgo(hoveredState?.last_run)}</span>
                      </span>
                    </div>
                  </div>
                ) : null}

                {celebrating ? (
                  <div className="orch-complete" aria-live="polite">
                    <div className="orch-complete-glow" aria-hidden="true" />
                    <div className="orch-complete-card">
                      <span className="orch-complete-brand">SocialAI</span>
                      <span className="orch-complete-title">Orchestration complete</span>
                      <span className="orch-complete-meta tabular">
                        {SCENE_AGENT_COUNT} agents · {SCENE_STAGE_COUNT} stages · 1 workflow
                      </span>
                    </div>
                  </div>
                ) : null}

              </div>

              <div className="mt-1 flex flex-wrap items-center gap-4 px-3 pb-2 text-[10px] text-ink-3">
                <span className="flex items-center gap-1.5">
                  <span className="h-px w-5 bg-line-strong" aria-hidden="true" /> Hand-off
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-px w-5 border-t border-dashed border-accent" aria-hidden="true" /> Memory read/write
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-px w-5 border-t border-dotted border-magenta" aria-hidden="true" /> Ethara control
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-px w-5 border-t border-dashed border-accent" aria-hidden="true" /> Carrying work
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-1.5 w-1.5 rounded-full bg-good" aria-hidden="true" /> Completed path · the
                  travelling dot retraces the route the work took
                </span>
                <span className="ml-auto">
                  Hovering: {hovered ? agentDisplayName(hovered) : 'nothing'} · Holding: {agentDisplayName(focused)}
                </span>
              </div>
            </>
          ) : (
            <div className="p-3">
              <ul className="space-y-1">
                {AGENTS.map((agent, i) => {
                  const agentState = agents.find((a) => a.agent_id === agent.id)
                  const status = agentState?.status ?? 'idle'
                  return (
                    <li key={agent.id}>
                      <button
                        type="button"
                        onClick={() => {
                          setPinned(agent.id)
                          setTouring(false)
                        }}
                        className={`flex w-full items-center gap-3 rounded-lg border px-3 py-2 text-left transition-colors ${
                          focused === agent.id ? 'border-accent bg-accent/10' : 'border-transparent hover:bg-surface-2'
                        }`}
                      >
                        <span className="tabular w-5 shrink-0 text-[11px] text-ink-3">{i}</span>
                        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${AGENT_STATUS_META[status].dot}`} aria-hidden="true" />
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5 text-[12px] font-medium text-ink">
                            <AgentIcon agentId={agent.id} size={12} className="text-accent-bright" />
                            {agent.name}
                          </span>
                          <span className="block truncate text-[10.5px] text-ink-3">{agentState?.current_task ?? agent.role}</span>
                        </span>
                        <Badge tone="neutral">{agent.stage}</Badge>
                      </button>
                      {i < AGENTS.length - 1 ? (
                        <span className="ml-[26px] block h-3 w-px bg-line-strong" aria-hidden="true" />
                      ) : null}
                    </li>
                  )
                })}
              </ul>
            </div>
          )}
        </section>

        {/* ── Right rail ────────────────────────────────────────────────── */}
        <aside className="space-y-4">
          <section className="card overflow-hidden p-4">
            {inFlight ? (
              <div className="anim-neural-transit h-1 w-full rounded-full bg-accent" aria-hidden="true" />
            ) : (
              <>
                <div className="flex flex-wrap items-center gap-2">
                  <h3 className="display flex items-center gap-2 text-sm">
                    <AgentIcon agentId={focused} size={15} className="text-accent-bright" />
                    {spec?.name}
                  </h3>
                  <Badge tone="neutral">{spec?.stage}</Badge>
                  <Badge
                    tone={
                      state?.status === 'running'
                        ? 'accent'
                        : state?.status === 'failed'
                          ? 'critical'
                          : state?.status === 'needs_review'
                            ? 'serious'
                            : 'neutral'
                    }
                  >
                    {AGENT_STATUS_META[state?.status ?? 'idle'].label}
                  </Badge>
                </div>

                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{spec?.role}</p>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{state?.current_task}</p>

                <div className="mt-3 grid grid-cols-3 gap-1.5">
                  <Metric label="Processed" value={state?.processed ?? 0} />
                  <Metric label="Success" value={`${state?.success_rate ?? 100}%`} />
                  <Metric label="Last run" value={timeAgo(state?.last_run)} />
                </div>

                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Receives from</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {AGENTS.filter((a) => a.handsOffTo.includes(focused)).map((a) => (
                        <button
                          key={a.id}
                          type="button"
                          onClick={() => setPinned(a.id)}
                          className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                        >
                          {a.name.replace(' Agent', '')}
                        </button>
                      ))}
                      {AGENTS.filter((a) => a.handsOffTo.includes(focused)).length === 0 ? (
                        <span className="text-[10.5px] text-ink-3">Nothing — this is an entry point.</span>
                      ) : null}
                    </div>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Hands to</p>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {(spec?.handsOffTo ?? []).slice(0, 6).map((id) => (
                        <button
                          key={id}
                          type="button"
                          onClick={() => setPinned(id)}
                          className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                        >
                          {AGENT_BY_ID[id]?.name.replace(' Agent', '')}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>

                <div className="mt-3">
                  <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Skills</p>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {skills.slice(0, 6).map((skill) => (
                      <span key={skill.id} className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-3">
                        {skill.name}
                      </span>
                    ))}
                    {skills.length > 6 ? (
                      <button
                        type="button"
                        onClick={() => setPage('studio')}
                        className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-accent-bright transition-colors hover:border-accent"
                      >
                        +{skills.length - 6} more in Agent Studio
                      </button>
                    ) : null}
                  </div>
                </div>

                {recent.length > 0 ? (
                  <div className="mt-3">
                    <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Recent events</p>
                    <ul className="mt-1 space-y-1">
                      {recent.map((event) => (
                        <li key={event.id} className="text-[11px] leading-relaxed text-ink-3">
                          {event.message}
                        </li>
                      ))}
                    </ul>
                  </div>
                ) : null}
              </>
            )}
          </section>

          <section className="card max-h-[420px] overflow-y-auto p-4">
            <h3 className="display mb-2 text-sm">Activity timeline</h3>
            <ul className="space-y-2">
              {activity.map((event) => (
                <li key={event.id} className="flex items-start gap-2">
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      event.status === 'error'
                        ? 'bg-critical'
                        : event.status === 'warn'
                          ? 'bg-warn'
                          : event.status === 'running'
                            ? 'bg-accent anim-pulse-dot'
                            : 'bg-good'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] leading-relaxed text-ink-2">{event.message}</span>
                    <span className="block text-[10px] text-ink-3">
                      {event.agent_id} · {timeAgo(event.created_at)}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          </section>
        </aside>
      </div>

      <span className="sr-only">
        <Network size={0} aria-hidden="true" />
      </span>
    </>
  )
}

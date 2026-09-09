/**
 * AGENT ORCHESTRATION
 *
 * Twelve agents in seven stages, one network. The edges are drawn directly
 * from `handsOffTo`, so the picture *is* the spec — if the graph is wrong, the
 * registry is wrong.
 */

import { useEffect, useMemo, useState } from 'react'
import { AlertTriangle, List, Network, Play, RotateCcw } from 'lucide-react'
import { AGENTS, AGENT_BY_ID, SKILLS_BY_AGENT, STAGES as REGISTRY_STAGES } from '@shared/agent-registry'
import { AGENT_STATUS_META, useStore } from '../store'
import { PageHeader } from '../components/layout'
import { PlayButton } from '../components/play-button'
import { AssistantCore } from '../components/assistant/core'
import { Badge, Btn, Metric, Tabs, timeAgo } from '../components/ui'
import type { AgentId } from '../types'

const VIEW_WIDTH = 1060
const VIEW_HEIGHT = 640

/** The six pipeline stages, left to right. The command plane sits alone, before them. */
const FLOW_STAGES = REGISTRY_STAGES.filter((stage) => stage.id !== 'command')

interface Placed {
  id: AgentId
  x: number
  y: number
  stageIndex: number
}

function layout(): { nodes: Placed[]; columns: Array<{ label: string; x: number; index: number }> } {
  const nodes: Placed[] = []
  const columns: Array<{ label: string; x: number; index: number }> = []

  const left = 190
  const usable = VIEW_WIDTH - left - 60
  const columnWidth = usable / FLOW_STAGES.length

  for (const [i, stage] of FLOW_STAGES.entries()) {
    const x = left + columnWidth * i + columnWidth / 2
    columns.push({ label: stage.name, x, index: i })

    const inStage = AGENTS.filter((agent) => agent.stage === stage.id)
    const gap = 330 / (inStage.length + 1)
    for (const [j, agent] of inStage.entries()) {
      nodes.push({ id: agent.id, x, y: 130 + gap * (j + 1), stageIndex: i })
    }
  }

  return { nodes, columns }
}

const TWINKLES = Array.from({ length: 34 }, (_, i) => ({
  cx: 20 + ((i * 173) % (VIEW_WIDTH - 40)),
  cy: 20 + ((i * 271) % (VIEW_HEIGHT - 40)),
  delay: (i % 9) * 1.1,
}))

export function AgentActivity() {
  const agents = useStore((s) => s.agents)
  const activity = useStore((s) => s.activity)
  const setAgent = useStore((s) => s.setAgent)
  const runScraping = useStore((s) => s.runScraping)
  const runValidation = useStore((s) => s.runValidation)
  const openTheater = useStore((s) => s.openTheater)
  const setPage = useStore((s) => s.setPage)
  const coreState = useStore((s) => s.assistant.coreState)
  const scrapeRun = useStore((s) => s.scrapeRun)

  const [view, setView] = useState<'network' | 'list'>('network')
  const [pinned, setPinned] = useState<AgentId | null>(null)
  const [touring, setTouring] = useState(false)
  const [tourIndex, setTourIndex] = useState(0)
  const [inFlight, setInFlight] = useState(false)

  const { nodes, columns } = useMemo(layout, [])

  const running = agents.find((a) => a.status === 'running')
  const failed = agents.find((a) => a.status === 'failed')

  // A running agent always takes precedence over the tour.
  const focused: AgentId = running?.agent_id ?? pinned ?? (AGENTS[tourIndex]?.id as AgentId) ?? 'assistant'

  useEffect(() => {
    if (!touring || pinned) return
    const timer = window.setInterval(() => setTourIndex((i) => (i + 1) % AGENTS.length), 3_200)
    return () => window.clearInterval(timer)
  }, [touring, pinned])

  // The 900ms virtual transit: the rail shows the signal in flight before it lands.
  useEffect(() => {
    setInFlight(true)
    const timer = window.setTimeout(() => setInFlight(false), 900)
    return () => window.clearTimeout(timer)
  }, [focused])

  const spec = AGENT_BY_ID[focused]
  const state = agents.find((a) => a.agent_id === focused)
  const skills = SKILLS_BY_AGENT[focused] ?? []
  const recent = activity.filter((event) => event.agent_id === focused).slice(0, 4)

  const positionOf = (id: AgentId): { x: number; y: number } => {
    if (id === 'assistant') return { x: 88, y: VIEW_HEIGHT / 2 }
    const node = nodes.find((n) => n.id === id)
    return node ? { x: node.x, y: node.y } : { x: 88, y: VIEW_HEIGHT / 2 }
  }

  return (
    <>
      <PageHeader
        title="Agent Orchestration"
        subtitle="Twelve agents in seven stages, one network. Work travels along the synapses; start the tour to follow the signal, or click any agent to hold it."
        askPrompt="What is every agent doing right now?"
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
                openTheater()
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
            {AGENT_BY_ID[failed.agent_id]?.name} failed — {failed.current_task}. The rest of the run
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

      <div className="grid gap-4 xl:grid-cols-[1fr_380px]">
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
          </header>

          {view === 'network' ? (
            <div className="stage-3d overflow-x-auto p-2">
              <svg
                viewBox={`0 0 ${VIEW_WIDTH} ${VIEW_HEIGHT}`}
                className="plane-3d h-auto w-full min-w-[760px]"
                role="img"
                aria-label="The agent network: Ethara on the left with control edges to every agent, then six pipeline stages joined by hand-off edges, over a Knowledge Base memory row."
              >
                <defs>
                  <radialGradient id="node-fill" cx="50%" cy="35%" r="70%">
                    <stop offset="0%" stopColor="var(--color-surface-3)" />
                    <stop offset="100%" stopColor="var(--color-surface)" />
                  </radialGradient>
                </defs>

                {/* Background twinkles. */}
                {TWINKLES.map((dot, i) => (
                  <circle
                    key={i}
                    className="twinkle"
                    cx={dot.cx}
                    cy={dot.cy}
                    r={1.2}
                    fill="var(--color-hud-strong)"
                    style={{ animationDelay: `${dot.delay}s` }}
                  />
                ))}

                {/* Stage bands. */}
                {columns.map((column) => (
                  <g key={column.label}>
                    <rect
                      x={column.x - 76}
                      y={96}
                      width={152}
                      height={370}
                      rx={16}
                      fill="var(--color-surface-2)"
                      opacity={0.35}
                      stroke="var(--color-line)"
                    />
                    <text x={column.x} y={78} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)" className="uppercase">
                      Step {column.index + 1}
                    </text>
                    <text x={column.x} y={90} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--color-ink-2)">
                      {column.label}
                    </text>
                  </g>
                ))}

                {/* The command column. */}
                <rect x={22} y={96} width={132} height={370} rx={16} fill="var(--color-surface-2)" opacity={0.4} stroke="var(--color-magenta)" strokeOpacity={0.3} />
                <text x={88} y={78} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)" className="uppercase">
                  Command
                </text>
                <text x={88} y={90} textAnchor="middle" fontSize={10.5} fontWeight={600} fill="var(--color-magenta-ink)">
                  Ethara
                </text>

                {/* The memory row spanning all six stages. */}
                <rect
                  x={168}
                  y={490}
                  width={VIEW_WIDTH - 218}
                  height={54}
                  rx={14}
                  fill="var(--color-surface-2)"
                  opacity={0.5}
                  stroke="var(--color-accent)"
                  strokeOpacity={0.3}
                  strokeDasharray="6 5"
                />
                <text x={VIEW_WIDTH / 2 + 20} y={514} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-accent-bright)">
                  KNOWLEDGE BASE
                </text>
                <text x={VIEW_WIDTH / 2 + 20} y={530} textAnchor="middle" fontSize={8.5} fill="var(--color-ink-3)">
                  MEMORY · READ AND WRITTEN BY EVERY STAGE
                </text>

                {/* Command edges: Ethara to every agent. Dotted. */}
                {AGENTS.filter((agent) => agent.id !== 'assistant').map((agent) => {
                  const from = positionOf('assistant')
                  const to = positionOf(agent.id)
                  const dx = (to.x - from.x) * 0.5
                  return (
                    <path
                      key={`cmd-${agent.id}`}
                      d={`M ${from.x + 34} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x - 26} ${to.y}`}
                      fill="none"
                      stroke="var(--color-magenta)"
                      strokeWidth={0.8}
                      strokeDasharray="2 5"
                      opacity={focused === agent.id ? 0.6 : 0.18}
                    />
                  )
                })}

                {/* Hand-off edges, drawn from handsOffTo. */}
                {AGENTS.filter((agent) => agent.id !== 'assistant').flatMap((agent) =>
                  agent.handsOffTo
                    .filter((target) => target !== 'assistant')
                    .map((target) => {
                      const from = positionOf(agent.id)
                      const to = positionOf(target)
                      const memory = agent.id === 'knowledge' || target === 'knowledge'
                      const hot = focused === target || focused === agent.id
                      const dx = Math.max(40, (to.x - from.x) * 0.5)
                      const path = `M ${from.x + 26} ${from.y} C ${from.x + dx} ${from.y}, ${to.x - dx} ${to.y}, ${to.x - 26} ${to.y}`

                      return (
                        <g key={`edge-${agent.id}-${target}`}>
                          <path
                            d={path}
                            fill="none"
                            stroke={memory ? 'var(--color-accent)' : 'var(--color-line-strong)'}
                            strokeWidth={hot ? 1.7 : 1}
                            strokeDasharray={memory ? '5 6' : undefined}
                            opacity={hot ? 0.9 : 0.34}
                            className={hot ? 'edge-hot' : ''}
                          />
                          <circle r={hot ? 2.6 : 1.8} fill={hot ? 'var(--color-magenta)' : 'var(--color-hud-strong)'} opacity={hot ? 1 : 0.5}>
                            <animateMotion dur={hot ? '0.9s' : '5.2s'} repeatCount="indefinite" path={path} />
                          </circle>
                        </g>
                      )
                    }),
                )}

                {/* The command plane node — the live core mark. */}
                <g
                  transform={`translate(${positionOf('assistant').x}, ${positionOf('assistant').y})`}
                  className="cursor-pointer"
                  onClick={() => {
                    setPinned('assistant')
                    setTouring(false)
                  }}
                >
                  <circle r={34} fill="url(#node-fill)" stroke="var(--color-magenta)" strokeWidth={focused === 'assistant' ? 2 : 1.2} />
                  <foreignObject x={-22} y={-22} width={44} height={44}>
                    <AssistantCore state={coreState} size={44} />
                  </foreignObject>
                  <text x={0} y={50} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-ink)">
                    Ethara
                  </text>
                  <text x={0} y={62} textAnchor="middle" fontSize={8.5} fill="var(--color-ink-3)">
                    command
                  </text>
                </g>

                {/* Agent nodes. */}
                {nodes.map((node) => {
                  const agentState = agents.find((a) => a.agent_id === node.id)
                  const agentSpec = AGENT_BY_ID[node.id]
                  const status = agentState?.status ?? 'idle'
                  const active = focused === node.id
                  const order = AGENTS.findIndex((a) => a.id === node.id)

                  const colour =
                    status === 'running'
                      ? 'var(--color-accent-bright)'
                      : status === 'failed'
                        ? 'var(--color-critical)'
                        : status === 'needs_review'
                          ? 'var(--color-serious)'
                          : status === 'waiting'
                            ? 'var(--color-warn)'
                            : status === 'completed'
                              ? 'var(--color-good)'
                              : 'var(--color-line-strong)'

                  return (
                    <g
                      key={node.id}
                      transform={`translate(${node.x}, ${node.y})`}
                      className="cursor-pointer"
                      onClick={() => {
                        setPinned(node.id)
                        setTouring(false)
                      }}
                    >
                      {status === 'running' ? (
                        <>
                          <circle className="node-halo" r={36} fill="none" stroke="var(--color-accent)" strokeWidth={1} />
                          <circle
                            r={30}
                            fill="none"
                            stroke="var(--color-accent-bright)"
                            strokeWidth={1.2}
                            strokeDasharray="12 140"
                            style={{ transformOrigin: 'center', animation: 'ring-spin 2.6s linear infinite' }}
                          />
                        </>
                      ) : null}
                      {status === 'needs_review' ? (
                        <circle className="node-halo" r={33} fill="none" stroke="var(--color-serious)" strokeWidth={1} />
                      ) : null}

                      <circle r={26} fill="url(#node-fill)" stroke={colour} strokeWidth={active ? 2 : 1.2} />
                      <text x={0} y={-2} textAnchor="middle" fontSize={11} fontWeight={600} fill={colour}>
                        {order}
                      </text>
                      <circle cx={0} cy={9} r={2.4} fill={colour} />

                      <text x={0} y={42} textAnchor="middle" fontSize={9.5} fontWeight={600} fill="var(--color-ink-2)">
                        {agentSpec?.name.replace(' Agent', '') ?? node.id}
                      </text>
                      <text x={0} y={53} textAnchor="middle" fontSize={8} fill="var(--color-ink-3)">
                        {AGENT_STATUS_META[status].label}
                      </text>
                    </g>
                  )
                })}
              </svg>

              <div className="mt-1 flex flex-wrap items-center gap-4 px-2 pb-1 text-[10px] text-ink-3">
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
                  <span className="h-1.5 w-1.5 rounded-full bg-magenta" aria-hidden="true" /> Signal in transit
                </span>
              </div>
            </div>
          ) : (
            <ul className="p-3">
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
                        <span className="block text-[12px] font-medium text-ink">{agent.name}</span>
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
                  <h3 className="display text-sm">{spec?.name}</h3>
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
                <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{state?.current_task}</p>

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
                          {AGENT_BY_ID[id]?.name.replace(' Agent', '') ?? id}
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

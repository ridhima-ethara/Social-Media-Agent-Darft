/**
 * THE ORCHESTRATION DIAGRAM — seven stages, twelve agents, one flat picture
 *
 * Derived entirely from the registry: stages become columns, agents stack
 * inside their stage, and every line is a declared `handsOffTo`. Nothing is
 * positioned by hand, so the diagram cannot disagree with `graph.ts`.
 *
 * Edges are SVG so they stay crisp; nodes are HTML over the SVG so type and
 * icons render like the rest of the product. One motion cue per state: a
 * flowing dash on a pathway that is carrying work, a thin arc on an agent
 * that is running. Nothing orbits, nothing glows, nothing zooms.
 */

import { useEffect, useRef } from 'react'
import { AGENTS, AGENT_BY_ID, STAGES } from '@shared/agent-registry'
import { AGENT_STATUS_META } from '../store'
import { AgentIcon } from './agent-icon'
import type { AgentId, AgentRunStatus, AgentState } from '../types'

export const SCENE_AGENT_COUNT = AGENTS.length
export const SCENE_STAGE_COUNT = STAGES.length

export function agentDisplayName(id: AgentId): string {
  return AGENT_BY_ID[id]?.name.replace(' Agent', '') ?? id
}

/** The agent's real name: mascots carry it in their role, the rest already are it. */
export function agentRealName(id: AgentId): string {
  const spec = AGENT_BY_ID[id]
  if (!spec) return id
  if (spec.id === 'assistant') return 'Command plane'
  const lead = spec.role.split(' · ')[0]
  return lead.endsWith(' Agent') ? lead : spec.name
}

/**
 * Whether the role line would only restate the name.
 *
 * An agent with no mascot is named for its job, so its display name and its
 * role are the same words: "Knowledge" and "Knowledge Agent". A mascot's role
 * genuinely adds something — Sherlock is the Scraping Agent — and is kept.
 */
function redundantRole(id: AgentId): boolean {
  const display = agentDisplayName(id)
  const real = agentRealName(id)
  return real === display || real === `${display} Agent`
}

/* ── Layout, from the registry ─────────────────────────────────────────── */

const W = 1400
const H = 780
const TOP = 150
const BOTTOM = 590
/** A node plus its three label lines needs this much before the next node starts. */
const STACK_GAP = 200
const NODE_R = 27

interface Node {
  id: AgentId
  index: number
  x: number
  y: number
  readsKb: boolean
  writesKb: boolean
}

interface Edge {
  id: string
  from: AgentId
  to: AgentId
  kind: 'handoff' | 'memory' | 'command'
  path: string
  /** Stage index of the source, so travellers along the route stagger left to right. */
  step: number
}

function buildLayout(): { nodes: Node[]; edges: Edge[]; columns: Array<{ x: number; name: string; index: number }> } {
  const nodes: Node[] = []
  const columns: Array<{ x: number; name: string; index: number }> = []
  const colWidth = W / STAGES.length

  for (const [i, stage] of STAGES.entries()) {
    const x = colWidth * (i + 0.5)
    columns.push({ x, name: stage.name, index: i })
    const inStage = AGENTS.filter((agent) => agent.stage === stage.id)
    const gap = inStage.length > 1 ? Math.min(STACK_GAP, (BOTTOM - TOP) / (inStage.length - 1)) : 0
    const first = (TOP + BOTTOM) / 2 - (gap * (inStage.length - 1)) / 2
    for (const [k, agent] of inStage.entries()) {
      nodes.push({
        id: agent.id,
        index: AGENTS.findIndex((a) => a.id === agent.id),
        x,
        y: first + k * gap,
        readsKb: agent.id !== 'assistant' && (agent.id === 'knowledge' || agent.consumes.some((c) => /knowledge base/i.test(c))),
        writesKb: agent.id !== 'assistant' && (agent.id === 'knowledge' || agent.handsOffTo.includes('knowledge')),
      })
    }
  }

  const byId = Object.fromEntries(nodes.map((n) => [n.id, n])) as Record<AgentId, Node>
  const edges: Edge[] = []
  for (const agent of AGENTS) {
    for (const target of agent.handsOffTo) {
      if (target === 'assistant') continue
      const a = byId[agent.id]
      const b = byId[target]
      if (!a || !b) continue
      const memory = agent.id === 'knowledge' || target === 'knowledge'
      const kind: Edge['kind'] = agent.id === 'assistant' ? 'command' : memory ? 'memory' : 'handoff'
      // Leave and enter horizontally; a hand-off reads left to right.
      const dir = b.x >= a.x ? 1 : -1
      const x1 = a.x + NODE_R * dir
      const x2 = b.x - NODE_R * dir
      const dx = Math.max(60, Math.abs(x2 - x1) * 0.5)
      edges.push({
        id: `${agent.id}->${target}`,
        from: agent.id,
        to: target,
        kind,
        path: `M ${x1} ${a.y} C ${x1 + dx * dir} ${a.y}, ${x2 - dx * dir} ${b.y}, ${x2} ${b.y}`,
        step: Math.max(0, STAGES.findIndex((stage) => stage.id === agent.stage)),
      })
    }
  }

  return { nodes, edges, columns }
}

const LAYOUT = buildLayout()

const STATUS_STROKE: Record<AgentRunStatus, string> = {
  idle: 'var(--color-line-strong)',
  running: 'var(--color-accent)',
  completed: 'var(--color-good)',
  waiting: 'var(--color-warn)',
  needs_review: 'var(--color-serious)',
  failed: 'var(--color-critical)',
}

/* ── The diagram ───────────────────────────────────────────────────────── */

export interface OrchestrationDiagramProps {
  agents: AgentState[]
  /** The agent the rail is showing; its pathways are emphasised when the focus is a choice. */
  focused: AgentId
  focusExplicit: boolean
  /** The command plane is dispatching a run right now. */
  commandActive: boolean
  onSelect: (id: AgentId) => void
  onHover: (id: AgentId | null) => void
}

export function OrchestrationDiagram({ agents, focused, focusExplicit, commandActive, onSelect, onHover }: OrchestrationDiagramProps) {
  const statusOf = (id: AgentId): AgentRunStatus => agents.find((a) => a.agent_id === id)?.status ?? 'idle'

  const edgeLook = (
    edge: Edge,
  ): { stroke: string; width: number; opacity: number; flowing: boolean; settled: boolean; dashed: boolean } => {
    const from = statusOf(edge.from)
    const to = statusOf(edge.to)
    const lit = focusExplicit && (edge.from === focused || edge.to === focused)
    const flowing = from === 'running' || (from === 'completed' && to === 'running') || (edge.kind === 'command' && commandActive)
    const done = from === 'completed' && (to === 'completed' || to === 'needs_review')
    const broken = from === 'failed' || to === 'failed'

    if (broken) return { stroke: 'var(--color-critical)', width: 1.5, opacity: 0.8, flowing: false, settled: false, dashed: edge.kind !== 'handoff' }
    if (flowing) return { stroke: edge.kind === 'command' ? 'var(--color-magenta)' : 'var(--color-accent)', width: 1.8, opacity: 0.95, flowing: true, settled: false, dashed: true }
    // A finished route still shows which way the work went. One slow, dim
    // traveller per hand-off — enough to read the direction, not a light show.
    if (done) return { stroke: 'var(--color-good)', width: 1.5, opacity: 0.85, flowing: false, settled: edge.kind === 'handoff', dashed: edge.kind !== 'handoff' }
    if (lit) return { stroke: edge.kind === 'command' ? 'var(--color-magenta)' : 'var(--color-accent)', width: 1.6, opacity: 0.9, flowing: false, settled: false, dashed: edge.kind !== 'handoff' }
    return {
      stroke: edge.kind === 'command' ? 'var(--color-magenta)' : 'var(--color-line-strong)',
      width: 1,
      opacity: edge.kind === 'command' ? 0.3 : 0.55,
      flowing: false,
      settled: false,
      dashed: edge.kind !== 'handoff',
    }
  }

  const showCommand = commandActive || (focusExplicit && focused === 'assistant')
  const edges = LAYOUT.edges.filter((edge) => edge.kind !== 'command' || showCommand)

  // SMIL travellers cannot be stopped by CSS; reduced motion pauses the SVG itself.
  const svgRef = useRef<SVGSVGElement | null>(null)
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) svg.pauseAnimations()
  }, [])

  const readers = LAYOUT.nodes.filter((n) => n.readsKb).map((n) => agentDisplayName(n.id))
  const writers = LAYOUT.nodes.filter((n) => n.writesKb).map((n) => agentDisplayName(n.id))

  return (
    <div className="relative w-full" style={{ aspectRatio: `${W} / ${H}` }}>
      <svg ref={svgRef} viewBox={`0 0 ${W} ${H}`} className="absolute inset-0 h-full w-full" aria-hidden="true">
        {LAYOUT.columns.map((column) => (
          <g key={column.name} transform={`translate(${column.x}, 34)`}>
            <text textAnchor="middle" fontSize={10} letterSpacing={1.5} fill={column.index === 0 ? 'var(--color-magenta)' : 'var(--color-ink-3)'} className="uppercase">
              {column.index === 0 ? 'COMMAND' : `STEP ${column.index}`}
            </text>
            <text y={18} textAnchor="middle" fontSize={13} fontWeight={600} fill="var(--color-ink)">
              {column.name}
            </text>
            <line x1={-W / STAGES.length / 2 + 14} x2={W / STAGES.length / 2 - 14} y1={30} y2={30} stroke="var(--color-line)" strokeWidth={1} />
          </g>
        ))}

        {edges.map((edge) => {
          const look = edgeLook(edge)
          return (
            <g key={edge.id}>
              <path
                d={edge.path}
                fill="none"
                stroke={look.stroke}
                strokeWidth={look.width}
                opacity={look.opacity}
                strokeLinecap="round"
                strokeDasharray={look.flowing ? '6 8' : look.dashed ? '3 5' : undefined}
                className={look.flowing ? 'edge-flow' : ''}
                style={{ transition: 'stroke var(--dur-slow) var(--ease-out-soft), opacity var(--dur-slow) var(--ease-out-soft), stroke-width var(--dur-slow) var(--ease-out-soft)' }}
              />
              {/* Two signals in flight, half a cycle apart, so the pathway reads as carrying work rather than blinking. */}
              {look.flowing
                ? [0, 1].map((n) => (
                    <circle key={n} r={3.2} fill={look.stroke}>
                      <animateMotion dur="2.4s" begin={`${-n * 1.2}s`} repeatCount="indefinite" path={edge.path} calcMode="spline" keySplines="0.4 0 0.2 1" keyTimes="0;1" />
                    </circle>
                  ))
                : null}
              {/* The completed route, still legible as a route: one traveller per
                  hand-off, each starting a beat after the stage before it, so the
                  whole path reads as a single pass left to right. */}
              {look.settled ? (
                <circle r={2.4} fill={look.stroke} opacity={0.75}>
                  <animateMotion
                    dur="3.6s"
                    begin={`${edge.step * 0.4}s`}
                    repeatCount="indefinite"
                    path={edge.path}
                    calcMode="spline"
                    keySplines="0.4 0 0.2 1"
                    keyTimes="0;1"
                  />
                  <animate
                    attributeName="opacity"
                    dur="3.6s"
                    begin={`${edge.step * 0.4}s`}
                    repeatCount="indefinite"
                    values="0;0.75;0.75;0"
                    keyTimes="0;0.15;0.85;1"
                  />
                </circle>
              ) : null}
            </g>
          )
        })}
      </svg>

      {LAYOUT.nodes.map((node) => {
        const status = statusOf(node.id)
        const isFocused = focused === node.id
        const stroke = STATUS_STROKE[status]
        return (
          <button
            key={node.id}
            type="button"
            onClick={() => onSelect(node.id)}
            onPointerEnter={() => onHover(node.id)}
            onPointerLeave={() => onHover(null)}
            aria-label={`${agentDisplayName(node.id)}${
              redundantRole(node.id) ? '' : `, ${agentRealName(node.id)}`
            }, ${AGENT_STATUS_META[status].label}`}
            className="group anim-fade-up absolute flex -translate-x-1/2 -translate-y-1/2 flex-col items-center text-center outline-none"
            style={{ left: `${(node.x / W) * 100}%`, top: `${(node.y / H) * 100}%`, width: 150, animationDelay: `${node.index * 45}ms` }}
          >
            <span className="relative flex items-center justify-center" style={{ width: NODE_R * 2, height: NODE_R * 2 }}>
              {status === 'running' ? (
                <span className="anim-ping-slow absolute inset-0 rounded-full border border-accent" aria-hidden="true" />
              ) : null}
              <span
                className={`absolute inset-0 rounded-full bg-surface transition-[box-shadow,border-color,transform] duration-[var(--dur-base)] group-hover:scale-[1.04] ${
                  isFocused && focusExplicit ? 'ring-2 ring-accent/40 ring-offset-2 ring-offset-page' : 'group-hover:ring-2 group-hover:ring-line-strong group-hover:ring-offset-2 group-hover:ring-offset-page'
                }`}
                style={{ border: `1.5px solid ${stroke}` }}
              />
              {status === 'running' ? (
                <svg className="absolute" width={NODE_R * 2 + 12} height={NODE_R * 2 + 12} viewBox={`0 0 ${NODE_R * 2 + 12} ${NODE_R * 2 + 12}`} aria-hidden="true">
                  <circle
                    cx={NODE_R + 6}
                    cy={NODE_R + 6}
                    r={NODE_R + 4}
                    fill="none"
                    stroke="var(--color-accent)"
                    strokeWidth={1.4}
                    strokeLinecap="round"
                    strokeDasharray="50 180"
                    style={{ transformOrigin: 'center', animation: 'ring-spin 1.6s linear infinite' }}
                  />
                </svg>
              ) : null}
              <AgentIcon agentId={node.id} size={node.id === 'assistant' ? 22 : 18} className="relative text-ink-2" />
              <span className="tabular absolute -left-1 -top-1 flex h-[18px] min-w-[18px] items-center justify-center rounded-full border border-line bg-page px-1 text-[9.5px] text-ink-3">
                {node.index}
              </span>
            </span>

            <span className="mt-2 text-[12.5px] font-semibold leading-tight text-ink">{agentDisplayName(node.id)}</span>
            {/* A mascot's second line names the job it does. Where the agent has
                no mascot the second line only repeats the first — "Knowledge"
                over "Knowledge Agent" — and repeating it is noise. */}
            {redundantRole(node.id) ? null : (
              <span className="text-[10.5px] leading-tight text-ink-3">{agentRealName(node.id)}</span>
            )}
            <span className="mt-1 flex items-center gap-1.5 text-[10.5px] text-ink-3">
              <span className={`h-1.5 w-1.5 rounded-full ${AGENT_STATUS_META[status].dot}`} aria-hidden="true" />
              {AGENT_STATUS_META[status].label}
            </span>
          </button>
        )
      })}

      {/* The memory core, stated rather than drawn as a planet: what it is and who touches it. */}
      <div
        className="absolute inset-x-6 flex flex-wrap items-center gap-x-4 gap-y-1 rounded-xl border border-line bg-surface/85 px-4 py-2.5 backdrop-blur-sm"
        style={{ top: `${((BOTTOM + 96) / H) * 100}%` }}
      >
        <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-accent-bright">Knowledge Base</span>
        <span className="text-[11px] text-ink-3">Read before every stage acts, written back after.</span>
        <span className="ml-auto flex flex-wrap items-center gap-x-3 text-[10.5px] text-ink-3">
          <span>
            <span className="text-ink-2">Read by</span> {readers.join(', ')}
          </span>
          <span>
            <span className="text-ink-2">Written by</span> {writers.join(', ')}
          </span>
        </span>
      </div>
    </div>
  )
}

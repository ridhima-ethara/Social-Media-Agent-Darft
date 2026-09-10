/**
 * THE PIPELINE GRAPH
 *
 * A flat SVG diagram of scrape → validate. Edges are S-curve Béziers; an edge
 * that is currently working carries one travelling dot (SMIL `<animateMotion>`)
 * and settles to a still line once done. Nothing else moves.
 *
 * The graph never owns state, so it cannot disagree with the run. Pause calls
 * `svg.pauseAnimations()` — CSS alone cannot pause SMIL.
 */

import { useEffect, useRef } from 'react'
import type { ValidationVerdict } from '../types'

export interface GraphSource {
  id: string
  label: string
  count: number
  status: 'idle' | 'working' | 'done'
}

export interface GraphBucket {
  id: ValidationVerdict
  label: string
  count: number
  tone: string
}

export interface PipelineGraphProps {
  sources: GraphSource[]
  buckets: GraphBucket[]
  scrapingStatus: 'idle' | 'working' | 'done'
  validationStatus: 'idle' | 'working' | 'done'
  paused?: boolean
  /** Clicking a finished source or a populated bucket toggles the feed filter. */
  activeFilter?: string | null
  onFilter?: (filter: string | null) => void
  /** Replaces Dexter's status word when the run has something more exact to say, e.g. "Nothing new". */
  validationLabel?: string
  /** What crossed from Sherlock to Dexter, printed on the edge between them. */
  handoffLabel?: string
}

type Status = 'idle' | 'working' | 'done'

const WIDTH = 760
const HEIGHT = 460

const SOURCE_X = 92
const SCRAPE_X = 300
const VALIDATE_X = 480
const BUCKET_X = 676
const SOURCE_W = 108
const BUCKET_W = 84
const AGENT_R = 38

function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = (x2 - x1) * 0.55
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

function tone(status: Status): string {
  if (status === 'working') return 'var(--color-accent)'
  if (status === 'done') return 'var(--color-good)'
  return 'var(--color-line-strong)'
}

function Edge({ path, status, colour, weight = 1.25 }: { path: string; status: Status; colour?: string; weight?: number }) {
  const stroke = colour ?? tone(status)
  return (
    <g>
      <path d={path} fill="none" stroke={stroke} strokeWidth={status === 'idle' ? 1 : weight} opacity={status === 'idle' ? 0.5 : 0.9} />
      {status === 'working' ? (
        <circle r={2.5} fill={stroke}>
          <animateMotion dur="2.2s" repeatCount="indefinite" path={path} />
        </circle>
      ) : null}
    </g>
  )
}

export function PipelineGraph({
  sources,
  buckets,
  scrapingStatus,
  validationStatus,
  paused = false,
  activeFilter = null,
  onFilter,
  validationLabel,
  handoffLabel,
}: PipelineGraphProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    if (paused) svg.pauseAnimations()
    else svg.unpauseAnimations()
  }, [paused])

  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) svg.pauseAnimations()
  }, [])

  const sourceGap = HEIGHT / (sources.length + 1)
  const bucketGap = HEIGHT / (buckets.length + 1)
  const midY = HEIGHT / 2
  const coreStatus: Status =
    scrapingStatus === 'working' || validationStatus === 'working' ? 'working' : validationStatus === 'done' ? 'done' : 'idle'

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-full w-full"
      role="img"
      aria-label="The discovery pipeline: keyword sources feed Sherlock, the Scraping Agent, which feeds Dexter, the Validation Agent, who sorts every candidate into four buckets."
    >
      {sources.map((source, i) => {
        const y = sourceGap * (i + 1)
        return <Edge key={source.id} path={bezier(SOURCE_X + SOURCE_W / 2, y, SCRAPE_X - AGENT_R, midY)} status={source.status} />
      })}

      <Edge path={bezier(SCRAPE_X + AGENT_R, midY, VALIDATE_X - AGENT_R, midY)} status={coreStatus} weight={1.6} />
      {handoffLabel ? (
        <text x={(SCRAPE_X + VALIDATE_X) / 2} y={midY - 10} textAnchor="middle" fontSize={9} fontWeight={500} fill="var(--color-ink-3)">
          {handoffLabel}
        </text>
      ) : null}

      {buckets.map((bucket, i) => {
        const y = bucketGap * (i + 1)
        const filled = bucket.count > 0
        const status: Status = validationStatus === 'working' && filled ? 'working' : filled ? 'done' : 'idle'
        return (
          <Edge
            key={bucket.id}
            path={bezier(VALIDATE_X + AGENT_R, midY, BUCKET_X - BUCKET_W / 2, y)}
            status={status}
            colour={filled ? bucket.tone : undefined}
          />
        )
      })}

      {sources.map((source, i) => {
        const y = sourceGap * (i + 1)
        const selected = activeFilter === source.id
        const clickable = source.status === 'done' && Boolean(onFilter)
        return (
          <g
            key={source.id}
            transform={`translate(${SOURCE_X}, ${y})`}
            className={clickable ? 'cursor-pointer' : ''}
            onClick={() => {
              if (clickable && onFilter) onFilter(selected ? null : source.id)
            }}
          >
            <rect
              x={-SOURCE_W / 2}
              y={-17}
              width={SOURCE_W}
              height={34}
              rx={8}
              fill="var(--color-surface)"
              stroke={selected ? 'var(--color-accent)' : tone(source.status)}
              strokeWidth={selected ? 1.6 : 1}
            />
            <text x={0} y={-2} textAnchor="middle" fontSize={10} fontWeight={500} fill="var(--color-ink)">
              {source.label.length > 16 ? `${source.label.slice(0, 16)}…` : source.label}
            </text>
            <text x={0} y={10} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)" className="tabular">
              {source.count} items
            </text>
          </g>
        )
      })}

      <AgentNode x={SCRAPE_X} y={midY} name="Sherlock" role="Scraping Agent" status={scrapingStatus} paused={paused} />
      <AgentNode x={VALIDATE_X} y={midY} name="Dexter" role="Validation Agent" status={validationStatus} paused={paused} label={validationLabel} />

      {buckets.map((bucket, i) => {
        const y = bucketGap * (i + 1)
        const filled = bucket.count > 0
        const selected = activeFilter === bucket.id
        const clickable = filled && Boolean(onFilter)
        return (
          <g
            key={bucket.id}
            transform={`translate(${BUCKET_X}, ${y})`}
            className={clickable ? 'cursor-pointer' : ''}
            onClick={() => {
              if (clickable && onFilter) onFilter(selected ? null : bucket.id)
            }}
          >
            <rect
              x={-BUCKET_W / 2}
              y={-20}
              width={BUCKET_W}
              height={40}
              rx={8}
              fill="var(--color-surface)"
              stroke={selected ? 'var(--color-accent)' : filled ? bucket.tone : 'var(--color-line-strong)'}
              strokeWidth={selected ? 1.6 : 1}
            />
            <text x={0} y={-3} textAnchor="middle" fontSize={14} fontWeight={600} fill={filled ? bucket.tone : 'var(--color-ink-3)'} className="tabular">
              {bucket.count}
            </text>
            <text x={0} y={11} textAnchor="middle" fontSize={8.5} fill="var(--color-ink-3)">
              {bucket.label}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

function AgentNode({
  x,
  y,
  name,
  role,
  status,
  paused,
  label: labelOverride,
}: {
  x: number
  y: number
  name: string
  role: string
  status: Status
  paused: boolean
  label?: string
}) {
  const colour = tone(status)
  const label = labelOverride ?? (status === 'working' ? 'Working' : status === 'done' ? 'Done' : 'Idle')
  return (
    <g transform={`translate(${x}, ${y})`}>
      <circle r={AGENT_R} fill="var(--color-surface)" stroke={colour} strokeWidth={1.4} />
      {status === 'working' ? (
        <circle
          r={AGENT_R + 5}
          fill="none"
          stroke={colour}
          strokeWidth={1.2}
          strokeLinecap="round"
          strokeDasharray="60 220"
          style={{ transformOrigin: 'center', transformBox: 'fill-box', animation: 'ring-spin 1.6s linear infinite', animationPlayState: paused ? 'paused' : 'running' }}
        />
      ) : null}
      <text x={0} y={-2} textAnchor="middle" fontSize={11} fontWeight={600} fill="var(--color-ink)">
        {name}
      </text>
      <text x={0} y={11} textAnchor="middle" fontSize={8.5} fill="var(--color-ink-3)">
        {role}
      </text>
      <text x={0} y={AGENT_R + 16} textAnchor="middle" fontSize={9} fontWeight={500} fill={colour}>
        {label}
      </text>
    </g>
  )
}

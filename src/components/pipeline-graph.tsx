/**
 * THE PIPELINE GRAPH
 *
 * An SVG neural graph of scrape → validate. Edges are smooth S-curve Béziers
 * carrying a travelling pulse animated with SMIL `<animateMotion>`; an edge
 * lights "hot" only while its stage is working and settles to a muted "done".
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
  /** Clicking a finished source or a populated bucket toggles a feed filter. */
  activeFilter?: string | null
  onFilter?: (filter: string | null) => void
}

const WIDTH = 760
const HEIGHT = 460

/** A smooth S-curve between two points, flattened horizontally at both ends. */
function bezier(x1: number, y1: number, x2: number, y2: number): string {
  const dx = (x2 - x1) * 0.55
  return `M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`
}

const TWINKLES = Array.from({ length: 34 }, (_, i) => ({
  cx: 24 + ((i * 137) % (WIDTH - 48)),
  cy: 18 + ((i * 211) % (HEIGHT - 36)),
  delay: (i % 9) * 1.1,
  r: i % 3 === 0 ? 1.4 : 1,
}))

export function PipelineGraph({
  sources,
  buckets,
  scrapingStatus,
  validationStatus,
  paused = false,
  activeFilter = null,
  onFilter,
}: PipelineGraphProps) {
  const svgRef = useRef<SVGSVGElement | null>(null)

  // SMIL ignores CSS `animation-play-state`, so pausing is explicit.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    if (paused) svg.pauseAnimations()
    else svg.unpauseAnimations()
  }, [paused])

  // Reduced motion stops SMIL outright — the CSS block cannot reach it.
  useEffect(() => {
    const svg = svgRef.current
    if (!svg) return
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) svg.pauseAnimations()
  }, [])

  const sourceX = 92
  const scrapeX = 300
  const validateX = 480
  const bucketX = 676

  const sourceGap = HEIGHT / (sources.length + 1)
  const bucketGap = HEIGHT / (buckets.length + 1)
  const scrapeY = HEIGHT / 2
  const validateY = HEIGHT / 2

  const tone = (status: 'idle' | 'working' | 'done'): string =>
    status === 'working' ? 'var(--color-accent-bright)' : status === 'done' ? 'var(--color-good)' : 'var(--color-line-strong)'

  return (
    <svg
      ref={svgRef}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      className="h-full w-full"
      role="img"
      aria-label="The discovery pipeline: sources feed the Scraping Agent, which feeds the Validation Agent, which sorts every candidate into four buckets."
    >
      <defs>
        <radialGradient id="pg-node" cx="50%" cy="35%" r="70%">
          <stop offset="0%" stopColor="var(--color-surface-3)" />
          <stop offset="100%" stopColor="var(--color-surface)" />
        </radialGradient>
      </defs>

      {/* Background twinkle field. */}
      <g aria-hidden="true">
        {TWINKLES.map((dot, i) => (
          <circle
            key={i}
            className="twinkle"
            cx={dot.cx}
            cy={dot.cy}
            r={dot.r}
            fill="var(--color-hud-strong)"
            style={{ animationDelay: `${dot.delay}s` }}
          />
        ))}
      </g>

      {/* Source → scraping edges. */}
      {sources.map((source, i) => {
        const y = sourceGap * (i + 1)
        const path = bezier(sourceX + 52, y, scrapeX - 44, scrapeY)
        const hot = source.status === 'working'
        return (
          <g key={source.id}>
            <path
              d={path}
              fill="none"
              stroke={hot ? 'var(--color-accent-bright)' : source.status === 'done' ? 'var(--color-good)' : 'var(--color-line)'}
              strokeWidth={hot ? 1.8 : 1.2}
              opacity={source.status === 'idle' ? 0.4 : 0.85}
              className={hot ? 'edge-hot' : ''}
            />
            {source.status !== 'idle' ? (
              <circle r={2.6} fill={hot ? 'var(--color-magenta)' : 'var(--color-good)'}>
                <animateMotion dur={hot ? '1.5s' : '3.4s'} repeatCount="indefinite" path={path} />
              </circle>
            ) : null}
          </g>
        )
      })}

      {/* Scraping → validation. */}
      {(() => {
        const path = bezier(scrapeX + 44, scrapeY, validateX - 44, validateY)
        const hot = validationStatus === 'working' || scrapingStatus === 'working'
        return (
          <g>
            <path
              d={path}
              fill="none"
              stroke={hot ? 'var(--color-accent-bright)' : 'var(--color-line-strong)'}
              strokeWidth={2}
              className={hot ? 'edge-hot' : ''}
            />
            {hot ? (
              <circle r={3} fill="var(--color-magenta)">
                <animateMotion dur="1.2s" repeatCount="indefinite" path={path} />
              </circle>
            ) : null}
          </g>
        )
      })()}

      {/* Validation → buckets. */}
      {buckets.map((bucket, i) => {
        const y = bucketGap * (i + 1)
        const path = bezier(validateX + 44, validateY, bucketX - 40, y)
        const live = validationStatus === 'working' && bucket.count > 0
        return (
          <g key={bucket.id}>
            <path
              d={path}
              fill="none"
              stroke={bucket.count > 0 ? bucket.tone : 'var(--color-line)'}
              strokeWidth={bucket.count > 0 ? 1.6 : 1}
              opacity={bucket.count > 0 ? 0.85 : 0.35}
              className={live ? 'edge-hot' : ''}
            />
            {live ? (
              <circle r={2.4} fill={bucket.tone}>
                <animateMotion dur="1.4s" repeatCount="indefinite" path={path} />
              </circle>
            ) : null}
          </g>
        )
      })}

      {/* Source nodes. */}
      {sources.map((source, i) => {
        const y = sourceGap * (i + 1)
        const selected = activeFilter === source.id
        return (
          <g
            key={source.id}
            transform={`translate(${sourceX}, ${y})`}
            className={source.status === 'done' && onFilter ? 'cursor-pointer' : ''}
            onClick={() => {
              if (source.status === 'done' && onFilter) onFilter(selected ? null : source.id)
            }}
          >
            {source.status === 'working' ? (
              <circle className="node-halo" r={30} fill="none" stroke="var(--color-accent)" strokeWidth={1} />
            ) : null}
            <rect x={-52} y={-17} width={104} height={34} rx={17} fill="url(#pg-node)" stroke={selected ? 'var(--color-magenta)' : tone(source.status)} strokeWidth={selected ? 1.8 : 1.1} />
            <text x={0} y={-1} textAnchor="middle" fontSize={9.5} fill="var(--color-ink-2)">
              {source.label.length > 15 ? `${source.label.slice(0, 15)}…` : source.label}
            </text>
            <text x={0} y={10} textAnchor="middle" fontSize={9} fill="var(--color-ink-3)" className="tabular">
              {source.count} items
            </text>
          </g>
        )
      })}

      {/* The two agent nodes. */}
      <AgentNode x={scrapeX} y={scrapeY} label="Scraping Agent" status={scrapingStatus} />
      <AgentNode x={validateX} y={validateY} label="Validation Agent" status={validationStatus} />

      {/* Bucket nodes. */}
      {buckets.map((bucket, i) => {
        const y = bucketGap * (i + 1)
        const selected = activeFilter === bucket.id
        return (
          <g
            key={bucket.id}
            transform={`translate(${bucketX}, ${y})`}
            className={bucket.count > 0 && onFilter ? 'cursor-pointer' : ''}
            onClick={() => {
              if (bucket.count > 0 && onFilter) onFilter(selected ? null : bucket.id)
            }}
          >
            <rect
              x={-40}
              y={-19}
              width={80}
              height={38}
              rx={10}
              fill="url(#pg-node)"
              stroke={selected ? 'var(--color-magenta)' : bucket.count > 0 ? bucket.tone : 'var(--color-line)'}
              strokeWidth={selected ? 1.8 : 1.1}
              className={bucket.count > 0 ? 'anim-bucket-land' : ''}
            />
            <text x={0} y={-3} textAnchor="middle" fontSize={13} fontWeight={600} fill={bucket.count > 0 ? bucket.tone : 'var(--color-ink-3)'} className="tabular">
              {bucket.count}
            </text>
            <text x={0} y={10} textAnchor="middle" fontSize={8.5} fill="var(--color-ink-3)">
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
  label,
  status,
}: {
  x: number
  y: number
  label: string
  status: 'idle' | 'working' | 'done'
}) {
  const colour =
    status === 'working' ? 'var(--color-accent-bright)' : status === 'done' ? 'var(--color-good)' : 'var(--color-line-strong)'

  return (
    <g transform={`translate(${x}, ${y})`}>
      {status === 'working' ? (
        <>
          <circle className="node-halo" r={54} fill="none" stroke="var(--color-accent)" strokeWidth={1} />
          <circle
            r={44}
            fill="none"
            stroke="var(--color-magenta)"
            strokeWidth={1.4}
            strokeDasharray="14 200"
            style={{ transformOrigin: 'center', animation: 'ring-spin 2.4s linear infinite' }}
          />
        </>
      ) : null}
      <circle r={40} fill="url(#pg-node)" stroke={colour} strokeWidth={1.6} />
      <text x={0} y={-4} textAnchor="middle" fontSize={10} fontWeight={600} fill="var(--color-ink)">
        {label.split(' ')[0]}
      </text>
      <text x={0} y={8} textAnchor="middle" fontSize={8.5} fill="var(--color-ink-3)">
        Agent
      </text>
      <text x={0} y={20} textAnchor="middle" fontSize={7.5} fill={colour} className="uppercase">
        {status}
      </text>
    </g>
  )
}

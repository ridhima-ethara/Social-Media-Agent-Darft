/**
 * CHARTS — the only file in the product that imports Recharts.
 *
 * Series colours are theme-invariant and contrast-validated on both surfaces;
 * only the grid, axis ink and hover wash change with the theme. Every chart
 * sits in an `overflow-x: auto` container, so the page body never scrolls
 * horizontally.
 */

import { useMemo, type ReactNode } from 'react'
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'
import { useStore } from '../store'
import { fmt } from './ui'

/* ═══════════════════════════════════════════════════════════════════════════
   CHROME
   ═══════════════════════════════════════════════════════════════════════════ */

export const SERIES = {
  linkedin: '#3987e5',
  instagram: '#d55181',
  x: '#19a219',
  facebook: '#3b7dd8',
  accent: '#7a99d1',
} as const

interface Chrome {
  grid: string
  axis: string
  wash: string
}

const CHROME: Record<'dark' | 'light', Chrome> = {
  dark: { grid: 'rgba(122,153,209,0.16)', axis: '#8a8fa5', wash: 'rgba(122,153,209,0.10)' },
  light: { grid: 'rgba(83,78,125,0.16)', axis: '#767390', wash: 'rgba(84,112,194,0.10)' },
}

function useChrome(): Chrome {
  const theme = useStore((s) => s.theme)
  return CHROME[theme]
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE TOOLTIP
   ═══════════════════════════════════════════════════════════════════════════ */

interface TooltipPayloadEntry {
  name?: string
  value?: number
  color?: string
  dataKey?: string
}

export function ChartTooltip({
  active,
  payload,
  label,
  period = 'the period',
  formatter = fmt,
}: {
  active?: boolean
  payload?: TooltipPayloadEntry[]
  label?: string | number
  period?: string
  formatter?: (n: number) => string
}) {
  if (!active || !payload || payload.length === 0) return null

  const total = payload.reduce((sum, entry) => sum + (entry.value ?? 0), 0)
  const multi = payload.length > 1

  return (
    <div className="card px-3 py-2 shadow-xl">
      <p className="text-[11px] font-medium text-ink-2">{label}</p>
      <div className="mt-1.5 space-y-1">
        {payload.map((entry) => {
          const value = entry.value ?? 0
          const share = total > 0 ? (value / total) * 100 : 0
          return (
            <div key={entry.dataKey ?? entry.name} className="flex items-baseline gap-2">
              <span className="h-2 w-2 shrink-0 rounded-full" style={{ background: entry.color }} aria-hidden="true" />
              <span className="text-[11px] text-ink-3">{entry.name}</span>
              <span className="tabular ml-auto text-[11px] font-medium text-ink">{formatter(value)}</span>
              {multi ? (
                <span className="tabular text-[10px] text-ink-3">{share.toFixed(0)}% of {period}</span>
              ) : null}
            </div>
          )
        })}
      </div>
      {multi ? (
        <div className="mt-1.5 flex items-baseline justify-between border-t border-line pt-1.5">
          <span className="text-[11px] font-semibold text-ink">Total</span>
          <span className="tabular text-[11px] font-semibold text-ink">{formatter(total)}</span>
        </div>
      ) : null}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CARD WRAPPER
   ═══════════════════════════════════════════════════════════════════════════ */

export function ChartCard({
  title,
  subtitle,
  actions,
  children,
  height = 240,
}: {
  title: string
  subtitle?: string
  actions?: ReactNode
  children: ReactNode
  height?: number
}) {
  return (
    <section className="card p-4">
      <header className="mb-3 flex items-start justify-between gap-3">
        <div>
          <h3 className="display text-sm">{title}</h3>
          {subtitle ? <p className="mt-0.5 text-[11px] text-ink-3">{subtitle}</p> : null}
        </div>
        {actions}
      </header>
      <div className="chart-reveal overflow-x-auto" style={{ height }}>
        <div style={{ height, minWidth: 320 }}>{children}</div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BASIC THREE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SeriesSpec {
  key: string
  name: string
  colour: string
}

export function TrendLine({
  data,
  series,
  xKey = 'label',
}: {
  data: Array<Record<string, string | number>>
  series: SeriesSpec[]
  xKey?: string
}) {
  const chrome = useChrome()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <LineChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
        <CartesianGrid stroke={chrome.grid} strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey={xKey} stroke={chrome.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis stroke={chrome.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmt} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: chrome.grid }} />
        {series.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.colour}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
            isAnimationActive={false}
          />
        ))}
      </LineChart>
    </ResponsiveContainer>
  )
}

export function TrendArea({
  data,
  series,
  xKey = 'label',
}: {
  data: Array<Record<string, string | number>>
  series: SeriesSpec[]
  xKey?: string
}) {
  const chrome = useChrome()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
        <defs>
          {series.map((s) => (
            <linearGradient key={s.key} id={`area-${s.key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={s.colour} stopOpacity={0.34} />
              <stop offset="100%" stopColor={s.colour} stopOpacity={0.02} />
            </linearGradient>
          ))}
        </defs>
        <CartesianGrid stroke={chrome.grid} strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey={xKey} stroke={chrome.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis stroke={chrome.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmt} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: chrome.grid }} />
        {series.map((s) => (
          <Area
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.name}
            stroke={s.colour}
            strokeWidth={2}
            fill={`url(#area-${s.key})`}
            isAnimationActive={false}
          />
        ))}
      </AreaChart>
    </ResponsiveContainer>
  )
}

export function BarsChart({
  data,
  series,
  xKey = 'label',
}: {
  data: Array<Record<string, string | number>>
  series: SeriesSpec[]
  xKey?: string
}) {
  const chrome = useChrome()
  return (
    <ResponsiveContainer width="100%" height="100%">
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 4, left: -18 }}>
        <CartesianGrid stroke={chrome.grid} strokeDasharray="3 5" vertical={false} />
        <XAxis dataKey={xKey} stroke={chrome.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} />
        <YAxis stroke={chrome.axis} tick={{ fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmt} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: chrome.wash }} />
        {series.map((s) => (
          <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.colour} radius={[4, 4, 0, 0]} isAnimationActive={false} />
        ))}
      </BarChart>
    </ResponsiveContainer>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE FLAGSHIP — one graph tells the whole story
   ═══════════════════════════════════════════════════════════════════════════ */

export interface InsightDetail<T> {
  label: string
  /** Reads the figure off the row, when it is not the primary value. */
  derive?: (row: T) => number | string
  key?: keyof T
  format?: (value: number) => string
}

export interface InsightChartProps<T extends { label: string; value: number }> {
  data: T[]
  /** e.g. "August 2026" — used in the tooltip's share line and the chips. */
  period: string
  colour?: string
  valueLabel?: string
  format?: (n: number) => string
  details?: Array<InsightDetail<T>>
  height?: number
}

/**
 * A single gradient area with a 2.25px stroke and an 1100ms draw-in, a dashed
 * reference line at the period average, the peak day marked with a pulsing
 * ring, a rich tooltip, and four summary chips beneath.
 */
export function InsightChart<T extends { label: string; value: number }>({
  data,
  period,
  colour = SERIES.accent,
  valueLabel = 'Value',
  format = fmt,
  details = [],
  height = 300,
}: InsightChartProps<T>) {
  const chrome = useChrome()

  const stats = useMemo(() => {
    if (data.length === 0) {
      return { average: 0, peak: null as T | null, peakIndex: -1, aboveAverage: 0, total: 0 }
    }
    const total = data.reduce((sum, row) => sum + row.value, 0)
    const average = total / data.length
    let peakIndex = 0
    for (const [i, row] of data.entries()) if (row.value > (data[peakIndex] as T).value) peakIndex = i
    return {
      average,
      peak: data[peakIndex] as T,
      peakIndex,
      aboveAverage: data.filter((row) => row.value > average).length,
      total,
    }
  }, [data])

  const RichTooltip = ({
    active,
    payload,
  }: {
    active?: boolean
    payload?: Array<{ payload?: T; value?: number }>
  }): ReactNode => {
    if (!active || !payload || payload.length === 0) return null
    const row = payload[0]?.payload
    if (!row) return null

    const value = row.value
    const share = stats.total > 0 ? (value / stats.total) * 100 : 0
    const vsAverage = stats.average > 0 ? ((value - stats.average) / stats.average) * 100 : 0
    const isPeak = row.label === stats.peak?.label

    return (
      <div className="card min-w-[200px] px-3 py-2 shadow-xl">
        <div className="flex items-center gap-2">
          <span className="text-[11px] font-medium text-ink-2">{row.label}</span>
          {isPeak ? (
            <span className="rounded-full border border-magenta/40 bg-magenta/10 px-1.5 py-0.5 text-[10.5px] font-medium uppercase tracking-wide text-magenta-ink">
              Peak
            </span>
          ) : null}
        </div>

        <p className="tabular mt-1 text-lg font-semibold text-ink">{format(value)}</p>
        <p className="tabular text-[11px] text-ink-3">
          {share.toFixed(1)}% of {period}
        </p>
        <p className={`tabular text-[11px] font-medium ${vsAverage >= 0 ? 'text-good-ink' : 'text-critical-ink'}`}>
          {vsAverage >= 0 ? '+' : ''}
          {vsAverage.toFixed(0)}% vs avg
        </p>

        {details.length > 0 ? (
          <div className="mt-1.5 space-y-0.5 border-t border-line pt-1.5">
            {details.map((detail) => {
              const raw = detail.derive
                ? detail.derive(row)
                : detail.key
                  ? (row[detail.key] as unknown as number | string)
                  : ''
              const shown =
                typeof raw === 'number' ? (detail.format ? detail.format(raw) : format(raw)) : String(raw)
              return (
                <div key={detail.label} className="flex items-baseline justify-between gap-3">
                  <span className="text-[10px] text-ink-3">{detail.label}</span>
                  <span className="tabular text-[10px] text-ink-2">{shown}</span>
                </div>
              )
            })}
          </div>
        ) : null}
      </div>
    )
  }

  return (
    <div>
      <div className="chart-reveal overflow-x-auto" style={{ height }}>
        <div style={{ height, minWidth: 360 }}>
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={data} margin={{ top: 24, right: 12, bottom: 4, left: -16 }}>
              <defs>
                <linearGradient id="insight-fill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={colour} stopOpacity={0.42} />
                  <stop offset="100%" stopColor={colour} stopOpacity={0.02} />
                </linearGradient>
              </defs>

              <CartesianGrid stroke={chrome.grid} strokeDasharray="3 5" vertical={false} />
              <XAxis
                dataKey="label"
                stroke={chrome.axis}
                tick={{ fontSize: 10 }}
                tickLine={false}
                axisLine={false}
                interval="preserveStartEnd"
                minTickGap={22}
              />
              <YAxis stroke={chrome.axis} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmt} />
              <Tooltip content={<RichTooltip />} cursor={{ stroke: chrome.grid }} />

              <ReferenceLine
                y={stats.average}
                stroke={chrome.axis}
                strokeDasharray="4 5"
                label={{
                  value: `avg ${format(stats.average)}`,
                  position: 'insideTopRight',
                  fill: chrome.axis,
                  fontSize: 10,
                }}
              />

              <Area
                type="monotone"
                dataKey="value"
                name={valueLabel}
                stroke={colour}
                strokeWidth={2.25}
                fill="url(#insight-fill)"
                isAnimationActive
                animationDuration={1_100}
                animationEasing="ease-out"
                dot={(props: { cx?: number; cy?: number; index?: number }) => {
                  const isPeak = props.index === stats.peakIndex
                  if (!isPeak || props.cx === undefined || props.cy === undefined) {
                    return <g key={`dot-${props.index}`} />
                  }
                  return (
                    <g key={`dot-${props.index}`}>
                      <circle className="peak-pulse" cx={props.cx} cy={props.cy} r={7} fill="none" stroke={colour} strokeWidth={1.5} />
                      <circle cx={props.cx} cy={props.cy} r={3.5} fill={colour} />
                      <text x={props.cx} y={props.cy - 14} textAnchor="middle" fontSize={10} fill={chrome.axis}>
                        Peak · {stats.peak?.label ?? ''}
                      </text>
                    </g>
                  )
                }}
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      <div className="stagger-fade mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Peak', value: stats.peak ? `${format(stats.peak.value)} · ${stats.peak.label}` : '—' },
          { label: 'Daily average', value: format(stats.average) },
          { label: 'Days above average', value: `${stats.aboveAverage} of ${data.length}` },
          { label: `Total this period`, value: format(stats.total) },
        ].map((chip, i) => (
          <div
            key={chip.label}
            className="rounded-lg border border-line bg-surface-2 px-2.5 py-2"
            style={{ ['--i' as string]: i }}
          >
            <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{chip.label}</p>
            <p className="tabular mt-0.5 text-[12px] font-medium text-ink">{chip.value}</p>
          </div>
        ))}
      </div>
    </div>
  )
}

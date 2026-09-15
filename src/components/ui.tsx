/**
 * THE COMPONENT LIBRARY
 *
 * Every primitive the sixteen screens are built from. Two rules hold
 * throughout: no component hard-codes a colour (every one is a token), and
 * every number carries `.tabular`.
 */

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useId,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, X } from 'lucide-react'
import { Tilt } from './tilt'
import type { Platform, ToolRisk } from '../types'

/* ═══════════════════════════════════════════════════════════════════════════
   PLATFORM GLYPHS — hand-authored, never an icon-font import
   ═══════════════════════════════════════════════════════════════════════════ */

export function LinkedinGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M20.45 20.45h-3.56v-5.57c0-1.33-.02-3.04-1.85-3.04-1.85 0-2.14 1.45-2.14 2.94v5.67H9.35V9h3.41v1.56h.05c.48-.9 1.63-1.85 3.36-1.85 3.6 0 4.27 2.37 4.27 5.45v6.29zM5.34 7.43a2.07 2.07 0 1 1 0-4.13 2.07 2.07 0 0 1 0 4.13zM7.12 20.45H3.55V9h3.57v11.45zM22.22 0H1.77C.79 0 0 .77 0 1.72v20.55C0 23.23.79 24 1.77 24h20.45c.98 0 1.78-.77 1.78-1.73V1.72C24 .77 23.2 0 22.22 0z" />
    </svg>
  )
}

export function InstagramGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className={className}>
      <rect x="2" y="2" width="20" height="20" rx="5.5" />
      <circle cx="12" cy="12" r="4.2" />
      <circle cx="17.6" cy="6.4" r="1.15" fill="currentColor" stroke="none" />
    </svg>
  )
}

export function XGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M18.24 2.25h3.31l-7.23 8.26 8.5 11.24h-6.65l-5.21-6.82-5.97 6.82H1.68l7.73-8.84L1.25 2.25h6.82l4.71 6.23 5.46-6.23zm-1.16 17.52h1.83L7.02 4.13H5.05l12.03 15.64z" />
    </svg>
  )
}

export function FacebookGlyph({ size = 16, className = '' }: { size?: number; className?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M24 12.07C24 5.4 18.63 0 12 0S0 5.4 0 12.07C0 18.1 4.39 23.09 10.13 24v-8.44H7.08v-3.49h3.05V9.41c0-3.02 1.8-4.69 4.54-4.69 1.31 0 2.68.24 2.68.24v2.97h-1.51c-1.49 0-1.96.93-1.96 1.88v2.26h3.33l-.53 3.49h-2.8V24C19.61 23.09 24 18.1 24 12.07z" />
    </svg>
  )
}

const PLATFORM_GLYPH: Record<Platform, typeof LinkedinGlyph> = {
  linkedin: LinkedinGlyph,
  instagram: InstagramGlyph,
  x: XGlyph,
  facebook: FacebookGlyph,
}

export const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X',
  facebook: 'Facebook',
}

/** Series colours are theme-invariant, so the same platform reads the same everywhere. */
export const PLATFORM_TOKEN: Record<Platform, string> = {
  linkedin: 'var(--color-series-li)',
  instagram: 'var(--color-series-ig)',
  x: 'var(--color-series-x)',
  facebook: 'var(--color-series-fb)',
}

export function PlatformIcon({
  platform,
  size = 16,
  tinted = true,
  className = '',
}: {
  platform: Platform
  size?: number
  tinted?: boolean
  className?: string
}) {
  const Glyph = PLATFORM_GLYPH[platform]
  return (
    <span
      className={`inline-flex ${className}`}
      style={tinted ? { color: PLATFORM_TOKEN[platform] } : undefined}
    >
      <Glyph size={size} />
    </span>
  )
}

export function PlatformChip({ platform, className = '' }: { platform: Platform; className?: string }) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium ${className}`}
      style={{
        color: PLATFORM_TOKEN[platform],
        borderColor: PLATFORM_TOKEN[platform],
        backgroundColor: `color-mix(in srgb, ${PLATFORM_TOKEN[platform]} 12%, transparent)`,
      }}
    >
      <PlatformIcon platform={platform} size={11} tinted={false} />
      {PLATFORM_LABEL[platform]}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   FORMATTERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** `1.2M` · `18.4K` · `842`. */
export function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}M`
  if (abs >= 1_000) return `${(n / 1_000).toFixed(1).replace(/\.0$/, '')}K`
  return String(Math.round(n))
}

/** `14m ago` · `3h ago` · `2d ago`. Timestamps are always relative. */
export function timeAgo(iso: string | null | undefined): string {
  if (!iso) return '—'
  const then = new Date(iso).getTime()
  if (!Number.isFinite(then)) return '—'
  const seconds = Math.max(0, Math.round((Date.now() - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.round(hours / 24)
  if (days < 31) return `${days}d ago`
  return new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })
}

export function formatDate(iso: string | null | undefined, withYear = false): string {
  if (!iso) return '—'
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return '—'
  return date.toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    ...(withYear ? { year: 'numeric' } : {}),
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   BADGES AND PILLS
   ═══════════════════════════════════════════════════════════════════════════ */

export type BadgeTone = 'neutral' | 'accent' | 'good' | 'warn' | 'serious' | 'critical' | 'magenta'

const BADGE_TONE: Record<BadgeTone, string> = {
  neutral: 'text-ink-2 border-line-strong bg-surface-2',
  accent: 'text-accent-bright border-accent/40 bg-accent/10',
  good: 'text-good-ink border-good/40 bg-good/10',
  warn: 'text-warn border-warn/40 bg-warn/10',
  serious: 'text-serious border-serious/40 bg-serious/10',
  critical: 'text-critical-ink border-critical/40 bg-critical/10',
  magenta: 'text-magenta-ink border-magenta/40 bg-magenta/10',
}

export function Badge({
  children,
  tone = 'neutral',
  className = '',
}: {
  children: ReactNode
  tone?: BadgeTone
  className?: string
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[11px] font-medium leading-tight ${BADGE_TONE[tone]} ${className}`}
    >
      {children}
    </span>
  )
}

const RISK_TONE: Record<ToolRisk, { tone: BadgeTone; label: string }> = {
  safe: { tone: 'neutral', label: 'safe' },
  mutating: { tone: 'accent', label: 'mutating' },
  irreversible: { tone: 'serious', label: 'irreversible' },
}

/** The risk class of a tool, in the operator's language. */
export function RiskPill({ risk, className = '' }: { risk: ToolRisk; className?: string }) {
  const meta = RISK_TONE[risk]
  return (
    <Badge tone={meta.tone} className={`uppercase tracking-[0.08em] ${className}`}>
      {meta.label}
    </Badge>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   BUTTONS
   ═══════════════════════════════════════════════════════════════════════════ */

export type BtnVariant = 'primary' | 'ghost' | 'subtle' | 'danger'

const BTN_VARIANT: Record<BtnVariant, string> = {
  // A gradient with a glow underneath: the one button on a screen that should
  // look like it does something.
  primary:
    'text-on-accent border-transparent bg-[linear-gradient(135deg,var(--color-accent-bright),var(--color-accent))] shadow-[0_6px_20px_-10px_var(--color-glow)] hover:shadow-[0_10px_28px_-10px_var(--color-glow)] hover:brightness-110',
  ghost: 'bg-transparent text-ink-2 border-line hover:text-ink hover:border-line-strong',
  subtle: 'bg-surface-2 text-ink-2 border-line hover:bg-surface-3 hover:text-ink',
  danger: 'bg-critical text-ink border-critical hover:brightness-110',
}

export function Btn({
  children,
  onClick,
  variant = 'subtle',
  disabled = false,
  title,
  className = '',
  type = 'button',
}: {
  children: ReactNode
  onClick?: () => void
  variant?: BtnVariant
  disabled?: boolean
  title?: string
  className?: string
  type?: 'button' | 'submit'
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      title={title}
      className={`inline-flex items-center justify-center gap-2 rounded-lg border px-3 py-1.5 text-[13px] font-medium
        transition-[background-color,border-color,color,transform] duration-[var(--dur-fast)] ease-[var(--ease-out-soft)]
        active:scale-[0.97] disabled:pointer-events-none disabled:opacity-40 ${BTN_VARIANT[variant]} ${className}`}
    >
      {children}
    </button>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   NUMBERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Counts up from zero on mount, cubic ease-out over 900 ms. */
export function CountUp({
  value,
  format = fmt,
  className = '',
}: {
  value: number
  format?: (n: number) => string
  className?: string
}) {
  const [shown, setShown] = useState(0)
  const frame = useRef(0)

  useEffect(() => {
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      setShown(value)
      return
    }

    const start = performance.now()
    const step = (now: number): void => {
      const t = Math.min(1, (now - start) / 900)
      const eased = 1 - Math.pow(1 - t, 3)
      setShown(value * eased)
      if (t < 1) frame.current = requestAnimationFrame(step)
    }
    frame.current = requestAnimationFrame(step)
    return () => cancelAnimationFrame(frame.current)
  }, [value])

  return <span className={`tabular ${className}`}>{format(shown)}</span>
}

/** A 12-point inline sparkline. Purely decorative, so it is aria-hidden. */
export function Sparkline({
  points,
  width = 68,
  height = 20,
  tone = 'var(--color-accent)',
  className = '',
}: {
  points: number[]
  width?: number
  height?: number
  tone?: string
  className?: string
}) {
  const path = useMemo(() => {
    const series = points.length > 0 ? points : [0, 0]
    const max = Math.max(...series)
    const min = Math.min(...series)
    const span = max - min || 1
    return series
      .map((value, i) => {
        const x = (i / Math.max(1, series.length - 1)) * width
        const y = height - ((value - min) / span) * (height - 2) - 1
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(2)} ${y.toFixed(2)}`
      })
      .join(' ')
  }, [points, width, height])

  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} fill="none" aria-hidden="true" className={className}>
      <path d={path} stroke={tone} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" opacity={0.85} />
    </svg>
  )
}

export function KpiCard({
  label,
  value,
  delta,
  hint,
  spark,
  format = fmt,
  onClick,
  tone,
  index = 0,
  unavailable,
}: {
  label: string
  value: number
  delta?: number | null
  hint?: string
  spark?: number[]
  format?: (n: number) => string
  onClick?: () => void
  tone?: 'good' | 'warn' | 'serious'
  index?: number
  /**
   * Why there is no figure. When set, an em dash is shown instead of a number
   * and this replaces the hint.
   *
   * Constraint 2 — `N/A` is never `0`. An unreported engagement rate rendered as
   * "0.00%" is a measurement nobody took, and it reads as a catastrophic month
   * rather than as an absence.
   */
  unavailable?: string
}) {
  const positive = (delta ?? 0) >= 0

  return (
    // The grid stretches this wrapper, so the card inside has to fill it or the
    // row ends up ragged — the wrapper was sized by the row and the card by its
    // own content.
    <Tilt maxDeg={5} className="h-full rounded-[14px]">
    <div
      className={`card card-hover anim-fade-up flex h-full flex-col p-4 ${onClick ? 'cursor-pointer' : ''}`}
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
      {...(onClick ? { onClick, role: 'button', tabIndex: 0 } : {})}
    >
      <div className="flex items-start justify-between gap-2">
        {/* Two lines' worth either way. "Total reach" sits on one line and
            "Awaiting leadership" on two, and without this the figures below
            them start at different heights across the strip. */}
        <p className="min-h-[2.5em] text-[11px] uppercase tracking-[0.1em] text-ink-3 leading-tight">{label}</p>
        {spark && spark.length > 1 ? (
          <Sparkline
            points={spark}
            tone={
              tone === 'serious'
                ? 'var(--color-serious)'
                : tone === 'warn'
                  ? 'var(--color-warn)'
                  : 'var(--color-accent)'
            }
          />
        ) : null}
      </div>

      <p
        className={`display mt-2 text-2xl ${
          unavailable
            ? 'text-ink-3'
            : tone === 'serious'
              ? 'text-serious'
              : tone === 'warn'
                ? 'text-warn'
                : 'text-ink'
        }`}
      >
        {unavailable ? '—' : <CountUp value={value} format={format} />}
      </p>

      {/* Pinned to the bottom so the hint line sits on one baseline across the
          row, whether or not the card has a delta. */}
      <div className="mt-auto flex items-center gap-2 pt-1">
        {/* A delta against an absent figure would be arithmetic on nothing. */}
        {!unavailable && delta !== undefined && delta !== null ? (
          <span className={`tabular text-[11px] font-medium ${positive ? 'text-good-ink' : 'text-critical-ink'}`}>
            {positive ? '+' : ''}
            {delta.toFixed(1)}%
          </span>
        ) : null}
        {unavailable ? (
          <span className="text-[11px] leading-tight text-ink-3">{unavailable}</span>
        ) : hint ? (
          <span className="text-[11px] text-ink-3 leading-tight">{hint}</span>
        ) : null}
      </div>
    </div>
    </Tilt>
  )
}

export function Progress({ value, className = '' }: { value: number; className?: string }) {
  return (
    <div className={`h-1.5 w-full overflow-hidden rounded-full bg-surface-3 ${className}`}>
      <div
        className="h-full rounded-full transition-[width] duration-300 ease-[var(--ease-out-soft)]"
        style={{
          width: `${Math.max(0, Math.min(100, value))}%`,
          background: 'linear-gradient(90deg, var(--color-accent), var(--color-magenta))',
        }}
      />
    </div>
  )
}

/** A circular score, 0–100, with the number at its centre. */
export function ScoreRing({
  value,
  size = 52,
  label,
  tone,
}: {
  value: number
  size?: number
  label?: string
  tone?: string
}) {
  const r = size / 2 - 4
  const circumference = 2 * Math.PI * r
  const offset = circumference * (1 - Math.max(0, Math.min(100, value)) / 100)
  const colour =
    tone ?? (value >= 75 ? 'var(--color-good)' : value >= 50 ? 'var(--color-accent)' : 'var(--color-serious)')

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} aria-hidden="true" className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={colour}
          strokeWidth={3}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={offset}
          style={{ transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out-expo)' }}
        />
      </svg>
      <span className="absolute inset-0 flex flex-col items-center justify-center">
        <span className="tabular text-[13px] font-semibold leading-none">{Math.round(value)}</span>
        {label ? <span className="mt-0.5 text-[10.5px] uppercase tracking-wide text-ink-3">{label}</span> : null}
      </span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   TABS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TabSpec<T extends string> {
  id: T
  label: string
  count?: number
}

export function Tabs<T extends string>({
  tabs,
  active,
  onChange,
  className = '',
}: {
  tabs: Array<TabSpec<T>>
  active: T
  onChange: (id: T) => void
  className?: string
}) {
  return (
    <div className={`flex flex-wrap items-center gap-1.5 ${className}`} role="tablist">
      {tabs.map((tab) => {
        const selected = tab.id === active
        return (
          <button
            key={tab.id}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.id)}
            className={`rounded-full border px-3 py-1.5 text-[12px] font-medium transition-colors duration-[var(--dur-fast)]
              ${selected ? 'border-accent bg-accent/12 text-accent-bright' : 'border-line text-ink-3 hover:text-ink-2 hover:border-line-strong'}`}
          >
            {tab.label}
            {tab.count !== undefined ? (
              <span className="tabular ml-1.5 text-ink-3">{tab.count}</span>
            ) : null}
          </button>
        )
      })}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   OVERLAYS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Closes on Escape, and restores focus to whatever opened it. */
function useEscape(onClose: () => void): void {
  useEffect(() => {
    const handler = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onClose])
}

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  footer,
  wide = false,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  wide?: boolean
}) {
  useEscape(onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-page/78 backdrop-blur-sm"
        onClick={onClose}
        aria-hidden="true"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className={`anim-dialog-in card relative z-10 flex max-h-[86vh] w-full flex-col overflow-hidden shadow-2xl ${wide ? 'max-w-2xl' : 'max-w-md'}`}
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-5 py-4">
          <div>
            <h2 className="display text-base">{title}</h2>
            {subtitle ? <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p> : null}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
          >
            <X size={16} />
          </button>
        </header>

        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>

        {footer ? <footer className="border-t border-line px-5 py-3">{footer}</footer> : null}
      </div>
    </div>
  )
}

/** The right-hand drawer. Used by the Knowledge Base from any screen. */
export function SlideOver({
  open,
  onClose,
  title,
  subtitle,
  icon,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  icon?: ReactNode
  children: ReactNode
}) {
  useEscape(onClose)
  if (!open) return null

  return (
    <div className="fixed inset-0 z-[65] flex justify-end">
      <div className="absolute inset-0 bg-page/72 backdrop-blur-sm" onClick={onClose} aria-hidden="true" />
      <aside
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="anim-slide-in relative z-10 flex h-full w-full max-w-6xl flex-col border-l border-line bg-surface shadow-2xl"
      >
        <header className="flex items-start justify-between gap-4 border-b border-line px-6 py-4">
          <div className="flex items-start gap-3">
            {icon}
            <div>
              <h2 className="display text-lg">{title}</h2>
              {subtitle ? <p className="mt-0.5 text-[12px] text-ink-3">{subtitle}</p> : null}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        <div className="flex-1 overflow-y-auto">{children}</div>
      </aside>
    </div>
  )
}

/**
 * The centred workspace dialog. The review panel is one of these, not a
 * drawer — it needs the full width for three columns.
 */
export function Dialog({
  open,
  onClose,
  header,
  children,
}: {
  open: boolean
  onClose: () => void
  header: ReactNode
  children: ReactNode
}) {
  useEscape(onClose)
  if (!open) return null

  return (
    /*
     * ABOVE EVERY OTHER OVERLAY.
     *
     * This was `z-[68]`, which sits UNDER the Pipeline Theater (`z-[92]`) and the
     * boot sequence (`z-[95]`). Opening a post while the theater was mounted —
     * which is the normal state after pressing Run SocialAI — rendered the dialog
     * correctly and then buried it, so the card appeared not to open at all.
     *
     * A dialog is the thing a person just asked for, so it outranks anything
     * ambient. `z-[99]` keeps it above both.
     */
    <div className="fixed inset-0 z-[99] flex items-center justify-center p-3">
      <div className="absolute inset-0 bg-page/82 backdrop-blur-md" onClick={onClose} aria-hidden="true" />
      <div
        role="dialog"
        aria-modal="true"
        className="anim-dialog-in card relative z-10 flex h-[94vh] w-full max-w-[1480px] flex-col overflow-hidden shadow-2xl"
      >
        <header className="flex items-center justify-between gap-4 border-b border-line px-5 py-3">
          {header}
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
          >
            <X size={18} />
          </button>
        </header>
        {/* `min-h-0` so this body can never be taller than the card, whatever
            a child asks for. The review panel's grid still has to pin its own
            row to this height — see there — or its columns inherit a
            content-sized row and the post is clipped instead of scrolled. */}
        <div className="min-h-0 flex-1 overflow-hidden">{children}</div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   EMPTY STATE AND TOASTS
   ═══════════════════════════════════════════════════════════════════════════ */

export function EmptyState({
  icon,
  title,
  body,
  action,
  className = '',
}: {
  icon?: ReactNode
  title: string
  body?: string
  action?: ReactNode
  className?: string
}) {
  return (
    <div className={`anim-fade-in flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-line px-6 py-12 text-center ${className}`}>
      {icon ? <div className="text-ink-3">{icon}</div> : null}
      <h3 className="display text-sm text-ink-2">{title}</h3>
      {body ? <p className="max-w-md text-[12px] leading-relaxed text-ink-3">{body}</p> : null}
      {action}
    </div>
  )
}

const TOAST_TONE: Record<string, string> = {
  neutral: 'border-line-strong',
  good: 'border-good/50',
  warn: 'border-warn/50',
  critical: 'border-critical/50',
}

export function ToastHost({
  toasts,
  onDismiss,
}: {
  toasts: Array<{ id: string; message: string; tone: string; hint?: string }>
  onDismiss: (id: string) => void
}) {
  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[90] flex w-80 flex-col gap-2">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={`anim-slide-in glass pointer-events-auto rounded-xl border px-4 py-3 shadow-xl ${TOAST_TONE[toast.tone] ?? TOAST_TONE.neutral}`}
        >
          <div className="flex items-start justify-between gap-3">
            <p className="text-[12px] leading-relaxed text-ink">{toast.message}</p>
            <button
              type="button"
              onClick={() => onDismiss(toast.id)}
              aria-label="Dismiss"
              className="shrink-0 text-ink-3 transition-colors hover:text-ink"
            >
              <X size={13} />
            </button>
          </div>
          {toast.hint ? <p className="mt-1 text-[11px] text-ink-3">{toast.hint}</p> : null}
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE Ethara PLAN STEP
   ═══════════════════════════════════════════════════════════════════════════ */

export function StepRow({
  index,
  name,
  why,
  risk,
  status = 'queued',
  summary,
  greyed = false,
  children,
}: {
  index: number
  name: string
  why: string
  risk: ToolRisk
  status?: 'queued' | 'running' | 'completed' | 'failed' | 'skipped'
  summary?: string
  greyed?: boolean
  children?: ReactNode
}) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div
      className="anim-assistant-step-in border-l-2 py-2 pl-3 transition-colors duration-[var(--dur-base)]"
      style={{
        animationDelay: `${Math.min(index, 12) * 30}ms`,
        opacity: greyed ? 0.55 : 1,
        borderLeftColor:
          status === 'completed'
            ? 'var(--color-good)'
            : status === 'failed'
              ? 'var(--color-critical)'
              : status === 'running'
                ? 'var(--color-accent)'
                : 'var(--color-line)',
      }}
    >
      <div className="flex items-start gap-2.5">
        <StepGlyph status={status} />
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[12px] font-medium text-ink">{name}</span>
            <RiskPill risk={risk} />
          </div>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{why}</p>
          {summary ? (
            <button
              type="button"
              onClick={() => setExpanded(!expanded)}
              className="mt-1 text-left text-[11px] leading-relaxed text-ink-2 underline decoration-line-strong underline-offset-2 transition-colors hover:text-ink"
            >
              {summary}
            </button>
          ) : null}
          {expanded && children ? (
            <div className="mt-2 overflow-hidden transition-[height] duration-[var(--dur-base)]">{children}</div>
          ) : null}
        </div>
      </div>
    </div>
  )
}

/** Queued · running (rotating tick) · done (a check that draws itself) · failed. */
function StepGlyph({ status }: { status: 'queued' | 'running' | 'completed' | 'failed' | 'skipped' }) {
  if (status === 'running') {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
        <circle cx="7" cy="7" r="6" stroke="var(--color-surface-3)" strokeWidth="1.5" />
        <circle
          cx="7"
          cy="7"
          r="6"
          stroke="var(--color-accent)"
          strokeWidth="1.5"
          strokeLinecap="round"
          strokeDasharray="10 28"
          style={{ transformOrigin: 'center', animation: 'ring-spin 1.4s linear infinite' }}
        />
      </svg>
    )
  }

  if (status === 'completed') {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
        <circle cx="7" cy="7" r="6" stroke="var(--color-good)" strokeWidth="1.25" opacity="0.5" />
        <path
          d="M4.2 7.2 6.2 9.2 9.9 4.9"
          stroke="var(--color-good-ink)"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeDasharray="12"
          style={{ animation: 'check-fill 320ms var(--ease-out-expo) both' }}
        />
      </svg>
    )
  }

  if (status === 'failed') {
    return (
      <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
        <circle cx="7" cy="7" r="6" stroke="var(--color-critical)" strokeWidth="1.25" />
        <path d="M4.8 4.8 9.2 9.2M9.2 4.8 4.8 9.2" stroke="var(--color-critical-ink)" strokeWidth="1.6" strokeLinecap="round" />
      </svg>
    )
  }

  return (
    <svg width={14} height={14} viewBox="0 0 14 14" fill="none" aria-hidden="true" className="mt-0.5 shrink-0">
      <circle cx="7" cy="7" r="6" stroke="var(--color-line-strong)" strokeWidth="1.25" strokeDasharray="2 3" />
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   SMALL HELPERS USED ACROSS SCREENS
   ═══════════════════════════════════════════════════════════════════════════ */

/** A labelled metric cell. Used in every detail grid in the product. */
export function Metric({
  label,
  value,
  tone,
  className = '',
}: {
  label: string
  value: ReactNode
  tone?: 'good' | 'warn' | 'serious' | 'critical'
  className?: string
}) {
  const toneClass =
    tone === 'good'
      ? 'text-good-ink'
      : tone === 'warn'
        ? 'text-warn'
        : tone === 'serious'
          ? 'text-serious'
          : tone === 'critical'
            ? 'text-critical-ink'
            : 'text-ink'

  return (
    // The grid already makes every tile in a row the same height. Pinning the
    // figure to the bottom is what makes the figures line up when one label
    // wraps to two lines and its neighbours do not — and it costs no height
    // when none of them wrap.
    <div className={`flex flex-col rounded-lg border border-line bg-surface-2 px-3 py-2 ${className}`}>
      <p className="text-[10px] uppercase tracking-[0.09em] text-ink-3 leading-tight">{label}</p>
      <p className={`tabular mt-auto pt-1 text-[13px] font-medium ${toneClass}`}>{value}</p>
    </div>
  )
}

/** A live status dot, matching `AGENT_STATUS_META`. */
export function StatusDot({ className = '' }: { className?: string }) {
  return <span className={`inline-block h-1.5 w-1.5 rounded-full ${className}`} aria-hidden="true" />
}

/** Copies text and reports it, without a library. */
export function useCopy(): [boolean, (text: string) => void] {
  const [copied, setCopied] = useState(false)
  const copy = useCallback((text: string) => {
    void navigator.clipboard
      ?.writeText(text)
      .then(() => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1_800)
      })
      .catch(() => setCopied(false))
  }, [])
  return [copied, copy]
}

/** Closes a popover when a click lands outside it. */
export function useOutsideClick<T extends HTMLElement>(onOutside: () => void) {
  const ref = useRef<T | null>(null)
  useEffect(() => {
    const handler = (event: MouseEvent): void => {
      if (ref.current && !ref.current.contains(event.target as Node)) onOutside()
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [onOutside])
  return ref
}

/* ═══════════════════════════════════════════════════════════════════════════
   SELECT

   The native <select> pops the operating system's own menu, which ignores
   the product's theme entirely — a dark grey sheet over a light screen. This
   one is the product's: a trigger in our tokens and a listbox rendered
   through a portal (so no panel can clip it), with the keyboard behaviour a
   native select has: arrows, Home/End, Enter, Escape, and a check on the
   current value.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SelectOption {
  value: string
  label: string
  /** Options with the same group are listed under one heading, in order. */
  group?: string
}

const SELECT_SIZE = {
  xs: 'gap-1 rounded-[5px] px-1.5 py-0.5 text-[11px]',
  sm: 'gap-1.5 rounded-md px-2 py-1 text-[11.5px]',
  md: 'gap-1.5 rounded-md px-2.5 py-1.5 text-[12px]',
} as const

export function Select({
  value,
  onChange,
  options,
  ariaLabel,
  id,
  className = '',
  size = 'md',
  mono = false,
}: {
  value: string
  onChange: (value: string) => void
  options: SelectOption[]
  ariaLabel?: string
  id?: string
  className?: string
  size?: keyof typeof SELECT_SIZE
  /** Machine values — times, model tags — set in the mono face. */
  mono?: boolean
}) {
  const uid = useId()
  const [at, setAt] = useState<{ top: number; left: number; width: number } | null>(null)
  const [active, setActive] = useState(0)
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const listRef = useRef<HTMLDivElement | null>(null)
  const open = at !== null
  const current = options.find((o) => o.value === value)

  /** Below the trigger when there is room, above it when there is not. */
  const openAt = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const groups = new Set(options.map((o) => o.group).filter(Boolean)).size
    const height = Math.min(320, options.length * 30 + groups * 24 + 10)
    const width = Math.max(rect.width, 168)
    const left = Math.max(8, Math.min(rect.left, window.innerWidth - width - 8))
    const top = window.innerHeight - rect.bottom >= height + 8 ? rect.bottom + 4 : Math.max(8, rect.top - height - 4)
    setActive(Math.max(0, options.findIndex((o) => o.value === value)))
    setAt({ top, left, width })
  }
  const close = (): void => setAt(null)
  const choose = (next: string): void => {
    onChange(next)
    close()
    triggerRef.current?.focus()
  }

  useEffect(() => {
    if (!open) return
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || listRef.current?.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape' || event.key === 'Tab') return close()
      if (event.key === 'ArrowDown') { event.preventDefault(); setActive((i) => Math.min(options.length - 1, i + 1)) }
      if (event.key === 'ArrowUp') { event.preventDefault(); setActive((i) => Math.max(0, i - 1)) }
      if (event.key === 'Home') { event.preventDefault(); setActive(0) }
      if (event.key === 'End') { event.preventDefault(); setActive(options.length - 1) }
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault()
        const pick = options[active]
        if (pick) choose(pick.value)
      }
    }
    // The list scrolls inside itself; only the page scrolling underneath closes it.
    const onScroll = (event: Event): void => {
      if (listRef.current?.contains(event.target as Node)) return
      close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    document.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', close)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', close)
    }
    // `choose` and `close` are stable per render and read only props/state that are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, options, active])

  useEffect(() => {
    if (!open) return
    listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [open, active])

  let lastGroup: string | undefined
  return (
    <>
      <button
        ref={triggerRef}
        id={id}
        type="button"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? `${uid}-list` : undefined}
        aria-label={ariaLabel}
        onClick={() => (open ? close() : openAt())}
        onKeyDown={(event) => {
          if (!open && (event.key === 'ArrowDown' || event.key === 'ArrowUp')) {
            event.preventDefault()
            openAt()
          }
        }}
        className={`inline-flex items-center border bg-surface text-left outline-none transition-colors hover:border-accent focus-visible:border-accent ${
          open ? 'border-accent' : 'border-line-strong'
        } ${mono ? 'mono' : ''} ${size === 'xs' ? 'text-ink-3 hover:text-ink' : 'text-ink'} ${SELECT_SIZE[size]} ${className}`}
      >
        <span className="min-w-0 flex-1 truncate">{current?.label ?? value}</span>
        <ChevronDown
          size={size === 'xs' ? 10 : 12}
          className="shrink-0 text-ink-3"
          aria-hidden="true"
          style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out-soft)' }}
        />
      </button>

      {at
        ? createPortal(
            <div
              ref={listRef}
              id={`${uid}-list`}
              role="listbox"
              aria-label={ariaLabel}
              aria-activedescendant={`${uid}-opt-${active}`}
              className="fixed z-[130] max-h-[320px] overflow-y-auto rounded-[10px] border border-line-strong bg-surface p-1 shadow-xl"
              style={{ top: at.top, left: at.left, minWidth: at.width, animation: 'eth-rise 180ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
            >
              {options.map((option, i) => {
                const heading = option.group !== undefined && option.group !== lastGroup ? option.group : null
                lastGroup = option.group
                const selected = option.value === value
                return (
                  <div key={`${option.value}-${i}`}>
                    {heading ? (
                      <p className="mono px-2 pb-1 pt-2 text-[10.5px] uppercase tracking-[0.12em] text-ink-3">{heading}</p>
                    ) : null}
                    <button
                      type="button"
                      role="option"
                      id={`${uid}-opt-${i}`}
                      data-index={i}
                      aria-selected={selected}
                      onMouseEnter={() => setActive(i)}
                      onClick={() => choose(option.value)}
                      className={`flex w-full items-center gap-2 rounded-md px-2 py-[6px] text-left transition-colors ${
                        mono ? 'mono text-[11px]' : 'text-[12px]'
                      } ${i === active ? 'bg-surface-2 text-ink' : 'text-ink-2'}`}
                    >
                      <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                        {selected ? <Check size={12} strokeWidth={2.4} className="text-accent-bright" aria-hidden="true" /> : null}
                      </span>
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                    </button>
                  </div>
                )
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

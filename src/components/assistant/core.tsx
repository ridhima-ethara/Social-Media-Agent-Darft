/**
 * THE REACTOR — `AssistantCore`
 *
 * Three concentric rings (outer slow clockwise, middle faster counter-clockwise,
 * inner static), a luminous centre, and a tick ring of 24 marks. Its
 * `data-state` attribute drives all seven states; every motion lives in
 * `index.css` under `.assistant-core[data-state]`, so reduced motion kills the
 * lot without this component knowing.
 */

import {
  arcOffset,
  CORE_CENTRE,
  CORE_RING_INNER,
  CORE_RING_MID,
  CORE_RING_OUTER,
  CORE_SWEEP_PATH,
  CORE_TICKS,
  CORE_VIEWBOX,
} from '@shared/logo-mark'
import type { AssistantCoreState } from '../../types'

export interface AssistantCoreProps {
  state: AssistantCoreState
  size?: number
  /** 0–100. Drives the progress arc in the `working` state. */
  progress?: number
  /** Live microphone amplitudes, 24 of them, in the `listening` state. */
  amplitudes?: number[]
  /** Count badge for the `attention` and `error` states. */
  badge?: number
  onClick?: () => void
  title?: string
  className?: string
}

export function AssistantCore({
  state,
  size = 44,
  progress = 0,
  amplitudes,
  badge,
  onClick,
  title,
  className = '',
}: AssistantCoreProps) {
  const interactive = typeof onClick === 'function'
  const listening = state === 'listening'

  const core = (
    <svg
      viewBox={CORE_VIEWBOX}
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      className="assistant-core block"
      data-state={state}
    >
      <defs>
        <radialGradient id={`jc-centre-${size}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="var(--color-magenta-ink)" />
          <stop offset="70%" stopColor="var(--color-magenta)" />
          <stop offset="100%" stopColor="var(--color-magenta)" stopOpacity="0.15" />
        </radialGradient>
        <radialGradient id={`jc-halo-${size}`} cx="50%" cy="50%" r="50%">
          <stop offset="55%" stopColor="var(--color-hud-glow)" stopOpacity="0" />
          <stop offset="100%" stopColor="var(--color-magenta)" stopOpacity="0.42" />
        </radialGradient>
      </defs>

      {/* The bloom behind everything. Opacity is driven by state in CSS. */}
      <circle className="jc-halo" cx="50" cy="50" r="48" fill={`url(#jc-halo-${size})`} />

      {/* Outer ring — slow clockwise, and the progress arc when working. */}
      <circle
        className="jc-ring-outer"
        cx="50"
        cy="50"
        r={CORE_RING_OUTER.r}
        stroke="var(--color-accent)"
        strokeWidth={CORE_RING_OUTER.w}
        strokeDasharray={CORE_RING_OUTER.dash}
        strokeLinecap="round"
      />
      {state === 'working' ? (
        <circle
          className="jc-arc"
          cx="50"
          cy="50"
          r={CORE_RING_OUTER.r}
          stroke="var(--color-magenta)"
          strokeWidth={CORE_RING_OUTER.w + 0.6}
          strokeLinecap="round"
          strokeDasharray={CORE_RING_OUTER.circumference}
          strokeDashoffset={arcOffset(progress)}
          transform="rotate(-90 50 50)"
          style={{ transition: 'stroke-dashoffset var(--dur-slow) var(--ease-out-soft)' }}
        />
      ) : null}

      {/* Middle ring — faster, counter-clockwise. */}
      <circle
        className="jc-ring-mid"
        cx="50"
        cy="50"
        r={CORE_RING_MID.r}
        stroke="var(--color-accent-bright)"
        strokeWidth={CORE_RING_MID.w}
        strokeDasharray={CORE_RING_MID.dash}
        strokeLinecap="round"
        opacity="0.8"
      />

      {/* Inner ring — static. */}
      <circle
        className="jc-ring-inner"
        cx="50"
        cy="50"
        r={CORE_RING_INNER.r}
        stroke="var(--color-hud-strong)"
        strokeWidth={CORE_RING_INNER.w}
        strokeDasharray={CORE_RING_INNER.dash}
      />

      {/* The scan sweep, orbiting every 900ms while thinking. */}
      <path className="jc-sweep" d={CORE_SWEEP_PATH} stroke="var(--color-magenta-ink)" strokeWidth="2.5" strokeLinecap="round" />

      {/* The tick ring — 24 marks, or a live waveform while listening. */}
      <g className="jc-ticks">
        {CORE_TICKS.map((tick) => {
          const amplitude = listening ? (amplitudes?.[tick.index] ?? 0) : 0
          const grow = 1 + amplitude * 1.7
          const mx = 50 + (tick.x1 - 50) * 1
          const my = 50 + (tick.y1 - 50) * 1
          const ex = 50 + (tick.x2 - 50) * grow
          const ey = 50 + (tick.y2 - 50) * grow
          return (
            <line
              key={tick.index}
              x1={mx}
              y1={my}
              x2={ex}
              y2={ey}
              stroke={listening ? 'var(--color-magenta-ink)' : 'var(--color-hud-strong)'}
              strokeWidth="1.1"
              strokeLinecap="round"
              opacity={listening ? 0.45 + amplitude * 0.55 : 0.55}
              style={listening ? { transition: 'opacity 120ms linear' } : undefined}
            />
          )
        })}
      </g>

      {/* The luminous centre. */}
      <circle className="jc-centre" cx={CORE_CENTRE.cx} cy={CORE_CENTRE.cy} r={CORE_CENTRE.r} fill={`url(#jc-centre-${size})`} />
    </svg>
  )

  const badged =
    badge !== undefined && badge > 0 ? (
      <span className="relative inline-block">
        {core}
        <span className="tabular absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-serious px-1 text-[10.5px] font-semibold text-page">
          {badge > 9 ? '9+' : badge}
        </span>
      </span>
    ) : (
      core
    )

  if (!interactive) {
    return <span className={`inline-flex ${className}`}>{badged}</span>
  }

  return (
    <button
      type="button"
      onClick={onClick}
      title={title ?? 'Open the Command Console'}
      aria-label={`Ethara · ${state}`}
      className={`inline-flex rounded-full transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out-soft)] active:scale-[0.97] ${className}`}
    >
      {badged}
    </button>
  )
}

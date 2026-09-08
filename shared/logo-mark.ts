/**
 * The Ethara mark, as path data.
 *
 * Kept as data rather than JSX so the same geometry serves the React logo
 * component, the server-side SVG image renderer and the boot sequence without
 * three copies drifting apart.
 *
 * Viewbox is 64×64 for every path below.
 */

export const MARK_VIEWBOX = '0 0 64 64'

export interface MarkRing {
  /** Radius in the 64×64 box. */
  r: number
  /** Stroke width. */
  w: number
  /** Circumference, precomputed for stroke-dasharray draw-in animations. */
  circumference: number
  opacity: number
}

const ring = (r: number, w: number, opacity: number): MarkRing => ({
  r,
  w,
  circumference: Number((2 * Math.PI * r).toFixed(2)),
  opacity,
})

/** Outer to inner. The sign-in and boot animations draw these in order. */
export const MARK_RINGS: MarkRing[] = [ring(19, 3.5, 1), ring(11, 2, 0.75)]

export const MARK_CENTRE = { cx: 32, cy: 32, r: 4.5 }

/**
 * The full mark as a single path, for contexts that cannot nest elements
 * (favicons, the OG image, canvas fallbacks).
 */
export const MARK_PATH =
  'M32 13a19 19 0 1 0 0 38 19 19 0 0 0 0-38m0 3.5a15.5 15.5 0 1 1 0 31 15.5 15.5 0 0 1 0-31' +
  'M32 21a11 11 0 1 0 0 22 11 11 0 0 0 0-22m0 2a9 9 0 1 1 0 18 9 9 0 0 1 0-18' +
  'M32 27.5a4.5 4.5 0 1 0 0 9 4.5 4.5 0 0 0 0-9'

/* ═══════════════════════════════════════════════════════════════════════════
   THE JARVIS CORE
   Three concentric rings plus a 24-mark tick ring. The tick ring doubles as
   the microphone waveform when JARVIS is listening.
   ═══════════════════════════════════════════════════════════════════════════ */

export const CORE_VIEWBOX = '0 0 100 100'

export interface CoreRing {
  r: number
  w: number
  /** Dash pattern — the gaps are what make the rotation legible. */
  dash: string
  circumference: number
}

const coreRing = (r: number, w: number, dash: string): CoreRing => ({
  r,
  w,
  dash,
  circumference: Number((2 * Math.PI * r).toFixed(2)),
})

export const CORE_RING_OUTER = coreRing(46, 1.5, '38 10')
export const CORE_RING_MID = coreRing(37, 1.25, '20 12')
export const CORE_RING_INNER = coreRing(28, 1, '6 6')

export const CORE_CENTRE = { cx: 50, cy: 50, r: 8 }

/** 24 tick marks around the disc, at radius 20–24. */
export const CORE_TICK_COUNT = 24

export interface CoreTick {
  index: number
  angle: number
  x1: number
  y1: number
  x2: number
  y2: number
}

export const CORE_TICKS: CoreTick[] = Array.from({ length: CORE_TICK_COUNT }, (_, i) => {
  const angle = (i / CORE_TICK_COUNT) * Math.PI * 2 - Math.PI / 2
  const inner = 19
  const outer = 23.5
  return {
    index: i,
    angle,
    x1: Number((50 + Math.cos(angle) * inner).toFixed(3)),
    y1: Number((50 + Math.sin(angle) * inner).toFixed(3)),
    x2: Number((50 + Math.cos(angle) * outer).toFixed(3)),
    y2: Number((50 + Math.sin(angle) * outer).toFixed(3)),
  }
})

/**
 * The progress arc used by the `working` core state.
 * Returns the dashoffset for a 0–100 completion value.
 */
export function arcOffset(percent: number, circumference = CORE_RING_OUTER.circumference): number {
  const clamped = Math.max(0, Math.min(100, percent))
  return Number((circumference * (1 - clamped / 100)).toFixed(2))
}

/** A 30° conic highlight path used by the `thinking` sweep. */
export const CORE_SWEEP_PATH = describeArc(50, 50, 46, -90, -60)

function describeArc(
  cx: number,
  cy: number,
  r: number,
  startDeg: number,
  endDeg: number,
): string {
  const p = (deg: number) => {
    const rad = (deg * Math.PI) / 180
    return `${(cx + r * Math.cos(rad)).toFixed(3)} ${(cy + r * Math.sin(rad)).toFixed(3)}`
  }
  const large = Math.abs(endDeg - startDeg) > 180 ? 1 : 0
  return `M ${p(startDeg)} A ${r} ${r} 0 ${large} 1 ${p(endDeg)}`
}

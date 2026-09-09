/**
 * THE ETHARA EMBLEM
 *
 * The company mark is the actual file at `public/brand/emblem.jpeg`, embedded
 * as a data URI by `scripts/build-brand-assets.ts`. Nothing here draws it —
 * this module only places it, so the sidebar, the creative renderers on both
 * tiers, the previews and the favicon show the identical pixels.
 *
 * The JPEG is square with white corners; every consumer clips it to its disc.
 * The emblem is theme-invariant by design: a logo that changed with the theme
 * would not be the logo.
 */

import { EMBLEM_DATA_URI, EMBLEM_SOURCE_SIZE } from './emblem-data'

export { EMBLEM_DATA_URI, EMBLEM_SOURCE_SIZE }

export const EMBLEM_VIEWBOX = '0 0 100 100'

/** The disc ground behind the image, for a ring drawn around it. */
export const EMBLEM_COLOURS = {
  disc: '#0e1713',
  ink: '#ffffff',
} as const

let clipCounter = 0

/**
 * The emblem as SVG markup, centred at (cx, cy) at `size` px, for contexts that
 * assemble SVG as a string — the creative renderers and the favicon.
 *
 * Each call gets its own clipPath id, so two emblems in one document cannot
 * collide. Deterministic given the counter, which resets per process.
 */
export function emblemMarkup(cx: number, cy: number, size: number): string {
  clipCounter += 1
  const id = `emblem-clip-${clipCounter}`
  const x = cx - size / 2
  const y = cy - size / 2
  return (
    `<clipPath id="${id}"><circle cx="${cx.toFixed(2)}" cy="${cy.toFixed(2)}" r="${(size / 2).toFixed(2)}"/></clipPath>` +
    `<image href="${EMBLEM_DATA_URI}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${size.toFixed(2)}" height="${size.toFixed(2)}" clip-path="url(#${id})" preserveAspectRatio="xMidYMid slice"/>`
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE Ethara CORE
   Three concentric rings plus a 24-mark tick ring. The tick ring doubles as
   the microphone waveform when Ethara is listening.
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

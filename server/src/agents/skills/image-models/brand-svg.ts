/**
 * THE BRAND RENDERER — the local vector layer, and the floor of every fallback.
 *
 * Needs no service, makes no network call, and cannot fail. It draws the brand
 * layer for every render (rule 12), and when no model is reachable it also
 * draws the background, so a post is never left without a picture.
 *
 * Output is deterministic: the same request always produces byte-identical SVG,
 * which is what keeps a run replayable.
 */

import { BRAND } from '../../../../../shared/brand-voice'
import type { ImageConcept } from '../../../../../shared/image-models'
import type { RenderRequest } from './types'

/* ═══════════════════════════════════════════════════════════════════════════
   PALETTE
   ═══════════════════════════════════════════════════════════════════════════ */

const [ACCENT, ACCENT_MID, ACCENT_LIGHT, ACCENT_DEEP] = BRAND.visual.family

/** Which slice of the declared family leads, per the `paletteRole` knob. */
function palette(role: string): { from: string; via: string; to: string } {
  switch (role) {
    case 'Deep':
      return { from: ACCENT_DEEP as string, via: ACCENT as string, to: ACCENT_MID as string }
    case 'Light':
      return { from: ACCENT_MID as string, via: ACCENT_LIGHT as string, to: '#E9D5FF' }
    case 'Full range':
      return { from: ACCENT_DEEP as string, via: ACCENT_MID as string, to: ACCENT_LIGHT as string }
    default:
      return { from: ACCENT_DEEP as string, via: ACCENT as string, to: ACCENT_LIGHT as string }
  }
}

/** The canvas ground. Deliberately near-black so the accent family carries. */
const GROUND = '#0B0E14'
const INK = '#FFFFFF'
const INK_MUTED = '#8A8FA5'

/* ═══════════════════════════════════════════════════════════════════════════
   TEXT LAYOUT
   ═══════════════════════════════════════════════════════════════════════════ */

/** XML-escapes text before it goes into SVG. */
function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Wraps a headline to a character budget per line.
 *
 * There is no text metrics engine here, so the budget is derived from the
 * canvas width and the font size — approximate, but deterministic, and tuned so
 * the longest realistic headline still fits inside the safe margin.
 */
function wrapHeadline(
  headline: string,
  maxWords: number,
  charsPerLine: number,
): string[] {
  const words = headline.trim().split(/\s+/).filter(Boolean).slice(0, maxWords)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (candidate.length > charsPerLine && current !== '') {
      lines.push(current)
      current = word
    } else {
      current = candidate
    }
  }
  if (current !== '') lines.push(current)

  // Four lines is the practical ceiling before the type is too small to read
  // on a phone. Beyond that, truncate and mark it.
  if (lines.length > 4) {
    const kept = lines.slice(0, 4)
    kept[3] = `${(kept[3] as string).replace(/[,;:]$/, '')}…`
    return kept
  }
  return lines
}

/* ═══════════════════════════════════════════════════════════════════════════
   BACKGROUND CONCEPTS
   Each concept is a deterministic vector treatment. These are what the local
   renderer draws when no model painted a background.
   ═══════════════════════════════════════════════════════════════════════════ */

/** A small deterministic PRNG so concept geometry is stable per request. */
function seededRandom(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** A stable seed from the headline, so the same post always renders the same. */
function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function conceptGeometry(
  concept: ImageConcept,
  w: number,
  h: number,
  intensity: number,
  seed: number,
): string {
  const rand = seededRandom(seed)
  const alpha = Math.max(0.08, Math.min(0.6, intensity / 100))
  const parts: string[] = []

  switch (concept) {
    case 'reward-surface': {
      // A contour field: nested curves suggesting an optimisation surface.
      for (let i = 0; i < 7; i += 1) {
        const y = h * (0.28 + i * 0.075)
        const amp = h * (0.05 + i * 0.012)
        const d =
          `M ${-w * 0.05} ${y} ` +
          `C ${w * 0.22} ${y - amp}, ${w * 0.42} ${y + amp}, ${w * 0.62} ${y - amp * 0.6} ` +
          `S ${w * 0.9} ${y + amp * 0.8}, ${w * 1.05} ${y - amp * 0.3}`
        parts.push(
          `<path d="${d}" fill="none" stroke="${ACCENT_LIGHT}" stroke-width="${1.2 + i * 0.25}" opacity="${(alpha * (1 - i * 0.09)).toFixed(3)}"/>`,
        )
      }
      break
    }

    case 'agent-graph': {
      // Nodes and edges: a small directed graph.
      const nodes: Array<{ x: number; y: number; r: number }> = []
      for (let i = 0; i < 9; i += 1) {
        nodes.push({
          x: w * (0.5 + rand() * 0.46),
          y: h * (0.12 + rand() * 0.76),
          r: w * (0.004 + rand() * 0.007),
        })
      }
      for (let i = 0; i < nodes.length - 1; i += 1) {
        const a = nodes[i] as { x: number; y: number }
        const b = nodes[i + 1] as { x: number; y: number }
        const mx = (a.x + b.x) / 2
        parts.push(
          `<path d="M ${a.x.toFixed(1)} ${a.y.toFixed(1)} Q ${mx.toFixed(1)} ${((a.y + b.y) / 2 - h * 0.06).toFixed(1)} ${b.x.toFixed(1)} ${b.y.toFixed(1)}" fill="none" stroke="${ACCENT_MID}" stroke-width="1.4" opacity="${(alpha * 0.7).toFixed(3)}"/>`,
        )
      }
      for (const n of nodes) {
        parts.push(
          `<circle cx="${n.x.toFixed(1)}" cy="${n.y.toFixed(1)}" r="${n.r.toFixed(1)}" fill="${ACCENT_LIGHT}" opacity="${(alpha * 1.3).toFixed(3)}"/>`,
        )
      }
      break
    }

    case 'benchmark-bars': {
      // A rising bar field, clearly comparative.
      const count = 11
      const slot = (w * 0.44) / count
      for (let i = 0; i < count; i += 1) {
        const bh = h * (0.08 + (i / count) * 0.42 + rand() * 0.06)
        parts.push(
          `<rect x="${(w * 0.54 + i * slot).toFixed(1)}" y="${(h * 0.72 - bh).toFixed(1)}" width="${(slot * 0.56).toFixed(1)}" height="${bh.toFixed(1)}" rx="2" fill="${i === count - 1 ? ACCENT_LIGHT : ACCENT_MID}" opacity="${(alpha * (0.5 + (i / count) * 0.6)).toFixed(3)}"/>`,
        )
      }
      break
    }

    case 'signal-lines': {
      // A rising trace with a shaded area beneath it.
      const points: string[] = []
      const steps = 22
      for (let i = 0; i <= steps; i += 1) {
        const x = w * 0.52 + (i / steps) * w * 0.46
        const trend = (i / steps) * h * 0.3
        const noise = (rand() - 0.5) * h * 0.05
        points.push(`${x.toFixed(1)} ${(h * 0.66 - trend + noise).toFixed(1)}`)
      }
      parts.push(
        `<polyline points="${points.join(' ')}" fill="none" stroke="${ACCENT_LIGHT}" stroke-width="2.5" opacity="${(alpha * 1.5).toFixed(3)}" stroke-linejoin="round"/>`,
      )
      parts.push(
        `<polygon points="${points.join(' ')} ${(w * 0.98).toFixed(1)} ${(h * 0.72).toFixed(1)} ${(w * 0.52).toFixed(1)} ${(h * 0.72).toFixed(1)}" fill="${ACCENT}" opacity="${(alpha * 0.35).toFixed(3)}"/>`,
      )
      break
    }

    case 'data-lattice': {
      // A dot lattice with varying opacity — sampling, made visible.
      const cols = 16
      const rows = 10
      for (let c = 0; c < cols; c += 1) {
        for (let r = 0; r < rows; r += 1) {
          const o = alpha * (0.25 + rand() * 0.9)
          parts.push(
            `<circle cx="${(w * 0.52 + (c / cols) * w * 0.46).toFixed(1)}" cy="${(h * 0.16 + (r / rows) * h * 0.62).toFixed(1)}" r="${(w * 0.0032).toFixed(2)}" fill="${ACCENT_LIGHT}" opacity="${o.toFixed(3)}"/>`,
          )
        }
      }
      break
    }

    default: {
      // gradient-field: concentric arcs, quiet and positional.
      for (let i = 0; i < 5; i += 1) {
        parts.push(
          `<circle cx="${(w * 0.86).toFixed(1)}" cy="${(h * 0.24).toFixed(1)}" r="${(w * (0.1 + i * 0.062)).toFixed(1)}" fill="none" stroke="${ACCENT_LIGHT}" stroke-width="1.3" opacity="${(alpha * (0.55 - i * 0.08)).toFixed(3)}"/>`,
        )
      }
      break
    }
  }

  return parts.join('\n  ')
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BRAND LAYER
   ═══════════════════════════════════════════════════════════════════════════ */

/** The Ethara logomark, drawn as vectors at an arbitrary size. */
function logomark(cx: number, cy: number, size: number): string {
  const r = size / 2
  return [
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.95).toFixed(1)}" fill="none" stroke="${ACCENT}" stroke-width="${(size * 0.09).toFixed(2)}"/>`,
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.55).toFixed(1)}" fill="none" stroke="${ACCENT_LIGHT}" stroke-width="${(size * 0.055).toFixed(2)}" opacity="0.8"/>`,
    `<circle cx="${cx.toFixed(1)}" cy="${cy.toFixed(1)}" r="${(r * 0.22).toFixed(1)}" fill="${ACCENT_MID}"/>`,
  ].join('\n  ')
}

/**
 * Where the headline block sits, per the `layout` knob.
 * Editorial is the default: kicker above, headline lower-left, accent bar between.
 */
function layoutGeometry(
  layout: string,
  w: number,
  h: number,
  margin: number,
  lineCount: number,
  fontSize: number,
): { x: number; headlineTop: number; anchor: string; kickerY: number; barY: number } {
  const blockHeight = lineCount * fontSize * 1.18

  switch (layout) {
    case 'Centred':
      return {
        x: w / 2,
        headlineTop: h / 2 - blockHeight / 2 + fontSize * 0.85,
        anchor: 'middle',
        kickerY: h / 2 - blockHeight / 2 - fontSize * 0.9,
        barY: h / 2 - blockHeight / 2 - fontSize * 0.5,
      }
    case 'Minimal':
      return {
        x: margin,
        headlineTop: h - margin - blockHeight + fontSize * 0.85,
        anchor: 'start',
        kickerY: h - margin - blockHeight - fontSize * 0.7,
        barY: 0, // no bar in minimal
      }
    case 'Split':
      return {
        x: margin,
        headlineTop: h * 0.42 - blockHeight / 2 + fontSize * 0.85,
        anchor: 'start',
        kickerY: h * 0.42 - blockHeight / 2 - fontSize * 1.1,
        barY: h * 0.42 - blockHeight / 2 - fontSize * 0.65,
      }
    default:
      // Editorial.
      return {
        x: margin,
        headlineTop: h * 0.62 - blockHeight / 2 + fontSize * 0.85,
        anchor: 'start',
        kickerY: h * 0.62 - blockHeight / 2 - fontSize * 1.25,
        barY: h * 0.62 - blockHeight / 2 - fontSize * 0.78,
      }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RENDER
   ═══════════════════════════════════════════════════════════════════════════ */

export interface BrandLayerOptions {
  /** A base64 background to composite underneath, when a model painted one. */
  backgroundBase64?: string
  backgroundMimeType?: string
}

/**
 * Composes the full SVG. When `backgroundBase64` is supplied it is embedded as
 * the bottom layer and the local concept geometry is omitted, because the model
 * already provided the field. The brand layer is drawn either way.
 */
export function renderBrandSvg(
  request: RenderRequest,
  options: BrandLayerOptions = {},
): string {
  const { width: w, height: h } = request
  const margin = Math.max(24, request.safeMargin)
  const p = palette(request.paletteRole)
  const seed = seedFrom(`${request.headline}|${request.concept}|${request.platform}`)

  // Type scale from the canvas. Portrait canvases get a slightly larger
  // headline because there is vertical room for it.
  const isPortrait = h > w
  const baseSize = isPortrait ? w * 0.072 : w * 0.055
  const charsPerLine = Math.round((w - margin * 2) / (baseSize * 0.52))
  const lines = wrapHeadline(request.headline, request.headlineMaxWords, charsPerLine)

  // Shrink slightly when the headline needs four lines, so it stays inside the
  // safe area on the smaller canvases.
  const fontSize = lines.length >= 4 ? baseSize * 0.86 : baseSize
  const geo = layoutGeometry(request.layout, w, h, margin, lines.length, fontSize)

  const kickerSize = Math.max(10, w * 0.019)
  const footerSize = Math.max(10, w * 0.017)
  const alpha = Math.max(0.1, Math.min(0.75, request.accentIntensity / 100))

  const hasPainted = Boolean(options.backgroundBase64)

  const background = hasPainted
    ? `<image href="data:${options.backgroundMimeType ?? 'image/png'};base64,${options.backgroundBase64}" x="0" y="0" width="${w}" height="${h}" preserveAspectRatio="xMidYMid slice"/>
  <rect width="${w}" height="${h}" fill="${GROUND}" opacity="0.42"/>`
    : `<rect width="${w}" height="${h}" fill="${GROUND}"/>
  <circle cx="${(w * 0.84).toFixed(1)}" cy="${(h * 0.22).toFixed(1)}" r="${(w * 0.3).toFixed(1)}" fill="url(#field)" opacity="${(alpha * 0.62).toFixed(3)}"/>
  <circle cx="${(w * 0.16).toFixed(1)}" cy="${(h * 0.86).toFixed(1)}" r="${(w * 0.24).toFixed(1)}" fill="${p.via}" opacity="${(alpha * 0.3).toFixed(3)}"/>
  ${conceptGeometry(request.concept, w, h, request.accentIntensity, seed)}`

  const headlineLines = lines
    .map(
      (line, i) =>
        `<text x="${geo.x.toFixed(1)}" y="${(geo.headlineTop + i * fontSize * 1.18).toFixed(1)}" text-anchor="${geo.anchor}" font-family="${BRAND.visual.displayFont}, Inter, system-ui, sans-serif" font-size="${fontSize.toFixed(1)}" font-weight="600" letter-spacing="-0.015em" fill="${INK}">${esc(line)}</text>`,
    )
    .join('\n  ')

  const accentBar =
    geo.barY > 0
      ? `<rect x="${geo.x.toFixed(1)}" y="${geo.barY.toFixed(1)}" width="${(w * 0.072).toFixed(1)}" height="${Math.max(4, w * 0.005).toFixed(1)}" rx="${Math.max(2, w * 0.0025).toFixed(1)}" fill="${ACCENT}"/>`
      : ''

  const mark = request.showLogomark
    ? logomark(w - margin - w * 0.024, h - margin - w * 0.024, w * 0.048)
    : ''

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" role="img">
  <defs>
    <linearGradient id="field" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${p.from}"/>
      <stop offset="0.55" stop-color="${p.via}"/>
      <stop offset="1" stop-color="${p.to}"/>
    </linearGradient>
  </defs>
  ${background}
  ${accentBar}
  <text x="${geo.x.toFixed(1)}" y="${geo.kickerY.toFixed(1)}" text-anchor="${geo.anchor}" font-family="${BRAND.visual.bodyFont}, Inter, system-ui, sans-serif" font-size="${kickerSize.toFixed(1)}" font-weight="500" letter-spacing="0.18em" fill="${ACCENT_LIGHT}">${esc(request.kicker.toUpperCase())}</text>
  ${headlineLines}
  <text x="${geo.x.toFixed(1)}" y="${(h - margin * 0.55).toFixed(1)}" text-anchor="${geo.anchor}" font-family="${BRAND.visual.bodyFont}, Inter, system-ui, sans-serif" font-size="${footerSize.toFixed(1)}" fill="${INK_MUTED}">${esc(request.footer)}</text>
  ${mark}
</svg>`
}

/** The SVG as a data URI, ready to store on `media_assets.data_uri`. */
export function svgToDataUri(svg: string): string {
  return `data:image/svg+xml;base64,${Buffer.from(svg, 'utf8').toString('base64')}`
}

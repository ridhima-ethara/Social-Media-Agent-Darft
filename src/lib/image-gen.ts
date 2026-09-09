/**
 * THE LOCAL BRAND RENDERER
 *
 * The client half of the two-layer render (Part 7.7). It draws the vector
 * brand layer — headline, kicker, accent bar, logomark, footer — with no
 * network call at all, so a card is never left without a picture while the
 * server decides whether a diffusion model is reachable.
 *
 * The store calls this immediately on `ensureImage`, then swaps in real
 * artwork if the API returns some. Deterministic: same request, same bytes.
 */

import { BRAND } from '@shared/brand-voice'
import { canvasFor } from '@shared/image-models'
import { emblemMarkup } from '@shared/logo-mark'
import type { MediaAsset, Platform } from '../types'

const [ACCENT, ACCENT_MID, ACCENT_LIGHT, ACCENT_DEEP] = BRAND.visual.family

const GROUND = '#0B0E14'
const INK = '#FFFFFF'
const INK_MUTED = '#8A8FA5'

function esc(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Wraps a headline to a character budget. There is no text metrics engine in
 * the browser path either, so the budget is derived from canvas width and font
 * size — approximate but deterministic, and tuned so the longest realistic
 * headline still clears the safe margin.
 */
function wrap(headline: string, charsPerLine: number, maxLines: number): string[] {
  const words = headline.trim().split(/\s+/).filter(Boolean)
  const lines: string[] = []
  let current = ''

  for (const word of words) {
    const candidate = current === '' ? word : `${current} ${word}`
    if (candidate.length > charsPerLine && current !== '') {
      lines.push(current)
      current = word
      if (lines.length === maxLines) break
    } else {
      current = candidate
    }
  }
  if (current !== '' && lines.length < maxLines) lines.push(current)
  return lines
}

export interface BrandRenderRequest {
  platform: Platform
  headline: string
  kicker?: string
  concept?: string
  /** A model-painted background, if one was produced. Composited underneath. */
  backgroundDataUri?: string
  fallbackReason?: string
}

/**
 * Renders the brand layer and returns a `MediaAsset` in exactly the shape the
 * server produces, so the two are interchangeable in the store.
 */
export function renderBrandSvg(request: BrandRenderRequest): MediaAsset {
  const canvas = canvasFor(request.platform)
  const { width, height } = canvas

  const scale = width / 1200
  const pad = Math.round(72 * scale)
  const headlineSize = Math.round((width > height ? 68 : 76) * scale)
  const charsPerLine = Math.floor((width - pad * 2) / (headlineSize * 0.52))
  const lines = wrap(request.headline, charsPerLine, 4)

  const kicker = (request.kicker ?? BRAND.domains[0] ?? 'AI research').toUpperCase()
  const kickerSize = Math.round(22 * scale)
  const footerSize = Math.round(20 * scale)

  // Vertically centre the headline block, biased slightly upward so the
  // footer never crowds it.
  const lineHeight = Math.round(headlineSize * 1.18)
  const blockHeight = lines.length * lineHeight
  const blockTop = Math.round((height - blockHeight) / 2 - height * 0.04)

  const headlineMarkup = lines
    .map(
      (line, i) =>
        `<text x="${pad}" y="${blockTop + i * lineHeight + headlineSize * 0.78}" ` +
        `font-family="${BRAND.visual.displayFont}, Inter, system-ui, sans-serif" ` +
        `font-size="${headlineSize}" font-weight="600" fill="${INK}" ` +
        `letter-spacing="${(-0.012 * headlineSize).toFixed(2)}">${esc(line)}</text>`,
    )
    .join('')

  const background = request.backgroundDataUri
    ? `<image href="${request.backgroundDataUri}" x="0" y="0" width="${width}" height="${height}" preserveAspectRatio="xMidYMid slice" opacity="0.62"/>`
    : ''

  const markX = width - pad - Math.round(56 * scale)
  const markY = pad + Math.round(8 * scale)
  const markR = Math.round(26 * scale)

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${esc(request.headline)}">
  <defs>
    <linearGradient id="ground" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${ACCENT_DEEP}" stop-opacity="0.34"/>
      <stop offset="52%" stop-color="${GROUND}" stop-opacity="1"/>
      <stop offset="100%" stop-color="${ACCENT}" stop-opacity="0.22"/>
    </linearGradient>
    <linearGradient id="bar" x1="0" y1="0" x2="1" y2="0">
      <stop offset="0%" stop-color="${ACCENT}"/>
      <stop offset="60%" stop-color="${ACCENT_MID}"/>
      <stop offset="100%" stop-color="${ACCENT_LIGHT}"/>
    </linearGradient>
    <radialGradient id="glow" cx="0.82" cy="0.14" r="0.6">
      <stop offset="0%" stop-color="${ACCENT_MID}" stop-opacity="0.42"/>
      <stop offset="100%" stop-color="${ACCENT_MID}" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${width}" height="${height}" fill="${GROUND}"/>
  ${background}
  <rect width="${width}" height="${height}" fill="url(#ground)"/>
  <rect width="${width}" height="${height}" fill="url(#glow)"/>

  <g opacity="0.10" stroke="${ACCENT_LIGHT}" stroke-width="1">
    ${Array.from({ length: Math.ceil(width / 80) }, (_, i) => `<line x1="${i * 80}" y1="0" x2="${i * 80}" y2="${height}"/>`).join('')}
    ${Array.from({ length: Math.ceil(height / 80) }, (_, i) => `<line x1="0" y1="${i * 80}" x2="${width}" y2="${i * 80}"/>`).join('')}
  </g>

  <rect x="${pad}" y="${blockTop - Math.round(46 * scale)}" width="${Math.round(96 * scale)}" height="${Math.round(6 * scale)}" rx="${Math.round(3 * scale)}" fill="url(#bar)"/>

  <text x="${pad}" y="${pad + kickerSize}" font-family="${BRAND.visual.bodyFont}, Inter, system-ui, sans-serif" font-size="${kickerSize}" font-weight="500" fill="${ACCENT_LIGHT}" letter-spacing="${(0.18 * kickerSize).toFixed(2)}">${esc(kicker)}</text>

  ${headlineMarkup}

  ${emblemMarkup(markX, markY + markR, markR * 2)}

  <text x="${pad}" y="${height - pad + footerSize * 0.4}" font-family="${BRAND.visual.bodyFont}, Inter, system-ui, sans-serif" font-size="${footerSize}" font-weight="500" fill="${INK}">${esc(BRAND.wordmark)}</text>
  <text x="${width - pad}" y="${height - pad + footerSize * 0.4}" text-anchor="end" font-family="${BRAND.visual.bodyFont}, Inter, system-ui, sans-serif" font-size="${footerSize}" fill="${INK_MUTED}">${esc(request.concept ?? 'Thought Leadership')} · ${width}×${height}</text>
</svg>`

  return {
    dataUri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    model: 'brand-svg',
    renderMode: 'demo',
    concept: request.concept ?? 'Thought Leadership',
    canvas: `${width}×${height}`,
    width,
    height,
    altText: `${request.headline}. Ethara brand card on a dark ground with the accent gradient bar and the Ethara emblem.`,
    fallbackReason: request.fallbackReason ?? null,
  }
}

/**
 * A neutral gradient placeholder for a card that has no creative at all yet.
 * Cheap enough to render inline, and never blank.
 */
export function gradientPlaceholder(platform: Platform, seedText: string): string {
  const canvas = canvasFor(platform)
  const hue = [...seedText].reduce((n, c) => (n + c.charCodeAt(0)) % 360, 0)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${canvas.width}" height="${canvas.height}" viewBox="0 0 ${canvas.width} ${canvas.height}">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="hsl(${hue}, 42%, 18%)"/>
    <stop offset="100%" stop-color="${ACCENT_DEEP}"/>
  </linearGradient></defs>
  <rect width="${canvas.width}" height="${canvas.height}" fill="url(#g)"/>
</svg>`
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`
}

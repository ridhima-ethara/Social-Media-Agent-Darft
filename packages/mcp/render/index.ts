/**
 * RENDER CONNECTOR
 *
 * Four render paths behind one interface: chart, diagram, generative
 * background, and the composite that puts a brand layer over any of them.
 *
 * ADR-001: the vector brand layer is always local and always authoritative.
 * No diffusion model is ever asked to draw brand text.
 */

import type { Connector, ConnectorHealth, Platform } from '../../contracts/src/index'
import { readRaw } from '../../config/src/loader'

export type RenderPath = 'chart' | 'diagram' | 'generative' | 'composite'

export interface RenderRequest {
  path: RenderPath
  platform: Platform
  headline: string
  kicker?: string
  concept?: string
  /** Only consulted on the generative path. Never describes text. */
  backgroundPrompt?: string
  /** Chart path only. Values are supplied, never invented by a model. */
  series?: Array<{ label: string; value: number }>
}

export interface RenderResult {
  dataUri: string
  /** What actually ran. Never names a renderer that did not. */
  model: string
  width: number
  height: number
  altText: string
  /** Present whenever the requested path was not the one taken. */
  fallbackReason?: string
}

const CANVAS: Record<Platform, { width: number; height: number }> = {
  linkedin: { width: 1200, height: 627 },
  instagram: { width: 1080, height: 1350 },
  x: { width: 1600, height: 900 },
  facebook: { width: 1200, height: 630 },
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CHART PATH — deterministic, values supplied
   ═══════════════════════════════════════════════════════════════════════════ */

function escapeXml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

/**
 * Renders a bar chart from supplied values.
 *
 * Constraint 3: chart data is never invented. If `series` is absent this path
 * refuses rather than generating plausible-looking bars, because a fabricated
 * chart is the most convincing lie the system could tell.
 */
function renderChart(request: RenderRequest): RenderResult {
  const { width, height } = CANVAS[request.platform]
  const series = request.series ?? []

  if (series.length === 0) {
    throw new Error(
      'The chart path requires supplied values. Refusing to render a chart with no data — a fabricated chart is worse than no chart.',
    )
  }

  const max = Math.max(...series.map((point) => point.value))
  const padding = 90
  const plotWidth = width - padding * 2
  const plotHeight = height - padding * 2.2
  const barWidth = plotWidth / (series.length * 1.6)

  const bars = series
    .map((point, i) => {
      const barHeight = max === 0 ? 0 : (point.value / max) * plotHeight
      const x = padding + i * (plotWidth / series.length) + barWidth * 0.3
      const y = height - padding - barHeight
      return (
        `<rect x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}" rx="4" fill="#8B2CF5"/>` +
        `<text x="${(x + barWidth / 2).toFixed(1)}" y="${(height - padding + 22).toFixed(1)}" text-anchor="middle" font-size="16" fill="#8A8FA5">${escapeXml(point.label)}</text>`
      )
    })
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#0B0E14"/>` +
    `<text x="${padding}" y="${padding - 20}" font-size="34" font-weight="600" fill="#FFFFFF">${escapeXml(request.headline)}</text>` +
    bars +
    `</svg>`

  return {
    dataUri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    model: 'chart-svg',
    width,
    height,
    altText: `Bar chart titled "${request.headline}" with ${series.length} bars. ${series
      .map((p) => `${p.label}: ${p.value}`)
      .join(', ')}.`,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DIAGRAM PATH — structure, no values
   ═══════════════════════════════════════════════════════════════════════════ */

function renderDiagram(request: RenderRequest): RenderResult {
  const { width, height } = CANVAS[request.platform]
  const nodes = ['Input', 'Model', 'Reward', 'Output']
  const gap = width / (nodes.length + 1)

  const shapes = nodes
    .map((label, i) => {
      const cx = gap * (i + 1)
      const cy = height / 2
      const edge =
        i < nodes.length - 1
          ? `<line x1="${cx + 62}" y1="${cy}" x2="${gap * (i + 2) - 62}" y2="${cy}" stroke="#5E1BC7" stroke-width="2"/>`
          : ''
      return (
        `<rect x="${cx - 62}" y="${cy - 30}" width="124" height="60" rx="12" fill="#151A28" stroke="#8B2CF5" stroke-width="2"/>` +
        `<text x="${cx}" y="${cy + 6}" text-anchor="middle" font-size="18" fill="#FFFFFF">${escapeXml(label)}</text>` +
        edge
      )
    })
    .join('')

  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">` +
    `<rect width="${width}" height="${height}" fill="#0B0E14"/>` +
    `<text x="72" y="86" font-size="34" font-weight="600" fill="#FFFFFF">${escapeXml(request.headline)}</text>` +
    shapes +
    `</svg>`

  return {
    dataUri: `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`,
    model: 'diagram-svg',
    width,
    height,
    altText: `Diagram titled "${request.headline}" showing ${nodes.join(' feeding into ')}.`,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE GENERATIVE PATH
   ═══════════════════════════════════════════════════════════════════════════ */

function generativeAvailable(): { available: boolean; reason: string; envKey: string } {
  const gcp = readRaw('GCP_API_KEY')
  if (gcp.reported) return { available: true, reason: 'GCP Imagen is configured.', envKey: 'GCP_API_KEY' }

  const zImage = readRaw('Z_IMAGE_ENDPOINT')
  if (zImage.reported) {
    return { available: true, reason: 'Z-Image endpoint is configured.', envKey: 'Z_IMAGE_ENDPOINT' }
  }

  return {
    available: false,
    reason: 'No image model is configured — GCP_API_KEY and Z_IMAGE_ENDPOINT are both unset.',
    envKey: 'GCP_API_KEY',
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CONNECTOR
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RenderDeps {
  /** The local vector renderer. Always present; this is the floor. */
  brandLayer(request: RenderRequest): RenderResult
  /** Paints a background. Absent when no model is reachable. */
  paintBackground?(prompt: string, platform: Platform): Promise<string>
}

export function createRenderConnector(deps: RenderDeps): Connector & {
  render(request: RenderRequest): Promise<RenderResult>
} {
  return {
    id: 'render',
    label: 'Render · chart · diagram · generative · composite',

    health(): ConnectorHealth {
      const generative = generativeAvailable()
      return {
        id: 'render',
        label: 'Render',
        // The local paths always work, so the connector is never unavailable.
        configured: true,
        reason: generative.available
          ? `All four paths available. ${generative.reason}`
          : `Chart, diagram and composite available. Generative unavailable: ${generative.reason}`,
        envKey: generative.envKey,
      }
    },

    async render(request) {
      if (request.path === 'chart') return renderChart(request)
      if (request.path === 'diagram') return renderDiagram(request)

      const generative = generativeAvailable()

      // Composite and generative both end at the local brand layer; the only
      // difference is whether a painted background sits under it.
      if (request.path === 'generative' || request.path === 'composite') {
        if (!generative.available || !deps.paintBackground || !request.backgroundPrompt) {
          const local = deps.brandLayer(request)
          return {
            ...local,
            fallbackReason: generative.available
              ? 'No background prompt supplied; the brand layer rendered alone.'
              : generative.reason,
          }
        }

        try {
          const background = await deps.paintBackground(request.backgroundPrompt, request.platform)
          const local = deps.brandLayer({ ...request, backgroundPrompt: background })
          return local
        } catch (error) {
          const local = deps.brandLayer(request)
          return {
            ...local,
            fallbackReason: `The image model failed (${
              error instanceof Error ? error.message : 'unknown error'
            }); the brand layer rendered alone.`,
          }
        }
      }

      return deps.brandLayer(request)
    },
  }
}

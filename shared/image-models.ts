/**
 * The image-model catalogue.
 *
 * Every entry is a background painter only. The brand layer — headline, kicker,
 * accent bar, logomark, footer — is always drawn locally as vectors on top
 * (invariant 21: no diffusion model is ever asked to render brand text).
 *
 * `brand-svg` is the floor: it needs no service, never fails, and is what the
 * product falls back to when a model is unreachable.
 */

import type { Platform } from './agent-contract'

export type ImageModelId = 'brand-svg' | 'gcp-imagen' | 'z-image-turbo' | 'flux2-klein'

export interface ImageModelSpec {
  id: ImageModelId
  label: string
  vendor: string
  /** Shown on the asset card and in the model menu. */
  summary: string
  /** Licence pill in the model menu. */
  licence: string
  /** The env key that switches it on. Empty for the local renderer. */
  envKey: string
  /** True when the model paints a background; false for the pure vector renderer. */
  paintsBackground: boolean
  /** Always true — the brand layer is local for every model. */
  drawsBrandLayerLocally: true
  /** Rough wall-clock expectation, shown as a hint. */
  typicalMs: number
}

export const IMAGE_MODELS: ImageModelSpec[] = [
  {
    id: 'brand-svg',
    label: 'Ethara Brand Renderer',
    vendor: 'Ethara (local)',
    summary:
      'Deterministic vector renderer. Gradient field, accent geometry and the full brand layer, drawn locally with no network call.',
    licence: 'In-house',
    envKey: '',
    paintsBackground: false,
    drawsBrandLayerLocally: true,
    typicalMs: 40,
  },
  {
    id: 'gcp-imagen',
    label: 'Imagen 4',
    vendor: 'Google Cloud',
    summary:
      'Paints an abstract technical background from the concept prompt. The brand layer is composited over it locally.',
    licence: 'Commercial · Google Cloud terms',
    envKey: 'GCP_API_KEY',
    paintsBackground: true,
    drawsBrandLayerLocally: true,
    typicalMs: 6500,
  },
  {
    id: 'flux2-klein',
    label: 'FLUX.2 Klein',
    vendor: 'Black Forest Labs (local)',
    summary:
      'Open-weight background painter running entirely on this machine. Distilled to four steps, so it is quick for a diffusion model, and nothing leaves the host.',
    licence: 'Apache-2.0 (4B) · non-commercial (9B) · local weights',
    // The Ollama transport is preferred; MFLUX_PYTHON is what actually paints
    // today, because Ollama will not serve image models over HTTP yet.
    envKey: 'MFLUX_PYTHON',
    paintsBackground: true,
    drawsBrandLayerLocally: true,
    typicalMs: 14000,
  },
  {
    id: 'z-image-turbo',
    label: 'Z-Image Turbo',
    vendor: 'Tongyi MAI',
    summary:
      'Fast open-weight background painter. Lower fidelity than Imagen, materially quicker, useful for iterating on a concept.',
    licence: 'Apache-2.0 · self-hosted endpoint',
    envKey: 'Z_IMAGE_ENDPOINT',
    paintsBackground: true,
    drawsBrandLayerLocally: true,
    typicalMs: 2200,
  },
]

export const IMAGE_MODEL_BY_ID: Record<ImageModelId, ImageModelSpec> = Object.fromEntries(
  IMAGE_MODELS.map((m) => [m.id, m]),
) as Record<ImageModelId, ImageModelSpec>

/**
 * The catalogue as a zod-ready tuple.
 *
 * Every schema and knob that accepts a model id reads this rather than
 * restating the list. Adding a painter to `IMAGE_MODELS` is then the whole
 * change — a hand-maintained copy elsewhere is a copy that will disagree, and
 * the way it disagrees is that the new model is silently rejected at the API
 * boundary while appearing in the menu.
 */
export const IMAGE_MODEL_IDS = IMAGE_MODELS.map((m) => m.id) as [ImageModelId, ...ImageModelId[]]

export const DEFAULT_IMAGE_MODEL: ImageModelId = 'brand-svg'

/* ═══════════════════════════════════════════════════════════════════════════
   CANVASES — invariant 22. A post is never shipped on the wrong canvas.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface Canvas {
  width: number
  height: number
  label: string
  aspect: string
}

export const CANVASES: Record<Platform, Canvas> = {
  linkedin: { width: 1200, height: 627, label: '1200×627', aspect: '1.91:1' },
  instagram: { width: 1080, height: 1350, label: '1080×1350', aspect: '4:5' },
  x: { width: 1600, height: 900, label: '1600×900', aspect: '16:9' },
  facebook: { width: 1200, height: 630, label: '1200×630', aspect: '1.91:1' },
}

export function canvasFor(platform: Platform): Canvas {
  return CANVASES[platform]
}

/** The `WxH` string stored on `media_assets.canvas` and checked by invariant 22. */
export function canvasKey(platform: Platform): string {
  const c = CANVASES[platform]
  return `${c.width}x${c.height}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONCEPTS — the background treatments the renderer knows how to draw.
   Chosen by `generation.image.approach` from the caption's subject matter.
   ═══════════════════════════════════════════════════════════════════════════ */

export type ImageConcept =
  | 'gradient-field'
  | 'signal-lines'
  | 'reward-surface'
  | 'agent-graph'
  | 'benchmark-bars'
  | 'data-lattice'

export interface ConceptSpec {
  id: ImageConcept
  label: string
  /** Why this concept suits a given subject. Rendered on the asset card. */
  suitedTo: string
  /** Terms that pull a caption toward this concept. */
  cues: string[]
}

export const IMAGE_CONCEPTS: ConceptSpec[] = [
  {
    id: 'gradient-field',
    label: 'Gradient field',
    suitedTo: 'Positioning and thought-leadership posts with no single hard metric',
    cues: ['positioning', 'thesis', 'philosophy', 'approach', 'why'],
  },
  {
    id: 'signal-lines',
    label: 'Signal lines',
    suitedTo: 'Trend and movement posts where something is rising or falling',
    cues: ['trend', 'growth', 'velocity', 'rising', 'shift', 'movement'],
  },
  {
    id: 'reward-surface',
    label: 'Reward surface',
    suitedTo: 'Reinforcement learning, reward modelling and post-training subjects',
    cues: ['reward', 'rlhf', 'reinforcement', 'policy', 'preference', 'post-training'],
  },
  {
    id: 'agent-graph',
    label: 'Agent graph',
    suitedTo: 'Agentic systems, orchestration and multi-agent architecture',
    cues: ['agent', 'agentic', 'orchestration', 'multi-agent', 'tool', 'workflow'],
  },
  {
    id: 'benchmark-bars',
    label: 'Benchmark bars',
    suitedTo: 'Evaluation, benchmarks and anything carrying comparative figures',
    cues: ['benchmark', 'evaluation', 'eval', 'score', 'leaderboard', 'measure'],
  },
  {
    id: 'data-lattice',
    label: 'Data lattice',
    suitedTo: 'Synthetic data, datasets and training-corpus subjects',
    cues: ['synthetic', 'dataset', 'data', 'corpus', 'generation', 'sampling'],
  },
]

export const CONCEPT_BY_ID: Record<ImageConcept, ConceptSpec> = Object.fromEntries(
  IMAGE_CONCEPTS.map((c) => [c.id, c]),
) as Record<ImageConcept, ConceptSpec>

/**
 * Deterministic concept selection from a caption/topic.
 * Same text always yields the same concept, which keeps a run replayable.
 */
export function conceptFor(text: string): ImageConcept {
  const lower = text.toLowerCase()
  let best: ImageConcept = 'gradient-field'
  let bestScore = 0
  for (const concept of IMAGE_CONCEPTS) {
    let score = 0
    for (const cue of concept.cues) {
      if (lower.includes(cue)) score += cue.length
    }
    if (score > bestScore) {
      bestScore = score
      best = concept.id
    }
  }
  return best
}

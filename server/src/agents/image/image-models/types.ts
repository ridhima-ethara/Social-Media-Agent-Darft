/**
 * THE IMAGE RENDERER CONTRACT
 *
 * Every renderer produces the SAME shape, so nothing downstream branches on
 * which model ran. Two layers, always:
 *
 *   1. an optional model-painted BACKGROUND
 *   2. a vector BRAND LAYER drawn locally on top
 *
 * Invariant 21 is structural, not advisory: no diffusion model is ever asked to draw
 * brand text. Headline, kicker, accent bar, logomark and footer are vectors
 * composed here. A model that is unreachable costs the background only — the
 * post still ships with a picture, labelled with why.
 */

import type { Platform } from '../../../../../shared/agent-contract'
import type { ImageConcept, ImageModelId } from '../../../../../shared/image-models'

export interface RenderRequest {
  platform: Platform
  /** Which model paints the background. `brand-svg` paints none. */
  model: ImageModelId
  /** Drawn as vectors. Never sent to a diffusion model. */
  headline: string
  kicker: string
  footer: string
  concept: ImageConcept
  /** Describes the background only. Contains no brand copy. */
  backgroundPrompt: string
  width: number
  height: number
  layout: string
  paletteRole: string
  accentIntensity: number
  showLogomark: boolean
  safeMargin: number
  headlineMaxWords: number
  timeoutMs: number
  retries: number
  /** Invariant 21. Off produces unusable creative and is never correct. */
  compositeBrandLayer: boolean

  /**
   * Labels drawn beside the composition, each already licensed by evidence in
   * `agents/image/annotations.ts`. Empty means the evidence did not support a
   * readable set, and the creative renders unannotated — never partially.
   */
  annotations?: ReadonlyArray<{ label: string }>

  /**
   * Whether the hook is repeated on the canvas.
   *
   * Off by default, and the default is the point. The caption already carries
   * the hook; setting the same sentence in 64pt over some artwork adds no
   * information to the post and spends the whole canvas doing it. The image is
   * worth its space when it shows something the sentence cannot — the parts of
   * the mechanism, named. On, the headline returns for the cases where a
   * creative genuinely has to stand alone.
   */
  showHeadline?: boolean
}

export interface RenderResult {
  /** A complete, self-contained data URI ready to store and display. */
  dataUri: string
  /** Which renderer actually produced it. */
  model: ImageModelId
  /** 'live' when a model painted the background; 'demo' for pure vector. */
  renderMode: 'demo' | 'live'
  /** Present when the requested model could not be reached. */
  fallbackReason?: string
  width: number
  height: number
  concept: ImageConcept
  /** Whether a model-painted background is underneath the brand layer. */
  hasPaintedBackground: boolean
}

/**
 * A renderer paints a background and returns it base64-encoded, or throws.
 * `brand-svg` is the exception: it paints nothing and needs no service, which
 * is why it can never fail and is the floor of the fallback chain.
 */
export interface BackgroundPainter {
  readonly id: ImageModelId
  isConfigured(): boolean
  unavailableReason(): string
  paint(request: RenderRequest): Promise<{ base64: string; mimeType: string }>
}

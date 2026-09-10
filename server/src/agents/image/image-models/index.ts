/**
 * THE RENDER ORCHESTRATOR
 *
 * Resolves which painter to use, attempts it with retries, and falls back down
 * the chain to the local brand renderer — which cannot fail. Whatever happens,
 * a `RenderResult` comes back with a real picture and an honest account of how
 * it was produced.
 *
 * The fallback chain is: requested model → local brand renderer.
 * There is no silent substitution between the two model painters, because an
 * operator who chose Imagen should be told Imagen was unreachable rather than
 * quietly served something else.
 */

import {
  DEFAULT_IMAGE_MODEL,
  type ImageModelId,
  IMAGE_MODEL_BY_ID,
} from '../../../../../shared/image-models'
import { withRetry } from '../../../integrations/adapter'
import { renderBrandSvg, svgToDataUri } from './brand-svg'
import { flux2KleinPainter } from './flux2-klein'
import { imagenPainter } from './gcp-imagen'
import type { BackgroundPainter, RenderRequest, RenderResult } from './types'
import { zImagePainter } from './z-image-turbo'

export type { RenderRequest, RenderResult } from './types'
export { renderBrandSvg, svgToDataUri } from './brand-svg'

/** The painters that actually paint. `brand-svg` is absent by design. */
const PAINTERS: Partial<Record<ImageModelId, BackgroundPainter>> = {
  'gcp-imagen': imagenPainter,
  'z-image-turbo': zImagePainter,
  'flux2-klein': flux2KleinPainter,
}

/** Which models are reachable right now — what the model menu renders. */
export function availableImageModels(): Array<{
  id: ImageModelId
  label: string
  configured: boolean
  reason: string
}> {
  return Object.values(IMAGE_MODEL_BY_ID).map((spec) => {
    const painter = PAINTERS[spec.id]
    if (!painter) {
      // The local renderer needs no service and is always available.
      return { id: spec.id, label: spec.label, configured: true, reason: 'Always available' }
    }
    const configured = painter.isConfigured()
    return {
      id: spec.id,
      label: spec.label,
      configured,
      reason: configured ? 'Configured' : painter.unavailableReason(),
    }
  })
}

/**
 * Renders the creative.
 *
 * `compositeBrandLayer` being off would mean asking a diffusion model to draw
 * brand text, which invariant 21 forbids. The request is honoured as far as it can
 * be — the brand layer is always drawn — and the attempt is recorded in the
 * fallback reason so the operator can see the knob had no effect.
 */
export async function renderCreative(request: RenderRequest): Promise<RenderResult> {
  // An unrecognised model id falls back to the local renderer rather than
  // throwing, so a stale value in a saved config can never break a render.
  const requested: ImageModelId = IMAGE_MODEL_BY_ID[request.model]
    ? request.model
    : DEFAULT_IMAGE_MODEL

  const painter = PAINTERS[requested]

  // The local renderer: no network, no failure mode.
  if (!painter) {
    return {
      dataUri: svgToDataUri(renderBrandSvg(request)),
      model: 'brand-svg',
      renderMode: 'demo',
      width: request.width,
      height: request.height,
      concept: request.concept,
      hasPaintedBackground: false,
    }
  }

  if (!painter.isConfigured()) {
    const reason = painter.unavailableReason()
    return {
      dataUri: svgToDataUri(renderBrandSvg(request)),
      model: 'brand-svg',
      renderMode: 'demo',
      fallbackReason: `${IMAGE_MODEL_BY_ID[requested].label} was requested but ${reason} — rendered with the local brand renderer`,
      width: request.width,
      height: request.height,
      concept: request.concept,
      hasPaintedBackground: false,
    }
  }

  try {
    const painted = await withRetry(
      () => painter.paint(request),
      Math.max(0, request.retries),
    )

    return {
      // The brand layer is composited over the painted background, always.
      dataUri: svgToDataUri(
        renderBrandSvg(request, {
          backgroundBase64: painted.base64,
          backgroundMimeType: painted.mimeType,
        }),
      ),
      model: requested,
      renderMode: 'live',
      width: request.width,
      height: request.height,
      concept: request.concept,
      hasPaintedBackground: true,
    }
  } catch (error) {
    // Fail in the open: record the reason, fall back, and stamp the artefact.
    const detail = error instanceof Error ? error.message : String(error)
    return {
      dataUri: svgToDataUri(renderBrandSvg(request)),
      model: 'brand-svg',
      renderMode: 'demo',
      fallbackReason: `${IMAGE_MODEL_BY_ID[requested].label} failed — ${detail}. Rendered with the local brand renderer.`,
      width: request.width,
      height: request.height,
      concept: request.concept,
      hasPaintedBackground: false,
    }
  }
}

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
import { config } from '../../../config'
import { renderBrandSvg, svgToDataUri } from './brand-svg'
import { flux2KleinPainter } from './flux2-klein'
import { geminiImagePainter } from './gcp-gemini-image'
import { imagenPainter } from './gcp-imagen'
import type { BackgroundPainter, RenderRequest, RenderResult } from './types'
import { zImagePainter } from './z-image-turbo'

export type { RenderRequest, RenderResult } from './types'
export { renderBrandSvg, svgToDataUri } from './brand-svg'

/** The painters that actually paint. `brand-svg` is absent by design. */
const PAINTERS: Partial<Record<ImageModelId, BackgroundPainter>> = {
  'gcp-imagen': imagenPainter,
  'gcp-gemini-image': geminiImagePainter,
  'z-image-turbo': zImagePainter,
  'flux2-klein': flux2KleinPainter,
}

/**
 * THE PAINTER TO USE WHEN THE OPERATOR HAS NOT NAMED ONE.
 *
 * The knob used to default to `brand-svg`, the local vector renderer — which
 * never fails and never paints. So a workspace with Imagen and FLUX both
 * configured still produced flat vector cards on every automated run, and only a
 * hand-picked model in the UI ever reached a real painter. The agent looked like
 * it was working and was quietly doing the least it could.
 *
 * Preference order is capability, not cost: a hosted painter first because it is
 * fastest and highest fidelity, the local MLX painter next because it needs no
 * egress, and the brand renderer last because it is the floor rather than a
 * choice. `brand-svg` is still what a caller GETS when nothing is configured —
 * it just is not what a caller ASKS for by default.
 */
const PAINTER_PREFERENCE: ImageModelId[] = ['gcp-imagen', 'gcp-gemini-image', 'flux2-klein', 'z-image-turbo']

/**
 * THE MODEL NAMED IN THE ENVIRONMENT OUTRANKS THE STATIC ORDER.
 *
 * `isConfigured()` on the two GCP painters answers "are there credentials",
 * which is not the same question as "does this project serve this model".
 * Imagen and Gemini share one credential, so with `GCP_IMAGE_MODEL` set to a
 * Gemini image model, Imagen still reported itself configured, still won the
 * static order, and still 404'd on every call — `Publisher model … not found`,
 * because Imagen is not enabled on this project. Every render then fell through
 * to the local vector renderer, which is why the reference art direction had
 * never once reached a painter and every creative came back flat.
 *
 * `GCP_IMAGE_MODEL` is the deployment stating which model it actually has. The
 * painter that consumes that model is therefore tried first. The static order
 * still decides everything else, and a model the operator names by hand in the
 * UI still wins outright — this only changes what `auto` resolves to.
 */
function painterForConfiguredModel(): ImageModelId | null {
  const model = config.gcp.imageModel.toLowerCase()
  if (model === '') return null
  if (model.startsWith('gemini')) return 'gcp-gemini-image'
  if (model.startsWith('imagen')) return 'gcp-imagen'
  return null
}

export function preferredImageModel(): ImageModelId {
  const named = painterForConfiguredModel()
  if (named !== null && PAINTERS[named]?.isConfigured() === true) return named

  for (const id of PAINTER_PREFERENCE) {
    const painter = PAINTERS[id]
    if (painter?.isConfigured() === true) return id
  }
  return DEFAULT_IMAGE_MODEL
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

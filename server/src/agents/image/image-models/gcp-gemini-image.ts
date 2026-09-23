/**
 * GEMINI IMAGE — a background painter, and nothing more.
 *
 * The Gemini image family ("Nano Banana") reached through Google's
 * `:generateContent` shape rather than Imagen's `:predict`. The gcp.image
 * adapter already branches on the model name for the endpoint, the request body
 * and the response parsing, so this painter's whole job is to name a Gemini
 * model and hand it the same wordless-background prompt Imagen gets.
 *
 * Invariant 21 still holds: the model paints a BACKGROUND only, and the brand
 * layer (headline, kicker, logomark, footer) is composited over it locally as
 * vectors. It is never asked for text.
 */

import { config } from '../../../config'
import { DEFAULT_GCP_GEMINI_IMAGE_MODEL } from '../../../../../shared/image-models'
import { referenceImageFor } from '../../../../../shared/reference-images'
import { gcpImage } from '../../../integrations/gcp-llm'
import type { BackgroundPainter, RenderRequest } from './types'

export const geminiImagePainter: BackgroundPainter = {
  id: 'gcp-gemini-image',

  isConfigured(): boolean {
    // Same Google credential as Imagen — one adapter, two model families.
    return gcpImage.isConfigured()
  },

  unavailableReason(): string {
    return gcpImage.unavailableReason()
  },

  async paint(request: RenderRequest): Promise<{ base64: string; mimeType: string }> {
    /*
     * Force a GEMINI model even if GCP_IMAGE_MODEL names an Imagen one. This
     * painter IS the Gemini choice. If the env already names a Gemini image
     * model it is honoured; otherwise the Gemini default.
     */
    const configured = config.gcp.imageModel
    const model = configured.toLowerCase().startsWith('gemini') ? configured : DEFAULT_GCP_GEMINI_IMAGE_MODEL

    /*
     * THE HOUSE REFERENCE TRAVELS AS AN IMAGE, NOT ONLY AS A SENTENCE.
     *
     * This family accepts image parts, so the creative the style clause was
     * written from is sent alongside it. The clause says which properties to
     * carry; the image shows them. Absent when the file is missing, in which
     * case the words still travel and the render still happens.
     */
    const reference = referenceImageFor(request.concept)

    return gcpImage.run({
      prompt: buildPrompt(request),
      width: request.width,
      height: request.height,
      timeoutMs: request.timeoutMs || config.gcp.timeoutMs,
      model,
      ...(reference ? { reference: { base64: reference.base64, mimeType: reference.mimeType } } : {}),
    })
  },
}

/**
 * The background prompt.
 *
 * Identical intent to Imagen's: a technical, abstract field in the brand
 * palette. The gcp.image adapter appends the family-specific wording that keeps
 * a Gemini image model from returning an empty candidate, so this states the
 * composition and leaves the "wordless" phrasing to the adapter.
 */
function buildPrompt(request: RenderRequest): string {
  const conceptDirection: Record<string, string> = {
    'reward-surface': 'smooth contour lines over a dark optimisation landscape',
    'agent-graph': 'a sparse network of connected nodes on a dark ground',
    'benchmark-bars': 'clean abstract vertical bar forms rising to the right',
    'signal-lines': 'a single rising trace with a soft gradient beneath it',
    'data-lattice': 'a regular lattice of small points with varying brightness',
    'gradient-field': 'a soft concentric gradient field, quiet and out of focus',
  }

  const direction = conceptDirection[request.concept] ?? conceptDirection['gradient-field']

  /*
   * WHAT TO DO WITH THE ATTACHED REFERENCE — and what not to.
   *
   * Two failure modes, both of which the first attached-reference renders hit:
   *
   *   COPYING. Given an image and an instruction, this family will happily
   *   return a recoloured version of the image. The reference is a sample of a
   *   HOUSE STYLE, not a subject, and the brief says so explicitly.
   *
   *   LETTERING. Every house reference carries a finished headline — "The
   *   output is only the visible outcome" — because it was cut from a shipped
   *   creative. A model matching the reference faithfully reproduces that
   *   text, and invariant 21 forbids any model-drawn lettering: the brand layer
   *   draws every word locally. So the exclusion is stated last, where it is
   *   read against the reference rather than before it is seen.
   */
  const withReference = referenceImageFor(request.concept) !== null

  return [
    withReference
      ? 'The attached image is a sample of the visual style to work in — NOT the subject, and not an image to edit.'
      : '',
    withReference
      ? 'Match its palette, lighting, material quality, line weight and use of negative space.'
      : '',
    `Compose a NEW abstract technical background: ${direction}.`,
    'Deep near-black ground with violet and purple accents only.',
    'Editorial, restrained, high contrast, generous negative space on the left.',
    `Composition suited to a ${request.width}x${request.height} canvas.`,
    request.backgroundPrompt,
    withReference
      ? 'Reproduce NONE of the lettering, headlines, labels, callouts or logos visible in the attached image. The output must contain no text of any kind — every word is added afterwards.'
      : '',
  ]
    .filter(Boolean)
    .join(' ')
}

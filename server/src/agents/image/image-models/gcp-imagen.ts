/**
 * IMAGEN — a background painter, and nothing more.
 *
 * It receives a prompt describing an abstract field and returns pixels. It is
 * never asked for brand text; the headline, kicker, logomark and footer are
 * composited over the result as vectors by the brand renderer (invariant 21).
 */

import { config } from '../../../config'
import { gcpImage } from '../../../integrations/gcp-llm'
import type { BackgroundPainter, RenderRequest } from './types'

export const imagenPainter: BackgroundPainter = {
  id: 'gcp-imagen',

  isConfigured(): boolean {
    return gcpImage.isConfigured()
  },

  unavailableReason(): string {
    return gcpImage.unavailableReason()
  },

  async paint(request: RenderRequest): Promise<{ base64: string; mimeType: string }> {
    return gcpImage.run({
      prompt: buildPrompt(request),
      width: request.width,
      height: request.height,
      timeoutMs: request.timeoutMs || config.gcp.timeoutMs,
    })
  },
}

/**
 * The background prompt.
 *
 * Deliberately constrained: a technical, abstract field in the brand palette,
 * with an explicit instruction against any lettering. The concept name steers
 * the composition so the picture relates to what the caption argues.
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

  return [
    `Abstract technical background: ${direction}.`,
    'Deep near-black ground with violet and purple accents only.',
    'Editorial, restrained, high contrast, generous negative space on the left.',
    `Composition suited to a ${request.width}x${request.height} canvas.`,
    request.backgroundPrompt,
  ]
    .filter(Boolean)
    .join(' ')
}

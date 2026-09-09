/**
 * Z-IMAGE TURBO — the optional secondary background painter.
 *
 * A self-hosted open-weight endpoint. Faster and lower fidelity than Imagen,
 * useful for iterating on a concept. Same contract: background pixels only,
 * never brand text.
 *
 * The endpoint shape follows the common OpenAI-compatible image convention,
 * because that is what most self-hosted servers for this model expose.
 */

import { config } from '../../../config'
import { AdapterError, fetchJson } from '../../../integrations/adapter'
import type { BackgroundPainter, RenderRequest } from './types'

interface ZImageResponse {
  data?: Array<{ b64_json?: string; url?: string }>
  images?: string[]
}

export const zImagePainter: BackgroundPainter = {
  id: 'z-image-turbo',

  isConfigured(): boolean {
    return config.zImage.configured
  },

  unavailableReason(): string {
    return 'Z_IMAGE_ENDPOINT is not set'
  },

  async paint(request: RenderRequest): Promise<{ base64: string; mimeType: string }> {
    if (!this.isConfigured()) {
      throw new AdapterError('z-image-turbo', this.unavailableReason())
    }

    const payload = await fetchJson<ZImageResponse>(config.zImage.endpoint, {
      method: 'POST',
      timeoutMs: request.timeoutMs || config.zImage.timeoutMs,
      adapterId: 'z-image-turbo',
      headers: config.zImage.apiKey
        ? { authorization: `Bearer ${config.zImage.apiKey}` }
        : {},
      body: {
        model: config.zImage.modelId,
        prompt: buildPrompt(request),
        negative_prompt:
          'text, words, letters, typography, logo, watermark, signature, caption, ui, interface',
        // Snapped to a multiple of 64, which most diffusion servers require.
        width: snap(request.width),
        height: snap(request.height),
        n: 1,
        response_format: 'b64_json',
      },
    })

    // Accept either the OpenAI-style envelope or a bare image array.
    const base64 = payload.data?.[0]?.b64_json ?? payload.images?.[0]
    if (!base64) {
      throw new AdapterError('z-image-turbo', 'endpoint returned no base64 image data')
    }

    return { base64, mimeType: 'image/png' }
  },
}

/** Diffusion servers generally require dimensions on a 64px grid. */
function snap(value: number): number {
  return Math.max(256, Math.round(value / 64) * 64)
}

function buildPrompt(request: RenderRequest): string {
  return [
    'Abstract technical background artwork.',
    'Deep near-black ground, violet and purple accents, editorial and restrained.',
    'Generous negative space on the left third.',
    request.backgroundPrompt,
  ].join(' ')
}

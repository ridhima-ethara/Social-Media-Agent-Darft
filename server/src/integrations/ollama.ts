/**
 * OLLAMA — local text generation (Qwen3) and local background painting
 * (FLUX.2 Klein).
 *
 * Why this exists beside `gcp-llm.ts` rather than replacing it: law 3 says
 * every external service sits behind its own `ServiceAdapter` with an honest
 * `isConfigured()` and a deterministic offline fallback. A local daemon is
 * still an external service — it can be stopped, the model can be absent, the
 * machine can be busy — so it gets the same treatment as Gemini, and the
 * deterministic template writer remains the floor for both.
 *
 * TEXT. `ollamaText` takes the SAME input shape as `gcpText` (`GcpTextInput`),
 * so every existing `withFallback(gcpText, {...}, fixture)` call site can be
 * pointed at `textAdapter()` without touching the payload it builds. Two
 * implementations, one interface, one code path — which is the property that
 * makes falling back change only which implementation is bound.
 *
 * Qwen3 is a hybrid-reasoning model. Thinking is disabled explicitly
 * (`think: false`) because a caption is a product artefact, not a transcript:
 * the pipeline wants the answer, not the deliberation. `stripReasoning()` is a
 * second line of defence for builds that emit the block anyway.
 *
 * IMAGES. `ollamaImage` speaks the shape Ollama uses for its image models. As
 * of 0.33.3 the HTTP API refuses them outright — `/api/generate` answers
 * `image generation models are not currently supported` — so the adapter
 * detects that answer and reports it as a plain unavailability rather than a
 * crash. The moment Ollama ships REST support this adapter starts working with
 * no change here; until then the FLUX painter routes to the mflux sidecar.
 */

import type { ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError, fetchJson } from './adapter'
import { gcpText, type GcpImageInput, type GcpTextInput, type PaintedBackground } from './gcp-llm'

/* ═══════════════════════════════════════════════════════════════════════════
   TEXT — Qwen3 via /api/chat
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Deliberately an alias, not a copy. If the text input shape ever changes it
 * must change for every provider at once, and an alias makes that automatic.
 */
export type OllamaTextInput = GcpTextInput

interface OllamaChatResponse {
  message?: { role?: string; content?: string; thinking?: string }
  done_reason?: string
  error?: string
}

/**
 * Ollama reports a missing model as a 404 with a body naming it. Turning that
 * into a sentence an operator can act on is worth the few lines, because
 * "HTTP 404" tells them nothing and `ollama pull qwen3:14b` tells them
 * everything.
 */
function explainOllamaFailure(error: unknown, model: string, adapterId: string): AdapterError {
  if (!(error instanceof AdapterError)) {
    return new AdapterError(
      adapterId,
      error instanceof Error ? error.message : 'request failed',
    )
  }

  const detail = (error.detail ?? '').toLowerCase()

  if (error.status === 404 && detail.includes('not found')) {
    return new AdapterError(
      adapterId,
      `the model "${model}" is not present on the Ollama host — run \`ollama pull ${model}\``,
      error.status,
    )
  }

  if (detail.includes('image generation models are not currently supported')) {
    return new AdapterError(
      adapterId,
      `this Ollama build (${config.ollama.baseUrl}) refuses image models over HTTP — image generation is not exposed by the REST API yet`,
      error.status,
    )
  }

  // A stopped daemon surfaces as a connection error, which is the single most
  // likely cause and deserves to be named.
  if (
    error.status === undefined &&
    /econnrefused|fetch failed|connect|refused/i.test(error.message)
  ) {
    return new AdapterError(
      adapterId,
      `no Ollama daemon answered at ${config.ollama.baseUrl} — is \`ollama serve\` running?`,
    )
  }

  return error
}

/**
 * Removes a reasoning block if one is emitted despite `think: false`.
 * Only strips a block that OPENS the response, so a caption that legitimately
 * contains the word "think" is never touched.
 */
export function stripReasoning(text: string): string {
  return text.replace(/^\s*<(think|thinking)>[\s\S]*?<\/\1>\s*/i, '').trim()
}

export const ollamaText: ServiceAdapter<OllamaTextInput, string> = {
  id: 'ollama.text',
  label: 'Ollama · Qwen3 (local)',

  isConfigured(): boolean {
    // Presence of an explicitly-set base URL is the switch. There is no
    // default, because a default would make `isConfigured()` answer "yes" on a
    // machine with no daemon and /health would then claim live when nothing is
    // listening — an dishonest report is worse than an absent one.
    return config.ollama.configured
  },

  unavailableReason(): string {
    return 'OLLAMA_BASE_URL is not set'
  },

  async run(input: OllamaTextInput): Promise<string> {
    if (!this.isConfigured()) throw new AdapterError(this.id, this.unavailableReason())

    const model = input.fast ? config.ollama.fastTextModel : config.ollama.textModel

    let payload: OllamaChatResponse
    try {
      payload = await fetchJson<OllamaChatResponse>(
        `${config.ollama.baseUrl}/api/chat`,
        {
          method: 'POST',
          timeoutMs: config.ollama.timeoutMs,
          adapterId: this.id,
          body: {
            model,
            messages: [
              { role: 'system', content: input.systemInstruction },
              { role: 'user', content: input.prompt },
            ],
            stream: false,
            // A product artefact, not a transcript. See the module note.
            think: false,
            options: {
              temperature: input.temperature,
              num_predict: input.maxOutputTokens,
              num_ctx: config.ollama.contextTokens,
            },
          },
        },
      )
    } catch (error) {
      throw explainOllamaFailure(error, model, this.id)
    }

    if (payload.error) throw new AdapterError(this.id, payload.error)

    const text = stripReasoning(payload.message?.content ?? '')

    if (text === '') {
      throw new AdapterError(
        this.id,
        payload.done_reason
          ? `model returned no text (done_reason: ${payload.done_reason})`
          : 'model returned no text',
      )
    }

    return text
  },
}

/* ═══════════════════════════════════════════════════════════════════════════
   PROVIDER RESOLUTION

   One resolver instead of a conditional at every call site. Callers ask for
   "the text adapter" and get whichever implementation is bound; they never
   learn which vendor answered, which is what keeps the agents provider-blind.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The adapter that should serve text generation right now.
 *
 * `auto` prefers the local model, because a local daemon costs nothing per
 * call and keeps evidence on the machine. When neither provider is configured
 * this still returns an adapter — an unconfigured one — so `withFallback`
 * takes the fixture path and names the reason, rather than the caller having
 * to branch on null.
 */
export function textAdapter(): ServiceAdapter<GcpTextInput, string> {
  switch (config.textProvider) {
    case 'ollama':
      return ollamaText
    case 'gcp':
      return gcpText
    default:
      return ollamaText.isConfigured() ? ollamaText : gcpText
  }
}

/**
 * The deterministic template writer, expressed as an adapter that is never
 * configured.
 *
 * Selecting "Ethara Writer" is a positive choice for the local template path,
 * not a failure to reach a model. Modelling it as a never-configured adapter
 * means `withFallback` takes the template branch by the same route it always
 * does, so the choice needs no second code path and is stamped with a reason
 * like every other fallback.
 */
export const templateWriter: ServiceAdapter<GcpTextInput, string> = {
  id: 'ethara.writer',
  label: 'Ethara Writer (local template)',
  isConfigured(): boolean {
    return false
  },
  unavailableReason(): string {
    return 'Ethara Writer was selected — the deterministic template writer is the intended path, not a fallback'
  },
  async run(): Promise<string> {
    throw new AdapterError(this.id, this.unavailableReason())
  },
}

/**
 * The adapter for an explicitly chosen caption model.
 *
 * An unknown or absent id falls through to `textAdapter()`, so a caller that
 * expresses no preference keeps the environment's own resolution order.
 */
export function textAdapterFor(modelId?: string): ServiceAdapter<GcpTextInput, string> {
  switch (modelId) {
    case 'ethara-writer':
      return templateWriter
    case 'ollama-qwen3':
      return ollamaText
    case 'gcp-gemini':
      return gcpText
    default:
      return textAdapter()
  }
}

/** The model id that actually produced a caption, for the artefact stamp. */
export function textModelId(fast = false): string {
  const adapter = textAdapter()
  if (adapter.id === ollamaText.id) {
    return fast ? config.ollama.fastTextModel : config.ollama.textModel
  }
  return fast ? config.gcp.fastTextModel : config.gcp.textModel
}

/* ═══════════════════════════════════════════════════════════════════════════
   IMAGES — FLUX.2 Klein via Ollama, when the daemon will serve it
   ═══════════════════════════════════════════════════════════════════════════ */

interface OllamaGenerateResponse {
  images?: string[]
  response?: string
  error?: string
}

export const ollamaImage: ServiceAdapter<GcpImageInput, PaintedBackground> = {
  id: 'ollama.image',
  label: 'Ollama · FLUX.2 Klein (local)',

  isConfigured(): boolean {
    return config.ollama.configured && config.ollama.imageModel !== ''
  },

  unavailableReason(): string {
    if (!config.ollama.configured) return 'OLLAMA_BASE_URL is not set'
    return 'OLLAMA_IMAGE_MODEL is not set'
  },

  async run(input: GcpImageInput): Promise<PaintedBackground> {
    if (!this.isConfigured()) throw new AdapterError(this.id, this.unavailableReason())

    let payload: OllamaGenerateResponse
    try {
      payload = await fetchJson<OllamaGenerateResponse>(
        `${config.ollama.baseUrl}/api/generate`,
        {
          method: 'POST',
          timeoutMs: input.timeoutMs || config.ollama.imageTimeoutMs,
          adapterId: this.id,
          body: {
            model: config.ollama.imageModel,
            prompt: input.prompt,
            stream: false,
            options: {
              width: input.width,
              height: input.height,
              // Invariant 21: the model is never asked for brand text, and is told
              // so explicitly as well as being denied the opportunity.
              negative_prompt:
                'text, words, letters, typography, logo, watermark, signature, caption',
            },
          },
        },
      )
    } catch (error) {
      throw explainOllamaFailure(error, config.ollama.imageModel, this.id)
    }

    if (payload.error) throw new AdapterError(this.id, payload.error)

    const base64 = payload.images?.[0]
    if (!base64) {
      throw new AdapterError(this.id, 'Ollama returned no image data')
    }

    return { base64, mimeType: 'image/png' }
  },
}

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
import { AdapterError, fetchJson, type ChainLink } from './adapter'
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
 * DESCRIBES AN ATTACHED IMAGE, so a painter that takes text can still use it.
 *
 * The reference flow used to name an attachment and discard it — "an image was
 * attached, but this painter takes a text prompt, so its contents were not
 * sent." Honest, and a dead end: an operator who attaches a moodboard means it
 * to influence the result.
 *
 * `qwen3.5` reports the `vision` capability, so the image is read here and
 * turned into the one thing every painter accepts: words. What reaches the
 * painter is therefore a DESCRIPTION of the reference, never the reference
 * itself, and the prompt says so — a caller must not be able to believe the
 * picture was passed through when it was paraphrased.
 *
 * Returns an empty string on any failure. A reference that could not be read is
 * reported by the caller as unread rather than silently treated as absent.
 */
export async function describeImage(
  dataUri: string,
  intent: 'caption' | 'image',
): Promise<string> {
  if (!ollamaText.isConfigured()) return ''

  // `data:image/png;base64,XXXX` → `XXXX`. Ollama wants bare base64.
  const comma = dataUri.indexOf(',')
  const base64 = comma === -1 ? dataUri : dataUri.slice(comma + 1)
  if (base64.trim() === '') return ''

  const ask =
    intent === 'image'
      ? 'Describe this reference image for another illustrator to work from: subject, ' +
        'composition, palette, and mood. Two sentences. No preamble.'
      : 'Describe what this image shows, in one sentence, for a writer who cannot see it. ' +
        'No preamble.'

  try {
    const payload = await fetchJson<OllamaChatResponse>(`${config.ollama.baseUrl}/api/chat`, {
      method: 'POST',
      body: {
        model: config.ollama.textModel,
        stream: false,
        think: false,
        messages: [{ role: 'user', content: ask, images: [base64] }],
        options: { temperature: 0.2, num_ctx: config.ollama.contextTokens },
      },
      timeoutMs: config.ollama.timeoutMs,
      adapterId: 'ollama.vision',
    })
    return stripReasoning(payload.message?.content ?? '').trim()
  } catch {
    // Never fatal: a describable reference is a bonus, not a requirement.
    return ''
  }
}

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
 * THE ORDERED TEXT PROVIDERS, PRIMARY FIRST.
 *
 * `textAdapter()` answers "which vendor owns text generation", which is the
 * right question when only one is configured and the wrong one when the primary
 * is configured but failing. A hosted endpoint gets rate-limited, has its
 * credential rotated, returns a 500, or hits a token ceiling — and on any of
 * those days a caption that Qwen could have written instead fell through to the
 * template writer, because the vendor had already been decided.
 *
 * So text generation is a chain, exactly as a platform capture lane is:
 *
 *   TEXT_MODEL_PROVIDER=gcp     Gemini, then Qwen behind it
 *   TEXT_MODEL_PROVIDER=ollama  Qwen, then Gemini behind it
 *   TEXT_MODEL_PROVIDER=auto    the local model first — it costs nothing per
 *                               call and keeps evidence on the machine — with
 *                               the hosted one behind it
 *
 * The backup is only appended when it is actually configured, so a chain never
 * contains a link that cannot serve. When neither is configured the chain is
 * empty and the caller takes the deterministic path with both reasons stated.
 */
export function textChain(): ChainLink<GcpTextInput, string>[] {
  const preferred: ServiceAdapter<GcpTextInput, string> =
    config.textProvider === 'gcp'
      ? gcpText
      : config.textProvider === 'ollama'
        ? ollamaText
        : ollamaText.isConfigured()
          ? ollamaText
          : gcpText

  const backup = preferred.id === ollamaText.id ? gcpText : ollamaText

  const chain: ChainLink<GcpTextInput, string>[] = []
  if (preferred.isConfigured()) chain.push({ adapter: preferred, isBackup: false })

  if (backup.isConfigured()) {
    // `isBackup` is false when the preferred provider is not configured at all:
    // in that case this adapter IS the primary, and calling it a fallback would
    // report a degradation that did not happen.
    chain.push({ adapter: backup, isBackup: preferred.isConfigured() })
  }

  return chain
}

/**
 * Why text generation is not being served by the preferred provider, or an
 * empty string when it is. Surfaced at /health so the mode stays visible.
 */
export function textChainDowngradeReason(): string {
  if (config.textProvider === 'auto') return ''
  const named = config.textProvider === 'gcp' ? gcpText : ollamaText
  if (named.isConfigured()) return ''
  const backup = named.id === gcpText.id ? ollamaText : gcpText
  return backup.isConfigured()
    ? `${named.unavailableReason()} — ${backup.label} is serving text instead`
    : named.unavailableReason()
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

/**
 * The model id behind a specific adapter, for stamping a chained result.
 *
 * `textModelId()` names the PREFERRED provider's model, which is wrong on a run
 * that fell through to the backup: the artefact would claim Gemini wrote a
 * caption Qwen wrote. Callers that use `textChain()` stamp with this instead,
 * passing the `servedBy` the chain returned.
 */
export function textModelIdFor(adapterId: string | undefined, fast = false): string {
  if (adapterId === ollamaText.id) {
    return fast ? config.ollama.fastTextModel : config.ollama.textModel
  }
  if (adapterId === gcpText.id) {
    return fast ? config.gcp.fastTextModel : config.gcp.textModel
  }
  return 'the template writer'
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

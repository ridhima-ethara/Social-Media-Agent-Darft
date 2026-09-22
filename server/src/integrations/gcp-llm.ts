/**
 * GOOGLE CLOUD — Gemini text generation and Imagen background painting.
 *
 * Two endpoints are supported and chosen at call time:
 *   · the public Generative Language API when only `GCP_API_KEY` is set
 *   · Vertex AI when `GCP_PROJECT_ID` is also set
 *
 * Blank ⇒ the deterministic template writer. That fallback NEVER blocks the
 * pipeline: a caption is always produced, and the artefact is stamped
 * `source: 'fixture'` so the UI can say which writer produced it.
 *
 * Whatever produced the text, `enforceBrandVoice()` runs unconditionally as the
 * final step in the caption agent — this module does not apply it, because
 * enforcement must happen once, at a known point, on both paths.
 */

import type { ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError, fetchJson } from './adapter'
import { describeGcpAuth, gcpAuthAvailable, gcpAuthHeader } from './gcp-auth'

/* ═══════════════════════════════════════════════════════════════════════════
   TEXT
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   THE USER PARTS

   Text first, then any images. Order matters to the model: the instruction
   should be read before the material it applies to.
   ═══════════════════════════════════════════════════════════════════════════ */

/** At most this many images per request, whatever the caller asks for. */
const MAX_IMAGE_PARTS = 4

/** Roughly 6 MB of base64, matching the per-reference ceiling the API enforces. */
const MAX_IMAGE_CHARS = 8_000_000

interface GeminiPart {
  text?: string
  inlineData?: { mimeType: string; data: string }
}

/**
 * Splits a `data:` URI into the two fields Gemini's `inlineData` wants.
 * Returns `null` for anything that is not one, rather than sending a string the
 * API will reject with a message nobody can act on.
 */
function inlinePart(dataUri: string): GeminiPart | null {
  const match = /^data:([^;,]+);base64,(.+)$/s.exec(dataUri)
  if (!match) return null
  const mimeType = match[1] as string
  const data = match[2] as string
  if (!mimeType.startsWith('image/')) return null
  if (data.length > MAX_IMAGE_CHARS) return null
  return { inlineData: { mimeType, data } }
}

/**
 * The `parts` array for one request.
 *
 * WITHOUT IMAGES THIS RETURNS EXACTLY WHAT IT ALWAYS DID — a single text part —
 * so no existing caller's request body changes by a byte.
 *
 * The ceilings are enforced here as well as at the API boundary, because a
 * hosted model bills per request and this is the last place before the money is
 * spent. A reference that cannot be turned into a part is dropped silently HERE
 * and reported by the caller, which holds the context to say which attachment
 * and why.
 */
function userParts(input: GcpTextInput): GeminiPart[] {
  const parts: GeminiPart[] = [{ text: input.prompt }]
  for (const image of (input.images ?? []).slice(0, MAX_IMAGE_PARTS)) {
    const part = inlinePart(image.dataUri)
    if (part) parts.push(part)
  }
  return parts
}

/** Which references a request could actually carry. Used by callers to report. */
export function usableImageParts(
  images: Array<{ dataUri: string; name: string }>,
): { usable: string[]; rejected: Array<{ name: string; reason: string }> } {
  const usable: string[] = []
  const rejected: Array<{ name: string; reason: string }> = []
  for (const [index, image] of images.entries()) {
    if (index >= MAX_IMAGE_PARTS) {
      rejected.push({ name: image.name, reason: `beyond the ${MAX_IMAGE_PARTS}-image ceiling for one request` })
      continue
    }
    if (inlinePart(image.dataUri) === null) {
      rejected.push({ name: image.name, reason: 'not a base64 image data URI, or larger than the per-image ceiling' })
      continue
    }
    usable.push(image.name)
  }
  return { usable, rejected }
}

export interface GcpTextInput {
  /** The system instruction: brand definition plus retrieved grounding. */
  systemInstruction: string
  /** The actual request. */
  prompt: string
  temperature: number
  maxOutputTokens: number
  /** Use the fast model for short, cheap calls like a single rewrite. */
  fast?: boolean
  /**
   * Images the model should actually LOOK at, as `data:` URIs.
   *
   * Optional, and absent on every existing caller — a request without them
   * composes byte-identically to what this adapter has always sent, which is
   * what keeps every caption, hook and script path unchanged.
   *
   * Present only where the operator attached a picture and the selected model
   * can accept one. A model that cannot is never handed these; it is told the
   * attachment exists and that it could not be read, which is the same
   * "state the absence" rule the capture tier applies to a missing metric.
   */
  images?: Array<{ dataUri: string; name: string }>
}

interface GeminiCandidate {
  content?: { parts?: Array<{ text?: string }> }
  finishReason?: string
}

interface GeminiResponse {
  candidates?: GeminiCandidate[]
  promptFeedback?: { blockReason?: string }
}

function textEndpoint(model: string): string {
  if (config.gcp.useVertex) {
    return (
      `https://${config.gcp.location}-aiplatform.googleapis.com/v1/projects/` +
      `${config.gcp.projectId}/locations/${config.gcp.location}/publishers/google/models/` +
      `${model}:generateContent`
    )
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
}

/**
 * Auth differs between the two endpoints: the public API takes a key in a
 * header, Vertex expects a bearer token minted from a service account. Both live
 * in `gcp-auth.ts`, which is async because the service-account path exchanges a
 * signed JWT for a short-lived token (cached for its lifetime, so this is one
 * round trip per hour rather than per call).
 */
async function textHeaders(): Promise<Record<string, string>> {
  return gcpAuthHeader()
}


/* ═══════════════════════════════════════════════════════════════════════════
   THINKING TOKENS

   `maxOutputTokens` on a 2.5 model caps THINKING PLUS OUTPUT, not output. That
   is measured, not assumed: `gemini-2.5-pro` asked for one sentence under a
   120-token cap spent 111 tokens thinking, returned 5 tokens of text and
   finished `MAX_TOKENS` — "Reinforcement Learning from Human", cut mid-phrase.
   A caption agent would have shipped that.

   Two different fixes, because the models differ:

     flash  thinking can be switched OFF (`thinkingBudget: 0`), so the whole
            budget becomes output. Same prompt, same cap: a complete sentence.

     pro    thinking cannot be disabled, so the caller's budget is TOPPED UP by
            a reserve instead. The caller asked for N tokens of prose and still
            gets room for N; the reserve absorbs the reasoning.

   Either way the caller states what it wants the OUTPUT to be and does not have
   to know that a vendor counts hidden tokens against it.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Room set aside for a thinking model's reasoning, on top of the asked-for output. */
const THINKING_RESERVE_TOKENS = 2048

function budgetFor(
  model: string,
  requested: number,
): { maxOutputTokens: number; thinkingConfig?: { thinkingBudget: number } } {
  const name = model.toLowerCase()
  // Flash can be told not to think at all, which is what a caption wants.
  if (name.includes('flash')) {
    return { maxOutputTokens: requested, thinkingConfig: { thinkingBudget: 0 } }
  }
  // Pro always thinks. Give the reasoning its own room rather than the caller's.
  if (name.includes('2.5') || name.includes('pro')) {
    return { maxOutputTokens: requested + THINKING_RESERVE_TOKENS }
  }
  return { maxOutputTokens: requested }
}

export const gcpText: ServiceAdapter<GcpTextInput, string> = {
  id: 'gcp.text',
  label: 'Google Cloud · Gemini',

  isConfigured(): boolean {
    // Either credential is enough: an API key for the public endpoint, or a
    // service account that `gcp-auth` can exchange for a Vertex bearer token.
    return gcpAuthAvailable()
  },

  unavailableReason(): string {
    return `no usable Google credential — ${describeGcpAuth()}`
  },

  async run(input: GcpTextInput): Promise<string> {
    if (!this.isConfigured()) throw new AdapterError(this.id, this.unavailableReason())

    const model = input.fast ? config.gcp.fastTextModel : config.gcp.textModel

    const payload = await fetchJson<GeminiResponse>(textEndpoint(model), {
      method: 'POST',
      timeoutMs: config.gcp.timeoutMs,
      adapterId: 'gcp.text',
      headers: await textHeaders(),
      body: {
        systemInstruction: { parts: [{ text: input.systemInstruction }] },
        contents: [{ role: 'user', parts: userParts(input) }],
        generationConfig: {
          temperature: input.temperature,
          ...budgetFor(model, input.maxOutputTokens),
        },
      },
    })

    if (payload.promptFeedback?.blockReason) {
      throw new AdapterError(
        this.id,
        `the request was blocked (${payload.promptFeedback.blockReason})`,
      )
    }

    const text = (payload.candidates ?? [])
      .flatMap((c) => c.content?.parts ?? [])
      .map((p) => p.text ?? '')
      .join('')
      .trim()

    const finish = payload.candidates?.[0]?.finishReason

    if (text === '') {
      throw new AdapterError(
        this.id,
        finish ? `model returned no text (finishReason: ${finish})` : 'model returned no text',
      )
    }

    /*
     * A body cut off at the token ceiling is not an answer. Returning it would
     * put half a sentence through the brand check and onto a card, where it
     * reads as a badly written caption rather than a truncated one — so it is
     * refused, and `withFallback` degrades to the template writer with the
     * reason stamped on the artefact. Raising the caller's budget, or moving the
     * skill to a flash model, is the fix the message names.
     */
    if (finish === 'MAX_TOKENS') {
      throw new AdapterError(
        this.id,
        `${model} hit its token ceiling and returned an incomplete answer ` +
          `(${text.length} characters). Raise the skill's output-length knob, or point it at a ` +
          'flash model, where reasoning is switched off and the whole budget becomes output.',
      )
    }

    return text
  },
}

/** Temperature is a percent knob in the registry; the API wants 0–1. */
export function temperatureFromPercent(percent: number): number {
  return Math.max(0, Math.min(1, percent / 100))
}

/* ═══════════════════════════════════════════════════════════════════════════
   IMAGES — Imagen paints a BACKGROUND ONLY.
   The brand layer is always drawn locally as vectors over the result
   (invariant 21: no diffusion model is ever asked to render brand text).
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GcpImageInput {
  /** Describes an abstract background. Never contains brand copy. */
  prompt: string
  width: number
  height: number
  timeoutMs: number
  /**
   * Which Google image model to run. Absent means the configured
   * `GCP_IMAGE_MODEL`. A painter passes this so an operator who picked Imagen
   * gets Imagen and one who picked Gemini gets Gemini, rather than both being
   * decided by a single env var.
   */
  model?: string
}

/** A base64 PNG payload, ready to composite under the vector brand layer. */
export interface PaintedBackground {
  base64: string
  mimeType: string
}

interface ImagenPrediction {
  bytesBase64Encoded?: string
  mimeType?: string
}

interface ImagenResponse {
  predictions?: ImagenPrediction[]
}

/**
 * WHICH FAMILY THE CONFIGURED IMAGE MODEL BELONGS TO.
 *
 * Google serves image generation through two incompatible shapes, and the model
 * name is the only thing that says which:
 *
 *   imagen-*   `:predict`         · instances[].prompt + parameters
 *                                 · returns predictions[].bytesBase64Encoded
 *   gemini-*   `:generateContent` · contents[].parts + responseModalities
 *                                 · returns candidates[].content.parts[].inlineData
 *
 * Sending one shape to the other's endpoint answers 404 or 400. This used to
 * hard-code `:predict`, so setting GCP_IMAGE_MODEL to a Gemini image model — the
 * obvious thing to do when told "use Gemini for images" — failed at call time
 * and silently fell through to the local brand renderer.
 */
function isGeminiImageModel(model: string): boolean {
  return model.toLowerCase().startsWith('gemini')
}

function imageEndpoint(model: string): string {
  const action = isGeminiImageModel(model) ? 'generateContent' : 'predict'
  if (config.gcp.useVertex) {
    return (
      `https://${config.gcp.location}-aiplatform.googleapis.com/v1/projects/` +
      `${config.gcp.projectId}/locations/${config.gcp.location}/publishers/google/models/` +
      `${model}:${action}`
    )
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:${action}`
}

/** Imagen takes a named aspect ratio rather than pixel dimensions. */
function aspectRatioFor(width: number, height: number): string {
  const ratio = width / height
  if (ratio > 1.6) return '16:9'
  if (ratio > 1.2) return '4:3'
  if (ratio > 0.9) return '1:1'
  if (ratio > 0.7) return '4:5'
  return '9:16'
}

export const gcpImage: ServiceAdapter<GcpImageInput, PaintedBackground> = {
  id: 'gcp.image',
  label: 'Google Cloud · Gemini and Imagen',

  isConfigured(): boolean {
    return gcpAuthAvailable()
  },

  unavailableReason(): string {
    return `no usable Google credential — ${describeGcpAuth()}`
  },

  async run(input: GcpImageInput): Promise<PaintedBackground> {
    if (!this.isConfigured()) throw new AdapterError(this.id, this.unavailableReason())

    const headers = await gcpAuthHeader()
    const model = input.model ?? config.gcp.imageModel
    const gemini = isGeminiImageModel(model)

    /*
     * Invariant 21: the model paints a BACKGROUND and is never asked for text,
     * because the brand layer is drawn locally as vectors over the result.
     *
     * HOW that is asked for differs by family, and it is not cosmetic. Imagen
     * takes a list of prohibitions and honours it. A Gemini image model handed
     * the same list — "no text, no words, no letters, no logos, no watermarks" —
     * answers HTTP 200 with an EMPTY candidate: no image, no text, not even a
     * finishReason, which the caller can only report as "returned no image
     * data". Measured across five phrasings, one prohibition is tolerated and
     * the full list is not, while describing the wordless result positively
     * works every time and returns a richer image.
     *
     * So the intent is identical and the wording is per family: state what the
     * frame contains rather than listing what it must not.
     */
    const prompt = gemini
      ? `${input.prompt}. A purely abstract technical background: only gradients, ` +
        'geometry and texture, an entirely wordless composition.'
      : `${input.prompt}. Abstract technical background artwork, ` +
        'no text, no words, no letters, no logos, no watermarks.'

    const body = gemini
      ? {
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            // Gemini image models must be told to return an image; text-only is
            // the default and would come back with no inlineData at all.
            responseModalities: ['TEXT', 'IMAGE'],
          },
        }
      : {
          instances: [{ prompt }],
          parameters: {
            sampleCount: 1,
            aspectRatio: aspectRatioFor(input.width, input.height),
            personGeneration: 'dont_allow',
          },
        }

    const payload = await fetchJson<ImagenResponse & GeminiResponse>(imageEndpoint(model), {
      method: 'POST',
      timeoutMs: input.timeoutMs,
      adapterId: 'gcp.image',
      headers,
      body,
    })

    if (gemini) {
      const inline = (payload.candidates ?? [])
        .flatMap((c) => c.content?.parts ?? [])
        .map((part) => (part as { inlineData?: { data?: string; mimeType?: string } }).inlineData)
        .find((data) => typeof data?.data === 'string' && data.data !== '')

      if (!inline?.data) {
        // A Gemini image model that returns only text has refused, and the text
        // is the refusal. Surfacing it beats reporting "no image data".
        const said = (payload.candidates ?? [])
          .flatMap((c) => c.content?.parts ?? [])
          .map((p) => p.text ?? '')
          .join(' ')
          .trim()
        throw new AdapterError(
          this.id,
          said === ''
            ? `${model} returned no image data`
            : `${model} returned no image, only text: ${said.slice(0, 200)}`,
        )
      }

      return { base64: inline.data, mimeType: inline.mimeType ?? 'image/png' }
    }

    const first = payload.predictions?.[0]
    if (!first?.bytesBase64Encoded) {
      throw new AdapterError(this.id, `${model} returned no image data`)
    }

    return { base64: first.bytesBase64Encoded, mimeType: first.mimeType ?? 'image/png' }
  },
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DETERMINISTIC TEMPLATE WRITER
   The fallback for every text call. Same output SHAPE as the model path, so
   nothing downstream branches on which one produced the caption.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TemplateWriterInput {
  title: string
  description: string
  topic: string
  angle: string
  audience: string
  /** Retrieved Knowledge Base entries. Used verbatim as the evidence beat. */
  grounding: Array<{ title: string; content: string }>
  hookStyle: string
  hookMaxWords: number
  layers: number
  closeStyle: string
}

/** Hand-authored hook patterns, chosen deterministically by style. */
const HOOK_PATTERNS: Record<string, (t: TemplateWriterInput) => string> = {
  Declarative: (t) => `${t.title}.`,
  Question: (t) => `What if ${lowerFirst(stripPeriod(t.title))}?`,
  Contrarian: (t) => `The usual reading of ${lowerFirst(stripPeriod(t.topic))} is wrong.`,
  Observation: (t) => `Something changed in ${lowerFirst(stripPeriod(t.topic))} this quarter.`,
}

function stripPeriod(s: string): string {
  return s.replace(/[.]+$/, '')
}

function lowerFirst(s: string): string {
  return s.charAt(0).toLowerCase() + s.slice(1)
}

function clampWords(s: string, maxWords: number): string {
  const words = s.split(/\s+/).filter(Boolean)
  if (words.length <= maxWords) return s
  return `${words.slice(0, maxWords).join(' ')}.`
}

/**
 * Writes the nine-stage caption without a model.
 *
 * The grounding entries are used as the evidence beat verbatim rather than
 * paraphrased, so the claim is traceable to the entry it came from — which is
 * what makes rule 6 pass on the fixture path too.
 */
export function writeTemplateCaption(input: TemplateWriterInput): string {
  const hookFn = HOOK_PATTERNS[input.hookStyle] ?? HOOK_PATTERNS.Declarative
  const hook = clampWords((hookFn as (t: TemplateWriterInput) => string)(input), input.hookMaxWords)

  const blocks: string[] = [hook, '']

  // Context and problem.
  blocks.push(input.description)
  blocks.push('')

  // Reframe → mechanism → evidence, one paragraph per requested layer.
  const layers: string[] = [
    `Treated as a detail of the pipeline, this looks minor. Treated as a specification, it decides behaviour in every case nobody enumerated.`,
    `The mechanism is unglamorous: ${lowerFirst(stripPeriod(input.angle))}. That is where the behaviour is actually determined.`,
  ]

  if (input.grounding.length > 0) {
    const evidence = input.grounding
      .slice(0, 2)
      .map((g) => stripPeriod(firstSentence(g.content)))
      .join('. ')
    layers.push(`The evidence: ${evidence}.`)
  } else {
    layers.push(
      `We are publishing the working notes rather than a claim, because the supporting research is not yet in hand.`,
    )
  }

  for (const layer of layers.slice(0, Math.max(1, input.layers))) {
    blocks.push(layer)
    blocks.push('')
  }

  // Implication and the Ethara connection.
  blocks.push(
    `For ${input.audience}, the consequence is practical: name an owner, review the definition before the run, and measure the thing you care about rather than the thing that is easy to log.`,
  )
  blocks.push('')
  blocks.push(`We build ${input.topic} systems at Ethara, and this is the part that moves outcomes.`)

  // Close.
  const closes: Record<string, string> = {
    Implication: `If that holds, most of the remaining gains are in specification, not scale.`,
    'Open question': `Where else is a specification being mistaken for a training detail?`,
    'Forward look': `We will publish the ablations once the held-out set is rebuilt.`,
    None: '',
  }
  const close = closes[input.closeStyle] ?? closes.Implication
  if (close !== undefined && close !== '') {
    blocks.push('')
    blocks.push(close)
  }

  return blocks.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

function firstSentence(s: string): string {
  return (s.split(/(?<=[.?!])\s/)[0] ?? s).trim()
}

/**
 * The deterministic rewrite path, used when a model is unavailable but the
 * operator asked for a specific change. Applies the instruction mechanically
 * where it can, and reports honestly where it cannot.
 */
export interface TemplateRewriteResult {
  text: string
  /** What actually changed, in one line. Empty when nothing could be applied. */
  applied: string
}

export function rewriteTemplateCaption(
  body: string,
  instruction: string,
): TemplateRewriteResult {
  const lower = instruction.toLowerCase()
  const paragraphs = body.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)

  if (/\b(shorter|shorten|tighten|trim|cut|concise)\b/.test(lower)) {
    // Keep the hook, the strongest middle beat, and the close.
    const kept =
      paragraphs.length <= 3
        ? paragraphs
        : [paragraphs[0] as string, paragraphs[Math.floor(paragraphs.length / 2)] as string, paragraphs[paragraphs.length - 1] as string]
    return {
      text: kept.join('\n\n'),
      applied: `Cut from ${paragraphs.length} paragraphs to ${kept.length}.`,
    }
  }

  if (/\b(longer|expand|elaborate|more detail)\b/.test(lower)) {
    const insertAt = Math.max(1, paragraphs.length - 2)
    const added =
      'Worth stating the boundary: this holds where the task has many valid solution paths, and matters less where the outcome signal is already dense.'
    const next = [...paragraphs.slice(0, insertAt), added, ...paragraphs.slice(insertAt)]
    return {
      text: next.join('\n\n'),
      applied: 'Added a scope-and-limits paragraph before the close.',
    }
  }

  if (/\b(cto|executive|leadership|senior|business)\b/.test(lower)) {
    const reframed = paragraphs.map((p, i) =>
      i === 0
        ? p
        : p.replace(
            /\bthe mechanism is unglamorous\b/i,
            'The decision this forces is a budget one',
          ),
    )
    reframed.splice(
      Math.max(1, reframed.length - 2),
      0,
      'In cost terms: the same outcome for a fraction of the spend, because the saving comes from specification rather than scale.',
    )
    return {
      text: reframed.join('\n\n'),
      applied: 'Reframed toward cost and the decision it forces.',
    }
  }

  if (/\b(hook|opening|first line|stronger start)\b/.test(lower)) {
    const rest = paragraphs.slice(1)
    return {
      text: [`${stripPeriod(paragraphs[0] ?? '')} — and it is not a training detail.`, ...rest].join(
        '\n\n',
      ),
      applied: 'Sharpened the opening line.',
    }
  }

  // Nothing mechanical matched. Return the body unchanged and say so, rather
  // than silently pretending an edit happened.
  return { text: body, applied: '' }
}

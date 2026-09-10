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

/* ═══════════════════════════════════════════════════════════════════════════
   TEXT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GcpTextInput {
  /** The system instruction: brand definition plus retrieved grounding. */
  systemInstruction: string
  /** The actual request. */
  prompt: string
  temperature: number
  maxOutputTokens: number
  /** Use the fast model for short, cheap calls like a single rewrite. */
  fast?: boolean
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
 * header, Vertex expects a bearer token. A service-account JSON would need a
 * signed JWT exchange, which is out of scope here — so when a project is named
 * but no usable token is present, the adapter reports itself unconfigured
 * rather than failing at call time.
 */
function textHeaders(): Record<string, string> {
  if (config.gcp.useVertex) {
    return { authorization: `Bearer ${config.gcp.apiKey}` }
  }
  return { 'x-goog-api-key': config.gcp.apiKey }
}

export const gcpText: ServiceAdapter<GcpTextInput, string> = {
  id: 'gcp.text',
  label: 'Google Cloud · Gemini',

  isConfigured(): boolean {
    // Vertex needs a project AND a token we can actually present.
    if (config.gcp.useVertex) return config.gcp.apiKey !== ''
    return config.gcp.apiKey !== ''
  },

  unavailableReason(): string {
    if (config.gcp.useVertex && config.gcp.apiKey === '') {
      return 'GCP_PROJECT_ID is set but GCP_API_KEY is empty, so Vertex cannot be authenticated'
    }
    return 'GCP_API_KEY is not set'
  },

  async run(input: GcpTextInput): Promise<string> {
    if (!this.isConfigured()) throw new AdapterError(this.id, this.unavailableReason())

    const model = input.fast ? config.gcp.fastTextModel : config.gcp.textModel

    const payload = await fetchJson<GeminiResponse>(textEndpoint(model), {
      method: 'POST',
      timeoutMs: config.gcp.timeoutMs,
      adapterId: 'gcp.text',
      headers: textHeaders(),
      body: {
        systemInstruction: { parts: [{ text: input.systemInstruction }] },
        contents: [{ role: 'user', parts: [{ text: input.prompt }] }],
        generationConfig: {
          temperature: input.temperature,
          maxOutputTokens: input.maxOutputTokens,
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

    if (text === '') {
      const finish = payload.candidates?.[0]?.finishReason
      throw new AdapterError(
        this.id,
        finish ? `model returned no text (finishReason: ${finish})` : 'model returned no text',
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

function imageEndpoint(): string {
  if (config.gcp.useVertex) {
    return (
      `https://${config.gcp.location}-aiplatform.googleapis.com/v1/projects/` +
      `${config.gcp.projectId}/locations/${config.gcp.location}/publishers/google/models/` +
      `${config.gcp.imageModel}:predict`
    )
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${config.gcp.imageModel}:predict`
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
  label: 'Google Cloud · Imagen',

  isConfigured(): boolean {
    return config.gcp.apiKey !== ''
  },

  unavailableReason(): string {
    return 'GCP_API_KEY is not set'
  },

  async run(input: GcpImageInput): Promise<PaintedBackground> {
    if (!this.isConfigured()) throw new AdapterError(this.id, this.unavailableReason())

    const payload = await fetchJson<ImagenResponse>(imageEndpoint(), {
      method: 'POST',
      timeoutMs: input.timeoutMs,
      adapterId: 'gcp.image',
      headers: textHeaders(),
      body: {
        instances: [
          {
            // The prompt is explicitly background-only. Any request for text in
            // the image would violate invariant 21.
            prompt: `${input.prompt}. Abstract technical background artwork, no text, no words, no letters, no logos, no watermarks.`,
          },
        ],
        parameters: {
          sampleCount: 1,
          aspectRatio: aspectRatioFor(input.width, input.height),
          personGeneration: 'dont_allow',
        },
      },
    })

    const first = payload.predictions?.[0]
    if (!first?.bytesBase64Encoded) {
      throw new AdapterError(this.id, 'Imagen returned no image data')
    }

    return {
      base64: first.bytesBase64Encoded,
      mimeType: first.mimeType ?? 'image/png',
    }
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

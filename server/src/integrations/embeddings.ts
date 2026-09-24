/**
 * EMBEDDINGS — the vector half of retrieval, on Google's hosted embedder.
 *
 * Law 3: behind `ServiceAdapter`, with `isConfigured()` and
 * `unavailableReason()`, so the product stays fully explorable with an empty
 * `.env`. There is no fixture path here and there deliberately is not one: a
 * fabricated vector would place a row at a fabricated distance from every
 * query, which is the fabricated-evidence failure of constraint 3 wearing a
 * numeric disguise. When the embedder is unreachable, retrieval falls back to
 * the LEXICAL scorer — a second real implementation — and says so.
 *
 * WHY gemini-embedding-001. It rides the same Google credential that already
 * serves Gemini text, so semantic retrieval needs no separate service or key —
 * an API key OR a Vertex service account is enough. It is a Matryoshka model:
 * asked for `outputDimensionality: 768` it returns a 768-dimension vector whose
 * quality is within a point of the full 3072 on MTEB, which is what lets the
 * `vector(768)` column in `schema.sql` stay exactly as it was.
 *
 * WHY THE OUTPUT IS NORMALISED HERE. `gemini-embedding-001` does NOT normalise
 * vectors it truncates below 3072 dimensions — that is documented, and it is
 * the one footgun of the model. An un-normalised vector makes cosine distance
 * depend on magnitude as well as direction, which quietly degrades every
 * ranking. So each returned vector is L2-normalised at this boundary, once,
 * where it cannot be forgotten by a caller.
 *
 * WHY THE DIMENSION IS CHECKED. `schema.sql` fixes the column at vector(768):
 * pgvector needs a literal width for an HNSW index. Requesting a different
 * `EMBEDDING_DIMENSIONS` would otherwise fail deep inside a distance operator,
 * so the width is asserted at the boundary with both numbers named.
 */

import type { ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError, fetchJson } from './adapter'
import { describeGcpAuth, gcpAuthAvailable, gcpAuthHeader } from './gcp-auth'

/* ═══════════════════════════════════════════════════════════════════════════
   THE WIRE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface EmbedInput {
  /** The texts to embed, in order. The result is index-aligned with this. */
  texts: string[]
  /**
   * `query` for something a person is searching WITH, `document` for something
   * being searched OVER. Asymmetric on purpose: it maps to Gemini's
   * `RETRIEVAL_QUERY` / `RETRIEVAL_DOCUMENT` task types, which optimise the two
   * ends of a retrieval pair differently. A query embedded as a document is a
   * silent quality loss no error would ever report.
   */
  kind: 'query' | 'document'
}

/** One item in a `:batchEmbedContents` request. */
interface EmbedContentRequest {
  model: string
  content: { parts: Array<{ text: string }> }
  taskType: 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT'
  outputDimensionality: number
}

interface GeminiEmbedResponse {
  /** `:batchEmbedContents` returns this. */
  embeddings?: Array<{ values?: number[] }>
  /** `:embedContent` returns this singular form. */
  embedding?: { values?: number[] }
  error?: { message?: string }
}

/** The Gemini task type for each end of a retrieval pair. */
function taskTypeFor(kind: 'query' | 'document'): 'RETRIEVAL_QUERY' | 'RETRIEVAL_DOCUMENT' {
  return kind === 'query' ? 'RETRIEVAL_QUERY' : 'RETRIEVAL_DOCUMENT'
}

/**
 * L2-normalises a vector so its length is 1.
 *
 * Mandatory for `gemini-embedding-001` at any dimension other than 3072: the
 * model returns the truncated vector un-normalised, and cosine similarity is
 * only a direction measure once the magnitude is 1. A zero vector (which the
 * API does not return, but which a malformed row could) is passed through
 * unchanged rather than divided by zero.
 */
function l2normalise(vector: number[]): number[] {
  let sumSquares = 0
  for (const value of vector) sumSquares += value * value
  const magnitude = Math.sqrt(sumSquares)
  if (magnitude === 0) return vector
  return vector.map((value) => value / magnitude)
}

/**
 * The `:batchEmbedContents` endpoint for the configured model.
 *
 * Vertex when a project is named, the public Generative Language API otherwise
 * — the same split `gcp-llm.ts` uses for text, resolved from the same
 * `config.gcp.useVertex`.
 */
function batchEmbedEndpoint(model: string): string {
  if (config.gcp.useVertex) {
    return (
      `https://${config.gcp.location}-aiplatform.googleapis.com/v1/projects/` +
      `${config.gcp.projectId}/locations/${config.gcp.location}/publishers/google/models/` +
      `${model}:batchEmbedContents`
    )
  }
  return `https://generativelanguage.googleapis.com/v1beta/models/${model}:batchEmbedContents`
}

export const embeddingAdapter: ServiceAdapter<EmbedInput, number[][]> = {
  id: 'gcp.embed',
  label: 'Google Cloud · gemini-embedding-001',

  isConfigured(): boolean {
    return config.embeddings.configured
  },

  unavailableReason(): string {
    if (!config.embeddings.enabled) {
      return 'EMBEDDINGS_ENABLED is false — retrieval is running on the lexical scorer only'
    }
    return `no usable Google credential, so nothing can embed — retrieval is lexical only (${describeGcpAuth()})`
  },

  async run(input: EmbedInput): Promise<number[][]> {
    if (input.texts.length === 0) return []

    const model = config.embeddings.model
    const expected = config.embeddings.dimensions
    const taskType = taskTypeFor(input.kind)

    // `:batchEmbedContents` embeds a list in one round trip. Each request must
    // name the model on its own line — the API requires it even though the URL
    // already carries it.
    const requests: EmbedContentRequest[] = input.texts.map((text) => ({
      model: `models/${model}`,
      content: { parts: [{ text }] },
      taskType,
      outputDimensionality: expected,
    }))

    const payload = await fetchJson<GeminiEmbedResponse>(batchEmbedEndpoint(model), {
      method: 'POST',
      body: { requests },
      timeoutMs: config.embeddings.timeoutMs,
      adapterId: this.id,
      headers: await gcpAuthHeader(),
    })

    if (payload.error?.message) throw new AdapterError(this.id, payload.error.message)

    const raw = payload.embeddings ?? []
    if (raw.length !== input.texts.length) {
      throw new AdapterError(
        this.id,
        `asked ${model} for ${input.texts.length} vector(s) and received ${raw.length}`,
      )
    }

    const vectors: number[][] = []
    for (const entry of raw) {
      const values = entry.values ?? []
      if (values.length !== expected) {
        throw new AdapterError(
          this.id,
          `${model} returned ${values.length}-dimension vectors but the schema column is ` +
            `vector(${expected}). Either set EMBEDDING_DIMENSIONS back to ${expected}, or change ` +
            `the column width in schema.sql and re-embed everything — a vector from one ` +
            `dimensionality cannot be compared against another's.`,
        )
      }
      // gemini-embedding-001 does not normalise truncated dimensions; we must.
      vectors.push(l2normalise(values))
    }

    return vectors
  },
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CALLABLE SURFACE

   These never throw. Every caller is on a write or read path that must survive
   the embedder being down, so the failure is expressed as `null` plus a reason
   the caller can record — not as an exception that would lose a captured row.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface EmbedOutcome {
  /** Index-aligned with the input. `null` at a position that could not embed. */
  vectors: Array<number[] | null>
  /** Why nothing embedded, when nothing did. */
  reason?: string
}

/**
 * Embeds many texts, in batches, and never rejects.
 *
 * A batch that fails costs only that batch: the rest still embed, so one long
 * or malformed body cannot leave a whole run unembedded.
 */
export async function embedMany(
  texts: string[],
  kind: 'query' | 'document',
): Promise<EmbedOutcome> {
  if (texts.length === 0) return { vectors: [] }

  if (!embeddingAdapter.isConfigured()) {
    return {
      vectors: texts.map(() => null),
      reason: embeddingAdapter.unavailableReason(),
    }
  }

  const out: Array<number[] | null> = []
  const failures: string[] = []
  const size = Math.max(1, config.embeddings.batchSize)

  for (let i = 0; i < texts.length; i += size) {
    const batch = texts.slice(i, i + size)
    try {
      const vectors = await embeddingAdapter.run({ texts: batch, kind })
      out.push(...vectors)
    } catch (error) {
      const reason =
        error instanceof AdapterError
          ? error.toReason()
          : `gcp.embed failed — ${error instanceof Error ? error.message : String(error)}`
      if (!failures.includes(reason)) failures.push(reason)
      out.push(...batch.map(() => null))
    }
  }

  return failures.length > 0 ? { vectors: out, reason: failures.join('; ') } : { vectors: out }
}

/** One text. `null` when it could not be embedded, with the reason beside it. */
export async function embedOne(
  text: string,
  kind: 'query' | 'document',
): Promise<{ vector: number[] | null; reason?: string }> {
  const outcome = await embedMany([text], kind)
  const vector = outcome.vectors[0] ?? null
  return outcome.reason === undefined ? { vector } : { vector, reason: outcome.reason }
}

/* ═══════════════════════════════════════════════════════════════════════════
   SQL INTEROP
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * pgvector's text input format.
 *
 * `node-pg` has no vector type, so the value crosses as a string and is cast in
 * the statement (`$1::vector`). Built here so no call site hand-rolls it.
 */
export function toSqlVector(vector: number[]): string {
  return `[${vector.join(',')}]`
}

/** The model name to stamp on a row, so a change of embedder is detectable. */
export function embeddingModelId(): string {
  return config.embeddings.model
}

/**
 * What the text of a knowledge entry or scraped item should be, for embedding.
 *
 * One function so the write path and the backfill cannot compose it
 * differently — two rows embedded from differently-shaped text are two rows at
 * incomparable distances from the same query.
 */
export function embeddableText(title: string, body: string, maxChars = 4000): string {
  return `${title}\n\n${body}`.slice(0, maxChars).trim()
}

/** Whether some usable Google credential exists — the basis of `isConfigured`. */
export { gcpAuthAvailable }

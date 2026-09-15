/**
 * EMBEDDINGS — the vector half of retrieval, on the daemon we already run.
 *
 * Law 3: behind `ServiceAdapter`, with `isConfigured()` and
 * `unavailableReason()`, so the product stays fully explorable with an empty
 * `.env`. There is no fixture path here and there deliberately is not one: a
 * fabricated vector would place a row at a fabricated distance from every
 * query, which is the fabricated-evidence failure of constraint 3 wearing a
 * numeric disguise. When the embedder is unreachable, retrieval falls back to
 * the LEXICAL scorer — a second real implementation — and says so.
 *
 * WHY nomic-embed-text. 768 dimensions, Apache-2.0, ~275MB, and it rides the
 * same Ollama daemon as Qwen, so semantic retrieval adds no service, key or
 * egress. Its documented task prefixes (`search_query:` / `search_document:`)
 * are applied here rather than by callers, because a query embedded as a
 * document is a silent quality loss no error would ever report.
 *
 * WHY THE DIMENSION IS CHECKED. `schema.sql` fixes the column at vector(768):
 * pgvector needs a literal width for an HNSW index. Pointing `EMBEDDING_MODEL`
 * at a 1024-dimension model would otherwise fail deep inside a distance
 * operator, so the width is asserted at the boundary with both numbers named.
 */

import type { ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError, fetchJson } from './adapter'

/* ═══════════════════════════════════════════════════════════════════════════
   THE WIRE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface EmbedInput {
  /** The texts to embed, in order. The result is index-aligned with this. */
  texts: string[]
  /**
   * `query` for something a person is searching WITH, `document` for something
   * being searched OVER. Asymmetric on purpose — see the module note.
   */
  kind: 'query' | 'document'
}

interface OllamaEmbedResponse {
  embeddings?: number[][]
  error?: string
}

/** nomic's documented task prefixes. A no-op for models that ignore them. */
function withPrefix(text: string, kind: 'query' | 'document'): string {
  if (!config.embeddings.model.includes('nomic')) return text
  return `${kind === 'query' ? 'search_query' : 'search_document'}: ${text}`
}

export const embeddingAdapter: ServiceAdapter<EmbedInput, number[][]> = {
  id: 'ollama.embed',
  label: 'Ollama · nomic-embed-text (local)',

  isConfigured(): boolean {
    return config.embeddings.configured
  },

  unavailableReason(): string {
    if (!config.embeddings.enabled) {
      return 'EMBEDDINGS_ENABLED is false — retrieval is running on the lexical scorer only'
    }
    return 'OLLAMA_BASE_URL is not set, so nothing can embed — retrieval is lexical only'
  },

  async run(input: EmbedInput): Promise<number[][]> {
    if (input.texts.length === 0) return []

    const model = config.embeddings.model
    const expected = config.embeddings.dimensions

    const payload = await fetchJson<OllamaEmbedResponse>(
      `${config.ollama.baseUrl}/api/embed`,
      {
        method: 'POST',
        body: {
          model,
          input: input.texts.map((t) => withPrefix(t, input.kind)),
        },
        timeoutMs: config.embeddings.timeoutMs,
        adapterId: 'ollama.embed',
      },
    )

    if (payload.error) throw new AdapterError('ollama.embed', payload.error)

    const vectors = payload.embeddings ?? []
    if (vectors.length !== input.texts.length) {
      throw new AdapterError(
        'ollama.embed',
        `asked ${model} for ${input.texts.length} vector(s) and received ${vectors.length}`,
      )
    }

    for (const vector of vectors) {
      if (vector.length !== expected) {
        throw new AdapterError(
          'ollama.embed',
          `${model} returns ${vector.length}-dimension vectors but the schema column is ` +
            `vector(${expected}). Either set EMBEDDING_MODEL back to a ${expected}-dimension ` +
            `model, or change the column width in schema.sql and re-embed everything — a ` +
            `vector from one model cannot be compared against another's.`,
        )
      }
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
          : `ollama.embed failed — ${error instanceof Error ? error.message : String(error)}`
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

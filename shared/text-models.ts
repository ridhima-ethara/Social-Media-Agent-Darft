/**
 * The caption-writer catalogue.
 *
 * The counterpart to `image-models.ts`: which model writes and revises a
 * caption, declared rather than hidden in a handler, so the operator can see
 * and change it from the review panel (law 2 — a constant a human might want to
 * change is a knob, and a knob must be visible).
 *
 * `ethara-writer` is the floor, exactly as `brand-svg` is for imagery: it needs
 * no service, cannot fail, and is what the product falls back to when a model is
 * unreachable. Selecting an unreachable model is never silently honoured — the
 * draft is written by the floor and stamped with the reason.
 */

export type TextModelId = 'ethara-writer' | 'ollama-qwen3' | 'gcp-gemini'

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEFAULT MODEL TAGS — ONE HOME

   A model tag is a deployment fact, not a preference, and it was previously
   stated in four places that disagreed: `config.ts` defaulted to `qwen3:14b`
   while `server/.env.example` shipped `qwen3.5:latest`, so copying the example
   file pulled a different model than the code expected — and the one the code
   named was not installed at all.

   These constants are the single home. `server/src/config.ts` reads them as its
   `str()` fallbacks, and the Python tier mirrors them in `backend/core/models.py`
   — a test asserts the two files agree character for character, because Python
   cannot import TypeScript and a comment asking someone to remember is not a
   mechanism.

   THE RULE FOR CHANGING ONE: the tag named here must exist in the registry it
   addresses. `ollama list` is the check for the two Ollama tags.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Reasoning, captions, calendar copy. `qwen3.5:latest` is what `ollama pull qwen3.5` lands. */
export const DEFAULT_OLLAMA_TEXT_MODEL = 'qwen3.5:latest'

/** The hosted counterpart, used when `TEXT_MODEL_PROVIDER=gcp`. */
export const DEFAULT_GCP_TEXT_MODEL = 'gemini-2.5-pro'

/** Embeddings. 768 dimensions — `schema.sql` fixes the column to match. */
export const DEFAULT_EMBEDDING_MODEL = 'nomic-embed-text'

/** The Python tier's hosted binding. That tier has no Gemini client. */
export const DEFAULT_ANTHROPIC_MODEL = 'claude-sonnet-5'

export interface TextModelSpec {
  id: TextModelId
  label: string
  vendor: string
  /** Shown in the model menu. */
  summary: string
  /** Licence pill in the model menu. */
  licence: string
  /** The env key that switches it on. Empty for the local template writer. */
  envKey: string
  /**
   * The `ServiceAdapter` id whose reachability decides this model's. Empty for
   * the writer that needs no service. Matched against `mode.integrations`, so
   * the menu reports what the server actually reports rather than guessing.
   */
  adapterId: string
  /** Rough wall-clock expectation, shown as a hint. */
  typicalMs: number
}

export const TEXT_MODELS: TextModelSpec[] = [
  {
    id: 'ethara-writer',
    label: 'Ethara Writer',
    vendor: 'Ethara (local)',
    summary:
      'Deterministic template writer. Composes and revises from the brand rules with no network call — blunter than a model, and it never fails.',
    licence: 'In-house',
    envKey: '',
    adapterId: '',
    typicalMs: 30,
  },
  {
    id: 'ollama-qwen3',
    label: 'Qwen3 (local)',
    vendor: 'Ollama',
    summary:
      'Runs on the local Ollama daemon, so the draft and the evidence behind it never leave this machine. The default when a daemon is up.',
    licence: 'Apache-2.0',
    envKey: 'OLLAMA_BASE_URL',
    adapterId: 'ollama.text',
    typicalMs: 9000,
  },
  {
    id: 'gcp-gemini',
    label: 'Gemini 2.5 Pro',
    vendor: 'Google Cloud',
    summary:
      'Hosted reasoning model. Fastest of the three on long rewrites, and the only one that sends the draft off the machine.',
    licence: 'Commercial · Google Cloud terms',
    envKey: 'GCP_API_KEY',
    adapterId: 'gcp.text',
    typicalMs: 4200,
  },
]

export const TEXT_MODEL_BY_ID: Record<string, TextModelSpec> = Object.fromEntries(
  TEXT_MODELS.map((model) => [model.id, model]),
)

/**
 * The adapter id that decides an image model's reachability.
 *
 * Lives here beside the text mapping because both answer the same question, and
 * the menu needs one rule for it. `z-image-turbo` has no adapter in the server's
 * reachability sweep, so it reports as unverifiable rather than as unconfigured
 * — claiming a definite "not configured" for something never checked would be a
 * dishonest report.
 */
export const IMAGE_MODEL_ADAPTER: Record<string, string | null> = {
  'brand-svg': '',
  'gcp-imagen': 'gcp.image',
  'gcp-gemini-image': 'gcp.image',
  'flux2-klein': 'ollama.image',
  'z-image-turbo': null,
}

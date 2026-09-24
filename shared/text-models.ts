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

export type TextModelId = 'ethara-writer' | 'gcp-gemini'

/* ═══════════════════════════════════════════════════════════════════════════
   THE DEFAULT MODEL TAGS — ONE HOME

   A model tag is a deployment fact, not a preference. These constants are the
   single home. `server/src/config.ts` reads them as its `str()` fallbacks, and
   the Python tier mirrors the Anthropic tag in `backend/core/models.py` — a
   test asserts the two files agree character for character, because Python
   cannot import TypeScript and a comment asking someone to remember is not a
   mechanism.

   THE RULE FOR CHANGING ONE: the tag named here must exist in the registry it
   addresses.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The hosted model that writes captions, calendar copy and rewrites. */
export const DEFAULT_GCP_TEXT_MODEL = 'gemini-2.5-pro'

/**
 * Embeddings. `gemini-embedding-001` at `outputDimensionality: 768`, which
 * `schema.sql` fixes the column to match. Rides the same Google credential as
 * Gemini text — no separate service or key.
 */
export const DEFAULT_EMBEDDING_MODEL = 'gemini-embedding-001'

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
  /**
   * Whether the operator may CHOOSE this in the model menu.
   *
   * Separate from whether it exists. The catalogue has to keep every id: the
   * zod enums on the API routes validate against it, stored rows carry these
   * values, and the local renderer/template writer are the honest degradation
   * when nothing hosted is reachable. Deleting them would turn "no model
   * configured" from a labelled fallback into a hard failure, and would reject
   * every draft already stamped with one.
   *
   * So this narrows the MENU and nothing else. A model that is not selectable
   * can still run — it just cannot be picked on purpose.
   */
  selectable?: boolean
  /**
   * The env key that switches it on, for the operator-facing "not configured"
   * line. Empty for the local template writer.
   *
   * Names EVERY credential that satisfies the adapter, not just the first one.
   * Gemini accepts an API key or a service account; naming only the key sent an
   * operator to create one when their service account already worked — and this
   * deployment runs on the service account.
   */
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
    id: 'gcp-gemini',
    label: 'Gemini 2.5 Pro',
    vendor: 'Google Cloud',
    summary:
      'Hosted reasoning model. Writes and revises captions, scripts and calendar copy; the only model provider now that local models have been removed.',
    licence: 'Commercial · Google Cloud terms',
    envKey: 'GCP_API_KEY or GCP_SERVICE_ACCOUNT_JSON',
    selectable: true,
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
 * the menu needs one rule for it. `z-image-turbo` and `flux2-klein` have no
 * adapter in the server's reachability sweep — z-image is a self-hosted
 * endpoint and FLUX.2 Klein is an mflux subprocess — so they report as
 * unverifiable rather than as unconfigured. Claiming a definite "not configured"
 * for something never checked would be a dishonest report.
 */
export const IMAGE_MODEL_ADAPTER: Record<string, string | null> = {
  'brand-svg': '',
  'gcp-imagen': 'gcp.image',
  'gcp-gemini-image': 'gcp.image',
  'flux2-klein': null,
  'z-image-turbo': null,
}

/** The models the menu offers. Everything else still runs as a fallback. */
export const SELECTABLE_TEXT_MODELS = TEXT_MODELS.filter((m) => m.selectable === true)

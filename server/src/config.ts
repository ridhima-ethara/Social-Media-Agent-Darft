/**
 * The one typed accessor for environment configuration.
 *
 * Every value is read LAZILY, at call time — never captured at import time.
 * That is what lets an adapter answer `isConfigured()` honestly after the
 * process has started, without any part of the product having to be restarted
 * to notice that a key was filled in.
 */

import { config as loadDotenv, parse as dotenvParse } from 'dotenv'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, isAbsolute, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_GCP_TEXT_MODEL,
} from '../../shared/text-models'
import { DEFAULT_GCP_IMAGE_MODEL, DEFAULT_MFLUX_MODEL } from '../../shared/image-models'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, '..')

/**
 * THE ENV FILES, IN PRECEDENCE ORDER.
 *
 * `.env` is the primary and holds SETTINGS — ports, model names, timeouts, cron
 * expressions. `secrets.env` holds CREDENTIALS. They are separate so that a
 * configuration can be read, diffed and shared without also handing over the
 * keys, which is the whole reason for the split.
 *
 * `dotenv` does not overwrite a variable that is already set, so loading in this
 * order means a key present in both files resolves to `.env` — stated here and
 * at the top of `secrets.env`, because "which of two files is live" must never
 * be a question an operator has to answer by experiment.
 *
 * Every file is optional. Absent is a supported, first-class state: the product
 * runs with a completely empty environment and labels every degraded path.
 */
const ENV_FILES = ['.env', 'secrets.env'] as const

/** Which files were actually found, reported at boot so the source is visible. */
export const loadedEnvFiles: string[] = []

/*
 * BLANK COUNTS AS ABSENT WHEN AN OVERLAY FILLS IT IN.
 *
 * `dotenv` skips any variable already present in `process.env`, and a key
 * written as `PARALLEL_API_KEY=` IS present — as the empty string. So a blank
 * line in `.env` silently shadowed the real value in `secrets.env`, and the
 * product reported the key as missing while the operator was looking straight at
 * it in the file they had just edited. That is the worst possible failure mode
 * for a credential: correct configuration, confident denial.
 *
 * Every reader in this file already treats an empty string as absent — that is
 * what `str()` does, and it is why a key left blank in `.env.example` behaves
 * identically to a key that is not there. Loading follows the same rule: a later
 * file may fill a variable that is unset OR empty, and may never overwrite one
 * that actually holds a value. `.env` still wins on any key where it states
 * something.
 */
for (const [index, name] of ENV_FILES.entries()) {
  const path = join(SERVER_ROOT, name)
  if (!existsSync(path)) continue

  if (index === 0) {
    loadDotenv({ path, quiet: true })
  } else {
    const parsed = dotenvParse(readFileSync(path))
    for (const [key, value] of Object.entries(parsed)) {
      const current = process.env[key]
      if (current === undefined || current.trim() === '') process.env[key] = value
    }
  }
  loadedEnvFiles.push(name)
}

// Nothing found where we looked — fall back to dotenv's own resolution so a
// process started from another directory, or one whose variables come from the
// shell or a container, still behaves.
if (loadedEnvFiles.length === 0) {
  loadDotenv({ quiet: true })
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRIMITIVE READERS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Reads a string. Trims, and treats an empty string as absent so a key left
 * blank in `.env.example` behaves identically to a key that is not there.
 * Also strips a trailing inline `# comment`, which dotenv preserves for
 * unquoted values and which would otherwise poison cron expressions.
 */
function str(key: string, fallback = ''): string {
  const raw = process.env[key]
  if (raw === undefined) return fallback
  const withoutComment = raw.includes('#') ? (raw.split('#')[0] as string) : raw
  const trimmed = withoutComment.trim()
  return trimmed.length === 0 ? fallback : trimmed
}

function int(key: string, fallback: number): number {
  const raw = str(key)
  if (raw === '') return fallback
  const n = Number.parseInt(raw, 10)
  return Number.isFinite(n) ? n : fallback
}

function float(key: string, fallback: number): number {
  const raw = str(key)
  if (raw === '') return fallback
  const n = Number.parseFloat(raw)
  return Number.isFinite(n) ? n : fallback
}

function flag(key: string, fallback: boolean): boolean {
  const raw = str(key).toLowerCase()
  if (raw === '') return fallback
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on'
}

/** True when a key is present and non-empty. The basis of every `isConfigured`. */
function has(key: string): boolean {
  return str(key) !== ''
}

/* ═══════════════════════════════════════════════════════════════════════════
   TYPED SECTIONS
   ═══════════════════════════════════════════════════════════════════════════ */

export type PublishMode = 'demo' | 'live'
export type AssistantProvider = 'gcp' | 'deterministic'

/**
 * Which vendor serves text generation. Ollama has been removed, so `gcp`
 * (Gemini) is the only model provider; the type is kept for the config surface
 * and for callers that still read `config.textProvider`.
 */
export type TextProvider = 'gcp'

export const config = {
  /**
   * Provider selection for text generation, read by `textAdapter()`.
   * Gemini is the only provider now, so this is constant — kept so the health
   * report and any caller reading it resolve without a special case.
   */
  get textProvider(): TextProvider {
    return 'gcp'
  },

  /* ── Core ───────────────────────────────────────────────────────────────── */
  core: {
    /**
     * THE CANONICAL DATABASE IS `ethara_socialai`.
     *
     * It is what `docker-compose.yml` creates (`POSTGRES_DB`), so the default
     * here and the container agree. They used to differ — this defaulted to
     * `ethara_sma` — which meant copying `server/.env.example` as the README
     * instructs produced a URL pointing at a database nothing ever created, and
     * the API refused to start for a reason no message explained. A test parses
     * both out of `docker-compose.yml` so they cannot drift again.
     */
    get databaseUrl(): string {
      return str('DATABASE_URL', 'postgresql://ethara:ethara@localhost:5432/ethara_socialai')
    },
    /**
     * THE CANONICAL PORT IS 4001.
     *
     * Not 4000: another project on this machine answers there with a different
     * API, and `detectApi()` only trusts a `/health` carrying this product's
     * registry summary — so a stranger on the port reads as "no API" rather than
     * a half-working one. `vite.config.ts` reads this same value for its proxy
     * target, and nginx uses it in the container image.
     */
    get port(): number {
      return int('PORT', 4001)
    },
    get workspaceSlug(): string {
      return str('WORKSPACE_SLUG', 'ethara')
    },
    get corsOrigin(): string {
      return str('CORS_ORIGIN', '*')
    },
    get tz(): string {
      return str('TZ', 'Asia/Kolkata')
    },
    /** 'demo' simulates every platform call. 'live' requires real credentials. */
    get publishMode(): PublishMode {
      return str('PUBLISH_MODE', 'demo') === 'live' ? 'live' : 'demo'
    },
  },

  /* ── Ethara · command plane ─────────────────────────────────────────────── */
  assistant: {
    /**
     * Blank or 'deterministic' runs the built-in grammar parser and template
     * narrator: slightly blunter, fully working, every tool still reachable.
     */
    get provider(): AssistantProvider {
      return str('ASSISTANT_MODEL_PROVIDER').toLowerCase() === 'gcp' ? 'gcp' : 'deterministic'
    },
    get plannerModel(): string {
      return str('ASSISTANT_PLANNER_MODEL', 'gemini-2.5-pro')
    },
    get narratorModel(): string {
      return str('ASSISTANT_NARRATOR_MODEL', 'gemini-2.5-flash')
    },
    get maxPlanSteps(): number {
      return int('ASSISTANT_MAX_PLAN_STEPS', 8)
    },
    get confirmTtlSeconds(): number {
      return int('ASSISTANT_CONFIRM_TTL_SECONDS', 180)
    },
    get historyTurns(): number {
      return int('ASSISTANT_HISTORY_TURNS', 12)
    },
    get briefCron(): string {
      return str('ASSISTANT_BRIEF_CRON', '0 9 * * 1-5')
    },
    get watchIntervalMs(): number {
      return int('ASSISTANT_WATCH_INTERVAL_MS', 60000)
    },
    /** A server hint only. The browser decides whether speech is available. */
    get voiceEnabled(): boolean {
      return flag('ASSISTANT_VOICE_ENABLED', true)
    },
    get addressStyle(): 'surname' | 'firstname' | 'role' {
      const raw = str('ASSISTANT_ADDRESS_STYLE', 'surname')
      return raw === 'firstname' || raw === 'role' ? raw : 'surname'
    },
  },

  /* ── Capture · the Scraping Agent's lanes (all served by the Claude Bridge) ─ */
  capture: {
    /**
     * Characters kept per captured page. A property of the LANE, not of
     * whichever client reads it: one verbose page must not crowd the rest of a
     * keyword's budget out of the payload handed to the validator.
     */
    get maxCharsPerPage(): number {
      return int('OPEN_WEB_MAX_CHARS_PER_PAGE', 6000)
    },
  },

  /* ── Knowledge · Parallel Web Systems (research only — not a scraping source) ─ */
  /**
   * SocialFetch — public social data (profiles, posts, comments, engagement)
   * for the Analysis Agent's Social Media Listener. Header `x-api-key`. The key
   * lives in secrets.env; without it the listener reports itself unavailable.
   */
  socialFetch: {
    get baseUrl(): string {
      return str('SOCIALFETCH_BASE_URL', 'https://api.socialfetch.dev')
    },
    get apiKey(): string {
      return str('SOCIALFETCH_API_KEY')
    },
    get timeoutMs(): number {
      return Number(str('SOCIALFETCH_TIMEOUT_MS', '90000')) || 90_000
    },
  },
  /**
   * FetchLayer — Glassdoor employer reviews and ratings for the Analysis
   * Agent's Social Media Listener (https://fetchlayer.dev, header `x-api-key`).
   * The key lives in secrets.env; without it the Glassdoor block reports itself
   * unavailable and the rest of the listener is unaffected.
   */
  /**
   * DataForSEO — SEO & market data for Competitor Intelligence (the
   * competitor-profiling skill's DataForSEO calls). HTTP Basic auth with the
   * account login and API password, both in secrets.env. Unset, every SEO
   * figure reads "Not available from current sources".
   */
  dataForSeo: {
    get baseUrl(): string {
      return str('DATAFORSEO_BASE_URL', 'https://api.dataforseo.com')
    },
    get login(): string {
      return str('DATAFORSEO_LOGIN')
    },
    get password(): string {
      return str('DATAFORSEO_PASSWORD')
    },
    get locationCode(): number {
      return Number(str('DATAFORSEO_LOCATION_CODE', '2840')) || 2840
    },
  },
  fetchLayer: {
    get baseUrl(): string {
      return str('FETCHLAYER_BASE_URL', 'https://api.fetchlayer.dev')
    },
    get apiKey(): string {
      return str('FETCHLAYER_API_KEY')
    },
    get timeoutMs(): number {
      return Number(str('FETCHLAYER_TIMEOUT_MS', '90000')) || 90_000
    },
  },
  parallel: {
    get baseUrl(): string {
      return str('PARALLEL_BASE_URL', 'https://api.parallel.ai')
    },
    get apiKey(): string {
      return str('PARALLEL_API_KEY')
    },
    get searchPath(): string {
      return str('PARALLEL_SEARCH_PATH', '/v1beta/search')
    },
    get taskPath(): string {
      return str('PARALLEL_TASK_PATH', '/v1/tasks/runs')
    },
    get processor(): string {
      return str('PARALLEL_PROCESSOR', 'base')
    },
    get maxResults(): number {
      return int('PARALLEL_MAX_RESULTS', 10)
    },
    get maxCharsPerResult(): number {
      return int('PARALLEL_MAX_CHARS_PER_RESULT', 6000)
    },
    get timeoutMs(): number {
      return int('PARALLEL_TIMEOUT_MS', 120000)
    },
    get configured(): boolean {
      return has('PARALLEL_API_KEY')
    },
  },

  /* ── Knowledge build schedule ───────────────────────────────────────────── */
  knowledge: {
    /** Sunday 06:00 in TZ. */
    get discoveryCron(): string {
      /*
       * Blank means NOT SCHEDULED, deliberately. A discovery run costs Claude
       * usage and a few minutes of searching, so it must be opted into rather
       * than started by the act of installing the product.
       */
      return str('DISCOVERY_CRON')
    },
    get buildCron(): string {
      return str('KNOWLEDGE_BUILD_CRON', '0 6 * * 0')
    },
    /**
     * Competitor Intelligence monitoring: when set, profiles the competitors
     * that are DUE by their monitoring frequency (weekly / monthly). Blank = not
     * scheduled, for the same reason as discovery: it spends Claude usage.
     */
    get competitorMonitorCron(): string {
      return str('COMPETITOR_MONITOR_CRON')
    },
    get hashtagCount(): number {
      return int('KNOWLEDGE_HASHTAG_COUNT', 25)
    },
  },

  /* ── Content · Google Cloud ─────────────────────────────────────────────── */
  gcp: {
    get apiKey(): string {
      return str('GCP_API_KEY')
    },
    get projectId(): string {
      return str('GCP_PROJECT_ID')
    },
    get location(): string {
      return str('GCP_LOCATION', 'us-central1')
    },
    /**
     * The service-account file, resolved against the SERVER ROOT.
     *
     * `GCP_SERVICE_ACCOUNT_JSON=./secrets/gcp-sa.json` is a relative path, and
     * it used to be handed onward as written — so it resolved against whatever
     * directory the process happened to start in. Launched from `server/` it
     * found the file; launched from the repo root, from a script, from a test
     * or from a container with a different workdir, it did not.
     *
     * The failure was silent and expensive: `gcpText.isConfigured()` returned
     * false, the caption fell through to the template writer, and the operator
     * saw a worse revision stamped "the model was not reachable" while the
     * credential sat exactly where they had put it. `/api/health` reported
     * Gemini as configured at the same time, because the API does start from
     * `server/` — two parts of one product disagreeing about the same file.
     *
     * Same defect `integrations/agent-tier.ts` documents for AGENT_PYTHON, and
     * the same fix: resolve against a path derived from this module's own
     * location, never from `process.cwd()`. An absolute path is returned
     * untouched.
     */
    get serviceAccountJson(): string {
      const configured = str('GCP_SERVICE_ACCOUNT_JSON')
      if (configured === '') return ''
      return isAbsolute(configured) ? configured : join(SERVER_ROOT, configured)
    },
    get textModel(): string {
      return str('GCP_TEXT_MODEL', DEFAULT_GCP_TEXT_MODEL)
    },
    /** Same rule as Ollama's: an unset fast model means the configured one. */
    get fastTextModel(): string {
      return str('GCP_FAST_TEXT_MODEL', this.textModel)
    },
    get imageModel(): string {
      return str('GCP_IMAGE_MODEL', DEFAULT_GCP_IMAGE_MODEL)
    },
    get timeoutMs(): number {
      return int('GCP_TIMEOUT_MS', 90000)
    },
    get maxOutputTokens(): number {
      return int('GCP_MAX_OUTPUT_TOKENS', 2048)
    },
    get temperature(): number {
      return float('GCP_TEMPERATURE', 0.6)
    },
    /** Either an API key or a service account is enough to be configured. */
    get configured(): boolean {
      return has('GCP_API_KEY') || has('GCP_SERVICE_ACCOUNT_JSON')
    },
    /** Vertex endpoints are used when a project is named; otherwise the public API. */
    get useVertex(): boolean {
      return has('GCP_PROJECT_ID')
    },
  },

  /* ── Identity and role ───────────────────────────────────────────────────── */
  auth: {
    /**
     * The shared operator password. BLANK MEANS NO PASSWORD IS REQUIRED — the
     * product must run with an empty `.env`, so an absent credential opens the
     * gate rather than closing the product. `/api/health` reports
     * `auth.enforced` so an open gate is visible rather than assumed shut.
     */
    get operatorPassword(): string {
      return str('OPERATOR_PASSWORD')
    },
    /**
     * The HMAC key for session cookies. Blank means a random per-process key:
     * sessions then end on restart, which is inconvenient and safe. A shipped
     * constant would be neither — every deployment would share a signing key.
     */
    get sessionSecret(): string {
      return str('SESSION_SECRET')
    },
    get sessionTtlSeconds(): number {
      return int('SESSION_TTL_SECONDS', 60 * 60 * 12)
    },
    /**
     * Whether the session cookie is marked `Secure`.
     *
     * Off by default because development is plain HTTP on localhost and a
     * `Secure` cookie would simply never be stored — which presents as sign-in
     * silently not working. Turn it on for any deployment behind TLS.
     */
    get secureCookie(): boolean {
      return flag('SESSION_SECURE_COOKIE', false)
    },
  },

  /* ── Publishing · Buffer ─────────────────────────────────────────────────── */
  buffer: {
    /**
     * The base URL Buffer's servers will fetch creatives from.
     *
     * Buffer takes an image by URL — `ImageAssetInput.url` is the only way to
     * attach one, there is no upload endpoint — so the creative must be reachable
     * from the public internet. `localhost` is not: it resolves on Buffer's
     * machine, not ours.
     *
     * Blank is a supported state. The caption then publishes without the image and
     * says why, which is the correct degradation: losing the whole post because a
     * picture could not be hosted would be the worse failure.
     */
    get publicBaseUrl(): string {
      return str('PUBLIC_BASE_URL').replace(/\/+$/, '')
    },
    /*
     * ONE TOKEN, EVERY CHANNEL.
     *
     * Buffer is a broker: the operator connects LinkedIn, Instagram, X and
     * Facebook inside Buffer once, and this posts through it. That is why there
     * is a single credential here rather than a per-platform app, secret and
     * OAuth flow — and why a LinkedIn *Company Page* is reachable at all, since
     * the scope LinkedIn refuses to issue us directly is one Buffer already holds.
     */
    get accessToken(): string {
      return str('BUFFER_ACCESS_TOKEN')
    },
    get apiBase(): string {
      return str('BUFFER_API_BASE', 'https://api.buffer.com')
    },
    get timeoutMs(): number {
      return int('BUFFER_TIMEOUT_MS', 30000)
    },
    /**
     * An explicitly pinned channel for a platform, or '' to discover it.
     *
     * Pinning matters when an account holds two channels for one service — a
     * personal LinkedIn profile and a Company Page, say. Discovery would resolve
     * whichever Buffer listed first, and posting to the wrong feed cannot be
     * undone, so the ambiguous case is refused rather than guessed.
     */
    profileIdFor(platform: string): string {
      return str(`BUFFER_PROFILE_ID_${platform.toUpperCase()}`)
    },
    get configured(): boolean {
      return has('BUFFER_ACCESS_TOKEN')
    },
  },

  /* ── The Python agent tier · process boundary ────────────────────────────── */
  agentTier: {
    /**
     * The interpreter that runs `backend/api.py`.
     *
     * Blank means "the venv inside the backend root", derived from the module's
     * own location rather than the working directory — see
     * `integrations/agent-tier.ts`. Present for the same reason
     * `CRAWL4AI_PYTHON` is: a sidecar reached across a process boundary is
     * deployment configuration, and it must be overridable and checkable.
     */
    get python(): string {
      return str('AGENT_PYTHON')
    },
    /** The directory holding `api.py` and `.venv`. Blank means `<repo>/backend`. */
    get backendRoot(): string {
      return str('AGENT_BACKEND_ROOT')
    },
  },

  /* ── Semantic retrieval · embeddings over the Google credential ─────────── */
  embeddings: {
    /**
     * The embedding model. Rides the same Google credential that serves Gemini
     * text, so enabling semantic retrieval costs no new service or key.
     */
    get model(): string {
      return str('EMBEDDING_MODEL', DEFAULT_EMBEDDING_MODEL)
    },
    /**
     * The vector width requested from the model AND asserted against the schema.
     * `schema.sql` fixes the column at vector(768) because pgvector needs a
     * literal dimension for an HNSW index, and `gemini-embedding-001` returns
     * exactly this width when asked via `outputDimensionality`. A response of
     * any other width is rejected at write time with both numbers named, rather
     * than allowed to fail later inside a distance operator.
     */
    get dimensions(): number {
      return int('EMBEDDING_DIMENSIONS', 768)
    },
    /** How many texts go in one `:batchEmbedContents` request. */
    get batchSize(): number {
      return int('EMBEDDING_BATCH_SIZE', 16)
    },
    get timeoutMs(): number {
      return int('EMBEDDING_TIMEOUT_MS', 120000)
    },
    /**
     * Whether semantic retrieval is on. Defaults to on WHEN a Google credential
     * exists, because the embedder rides the same credential the text model
     * already uses — but `EMBEDDINGS_ENABLED=false` turns it off without
     * touching the credential, which is what you want to isolate a retrieval
     * problem.
     */
    get enabled(): boolean {
      return flag('EMBEDDINGS_ENABLED', true)
    },
    get configured(): boolean {
      return this.enabled && (has('GCP_API_KEY') || has('GCP_SERVICE_ACCOUNT_JSON'))
    },
  },

  /* ── Local background painter · mflux (FLUX.2 Klein on MLX) ─────────────── */
  mflux: {
    /**
     * The Python interpreter of the venv that has `mflux` installed, and the
     * model name to hand it. Present because Ollama 0.33.3 will not serve
     * image models over HTTP; this is the transport that actually paints.
     */
    get python(): string {
      return str('MFLUX_PYTHON')
    },
    get model(): string {
      return str('MFLUX_MODEL', DEFAULT_MFLUX_MODEL)
    },
    /** Klein is distilled — few steps is the point of it. */
    get steps(): number {
      return int('MFLUX_STEPS', 4)
    },
    /** Fixed by default so the same brief renders the same background twice. */
    get seed(): number {
      return int('MFLUX_SEED', 42)
    },
    get quantize(): number {
      return int('MFLUX_QUANTIZE', 8)
    },
    get timeoutMs(): number {
      return int('MFLUX_TIMEOUT_MS', 900000)
    },
    get configured(): boolean {
      return has('MFLUX_PYTHON')
    },
  },

  /* ── Whisper · local transcription sidecar (ADR-011) ────────────────────── */
  whisper: {
    /**
     * The Python interpreter of a venv that has `faster-whisper` (or `whisper`)
     * installed. Blank is a supported, first-class state: nothing spawns,
     * `scraped_items.transcript` stays NULL, and the run says what it could not
     * transcribe.
     *
     * Present for the same reason `AGENT_PYTHON` and `MFLUX_PYTHON` are: a
     * sidecar reached across a process boundary is deployment configuration,
     * and it must be overridable and checkable rather than guessed from `cwd`.
     */
    get python(): string {
      return str('WHISPER_PYTHON')
    },
    /**
     * Which weights to load. `base` is the honest default — it is fast enough
     * to run on the machine serving the API and accurate enough that a
     * transcript is usable as evidence. Larger models are markedly slower, and
     * the minute budget below is what stops that becoming a surprise.
     */
    get model(): string {
      return str('WHISPER_MODEL', 'base')
    },
    /** `auto` detects per item. Pinning a language is faster and can be wrong. */
    get language(): string {
      return str('WHISPER_LANGUAGE', 'auto')
    },
    /**
     * THE CEILING THE OPERATOR'S KNOB CANNOT EXCEED (ADR-011).
     *
     * The knob asks, this decides. Transcription bills wall-clock time on this machine rather
     * than a vendor invoice, which makes it easier to spend carelessly, not
     * harder.
     */
    get maxMinutesPerRun(): number {
      return int('WHISPER_MAX_MINUTES_PER_RUN', 20)
    },
    /**
     * A bound on ONE item, so a single mis-detected long stream cannot consume
     * the whole run budget by itself.
     */
    get maxSecondsPerItem(): number {
      return int('WHISPER_MAX_SECONDS_PER_ITEM', 600)
    },
    get timeoutMs(): number {
      return int('WHISPER_TIMEOUT_MS', 180000)
    },
    get configured(): boolean {
      return has('WHISPER_PYTHON')
    },
  },

  /* ── Optional secondary image renderer ──────────────────────────────────── */
  zImage: {
    get endpoint(): string {
      return str('Z_IMAGE_ENDPOINT')
    },
    get apiKey(): string {
      return str('Z_IMAGE_API_KEY')
    },
    get modelId(): string {
      return str('Z_IMAGE_MODEL_ID', 'Tongyi-MAI/Z-Image-Turbo')
    },
    get timeoutMs(): number {
      return int('Z_IMAGE_TIMEOUT_MS', 60000)
    },
    get configured(): boolean {
      return has('Z_IMAGE_ENDPOINT')
    },
  },
} as const

/* ═══════════════════════════════════════════════════════════════════════════
   REPORTING — what /health surfaces, so the mode is always visible.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface IntegrationStatus {
  configured: boolean
  reason: string
}

function statusFor(configured: boolean, envKey: string): IntegrationStatus {
  return {
    configured,
    reason: configured ? 'Configured' : `${envKey} is not set`,
  }
}

export function integrationStatuses(): {
  parallel: IntegrationStatus
  gcp: IntegrationStatus
  embeddings: IntegrationStatus & { model: string; dimensions: number }
  mflux: IntegrationStatus & { model: string }
  zImage: IntegrationStatus
  text: IntegrationStatus & {
    provider: TextProvider
    resolved: 'gcp' | 'template'
    /** The ordered providers that will be tried, primary first. */
    chain: Array<'gcp'>
    /** The provider standing behind the primary, or `null` when there is none. */
    backup: 'gcp' | null
  }
  assistant: IntegrationStatus & { provider: AssistantProvider }
} {
  const gcpConfigured = config.gcp.configured

  /*
   * ONE PROVIDER NOW. Ollama has been removed, so text generation is Gemini
   * with the deterministic template writer as its only floor. There is no
   * second model provider, so `chain` is at most one link and `backup` is
   * always null — kept in the shape callers expect rather than removed.
   */
  const resolved: 'gcp' | 'template' = gcpConfigured ? 'gcp' : 'template'
  const chain: Array<'gcp'> = gcpConfigured ? ['gcp'] : []
  const backup: 'gcp' | null = null

  const assistantProvider = config.assistant.provider
  const assistantConfigured = assistantProvider === 'gcp' && gcpConfigured

  return {
    parallel: statusFor(config.parallel.configured, 'PARALLEL_API_KEY'),
    gcp: statusFor(gcpConfigured, 'GCP_API_KEY'),
    embeddings: {
      configured: config.embeddings.configured,
      reason: config.embeddings.configured
        ? `Semantic retrieval on — ${config.embeddings.model} (${config.embeddings.dimensions} dims) on the Google credential`
        : config.embeddings.enabled
          ? 'No Google credential set, so nothing can embed — retrieval is lexical only'
          : 'EMBEDDINGS_ENABLED is false — retrieval is lexical only',
      model: config.embeddings.model,
      dimensions: config.embeddings.dimensions,
    },
    mflux: {
      ...statusFor(config.mflux.configured, 'MFLUX_PYTHON'),
      model: config.mflux.model,
    },
    zImage: statusFor(config.zImage.configured, 'Z_IMAGE_ENDPOINT'),
    text: {
      provider: config.textProvider,
      resolved,
      chain,
      backup,
      configured: resolved !== 'template',
      reason:
        resolved === 'template'
          ? 'No text provider configured — running on the deterministic template writer'
          : `Hosted model — ${config.gcp.textModel}, with the deterministic template writer beneath it`,
    },
    assistant: {
      provider: assistantProvider,
      configured: assistantConfigured,
      reason:
        assistantProvider === 'deterministic'
          ? 'ASSISTANT_MODEL_PROVIDER is not set to gcp — running on the deterministic parser and template narrator'
          : assistantConfigured
            ? 'Configured'
            : // Either credential satisfies `gcpConfigured`, so naming only
              // GCP_API_KEY sent an operator to create a key they did not need —
              // a service account is the path this deployment actually uses.
              'ASSISTANT_MODEL_PROVIDER is gcp but neither GCP_API_KEY nor GCP_SERVICE_ACCOUNT_JSON is set — falling back to the deterministic parser',
    },
  }
}

/** Masks a secret for logging. Never print a raw key. */
export function maskSecret(value: string): string {
  if (value === '') return '(not set)'
  if (value.length <= 8) return '••••'
  return `${value.slice(0, 4)}••••${value.slice(-2)}`
}

/** A one-line boot summary of which mode every service is in. */
export function describeConfiguration(): string[] {
  const s = integrationStatuses()
  return [
    // Which files the values below came from. A token that was added to a file
    // nothing reads is the single most confusing failure in this area, so the
    // answer is printed rather than assumed.
    `env files   ${loadedEnvFiles.length === 0 ? 'none found — reading the shell environment' : loadedEnvFiles.join(' → ')}`,
    `database    ${redactUrl(config.core.databaseUrl)}`,
    `workspace   ${config.core.workspaceSlug}`,
    `publish     ${config.core.publishMode}`,
    `timezone    ${config.core.tz}`,
    `assistant   ${s.assistant.provider}${s.assistant.configured ? '' : ' (deterministic fallback)'}`,
    `text        ${s.text.resolved}${s.text.resolved === 'template' ? '' : ` · ${config.gcp.textModel}`}`,
    `embeddings  ${s.embeddings.configured ? `live · ${s.embeddings.model}` : 'lexical only'}`,
    `mflux       ${s.mflux.configured ? `live · ${s.mflux.model}` : 'not configured'}`,
    `parallel    ${s.parallel.configured ? 'live' : 'not configured'}`,
    `gcp         ${s.gcp.configured ? 'live' : 'template writer'}`,
    `z-image     ${s.zImage.configured ? 'live' : 'not configured'}`,
  ]
}

/** Strips the password from a connection string before it is logged. */
export function redactUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••@')
}

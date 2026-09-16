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
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  DEFAULT_EMBEDDING_MODEL,
  DEFAULT_GCP_TEXT_MODEL,
  DEFAULT_OLLAMA_TEXT_MODEL,
} from '../../shared/text-models'
import {
  DEFAULT_GCP_IMAGE_MODEL,
  DEFAULT_MFLUX_MODEL,
  DEFAULT_OLLAMA_IMAGE_MODEL,
} from '../../shared/image-models'

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
export type AssistantProvider = 'gcp' | 'ollama' | 'deterministic'

/**
 * Which vendor serves text generation.
 * `auto` prefers a configured local model over a cloud one — see `textAdapter()`.
 */
export type TextProvider = 'auto' | 'ollama' | 'gcp'

export const config = {
  /**
   * Provider selection for text generation, read by `textAdapter()`.
   * Lives at the top level rather than inside a vendor section because it is
   * the choice BETWEEN vendors, and putting it under one of them would imply
   * that vendor is privileged.
   */
  get textProvider(): TextProvider {
    const raw = str('TEXT_MODEL_PROVIDER', 'auto').toLowerCase()
    return raw === 'ollama' || raw === 'gcp' ? raw : 'auto'
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
      const raw = str('ASSISTANT_MODEL_PROVIDER').toLowerCase()
      return raw === 'gcp' || raw === 'ollama' ? raw : 'deterministic'
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

  /* ── Knowledge · Parallel Web Systems ───────────────────────────────────── */
  parallel: {
    get apiKey(): string {
      return str('PARALLEL_API_KEY')
    },
    get baseUrl(): string {
      return str('PARALLEL_BASE_URL', 'https://api.parallel.ai')
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
       * Blank means NOT SCHEDULED, deliberately. A discovery run costs Apify
       * credit and several minutes of crawling, so it must be opted into rather
       * than started by the act of installing the product.
       */
      return str('DISCOVERY_CRON')
    },
    get buildCron(): string {
      return str('KNOWLEDGE_BUILD_CRON', '0 6 * * 0')
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
    get serviceAccountJson(): string {
      return str('GCP_SERVICE_ACCOUNT_JSON')
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

  /* ── Local models · Ollama ──────────────────────────────────────────────── */
  ollama: {
    /**
     * No default. A default would make `configured` answer true on a machine
     * with no daemon, and /health would claim live when nothing is listening.
     * The example value is in `.env.example`, where it is opt-in.
     */
    get baseUrl(): string {
      return str('OLLAMA_BASE_URL').replace(/\/+$/, '')
    },
    /** Content generation, calendar reasoning, review rewrites, the planner. */
    get textModel(): string {
      return str('OLLAMA_TEXT_MODEL', DEFAULT_OLLAMA_TEXT_MODEL)
    },
    /**
     * Short, cheap calls — narration and single rewrites.
     *
     * Falls back to the model the operator actually configured, never to a
     * second hardcoded tag. A literal default here names a model the operator
     * never chose and may not have pulled: every `fast` call then failed with
     * "model not found", `withFallback` swallowed it, and caption edits
     * silently ran on the built-in writer instead of the model.
     */
    get fastTextModel(): string {
      return str('OLLAMA_FAST_TEXT_MODEL', this.textModel)
    },
    /** Background painting. Empty disables the Ollama image transport. */
    get imageModel(): string {
      return str('OLLAMA_IMAGE_MODEL', DEFAULT_OLLAMA_IMAGE_MODEL)
    },
    /** Local generation is slower per token than a hosted API; budget for it. */
    get timeoutMs(): number {
      return int('OLLAMA_TIMEOUT_MS', 180000)
    },
    get imageTimeoutMs(): number {
      return int('OLLAMA_IMAGE_TIMEOUT_MS', 600000)
    },
    /** Qwen3-14B ships a 40 960-token window; leave headroom under it. */
    get contextTokens(): number {
      return int('OLLAMA_CONTEXT_TOKENS', 16384)
    },
    get configured(): boolean {
      return has('OLLAMA_BASE_URL')
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

  /* ── Semantic retrieval · embeddings over the same Ollama daemon ─────────── */
  embeddings: {
    /**
     * The embedding model. Rides the Ollama daemon that already serves text, so
     * enabling semantic retrieval costs no new service, key or egress.
     */
    get model(): string {
      return str('EMBEDDING_MODEL', DEFAULT_EMBEDDING_MODEL)
    },
    /**
     * The vector width this model returns. Declared here for VALIDATION, not
     * configuration: `schema.sql` fixes the column at vector(768) because
     * pgvector needs a literal dimension for an HNSW index. A model returning
     * anything else is rejected at write time with both numbers named, rather
     * than allowed to fail later inside a distance operator.
     */
    get dimensions(): number {
      return int('EMBEDDING_DIMENSIONS', 768)
    },
    /** How many texts go in one request. Ollama accepts an array on /api/embed. */
    get batchSize(): number {
      return int('EMBEDDING_BATCH_SIZE', 16)
    },
    get timeoutMs(): number {
      return int('EMBEDDING_TIMEOUT_MS', 120000)
    },
    /**
     * Whether semantic retrieval is on. Defaults to on WHEN a daemon exists,
     * because the embedder is the same daemon the text model already uses — but
     * `EMBEDDINGS_ENABLED=false` turns it off without unsetting OLLAMA_BASE_URL,
     * which is what you want to isolate a retrieval problem.
     */
    get enabled(): boolean {
      return flag('EMBEDDINGS_ENABLED', true)
    },
    get configured(): boolean {
      return this.enabled && has('OLLAMA_BASE_URL')
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

  /* ── Scraping · Apify ───────────────────────────────────────────────────── */
  apify: {
    /**
     * Hosted capture for the four platform lanes. Unlike crawl4ai — which reads
     * whatever a search engine indexed and therefore cannot state a reaction
     * count — an actor reads the platform itself and returns real engagement.
     * That is the whole reason this adapter exists: three of the four trend
     * components are engagement maths, and they are inert without it.
     *
     * The open web has no actor and stays on crawl4ai. See `capture.ts`.
     */
    get token(): string {
      return str('APIFY_API_TOKEN')
    },
    get baseUrl(): string {
      return str('APIFY_BASE_URL', 'https://api.apify.com/v2')
    },
    /**
     * One actor per lane, each env-overridable, because an actor is a
     * third-party artefact that can be deprecated or repriced without notice.
     * Swapping one must be a config change, never a code change — which is why
     * the request bodies are built per actor family in `apify.ts`.
     */
    get postsActor(): string {
      return str('APIFY_LINKEDIN_POSTS_ACTOR', 'harvestapi~linkedin-post-search')
    },
    get instagramActor(): string {
      return str('APIFY_INSTAGRAM_ACTOR', 'apify~instagram-hashtag-scraper')
    },
    get xActor(): string {
      return str('APIFY_X_ACTOR', 'apidojo~tweet-scraper')
    },
    get facebookActor(): string {
      return str('APIFY_FACEBOOK_ACTOR', 'scraper_one~facebook-posts-search')
    },
    get runTimeoutMs(): number {
      return int('APIFY_RUN_TIMEOUT_MS', 180000)
    },
    /**
     * The ceiling the operator's knob cannot exceed. Actors bill per result, so
     * a slider in Agent Studio must not be able to run up a bill beyond what the
     * deployment allows — the knob asks, this decides.
     */
    get maxItemsPerKeyword(): number {
      return int('APIFY_MAX_ITEMS_PER_KEYWORD', 50)
    },
    get memoryMbytes(): number {
      return int('APIFY_MEMORY_MBYTES', 1024)
    },
    get configured(): boolean {
      return has('APIFY_API_TOKEN')
    },
  },

  /* ── Scraping · crawl4ai ────────────────────────────────────────────────── */
  crawl4ai: {
    /**
     * crawl4ai runs as a Python sidecar rather than a service, because the
     * browser it drives is a local process, not an endpoint. The script is
     * addressed by interpreter + path for the same reason the agent bridge is
     * (`api.ts`): the process boundary is the interface.
     */
    get python(): string {
      return str('CRAWL4AI_PYTHON')
    },
    /** Where a keyword search starts. Comma-separated, resolved at call time. */
    get searchEngines(): string[] {
      return str('CRAWL4AI_SEARCH_ENGINES', 'duckduckgo,bing')
        .split(',')
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s !== '')
    },
    get maxPagesPerKeyword(): number {
      return int('CRAWL4AI_MAX_PAGES_PER_KEYWORD', 8)
    },
    get maxCharsPerPage(): number {
      return int('CRAWL4AI_MAX_CHARS_PER_PAGE', 6000)
    },
    get timeoutMs(): number {
      return int('CRAWL4AI_TIMEOUT_MS', 180000)
    },
    /** Politeness. A scraper that hammers a host is a scraper that gets blocked. */
    get delayMs(): number {
      return int('CRAWL4AI_DELAY_MS', 400)
    },
    get headless(): boolean {
      return flag('CRAWL4AI_HEADLESS', true)
    },
    get configured(): boolean {
      return has('CRAWL4AI_PYTHON')
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
  ollama: IntegrationStatus & { textModel: string; imageModel: string }
  embeddings: IntegrationStatus & { model: string; dimensions: number }
  mflux: IntegrationStatus & { model: string }
  crawl4ai: IntegrationStatus
  apify: IntegrationStatus & { platformLanes: 'apify' | 'crawl4ai' }
  zImage: IntegrationStatus
  text: IntegrationStatus & {
    provider: TextProvider
    resolved: 'ollama' | 'gcp' | 'template'
    /** The ordered providers that will be tried, primary first. */
    chain: Array<'ollama' | 'gcp'>
    /** The provider standing behind the primary, or `null` when there is none. */
    backup: 'ollama' | 'gcp' | null
  }
  assistant: IntegrationStatus & { provider: AssistantProvider }
} {
  const gcpConfigured = config.gcp.configured
  const ollamaConfigured = config.ollama.configured

  /*
   * THE ORDERED PROVIDERS, mirroring `textChain()` exactly.
   *
   * Reported rather than inferred, because "which model wrote this" is the
   * first question an operator asks about a caption — and with a chain the
   * answer is no longer a single name. A named provider that is unreachable now
   * degrades to the OTHER vendor before it degrades to the template writer, so
   * reporting only the preference would describe a path that is not taken.
   */
  const preferred: 'ollama' | 'gcp' =
    config.textProvider === 'gcp'
      ? 'gcp'
      : config.textProvider === 'ollama'
        ? 'ollama'
        : ollamaConfigured
          ? 'ollama'
          : 'gcp'

  const configuredFor = { ollama: ollamaConfigured, gcp: gcpConfigured }
  const backupName: 'ollama' | 'gcp' = preferred === 'ollama' ? 'gcp' : 'ollama'

  const chain: Array<'ollama' | 'gcp'> = []
  if (configuredFor[preferred]) chain.push(preferred)
  if (configuredFor[backupName]) chain.push(backupName)

  // Derived from the same two booleans as `chain` rather than read off its
  // first element, which would narrow the union and lose 'template'.
  const resolved: 'ollama' | 'gcp' | 'template' = configuredFor[preferred]
    ? preferred
    : configuredFor[backupName]
      ? backupName
      : 'template'

  // A backup exists only when the primary is also configured. When the
  // preferred provider is absent the other one IS the primary, and naming it a
  // backup would report a degradation that did not happen.
  const backup: 'ollama' | 'gcp' | null =
    configuredFor[preferred] && configuredFor[backupName] ? backupName : null

  const assistantProvider = config.assistant.provider
  const assistantConfigured =
    (assistantProvider === 'gcp' && gcpConfigured) ||
    (assistantProvider === 'ollama' && ollamaConfigured)

  return {
    parallel: statusFor(config.parallel.configured, 'PARALLEL_API_KEY'),
    gcp: statusFor(gcpConfigured, 'GCP_API_KEY'),
    ollama: {
      ...statusFor(ollamaConfigured, 'OLLAMA_BASE_URL'),
      textModel: config.ollama.textModel,
      imageModel: config.ollama.imageModel,
    },
    embeddings: {
      configured: config.embeddings.configured,
      reason: config.embeddings.configured
        ? `Semantic retrieval on — ${config.embeddings.model} (${config.embeddings.dimensions} dims) on ${config.ollama.baseUrl}`
        : config.embeddings.enabled
          ? 'OLLAMA_BASE_URL is not set, so nothing can embed — retrieval is lexical only'
          : 'EMBEDDINGS_ENABLED is false — retrieval is lexical only',
      model: config.embeddings.model,
      dimensions: config.embeddings.dimensions,
    },
    mflux: {
      ...statusFor(config.mflux.configured, 'MFLUX_PYTHON'),
      model: config.mflux.model,
    },
    crawl4ai: statusFor(config.crawl4ai.configured, 'CRAWL4AI_PYTHON'),
    apify: {
      ...statusFor(config.apify.configured, 'APIFY_API_TOKEN'),
      // Which implementation the four platform lanes will actually bind, for
      // the same reason `text.resolved` is reported: an operator should not
      // have to work out the precedence, and "why does this post have no
      // reaction count" is answered here rather than on the card.
      platformLanes: config.apify.configured ? 'apify' : 'crawl4ai',
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
          : [
              resolved === 'ollama'
                ? `Local model — ${config.ollama.textModel} on ${config.ollama.baseUrl}`
                : `Hosted model — ${config.gcp.textModel}`,
              // The backup is stated whenever there is one, because a chain of
              // two degrades differently from a chain of one and an operator
              // reading this should not have to work that out.
              backup === null
                ? 'no second provider is configured, so a failure here falls straight to the template writer'
                : backup === 'ollama'
                  ? `backed by the local model ${config.ollama.textModel} if it fails`
                  : `backed by the hosted model ${config.gcp.textModel} if it fails`,
            ].join(', '),
    },
    assistant: {
      provider: assistantProvider,
      configured: assistantConfigured,
      reason:
        assistantProvider === 'deterministic'
          ? 'ASSISTANT_MODEL_PROVIDER is not set to gcp or ollama — running on the deterministic parser and template narrator'
          : assistantConfigured
            ? 'Configured'
            : `ASSISTANT_MODEL_PROVIDER is ${assistantProvider} but ${
                assistantProvider === 'ollama' ? 'OLLAMA_BASE_URL' : 'GCP_API_KEY'
              } is not set — falling back to the deterministic parser`,
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
    `text        ${s.text.resolved}${s.text.resolved === 'template' ? '' : ` · ${s.text.resolved === 'ollama' ? config.ollama.textModel : config.gcp.textModel}`}`,
    `ollama      ${s.ollama.configured ? `live · ${config.ollama.baseUrl}` : 'not configured'}`,
    `mflux       ${s.mflux.configured ? `live · ${s.mflux.model}` : 'not configured'}`,
    `crawl4ai    ${s.crawl4ai.configured ? 'live' : 'NOT CONFIGURED — the open-web lane cannot be scraped'}`,
    `apify       ${s.apify.configured ? 'live · platform lanes carry engagement' : 'not configured — platform lanes fall back to crawl4ai, without engagement figures'}`,
    `parallel    ${s.parallel.configured ? 'live' : 'not configured'}`,
    `gcp         ${s.gcp.configured ? 'live' : 'template writer'}`,
    `z-image     ${s.zImage.configured ? 'live' : 'not configured'}`,
  ]
}

/** Strips the password from a connection string before it is logged. */
export function redactUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••@')
}

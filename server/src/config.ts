/**
 * The one typed accessor for environment configuration.
 *
 * Every value is read LAZILY, at call time — never captured at import time.
 * That is what lets an adapter answer `isConfigured()` honestly after the
 * process has started, and what makes the whole product explorable with a
 * completely empty `.env`.
 */

import { config as loadDotenv } from 'dotenv'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = dirname(fileURLToPath(import.meta.url))
const SERVER_ROOT = join(HERE, '..')

// Load server/.env if present. Absent is a supported, first-class state.
const envPath = join(SERVER_ROOT, '.env')
if (existsSync(envPath)) {
  loadDotenv({ path: envPath, quiet: true })
} else {
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

export const config = {
  /* ── Core ───────────────────────────────────────────────────────────────── */
  core: {
    get databaseUrl(): string {
      return str('DATABASE_URL', 'postgresql://ethara:ethara@localhost:5432/ethara_sma')
    },
    get port(): number {
      return int('PORT', 4000)
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

  /* ── Scraping · Apify ───────────────────────────────────────────────────── */
  apify: {
    get token(): string {
      return str('APIFY_API_TOKEN')
    },
    get baseUrl(): string {
      return str('APIFY_BASE_URL', 'https://api.apify.com/v2')
    },
    get postsActor(): string {
      return str('APIFY_LINKEDIN_POSTS_ACTOR', 'harvestapi~linkedin-post-search')
    },
    get hashtagActor(): string {
      return str('APIFY_LINKEDIN_HASHTAG_ACTOR', 'harvestapi~linkedin-post-search')
    },
    get profileActor(): string {
      return str('APIFY_LINKEDIN_PROFILE_ACTOR', 'harvestapi~linkedin-company-posts')
    },
    get runTimeoutMs(): number {
      return int('APIFY_RUN_TIMEOUT_MS', 180000)
    },
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
      return str('GCP_TEXT_MODEL', 'gemini-2.5-pro')
    },
    get fastTextModel(): string {
      return str('GCP_FAST_TEXT_MODEL', 'gemini-2.5-flash')
    },
    get imageModel(): string {
      return str('GCP_IMAGE_MODEL', 'imagen-4.0-generate-001')
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
  apify: IntegrationStatus
  parallel: IntegrationStatus
  gcp: IntegrationStatus
  zImage: IntegrationStatus
  assistant: IntegrationStatus & { provider: AssistantProvider }
} {
  const gcpConfigured = config.gcp.configured
  const assistantGcp = config.assistant.provider === 'gcp'
  return {
    apify: statusFor(config.apify.configured, 'APIFY_API_TOKEN'),
    parallel: statusFor(config.parallel.configured, 'PARALLEL_API_KEY'),
    gcp: statusFor(gcpConfigured, 'GCP_API_KEY'),
    zImage: statusFor(config.zImage.configured, 'Z_IMAGE_ENDPOINT'),
    assistant: {
      provider: config.assistant.provider,
      configured: assistantGcp && gcpConfigured,
      reason: !assistantGcp
        ? 'ASSISTANT_MODEL_PROVIDER is not set to gcp — running on the deterministic parser and template narrator'
        : gcpConfigured
          ? 'Configured'
          : 'ASSISTANT_MODEL_PROVIDER is gcp but GCP_API_KEY is not set — falling back to the deterministic parser',
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
    `database    ${redactUrl(config.core.databaseUrl)}`,
    `workspace   ${config.core.workspaceSlug}`,
    `publish     ${config.core.publishMode}`,
    `timezone    ${config.core.tz}`,
    `assistant      ${s.assistant.provider}${s.assistant.configured ? '' : ' (deterministic fallback)'}`,
    `apify       ${s.apify.configured ? 'live' : 'fixtures'}`,
    `parallel    ${s.parallel.configured ? 'live' : 'fixtures'}`,
    `gcp         ${s.gcp.configured ? 'live' : 'template writer'}`,
    `z-image     ${s.zImage.configured ? 'live' : 'not configured'}`,
  ]
}

/** Strips the password from a connection string before it is logged. */
export function redactUrl(url: string): string {
  return url.replace(/:\/\/([^:]+):([^@]+)@/, '://$1:••••@')
}

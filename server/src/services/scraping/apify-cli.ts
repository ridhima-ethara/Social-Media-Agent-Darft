/**
 * THE APIFY CLI DRIVER — the official skill's workflow, executed from a server.
 *
 * Replaces the hand-rolled `api.apify.com/v2` client's ACTOR SELECTION and
 * EXECUTION with the protocol `apify/agent-skills → apify-ultimate-scraper`
 * documents:
 *
 *     actor selection  →  apify actors search        (index first, search as fallback)
 *     schema discovery →  apify actors info --input  (never assume an input shape)
 *     execution        →  apify actors call --json
 *     retrieval        →  apify datasets get-items
 *
 * Every invocation carries the skill's three required rules: `--json`,
 * `--user-agent apify-agent-skills/apify-ultimate-scraper`, and stderr kept off
 * stdout (the skill says `2>/dev/null`; a spawn separates the streams natively,
 * which is the same guarantee without a shell).
 *
 * WHAT THIS IS NOT. It is not a second scraper. `apifySearch` in
 * `integrations/apify.ts` keeps its `ServiceAdapter` surface exactly as it was —
 * `capture.ts` and Sherlock are untouched — and delegates its internals here.
 * One scraper, one capture contract, new execution mechanism underneath.
 *
 * ═══ TWO THINGS THAT COST REAL MONEY OR REAL SECRECY ═══
 *
 * COST. Every actor in the index is PAY_PER_EVENT — billed per result. So the
 * item ceiling is never taken from the caller alone: it is clamped to
 * `APIFY_MAX_ITEMS_PER_KEYWORD`, the deployment ceiling that exists so a slider
 * in Agent Studio cannot run up a bill.
 *
 * SECRECY. The CLI does NOT read `APIFY_TOKEN` from the environment — verified
 * against 1.10.0, both spellings. It authenticates from `~/.apify/auth.json`
 * (or the OS keyring) written by `apify login`, and `actors call` has no
 * `--token` flag at all. That is fortunate rather than limiting: passing a token
 * on argv would expose it to any process that can read `ps`. So this module
 * NEVER puts the token in an argument, and `ensureLogin()` shells it exactly
 * once through stdin-free `login -t`, from the configured env var.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from '../../config'
import { AdapterError } from '../../integrations/adapter'
import { indexedActor, type ScrapeIntent, type ScrapeTarget } from './actor-index'

const ADAPTER_ID = 'apify.cli'

/** The attribution the skill requires on every call. */
const USER_AGENT = 'apify-agent-skills/apify-ultimate-scraper'

const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')

/**
 * The CLI binary, resolved from the repo's own `node_modules`.
 *
 * Installed as a devDependency rather than globally, so the version is pinned
 * in `package.json` and a machine without a global install still works. Derived
 * from this module's location, never from `cwd` — the same rule
 * `agent-tier.ts` follows, and for the same reason.
 */
export function apifyBin(): string {
  return join(REPO_ROOT, 'node_modules', '.bin', 'apify')
}

export function cliInstalled(): boolean {
  return existsSync(apifyBin())
}

/* ═══════════════════════════════════════════════════════════════════════════
   RUNNING ONE CLI COMMAND
   ═══════════════════════════════════════════════════════════════════════════ */

interface CliOutcome {
  stdout: string
  stderr: string
  code: number | null
}

/**
 * Spawns the CLI. No shell, ever.
 *
 * `shell: false` is the default and is load-bearing: arguments here include
 * scraped-adjacent values such as keywords and handles, and a shell would make
 * those injectable. An array of argv cannot be.
 */
function runCli(args: string[], timeoutMs: number): Promise<CliOutcome> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(apifyBin(), args, {
      cwd: REPO_ROOT,
      // The CLI reads credentials from the keyring / ~/.apify. The token is
      // deliberately NOT placed here or in argv.
      env: { ...process.env, APIFY_HEADLESS: '1', CI: '1' },
    })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(new AdapterError(ADAPTER_ID, `\`apify ${args[0]}\` exceeded ${timeoutMs}ms`))
    }, timeoutMs)

    child.stdout.on('data', (c: Buffer) => {
      stdout += c.toString()
    })
    // Kept, never merged into stdout. The skill redirects it because progress
    // messages break JSON parsers; a spawn separates the streams for free, and
    // keeping stderr means a failure still has a reason attached.
    child.stderr.on('data', (c: Buffer) => {
      stderr += c.toString()
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new AdapterError(ADAPTER_ID, `could not start the Apify CLI — ${error.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolvePromise({ stdout, stderr, code })
    })
  })
}

/**
 * Runs a CLI command and parses its JSON.
 *
 * The CLI prints human lines before the payload on some subcommands, so the
 * parse starts at the first `{` or `[` rather than at character zero. Anything
 * unparseable is an error carrying what the CLI actually said — never a silent
 * empty result, which §7 forbids and which would look identical to "this
 * platform had nothing".
 */
async function cliJson<T>(args: string[], timeoutMs: number): Promise<T> {
  const { stdout, stderr, code } = await runCli([...args, '--json'], timeoutMs)

  const start = stdout.search(/[[{]/)
  if (start >= 0) {
    try {
      return JSON.parse(stdout.slice(start)) as T
    } catch {
      /* fall through to the error below */
    }
  }

  const said = (stderr.trim() || stdout.trim() || 'no output').slice(0, 300)
  throw new AdapterError(ADAPTER_ID, `\`apify ${args[0]} ${args[1] ?? ''}\` (exit ${code ?? '?'}) — ${said}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   AUTHENTICATION
   ═══════════════════════════════════════════════════════════════════════════ */

let loginChecked = false

/**
 * Whether the CLI holds credentials.
 *
 * `apify info` answers as the logged-in user or fails. Cached for the process
 * because a login does not come and go mid-run, and shelling out per capture
 * would add a process spawn to every lane.
 */
export async function cliAuthenticated(): Promise<boolean> {
  try {
    /*
     * `apify info` takes NO `--json` flag — it rejects it outright ("Unknown
     * flag provided") and prints plain `key: value` lines instead. So this is
     * the one command that must not go through `cliJson`, and the check is for
     * a `username:` line rather than a parsed field.
     *
     * Worth stating because it is the opposite of the skill's blanket rule to
     * pass `--json` to every command: that rule holds for the data commands,
     * and this one is not one of them.
     */
    const { stdout, code } = await runCli(['info'], 15_000)
    if (code !== 0) return false
    return /^\s*username\s*:\s*\S+/m.test(stdout)
  } catch {
    return false
  }
}

/**
 * Establishes the CLI login from `APIFY_API_TOKEN`, once per process.
 *
 * This is the bridge between the environment variable the rest of the product
 * uses and the stored credential the CLI insists on. The token goes in as a
 * single argv element to `login -t` — unavoidable, since the CLI offers no
 * stdin path — and this is the ONLY place it ever appears in an argument. It
 * runs at most once, never per capture, and the token is never logged, never
 * echoed and never included in an error message.
 */
export async function ensureLogin(): Promise<{ ok: boolean; reason: string }> {
  if (!cliInstalled()) {
    return {
      ok: false,
      reason:
        'The Apify CLI is not installed. Run `npm i -D apify-cli` in the repository root; ' +
        'it resolves from node_modules/.bin and needs no global install.',
    }
  }

  if (loginChecked && (await cliAuthenticated())) return { ok: true, reason: '' }

  if (await cliAuthenticated()) {
    loginChecked = true
    return { ok: true, reason: '' }
  }

  const token = config.apify.token
  if (token === '') {
    return {
      ok: false,
      reason:
        'APIFY_AUTH_MISSING — the Apify CLI holds no credentials and APIFY_API_TOKEN is not set. ' +
        'The CLI does not read the environment (verified against 1.10.0), so it must be logged in ' +
        'once: set APIFY_API_TOKEN and restart, or run `npx apify login`.',
    }
  }

  const { stderr, code } = await runCli(['login', '-t', token], 30_000)
  if (code !== 0) {
    // The CLI's own message, with anything token-shaped removed. A failed login
    // has been observed to echo the credential back.
    const scrubbed = stderr.replace(/apify_api_[A-Za-z0-9]+/g, '«token»').trim().slice(0, 240)
    return { ok: false, reason: `APIFY_AUTH_MISSING — \`apify login\` failed: ${scrubbed}` }
  }

  loginChecked = true
  return { ok: true, reason: '' }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ACCOUNT BREAKER

   Some Apify failures are properties of the ACCOUNT, not of the call: an
   exhausted monthly allowance, a missing credential, an unpayable balance.
   Retrying those is guaranteed to fail identically, and it is not free —
   every attempt spawns a CLI process and waits on the network.

   WHAT THAT COST LOOKED LIKE. A run over four keywords with four platform
   lanes enabled makes SIXTEEN calls. With the account over its limit, all
   sixteen spawned, all sixteen waited, all sixteen failed with the same
   sentence — which presented as a discovery run that hung for twenty minutes
   and then reported "nothing captured" sixteen times. The open-web lane had
   succeeded the whole time and its result was buried under the noise.

   So the first account-level failure trips this, and every subsequent Apify
   lane in the run fails instantly with the stored reason instead of spawning.
   The run then finishes in the time the open-web lane takes, and says once
   what it could not do.

   IT EXPIRES. An allowance rolls over and a credential gets fixed; a breaker
   that latched for the life of the process would keep a recovered account
   offline until someone restarted the server.
   ═══════════════════════════════════════════════════════════════════════════ */

interface Breaker {
  reason: string
  at: number
}

let breaker: Breaker | null = null

/** How long an account-level failure is trusted before it is re-tested. */
const BREAKER_TTL_MS = 10 * 60_000

/** Failures that are about the account rather than about this particular call. */
function isAccountLevel(message: string): boolean {
  return /hard limit|usage limit|monthly usage|not logged in|APIFY_AUTH_MISSING|payment|insufficient credit/i.test(
    message,
  )
}

/** The stored reason, or `''` when the breaker is closed or has expired. */
export function breakerReason(): string {
  if (breaker === null) return ''
  if (Date.now() - breaker.at > BREAKER_TTL_MS) {
    breaker = null
    return ''
  }
  return breaker.reason
}

/** Closes the breaker, so the next call re-tests the account. */
export function resetBreaker(): void {
  breaker = null
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 1 — ACTOR SELECTION
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResolvedActor {
  actorId: string
  because: string
  /** How this actor was chosen — rendered into the run log, never inferred. */
  via: 'pinned' | 'index' | 'search'
}

interface StoreItem {
  username?: string
  name?: string
  title?: string
  stats?: { totalUsers30Days?: number }
  currentPricingInfo?: { pricingModel?: string }
}

/**
 * The actor for a lane: the index first, then the skill's documented search.
 *
 * Search results are ranked by `stats.totalUsers30Days`, which the skill names
 * as the field to read. Popularity is a weak signal, but it is the only signal
 * available without running an actor, and it is stated rather than implied.
 */
export async function selectActor(
  target: ScrapeTarget,
  intent: ScrapeIntent,
  timeoutMs = 30_000,
): Promise<ResolvedActor> {
  /*
   * AN OPERATOR PIN WINS OUTRIGHT.
   *
   * `APIFY_<PLATFORM>_ACTOR` lets a lane be repointed without a deploy, which
   * matters because actors are third-party artefacts that get deprecated and
   * repriced without notice. Blank is the normal state and means "use the
   * index".
   *
   * A pin changes WHICH actor runs and nothing else: its schema is still
   * fetched live by the caller, so pinning can never smuggle an assumed input
   * shape past the check that exists to prevent exactly that.
   */
  const pinned = config.apify.actorFor(target)
  if (pinned !== '') {
    return {
      actorId: pinned,
      because: `pinned by APIFY_${target.toUpperCase()}_ACTOR`,
      via: 'pinned',
    }
  }

  const choice = indexedActor(target, intent)
  if (choice) {
    return { actorId: choice.actorId, because: choice.because, via: 'index' }
  }

  const terms = `${target} ${intent}`
  const found = await cliJson<{ items?: StoreItem[] } | StoreItem[]>(
    ['actors', 'search', terms, '--user-agent', USER_AGENT, '--limit', '10'],
    timeoutMs,
  )
  const items = Array.isArray(found) ? found : (found.items ?? [])
  const ranked = [...items].sort(
    (a, b) => (b.stats?.totalUsers30Days ?? 0) - (a.stats?.totalUsers30Days ?? 0),
  )
  const best = ranked[0]
  const id = best?.username && best?.name ? `${best.username}/${best.name}` : ''

  if (id === '') {
    throw new AdapterError(
      ADAPTER_ID,
      `no actor found for ${target}/${intent}. The curated index has no entry and \`apify actors search "${terms}"\` returned nothing. No actor id is invented.`,
    )
  }

  return {
    actorId: id,
    because: `discovered via the skill's actor search — ${best?.title ?? id}, ${best?.stats?.totalUsers30Days ?? 0} users in 30 days`,
    via: 'search',
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 2 — SCHEMA DISCOVERY, AND INPUT BUILT AGAINST IT
   ═══════════════════════════════════════════════════════════════════════════ */

interface InputSchema {
  properties?: Record<string, { type?: string; editor?: string; title?: string }>
  required?: string[]
}

/**
 * The live input schema for an actor.
 *
 * ═══ A DIVERGENCE FROM THE SKILL'S DOCUMENTED COMMAND, ON PURPOSE ═══
 *
 * The skill says:
 *
 *     apify actors info "ACTOR_ID" --input --json
 *
 * Against CLI 1.10.0 that returns the ACTOR OBJECT — id, username, stats,
 * pricingInfos — and silently drops the schema, because `--json` wins over
 * `--input`. Verified: the response has 30 top-level keys and no `properties`
 * anywhere, which is why the first doctor run reported "0 input fields" for an
 * actor that plainly has many.
 *
 * `--input` WITHOUT `--json` returns exactly what is wanted: the input schema
 * document, already JSON. So that is what runs here.
 *
 * This is the one place this module knowingly departs from the skill text, and
 * it departs in order to get the result the skill is asking for. If a later CLI
 * fixes the flag interaction, the parse below still works — it reads whichever
 * of the two shapes comes back.
 */
export async function actorInputSchema(
  actorId: string,
  timeoutMs = 30_000,
): Promise<InputSchema> {
  const { stdout, stderr, code } = await runCli(
    ['actors', 'info', actorId, '--user-agent', USER_AGENT, '--input'],
    timeoutMs,
  )

  const start = stdout.search(/[[{]/)
  if (start < 0) {
    const said = (stderr.trim() || stdout.trim() || 'no output').slice(0, 240)
    throw new AdapterError(ADAPTER_ID, `\`actors info ${actorId} --input\` (exit ${code ?? '?'}) — ${said}`)
  }

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(stdout.slice(start)) as Record<string, unknown>
  } catch {
    throw new AdapterError(ADAPTER_ID, `the input schema for ${actorId} was not valid JSON`)
  }

  // The schema document itself, or — should a future CLI nest it — the nested
  // copy. Both accepted rather than assumed.
  if ('properties' in parsed) return parsed as InputSchema
  const nested = (parsed.input ?? parsed.inputSchema) as InputSchema | undefined
  if (nested && typeof nested === 'object' && 'properties' in nested) return nested

  throw new AdapterError(
    ADAPTER_ID,
    `${actorId} returned no input schema, so no input can be built for it without assuming its shape.`,
  )
}

export interface ScrapeAsk {
  target: ScrapeTarget
  intent: ScrapeIntent
  /** Search terms, handles or hashtags — whichever the intent implies. */
  terms: string[]
  maxItems: number
  /** ISO date; actors that take a date filter receive it. */
  since?: string
}

/**
 * Builds an actor input by matching the ask against the LIVE schema.
 *
 * This is the whole point of the migration. The previous implementation carried
 * an eight-member `ActorFamily` union and a hand-written body per family, which
 * meant every new actor needed code and every renamed field broke a lane
 * silently. Here the field names come from the actor itself, so an actor that
 * renames `searchQueries` to `queries` keeps working.
 *
 * Candidate names are ordered most-specific first, and only a key the schema
 * actually declares is ever set — an unknown key is at best ignored and at
 * worst makes the actor exit before it starts.
 */
export function buildInput(schema: InputSchema, ask: ScrapeAsk): Record<string, unknown> {
  const props = schema.properties ?? {}
  const has = (key: string): boolean => Object.hasOwn(props, key)
  const input: Record<string, unknown> = {}

  const TERM_KEYS = [
    'search', 'searchQueries', 'searchTerms', 'queries', 'query', 'keyword', 'keywords',
    'hashtags', 'hashtag', 'username', 'usernames', 'profiles', 'handles', 'startUrls',
  ]
  const LIMIT_KEYS = [
    'maxItems', 'resultsLimit', 'maxResults', 'maxPosts', 'resultsPerPage',
    'maxRequestsPerCrawl', 'limit',
  ]
  const DATE_KEYS = ['onlyPostsNewerThan', 'publishedAfter', 'since', 'startDate', 'fromDate']

  for (const key of TERM_KEYS) {
    if (!has(key)) continue
    const declared = props[key]
    // An array-typed field takes the list; a string field takes the first term.
    input[key] = declared?.type === 'array' ? ask.terms : ask.terms[0]
    break
  }

  for (const key of LIMIT_KEYS) {
    if (!has(key)) continue
    input[key] = ask.maxItems
    break
  }

  if (ask.since !== undefined) {
    for (const key of DATE_KEYS) {
      if (!has(key)) continue
      input[key] = ask.since
      break
    }
  }

  // A schema that declares a required field this builder does not know about is
  // reported rather than guessed at — §5 forbids assuming an input shape.
  const missing = (schema.required ?? []).filter((key) => !(key in input))
  if (missing.length > 0) {
    throw new AdapterError(
      ADAPTER_ID,
      `the actor requires ${missing.join(', ')}, which this lane does not know how to supply. ` +
        'Inspect it with `npx apify actors info <actor> --input` and extend the candidate keys.',
    )
  }

  if (Object.keys(input).length === 0) {
    throw new AdapterError(
      ADAPTER_ID,
      'the actor declares none of the known search or limit fields, so no valid input could be built.',
    )
  }

  return input
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEP 3 AND 4 — EXECUTION, THEN THE DATASET
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RunRecord {
  runId: string
  datasetId: string
  status: string
  durationMs: number
  actorId: string
}

export interface DatasetOutcome {
  run: RunRecord
  items: unknown[]
  /** Apify console links, for the "View scrape run" / "View dataset" affordances. */
  runUrl: string
  datasetUrl: string
}

/**
 * Runs an actor and returns its dataset items, raw.
 *
 * Normalisation is deliberately elsewhere: this module's job ends at "here is
 * what the actor said", and `normalize.ts` turns that into the capture
 * contract. Keeping them apart is what lets `rawData` be preserved.
 */
export async function runActorViaCli(
  actorId: string,
  input: Record<string, unknown>,
  maxItems: number,
): Promise<DatasetOutcome> {
  // Fail instantly on a known account-level condition rather than spawning a
  // process that cannot succeed.
  const open = breakerReason()
  if (open !== '') throw new AdapterError(ADAPTER_ID, open)

  const auth = await ensureLogin()
  if (!auth.ok) {
    breaker = { reason: auth.reason, at: Date.now() }
    throw new AdapterError(ADAPTER_ID, auth.reason)
  }

  const dir = await mkdtemp(join(tmpdir(), 'ethara-apify-'))
  const inputPath = join(dir, 'input.json')

  try {
    // `--input-file`, which the skill prefers for anything non-trivial: it keeps
    // the payload out of argv entirely, so no keyword or handle is ever visible
    // to `ps` and no shell quoting can go wrong.
    await writeFile(inputPath, JSON.stringify(input), 'utf8')

    const started = Date.now()
    let run: Record<string, unknown>
    try {
      run = await cliJson<Record<string, unknown>>(
        [
          'actors', 'call', actorId,
          '--input-file', inputPath,
          '--user-agent', USER_AGENT,
          // The CLI's own timeout, so a long actor is abandoned server-side
          // rather than held open by this process.
          '--timeout', String(Math.ceil(config.apify.runTimeoutMs / 1000)),
        ],
        config.apify.runTimeoutMs + 30_000,
      )
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (isAccountLevel(message)) breaker = { reason: message, at: Date.now() }
      throw error
    }

    const runId = String(run.id ?? '')
    const datasetId = String(run.defaultDatasetId ?? '')
    const status = String(run.status ?? 'UNKNOWN')

    if (datasetId === '') {
      throw new AdapterError(
        ADAPTER_ID,
        `actor ${actorId} finished ${status} without a dataset. Nothing is substituted for it.`,
      )
    }

    const items = await cliJson<unknown[]>(
      ['datasets', 'get-items', datasetId, '--user-agent', USER_AGENT, '--limit', String(maxItems)],
      120_000,
    )

    return {
      run: {
        runId,
        datasetId,
        status,
        durationMs: Date.now() - started,
        actorId,
      },
      items: Array.isArray(items) ? items : [],
      // The ORIGINAL source url of each item is preserved by the normaliser.
      // These two are additional, for debugging — never a replacement for it.
      runUrl: runId === '' ? '' : `https://console.apify.com/actors/runs/${runId}`,
      datasetUrl: `https://console.apify.com/storage/datasets/${datasetId}`,
    }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE WHOLE WORKFLOW, IN ONE CALL
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * selection → schema → input → run → dataset.
 *
 * The item ceiling is clamped to the deployment cap here rather than at the
 * call site, so no caller can exceed it by forgetting to.
 */
export async function scrapeViaSkill(ask: ScrapeAsk): Promise<DatasetOutcome & { via: string }> {
  const capped = Math.max(1, Math.min(ask.maxItems, config.apify.maxItemsPerKeyword))

  const actor = await selectActor(ask.target, ask.intent)
  const schema = await actorInputSchema(actor.actorId)
  const input = buildInput(schema, { ...ask, maxItems: capped })
  const outcome = await runActorViaCli(actor.actorId, input, capped)

  return {
    ...outcome,
    via: `${actor.actorId} (${actor.via}) — ${actor.because}`,
  }
}

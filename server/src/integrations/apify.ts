/**
 * APIFY — platform capture, executed through the official agent skill.
 *
 * WHAT THIS FILE IS NOW. A thin adapter. It holds the `ServiceAdapter` surface
 * that `capture.ts` and Sherlock bind to, and nothing else: actor selection,
 * schema discovery, execution and dataset retrieval all live in
 * `services/scraping/apify-cli.ts`, following the protocol that
 * `apify/agent-skills → apify-ultimate-scraper` documents.
 *
 * WHAT IT NO LONGER IS. It used to be a hand-written `api.apify.com/v2` client:
 * ~780 lines carrying an eight-member `ActorFamily` union, a request body built
 * by hand per family, one hardcoded actor per platform, a sync→async→poll run
 * loop, and its own tolerant field readers. All of it is gone. That code had
 * two defects the skill workflow does not:
 *
 *   · ONE ACTOR PER PLATFORM, FIXED. `actorFor('instagram')` always returned
 *     the hashtag scraper, so capturing an account meant capturing the wrong
 *     thing. Selection is now per (platform, intent).
 *   · INPUT SHAPES ASSUMED, NOT READ. A family's body was written by hand from
 *     an actor's docs, so an author renaming `searchQueries` to `queries` broke
 *     a lane silently — it kept returning zero items and looked like a quiet
 *     week. Input is now built against the schema the actor itself reports.
 *
 * ═══ THERE IS NO HTTP FALLBACK, DELIBERATELY ═══
 *
 * An earlier revision kept the API client behind the CLI as a backup. That was
 * the wrong shape: two execution paths reading the same actors is the "second
 * scraper" the brief forbids, and which one ran was decided by whichever failed
 * first — so two runs could differ in ways no log explained.
 *
 * The CLI is the only path. When it cannot serve, the lane reports what it
 * could not do and captures nothing — the same standard every other lane here
 * is held to. Nothing is substituted and nothing is fabricated.
 *
 * APIFY IS STILL REQUIRED. The skill is a workflow, not a replacement for
 * Apify's infrastructure: the authentication, the actors and the datasets are
 * all still Apify's. What has been removed is our own API client, not the
 * vendor.
 */

import type { Platform, ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError } from './adapter'
import type { CaptureInput, RawPost } from './capture'
import { breakerReason, cliInstalled, ensureLogin, scrapeViaSkill } from '../services/scraping/apify-cli'
import { indexedActor } from '../services/scraping/actor-index'
import { normalizeDataset, toCaptureShape } from '../services/scraping/normalize'

/** What each lane calls itself on a captured row. */
const SOURCE_NAME: Record<Platform, string> = {
  linkedin: 'LinkedIn · Post Search',
  instagram: 'Instagram · Hashtag Search',
  x: 'X · Post Search',
  facebook: 'Facebook · Post Search',
}

const WINDOW_DAYS: Record<CaptureInput['datePosted'], number> = {
  'past-24h': 1,
  'past-week': 7,
  'past-month': 30,
}

/** The start of the recency window, for actors whose schema declares a date field. */
function windowStart(datePosted: CaptureInput['datePosted']): Date {
  const at = new Date()
  at.setDate(at.getDate() - WINDOW_DAYS[datePosted])
  return at
}

/* ═══════════════════════════════════════════════════════════════════════════
   WHY A LANE CANNOT RUN
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Two distinct unavailable states, because the fixes are different.
 *
 * Collapsing them into one "Apify is not configured" would send an operator to
 * regenerate a token that is already correct.
 */
function unavailable(): string {
  if (!cliInstalled()) {
    return (
      'The Apify CLI is not installed, and it is the only way the platform lanes run. ' +
      'Install it in the repository root with `npm i -D apify-cli` — it resolves from ' +
      'node_modules/.bin and needs no global install.'
    )
  }
  if (config.apify.token === '') {
    return (
      'APIFY_API_TOKEN is not set. The CLI needs it once to establish a stored login; ' +
      'put it in server/secrets.env (gitignored). Apify console → Settings → API & Integrations.'
    )
  }

  /*
   * AN ACCOUNT-LEVEL FAILURE MAKES THE LANE UNAVAILABLE, NOT MERELY UNLUCKY.
   *
   * Once the breaker is open, every platform lane reports itself unavailable
   * up front. That matters more than it sounds: the Scraping Agent checks
   * `isConfigured()` when it builds its lane list, so the four platform lanes
   * are dropped BEFORE any keyword is attempted rather than each failing
   * separately for every keyword. One stated reason on the run instead of
   * sixteen, and the open-web lane's result is legible instead of buried.
   *
   * The breaker expires, so an allowance that rolls over is picked up without
   * a restart.
   */
  const tripped = breakerReason()
  // Explained, not echoed. The breaker stores whatever the CLI said; an
  // operator reading "apify actors call (exit 1)" learns nothing they can act
  // on, and this is the string the run console shows for the whole lane.
  if (tripped !== '') return explainApifyFailure(new Error(tripped), 'the platform lanes')

  return ''
}

/* ═══════════════════════════════════════════════════════════════════════════
   EXPLAINING A FAILURE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Which actor a lane would use, for an error message.
 *
 * Selection is per-intent and can fall through to a live search, so this names
 * the INDEXED default rather than claiming to know what a future run will pick.
 */
export function actorLabelFor(platform: Platform | undefined): string {
  if (platform === undefined) return 'the open-web lane'
  return indexedActor(platform, 'keyword')?.actorId ?? platform
}

/**
 * Turns an Apify failure into a sentence naming the fix.
 *
 * Reads the CLI's stderr rather than an HTTP body now. The distinctions that
 * matter are unchanged and are the reason this exists: an exhausted account, a
 * missing credential and a withdrawn actor all look alike from the outside, and
 * they need three different actions.
 */
export function explainApifyFailure(error: unknown, actor: string): string {
  const raw = error instanceof Error ? error.message : String(error)
  // Defensive: a failed CLI login has been observed to echo the credential back.
  const said = raw.replace(/apify_api_[A-Za-z0-9]+/g, '«token»')

  if (/hard limit|usage limit|monthly usage/i.test(said)) {
    return (
      'Apify refused the run: the account has exceeded its monthly usage limit. This is an ' +
      'ACCOUNT limit, not a configuration problem — the token is valid and the actor exists. ' +
      'Every actor this product uses is priced per result, so runs draw on the plan’s monthly ' +
      'allowance. Check console.apify.com/billing: the usage cycle has to roll over, the hard ' +
      'limit has to be raised, or the plan has to be upgraded. Nothing in this repository can ' +
      'work around it, and no substitute source is used for the platform lanes.'
    )
  }

  if (/APIFY_AUTH_MISSING|not logged in|authentication/i.test(said)) {
    return (
      'The Apify CLI holds no credentials. It does not read APIFY_TOKEN from the environment ' +
      '(verified against CLI 1.10.0), so it must be logged in once. Set APIFY_API_TOKEN and ' +
      'restart — the server establishes the login itself — or run `npx apify login`.'
    )
  }

  if (/payment|insufficient credit/i.test(said)) {
    return `Apify requires payment for this run. "${actor}" is priced per result and the account cannot be charged.`
  }

  if (/not found|does not exist|404/i.test(said)) {
    return (
      `Apify has no actor "${actor}", or it is no longer published. Actors are third-party ` +
      'artefacts and their authors can rename or withdraw them. Check it with ' +
      `\`npx apify actors info ${actor}\`, and if it is gone the lane needs a replacement in ` +
      'server/src/services/scraping/actor-index.ts.'
    )
  }

  if (/rate limit|429|too many requests/i.test(said)) {
    return (
      'Apify rate-limited this run. Lower "Posts per keyword, per lane" or "Concurrent captures" ' +
      'on the capture skill, or space runs further apart.'
    )
  }

  if (/exceeded \d+ms|timed out/i.test(said)) {
    return (
      'The actor did not finish in time. Raise APIFY_RUN_TIMEOUT_MS, or lower the per-keyword ' +
      'item ceiling so the run has less to do.'
    )
  }

  return said
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ADAPTER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Keyword capture on one platform lane.
 *
 * The id, label and signature are unchanged from the HTTP implementation on
 * purpose: `capture.ts` routes to this by id and Sherlock reports `.label` on
 * every lane event, so neither can tell that the mechanism underneath changed.
 * That is the property that made replacing the mechanism possible at all.
 */
export const apifySearch: ServiceAdapter<CaptureInput, RawPost[]> = {
  id: 'apify.search',
  label: 'Apify · platform capture',

  isConfigured(): boolean {
    return unavailable() === ''
  },

  unavailableReason(): string {
    return unavailable()
  },

  async run(input: CaptureInput): Promise<RawPost[]> {
    const reason = unavailable()
    if (reason !== '') throw new AdapterError(this.id, reason)

    if (input.platform === undefined) {
      throw new AdapterError(
        this.id,
        'the open-web lane has no actor — it is captured by the research adapter',
      )
    }
    const platform = input.platform

    // Established once per process, from APIFY_API_TOKEN. The token never
    // reaches argv here, and never reaches a log anywhere.
    const auth = await ensureLogin()
    if (!auth.ok) throw new AdapterError(this.id, auth.reason)

    /*
     * selection → live schema → input → run → dataset.
     *
     * The item ceiling is clamped to APIFY_MAX_ITEMS_PER_KEYWORD inside
     * `scrapeViaSkill`, so a knob in Agent Studio cannot exceed what the
     * deployment allows. Actors bill per result.
     */
    const outcome = await scrapeViaSkill({
      target: platform,
      intent: 'keyword',
      terms: [input.keyword],
      maxItems: input.maxItems,
      since: windowStart(input.datePosted).toISOString(),
    })

    const { items, rejected } = normalizeDataset(outcome.items, {
      platform,
      sourceActor: outcome.run.actorId,
      apifyRunId: outcome.run.runId,
      apifyDatasetId: outcome.run.datasetId,
    })

    const posts = items.map((item) =>
      toCaptureShape(item, input.keyword, platform, SOURCE_NAME[platform]),
    )

    if (posts.length === 0) {
      /*
       * An empty live result and a broken actor are indistinguishable from the
       * caller's side, so this names the keyword, the lane and the actor that
       * produced nothing — and links the run, so the dataset can be opened.
       * Reporting a successful zero here is how a broken lane stays broken for
       * a month.
       */
      throw new AdapterError(
        this.id,
        `${outcome.via} returned ${outcome.items.length} row(s) for “${input.keyword}” on ${platform}` +
          (rejected > 0 ? `, ${rejected} of which carried neither text nor a URL` : '') +
          `. Run: ${outcome.runUrl}`,
      )
    }

    if (rejected > 0) {
      console.warn(
        `  · ${outcome.run.actorId}: ${rejected} dataset row(s) yielded neither text nor a URL and were not used`,
      )
    }

    return posts
  },
}

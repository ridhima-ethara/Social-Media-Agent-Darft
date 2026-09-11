/**
 * APIFY — hosted capture for the four platform lanes.
 *
 * WHY THIS EXISTS. crawl4ai reads what a search engine indexed, and an indexed
 * page states no reaction count. Three of the Validation Agent's four trend
 * components — engagement, velocity, growth — are engagement maths, so under a
 * search-only capture they compute over zeros and 75 of the 100 points of
 * `trend_score` go inert. An Apify actor reads the platform itself and returns
 * real counts. That is the entire argument for paying for this.
 *
 * ONE ACTOR PER LANE, SELECTED BY CONFIG. Actors are third-party artefacts that
 * get deprecated and repriced without notice, so every slug is an env-overridable
 * default and every request body is built per actor FAMILY rather than per
 * platform. Swapping an actor is a config change; adding a family is the only
 * thing that needs code.
 *
 * NO FIXTURES. The pre-crawl4ai version of this file fell back to a bundled
 * corpus when the token was blank. That corpus was deleted deliberately: an
 * empty lane is a real finding about that lane, and a plausible substitute for
 * it is fabricated evidence. A missing token means the lane reports what it
 * could not capture.
 */

import type { Platform, ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError, fetchJson } from './adapter'
import type { CaptureInput, RawPost } from './capture'

const UNAVAILABLE = 'APIFY_API_TOKEN is not set'

/* ═══════════════════════════════════════════════════════════════════════════
   TOLERANT FIELD READING

   Four actors from three vendors, none of whose field names are a contract we
   control. Every field is read through a list of candidate keys rather than
   assumed, so a vendor renaming `likesCount` to `likeCount` costs a key in a
   list instead of a broken run that reports zeros as measurements.
   ═══════════════════════════════════════════════════════════════════════════ */

interface LooseRecord {
  [key: string]: unknown
}

function str(row: LooseRecord, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return ''
}

function int(row: LooseRecord, ...keys: string[]): number {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
    if (typeof v === 'string') {
      const n = Number.parseInt(v.replace(/[^\d-]/g, ''), 10)
      if (Number.isFinite(n)) return n
    }
  }
  return 0
}

function nested(row: LooseRecord, path: string): unknown {
  let cursor: unknown = row
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as LooseRecord)[part]
  }
  return cursor
}

/** A nested integer, e.g. `engagement.likes`. Zero when absent, so callers can `||` a flat fallback. */
function nestedInt(row: LooseRecord, path: string): number {
  const v = nested(row, path)
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const n = Number.parseInt(v.replace(/[^\d-]/g, ''), 10)
    if (Number.isFinite(n)) return n
  }
  return 0
}

/**
 * Whether ANY of these keys or dotted paths exists on the row at all.
 *
 * This is the difference between "the source said zero" and "the source said
 * nothing", and it is why `metricsAvailable` can no longer be a constant. One of
 * the four configured actors returns `stats.total_reactions`, another returns
 * flat `likesCount`, and a third returns no engagement keys whatsoever — and
 * stamping that third one as measured would put three fabricated zeros into the
 * engagement, velocity and growth components of the trend score. A key present
 * with the value 0 IS a measurement and counts as present; a key that is absent
 * does not.
 */
function statesAny(row: LooseRecord, ...keys: string[]): boolean {
  for (const key of keys) {
    const value = key.includes('.') ? nested(row, key) : row[key]
    if (value === undefined || value === null) continue
    if (typeof value === 'number' && Number.isFinite(value)) return true
    if (typeof value === 'string' && value.trim() !== '') return true
  }
  return false
}

function nestedStr(row: LooseRecord, ...paths: string[]): string {
  for (const path of paths) {
    const v = nested(row, path)
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number') return String(v)
  }
  return ''
}

function extractHashtagsFromText(text: string): string[] {
  const matches = text.match(/#[\p{L}\p{N}_]+/gu)
  if (!matches) return []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of matches) {
    const tag = raw.slice(1)
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   NORMALISATION
   ═══════════════════════════════════════════════════════════════════════════ */

const SOURCE_NAME: Record<Platform, string> = {
  linkedin: 'LinkedIn · Post Search',
  instagram: 'Instagram · Hashtag Search',
  x: 'X · Post Search',
  facebook: 'Facebook · Post Search',
}

const POST_URL_BASE: Record<Platform, (id: string) => string> = {
  linkedin: (id) => `https://www.linkedin.com/feed/update/${id}`,
  instagram: (id) => `https://www.instagram.com/p/${id}/`,
  x: (id) => `https://x.com/i/status/${id}`,
  facebook: (id) => `https://www.facebook.com/${id}`,
}

/**
 * Normalises one dataset item into the shape the pipeline consumes.
 * Returns null when the item cannot yield both an id and some text — a
 * half-row downstream is worse than one fewer row.
 */
function normalisePost(item: unknown, keyword: string, platform: Platform): RawPost | null {
  if (item === null || typeof item !== 'object') return null
  const row = item as LooseRecord

  /*
   * FOUR ACTORS, FOUR VOCABULARIES — AND TWO CASING CONVENTIONS.
   *
   * Every field is read through a list of candidate keys because none of these
   * names is a contract we control. The snake_case spellings are not
   * speculative: `apimaestro~linkedin-posts-search-scraper-no-cookies` returns
   * `activity_id`, `post_url`, `stats.total_reactions` and `posted_at.date`, and
   * against a camelCase-only reader every single row failed the id check and was
   * discarded as unusable — a lane that reported "no usable items" while the
   * actor was returning perfectly good posts with real engagement on them.
   */
  const text = str(
    row,
    'text', 'postText', 'caption', 'content', 'description', 'commentary', 'full_text',
    'post_text', 'message',
  )

  const urlOf = str(
    row,
    'url', 'postUrl', 'linkedinUrl', 'twitterUrl', 'link',
    'post_url', 'postLink', 'permalink', 'permalink_url',
  )

  const externalId =
    str(
      row,
      'id', 'postId', 'urn', 'shortCode', 'activityUrn', 'shareUrn', 'feedbackId',
      'activity_id', 'full_urn', 'post_id', 'shortcode', 'tweet_id', 'story_fbid',
    ) || urlOf
  if (text === '' || externalId === '') return null

  const url = urlOf || POST_URL_BASE[platform](externalId)

  // LinkedIn nests the date under `posted_at.date`, Instagram and Facebook use
  // `timestamp`, X uses `createdAt`. An unparseable date becomes capture time
  // rather than being dropped, because a post with no stated date is still
  // evidence — but it is never invented as something more precise.
  const postedRaw =
    nestedStr(row, 'postedAt.date', 'posted_at.date', 'postedAt.timestamp', 'posted_at.timestamp') ||
    str(row, 'postedAt', 'publishedAt', 'timestamp', 'createdAt', 'date', 'time', 'posted_at', 'created_at') ||
    ''
  const parsed = new Date(postedRaw)
  const postedAt =
    postedRaw !== '' && !Number.isNaN(parsed.getTime())
      ? parsed.toISOString()
      : new Date().toISOString()

  const declaredHashtags = Array.isArray(row.hashtags)
    ? (row.hashtags as unknown[])
        .filter((h): h is string => typeof h === 'string')
        .map((h) => h.replace(/^#/, ''))
    : []

  /* ── ENGAGEMENT, AND WHETHER IT WAS STATED AT ALL ────────────────────────── */

  const REACTION_KEYS = [
    'engagement.likes', 'stats.total_reactions', 'stats.reactions',
    'likesCount', 'likeCount', 'reactionsCount', 'numLikes', 'reactions', 'totalReactions',
    'likes', 'favorite_count', 'favoriteCount',
  ]
  const COMMENT_KEYS = [
    'engagement.comments', 'stats.comments',
    'commentsCount', 'replyCount', 'numComments', 'comments', 'comment_count',
  ]
  const REPOST_KEYS = [
    'engagement.shares', 'stats.shares', 'stats.reposts',
    'sharesCount', 'retweetCount', 'reshareCount', 'numShares', 'reposts', 'repostsCount',
    'share_count', 'quoteCount',
  ]

  const readCount = (keys: string[]): number => {
    for (const key of keys) {
      const value = key.includes('.') ? nestedInt(row, key) : int(row, key)
      if (value !== 0) return value
    }
    return 0
  }

  const reactions = readCount(REACTION_KEYS)
  const comments = readCount(COMMENT_KEYS)
  const reposts = readCount(REPOST_KEYS)

  /*
   * Measured only if the actor actually stated a count somewhere. An actor that
   * returns no engagement keys at all — the Facebook search actor is one — used
   * to have its three structural zeros stamped `metricsAvailable: true`, which
   * is precisely the "N/A is never 0" violation the pipeline is built to avoid:
   * the Validation Agent would then average those zeros into a measured
   * engagement figure and quietly depress a real one.
   */
  const metricsAvailable = statesAny(row, ...REACTION_KEYS, ...COMMENT_KEYS, ...REPOST_KEYS)

  return {
    externalId,
    text,
    authorName:
      nestedStr(row, 'author.name', 'author.userName', 'author.user_name', 'user.name') ||
      str(row, 'ownerFullName', 'ownerUsername', 'authorName', 'author', 'profileName', 'author_name') ||
      'Unknown author',
    authorHeadline:
      nestedStr(row, 'author.headline', 'author.info', 'author.description') ||
      str(row, 'authorHeadline', 'headline', 'occupation'),
    // Only some actors state this. Zero means "not stated" — the follower floor
    // in the handler exempts unstated counts rather than reading them as tiny.
    authorFollowers:
      nestedInt(row, 'author.followersCount') ||
      nestedInt(row, 'author.followers_count') ||
      nestedInt(row, 'author.followers') ||
      int(row, 'authorFollowers', 'followersCount', 'followers'),
    url,
    postedAt,
    reactions,
    comments,
    reposts,
    hashtags: declaredHashtags.length > 0 ? declaredHashtags : extractHashtagsFromText(text),
    keyword,
    sourceName: SOURCE_NAME[platform],
    platform,
    metricsAvailable,
  }
}

/** Apify returns either a bare array or `{ items }` / `{ data }`, depending on route. */
function datasetItems(payload: unknown): unknown[] {
  if (Array.isArray(payload)) return payload
  if (payload !== null && typeof payload === 'object') {
    const items = (payload as LooseRecord).items
    if (Array.isArray(items)) return items
    const data = (payload as LooseRecord).data
    if (Array.isArray(data)) return data
  }
  return []
}

/* ═══════════════════════════════════════════════════════════════════════════
   REQUEST PLUMBING — per https://apify.com/agents.md

   Bearer header, never a query-string token. Cost caps in the query string,
   never the input body: an actor is free to ignore a `maxPosts` field it does
   not recognise, but it cannot ignore Apify's own `maxItems` ceiling. Sync
   first; async run → poll → dataset when sync cannot finish inside its window.
   ═══════════════════════════════════════════════════════════════════════════ */

function authHeaders(): Record<string, string> {
  return { authorization: `Bearer ${config.apify.token}` }
}

/** Actor ids use `~` as the owner separator and must not be URL-escaped away. */
function actorPath(actor: string): string {
  return actor.replace(/\//g, '~')
}

/** `maxItems` caps a pay-per-result run's cost; `memory` sizes the container. */
function capQuery(maxItems: number): string {
  return `maxItems=${Math.max(1, Math.trunc(maxItems))}&memory=${config.apify.memoryMbytes}`
}

interface RunRecord {
  id: string
  status: string
  defaultDatasetId: string
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'])

async function runActor(
  actor: string,
  body: Record<string, unknown>,
  maxItems: number,
  adapterId: string,
): Promise<unknown[]> {
  const base = config.apify.baseUrl
  try {
    const payload = await fetchJson<unknown>(
      `${base}/acts/${actorPath(actor)}/run-sync-get-dataset-items?${capQuery(maxItems)}`,
      {
        method: 'POST',
        headers: authHeaders(),
        timeoutMs: config.apify.runTimeoutMs,
        adapterId,
        body,
      },
    )
    return datasetItems(payload)
  } catch (error) {
    // Only a timeout is worth a second, slower attempt. A 404 on the actor or a
    // 401 on the token will fail identically the second time, and retrying them
    // just doubles the wait before the operator sees the real reason.
    const timedOut = error instanceof AdapterError && /timed out/i.test(error.message)
    if (!timedOut) throw error
  }

  const started = await fetchJson<{ data?: RunRecord }>(
    `${base}/acts/${actorPath(actor)}/runs?${capQuery(maxItems)}`,
    { method: 'POST', headers: authHeaders(), timeoutMs: 30_000, adapterId, body },
  )
  const run = started.data
  if (!run?.id) throw new AdapterError(adapterId, 'actor run did not start')

  const deadline = Date.now() + config.apify.runTimeoutMs * 2
  let status = run.status
  let datasetId = run.defaultDatasetId

  while (!TERMINAL.has(status)) {
    if (Date.now() > deadline) {
      throw new AdapterError(adapterId, `run ${run.id} did not finish in time`)
    }
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const polled = await fetchJson<{ data?: RunRecord }>(`${base}/actor-runs/${run.id}`, {
      headers: authHeaders(),
      timeoutMs: 20_000,
      adapterId,
    })
    status = polled.data?.status ?? status
    datasetId = polled.data?.defaultDatasetId ?? datasetId
  }

  if (status !== 'SUCCEEDED') throw new AdapterError(adapterId, `run ${run.id} ended ${status}`)

  const items = await fetchJson<unknown>(`${base}/datasets/${datasetId}/items?limit=${maxItems}`, {
    headers: authHeaders(),
    timeoutMs: 60_000,
    adapterId,
  })
  return datasetItems(items)
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACTOR FAMILIES

   Input field names belong to an actor, not to a platform. `harvestapi` wants
   `searchQueries` + `maxPosts`; `apidojo` wants `searchTerms` + `maxItems`;
   Apify's own Instagram actor wants `hashtags` + `resultsLimit`. Keying the
   body on the family means an operator can point a lane at a different actor
   without a deploy, as long as its family is known.
   ═══════════════════════════════════════════════════════════════════════════ */

type ActorFamily =
  | 'harvestapi'
  | 'apimaestro'
  | 'instagram-hashtag'
  | 'instagram-search'
  | 'tweet-scraper'
  | 'facebook-search'
  | 'facebook-hashtag'
  | 'generic'

function familyOf(actor: string): ActorFamily {
  const slug = actor.toLowerCase()
  if (slug.includes('harvestapi')) return 'harvestapi'
  if (slug.includes('apimaestro')) return 'apimaestro'
  if (slug.includes('instagram-hashtag')) return 'instagram-hashtag'
  if (slug.includes('instagram-scraper')) return 'instagram-search'
  if (slug.includes('tweet-scraper') || slug.includes('twitter')) return 'tweet-scraper'
  if (slug.includes('facebook-posts-search') || slug.includes('facebook-search')) return 'facebook-search'
  if (slug.includes('facebook-hashtag')) return 'facebook-hashtag'
  return 'generic'
}

const POSTED_LIMIT: Record<CaptureInput['datePosted'], string> = {
  'past-24h': '24h',
  'past-week': 'week',
  'past-month': 'month',
}

const WINDOW_DAYS: Record<CaptureInput['datePosted'], number> = {
  'past-24h': 1,
  'past-week': 7,
  'past-month': 30,
}

/** The start of the recency window, for actors that take a date instead of a token. */
function windowStart(datePosted: CaptureInput['datePosted']): Date {
  const at = new Date()
  at.setDate(at.getDate() - WINDOW_DAYS[datePosted])
  return at
}

function isoDate(at: Date): string {
  return at.toISOString().slice(0, 10)
}

function actorFor(platform: Platform): string {
  switch (platform) {
    case 'linkedin':
      return config.apify.postsActor
    case 'instagram':
      return config.apify.instagramActor
    case 'x':
      return config.apify.xActor
    case 'facebook':
      return config.apify.facebookActor
  }
}

/**
 * The run input for one keyword on one lane.
 *
 * Note what is NOT here: Instagram's hashtag actor has no sort or recency
 * control at all, so `datePosted` cannot be expressed on that lane. Rather
 * than pretend otherwise, the lane over-fetches and the handler filters on
 * `postedAt` — and says it did.
 */
function searchBody(actor: string, input: CaptureInput, maxItems: number): Record<string, unknown> {
  const term = input.keyword
  switch (familyOf(actor)) {
    case 'harvestapi':
      return {
        searchQueries: [term],
        maxPosts: maxItems,
        sortBy: input.sortBy,
        postedLimit: POSTED_LIMIT[input.datePosted],
      }
    case 'apimaestro':
      return {
        keyword: term,
        sort_type: input.sortBy === 'date' ? 'date_posted' : 'relevance',
        // This actor's own enum happens to be exactly our `datePosted` vocabulary,
        // so the recency window IS expressible on this lane and is passed rather
        // than dropped. Verified against its published input schema.
        date_filter: input.datePosted,
        limit: Math.min(50, maxItems),
        total_posts: maxItems,
      }
    case 'instagram-hashtag':
      return {
        // `keywordSearch` makes the actor treat the entry as a plain search
        // term rather than a literal tag, which is what a trending keyword is.
        hashtags: [term.replace(/^#/, '')],
        keywordSearch: !term.startsWith('#'),
        resultsType: 'posts',
        resultsLimit: maxItems,
      }
    case 'instagram-search':
      return {
        search: term,
        searchType: term.startsWith('#') ? 'hashtag' : 'user',
        searchLimit: 1,
        resultsType: 'posts',
        resultsLimit: maxItems,
        onlyPostsNewerThan: isoDate(windowStart(input.datePosted)),
      }
    case 'tweet-scraper':
      return {
        searchTerms: [term],
        maxItems,
        sort: input.sortBy === 'date' ? 'Latest' : 'Top',
        start: isoDate(windowStart(input.datePosted)),
      }
    case 'facebook-search':
      return {
        // A single string, not an array — this actor is called once per keyword.
        query: term,
        resultsCount: maxItems,
        searchType: input.sortBy === 'date' ? 'latest' : 'top',
        startDate: isoDate(windowStart(input.datePosted)),
      }
    case 'facebook-hashtag':
      return { keywordList: [term.replace(/^#/, '')], resultsLimit: maxItems }
    default:
      return { searchQuery: term, maxItems, sortBy: input.sortBy, datePosted: input.datePosted }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ADAPTER
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Keyword search on one platform lane. The open web has no actor and is not
 * reachable through here — `captureFor()` routes it to crawl4ai instead.
 */
export const apifySearch: ServiceAdapter<CaptureInput, RawPost[]> = {
  id: 'apify.search',
  label: 'Apify · platform capture',

  isConfigured(): boolean {
    return config.apify.configured
  },

  unavailableReason(): string {
    return UNAVAILABLE
  },

  async run(input: CaptureInput): Promise<RawPost[]> {
    if (!this.isConfigured()) throw new AdapterError(this.id, UNAVAILABLE)
    if (input.platform === undefined) {
      throw new AdapterError(this.id, 'the open-web lane has no actor — it is captured by crawl4ai')
    }

    const platform = input.platform
    const actor = actorFor(platform)
    // The operator's knob asks; the env ceiling decides. Actors bill per result.
    const maxItems = Math.max(1, Math.min(input.maxItems, config.apify.maxItemsPerKeyword))

    const items = await runActor(actor, searchBody(actor, input, maxItems), maxItems, this.id)

    const posts = items
      .map((item) => normalisePost(item, input.keyword, platform))
      .filter((p): p is RawPost => p !== null)

    if (posts.length === 0) {
      // An empty live result and a broken actor are indistinguishable from the
      // caller's side, so say which keyword and lane produced nothing rather
      // than reporting a successful zero.
      throw new AdapterError(
        this.id,
        `${actor} returned no usable items for “${input.keyword}” on ${platform}`,
      )
    }
    return posts
  },
}

/** Engagement, weighted the way the pipeline weights it. */
export function rawPostEngagement(post: RawPost): number {
  return post.reactions + post.comments * 3 + post.reposts * 5
}

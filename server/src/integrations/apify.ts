/**
 * APIFY — the LinkedIn scraping adapter.
 *
 * Three actors: keyword post search, hashtag feeds, and competitor profile
 * posts. Each one normalises whatever Apify returns into `RawPost`, because the
 * actors are third-party and their field names are not a contract we control.
 *
 * Blank `APIFY_API_TOKEN` ⇒ the bundled offline corpus, with the reason
 * recorded on every item produced.
 */

import type { ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError, fetchJson } from './adapter'
import {
  type FixturePost,
  fixtureEngagement,
  fixtureHashtagFeed,
  fixturePostedAt,
  fixturesForKeyword,
} from './fixtures/linkedin-posts'
import { COMPETITOR_POSTS, postsForCompetitor } from './fixtures/competitors'

/* ═══════════════════════════════════════════════════════════════════════════
   THE NORMALISED SHAPE
   ═══════════════════════════════════════════════════════════════════════════ */

/** What the rest of the pipeline consumes, regardless of which actor ran. */
export interface RawPost {
  externalId: string
  text: string
  authorName: string
  authorHeadline: string
  authorFollowers: number
  url: string
  postedAt: string
  reactions: number
  comments: number
  reposts: number
  hashtags: string[]
  /** The keyword or hashtag whose query surfaced this post. */
  keyword: string
  sourceName: string
}

export interface ApifyPostSearchInput {
  keyword: string
  maxItems: number
  datePosted: 'past-24h' | 'past-week' | 'past-month'
  sortBy: 'relevance' | 'date'
  minAuthorFollowers: number
}

export interface ApifyHashtagInput {
  hashtag: string
  maxItems: number
}

export interface ApifyProfileInput {
  handle: string
  competitorName: string
  maxItems: number
}

/* ═══════════════════════════════════════════════════════════════════════════
   NORMALISATION
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Apify actors vary in field naming between versions, so every field is read
 * through a tolerant lookup rather than assumed. An item that cannot yield an
 * id and some text is dropped rather than inserted as a half-row.
 */
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

/** A nested integer, e.g. `engagement.likes`. Zero when absent — callers OR a flat fallback. */
function nestedInt(row: LooseRecord, path: string): number {
  const v = nested(row, path)
  if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
  if (typeof v === 'string') {
    const n = Number.parseInt(v.replace(/[^\d-]/g, ''), 10)
    if (Number.isFinite(n)) return n
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

export function extractHashtagsFromText(text: string): string[] {
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

/** Normalises one Apify dataset item. Returns null when it is unusable. */
function normalisePost(
  item: unknown,
  keyword: string,
  sourceName: string,
): RawPost | null {
  if (item === null || typeof item !== 'object') return null
  const row = item as LooseRecord

  const text = str(row, 'text', 'postText', 'content', 'description', 'commentary')
  const externalId =
    str(row, 'urn', 'postId', 'id', 'activityUrn', 'shareUrn') ||
    str(row, 'url', 'postUrl', 'linkedinUrl', 'link')
  if (text === '' || externalId === '') return null

  const authorFromNested =
    typeof nested(row, 'author.name') === 'string' ? (nested(row, 'author.name') as string) : ''
  const headlineFromNested =
    typeof (nested(row, 'author.headline') ?? nested(row, 'author.info')) === 'string'
      ? ((nested(row, 'author.headline') ?? nested(row, 'author.info')) as string)
      : ''
  const followersFromNested = nested(row, 'author.followersCount')

  const postedRaw =
    str(row, 'postedAt', 'publishedAt', 'date', 'time', 'createdAt') ||
    new Date().toISOString()
  const parsed = new Date((typeof nested(row, 'postedAt.date') === 'string' ? (nested(row, 'postedAt.date') as string) : '') || postedRaw)
  const postedAt = Number.isNaN(parsed.getTime())
    ? new Date().toISOString()
    : parsed.toISOString()

  const declaredHashtags = Array.isArray(row.hashtags)
    ? (row.hashtags as unknown[])
        .filter((h): h is string => typeof h === 'string')
        .map((h) => h.replace(/^#/, ''))
    : []

  return {
    externalId,
    text,
    authorName: authorFromNested || str(row, 'authorName', 'author', 'profileName') || 'Unknown author',
    authorHeadline: headlineFromNested || str(row, 'authorHeadline', 'headline', 'occupation'),
    authorFollowers:
      typeof followersFromNested === 'number'
        ? Math.trunc(followersFromNested)
        : int(row, 'authorFollowers', 'followersCount', 'followers'),
    url: str(row, 'url', 'postUrl', 'linkedinUrl', 'link') || `https://www.linkedin.com/feed/update/${externalId}`,
    postedAt,
    reactions: nestedInt(row, 'engagement.likes') || int(row, 'numLikes', 'likesCount', 'reactions', 'reactionsCount', 'totalReactions'),
    comments: nestedInt(row, 'engagement.comments') || int(row, 'numComments', 'commentsCount', 'comments'),
    reposts: nestedInt(row, 'engagement.shares') || int(row, 'numShares', 'sharesCount', 'reposts', 'repostsCount'),
    hashtags: declaredHashtags.length > 0 ? declaredHashtags : extractHashtagsFromText(text),
    keyword,
    sourceName,
  }
}

/** Apify returns either a bare array or `{ items: [...] }` depending on route. */
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
   THE FIXTURE PATH
   ═══════════════════════════════════════════════════════════════════════════ */

function fixtureToRawPost(post: FixturePost, keyword: string, now: Date): RawPost {
  return {
    externalId: post.externalId,
    text: post.text,
    authorName: post.authorName,
    authorHeadline: post.authorHeadline,
    authorFollowers: post.authorFollowers,
    url: `https://www.linkedin.com/feed/update/urn:li:activity:${post.externalId}`,
    postedAt: fixturePostedAt(post, now).toISOString(),
    reactions: post.reactions,
    comments: post.comments,
    reposts: post.reposts,
    hashtags: post.hashtags,
    keyword,
    sourceName: post.sourceName,
  }
}

/** The offline corpus for one keyword, rotated so repeat runs surface new items. */
export function apifyFixturePosts(
  keyword: string,
  maxItems: number,
  runOffset = 0,
  now = new Date(),
): RawPost[] {
  return fixturesForKeyword(keyword, maxItems, runOffset).map((p) =>
    fixtureToRawPost(p, keyword, now),
  )
}

/** The offline independent reading of one hashtag's own feed. */
export function apifyFixtureHashtagFeed(
  hashtag: string,
  maxItems: number,
  runOffset = 0,
  now = new Date(),
): RawPost[] {
  return fixtureHashtagFeed(hashtag, maxItems, runOffset).map((p) =>
    fixtureToRawPost(p, `#${hashtag.replace(/^#/, '')}`, now),
  )
}

export interface CompetitorPost {
  competitor: string
  text: string
  format: string
  engagementIndex: number
  postedAt: string
  topics: string[]
}

/** The offline competitor reading. */
export function apifyFixtureCompetitorPosts(
  competitorName: string,
  maxItems: number,
  now = new Date(),
): CompetitorPost[] {
  const posts =
    competitorName === '*'
      ? COMPETITOR_POSTS.slice(0, maxItems)
      : postsForCompetitor(competitorName, maxItems)

  return posts.map((p) => {
    const at = new Date(now)
    at.setDate(at.getDate() - p.daysAgo)
    return {
      competitor: p.competitor,
      text: p.text,
      format: p.format,
      engagementIndex: p.engagementIndex,
      postedAt: at.toISOString(),
      topics: p.topics,
    }
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ADAPTERS
   ═══════════════════════════════════════════════════════════════════════════ */

const UNAVAILABLE = 'APIFY_API_TOKEN is not set'

/* ═══════════════════════════════════════════════════════════════════════════
   REQUEST PLUMBING — per https://apify.com/agents.md
   Bearer header, never a query-string token. Cost caps in the query string,
   never the input body. Sync first; async run → poll → dataset when sync
   cannot finish inside its window.
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

function runSyncUrl(actor: string, maxItems: number): string {
  return `${config.apify.baseUrl}/actors/${actorPath(actor)}/run-sync-get-dataset-items?${capQuery(maxItems)}`
}

function runAsyncUrl(actor: string, maxItems: number): string {
  return `${config.apify.baseUrl}/actors/${actorPath(actor)}/runs?${capQuery(maxItems)}`
}

type ActorFamily = 'harvestapi' | 'apimaestro' | 'generic'

/** Input field names are per actor, not per platform — so the body is built per family. */
function familyOf(actor: string): ActorFamily {
  if (actor.startsWith('harvestapi')) return 'harvestapi'
  if (actor.startsWith('apimaestro')) return 'apimaestro'
  return 'generic'
}

const POSTED_LIMIT: Record<ApifyPostSearchInput['datePosted'], string> = {
  'past-24h': '24h',
  'past-week': 'week',
  'past-month': 'month',
}

function postSearchBody(actor: string, input: ApifyPostSearchInput): Record<string, unknown> {
  switch (familyOf(actor)) {
    case 'harvestapi':
      return {
        searchQueries: [input.keyword],
        maxPosts: input.maxItems,
        sortBy: input.sortBy,
        postedLimit: POSTED_LIMIT[input.datePosted],
      }
    case 'apimaestro':
      return {
        keyword: input.keyword,
        sort_type: input.sortBy === 'date' ? 'date_posted' : 'relevance',
        limit: Math.min(50, input.maxItems),
        total_posts: input.maxItems,
      }
    default:
      return {
        searchQuery: input.keyword,
        maxItems: input.maxItems,
        sortBy: input.sortBy,
        datePosted: input.datePosted,
      }
  }
}

/**
 * A hashtag feed is a post search for `#tag`. Reading it through the same
 * actor as the keyword search is deliberate: it is an independent volume
 * reading, and one actor family means one output shape to normalise.
 */
function hashtagBody(actor: string, tag: string, maxItems: number): Record<string, unknown> {
  switch (familyOf(actor)) {
    case 'harvestapi':
      return { searchQueries: [`#${tag}`], maxPosts: maxItems, sortBy: 'date', postedLimit: 'month' }
    case 'apimaestro':
      return { keyword: `#${tag}`, sort_type: 'date_posted', limit: Math.min(50, maxItems), total_posts: maxItems }
    default:
      return { hashtag: tag, maxItems }
  }
}

function profileUrl(handle: string): string {
  if (/^https?:\/\//i.test(handle)) return handle
  return `https://www.linkedin.com/company/${handle.replace(/^@/, '')}`
}

function profileBody(actor: string, input: ApifyProfileInput): Record<string, unknown> {
  switch (familyOf(actor)) {
    case 'harvestapi':
      return { targetUrls: [profileUrl(input.handle)], maxPosts: input.maxItems, postedLimit: 'month' }
    default:
      return { username: input.handle, maxItems: input.maxItems }
  }
}

interface RunRecord {
  id: string
  status: string
  defaultDatasetId: string
}

const TERMINAL = new Set(['SUCCEEDED', 'FAILED', 'TIMED-OUT', 'ABORTED'])

/**
 * Runs an actor and returns its dataset items.
 *
 * The synchronous endpoint returns items directly but is capped at its own
 * window. When it times out, the run is started asynchronously and polled
 * until it reaches a terminal state — so a slow LinkedIn query degrades to
 * "slower", never to "failed".
 */
async function runActor(
  actor: string,
  body: Record<string, unknown>,
  maxItems: number,
  adapterId: string,
): Promise<unknown[]> {
  try {
    const payload = await fetchJson<unknown>(runSyncUrl(actor, maxItems), {
      method: 'POST',
      headers: authHeaders(),
      timeoutMs: config.apify.runTimeoutMs,
      adapterId,
      body,
    })
    return datasetItems(payload)
  } catch (error) {
    const timedOut = error instanceof AdapterError && /timed out/i.test(error.message)
    if (!timedOut) throw error
  }

  const started = await fetchJson<{ data?: RunRecord }>(runAsyncUrl(actor, maxItems), {
    method: 'POST',
    headers: authHeaders(),
    timeoutMs: 30_000,
    adapterId,
    body,
  })
  const run = started.data
  if (!run?.id) throw new AdapterError(adapterId, 'actor run did not start')

  const deadline = Date.now() + config.apify.runTimeoutMs * 2
  let status = run.status
  let datasetId = run.defaultDatasetId

  while (!TERMINAL.has(status)) {
    if (Date.now() > deadline) throw new AdapterError(adapterId, `run ${run.id} did not finish in time`)
    await new Promise((resolve) => setTimeout(resolve, 3_000))
    const polled = await fetchJson<{ data?: RunRecord }>(`${config.apify.baseUrl}/actor-runs/${run.id}`, {
      headers: authHeaders(),
      timeoutMs: 20_000,
      adapterId,
    })
    status = polled.data?.status ?? status
    datasetId = polled.data?.defaultDatasetId ?? datasetId
  }

  if (status !== 'SUCCEEDED') throw new AdapterError(adapterId, `run ${run.id} ended ${status}`)

  const items = await fetchJson<unknown>(`${config.apify.baseUrl}/datasets/${datasetId}/items?limit=${maxItems}`, {
    headers: authHeaders(),
    timeoutMs: 60_000,
    adapterId,
  })
  return datasetItems(items)
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ADAPTERS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Keyword post search. The one adapter `scraping.linkedin.fetch` calls. */
export const apifyPostSearch: ServiceAdapter<ApifyPostSearchInput, RawPost[]> = {
  id: 'apify.postSearch',
  label: 'Apify · LinkedIn post search',

  isConfigured(): boolean {
    return config.apify.configured
  },

  unavailableReason(): string {
    return UNAVAILABLE
  },

  async run(input: ApifyPostSearchInput): Promise<RawPost[]> {
    if (!this.isConfigured()) throw new AdapterError(this.id, UNAVAILABLE)

    const actor = config.apify.postsActor
    const maxItems = Math.min(input.maxItems, config.apify.maxItemsPerKeyword)
    const items = await runActor(actor, postSearchBody(actor, { ...input, maxItems }), maxItems, this.id)

    const posts = items
      .map((item) => normalisePost(item, input.keyword, 'LinkedIn · Research Feed'))
      .filter((p): p is RawPost => p !== null)
      .filter((p) => p.authorFollowers >= input.minAuthorFollowers)

    if (posts.length === 0) {
      // An empty live result is indistinguishable from a broken actor from the
      // caller's side, so say so rather than reporting a successful zero.
      throw new AdapterError(this.id, `actor returned no usable items for "${input.keyword}"`)
    }
    return posts
  },
}

/** Hashtag feed — an independent volume reading, not biased by the keyword query. */
export const apifyHashtagFeed: ServiceAdapter<ApifyHashtagInput, RawPost[]> = {
  id: 'apify.hashtagFeed',
  label: 'Apify · LinkedIn hashtag feed',

  isConfigured(): boolean {
    return config.apify.configured
  },

  unavailableReason(): string {
    return UNAVAILABLE
  },

  async run(input: ApifyHashtagInput): Promise<RawPost[]> {
    if (!this.isConfigured()) throw new AdapterError(this.id, UNAVAILABLE)

    const tag = input.hashtag.replace(/^#/, '')
    const actor = config.apify.hashtagActor
    const items = await runActor(actor, hashtagBody(actor, tag, input.maxItems), input.maxItems, this.id)

    const posts = items
      .map((item) => normalisePost(item, `#${tag}`, 'LinkedIn · Hashtag Feeds'))
      .filter((p): p is RawPost => p !== null)

    if (posts.length === 0) {
      throw new AdapterError(this.id, `hashtag actor returned no usable items for #${tag}`)
    }
    return posts
  },
}

/** Competitor company or profile posts. */
export const apifyProfilePosts: ServiceAdapter<ApifyProfileInput, CompetitorPost[]> = {
  id: 'apify.profilePosts',
  label: 'Apify · LinkedIn company posts',

  isConfigured(): boolean {
    return config.apify.configured
  },

  unavailableReason(): string {
    return UNAVAILABLE
  },

  async run(input: ApifyProfileInput): Promise<CompetitorPost[]> {
    if (!this.isConfigured()) throw new AdapterError(this.id, UNAVAILABLE)

    const actor = config.apify.profileActor
    const raw = await runActor(actor, profileBody(actor, input), input.maxItems, this.id)

    const items = raw
      .map((item) => normalisePost(item, input.competitorName, 'Competitor Pages'))
      .filter((p): p is RawPost => p !== null)

    if (items.length === 0) {
      throw new AdapterError(this.id, `company actor returned no usable items for ${input.handle}`)
    }

    // Engagement index is relative to this competitor's own batch, so a large
    // account and a small one are comparable.
    const maxEngagement = Math.max(...items.map((p) => p.reactions + p.comments * 3 + p.reposts * 5), 1)

    return items.map((p) => ({
      competitor: input.competitorName,
      text: p.text,
      format: inferFormat(p.text),
      engagementIndex: Math.round(((p.reactions + p.comments * 3 + p.reposts * 5) / maxEngagement) * 100),
      postedAt: p.postedAt,
      topics: p.hashtags.map((h) => h.toLowerCase()),
    }))
  },
}

/** A rough format read from the shape of the text. */
function inferFormat(text: string): string {
  const lines = text.split('\n').filter((l) => l.trim() !== '')
  if (/\b(carousel|swipe|slide \d)\b/i.test(text)) return 'Carousel'
  if (/\b(video|watch|webinar)\b/i.test(text)) return 'Video'
  if (/\b(case study|how we|results)\b/i.test(text)) return 'Case Study'
  if (text.length < 280 || lines.length <= 2) return 'Short Post'
  return 'Thought Leadership'
}

/** Engagement, weighted the way the pipeline weights it. */
export function rawPostEngagement(post: RawPost): number {
  return post.reactions + post.comments * 3 + post.reposts * 5
}

export { fixtureEngagement }

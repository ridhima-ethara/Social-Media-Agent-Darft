/**
 * NORMALISATION — every actor's output, one shape.
 *
 * Actors from six vendors return six vocabularies, and none of those field
 * names is a contract we control. So every field is read through a candidate
 * list rather than assumed, in both camelCase and snake_case — the same
 * technique `integrations/apify.ts` already documents, applied across more
 * platforms.
 *
 * ═══ THE RULE THAT GOVERNS THIS WHOLE FILE ═══
 *
 * A metric the actor did not state comes out as `null`, never `0`.
 *
 * Not a style preference. Downstream, `validation.keyword.trend` averages
 * engagement and `validation.item.filter` applies a plays floor; a zero
 * substituted for an absent figure would drag a real average down and delete
 * every unmeasured capture as "underperforming". A YouTube video states views
 * and a LinkedIn text post never had any — those are different facts, and this
 * is the layer where they would be most easily collapsed.
 *
 * `rawData` is preserved on every item, because these schemas differ and a
 * future improvement to this file will need fields it does not read today.
 */

import type { Platform } from '../../../../shared/agent-contract'
import type { ScrapeTarget } from './actor-index'

/* ═══════════════════════════════════════════════════════════════════════════
   TOLERANT READERS
   ═══════════════════════════════════════════════════════════════════════════ */

interface Loose {
  [key: string]: unknown
}

function at(row: Loose, path: string): unknown {
  let cursor: unknown = row
  for (const part of path.split('.')) {
    if (cursor === null || typeof cursor !== 'object') return undefined
    cursor = (cursor as Loose)[part]
  }
  return cursor
}

/** The first key that holds a non-empty string. `''` when none does. */
function text(row: Loose, ...keys: string[]): string {
  for (const key of keys) {
    const v = key.includes('.') ? at(row, key) : row[key]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
    if (typeof v === 'number' && Number.isFinite(v)) return String(v)
  }
  return ''
}

/**
 * The first key that STATES a number, or `null`.
 *
 * `null` and `0` are different returns and the difference is the point: a key
 * present with the value 0 IS a measurement and is returned as 0; a key that is
 * absent everywhere returns null and stays absent all the way to the column.
 */
function count(row: Loose, ...keys: string[]): number | null {
  for (const key of keys) {
    const v = key.includes('.') ? at(row, key) : row[key]
    if (typeof v === 'number' && Number.isFinite(v)) return Math.trunc(v)
    if (typeof v === 'string') {
      const cleaned = v.replace(/[,\s]/g, '')
      if (/^-?\d+$/.test(cleaned)) return Number.parseInt(cleaned, 10)
    }
  }
  return null
}

function list(row: Loose, ...keys: string[]): string[] {
  for (const key of keys) {
    const v = key.includes('.') ? at(row, key) : row[key]
    if (Array.isArray(v)) {
      const strings = v.filter((x): x is string => typeof x === 'string')
      if (strings.length > 0) return strings.map((s) => s.replace(/^#/, ''))
    }
  }
  return []
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE NORMALISED SHAPE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface NormalizedItem {
  id: string
  platform: ScrapeTarget
  /** The ORIGINAL platform URL. Never an Apify dataset URL. */
  sourceUrl: string
  /** A direct media URL where the actor gave one. */
  contentUrl: string | null
  author: string | null
  authorHandle: string | null
  title: string | null
  caption: string | null
  text: string
  transcript: string | null
  publishedAt: string | null
  collectedAt: string

  views: number | null
  likes: number | null
  comments: number | null
  shares: number | null
  /** Computed only when both halves were stated. */
  engagementRate: number | null

  hashtags: string[]
  format: string
  mediaType: string | null
  thumbnailUrl: string | null

  sourceActor: string
  apifyRunId: string
  apifyDatasetId: string
  /** The actor's own row, untouched. */
  rawData: Record<string, unknown>
}

/* ═══════════════════════════════════════════════════════════════════════════
   CANDIDATE KEYS — the union of what these actors actually emit
   ═══════════════════════════════════════════════════════════════════════════ */

const URL_KEYS = [
  'url', 'postUrl', 'webVideoUrl', 'videoUrl', 'link', 'permalink', 'permalink_url',
  'post_url', 'postLink', 'linkedinUrl', 'twitterUrl', 'shareUrl', 'displayUrl',
]
const ID_KEYS = [
  'id', 'postId', 'videoId', 'shortCode', 'shortcode', 'urn', 'activityUrn', 'tweet_id',
  'activity_id', 'post_id', 'story_fbid', 'full_urn',
]
const TEXT_KEYS = [
  'text', 'caption', 'postText', 'content', 'description', 'commentary',
  'full_text', 'post_text', 'message', 'title',
]
const TITLE_KEYS = ['title', 'name', 'headline', 'videoTitle']
const AUTHOR_KEYS = [
  'author.name', 'author.fullName', 'user.name', 'owner.username', 'channel.name',
  'ownerFullName', 'authorName', 'author', 'channelName', 'profileName', 'author_name',
]
const HANDLE_KEYS = [
  'author.userName', 'author.username', 'owner.username', 'user.screen_name',
  'ownerUsername', 'authorHandle', 'username', 'screenName', 'channelUsername',
]
const DATE_KEYS = [
  'postedAt.date', 'posted_at.date', 'timestamp', 'createdAt', 'publishedAt',
  'date', 'uploadDate', 'created_at', 'posted_at', 'time',
]
const VIEW_KEYS = [
  'videoPlayCount', 'videoViewCount', 'viewCount', 'views', 'playCount', 'play_count',
  'view_count', 'viewsCount', 'stats.views', 'statistics.viewCount', 'impressionsCount',
]
const LIKE_KEYS = [
  'likesCount', 'likeCount', 'likes', 'diggCount', 'favorite_count', 'favoriteCount',
  'reactionsCount', 'numLikes', 'stats.total_reactions', 'engagement.likes',
  'statistics.likeCount',
]
const COMMENT_KEYS = [
  'commentsCount', 'commentCount', 'comments', 'replyCount', 'numComments',
  'comment_count', 'stats.comments', 'engagement.comments', 'statistics.commentCount',
]
const SHARE_KEYS = [
  'sharesCount', 'shareCount', 'shares', 'retweetCount', 'reshareCount', 'repostsCount',
  'share_count', 'quoteCount', 'stats.shares', 'engagement.shares',
]
const TRANSCRIPT_KEYS = ['transcript', 'captions', 'subtitles', 'transcription']
const THUMB_KEYS = ['thumbnailUrl', 'displayUrl', 'thumbnail', 'coverUrl', 'imageUrl', 'previewImage']

/** A canonical URL when the actor gave none, so a real item is never dropped for lack of one. */
const URL_FALLBACK: Partial<Record<ScrapeTarget, (id: string) => string>> = {
  instagram: (id) => `https://www.instagram.com/p/${id}/`,
  x: (id) => `https://x.com/i/status/${id}`,
  youtube: (id) => `https://www.youtube.com/watch?v=${id}`,
  tiktok: (id) => `https://www.tiktok.com/@/video/${id}`,
  linkedin: (id) => `https://www.linkedin.com/feed/update/${id}`,
  facebook: (id) => `https://www.facebook.com/${id}`,
}

function hashtagsFrom(row: Loose, body: string): string[] {
  const declared = list(row, 'hashtags', 'tags', 'hashtag')
  if (declared.length > 0) return declared
  const found = body.match(/#[\p{L}\p{N}_]+/gu) ?? []
  const seen = new Set<string>()
  const out: string[] = []
  for (const raw of found) {
    const tag = raw.slice(1)
    const key = tag.toLowerCase()
    if (seen.has(key)) continue
    seen.add(key)
    out.push(tag)
  }
  return out
}

function formatOf(target: ScrapeTarget, url: string, views: number | null): string {
  const u = url.toLowerCase()
  if (u.includes('/reel')) return 'reel'
  if (u.includes('/shorts/')) return 'short'
  if (u.includes('/video/') || u.includes('watch?v=')) return 'video'
  if (target === 'youtube' || target === 'tiktok') return 'video'
  return views !== null && views > 0 ? 'video' : 'post'
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE NORMALISER
   ═══════════════════════════════════════════════════════════════════════════ */

export interface NormalizeContext {
  platform: ScrapeTarget
  sourceActor: string
  apifyRunId: string
  apifyDatasetId: string
}

/**
 * One dataset row → one normalised item, or `null`.
 *
 * `null` when the row yields neither text nor a URL: a half-row downstream is
 * worse than one fewer row, and it would occupy a calendar slot on the strength
 * of nothing. Every rejection is counted by the caller and reported.
 */
export function normalizeItem(raw: unknown, ctx: NormalizeContext): NormalizedItem | null {
  if (raw === null || typeof raw !== 'object') return null
  const row = raw as Loose

  const id = text(row, ...ID_KEYS)
  const body = text(row, ...TEXT_KEYS)
  const directUrl = text(row, ...URL_KEYS)

  // §9: the original source URL is preserved whenever the actor provides one,
  // and reconstructed from the id when it does not. It is NEVER replaced by an
  // Apify dataset URL — those travel separately, as `apifyRunId`/`apifyDatasetId`.
  const sourceUrl = directUrl !== '' ? directUrl : id !== '' ? (URL_FALLBACK[ctx.platform]?.(id) ?? '') : ''

  if (body === '' && sourceUrl === '') return null

  const views = count(row, ...VIEW_KEYS)
  const likes = count(row, ...LIKE_KEYS)
  const comments = count(row, ...COMMENT_KEYS)
  const shares = count(row, ...SHARE_KEYS)

  /*
   * ENGAGEMENT RATE, OR NOTHING.
   *
   * It needs a play count AND at least one interaction count. Missing either
   * one means the rate is not computable — which is a different statement from
   * a rate of zero, and a zero here would assert that the post was seen and
   * ignored.
   */
  const interactions =
    likes === null && comments === null ? null : (likes ?? 0) + (comments ?? 0)
  const engagementRate =
    views !== null && views > 0 && interactions !== null
      ? Math.round((interactions / views) * 10000) / 100
      : null

  const published = text(row, ...DATE_KEYS)
  const parsed = published === '' ? null : new Date(published)

  const transcriptRaw = row.transcript ?? row.captions ?? row.subtitles
  const transcript = Array.isArray(transcriptRaw)
    ? transcriptRaw
        .map((x) => (typeof x === 'string' ? x : text(x as Loose, 'text')))
        .filter((x) => x !== '')
        .join(' ') || null
    : text(row, ...TRANSCRIPT_KEYS) || null

  const title = text(row, ...TITLE_KEYS)
  const handle = text(row, ...HANDLE_KEYS)

  return {
    id: id !== '' ? id : sourceUrl,
    platform: ctx.platform,
    sourceUrl,
    contentUrl: text(row, 'videoUrl', 'webVideoUrl', 'mediaUrl', 'downloadUrl') || null,
    author: text(row, ...AUTHOR_KEYS) || null,
    authorHandle: handle === '' ? null : handle.startsWith('@') ? handle : `@${handle}`,
    title: title === '' ? null : title,
    caption: body === '' ? null : body,
    text: body,
    transcript,
    publishedAt: parsed && !Number.isNaN(parsed.getTime()) ? parsed.toISOString() : null,
    collectedAt: new Date().toISOString(),
    views,
    likes,
    comments,
    shares,
    engagementRate,
    hashtags: hashtagsFrom(row, body),
    format: formatOf(ctx.platform, sourceUrl, views),
    mediaType: text(row, 'type', 'mediaType', '__typename') || null,
    thumbnailUrl: text(row, ...THUMB_KEYS) || null,
    sourceActor: ctx.sourceActor,
    apifyRunId: ctx.apifyRunId,
    apifyDatasetId: ctx.apifyDatasetId,
    // §10: kept whole. A future normaliser will want fields this one ignores.
    rawData: row as Record<string, unknown>,
  }
}

export interface NormalizeOutcome {
  items: NormalizedItem[]
  /** How many rows yielded neither text nor a URL. Reported, never hidden. */
  rejected: number
}

export function normalizeDataset(rows: unknown[], ctx: NormalizeContext): NormalizeOutcome {
  const items: NormalizedItem[] = []
  let rejected = 0
  for (const row of rows) {
    const item = normalizeItem(row, ctx)
    if (item === null) rejected += 1
    else items.push(item)
  }
  return { items, rejected }
}

/* ═══════════════════════════════════════════════════════════════════════════
   INTO THE CAPTURE CONTRACT

   Sherlock is unchanged (§14): it still consumes `RawPost`. This is the one
   adapter between the normalised shape and that contract, and it is where the
   two availability flags are set — the fields that keep "not stated" and "zero"
   apart for the whole rest of the pipeline.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface CaptureShaped {
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
  views: number
  viewsAvailable: boolean
  hashtags: string[]
  keyword: string
  sourceName: string
  platform: Platform | null
  metricsAvailable: boolean
}

/**
 * `NormalizedItem` → the shape `capture.ts` already defines.
 *
 * The two boolean flags are the whole of the translation's risk. `RawPost`'s
 * count fields are non-nullable numbers, so a null has to become a zero HERE —
 * and that is only safe because the flag beside it says the zero means "not
 * applicable". Setting the number without setting the flag is the one mistake
 * in this file that would silently corrupt every downstream average.
 */
export function toCaptureShape(
  item: NormalizedItem,
  keyword: string,
  platform: Platform | null,
  sourceName: string,
): CaptureShaped {
  const metricsAvailable = item.likes !== null || item.comments !== null || item.shares !== null
  const viewsAvailable = item.views !== null

  return {
    externalId: item.id,
    text: item.text,
    authorName: item.author ?? '',
    authorHeadline: '',
    authorFollowers: 0,
    url: item.sourceUrl,
    postedAt: item.publishedAt ?? item.collectedAt,
    reactions: item.likes ?? 0,
    comments: item.comments ?? 0,
    reposts: item.shares ?? 0,
    views: item.views ?? 0,
    viewsAvailable,
    hashtags: item.hashtags,
    keyword,
    sourceName,
    platform,
    metricsAvailable,
  }
}

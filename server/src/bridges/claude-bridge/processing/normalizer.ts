/**
 * NORMALISER — source candidates into one validated shape.
 *
 * Source validation happens here: a URL on another host, or a platform URL
 * that is not an individual post or article (a profile, a company page, a job
 * listing), is rejected and counted. Only what survives can reach the output.
 *
 * DATES, IN ORDER OF TRUST:
 *   1. decoded from the platform's post id — exact, and published by the
 *      platform itself (`date_source: "platform_id"`);
 *   2. a full date written in the URL path (`date_source: "url_path"`);
 *   3. stated by the source (`date_source: "source"`), if it parses to a real
 *      instant that is not in the future;
 *   4. otherwise `date_status: "unknown"` and `published_at: null` — a later
 *      step may still read the page's own published-date tag (open web only,
 *      see `page-metadata.ts`).
 * Relative phrases ("3d ago") are not parsed — they are an estimate relative
 * to a capture time, not a date.
 */

import { createHash } from 'node:crypto'
import type { AdapterId, BridgeConfig } from '../config'
import type { SourceCandidate } from '../adapters/source-types'
import type { ContentType, PlatformModule } from '../platforms'
import { dateFromUrlPath } from '../platforms/web'
import type { DateSource, DateStatus, Engagement } from '../schemas/trend-output'

export interface Hashtag {
  /** Lower-case, no `#` — the comparison key. */
  key: string
  /** As the author wrote it, with `#`. */
  display: string
}

export interface NormalizedCandidate {
  key: string
  url: string | null
  itemId: string | null
  contentType: ContentType
  published_at: string | null
  date_status: DateStatus
  date_source: DateSource
  title: string | null
  /** Title + body, for analysis only. Never returned whole. */
  analysisText: string
  snippet: string | null
  hashtags: Hashtag[]
  author: string | null
  engagement: Engagement | null
  adapters: Set<AdapterId>
  queries: Set<string>
  keywords: Set<string>
}

export interface NormalizeOutcome {
  items: NormalizedCandidate[]
  rejected: { off_platform: number; not_a_post: number; empty: number }
}

const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

/** A stated timestamp as an ISO string, or `null` when it is not a real, past instant. */
export function parseSourceDate(value: unknown, now: Date): string | null {
  let ms: number | null = null
  if (typeof value === 'number' && Number.isFinite(value)) {
    ms = value < 1e11 ? value * 1000 : value
  } else if (typeof value === 'string') {
    const s = value.trim()
    if (/^\d{9,13}$/.test(s)) {
      const n = Number(s)
      ms = n < 1e11 ? n * 1000 : n
    } else if (/^\d{4}-\d{2}-\d{2}/.test(s)) {
      const parsed = Date.parse(s)
      ms = Number.isNaN(parsed) ? null : parsed
    }
  }
  if (ms === null) return null
  if (ms > now.getTime() + FUTURE_TOLERANCE_MS || ms < Date.UTC(2003, 0, 1)) return null
  return new Date(ms).toISOString()
}

const HASHTAG_RE = /#([\p{L}\p{N}_]+)/gu

export function extractHashtags(stated: readonly string[], ...texts: Array<string | null>): Hashtag[] {
  const out = new Map<string, Hashtag>()
  const add = (raw: string): void => {
    const body = raw.replace(/^#/, '').trim()
    // `#1` is a numbering, not a hashtag.
    if (body === '' || /^\d+$/.test(body)) return
    const key = body.toLowerCase()
    if (!out.has(key)) out.set(key, { key, display: `#${body}` })
  }
  for (const tag of stated) add(tag)
  for (const text of texts) {
    if (!text) continue
    for (const m of text.matchAll(HASHTAG_RE)) add(m[1] as string)
  }
  return [...out.values()]
}

export function toSnippet(text: string | null, maxChars: number): string | null {
  if (text === null) return null
  const flat = text.replace(/\s+/g, ' ').trim()
  if (flat === '') return null
  if (flat.length <= maxChars) return flat
  const cut = flat.slice(0, maxChars - 1)
  const lastSpace = cut.lastIndexOf(' ')
  return `${(lastSpace > maxChars * 0.6 ? cut.slice(0, lastSpace) : cut).trimEnd()}…`
}

function textKey(text: string): string {
  return createHash('sha1').update(text.toLowerCase().replace(/\s+/g, ' ').trim().slice(0, 400)).digest('hex').slice(0, 16)
}

export function normalizeCandidates(
  candidates: readonly SourceCandidate[],
  platform: PlatformModule,
  cfg: BridgeConfig,
  now: Date,
): NormalizeOutcome {
  const rejected = { off_platform: 0, not_a_post: 0, empty: 0 }
  const items: NormalizedCandidate[] = []

  for (const c of candidates) {
    const title = c.title?.trim() || null
    const body = c.text?.trim() || null
    let url: string | null = null
    let itemId: string | null = null
    let contentType: ContentType = 'unknown'

    if (c.url !== null && c.url.trim() !== '') {
      if (!platform.isPlatformHost(c.url)) {
        rejected.off_platform += 1
        continue
      }
      const classified = platform.classifyUrl(c.url)
      if (classified === null) {
        rejected.not_a_post += 1
        continue
      }
      url = classified.canonical
      itemId = classified.itemId
      contentType = classified.contentType
    } else if (title === null && body === null) {
      rejected.empty += 1
      continue
    }

    let published_at: string | null = null
    let date_status: DateStatus = 'unknown'
    let date_source: DateSource = null
    const decoded = itemId === null ? null : platform.dateFromItemId(itemId)
    const fromPath = decoded === null && url !== null ? dateFromUrlPath(url, now) : null
    if (decoded !== null) {
      published_at = decoded.toISOString()
      date_status = 'verified'
      date_source = 'platform_id'
    } else if (fromPath !== null) {
      published_at = fromPath.toISOString()
      date_status = 'verified'
      date_source = 'url_path'
    } else {
      const stated = parseSourceDate(c.published_at, now)
      if (stated !== null) {
        published_at = stated
        date_status = 'verified'
        date_source = 'source'
      }
    }

    const analysisText = [title, body].filter((s): s is string => s !== null).join('\n')
    const key = itemId !== null ? `${platform.id}:id:${itemId}` : url !== null ? `url:${url}` : `text:${textKey(analysisText)}`

    items.push({
      key,
      url,
      itemId,
      contentType,
      published_at,
      date_status,
      date_source,
      title,
      analysisText,
      snippet: toSnippet(body ?? title, cfg.snippet_max_chars),
      hashtags: extractHashtags(c.hashtags, title, body),
      // A news story's "author" is its publisher (TechCrunch, Inc42) — a publication, not a person — so the web lane keeps it.
      author: cfg.include_author_names || platform.id === 'web' ? (c.author?.trim() || null) : null,
      engagement: c.engagement,
      adapters: new Set([c.adapter]),
      queries: new Set(c.query === null ? [] : [c.query]),
      keywords: new Set(c.keyword === null ? [] : [c.keyword]),
    })
  }

  return { items, rejected }
}

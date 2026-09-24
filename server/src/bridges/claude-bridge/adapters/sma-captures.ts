/**
 * `sma_captures` — platform posts the SMA has already captured.
 *
 * Reads `scraped_items` rows whose URL is on the platform, so a trend question
 * asked between Scraping Agent runs is answered from what was already
 * acquired, at no acquisition cost. It is not offered to the Scraping Agent
 * itself — that would be the agent re-reading its own output.
 *
 * DATES ARE HANDLED STRICTLY. Earlier capture paths (the Parallel open-web
 * lane among them) wrote the capture time into `posted_at` when a source
 * stated no date, so a stored `posted_at` is trusted ONLY on rows the Claude
 * Bridge captured — it verified every date it stored. Any other row's date is
 * re-derived by the normaliser (post id, URL, page metadata) or reported as
 * unknown.
 */

import { config } from '../../../config'
import { query as dbQuery } from '../../../db/pool'
import type { AdapterId } from '../config'
import type { PlatformModule } from '../platforms'
import {
  SourceError,
  queryTerms,
  type SearchRequest,
  type SourceCandidate,
  type TrendSourceAdapter,
} from './source-types'

const ID: AdapterId = 'sma_captures'
const CAPTURE_CLOCK_TOLERANCE_MS = 60_000

interface CaptureRow {
  url: string
  source_name: string | null
  title: string
  snippet: string | null
  hashtags: string[]
  posted_at: string | null
  scraped_at: string
  metrics_available: boolean
  reactions: number
  comments: number
  reposts: number
}

/** Rows the bridge captured carry a `source_name` beginning with this. */
const BRIDGE_SOURCE_PREFIX = 'Claude Bridge'

function statedDate(row: CaptureRow): string | null {
  if (row.posted_at === null || !(row.source_name ?? '').startsWith(BRIDGE_SOURCE_PREFIX)) return null
  const posted = Date.parse(row.posted_at)
  const scraped = Date.parse(row.scraped_at)
  if (!Number.isFinite(posted)) return null
  // Belt and braces: even a bridge row whose date equals its capture clock is not trusted.
  if (Number.isFinite(scraped) && Math.abs(scraped - posted) <= CAPTURE_CLOCK_TOLERANCE_MS) return null
  return new Date(posted).toISOString()
}

export function createSmaCapturesAdapter(platform: PlatformModule): TrendSourceAdapter {
  async function search(req: SearchRequest): Promise<SourceCandidate[]> {
    const terms = queryTerms(req.query.text)
    if (terms === '') return []
    // A lookback a little wider than the window: the date filter is applied
    // later, on the date the normaliser settles on, not on `scraped_at`.
    let rows: CaptureRow[]
    try {
      rows = await dbQuery<CaptureRow>(
        `SELECT si.url, si.source_name, si.title, si.snippet, si.hashtags, si.posted_at, si.scraped_at,
                si.metrics_available, si.reactions, si.comments, si.reposts
           FROM scraped_items si
           JOIN workspaces w ON w.id = si.workspace_id
          WHERE w.slug = $1
            AND si.url IS NOT NULL
            AND (($2 = 'web' AND si.platform IS NULL) OR si.platform = $2)
            AND si.scraped_at >= $3
            AND (si.title ILIKE $4 OR si.snippet ILIKE $4 OR array_to_string(si.hashtags, ' ') ILIKE $5)
          ORDER BY si.scraped_at DESC
          LIMIT $6`,
        [
          config.core.workspaceSlug,
          platform.id,
          req.window.from.toISOString(),
          `%${terms}%`,
          `%${terms.replace(/\s+/g, '')}%`,
          req.maxResults,
        ],
      )
    } catch (error) {
      throw new SourceError(ID, `The SMA database could not be read — ${error instanceof Error ? error.message : String(error)}`, true)
    }

    return rows.map((row) => ({
      adapter: ID,
      query: req.query.text,
      keyword: req.query.keyword,
      url: row.url,
      published_at: statedDate(row),
      title: row.title,
      text: row.snippet,
      hashtags: row.hashtags,
      author: null,
      engagement: row.metrics_available
        ? { reactions: row.reactions, comments: row.comments, reposts: row.reposts }
        : null,
    }))
  }

  return {
    id: ID,
    label: `SMA captures already stored (${platform.label})`,
    kind: 'store',
    platform,
    availability: () =>
      config.core.databaseUrl === ''
        ? { available: false, reason: 'DATABASE_URL is not set, so stored captures cannot be read.' }
        : { available: true, reason: '' },
    search_topics: search,
    search_posts: search,
    search_hashtags: search,
    async get_post(url: string) {
      const rows = await dbQuery<CaptureRow>(
        `SELECT si.url, si.source_name, si.title, si.snippet, si.hashtags, si.posted_at, si.scraped_at,
                si.metrics_available, si.reactions, si.comments, si.reposts
           FROM scraped_items si JOIN workspaces w ON w.id = si.workspace_id
          WHERE w.slug = $1 AND si.url = $2 LIMIT 1`,
        [config.core.workspaceSlug, url],
      )
      const row = rows[0]
      if (row === undefined) return null
      return {
        adapter: ID,
        query: null,
        keyword: null,
        url: row.url,
        published_at: statedDate(row),
        title: row.title,
        text: row.snippet,
        hashtags: row.hashtags,
        author: null,
        engagement: row.metrics_available
          ? { reactions: row.reactions, comments: row.comments, reposts: row.reposts }
          : null,
      }
    },
  }
}

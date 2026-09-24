/**
 * `manual_urls` — posts a person (or Claude, in conversation) supplied.
 *
 * Two inputs: URLs passed on a call (`post_urls`), and an optional JSON file
 * an operator maintains (`acquisition.manual_urls_file` or
 * `LINKEDIN_TRENDS_MANUAL_URLS_FILE`) holding either bare URLs or objects
 * `{ url, published_at?, title?, text?, hashtags? }`.
 *
 * Nothing is fetched. A bare URL carries only what the URL itself states —
 * for LinkedIn, often the post's slug and an activity id the date can be
 * decoded from. Metadata in the file is the operator's statement and is
 * passed through as such.
 */

import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { repoPath, type AdapterId, type BridgeConfig } from '../config'
import type { PlatformModule } from '../platforms'
import {
  SourceError,
  textAnswersQuery,
  type SearchRequest,
  type SourceCandidate,
  type TrendSourceAdapter,
} from './source-types'

const ID: AdapterId = 'manual_urls'

const entrySchema = z.union([
  z.string().url(),
  z.object({
    url: z.string().url(),
    published_at: z.string().nullable().optional(),
    title: z.string().nullable().optional(),
    text: z.string().nullable().optional(),
    hashtags: z.array(z.string()).optional(),
  }),
])
const fileSchema = z.union([z.array(entrySchema), z.object({ posts: z.array(entrySchema) })])

function toCandidate(entry: z.infer<typeof entrySchema>): SourceCandidate {
  const e = typeof entry === 'string' ? { url: entry } : entry
  return {
    adapter: ID,
    query: null,
    keyword: null,
    url: e.url,
    published_at: e.published_at ?? null,
    title: e.title ?? null,
    text: e.text ?? null,
    hashtags: e.hashtags ?? [],
    author: null,
    engagement: null,
  }
}

export function loadManualFile(path: string): SourceCandidate[] {
  const resolved = repoPath(path)
  if (!existsSync(resolved)) {
    throw new SourceError(ID, `Manual URL file not found at ${resolved}`)
  }
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(resolved, 'utf8'))
  } catch (error) {
    throw new SourceError(ID, `Manual URL file ${resolved} is not valid JSON — ${error instanceof Error ? error.message : String(error)}`)
  }
  const parsed = fileSchema.safeParse(raw)
  if (!parsed.success) {
    throw new SourceError(ID, `Manual URL file ${resolved} has an invalid entry: ${parsed.error.issues[0]?.path.join('.') ?? ''} ${parsed.error.issues[0]?.message ?? ''}`)
  }
  const entries = Array.isArray(parsed.data) ? parsed.data : parsed.data.posts
  return entries.map(toCandidate)
}

export function createManualUrlsAdapter(
  platform: PlatformModule,
  cfg: BridgeConfig,
  suppliedUrls: readonly string[] = [],
): TrendSourceAdapter {
  const file = cfg.acquisition.manual_urls_file

  function pool(): SourceCandidate[] {
    const fromFile = file === null ? [] : loadManualFile(file)
    return [...suppliedUrls.map((url) => toCandidate(url)), ...fromFile]
  }

  function search(req: SearchRequest): Promise<SourceCandidate[]> {
    const hits = pool()
      .filter((c) => textAnswersQuery(`${c.url ?? ''} ${c.title ?? ''} ${c.text ?? ''} ${c.hashtags.join(' ')}`, req.query.text))
      .slice(0, req.maxResults)
      .map((c) => ({ ...c, query: req.query.text, keyword: req.query.keyword }))
    return Promise.resolve(hits)
  }

  return {
    id: ID,
    label: `Operator-supplied URLs (${platform.label})`,
    kind: 'manual',
    platform,
    availability() {
      if (suppliedUrls.length === 0 && file === null) {
        return { available: false, reason: 'No post URLs were supplied and no manual URL file is configured.' }
      }
      return { available: true, reason: '' }
    },
    search_topics: search,
    search_posts: search,
    search_hashtags: search,
    async get_post(url: string) {
      return pool().find((c) => c.url === url) ?? null
    },
  }
}

/** Every URL the adapter holds, for direct inclusion (supplied URLs are analysed whether or not a query matches them). */
export function suppliedCandidates(urls: readonly string[]): SourceCandidate[] {
  return urls.map((url) => toCandidate(url))
}

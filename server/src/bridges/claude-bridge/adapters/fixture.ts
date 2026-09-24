/**
 * `fixture` — test data, and only test data.
 *
 * Reads a JSON file of sample posts so the whole processing pipeline can run
 * without any external request. Every run that uses it reports
 * `source_status: "fixture"`, and the Markdown rendering carries a banner
 * saying the rows are not LinkedIn data. It is never in a production adapter
 * list by default.
 */

import { existsSync, readFileSync } from 'node:fs'
import { z } from 'zod'
import { repoPath, type AdapterId } from '../config'
import type { PlatformModule } from '../platforms'
import {
  SourceError,
  textAnswersQuery,
  type SearchRequest,
  type SourceCandidate,
  type TrendSourceAdapter,
} from './source-types'

const ID: AdapterId = 'fixture'

export const DEFAULT_FIXTURE_FILE = 'tests/fixtures/claude-bridge/linkedin-posts.json'

const postSchema = z.object({
  url: z.string().nullable(),
  published_at: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  text: z.string().nullable().optional(),
  hashtags: z.array(z.string()).optional(),
  author: z.string().nullable().optional(),
  engagement: z
    .object({ reactions: z.number().nullable(), comments: z.number().nullable(), reposts: z.number().nullable() })
    .nullable()
    .optional(),
})

export const fixtureFileSchema = z.object({
  $comment: z.string().optional(),
  /** The moment the fixture was authored against; sample runs pin "now" to it so results are stable. */
  reference_time: z.string(),
  posts: z.array(postSchema),
})

export type FixtureFile = z.infer<typeof fixtureFileSchema>

export function loadFixtureFile(path: string = DEFAULT_FIXTURE_FILE): FixtureFile {
  const resolved = repoPath(path)
  if (!existsSync(resolved)) throw new SourceError(ID, `Fixture file not found at ${resolved}`, true)
  const parsed = fixtureFileSchema.safeParse(JSON.parse(readFileSync(resolved, 'utf8')))
  if (!parsed.success) {
    throw new SourceError(ID, `Fixture file ${resolved} is invalid: ${parsed.error.issues[0]?.message ?? ''}`, true)
  }
  return parsed.data
}

export function createFixtureAdapter(platform: PlatformModule, fixture: FixtureFile): TrendSourceAdapter {
  const posts: SourceCandidate[] = fixture.posts.map((p) => ({
    adapter: ID,
    query: null,
    keyword: null,
    url: p.url,
    published_at: p.published_at ?? null,
    title: p.title ?? null,
    text: p.text ?? null,
    hashtags: p.hashtags ?? [],
    author: p.author ?? null,
    engagement: p.engagement ?? null,
  }))

  function search(req: SearchRequest): Promise<SourceCandidate[]> {
    return Promise.resolve(
      posts
        .filter((c) =>
          textAnswersQuery(`${c.url ?? ''} ${c.title ?? ''} ${c.text ?? ''} ${c.hashtags.map((h) => `#${h.replace(/^#/, '')}`).join(' ')}`, req.query.text),
        )
        .slice(0, req.maxResults)
        .map((c) => ({ ...c, query: req.query.text, keyword: req.query.keyword })),
    )
  }

  return {
    id: ID,
    label: `Fixture data — not ${platform.label}`,
    kind: 'fixture',
    platform,
    availability: () => ({ available: true, reason: '' }),
    search_topics: search,
    search_posts: search,
    search_hashtags: search,
    async get_post(url: string) {
      return posts.find((c) => c.url === url) ?? null
    },
  }
}

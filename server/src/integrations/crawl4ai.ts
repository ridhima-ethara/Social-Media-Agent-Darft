/**
 * CRAWL4AI — keyword-driven, platform-scoped open-web capture.
 *
 * THE ONLY SCRAPING ADAPTER. Every live post the pipeline sees, on every
 * platform, comes from this module. There is no paid connector and no bundled
 * fixture corpus behind it — see the module note in `backend/tools/crawl.py`
 * for exactly what that means and does not mean per platform: LinkedIn and X
 * indexing is real and searchable via `site:`; Instagram render almost
 * nothing to a logged-out fetch, and that emptiness is reported, not papered
 * over with an invented post.
 *
 * WHY A SUBPROCESS, NOT `fetchJson`. crawl4ai drives a headless browser, which
 * is a local process rather than an endpoint. `fetchJson` is the only HTTP path
 * for everything else in the codebase and stays that way; this adapter uses the
 * same process boundary the agent bridge in `api.ts` already uses, and reads
 * its result from a temp file so the sidecar's progress log can never corrupt
 * the payload.
 *
 * ON THE ENGAGEMENT FIELDS (constraint 2 — `N/A` is never `0`). A web page has
 * no reaction count, and the sidecar refuses to invent one: it returns no
 * engagement fields at all. `RawPost` requires the trio, so they arrive as 0 —
 * but these posts are captured with `sourceType: 'Website'`, and
 * `credibilityBase()` scores that tier on provenance (80) rather than on
 * engagement. The zeros are therefore never read as "this performed badly";
 * they are read as "this is not a social artefact". That distinction is carried
 * on the record itself via `sourceName`, so it survives into the UI.
 *
 * The bodies are untrusted. They reach nothing without passing through
 * `prepareEvidence()` at the point of capture, in `agents/scraping/handlers.ts`.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { Platform, ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError } from './adapter'

/** What the rest of the pipeline consumes, regardless of platform. */
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
  /** The keyword whose query surfaced this post. */
  keyword: string
  sourceName: string
}

const HERE = dirname(fileURLToPath(import.meta.url))
/** `server/src/integrations` → repo root → `backend`. */
const BACKEND_DIR = join(HERE, '..', '..', '..', 'backend')

export interface Crawl4aiSearchInput {
  keyword: string
  /**
   * Scopes the search to one platform's domain via a `site:` query — see the
   * module note in `backend/tools/crawl.py`. Omitted (or `undefined`) reads
   * the open web instead, which is what the hashtag-expansion and knowledge
   * research paths want: a hashtag or topic reading that is not itself tied
   * to one platform's indexed content.
   */
  platform?: Platform
  /** Pages to crawl for this keyword. */
  maxItems: number
  /** Characters kept per page, so one verbose page cannot crowd out the rest. */
  maxCharsPerPage: number
}

/** The sidecar's contract. Deliberately has no engagement fields. */
interface WebEvidenceRow {
  externalId: string
  url: string
  title: string
  text: string
  siteName: string
  keyword: string
  authorName: string
  /** Only present when the page itself stated a date. */
  publishedAt: string | null
  capturedAt: string
  hashtags: string[]
  metricsAvailable: boolean
}

interface CrawlPayload {
  posts?: WebEvidenceRow[]
  engines?: string[]
  errors?: string[]
}

/**
 * Runs the sidecar and parses its JSON.
 *
 * The result is read from a file rather than stdout because crawl4ai's progress
 * logger is not fully silenceable, and a data channel that a dependency can
 * write to is a data channel that will eventually be corrupted.
 */
async function runSidecar(
  input: Crawl4aiSearchInput,
  adapterId: string,
): Promise<CrawlPayload> {
  const dir = await mkdtemp(join(tmpdir(), 'ethara-crawl-'))
  const outPath = join(dir, 'result.json')

  const args = [
    '-m',
    'tools.crawl',
    '--keywords',
    input.keyword,
    '--max-pages',
    String(Math.max(1, input.maxItems)),
    '--max-chars',
    String(Math.max(500, input.maxCharsPerPage)),
    '--engines',
    config.crawl4ai.searchEngines.join(','),
    '--delay-ms',
    String(Math.max(0, config.crawl4ai.delayMs)),
    '--out',
    outPath,
  ]

  if (!config.crawl4ai.headless) args.push('--headed')

  try {
    const stderr = await new Promise<string>((resolve, reject) => {
      // `cwd` is the backend dir so `-m tools.crawl` resolves, mirroring how
      // the runtime process sets cwd for the Agent SDK.
      const child = spawn(config.crawl4ai.python, args, {
        cwd: BACKEND_DIR,
        env: { ...process.env, PYTHONUNBUFFERED: '1' },
      })

      let errBuffer = ''
      let settled = false

      const timer = setTimeout(() => {
        settled = true
        child.kill('SIGKILL')
        reject(
          new AdapterError(
            adapterId,
            `the crawl4ai sidecar exceeded ${config.crawl4ai.timeoutMs}ms for “${input.keyword}”`,
          ),
        )
      }, config.crawl4ai.timeoutMs)

      // Bounded, so a chatty crawl cannot grow the buffer without limit.
      child.stderr.on('data', (chunk: Buffer) => {
        if (errBuffer.length < 8_000) errBuffer += chunk.toString()
      })
      // stdout is drained and discarded: the payload arrives via --out.
      child.stdout.on('data', () => {})

      child.on('error', (error) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        reject(
          new AdapterError(
            adapterId,
            `could not start the crawl4ai sidecar (${config.crawl4ai.python}) — ${error.message}`,
          ),
        )
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        if (code === 0) {
          resolve(errBuffer)
          return
        }
        reject(
          new AdapterError(
            adapterId,
            `the crawl4ai sidecar exited ${code}`,
            undefined,
            errBuffer.slice(-240).replace(/\s+/g, ' ').trim() || undefined,
          ),
        )
      })
    })

    void stderr

    let parsed: CrawlPayload
    try {
      parsed = JSON.parse(await readFile(outPath, 'utf-8')) as CrawlPayload
    } catch {
      throw new AdapterError(adapterId, 'the crawl4ai sidecar produced no readable result')
    }

    return parsed
  } finally {
    // The temp dir goes whatever happened, including on the timeout path.
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * Maps a crawled page onto `RawPost`.
 *
 * `postedAt` uses the page's own stated date when it has one and the capture
 * time otherwise — and `sourceName` records which of the two it was, because a
 * freshness score computed from a capture time is a different claim from one
 * computed from a publication date, and the operator is entitled to know which
 * they are looking at.
 */
function toRawPost(row: WebEvidenceRow, keyword: string): RawPost {
  const dated = row.publishedAt !== null && row.publishedAt !== ''
  return {
    externalId: row.externalId,
    text: row.text,
    authorName: row.authorName || row.siteName,
    authorHeadline: dated ? row.siteName : `${row.siteName} · no publication date stated`,
    // Not a follower count and not claimed as one. A website has no followers.
    authorFollowers: 0,
    url: row.url,
    postedAt: dated ? (row.publishedAt as string) : row.capturedAt,
    // See the module note: a page has no reactions. Scored on provenance.
    reactions: 0,
    comments: 0,
    reposts: 0,
    // Whatever the sidecar reported, and nothing more. There is deliberately no
    // `extractHashtagsFromText` fallback here: that helper exists for social
    // bodies, where a `#token` IS a hashtag. On a web page a `#token` is a URL
    // fragment — running it would resurrect `#cite_note` from Wikipedia
    // footnotes and publish it as audience vocabulary.
    hashtags: row.hashtags,
    keyword,
    sourceName: `crawl4ai · ${row.siteName}`,
  }
}

export const crawl4aiSearch: ServiceAdapter<Crawl4aiSearchInput, RawPost[]> = {
  id: 'crawl4ai.search',
  label: 'crawl4ai · open web (local)',

  isConfigured(): boolean {
    return config.crawl4ai.configured
  },

  unavailableReason(): string {
    return 'CRAWL4AI_PYTHON is not set'
  },

  async run(input: Crawl4aiSearchInput): Promise<RawPost[]> {
    if (!this.isConfigured()) throw new AdapterError(this.id, this.unavailableReason())

    const payload = await runSidecar(input, this.id)
    const rows = payload.posts ?? []

    // An empty live result throws rather than reporting a successful zero, so
    // the caller falls back and names the reason — the same choice `apify.ts`
    // makes, and for the same reason: "nothing found" and "nothing worked" look
    // identical downstream unless one of them is an error.
    if (rows.length === 0) {
      const first = payload.errors?.[0]
      throw new AdapterError(
        this.id,
        first
          ? `no usable pages for “${input.keyword}” — ${first}`
          : `no usable pages for “${input.keyword}”`,
      )
    }

    return rows.map((row) => toRawPost(row, input.keyword))
  },
}

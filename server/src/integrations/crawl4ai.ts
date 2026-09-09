/**
 * CRAWL4AI — keyword-driven, platform-scoped open-web capture.
 *
 * THE ONLY SCRAPING ADAPTER. Every post the pipeline sees, on every platform,
 * comes from this module. There is no paid connector behind it and no bundled
 * fixture corpus underneath it: when a keyword returns nothing, the run says
 * so rather than substituting invented material.
 *
 * PLATFORM SCOPING. `platform` narrows the search to one domain via a `site:`
 * query — see the module note in `backend/tools/crawl.py` for exactly what that
 * reads and what it does not. LinkedIn and X index a great deal of public
 * content that a search engine will surface; Instagram and Facebook index far
 * less, and that thinness is reported as an empty result, never papered over.
 * `platform: undefined` reads the open web instead, which is what the
 * knowledge-research path wants: a topic reading not tied to one platform.
 *
 * WHY A SUBPROCESS, NOT `fetchJson`. crawl4ai drives a headless browser, which
 * is a local process rather than an endpoint. `fetchJson` is the only HTTP path
 * for everything else in the codebase and stays that way; this adapter uses the
 * same process boundary the agent bridge in `api.ts` already uses, and reads
 * its result from a temp file so the sidecar's progress log can never corrupt
 * the payload.
 *
 * ON THE ENGAGEMENT FIELDS (constraint 2 — `N/A` is never `0`). A crawled page
 * has no reaction count, and the sidecar refuses to invent one: it returns no
 * engagement fields at all. `RawPost` requires the trio, so they arrive as 0 —
 * but these posts carry `metricsAvailable: false`, and `credibilityBase()`
 * scores them on provenance rather than on engagement. The zeros are therefore
 * never read as "this performed badly"; they are read as "this is not a
 * metrics-bearing artefact". That distinction is carried on the record itself,
 * so it survives into the UI.
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
  /**
   * The platform this row was captured FOR — `null` for the open-web tier.
   * Recorded rather than re-derived from the URL, so a consumer never has to
   * parse a host to know which platform lane an item belongs to.
   */
  platform: Platform | null
  /**
   * Whether the source could state engagement figures. Always false today,
   * because a search-indexed page carries none. Present so that the zeros in
   * the three count fields are readable as "not applicable" rather than "zero".
   */
  metricsAvailable: boolean
}

const HERE = dirname(fileURLToPath(import.meta.url))
/** `server/src/integrations` → repo root → `backend`. */
const BACKEND_DIR = join(HERE, '..', '..', '..', 'backend')

export interface Crawl4aiSearchInput {
  keyword: string
  /**
   * Scopes the search to one platform's domain via a `site:` query. Omitted
   * reads the open web instead.
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
  platform: string | null
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

  // Blank is the sidecar's own spelling of "open web", so an unscoped search
  // and a scoped one differ by a value rather than by the shape of the call.
  if (input.platform !== undefined) args.push('--platform', input.platform)

  if (!config.crawl4ai.headless) args.push('--headed')

  const scope = input.platform ?? 'open web'

  try {
    await new Promise<void>((resolve, reject) => {
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
            `the crawl4ai sidecar exceeded ${config.crawl4ai.timeoutMs}ms for “${input.keyword}” on ${scope}`,
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
          resolve()
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
 * time otherwise — and `authorHeadline` records which of the two it was,
 * because a freshness score computed from a capture time is a different claim
 * from one computed from a publication date, and the operator is entitled to
 * know which they are looking at.
 */
function toRawPost(row: WebEvidenceRow, input: Crawl4aiSearchInput): RawPost {
  const dated = row.publishedAt !== null && row.publishedAt !== ''
  const platform = input.platform ?? null
  return {
    externalId: row.externalId,
    text: row.text,
    authorName: row.authorName || row.siteName,
    authorHeadline: dated ? row.siteName : `${row.siteName} · no publication date stated`,
    // Not a follower count and not claimed as one. A crawled page has none.
    authorFollowers: 0,
    url: row.url,
    postedAt: dated ? (row.publishedAt as string) : row.capturedAt,
    // See the module note: a crawled page has no reactions. Scored on provenance.
    reactions: 0,
    comments: 0,
    reposts: 0,
    // Whatever the sidecar reported, and nothing more. There is deliberately no
    // `extractHashtagsFromText` fallback here: that helper exists for social
    // bodies, where a `#token` IS a hashtag. On a rendered page a `#token` is a
    // URL fragment — running it would resurrect `#cite_note` from Wikipedia
    // footnotes and publish it as audience vocabulary.
    hashtags: row.hashtags,
    keyword: input.keyword,
    sourceName: `crawl4ai · ${row.siteName}`,
    platform,
    metricsAvailable: row.metricsAvailable === true,
  }
}

export const crawl4aiSearch: ServiceAdapter<Crawl4aiSearchInput, RawPost[]> = {
  id: 'crawl4ai.search',
  label: 'crawl4ai · headless capture (local)',

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
    const scope = input.platform ?? 'the open web'

    // An empty result throws rather than reporting a successful zero, so the
    // caller names the reason: "nothing found" and "nothing worked" look
    // identical downstream unless one of them is an error. There is nothing to
    // fall back TO any more — the caller records the gap and carries on with
    // the platforms that did answer.
    if (rows.length === 0) {
      const first = payload.errors?.[0]
      throw new AdapterError(
        this.id,
        first
          ? `no usable pages for “${input.keyword}” on ${scope} — ${first}`
          : `no usable pages for “${input.keyword}” on ${scope}`,
      )
    }

    return rows.map((row) => toRawPost(row, input))
  },
}

/**
 * RESEARCH SOURCES CONNECTOR
 *
 * arXiv · Semantic Scholar · Papers with Code · GDELT, plus the deep-research
 * adapter. Every source returns the same `ResearchResult` shape, so the
 * Knowledge Agent does not branch on which one answered — falling back changes
 * which implementation is bound, never which code path runs.
 *
 * Everything returned here is **untrusted content**. It must pass through the
 * evidence wrapper before any model reads it (Constraint 5).
 */

import type { Citation, Connector, ConnectorHealth, Sourced } from '../../contracts/src/index'
import { readRaw } from '../../config/src/loader'

/* ═══════════════════════════════════════════════════════════════════════════
   THE SHAPE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResearchQuery {
  /** What is materially new about this topic, in this window. */
  topic: string
  windowDays: number
  maxResults: number
  maxCharsPerResult: number
}

export interface ResearchResult {
  title: string
  /** Untrusted. Wrap before it reaches a model. */
  content: string
  citations: Citation[]
  /** Which source produced it, for the citation and for debugging. */
  sourceId: string
  publishedAt?: string
}

export type ResearchResponse = Sourced<{
  results: ResearchResult[]
  /** Sources that could not be read, named rather than silently skipped. */
  unreachable: string[]
}>

export interface ResearchSource extends Connector {
  /** Runs the query, or throws. Callers wrap and fall back. */
  search(query: ResearchQuery): Promise<ResearchResult[]>
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SOURCES
   ═══════════════════════════════════════════════════════════════════════════ */

const TIMEOUT_MS = 20_000

async function getJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    signal: AbortSignal.timeout(TIMEOUT_MS),
    headers: { Accept: 'application/json' },
  })
  if (!response.ok) throw new Error(`${url} returned ${response.status}`)
  return (await response.json()) as T
}

/**
 * arXiv. Open, keyless, and the primary source for this domain — which is why
 * it is first and why its absence is a real degradation rather than a nuisance.
 */
export const arxivSource: ResearchSource = {
  id: 'arxiv',
  label: 'arXiv · cs.LG, cs.AI, cs.CL',

  health(): ConnectorHealth {
    return {
      id: 'arxiv',
      label: 'arXiv',
      configured: true,
      reason: 'Open API, no key required.',
      envKey: '',
    }
  },

  async search(query) {
    // arXiv answers Atom, not JSON, so this one parses text rather than getJson.
    const search = encodeURIComponent(`all:"${query.topic}"`)
    const url = `http://export.arxiv.org/api/query?search_query=${search}&sortBy=submittedDate&sortOrder=descending&max_results=${query.maxResults}`

    const response = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) })
    if (!response.ok) throw new Error(`arXiv returned ${response.status}`)
    const xml = await response.text()

    const entries = xml.split('<entry>').slice(1)
    const cutoff = Date.now() - query.windowDays * 86_400_000

    return entries.flatMap((entry) => {
      const pick = (tag: string): string =>
        new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`).exec(entry)?.[1]?.trim() ?? ''

      const published = pick('published')
      if (published && new Date(published).getTime() < cutoff) return []

      const title = pick('title').replace(/\s+/g, ' ')
      const summary = pick('summary').replace(/\s+/g, ' ')
      const link = /<id>([\s\S]*?)<\/id>/.exec(entry)?.[1]?.trim() ?? ''
      if (!title || !link) return []

      return [
        {
          title,
          content: summary.slice(0, query.maxCharsPerResult),
          citations: [{ title, url: link, publishedAt: published }],
          sourceId: 'arxiv',
          publishedAt: published,
        },
      ]
    })
  },
}

/** Semantic Scholar. Keyless at low volume; a key raises the rate limit. */
export const semanticScholarSource: ResearchSource = {
  id: 'semantic-scholar',
  label: 'Semantic Scholar',

  health(): ConnectorHealth {
    const key = readRaw('SEMANTIC_SCHOLAR_API_KEY')
    return {
      id: 'semantic-scholar',
      label: 'Semantic Scholar',
      configured: true,
      reason: key.reported
        ? 'Keyed — the higher rate limit applies.'
        : 'Keyless. Works, but rate-limited; SEMANTIC_SCHOLAR_API_KEY raises the ceiling.',
      envKey: 'SEMANTIC_SCHOLAR_API_KEY',
    }
  },

  async search(query) {
    const fields = 'title,abstract,url,year,publicationDate,externalIds'
    const url =
      `https://api.semanticscholar.org/graph/v1/paper/search` +
      `?query=${encodeURIComponent(query.topic)}&limit=${query.maxResults}&fields=${fields}`

    const payload = await getJson<{
      data?: Array<{
        title?: string
        abstract?: string
        url?: string
        publicationDate?: string
      }>
    }>(url)

    return (payload.data ?? []).flatMap((paper) => {
      if (!paper.title || !paper.url) return []
      return [
        {
          title: paper.title,
          content: (paper.abstract ?? '').slice(0, query.maxCharsPerResult),
          citations: [
            { title: paper.title, url: paper.url, publishedAt: paper.publicationDate },
          ],
          sourceId: 'semantic-scholar',
          publishedAt: paper.publicationDate,
        },
      ]
    })
  },
}

/** Papers with Code — what is actually being implemented, not just published. */
export const papersWithCodeSource: ResearchSource = {
  id: 'papers-with-code',
  label: 'Papers with Code',

  health(): ConnectorHealth {
    return {
      id: 'papers-with-code',
      label: 'Papers with Code',
      configured: true,
      reason: 'Open API, no key required.',
      envKey: '',
    }
  },

  async search(query) {
    const url = `https://paperswithcode.com/api/v1/papers/?q=${encodeURIComponent(query.topic)}&items_per_page=${query.maxResults}`
    const payload = await getJson<{
      results?: Array<{ title?: string; abstract?: string; url_abs?: string; published?: string }>
    }>(url)

    return (payload.results ?? []).flatMap((paper) => {
      if (!paper.title || !paper.url_abs) return []
      return [
        {
          title: paper.title,
          content: (paper.abstract ?? '').slice(0, query.maxCharsPerResult),
          citations: [{ title: paper.title, url: paper.url_abs, publishedAt: paper.published }],
          sourceId: 'papers-with-code',
          publishedAt: paper.published,
        },
      ]
    })
  },
}

/**
 * GDELT — press coverage rather than primary research. Deliberately weighted
 * below the academic sources: it establishes that something is being talked
 * about, not that it is true.
 */
export const gdeltSource: ResearchSource = {
  id: 'gdelt',
  label: 'GDELT · press coverage',

  health(): ConnectorHealth {
    return {
      id: 'gdelt',
      label: 'GDELT',
      configured: true,
      reason: 'Open API, no key required. Establishes coverage, not correctness.',
      envKey: '',
    }
  },

  async search(query) {
    const url =
      `https://api.gdeltproject.org/api/v2/doc/doc` +
      `?query=${encodeURIComponent(query.topic)}&mode=artlist&format=json&maxrecords=${query.maxResults}` +
      `&timespan=${Math.max(1, query.windowDays)}d`

    const payload = await getJson<{
      articles?: Array<{ title?: string; url?: string; seendate?: string; domain?: string }>
    }>(url)

    return (payload.articles ?? []).flatMap((article) => {
      if (!article.title || !article.url) return []
      return [
        {
          title: article.title,
          content: `Press coverage from ${article.domain ?? 'an unnamed outlet'}. Coverage establishes attention, not accuracy — treat as a signal that a topic is being discussed.`,
          citations: [{ title: article.title, url: article.url, publishedAt: article.seendate }],
          sourceId: 'gdelt',
          publishedAt: article.seendate,
        },
      ]
    })
  },
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE FAN-OUT
   ═══════════════════════════════════════════════════════════════════════════ */

export const RESEARCH_SOURCES: ResearchSource[] = [
  arxivSource,
  semanticScholarSource,
  papersWithCodeSource,
  gdeltSource,
]

/**
 * Queries every source concurrently and merges.
 *
 * One source failing never fails the sweep — it is named in `unreachable` and
 * the rest carry on. A caller that got three of four sources must be able to
 * tell, which is why the failure list is part of the result rather than a log
 * line nobody reads.
 */
export async function researchAll(query: ResearchQuery): Promise<ResearchResponse> {
  const unreachable: string[] = []

  const settled = await Promise.all(
    RESEARCH_SOURCES.map(async (source) => {
      try {
        return await source.search(query)
      } catch (error) {
        unreachable.push(
          `${source.label}: ${error instanceof Error ? error.message : 'unreachable'}`,
        )
        return [] as ResearchResult[]
      }
    }),
  )

  const results = settled.flat()

  // Everything failed. Say so plainly rather than returning an empty success.
  if (results.length === 0) {
    return {
      results: [],
      unreachable,
      source: 'fixture',
      fallbackReason:
        unreachable.length > 0
          ? `Every research source was unreachable: ${unreachable.join('; ')}`
          : 'No source returned a result for this topic.',
    }
  }

  return {
    results,
    unreachable,
    source: 'live',
    ...(unreachable.length > 0
      ? { fallbackReason: `Partial: ${unreachable.join('; ')}` }
      : {}),
  }
}

/**
 * Independent-source counting for the confidence band.
 *
 * Three URLs from one domain are **one** independent source. Counting them as
 * three is how a single blog post becomes "High confidence".
 */
export function countIndependentSources(citations: Citation[]): number {
  const domains = new Set<string>()
  for (const citation of citations) {
    try {
      domains.add(new URL(citation.url).hostname.replace(/^www\./, ''))
    } catch {
      domains.add(citation.url)
    }
  }
  return domains.size
}

export function healthOfAll(): ConnectorHealth[] {
  return RESEARCH_SOURCES.map((source) => source.health())
}

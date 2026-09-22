/**
 * PARALLEL WEB SYSTEMS — the deep research adapter.
 *
 * Asks what is materially new about a hashtag in a recent window, demanding
 * concrete findings, named sources, dates and figures, and excluding vendor
 * marketing. The objective text is part of the contract: the extraction step
 * downstream depends on getting cited claims back rather than prose.
 *
 * Blank `PARALLEL_API_KEY` ⇒ no research runs at all. There is no bundled
 * corpus behind this: an entry that cannot cite `minSources` independent URLs
 * is discarded downstream, and an uncited claim never enters the Knowledge
 * Base — which is precisely why there is nothing to substitute when the
 * adapter cannot answer.
 */

import type { ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError, fetchJson } from './adapter'

/* ═══════════════════════════════════════════════════════════════════════════
   SHAPES
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResearchCitation {
  title: string
  url: string
  publishedAt?: string
}

/** One research finding about a hashtag, with the sources behind it. */
export interface ResearchFinding {
  hashtag: string
  title: string
  content: string
  category: string
  citations: ResearchCitation[]
}

export interface ParallelSearchInput {
  hashtag: string
  /** The research domain, so the objective is scoped. */
  domain: string
  windowDays: number
  processor: string
  maxResults: number
}

/**
 * The objective sent to Parallel. Kept as a function so the wording is in one
 * place, and so the question the Knowledge Base was built from stays quotable.
 */
export function researchObjective(hashtag: string, domain: string, windowDays: number): string {
  const tag = hashtag.replace(/^#/, '')
  return (
    `What is materially new about ${tag} in ${domain} in the last ${windowDays} days? ` +
    'Return concrete findings, named sources, dates and figures. Exclude vendor marketing.'
  )
}

/** The queries Parallel searches. Derived from the tag, not hand-written per tag. */
function searchQueries(hashtag: string, domain: string): string[] {
  const tag = hashtag.replace(/^#/, '')
  // Split camelCase so "RewardModeling" searches as "Reward Modeling".
  const spaced = tag.replace(/([a-z])([A-Z])/g, '$1 $2')
  return [
    `${spaced} research findings`,
    `${spaced} ${domain} recent results`,
    `${spaced} benchmark OR evaluation OR study`,
  ]
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESPONSE NORMALISATION
   ═══════════════════════════════════════════════════════════════════════════ */

interface LooseRecord {
  [key: string]: unknown
}

function readString(row: LooseRecord, ...keys: string[]): string {
  for (const key of keys) {
    const v = row[key]
    if (typeof v === 'string' && v.trim() !== '') return v.trim()
  }
  return ''
}

/**
 * Parallel's search response carries results with excerpts and URLs. Field
 * naming varies across the beta routes, so every field is read tolerantly and
 * a result without a URL is dropped — it could never satisfy the citation rule.
 */
function normaliseResults(payload: unknown): ResearchCitation[] {
  const container =
    payload !== null && typeof payload === 'object' ? (payload as LooseRecord) : {}

  const raw =
    (Array.isArray(container.results) && container.results) ||
    (Array.isArray(container.data) && container.data) ||
    (Array.isArray(container.items) && container.items) ||
    []

  const out: ResearchCitation[] = []
  const seenUrls = new Set<string>()

  for (const item of raw as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const row = item as LooseRecord

    const url = readString(row, 'url', 'link', 'source_url', 'sourceUrl')
    if (url === '' || seenUrls.has(url)) continue
    seenUrls.add(url)

    const title =
      readString(row, 'title', 'name', 'heading') || new URL(url, 'https://example.com').hostname

    const published = readString(row, 'published_at', 'publishedAt', 'date', 'published')
    const parsed = published === '' ? null : new Date(published)

    out.push({
      title,
      url,
      ...(parsed && !Number.isNaN(parsed.getTime())
        ? { publishedAt: parsed.toISOString().slice(0, 10) }
        : {}),
    })
  }

  return out
}

/** The excerpt text Parallel returned, used as the finding body. */
function normaliseExcerpts(payload: unknown, maxChars: number): string {
  const container =
    payload !== null && typeof payload === 'object' ? (payload as LooseRecord) : {}

  const raw =
    (Array.isArray(container.results) && container.results) ||
    (Array.isArray(container.data) && container.data) ||
    (Array.isArray(container.items) && container.items) ||
    []

  const parts: string[] = []
  for (const item of raw as unknown[]) {
    if (item === null || typeof item !== 'object') continue
    const row = item as LooseRecord

    /*
     * PARALLEL RETURNS `excerpts`, AN ARRAY — AND THAT WAS THE WHOLE BUG.
     *
     * The reader below only knew the singular STRING spellings, so for every
     * result `excerpt` resolved to '' , `parts` stayed empty, and the adapter
     * threw `no citable results` — while Parallel had returned five perfectly
     * good, cited pages. The open-web lane therefore captured nothing on every
     * run, and with the Apify lanes limit-blocked that presented as "nothing
     * captured" with no reason that pointed here.
     *
     * Exactly the failure `apify.ts` documents against its own snake_case
     * discovery: a field name is not a contract we control, so it is read
     * through a list of candidates and through both shapes. An array of strings
     * joins; a single string is taken as-is.
     */
    const many = row.excerpts ?? row.excerpt ?? row.snippets
    if (Array.isArray(many)) {
      const joined = many
        .filter((x): x is string => typeof x === 'string' && x.trim() !== '')
        .join(' ')
        .trim()
      if (joined !== '') {
        parts.push(joined)
        continue
      }
    }

    const excerpt = readString(row, 'excerpt', 'snippet', 'content', 'text', 'summary')
    if (excerpt !== '') parts.push(excerpt)
  }

  const joined = parts.join(' ').replace(/\s+/g, ' ').trim()
  return joined.length > maxChars ? `${joined.slice(0, maxChars - 1).trimEnd()}…` : joined
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ADAPTER
   ═══════════════════════════════════════════════════════════════════════════ */

const UNAVAILABLE = 'PARALLEL_API_KEY is not set'

export const parallelResearch: ServiceAdapter<ParallelSearchInput, ResearchFinding[]> = {
  id: 'parallel.search',
  label: 'Parallel Web Systems · deep research',

  isConfigured(): boolean {
    return config.parallel.configured
  },

  unavailableReason(): string {
    return UNAVAILABLE
  },

  async run(input: ParallelSearchInput): Promise<ResearchFinding[]> {
    if (!this.isConfigured()) throw new AdapterError(this.id, UNAVAILABLE)

    const url = `${config.parallel.baseUrl}${config.parallel.searchPath}`

    const payload = await fetchJson<unknown>(url, {
      method: 'POST',
      timeoutMs: config.parallel.timeoutMs,
      adapterId: 'parallel.search',
      headers: {
        // Parallel authenticates with x-api-key, not a bearer token.
        'x-api-key': config.parallel.apiKey,
      },
      body: {
        objective: researchObjective(input.hashtag, input.domain, input.windowDays),
        search_queries: searchQueries(input.hashtag, input.domain),
        processor: input.processor,
        max_results: input.maxResults,
        max_chars_per_result: config.parallel.maxCharsPerResult,
      },
    })

    const citations = normaliseResults(payload)
    const body = normaliseExcerpts(payload, 900)

    if (citations.length === 0 || body === '') {
      throw new AdapterError(
        this.id,
        `no citable results for ${input.hashtag} in the last ${input.windowDays} days`,
      )
    }

    // One finding per call. The extraction skill splits and filters further,
    // and applies the minimum-source rule.
    return [
      {
        hashtag: input.hashtag.replace(/^#/, '').toLowerCase(),
        title: deriveTitle(body, input.hashtag),
        content: body,
        category: 'Research',
        citations,
      },
    ]
  },
}

/** A declarative title from the finding body, since search returns no heading. */
function deriveTitle(body: string, hashtag: string): string {
  const firstSentence = body.split(/(?<=[.?!])\s/)[0] ?? body
  const trimmed = firstSentence.replace(/\s+/g, ' ').trim()
  if (trimmed.length >= 24 && trimmed.length <= 120) return trimmed.replace(/[.]$/, '')
  const tag = hashtag.replace(/^#/, '').replace(/([a-z])([A-Z])/g, '$1 $2')
  return `Recent findings on ${tag}`
}

/** The six declared research domains, for scoping the objective. */
export const RESEARCH_DOMAIN =
  'reinforcement learning, post-training, agentic systems, model evaluation, synthetic data and inference economics'

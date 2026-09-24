/**
 * SEO & MARKET DATA — the competitor-profiling skill's DataForSEO calls.
 *
 *   dataforseo_labs_google_domain_rank_overview  organic keywords, est. traffic, traffic value
 *   backlinks_summary                            domain rank, backlinks, referring domains
 *   dataforseo_labs_google_relevant_pages        top organic pages
 *   dataforseo_labs_google_competitors_domain    organic competitors
 *
 * Only what DataForSEO returned is reported; a figure it did not return is
 * null ("Not available from current sources"). Without credentials nothing
 * is called and the block says so.
 */

import { config } from '../../../config'
import type { SeoData } from '../../../../../shared/competitor-intel'

export function seoConfigured(): boolean {
  return config.dataForSeo.login !== '' && config.dataForSeo.password !== ''
}

function empty(status: SeoData['status'], reason: string | null): SeoData {
  return {
    status,
    reason,
    domain_rank: null,
    organic_keywords: null,
    estimated_organic_traffic: null,
    organic_traffic_value_usd: null,
    backlinks: null,
    referring_domains: null,
    top_pages: [],
    organic_competitors: [],
    retrieved_at: null,
  }
}

function num(v: unknown): number | null {
  return typeof v === 'number' && Number.isFinite(v) ? v : null
}

type Loose = Record<string, unknown>
const rec = (v: unknown): Loose => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Loose) : {})
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : [])

const REJECTED =
  'DataForSEO rejected the credentials (401). DATAFORSEO_PASSWORD must be the API password shown at https://app.dataforseo.com/api-access — not the account sign-in password.'

async function call(path: string, body: unknown): Promise<{ result: Loose | null; raw: unknown; error: string | null }> {
  const auth = Buffer.from(`${config.dataForSeo.login}:${config.dataForSeo.password}`).toString('base64')
  try {
    const res = await fetch(`${config.dataForSeo.baseUrl.replace(/\/$/, '')}${path}`, {
      method: 'POST',
      headers: { authorization: `Basic ${auth}`, 'content-type': 'application/json' },
      body: JSON.stringify([body]),
      signal: AbortSignal.timeout(60_000),
    })
    const raw: unknown = await res.json().catch(() => null)
    if (res.status === 401 || rec(raw).status_code === 40100) return { result: null, raw, error: REJECTED }
    if (!res.ok) {
      const said = typeof rec(raw).status_message === 'string' ? ` — ${String(rec(raw).status_message)}` : ''
      return { result: null, raw, error: `DataForSEO answered HTTP ${res.status}${said}` }
    }
    const task = rec(arr(rec(raw).tasks)[0])
    if (typeof task.status_code === 'number' && task.status_code >= 40000) return { result: null, raw, error: `DataForSEO ${path}: ${String(task.status_message ?? task.status_code)}` }
    return { result: rec(arr(task.result)[0]), raw, error: null }
  } catch (error) {
    return { result: null, raw: null, error: `DataForSEO ${path}: ${error instanceof Error ? error.message : String(error)}` }
  }
}

/** The SEO block for a domain, plus each raw response (kept with the raw scrape data). */
export async function readSeo(websiteUrl: string, now: Date, depth: 'quick' | 'deep'): Promise<{ seo: SeoData; raw: Record<string, unknown> }> {
  if (!seoConfigured()) return { seo: empty('not_configured', 'DataForSEO is not configured (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD).'), raw: {} }
  let domain: string
  try {
    domain = new URL(websiteUrl).hostname.replace(/^www\./, '')
  } catch {
    return { seo: empty('error', 'The competitor has no valid website URL.'), raw: {} }
  }
  const loc = { target: domain, location_code: config.dataForSeo.locationCode, language_code: 'en' }
  const raw: Record<string, unknown> = {}
  const errors: string[] = []
  const seo = empty('ok', null)

  const overview = await call('/v3/dataforseo_labs/google/domain_rank_overview/live', loc)
  raw['domain-rank-overview'] = overview.raw
  // Credentials rejected or the account not yet usable (e.g. unverified): one call says it all.
  if (overview.error === REJECTED || (overview.error && /HTTP 40[13]/.test(overview.error))) return { seo: empty('error', overview.error), raw }
  if (overview.error) errors.push(overview.error)
  const organic = rec(rec(rec(arr(overview.result?.items)[0]).metrics).organic)
  seo.organic_keywords = num(organic.count)
  seo.estimated_organic_traffic = num(organic.etv)
  seo.organic_traffic_value_usd = num(organic.estimated_paid_traffic_cost)

  const backlinks = await call('/v3/backlinks/summary/live', { target: domain, include_subdomains: true })
  raw['backlinks-summary'] = backlinks.raw
  if (backlinks.error) errors.push(backlinks.error)
  seo.domain_rank = num(backlinks.result?.rank)
  seo.backlinks = num(backlinks.result?.backlinks)
  seo.referring_domains = num(backlinks.result?.referring_domains)

  if (depth === 'deep') {
    const pages = await call('/v3/dataforseo_labs/google/relevant_pages/live', { ...loc, limit: 10 })
    raw['relevant-pages'] = pages.raw
    if (pages.error) errors.push(pages.error)
    seo.top_pages = arr(pages.result?.items)
      .map((i) => ({ url: String(rec(i).page_address ?? ''), traffic: num(rec(rec(rec(i).metrics).organic).etv) }))
      .filter((p) => p.url !== '')
    const comp = await call('/v3/dataforseo_labs/google/competitors_domain/live', { ...loc, limit: 10 })
    raw['competitors-domain'] = comp.raw
    if (comp.error) errors.push(comp.error)
    seo.organic_competitors = arr(comp.result?.items).map((i) => String(rec(i).domain ?? '')).filter((d) => d !== '' && d !== domain)
  }
  seo.retrieved_at = now.toISOString()
  if (errors.length > 0) {
    const nothing = seo.organic_keywords === null && seo.domain_rank === null
    seo.status = nothing ? 'error' : 'ok'
    seo.reason = errors.join(' · ')
  }
  return { seo, raw }
}

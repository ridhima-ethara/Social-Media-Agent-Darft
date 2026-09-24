/**
 * FETCHLAYER — the source of Glassdoor employer data (reviews, ratings,
 * feedback) for the Analysis Agent's Social Media Listener
 * (https://fetchlayer.dev, header `x-api-key`).
 *
 * A thin POST client (FetchLayer's routes take a JSON body and a Bearer token). It never retries a request
 * that cost a credit, never invents a field, and turns every outcome into a
 * stated status:
 *
 *   found      — `data` holds what FetchLayer returned
 *   not_found  — the employer does not exist on Glassdoor (or is not public)
 *   error      — HTTP / network / credit failure, with the reason
 *
 * `creditsCharged` counts the requests FetchLayer bills (one per page), so the
 * listener can state exactly what a Glassdoor read cost. Nothing here is ever counted as a
 * measured zero: an absent figure is `null`.
 */

import { config } from '../config'

export type FetchLayerStatus = 'found' | 'not_found' | 'error'

export interface FetchLayerResult {
  status: FetchLayerStatus
  data: Record<string, unknown> | null
  creditsCharged: number
  /** Why, when the status is not `found`. */
  reason: string | null
  path: string
}

export function fetchLayerConfigured(): boolean {
  return config.fetchLayer.apiKey.trim() !== ''
}

export function fetchLayerUnavailableReason(): string | null {
  return fetchLayerConfigured()
    ? null
    : 'FETCHLAYER_API_KEY is not set in server/secrets.env, so the Glassdoor reviews cannot be read.'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/**
 * POST one FetchLayer route — `https://api.fetchlayer.dev/{platform}/{endpoint}`
 * with a JSON body and `Authorization: Bearer <key>`, as FetchLayer documents
 * it (e.g. `/glassdoor/search-companies`, `/glassdoor/company-profile`,
 * `/glassdoor/company-reviews`).
 *
 * FetchLayer bills per request (a multi-page read counts each page), so
 * `creditsCharged` is 1 per successful response, or the `pagesScraped` it
 * reports when a response walked several pages.
 */
export async function fetchLayerPost(path: string, body: Record<string, unknown>): Promise<FetchLayerResult> {
  if (!fetchLayerConfigured()) {
    return { status: 'error', data: null, creditsCharged: 0, reason: fetchLayerUnavailableReason(), path }
  }
  const url = `${config.fetchLayer.baseUrl.replace(/\/$/, '')}${path}`
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.fetchLayer.timeoutMs)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${config.fetchLayer.apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    let parsed: unknown = null
    try {
      parsed = JSON.parse(text)
    } catch {
      parsed = null
    }
    if (!res.ok) {
      const err = isRecord(parsed) ? (isRecord(parsed.error) ? parsed.error : parsed) : null
      const message = err && typeof err.message === 'string' ? err.message : err && typeof err.error === 'string' ? err.error : text.slice(0, 200)
      const why =
        res.status === 402 || res.status === 429
          ? `FetchLayer refused the request (HTTP ${res.status}): ${message}`
          : res.status === 401 || res.status === 403
            ? 'FetchLayer rejected the API key.'
            : `FetchLayer answered HTTP ${res.status}: ${message}`
      return { status: res.status === 404 ? 'not_found' : 'error', data: null, creditsCharged: 0, reason: why, path }
    }
    // FetchLayer returns the record at the top level; some routes wrap it in `data`.
    const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : isRecord(parsed) ? parsed : null
    if (data && data.blocked === true) {
      return { status: 'error', data: null, creditsCharged: 1, reason: 'FetchLayer reports the page was blocked upstream.', path }
    }
    const pages = data && typeof data.pagesScraped === 'number' && data.pagesScraped > 0 ? data.pagesScraped : 1
    return { status: 'found', data, creditsCharged: pages, reason: null, path }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      status: 'error',
      data: null,
      creditsCharged: 0,
      reason: aborted
        ? `FetchLayer did not answer within ${config.fetchLayer.timeoutMs} ms.`
        : `FetchLayer request failed: ${error instanceof Error ? error.message : String(error)}`,
      path,
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * SOCIALFETCH — the one source of public social data for the Analysis Agent's
 * Social Media Listener (https://api.socialfetch.dev, header `x-api-key`).
 *
 * A thin GET client. It never retries a request that cost a credit, never
 * invents a field, and turns every outcome into a stated status:
 *
 *   found      — `data` holds what SocialFetch returned
 *   not_found  — the account or post does not exist (or is not public)
 *   private    — the account exists but is private
 *   error      — HTTP / network / credit failure, with the reason
 *
 * `creditsCharged` comes from the response's own `meta`, so the listener can
 * state exactly what a run cost.
 */

import { config } from '../config'

export type FetchStatus = 'found' | 'not_found' | 'private' | 'error'

export interface SocialFetchResult {
  status: FetchStatus
  data: Record<string, unknown> | null
  creditsCharged: number
  /** Why, when the status is not `found`. */
  reason: string | null
  path: string
}

export function socialFetchConfigured(): boolean {
  return config.socialFetch.apiKey.trim() !== ''
}

export function socialFetchUnavailableReason(): string | null {
  return socialFetchConfigured()
    ? null
    : 'SOCIALFETCH_API_KEY is not set in server/secrets.env, so the Social Media Listener cannot read any platform.'
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** GET one SocialFetch route. `path` may contain `{placeholders}` already filled in by the caller. */
export async function socialFetchGet(
  path: string,
  params: Record<string, string | number | boolean | undefined> = {},
): Promise<SocialFetchResult> {
  if (!socialFetchConfigured()) {
    return { status: 'error', data: null, creditsCharged: 0, reason: socialFetchUnavailableReason(), path }
  }
  const query = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v !== undefined && v !== '') query.set(k, String(v))
  const url = `${config.socialFetch.baseUrl.replace(/\/$/, '')}${path}${query.size > 0 ? `?${query.toString()}` : ''}`

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), config.socialFetch.timeoutMs)
  try {
    const res = await fetch(url, {
      headers: { 'x-api-key': config.socialFetch.apiKey, accept: 'application/json' },
      signal: controller.signal,
    })
    const text = await res.text()
    let body: unknown = null
    try {
      body = JSON.parse(text)
    } catch {
      body = null
    }
    const meta = isRecord(body) && isRecord(body.meta) ? body.meta : {}
    const credits = typeof meta.creditsCharged === 'number' ? meta.creditsCharged : 0
    if (!res.ok) {
      const err = isRecord(body) && isRecord(body.error) ? body.error : null
      const message = err && typeof err.message === 'string' ? err.message : text.slice(0, 200)
      const why =
        res.status === 402
          ? 'SocialFetch reports insufficient credits.'
          : res.status === 401
            ? 'SocialFetch rejected the API key.'
            : `SocialFetch answered HTTP ${res.status}: ${message}`
      return { status: res.status === 404 ? 'not_found' : 'error', data: null, creditsCharged: credits, reason: why, path }
    }
    const data = isRecord(body) && isRecord(body.data) ? body.data : null
    const lookup = data && typeof data.lookupStatus === 'string' ? data.lookupStatus : 'found'
    const status: FetchStatus = lookup === 'not_found' ? 'not_found' : lookup === 'private' ? 'private' : 'found'
    return {
      status,
      data,
      creditsCharged: credits,
      reason: status === 'not_found' ? 'SocialFetch found no such public account or post.' : status === 'private' ? 'The account is private.' : null,
      path,
    }
  } catch (error) {
    const aborted = error instanceof Error && error.name === 'AbortError'
    return {
      status: 'error',
      data: null,
      creditsCharged: 0,
      reason: aborted ? `SocialFetch did not answer within ${config.socialFetch.timeoutMs} ms.` : `SocialFetch request failed: ${error instanceof Error ? error.message : String(error)}`,
      path,
    }
  } finally {
    clearTimeout(timer)
  }
}

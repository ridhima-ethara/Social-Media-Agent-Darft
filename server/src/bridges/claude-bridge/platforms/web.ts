/**
 * THE OPEN WEB — the fifth lane, served by the same bridge.
 *
 * Any http(s) page that is not on one of the social platforms (those have
 * their own lanes). No id carries a date here, so a page is dated by what it
 * states itself:
 *   1. a full date in its URL path (`/2026/09/21/…`, `/2026-09-21-…`), or
 *   2. its own published-date metadata (`article:published_time`, JSON-LD
 *      `datePublished`, …), read by `processing/page-metadata.ts` — only where
 *      the site's robots.txt allows it.
 * A page stating neither stays undated.
 */

import type { ClassifiedUrl, PlatformModule } from './types'

/** Hosts that belong to a platform lane, so the open web never double-counts them. */
const PLATFORM_HOSTS = /(^|\.)(linkedin\.com|lnkd\.in|instagram\.com|x\.com|twitter\.com|facebook\.com|fb\.watch)$/i

/** Query parameters that track a click rather than identify content. */
const TRACKING_PARAM = /^(utm_|fbclid$|gclid$|mc_|ref$|ref_src$|source$|si$|igshid$|_hs)/i

/** Pages that are navigation, not content. */
const NON_CONTENT = /^\/?(search|login|signin|signup|tag|tags|category|categories|author)(\/|$)/i

export const web: PlatformModule = {
  id: 'web',
  label: 'Open web',
  siteFilters: ['-site:linkedin.com', '-site:instagram.com', '-site:x.com', '-site:twitter.com', '-site:facebook.com'],
  readsPageDates: true,
  canDateItems: true,

  isPlatformHost(url: string): boolean {
    try {
      const u = new URL(url)
      return /^https?:$/.test(u.protocol) && !PLATFORM_HOSTS.test(u.hostname)
    } catch {
      return false
    }
  },

  classifyUrl(raw: string): ClassifiedUrl | null {
    let url: URL
    try {
      url = new URL(raw.trim())
    } catch {
      return null
    }
    if (!/^https?:$/.test(url.protocol) || PLATFORM_HOSTS.test(url.hostname)) return null
    const path = url.pathname.length > 1 ? url.pathname.replace(/\/+$/, '') : url.pathname
    if (path === '/' || path === '' || NON_CONTENT.test(path)) return null
    const host = url.hostname.toLowerCase().replace(/^www\./, '')
    // Some sites identify content by query (`/watch?v=…`); keep those
    // parameters, sorted, and drop only the ones that track a click.
    const params = [...url.searchParams.entries()]
      .filter(([k]) => !TRACKING_PARAM.test(k))
      .sort(([a], [b]) => a.localeCompare(b))
    const query = params.length === 0 ? '' : `?${new URLSearchParams(params).toString()}`
    return { canonical: `https://${host}${path}${query}`, itemId: null, contentType: 'article' }
  },

  authorHandleFromUrl(): string | null {
    return null
  },

  dateFromItemId(): Date | null {
    return null
  },
}

/** A full calendar date written into a URL path, or `null`. Never a month alone. */
export function dateFromUrlPath(raw: string, now: Date): Date | null {
  let path: string
  try {
    path = new URL(raw).pathname
  } catch {
    return null
  }
  const m = path.match(/(?:^|[/_-])(20\d{2})[/_-](0[1-9]|1[0-2])[/_-](0[1-9]|[12]\d|3[01])(?:[/_.-]|$)/)
  if (!m) return null
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00Z`)
  if (Number.isNaN(d.getTime()) || d.getTime() > now.getTime() + 86_400_000) return null
  // Reject impossible dates that Date silently rolls over (2026-02-31 → March).
  if (d.toISOString().slice(0, 10) !== `${m[1]}-${m[2]}-${m[3]}`) return null
  return d
}

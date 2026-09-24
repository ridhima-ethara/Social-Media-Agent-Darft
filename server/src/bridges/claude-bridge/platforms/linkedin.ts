/**
 * LINKEDIN — the first platform module.
 *
 * THE DATE COMES FROM THE POST ID, NOT FROM A GUESS. A LinkedIn activity,
 * share or ugcPost id is a 64-bit snowflake whose top 41 bits are the creation
 * time in Unix milliseconds. Shifting the id right by 22 bits recovers it
 * exactly. That is a decoding of a value LinkedIn published, which is why a
 * date obtained this way is reported as `verified` with
 * `date_source: "platform_id"`. A URL without such an id (a Pulse
 * article, say) gets no date from here — the bridge reports `unknown` rather
 * than estimating one.
 *
 * ONLY INDIVIDUAL POSTS AND ARTICLES ARE ACCEPTED. Profiles, company pages,
 * job listings and search pages are not trend evidence and are rejected, so a
 * search result pointing at someone's profile can never be reported as a post.
 */

import type { ClassifiedUrl, PlatformModule } from './types'

/** LinkedIn's public launch year; a decoded date before it is not a real post id. */
const EARLIEST_PLAUSIBLE = Date.UTC(2003, 0, 1)
/** Tolerance for clock skew between LinkedIn and this machine. */
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000

const ID_PATTERNS: RegExp[] = [
  /urn:li:(?:activity|share|ugcPost):(\d{15,20})/i,
  /urn%3Ali%3A(?:activity|share|ugcPost)%3A(\d{15,20})/i,
  /[-_]activity[-_](\d{15,20})(?:[-_]|$|\/)/i,
  /[-_](?:share|ugcpost)[-_](\d{15,20})(?:[-_]|$|\/)/i,
]

function hostIsLinkedIn(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'linkedin.com' || h.endsWith('.linkedin.com') || h === 'lnkd.in'
}

function extractItemId(url: URL): string | null {
  const haystack = `${url.pathname}${url.search}`
  for (const pattern of ID_PATTERNS) {
    const m = haystack.match(pattern)
    if (m?.[1]) return m[1]
  }
  return null
}

function stripTrailingSlash(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export const linkedin: PlatformModule = {
  id: 'linkedin',
  label: 'LinkedIn',
  /*
   * Posts only. Pulse articles carry no id to date them by, so a search that
   * returns them fills the window with undated material. They are still
   * accepted when a person supplies one (`manual_urls`).
   */
  siteFilters: ['site:linkedin.com/posts'],
  readsPageDates: false,
  canDateItems: true,

  isPlatformHost(url: string): boolean {
    try {
      return hostIsLinkedIn(new URL(url).hostname)
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
    if (!/^https?:$/.test(url.protocol) || !hostIsLinkedIn(url.hostname)) return null
    // lnkd.in is a shortener; its target is unknown without following it, and
    // following it is a fetch this bridge does not make.
    if (url.hostname.toLowerCase() === 'lnkd.in') return null

    const path = stripTrailingSlash(url.pathname)
    const itemId = extractItemId(url)

    // Country subdomains (in., uk., de.) serve the same post — one canonical host.
    const base = 'https://www.linkedin.com'

    if (/^\/posts\/[^/]+/i.test(path)) {
      return { canonical: `${base}${path}`, itemId, contentType: 'post' }
    }
    if (/^\/feed\/update\//i.test(path)) {
      if (itemId === null) return null
      return {
        canonical: `${base}/feed/update/urn:li:activity:${itemId}`,
        itemId,
        contentType: 'post',
      }
    }
    if (/^\/pulse\/[^/]+/i.test(path)) {
      return { canonical: `${base}${path}`, itemId, contentType: 'article' }
    }
    return null
  },

  authorHandleFromUrl(raw: string): string | null {
    try {
      const m = new URL(raw).pathname.match(/^\/posts\/([A-Za-z0-9-]+)_/)
      return m?.[1] ?? null
    } catch {
      return null
    }
  },

  dateFromItemId(itemId: string): Date | null {
    if (!/^\d{15,20}$/.test(itemId)) return null
    let ms: number
    try {
      ms = Number(BigInt(itemId) >> 22n)
    } catch {
      return null
    }
    if (!Number.isFinite(ms)) return null
    if (ms < EARLIEST_PLAUSIBLE || ms > Date.now() + FUTURE_TOLERANCE_MS) return null
    return new Date(ms)
  },
}

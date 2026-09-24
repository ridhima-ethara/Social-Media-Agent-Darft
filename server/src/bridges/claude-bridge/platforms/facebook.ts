/**
 * FACEBOOK — a platform module.
 *
 * NO DATE CAN BE DECODED. Facebook post ids carry no timestamp: numeric ids
 * are opaque object ids and `pfbid…` ids are deliberately obfuscated. So a
 * Facebook post found by search is reported with `date_status: "unknown"`
 * unless another source states its date — never with an estimated one. The
 * Scraping Agent's capture contract requires a date, so undated Facebook posts
 * are counted and left out of capture there; the Claude Code tool shows them
 * as undated.
 *
 * Individual posts, videos, reels, photos and permalinks are accepted; pages,
 * profiles, groups' front pages and search are rejected.
 */

import type { ClassifiedUrl, PlatformModule } from './types'

function isHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'facebook.com' || h.endsWith('.facebook.com') || h === 'fb.watch'
}

function strip(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, '') : path
}

export const facebook: PlatformModule = {
  id: 'facebook',
  label: 'Facebook',
  siteFilters: ['site:facebook.com'],
  readsPageDates: false,
  canDateItems: false,

  isPlatformHost(url: string): boolean {
    try {
      return isHost(new URL(url).hostname)
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
    if (!/^https?:$/.test(url.protocol) || !isHost(url.hostname) || url.hostname === 'fb.watch') return null
    const path = strip(url.pathname)
    const base = 'https://www.facebook.com'

    // Query-string permalinks: the id lives in the query, which is kept.
    if (/^\/(permalink|story)\.php$/i.test(path)) {
      const story = url.searchParams.get('story_fbid')
      const owner = url.searchParams.get('id')
      if (!story) return null
      return { canonical: `${base}${path}?story_fbid=${story}${owner ? `&id=${owner}` : ''}`, itemId: story, contentType: 'post' }
    }
    if (/^\/watch$/i.test(path) || /^\/photo(\.php)?$/i.test(path)) {
      const v = url.searchParams.get('v') ?? url.searchParams.get('fbid')
      if (!v) return null
      return { canonical: `${base}${path}?${url.searchParams.has('v') ? 'v' : 'fbid'}=${v}`, itemId: v, contentType: 'post' }
    }

    const m =
      path.match(/^\/[^/]+\/(posts|videos|photos)\/(?:[^/]+\/)*([A-Za-z0-9._-]+)$/i) ??
      path.match(/^\/(reel|share\/p|share\/v|share\/r)\/([A-Za-z0-9._-]+)$/i) ??
      path.match(/^\/groups\/[^/]+\/(posts|permalink)\/([A-Za-z0-9._-]+)$/i)
    if (!m) return null
    return { canonical: `${base}${path}`, itemId: m[2] ?? null, contentType: 'post' }
  },

  authorHandleFromUrl(raw: string): string | null {
    try {
      const m = new URL(raw).pathname.match(/^\/([^/]+)\/(posts|videos|photos)\//i)
      return m?.[1] ?? null
    } catch {
      return null
    }
  },

  dateFromItemId(): Date | null {
    return null
  },
}

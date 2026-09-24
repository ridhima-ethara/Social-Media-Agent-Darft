/**
 * INSTAGRAM — a platform module.
 *
 * THE DATE COMES FROM THE SHORTCODE. A post's shortcode (`/p/<code>/`,
 * `/reel/<code>/`) is its numeric media id in URL-safe base64. That id follows
 * Instagram's published id scheme: the top 41 bits are milliseconds since
 * Instagram's epoch, 1314220021721 (2011-08-24T21:07:01.721Z). Decoding the
 * shortcode and shifting right by 23 recovers the creation time — verified
 * against a post with a widely reported date (`BsOGulcndj-` →
 * 2019-01-04T17:05:45Z).
 *
 * Only posts, reels and IGTV items are accepted; profiles, tag and explore
 * pages are rejected.
 */

import type { ClassifiedUrl, PlatformModule } from './types'

const INSTAGRAM_EPOCH_MS = 1314220021721
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_'
const POST_PATH = /^\/(?:([A-Za-z0-9._]{1,30})\/)?(p|reel|reels|tv)\/([A-Za-z0-9_-]{8,14})(?:\/|$)/

function isHost(host: string): boolean {
  const h = host.toLowerCase()
  return h === 'instagram.com' || h.endsWith('.instagram.com')
}

/** Shortcode → media id, as a decimal string. `null` for a malformed code. */
export function shortcodeToMediaId(code: string): string | null {
  let n = 0n
  for (const ch of code) {
    const i = ALPHABET.indexOf(ch)
    if (i < 0) return null
    n = n * 64n + BigInt(i)
  }
  return n.toString()
}

export const instagram: PlatformModule = {
  id: 'instagram',
  label: 'Instagram',
  // Posts and reels only: an unscoped search returns profile and tag pages,
  // which carry no date and are rejected anyway.
  siteFilters: ['site:instagram.com/p', 'site:instagram.com/reel'],
  readsPageDates: false,
  canDateItems: true,

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
    if (!/^https?:$/.test(url.protocol) || !isHost(url.hostname)) return null
    const m = url.pathname.match(POST_PATH)
    if (!m) return null
    const kind = m[2] === 'reels' ? 'reel' : (m[2] as string)
    const code = m[3] as string
    return {
      canonical: `https://www.instagram.com/${kind}/${code}/`,
      itemId: shortcodeToMediaId(code),
      contentType: 'post',
    }
  },

  authorHandleFromUrl(raw: string): string | null {
    try {
      const m = new URL(raw).pathname.match(POST_PATH)
      return m?.[1] ?? null
    } catch {
      return null
    }
  },

  dateFromItemId(itemId: string): Date | null {
    if (!/^\d{15,20}$/.test(itemId)) return null
    const ms = Number(BigInt(itemId) >> 23n) + INSTAGRAM_EPOCH_MS
    if (!Number.isFinite(ms) || ms < INSTAGRAM_EPOCH_MS || ms > Date.now() + FUTURE_TOLERANCE_MS) return null
    return new Date(ms)
  },
}

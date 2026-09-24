/**
 * X (TWITTER) — a platform module.
 *
 * THE DATE COMES FROM THE STATUS ID. A post id is a Twitter "snowflake": the
 * top 41 bits are milliseconds since the snowflake epoch 1288834974657
 * (2010-11-04T01:42:54.657Z). Shifting right by 22 and adding the epoch gives
 * the exact creation time — verified against a post with a widely reported
 * timestamp (1585841080431321088 → 2022-10-28T03:49:11.734Z).
 *
 * Only status URLs are posts; profiles, lists, search and hashtag pages are
 * rejected. x.com and twitter.com serve the same posts, so both canonicalise to
 * x.com.
 */

import type { ClassifiedUrl, PlatformModule } from './types'

const SNOWFLAKE_EPOCH_MS = 1288834974657
const FUTURE_TOLERANCE_MS = 24 * 60 * 60 * 1000
const HOSTS = ['x.com', 'twitter.com', 'mobile.twitter.com', 'mobile.x.com', 'www.x.com', 'www.twitter.com']

function isHost(host: string): boolean {
  return HOSTS.includes(host.toLowerCase())
}

export const x: PlatformModule = {
  id: 'x',
  label: 'X',
  siteFilters: ['site:x.com'],
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
    const m = url.pathname.match(/^\/([A-Za-z0-9_]{1,30})\/(status(?:es)?|article)\/(\d{6,20})(?:\/|$)/)
    if (!m) return null
    const [, handle, kind, id] = m
    // An X article's id is a snowflake like a status id, so it is dated the same way.
    const path = kind === 'article' ? 'article' : 'status'
    return { canonical: `https://x.com/${handle}/${path}/${id}`, itemId: id ?? null, contentType: 'post' }
  },

  authorHandleFromUrl(raw: string): string | null {
    try {
      const m = new URL(raw).pathname.match(/^\/([A-Za-z0-9_]{1,30})\/(?:status|article)/)
      return m?.[1] ?? null
    } catch {
      return null
    }
  },

  dateFromItemId(itemId: string): Date | null {
    // Pre-snowflake ids (before late 2010) are small sequential integers with no time in them.
    if (!/^\d{15,20}$/.test(itemId)) return null
    const ms = Number(BigInt(itemId) >> 22n) + SNOWFLAKE_EPOCH_MS
    if (!Number.isFinite(ms) || ms > Date.now() + FUTURE_TOLERANCE_MS) return null
    return new Date(ms)
  },
}

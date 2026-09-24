/**
 * What every platform source shares: the adapter contract, and the careful
 * readers that turn SocialFetch's JSON into numbers and dates WITHOUT inventing
 * any. An absent or non-numeric count is `null` (not stated), never 0.
 */

import { socialFetchGet, type SocialFetchResult } from '../../../../integrations/socialfetch'
import type { FetchLogEntry, ListenerAccount, ListenerComment, ListenerPlatform, ListenerPost } from '../types'

export interface SourceTarget {
  /** Company page URL, handle or id — whatever this platform's source takes. Empty = not configured. */
  identifier: string
}

export interface SourceContext {
  log: FetchLogEntry[]
  /** Set once SocialFetch answers 402: every later call is skipped, not attempted. */
  outOfCredits?: boolean
}

/** One platform's SocialFetch adapter. Independent, so a platform can be added or replaced alone. */
export interface ListenerSource {
  platform: ListenerPlatform
  /** Profile / company page, with the follower count when stated. */
  fetchAccount(target: SourceTarget, ctx: SourceContext): Promise<{ account: ListenerAccount | null; result: SocialFetchResult }>
  fetchPosts(target: SourceTarget, account: ListenerAccount | null, limit: number, ctx: SourceContext): Promise<{ posts: ListenerPost[]; result: SocialFetchResult }>
  fetchComments(post: ListenerPost, limit: number, ctx: SourceContext): Promise<{ comments: ListenerComment[]; result: SocialFetchResult }>
}

export function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function rec(v: unknown): Record<string, unknown> {
  return isRecord(v) ? v : {}
}

export function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}

export function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : null
}

/** A stated, finite, non-negative count — or `null`. Numeric strings count; "…" and absent do not. */
export function count(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v) && v >= 0) return v
  if (typeof v === 'string' && /^\d+$/.test(v.trim())) return Number(v.trim())
  return null
}

/** ISO string from an ISO string, epoch seconds or epoch milliseconds — or `null`. */
export function isoDate(v: unknown): string | null {
  if (typeof v === 'string') {
    const t = Date.parse(v)
    return Number.isNaN(t) ? null : new Date(t).toISOString()
  }
  if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
    const ms = v < 1e12 ? v * 1000 : v
    return new Date(ms).toISOString()
  }
  return null
}

const HASHTAG = /#[\p{L}\p{N}_]+/gu

export function hashtagsIn(text: string): string[] {
  return [...new Set((text.normalize('NFKC').match(HASHTAG) ?? []).map((h) => h))]
}

/** Calls SocialFetch and records the call, so credits and outcomes are traceable. */
export async function call(
  platform: ListenerPlatform,
  route: string,
  path: string,
  params: Record<string, string | number | boolean | undefined>,
  ctx: SourceContext,
): Promise<SocialFetchResult> {
  if (ctx.outOfCredits) {
    const reason = 'Not requested — SocialFetch had already reported insufficient credits in this run.'
    ctx.log.push({ platform, route, status: 'skipped', credits: 0, reason })
    return { status: 'error', data: null, creditsCharged: 0, reason, path }
  }
  const result = await socialFetchGet(path, params)
  if (result.status === 'error' && /insufficient credits/i.test(result.reason ?? '')) ctx.outOfCredits = true
  ctx.log.push({ platform, route, status: result.status, credits: result.creditsCharged, reason: result.reason })
  return result
}

/** A result standing in for a call that was deliberately not made. */
export function skipped(platform: ListenerPlatform, route: string, reason: string, ctx: SourceContext): SocialFetchResult {
  ctx.log.push({ platform, route, status: 'skipped', credits: 0, reason })
  return { status: 'not_found', data: null, creditsCharged: 0, reason, path: route }
}

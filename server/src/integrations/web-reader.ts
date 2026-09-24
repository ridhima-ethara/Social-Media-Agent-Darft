/**
 * POLITE WEB READING — robots.txt, bounded fetches and RSS/Atom feeds.
 *
 *   robots     a URL is read only when its robots.txt allows every agent named
 *              and the caller's own agent. An unreachable robots.txt reads as
 *              "not allowed"; a missing one (404/410) allows, as the standard
 *              says.
 *   fetch      a bounded GET: timeout, byte cap, redirects followed.
 *   feeds      the items of an RSS or Atom document, each with the date the
 *              feed itself states. Bing News wraps each story in a
 *              click-through link; the publisher's URL is taken from its `url`
 *              parameter, so an item names the page it points at.
 *
 * Used by Competitor Intelligence (the Analysis Agent) to read competitor
 * sites and dated coverage. Nothing here bypasses an access control.
 */

import { parseRobots, robotsAllows } from '../bridges/claude-bridge/processing/page-metadata'

export interface FeedItem {
  /** The story's own URL (a Bing click-through unwrapped). */
  link: string
  title: string
  description: string
  /** ISO timestamp the feed stated; `null` when it stated none or an impossible one. */
  publishedAt: string | null
  /** The publisher the feed names for the item (Bing's `News:Source`), else `null`. */
  source: string | null
}

export interface RobotsVerdict {
  allowed: boolean
  /** Which agent robots.txt refused, or why it could not be read. Empty when allowed. */
  reason: string
}

/** The limits every read obeys. */
export interface ReadLimits {
  fetch_timeout_ms: number
  max_bytes: number
}

/* ─── text ─────────────────────────────────────────────────────────────── */

function decode(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
}

function plain(html: string): string {
  return decode(decode(html).replace(/<[^>]+>/g, ' '))
    .replace(/\s+/g, ' ')
    .trim()
}

function field(block: string, tag: string): string | null {
  const m = block.match(new RegExp(`<${tag.replace(':', '\\:')}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag.replace(':', '\\:')}>`, 'i'))
  return m ? (m[1] as string) : null
}

/* ─── links ────────────────────────────────────────────────────────────── */

/** A Bing News click-through (`/news/apiclick.aspx?…&url=…`) → the publisher's URL. Anything else unchanged. */
export function unwrapLink(raw: string): string {
  const link = decode(raw.trim())
  try {
    const u = new URL(link)
    if (/(^|\.)bing\.com$/i.test(u.hostname) && /apiclick/i.test(u.pathname)) {
      const target = u.searchParams.get('url')
      if (target && /^https?:\/\//i.test(target)) return target
    }
  } catch {
    return link
  }
  return link
}

/* ─── feeds ────────────────────────────────────────────────────────────── */

function isoDate(raw: string | null, now: Date): string | null {
  if (!raw) return null
  const ms = Date.parse(decode(raw).trim())
  if (Number.isNaN(ms) || ms > now.getTime() + 86_400_000 || ms < Date.UTC(2003, 0, 1)) return null
  return new Date(ms).toISOString()
}

/** The items of an RSS or Atom document; `[]` when it is neither. */
export function parseFeed(xml: string, now: Date, max = 100): FeedItem[] {
  const out: FeedItem[] = []
  const blocks = [...xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)].map((m) => m[1] as string)
  const atom = blocks.length === 0
  if (atom) blocks.push(...[...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)].map((m) => m[1] as string))
  for (const block of blocks) {
    let link: string | null = null
    if (atom) {
      const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((m) => m[1] as string)
      const pick = links.find((a) => !/\brel\s*=/.test(a) || /\brel\s*=\s*["']alternate["']/.test(a)) ?? links[0]
      link = pick?.match(/\bhref\s*=\s*["']([^"']+)["']/)?.[1] ?? null
    } else {
      link = field(block, 'link') ?? field(block, 'guid')
    }
    if (!link) continue
    const url = unwrapLink(plain(link))
    if (!/^https?:\/\//i.test(url)) continue
    const title = plain(field(block, 'title') ?? '')
    if (title === '') continue
    out.push({
      link: url,
      title,
      description: plain(field(block, 'description') ?? field(block, 'summary') ?? field(block, 'content') ?? '').slice(0, 600),
      publishedAt: isoDate(field(block, 'pubDate') ?? field(block, 'published') ?? field(block, 'dc:date') ?? field(block, 'updated'), now),
      source: (() => {
        const s = field(block, 'News:Source') ?? field(block, 'source')
        return s ? plain(s) || null : null
      })(),
    })
    if (out.length >= max) break
  }
  return out
}

/* ─── fetching ─────────────────────────────────────────────────────────── */

/** A bounded GET: timeout, byte cap, redirects followed. `null` when unreachable. */
export async function fetchText(url: string, userAgent: string, limits: ReadLimits, accept: string): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': userAgent, accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(limits.fetch_timeout_ms),
    })
    const reader = res.body?.getReader()
    if (!reader) return { status: res.status, text: '' }
    const chunks: Uint8Array[] = []
    let size = 0
    for (;;) {
      const { done, value } = await reader.read()
      if (done || value === undefined) break
      chunks.push(value)
      size += value.length
      if (size >= limits.max_bytes) {
        await reader.cancel()
        break
      }
    }
    return { status: res.status, text: Buffer.concat(chunks).toString('utf8') }
  } catch {
    return null
  }
}

/**
 * Whether robots.txt lets every named agent read `url`. One robots.txt read
 * per host, shared through `cache` for the run.
 */
export async function robotsVerdict(
  url: string,
  agents: readonly string[],
  userAgent: string,
  limits: ReadLimits,
  cache: Map<string, Promise<{ status: number; text: string } | null>>,
): Promise<RobotsVerdict> {
  let u: URL
  try {
    u = new URL(url)
  } catch {
    return { allowed: false, reason: 'not a valid URL' }
  }
  const origin = `${u.protocol}//${u.host}`
  let pending = cache.get(origin)
  if (!pending) {
    pending = fetchText(`${origin}/robots.txt`, userAgent, limits, 'text/plain')
    cache.set(origin, pending)
  }
  const robots = await pending
  if (robots === null) return { allowed: false, reason: `${u.host}/robots.txt could not be read, so the source is not fetched` }
  if (robots.status === 404 || robots.status === 410) return { allowed: true, reason: '' }
  if (robots.status < 200 || robots.status >= 300) return { allowed: false, reason: `${u.host}/robots.txt answered ${robots.status}, so the source is not fetched` }
  const path = `${u.pathname}${u.search}`
  for (const agent of [...agents, userAgent]) {
    if (!robotsAllows(parseRobots(robots.text, agent), path)) {
      return { allowed: false, reason: `${u.host}/robots.txt disallows ${agent.split(/[\s/]/)[0]} on ${u.pathname}` }
    }
  }
  return { allowed: true, reason: '' }
}

/** The publisher's own feed, read by the bridge: its items, or why it could not be read. */
export async function readFeed(
  url: string,
  userAgent: string,
  limits: ReadLimits & { max_items_per_feed: number },
  now: Date,
): Promise<{ items: FeedItem[]; raw: string; error: string | null }> {
  const res = await fetchText(url, userAgent, limits, 'application/rss+xml, application/atom+xml, application/xml, text/xml, text/html;q=0.8')
  if (res === null) return { items: [], raw: '', error: 'could not be reached' }
  if (res.status < 200 || res.status >= 300) return { items: [], raw: '', error: `answered HTTP ${res.status}` }
  return { items: parseFeed(res.text, now, limits.max_items_per_feed), raw: res.text, error: null }
}

/**
 * DATA SOURCES — what answers the competitor-profiling skill's tool calls.
 *
 *   website    firecrawl_map + firecrawl_scrape → robots.txt-checked sitemap /
 *              homepage links, then each key page as readable text
 *   reference  the competitor's Wikipedia article (when configured in its
 *              social_urls): infobox + lead — founded, HQ, people, funding
 *   news       firecrawl_search (press coverage) → Bing News RSS, dated by the
 *              feed; plus the competitor's own blog feed when the homepage
 *              declares one
 *   reviews    G2 / Capterra / TrustRadius / Product Hunt pages configured in
 *              social_urls, read only where robots.txt allows
 *   seo        DataForSEO (see seo.ts)
 *
 * RULES. robots.txt is read and obeyed for the bridge's own user agent; a page
 * that answers 401/403/429 (bot protection) is reported, never worked around.
 * Every fetched text is untrusted evidence for Claude, never instructions.
 */

import { fetchText, parseFeed, robotsVerdict } from '../../../integrations/web-reader'
import type { CompetitorSource, ReviewSourceStatus, SourceType } from '../../../../../shared/competitor-intel'
import { KEY_PAGES } from './marketing-skills'

export interface FetchLimits {
  userAgent: string
  fetch_timeout_ms: number
  max_bytes: number
}

/** A source with its text — the text goes to Claude as evidence and to the raw store; the rest is kept on the profile. */
export interface GatheredSource extends CompetitorSource {
  text: string
}

type RobotsCache = Map<string, Promise<{ status: number; text: string } | null>>

/* ── text ─────────────────────────────────────────────────────────────── */

function decode(s: string): string {
  return s
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;|&rsquo;|&lsquo;/g, "'")
    .replace(/&ldquo;|&rdquo;/g, '"')
    .replace(/&mdash;/g, '—')
    .replace(/&ndash;/g, '–')
    .replace(/&#x([0-9a-f]+);/gi, (_m, h: string) => String.fromCodePoint(Number.parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
    .replace(/&amp;/g, '&')
}

/** A page's title, meta description and readable text — scripts, styles and markup removed. */
export function htmlToText(html: string, maxChars: number): { title: string | null; description: string | null; text: string } {
  const title = decode(html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1]?.trim() ?? '') || null
  const description =
    decode(
      html.match(/<meta[^>]+(?:name|property)=["'](?:og:)?description["'][^>]*content=["']([^"']*)["']/i)?.[1] ??
        html.match(/<meta[^>]+content=["']([^"']*)["'][^>]*(?:name|property)=["'](?:og:)?description["']/i)?.[1] ??
        '',
    ).trim() || null
  const body = html
    .replace(/<(script|style|noscript|svg|template|iframe)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .replace(/<\/(p|div|section|article|li|h[1-6]|tr|br|header|footer|main)>/gi, '\n')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<h([1-3])[^>]*>/gi, '\n## ')
    .replace(/<li[^>]*>/gi, '\n- ')
    .replace(/<[^>]+>/g, ' ')
  const text = decode(body)
    .split('\n')
    .map((l) => l.replace(/\s+/g, ' ').trim())
    .filter((l) => l !== '' && l !== '-' && l !== '##')
    .filter((l, i, all) => all.indexOf(l) === i)
    .join('\n')
  return { title, description, text: text.slice(0, maxChars) }
}

/* ── website: map + scrape ─────────────────────────────────────────────── */

function sameSite(a: URL, b: URL): boolean {
  const root = (h: string): string => h.replace(/^www\./, '')
  return root(a.hostname) === root(b.hostname)
}

/** The key pages of a site, by type, from its sitemap and homepage links — shortest path per type. */
export function pickKeyPages(base: string, urls: readonly string[]): Array<{ url: string; type: SourceType }> {
  let origin: URL
  try {
    origin = new URL(base)
  } catch {
    return []
  }
  const candidates = new Map<SourceType, string>()
  for (const raw of urls) {
    let u: URL
    try {
      u = new URL(raw, origin)
    } catch {
      continue
    }
    if (!/^https?:$/.test(u.protocol) || !sameSite(u, origin)) continue
    // Only the site's own language root or none: /pricing, /en/pricing — not deep localised copies.
    const path = u.pathname.replace(/^\/(en|en-us|en-gb)(?=\/)/i, '')
    for (const kp of KEY_PAGES) {
      if (!kp.pattern.test(path)) continue
      const clean = `${u.origin}${u.pathname.replace(/\/+$/, '')}`
      const current = candidates.get(kp.type)
      if (!current || new URL(clean).pathname.length < new URL(current).pathname.length) candidates.set(kp.type, clean)
      break
    }
  }
  return KEY_PAGES.filter((kp) => candidates.has(kp.type)).map((kp) => ({ url: candidates.get(kp.type) as string, type: kp.type }))
}

async function allowed(url: string, limits: FetchLimits, cache: RobotsCache): Promise<{ ok: boolean; reason: string }> {
  const v = await robotsVerdict(url, [], limits.userAgent, limits, cache)
  return { ok: v.allowed, reason: v.reason }
}

async function getPage(url: string, limits: FetchLimits, cache: RobotsCache, accept = 'text/html'): Promise<{ status: number; text: string } | { error: string }> {
  const robots = await allowed(url, limits, cache)
  if (!robots.ok) return { error: `not read — ${robots.reason}` }
  const res = await fetchText(url, limits.userAgent, limits, accept)
  if (res === null) return { error: 'not read — the site could not be reached' }
  if (res.status === 401 || res.status === 403 || res.status === 429) return { error: `not read — the site answered ${res.status} (access control / bot protection); not bypassed` }
  if (res.status >= 400) return { error: `not read — HTTP ${res.status}` }
  return res
}

export interface WebsiteResult {
  pages: GatheredSource[]
  /** The homepage's declared RSS/Atom feed, if any (its blog). */
  feedUrl: string | null
  notes: string[]
}

export async function readWebsite(
  websiteUrl: string,
  opts: { maxPages: number; maxCharsPerPage: number; now: Date; nextId: () => string },
  limits: FetchLimits,
  cache: RobotsCache,
): Promise<WebsiteResult> {
  const notes: string[] = []
  const pages: GatheredSource[] = []
  const retrieved = opts.now.toISOString()
  const home = await getPage(websiteUrl, limits, cache)
  if ('error' in home) {
    notes.push(`Homepage ${websiteUrl}: ${home.error}.`)
    return { pages, feedUrl: null, notes }
  }
  const h = htmlToText(home.text, opts.maxCharsPerPage)
  pages.push({ id: opts.nextId(), source_url: websiteUrl, source_type: 'website', title: h.title, source_date: null, retrieved_at: retrieved, text: [h.description ? `Meta description: ${h.description}` : '', h.text].filter(Boolean).join('\n') })

  const feedHref = home.text.match(/<link[^>]+type=["']application\/(?:rss|atom)\+xml["'][^>]*href=["']([^"']+)["']/i)?.[1] ?? home.text.match(/<link[^>]+href=["']([^"']+)["'][^>]*type=["']application\/(?:rss|atom)\+xml["']/i)?.[1] ?? null
  let feedUrl: string | null = null
  try {
    feedUrl = feedHref ? new URL(decode(feedHref), websiteUrl).toString() : null
  } catch {
    feedUrl = null
  }

  // firecrawl_map: the sitemap (as robots.txt names it, else /sitemap.xml) and the homepage's own links.
  const links = [...home.text.matchAll(/href=["']([^"'#]+)["']/gi)].map((m) => decode(m[1] as string))
  const origin = new URL(websiteUrl).origin
  const sitemap = await getPage(`${origin}/sitemap.xml`, limits, cache, 'application/xml,text/xml')
  if (!('error' in sitemap)) {
    const locs = [...sitemap.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1] as string))
    // A sitemap index lists more sitemaps; the first two are read.
    const children = locs.filter((l) => /\.xml(\?|$)/i.test(l)).slice(0, 2)
    for (const child of children) {
      const sm = await getPage(child, limits, cache, 'application/xml,text/xml')
      if (!('error' in sm)) links.push(...[...sm.text.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/gi)].map((m) => decode(m[1] as string)))
    }
    links.push(...locs.filter((l) => !/\.xml(\?|$)/i.test(l)))
  }
  const key = pickKeyPages(websiteUrl, links).slice(0, Math.max(0, opts.maxPages - 1))
  for (const page of key) {
    const res = await getPage(page.url, limits, cache)
    if ('error' in res) {
      notes.push(`${page.type} page ${page.url}: ${res.error}.`)
      continue
    }
    const t = htmlToText(res.text, opts.maxCharsPerPage)
    pages.push({ id: opts.nextId(), source_url: page.url, source_type: page.type, title: t.title, source_date: null, retrieved_at: retrieved, text: [t.description ? `Meta description: ${t.description}` : '', t.text].filter(Boolean).join('\n') })
  }
  const missing = KEY_PAGES.slice(0, 3).filter((kp) => !key.some((k) => k.type === kp.type)).map((kp) => kp.type)
  if (missing.length > 0) notes.push(`No ${missing.join(' / ')} page found in the sitemap or homepage links.`)
  return { pages, feedUrl, notes }
}

/* ── reference: Wikipedia ──────────────────────────────────────────────── */

/** The infobox rows and lead paragraphs of a Wikipedia article. */
export function wikipediaText(html: string, maxChars: number): string {
  const box = html.match(/<table[^>]*class="[^"]*infobox[^"]*"[\s\S]*?<\/table>/i)?.[0] ?? ''
  const rows = [...box.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)]
    .map((r) => {
      const th = htmlToText(r[1]?.match(/<th[^>]*>([\s\S]*?)<\/th>/i)?.[1] ?? '', 200).text.replace(/\n/g, ' ')
      const td = htmlToText(r[1]?.match(/<td[^>]*>([\s\S]*?)<\/td>/i)?.[1] ?? '', 400).text.replace(/\n/g, '; ')
      return th && td ? `${th}: ${td.replace(/\[\d+\]/g, '')}` : ''
    })
    .filter(Boolean)
  const content = html.split(/<div[^>]+id="mw-content-text"/i)[1] ?? html
  const paras = [...content.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map((m) => htmlToText(m[1] ?? '', 1500).text.replace(/\n/g, ' ').replace(/\[\d+\]/g, ''))
    .filter((p) => p.length > 60)
    .slice(0, 4)
  return [rows.length > 0 ? `Infobox:\n${rows.join('\n')}` : '', paras.join('\n\n')].filter(Boolean).join('\n\n').slice(0, maxChars)
}

export async function readReference(urls: readonly string[], opts: { now: Date; nextId: () => string; maxChars: number }, limits: FetchLimits, cache: RobotsCache): Promise<{ sources: GatheredSource[]; notes: string[] }> {
  const wiki = urls.filter((u) => /^https:\/\/[a-z]{2}\.wikipedia\.org\/wiki\//i.test(u)).slice(0, 1)
  const sources: GatheredSource[] = []
  const notes: string[] = []
  for (const url of wiki) {
    const res = await getPage(url, limits, cache)
    if ('error' in res) {
      notes.push(`Wikipedia ${url}: ${res.error}.`)
      continue
    }
    const title = htmlToText(res.text.match(/<title[^>]*>[\s\S]*?<\/title>/i)?.[0] ?? '', 200).title
    sources.push({ id: opts.nextId(), source_url: url, source_type: 'about', title: title ?? 'Wikipedia', source_date: null, retrieved_at: opts.now.toISOString(), text: wikipediaText(res.text, opts.maxChars) })
  }
  return { sources, notes }
}

/* ── news: Bing News + the company's own feed ──────────────────────────── */

export async function readNews(
  competitor: { name: string; keywords: readonly string[] },
  feedUrl: string | null,
  opts: { now: Date; windowDays: number; maxItems: number; nextId: () => string },
  limits: FetchLimits,
  cache: RobotsCache,
): Promise<{ sources: GatheredSource[]; notes: string[] }> {
  const notes: string[] = []
  const since = opts.now.getTime() - opts.windowDays * 86_400_000
  // "Ethara AI" also matches "Ethara.AI" and "Ethara-AI": the words, whatever joins them.
  const nameRe = new RegExp(`\\b${competitor.name.split(/[\s.\-]+/).map((w) => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('[\\s.\\-]?')}\\b`, 'i')
  const feeds: Array<{ url: string; label: string; own: boolean }> = [
    { url: `https://www.bing.com/news/search?q=${encodeURIComponent(`"${competitor.name}"`)}&format=rss&setlang=en`, label: 'Bing News', own: false },
    ...(feedUrl ? [{ url: feedUrl, label: `${competitor.name} feed`, own: true }] : []),
  ]
  const seen = new Set<string>()
  const items: GatheredSource[] = []
  for (const f of feeds) {
    const res = await getPage(f.url, limits, cache, 'application/rss+xml, application/atom+xml, application/xml, text/xml')
    if ('error' in res) {
      notes.push(`${f.label}: ${res.error}.`)
      continue
    }
    const parsed = parseFeed(res.text, opts.now, 60)
    let kept = 0
    for (const it of parsed) {
      if (it.publishedAt === null || Date.parse(it.publishedAt) < since) continue
      // Coverage must name the company; its own feed is about it by definition.
      if (!f.own && !nameRe.test(`${it.title} ${it.description}`)) continue
      const key = it.link.replace(/[?#].*$/, '').replace(/\/+$/, '')
      if (seen.has(key)) continue
      seen.add(key)
      items.push({
        id: '',
        source_url: it.link,
        source_type: f.own ? 'blog' : 'news',
        title: it.title,
        source_date: it.publishedAt,
        retrieved_at: opts.now.toISOString(),
        text: [`${it.title}${it.source ? ` — ${it.source}` : ''}`, it.description].filter(Boolean).join('\n'),
      })
      kept += 1
    }
    if (kept === 0) notes.push(`${f.label}: no dated item naming ${competitor.name} in the last ${opts.windowDays} days.`)
  }
  const sources = items
    .sort((a, b) => (b.source_date ?? '').localeCompare(a.source_date ?? ''))
    .slice(0, opts.maxItems)
    .map((s) => ({ ...s, id: opts.nextId() }))
  return { sources, notes }
}

/* ── reviews ─────────────────────────────────────────────────────────── */

const REVIEW_SITES: Array<{ source: string; host: RegExp }> = [
  { source: 'G2', host: /(^|\.)g2\.com$/i },
  { source: 'Capterra', host: /(^|\.)capterra\.com$/i },
  { source: 'TrustRadius', host: /(^|\.)trustradius\.com$/i },
  { source: 'Product Hunt', host: /(^|\.)producthunt\.com$/i },
]

export async function readReviews(urls: readonly string[], opts: { now: Date; nextId: () => string; maxChars: number }, limits: FetchLimits, cache: RobotsCache): Promise<{ sources: GatheredSource[]; statuses: ReviewSourceStatus[] }> {
  const sources: GatheredSource[] = []
  const statuses: ReviewSourceStatus[] = []
  for (const site of REVIEW_SITES) {
    const url = urls.find((u) => {
      try {
        return site.host.test(new URL(u).hostname)
      } catch {
        return false
      }
    })
    if (!url) {
      statuses.push({ source: site.source, status: 'unavailable', reason: `No ${site.source} page is configured for this competitor (add its URL to the competitor's links).`, url: null })
      continue
    }
    const robots = await allowed(url, limits, cache)
    if (!robots.ok) {
      statuses.push({ source: site.source, status: 'blocked_by_robots', reason: robots.reason, url })
      continue
    }
    const res = await getPage(url, limits, cache)
    if ('error' in res) {
      statuses.push({ source: site.source, status: 'unavailable', reason: res.error, url })
      continue
    }
    const t = htmlToText(res.text, opts.maxChars)
    sources.push({ id: opts.nextId(), source_url: url, source_type: 'review', title: t.title ?? site.source, source_date: null, retrieved_at: opts.now.toISOString(), text: t.text })
    statuses.push({ source: site.source, status: 'ok', reason: null, url })
  }
  return { sources, statuses }
}

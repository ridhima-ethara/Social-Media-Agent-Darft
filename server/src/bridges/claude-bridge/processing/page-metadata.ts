/**
 * PAGE METADATA — the open web's own published date and description.
 *
 * A search result carries a URL and a title and nothing else. For an open-web
 * page that states no date in its URL, the bridge reads the page itself —
 * once, politely — and takes only what the page declares about itself:
 *
 *   date         `article:published_time`, `og:published_time`, JSON-LD
 *                `datePublished`, `<meta name="date|pubdate|publish-date|…">`,
 *                `itemprop="datePublished"`, else the first `<time datetime>`
 *   description  `og:description` / `<meta name="description">` — the page's
 *                own summary, used as the snippet
 *
 * RULES IT KEEPS.
 *   · robots.txt is fetched first and obeyed for this user agent and `*`.
 *     A disallowed path is not fetched. An unreachable robots.txt is treated
 *     as "not allowed" — the conservative reading.
 *   · Only platform modules that set `readsPageDates` get here — the open
 *     web. The social platforms disallow generic crawlers and are never read.
 *   · Bounded: a page cap per run, a byte cap per page, a timeout, and a
 *     concurrency ceiling, all from config.
 *   · Nothing is inferred. A page that declares no date stays undated.
 */

import type { BridgeConfig } from '../config'
import { mapWithConcurrency } from '../../../integrations/adapter'
import { parseSourceDate, toSnippet, type NormalizedCandidate } from './normalizer'

export interface PageMetadata {
  publishedAt: string | null
  description: string | null
}

export interface PageMetadataOutcome {
  dated: number
  described: number
  blockedByRobots: number
  failed: number
  attempted: number
}

type RobotsRules = Array<{ allow: boolean; path: string }>

/** Parses the groups of a robots.txt that apply to `agent` (or `*` when none names it). */
export function parseRobots(text: string, agent: string): RobotsRules {
  const groups: Array<{ agents: string[]; rules: RobotsRules }> = []
  let current: { agents: string[]; rules: RobotsRules } | null = null
  let lastWasAgent = false
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.replace(/#.*$/, '').trim()
    const m = line.match(/^([A-Za-z-]+)\s*:\s*(.*)$/)
    if (!m) continue
    const field = (m[1] as string).toLowerCase()
    const value = (m[2] as string).trim()
    if (field === 'user-agent') {
      if (!current || !lastWasAgent) {
        current = { agents: [], rules: [] }
        groups.push(current)
      }
      current.agents.push(value.toLowerCase())
      lastWasAgent = true
    } else if ((field === 'allow' || field === 'disallow') && current) {
      lastWasAgent = false
      if (field === 'disallow' && value === '') continue
      current.rules.push({ allow: field === 'allow', path: value })
    } else {
      lastWasAgent = false
    }
  }
  const token = agent.toLowerCase().split('/')[0] as string
  const named = groups.filter((g) => g.agents.some((a) => a !== '*' && token.includes(a)))
  const chosen = named.length > 0 ? named : groups.filter((g) => g.agents.includes('*'))
  return chosen.flatMap((g) => g.rules)
}

function ruleMatches(rulePath: string, path: string): boolean {
  const anchored = rulePath.endsWith('$')
  const pattern = (anchored ? rulePath.slice(0, -1) : rulePath)
    .split('*')
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
    .join('.*')
  return new RegExp(`^${pattern}${anchored ? '$' : ''}`).test(path)
}

/** Longest matching rule wins; Allow wins a tie. No matching rule means allowed. */
export function robotsAllows(rules: RobotsRules, pathAndQuery: string): boolean {
  let best: { allow: boolean; len: number } | null = null
  for (const r of rules) {
    if (!ruleMatches(r.path, pathAndQuery)) continue
    const len = r.path.length
    if (best === null || len > best.len || (len === best.len && r.allow)) best = { allow: r.allow, len }
  }
  return best === null ? true : best.allow
}

async function fetchText(url: string, cfg: BridgeConfig['page_metadata'], accept: string): Promise<{ status: number; text: string } | null> {
  try {
    const res = await fetch(url, {
      headers: { 'user-agent': cfg.user_agent, accept },
      redirect: 'follow',
      signal: AbortSignal.timeout(cfg.timeout_ms),
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
      if (size >= cfg.max_bytes) {
        await reader.cancel()
        break
      }
    }
    return { status: res.status, text: Buffer.concat(chunks).toString('utf8') }
  } catch {
    return null
  }
}

function attr(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i'))
  return m ? (m[2] ?? m[3] ?? m[4] ?? null) : null
}

function decodeEntities(s: string): string {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&#(\d+);/g, (_m, d: string) => String.fromCodePoint(Number(d)))
}

const DATE_META_KEYS = [
  'article:published_time',
  'og:published_time',
  'datepublished',
  'date',
  'pubdate',
  'publish-date',
  'publish_date',
  'parsely-pub-date',
  'sailthru.date',
  'dc.date',
  'dc.date.issued',
  'dcterms.created',
]

/** Extracts the page's own published date and description from its HTML. */
export function extractPageMetadata(html: string, now: Date): PageMetadata {
  const head = html.slice(0, 400_000)
  const metas = head.match(/<meta\b[^>]*>/gi) ?? []
  const byKey = new Map<string, string>()
  for (const tag of metas) {
    const key = (attr(tag, 'property') ?? attr(tag, 'name') ?? attr(tag, 'itemprop'))?.toLowerCase()
    const content = attr(tag, 'content')
    if (key && content && !byKey.has(key)) byKey.set(key, decodeEntities(content))
  }

  let publishedAt: string | null = null
  for (const key of DATE_META_KEYS) {
    const v = byKey.get(key)
    if (v) {
      publishedAt = parseSourceDate(v, now)
      if (publishedAt) break
    }
  }
  if (!publishedAt) {
    for (const block of head.match(/<script[^>]+application\/ld\+json[^>]*>[\s\S]*?<\/script>/gi) ?? []) {
      const m = block.match(/"datePublished"\s*:\s*"([^"]+)"/)
      if (m?.[1]) {
        publishedAt = parseSourceDate(m[1], now)
        if (publishedAt) break
      }
    }
  }
  if (!publishedAt) {
    const t = head.match(/<time\b[^>]*\bdatetime\s*=\s*["']([^"']+)["']/i)
    if (t?.[1]) publishedAt = parseSourceDate(t[1], now)
  }

  const description = byKey.get('og:description') ?? byKey.get('description') ?? byKey.get('twitter:description') ?? null
  return { publishedAt, description: description?.trim() || null }
}

/**
 * Fills in dates (and a snippet) for undated items from their own pages.
 * Mutates the items it can date; returns what it did, for the diagnostics.
 */
export async function enrichFromPageMetadata(
  items: NormalizedCandidate[],
  cfg: BridgeConfig,
  now: Date,
): Promise<PageMetadataOutcome> {
  const pm = cfg.page_metadata
  const outcome: PageMetadataOutcome = { dated: 0, described: 0, blockedByRobots: 0, failed: 0, attempted: 0 }
  if (!pm.enabled) return outcome

  const targets = items.filter((i) => i.url !== null && i.published_at === null).slice(0, pm.max_pages_per_run)
  const robotsCache = new Map<string, Promise<RobotsRules | null>>()

  const robotsFor = (origin: string): Promise<RobotsRules | null> => {
    let pending = robotsCache.get(origin)
    if (!pending) {
      pending = fetchText(`${origin}/robots.txt`, pm, 'text/plain').then((res) => {
        if (res === null) return null
        // A missing robots.txt means no restrictions; a server error means unknown → not allowed.
        if (res.status === 404 || res.status === 410) return []
        if (res.status >= 400) return null
        return parseRobots(res.text, pm.user_agent)
      })
      robotsCache.set(origin, pending)
    }
    return pending
  }

  await mapWithConcurrency(targets, pm.concurrency, async (item) => {
    outcome.attempted += 1
    const url = new URL(item.url as string)
    const rules = await robotsFor(url.origin)
    if (rules === null || !robotsAllows(rules, `${url.pathname}${url.search}`)) {
      outcome.blockedByRobots += 1
      return
    }
    const res = await fetchText(url.toString(), pm, 'text/html')
    if (res === null || res.status >= 400) {
      outcome.failed += 1
      return
    }
    const meta = extractPageMetadata(res.text, now)
    if (meta.publishedAt) {
      item.published_at = meta.publishedAt
      item.date_status = 'verified'
      item.date_source = 'page_metadata'
      outcome.dated += 1
    }
    if (meta.description && (item.snippet === null || item.snippet === item.title)) {
      item.snippet = toSnippet(meta.description, cfg.snippet_max_chars)
      item.analysisText = [item.title, meta.description].filter((s): s is string => s !== null).join('\n')
      outcome.described += 1
    }
  })

  return outcome
}

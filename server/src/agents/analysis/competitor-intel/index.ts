/**
 * COMPETITOR INTELLIGENCE — the Analysis Agent's research orchestrator.
 *
 *   Competitor Universe (DB, seeded P0/P1)
 *     → Research        per competitor: the skill's tools, answered by SMA sources
 *                       (website map + scrape, Wikipedia, dated news, reviews, SEO)
 *                       raw data saved as the skill lays it out:
 *                       data/competitor-profiles/raw/<slug>/<YYYY-MM-DD>/{scrapes,seo,reviews}
 *     → Profile         Claude, following competitor-profiling (profile.ts)
 *     → Changes         versus the previous version (changes.ts)
 *     → Market          cross-competitor analysis over the latest profiles (market.ts)
 *     → Storage         competitor_profiles (versioned), competitor_market_reports
 *
 * A competitor that cannot be read is profiled as far as its sources allow and
 * says why; one failure never stops the run.
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Competitor, CompetitorIntelligence, CompetitorProfile, CompetitorRunStatus, MarketReport } from '../../../../../shared/competitor-intel'
import {
  countCompetitors,
  insertCompetitor,
  insertMarketReport,
  insertProfile,
  latestMarketReport,
  latestProfile,
  latestProfiles,
  listCompetitors,
  markCompetitorAnalyzed,
  type CompetitorInput,
} from '../../../db/competitor-repo'
import { query } from '../../../db/pool'
import { latestListenerReport } from '../../../db/repo'
import type { SocialMediaListener } from '../../../../../shared/social-listener'
import { diffProfiles } from './changes'
import { analyseMarket } from './market'
import { generateProfile, type ClaudeSettings } from './profile'
import { readSeo } from './seo'
import { readNews, readReference, readReviews, readWebsite, type FetchLimits, type GatheredSource } from './sources'

const HERE = dirname(fileURLToPath(import.meta.url))
export const RAW_DIR = resolve(HERE, '..', '..', '..', '..', 'data', 'competitor-profiles', 'raw')

export interface CompetitorIntelConfig {
  depth: 'quick' | 'deep'
  maxPagesPerCompetitor: number
  maxCharsPerPage: number
  newsWindowDays: number
  maxNewsItems: number
  includeSeo: boolean
  includeReviews: boolean
  concurrency: number
  profileClaude: ClaudeSettings
  marketClaude: ClaudeSettings
  userAgent: string
  runMarketAnalysis: boolean
}

/* ── the universe ─────────────────────────────────────────────────────── */

/** Writes the seed universe the first time a workspace has no competitors. Never over an edit. */
export async function ensureUniverse(workspaceId: string): Promise<number> {
  if ((await countCompetitors(workspaceId)) > 0) return 0
  const seed = JSON.parse(readFileSync(join(HERE, 'universe.seed.json'), 'utf8')) as { competitors: CompetitorInput[] }
  let n = 0
  for (const c of seed.competitors) if (await insertCompetitor(workspaceId, c)) n += 1
  return n
}

export const SELF: CompetitorInput = {
  slug: 'ethara-ai',
  name: 'Ethara.AI',
  tier: 'P0',
  category: 'Our company',
  description: 'Reinforcement learning environments, feedback systems and evaluation pipelines for frontier AI',
  website_url: 'https://www.ethara.ai',
  social_urls: [],
  keywords: ['Ethara', 'Ethara.AI', 'RL environments', 'RLaaS', 'MILO-Bench'],
  status: 'active',
  monitoring_frequency: 'manual',
  is_self: true,
}

/** Ethara.AI's own entry, so it can be compared with the competitors. Created once; never over an edit. */
export async function ensureSelf(workspaceId: string): Promise<void> {
  if ((await listCompetitors(workspaceId)).some((c) => c.is_self)) return
  await insertCompetitor(workspaceId, SELF)
}

/**
 * Ethara's own sources beyond its website (a client-rendered page that states
 * little to a plain fetch): its Knowledge Base brand entries (internal), its own
 * public posts from the latest Social Media Listener report, and the Glassdoor
 * summary. Every one is labelled with where it came from.
 */
async function selfSources(workspaceId: string, now: Date, nextId: () => string): Promise<{ sources: GatheredSource[]; notes: string[] }> {
  const notes: string[] = []
  const sources: GatheredSource[] = []
  const retrieved = now.toISOString()
  const kb = await query<{ title: string; category: string; content: string }>(
    `SELECT title, category, content FROM knowledge_entries
      WHERE workspace_id = $1 AND active AND category IN ('Brand Voice', 'Brand Guideline', 'Brand Corpus')
        AND coalesce(source, '') NOT LIKE 'corpus/%'
      ORDER BY category, title`,
    [workspaceId],
  )
  if (kb.length > 0) {
    sources.push({
      id: nextId(),
      source_url: 'internal:knowledge-base/brand',
      source_type: 'internal',
      title: 'Ethara Knowledge Base — brand entries (internal)',
      source_date: null,
      retrieved_at: retrieved,
      text: kb.map((e) => `## ${e.category} · ${e.title}\n${e.content.slice(0, 1_200)}`).join('\n\n').slice(0, 9_000),
    })
  } else notes.push('No brand entries in the Knowledge Base.')
  const products = await query<{ term: string }>("SELECT term FROM keywords WHERE workspace_id = $1 AND active AND term ILIKE 'Ethara %' ORDER BY term", [workspaceId])
  if (products.length > 0) {
    sources.push({ id: nextId(), source_url: 'internal:keywords', source_type: 'internal', title: 'Ethara keyword set — named offerings (internal)', source_date: null, retrieved_at: retrieved, text: products.map((p) => p.term).join('\n') })
  }
  const listener = await latestListenerReport<SocialMediaListener>(workspaceId)
  if (listener) {
    const posts = Object.values(listener.report.platforms)
      .flatMap((p) => p.posts)
      .filter((p) => p.post_url && p.text.trim() !== '')
      .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
      .slice(0, 12)
    for (const p of posts) {
      const engagement = p.total_engagement === null ? '' : ` · ${p.total_engagement} interactions`
      // A repost is someone else's post on Ethara's feed: named by its own account.
      const account = p.post_url.match(/instagram\.com\/([^/]+)\/p\//i)?.[1] ?? null
      const byOther = p.is_repost || (account !== null && account.toLowerCase() !== 'ethara.ai')
      const title = byOther ? `${account ? `@${account}` : 'Another account'}’s post, reposted by Ethara.AI on ${p.platform}${engagement}` : `Ethara.AI on ${p.platform}${engagement}`
      sources.push({ id: nextId(), source_url: p.post_url, source_type: 'social', title, source_date: p.published_at, retrieved_at: listener.created_at, text: p.text.slice(0, 1_500) })
    }
    const g = listener.report.glassdoor
    if (g && g.status === 'ok') {
      sources.push({
        id: nextId(),
        source_url: g.employerUrl ?? 'https://www.glassdoor.com',
        source_type: 'review',
        title: 'Glassdoor — Ethara.AI employer reviews (via FetchLayer)',
        source_date: g.read_at ?? null,
        retrieved_at: g.read_at ?? retrieved,
        text: [
          `Overall rating ${g.overall_rating ?? 'not stated'} from ${g.review_count ?? 'an unstated number of'} reviews; recommend ${g.recommend_percent ?? '—'}%.`,
          `Pros: ${g.pros_themes.map((t) => `${t.label} (${t.count})`).join('; ')}`,
          `Cons: ${g.cons_themes.map((t) => `${t.label} (${t.count})`).join('; ')}`,
        ].join('\n'),
      })
    }
  } else notes.push('No Social Media Listener report yet, so Ethara’s own posts are not included.')
  return { sources, notes }
}

/** Whether a competitor is due, by its monitoring frequency. */
export function isDue(c: Competitor, now: Date): boolean {
  if (c.status !== 'active' || c.monitoring_frequency === 'manual') return false
  if (!c.last_analyzed_at) return true
  const days = c.monitoring_frequency === 'weekly' ? 7 : 30
  return now.getTime() - Date.parse(c.last_analyzed_at) >= days * 86_400_000 - 3_600_000
}

/* ── run status (what the UI polls) ──────────────────────────────────── */

const STATUS = new Map<string, CompetitorRunStatus>()
const idle = (): CompetitorRunStatus => ({ running: false, started_at: null, finished_at: null, step: null, done: 0, total: 0, errors: [] })
export function runStatus(workspaceId: string): CompetitorRunStatus {
  return STATUS.get(workspaceId) ?? idle()
}

/** Closes a run that ended without reaching the orchestrator (the skill failed first). */
export function markEnded(workspaceId: string, error: string | null): void {
  const s = STATUS.get(workspaceId)
  if (!s || !s.running || s.step !== 'Queued') return
  STATUS.set(workspaceId, { ...s, running: false, step: null, finished_at: new Date().toISOString(), errors: error ? [error] : s.errors })
}

/** Marks a run as started the moment it is requested, so the tab never sees a gap before the skill begins. */
export function markQueued(workspaceId: string, total: number): void {
  STATUS.set(workspaceId, { running: true, started_at: new Date().toISOString(), finished_at: null, step: 'Queued', done: 0, total, errors: [] })
}

/* ── raw data, as the skill lays it out ──────────────────────────────── */

function saveRaw(slug: string, day: string, kind: 'scrapes' | 'seo' | 'reviews', name: string, content: string): void {
  try {
    const dir = join(RAW_DIR, slug, day, kind)
    mkdirSync(dir, { recursive: true })
    writeFileSync(join(dir, name), content)
  } catch {
    // The raw store is an audit aid; a disk problem never fails the profile.
  }
}

function fileName(s: GatheredSource, i: number): string {
  const base = s.source_type === 'website' ? 'homepage' : s.source_type === 'news' || s.source_type === 'blog' ? `${s.source_type}-${String(i + 1).padStart(2, '0')}` : s.source_type
  return `${base}.md`
}

/* ── one competitor ──────────────────────────────────────────────────── */

export async function researchCompetitor(
  workspaceId: string,
  competitor: Competitor,
  cfg: CompetitorIntelConfig,
  now: Date = new Date(),
): Promise<{ profile: CompetitorProfile; costUsd: number }> {
  const limits: FetchLimits = { userAgent: cfg.userAgent, fetch_timeout_ms: 15_000, max_bytes: 2_500_000 }
  const cache = new Map<string, Promise<{ status: number; text: string } | null>>()
  let n = 0
  const nextId = (): string => `s${(n += 1)}`
  const notes: string[] = []

  const site = competitor.website_url
    ? await readWebsite(competitor.website_url, { maxPages: cfg.maxPagesPerCompetitor, maxCharsPerPage: cfg.maxCharsPerPage, now, nextId }, limits, cache)
    : { pages: [], feedUrl: null, notes: ['No website URL is configured for this competitor.'] }
  notes.push(...site.notes)
  const reference = await readReference(competitor.social_urls, { now, nextId, maxChars: cfg.maxCharsPerPage }, limits, cache)
  notes.push(...reference.notes)
  // Coverage must name "Ethara AI" / "Ethara.AI": a bare "Ethara" is also the UAE's Formula 1 promoter.
  const news = await readNews(competitor.is_self ? { ...competitor, name: 'Ethara AI' } : competitor, site.feedUrl, { now, windowDays: cfg.newsWindowDays, maxItems: cfg.maxNewsItems, nextId }, limits, cache)
  notes.push(...news.notes)
  const reviews = cfg.includeReviews
    ? await readReviews(competitor.social_urls, { now, nextId, maxChars: cfg.maxCharsPerPage }, limits, cache)
    : { sources: [], statuses: [] }
  const seo = cfg.includeSeo && competitor.website_url
    ? await readSeo(competitor.website_url, now, cfg.depth)
    : { seo: { status: 'not_configured' as const, reason: 'SEO data is switched off for this run.', domain_rank: null, organic_keywords: null, estimated_organic_traffic: null, organic_traffic_value_usd: null, backlinks: null, referring_domains: null, top_pages: [], organic_competitors: [], retrieved_at: null }, raw: {} }

  const own = competitor.is_self ? await selfSources(workspaceId, now, nextId) : { sources: [], notes: [] }
  notes.push(...own.notes)
  const sources = [...site.pages, ...own.sources, ...reference.sources, ...news.sources, ...reviews.sources]
  const day = now.toISOString().slice(0, 10)
  sources.forEach((s, i) => saveRaw(competitor.slug, day, s.source_type === 'review' ? 'reviews' : 'scrapes', fileName(s, i), `<!-- ${s.source_url} · retrieved ${s.retrieved_at}${s.source_date ? ` · dated ${s.source_date}` : ''} -->\n# ${s.title ?? ''}\n\n${s.text}\n`))
  for (const [name, raw] of Object.entries(seo.raw)) saveRaw(competitor.slug, day, 'seo', `${name}.json`, JSON.stringify(raw, null, 2))

  const previous = await latestProfile(workspaceId, competitor.id)
  const { profile, costUsd } = await generateProfile(
    { competitor, depth: cfg.depth, sources, seo: seo.seo, reviews: reviews.statuses, coverageNotes: notes, version: (previous?.profile_version ?? 0) + 1, now, self: competitor.is_self },
    cfg.profileClaude,
  )
  profile.changes = diffProfiles(previous, profile)
  await insertProfile(workspaceId, profile)
  await markCompetitorAnalyzed(workspaceId, competitor.id, now.toISOString())
  return { profile, costUsd }
}

/* ── a run ───────────────────────────────────────────────────────────── */

export interface RunOptions {
  /** Competitors to analyse; default: every active competitor that is due. */
  competitorIds?: string[]
  onlyDue?: boolean
  maxCompetitors?: number
}

export async function runCompetitorIntel(
  workspaceId: string,
  cfg: CompetitorIntelConfig,
  opts: RunOptions = {},
  log: (message: string) => void = () => undefined,
): Promise<{ intelligence: CompetitorIntelligence; profiled: number; costUsd: number; errors: string[] }> {
  const now = new Date()
  await ensureUniverse(workspaceId)
  await ensureSelf(workspaceId)
  const universe = await listCompetitors(workspaceId)
  // Ethara's own entry runs only when asked for by id — never as one of "the competitors".
  const chosen = (opts.competitorIds && opts.competitorIds.length > 0
    ? universe.filter((c) => opts.competitorIds?.includes(c.id))
    : universe.filter((c) => !c.is_self && c.status === 'active' && (!opts.onlyDue || isDue(c, now)))
  ).slice(0, Math.max(0, opts.maxCompetitors ?? 100))

  const status: CompetitorRunStatus = { running: true, started_at: now.toISOString(), finished_at: null, step: 'Starting', done: 0, total: chosen.length, errors: [] }
  STATUS.set(workspaceId, status)
  let costUsd = 0
  let profiled = 0
  try {
    // A few at a time: each is mostly network waits and one Claude call.
    const queue = [...chosen]
    const worker = async (): Promise<void> => {
      for (let c = queue.shift(); c; c = queue.shift()) {
        status.step = `Profiling ${c.name}`
        log(`Competitor Intelligence · profiling ${c.name}`)
        try {
          const r = await researchCompetitor(workspaceId, c, cfg)
          costUsd += r.costUsd
          profiled += 1
          if (r.profile.error) status.errors.push(`${c.name}: ${r.profile.error}`)
          log(`Competitor Intelligence · ${c.name}: v${r.profile.profile_version}, ${r.profile.sources.length} source(s)${r.profile.changes.length > 0 ? `, ${r.profile.changes.length} change(s)` : ''}`)
        } catch (error) {
          status.errors.push(`${c.name}: ${error instanceof Error ? error.message : String(error)}`)
        }
        status.done += 1
      }
    }
    await Promise.all(Array.from({ length: Math.max(1, Math.min(cfg.concurrency, chosen.length)) }, () => worker()))

    let market: MarketReport | null = await latestMarketReport(workspaceId)
    if (cfg.runMarketAnalysis && chosen.some((c) => !c.is_self) && profiled > 0) {
      status.step = 'Cross-competitor analysis'
      log('Competitor Intelligence · cross-competitor market analysis')
      const active = new Set(universe.filter((c) => c.status === 'active' && !c.is_self).map((c) => c.id))
      const profiles = (await latestProfiles(workspaceId)).filter((p) => active.has(p.competitor_id))
      const m = await analyseMarket(profiles, new Date(), cfg.marketClaude)
      costUsd += m.costUsd
      if (m.report.error) status.errors.push(`Market analysis: ${m.report.error}`)
      if (m.report.by === 'claude') {
        await insertMarketReport(workspaceId, m.report)
        market = m.report
      }
    }
    return { intelligence: await normalized(workspaceId, market), profiled, costUsd, errors: status.errors }
  } finally {
    status.running = false
    status.finished_at = new Date().toISOString()
    status.step = null
  }
}

/** The spec's normalized output, from what is stored. */
export async function normalized(workspaceId: string, market?: MarketReport | null): Promise<CompetitorIntelligence> {
  const universe = await listCompetitors(workspaceId)
  const profiles = new Map((await latestProfiles(workspaceId)).map((p) => [p.competitor_id, p]))
  const m = market === undefined ? await latestMarketReport(workspaceId) : market
  return {
    generated_at: new Date().toISOString(),
    competitors: universe.map((c) => ({ id: c.id, name: c.name, tier: c.tier, category: c.category, profile: profiles.get(c.id) ?? null })),
    market_analysis: m?.market_analysis ?? null,
    ethara_analysis: m?.ethara_analysis ?? null,
  }
}

/**
 * PLATFORM TREND DISCOVERY — what the Scraping Agent's Claude Bridge capture
 * did on the latest run, read from `pipeline.summary.platformDiscovery`.
 *
 * Three parts, in the order the flow runs:
 *   1. the flow itself, so the operator can see what "scraping" now means;
 *   2. each platform — the searches run (within the per-platform budget), what
 *      came back, and why a platform is empty or skipped;
 *   3. the trends, newest first — topic, hashtags, post links with their
 *      verified date and author, the matched Ethara keywords and the reason.
 *
 * Server-truth: it renders what the run recorded, so a refresh shows the same
 * thing. An empty result is shown as an empty result, with its reason.
 */

import { ExternalLink } from 'lucide-react'
import { z } from 'zod'
import { useStore } from '../store'
import type { Platform } from '../types'
import { Badge, PlatformIcon, timeAgo } from './ui'

// `period` is absent on runs recorded before "today vs this week" existed; read as `earlier`.
const periodSchema = z.enum(['today', 'earlier', 'older']).default('earlier')
const postSchema = z.object({ url: z.string(), publishedAt: z.string(), author: z.string().nullable(), period: periodSchema })

const contextSchema = z.object({
  knowledgeBase: z.object({ source: z.string(), entries: z.number(), vocabularyTerms: z.number() }),
  brand: z.object({ sources: z.array(z.string()), positioning: z.string().nullable(), audience: z.string().nullable(), topics: z.number() }),
  keywords: z.object({ source: z.string(), count: z.number() }),
})

export type DiscoveryContext = z.infer<typeof contextSchema>

const discoverySchema = z.object({
  generatedAt: z.string(),
  /** Absent on runs recorded before the context was. */
  context: contextSchema.optional(),
  /** The current date "today" was judged against. Absent on older runs. */
  today: z.string().optional(),
  windowHours: z.number(),
  /** The window in words ("this month (since 1 September 2026)"). Absent on runs recorded before it was. */
  windowName: z.string().optional(),
  keywordsUsed: z.array(z.string()),
  /** The research corpus used as reference. Absent on runs recorded before it was. */
  corpus: z
    .object({ papers: z.number(), terms: z.array(z.string()), hashtags: z.array(z.string()), searched: z.array(z.string()), reason: z.string().nullable() })
    .nullable()
    .default(null),
  searchesRun: z.number(),
  maxSearchesPerPlatform: z.number(),
  maxPostsPerTrend: z.number(),
  postCount: z.number(),
  platforms: z.array(
    z.object({
      platform: z.string(),
      platformId: z.string(),
      status: z.enum(['ok', 'older', 'undated', 'empty', 'skipped', 'error']),
      reason: z.string().nullable(),
      searches: z.array(z.string()),
      found: z.number(),
      kept: z.number(),
      freshestSeen: z.string().nullable(),
      /** The news lane's per-source notes (read, verified, skipped by robots.txt). */
      notes: z.array(z.string()).default([]),
    }),
  ),
  trends: z.array(
    z.object({
      platform: z.string(),
      trend: z.string(),
      period: periodSchema,
      postsToday: z.number().default(0),
      hashtags: z.array(z.string()),
      posts: z.array(postSchema),
      matchedEtharaKeywords: z.array(z.string()),
      reason: z.string(),
    }),
  ),
  /** Relevant posts from platforms that cannot be dated (Facebook). Absent on older runs. */
  undated: z
    .array(
      z.object({
        platform: z.string(),
        platformId: z.string(),
        url: z.string(),
        title: z.string(),
        hashtags: z.array(z.string()),
        matchedEtharaKeywords: z.array(z.string()),
        trend: z.string(),
      }),
    )
    .default([]),
})

type PlatformDiscovery = z.infer<typeof discoverySchema>

/** Reads the recorded discovery off a run summary, or `null` when the run predates it. */
export function readDiscovery(summary: Record<string, unknown> | undefined): PlatformDiscovery | null {
  const parsed = discoverySchema.safeParse(summary?.platformDiscovery)
  return parsed.success ? parsed.data : null
}

/** The flow, in the operator's own words — the order the run actually goes in. */
export const DISCOVERY_FLOW = [
  'Knowledge Base + Ethara brand context + every keyword',
  'Claude Bridge',
  'LinkedIn + Instagram + Facebook + X',
  'Scraping Agent',
  'Trending today + {window}',
  'Topic + date + hashtags + post URL + platform',
  'Validation Agent',
  'Calendar: today + tomorrow → posts · later → Topic Queue',
]

const STATUS_TONE = { ok: 'good', older: 'warn', undated: 'neutral', empty: 'warn', skipped: 'neutral', error: 'serious' } as const
const STATUS_LABEL = { ok: 'kept', older: 'older posts', undated: 'undated', empty: 'empty', skipped: 'skipped', error: 'error' } as const

function windowLabel(hours: number): string {
  return hours < 72 ? `${hours} hours` : `${Math.round(hours / 24)} days`
}

/** The run's window in words — its recorded name, or "the last N days" on runs recorded before names were. */
export function windowText(d: Pick<PlatformDiscovery, 'windowHours' | 'windowName'> | null | undefined): string {
  if (!d) return 'this month'
  return d.windowName ?? `the last ${windowLabel(d.windowHours)}`
}

function asPlatform(id: string): Platform | null {
  return id === 'linkedin' || id === 'instagram' || id === 'x' || id === 'facebook' ? id : null
}

export function PlatformDiscoveryPanel({ compact = false }: { compact?: boolean }) {
  const run = useStore((s) => s.pipeline)
  const openResults = useStore((s) => s.openDiscoveryResults)
  const discovery = readDiscovery(run?.summary)
  // Recorded once validation finishes; the popup is reopenable from here.
  const hasResults = typeof (run?.summary as Record<string, unknown> | undefined)?.discoveryResults === 'object'

  return (
    <section className="card p-4" aria-label="Platform trend discovery">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="display text-sm">
          Platform trend discovery{discovery ? ` · ${windowText(discovery)}` : ''}
        </h3>
        <span className="flex items-center gap-2">
          {discovery ? (
            <span className="mono tabular text-[10.5px] text-ink-3">
              {discovery.searchesRun} search{discovery.searchesRun === 1 ? '' : 'es'} · ≤{discovery.maxSearchesPerPlatform} per platform ·{' '}
              {timeAgo(discovery.generatedAt)}
            </span>
          ) : null}
          {hasResults ? (
            <button
              type="button"
              onClick={openResults}
              className="rounded-[7px] border border-accent/50 px-2 py-[3px] text-[10.5px] font-semibold text-accent-bright transition-colors hover:border-accent hover:bg-accent/10"
            >
              View results
            </button>
          ) : null}
        </span>
      </div>

      {/* 1 · the flow */}
      <ol className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[11px] text-ink-2" aria-label="How capture works">
        {DISCOVERY_FLOW.map((step, i) => (
          <li key={step} className="inline-flex items-center gap-1.5">
            {i > 0 ? <span className="text-line-strong" aria-hidden="true">→</span> : null}
            <span className={`rounded-md border px-1.5 py-0.5 ${step === 'Claude Bridge' ? 'border-accent/50 text-ink' : 'border-line'}`}>
              {step.replace('{window}', windowText(discovery))}
            </span>
          </li>
        ))}
      </ol>
      {!compact ? (
        <p className="mt-2 max-w-[100ch] text-[11px] leading-relaxed text-ink-3">
          Each platform is searched on the platform itself — a search scoped to that platform’s own post URLs, each post
          dated from its own id. Never the open web or news. Search results state no engagement, so none is shown. The searches and the relevance test come from the Knowledge Base — including the
          research corpus — and every keyword the SMA holds. The bridge writes no content and no calendar.
        </p>
      ) : null}

      {discovery === null ? (
        <p className="mt-3 text-[12px] text-ink-3">No discovery has run yet. Run SocialAI to discover platform trends.</p>
      ) : (
        <>
          {/* 0 · the context the Claude Bridge read, from the three sections */}
          {discovery.context ? (
            <div className="mt-3 grid gap-2 sm:grid-cols-3" aria-label="Context the Claude Bridge read">
              <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                <p className="mono text-[9.5px] uppercase tracking-[0.12em] text-good">Knowledge Base</p>
                <p className="tabular mt-1 text-[12px] text-ink">{discovery.context.knowledgeBase.entries} entries</p>
                <p className="mt-0.5 text-[10.5px] text-ink-3">{discovery.context.knowledgeBase.vocabularyTerms} terms used for relevance</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                <p className="mono text-[9.5px] uppercase tracking-[0.12em] text-good">Ethara brand context</p>
                <p className="mt-1 truncate text-[12px] text-ink" title={discovery.context.brand.positioning ?? ''}>
                  {discovery.context.brand.positioning ?? 'Brand voice'}
                </p>
                <p className="mt-0.5 text-[10.5px] text-ink-3">{discovery.context.brand.topics} brand topics</p>
              </div>
              <div className="rounded-lg border border-line bg-surface-2 p-2.5">
                <p className="mono text-[9.5px] uppercase tracking-[0.12em] text-good">Existing keywords</p>
                <p className="tabular mt-1 text-[12px] text-ink">{discovery.context.keywords.count} this run</p>
                <p className="mt-0.5 truncate text-[10.5px] text-ink-3" title={discovery.keywordsUsed.join(', ')}>
                  searched: {discovery.keywordsUsed.slice(0, 4).join(', ')}
                </p>
              </div>
            </div>
          ) : null}
          {discovery.corpus ? (
            <div className="mt-2 rounded-lg border border-line bg-surface-2 p-2.5">
              <p className="mono text-[9.5px] uppercase tracking-[0.12em] text-good">Research corpus · reference</p>
              {discovery.corpus.terms.length > 0 ? (
                <>
                  <p className="mt-1 text-[12px] text-ink">
                    {discovery.corpus.papers} papers → {discovery.corpus.terms.length} topics
                    {discovery.corpus.searched.length > 0 ? ` · searched this run: ${discovery.corpus.searched.join(', ')}` : ''}
                  </p>
                  <p className="mt-0.5 text-[10.5px] leading-snug text-ink-3" title={discovery.corpus.terms.join(', ')}>
                    {discovery.corpus.terms.join(' · ')}
                  </p>
                </>
              ) : (
                <p className="mt-1 text-[11px] text-ink-3">Not used: {discovery.corpus.reason ?? 'no topics'}</p>
              )}
            </div>
          ) : null}

          {/* 2 · each platform */}
          <div className={`mt-3 grid gap-2 ${compact ? '' : 'md:grid-cols-2 xl:grid-cols-4'}`}>
            {discovery.platforms.map((p) => {
              const icon = asPlatform(p.platformId)
              return (
                <div key={p.platformId} className="rounded-lg border border-line bg-surface-2 p-2.5">
                  <div className="flex items-center gap-1.5">
                    {icon ? <PlatformIcon platform={icon} size={14} /> : null}
                    <span className="text-[12px] font-medium text-ink">{p.platform}</span>
                    <Badge tone={STATUS_TONE[p.status]} className="ml-auto">
                      {p.status === 'ok' || p.status === 'older' || p.status === 'undated' ? `${p.kept} ${STATUS_LABEL[p.status]}` : STATUS_LABEL[p.status]}
                    </Badge>
                  </div>
                  {p.searches.length > 0 ? (
                    <p className="mono mt-1.5 text-[10px] leading-snug text-ink-3" title={p.searches.join('\n')}>
                      {p.searches.length} search{p.searches.length === 1 ? '' : 'es'} · {p.found} result{p.found === 1 ? '' : 's'}
                    </p>
                  ) : null}
                  {p.reason ? <p className="mt-1 text-[11px] leading-snug text-ink-2">{p.reason}</p> : null}
                  {p.status !== 'ok' && p.freshestSeen ? (
                    <p className="mt-1 text-[10.5px] text-ink-3">Newest post found: {timeAgo(p.freshestSeen)}</p>
                  ) : null}
                  {p.notes.length > 0 ? (
                    <ul className="mt-1 space-y-0.5 text-[10px] leading-snug text-ink-3">
                      {p.notes.map((n) => (
                        <li key={n}>{n}</li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* 3 · the trends — trending today first, then the rest of the window, newest first */}
          <h4 className="mt-4 text-[12px] font-semibold text-ink">
            Trends · today first{discovery.today ? ` (${discovery.today})` : ''}, then the rest of {windowText(discovery)}
            <span className="mono tabular ml-2 text-[10.5px] font-normal text-ink-3">
              {discovery.trends.filter((t) => t.period === 'today').length} today ·{' '}
              {discovery.trends.length} trend{discovery.trends.length === 1 ? '' : 's'} · {discovery.postCount} post
              {discovery.postCount === 1 ? '' : 's'} → Validation Agent
            </span>
          </h4>
          {discovery.trends.length === 0 ? (
            <p className="mt-1.5 text-[12px] text-ink-3">
              No Ethara-relevant post was verifiably published on any platform in {windowText(discovery)}.
              Nothing has been substituted — each platform above says why.
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {discovery.trends.map((t) => {
                const icon = asPlatform(t.platform.toLowerCase())
                return (
                  <li key={`${t.platform}:${t.trend}`} className="rounded-lg border border-line p-2.5">
                    <div className="flex flex-wrap items-center gap-1.5">
                      {icon ? <PlatformIcon platform={icon} size={14} /> : null}
                      <span className="text-[12.5px] font-medium text-ink">{t.trend}</span>
                      <span className="text-[11px] text-ink-3">{t.platform}</span>
                      <Badge tone={t.period === 'today' ? 'good' : t.period === 'older' ? 'warn' : 'neutral'}>
                        {t.period === 'today' ? `trending today · ${t.postsToday}` : t.period === 'older' ? 'older than the window' : 'in the window'}
                      </Badge>
                      {t.matchedEtharaKeywords.map((k) => (
                        <Badge key={k} tone="accent">{k}</Badge>
                      ))}
                    </div>
                    {t.hashtags.length > 0 ? (
                      <p className="mt-1 text-[11px] text-ink-2">{t.hashtags.join(' ')}</p>
                    ) : null}
                    <ul className="mt-1.5 space-y-0.5">
                      {t.posts.map((post) => (
                        <li key={post.url} className="flex items-center gap-2 text-[11px]">
                          <span
                            className={`mono tabular w-[84px] shrink-0 ${post.period === 'today' ? 'text-good' : 'text-ink-3'}`}
                            title={post.publishedAt}
                          >
                            {post.period === 'today' ? 'today · ' : ''}
                            {timeAgo(post.publishedAt)}
                          </span>
                          <span className="min-w-0 truncate text-ink-2">{post.author ?? 'author not stated'}</span>
                          <a
                            href={post.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="ml-auto inline-flex shrink-0 items-center gap-1 text-accent-bright hover:underline"
                          >
                            post <ExternalLink size={11} />
                          </a>
                        </li>
                      ))}
                    </ul>
                    {!compact ? <p className="mt-1.5 text-[11px] leading-snug text-ink-3">{t.reason}</p> : null}
                  </li>
                )
              })}
            </ul>
          )}

          {/* 4 · relevant posts that cannot be dated (Facebook) — for reference only */}
          {discovery.undated.length > 0 ? (
            <>
              <h4 className="mt-4 text-[12px] font-semibold text-ink">
                Date not stated
                <span className="ml-2 text-[10.5px] font-normal text-ink-3">listed for reference · not validated</span>
              </h4>
              <ul className="mt-2 space-y-1">
                {discovery.undated.map((u) => {
                  const icon = asPlatform(u.platformId)
                  return (
                    <li key={u.url} className="flex items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-[11px]">
                      {icon ? <PlatformIcon platform={icon} size={12} /> : null}
                      <span className="min-w-0 flex-1 truncate text-ink-2" title={u.title}>
                        {u.trend ? <span className="font-medium text-ink">{u.trend} · </span> : null}
                        {u.title || u.url}
                      </span>
                      <a href={u.url} target="_blank" rel="noreferrer noopener" className="inline-flex shrink-0 items-center gap-1 text-accent-bright hover:underline">
                        post <ExternalLink size={11} />
                      </a>
                    </li>
                  )
                })}
              </ul>
            </>
          ) : null}
        </>
      )}
    </section>
  )
}

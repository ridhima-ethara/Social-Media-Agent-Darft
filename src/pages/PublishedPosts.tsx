/**
 * PUBLISHED POSTS
 *
 * What actually went out, what it did, and why. Every explanation is measured
 * against this account's own trailing baseline. A metric that has not been
 * reported yet is shown as `—`, never as zero.
 */

import { Suspense, lazy, useMemo, useState } from 'react'
import { ExternalLink, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { usePostLinks } from '../lib/post-links'
import { PageHeader } from '../components/layout'
import { DownloadMenu } from '../components/download-menu'
import { exportPerPost, exportSinglePost } from '../lib/export'
import { PlatformPreview } from '../components/previews'
import {
  Badge,
  Btn,
  EmptyState,
  Metric,
  Modal,
  PlatformIcon,
  PLATFORM_LABEL,
  PLATFORM_TOKEN,
  fmt,
  formatDate,
} from '../components/ui'
import type { Platform, PublishedPost } from '../types'

/* Loaded only when the Graphs tab is opened. This is the app's single entry
   point to Recharts, and it is heavy enough to keep off the first paint. */
const PublishedGraphs = lazy(() => import('../components/published-graphs'))

const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'x', 'facebook']


export function PublishedPosts() {
  const published = useStore((s) => s.published)
  const openBar = useStore((s) => s.openBar)
  const addKnowledge = useStore((s) => s.addKnowledge)

  const [platform, setPlatform] = useState<Platform>('linkedin')
  const [view, setView] = useState<'records' | 'charts'>('records')
  const [detail, setDetail] = useState<PublishedPost | null>(null)


  const rows = published.filter((post) => post.platform === platform)

  // Each listed post's page on the platform — see `usePostLinks`.
  const linkFor = usePostLinks([...rows, detail])
  const link = linkFor(detail)

  /*
   * THE CHART SERIES ARE BUILT FROM REPORTED READINGS ONLY.
   *
   * A post whose metrics have never come back is not a zero — it is absent.
   * Plotting it at zero would invent a flat reading the platform never made,
   * and would drag every average down with it. Each series therefore keeps
   * only the posts that carry that particular figure, and says how many it
   * left out.
   */
  const charts = useMemo(() => {
    const dated = [...rows]
      .filter((post) => post.published_at !== null)
      .sort((a, b) => String(a.published_at).localeCompare(String(b.published_at)))

    /*
     * A LABEL THAT IDENTIFIES THE POST, NOT THE DAY.
     *
     * Two posts published on the same day both drew the axis label "17 Sept",
     * so the chart showed three bars under two identical captions and there was
     * no way to tell which post was which. The second and later post of a day
     * carries its ordinal.
     */
    const seen = new Map<string, number>()
    const labels = new Map<string, string>()
    for (const post of dated) {
      const day = formatDate(String(post.published_at))
      const n = (seen.get(day) ?? 0) + 1
      seen.set(day, n)
      labels.set(post.id, n === 1 ? day : `${day} · ${n}`)
    }
    const label = (post: PublishedPost): string => labels.get(post.id) ?? formatDate(String(post.published_at))

    /* A reading that never came back stays `null` all the way into the chart. */
    const reach = dated
      .filter((post) => post.reach !== null || post.impressions !== null)
      .map((post) => ({ label: label(post), Reach: post.reach, Impressions: post.impressions }))
    const interactions = dated
      .filter((post) => post.likes !== null || post.comments !== null || post.shares !== null)
      .map((post) => ({ label: label(post), Likes: post.likes, Comments: post.comments, Shares: post.shares }))
    const engagement = dated
      .filter((post) => post.engagement_rate !== null)
      .map((post) => ({ label: label(post), Rate: Number(post.engagement_rate) }))

    /*
     * THE BASELINE IS THIS ACCOUNT'S OWN MEAN, over the posts that actually
     * reported a rate. Every per-post verdict on this screen is a distance from
     * that number, never a judgement against an outside benchmark we do not have.
     */
    const rated = dated.filter((post) => post.engagement_rate !== null)
    const avgRate =
      rated.length > 0 ? rated.reduce((sum, p) => sum + Number(p.engagement_rate), 0) / rated.length : null

    const posts = dated.map((post) => {
      const parts = [post.likes, post.comments, post.shares].filter((v): v is number => v !== null)
      const rate = post.engagement_rate === null ? null : Number(post.engagement_rate)
      return {
        id: post.id,
        label: label(post),
        title: post.title,
        platform: post.platform,
        reach: post.reach,
        impressions: post.impressions,
        /* Summed over the reported parts only; `reportedParts` says how many of
           the three that was, so a partial sum is never read as a total. */
        interactions: parts.length === 0 ? null : parts.reduce((a, b) => a + b, 0),
        reportedParts: parts.length,
        rate,
        delta: rate === null || avgRate === null ? null : rate - avgRate,
      }
    })

    const sumOf = (pick: (p: (typeof posts)[number]) => number | null): { value: number; from: number } | null => {
      const vals = posts.map(pick).filter((v): v is number => v !== null)
      return vals.length === 0 ? null : { value: vals.reduce((a, b) => a + b, 0), from: vals.length }
    }

    return {
      reach,
      interactions,
      engagement,
      posts,
      avgRate,
      measured: posts.filter((p) => p.rate !== null || p.reach !== null || p.interactions !== null).length,
      totalReach: sumOf((p) => p.reach),
      totalInteractions: sumOf((p) => p.interactions),
      missingReach: rows.length - reach.length,
      missingInteractions: rows.length - interactions.length,
      missingEngagement: rows.length - engagement.length,
    }
  }, [rows])

  const stats = useMemo(() => {
    const reach = rows.reduce((sum, p) => sum + (p.reach ?? 0), 0)
    const interactions = rows.reduce(
      (sum, p) => sum + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0),
      0,
    )
    const rated = rows.filter((p) => p.engagement_rate !== null)
    const avg =
      rated.length > 0 ? rated.reduce((sum, p) => sum + Number(p.engagement_rate), 0) / rated.length : null
    const best = [...rows].sort((a, b) => (b.reach ?? 0) - (a.reach ?? 0))[0] ?? null
    return { reach, interactions, avg, best }
  }, [rows])

  if (published.length === 0) {
    return (
      <>
        <PageHeader
          title="Published Posts"
          subtitle="What actually went out, and what it did."
          agents={['publishing', 'analytics', 'learning']}
        />
        <EmptyState
          title="Nothing published yet"
          body="Approved posts appear here once Leadership signs off. The calendar is where drafts wait for that approval."
          action={
            <Btn variant="subtle" onClick={() => useStore.getState().setPage('calendar')}>
              Open the calendar
            </Btn>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Published Posts"
        subtitle="What actually went out, what it did, and why — measured against this account's own trailing baseline."
        agents={['publishing', 'analytics', 'learning']}
        actions={
          <DownloadMenu
            options={[
              {
                id: 'per-post',
                label: 'Per-post analytics',
                hint: 'Every published post with its latest metric reading.',
                onSelect: (format) => exportPerPost(published, format),
              },
            ]}
          />
        }
      />

      {/* ── Platform hub ──────────────────────────────────────────────── */}
      <section className="mb-5 flex items-center justify-center gap-6 py-2">
        {PLATFORMS.map((id) => {
          const count = published.filter((p) => p.platform === id).length
          const active = id === platform
          return (
            <button
              key={id}
              type="button"
              onClick={() => setPlatform(id)}
              aria-pressed={active}
              className="relative flex flex-col items-center gap-2"
            >
              <span
                className="relative flex items-center justify-center rounded-full border transition-all duration-[var(--dur-base)] ease-[var(--ease-out-soft)]"
                style={{
                  width: active ? 62 : 48,
                  height: active ? 62 : 48,
                  borderColor: active ? PLATFORM_TOKEN[id] : 'var(--color-line)',
                  background: active ? `color-mix(in srgb, ${PLATFORM_TOKEN[id]} 12%, transparent)` : 'var(--color-surface-2)',
                  boxShadow: active ? `0 0 28px -6px ${PLATFORM_TOKEN[id]}` : undefined,
                }}
              >
                <PlatformIcon platform={id} size={active ? 22 : 17} />
                {active ? (
                  <span
                    className="anim-ping-slow absolute inset-0 rounded-full border"
                    style={{ borderColor: PLATFORM_TOKEN[id] }}
                    aria-hidden="true"
                  />
                ) : null}
                <span className="tabular absolute -right-1 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full border border-line bg-surface px-1 text-[10.5px] text-ink-2">
                  {count}
                </span>
              </span>
              <span className={`text-[11px] ${active ? 'text-ink' : 'text-ink-3'}`}>{PLATFORM_LABEL[id]}</span>
            </button>
          )
        })}
      </section>

      {/* Two ways to read the same posts: the record as it arrived, and the
          shape of it. Neither adds a figure the other does not have. */}
      <div className="mb-4 flex justify-center">
        <div role="tablist" aria-label="How to view the published posts" className="flex gap-0.5 rounded-lg border border-line-strong p-0.5">
          {([['records', 'Records'], ['charts', 'Graphs']] as const).map(([id, label]) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={view === id}
              onClick={() => setView(id)}
              className={`rounded-[6px] px-3.5 py-1.5 text-[11.5px] transition-colors ${
                view === id ? 'bg-accent text-on-accent' : 'text-ink-3 hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </div>
      </div>

      {/* ── Expanded platform panel ───────────────────────────────────── */}
      <section className="card anim-fade-up mb-4 overflow-hidden">
        <span className="block h-1" style={{ background: PLATFORM_TOKEN[platform] }} aria-hidden="true" />
        <div className="grid gap-3 p-4 md:grid-cols-4">
          <Metric label="Posts" value={rows.length} />
          <Metric label="Total reach" value={fmt(stats.reach)} />
          <Metric label="Interactions" value={fmt(stats.interactions)} />
          <Metric
            label="Avg. engagement"
            value={stats.avg === null ? '—' : `${stats.avg.toFixed(2)}%`}
            tone={stats.avg !== null && stats.avg >= 6 ? 'good' : undefined}
          />
        </div>
        {stats.best ? (
          <button
            type="button"
            onClick={() => setDetail(stats.best)}
            className="flex w-full items-center gap-2 border-t border-line px-4 py-2.5 text-left transition-colors hover:bg-surface-2"
          >
            <Badge tone="good">Best post</Badge>
            <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{stats.best.title}</span>
            <span className="tabular text-[11px] text-ink-3">{fmt(stats.best.reach)} reach</span>
          </button>
        ) : null}
      </section>

      {view === 'records' ? (
        <>
        {/* ── Table ─────────────────────────────────────────────────────── */}
        <div className="card overflow-x-auto">
          <table className="w-full min-w-[900px] text-left text-[12px]">
            <thead>
              <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-ink-3">
                <th className="px-4 py-2 font-medium">Post</th>
                <th className="px-3 py-2 font-medium">Platform</th>
                <th className="px-3 py-2 font-medium">Published</th>
                <th className="px-3 py-2 font-medium">Reach</th>
                <th className="px-3 py-2 font-medium">Impressions</th>
                <th className="px-3 py-2 font-medium">Likes</th>
                <th className="px-3 py-2 font-medium">Comments</th>
                <th className="px-3 py-2 font-medium">Shares</th>
                <th className="px-3 py-2 font-medium">Eng. rate</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {rows.map((post) => {
                const rate = post.engagement_rate === null ? null : Number(post.engagement_rate)
                return (
                  <tr
                    key={post.id}
                    onClick={() => setDetail(post)}
                    className="cursor-pointer border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2"
                  >
                    <td className="max-w-[300px] truncate px-4 py-2 font-medium text-ink">{post.title}</td>
                    <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                      {linkFor(post).url ? (
                        <a
                          href={linkFor(post).url ?? undefined}
                          target="_blank"
                          rel="noreferrer noopener"
                          title={`Open this post on ${PLATFORM_LABEL[post.platform]}`}
                          aria-label={`Open “${post.title}” on ${PLATFORM_LABEL[post.platform]}`}
                          className="inline-flex rounded-md p-1 transition-colors hover:bg-surface-3 hover:text-accent-bright"
                        >
                          <PlatformIcon platform={post.platform} size={13} />
                        </a>
                      ) : (
                        <span className="inline-flex p-1" title={linkFor(post).reason ?? undefined}>
                          <PlatformIcon platform={post.platform} size={13} />
                        </span>
                      )}
                    </td>
                    <td className="tabular px-3 py-2 text-ink-3">{formatDate(post.published_at)}</td>
                    <td className="tabular px-3 py-2 text-ink-2">{post.reach === null ? '—' : fmt(post.reach)}</td>
                    <td className="tabular px-3 py-2 text-ink-2">{post.impressions === null ? '—' : fmt(post.impressions)}</td>
                    <td className="tabular px-3 py-2 text-ink-2">{post.likes === null ? '—' : fmt(post.likes)}</td>
                    <td className="tabular px-3 py-2 text-ink-2">{post.comments === null ? '—' : fmt(post.comments)}</td>
                    <td className="tabular px-3 py-2 text-ink-2">{post.shares === null ? '—' : fmt(post.shares)}</td>
                    <td className="px-3 py-2">
                      {rate === null ? (
                        <span className="text-ink-3">—</span>
                      ) : (
                        <span className={`tabular font-semibold ${rate >= 6 ? 'text-good-ink' : 'text-ink-2'}`}>
                          {rate.toFixed(2)}%
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2" onClick={(event) => event.stopPropagation()}>
                      <div className="flex items-center justify-end gap-1">
                        <button
                          type="button"
                          title="Ask Ethara why"
                          aria-label={`Ask Ethara why ${post.title} performed the way it did`}
                          onClick={() => openBar(`Why did '${post.title}' perform the way it did?`)}
                          className="rounded-md border border-line p-1.5 text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                        >
                          <Sparkles size={13} />
                        </button>
                        <DownloadMenu
                          compact
                          options={[
                            {
                              id: 'single',
                              label: 'This post',
                              onSelect: (format) => exportSinglePost(post, format),
                            },
                          ]}
                        />
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        </>
      ) : (
        <Suspense
          fallback={
            <p className="mono py-16 text-center text-[11px] uppercase tracking-[0.1em] text-ink-3">
              Drawing the graphs…
            </p>
          }
        >
          <PublishedGraphs charts={charts} platform={platform} total={rows.length} />
        </Suspense>
      )}

      {/* ── Detail modal ──────────────────────────────────────────────── */}
      <Modal
        open={detail !== null}
        onClose={() => setDetail(null)}
        wide
        title={detail?.title ?? ''}
        subtitle={
          detail ? (
            <>
              {/* The platform name is the way to the post itself, once the
                  platform has returned its address. */}
              {link.url ? (
                <a
                  href={link.url}
                  target="_blank"
                  rel="noreferrer noopener"
                  title={`Open this post on ${PLATFORM_LABEL[detail.platform]}`}
                  className="inline-flex items-center gap-1 text-ink-2 underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-colors hover:text-accent-bright hover:decoration-accent"
                >
                  {PLATFORM_LABEL[detail.platform]}
                  <ExternalLink size={10} aria-hidden="true" />
                </a>
              ) : (
                PLATFORM_LABEL[detail.platform]
              )}
              {` · published ${formatDate(detail.published_at, true)}`}
            </>
          ) : (
            ''
          )
        }
      >
        {detail ? (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_296px]">
            {/*
              THE POST AS THE FEED SHOWED IT.

              This was a bare <img> above an unbroken wall of caption — a
              thousand characters of body text at full width, which is neither
              what the audience saw nor readable. The same preview the review
              panel approves is the honest picture of what went out, and it
              folds the caption where the platform folds it, so the modal opens
              on the post rather than on a transcript of it.

              It carries no engagement figures of its own; the real ones, from
              the platform, are beside it.
            */}
            <div className="min-w-0">
              <div className="mx-auto max-w-[520px]">
                <PlatformPreview platform={detail.platform} body={detail.content} media={detail.data_uri} />
              </div>
            </div>

            <aside className="flex min-w-0 flex-col gap-3">
              {/*
                Two columns, not three. At 280px a third column left each label
                about ninety pixels, so "IMPRESSIONS" ran past its tile and
                collided with the one beside it.
              */}
              <div className="grid grid-cols-2 gap-1.5">
                <Metric label="Reach" value={detail.reach === null ? '—' : fmt(detail.reach)} />
                <Metric label="Impressions" value={detail.impressions === null ? '—' : fmt(detail.impressions)} />
                <Metric label="Likes" value={detail.likes === null ? '—' : fmt(detail.likes)} />
                <Metric label="Comments" value={detail.comments === null ? '—' : fmt(detail.comments)} />
                <Metric label="Shares" value={detail.shares === null ? '—' : fmt(detail.shares)} />
                <Metric
                  label="Eng. rate"
                  value={detail.engagement_rate === null ? '—' : `${Number(detail.engagement_rate).toFixed(2)}%`}
                />
              </div>

              {/*
                "Publishing history" is gone. It listed `history` labels, and
                every row's label was empty — the modal showed a numbered list
                of nothing, "1. 2. 3. 4. 5.", which reads as five steps whose
                names failed to load. The receipt below says what is actually
                known about how this post went out.
              */}
              {/* One row, one baseline: the status, the platform, and — pushed
                  to the far edge — the way to the post itself. */}
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={detail.publish_mode === 'demo' ? 'warn' : 'good'}>
                  {detail.publish_mode === 'demo' ? 'Published in demo mode' : 'Published live'}
                </Badge>
                {link.url ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3 underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-colors hover:text-accent-bright hover:decoration-accent"
                  >
                    {PLATFORM_LABEL[detail.platform]}
                  </a>
                ) : (
                  <span className="mono text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
                    {PLATFORM_LABEL[detail.platform]}
                  </span>
                )}
                {link.url ? (
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="ml-auto inline-flex items-center gap-1.5 rounded-[8px] border border-line-strong px-2.5 py-1 text-[11.5px] font-medium text-ink transition-colors hover:border-accent hover:text-accent-bright"
                  >
                    View on {PLATFORM_LABEL[detail.platform]}
                    <ExternalLink size={11} aria-hidden="true" />
                  </a>
                ) : link.loading ? (
                  <span className="ml-auto text-[11px] text-ink-3">Finding the post…</span>
                ) : null}
              </div>

              <dl className="flex flex-col gap-1.5 border-t border-line pt-3 text-[11.5px]">
                <div className="flex items-baseline justify-between gap-3">
                  <dt className="shrink-0 text-ink-3">Published</dt>
                  <dd className="tabular min-w-0 truncate text-right text-ink-2">
                    {formatDate(detail.published_at, true)}
                  </dd>
                </div>
                {detail.external_id ? (
                  <div className="flex items-baseline justify-between gap-3">
                    <dt className="shrink-0 text-ink-3">Receipt</dt>
                    <dd className="mono min-w-0 truncate text-right text-ink-2" title={link.url ?? link.reason ?? detail.external_id}>
                      {/* The receipt opens the post on the platform once the
                          platform has returned its address. */}
                      {link.url ? (
                        <a
                          href={link.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-colors hover:text-accent-bright hover:decoration-accent"
                        >
                          {detail.external_id}
                        </a>
                      ) : (
                        detail.external_id
                      )}
                    </dd>
                  </div>
                ) : null}
              </dl>
            </aside>

            {detail.analysis_summary ? (
              <section className="rounded-xl border border-accent/40 bg-accent/8 p-3 lg:col-span-2">
                <h4 className="display text-[12px]">Jerry · Analytics Agent · post analysis</h4>
                <p className="mt-1.5 text-[12px] leading-relaxed text-ink-2">{detail.analysis_summary}</p>
                {detail.analysis_recommendation ? (
                  <p className="mt-2 text-[12px] leading-relaxed text-ink">
                    <span className="font-semibold">Recommendation:</span> {detail.analysis_recommendation}
                  </p>
                ) : null}
                <Btn
                  variant="ghost"
                  className="mt-2"
                  onClick={() =>
                    void addKnowledge({
                      title: `Insight: ${detail.title}`,
                      category: 'High Performer',
                      content: `${detail.analysis_summary} ${detail.analysis_recommendation ?? ''}`.trim(),
                    })
                  }
                >
                  Save insight to Knowledge Base
                </Btn>
              </section>
            ) : null}
          </div>
        ) : null}
      </Modal>
    </>
  )
}

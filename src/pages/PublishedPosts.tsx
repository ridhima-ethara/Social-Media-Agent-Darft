/**
 * PUBLISHED POSTS
 *
 * What actually went out, what it did, and why. Every explanation is measured
 * against this account's own trailing baseline. A metric that has not been
 * reported yet is shown as `—`, never as zero.
 */

import { Suspense, lazy, useMemo, useState } from 'react'
import { Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { DownloadMenu } from '../components/download-menu'
import { exportPerPost, exportSinglePost } from '../lib/export'
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
    const label = (post: PublishedPost) => formatDate(String(post.published_at))

    const reach = dated
      .filter((post) => post.reach !== null || post.impressions !== null)
      .map((post) => ({ label: label(post), Reach: post.reach ?? 0, Impressions: post.impressions ?? 0 }))
    const interactions = dated
      .filter((post) => post.likes !== null || post.comments !== null || post.shares !== null)
      .map((post) => ({ label: label(post), Likes: post.likes ?? 0, Comments: post.comments ?? 0, Shares: post.shares ?? 0 }))
    const engagement = dated
      .filter((post) => post.engagement_rate !== null)
      .map((post) => ({ label: label(post), Rate: Number(post.engagement_rate) }))

    return {
      reach,
      interactions,
      engagement,
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
                    <td className="px-3 py-2">
                      <PlatformIcon platform={post.platform} size={13} />
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
        subtitle={detail ? `${PLATFORM_LABEL[detail.platform]} · published ${formatDate(detail.published_at, true)}` : ''}
      >
        {detail ? (
          <div className="grid gap-4 lg:grid-cols-[1fr_280px]">
            <div>
              {detail.data_uri ? (
                <img src={detail.data_uri} alt="" className="mb-3 w-full rounded-lg border border-line" />
              ) : null}
              <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink-2">{detail.content}</p>
            </div>

            <aside className="space-y-3">
              <div className="grid grid-cols-3 gap-1.5">
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

              <section>
                <h4 className="display text-[12px]">Publishing history</h4>
                <ol className="mt-1.5 space-y-1.5">
                  {detail.history.map((step, i) => (
                    <li key={i} className="flex gap-2 text-[11px] leading-relaxed text-ink-3">
                      <span className="tabular shrink-0 text-ink-2">{i + 1}.</span>
                      <span>{String(step.label ?? '')}</span>
                    </li>
                  ))}
                </ol>
              </section>

              <Badge tone={detail.publish_mode === 'demo' ? 'warn' : 'good'}>
                {detail.publish_mode === 'demo' ? 'Published in demo mode' : 'Published live'}
              </Badge>
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

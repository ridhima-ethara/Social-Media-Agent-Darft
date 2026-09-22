/**
 * THE PUBLISHED POSTS GRAPHS
 *
 * The same posts as the Records tab, read as analytics rather than drawn as
 * three tall bar charts. This lives in its own module so it can be loaded on
 * demand: it is the only thing in the app that pulls in Recharts, and importing
 * it eagerly put ~116 kB gzipped in front of every page load for a tab most
 * visits never open.
 *
 * NOTHING HERE COMPUTES A FIGURE. Every number arrives already measured, with
 * the count of posts it was measured from, and with the readings that never
 * came back excluded rather than zeroed. A missing reading reaches the charts
 * as `null`, so Recharts draws no bar — a post nobody reported on must never
 * appear as a post that reached nobody.
 *
 * The one comparison made anywhere on this screen is against THIS ACCOUNT'S
 * OWN MEAN, which is the only baseline the product has. There is no industry
 * benchmark here because none was measured.
 */

import { BarsChart, ChartCard, SERIES, TrendLine } from './charts'
import { EmptyState, PLATFORM_LABEL, PLATFORM_TOKEN, PlatformIcon, fmt } from './ui'
import type { Platform } from '../types'

/** A figure, and how many posts it was summed from. */
export interface Measured {
  value: number
  from: number
}

/** One post, as this screen reads it. */
export interface PostAnalytic {
  id: string
  label: string
  title: string
  platform: Platform
  reach: number | null
  impressions: number | null
  interactions: number | null
  /** How many of likes, comments and shares were reported — 0 to 3. */
  reportedParts: number
  rate: number | null
  /** Distance from the account's own mean rate, or null if either is missing. */
  delta: number | null
}

export interface PublishedSeries {
  reach: Array<Record<string, string | number | null>>
  interactions: Array<Record<string, string | number | null>>
  engagement: Array<Record<string, string | number | null>>
  posts: PostAnalytic[]
  avgRate: number | null
  measured: number
  totalReach: Measured | null
  totalInteractions: Measured | null
  missingReach: number
  missingInteractions: number
  missingEngagement: number
}

/** Says what a chart was drawn from, and what it had to leave out. */
function chartNote(shown: number, missing: number, metric: string): string {
  const base = `${shown} post${shown === 1 ? '' : 's'} with ${metric} reported`
  return missing > 0 ? `${base} · ${missing} not reported yet, left out` : base
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE HEADLINE FIGURES
   ───────────────────────────────────────────────────────────────────────────
   Four tiles, each carrying its own coverage. A total with no note reads as a
   total of everything; these say how many posts they are a total OF, because
   on this screen that is usually fewer than were published.
   ═══════════════════════════════════════════════════════════════════════════ */

function Tile({
  label,
  value,
  note,
  tint,
}: {
  label: string
  value: string
  note: string
  tint?: string
}) {
  return (
    <div className="card flex min-w-0 flex-col gap-1 p-3.5">
      <span className="mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
      <span className="tabular text-[22px] font-semibold leading-none tracking-[-0.02em]" style={{ color: tint ?? 'var(--color-ink)' }}>
        {value}
      </span>
      <span className="text-[10.5px] leading-snug text-ink-3">{note}</span>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   AGAINST THIS ACCOUNT'S OWN MEAN
   ───────────────────────────────────────────────────────────────────────────
   The section that turns three bars into a finding. Each post is a row: what
   it was, what it scored, and how far that sits from the mean of every post
   that reported a rate. The bar is drawn against the strongest post, so the
   comparison is between posts rather than against an invented ceiling.
   ═══════════════════════════════════════════════════════════════════════════ */

function Baseline({ posts, avgRate }: { posts: PostAnalytic[]; avgRate: number | null }) {
  const rated = posts.filter((p) => p.rate !== null)
  if (rated.length === 0 || avgRate === null) {
    return (
      <section className="card p-4">
        <h3 className="display text-sm">Against your own mean</h3>
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
          No post has reported an engagement rate yet, so there is no mean to measure against. This
          appears as soon as the platform reports one.
        </p>
      </section>
    )
  }

  const peak = Math.max(...rated.map((p) => Number(p.rate)))
  const ranked = [...rated].sort((a, b) => Number(b.rate) - Number(a.rate))
  const above = ranked.filter((p) => Number(p.delta) > 0).length

  return (
    <section className="card p-4">
      <header className="mb-3">
        <h3 className="display text-sm">Against your own mean</h3>
        <p className="mt-0.5 text-[11px] text-ink-3">
          Mean engagement rate {avgRate.toFixed(2)}% across {rated.length} reported post
          {rated.length === 1 ? '' : 's'} · {above} above it
        </p>
      </header>

      <ul className="flex flex-col gap-2.5">
        {ranked.map((post) => {
          const rate = Number(post.rate)
          const delta = post.delta
          const ahead = delta !== null && delta > 0
          return (
            <li key={post.id} className="flex flex-col gap-1.5">
              <div className="flex items-center gap-2">
                <PlatformIcon platform={post.platform} size={11} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2" title={post.title}>
                  {post.title}
                </span>
                <span className="mono shrink-0 text-[9.5px] text-ink-3">{post.label}</span>
                <span className="tabular w-[52px] shrink-0 text-right text-[12px] font-semibold text-ink">
                  {rate.toFixed(2)}%
                </span>
                {delta === null ? null : (
                  <span
                    className="tabular w-[58px] shrink-0 text-right text-[10.5px] font-medium"
                    style={{ color: ahead ? 'var(--color-good-ink)' : 'var(--color-serious)' }}
                    title={`${Math.abs(delta).toFixed(2)} points ${ahead ? 'above' : 'below'} the mean`}
                  >
                    {ahead ? '+' : '−'}
                    {Math.abs(delta).toFixed(2)}
                  </span>
                )}
              </div>

              {/* The bar runs to the strongest post; the notch is the mean. */}
              <div className="relative h-[6px] overflow-hidden rounded-full bg-surface-3">
                <div
                  className="h-full rounded-full"
                  style={{
                    width: `${peak > 0 ? (rate / peak) * 100 : 0}%`,
                    background: PLATFORM_TOKEN[post.platform],
                    animation: 'eth-seg 620ms cubic-bezier(0.16, 1, 0.3, 1) both',
                  }}
                />
                <span
                  aria-hidden="true"
                  title="Your mean"
                  className="absolute inset-y-0 w-px bg-ink-3"
                  style={{ left: `${peak > 0 ? (avgRate / peak) * 100 : 0}%` }}
                />
              </div>
            </li>
          )
        })}
      </ul>

      <p className="mono mt-3 border-t border-line pt-2.5 text-[9px] uppercase tracking-[0.1em] text-ink-3">
        the hairline is your mean · posts with no reported rate are not listed
      </p>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════ */

export default function PublishedGraphs({
  charts,
  platform,
  total,
}: {
  charts: PublishedSeries
  platform: Platform
  total: number
}) {
  const nothing =
    charts.reach.length === 0 && charts.interactions.length === 0 && charts.engagement.length === 0

  if (nothing) {
    return (
      <EmptyState
        title="Nothing measured yet"
        body={`${total} ${PLATFORM_LABEL[platform]} post${total === 1 ? ' has' : 's have'} gone out, but no metric reading has come back for ${total === 1 ? 'it' : 'them'} yet. Graphs appear once the platform reports.`}
      />
    )
  }

  const coverage = (m: Measured | null, what: string): string =>
    m === null ? `no post has reported ${what}` : `summed from ${m.from} of ${total} post${total === 1 ? '' : 's'}`

  /* Composition needs at least two posts to be a comparison rather than a fact. */
  const stacked = charts.interactions.length > 1

  return (
    <div className="flex flex-col gap-4">
      {/* ── what it all came to ─────────────────────────────────────────── */}
      <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
        <Tile
          label="Reach"
          value={charts.totalReach === null ? '—' : fmt(charts.totalReach.value)}
          note={coverage(charts.totalReach, 'reach')}
          tint={PLATFORM_TOKEN[platform]}
        />
        <Tile
          label="Interactions"
          value={charts.totalInteractions === null ? '—' : fmt(charts.totalInteractions.value)}
          note={coverage(charts.totalInteractions, 'a like, comment or share')}
        />
        <Tile
          label="Mean engagement"
          value={charts.avgRate === null ? '—' : `${charts.avgRate.toFixed(2)}%`}
          note={
            charts.avgRate === null
              ? 'no post has reported a rate'
              : `mean of ${charts.engagement.length} reported rate${charts.engagement.length === 1 ? '' : 's'}`
          }
        />
        <Tile
          label="Measured"
          value={`${charts.measured}/${total}`}
          note={
            charts.measured === total
              ? 'every post has reported something'
              : `${total - charts.measured} still waiting on the platform`
          }
        />
      </div>

      {/* ── the finding ─────────────────────────────────────────────────── */}
      <Baseline posts={charts.posts} avgRate={charts.avgRate} />

      {/* ── the readings behind it ──────────────────────────────────────── */}
      <div className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
        <ChartCard
          title="Reach and impressions"
          subtitle={chartNote(charts.reach.length, charts.missingReach, 'reach or impressions')}
          height={240}
        >
          <BarsChart
            data={charts.reach}
            series={[
              { key: 'Reach', name: 'Reach', colour: PLATFORM_TOKEN[platform] },
              { key: 'Impressions', name: 'Impressions', colour: SERIES.accent },
            ]}
          />
        </ChartCard>

        <ChartCard
          title={stacked ? 'What the interactions were made of' : 'Interactions'}
          subtitle={chartNote(charts.interactions.length, charts.missingInteractions, 'likes, comments or shares')}
          height={240}
        >
          {/* Stacked, so each bar is one post's whole interaction count and the
              segments are its composition — which is the question worth asking
              of three numbers that always travel together. */}
          <BarsChart
            data={charts.interactions}
            series={[
              { key: 'Likes', name: 'Likes', colour: SERIES.linkedin, stackId: stacked ? 'mix' : undefined },
              { key: 'Comments', name: 'Comments', colour: SERIES.instagram, stackId: stacked ? 'mix' : undefined },
              { key: 'Shares', name: 'Shares', colour: SERIES.x, stackId: stacked ? 'mix' : undefined },
            ]}
          />
        </ChartCard>
      </div>

      {/* A single point is not a trend, and drawing it as one would be a claim
          the data does not support. */}
      {charts.engagement.length > 1 ? (
        <ChartCard
          title="Engagement rate over time"
          subtitle={chartNote(charts.engagement.length, charts.missingEngagement, 'an engagement rate')}
          height={220}
        >
          <TrendLine
            data={charts.engagement}
            series={[{ key: 'Rate', name: 'Engagement rate', colour: PLATFORM_TOKEN[platform] }]}
          />
        </ChartCard>
      ) : null}
    </div>
  )
}

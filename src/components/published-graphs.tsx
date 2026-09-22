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
   THE BEST POST — the one finding this screen exists to make
   ───────────────────────────────────────────────────────────────────────────
   Four KPI tiles say what the account did in total. They do not say which post
   did it, and that is the question an operator actually arrives with. So the
   strongest reported post gets the one card that is allowed to be loud: a lit
   gradient edge, its own metrics broken out, and its distance from the account
   mean stated rather than implied.

   It replaces a per-post bar list that ranked all three posts against the mean.
   Ranking three rows is not a finding — naming the leader and what it scored is.

   Every colour is a token. ADR-004, and `verify.ts` fails the build on a hex.
   ═══════════════════════════════════════════════════════════════════════════ */

function Metric({ label, value, tint }: { label: string; value: string; tint?: string }) {
  return (
    <div
      className="rounded-[12px] px-3.5 py-3"
      style={{
        background: 'color-mix(in srgb, var(--color-ink-3) 5%, transparent)',
        border: '1px solid color-mix(in srgb, var(--color-ink-3) 10%, transparent)',
      }}
    >
      <span className="mono block text-[9px] uppercase tracking-[0.12em] text-ink-3">{label}</span>
      <span
        className="tabular mt-1 block text-[20px] font-semibold leading-none tracking-[-0.02em]"
        style={{ color: tint ?? 'var(--color-ink)' }}
      >
        {value}
      </span>
    </div>
  )
}

function BestPost({
  post,
  avgRate,
  platform,
}: {
  post: PostAnalytic
  avgRate: number | null
  platform: Platform
}) {
  const rate = post.rate === null ? null : Number(post.rate)
  const ahead = post.delta !== null && post.delta > 0

  return (
    /* The gradient lives on a 1px wrapper rather than a border, because a
       gradient border cannot follow a radius cleanly in CSS. */
    <section
      className="rounded-[17px] p-px"
      style={{
        background:
          'linear-gradient(160deg, color-mix(in srgb, var(--color-magenta) 50%, transparent), ' +
          'color-mix(in srgb, var(--color-accent) 35%, transparent) 50%, ' +
          'color-mix(in srgb, var(--color-ink-3) 12%, transparent))',
      }}
    >
      <div className="relative flex flex-wrap items-center gap-6 overflow-hidden rounded-[16px] bg-surface p-5">
        {/* A soft bloom behind the eyebrow, so the card reads as lit rather than
            merely outlined. Decorative, and hidden from assistive tech. */}
        <span
          aria-hidden="true"
          className="pointer-events-none absolute -left-16 -top-16 h-60 w-60 rounded-full"
          style={{
            background:
              'radial-gradient(circle, color-mix(in srgb, var(--color-magenta) 12%, transparent), transparent 70%)',
          }}
        />

        <div className="relative min-w-[260px] flex-[1.4]">
          <div className="flex items-center gap-2">
            <span
              className="h-2 w-2 shrink-0 rounded-full"
              style={{ background: 'linear-gradient(135deg, var(--color-magenta), var(--color-accent))' }}
            />
            <span className="mono text-[10px] uppercase tracking-[0.16em] text-magenta-ink">
              Best reported post
            </span>
          </div>

          <h3 className="mt-3 text-[18px] font-semibold leading-[1.35] tracking-[-0.005em] text-ink">
            {post.title}
          </h3>

          <div className="mt-3.5 flex flex-wrap items-center gap-2.5">
            <span className="inline-flex items-center gap-1.5 text-[11.5px] text-ink-3">
              <PlatformIcon platform={platform} size={11} />
              {PLATFORM_LABEL[platform]} · {post.label}
            </span>
            {post.delta === null ? null : (
              <span
                className="mono rounded-full px-2.5 py-[3px] text-[10.5px] font-semibold"
                style={{
                  color: ahead ? 'var(--color-good-ink)' : 'var(--color-serious)',
                  background: `color-mix(in srgb, ${ahead ? 'var(--color-good-ink)' : 'var(--color-serious)'} 8%, transparent)`,
                  border: `1px solid color-mix(in srgb, ${ahead ? 'var(--color-good-ink)' : 'var(--color-serious)'} 30%, transparent)`,
                }}
                title={`${Math.abs(post.delta).toFixed(2)} points ${ahead ? 'above' : 'below'} the account mean${avgRate === null ? '' : ` of ${avgRate.toFixed(2)}%`}`}
              >
                {ahead ? '+' : '−'}
                {Math.abs(post.delta).toFixed(2)} {ahead ? 'above' : 'below'} account mean
              </span>
            )}
          </div>
        </div>

        {/* The same four numbers the tiles total, for this post alone. */}
        <div className="relative grid min-w-[280px] flex-1 grid-cols-2 gap-2.5 sm:grid-cols-4">
          <Metric
            label="Engagement"
            value={rate === null ? '—' : `${rate.toFixed(2)}%`}
            tint={ahead ? 'var(--color-good-ink)' : undefined}
          />
          <Metric label="Reach" value={post.reach === null ? '—' : fmt(post.reach)} />
          <Metric label="Impressions" value={post.impressions === null ? '—' : fmt(post.impressions)} />
          <Metric label="Interactions" value={post.interactions === null ? '—' : fmt(post.interactions)} />
        </div>
      </div>
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

  /*
   * The strongest post that actually reported a rate.
   *
   * Null when nothing has — the card is then omitted rather than rendered with
   * an em dash where the finding should be. An unmeasured post is not a weak
   * post, and ranking it as one would be the reading this screen exists to avoid.
   */
  const best =
    charts.posts
      .filter((p) => p.rate !== null)
      .sort((a, b) => Number(b.rate) - Number(a.rate))[0] ?? null

  /*
   * The movement across the reported rates, first to last.
   *
   * Stated only when there are at least two, because one reading has nothing to
   * move from. `engagement` is already in publication order.
   */
  const firstRate = charts.engagement.length > 1 ? Number(charts.engagement[0]?.Rate ?? NaN) : NaN
  const lastRate =
    charts.engagement.length > 1
      ? Number(charts.engagement[charts.engagement.length - 1]?.Rate ?? NaN)
      : NaN
  const drift =
    Number.isFinite(firstRate) && Number.isFinite(lastRate) ? lastRate - firstRate : null

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
      {best === null ? null : (
        <BestPost post={best} avgRate={charts.avgRate} platform={platform} />
      )}

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
          /*
            The two numbers a reader would otherwise have to compute off the
            chart: what the mean is, and which way the series has moved. Stated
            as pills in the header so the line does not have to be read twice.
          */
          actions={
            <div className="flex shrink-0 flex-wrap items-center gap-2">
              {charts.avgRate === null ? null : (
                <span
                  className="mono rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                  style={{
                    color: 'var(--color-magenta-ink)',
                    background: 'color-mix(in srgb, var(--color-magenta) 8%, transparent)',
                    border: '1px solid color-mix(in srgb, var(--color-magenta) 30%, transparent)',
                  }}
                >
                  MEAN {charts.avgRate.toFixed(2)}%
                </span>
              )}
              {drift === null || Math.abs(drift) < 0.005 ? null : (
                <span
                  className="mono rounded-full px-2.5 py-1 text-[10.5px] font-semibold"
                  style={{
                    color: drift > 0 ? 'var(--color-good-ink)' : 'var(--color-serious)',
                    background: `color-mix(in srgb, ${drift > 0 ? 'var(--color-good-ink)' : 'var(--color-serious)'} 8%, transparent)`,
                    border: `1px solid color-mix(in srgb, ${drift > 0 ? 'var(--color-good-ink)' : 'var(--color-serious)'} 30%, transparent)`,
                  }}
                  title={`Between the first and last reported rate on this channel`}
                >
                  {drift > 0 ? '▲' : '▼'} {Math.abs(drift).toFixed(2)} pts
                </span>
              )}
            </div>
          }
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

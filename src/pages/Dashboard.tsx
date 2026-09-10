/**
 * DASHBOARD
 *
 * How Ethara.AI's social presence is performing, and what the agents are doing
 * about it. Every figure is measured against this account's own trailing
 * baseline — never an industry benchmark.
 */

import { useMemo, useState } from 'react'
import { Maximize2, Sparkles } from 'lucide-react'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { PlayButton } from '../components/play-button'
import { DownloadMenu } from '../components/download-menu'
import { Tilt } from '../components/tilt'
import { ChartCard, InsightChart, SERIES, TrendArea } from '../components/charts'
import { AssistantCore } from '../components/assistant/core'
import {
  Badge,
  Btn,
  EmptyState,
  KpiCard,
  Metric,
  PlatformIcon,
  PLATFORM_LABEL,
  Progress,
  Tabs,
  fmt,
  timeAgo,
} from '../components/ui'
import { answerFromAnalytics } from '../lib/ai'
import { exportCombined, exportPerPost } from '../lib/export'
import type { Platform } from '../types'

type PlatformTab = Platform

/**
 * The brand definition, which is configuration rather than something learned.
 *
 * Excluded by name so anything else counts as a lesson. The panel used to
 * whitelist four outcome categories instead — and every one of them happened to
 * be absent, so it rendered its empty state while six real entries the Learning
 * Agent had written sat one category away. A whitelist here fails silently every
 * time the agents produce a category nobody thought to list.
 */
const BRAND_DEFINITION_CATEGORIES = [
  'Brand Corpus',
  'Brand Voice',
  'Brand Guideline',
  'Visual Identity',
  'Compliance Rule',
]

const SUGGESTED_QUESTIONS = [
  'Why did Instagram drop last month?',
  'What was our strongest post?',
  'How did follower growth split by platform?',
  'What is our engagement rate trend?',
  'What should we publish next week?',
]

export function Dashboard() {
  const user = useStore((s) => s.user)
  const analytics = useStore((s) => s.analytics)
  const published = useStore((s) => s.published)
  const ideas = useStore((s) => s.ideas)
  const knowledge = useStore((s) => s.knowledge)
  const knowledgeCounts = useStore((s) => s.knowledgeCounts)
  const activity = useStore((s) => s.activity)
  const scrapeRun = useStore((s) => s.scrapeRun)
  const setPage = useStore((s) => s.setPage)
  const openReview = useStore((s) => s.openReview)
  const openTheater = useStore((s) => s.openTheater)
  const runScraping = useStore((s) => s.runScraping)
  const openBar = useStore((s) => s.openBar)

  const months = useMemo(
    () => [...new Set(analytics.map((a) => a.month))].sort().reverse(),
    [analytics],
  )
  /*
   * The chosen month, not the stored one. `analytics` arrives after mount, so a
   * `useState(months[0])` initialiser ran while the list was still empty and
   * stayed on '' forever — the select then showed the newest month while every
   * figure on the page filtered on a month that matched nothing.
   */
  const [picked, setPicked] = useState<string | null>(null)
  const month = picked !== null && months.includes(picked) ? picked : (months[0] ?? '')
  const [platformTab, setPlatformTab] = useState<PlatformTab>('linkedin')

  /**
   * The lessons the Learning Agent actually wrote, newest first.
   *
   * Only categories that record something observed: a brand rule is
   * configuration, not a finding, so it does not belong in a panel about what
   * the account has learned.
   */
  const learned = useMemo(
    () =>
      knowledge
        .filter((entry) => entry.active && !BRAND_DEFINITION_CATEGORIES.includes(entry.category))
        .slice(0, 4),
    [knowledge],
  )

  const monthRows = analytics.filter((a) => a.month === month)
  const linkedin = monthRows.find((a) => a.platform === 'linkedin')
  const instagram = monthRows.find((a) => a.platform === 'instagram')
  const reported = monthRows.some((a) => a.is_reported)

  const previousMonth = months[months.indexOf(month) + 1]
  const previousLinkedIn = analytics.find((a) => a.month === previousMonth && a.platform === 'linkedin')

  const engagementDelta =
    linkedin && previousLinkedIn && previousLinkedIn.metrics.engagementRate
      ? ((linkedin.metrics.engagementRate - previousLinkedIn.metrics.engagementRate) /
          previousLinkedIn.metrics.engagementRate) *
        100
      : null

  const awaitingLeadership = ideas.filter((i) => i.status === 'pending_leadership').length
  const scheduled = ideas.filter(
    (i) =>
      i.calendar_slot === 'primary' &&
      new Date(i.scheduled_date).getTime() > Date.now() &&
      new Date(i.scheduled_date).getTime() < Date.now() + 14 * 86_400_000,
  ).length

  const totalReach = published.reduce((sum, p) => sum + (p.reach ?? 0), 0)
  const avgEngagement =
    published.length > 0
      ? published.reduce((sum, p) => sum + Number(p.engagement_rate ?? 0), 0) / published.length
      : 0

  const spark = (rows: number[]): number[] => rows.slice(-12)

  const reachTrend = useMemo(() => {
    const byMonth = [...months].reverse()
    return byMonth.map((key) => {
      const li = analytics.find((a) => a.month === key && a.platform === 'linkedin')
      const ig = analytics.find((a) => a.month === key && a.platform === 'instagram')
      return {
        label: li?.label?.split(' ')[0] ?? key,
        LinkedIn: li?.metrics.reach ?? 0,
        Instagram: ig?.metrics.reach ?? 0,
      }
    })
  }, [analytics, months])

  const upNext = useMemo(
    () =>
      [...ideas]
        .filter((i) => i.status !== 'published' && i.status !== 'rejected')
        .sort((a, b) => `${a.scheduled_date}${a.scheduled_time}`.localeCompare(`${b.scheduled_date}${b.scheduled_time}`))
        .slice(0, 4),
    [ideas],
  )

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="How Ethara.AI's social presence is performing, and what the agents are doing about it."
        agents={['assistant', 'scraping', 'calendar', 'publishing', 'analytics']}
        actions={
          <>
            {reported ? <Badge tone="good">Reported platform data</Badge> : null}
            {/* No month is a real state: an empty picker is a control that does nothing. */}
            {months.length > 0 ? (
              <select
                value={month}
                onChange={(event) => setPicked(event.target.value)}
                aria-label="Month"
                className="rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
              >
                {months.map((key) => (
                  <option key={key} value={key}>
                    {analytics.find((a) => a.month === key)?.label ?? key}
                  </option>
                ))}
              </select>
            ) : null}
            <DownloadMenu
              options={[
                {
                  id: 'combined',
                  label: 'Combined analytics',
                  hint: 'One row per platform per month, every reported metric.',
                  onSelect: (format) => exportCombined(analytics, format),
                },
                {
                  id: 'per-post',
                  label: 'Per-post analytics',
                  hint: 'Every published post with its latest metric reading.',
                  onSelect: (format) => exportPerPost(published, format),
                },
              ]}
            />
            {user?.role === 'marketing' ? (
              <PlayButton
                label="Run SocialAI"
                hint="Twelve agents · watch it live"
                running={scrapeRun.running}
                onClick={() => {
                  openTheater()
                  void runScraping()
                }}
              />
            ) : null}
          </>
        }
      />

      {/* ── Live scrape banner ────────────────────────────────────────────── */}
      {/* Closing the theater minimises the run onto this strip, so the strip is
          the way back into it. Without that, a closed theater on a running
          crawl leaves no route back to the feed. */}
      {scrapeRun.running ? (
        <button
          type="button"
          onClick={openTheater}
          aria-label="Reopen the pipeline run screen"
          className="anim-fade-in group mb-4 block w-full rounded-xl border border-accent/40 bg-accent/8 px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-ink">
              Sherlock · scanning <span className="font-medium">{scrapeRun.currentKeyword || '…'}</span>
            </p>
            <p className="tabular flex items-center gap-2 text-[12px] text-ink-3">
              {scrapeRun.found} items · {scrapeRun.progress}%
              <span className="flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] transition-colors group-hover:border-accent group-hover:text-accent-bright">
                <Maximize2 size={10} aria-hidden="true" /> Open run
              </span>
            </p>
          </div>
          <Progress value={scrapeRun.progress} className="mt-2" />
        </button>
      ) : null}

      {/* ── KPI strip ─────────────────────────────────────────────────────── */}
      <section className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <KpiCard index={0} label="Posts published" value={published.length} spark={spark(published.map((p) => p.reach ?? 0))} onClick={() => setPage('published')} />
        <KpiCard index={1} label="Awaiting leadership" value={awaitingLeadership} tone={awaitingLeadership > 0 ? 'serious' : undefined} hint="Two-stage approval" onClick={() => setPage('leadership')} />
        <KpiCard index={2} label="Scheduled · 2 weeks" value={scheduled} hint="On the calendar" onClick={() => setPage('calendar')} />
        <KpiCard
          index={3}
          label="Engagement rate"
          value={linkedin?.metrics.engagementRate ?? 0}
          format={(n) => `${n.toFixed(2)}%`}
          delta={engagementDelta}
          hint="LinkedIn, MoM"
          {...(linkedin === undefined
            ? { unavailable: 'LinkedIn has reported no monthly rollup yet' }
            : {})}
        />
        <KpiCard index={4} label="Total reach" value={totalReach} spark={spark(published.map((p) => p.impressions ?? 0))} />
        <KpiCard
          index={5}
          label="Followers"
          value={linkedin?.metrics.followerGrowth ?? 0}
          hint={`+${fmt(instagram?.metrics.followerGrowth ?? 0)} on Instagram`}
          {...(linkedin === undefined
            ? { unavailable: 'No follower figures reported for this period' }
            : {})}
        />
        <KpiCard
          index={6}
          label="Avg engagement"
          value={avgEngagement}
          format={(n) => `${n.toFixed(2)}%`}
          hint={`Across ${published.length} published post${published.length === 1 ? '' : 's'}`}
          {...(published.length === 0 ? { unavailable: 'Nothing has published yet' } : {})}
        />
        {/* The true total from the server. Counting `knowledge.length` reported
            the page cap (400) once the corpus pushed the store past it. */}
        <KpiCard
          index={7}
          label="Knowledge base"
          value={knowledgeCounts?.active ?? knowledge.filter((k) => k.active).length}
          hint="Active entries"
          onClick={() => useStore.getState().openKnowledge()}
        />
      </section>

      {/* ── Row 2 ─────────────────────────────────────────────────────────── */}
      <section className="mb-5 grid gap-4 lg:grid-cols-3">
        <div className="card p-4">
          <h3 className="display mb-3 text-sm">Agent activity</h3>
          <ul className="space-y-2">
            {activity.slice(0, 8).map((event) => (
              <li key={event.id}>
                <button
                  type="button"
                  onClick={() => setPage('orchestration')}
                  className="flex w-full items-start gap-2 rounded-lg px-1.5 py-1 text-left transition-colors hover:bg-surface-2"
                >
                  <span
                    className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                      event.status === 'error'
                        ? 'bg-critical'
                        : event.status === 'warn'
                          ? 'bg-warn'
                          : event.status === 'running'
                            ? 'bg-accent anim-pulse-dot'
                            : 'bg-good'
                    }`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[11.5px] leading-relaxed text-ink-2">{event.message}</span>
                    <span className="block text-[10px] text-ink-3">
                      {event.agent_id} · {timeAgo(event.created_at)}
                    </span>
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </div>

        <ChartCard title="Reach trend" subtitle="LinkedIn against Instagram, by month" height={210}>
          <TrendArea
            data={reachTrend}
            series={[
              { key: 'LinkedIn', name: 'LinkedIn', colour: SERIES.linkedin },
              { key: 'Instagram', name: 'Instagram', colour: SERIES.instagram },
            ]}
          />
        </ChartCard>

        <div className="card p-4">
          <h3 className="display mb-3 text-sm">Up next</h3>
          {upNext.length === 0 ? (
            <EmptyState title="Nothing scheduled" body="Run discovery and Dora will fill the week." />
          ) : (
            <ul className="space-y-2">
              {upNext.map((idea) => (
                <li key={idea.id}>
                  <button
                    type="button"
                    onClick={() => openReview(idea.id)}
                    className="flex w-full items-start gap-2.5 rounded-lg border border-line px-2.5 py-2 text-left transition-colors hover:border-line-strong hover:bg-surface-2"
                  >
                    <PlatformIcon platform={idea.platform} size={14} className="mt-0.5" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12px] font-medium text-ink">{idea.title}</span>
                      <span className="tabular block text-[10.5px] text-ink-3">
                        {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' })} · {idea.scheduled_time}
                      </span>
                    </span>
                    <span className="tabular shrink-0 text-[11px] text-ink-3">{idea.confidence}%</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </section>

      {/* ── Row 3 ─────────────────────────────────────────────────────────── */}
      {/* Ask Ethara is a fixed 520px column. Stretching the row would size the
          left card to it even when there is little to show, so each column takes
          its own height and they align at the top. */}
      <section className="mb-5 grid items-start gap-4 lg:grid-cols-[1fr_380px]">
        <div className="card p-4">
          <h3 className="display mb-1 text-sm">What the agents have learned</h3>
          <p className="mb-3 text-[11.5px] leading-relaxed text-ink-3">
            Written by the Learning Agent from measured outcomes and your own instructions. Nothing
            here is an estimate — an empty panel means nothing has been measured yet.
          </p>

          {learned.length === 0 ? (
            <EmptyState
              title="No lessons recorded yet"
              body="The Learning Agent writes here once posts have published and been measured, or once you have given an instruction worth remembering."
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              {learned.map((entry, index) => (
                <Tilt key={entry.id} maxDeg={5} className="h-full rounded-xl">
                  <article className="group card-hover relative flex h-full flex-col rounded-xl border border-line bg-surface-2 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <span className="mono text-[11px] text-accent-bright">
                        {String(index + 1).padStart(2, '0')}
                      </span>
                      <div className="flex items-center gap-1.5">
                        <Badge tone="neutral">{entry.category}</Badge>
                        <Badge tone={entry.confidence === 'High' ? 'good' : 'accent'}>
                          {entry.confidence}
                        </Badge>
                      </div>
                    </div>
                    {/* Clamped so a long lesson title cannot push the body and
                        the source line out of step with the card beside it. */}
                    <h4 className="mt-1.5 line-clamp-2 text-[12.5px] font-medium text-ink">{entry.title}</h4>
                    <p className="mt-1 line-clamp-4 text-[11.5px] leading-relaxed text-ink-3">
                      {entry.content}
                    </p>
                    <p className="mt-auto pt-1.5 text-[10.5px] text-ink-3">
                      {entry.source} · {entry.evidence_count} observation
                      {entry.evidence_count === 1 ? '' : 's'}
                    </p>
                  </article>
                </Tilt>
              ))}
            </div>
          )}
        </div>

        <AskAssistantCard month={linkedin?.label ?? month} rows={monthRows} onOpenBar={openBar} />
      </section>

      {/* ── Platform analysis ─────────────────────────────────────────────── */}
      <section className="card p-4">
        <header className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="display text-sm">Platform analysis</h3>
            <p className="mt-0.5 text-[11px] text-ink-3">
              {linkedin?.label ? `${linkedin.label} · ` : ''}measured against this account's own trailing baseline
            </p>
          </div>
          <Tabs<PlatformTab>
            tabs={[
              { id: 'linkedin', label: 'LinkedIn' },
              { id: 'instagram', label: 'Instagram' },
              { id: 'x', label: 'X' },
              { id: 'facebook', label: 'Facebook' },
            ]}
            active={platformTab}
            onChange={setPlatformTab}
          />
        </header>

        <PlatformPanel tab={platformTab} month={month} />
      </section>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE PLATFORM PANEL — four figures, one graph, one reading. Nothing else.
   ═══════════════════════════════════════════════════════════════════════════ */

function PlatformPanel({ tab, month }: { tab: Platform; month: string }) {
  const analytics = useStore((s) => s.analytics)
  const published = useStore((s) => s.published)

  const row = analytics.find((a) => a.month === month && a.platform === tab)

  // X and Facebook report no monthly rollup, so their figures are computed from posts.
  if (tab === 'x' || tab === 'facebook') {
    const posts = published.filter((p) => p.platform === tab)
    const reach = posts.reduce((sum, p) => sum + (p.reach ?? 0), 0)
    const impressions = posts.reduce((sum, p) => sum + (p.impressions ?? 0), 0)
    const interactions = posts.reduce((sum, p) => sum + (p.likes ?? 0) + (p.comments ?? 0) + (p.shares ?? 0), 0)

    return (
      <div>
        <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
          <Metric label="Posts" value={posts.length} />
          <Metric label="Reach" value={fmt(reach)} />
          <Metric label="Impressions" value={fmt(impressions)} />
          <Metric label="Interactions" value={fmt(interactions)} />
        </div>
        <InsightChart
          data={posts.map((p) => ({ label: p.title.slice(0, 18), value: p.reach ?? 0 }))}
          period="the period"
          colour={SERIES[tab]}
          valueLabel="Reach"
          details={[{ label: 'Reposts', derive: (r) => r.value }]}
        />
        <p className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11.5px] leading-relaxed text-ink-3">
          {PLATFORM_LABEL[tab]} reports no monthly rollup yet, so these figures are computed from the posts themselves rather
          than from a platform export. Reach here is post-level and not directly comparable with the
          LinkedIn or Instagram monthly totals.
        </p>
      </div>
    )
  }

  if (!row) {
    return analytics.length === 0 ? (
      <EmptyState
        title="Nothing reported yet"
        body={`No monthly rollup has been recorded for ${PLATFORM_LABEL[tab]}. Refresh analytics once a period has closed.`}
      />
    ) : (
      <EmptyState title="No reported data for this month" body="Pick another month, or refresh analytics." />
    )
  }

  const daily = row.daily.map((d) => ({
    label: new Date(d.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }),
    value: d.value,
  }))

  const headline =
    tab === 'linkedin'
      ? [
          { label: 'Impressions', value: fmt(row.metrics.impressions) },
          { label: 'Engagements', value: fmt(row.metrics.engagements) },
          { label: 'Page views', value: fmt(row.metrics.pageViews) },
          { label: 'New followers', value: `+${fmt(row.metrics.followerGrowth)}` },
        ]
      : [
          { label: 'Views', value: fmt(row.metrics.views) },
          { label: 'Unique viewers', value: fmt(row.metrics.uniqueViewers) },
          { label: 'Interactions', value: fmt(row.metrics.interactions) },
          { label: 'Non-follower share', value: `${row.metrics.nonFollowerShare}%` },
        ]

  const reading =
    tab === 'linkedin'
      ? `LinkedIn recorded ${fmt(row.metrics.impressions)} impressions against ${fmt(row.metrics.engagements)} engagements, an engagement rate of ${row.metrics.engagementRate}%. Follower growth was ${fmt(row.metrics.followerGrowth)}, ${row.metrics.organicShare}% of it organic — which means the reach was earned rather than bought.`
      : `Instagram recorded ${fmt(row.metrics.views)} views from ${fmt(row.metrics.uniqueViewers)} unique viewers, with ${row.metrics.nonFollowerShare}% of views coming from non-followers. The interaction rate of ${row.metrics.engagementRate}% is low in absolute terms and normal for this account given how much of the reach is discovery rather than audience.`

  return (
    <div>
      <div className="mb-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {headline.map((item) => (
          <Metric key={item.label} label={item.label} value={item.value} />
        ))}
      </div>

      <InsightChart
        data={daily}
        period={row.label ?? month}
        colour={tab === 'linkedin' ? SERIES.linkedin : SERIES.instagram}
        valueLabel={tab === 'linkedin' ? 'Impressions' : 'Views'}
        details={[
          {
            label: 'Weekday',
            derive: (r) => new Date(`${month}-01`).toLocaleDateString('en-GB', { month: 'long' }) + ' · ' + r.label,
          },
        ]}
      />

      <div className="mt-4 rounded-xl border border-line bg-surface-2 p-3">
        <h4 className="display text-[12px]">What the numbers say</h4>
        <p className="mt-1 text-[12px] leading-relaxed text-ink-3">{reading}</p>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   ASK Ethara — grounded in the selected month's platform data
   ═══════════════════════════════════════════════════════════════════════════ */

interface Bubble {
  id: string
  speaker: 'operator' | 'assistant'
  text: string
}

function AskAssistantCard({
  month,
  rows,
  onOpenBar,
}: {
  month: string
  rows: Array<{ platform: string; label: string | null; metrics: Record<string, number> }>
  onOpenBar: (prefill: string) => void
}) {
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [value, setValue] = useState('')
  const [thinking, setThinking] = useState(false)

  const ask = (question: string): void => {
    const trimmed = question.trim()
    if (trimmed.length === 0) return

    setBubbles((prev) => [...prev, { id: `q-${Date.now()}`, speaker: 'operator', text: trimmed }])
    setValue('')
    setThinking(true)

    // A 900ms think is narrated, not hidden.
    window.setTimeout(() => {
      setBubbles((prev) => [
        ...prev,
        { id: `a-${Date.now()}`, speaker: 'assistant', text: answerFromAnalytics(trimmed, rows) },
      ])
      setThinking(false)
    }, 950)
  }

  return (
    <div className="card flex h-[520px] flex-col p-4">
      <header className="mb-3 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <AssistantCore state={thinking ? 'thinking' : 'dormant'} size={26} />
          <h3 className="display text-sm">Ask Ethara</h3>
        </div>
        <button
          type="button"
          onClick={() => onOpenBar(month ? `How did ${month} perform?` : 'How are we performing?')}
          aria-label="Open the command bar"
          className="text-[11px] text-ink-3 transition-colors hover:text-ink-2"
        >
          ⌘K
        </button>
      </header>

      <div className="flex-1 space-y-2.5 overflow-y-auto pr-1">
        {bubbles.length === 0 ? (
          <>
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              {month
                ? `Grounded in ${month}'s platform data.`
                : 'No month has reported yet, so there is no platform rollup to ground an answer in.'}{' '}
              Every answer is measured against this account's own baseline, never an industry benchmark.
            </p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {SUGGESTED_QUESTIONS.map((question) => (
                <button
                  key={question}
                  type="button"
                  onClick={() => ask(question)}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                >
                  {question}
                </button>
              ))}
            </div>
          </>
        ) : null}

        {bubbles.map((bubble) =>
          bubble.speaker === 'operator' ? (
            <div key={bubble.id} className="anim-fade-up flex justify-end">
              <p className="max-w-[86%] rounded-xl rounded-br-sm border border-accent/35 bg-accent/10 px-3 py-2 text-[12px] leading-relaxed text-ink">
                {bubble.text}
              </p>
            </div>
          ) : (
            <div key={bubble.id} className="anim-fade-up flex gap-2">
              <AssistantCore state="dormant" size={20} className="mt-0.5 shrink-0" />
              <p className="max-w-[86%] text-[12px] leading-relaxed text-ink-2">{bubble.text}</p>
            </div>
          ),
        )}

        {thinking ? (
          <div className="flex gap-2">
            <AssistantCore state="thinking" size={20} className="mt-0.5 shrink-0" />
            <p className="text-[12px] text-ink-3">Analysing {month} data…</p>
          </div>
        ) : null}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault()
          ask(value)
        }}
        className="mt-3 flex items-center gap-2"
      >
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          placeholder="Ask about this month…"
          aria-label="Ask Ethara about this month"
          className="flex-1 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] outline-none focus:border-accent"
        />
        <Btn type="submit" variant="primary" disabled={value.trim().length === 0}>
          <Sparkles size={13} />
        </Btn>
      </form>
    </div>
  )
}

/**
 * THE DASHBOARD — the command centre.
 *
 * One screen with the emblem at its heart and the platform's work arranged
 * around it. Every card is a door to the screen that owns that work, and
 * every figure on a card is read from state: a number the platform has not
 * measured is shown as not measured, never as a placeholder.
 */

import { useMemo, useState, type ReactNode } from 'react'
import { ArrowUpRight, ExternalLink, Play, Sparkles } from 'lucide-react'
import { AGENT_BY_ID } from '@shared/agent-registry'
import { operationalAgents } from '../../shared/agent-contract'
import { useStore } from '../store'
import { DownloadMenu } from '../components/download-menu'
import { navFor } from '../components/layout'
import { AgentHologram } from '../components/agent-hologram'
import { Btn, Dialog, EmptyState, PLATFORM_LABEL, PLATFORM_TOKEN, PlatformIcon, fmt, timeAgo } from '../components/ui'
import { exportCombined, exportPerPost } from '../lib/export'
import type { AgentId, AgentState, Idea, PageId, Platform, ReviewQueueItem } from '../types'

/**
 * Knowledge that is brand definition (configuration), not something learned.
 * Excluded by name so any category the Learning Agent produces counts as a lesson.
 */
const BRAND_DEFINITION_CATEGORIES = ['Brand Corpus', 'Brand Voice', 'Brand Guideline', 'Visual Identity', 'Compliance Rule']
const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'x', 'facebook']
const DAY_MS = 86_400_000

function agentShort(id: AgentId): string {
  return AGENT_BY_ID[id]?.name.replace(' Agent', '') ?? id
}

function startOfWeek(date: Date): Date {
  const d = new Date(date)
  d.setHours(0, 0, 0, 0)
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7))
  return d
}
function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/**
 * Desktop track count and width cap per tile count, as whole class strings.
 *
 * Written out rather than generated so Tailwind's compiler sees every class it
 * must emit. `w-*` fractions mirror `count / 6`, which is what keeps a short row
 * the same tile size as a full one.
 */
const TILE_GRID: Record<number, string> = {
  1: 'sm:grid-cols-1 sm:w-1/6',
  2: 'sm:grid-cols-2 sm:w-2/6',
  3: 'sm:grid-cols-3 sm:w-3/6',
  4: 'sm:grid-cols-4 sm:w-4/6',
  5: 'sm:grid-cols-5 sm:w-5/6',
  6: 'sm:grid-cols-6',
}

export function Dashboard() {
  const user = useStore((s) => s.user)
  const analytics = useStore((s) => s.analytics)
  const published = useStore((s) => s.published)
  const ideas = useStore((s) => s.ideas)
  const knowledge = useStore((s) => s.knowledge)
  const knowledgeCounts = useStore((s) => s.knowledgeCounts)
  const agents = useStore((s) => s.agents)
  const reviewQueue = useStore((s) => s.reviewQueue)
  const pendingConfirm = useStore((s) => s.assistant.pendingConfirm)
  const scrapeRun = useStore((s) => s.scrapeRun)
  const setPage = useStore((s) => s.setPage)
  const openTheater = useStore((s) => s.openTheater)
  const runScraping = useStore((s) => s.runScraping)
  const [queueOpen, setQueueOpen] = useState(false)

  const [statusOpen, setStatusOpen] = useState(false)

  /* ── Reach and engagement: the latest reported month, summed across platforms ── */
  const month = useMemo(() => [...new Set(analytics.filter((a) => a.is_reported).map((a) => a.month))].sort().reverse()[0] ?? null, [analytics])
  const reportedRows = useMemo(() => analytics.filter((a) => a.month === month && a.is_reported), [analytics, month])
  const monthLabel = reportedRows[0]?.label ?? month ?? null
  /** Sum of one metric across the rows that report it; null when none does. */
  const metric = (key: string): number | null => {
    const rows = reportedRows.filter((r) => typeof r.metrics[key] === 'number')
    return rows.length === 0 ? null : rows.reduce((sum, r) => sum + (r.metrics[key] ?? 0), 0)
  }
  const rollupReach = metric('reach') ?? metric('impressions')
  const rollupRate = (() => {
    const rows = reportedRows.filter((r) => typeof r.metrics.engagementRate === 'number')
    return rows.length === 0 ? null : rows.reduce((s, r) => s + (r.metrics.engagementRate ?? 0), 0) / rows.length
  })()

  /*
   * WHEN NO MONTHLY ROLLUP EXISTS, READ OUR OWN POSTS — AND SAY SO.
   *
   * These three figures came only from `platform_analytics`, the platform's own
   * monthly rollup, and that table is empty for this workspace. So the command
   * centre showed "—" for reach while the Published Posts screen, reading the
   * very same account, showed a reach summed from the posts' own readings. Two
   * screens disagreeing about one account is worse than either answer.
   *
   * The rollup still wins when it exists, because a platform's monthly reach is
   * not the same quantity as the sum of what our posts reported. When it does
   * not exist we show what we measured, labelled as being from posts. Followers
   * have no per-post equivalent, so they stay missing rather than invented.
   */
  const fromPosts = useMemo(() => {
    const reached = published.map((p) => p.reach).filter((v): v is number => v !== null)
    const rated = published.map((p) => p.engagement_rate).filter((v): v is string => v !== null).map(Number)
    return {
      reach: reached.length === 0 ? null : reached.reduce((a, b) => a + b, 0),
      rate: rated.length === 0 ? null : rated.reduce((a, b) => a + b, 0) / rated.length,
      posts: Math.max(reached.length, rated.length),
    }
  }, [published])

  const reach = rollupReach ?? fromPosts.reach
  const engagementRate = rollupRate ?? fromPosts.rate
  const followers = metric('followerGrowth')
  /** True when the figures above came from our posts, not the platform's month. */
  const readFromPosts = reportedRows.length === 0 && (fromPosts.reach !== null || fromPosts.rate !== null)
  const daily = useMemo(() => {
    const byDate = new Map<string, number>()
    for (const row of reportedRows) for (const d of row.daily) byDate.set(d.date, (byDate.get(d.date) ?? 0) + d.value)
    return [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([, v]) => v)
  }, [reportedRows])

  /* ── Engagement breakdown and top content: from the published posts' own readings ── */
  const breakdown = useMemo(() => {
    const parts = (['likes', 'comments', 'shares'] as const).map((key) => ({
      key,
      value: published.reduce((sum, p) => sum + (p[key] ?? 0), 0),
      reported: published.some((p) => p[key] !== null),
    }))
    const total = parts.reduce((s, p) => s + p.value, 0)
    return { parts, total, reported: parts.some((p) => p.reported) }
  }, [published])

  /* ── This week ── */
  const today = useMemo(() => new Date(), [])
  const week = useMemo(() => {
    const start = startOfWeek(today)
    return Array.from({ length: 7 }, (_, i) => {
      const day = new Date(start.getTime() + i * DAY_MS)
      const iso = isoDate(day)
      return { iso, day, items: ideas.filter((idea) => idea.calendar_slot === 'primary' && idea.scheduled_date === iso && idea.status !== 'rejected') }
    })
  }, [ideas, today])
  const placed = week.reduce((s, d) => s + d.items.length, 0)
  /** Published posts with a reading, strongest first. */
  const topContent = useMemo(
    () =>
      [...published]
        .filter((post) => post.likes !== null || post.comments !== null || post.shares !== null || post.impressions !== null)
        .sort((a, b) => (b.likes ?? 0) + (b.comments ?? 0) + (b.shares ?? 0) - ((a.likes ?? 0) + (a.comments ?? 0) + (a.shares ?? 0)))
        .slice(0, 3),
    [published],
  )

  /** The strongest drafts, for the card that stands in until something is published. */
  const topDrafts = useMemo(
    () => [...ideas].filter((i) => i.status !== 'suggested' && i.status !== 'rejected').sort((a, b) => b.confidence - a.confidence).slice(0, 4),
    [ideas],
  )
  /*
   * WHAT THE WEEK HOLDS — AND NEVER AN EMPTY LIST BESIDE A COUNT.
   *
   * This listed only posts dated today or later, so on a Sunday — with every
   * one of the week's posts behind it — the panel read "Nothing placed in this
   * week" directly under a hint saying seven were placed. Two true statements
   * that cannot both be true of the same week.
   *
   * So it shows what is still ahead, and when nothing is, what the week held,
   * saying which of the two it is. Empty now means the week is genuinely empty.
   */
  const weekList = useMemo(() => {
    const todayKey = isoDate(today)
    const all = week.flatMap((d) => d.items)
    const ahead = all.filter((i) => i.scheduled_date >= todayKey)
    if (ahead.length > 0) return { rows: ahead.slice(0, 3), ahead: true, total: all.length }
    return { rows: [...all].reverse().slice(0, 3), ahead: false, total: all.length }
  }, [week, today])
  /** What the Content Intelligence panel shows: lessons if any, else the most-cited entries. */
  const insightRows = useMemo(() => {
    const lessons = knowledge.filter((e) => e.active && !BRAND_DEFINITION_CATEGORIES.includes(e.category)).slice(0, 3)
    if (lessons.length > 0) return lessons
    return [...knowledge].filter((e) => e.active).sort((a, b) => b.evidence_count - a.evidence_count).slice(0, 3)
  }, [knowledge])

  /** When nothing has been learned yet, the entries the agents lean on most. */

  /** Everything written but not yet out — what the Create station holds. */
  const drafts = useMemo(
    () =>
      [...ideas]
        .filter((i) => i.status === 'drafted' || i.status === 'in_review' || i.status === 'pending_leadership')
        .sort((a, b) => `${a.scheduled_date} ${a.scheduled_time}`.localeCompare(`${b.scheduled_date} ${b.scheduled_time}`)),
    [ideas],
  )

  /* ── Waiting on people ── */
  const awaitingLeadership = useMemo(() => ideas.filter((i) => i.status === 'pending_leadership'), [ideas])
  const openVerdicts = useMemo(() => reviewQueue.filter((q) => !q.resolved), [reviewQueue])
  const waitingCount = awaitingLeadership.length + openVerdicts.length + (pendingConfirm ? 1 : 0)
  const total = waitingCount
  /** The queue in one line each, for the card. The dialog holds the full cards. */
  const waitingRows = useMemo(
    () => [
      ...(pendingConfirm ? [{ id: 'confirm', kind: 'confirm', title: pendingConfirm.prompt, age: 'now' }] : []),
      ...awaitingLeadership.map((i) => ({ id: i.id, kind: 'gate', title: i.title, age: timeAgo(i.marketing_approved_at ?? i.updated_at) })),
      ...openVerdicts.map((q) => ({ id: q.id, kind: q.kind.replace(/[_.]/g, ' '), title: q.entity_title ?? q.decision_requested, age: timeAgo(q.created_at) })),
    ],
    [pendingConfirm, awaitingLeadership, openVerdicts],
  )
  const oldestWait = [...awaitingLeadership.map((i) => i.marketing_approved_at ?? i.updated_at), ...openVerdicts.map((q) => q.created_at)].sort()[0]

  /* ── Lessons, agents, platforms ── */
  const kbCount = knowledgeCounts?.active ?? knowledge.filter((k) => k.active).length
  const running = agents.filter((a) => a.status === 'running')
  const lastRun = agents.map((a) => a.last_run).filter((v): v is string => v !== null).sort().reverse()[0] ?? null
  const platformRows = PLATFORMS.map((platform) => ({
    platform,
    scheduled: ideas.filter((i) => i.platform === platform && i.calendar_slot === 'primary' && i.status !== 'rejected' && i.status !== 'published').length,
    published: published.filter((p) => p.platform === platform).length,
  }))
  const controls = navFor(user?.role ?? 'marketing').flatMap((g) => g.items).filter((i) => i.page !== 'dashboard')

  const busy = running.length > 0 || scrapeRun.running
  const statusLine = busy
    ? `${running[0] ? agentShort(running[0].agent_id) : 'Sherlock'} · ${running[0]?.current_task ?? 'capturing'}`
    /* `operationalAgents` and not `agents`: Ethara Command is the instruction
       coming in, and the Knowledge Base is a store that is read and written, so
       neither is an agent that sits idle waiting for work. The registry still
       declares twelve because the graph is built from twelve; the roster an
       operator watches is ten. See NON_OPERATIONAL_AGENT_IDS for each reason. */
    : lastRun ? `all ${operationalAgents(agents).length} agents idle · last run ${timeAgo(lastRun)}` : `all ${operationalAgents(agents).length} agents idle · no run yet`

  return (
    <div className="relative flex min-h-0 w-full flex-1 flex-col">
      {/* The ambient field the glass sits over: light from behind the core,
          a warmer wash low and right, and a vignette holding the edges. */}
      <div aria-hidden="true" className="pointer-events-none absolute -inset-x-6 inset-y-0 -z-10 overflow-hidden">
        <span className="absolute left-1/2 top-[38%] h-[640px] w-[900px] -translate-x-1/2 -translate-y-1/2 rounded-full" style={{ background: 'radial-gradient(closest-side, color-mix(in srgb, var(--color-accent) 26%, transparent), transparent)', filter: 'blur(40px)' }} />
        <span className="absolute right-[-10%] bottom-[-10%] h-[520px] w-[620px] rounded-full" style={{ background: 'radial-gradient(closest-side, color-mix(in srgb, var(--color-magenta) 16%, transparent), transparent)', filter: 'blur(48px)' }} />
        <span className="absolute left-[-8%] top-[-6%] h-[420px] w-[520px] rounded-full" style={{ background: 'radial-gradient(closest-side, color-mix(in srgb, var(--color-accent-bright) 14%, transparent), transparent)', filter: 'blur(44px)' }} />
      </div>

      {/* ── Title row ─────────────────────────────────────────────────── */}
      <div className="mb-3.5 flex flex-wrap items-center gap-3">
        <div className="min-w-0">
          <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Command centre</h1>
          <p className="text-[11.5px] text-ink-3">Every card opens the screen that owns the work. Every figure is read from the platform.</p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <DownloadMenu
            options={[
              { id: 'combined', label: 'Combined analytics', hint: 'One row per platform per month, every reported metric.', onSelect: (format) => exportCombined(analytics, format) },
              { id: 'per-post', label: 'Per-post analytics', hint: 'Every published post with its latest metric reading.', onSelect: (format) => exportPerPost(published, format) },
            ]}
          />
          <SystemPill
            agents={agents}
            busy={busy}
            statusLine={statusLine}
            open={statusOpen}
            onToggle={() => setStatusOpen((v) => !v)}
            onOpenTheater={() => { setStatusOpen(false); if (user?.role === 'leadership') setPage('orchestration'); else openTheater() }}
            leadership={user?.role === 'leadership'}
          />
          {user?.role === 'marketing' ? (
            <Btn
              variant="primary"
              disabled={scrapeRun.running}
              onClick={() => {
                openTheater()
                void runScraping()
              }}
              className="!py-[6px] !text-[12px] font-semibold"
            >
              {scrapeRun.running ? <WorkArc /> : <Play size={12} aria-hidden="true" />}
              {scrapeRun.running ? 'Running' : 'Run pipeline'}
            </Btn>
          ) : null}
        </div>
      </div>

      {/* ── The command centre ────────────────────────────────────────
          A 21% / 1fr / 21% grid, flat. The side columns used to turn 8° toward
          the middle with the agent proud of them and the scene tracking the
          pointer; all of that is gone. Depth that layout cannot see is depth
          that overlaps, so position here is decided by the grid alone. */}
      <section
        aria-label="Command centre"
        className="relative flex min-h-0 flex-1 flex-col"
      >
        {/* Flat, and deliberately so. This wrapper used to carry a pointer-driven
            `rotateX/rotateY` written straight onto the node, inside a
            `perspective: 1600` parent with `preserve-3d` children. Because the
            rotation was an INLINE style it beat every stylesheet rule, and
            because it tracked the cursor the overlap appeared only once the
            pointer reached certain areas — which is why it looked fine on one
            machine and broken on another. Rotating the scene tilted the grid
            over the foot bar below it while layout still believed both fit. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3.5">
          <div
            className="grid min-h-0 flex-1 gap-4 xl:grid-cols-[minmax(280px,21%)_minmax(0,1fr)_minmax(280px,21%)] xl:grid-rows-[minmax(0,1fr)]"
          >

            {/* ── left ─────────────────────────────────────────────── */}
            <div
              /*
                `min-h-0` + `overflow-y-auto` is what stops this column spilling
                onto the foot bar, and it is the real reason the overlap showed up
                on Windows but not on macOS.

                Every link in the chain above — `min-h-0 flex-1` on the section, the
                same on the scene, `grid-rows-[minmax(0,1fr)]` on the grid — permits
                the row to be SHORTER than its content. But a flex child will not
                shrink below its own content unless it is given `min-h-0`, so
                without it this column kept its full content height, overran the
                row, and painted past the bottom of the grid. The foot bar carries
                `z-10`, so it then covered whatever had spilled — which is exactly
                what "Everything else is overlapping" looks like.

                Nothing there is platform specific in itself; it triggers whenever
                content is taller than the row, and Windows reaches that first
                through different text metrics and 125% display scaling. The same
                defect exists on both, and was only visible on one.

                Contained here, content can never leave the grid box, so no font
                size, zoom level or device pixel ratio can bring it back.
              */
              className="hub-tilt-left flex min-w-0 flex-col justify-start gap-3.5 min-h-0 overflow-y-auto overscroll-auto"
            >
              <Panel title="Content Intelligence" hint={`${kbCount} entries`} onOpen={() => setPage('intelligence')} delay={120}>
                {insightRows.length === 0 ? (
                  <NotMeasured>The Knowledge Base is empty. Entries arrive once a research build has run.</NotMeasured>
                ) : (
                  <ul className="flex flex-col gap-[7px]">
                    {insightRows.map((entry) => (
                      <li key={entry.id}>
                        <Row>
                          <span className="flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-lg border border-hud-strong bg-accent/12">
                            <Sparkles size={11} className="text-accent-bright" aria-hidden="true" />
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate text-[11.5px] font-medium text-ink">{entry.title}</span>
                            <span className="mono mt-0.5 block truncate text-[8px] uppercase tracking-[0.1em] text-ink-3">
                              {entry.category} · {entry.evidence_count} cited
                            </span>
                          </span>
                        </Row>
                      </li>
                    ))}
                  </ul>
                )}
              </Panel>

              {/* The second station belongs to the role. Marketing writes, so it
                  gets Create. Leadership signs off, so it gets the gate it owns —
                  putting drafts there offered work that is not theirs to do. */}
              {user?.role === 'leadership' ? (
                <Panel
                  title="Final Approval"
                  hint={`${awaitingLeadership.length} waiting`}
                  onOpen={() => setPage('leadership')}
                  delay={200}
                  grow
                >
                  {awaitingLeadership.length === 0 ? (
                    <NotMeasured>
                      Nothing is waiting on your sign-off. Posts arrive here once Marketing has approved them.
                    </NotMeasured>
                  ) : (
                    <ul className="flex flex-col gap-[7px]">
                      {awaitingLeadership.slice(0, 4).map((idea) => (
                        <li key={idea.id}>
                          <Row>
                            <Thumb src={idea.media?.dataUri ?? null} platform={idea.platform} className="h-[30px] w-10 shrink-0" />
                            <span className="min-w-0">
                              <span className="block truncate text-[11.5px] font-medium text-ink">{idea.title}</span>
                              <span className="mono mt-0.5 block truncate text-[8px] uppercase tracking-[0.1em] text-ink-3">
                                marketing approved · {timeAgo(idea.marketing_approved_at ?? idea.updated_at)}
                              </span>
                            </span>
                          </Row>
                        </li>
                      ))}
                    </ul>
                  )}
                </Panel>
              ) : (
                <Panel title="Suggestions" hint={`${drafts.length} draft${drafts.length === 1 ? '' : 's'}`} onOpen={() => setPage('calendar')} delay={200} grow>
                {topDrafts.length === 0 ? (
                  <NotMeasured>Nothing is written yet.</NotMeasured>
                ) : (
                  <ul className="flex flex-col gap-[7px]">
                    {topDrafts.map((idea) => (
                      <li key={idea.id}>
                        <Row>
                          <Thumb src={idea.media?.dataUri ?? null} platform={idea.platform} className="h-[30px] w-10 shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate text-[11.5px] font-medium text-ink">{idea.title}</span>
                            <span className="mono mt-0.5 block truncate text-[8px] uppercase tracking-[0.1em] text-ink-3">
                              {IDEA_STATUS_LABEL[idea.status] ?? idea.status} · conf {idea.confidence}
                            </span>
                          </span>
                        </Row>
                      </li>
                    ))}
                  </ul>
                )}
                </Panel>
              )}
            </div>

            {/* ── centre: the agent ────────────────────────────────── */}
            <div className="hub-lift relative flex min-h-0 min-w-0 flex-col items-center">
              <div className="relative min-h-[200px] w-full flex-1">
                <AgentHologram busy={busy} className="absolute inset-0" />
                {/* The core is the click target, without a badge painted over
                    it. Invisible by design; the focus ring is the only thing
                    it draws, for anyone reaching it by keyboard. */}
                <button
                  type="button"
                  onClick={() => openTheater()}
                  aria-label="What the system is doing. Opens the run theater."
                  title="What the system is doing"
                  className="absolute left-1/2 top-[42%] h-[140px] w-[140px] -translate-x-1/2 -translate-y-1/2 rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
                />
              </div>

              <div className="text-center">
                <p className="text-[19px] font-bold tracking-[0.2px] text-ink">AI Social Agent</p>
              </div>

              {/*
                The "Ask Ethara · ⌘K" chip was removed on request. The command
                plane itself is untouched: ⌘K still opens the bar from anywhere,
                the narration rail still opens with ⌥J, and the Calendar
                Assistant is unaffected. Only this launcher is gone.
              */}

              {/* One line, always reserved, so nothing below it jumps. */}
              <p className="mono mt-2 h-[15px] text-[9.5px] tracking-[0.05em] text-accent-bright">{statusLine}</p>

              <button
                type="button"
                onClick={() => setQueueOpen(true)}
                className={`glass-panel glass-lift mt-1.5 flex w-[86%] items-center gap-2.5 rounded-xl px-3.5 py-2.5 text-left ${total > 0 ? '!border-serious/50' : ''}`}
              >
                {total > 0 ? <Breathe /> : <span className="h-[7px] w-[7px] shrink-0 rounded-full bg-good" aria-hidden="true" />}
                <span className="min-w-0 flex-1">
                  <span className="block text-[11.5px] font-bold text-ink">
                    {total === 0 ? 'Nothing is waiting on you' : `${total} waiting on you`}
                  </span>
                  <span className="mono mt-0.5 block truncate text-[8.5px] text-ink-3">
                    {total === 0 ? 'verdicts and approvals land here' : waitingRows.slice(0, 2).map((row) => row.title).join(' · ')}
                  </span>
                </span>
                <span className="mono shrink-0 text-[10px] text-ink-3">↗</span>
              </button>
            </div>

            {/* ── right ────────────────────────────────────────────── */}
            <div
              /* Contained for the same reason as the left column. */
              className="hub-tilt-right flex min-w-0 flex-col justify-start gap-3.5 min-h-0 overflow-y-auto overscroll-auto"
            >
              <Panel title="Calendar" hint={`${placed} placed`} onOpen={() => setPage('calendar')} delay={160}>
                <div className="grid grid-cols-7 gap-1">
                  {week.map(({ iso, day, items }) => {
                    const isToday = iso === isoDate(today)
                    return (
                      <span
                        key={iso}
                        title={
                          items.length === 0
                            ? `${day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}: nothing placed`
                            : `${day.toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'short' })}: ${items.map((i) => PLATFORM_LABEL[i.platform]).join(', ')}`
                        }
                        className={`rounded-[9px] border px-0 py-1.5 text-center transition-colors ${isToday ? 'border-accent bg-accent/15' : 'border-line bg-surface-2/50'}`}
                        style={isToday ? { boxShadow: '0 0 14px -4px var(--color-accent)' } : undefined}
                      >
                        <span className="mono block text-[7.5px] uppercase text-ink-3">{day.toLocaleDateString('en-GB', { weekday: 'short' })}</span>
                        <span className="mt-0.5 block text-[12px] font-bold text-ink">{day.getDate()}</span>
                        {/* The row of dates carries the posts themselves: one
                            dot per placed post, in its platform's colour. A
                            single anonymous dot said only "something", which is
                            the one thing the day number already implied. */}
                        <span className="mx-auto mt-[3px] flex h-[3px] items-center justify-center gap-[2px]" aria-hidden="true">
                          {items.slice(0, 4).map((idea) => (
                            <span
                              key={idea.id}
                              className="h-[3px] w-[3px] rounded-full"
                              style={{ background: PLATFORM_TOKEN[idea.platform] }}
                            />
                          ))}
                        </span>
                      </span>
                    )
                  })}
                </div>
                {!weekList.ahead && weekList.total > 0 ? (
                  <p className="mono mt-2 text-[8px] uppercase tracking-[0.1em] text-ink-3">
                    nothing left this week · what it held
                  </p>
                ) : null}
                <ul className="mt-2.5 flex flex-col gap-[7px]">
                  {weekList.total === 0 ? (
                    <li><NotMeasured>Nothing placed in this week.</NotMeasured></li>
                  ) : (
                    weekList.rows.map((idea) => (
                      <li key={idea.id}>
                        <Row>
                          <span className="mono w-12 shrink-0 text-[9px] text-accent-bright">{idea.scheduled_time}</span>
                          <Thumb src={idea.media?.dataUri ?? null} platform={idea.platform} className="h-7 w-[38px] shrink-0" />
                          <span className="min-w-0">
                            <span className="block truncate text-[11px] font-medium text-ink">{idea.title}</span>
                            <span className="mono mt-0.5 block text-[8px] uppercase tracking-[0.1em] text-ink-3">{IDEA_STATUS_LABEL[idea.status] ?? idea.status}</span>
                          </span>
                        </Row>
                      </li>
                    ))
                  )}
                </ul>
              </Panel>

              <Panel title="Publish" hint={`${published.length} out`} onOpen={() => setPage('published')} delay={240} grow>
                <div className="grid grid-cols-4 gap-[7px]">
                  {platformRows.map((row) => (
                    <div
                      key={row.platform}
                      className="flex flex-col items-center gap-1 rounded-[11px] border border-line bg-surface-2/50 px-0.5 pb-[7px] pt-2"
                      title={`${PLATFORM_LABEL[row.platform]}: ${row.scheduled} scheduled · ${row.published} published`}
                    >
                      <span
                        className="flex h-6 w-6 items-center justify-center rounded-[7px]"
                        style={{ background: `color-mix(in srgb, ${PLATFORM_TOKEN[row.platform]} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${PLATFORM_TOKEN[row.platform]} 34%, transparent)` }}
                      >
                        <PlatformIcon platform={row.platform} size={12} />
                      </span>
                      <span className="text-[14px] font-bold text-ink">{row.scheduled}</span>
                      <span className="mono -mt-0.5 text-[7.5px] uppercase text-ink-3">{row.published} out</span>
                    </div>
                  ))}
                </div>

                <div className="mt-3 border-t border-line pt-2.5">
                  {monthLabel ? (
                    <p className="mono mb-1.5 text-[7.5px] uppercase tracking-[0.1em] text-ink-3">{monthLabel}</p>
                  ) : null}
                  <div className="grid grid-cols-[1.2fr_1fr_1fr] gap-2">
                    <Figure label="Total reach" value={reach === null ? null : fmt(reach)} />
                    <Figure label="Engagement" value={engagementRate === null ? null : `${engagementRate.toFixed(1)}%`} />
                    <Figure label="Followers" value={followers === null ? null : fmt(followers)} />
                  </div>
                  {daily.length > 1 ? <Spark values={daily} /> : null}
                </div>

                {topContent.length > 0 ? (
                  <ul className="mt-2.5 grid grid-cols-3 gap-1.5">
                    {topContent.map((post) => (
                      <li key={post.id} className="min-w-0">
                        <Thumb src={post.data_uri} platform={post.platform} />
                        <p className="mono mt-1 truncate text-[8px] uppercase tracking-[0.06em] text-ink-3">
                          {fmt((post.likes ?? 0) + (post.comments ?? 0) + (post.shares ?? 0))} · {PLATFORM_LABEL[post.platform]}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : null}

                <div className="mt-2.5 flex items-center gap-3.5">
                  <Donut
                    parts={breakdown.parts.map((part, i) => ({ value: part.value, tone: ['var(--color-accent)', 'var(--color-accent-bright)', 'var(--color-hud-strong)'][i] ?? 'var(--color-accent)' }))}
                    total={breakdown.total}
                    reported={breakdown.reported}
                  />
                  <ul className="flex min-w-0 flex-1 flex-col gap-[5px]">
                    {breakdown.parts.map((part, i) => (
                      <li key={part.key} className="flex items-center gap-[7px]">
                        <span className="h-1.5 w-1.5 rounded-full" style={{ background: ['var(--color-accent)', 'var(--color-accent-bright)', 'var(--color-hud-strong)'][i] }} aria-hidden="true" />
                        <span className="flex-1 text-[10.5px] capitalize text-ink-2">{part.key}</span>
                        <span className="mono text-[10.5px] text-ink-3">
                          {part.reported ? `${breakdown.total === 0 ? 0 : Math.round((part.value / breakdown.total) * 100)}%` : '—'}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>

                {/* What the platform has not measured, said rather than zeroed. */}
                {reportedRows.length === 0 || !breakdown.reported ? (
                  <p className="mono mt-2.5 text-[7.5px] uppercase tracking-[0.06em] text-ink-3">
                    {readFromPosts
                      ? `from ${fromPosts.posts} reported post${fromPosts.posts === 1 ? '' : 's'} · no monthly rollup`
                      : reportedRows.length === 0
                        ? 'no monthly rollup reported'
                        : ''}
                    {reportedRows.length === 0 && !breakdown.reported ? ' · ' : ''}
                    {!breakdown.reported ? 'no reactions reported' : ''}
                  </p>
                ) : null}
              </Panel>
            </div>
          </div>

          {/* ── the foot: every other screen ───────────────────────── */}
          {/*
            SEPARATED FROM THE PANELS ABOVE BY SPACE, NOT BY DEPTH.

            The side panels once sat at `rotateY(±8deg) translateZ(-14px)` in a
            perspective stage, and a rotated plane's near corner projects outward,
            so their bottom edges swung down across this bar.

            Lifting this bar forward on the Z axis "fixed" that by inverting it —
            pulled toward the viewer, its own edge then covered the panels above.
            Depth is the wrong tool for two things that should simply not
            intersect. So the bar stays in the plane, where it is already in front
            of panels pushed to -14px and after them in document order, and real
            vertical margin keeps the projection clear of it.
          */}
          <div
            className="hub-foot relative z-10 mt-5 flex flex-col gap-4 xl:flex-row"
          >
            <div className="glass-panel flex-1 rounded-[14px] px-3.5 py-3">
              <div className="flex items-center justify-between">
                <span className="text-[11.5px] font-bold text-ink">Everything else</span>
                <span className="mono text-[8px] uppercase tracking-[0.08em] text-ink-3">{controls.length} screens</span>
              </div>
              {/*
                CENTRED WHEN THE ROW IS NOT FULL.

                Marketing holds six of these, which fill `sm:grid-cols-6`
                exactly. Leadership holds three, and in a six-track grid those
                sat in the first three columns with the right half of the panel
                empty — it read as a layout bug rather than as a shorter list.

                So a short list gets its own track count at the matching
                fraction of the width: three tracks across half the panel keeps
                each tile the same size it would have been at six, and `mx-auto`
                centres the group. The six-item case is untouched.
              */}
              {/*
                ONE ROW ON DESKTOP, WHATEVER THE COUNT — THREE ON MOBILE.

                A hardcoded `sm:grid-cols-3` was right for Leadership's three
                tiles and wrong the moment Marketing dropped to five: five items
                in three columns wrap to 3 + 2, which is what produced the two
                stacked rows.

                The track count has to follow the item count. An inline
                `gridTemplateColumns` would do it, but inline styles beat classes
                at EVERY breakpoint, so it would also force five cramped columns
                on a phone. Tailwind cannot take a dynamic class name either —
                the compiler would never see it. So the count maps to complete,
                statically written class strings, which the compiler can see and
                which keep `grid-cols-3` for mobile intact.

                The width cap is the same fraction, so each tile stays exactly the
                size it would have had in a full six-column row and `mx-auto`
                centres a short row rather than leaving a gap on the right.
              */}
              <div className={`mt-2 grid grid-cols-3 gap-1.5 sm:mx-auto ${TILE_GRID[Math.min(controls.length, 6)] ?? 'sm:grid-cols-6'}`}>
                {controls.map((item) => (
                  <button
                    key={item.page}
                    type="button"
                    onClick={() => setPage(item.page as PageId)}
                    className="relative flex flex-col items-center gap-1 rounded-lg border border-line bg-surface-2/50 px-1 py-2 transition-[border-color,box-shadow] hover:border-accent hover:shadow-[0_0_14px_-6px_var(--color-accent)]"
                  >
                    <item.icon size={13} className="text-accent-bright" aria-hidden="true" />
                    <span className="text-center text-[9.5px] leading-[1.25] text-ink-2">{item.label}</span>
                    {item.badge === 'leadership' && awaitingLeadership.length > 0 ? (
                      <span className="mono absolute right-1 top-1 rounded-full bg-critical px-1 text-[7.5px] text-on-accent">{awaitingLeadership.length}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      </section>


      {/* The full queue, where the decisions are actually made. */}
      <Dialog
        open={queueOpen}
        size="fit"
        onClose={() => setQueueOpen(false)}
        header={
          <div className="flex min-w-0 items-center gap-2.5">
            {total > 0 ? <Breathe /> : null}
            <h2 className="text-[15px] font-semibold tracking-[-0.02em] text-ink">Waiting on you</h2>
            <span className="mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3">
              {total === 0 ? 'nothing needs a person' : `${total} item${total === 1 ? '' : 's'}${oldestWait ? ` · oldest ${timeAgo(oldestWait)}` : ''}`}
            </span>
          </div>
        }
      >
        <div className="p-4">
          <DecisionQueue awaiting={awaitingLeadership} verdicts={openVerdicts} />
        </div>
      </Dialog>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE HEART — the emblem, and the four ways work leaves it
   ═══════════════════════════════════════════════════════════════════════════ */


/** One glass panel in the command centre. The whole surface is the door. */
function Panel({
  title,
  hint,
  onOpen,
  delay,
  grow = false,
  children,
}: {
  title: string
  hint: string
  onOpen: () => void
  delay: number
  /** The last panel in a column absorbs the leftover height, so the column
      reaches the foot row instead of stopping short. `grow` keeps the
      content's own height as the floor, so nothing is clipped to fit. */
  grow?: boolean
  children: ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      /*
       * Natural height, not a forced share of the column. Stretching every
       * panel to an equal height clipped whichever had the most to say —
       * Publish lost its reaction split off the bottom edge.
       */
      className={`group glass-panel glass-lift flex min-w-0 flex-col rounded-[18px] px-4 py-3.5 text-left${grow ? ' grow' : ''}`}
      style={{ animation: `eth-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) ${delay}ms both` }}
    >
      <span className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-[12.5px] font-bold text-ink">{title}</span>
        <span className="mono shrink-0 whitespace-nowrap text-[8.5px] uppercase tracking-[0.08em] text-ink-3 transition-colors group-hover:text-accent-bright">
          {hint} ↗
        </span>
      </span>
      <span className="mt-[11px] block">{children}</span>
    </button>
  )
}

/** A row inside a panel: the design's soft inset with a hover wash. */
function Row({ children }: { children: ReactNode }) {
  return (
    <span className="flex items-center gap-2.5 rounded-xl border border-line bg-surface-2/40 px-2.5 py-2 transition-colors group-hover:border-line-strong">
      {children}
    </span>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   STATION DETAIL — what a station holds, before you go to its screen
   ═══════════════════════════════════════════════════════════════════════════ */


const IDEA_STATUS_LABEL: Record<string, string> = {
  drafted: 'Drafted',
  in_review: 'In review',
  pending_leadership: 'With Leadership',
  scheduled: 'Scheduled',
  published: 'Published',
  suggested: 'Suggested',
  rejected: 'Rejected',
}


/* ═══════════════════════════════════════════════════════════════════════════
   CARDS
   ═══════════════════════════════════════════════════════════════════════════ */


function NotMeasured({ children }: { children: ReactNode }) {
  return <span className="block text-[11.5px] leading-relaxed text-ink-3">{children}</span>
}

function Figure({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="block min-w-0">
      <span className="mono block text-[16px] leading-none text-ink">{value ?? '—'}</span>
      <span className="mono mt-1 block truncate text-[8.5px] uppercase tracking-[0.1em] text-ink-3">{label}</span>
    </span>
  )
}

/** Shares of a whole, drawn as arcs. Renders nothing meaningful when the whole is zero. */
/** A creative thumbnail, or the platform's mark where there is none yet. */
function Thumb({ src, platform, className = 'aspect-[4/3] w-full' }: { src: string | null; platform: Platform; className?: string }) {
  return (
    <span className={`block overflow-hidden rounded-md border border-line bg-surface-2 ${className}`}>
      {src ? (
        <img src={src} alt="" className="h-full w-full object-cover" />
      ) : (
        <span className="flex h-full w-full items-center justify-center"><PlatformIcon platform={platform} size={13} /></span>
      )}
    </span>
  )
}

function Donut({ parts, total, reported = true }: { parts: Array<{ value: number; tone: string }>; total: number; reported?: boolean }) {
  const r = 26
  const c = 2 * Math.PI * r
  let offset = 0
  return (
    <svg width={72} height={72} viewBox="0 0 72 72" aria-hidden="true" className="shrink-0">
      <circle cx={36} cy={36} r={r} fill="none" stroke="var(--color-surface-3)" strokeWidth={8} />
      {total > 0
        ? parts.map((p, i) => {
            const len = (p.value / total) * c
            const el = (
              <circle
                key={i}
                cx={36}
                cy={36}
                r={r}
                fill="none"
                stroke={p.tone}
                strokeWidth={8}
                strokeLinecap="round"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 36 36)"
                style={{ filter: 'drop-shadow(0 0 5px color-mix(in srgb, var(--color-accent) 55%, transparent))', animation: `eth-num-in 420ms cubic-bezier(0.22, 1, 0.36, 1) ${160 + i * 110}ms both` }}
              />
            )
            offset += len
            return el
          })
        : null}
      <text x={36} y={40} textAnchor="middle" fontSize={11} fill="var(--color-ink)" className="mono">{reported ? fmt(total) : '—'}</text>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   WAITING ON YOU — kept as it was
   ═══════════════════════════════════════════════════════════════════════════ */

function DecisionQueue({
  awaiting,
  verdicts,
}: {
  awaiting: Idea[]
  verdicts: ReviewQueueItem[]
}) {
  const user = useStore((s) => s.user)
  const pendingConfirm = useStore((s) => s.assistant.pendingConfirm)
  const openReview = useStore((s) => s.openReview)
  const leadershipPublish = useStore((s) => s.leadershipPublish)
  const resolveQueueItem = useStore((s) => s.resolveQueueItem)
  const confirmPlan = useStore((s) => s.confirmPlan)
  const setPage = useStore((s) => s.setPage)

  const [committed, setCommitted] = useState<string | null>(null)
  const [evidenceFor, setEvidenceFor] = useState<string | null>(null)
  /** Fires the commit draw, then the action. The card leaves when state refetches. */
  const commit = (key: string, action: () => Promise<void>): void => {
    setCommitted(key)
    void action()
  }

  const total = awaiting.length + verdicts.length + (pendingConfirm ? 1 : 0)
  // Everything, because this IS the queue. The dashboard card summarises it.
  const shown = total
  let index = 0
  const cards: ReactNode[] = []

  if (pendingConfirm) {
    cards.push(
      <Decision key="confirm" index={index++} eyebrow="Confirmation" meta={`expires ${new Date(pendingConfirm.expiresAt).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' })}`} tone="accent">
        <p className="mt-[7px] text-[12.5px] font-medium leading-snug text-ink">{pendingConfirm.prompt}</p>
        <Reason tone="accent">
          {pendingConfirm.plan.steps.length} step{pendingConfirm.plan.steps.length === 1 ? '' : 's'} · irreversible, so it waits for you
        </Reason>
        {committed === 'confirm' ? (
          <Commit label="Confirmed" />
        ) : (
          <div className="mt-2.5 flex gap-1.5">
            <Btn variant="primary" onClick={() => commit('confirm', () => confirmPlan(pendingConfirm.token, 'confirm'))}>Confirm</Btn>
            <Btn variant="ghost" onClick={() => void confirmPlan(pendingConfirm.token, 'cancel')}>Cancel</Btn>
          </div>
        )}
      </Decision>,
    )
  }
  for (const idea of awaiting.slice(0, shown - cards.length)) {
    cards.push(
      <Decision
        key={idea.id}
        index={index++}
        eyebrow="Leadership gate"
        tone="serious"
        meta={
          <span className="inline-flex items-center gap-1.5">
            <PlatformIcon platform={idea.platform} size={12} />
            {shortDay(idea.scheduled_date)} {idea.scheduled_time}
          </span>
        }
      >
        <p className="mt-[7px] text-[12.5px] font-medium leading-snug text-ink">{idea.title}</p>
        <div className="mt-2 flex items-center gap-[9px]">
          <span className="mono text-[11px] text-ink-3">CONF</span>
          <span className="relative h-[3px] flex-1 rounded-[2px] bg-surface-3">
            <span className="absolute inset-y-0 left-0 rounded-[2px] bg-accent-bright" style={{ width: `${idea.confidence}%`, transformOrigin: 'left', animation: 'eth-fill 560ms cubic-bezier(0.16, 1, 0.3, 1) both' }} />
          </span>
          <span className="mono text-[10.5px] text-ink">{idea.confidence}</span>
        </div>
        <Reason tone="accent">
          {idea.marketing_approved_at ? `Marketing approved ${timeAgo(idea.marketing_approved_at)}` : 'Awaiting Marketing'}
          {idea.marketing_approved_by ? ` · ${idea.marketing_approved_by}` : ''}
        </Reason>
        {evidenceFor === idea.id ? (
          <div
            className="mt-2 rounded-md border border-line bg-surface px-2.5 py-2 text-[11px] leading-relaxed text-ink-2"
            style={{ animation: 'eth-row-stream 200ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
          >
            {idea.description ? <p>{idea.description}</p> : null}
            <p className="mono mt-1 text-[11px] text-ink-3">
              {idea.source_topic ? `topic ${idea.source_topic} · ` : ''}conf {idea.confidence}
              {idea.alt_platforms.length > 0 ? ` · also fits ${idea.alt_platforms.map((a) => PLATFORM_LABEL[a.platform]).join(', ')}` : ''}
              {idea.platform_rank !== null ? ` · rank ${idea.platform_rank}` : ''}
            </p>
          </div>
        ) : null}
        {committed === idea.id ? (
          <Commit label="Approved · publishing" />
        ) : (
          <div className="mt-2.5 flex items-center gap-1.5">
            {user?.role === 'leadership' ? (
              <Btn variant="primary" onClick={() => commit(idea.id, () => leadershipPublish(idea.id))}>Approve &amp; publish</Btn>
            ) : (
              <Btn variant="subtle" onClick={() => openReview(idea.id)}>Open</Btn>
            )}
            {/* A rejection needs a reason, and the review panel is where it is written. */}
            <Btn variant="ghost" onClick={() => openReview(idea.id)}>{user?.role === 'leadership' ? 'Reject' : 'Review'}</Btn>
            <button
              type="button"
              onClick={() => setEvidenceFor(evidenceFor === idea.id ? null : idea.id)}
              aria-expanded={evidenceFor === idea.id}
              className="mono ml-auto text-[10px] text-ink-3 transition-colors hover:text-accent-bright"
            >
              EVIDENCE {evidenceFor === idea.id ? '▴' : '▾'}
            </button>
          </div>
        )}
      </Decision>,
    )
  }
  for (const q of verdicts.slice(0, Math.max(0, shown - cards.length))) {
    cards.push(
      <Decision key={q.id} index={index++} eyebrow={q.kind.replace(/[_.]/g, ' ')} tone="serious" meta={`${timeAgo(q.created_at)}`}>
        <p className="mt-[7px] text-[12.5px] font-medium leading-snug text-ink">{q.entity_title ?? q.decision_requested}</p>
        <Reason tone="serious">{q.reason}</Reason>
        {committed === q.id ? (
          <Commit label="Recorded" />
        ) : (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          {q.options.slice(0, 3).map((opt, i) => (
            <Btn key={opt} variant={i === 0 ? 'subtle' : 'ghost'} onClick={() => commit(q.id, () => resolveQueueItem(q.id, opt))}>
              {opt.replace(/[_.]/g, ' ')}
            </Btn>
          ))}
          {q.entity_id ? (
            <button type="button" onClick={() => setPage('intelligence')} className="mono ml-auto inline-flex items-center gap-1 text-[10px] text-ink-3 transition-colors hover:text-accent-bright">
              SOURCE <ExternalLink size={10} aria-hidden="true" />
            </button>
          ) : null}
        </div>
        )}
      </Decision>,
    )
  }

  return (
    <div className="mx-auto flex w-full max-w-[880px] flex-col gap-2">
        {cards.length === 0 ? (
          <div className="py-6">
            <EmptyState title="Nothing is waiting on you" body="Verdicts, approvals and confirmations land here the moment one needs a person. Everything else the agents decide themselves, and say why." />
          </div>
        ) : (
          cards
        )}
        {total > cards.length ? (
          <button
            type="button"
            onClick={() => setPage(user?.role === 'leadership' ? 'leadership' : 'intelligence')}
            className="mono inline-flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-line-strong px-3 py-[9px] text-[10.5px] text-ink-3 transition-colors duration-[var(--dur-fast)] hover:border-accent/60 hover:text-ink"
          >
            {total - cards.length} MORE · OPEN THE QUEUE <ArrowUpRight size={11} aria-hidden="true" />
          </button>
        ) : null}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SYSTEM PILL

   The run's state, beside the control that starts it. This was a full-width
   card in the foot of the page, which meant the one thing you watch during a
   run sat furthest from the button that begins it. Collapsed it is an animated
   dot; open it names every agent and what it is doing.
   ═══════════════════════════════════════════════════════════════════════════ */

function SystemPill({
  agents,
  busy,
  statusLine,
  open,
  onToggle,
  onOpenTheater,
  leadership,
}: {
  agents: AgentState[]
  busy: boolean
  statusLine: string
  open: boolean
  onToggle: () => void
  onOpenTheater: () => void
  leadership: boolean
}) {
  const working = agents.filter((a) => a.status === 'waiting').length

  return (
    <div className="relative">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={open}
        aria-label={`System status: ${statusLine}. ${open ? 'Hide' : 'Show'} the agents.`}
        title={statusLine}
        className={`flex items-center gap-2 rounded-md border px-2.5 py-[6px] text-[12px] transition-colors ${
          open ? 'border-accent text-ink' : 'border-line-strong text-ink-2 hover:border-accent'
        }`}
      >
        {/* The only looping motion here means work is in flight. */}
        <span className="relative flex h-[14px] w-[14px] shrink-0 items-center justify-center" aria-hidden="true">
          {busy ? (
            <span className="anim-ping-slow absolute inset-0 rounded-full border border-accent" />
          ) : null}
          <span
            className={`h-[7px] w-[7px] rounded-full ${busy ? 'bg-accent anim-pulse-dot' : 'bg-good'}`}
            style={{ boxShadow: `0 0 10px ${busy ? 'var(--color-accent)' : 'var(--color-good)'}` }}
          />
        </span>
        <span className="mono text-[10px] uppercase tracking-[0.08em]">
          {busy ? `${working || 1} running` : `${operationalAgents(agents).length} idle`}
        </span>
      </button>

      {open ? (
        <div
          className="glass-panel absolute right-0 top-[calc(100%+6px)] z-40 w-[320px] rounded-[14px] p-3 text-left"
          style={{ animation: 'eth-rise 220ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
        >
          <p className="text-[11.5px] font-bold text-ink">System status</p>
          <p className="mt-0.5 text-[10px] text-ink-3">{statusLine}</p>

          <div className="mt-2.5 grid grid-cols-2 gap-1.5">
            {agents.map((agent) => {
              const tone =
                agent.status === 'waiting' ? 'bg-accent anim-pulse-dot'
                  : agent.status === 'failed' ? 'bg-critical'
                    : agent.status === 'needs_review' ? 'bg-serious'
                      : agent.status === 'completed' ? 'bg-good'
                        : 'bg-line-strong'
              return (
                <span
                  key={agent.agent_id}
                  title={`${agentShort(agent.agent_id)} · ${agent.status}${agent.current_task ? ` · ${agent.current_task}` : ''}`}
                  className="flex min-w-0 items-center gap-1.5 rounded-lg border border-line bg-surface-2/50 px-2 py-1.5"
                >
                  <span className={`h-[5px] w-[5px] shrink-0 rounded-full ${tone}`} aria-hidden="true" />
                  <span className="mono truncate text-[8.5px] uppercase tracking-[0.06em] text-ink-3">
                    {agentShort(agent.agent_id)}
                  </span>
                </span>
              )
            })}
          </div>

          <button
            type="button"
            onClick={onOpenTheater}
            className="mono mt-2.5 w-full rounded-lg border border-line-strong px-2 py-1.5 text-[9px] uppercase tracking-[0.1em] text-ink-2 transition-colors hover:border-accent hover:text-ink"
          >
            {leadership ? 'Open orchestration ↗' : 'Open the run theater ↗'}
          </button>
        </div>
      ) : null}
    </div>
  )
}

function Decision({
  index,
  eyebrow,
  meta,
  tone,
  children,
}: {
  index: number
  eyebrow: string
  meta: ReactNode
  tone: 'serious' | 'accent'
  children: ReactNode
}) {
  return (
    <article
      className={`rounded-[10px] border bg-surface-2 px-3 py-2.5 ${tone === 'serious' && index === 0 ? 'border-serious/50' : 'border-line'}`}
      style={{ animation: `eth-row-stream 200ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 60}ms both` }}
    >
      <div className="flex items-center gap-[7px]">
        <span className={`mono text-[9.5px] uppercase tracking-[0.12em] ${tone === 'serious' ? 'text-serious' : 'text-accent-bright'}`}>{eyebrow}</span>
        <span className="mono ml-auto text-[10px] text-ink-3">{meta}</span>
      </div>
      {children}
    </article>
  )
}

/** A decision landed: the only celebratory motion in the product, and it fires once. */

/** A decision landed: the only celebratory motion in the product, and it fires once. */
function Commit({ label }: { label: string }) {
  return (
    <p className="mono mt-2.5 inline-flex items-center gap-1.5 text-[10.5px] text-good-ink" aria-live="polite">
      <svg width={14} height={14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M20 6 9 17l-5-5" strokeDasharray={26} style={{ animation: 'eth-commit-check 320ms cubic-bezier(0.22, 1, 0.36, 1) both' }} />
      </svg>
      {label}
    </p>
  )
}

function Reason({ tone, children }: { tone: 'serious' | 'accent'; children: ReactNode }) {
  return (
    <div className={`mt-2 border-l pl-[9px] ${tone === 'serious' ? 'border-serious/60' : 'border-hud-strong'}`}>
      <p className="text-[11.5px] leading-relaxed text-ink-2">{children}</p>
    </div>
  )
}

/** A human is required: 4s, amber, half-contrast travel. Never red, never fast. */
function Breathe({ small = false }: { small?: boolean }) {
  const size = small ? 8 : 13
  const dot = small ? 4 : 5
  return (
    <span className="relative inline-flex items-center justify-center" style={{ width: size, height: size }} aria-hidden="true">
      <span className="absolute inset-0 rounded-full bg-serious opacity-40" style={{ animation: 'eth-attention-breathe 4s ease-in-out infinite' }} />
      <span className="relative rounded-full bg-serious" style={{ width: dot, height: dot }} />
    </span>
  )
}

/** An agent is working: 1.6s linear on the node, stops when the skill returns. */

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${24 - (v / max) * 20}`)
  const last = pts[pts.length - 1]?.split(',') ?? ['120', '6']
  const line = `M${pts.join(' L')}`
  const uid = `spark-${values.length}-${Math.round(max)}`
  return (
    <svg viewBox="0 0 120 26" preserveAspectRatio="none" className="mt-1.5 block h-[26px] w-full overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={`${uid}-fill`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.45" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
        <linearGradient id={`${uid}-line`} x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stopColor="var(--color-accent)" />
          <stop offset="100%" stopColor="var(--color-accent-bright)" />
        </linearGradient>
      </defs>
      {/* the area, rising in behind the line */}
      <path
        d={`${line} L120,26 L0,26 Z`}
        fill={`url(#${uid}-fill)`}
        style={{ transformOrigin: 'bottom', animation: 'eth-area-in 720ms cubic-bezier(0.22, 1, 0.36, 1) 160ms both' }}
      />
      <path
        d={line}
        fill="none"
        stroke={`url(#${uid}-line)`}
        strokeWidth={1.4}
        strokeLinejoin="round"
        strokeLinecap="round"
        pathLength={300}
        style={{ strokeDasharray: 300, ['--len' as string]: '300', animation: 'eth-draw-line 900ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
      />
      {/* the latest reading, lit */}
      <circle cx={last[0]} cy={last[1]} r={2.6} fill="var(--color-accent-bright)" style={{ filter: 'drop-shadow(0 0 4px var(--color-accent-bright))', animation: 'eth-num-in 320ms cubic-bezier(0.22, 1, 0.36, 1) 820ms both' }} />
    </svg>
  )
}

/** An agent is working: 1.6s linear on the node, stops when the skill returns. */
function WorkArc() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" style={{ animation: 'eth-work-arc 1.6s linear infinite' }}>
      <circle cx={6} cy={6} r={4.5} fill="none" stroke="var(--color-accent-bright)" strokeWidth={1.4} strokeLinecap="round" strokeDasharray="12 30" />
    </svg>
  )
}

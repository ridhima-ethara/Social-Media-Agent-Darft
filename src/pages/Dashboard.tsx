/**
 * DASHBOARD
 *
 * The operator's first screen, built around what the system is doing. The
 * pipeline is the hero: the five stages that move work stand in depth with
 * live counts, and the decision queue sits beside them so a verdict needs no
 * navigation. Under that, the month against this account's own trailing
 * baseline, and the lessons that changed what the agents do.
 *
 * Every figure is measured or it is absent. A tile with nothing to show says
 * why, and never shows a zero that reads as a result.
 */

import { useMemo, useState, type CSSProperties, type ReactNode } from 'react'
import { ArrowUpRight, ExternalLink, Play } from 'lucide-react'
import { AGENT_BY_ID, STAGES } from '@shared/agent-registry'
import { useStore } from '../store'
import { DownloadMenu } from '../components/download-menu'
import { Btn, CountUp, EmptyState, PLATFORM_LABEL, PLATFORM_TOKEN, PlatformIcon, fmt, timeAgo } from '../components/ui'
import { exportCombined, exportPerPost } from '../lib/export'
import type { AgentId, AgentRunStatus, Idea, Platform, PlatformAnalytics, ReviewQueueItem } from '../types'

/**
 * The brand definition is configuration, not something learned. Excluded by
 * name so any category the Learning Agent produces counts as a lesson.
 */
const BRAND_DEFINITION_CATEGORIES = ['Brand Corpus', 'Brand Voice', 'Brand Guideline', 'Visual Identity', 'Compliance Rule']

/** The stages that move work, in registry order. Measure and learn close the loop overhead. */
const WORK_STAGE_IDS = ['discover', 'assess', 'plan', 'create', 'ship'] as const
const LOOP_STAGE_IDS = ['learn'] as const

const DAY_MS = 86_400_000

function agentShort(id: AgentId): string {
  return AGENT_BY_ID[id]?.name.replace(' Agent', '') ?? id
}

type StageStatus = 'idle' | 'running' | 'done' | 'gated' | 'failed'

/** A stage is what its agents are doing, taken together. */
function stageStatus(statuses: AgentRunStatus[]): StageStatus {
  if (statuses.some((s) => s === 'failed')) return 'failed'
  if (statuses.some((s) => s === 'running')) return 'running'
  if (statuses.some((s) => s === 'needs_review' || s === 'waiting')) return 'gated'
  if (statuses.length > 0 && statuses.every((s) => s === 'completed')) return 'done'
  return 'idle'
}

const STAGE_STROKE: Record<StageStatus, string> = {
  idle: 'var(--color-line-strong)',
  running: 'var(--color-accent)',
  done: 'var(--color-good)',
  gated: 'var(--color-serious)',
  failed: 'var(--color-critical)',
}

function quantile(sorted: number[], q: number): number {
  if (sorted.length === 0) return 0
  const pos = (sorted.length - 1) * q
  const lo = Math.floor(pos)
  const hi = Math.ceil(pos)
  const a = sorted[lo] ?? 0
  const b = sorted[hi] ?? a
  return a + (b - a) * (pos - lo)
}

function shortDay(iso: string): string {
  return new Date(iso).toLocaleDateString('en-GB', { weekday: 'short' })
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
  const apiMode = useStore((s) => s.apiMode)
  const openTheater = useStore((s) => s.openTheater)
  const runScraping = useStore((s) => s.runScraping)
  const openKnowledge = useStore((s) => s.openKnowledge)

  const months = useMemo(() => [...new Set(analytics.map((a) => a.month))].sort().reverse(), [analytics])
  // The chosen month, not the stored one: analytics arrives after mount.
  const [picked, setPicked] = useState<string | null>(null)
  const month = picked !== null && months.includes(picked) ? picked : (months[0] ?? '')
  const previousMonth = months[months.indexOf(month) + 1]
  const [platformTab, setPlatformTab] = useState<Platform>('linkedin')

  const rowFor = (m: string | undefined, p: Platform): PlatformAnalytics | undefined =>
    m === undefined ? undefined : analytics.find((a) => a.month === m && a.platform === p)
  const linkedin = rowFor(month, 'linkedin')
  const instagram = rowFor(month, 'instagram')
  const prevLinkedin = rowFor(previousMonth, 'linkedin')
  const reported = analytics.some((a) => a.month === month && a.is_reported)
  const labelOf = (m: string | undefined): string => (m ? (analytics.find((a) => a.month === m)?.label ?? m) : '')

  /* ── Waiting on people ────────────────────────────────────────────── */
  const awaitingLeadership = ideas.filter((i) => i.status === 'pending_leadership')
  const openVerdicts = reviewQueue.filter((q) => !q.resolved)
  const waitingCount = awaitingLeadership.length + openVerdicts.length + (pendingConfirm ? 1 : 0)
  const oldestWaiting = [...awaitingLeadership.map((i) => i.marketing_approved_at ?? i.updated_at), ...openVerdicts.map((q) => q.created_at)]
    .filter((d): d is string => typeof d === 'string')
    .sort()[0]

  /* ── The published tile ───────────────────────────────────────────── */
  const drafted = ideas.filter((i) => i.status !== 'suggested').length
  const held = ideas.filter((i) => i.status === 'in_review' || i.status === 'pending_leadership' || i.status === 'approved').length
  const rejected = ideas.filter((i) => i.status === 'rejected').length

  /* ── Scheduled · 14d ──────────────────────────────────────────────── */
  const now = Date.now()
  const upcoming = useMemo(
    () =>
      ideas
        .filter((i) => i.calendar_slot === 'primary' && i.status !== 'published' && i.status !== 'rejected')
        .filter((i) => {
          const t = new Date(i.scheduled_date).getTime()
          return t >= now - DAY_MS && t < now + 14 * DAY_MS
        })
        .sort((a, b) => `${a.scheduled_date}${a.scheduled_time}`.localeCompare(`${b.scheduled_date}${b.scheduled_time}`)),
    [ideas, now],
  )
  const weekdayShape = useMemo(() => {
    const counts = [0, 0, 0, 0, 0, 0, 0]
    for (const i of upcoming) counts[(new Date(i.scheduled_date).getDay() + 6) % 7] += 1
    const max = Math.max(1, ...counts)
    return counts.map((c) => c / max)
  }, [upcoming])
  const nextOut = upcoming.find((i) => new Date(i.scheduled_date).getTime() >= now - DAY_MS)
  const scheduledPlatforms = new Set(upcoming.map((i) => i.platform)).size

  /* ── Lessons ──────────────────────────────────────────────────────── */
  const learned = useMemo(
    () => knowledge.filter((e) => e.active && !BRAND_DEFINITION_CATEGORIES.includes(e.category)).slice(0, 4),
    [knowledge],
  )

  /* ── Pipeline ─────────────────────────────────────────────────────── */
  const stages = useMemo(() => {
    const statusOf = (id: AgentId): AgentRunStatus => agents.find((a) => a.agent_id === id)?.status ?? 'idle'
    return STAGES.filter((s) => s.id !== 'command').map((stage) => {
      const ids = Object.values(AGENT_BY_ID)
        .filter((a) => a.stage === stage.id && a.id !== 'assistant')
        .map((a) => a.id)
      return { id: stage.id, name: stage.name, agents: ids, status: stageStatus(ids.map(statusOf)) }
    })
  }, [agents])
  const workStages = WORK_STAGE_IDS.map((id) => stages.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => s !== undefined)
  const runningAgent = agents.find((a) => a.status === 'running')
  const anyRunning = runningAgent !== undefined || scrapeRun.running
  const runId = scrapeRun.runId ? scrapeRun.runId.slice(0, 4) : null

  const heldGates = awaitingLeadership.length + ideas.filter((i) => i.status === 'in_review').length
  const stageLine = (id: string): { text: string; tone: string } => {
    switch (id) {
      case 'discover': {
        const kept = scrapeRun.captures.filter((c) => c.held === null).length
        const empty = scrapeRun.lanes.filter((l) => l.status === 'warn').length
        if (scrapeRun.captures.length === 0 && scrapeRun.lanes.length === 0) return { text: 'nothing captured', tone: 'text-ink-3' }
        return { text: `${kept} kept${empty > 0 ? ` · ${empty} empty` : ''}`, tone: 'text-good-ink' }
      }
      case 'assess': {
        const scored = scrapeRun.verdicts.length
        const forYou = scrapeRun.verdicts.filter((v) => v.verdict === 'needs_review').length + openVerdicts.length
        if (scored === 0 && forYou === 0) return { text: 'nothing to score', tone: 'text-ink-3' }
        return { text: `${scored} scored${forYou > 0 ? ` · ${forYou} for you` : ''}`, tone: forYou > 0 ? 'text-serious' : 'text-good-ink' }
      }
      case 'plan': {
        const placed = ideas.filter((i) => i.calendar_slot === 'primary').length
        return placed === 0 ? { text: 'no slots taken', tone: 'text-ink-3' } : { text: `${placed} slots · ${ideas.length - placed} held`, tone: 'text-accent-bright' }
      }
      case 'create': {
        const written = ideas.filter((i) => i.status !== 'suggested').length
        return written === 0 ? { text: 'queued', tone: 'text-ink-3' } : { text: `${written} drafted`, tone: 'text-good-ink' }
      }
      case 'ship':
        return heldGates === 0 ? { text: published.length === 0 ? 'nothing published' : `${published.length} out`, tone: 'text-ink-3' } : { text: `${heldGates} gate${heldGates === 1 ? '' : 's'} held`, tone: 'text-serious' }
      default:
        return { text: '', tone: 'text-ink-3' }
    }
  }

  /* ── Lane feed: what the run reported last ────────────────────────── */
  const feed = useMemo(() => {
    const laneRows = scrapeRun.lanes.slice(-3).map((l) => ({
      id: `l-${l.id}`,
      agent: 'SHERLOCK',
      warn: l.status === 'warn',
      text:
        l.status === 'warn'
          ? `${l.platform} · ${l.keyword} · nothing captured${l.reason ? ` · ${l.reason}` : ''}`
          : l.status === 'running'
            ? `${l.platform} · ${l.keyword} · capturing`
            : `${l.platform} · ${l.keyword} · kept ${l.kept ?? 0}${l.captured === null ? '' : ` of ${l.captured}`}`,
    }))
    const noteRows = scrapeRun.notes.slice(-3).map((n) => ({
      id: `n-${n.id}`,
      agent: agentShort(n.agentId as AgentId).toUpperCase(),
      warn: n.status === 'warn',
      text: n.message,
    }))
    return [...noteRows, ...laneRows].slice(-3).reverse()
  }, [scrapeRun.lanes, scrapeRun.notes])

  /* ── Baseline chart ───────────────────────────────────────────────── */
  const chartRow = rowFor(month, platformTab)
  const prevRow = rowFor(previousMonth, platformTab)
  const chart = useMemo(() => {
    if (!chartRow || chartRow.daily.length === 0) return null
    const values = chartRow.daily.map((d) => d.value)
    const prevValues = prevRow?.daily.map((d) => d.value) ?? []
    // The band is where last month sat most of the time: its inner two quartiles.
    const sortedPrev = [...prevValues].sort((a, b) => a - b)
    const band = prevValues.length > 0 ? { lo: quantile(sortedPrev, 0.25), hi: quantile(sortedPrev, 0.75) } : null
    const max = Math.max(...values, band?.hi ?? 0, 1)
    const peakIndex = values.indexOf(Math.max(...values))
    const daysAbove = band ? values.filter((v) => v > band.hi).length : null
    const prevDaysAbove =
      band && prevValues.length > 0 ? prevValues.filter((v) => v > band.hi).length : null
    const avg = values.reduce((s, v) => s + v, 0) / values.length
    const prevAvg = prevValues.length > 0 ? prevValues.reduce((s, v) => s + v, 0) / prevValues.length : null
    return { values, band, max, peakIndex, daysAbove, prevDaysAbove, avg, prevAvg, dates: chartRow.daily.map((d) => d.date) }
  }, [chartRow, prevRow])

  const engagementDelta =
    linkedin && prevLinkedin && prevLinkedin.metrics.engagementRate
      ? ((linkedin.metrics.engagementRate ?? 0) - prevLinkedin.metrics.engagementRate) / prevLinkedin.metrics.engagementRate * 100
      : null
  const impressionsDelta =
    linkedin && prevLinkedin && prevLinkedin.metrics.impressions
      ? ((linkedin.metrics.impressions ?? 0) - prevLinkedin.metrics.impressions) / prevLinkedin.metrics.impressions * 100
      : null

  const kbCount = knowledgeCounts?.active ?? knowledge.filter((k) => k.active).length

  return (
    <>
      <header className="glass -mx-6 -mt-5 mb-3.5 flex min-h-[52px] shrink-0 flex-wrap items-center gap-3.5 border-b border-line px-[18px] py-1.5">
        <div className="flex min-w-0 items-baseline gap-[9px]">
          <h1 className="text-[17px] font-semibold tracking-[-0.02em] text-ink">Dashboard</h1>
          <span className="hidden truncate text-[11.5px] text-ink-3 md:inline">measured against our own trailing baseline</span>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {months.length > 0 ? (
            <div role="group" aria-label="Reporting period" className="flex items-center overflow-hidden rounded-md border border-line-strong">
              {months.slice(0, 4).map((key, i) => {
                const active = key === month
                const label = labelOf(key)
                return (
                  <button
                    key={key}
                    type="button"
                    onClick={() => setPicked(key)}
                    aria-pressed={active}
                    className={`mono px-2.5 py-[5px] text-[11px] uppercase transition-colors duration-[var(--dur-fast)] ${i > 0 ? 'border-l border-line-strong' : ''} ${
                      active ? 'bg-surface-3 text-ink' : 'text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    {active ? label : label.split(' ')[0]?.slice(0, 3)}
                  </button>
                )
              })}
            </div>
          ) : (
            <span className="mono rounded-md border border-line-strong px-2 py-[5px] text-[10px] tracking-[0.08em] text-ink-3">NO PERIOD REPORTED</span>
          )}
          {reported ? (
            <span className="mono inline-flex items-center gap-1.5 rounded-md border border-line-strong px-2 py-[5px] text-[10px] tracking-[0.08em] text-ink-2">
              <span className="h-[5px] w-[5px] rounded-full bg-accent-bright" aria-hidden="true" />
              REPORTED DATA
            </span>
          ) : null}
          <DownloadMenu
            options={[
              { id: 'combined', label: 'Combined analytics', hint: 'One row per platform per month, every reported metric.', onSelect: (format) => exportCombined(analytics, format) },
              { id: 'per-post', label: 'Per-post analytics', hint: 'Every published post with its latest metric reading.', onSelect: (format) => exportPerPost(published, format) },
            ]}
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
      </header>

      {/* ── Metric band ──────────────────────────────────────────────── */}
      <section
        aria-label="Performance this period"
        className="mb-3.5 grid grid-cols-2 gap-px overflow-hidden rounded-[10px] border border-line-strong bg-line-strong md:grid-cols-3 xl:grid-cols-6"
        style={{ animation: 'eth-row-stream 200ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
      >
        <Tile label="Engagement rate" unavailable={linkedin ? null : 'LinkedIn has reported no monthly rollup yet'}>
          <Figure value="—" {...(linkedin ? { count: linkedin.metrics.engagementRate ?? 0, format: (n: number) => n.toFixed(2) } : {})} unit="%" delta={engagementDelta} />
          {linkedin && prevLinkedin ? (
            <GhostBar
              now={linkedin.metrics.engagementRate ?? 0}
              ghost={prevLinkedin.metrics.engagementRate ?? 0}
            />
          ) : (
            <Spacer />
          )}
          <Caption>{prevLinkedin ? `LinkedIn · ghost = ${labelOf(previousMonth).split(' ')[0]}` : 'LinkedIn · no prior month to compare'}</Caption>
        </Tile>

        <Tile label="Impressions" unavailable={linkedin ? null : 'No impressions reported for this period'}>
          <Figure value="—" {...(linkedin ? { count: linkedin.metrics.impressions ?? 0, format: fmt } : {})} delta={impressionsDelta} />
          {linkedin && linkedin.daily.length > 1 ? <Spark values={linkedin.daily.map((d) => d.value)} /> : <Spacer />}
          <Caption>
            {(() => {
              const first = linkedin?.daily[0]
              if (!linkedin || !first) return 'no daily series'
              const peak = linkedin.daily.reduce((p, d) => (d.value > p.value ? d : p), first)
              return `peak ${fmt(peak.value)} · ${new Date(peak.date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}`
            })()}
          </Caption>
        </Tile>

        <Tile label="New followers" unavailable={linkedin ? null : 'No follower figures reported for this period'}>
          <Figure value="—" {...(linkedin ? { count: (linkedin.metrics.followerGrowth ?? 0) + (instagram?.metrics.followerGrowth ?? 0), format: fmt } : {})} />
          {linkedin ? (
            <SplitBar
              parts={[
                { platform: 'linkedin', value: linkedin.metrics.followerGrowth ?? 0 },
                { platform: 'instagram', value: instagram?.metrics.followerGrowth ?? 0 },
              ]}
            />
          ) : (
            <Spacer />
          )}
          <Caption>{linkedin?.metrics.organicShare !== undefined ? `${linkedin.metrics.organicShare}% organic` : 'organic share not reported'}</Caption>
        </Tile>

        <Tile label="Published">
          <Figure value="0" count={published.length} suffix={drafted > 0 ? `of ${drafted} drafted` : undefined} />
          <Bar fraction={drafted > 0 ? published.length / drafted : 0} tone="var(--color-hud-strong)" />
          <Caption>{held === 0 && rejected === 0 ? 'nothing held or rejected' : `${held} held · ${rejected} rejected`}</Caption>
        </Tile>

        <Tile label="Scheduled · 14d">
          <Figure value="0" count={upcoming.length} suffix={upcoming.length > 0 ? `${scheduledPlatforms} platform${scheduledPlatforms === 1 ? '' : 's'}` : undefined} />
          <div className="mt-3 flex h-3.5 items-end gap-0.5" aria-hidden="true">
            {weekdayShape.map((h, i) => (
              <span
                key={i}
                className="flex-1 rounded-[1px]"
                style={{ height: `${Math.max(20, h * 100)}%`, background: h > 0 ? 'var(--color-hud-strong)' : 'var(--color-surface-3)' }}
              />
            ))}
          </div>
          <Caption>{nextOut ? `next out ${shortDay(nextOut.scheduled_date)} ${nextOut.scheduled_time}` : 'nothing on the calendar'}</Caption>
        </Tile>

        <Tile label="Waiting on people" attention={waitingCount > 0}>
          <div className="mt-[7px] flex items-baseline gap-[7px]">
            <span className={`mono text-[26px] font-medium leading-none tracking-[-0.02em] ${waitingCount > 0 ? 'text-serious' : 'text-ink'}`}>
              <CountUp value={waitingCount} format={(n) => String(Math.round(n))} />
            </span>
            {waitingCount > 0 ? <Breathe /> : null}
          </div>
          <div className="mono mt-[9px] flex flex-col gap-[3px] text-[10px] text-ink-2">
            {openVerdicts.length > 0 ? <span>{openVerdicts.length} &nbsp;validation verdict{openVerdicts.length === 1 ? '' : 's'}</span> : null}
            {awaitingLeadership.length > 0 ? <span>{awaitingLeadership.length} &nbsp;leadership approval{awaitingLeadership.length === 1 ? '' : 's'}</span> : null}
            {pendingConfirm ? <span>1 &nbsp;confirmation</span> : null}
            {waitingCount === 0 ? <span className="text-ink-3">nothing needs a person</span> : null}
          </div>
        </Tile>
      </section>

      {/* ── Hero: live pipeline + decision queue ─────────────────────── */}
      <section className="mb-3.5 grid gap-3.5 lg:grid-cols-[minmax(0,1.52fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            lead={
              <span className={`mono inline-flex items-center gap-[7px] text-[9.5px] uppercase tracking-[0.14em] ${anyRunning ? 'text-accent-bright' : 'text-ink-3'}`}>
                <span className={`h-[5px] w-[5px] rounded-full ${anyRunning ? 'bg-accent-bright' : 'bg-ink-3'}`} aria-hidden="true" />
                {anyRunning ? `Live${runId ? ` · run ${runId}` : ''}` : 'Idle'}
              </span>
            }
            title="What the system is doing"
            meta={runningAgent ? `${agentShort(runningAgent.agent_id)} · ${runningAgent.current_task}` : `${agents.length} agents · nothing running`}
            action={
              <button
                type="button"
                onClick={openTheater}
                className="mono rounded-[5px] border border-line-strong px-2 py-[3px] text-[10px] text-ink-2 transition-colors duration-[var(--dur-fast)] hover:border-accent/60 hover:text-ink"
              >
                OPEN THEATER
              </button>
            }
          />

          <StageScene stages={workStages} loopStage={stages.find((s) => s.id === LOOP_STAGE_IDS[0])} lineFor={stageLine} anyRunning={anyRunning} />

          <div className="flex flex-col gap-[3px] border-t border-line px-[15px] pb-2 pt-[7px]">
            {feed.length === 0 ? (
              <p className="mono text-[10.5px] text-ink-3">no lane has reported this session · press Run pipeline</p>
            ) : (
              feed.map((row, i) => (
                <div
                  key={row.id}
                  className="mono flex items-center gap-[9px] text-[10.5px]"
                  style={{
                    animation: anyRunning
                      ? `eth-feed 9s linear ${i * 3}s infinite`
                      : `eth-row-stream 200ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 60}ms both`,
                  }}
                >
                  <span className={`w-[92px] shrink-0 ${row.warn ? 'text-serious' : 'text-ink-3'}`}>{row.agent}</span>
                  <span className={`min-w-0 flex-1 truncate ${row.warn ? 'text-serious' : 'text-ink-2'}`}>{row.text}</span>
                </div>
              ))
            )}
          </div>
        </Panel>

        <DecisionQueue awaiting={awaitingLeadership} verdicts={openVerdicts} oldest={oldestWaiting} />
      </section>

      {/* ── Baseline + learning loop ─────────────────────────────────── */}
      <section className="mb-3.5 grid gap-3.5 lg:grid-cols-[minmax(0,1.52fr)_minmax(0,1fr)]">
        <Panel>
          <PanelHeader
            title="Against our own baseline"
            action={
              <div role="tablist" className="flex items-center gap-0.5 rounded-md border border-line-strong p-0.5">
                {(['linkedin', 'instagram', 'x', 'facebook'] as Platform[]).map((p) => (
                  <button
                    key={p}
                    type="button"
                    role="tab"
                    aria-selected={platformTab === p}
                    onClick={() => setPlatformTab(p)}
                    className={`mono inline-flex items-center gap-1.5 rounded-[4px] px-[9px] py-[3px] text-[10px] transition-colors duration-[var(--dur-fast)] ${
                      platformTab === p ? 'bg-surface-3 text-ink' : 'text-ink-3 hover:text-ink-2'
                    }`}
                  >
                    <span className="h-[7px] w-[7px] rounded-[2px]" style={{ background: PLATFORM_TOKEN[p] }} aria-hidden="true" />
                    {p === 'linkedin' ? 'LI' : p === 'instagram' ? 'IG' : p === 'x' ? 'X' : 'FB'}
                  </button>
                ))}
              </div>
            }
          />
          <div className="px-4 pb-3.5 pt-2.5">
            {chart ? (
              <>
                <BaselineChart chart={chart} />
                <div className="mt-3 grid grid-cols-3 gap-px overflow-hidden rounded-[7px] border border-line-strong bg-line-strong">
                  <SubMetric label="Days above the band">
                    {chart.daysAbove === null ? (
                      <span className="mono text-[11px] text-ink-3">no prior month</span>
                    ) : (
                      <>
                        <span className="mono text-[17px] font-medium text-good-ink"><CountUp value={chart.daysAbove} format={(n) => String(Math.round(n))} /></span>
                        <span className="mono text-[10.5px] text-ink-3">
                          of {chart.values.length}
                          {chart.prevDaysAbove !== null ? ` · ${labelOf(previousMonth).split(' ')[0]?.slice(0, 3)} ${chart.prevDaysAbove}` : ''}
                        </span>
                      </>
                    )}
                  </SubMetric>
                  <SubMetric label="Daily average">
                    <span className="mono text-[17px] font-medium"><CountUp value={Math.round(chart.avg)} format={fmt} /></span>
                    {chart.prevAvg ? (
                      <span className={`mono text-[10.5px] ${chart.avg >= chart.prevAvg ? 'text-accent-bright' : 'text-ink-3'}`}>
                        {chart.avg >= chart.prevAvg ? '+' : ''}
                        {(((chart.avg - chart.prevAvg) / chart.prevAvg) * 100).toFixed(1)}%
                      </span>
                    ) : null}
                  </SubMetric>
                  <SubMetric label="Peak">
                    <span className="mono text-[17px] font-medium"><CountUp value={chart.values[chart.peakIndex] ?? 0} format={fmt} /></span>
                    <span className="mono text-[10.5px] text-ink-3">
                      {new Date(chart.dates[chart.peakIndex] ?? '').toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
                    </span>
                  </SubMetric>
                </div>
                <p className="mt-[11px] text-[11.5px] leading-relaxed text-ink-2">
                  {chart.band && chart.daysAbove !== null
                    ? `Above our own band on ${chart.daysAbove} of ${chart.values.length} days${
                        chart.prevDaysAbove !== null ? `, where ${labelOf(previousMonth).split(' ')[0]} managed ${chart.prevDaysAbove}` : ''
                      }. The band is the inner half of last month's days — the account's own trailing baseline, not an industry figure.`
                    : `${labelOf(month)} has a daily series but no prior month to draw a band from. Once a second period closes, the band appears.`}
                </p>
              </>
            ) : platformTab === 'x' || platformTab === 'facebook' ? (
              <EmptyState
                title={`${PLATFORM_LABEL[platformTab]} reports no monthly rollup`}
                body="Its figures come from the posts themselves, so there is no daily series to draw against a baseline. A synthetic month would be fabricated evidence."
              />
            ) : (
              <EmptyState
                title={analytics.length === 0 ? 'Nothing reported yet' : `No reported data for ${PLATFORM_LABEL[platformTab]} in ${labelOf(month) || 'this month'}`}
                body="Refresh analytics once a period has closed."
              />
            )}
          </div>
        </Panel>

        <Panel>
          <PanelHeader
            title="What changed because we measured"
            meta={learned.length > 0 ? `Velma · ${learned.length} lesson${learned.length === 1 ? '' : 's'}` : 'Velma · nothing yet'}
          />
          {learned.length === 0 ? (
            <div className="p-4">
              <EmptyState
                title="No lessons recorded yet"
                body="Velma writes here once posts have published and been measured, or once you have given an instruction worth remembering. An empty panel means nothing has been measured — not that nothing was learned."
              />
            </div>
          ) : (
            <div className="py-1">
              {learned.map((entry, i) => {
                const provisional = entry.confidence === 'Low'
                return (
                  <article
                    key={entry.id}
                    className={`px-[15px] py-[11px] ${i < learned.length - 1 ? 'border-b border-line' : ''}`}
                    style={{ animation: `eth-row-stream 200ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 60}ms both` }}
                  >
                    <div className="flex items-center gap-2">
                      <span className={`mono text-[9px] uppercase tracking-[0.12em] ${provisional ? 'text-serious' : 'text-accent-bright'}`}>{entry.category}</span>
                      <span className={`h-1 w-1 rounded-full ${provisional ? 'bg-serious/60' : 'bg-hud-strong'}`} aria-hidden="true" />
                      <span className="mono text-[9.5px] text-ink-3">
                        {entry.evidence_count} observation{entry.evidence_count === 1 ? '' : 's'} · {provisional ? 'provisional' : entry.confidence.toLowerCase()}
                      </span>
                    </div>
                    <h4 className="mt-1.5 text-[12.5px] font-medium leading-snug text-ink">{entry.title}</h4>
                    <p className="mt-1 line-clamp-2 text-[11.5px] leading-relaxed text-ink-2">
                      {entry.content} <span className="text-ink-3">{entry.source}</span>
                    </p>
                  </article>
                )
              })}
            </div>
          )}
        </Panel>
      </section>

      {/* ── The spine ────────────────────────────────────────────────── */}
      <footer className="glass sticky bottom-0 z-10 -mx-6 -mb-5 flex flex-wrap items-center gap-[11px] border-t border-line px-[18px] py-[9px]">
        <span className={`mono inline-flex shrink-0 items-center gap-[7px] text-[10px] tracking-[0.12em] ${anyRunning ? 'text-accent-bright' : 'text-ink-3'}`}>
          <span className={`h-[5px] w-[5px] rounded-full ${anyRunning ? 'bg-accent-bright' : 'bg-ink-3'}`} aria-hidden="true" />
          {runId ? `RUN ${runId.toUpperCase()}` : 'NO RUN'}
        </span>
        <span className="h-[15px] w-px shrink-0 bg-line-strong" aria-hidden="true" />
        <div className="flex min-w-0 flex-1 items-center gap-1" aria-label="Pipeline stages">
          {stages.map((s) => (
            <span
              key={s.id}
              title={`${s.name} · ${s.status}`}
              className="relative h-[3px] overflow-hidden rounded-[2px]"
              style={{
                transition: 'flex 320ms var(--ease-out-soft), background-color 320ms var(--ease-out-soft)',
                flex: s.status === 'running' ? 1.7 : 1,
                background:
                  s.status === 'running'
                    ? 'var(--color-accent-bright)'
                    : s.status === 'done'
                      ? 'var(--color-hud-strong)'
                      : s.status === 'gated'
                        ? 'color-mix(in srgb, var(--color-serious) 32%, transparent)'
                        : s.status === 'failed'
                          ? 'var(--color-critical)'
                          : 'var(--color-surface-3)',
              }}
            >
              {s.status === 'running' ? (
                <span
                  className="absolute inset-0 w-[32%]"
                  style={{
                    background: 'linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-ink) 80%, transparent), transparent)',
                    animation: 'eth-spine-sweep 1.8s linear infinite',
                  }}
                  aria-hidden="true"
                />
              ) : null}
            </span>
          ))}
        </div>
        <span className="mono hidden shrink-0 truncate text-[10px] text-ink-2 md:inline">
          {runningAgent ? `${agentShort(runningAgent.agent_id).toUpperCase()} · ${runningAgent.current_task}` : 'ALL TWELVE IDLE'}
        </span>
        <span className="h-[15px] w-px shrink-0 bg-line-strong" aria-hidden="true" />
        <button type="button" onClick={openKnowledge} className="mono shrink-0 text-[10px] text-ink-3 transition-colors duration-[var(--dur-fast)] hover:text-ink">
          KB {kbCount} · {apiMode === 'connected' ? 'DEMO MODE' : 'STANDALONE'}
        </button>
        {waitingCount > 0 ? (
          <span className="mono inline-flex shrink-0 items-center gap-1.5 rounded-full border border-serious/50 bg-serious/10 px-[9px] py-[3px] text-[10px] tracking-[0.08em] text-serious">
            <Breathe small />
            {waitingCount} FOR YOU
          </span>
        ) : null}
      </footer>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE STAGE SCENE — five stages in depth, one travelling dot per live hand-off
   ═══════════════════════════════════════════════════════════════════════════ */

interface SceneStage {
  id: string
  name: string
  agents: AgentId[]
  status: StageStatus
}

/** Where each stage stands: x across, z toward the viewer, y for the learn loop overhead. */
const SLOTS: Record<string, { x: number; z: number; ry: number }> = {
  discover: { x: -372, z: -118, ry: 14 },
  assess: { x: -214, z: -18, ry: 9 },
  plan: { x: -16, z: 104, ry: 0 },
  create: { x: 182, z: -18, ry: -9 },
  ship: { x: 336, z: -118, ry: -14 },
}

function StageScene({
  stages,
  loopStage,
  lineFor,
  anyRunning,
}: {
  stages: SceneStage[]
  loopStage: SceneStage | undefined
  lineFor: (id: string) => { text: string; tone: string }
  anyRunning: boolean
}) {
  return (
    <div className="relative min-h-[300px] flex-1 overflow-hidden">
      <div className="absolute inset-0" style={{ perspective: 1200, perspectiveOrigin: '50% 44%' }}>
        <div
          className="absolute left-1/2 top-1/2 h-0 w-0"
          style={{
            transformStyle: 'preserve-3d',
            transform: 'translate(-50%, -50%) translateY(16px) scale(0.74)',
            animation: 'eth-cam3 56s cubic-bezier(0.4, 0, 0.2, 1) infinite',
          }}
        >
          {/* the floor */}
          <div
            aria-hidden="true"
            className="absolute left-1/2 top-1/2 h-[620px] w-[1000px] origin-top"
            style={{
              marginLeft: -500,
              marginTop: -310,
              transform: 'translate3d(0, 86px, 0) rotateX(84deg)',
              backgroundImage:
                'linear-gradient(to right, var(--color-hud-strong) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hud-strong) 1px, transparent 1px)',
              backgroundSize: '56px 56px',
              opacity: 0.7,
              maskImage: 'radial-gradient(58% 52% at 50% 14%, #000 10%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(58% 52% at 50% 14%, #000 10%, transparent 100%)',
            }}
          />
          {/* the pool of light under the live stage */}
          {stages.some((s) => s.status === 'running') ? (
            <div
              aria-hidden="true"
              className="absolute left-1/2 top-1/2 h-[300px] w-[400px] rounded-full"
              style={{
                marginLeft: -200,
                marginTop: -150,
                transform: `translate3d(${SLOTS[stages.find((s) => s.status === 'running')?.id ?? 'plan']?.x ?? 0}px, 88px, ${
                  SLOTS[stages.find((s) => s.status === 'running')?.id ?? 'plan']?.z ?? 0
                }px) rotateX(84deg)`,
                background: 'radial-gradient(circle, var(--color-hud-strong), transparent 62%)',
                animation: 'eth-pool 3.6s cubic-bezier(0.4, 0, 0.2, 1) infinite',
              }}
            />
          ) : null}

          {/* hand-offs between neighbouring stages */}
          {stages.slice(0, -1).map((from, i) => {
            const to = stages[i + 1]
            if (!to) return null
            const a = SLOTS[from.id]
            const b = SLOTS[to.id]
            if (!a || !b) return null
            const dx = b.x - a.x
            const dz = b.z - a.z
            const len = Math.hypot(dx, dz)
            const ry = (Math.atan2(-dz, dx) * 180) / Math.PI
            const carrying = from.status === 'done' && to.status === 'running'
            const settled = from.status === 'done' && to.status !== 'idle'
            const colour = carrying ? 'var(--color-accent)' : settled ? 'var(--color-good)' : 'var(--color-line-strong)'
            return (
              <div
                key={`${from.id}-${to.id}`}
                aria-hidden="true"
                className="absolute left-1/2 top-1/2 h-0.5 origin-left"
                style={{
                  width: len,
                  marginTop: -1,
                  transform: `translate3d(${a.x}px, 0, ${a.z}px) rotateY(${ry}deg)`,
                  background: `linear-gradient(90deg, transparent, ${colour} 12%, ${colour} 88%, transparent)`,
                  opacity: settled || carrying ? 0.85 : 0.4,
                }}
              >
                {/* Three packets on a hand-off carrying work; one slow packet on a settled one. */}
                {carrying
                  ? [0, 1, 2].map((n) => (
                      <span
                        key={n}
                        className="absolute -top-[3px] h-2 w-2 rounded-full"
                        style={{ background: colour, boxShadow: `0 0 12px 3px ${colour}`, animation: `eth-signal 1.7s linear ${n * 0.57}s infinite` }}
                      />
                    ))
                  : settled
                    ? (
                      <span
                        className="absolute -top-[3px] h-2 w-2 rounded-full"
                        style={{ background: colour, boxShadow: `0 0 12px 3px ${colour}`, animation: 'eth-signal 3.6s linear infinite' }}
                      />
                    )
                    : null}
              </div>
            )
          })}

          {/* the loop overhead: measure → learn returning to discover */}
          {(() => {
            const a = SLOTS.ship
            const b = SLOTS.discover
            if (!a || !b) return null
            const returning = loopStage?.status === 'running' || loopStage?.status === 'done'
            const colour = 'var(--color-hud-strong)'
            return (
              <>
                <div
                  aria-hidden="true"
                  className="absolute left-1/2 top-1/2 h-0.5 origin-left"
                  style={{
                    width: a.x - b.x,
                    marginTop: -1,
                    transform: `translate3d(${a.x}px, -104px, ${a.z}px) rotateY(180deg)`,
                    background: `linear-gradient(90deg, transparent, ${colour} 10%, ${colour} 90%, transparent)`,
                    opacity: returning ? 0.85 : 0.35,
                  }}
                >
                  {returning ? (
                    <span className="absolute -top-[3px] h-2 w-2 rounded-full" style={{ background: colour, boxShadow: `0 0 12px 3px ${colour}`, animation: 'eth-signal 7.5s linear infinite' }} />
                  ) : null}
                </div>
                <div className="absolute left-1/2 top-1/2 w-[340px] text-center" style={{ marginLeft: -170, transform: 'translate3d(-18px, -158px, -118px)' }}>
                  <div className="mono text-[9px] tracking-[0.14em] text-accent-bright">06 · 07 &nbsp;MEASURE → LEARN</div>
                  <div className="mono mt-0.5 text-[9.5px] text-ink-3">
                    {loopStage?.status === 'running'
                      ? 'Velma is writing the lesson back'
                      : loopStage?.status === 'done'
                        ? 'Jerry measured · Velma wrote the lesson back'
                        : 'Jerry measures · Velma writes the lesson back'}
                  </div>
                </div>
              </>
            )
          })()}

          {/* the stage cards */}
          {stages.map((s, i) => {
            const slot = SLOTS[s.id]
            if (!slot) return null
            const live = s.status === 'running'
            const line = lineFor(s.id)
            const w = live ? 156 : 134
            const h = live ? 126 : 114
            return (
              <div
                key={s.id}
                className="absolute left-1/2 top-1/2"
                style={{ width: w, height: h, marginLeft: -w / 2, marginTop: -h / 2, transform: `translate3d(${slot.x}px, 0, ${slot.z}px) rotateY(${slot.ry}deg)` }}
              >
                <div
                  className="absolute inset-0 overflow-hidden rounded-[11px] border px-[13px] py-3"
                  style={{
                    borderColor: STAGE_STROKE[s.status],
                    background: 'linear-gradient(165deg, var(--color-surface-2), var(--color-page))',
                    boxShadow: live
                      ? '0 26px 54px -26px rgba(0, 0, 0, 0.72), 0 0 0 4px var(--color-hud-strong)'
                      : '0 26px 54px -26px rgba(0, 0, 0, 0.72)',
                  }}
                >
                  {live ? (
                    <span
                      aria-hidden="true"
                      className="absolute inset-x-0 top-0 h-px"
                      style={{ background: 'linear-gradient(90deg, transparent, var(--color-accent-bright), transparent)', animation: 'eth-glint 7s ease-in-out infinite' }}
                    />
                  ) : null}
                  <div className="flex items-center gap-[7px]">
                    <span className="mono text-[9px] tracking-[0.14em]" style={{ color: live ? 'var(--color-accent-bright)' : s.status === 'done' ? 'var(--color-good)' : s.status === 'gated' ? 'var(--color-serious)' : 'var(--color-ink-3)' }}>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span className="ml-auto">
                      {live ? (
                        <WorkArc />
                      ) : s.status === 'gated' ? (
                        <Breathe small />
                      ) : (
                        <span className="block h-[5px] w-[5px] rounded-full" style={{ background: STAGE_STROKE[s.status] }} aria-hidden="true" />
                      )}
                    </span>
                  </div>
                  <div className={`mt-1.5 whitespace-nowrap font-semibold leading-tight tracking-[-0.02em] text-ink ${live ? 'text-[14px]' : 'text-[13px]'}`}>{s.name}</div>
                  <div className="mono mt-0.5 truncate text-[9.5px] text-ink-3">{s.agents.map(agentShort).join(' · ')}</div>
                  <div className="absolute inset-x-[13px] bottom-[11px]">
                    <div className="mb-[7px] h-px bg-surface-3" />
                    <div className={`mono truncate text-[9.5px] ${line.tone}`}>{line.text || (s.status === 'idle' ? 'queued' : s.status)}</div>
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>

      <div className="mono absolute bottom-[9px] left-[15px] flex flex-wrap gap-x-3.5 gap-y-1 text-[9.5px] tracking-[0.08em] text-ink-3">
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-2 bg-good" />SETTLED</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-2 bg-accent" />CARRYING WORK</span>
        <span className="inline-flex items-center gap-1.5"><span className="h-0.5 w-2 bg-hud-strong" />LESSON RETURNING</span>
        {!anyRunning ? <span className="text-ink-3">· nothing moving — the dots are hand-offs in flight, and there are none</span> : null}
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DECISION QUEUE — confidence, the reason and both verdicts on the card
   ═══════════════════════════════════════════════════════════════════════════ */

function DecisionQueue({
  awaiting,
  verdicts,
  oldest,
}: {
  awaiting: Idea[]
  verdicts: ReviewQueueItem[]
  oldest: string | undefined
}) {
  const user = useStore((s) => s.user)
  const pendingConfirm = useStore((s) => s.assistant.pendingConfirm)
  const openReview = useStore((s) => s.openReview)
  const leadershipApprove = useStore((s) => s.leadershipApprove)
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
  const shown = 3
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
          <span className="mono text-[9.5px] text-ink-3">CONF</span>
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
            <p className="mono mt-1 text-[9.5px] text-ink-3">
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
              <Btn variant="primary" onClick={() => commit(idea.id, () => leadershipApprove(idea.id))}>Approve &amp; publish</Btn>
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
    <Panel>
      <PanelHeader
        lead={total > 0 ? <Breathe /> : null}
        title="Waiting on you"
        meta={total === 0 ? 'nothing needs a person' : `${total} item${total === 1 ? '' : 's'}${oldest ? ` · oldest ${timeAgo(oldest)}` : ''}`}
      />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto px-3 py-2.5">
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
    </Panel>
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
      className={`rounded-lg border bg-surface-2 px-3 py-[11px] ${tone === 'serious' && index === 0 ? 'border-serious/60' : 'border-line-strong'}`}
      style={{ animation: `eth-row-stream 200ms cubic-bezier(0.22, 1, 0.36, 1) ${index * 60}ms both` }}
    >
      <div className="flex items-center gap-[7px]">
        <span className={`mono text-[9px] uppercase tracking-[0.12em] ${tone === 'serious' ? 'text-serious' : 'text-accent-bright'}`}>{eyebrow}</span>
        <span className="mono ml-auto text-[9.5px] text-ink-3">{meta}</span>
      </div>
      {children}
    </article>
  )
}

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

/* ═══════════════════════════════════════════════════════════════════════════
   THE BASELINE CHART — daily values against last month's inner two quartiles
   ═══════════════════════════════════════════════════════════════════════════ */

function BaselineChart({
  chart,
}: {
  chart: { values: number[]; band: { lo: number; hi: number } | null; max: number; peakIndex: number; dates: string[] }
}) {
  const W = 860
  const H = 206
  const L = 34
  const R = 8
  const T = 14
  const B = 30
  const n = chart.values.length
  const x = (i: number) => L + ((W - L - R) * i) / Math.max(1, n - 1)
  const y = (v: number) => H - B - ((H - T - B) * v) / chart.max
  const pts = chart.values.map((v, i) => [x(i), y(v)] as const)
  const line = pts.map(([px, py], i) => (i === 0 ? `M${px} ${py}` : `L${px} ${py}`)).join(' ')
  const area = `${line} L${x(n - 1)} ${y(0)} L${L} ${y(0)} Z`
  const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => f * chart.max)
  const tickLabel = (v: number) => (v >= 1000 ? `${(v / 1000).toFixed(v >= 10_000 ? 0 : 1)}K` : String(Math.round(v)))
  const peak = pts[chart.peakIndex]

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="block h-[130px] w-full" preserveAspectRatio="none" role="img" aria-label="Daily values for the month against the account's own trailing baseline band.">
      <defs>
        <linearGradient id="eth-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent-bright)" stopOpacity="0.24" />
          <stop offset="100%" stopColor="var(--color-accent-bright)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <g stroke="var(--color-line)">
        {ticks.map((v) => (
          <line key={v} x1={L} y1={y(v)} x2={W - R} y2={y(v)} />
        ))}
      </g>
      <g className="mono" fontSize={9.5} fill="var(--color-ink-3)" textAnchor="end">
        {ticks.map((v) => (
          <text key={v} x={L - 6} y={y(v) + 3}>
            {tickLabel(v)}
          </text>
        ))}
      </g>
      {chart.band ? (
        <>
          <rect x={L} y={y(chart.band.hi)} width={W - L - R} height={Math.max(2, y(chart.band.lo) - y(chart.band.hi))} fill="var(--color-surface-3)" opacity={0.8} />
          <text x={L + 6} y={y(chart.band.hi) - 4} className="mono" fontSize={9.5} fill="var(--color-ink-3)">
            our own trailing band
          </text>
        </>
      ) : null}
      <path d={area} fill="url(#eth-fill)" />
      <path
        d={line}
        fill="none"
        stroke="var(--color-accent-bright)"
        strokeWidth={1.6}
        strokeLinejoin="round"
        style={{ strokeDasharray: 2400, animation: 'eth-draw 900ms cubic-bezier(0.22, 1, 0.36, 1) both', '--len': 2400 } as CSSProperties}
      />
      {peak ? (
        <>
          <circle cx={peak[0]} cy={peak[1]} r={3.4} fill="var(--color-accent-bright)" />
          <text x={peak[0]} y={Math.max(10, peak[1] - 7)} textAnchor="middle" className="mono" fontSize={9.5} fill="var(--color-ink-2)">
            {tickLabel(chart.values[chart.peakIndex] ?? 0)}
          </text>
        </>
      ) : null}
      <g className="mono" fontSize={9.5} fill="var(--color-ink-3)" textAnchor="middle">
        {chart.dates.map((d, i) =>
          i === 0 || i === n - 1 || i % 6 === 0 ? (
            <text key={d} x={x(i)} y={H - 4}>
              {i === n - 1 ? new Date(d).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' }).toUpperCase() : new Date(d).getDate()}
            </text>
          ) : null,
        )}
      </g>
    </svg>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   PRIMITIVES — the surface grammar: one hairline, no glow, radii 3 / 6 / 10
   ═══════════════════════════════════════════════════════════════════════════ */

function Panel({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-col overflow-hidden rounded-[10px] border border-line-strong bg-surface">{children}</div>
}

function PanelHeader({ lead, title, meta, action }: { lead?: ReactNode; title: string; meta?: string; action?: ReactNode }) {
  return (
    <header className="flex shrink-0 flex-wrap items-center gap-2.5 border-b border-line px-[15px] py-3">
      {lead}
      <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-ink">{title}</h2>
      {meta ? <span className="mono ml-auto truncate text-[10px] text-ink-3">{meta}</span> : null}
      {action ? <span className={meta ? '' : 'ml-auto'}>{action}</span> : null}
    </header>
  )
}

function Tile({ label, unavailable, attention, children }: { label: string; unavailable?: string | null; attention?: boolean; children: ReactNode }) {
  return (
    <div className="relative flex flex-col bg-surface px-[15px] pb-3 pt-[13px]">
      {attention ? <span className="absolute inset-y-0 left-0 w-0.5 bg-serious" aria-hidden="true" /> : null}
      <div className={`mono text-[9.5px] uppercase tracking-[0.14em] ${attention ? 'text-serious' : 'text-ink-3'}`}>{label}</div>
      {unavailable ? (
        <>
          <div className="mono mt-[7px] text-[26px] font-medium leading-none text-ink-3">—</div>
          <div className="mt-auto pt-2.5 text-[10.5px] leading-snug text-ink-3">{unavailable}</div>
        </>
      ) : (
        children
      )}
    </div>
  )
}

function Figure({
  value,
  count,
  format,
  unit,
  suffix,
  delta,
}: {
  value: string
  /** When set, the figure counts up to itself over 900ms. */
  count?: number
  format?: (n: number) => string
  unit?: string
  suffix?: string
  delta?: number | null
}) {
  return (
    <div className="mt-[7px] flex items-baseline gap-[7px]">
      <span className="mono text-[26px] font-medium leading-none tracking-[-0.02em] text-ink">
        {count === undefined ? value : <CountUp value={count} format={format ?? ((n) => String(Math.round(n)))} className="!font-[inherit]" />}
        {unit ? <span className="text-[14px] text-ink-3">{unit}</span> : null}
      </span>
      {delta !== undefined && delta !== null ? (
        <span className={`mono text-[11px] ${delta >= 0 ? 'text-accent-bright' : 'text-ink-3'}`}>
          {delta >= 0 ? '+' : ''}
          {delta.toFixed(1)}
        </span>
      ) : suffix ? (
        <span className="mono text-[11px] text-ink-3">{suffix}</span>
      ) : null}
    </div>
  )
}

function Caption({ children }: { children: ReactNode }) {
  return <div className="mt-auto pt-1.5 text-[10.5px] text-ink-3">{children}</div>
}

function Spacer() {
  return <div className="mt-2.5 h-[3px]" aria-hidden="true" />
}

/** Now against then: the ghost is last month, so a figure that moved shows where from. */
function GhostBar({ now, ghost }: { now: number; ghost: number }) {
  const max = Math.max(now, ghost, 0.0001)
  return (
    <div className="relative mt-2.5 h-[3px] rounded-[2px] bg-surface-3" aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-[2px] bg-hud-strong" style={{ width: `${(ghost / max) * 100}%` }} />
      <span className="absolute inset-y-0 left-0 rounded-[2px] bg-accent-bright" style={{ width: `${(now / max) * 100}%`, transformOrigin: 'left', animation: 'eth-fill 560ms cubic-bezier(0.16, 1, 0.3, 1) both' }} />
    </div>
  )
}

function Bar({ fraction, tone }: { fraction: number; tone: string }) {
  return (
    <div className="relative mt-3 h-[3px] rounded-[2px] bg-surface-3" aria-hidden="true">
      <span className="absolute inset-y-0 left-0 rounded-[2px]" style={{ width: `${Math.min(100, fraction * 100)}%`, background: tone, transformOrigin: 'left', animation: 'eth-fill 560ms cubic-bezier(0.16, 1, 0.3, 1) both' }} />
    </div>
  )
}

function SplitBar({ parts }: { parts: Array<{ platform: Platform; value: number }> }) {
  const total = parts.reduce((s, p) => s + p.value, 0)
  return (
    <div className="mt-3 flex items-center gap-[3px]" aria-hidden="true">
      {parts.filter((p) => p.value > 0).map((p) => (
        <span key={p.platform} className="h-[3px] rounded-[2px]" style={{ width: `${(p.value / Math.max(1, total)) * 100}%`, background: PLATFORM_TOKEN[p.platform] }} />
      ))}
      {total === 0 ? <span className="h-[3px] w-full rounded-[2px] bg-surface-3" /> : null}
    </div>
  )
}

function Spark({ values }: { values: number[] }) {
  const max = Math.max(...values, 1)
  const pts = values.map((v, i) => `${(i / (values.length - 1)) * 120},${24 - (v / max) * 20}`)
  const last = pts[pts.length - 1]?.split(',') ?? ['120', '6']
  return (
    <svg viewBox="0 0 120 26" preserveAspectRatio="none" className="mt-1.5 block h-[26px] w-full" aria-hidden="true">
      <path d={`M${pts.join(' L')}`} fill="none" stroke="var(--color-hud-strong)" strokeWidth={1.25} strokeLinejoin="round" />
      <circle cx={last[0]} cy={last[1]} r={2} fill="var(--color-accent-bright)" />
    </svg>
  )
}

function SubMetric({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="bg-surface-2 px-3 py-2">
      <div className="mono text-[9px] uppercase tracking-[0.13em] text-ink-3">{label}</div>
      <div className="mt-[3px] flex items-baseline gap-1.5">{children}</div>
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
function WorkArc() {
  return (
    <svg width={12} height={12} viewBox="0 0 12 12" aria-hidden="true" style={{ animation: 'eth-work-arc 1.6s linear infinite' }}>
      <circle cx={6} cy={6} r={4.5} fill="none" stroke="var(--color-accent-bright)" strokeWidth={1.4} strokeLinecap="round" strokeDasharray="12 30" />
    </svg>
  )
}

/**
 * THE PIPELINE THEATER
 *
 * A cinematic real-time run of Scrape → Validate → Plan on a virtual clock
 * (50ms ticks), so pause freezes every pending step exactly where it is and
 * resume preserves the spacing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Pause, Play, X } from 'lucide-react'
import { useStore } from '../store'
import { Logo } from '../components/logo'
import { PipelineGraph, type GraphBucket, type GraphSource } from '../components/pipeline-graph'
import { AssistantCore } from '../components/assistant/core'
import { Badge, Btn, PlatformIcon, Progress, fmt } from '../components/ui'
import type { ValidationVerdict } from '../types'

/* ═══════════════════════════════════════════════════════════════════════════
   THE FEED
   ═══════════════════════════════════════════════════════════════════════════ */

type FeedRow =
  | { kind: 'note'; id: string; text: string; tone: 'ok' | 'warn' }
  | {
      kind: 'capture'
      id: string
      keyword: string
      source: string
      title: string
      engagement: number
      relevance: number
    }
  | {
      kind: 'verdict'
      id: string
      entityId: string
      verdict: ValidationVerdict
      title: string
      reason: string
      resolvedBy?: string
    }
  | {
      kind: 'scoring'
      id: string
      title: string
      credibility: number
      relevance: number
      freshness: number
      unique: number
    }

const BUCKET_META: Array<{ id: ValidationVerdict; label: string; tone: string }> = [
  { id: 'validated', label: 'Validated', tone: 'var(--color-good)' },
  { id: 'needs_review', label: 'Needs review', tone: 'var(--color-warn)' },
  { id: 'duplicate', label: 'Duplicate', tone: 'var(--color-accent)' },
  { id: 'rejected', label: 'Rejected', tone: 'var(--color-critical)' },
]

/** The virtual clock: 50 ms ticks, so pause is exact rather than approximate. */
const TICK_MS = 50

export function PipelineTheater() {
  const theaterOpen = useStore((s) => s.theaterOpen)
  const closeTheater = useStore((s) => s.closeTheater)
  const scraped = useStore((s) => s.scraped)
  const topHashtags = useStore((s) => s.topHashtags)
  const signals = useStore((s) => s.keywordSignals)
  const ideas = useStore((s) => s.ideas)
  const setValidation = useStore((s) => s.setValidation)
  const setPage = useStore((s) => s.setPage)

  const [tick, setTick] = useState(0)
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const feedRef = useRef<HTMLDivElement | null>(null)

  /**
   * The script is derived once from state, then revealed by the clock. The
   * theater owns no data of its own, so it cannot disagree with the run.
   */
  const script = useMemo(() => {
    const rows: FeedRow[] = []

    rows.push({
      kind: 'note',
      id: 'note-mode',
      text: 'APIFY_API_TOKEN is not set, so this run is reading the bundled LinkedIn corpus. Set the token and I will run it live.',
      tone: 'warn',
    })

    for (const item of scraped.slice(0, 26)) {
      rows.push({
        kind: 'capture',
        id: `cap-${item.id}`,
        keyword: item.keyword_term ?? '—',
        source: item.source_name ?? 'LinkedIn',
        title: item.title,
        engagement: item.engagement,
        relevance: item.relevance,
      })
    }

    rows.push({
      kind: 'note',
      id: 'note-handoff',
      text: 'Scraping Agent finished. Handing 42 items and 60 hashtag candidates to Validation.',
      tone: 'ok',
    })

    for (const item of scraped.slice(0, 22)) {
      rows.push({
        kind: 'scoring',
        id: `score-${item.id}`,
        title: item.title,
        credibility: item.credibility === 'High' ? 86 : item.credibility === 'Medium' ? 58 : 31,
        relevance: item.relevance,
        freshness: item.freshness,
        unique: item.is_duplicate ? 24 : 92,
      })
      rows.push({
        kind: 'verdict',
        id: `ver-${item.id}`,
        entityId: item.id,
        verdict: item.validation,
        title: item.title,
        reason: item.verdict_reason ?? '',
      })
    }

    return rows
  }, [scraped])

  // The scraping half runs to 45%, validation to 100%.
  const revealed = Math.min(script.length, Math.floor(tick / 4))
  const finished = revealed >= script.length
  const progress = finished ? 100 : Math.round((revealed / Math.max(1, script.length)) * 100)

  const stage: 'scrape' | 'validate' | 'done' = finished
    ? 'done'
    : revealed < 28
      ? 'scrape'
      : 'validate'

  useEffect(() => {
    if (!theaterOpen) {
      setTick(0)
      setPaused(false)
      setFilter(null)
      return
    }
    if (paused || finished) return

    const timer = window.setInterval(() => setTick((t) => t + 1), TICK_MS)
    return () => window.clearInterval(timer)
  }, [theaterOpen, paused, finished])

  // Space pauses, but never while the operator is typing.
  useEffect(() => {
    if (!theaterOpen) return
    const onKey = (event: KeyboardEvent): void => {
      const target = event.target as HTMLElement | null
      const typing =
        target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA' || target?.isContentEditable
      if (event.code === 'Space' && !typing) {
        event.preventDefault()
        setPaused((p) => !p)
      }
      if (event.key === 'Escape') closeTheater()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theaterOpen, closeTheater])

  useEffect(() => {
    if (paused) return
    feedRef.current?.scrollTo({ top: feedRef.current.scrollHeight, behavior: 'smooth' })
  }, [revealed, paused])

  const rows = script.slice(0, revealed)

  const filtered = filter
    ? rows.filter((row) => {
        if (row.kind === 'verdict') return row.verdict === filter
        if (row.kind === 'capture') return row.source === filter || row.keyword === filter
        return true
      })
    : rows

  const buckets: GraphBucket[] = BUCKET_META.map((meta) => ({
    ...meta,
    count: rows.filter((row) => row.kind === 'verdict' && row.verdict === meta.id).length,
  }))

  const sources: GraphSource[] = useMemo(() => {
    const names = [...new Set(scraped.map((s) => s.keyword_term ?? 'unknown'))].slice(0, 6)
    return names.map((name, i) => {
      const captured = rows.filter((row) => row.kind === 'capture' && row.keyword === name).length
      return {
        id: name,
        label: name,
        count: captured,
        status: stage === 'done' || captured > 3 ? 'done' : captured > 0 ? 'working' : i === 0 ? 'working' : 'idle',
      }
    })
  }, [scraped, rows, stage])

  const narration = useMemo(() => {
    if (stage === 'scrape') {
      const captured = rows.filter((r) => r.kind === 'capture').length
      return `Scraping Agent: ${captured} posts captured across twelve keywords.`
    }
    if (stage === 'validate') {
      const verdicts = rows.filter((r) => r.kind === 'verdict').length
      const review = buckets.find((b) => b.id === 'needs_review')?.count ?? 0
      return `Validation Agent: ${verdicts} of ${scraped.length} items scored. ${review} are heading for review.`
    }
    return `Pipeline complete. Five keywords are trending and ${topHashtags.length} hashtags are queued for research.`
  }, [stage, rows, buckets, scraped.length, topHashtags.length])

  const resolveInline = useCallback(
    (entityId: string, verdict: ValidationVerdict) => {
      setResolved((prev) => ({ ...prev, [entityId]: verdict === 'validated' ? 'Approved' : 'Rejected' }))
      void setValidation(entityId, verdict)
    },
    [setValidation],
  )

  if (!theaterOpen) return null

  const trending = [...signals].filter((s) => s.is_trending).sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9)).slice(0, 5)
  const newTrendIdeas = ideas.filter((i) => i.is_new_trend)

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-page" role="dialog" aria-modal="true" aria-label="Pipeline run">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="glass flex shrink-0 flex-wrap items-center gap-3 border-b border-line px-5 py-3">
        <Logo size={26} />
        <div className="min-w-0">
          <h2 className="display text-[15px]">
            {stage === 'scrape'
              ? 'Scraping LinkedIn for 12 keywords'
              : stage === 'validate'
                ? 'Validation Agent at work'
                : 'Pipeline run complete'}
          </h2>
          <p className="text-[11px] text-ink-3">
            {stage === 'scrape'
              ? 'Every post is captured with its author, engagement and hashtags before anything is scored.'
              : stage === 'validate'
                ? 'Every candidate gets exactly one verdict, and every verdict names its evidence.'
                : 'The Calendar Agent placed the strongest trends into the week.'}
          </p>
        </div>

        <div className="ml-auto flex flex-wrap items-center gap-2">
          <span className="hidden items-center gap-1.5 text-[11px] text-ink-3 lg:flex">
            {['1 · Scrape', '2 · Validate', '3 · Plan'].map((step, i) => {
              const active = (stage === 'scrape' && i === 0) || (stage === 'validate' && i === 1) || (stage === 'done' && i === 2)
              return (
                <span key={step} className="flex items-center gap-1.5">
                  <span className={active ? 'text-accent-bright' : ''}>{step}</span>
                  {i < 2 ? <span className="text-ink-3">→</span> : null}
                </span>
              )
            })}
          </span>

          <Btn variant="ghost" onClick={() => setPaused(!paused)}>
            {paused ? <Play size={13} /> : <Pause size={13} />}
            {paused ? 'Resume' : 'Pause'}
          </Btn>

          <button
            type="button"
            onClick={closeTheater}
            aria-label="Close"
            className="rounded-lg border border-line p-1.5 text-ink-3 transition-colors hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {paused ? (
        <div className="shrink-0 border-b border-warn/40 bg-warn/10 px-5 py-1.5 text-[11px] text-warn">
          Paused. Every pending step is held exactly where it is — resume and the spacing continues
          from the same point.
        </div>
      ) : null}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
        <section className="flex min-h-0 flex-1 flex-col border-b border-line p-4 lg:border-b-0 lg:border-r">
          <div className="min-h-0 flex-1">
            <PipelineGraph
              sources={sources}
              buckets={buckets}
              scrapingStatus={stage === 'scrape' ? 'working' : 'done'}
              validationStatus={stage === 'validate' ? 'working' : stage === 'done' ? 'done' : 'idle'}
              paused={paused}
              activeFilter={filter}
              onFilter={setFilter}
            />
          </div>

          <div className="mt-2 flex flex-wrap items-center gap-3 text-[10px] text-ink-3">
            {BUCKET_META.map((meta) => (
              <span key={meta.id} className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: meta.tone }} aria-hidden="true" />
                {meta.label}
              </span>
            ))}
            <span className="ml-auto">Click a source or a bucket to filter the feed.</span>
          </div>

          {/* Command narration strip. */}
          <div className="glass mt-3 flex items-center gap-2.5 rounded-xl px-3 py-2">
            <AssistantCore state={stage === 'done' ? 'dormant' : 'working'} size={26} />
            <p className="text-[12px] leading-relaxed text-ink-2">{narration}</p>
          </div>
        </section>

        <section ref={feedRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto p-4">
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter(null)}
              className="mb-1 inline-flex items-center gap-1.5 rounded-full border border-magenta/40 bg-magenta/10 px-2.5 py-1 text-[11px] text-magenta-ink"
            >
              Filtered by {filter} <X size={11} />
            </button>
          ) : null}

          {filtered.map((row) => (
            <FeedItem key={row.id} row={row} resolved={resolved} onResolve={resolveInline} />
          ))}

          {finished ? (
            <CompletionPanel
              trending={trending.map((t) => ({ term: t.term, score: t.trend_score, rank: t.rank ?? 0 }))}
              topHashtags={topHashtags.map((h) => ({ tag: h.display_tag, score: h.hashtag_score }))}
              buckets={buckets}
              needsReview={rows.filter((r) => r.kind === 'verdict' && r.verdict === 'needs_review')}
              newTrendIdeas={newTrendIdeas.map((i) => ({
                id: i.id,
                title: i.title,
                platform: i.platform,
                slot: i.calendar_slot,
                rank: i.platform_rank,
              }))}
              resolved={resolved}
              onResolve={resolveInline}
              onFilter={setFilter}
              onNavigate={(page) => {
                closeTheater()
                setPage(page)
              }}
              onClose={closeTheater}
            />
          ) : null}
        </section>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="glass shrink-0 border-t border-line px-5 py-2.5">
        <Progress value={stage === 'scrape' ? (progress / 100) * 45 : 45 + (progress / 100) * 55} />
        <div className="mt-1.5 flex flex-wrap items-center gap-3 text-[11px] text-ink-3">
          <span className="tabular font-medium text-ink-2">{progress}%</span>
          <span>
            {rows.filter((r) => r.kind === 'capture').length} captured ·{' '}
            {rows.filter((r) => r.kind === 'verdict').length} scored ·{' '}
            {buckets.find((b) => b.id === 'needs_review')?.count ?? 0} for review
          </span>
          <span className="ml-auto rounded-full border border-line px-2 py-0.5">Space · pause</span>
        </div>
      </footer>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   FEED ITEMS
   ═══════════════════════════════════════════════════════════════════════════ */

const VERDICT_STYLE: Record<ValidationVerdict, { tone: string; label: string }> = {
  validated: { tone: 'var(--color-good)', label: 'Validated' },
  needs_review: { tone: 'var(--color-warn)', label: 'Needs review' },
  duplicate: { tone: 'var(--color-accent)', label: 'Duplicate' },
  rejected: { tone: 'var(--color-critical)', label: 'Rejected' },
  pending: { tone: 'var(--color-ink-3)', label: 'Pending' },
}

function FeedItem({
  row,
  resolved,
  onResolve,
}: {
  row: FeedRow
  resolved: Record<string, string>
  onResolve: (entityId: string, verdict: ValidationVerdict) => void
}) {
  if (row.kind === 'note') {
    return (
      <div
        className={`anim-stream-in rounded-lg border px-3 py-2 text-[11.5px] leading-relaxed ${
          row.tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line bg-surface-2 text-ink-2'
        }`}
      >
        {row.text}
      </div>
    )
  }

  if (row.kind === 'capture') {
    return (
      <div className="anim-stream-in flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-1.5">
        <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">{row.keyword}</span>
        <PlatformIcon platform="linkedin" size={12} />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{row.title}</span>
        <span className="tabular text-[11px] text-ink-3">{fmt(row.engagement)}</span>
        <span className="tabular rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
          Rel {row.relevance}%
        </span>
      </div>
    )
  }

  if (row.kind === 'scoring') {
    const bars = [
      { label: 'Credibility', value: row.credibility },
      { label: 'Relevance', value: row.relevance },
      { label: 'Freshness', value: row.freshness },
      { label: 'Unique', value: row.unique },
    ]
    return (
      <div className="anim-stream-in rounded-lg border border-accent/35 bg-accent/6 px-3 py-2">
        <p className="truncate text-[11.5px] text-ink-2">scoring… {row.title}</p>
        <div className="mt-1.5 space-y-1">
          {bars.map((bar, i) => (
            <div key={bar.label} className="flex items-center gap-2">
              <span className="w-16 shrink-0 text-[10px] text-ink-3">{bar.label}</span>
              <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                <span
                  className="block h-full rounded-full bg-accent"
                  style={{
                    width: `${bar.value}%`,
                    transition: `width var(--dur-slow) var(--ease-out-expo) ${i * 90}ms`,
                  }}
                />
              </span>
              <span className="tabular w-8 text-right text-[10px] text-ink-3">{bar.value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  const style = VERDICT_STYLE[row.verdict]
  const decision = resolved[row.entityId]

  return (
    <div className="anim-stream-in rounded-lg border px-3 py-2" style={{ borderColor: `color-mix(in srgb, ${style.tone} 40%, transparent)` }}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: style.tone }} aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{row.title}</span>
        <span
          className="rounded-full px-1.5 py-0.5 text-[10px] font-medium"
          style={{ color: style.tone, background: `color-mix(in srgb, ${style.tone} 12%, transparent)` }}
        >
          {style.label}
        </span>
      </div>

      {row.reason ? <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{row.reason}</p> : null}

      {row.verdict === 'needs_review' ? (
        decision ? (
          <p className="mt-1.5 flex items-center gap-1 text-[11px] text-good-ink">
            <Check size={11} /> {decision} by you
          </p>
        ) : (
          <div className="mt-1.5 flex items-center gap-2">
            <Btn variant="primary" onClick={() => onResolve(row.entityId, 'validated')}>
              Approve
            </Btn>
            <Btn variant="ghost" onClick={() => onResolve(row.entityId, 'rejected')}>
              Reject
            </Btn>
          </div>
        )
      ) : null}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   COMPLETION
   ═══════════════════════════════════════════════════════════════════════════ */

function CompletionPanel({
  trending,
  topHashtags,
  buckets,
  needsReview,
  newTrendIdeas,
  resolved,
  onResolve,
  onFilter,
  onNavigate,
  onClose,
}: {
  trending: Array<{ term: string; score: number; rank: number }>
  topHashtags: Array<{ tag: string; score: number }>
  buckets: GraphBucket[]
  needsReview: FeedRow[]
  newTrendIdeas: Array<{ id: string; title: string; platform: 'linkedin' | 'instagram' | 'x' | 'facebook'; slot: string; rank: number | null }>
  resolved: Record<string, string>
  onResolve: (entityId: string, verdict: ValidationVerdict) => void
  onFilter: (filter: string | null) => void
  onNavigate: (page: 'calendar' | 'intelligence') => void
  onClose: () => void
}) {
  const outstanding = needsReview.filter((row) => row.kind === 'verdict' && !resolved[row.entityId])

  return (
    <section className="anim-fade-up card mt-3 p-4">
      <h3 className="display text-sm">Pipeline run complete</h3>
      <p className="mt-0.5 text-[12px] text-ink-3">
        The Calendar Agent placed the strongest trends into the week.
      </p>

      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-[0.09em] text-ink-3">Top 5 keywords</p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {trending.map((item) => (
            <span key={item.term} className="flex items-center gap-1.5 rounded-full border border-accent/40 bg-accent/10 px-2.5 py-1 text-[11px]">
              <span className="tabular text-ink-3">{item.rank}</span>
              <span className="font-medium text-ink">{item.term}</span>
              <span className="tabular text-accent-bright">{item.score}</span>
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3">
        <p className="text-[11px] uppercase tracking-[0.09em] text-ink-3">
          Top {topHashtags.length} hashtags · consolidated
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {topHashtags.map((item) => (
            <span key={item.tag} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 text-[11px] text-ink-2">
              #{item.tag}
            </span>
          ))}
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {buckets.map((bucket) => (
          <button
            key={bucket.id}
            type="button"
            onClick={() => onFilter(bucket.id)}
            className="rounded-lg border border-line bg-surface-2 px-2.5 py-2 text-left transition-colors hover:border-line-strong"
          >
            <p className="tabular text-lg font-semibold" style={{ color: bucket.tone }}>
              {bucket.count}
            </p>
            <p className="text-[10.5px] text-ink-3">{bucket.label}</p>
          </button>
        ))}
      </div>

      {outstanding.length > 0 ? (
        <div className="mt-3 rounded-xl border border-warn/40 bg-warn/8 p-3">
          <p className="text-[12px] font-medium text-warn">
            {outstanding.length} item{outstanding.length === 1 ? '' : 's'} still need a verdict
          </p>
          <ul className="mt-2 space-y-1.5">
            {outstanding.slice(0, 4).map((row) =>
              row.kind === 'verdict' ? (
                <li key={row.id} className="flex flex-wrap items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{row.title}</span>
                  <Btn variant="primary" onClick={() => onResolve(row.entityId, 'validated')}>
                    Approve
                  </Btn>
                  <Btn variant="ghost" onClick={() => onResolve(row.entityId, 'rejected')}>
                    Reject
                  </Btn>
                </li>
              ) : null,
            )}
          </ul>
        </div>
      ) : null}

      {newTrendIdeas.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] uppercase tracking-[0.09em] text-ink-3">New trends added to the calendar</p>
          <ul className="mt-1.5 space-y-1">
            {newTrendIdeas.map((idea) => (
              <li key={idea.id} className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-2.5 py-1.5">
                <PlatformIcon platform={idea.platform} size={12} />
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{idea.title}</span>
                <Badge tone={idea.slot === 'primary' ? 'good' : 'neutral'}>
                  {idea.slot === 'primary' ? `On the calendar · #${idea.rank}` : `More suggestions · #${idea.rank}`}
                </Badge>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <Btn variant="primary" onClick={() => onNavigate('calendar')}>
          Open Weekly Calendar
        </Btn>
        <Btn variant="subtle" onClick={() => onNavigate('intelligence')}>
          View Content Intelligence
        </Btn>
        <Btn variant="ghost" onClick={onClose}>
          Close
        </Btn>
      </div>
    </section>
  )
}

/**
 * THE PIPELINE THEATER
 *
 * A cinematic real-time run of Scrape → Validate → Plan on a virtual clock
 * (50ms ticks), so pause freezes every pending step exactly where it is and
 * resume preserves the spacing.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Download, ExternalLink, Play, X } from 'lucide-react'
import { useStore } from '../store'
import { Logo } from '../components/logo'
import type { GraphBucket } from '../components/pipeline-graph'

import { Badge, Btn, PlatformIcon, fmt, timeAgo } from '../components/ui'
import { PLATFORMS } from '../../shared/agent-contract'
import { defaultSkillConfig } from '../../shared/agent-registry'
import type { LiveLane, Platform, ValidationVerdict } from '../types'

/**
 * The two capture knobs this screen can reason about, read from the registry
 * rather than restated. `historyDays` is the window inside which an
 * already-seen page is held back; `minBrandRelevance` is the floor a captured
 * page must clear to be admitted at all.
 */
const PREFILTER = defaultSkillConfig('scraping.dedupe.prefilter')
const HISTORY_DAYS = Number(PREFILTER.historyDays)
/** Age of an ISO timestamp in days. The one place this screen reads the clock. */

/** Lanes that are mostly login-walled, and so cost time for little return. */
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
      /** The lane it came from. `null` is the open-web tier, not a gap. */
      platform: Platform | null
      /**
       * Null when the source stated no engagement figures — which is the norm
       * for a crawled page. Rendered as N/A, never as a zero that would read
       * as "this performed badly".
       */
      engagement: number | null
      relevance: number
      /** The page this row was captured from, when the source named one. */
      url: string | null
      /** ISO timestamp of capture. Empty on a live row that reported none. */
      capturedAt: string
      /** Held back by the scraping stage as already on record. Never reached scoring. */
      held: { since: string; originalTitle: string } | null
    }
  | {
      kind: 'verdict'
      id: string
      entityId: string
      verdict: ValidationVerdict
      title: string
      reason: string
      resolvedBy?: string
      /** Set when the verdict was reached by an earlier run: relative time of that capture. */
      onRecord?: string
      /** The measured figures the verdict rests on, e.g. "rel 71 · cred HIGH · fresh 94". */
      evidence?: string
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
  | {
      kind: 'lane'
      id: string
      keyword: string
      platform: string
      status: 'running' | 'ok' | 'warn'
      kept: number | null
      captured: number | null
      reason: string | null
    }

const BUCKET_META: Array<{ id: ValidationVerdict; label: string; tone: string }> = [
  { id: 'validated', label: 'Validated', tone: 'var(--color-good)' },
  { id: 'needs_review', label: 'Needs review', tone: 'var(--color-warn)' },
  { id: 'duplicate', label: 'Duplicate', tone: 'var(--color-accent)' },
  { id: 'rejected', label: 'Rejected', tone: 'var(--color-critical)' },
]

/** The virtual clock: 50 ms ticks, so pause is exact rather than approximate. */
const TICK_MS = 50

/**
 * How many stored pages the replay walks through.
 *
 * The store can hold hundreds of pages from many runs, and replaying all of
 * them on a 50 ms clock would take minutes. So the replay works a sample —
 * and because it does, every figure the replay prints counts the sample, and
 * the sample is stated in the first row of the feed. Previously the hand-off
 * note said "handing 200 items" over a feed that would only ever show 26, and
 * the narration counted verdicts against a 200 it was never going to reach.
 */
const REPLAY_LIMIT = 26

/*
 * Rows per page in the run feed.
 *
 * A presentation constant, not a tunable: it describes how much of a list fits
 * in a column before paging beats scrolling, which is a property of this screen
 * rather than a decision an operator would make about the pipeline. Nothing in
 * the run changes with it.
 */
const FEED_PAGE = 20

export function PipelineTheater() {
  const theaterOpen = useStore((s) => s.theaterOpen)
  const closeTheater = useStore((s) => s.closeTheater)
  const scraped = useStore((s) => s.scraped)
  const topHashtags = useStore((s) => s.topHashtags)
  const signals = useStore((s) => s.keywordSignals)
  const ideas = useStore((s) => s.ideas)
  const setValidation = useStore((s) => s.setValidation)
  const scrapeRunning = useStore((s) => s.scrapeRun.running)
  const runSummary = useStore((s) => s.scrapeRun.summary)
  const pipelineRun = useStore((s) => s.pipeline)
  const trendingNowList = useStore((s) => s.trending)
  const liveCaptures = useStore((s) => s.scrapeRun.captures)
  const liveLanes = useStore((s) => s.scrapeRun.lanes)
  const liveVerdicts = useStore((s) => s.scrapeRun.verdicts)
  const liveNotes = useStore((s) => s.scrapeRun.notes)
  const keywordCount = useStore((s) => s.keywords.filter((k) => k.active).length)
  const setPage = useStore((s) => s.setPage)
  const runScraping = useStore((s) => s.runScraping)
  const runId = useStore((s) => s.scrapeRun.runId)
  const runStartedAt = useStore((s) => s.scrapeRun.startedAt ?? null)
  const runEndedAt = useStore((s) => s.scrapeRun.endedAt ?? null)

  const [tick, setTick] = useState(0)
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<string | null>(null)
  const [resolved, setResolved] = useState<Record<string, string>>({})
  const feedRef = useRef<HTMLElement | null>(null)

  /*
   * THE REPORT OPENS ITSELF ONCE PER RUN, AND STAYS CLOSED IF DISMISSED.
   *
   * Keyed on the run rather than on `finished` alone: `finished` stays true for
   * as long as the console is open, so reopening on every render would make the
   * dialog impossible to dismiss. Recording WHICH run was reported means the
   * next run raises it again without the operator doing anything.
   */
  const [reportedRun, setReportedRun] = useState<string | null>(null)
  const [reportOpen, setReportOpen] = useState(false)
  // The 3D graph needs WebGL; without it the SVG graph is the same picture.

  /**
   * The script is derived once from state, then revealed by the clock. The
   * theater owns no data of its own, so it cannot disagree with the run.
   */
  const script = useMemo(() => {
    const rows: FeedRow[] = []

    const sample = scraped.slice(0, REPLAY_LIMIT)

    // The scope of the replay, stated before anything is replayed inside it.
    if (scraped.length > sample.length) {
      rows.push({
        kind: 'note',
        id: 'note-sample',
        text:
          `Replaying the ${sample.length} most recent of ${scraped.length} pages on record. ` +
          'A live run shows every page as it lands.',
        tone: 'ok',
      })
    }

    for (const item of sample) {
      rows.push({
        kind: 'capture',
        id: `cap-${item.id}`,
        keyword: item.keyword_term ?? '—',
        source: item.source_name ?? 'Source not named',
        title: item.title,
        platform: item.platform,
        engagement: item.metrics_available ? item.engagement : null,
        relevance: item.relevance,
        url: item.url,
        capturedAt: item.scraped_at,
        held: null,
      })
    }

    // The hand-off is only stated when there is something to hand off, and the
    // figures are the ones actually held. A fixed sentence here claimed a
    // capture that never happened and contradicted every counter on screen.
    if (sample.length > 0) {
      rows.push({
        kind: 'note',
        id: 'note-handoff',
        text:
          `Sherlock finished scraping. Handing ${sample.length} item${sample.length === 1 ? '' : 's'} ` +
          `and ${topHashtags.length} hashtag candidate${topHashtags.length === 1 ? '' : 's'} to Dexter.`,
        tone: 'ok',
      })
    }

    for (const item of sample) {
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
        evidence: `rel ${item.relevance} · cred ${item.credibility.toUpperCase()} · fresh ${item.freshness}`,
      })
    }

    return rows
  }, [scraped, topHashtags.length])

  /**
   * What the run itself reported, in arrival order: each lane as it opens and
   * each page as it lands. This is the scraping agent's actual work, so it is
   * shown as it happens rather than replayed on a clock — a virtual clock over
   * a stored snapshot cannot show a capture that is happening now.
   */
  const liveRows = useMemo(() => {
    const rows: FeedRow[] = []
    for (const lane of liveLanes) {
      rows.push({
        kind: 'lane',
        id: `lane-${lane.id}`,
        keyword: lane.keyword,
        platform: lane.platform,
        status: lane.status,
        kept: lane.kept,
        captured: lane.captured,
        reason: lane.reason,
      })
    }
    for (const capture of liveCaptures) {
      rows.push({
        kind: 'capture',
        id: `live-${capture.id}`,
        keyword: capture.keyword,
        source: capture.source,
        title: capture.title,
        platform: (PLATFORMS as readonly string[]).includes(capture.platform)
          ? (capture.platform as Platform)
          : null,
        // A crawled page carries no reaction count and none is invented.
        engagement: null,
        relevance: capture.relevance ?? 0,
        url: capture.url,
        // A live row carries no capture time of its own; it is being captured
        // now, so the run's clock is the honest answer rather than a blank.
        capturedAt: new Date().toISOString(),
        held: capture.held,
      })
    }
    // Each stage's own conclusion, including the reason it produced nothing.
    for (const note of liveNotes) {
      rows.push({ kind: 'note', id: `note-${note.id}`, text: note.message, tone: note.status })
    }
    // A page held back already carries the verdict an earlier run gave it. That
    // verdict is on record, so it is shown and routed into its bucket — marked
    // as on record, never passed off as this run's scoring.
    for (const capture of liveCaptures) {
      if (capture.held === null || capture.held.verdict === 'pending') continue
      rows.push({
        kind: 'verdict',
        id: `heldver-${capture.id}`,
        entityId: capture.held.originalId || capture.id,
        verdict: capture.held.verdict,
        title: capture.title,
        reason: capture.held.reason,
        onRecord: timeAgo(capture.held.since),
      })
    }
    // Verdicts sit after the captures they judge, so the feed reads in the
    // order the pipeline actually works: capture, then score.
    for (const verdict of liveVerdicts) {
      rows.push({
        kind: 'verdict',
        id: `livever-${verdict.id}`,
        entityId: verdict.id,
        verdict: verdict.verdict,
        title: verdict.title,
        reason: verdict.reason,
        evidence: [
          verdict.relevance === null ? null : `rel ${verdict.relevance}`,
          verdict.credibility === null ? null : `cred ${verdict.credibility.toUpperCase()}`,
        ].filter((part): part is string => part !== null).join(' · ') || undefined,
      })
    }
    return rows
  }, [liveLanes, liveCaptures, liveVerdicts, liveNotes])

  // A run that has reported anything owns the feed. Only when it has reported
  // nothing at all does the theater fall back to replaying what is stored.
  const live = liveRows.length > 0
  // Pages the scraping stage held back never reach Dexter. Counting them
  // apart is what lets the graph say "0 new" instead of an unexplained "Done".
  const heldCount = liveCaptures.filter((c) => c.held !== null).length
  const handedOver = liveCaptures.length - heldCount

  // The scraping half runs to 45%, validation to 100%.
  const revealed = Math.min(script.length, Math.floor(tick / 4))
  // The feed replays what the store holds, on a clock. The run is the API's,
  // and takes as long as the crawl takes. "Complete" is said only when both
  // are true: a feed that has caught up while Sherlock is still capturing is
  // caught up, not complete — and the bar holds short of full to say so.
  const caughtUp = revealed >= script.length
  const finished = live ? !scrapeRunning : caughtUp && !scrapeRunning
  const shown = caughtUp && !finished ? Math.max(0, script.length - 1) : revealed

  // Live progress is lanes settled over lanes opened — the run's own unit of
  // work. It is never a timer, so the bar cannot run ahead of the crawl.
  const settledLanes = liveLanes.filter((l) => l.status !== 'running').length
  const liveProgress =
    liveVerdicts.length > 0
      ? // Scoring: verdicts returned over pages captured.
        Math.round((liveVerdicts.length / Math.max(1, liveCaptures.length)) * 100)
      : Math.round((settledLanes / Math.max(1, liveLanes.length)) * 100)
  const progress = finished
    ? 100
    : live
      ? Math.min(100, liveProgress)
      : Math.round((shown / Math.max(1, script.length)) * 100)

  // A live run is scoring once the first verdict lands, so the stage follows the
  // run rather than a tick count.
  const stage: 'scrape' | 'validate' | 'done' = finished
    ? 'done'
    : live
      ? liveVerdicts.length > 0
        ? 'validate'
        : 'scrape'
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
      if (event.key !== 'Escape') return
      // The report is the innermost layer, so Escape dismisses it first and
      // leaves the console standing. A second Escape then closes the console.
      if (reportOpen) {
        setReportOpen(false)
        return
      }
      closeTheater()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [theaterOpen, closeTheater, reportOpen])

  const rows = live ? liveRows : script.slice(0, revealed)

  /*
   * THE FEED FOLLOWS THE RUN.
   *
   * This depended on `revealed` alone — the scripted-playback counter — so it
   * worked while replaying a recorded run and did nothing at all during a live
   * one, where rows arrive over the event stream and `revealed` never moves.
   * A live run therefore filled the feed from the top while the viewport stayed
   * pinned to the first few rows, and the latest lane had to be scrolled to by
   * hand exactly when it was changing fastest.
   *
   * `rows.length` is the dependency that is true in both modes.
   */
  useEffect(() => {
    if (paused) return
    const element = feedRef.current
    if (!element) return
    // Only follow when the reader is already at the end. Yanking the viewport
    // back while someone is reading an earlier row is worse than not following.
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 120
    if (!atBottom && rows.length > 0) return
    element.scrollTo({ top: element.scrollHeight, behavior: 'smooth' })
  }, [rows.length, revealed, paused])

  /*
   * Raise the report when a run finishes, once. `runId ?? 'scripted'` covers
   * replayed runs, which carry no id but still end with a verdict worth showing.
   */
  useEffect(() => {
    if (!finished) return
    const key = runId ?? 'scripted'
    if (reportedRun === key) return
    setReportedRun(key)
    setReportOpen(true)
  }, [finished, runId, reportedRun])

  const filtered = filter
    ? rows.filter((row) => {
        if (row.kind === 'verdict') return row.verdict === filter
        if (row.kind === 'capture') return row.source === filter || row.keyword === filter
        return true
      })
    : rows

  /* ── Paging the feed ──────────────────────────────────────────────────────
     A finished run leaves hundreds of rows here, and a single list that long is
     only navigable by scrolling past everything you are not looking for.

     Paging is anchored to the END of the list, not the start: page 1 is the
     OLDEST rows, and the last page is where a live run is writing. `FEED_PAGE`
     rows per page.

     A live run pins itself to the last page — during a run the interesting row
     is the one arriving, and having the view sit on page 1 while work happens
     out of sight is the behaviour this replaces. Once the run finishes the page
     stops moving, so an operator reading page 3 of a finished run stays there.
  */
  const pageCount = Math.max(1, Math.ceil(filtered.length / FEED_PAGE))
  const [feedPage, setFeedPage] = useState(1)

  // Clamp rather than reset: a filter that shortens the list should not throw
  // away the operator's place any further than it has to.
  const page = Math.min(feedPage, pageCount)

  useEffect(() => {
    if (finished) return
    setFeedPage(pageCount)
  }, [pageCount, finished])

  const paged = filtered.slice((page - 1) * FEED_PAGE, page * FEED_PAGE)

  /*
   * VERDICT COUNTS COME FROM THE RUN'S OWN RECORD ONCE IT HAS ONE.
   *
   * These counted live SSE rows only. That works while a run is streaming and
   * reports FOUR ZEROS the moment it is not — which is exactly when the
   * completion panel renders. So a run that validated three pages and marked
   * fifteen duplicates finished by announcing "0 validated · 0 needs review ·
   * 0 duplicate · 0 rejected" directly above the ideas it had just placed on
   * the calendar. The numbers were not wrong so much as absent, and absent
   * rendered as zero.
   *
   * `pipeline.summary` is what the orchestrator persisted for this run, so it
   * survives the stream ending, a reload, and reopening the theater later. Law
   * 8: state is server-truth. Live rows still win WHILE they exist, because
   * mid-run they are ahead of the summary — which is only written at the end.
   */
  const liveBucketCounts = BUCKET_META.map(
    (meta) => rows.filter((row) => row.kind === 'verdict' && row.verdict === meta.id).length,
  )
  const anyLiveVerdict = liveBucketCounts.some((n) => n > 0)
  const persisted = (pipelineRun?.summary ?? {}) as Record<string, unknown>
  const persistedCount = (key: string): number => {
    const value = persisted[key]
    return typeof value === 'number' ? value : 0
  }

  const buckets: GraphBucket[] = BUCKET_META.map((meta, i) => ({
    ...meta,
    count: anyLiveVerdict
      ? (liveBucketCounts[i] ?? 0)
      : persistedCount(
          meta.id === 'needs_review'
            ? 'needsReview'
            : meta.id === 'validated'
              ? 'validated'
              : meta.id === 'duplicate'
                ? 'duplicate'
                : 'rejected',
        ),
  }))


  /* ── What the run produced, and what it costs to change ──────────────
     Every figure below is counted from what the run reported. Nothing here
     is estimated, and a lever that cannot be measured is not offered. */

  /** Pages that carry a verdict at all — the denominator for every share. */
  const verdictTotal = rows.filter((r) => r.kind === 'verdict').length

  /**
   * Pages the run CAPTURED, which is a different number from pages it SCORED.
   *
   * The header counted verdicts and called them "pages", so for the whole of
   * the capture stage — minutes, on a real run — it read "This run · 0 pages"
   * while the footer counted 55 captured and Sherlock's own caption said 55
   * kept. Three figures on one screen, two of them agreeing and the loudest one
   * contradicting both.
   *
   * Nothing about the scoring was wrong: Dexter genuinely had nothing to score
   * yet. The defect was calling the scored count "pages" and showing it before
   * scoring had happened, which reads as a run that found nothing.
   */
  const capturedTotal = rows.filter((r) => r.kind === 'capture').length

  /**
   * Verdicts this run actually produced. A page held back carries the verdict
   * an earlier run gave it, and that verdict is shown — but it is on record,
   * not scored now, and counting it as scored is the one misreading this
   * screen exists to prevent.
   */
  const scoredNow = rows.filter((r) => r.kind === 'verdict' && r.onRecord === undefined).length

  /** Ideas the calendar agent placed because a new trend appeared. */
  const newTrendCount = ideas.filter((i) => i.is_new_trend).length

  /** Verdicts only a person can clear, minus the ones already cleared here. */
  const outstanding = rows.filter(
    (row) => row.kind === 'verdict' && row.verdict === 'needs_review' && resolved[row.entityId] === undefined,
  )

  /** True when every verdict on screen was reached by an earlier run. */
  const onRecordOnly =
    verdictTotal > 0 && rows.every((r) => r.kind !== 'verdict' || r.onRecord !== undefined)

  /**
   * The finding: the sentence that explains the zeros.
   *
   * Only shown when there is a real finding to state. A run that scored
   * normally has no finding, and inventing one would be noise.
   */
  const finding = useMemo((): { sentence: string; figures: Array<{ label: string; value: number; emphasis?: boolean }> } | null => {
    if (!live || !finished) return null
    if (liveVerdicts.length > 0) return null
    if (heldCount === 0) return null
    const stamps = liveCaptures
      .map((c) => c.held?.since)
      .filter((since): since is string => typeof since === 'string')
      .sort()
    const oldest = stamps[0]
    const newest = stamps[stamps.length - 1]
    const spread = oldest && newest && new Date(newest).getTime() - new Date(oldest).getTime() > 60 * 60 * 1000
    const origin = spread
      ? ` from runs between ${timeAgo(oldest)} and ${timeAgo(newest)}`
      : oldest ? ` from a run ${timeAgo(oldest)}` : ''
    return {
      sentence:
        `Dexter had nothing new to score. All ${heldCount} page${heldCount === 1 ? '' : 's'} Sherlock kept ` +
        `${heldCount === 1 ? 'was' : 'were'} already on record` +
        origin +
        `, inside the ${HISTORY_DAYS}-day look-back — so none crossed the hand-off.`,
      figures: [
        { label: 'Kept', value: liveCaptures.length },
        { label: 'Held', value: heldCount, emphasis: true },
        { label: 'New', value: handedOver },
      ],
    }
  }, [live, finished, liveVerdicts.length, heldCount, liveCaptures, handedOver])

  /**
   * Settings that demonstrably shaped this run.
   *
   * Each lever names a registry knob and a consequence counted from the run's
   * own rows. A lever whose consequence cannot be counted is left out rather
   * than guessed at — an unmeasured "this might help" is exactly the kind of
   * claim this product does not make.
   */
  /* The "What would change the outcome" panel and the `levers` memo that fed
     it were removed on request. The knobs themselves are unchanged and live in
     Agent Studio, where they can be changed rather than merely suggested. */

  /**
   * The pipeline as stations, in the order the orchestrator runs them.
   *
   * The figure under each is the one that station actually produced, so a
   * station that did nothing says so rather than showing a zero that reads
   * as a failure.
   */
  /** The oldest held capture's own timestamp — the run the on-record verdicts came from. */
  const heldSince = liveCaptures
    .map((c) => c.held?.since)
    .filter((since): since is string => typeof since === 'string')
    .sort()[0]

  /**
   * The pipeline as five stations, in the order the orchestrator runs them,
   * from the keyword set to the calendar. The figure under each is the one
   * that station actually produced, so a station that did nothing says so
   * rather than showing a zero that reads as a failure.
   */
  const stations = useMemo((): Station[] => {
    const captured = rows.filter((r) => r.kind === 'capture').length
    const emptyLanes = liveLanes.filter((l) => l.status === 'warn').length
    /*
     * HOW MANY KEYWORDS THIS RUN ACTUALLY TOOK.
     *
     * This read `keywordCount` — every ACTIVE keyword in the workspace — the
     * moment there were no live lane events, so the source card announced
     * "151 keywords" for a run that scanned three. Before lanes arrived it
     * showed the other failure, "0 keywords", because an empty live set counts
     * zero. Neither number described the run.
     *
     * The run itself records the answer: `pipeline.summary.keywordsScanned` is
     * written by the orchestrator from the resolved set. Live lanes still win
     * while they exist — mid-run they are ahead of a summary only written at
     * the end — and the active-set count survives only as the last resort,
     * when no run has happened at all.
     */
    const scannedThisRun = (() => {
      const summary = (pipelineRun?.summary ?? {}) as Record<string, unknown>
      const n = summary.keywordsScanned
      return typeof n === 'number' && n > 0 ? n : null
    })()
    const liveKeywords = new Set(liveLanes.map((l) => l.keyword)).size
    const keywords = liveKeywords > 0 ? liveKeywords : (scannedThisRun ?? keywordCount)
    const gateHeld = heldCount > 0 && scoredNow === 0
    const count = (id: ValidationVerdict): number => buckets.find((b) => b.id === id)?.count ?? 0

    return [
      {
        id: 'source',
        tag: 'SOURCE',
        name: `${keywords} keyword${keywords === 1 ? '' : 's'}`,
        sub: liveLanes.length > 0
          ? `${liveLanes.length} lanes opened`
          : scannedThisRun !== null
            ? 'scanned this run'
            : 'active in the workspace',
        figure: liveLanes.length > 0
          ? 'resolved by weight'
          : scannedThisRun !== null
            ? 'this run'
            : 'on record',
        caption:
          `${keywords} active keyword${keywords === 1 ? '' : 's'} resolved by weight` +
          (liveLanes.length > 0 ? `, opening ${liveLanes.length} keyword-and-lane crawls.` : '.'),
        status: keywords > 0 ? 'done' : 'idle',
      },
      {
        id: 'scraping',
        tag: '01',
        name: 'Sherlock',
        sub: 'Scraping Agent',
        figure: liveLanes.length > 0 ? `${captured} kept · ${emptyLanes} empty` : `${captured} kept`,
        caption:
          `The Scraping Agent read every lane and kept ${captured} page${captured === 1 ? '' : 's'}` +
          (emptyLanes > 0 ? `. ${emptyLanes} lane${emptyLanes === 1 ? '' : 's'} came back empty.` : '.'),
        status: stage === 'scrape' ? 'working' : captured > 0 || finished ? 'done' : 'idle',
      },
      {
        id: 'validation',
        tag: '02',
        name: 'Dexter',
        sub: 'Validation Agent',
        figure: scoredNow > 0 ? `${scoredNow} scored` : gateHeld ? '0 new to score' : stage === 'validate' ? 'scoring' : 'nothing to score',
        caption:
          scoredNow > 0
            ? `The Validation Agent gave exactly one verdict to each of ${scoredNow} page${scoredNow === 1 ? '' : 's'}, and each verdict names its evidence.`
            : gateHeld
              ? `Nothing crossed the hand-off: all ${heldCount} kept page${heldCount === 1 ? ' was' : 's were'} already on record, so the Validation Agent was handed nothing new.`
              : 'The Validation Agent has not been handed anything yet.',
        status: stage === 'validate' ? 'working' : gateHeld && finished ? 'attention' : scoredNow > 0 ? 'done' : 'idle',
      },
      {
        id: 'buckets',
        tag: onRecordOnly ? 'ON RECORD' : 'THIS RUN',
        name: verdictTotal > 0 ? `${count('validated')} · ${count('needs_review')} · ${count('duplicate')} · ${count('rejected')}` : '— · — · — · —',
        sub: 'by verdict',
        figure: verdictTotal === 0 ? 'no verdicts yet' : onRecordOnly ? (heldSince ? `from the run ${timeAgo(heldSince)}` : 'from an earlier run') : 'scored this run',
        caption:
          verdictTotal === 0
            ? 'No page has a verdict yet.'
            : onRecordOnly
              ? `${verdictTotal} verdict${verdictTotal === 1 ? '' : 's'} on record from an earlier run: ${count('validated')} validated, ${count('needs_review')} need review, ${count('duplicate')} duplicate, ${count('rejected')} rejected. None was re-scored.`
              : `${verdictTotal} verdict${verdictTotal === 1 ? '' : 's'}: ${count('validated')} validated, ${count('needs_review')} need review, ${count('duplicate')} duplicate, ${count('rejected')} rejected.`,
        status: verdictTotal === 0 ? 'idle' : onRecordOnly ? 'record' : 'done',
      },
      {
        id: 'calendar',
        tag: '03',
        name: 'Dora',
        sub: 'Calendar Agent',
        figure: newTrendCount > 0 ? `${newTrendCount} placed` : 'nothing to place',
        caption:
          newTrendCount > 0
            ? `The Calendar Agent placed ${newTrendCount} new trend${newTrendCount === 1 ? '' : 's'} into the week.`
            : 'The Calendar Agent had no new trend to place this run.',
        status: stage === 'done' ? (newTrendCount > 0 ? 'done' : 'idle') : 'idle',
      },
    ]
  }, [rows, liveLanes, live, keywordCount, pipelineRun, stage, finished, scoredNow, heldCount, newTrendCount, buckets, verdictTotal, onRecordOnly, heldSince])

  /**
   * The four rails between the stations, each in the state its hand-off is
   * in. A packet rides a rail only while work is actually crossing it; the
   * gate marker sits on the rail where every packet was turned back.
   */
  const rails = useMemo((): RailKind[] => {
    const gateHeld = heldCount > 0 && scoredNow === 0
    return [
      stage === 'scrape' ? 'working' : stations[1]?.status === 'done' ? 'done' : 'idle',
      stage === 'validate' ? 'working' : scoredNow > 0 ? 'done' : gateHeld && finished ? 'held' : 'idle',
      scoredNow > 0 ? 'done' : 'idle',
      newTrendCount > 0 ? 'done' : 'idle',
    ]
  }, [stage, stations, scoredNow, heldCount, finished, newTrendCount])

  /**
   * The station the scene is showing.
   *
   * While the run plays, the scene follows it. Stepping or clicking a station
   * pauses the run and pins that station; pressing Play in the strip releases
   * the pin. Pausing by any other route (Space, the header button) keeps the
   * last pin, so pausing returns you to where you were looking — nothing is
   * synchronised through an effect, the index is simply derived.
   */
  const [pinnedStation, setPinnedStation] = useState<number | null>(null)

  // The run's clock. Its start and end are the store's facts; while it runs,
  // one tick a second keeps the figure moving. Nothing is set during render.
  const [now, setNow] = useState(0)
  useEffect(() => {
    if (!scrapeRunning) return
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [scrapeRunning])
  const runSeconds =
    runStartedAt === null ? null : Math.max(0, Math.round(((runEndedAt ?? now) - runStartedAt) / 1000))

  // Where the run is: the working station, or where the story ended.
  const autoStation = stage === 'scrape' ? 1 : stage === 'validate' ? 2 : heldCount > 0 && scoredNow === 0 ? 2 : newTrendCount > 0 ? 4 : 3
  const stationIndex =
    paused && pinnedStation !== null ? Math.min(pinnedStation, stations.length - 1) : autoStation

  const runNarration = useMemo(() => {
    if (stage === 'scrape') {
      const captured = rows.filter((r) => r.kind === 'capture').length
      if (live) {
        const open = liveLanes.filter((l) => l.status === 'running').length
        const empty = liveLanes.filter((l) => l.status === 'warn').length
        const terms = new Set(liveLanes.map((l) => l.keyword)).size
        // An empty lane is a finding about that lane, so it is counted out
        // loud rather than folded into a total that reads as failure.
        return (
          `Sherlock: ${captured} page${captured === 1 ? '' : 's'} kept from ` +
          `${liveLanes.length} lane${liveLanes.length === 1 ? '' : 's'} across ` +
          `${terms} keyword${terms === 1 ? '' : 's'}` +
          (open > 0 ? ` · ${open} still working` : '') +
          (empty > 0 ? ` · ${empty} came back empty` : '') +
          '.'
        )
      }
      return (
        `Sherlock: ${captured} post${captured === 1 ? '' : 's'} shown from ` +
        `${keywordCount} active keyword${keywordCount === 1 ? '' : 's'}.`
      )
    }
    if (stage === 'validate') {
      const verdicts = rows.filter((r) => r.kind === 'verdict').length
      const review = buckets.find((b) => b.id === 'needs_review')?.count ?? 0
      // What this feed can actually reach, so the count is able to finish.
      const total = live ? liveCaptures.length : Math.min(scraped.length, REPLAY_LIMIT)
      // Rule 6: a zero must name its cause. Everything captured being already
      // held is a finding about the run, not a failure of the validation agent.
      if (live && verdicts === 0) {
        if (heldCount > 0 && handedOver === 0) {
          const onRecord = rows.filter((r) => r.kind === 'verdict' && r.onRecord !== undefined)
          const tally = (v: ValidationVerdict): number => onRecord.filter((r) => r.kind === 'verdict' && r.verdict === v).length
          return (
            `Dexter: nothing new to score — all ${heldCount} captured page${heldCount === 1 ? '' : 's'} ` +
            `already carr${heldCount === 1 ? 'ies' : 'y'} a verdict from an earlier run: ` +
            `${tally('validated')} validated, ${tally('needs_review')} need review, ` +
            `${tally('duplicate')} duplicate, ${tally('rejected')} rejected.`
          )
        }
        const why = liveNotes.find((n) => /filtered|already-captured|already captured/i.test(n.message))
        return why
          ? `Dexter had nothing new to score — ${why.message}`
          : 'Dexter had nothing new to score: no page survived the capture stage.'
      }
      return (
        `Dexter: ${verdicts} of ${total} item${total === 1 ? '' : 's'} scored. ` +
        `${review} heading for review.`
      )
    }
    const trendingNow = signals.filter((sig) => sig.is_trending).length
    const trendWord = `${trendingNow} keyword${trendingNow === 1 ? '' : 's'}`
    // A run that held everything back changed nothing; what is trending was
    // decided by earlier runs, and the sentence says so.
    return heldCount > 0 && liveVerdicts.length === 0
      ? `Run complete. Nothing new reached scoring; ${trendWord} remain trending from earlier runs and ${topHashtags.length} hashtags are queued for research.`
      : `Pipeline complete. ${trendWord} ${trendingNow === 1 ? 'is' : 'are'} trending and ${topHashtags.length} hashtags are queued for research.`
  }, [stage, rows, buckets, scraped.length, topHashtags.length, live, liveLanes, liveCaptures.length, liveNotes, keywordCount, heldCount, handedOver, signals, liveVerdicts.length])


  /**
   * Leaving the theater for a screen. The run is the server's and keeps going
   * — closing this dialog stops the replay, not the crawl.
   */
  const leaveFor = useCallback(
    (page: 'calendar' | 'intelligence'): void => {
      closeTheater()
      setPage(page)
    },
    [closeTheater, setPage],
  )

  const resolveInline = useCallback(
    (entityId: string, verdict: ValidationVerdict) => {
      setResolved((prev) => ({ ...prev, [entityId]: verdict === 'validated' ? 'Approved' : 'Rejected' }))
      void setValidation(entityId, verdict)
    },
    [setValidation],
  )

  if (!theaterOpen) return null

  /*
   * The LATEST RUN's trending set, not the accumulated one.
   *
   * `signals` is the newest row per keyword across every run, so filtering it
   * by `is_trending` returned whatever each past run had flagged — five
   * keywords from five different runs, all showing rank 1, listed beside
   * source cards naming three completely different terms.
   */
  const trending = [...trendingNowList].sort((a, b) => (a.rank ?? 9) - (b.rank ?? 9)).slice(0, 5)
  const newTrendIdeas = ideas.filter((i) => i.is_new_trend)

  return (
    <div className="fixed inset-0 z-[92] flex flex-col bg-page" role="dialog" aria-modal="true" aria-label="Pipeline run">
      {/* ── Header ──────────────────────────────────────────────────────── */}
      <header className="flex h-[54px] shrink-0 items-center gap-3.5 border-b border-line bg-surface px-[18px]">
        <Logo size={26} />
        <h1 className="truncate text-[14.5px] font-semibold tracking-[-0.02em] text-ink">
          {finding
            ? 'Nothing new reached scoring'
            : stage === 'scrape'
              ? live
                ? `Capturing across ${new Set(liveLanes.map((l) => l.platform)).size} lane${new Set(liveLanes.map((l) => l.platform)).size === 1 ? '' : 's'}`
                : `Scraping ${keywordCount} active keyword${keywordCount === 1 ? '' : 's'}`
              : stage === 'validate'
                ? live || !caughtUp
                  ? 'Dexter at work'
                  : 'Sherlock is still capturing live'
                : 'Pipeline run complete'}
        </h1>
        {/* The run's own identity and clock — or, replaying, the scope of the replay. */}
        <span className="mono shrink-0 text-[10px] tracking-[0.08em] text-ink-3">
          {live && runId
            ? `RUN ${runId.slice(-4).toUpperCase()}${runSeconds === null ? '' : ` · ${formatSeconds(runSeconds)}`}`
            : live
              ? runSeconds === null ? 'LIVE RUN' : `LIVE RUN · ${formatSeconds(runSeconds)}`
              : `REPLAY · ${Math.min(scraped.length, REPLAY_LIMIT)} PAGES ON RECORD`}
        </span>

        <div className="mono ml-auto flex items-center gap-2.5 text-[10px] tracking-[0.08em]">
          {/* Each stage with what it produced; the amber one is where a person is needed. */}
          {[
            { label: 'SCRAPE', value: rows.filter((r) => r.kind === 'capture').length, state: stations[1]?.status ?? 'idle' },
            { label: 'VALIDATE', value: scoredNow, state: stations[2]?.status ?? 'idle' },
            { label: 'PLAN', value: newTrendCount, state: stations[4]?.status ?? 'idle' },
          ].map((step, i) => (
            <span key={step.label} className="inline-flex items-center gap-2.5">
              {i > 0 ? <span className="text-line-strong" aria-hidden="true">→</span> : null}
              <span className={`inline-flex items-center gap-1.5 ${step.state === 'idle' ? 'text-ink-3' : 'text-ink'}`}>
                {step.state === 'attention' ? (
                  <Breathe tone="var(--color-serious)" />
                ) : step.state === 'working' ? (
                  <WorkArc size={9} />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full" style={{ background: step.state === 'done' ? 'var(--color-good)' : 'var(--color-line-strong)' }} aria-hidden="true" />
                )}
                {step.label}{step.state === 'idle' && step.value === 0 ? '' : ` ${step.value}`}
              </span>
            </span>
          ))}
          <span className="mx-0.5 h-[22px] w-px shrink-0 bg-line-strong" aria-hidden="true" />
          <Btn
            variant="primary"
            disabled={scrapeRunning}
            onClick={() => void runScraping()}
            className="!py-[6px] !text-[12px] font-semibold"
          >
            {scrapeRunning ? <WorkArc size={12} /> : <Play size={12} />}
            {scrapeRunning ? 'Running' : 'Re-run'}
          </Btn>
          <button
            type="button"
            onClick={closeTheater}
            aria-label="Close"
            className="rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
          >
            <X size={15} />
          </button>
        </div>
      </header>

      {/* ── The finding, above everything ───────────────────────────────
          The zeros are the symptom; this sentence is the cause. */}
      {finding ? (
        <div
          className="flex shrink-0 items-start gap-4 border-b border-line bg-surface-2 px-[18px] py-[13px]"
          style={{ animation: 'eth-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
        >
          <span className="relative mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center" aria-hidden="true">
            <span className="absolute inset-0 rounded-full bg-serious opacity-35" style={{ animation: 'eth-attention-breathe 4s ease-in-out infinite' }} />
            <span className="relative h-1.5 w-1.5 rounded-full bg-serious" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="mono text-[11px] uppercase tracking-[0.14em] text-serious">The finding · not a failure</p>
            <p className="mt-[5px] max-w-[94ch] text-[14px] leading-[1.5] text-ink"><strong className="font-semibold">{finding.sentence}</strong></p>
          </div>
          <div className="flex shrink-0 gap-px overflow-hidden rounded-lg border border-line-strong bg-line-strong">
            {finding.figures.map((figure) => (
              <div key={figure.label} className="bg-page px-3.5 py-[7px] text-center">
                <p className={`mono text-[19px] font-medium leading-[1.1] ${figure.emphasis ? 'text-serious' : figure.value === 0 ? 'text-ink-3' : 'text-ink'}`}>
                  {figure.value}
                </p>
                <p className="mono text-[10.5px] tracking-[0.1em] text-ink-3">{figure.label.toUpperCase()}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {paused && !finished ? (
        <div className="mono flex shrink-0 items-center gap-2 border-b border-warn/40 bg-warn/10 px-[18px] py-1.5 text-[10px] uppercase tracking-[0.08em] text-warn">
          <Breathe tone="var(--color-warn)" />
          Paused · every pending step is held exactly where it is
        </div>
      ) : null}

      {/* ── Body ────────────────────────────────────────────────────────── */}
      <div className="flex min-h-0 flex-1 flex-col lg:flex-row">

        {/* ── LEFT · the run, end to end ─────────────────────────────── */}
        <section className="flex min-h-0 flex-1 flex-col border-b border-line px-[18px] py-3.5 lg:border-b-0 lg:border-r">
          <header className="flex shrink-0 items-center gap-2.5">
            <h2 className="text-[14px] font-semibold tracking-[-0.015em] text-ink">The run, end to end</h2>
            <span className="mono text-[10px] text-ink-3">STATION {stationIndex + 1} OF {stations.length}</span>
            <div className="ml-auto flex items-center gap-0.5 rounded-md border border-line-strong p-0.5">
              <button
                type="button"
                onClick={() => { setPaused(true); setPinnedStation(Math.max(0, stationIndex - 1)) }}
                disabled={stationIndex === 0}
                aria-label="Previous station"
                className="mono rounded-[4px] px-2 py-[3px] text-[11px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
              >
                ◀
              </button>
              <button
                type="button"
                onClick={() => { if (paused) setPinnedStation(null); setPaused(!paused) }}
                className={`mono rounded-[4px] px-3 py-[3px] text-[10px] uppercase tracking-[0.1em] transition-colors ${
                  paused ? 'bg-accent text-on-accent' : 'text-ink-2 hover:text-ink'
                }`}
              >
                {paused ? 'Play' : 'Pause'}
              </button>
              <button
                type="button"
                onClick={() => { setPaused(true); setPinnedStation(Math.min(stations.length - 1, stationIndex + 1)) }}
                disabled={stationIndex >= stations.length - 1}
                aria-label="Next station"
                className="mono rounded-[4px] px-2 py-[3px] text-[11px] text-ink-3 transition-colors hover:text-ink disabled:opacity-40"
              >
                ▶
              </button>
            </div>
          </header>

          <NeuralStage
            stations={stations}
            buckets={buckets}
            lanes={liveLanes}
            rails={rails}
            selected={stationIndex}
            paused={paused}
            onSelect={(i) => { setPaused(true); setPinnedStation(i) }}
          />

          {/* What the selected station did, in one sentence. The live station
              speaks in the run's own words. */}
          <div className="mt-2 min-h-[44px] shrink-0 rounded-lg border border-line-strong bg-surface-2 px-3 py-[9px]">
            <p
              className="mono text-[10.5px] uppercase tracking-[0.13em]"
              style={{ color: STATION_TONE[stations[stationIndex]?.status ?? 'idle'] }}
            >
              {stations[stationIndex]?.tag === '01' || stations[stationIndex]?.tag === '02' || stations[stationIndex]?.tag === '03'
                ? stations[stationIndex]?.name.toUpperCase()
                : stations[stationIndex]?.tag}
              {' · '}
              {STATION_WORD[stations[stationIndex]?.status ?? 'idle']}
            </p>
            <p className="mt-[3px] text-[11.5px] leading-[1.5] text-ink-2">
              {stationIndex === autoStation && !finished ? runNarration : stations[stationIndex]?.caption}
            </p>
          </div>
        </section>

        {/* ── RIGHT · what it produced, and what you still owe ────────── */}
        {/*
          ONE SCROLLER IN THIS COLUMN, NOT TWO.

          This aside scrolled, and the feed section inside it scrolled as well.
          A `flex-1 overflow-y-auto` child only bounds itself when an ancestor
          gives it a height to fill; inside a scrolling parent it simply grows
          to its content instead, so the inner scroller never engaged and the
          aside moved the whole column — header, counts and feed together.

          That is why rows appeared sliced at the top and bottom: what looked
          like a clipped list was the outer scroller cutting through a list that
          had no viewport of its own.

          The aside owns the scroll. `scroll-pt-7` keeps the sticky "row by row"
          header from landing on top of whatever row was just scrolled to.
        */}
        <aside
          ref={feedRef}
          className="flex w-full shrink-0 scroll-pt-7 flex-col gap-3 overflow-y-auto px-[18px] py-3.5 lg:w-[470px]"
        >
          {filter ? (
            <button
              type="button"
              onClick={() => setFilter(null)}
              className="mono inline-flex shrink-0 items-center gap-1.5 self-start rounded-full border border-hud-strong bg-accent/12 px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] text-accent-bright transition-colors hover:border-accent"
            >
              Filtered · {filter} <X size={11} />
            </button>
          ) : null}

          {/* ── The buckets, named for what they actually are ────────── */}
          <section
            className="shrink-0 overflow-hidden rounded-[10px] border border-line-strong bg-surface"
            style={{ animation: 'eth-rise 520ms cubic-bezier(0.22, 1, 0.36, 1) 120ms both' }}
          >
            <header className="flex items-baseline gap-2 px-3.5 pb-2.5 pt-3">
              <h3 className="text-[13.5px] font-semibold tracking-[-0.015em] text-ink">
                {onRecordOnly ? 'On record' : 'This run'}
              </h3>
              <span className="mono text-[11px] text-ink-3">
                {/*
                  Scored where there is scoring; captured-but-unscored says so
                  in words rather than showing a zero that means "not yet".
                */}
                {verdictTotal > 0
                  ? `${verdictTotal} ${verdictTotal === 1 ? 'page' : 'pages'} scored`
                  : capturedTotal > 0
                    ? `${capturedTotal} captured · not scored yet`
                    : '0 pages'}
                {onRecordOnly ? ' · earlier run' : ''}
              </span>
            </header>
            {/* The four shares as one bar, each segment filling from the left. */}
            {verdictTotal > 0 ? (
              <div className="mx-3.5 mb-3 flex h-1.5 gap-0.5 overflow-hidden rounded-[3px]" aria-hidden="true">
                {BUCKET_META.map((meta, i) => {
                  const count = buckets.find((b) => b.id === meta.id)?.count ?? 0
                  return count > 0 ? (
                    <span
                      key={meta.id}
                      className="block origin-left"
                      style={{ flex: count, background: meta.tone, animation: `eth-seg 720ms cubic-bezier(0.16, 1, 0.3, 1) ${260 + i * 110}ms both` }}
                    />
                  ) : null
                })}
              </div>
            ) : null}
            <div className="flex flex-col">
              {BUCKET_META.map((meta, i) => {
                const count = buckets.find((b) => b.id === meta.id)?.count ?? 0
                const share = verdictTotal === 0 ? 0 : Math.round((count / verdictTotal) * 100)
                const yours = meta.id === 'needs_review' && count > 0
                return (
                  <button
                    key={meta.id}
                    type="button"
                    onClick={() => setFilter(filter === meta.id ? null : meta.id)}
                    disabled={count === 0}
                    className={`flex items-center gap-2.5 border-t border-line px-3.5 py-2 text-left transition-colors first:border-t-0 ${
                      count === 0 ? 'opacity-55' : 'hover:bg-surface-2'
                    } ${filter === meta.id ? 'bg-accent/8' : ''}`}
                  >
                    {yours ? <Breathe tone={meta.tone} /> : (
                      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: count > 0 ? meta.tone : 'var(--color-line-strong)' }} aria-hidden="true" />
                    )}
                    <span className="text-[12px] text-ink-2">{meta.label}</span>
                    {yours ? (
                      <span className="mono rounded-[3px] border border-warn/50 px-1.5 py-px text-[10px] uppercase tracking-[0.08em] text-warn">Yours</span>
                    ) : null}
                    <span className="ml-auto block h-[3px] w-16 overflow-hidden rounded-[2px] bg-surface-3">
                      <span
                        className="block h-full"
                        style={{ width: `${share}%`, background: meta.tone, transformOrigin: 'left', animation: `eth-seg 620ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 80}ms both` }}
                      />
                    </span>
                    <span
                      className="mono w-7 shrink-0 text-right text-[14px]"
                      style={{ color: count > 0 ? meta.tone : 'var(--color-ink-3)', animation: `eth-num-in 420ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 60}ms both` }}
                    >
                      {count}
                    </span>
                    <span className="mono w-8 shrink-0 text-right text-[11px] text-ink-3">{share}%</span>
                  </button>
                )
              })}
            </div>
          </section>

          {/* ── The ones only a person can clear ─────────────────────── */}
          {outstanding.length > 0 ? (
            <section
              className="shrink-0 overflow-hidden rounded-[10px] border border-warn/55 bg-surface"
              style={{ animation: 'eth-rise 560ms cubic-bezier(0.22, 1, 0.36, 1) 320ms both' }}
            >
              <header className="flex items-center gap-2 border-b border-warn/35 px-3.5 py-2.5">
                <Breathe tone="var(--color-warn)" />
                <h3 className="text-[13.5px] font-semibold tracking-[-0.015em] text-ink">
                  {outstanding.length} still need{outstanding.length === 1 ? 's' : ''} a verdict from you
                </h3>
              </header>
              <ul className="flex flex-col">
                {outstanding.slice(0, 6).map((row) =>
                  row.kind === 'verdict' ? (
                    <li key={row.id} className="border-t border-line px-3.5 py-2.5 first:border-t-0">
                      <div className="flex items-center gap-2">
                        <span className="mono rounded-[3px] bg-warn/12 px-1.5 py-px text-[10px] uppercase tracking-[0.08em] text-warn">Needs review</span>
                        {row.onRecord ? (
                          <span className="mono text-[10.5px] uppercase tracking-[0.08em] text-ink-3">captured {row.onRecord}</span>
                        ) : null}
                      </div>
                      <p className="mt-1.5 text-[12.5px] font-medium leading-[1.4] text-ink">{row.title}</p>
                      {row.reason || row.evidence ? (
                        <div className="mt-[7px] border-l border-serious/60 pl-[9px]">
                          {row.reason ? <p className="text-[11.5px] leading-[1.5] text-ink-2">{row.reason}</p> : null}
                          {row.evidence ? <p className="mono mt-1 text-[11px] text-ink-3">{row.evidence}</p> : null}
                        </div>
                      ) : null}
                      <div className="mt-2 flex items-center gap-2">
                        <Btn variant="primary" onClick={() => resolveInline(row.entityId, 'validated')}>Validate</Btn>
                        <Btn variant="ghost" onClick={() => resolveInline(row.entityId, 'rejected')}>Reject</Btn>
                      </div>
                    </li>
                  ) : null,
                )}
              </ul>
            </section>
          ) : null}

          {/*
            "What would change the outcome" lived here.
            Removed on request: the run console's job is to report what the run
            did, and a panel of settings advice sat between the verdict counts
            and the row-by-row feed — the two things an operator is actually
            reading. The knobs themselves are unchanged and still live in Agent
            Studio, where they can be changed rather than merely suggested.
          */}

          {/* ── The feed: every row the run reported, in order ───────── */}
          {/* Not a scroller — the aside is. `pb-6` keeps the final row clear of
              the column's bottom edge instead of flush against it. */}
          <section className="flex flex-col gap-1.5 pb-6">
            {/*
              OPAQUE, AND AS WIDE AS THE COLUMN.

              This was `bg-page/95` at the section's own width. Two gaps let
              rows show through as they passed: the 5% transparency, and the
              column's 18px side padding, which the header did not cover — so a
              row scrolling underneath stayed visible down both edges and read
              as overlapping the heading.

              Negative margins pull it out to the column's full bleed and the
              padding puts the text back where it was. Opaque ground, and a hair
              more vertical padding so a row's rounded border cannot peek above
              the cap line.
            */}
            <p className="mono sticky top-0 z-10 -mx-[18px] border-b border-line/60 bg-page px-[18px] pb-1.5 pt-2 text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
              The run, row by row
            </p>
            {paged.map((row) => (
              <FeedItem key={row.id} row={row} resolved={resolved} onResolve={resolveInline} />
            ))}

            {/* The pager states the range it is showing, not just the page
                number — "41–60 of 317" answers where you are; "page 3" does
                not. Hidden entirely when everything fits on one page. */}
            {pageCount > 1 ? (
              <div className="mt-1 flex items-center justify-between gap-2 border-t border-line pt-2">
                <button
                  type="button"
                  disabled={page <= 1}
                  onClick={() => setFeedPage(Math.max(1, page - 1))}
                  className="mono rounded-[6px] border border-line-strong px-2 py-1 text-[10.5px] uppercase tracking-[0.1em] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-ink-2"
                >
                  Newer
                </button>
                <span className="mono tabular text-[10.5px] uppercase tracking-[0.1em] text-ink-3">
                  {(page - 1) * FEED_PAGE + 1}–{Math.min(page * FEED_PAGE, filtered.length)} of{' '}
                  {filtered.length}
                </span>
                <button
                  type="button"
                  disabled={page >= pageCount}
                  onClick={() => setFeedPage(Math.min(pageCount, page + 1))}
                  className="mono rounded-[6px] border border-line-strong px-2 py-1 text-[10.5px] uppercase tracking-[0.1em] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-ink-2"
                >
                  Older
                </button>
              </div>
            ) : null}
          </section>
        </aside>
      </div>

      {/* ── Footer ──────────────────────────────────────────────────────── */}
      <footer className="shrink-0 border-t border-line bg-surface px-5 py-2.5">
        <RunBar progress={progress} stage={stage} paused={paused} />
        <div className="mono mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] uppercase tracking-[0.08em] text-ink-3">
          <span className="text-ink-2">{progress}%</span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="text-ink-2">{rows.filter((r) => r.kind === 'capture').length}</span> captured
          </span>
          <span aria-hidden="true">·</span>
          <span>
            <span className="text-ink-2">{scoredNow}</span> scored
          </span>
          {verdictTotal > scoredNow ? (
            <>
              <span aria-hidden="true">·</span>
              <span><span className="text-ink-2">{verdictTotal - scoredNow}</span> on record</span>
            </>
          ) : null}
          <span aria-hidden="true">·</span>
          <span className={(buckets.find((b) => b.id === 'needs_review')?.count ?? 0) > 0 ? 'text-warn' : undefined}>
            <span className={(buckets.find((b) => b.id === 'needs_review')?.count ?? 0) > 0 ? '' : 'text-ink-2'}>
              {buckets.find((b) => b.id === 'needs_review')?.count ?? 0}
            </span>{' '}
            for review
          </span>
          {finished && runSummary ? (
            <>
              <span aria-hidden="true">·</span>
              {/* The server's own tally, under the names of what it counts:
                  pages that reached scoring, and the scoring stage's duplicate
                  bucket — not captures, and not the prefilter's holds. */}
              <span className="text-ink-2">
                server tally · {runSummary.postsScraped ?? 0} reached scoring · {runSummary.duplicate ?? 0} duplicate at scoring ·{' '}
                {runSummary.trending ?? 0} trending · {runSummary.ideas ?? 0} ideas placed
              </span>
            </>
          ) : null}
          <span className="ml-auto rounded-[3px] border border-line px-1.5 py-px">space · pause</span>
        </div>
      </footer>

      {/* ── The completion report ──────────────────────────────────────────
          A run ends with a verdict, and a verdict deserves the screen. This
          used to be the last card in a 470px column: an operator finished a
          run and then had to scroll a feed to find out what it had produced,
          with the way through to the calendar below that again.

          It is a real dialog now — `role="dialog"` and `aria-modal`, Escape to
          dismiss, and `data-overlay` so `overscroll-behavior: contain` applies
          here and a scroll inside it cannot chain out to the page behind.
          Dismissing leaves the run console exactly as it was, so nothing is
          lost by closing it.
      */}
      {finished && reportOpen ? (
        <div
          data-overlay
          className="fixed inset-0 z-50 flex items-center justify-center overflow-y-auto bg-[rgba(4,6,12,0.72)] p-4 backdrop-blur-sm sm:p-8"
          style={{ animation: 'eth-fade 200ms ease both' }}
          onClick={(event) => { if (event.target === event.currentTarget) setReportOpen(false) }}
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-label="Pipeline run complete"
            className="w-full max-w-[880px]"
          >
            <RunReport
              captures={rows.filter((r): r is Extract<FeedRow, { kind: 'capture' }> => r.kind === 'capture')}
              /*
               * Where each TOPIC can be read about, as opposed to where a single
               * captured page lives. The badge names an Ethara research topic and
               * was the only thing on the row with no way through — the title
               * links to one article, which is not the same question as "what is
               * this topic and what else is in it".
               */
              topicUrls={
                new Map(
                  signals
                    .map((sig) => [sig.term, sig.top_post_url ?? sig.search_url ?? ''] as const)
                    .filter(([, url]) => url !== ''),
                )
              }
              trending={trending.map((t) => ({ term: t.term, score: t.trend_score, rank: t.rank ?? 0 }))}
              topHashtags={topHashtags.map((h) => ({ tag: h.display_tag, score: h.hashtag_score }))}
              buckets={buckets}
              newTrendIdeas={newTrendIdeas.map((i) => ({
                id: i.id,
                title: i.title,
                platform: i.platform,
                slot: i.calendar_slot,
                rank: i.platform_rank,
              }))}
              summary={runSummary}
              onNavigate={leaveFor}
              onClose={() => setReportOpen(false)}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE STAGE

   Five stations on a rail, in depth. Depth comes from position and scale,
   never skew; the camera breathes over 84 seconds and nothing else about the
   scene moves unless a process is moving. Packets ride a rail only while
   work is crossing it. The gate marker sits on the rail where every packet
   was turned back.
   ═══════════════════════════════════════════════════════════════════════════ */

type StationStatus = 'idle' | 'working' | 'done' | 'attention' | 'record'
type RailKind = 'idle' | 'working' | 'done' | 'held'

interface Station {
  id: string
  /** The small mono tag: SOURCE, 01, 02, ON RECORD, 03. */
  tag: string
  name: string
  sub: string
  /** The one figure this station produced, in its own colour. */
  figure: string
  caption: string
  status: StationStatus
}

const STATION_TONE: Record<StationStatus, string> = {
  idle: 'var(--color-ink-3)',
  working: 'var(--color-accent-bright)',
  done: 'var(--color-good)',
  attention: 'var(--color-serious)',
  record: 'var(--color-ink-3)',
}
const STATION_WORD: Record<StationStatus, string> = {
  idle: 'NOT REACHED',
  working: 'WORKING',
  done: 'SETTLED',
  attention: 'HELD AT THE GATE',
  record: 'ON RECORD',
}
/* ═══════════════════════════════════════════════════════════════════════════
   THE NEURAL VIEW — GEOMETRY

   The run drawn the way it actually behaves: the keyword lanes fan IN to the
   Scraping Agent, one trunk carries the kept pages to the Validation Agent,
   and the Validation Agent BIFURCATES into the four verdict buckets. Only the
   validated branch continues to the Calendar Agent.

   Every coordinate is the design's own, inside a fixed stage that is then
   scaled to whatever frame it is handed. Scaling the whole composition —
   rather than leaving fixed-size cards adrift in a large frame — is what keeps
   it tight instead of stranding it in the middle of an empty floor, which is
   exactly how the previous station strip failed.
   ═══════════════════════════════════════════════════════════════════════════ */

const NEURAL_W = 1310
const NEURAL_H = 654

/** A keyword card and the point its synapse leaves from. */
const KEYWORD_SLOT = [
  { top: 158, out: [188, 190] as const },
  { top: 268, out: [188, 300] as const },
  { top: 378, out: [188, 410] as const },
]
/** Which slots one, two or three keyword cards occupy, so the fan stays even. */
const KEYWORD_LAYOUT: Record<number, number[]> = { 0: [], 1: [1], 2: [0, 2], 3: [0, 1, 2] }

const SCRAPE_IN = [262, 300] as const
const SCRAPE_OUT = [452, 300] as const
const VALIDATE_IN = [556, 300] as const
const VALIDATE_OUT = [762, 300] as const

/** A verdict bucket and the point its synapse arrives at. */
const BUCKET_SLOT = [
  { top: 108, into: [886, 140] as const },
  { top: 218, into: [886, 250] as const },
  { top: 328, into: [886, 360] as const },
  { top: 438, into: [886, 470] as const },
]
const VALIDATED_OUT = [1086, 140] as const
const CALENDAR_IN = [1126, 140] as const

/** The token each verdict is drawn in. Canvas cannot read `var()`, so the
    colour is resolved from the token through a probe and re-read on theme
    change — the palette still lives in one place. */
const BUCKET_TOKEN: Record<ValidationVerdict, string> = {
  validated: '--color-good',
  needs_review: '--color-warn',
  duplicate: '--color-accent',
  rejected: '--color-critical',
  pending: '--color-line-strong',
}
/** What each bucket means for the operator, in the design's own words. */
const BUCKET_NOTE: Record<ValidationVerdict, string> = {
  validated: 'QUEUED FOR CALENDAR',
  needs_review: 'WAITING ON YOU',
  duplicate: 'MERGED WITH EXISTING',
  rejected: 'BELOW THRESHOLD',
  pending: 'AWAITING A VERDICT',
}

const NEURAL_TOKENS = [
  '--color-accent',
  '--color-accent-bright',
  '--color-good',
  '--color-warn',
  '--color-critical',
  '--color-line-strong',
]

type RGB = [number, number, number]

/** A computed `color` is always `rgb(...)`, so this only guards a parse failure.
    The fallback is a neutral grey, never a brand colour standing in for one. */
function parseRGB(value: string): RGB {
  const parts = value.match(/[\d.]+/g)
  if (!parts || parts.length < 3) return [140, 140, 150]
  return [Number(parts[0]), Number(parts[1]), Number(parts[2])]
}

function formatSeconds(total: number): string {
  const m = Math.floor(total / 60)
  const s = total % 60
  return m > 0 ? `${m}m ${String(s).padStart(2, '0')}s` : `${s}s`
}

function NeuralStage({
  stations,
  buckets,
  lanes,
  rails,
  selected,
  paused,
  onSelect,
}: {
  stations: Station[]
  buckets: GraphBucket[]
  lanes: LiveLane[]
  rails: RailKind[]
  selected: number
  paused: boolean
  onSelect: (index: number) => void
}) {
  const reduced = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
  const frameRef = useRef<HTMLDivElement | null>(null)
  const canvasRef = useRef<HTMLCanvasElement | null>(null)
  const [scale, setScale] = useState(1)

  /* The stage is a fixed drawing; the frame decides how big it is shown. */
  useEffect(() => {
    const el = frameRef.current
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const rect = entries[0]?.contentRect
      if (!rect || rect.width === 0) return
      setScale(Math.min(rect.width / NEURAL_W, rect.height / NEURAL_H))
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  /* One card per keyword actually crawled, heaviest first. A replay opens no
     lanes, so it falls back to the single source card the run recorded. */
  const keywordCards = useMemo(() => {
    const byKeyword = new Map<string, { kept: number; lanes: number; running: boolean }>()
    for (const lane of lanes) {
      const entry = byKeyword.get(lane.keyword) ?? { kept: 0, lanes: 0, running: false }
      entry.kept += lane.kept ?? 0
      entry.lanes += 1
      entry.running = entry.running || lane.status === 'running'
      byKeyword.set(lane.keyword, entry)
    }
    return [...byKeyword.entries()]
      .sort((a, b) => b[1].kept - a[1].kept)
      .slice(0, 3)
      .map(([keyword, value]) => ({ keyword, ...value }))
  }, [lanes])

  const source = stations[0]
  const sourceCards = keywordCards.length > 0
    ? keywordCards
    : source
      ? [{ keyword: source.name, kept: 0, lanes: 0, running: false, fallback: true }]
      : []
  const slots = KEYWORD_LAYOUT[Math.min(sourceCards.length, 3)] ?? []

  /** Verdicts counted at all. Zero means not measured, so the buckets read "—". */
  const verdictTotal = buckets.reduce((total, bucket) => total + bucket.count, 0)

  /* The draw loop reads live values through refs, so changing the run does not
     tear down and restart the animation. */
  const frozen = useRef(paused || reduced)
  useEffect(() => { frozen.current = paused || reduced }, [paused, reduced])

  const sceneRef = useRef({ slots, buckets, rails, verdictTotal })
  useEffect(() => { sceneRef.current = { slots, buckets, rails, verdictTotal } })

  const paletteRef = useRef<Record<string, RGB>>({})
  useEffect(() => {
    const frame = frameRef.current
    if (!frame) return
    const probe = document.createElement('span')
    probe.setAttribute('aria-hidden', 'true')
    probe.style.cssText = 'position:absolute;width:0;height:0;opacity:0;pointer-events:none'
    frame.appendChild(probe)
    const read = () => {
      const next: Record<string, RGB> = {}
      for (const token of NEURAL_TOKENS) {
        probe.style.color = `var(${token})`
        next[token] = parseRGB(getComputedStyle(probe).color)
      }
      paletteRef.current = next
    }
    read()
    const observer = new MutationObserver(read)
    observer.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => { observer.disconnect(); probe.remove() }
  }, [])

  useEffect(() => {
    const canvas = canvasRef.current
    const ctx = canvas?.getContext('2d')
    if (!canvas || !ctx) return
    let raf = 0
    let last = 0
    let clock = 0

    const rgba = (c: RGB, a: number) => `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${a})`
    const tone = (token: string): RGB => paletteRef.current[token] ?? [140, 140, 150]
    const curve = (a: readonly number[], b: readonly number[]) => [
      a,
      [a[0] + (b[0] - a[0]) * 0.45, a[1]],
      [a[0] + (b[0] - a[0]) * 0.55, b[1]],
      b,
    ] as const
    const at = (c: ReturnType<typeof curve>, u: number) => {
      const v = 1 - u
      return [
        v * v * v * c[0][0] + 3 * v * v * u * c[1][0] + 3 * v * u * u * c[2][0] + u * u * u * c[3][0],
        v * v * v * c[0][1] + 3 * v * v * u * c[1][1] + 3 * v * u * u * c[2][1] + u * u * u * c[3][1],
      ]
    }

    /** One synapse. `alive` decides whether anything is actually travelling it. */
    const flow = (a: readonly number[], b: readonly number[], colour: RGB, pulses: number, speed: number, alive: boolean) => {
      const c = curve(a, b)
      ctx.beginPath()
      ctx.moveTo(c[0][0], c[0][1])
      ctx.bezierCurveTo(c[1][0], c[1][1], c[2][0], c[2][1], c[3][0], c[3][1])
      ctx.strokeStyle = rgba(colour, 0.1)
      ctx.lineWidth = 3.5
      ctx.stroke()
      ctx.strokeStyle = rgba(colour, alive ? 0.5 : 0.2)
      ctx.lineWidth = 1.3
      ctx.stroke()
      if (!alive) return
      for (let k = 0; k < pulses; k++) {
        const u = (clock * speed + k / pulses + a[1] * 0.013) % 1
        const point = at(c, u)
        const glow = ctx.createRadialGradient(point[0], point[1], 0, point[0], point[1], 6.5)
        glow.addColorStop(0, rgba(colour, 0.9))
        glow.addColorStop(1, rgba(colour, 0))
        ctx.fillStyle = glow
        ctx.beginPath()
        ctx.arc(point[0], point[1], 6.5, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    const draw = (ts: number) => {
      raf = requestAnimationFrame(draw)
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      if (canvas.width !== Math.round(NEURAL_W * dpr)) {
        canvas.width = Math.round(NEURAL_W * dpr)
        canvas.height = Math.round(NEURAL_H * dpr)
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      ctx.clearRect(0, 0, NEURAL_W, NEURAL_H)
      const delta = last ? Math.min((ts - last) / 1000, 0.05) : 0.016
      last = ts
      if (!frozen.current) clock += delta

      const scene = sceneRef.current
      const accent = tone('--color-accent')
      const bright = tone('--color-accent-bright')
      const grid = tone('--color-accent')

      /* The floor, in perspective. It is meant to be felt rather than read —
         at line-strength it competed with the synapses for attention. */
      ctx.strokeStyle = rgba(grid, 0.16)
      ctx.lineWidth = 1
      for (let i = 0; i < 9; i++) {
        const y = NEURAL_H * 0.66 + i * i * 4.2
        ctx.beginPath()
        ctx.moveTo(0, y)
        ctx.lineTo(NEURAL_W, y)
        ctx.stroke()
      }
      for (let i = 0; i <= 12; i++) {
        const x = (i / 12) * NEURAL_W
        ctx.beginPath()
        ctx.moveTo(NEURAL_W / 2 + (x - NEURAL_W / 2) * 0.55, NEURAL_H * 0.66)
        ctx.lineTo(x, NEURAL_H)
        ctx.stroke()
      }

      /* light where the two agents meet */
      const pool = ctx.createRadialGradient(659, 300, 0, 659, 300, 140)
      pool.addColorStop(0, rgba(accent, 0.1))
      pool.addColorStop(1, rgba(accent, 0))
      ctx.fillStyle = pool
      ctx.fillRect(509, 150, 300, 300)

      /* keyword lanes fan in */
      const scraping = scene.rails[0] === 'working'
      for (const slot of scene.slots) {
        const anchor = KEYWORD_SLOT[slot]
        if (anchor) flow(anchor.out, SCRAPE_IN, accent, 2, 0.3, scraping)
      }
      /* the hand-off */
      flow(SCRAPE_OUT, VALIDATE_IN, accent, 3, 0.34, scene.rails[1] === 'working')
      /* and the bifurcation, each branch in its verdict's colour */
      scene.buckets.forEach((bucket, i) => {
        const anchor = BUCKET_SLOT[i]
        if (!anchor) return
        flow(VALIDATE_OUT, anchor.into, tone(BUCKET_TOKEN[bucket.id]), 2, 0.28, bucket.count > 0)
      })
      /* only what validated continues */
      flow(VALIDATED_OUT, CALENDAR_IN, tone('--color-good'), 2, 0.3, scene.rails[3] !== 'idle')

      ctx.fillStyle = rgba(bright, 0.6)
      for (const point of [SCRAPE_IN, VALIDATE_IN, CALENDAR_IN, ...scene.slots.map((s) => KEYWORD_SLOT[s]?.out), ...BUCKET_SLOT.map((s) => s.into)]) {
        if (!point) continue
        ctx.beginPath()
        ctx.arc(point[0], point[1], 2.2, 0, Math.PI * 2)
        ctx.fill()
      }
    }

    raf = requestAnimationFrame(draw)
    return () => cancelAnimationFrame(raf)
  }, [])

  const card = 'glass-panel absolute rounded-[12px] text-left outline-none transition-[border-color,box-shadow] duration-200'
  const agentCard = (index: number) =>
    `${card} rounded-[14px] px-[13px] py-[11px] ${selected === index ? 'border-accent' : 'hover:border-accent'}`

  const scraping = stations[1]
  const validation = stations[2]
  const calendar = stations[4]

  return (
    <div ref={frameRef} className="relative mt-2 min-h-0 flex-1 overflow-hidden rounded-[10px]">
      <div
        className="absolute left-1/2 top-1/2"
        style={{ width: NEURAL_W, height: NEURAL_H, transform: `translate(-50%, -50%) scale(${scale})` }}
      >
        <canvas ref={canvasRef} className="absolute inset-0 block h-full w-full" aria-hidden="true" />

        {/* ── the keywords that opened the run ─────────────────────────── */}
        {sourceCards.map((entry, i) => {
          const slot = KEYWORD_SLOT[slots[i] ?? i]
          if (!slot) return null
          const measured = !('fallback' in entry)
          return (
            <button
              key={entry.keyword}
              type="button"
              onClick={() => onSelect(0)}
              aria-label={`${entry.keyword} · ${measured ? `${entry.kept} kept` : source?.figure ?? 'on record'}`}
              className={`${card} px-3 py-[9px] ${selected === 0 ? 'border-accent' : 'hover:border-accent'}`}
              style={{ left: 20, top: slot.top, width: 168, borderTopWidth: 2, borderTopColor: 'var(--color-good)' }}
            >
              <span className="flex items-center">
                <span className="mono text-[8.5px] tracking-[0.14em]" style={{ color: 'var(--color-good)' }}>
                  {measured ? `KEYWORD ${String(i + 1).padStart(2, '0')}` : 'SOURCE'}
                </span>
                <span className="ml-auto h-[5px] w-[5px] rounded-full" style={{ background: 'var(--color-good)' }} aria-hidden="true" />
              </span>
              <span className="mt-[5px] block truncate text-[13px] font-bold text-ink">{entry.keyword}</span>
              <span className="mono mt-[3px] block truncate text-[8.5px] text-ink-3">
                {measured ? `${entry.kept} KEPT · ${entry.lanes} LANE${entry.lanes === 1 ? '' : 'S'}` : (source?.figure ?? '').toUpperCase()}
              </span>
            </button>
          )
        })}

        {/* ── 01 · the Scraping Agent ──────────────────────────────────── */}
        {scraping ? (
          <button
            type="button"
            onClick={() => onSelect(1)}
            aria-label={`${scraping.name} · ${scraping.figure}`}
            className={agentCard(1)}
            style={{
              left: 262,
              top: 249,
              width: 190,
              boxShadow: selected === 1 ? '0 0 34px -8px var(--color-accent)' : undefined,
            }}
          >
            <span className="flex items-center gap-1.5">
              <span className="mono text-[8px] tracking-[0.18em] text-ink-3">{scraping.tag}</span>
              <span className="ml-auto flex h-3 w-3 items-center justify-center">
                {scraping.status === 'working' && !paused ? (
                  <WorkArc size={12} />
                ) : (
                  <span className="h-[5px] w-[5px] rounded-full" style={{ background: STATION_TONE[scraping.status] }} aria-hidden="true" />
                )}
              </span>
            </span>
            <span className="mt-[5px] block text-[15px] font-bold text-ink">{scraping.name}</span>
            <span className="mt-0.5 block text-[9.5px] text-ink-3">{scraping.sub}</span>
            <span className="mono mt-[7px] block truncate text-[8.5px]" style={{ color: STATION_TONE[scraping.status] }}>
              {scraping.figure}
            </span>
          </button>
        ) : null}

        {/* ── 02 · the Validation Agent, where the run bifurcates ──────── */}
        {validation ? (
          <button
            type="button"
            onClick={() => onSelect(2)}
            aria-label={`${validation.name} · ${validation.figure}`}
            className={agentCard(2)}
            style={{
              left: 556,
              top: 236,
              width: 206,
              boxShadow: selected === 2 ? '0 0 34px -8px var(--color-accent)' : undefined,
            }}
          >
            <span className="flex items-center gap-1.5">
              <span className="mono text-[8px] tracking-[0.18em] text-ink-3">{validation.tag}</span>
              <span className="ml-auto flex h-3 w-3 items-center justify-center">
                {validation.status === 'working' && !paused ? (
                  <WorkArc size={12} />
                ) : validation.status === 'attention' ? (
                  <Breathe tone={STATION_TONE[validation.status]} />
                ) : (
                  <span className="h-[5px] w-[5px] rounded-full" style={{ background: STATION_TONE[validation.status] }} aria-hidden="true" />
                )}
              </span>
            </span>
            <span className="mt-[5px] block text-[15px] font-bold text-ink">{validation.name}</span>
            <span className="mt-0.5 block text-[9.5px] text-ink-3">{validation.sub}</span>
            <span className="mono mt-[7px] block truncate text-[8.5px]" style={{ color: STATION_TONE[validation.status] }}>
              {validation.figure}
            </span>
            <span className="mono mt-[6px] block border-t border-line pt-[6px] text-[8px] text-ink-3">
              bifurcates by verdict class
            </span>
          </button>
        ) : null}

        {/* ── the four verdicts ────────────────────────────────────────── */}
        {buckets.map((bucket, i) => {
          const slot = BUCKET_SLOT[i]
          if (!slot) return null
          return (
            <button
              key={bucket.id}
              type="button"
              onClick={() => onSelect(3)}
              aria-label={`${bucket.label} · ${verdictTotal === 0 ? 'not measured' : bucket.count}`}
              className={`${card} px-3 py-[9px] ${selected === 3 ? 'border-accent' : 'hover:border-accent'}`}
              style={{ left: 886, top: slot.top, width: 200, borderLeftWidth: 2, borderLeftColor: bucket.tone }}
            >
              <span className="flex items-center gap-1.5">
                <span className="mono text-[7.5px] tracking-[0.14em]" style={{ color: bucket.tone }}>
                  {bucket.label.toUpperCase()}
                </span>
                <span className="tabular ml-auto text-[14px] font-bold text-ink">
                  {verdictTotal === 0 ? '—' : bucket.count}
                </span>
              </span>
              <span className="mono mt-1 block text-[8px] text-ink-3">{BUCKET_NOTE[bucket.id]}</span>
            </button>
          )
        })}

        {/* ── what happens after this theater ──────────────────────────── */}
        <span className="mono absolute text-[8px] tracking-[0.18em] text-ink-3" style={{ left: 1126, top: 56 }} aria-hidden="true">
          THEN → CREATE
        </span>
        {calendar ? (
          <button
            type="button"
            onClick={() => onSelect(4)}
            aria-label={`${calendar.name} · ${calendar.figure}`}
            className={`${card} rounded-[14px] px-[13px] py-[11px] ${selected === 4 ? 'border-accent' : 'hover:border-accent'}`}
            style={{ left: 1126, top: 83, width: 160 }}
          >
            <span className="flex items-center gap-1.5">
              <span className="mono text-[8px] tracking-[0.18em] text-ink-3">{calendar.tag}</span>
              <span className="ml-auto h-[5px] w-[5px] rounded-full" style={{ background: STATION_TONE[calendar.status] }} aria-hidden="true" />
            </span>
            <span className="mt-[5px] block text-[15px] font-bold text-ink">{calendar.name}</span>
            <span className="mt-0.5 block text-[9.5px] text-ink-3">{calendar.sub}</span>
            <span className="mono mt-[7px] block truncate text-[8.5px]" style={{ color: STATION_TONE[calendar.status] }}>
              {calendar.figure}
            </span>
          </button>
        ) : null}

        {/* ── what the drawing means ───────────────────────────────────── */}
        <div
          className="mono absolute flex items-center gap-3.5 text-[8px] tracking-[0.08em] text-ink-3"
          style={{ left: 20, bottom: 10 }}
          aria-hidden="true"
        >
          <span className="flex items-center gap-1.5">
            <span className="h-[2px] w-3.5 rounded-[2px]" style={{ background: 'var(--color-accent-bright)' }} />
            SYNAPSE · PULSES = ITEMS IN FLIGHT
          </span>
          {buckets.map((bucket) => (
            <span key={bucket.id} className="flex items-center gap-1.5">
              <span className="h-[7px] w-[7px] rounded-full" style={{ background: bucket.tone }} />
              {bucket.label.toUpperCase()}
            </span>
          ))}
        </div>
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE MOTION VOCABULARY

   Four of the eight named motions appear on this screen, and each means
   exactly one thing: an agent is working (work arc), information is moving
   (signal travel), a decision landed (commit), a human is required (attention
   breathe). Nothing else on this screen loops.
   ═══════════════════════════════════════════════════════════════════════════ */

/** An agent is working. The only looping motion allowed on a busy agent. */
function WorkArc({ size = 13 }: { size?: number }) {
  return (
    <span
      className="block shrink-0 rounded-full border-[1.5px] border-accent border-t-transparent"
      style={{ width: size, height: size, animation: 'eth-work-arc 1.5s linear infinite' }}
      aria-hidden="true"
    />
  )
}

/** A decision landed. One stroke, drawn once, never looped. */
function Commit({ size = 12, tone = 'currentColor' }: { size?: number; tone?: string }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" className="shrink-0" aria-hidden="true">
      <path
        d="M4 12.5 L9.5 18 L20 6"
        stroke={tone}
        strokeWidth="2.8"
        strokeLinecap="round"
        strokeLinejoin="round"
        style={{ strokeDasharray: 26, animation: 'eth-commit-check 420ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
      />
    </svg>
  )
}

/** A human is required here. */
function Breathe({ tone }: { tone: string }) {
  return (
    <span
      className="block h-1.5 w-1.5 shrink-0 rounded-full"
      style={{ background: tone, animation: 'eth-attention-breathe 2.6s var(--ease-in-out-soft) infinite' }}
      aria-hidden="true"
    />
  )
}

/**
 * The run, as two phases rather than one number.
 *
 * A single bar hid the fact that the first 45% is Sherlock capturing and the
 * rest is Dexter scoring — so a bar sitting at 40% read as "nearly half done"
 * when no page had been scored at all. Each phase fills on its own, and the
 * signal rides only the phase that is actually carrying work.
 */
function RunBar({ progress, stage, paused }: { progress: number; stage: 'scrape' | 'validate' | 'done'; paused: boolean }) {
  const scrapePct = stage === 'scrape' ? progress : 100
  const validatePct = stage === 'scrape' ? 0 : stage === 'done' ? 100 : progress
  const phases = [
    { id: 'scrape', label: 'Capture', basis: 45, pct: scrapePct, live: stage === 'scrape' },
    { id: 'validate', label: 'Score', basis: 55, pct: validatePct, live: stage === 'validate' },
  ]
  return (
    <div className="flex items-center gap-1">
      {phases.map((phase) => (
        <span
          key={phase.id}
          className="relative block h-1.5 overflow-hidden rounded-[3px] bg-surface-3"
          style={{ flexGrow: phase.basis, flexBasis: 0 }}
          title={`${phase.label} · ${Math.round(phase.pct)}%`}
        >
          <span
            className="absolute inset-y-0 left-0 rounded-[3px] bg-accent"
            style={{ width: `${Math.max(0, Math.min(100, phase.pct))}%`, transition: 'width 420ms cubic-bezier(0.16, 1, 0.3, 1)' }}
          />
          {phase.live && !paused ? (
            <span
              className="absolute top-1/2 h-[3px] w-[3px] -translate-y-1/2 rounded-full bg-accent-bright"
              style={{ animation: 'eth-signal 1.8s linear infinite' }}
            />
          ) : null}
        </span>
      ))}
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
  // New data arrived: every row enters with the same motion, so the feed reads
  // as one stream rather than five kinds of thing appearing five ways.
  const enter = { animation: 'eth-row-stream 420ms cubic-bezier(0.16, 1, 0.3, 1) both' }

  if (row.kind === 'note') {
    return (
      <div
        style={enter}
        className={`rounded-[10px] border px-3 py-2 text-[11.5px] leading-relaxed ${
          row.tone === 'warn' ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line-strong bg-surface-2 text-ink-2'
        }`}
      >
        {row.text}
      </div>
    )
  }

  /* ── A lane: one keyword being read on one platform ──────────────────── */
  if (row.kind === 'lane') {
    const laneLabel = row.platform === 'open-web' ? 'Open web' : row.platform
    const tone =
      row.status === 'warn'
        ? 'border-warn/40 bg-warn/8'
        : row.status === 'running'
          ? 'border-hud-strong bg-accent/8'
          : 'border-line-strong'
    return (
      <div style={enter} className={`flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-1.5 ${tone}`}>
        <span className="flex h-[13px] w-[13px] shrink-0 items-center justify-center">
          {row.status === 'running' ? (
            <WorkArc size={13} />
          ) : row.status === 'warn' ? (
            <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" />
          ) : (
            <span className="text-good-ink">
              <Commit size={13} />
            </span>
          )}
        </span>
        <span className="mono shrink-0 rounded-[3px] border border-line px-1.5 py-px text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
          {laneLabel}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2">{row.keyword}</span>
        {row.status === 'running' ? (
          <span className="mono text-[11px] uppercase tracking-[0.08em] text-accent-bright">capturing</span>
        ) : row.status === 'warn' ? (
          <span className="mono truncate text-[11px] uppercase tracking-[0.08em] text-warn" title={row.reason ?? undefined}>
            nothing captured{row.reason === null ? '' : ` · ${row.reason}`}
          </span>
        ) : (
          <span className="mono text-[10px] text-ink-3">
            <span className="text-ink-2">{row.kept ?? 0}</span> kept
            {row.captured === null ? '' : ` of ${row.captured}`}
          </span>
        )}
      </div>
    )
  }

  /* ── A capture: one page that came back from a lane ──────────────────── */
  if (row.kind === 'capture') {
    return (
      <div
        style={enter}
        className={`flex flex-wrap items-center gap-2 rounded-[10px] border px-3 py-1.5 ${
          row.held ? 'border-line bg-surface opacity-70' : 'border-line-strong'
        }`}
      >
        <span className="mono shrink-0 rounded-[3px] border border-line px-1.5 py-px text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
          {row.keyword}
        </span>
        <span className="flex h-3 w-3 shrink-0 items-center justify-center">
          {row.platform === null ? (
            <span className="mono text-[10px] uppercase tracking-[0.06em] text-ink-3" title="Read from the open web, not a platform lane">
              web
            </span>
          ) : (
            <PlatformIcon platform={row.platform} size={12} />
          )}
        </span>
        {/*
          THE TITLE IS THE LINK TO THE PAGE IT CAME FROM.

          A capture row named a page and gave no way to reach it, so nothing on
          this screen could be checked against its source — the one thing an
          operator wants when a title looks wrong or a relevance score looks
          generous. The title carries the link because it is already the thing
          you would click.

          Plain text when the source named no URL: a dead link that looks live
          is worse than no link, and some rows genuinely have none.
        */}
        {row.url ? (
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer noopener"
            className="group/src flex min-w-0 flex-1 items-center gap-1 text-[12px] text-ink-2 underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-colors hover:text-accent-bright hover:decoration-accent"
            title={`${row.title}\n${row.url}`}
          >
            <span className="min-w-0 truncate">{row.title}</span>
            <ExternalLink
              size={10}
              className="shrink-0 opacity-0 transition-opacity group-hover/src:opacity-100"
              aria-hidden="true"
            />
            <span className="sr-only">(opens the source page in a new tab)</span>
          </a>
        ) : (
          <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={row.title}>
            {row.title}
          </span>
        )}
        <span className="mono shrink-0 text-[10px] text-ink-3" title={row.source}>
          {row.engagement === null ? 'N/A' : fmt(row.engagement)}
        </span>
        {row.held ? (
          <span
            className="mono shrink-0 rounded-[3px] border border-line px-1.5 py-px text-[10.5px] uppercase tracking-[0.08em] text-ink-3"
            title={row.held.originalTitle ? `On record as “${row.held.originalTitle}”` : undefined}
          >
            held · {timeAgo(row.held.since)}
          </span>
        ) : (
          /* Confidence fill: the relevance the scraper measured, drawn. */
          <span className="flex shrink-0 items-center gap-1.5" title={`Relevance ${row.relevance}%`}>
            <span className="block h-[3px] w-9 overflow-hidden rounded-[2px] bg-surface-3">
              <span
                className="block h-full bg-accent"
                style={{ width: `${Math.max(0, Math.min(100, row.relevance))}%`, transformOrigin: 'left', animation: 'eth-seg 560ms cubic-bezier(0.16, 1, 0.3, 1) both' }}
              />
            </span>
            <span className="mono w-7 text-right text-[10px] text-ink-3">{row.relevance}</span>
          </span>
        )}
      </div>
    )
  }

  /* ── Scoring: the four measures, filling ─────────────────────────────── */
  if (row.kind === 'scoring') {
    const bars = [
      { label: 'Credibility', value: row.credibility },
      { label: 'Relevance', value: row.relevance },
      { label: 'Freshness', value: row.freshness },
      { label: 'Unique', value: row.unique },
    ]
    return (
      <div style={enter} className="rounded-[10px] border border-hud-strong bg-accent/6 px-3 py-2">
        <div className="flex items-center gap-2">
          <WorkArc size={11} />
          <span className="mono shrink-0 text-[10.5px] uppercase tracking-[0.1em] text-accent-bright">scoring</span>
          <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{row.title}</span>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1.5">
          {bars.map((bar, i) => (
            <div key={bar.label} className="flex items-center gap-2">
              <span className="mono w-[52px] shrink-0 text-[10.5px] uppercase tracking-[0.06em] text-ink-3">
                {bar.label.slice(0, 4)}
              </span>
              <span className="block h-[3px] flex-1 overflow-hidden rounded-[2px] bg-surface-3">
                <span
                  className="block h-full bg-accent"
                  style={{
                    width: `${Math.max(0, Math.min(100, bar.value))}%`,
                    transformOrigin: 'left',
                    animation: `eth-seg 620ms cubic-bezier(0.16, 1, 0.3, 1) ${i * 90}ms both`,
                  }}
                />
              </span>
              <span className="mono w-6 shrink-0 text-right text-[10px] text-ink-3">{bar.value}</span>
            </div>
          ))}
        </div>
      </div>
    )
  }

  /* ── A verdict: the decision, and what it rests on ───────────────────── */
  const style = VERDICT_STYLE[row.verdict]
  const decision = resolved[row.entityId]
  const needsHuman = row.verdict === 'needs_review' && decision === undefined

  return (
    <div
      style={{ ...enter, borderColor: `color-mix(in srgb, ${style.tone} 40%, transparent)` }}
      className="rounded-[10px] border px-3 py-2"
    >
      <div className="flex flex-wrap items-center gap-2">
        <span className="flex h-3 w-3 shrink-0 items-center justify-center" style={{ color: style.tone }}>
          {needsHuman ? (
            <Breathe tone={style.tone} />
          ) : row.onRecord ? (
            <span className="h-1.5 w-1.5 rounded-full" style={{ background: style.tone }} aria-hidden="true" />
          ) : (
            <Commit size={12} tone={style.tone} />
          )}
        </span>
        <span className="min-w-0 flex-1 truncate text-[12px] text-ink-2" title={row.title}>
          {row.title}
        </span>
        <span
          className="mono shrink-0 rounded-[3px] px-1.5 py-px text-[10.5px] uppercase tracking-[0.08em]"
          style={{ color: style.tone, background: `color-mix(in srgb, ${style.tone} 12%, transparent)` }}
        >
          {style.label}
        </span>
        {row.onRecord ? (
          <span
            className="mono shrink-0 rounded-[3px] border border-line px-1.5 py-px text-[10.5px] uppercase tracking-[0.08em] text-ink-3"
            title="Reached by an earlier run. Not re-scored this run."
          >
            on record · {row.onRecord}
          </span>
        ) : null}
      </div>

      {/* Rule 6: every automated decision names the evidence behind it. */}
      {row.reason ? (
        <p className="mt-1 border-l pl-2.5 text-[11px] leading-relaxed text-ink-3" style={{ borderColor: `color-mix(in srgb, ${style.tone} 45%, transparent)` }}>
          {row.reason}
        </p>
      ) : null}

      {row.verdict === 'needs_review' ? (
        decision ? (
          <p className="mono mt-1.5 flex items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-good-ink">
            <Commit size={12} tone="var(--color-good)" /> {decision} by you
          </p>
        ) : (
          <div className="mt-2 flex items-center gap-2">
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


/* ═══════════════════════════════════════════════════════════════════════════
   THE RUN REPORT

   What a finished run produced, on one screen: the tally, what it captured and
   where each page came from, and the way through to the calendar.

   SCOPED TO THE RUN THAT JUST FINISHED, DELIBERATELY. Every figure here is
   derived from this run's own rows — not from the workspace totals, which
   include everything every previous run left behind. A report that silently
   mixed the two would answer "how are we doing" when the question being asked
   is "what did THAT do".

   The captures list is the part that did not exist before. A run could report
   "97 duplicate, 16 validated" and give no way to see a single page behind
   those numbers, so a bad keyword looked exactly like a good one.
   ═══════════════════════════════════════════════════════════════════════════ */


/**
 * OPENS A PRINTABLE REPORT AND ASKS THE BROWSER TO PRINT IT.
 *
 * ═══ WHY A GENERATED DOCUMENT AND NOT `@media print` ON THE DIALOG ═══
 *
 * The first attempt printed the dialog in place, hiding everything else with
 * `body > * { display: none }`. That produced a blank page, and the reason is
 * structural rather than a tuning problem: the dialog renders INSIDE `#root`,
 * so the rule hid its own ancestor. Reaching past that would mean unhiding a
 * chain of wrappers by selector and keeping those selectors true as the layout
 * changes — a print stylesheet quietly coupled to the DOM shape of the app.
 *
 * A generated document has none of that. It contains the capture list and
 * nothing else, so it cannot print blank, and what it contains is decided here
 * rather than by whatever happened to be visible on screen.
 *
 * ═══ WHY IT IS STILL THE BROWSER'S PDF ═══
 *
 * No PDF library is added. One would be a second renderer drawing a different
 * document from the one the operator read, and the two drift the first time
 * either changes. This prints the same rows, with the URL of every one of them
 * written out in full — a PDF of a link list is useless if the links are only
 * clickable.
 */
function printRunReport(input: {
  captures: Array<Extract<FeedRow, { kind: 'capture' }>>
  trending: Array<{ term: string; score: number; rank: number }>
  topHashtags: Array<{ tag: string; score: number }>
  buckets: GraphBucket[]
}): void {
  const { captures, trending, topHashtags, buckets } = input

  const esc = (text: string): string =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

  const when = (iso: string): string => {
    if (iso === '') return '—'
    const d = new Date(iso)
    return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 16).replace('T', ' ')
  }

  const rows = captures
    .map(
      (c, i) => `<tr>
        <td class="n">${i + 1}</td>
        <td>${esc(c.keyword)}</td>
        <td>${esc(c.platform ?? 'open web')}</td>
        <td class="t">${esc(c.title)}</td>
        <td class="u">${c.url ? esc(c.url) : '<span class="muted">no URL recorded</span>'}</td>
        <td class="n">${esc(when(c.capturedAt))}</td>
        <td class="n">${c.held ? 'held' : 'kept'}</td>
      </tr>`,
    )
    .join('')

  const counts = buckets.map((b) => `${esc(b.label)} ${b.count}`).join(' · ')
  const held = captures.filter((c) => c.held !== null).length

  const doc = `<!doctype html>
<html><head><meta charset="utf-8"><title>Ethara.AI — pipeline run report</title>
<style>
  * { box-sizing: border-box; }
  body { font: 11px/1.45 -apple-system, Segoe UI, Inter, sans-serif; color: #111; margin: 0; padding: 22px; }
  h1 { font-size: 17px; margin: 0 0 2px; letter-spacing: -0.01em; }
  .sub { color: #555; margin: 0 0 14px; font-size: 11px; }
  h2 { font-size: 11px; text-transform: uppercase; letter-spacing: .1em; color: #666;
       margin: 16px 0 6px; font-weight: 600; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: .08em;
       color: #666; border-bottom: 1px solid #bbb; padding: 4px 6px 4px 0; font-weight: 600; }
  td { padding: 5px 6px 5px 0; border-bottom: 1px solid #eee; vertical-align: top; }
  tr { break-inside: avoid; page-break-inside: avoid; }
  .n { white-space: nowrap; color: #444; }
  .t { max-width: 230px; }
  /* The URL is written out, not linked: a printed link that only works when
     clicked is not a record of where anything came from. */
  .u { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; font-size: 8.5px;
       color: #2a2a7a; word-break: break-all; max-width: 250px; }
  .muted { color: #999; font-style: italic; }
  .chips { color: #333; }
  @page { margin: 12mm; }
</style></head>
<body>
  <h1>Ethara.AI — pipeline run report</h1>
  <p class="sub">${esc(new Date().toLocaleString())} · ${captures.length} page(s) captured, ${held} held on record · ${esc(counts)}</p>

  ${
    trending.length === 0
      ? ''
      : `<h2>Top keywords</h2><p class="chips">${trending
          .map((t) => `${t.rank}. ${esc(t.term)} (${t.score})`)
          .join(' &nbsp;·&nbsp; ')}</p>`
  }
  ${
    topHashtags.length === 0
      ? ''
      : `<h2>Consolidated hashtags</h2><p class="chips">${topHashtags
          .map((h) => esc(h.tag))
          .join(' &nbsp;·&nbsp; ')}</p>`
  }

  <h2>Everything captured on this run</h2>
  ${
    captures.length === 0
      ? '<p class="muted">Nothing was captured on this run.</p>'
      : `<table>
          <thead><tr><th>#</th><th>Topic</th><th>Lane</th><th>Title</th><th>URL</th><th>Captured</th><th>State</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>`
  }
</body></html>`

  const win = window.open('', '_blank')
  if (!win) return
  win.document.write(doc)
  win.document.close()
  win.focus()
  // The document has to be laid out before it can be printed; without the
  // frame the print dialog can open over an empty document.
  win.requestAnimationFrame(() => win.print())
}

function RunReport({
  captures,
  topicUrls,
  trending,
  topHashtags,
  buckets,
  newTrendIdeas,
  summary,
  onNavigate,
  onClose,
}: {
  captures: Array<Extract<FeedRow, { kind: 'capture' }>>
  /** Topic term → where that topic can be read about. Absent terms stay plain. */
  topicUrls: Map<string, string>
  trending: Array<{ term: string; score: number; rank: number }>
  topHashtags: Array<{ tag: string; score: number }>
  buckets: GraphBucket[]
  newTrendIdeas: Array<{ id: string; title: string; platform: Platform; slot: string; rank: number | null }>
  summary: { postsScraped?: number; duplicate?: number; trending?: number; ideas?: number } | null
  onNavigate: (page: 'calendar' | 'intelligence') => void
  onClose: () => void
}) {
  /*
   * COUNTED FROM THE CAPTURES, NOT FROM THE LANE ROWS.
   *
   * `lanes` is empty whenever the console is showing a replayed run — lane rows
   * are a live-stream artefact — so the header read "across 0 lanes" beside a
   * list of 26 captured pages, which contradicts itself. The keywords the
   * captures name are present in both modes and are the more useful figure
   * anyway: what was searched for, rather than how many pipes were open.
   */
  const laneCount = new Set(captures.map((c) => c.keyword).filter((k) => k !== '—')).size

  const held = captures.filter((c) => c.held !== null)
  const kept = captures.filter((c) => c.held === null)
  const placed = newTrendIdeas.filter((i) => i.slot === 'primary')

  // N/A, never 0: a lane that reported no engagement is not a lane that
  // measured zero. Averaging over rows that stated nothing would invent a figure.
  const measured = kept.filter((c) => c.engagement !== null)
  const avgRelevance =
    kept.length === 0 ? null : Math.round(kept.reduce((sum, c) => sum + c.relevance, 0) / kept.length)

  const stat = (label: string, value: string, tone = 'text-ink') => (
    <div key={label} className="rounded-[10px] border border-line-strong bg-surface px-3 py-2.5">
      <p className={`tabular text-[19px] font-semibold leading-none tracking-[-0.02em] ${tone}`}>{value}</p>
      <p className="mono mt-1.5 text-[9.5px] uppercase leading-tight tracking-[0.1em] text-ink-3">{label}</p>
    </div>
  )

  return (
    <section
      className="flex max-h-[88vh] flex-col overflow-hidden rounded-[14px] border border-line-strong bg-surface-2 shadow-[0_24px_80px_rgba(0,0,0,0.55)]"
      style={{ animation: 'eth-rise 460ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
    >
      {/* ── Header ───────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-start gap-3 border-b border-line px-5 py-4 sm:px-6">
        <span className="mt-0.5 text-good-ink">
          <Commit size={16} tone="var(--color-good)" />
        </span>
        <div className="min-w-0 flex-1">
          <h2 className="text-[15px] font-semibold tracking-[-0.01em] text-ink">Pipeline run complete</h2>
          <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
            {captures.length === 0
              ? 'Nothing was captured on this run. The rows below say which lanes reported and why.'
              : `${fmt(captures.length)} page${captures.length === 1 ? '' : 's'} read across ${fmt(laneCount)} keyword${laneCount === 1 ? '' : 's'}, and Dora placed the strongest trends into the week.`}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close the run report"
          className="shrink-0 rounded-[7px] border border-line-strong p-1.5 text-ink-3 transition-colors hover:border-accent hover:text-ink"
        >
          <X size={13} aria-hidden="true" />
        </button>
      </header>

      {/* ── Body ─────────────────────────────────────────────────────────── */}
      <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4 sm:px-6">
        {/* The tally. Every figure is this run's. */}
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
          {stat('Captured', fmt(captures.length))}
          {stat('Kept', fmt(kept.length), 'text-good-ink')}
          {stat('Held · on record', fmt(held.length), held.length > 0 ? 'text-ink-2' : 'text-ink')}
          {buckets.map((b) =>
            stat(b.label, fmt(b.count), b.id === 'needs_review' && b.count > 0 ? 'text-warn' : 'text-ink'),
          )}
        </div>

        <p className="mono mt-2 text-[10.5px] leading-relaxed text-ink-3">
          Average relevance {avgRelevance === null ? 'N/A' : `${avgRelevance}%`} ·{' '}
          {measured.length === 0
            ? 'no lane reported engagement figures on this run'
            : `${fmt(measured.length)} of ${fmt(kept.length)} pages carried engagement figures`}
          {summary?.ideas === undefined ? '' : ` · ${fmt(summary.ideas)} idea(s) placed`}
        </p>

        {/* ── Keywords and hashtags this run produced ───────────────────── */}
        {trending.length > 0 || topHashtags.length > 0 ? (
          <div className="mt-4 grid grid-cols-1 gap-4 lg:grid-cols-2">
            {trending.length > 0 ? (
              <div>
                <p className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                  Top {trending.length} keyword{trending.length === 1 ? '' : 's'}
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {trending.map((t) => (
                    <li
                      key={t.term}
                      className="flex items-center gap-1.5 rounded-full border border-line-strong px-2.5 py-1 text-[11.5px] text-ink-2"
                    >
                      <span className="mono tabular text-[10px] text-ink-3">{t.rank}</span>
                      <span className="truncate">{t.term}</span>
                      <span className="mono tabular text-[10px] text-accent-bright">{t.score}</span>
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {topHashtags.length > 0 ? (
              <div>
                <p className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
                  Top {topHashtags.length} hashtag{topHashtags.length === 1 ? '' : 's'} · consolidated
                </p>
                <ul className="mt-1.5 flex flex-wrap gap-1.5">
                  {topHashtags.map((h) => (
                    <li
                      key={h.tag}
                      className="rounded-full border border-line-strong px-2.5 py-1 text-[11.5px] text-ink-2"
                    >
                      {h.tag}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}
          </div>
        ) : null}

        {/* ── Every page this run read ──────────────────────────────────── */}
        <div className="mt-5">
          <p className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
            Everything captured on this run
          </p>
          {captures.length === 0 ? (
            <p className="mt-1.5 rounded-[10px] border border-line-strong bg-surface px-3 py-2.5 text-[12px] leading-relaxed text-ink-3">
              No page was captured. This is a real result, not a gap — the run console above names the
              lane that could not read and the reason it gave.
            </p>
          ) : (
            <ul className="mt-1.5 space-y-1">
              {captures.map((row) => (
                <li
                  key={row.id}
                  className={`flex flex-wrap items-center gap-2 rounded-[9px] border px-2.5 py-1.5 ${
                    row.held ? 'border-line bg-surface opacity-70' : 'border-line-strong'
                  }`}
                >
                  {topicUrls.get(row.keyword) ? (
                    <a
                      href={topicUrls.get(row.keyword)}
                      target="_blank"
                      rel="noreferrer noopener"
                      title={`Read about “${row.keyword}”`}
                      className="mono shrink-0 rounded-[3px] border border-line px-1.5 py-px text-[10px] uppercase tracking-[0.08em] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                    >
                      {row.keyword}
                    </a>
                  ) : (
                    <span className="mono shrink-0 rounded-[3px] border border-line px-1.5 py-px text-[10px] uppercase tracking-[0.08em] text-ink-3">
                      {row.keyword}
                    </span>
                  )}
                  <span className="flex h-3 w-3 shrink-0 items-center justify-center">
                    {row.platform === null ? (
                      <span className="mono text-[9.5px] uppercase tracking-[0.06em] text-ink-3" title="Read from the open web">
                        web
                      </span>
                    ) : (
                      <PlatformIcon platform={row.platform} size={12} />
                    )}
                  </span>

                  {/* The link is the whole point of this list: every claim here
                      can be opened and checked against the page it came from. */}
                  {row.url ? (
                    <a
                      href={row.url}
                      target="_blank"
                      rel="noreferrer noopener"
                      className="group/src flex min-w-0 flex-1 items-center gap-1 text-[11.5px] text-ink-2 underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-colors hover:text-accent-bright hover:decoration-accent"
                      title={`${row.title}\n${row.url}`}
                    >
                      <span className="min-w-0 truncate">{row.title}</span>
                      <ExternalLink size={10} className="shrink-0 opacity-0 transition-opacity group-hover/src:opacity-100" aria-hidden="true" />
                    </a>
                  ) : (
                    <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2" title={row.title}>
                      {row.title}
                    </span>
                  )}

                  {/*
                    ENGAGEMENT AND RELEVANCE ARE NOT SHOWN PER ROW HERE.

                    Both were printed on every line and both said the same thing
                    on every line — `N/A 100%`, several dozen times down the
                    list. A column that never varies is not information; it is
                    noise that pushes the title, which does vary, out of view.

                    Neither figure is lost. The band at the top of this report
                    states the average relevance and how many pages carried
                    engagement figures at all, which is where a number that is
                    uniform across the run actually belongs. `held` stays,
                    because it IS per-row and changes what the row means.
                  */}
                  {row.held ? (
                    <span className="mono shrink-0 rounded-[3px] border border-line px-1.5 py-px text-[10px] uppercase tracking-[0.08em] text-ink-3">
                      held · {timeAgo(row.held.since)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* ── What reached the calendar ─────────────────────────────────── */}
        {newTrendIdeas.length > 0 ? (
          <div className="mt-5">
            <p className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">
              New trends added to the calendar · {placed.length} placed, {newTrendIdeas.length - placed.length} in
              more suggestions
            </p>
            <ul className="mt-1.5 grid grid-cols-1 gap-1 lg:grid-cols-2">
              {newTrendIdeas.map((idea) => (
                <li key={idea.id} className="flex flex-wrap items-center gap-2 rounded-[9px] border border-line-strong px-2.5 py-1.5">
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
      </div>

      {/* ── Actions ──────────────────────────────────────────────────────── */}
      <footer
        className="flex shrink-0 flex-wrap items-center gap-2 border-t border-line px-5 py-3 sm:px-6"
      >
        <Btn variant="primary" onClick={() => onNavigate('calendar')}>
          Open Weekly Calendar
        </Btn>
        {/*
          The browser's own print-to-PDF, over the report already on screen.
          A PDF library would be a second renderer drawing a different document
          from the one being read, and the two drift the first time either
          changes. `@media print` in index.css hides everything else and lets
          the capture list run to its full length.
        */}
        <Btn
          variant="subtle"
          onClick={() => printRunReport({ captures, trending, topHashtags, buckets })}
          title="Open a printable report and save it as a PDF"
        >
          <Download size={13} /> Download PDF
        </Btn>
        <Btn variant="subtle" onClick={() => onNavigate('intelligence')}>
          View Content Intelligence
        </Btn>
        <Btn variant="ghost" onClick={onClose}>
          Back to the run
        </Btn>
      </footer>
    </section>
  )
}


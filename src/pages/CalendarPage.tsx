/**
 * WEEKLY CALENDAR
 *
 * Capacity is the first thing you see: five pips per platform, filled or
 * free, with the count waiting below the cut beside them. The week itself
 * carries only drafted work, seven columns on a shallow arc, each card a
 * title with a small creative under it. The ranked queue on the right is what
 * this screen is actually for: every idea below the cut shows the rank it
 * holds, and promoting one states exactly what it displaces before it does.
 *
 * The assistant lives in a popover under Ask Ethara, scoped to this week.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight } from 'lucide-react'
import { useStore } from '../store'
import { CalendarAssistant } from '../components/assistant/calendar-assistant'
import { PlatformIcon, PLATFORM_LABEL, PLATFORM_TOKEN } from '../components/ui'
import type { Idea, IdeaStatus, Platform } from '../types'

const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'x', 'facebook']
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
const DAY_MS = 24 * 60 * 60 * 1000

/* ── Dates: local calendar days, never UTC midnight ─────────────────────── */

function startOfWeek(date: Date): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + (out.getDay() === 0 ? -6 : 1 - out.getDay()))
  out.setHours(0, 0, 0, 0)
  return out
}
function addDays(date: Date, n: number): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + n)
  return out
}
function isoDate(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}
/** Sorts by clock time, so a day column reads top to bottom in posting order. */
function timeValue(time: string): number {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time)
  if (!match) return 0
  let hour = Number(match[1]) % 12
  if (/PM/i.test(match[3] ?? '')) hour += 12
  return hour * 60 + Number(match[2])
}
/** "10:30 AM" → "10:30", as the design prints it. */
function clock(time: string): string {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time)
  if (!match) return time
  let hour = Number(match[1]) % 12
  if (/PM/i.test(match[3] ?? '')) hour += 12
  return `${String(hour).padStart(2, '0')}:${match[2]}`
}

/* ── Card size: one slider, remembered ─────────────────────────────────── */

const WIDTH_KEY = 'ethara.calendar.cardWidth'
const MIN_WIDTH = 120
const MAX_WIDTH = 320
const DEFAULT_WIDTH = 150

function readWidth(): number {
  try {
    const stored = Number(localStorage.getItem(WIDTH_KEY))
    return Number.isFinite(stored) && stored >= MIN_WIDTH && stored <= MAX_WIDTH ? stored : DEFAULT_WIDTH
  } catch {
    return DEFAULT_WIDTH
  }
}

/**
 * What a card shows at a given width. Narrow cards drop the creative and
 * keep two lines of hook; wide ones show five lines and a taller creative.
 * The width is the one control; everything else follows from it.
 */
function cardShape(width: number): { hookLines: string; hookText: string; thumb: number; showAngle: boolean } {
  return {
    hookLines: width < 150 ? 'line-clamp-2' : width < 190 ? 'line-clamp-4' : 'line-clamp-5',
    hookText: width < 150 ? 'text-[12px]' : width < 200 ? 'text-[13px]' : 'text-[14px]',
    thumb: width < 150 ? 0 : width < 200 ? 84 : Math.round(width * 0.58),
    showAngle: width >= 140,
  }
}

/* ── Drag to reschedule ────────────────────────────────────────────────── */

type DragPhase = 'start' | 'move' | 'end' | 'cancel'
interface DragPoint {
  x: number
  y: number
}

/** "Wed 16", for the ghost's "Move to …" line. */
function dayLabelOf(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })
}

/* ── What a card leads with ─────────────────────────────────────────────── */

/**
 * The topic: the one phrase that says what a post is ABOUT. The Calendar
 * Agent records it on every idea; the hashtag and the platform are the
 * fallbacks for the rare row that predates it.
 */
function topicOf(idea: Idea): string {
  return idea.source_topic ?? idea.hashtag_display ?? PLATFORM_LABEL[idea.platform]
}

/**
 * The hook: the post's opening line, as it will read on the platform. The
 * pipeline retitles a card to its draft's first line, so the title usually IS
 * the hook — but the title is clipped, and the draft carries the whole
 * sentence. Whichever is fuller is shown.
 */
function hookOf(idea: Idea): string {
  const first = (idea.draft?.body ?? '')
    .split('\n')
    .map((line) => line.replace(/^[#*>\-\s]+/, '').trim())
    .find((line) => line.length > 0)
  return first !== undefined && first.length > idea.title.length ? first : idea.title
}

/* ── Status → tone ──────────────────────────────────────────────────────── */

const STATUS_INK: Partial<Record<IdeaStatus, string>> = {
  approved: 'var(--color-good-ink)',
  scheduled: 'var(--color-good-ink)',
  published: 'var(--color-good-ink)',
  drafted: 'var(--color-accent-bright)',
  in_review: 'var(--color-serious)',
  pending_leadership: 'var(--color-serious)',
}
const STATUS_CHIP: Partial<Record<IdeaStatus, string>> = {
  approved: 'APPROVED',
  scheduled: 'SCHEDULED',
  published: 'PUBLISHED',
  drafted: 'DRAFTED',
  in_review: 'IN REVIEW',
  pending_leadership: 'WITH LEADERSHIP',
}

export function CalendarPage() {
  const ideas = useStore((s) => s.ideas)
  const cap = useStore((s) => s.settings.topPerPlatform)
  const openReview = useStore((s) => s.openReview)

  /*
   * Open on the week that actually holds the content: the one containing the
   * earliest primary that has not passed. Once the operator pages, that is
   * their choice and it is left alone.
   */
  const [weekOffset, setWeekOffset] = useState(() => {
    const today = startOfWeek(new Date()).getTime()
    const upcoming = ideas
      .filter((idea) => idea.calendar_slot === 'primary' && typeof idea.scheduled_date === 'string')
      .map((idea) => startOfWeek(new Date(`${String(idea.scheduled_date).slice(0, 10)}T12:00:00`)).getTime())
      .filter((week) => week >= today)
      .sort((a, b) => a - b)
    const earliest = upcoming[0]
    return earliest === undefined ? 0 : Math.round((earliest - today) / (7 * DAY_MS))
  })
  const [askOpen, setAskOpen] = useState(false)
  const gridRef = useRef<HTMLDivElement | null>(null)
  const moveIdea = useStore((s) => s.moveIdea)

  /* ── Card size ────────────────────────────────────────────────────── */
  const [cardWidth, setCardWidth] = useState(readWidth)
  const shape = cardShape(cardWidth)
  useEffect(() => {
    try {
      localStorage.setItem(WIDTH_KEY, String(cardWidth))
    } catch {
      // Not remembering the size is acceptable; the slider still works.
    }
  }, [cardWidth])

  /*
   * ── Drag to reschedule ────────────────────────────────────────────────
   *
   * NOT the HTML5 drag API. This file's history records three failed attempts
   * built on `draggable`, and the lesson was that `draggable` and a reliable
   * click on the same element are incompatible. So the drag is pointer
   * events, by hand: a press that travels more than six pixels becomes a
   * drag; one that does not is a click that opens the card. The ghost that
   * follows the pointer is positioned by writing to the DOM directly, once
   * per frame, so the grid does not re-render while a card is in flight —
   * React state changes only when the day under the pointer changes.
   */
  const [drag, setDrag] = useState<{ idea: Idea; overIso: string | null; width: number } | null>(null)
  const dragRef = useRef<{ idea: Idea; overIso: string | null } | null>(null)
  const ghostRef = useRef<HTMLDivElement | null>(null)
  const pointRef = useRef<DragPoint>({ x: 0, y: 0 })
  const [justMoved, setJustMoved] = useState<string | null>(null)

  const place = (p: DragPoint): void => {
    pointRef.current = p
    const ghost = ghostRef.current
    if (ghost) ghost.style.transform = `translate(${p.x - 20}px, ${p.y - 18}px) rotate(1.5deg)`
  }
  /** The day column under the pointer; the ghost is pointer-transparent, so it never gets in the way. */
  const dayUnder = (p: DragPoint): string | null =>
    document.elementFromPoint(p.x, p.y)?.closest<HTMLElement>('[data-day]')?.dataset.day ?? null

  const onCardDrag = (idea: Idea, phase: DragPhase, p: DragPoint, rect?: DOMRect): void => {
    if (phase === 'start') {
      dragRef.current = { idea, overIso: null }
      place(p)
      setDrag({ idea, overIso: null, width: rect?.width ?? 180 })
      document.body.classList.add('is-dragging')
      return
    }
    if (phase === 'move') {
      place(p)
      const over = dayUnder(p)
      if (dragRef.current && over !== dragRef.current.overIso) {
        dragRef.current.overIso = over
        setDrag((d) => (d ? { ...d, overIso: over } : d))
      }
      return
    }
    const current = dragRef.current
    dragRef.current = null
    document.body.classList.remove('is-dragging')
    setDrag(null)
    if (phase !== 'end' || !current) return
    const target = dayUnder(p) ?? current.overIso
    if (target && target !== current.idea.scheduled_date) {
      setJustMoved(current.idea.id)
      void moveIdea(current.idea.id, target)
    }
  }

  // Escape lets go of a card mid-drag. The pointer-up that follows finds no
  // drag in progress and does nothing.
  useEffect(() => {
    if (!drag) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return
      dragRef.current = null
      document.body.classList.remove('is-dragging')
      setDrag(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [drag])

  // The landed card pops once, then settles; the flag clears itself.
  useEffect(() => {
    if (justMoved === null) return
    const timer = window.setTimeout(() => setJustMoved(null), 700)
    return () => window.clearTimeout(timer)
  }, [justMoved])

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const todayIso = isoDate(new Date())
  const weekIsos = useMemo(() => new Set(days.map(isoDate)), [days])

  /*
   * The calendar carries drafted work; the queue carries ideas. A slot alone
   * is not enough to put a card on the grid — the post must have been written.
   */
  const live = ideas.filter((i) => i.status !== 'rejected')
  const primary = live.filter((i) => i.calendar_slot === 'primary' && i.status !== 'suggested')
  const queued = live.filter((i) => i.calendar_slot === 'suggestion' || i.status === 'suggested')
  const weekPrimary = primary.filter((i) => weekIsos.has(i.scheduled_date))

  const capacity = PLATFORMS.map((platform) => {
    const placed = weekPrimary.filter((i) => i.platform === platform).length
    const waiting = queued.filter((i) => i.platform === platform).length
    return { platform, placed, free: Math.max(0, cap - placed), waiting }
  })
  const totalPlaced = weekPrimary.length
  const totalFree = capacity.reduce((s, c) => s + c.free, 0)

  useEffect(() => {
    if (!askOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setAskOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [askOpen])

  const label = (d: Date): string => d.toLocaleDateString('en-GB', { day: 'numeric' })
  const monthOf = (d: Date): string => d.toLocaleDateString('en-GB', { month: 'short' }).toUpperCase()
  const weekLabel =
    monthOf(weekStart) === monthOf(addDays(weekStart, 6))
      ? `${label(weekStart)}–${label(addDays(weekStart, 6))} ${monthOf(weekStart)}`
      : `${label(weekStart)} ${monthOf(weekStart)}–${label(addDays(weekStart, 6))} ${monthOf(addDays(weekStart, 6))}`


  return (
    <div className="-mx-6 -mt-5 -mb-5 flex min-h-[calc(100vh-56px)] flex-col">
      {/* ── Command bar ─────────────────────────────────────────────────── */}
      <header className="glass relative z-20 flex min-h-[58px] shrink-0 flex-wrap items-center gap-3.5 border-b border-line px-[18px] py-1.5">
        <h1 className="whitespace-nowrap text-[20px] font-semibold tracking-[-0.02em] text-ink">Weekly Calendar</h1>
        <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-md border border-line-strong px-[9px] py-1 text-[11px] tracking-[0.1em] text-ink-3">
          TOP {cap} PER PLATFORM
        </span>
        <div className="ml-auto flex items-center gap-2">
          {/* The cards' size, as one slider. Everything a card shows follows
              from its width — see `cardShape`. */}
          <label className="flex items-center gap-2 rounded-md border border-line-strong px-2.5 py-[5px] text-[10.5px] text-ink-3">
            <span className="whitespace-nowrap">Card size</span>
            <input
              type="range"
              min={MIN_WIDTH}
              max={MAX_WIDTH}
              step={10}
              value={cardWidth}
              onChange={(event) => setCardWidth(Number(event.target.value))}
              aria-label="Card size"
              aria-valuetext={`${cardWidth} pixels wide`}
              className="eth-range w-24"
            />
          </label>
          <div className="flex items-center overflow-hidden rounded-md border border-line-strong">
            <button type="button" onClick={() => setWeekOffset(weekOffset - 1)} aria-label="Previous week" className="px-[9px] py-[5px] text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink">
              <ChevronLeft size={13} />
            </button>
            <span className="border-x border-line-strong px-3 py-[5px] text-[11px] text-ink">{weekLabel}</span>
            <button type="button" onClick={() => setWeekOffset(weekOffset + 1)} aria-label="Next week" className="px-[9px] py-[5px] text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink">
              <ChevronRight size={13} />
            </button>
          </div>

          <div className="relative">
            <button
              type="button"
              onClick={() => setAskOpen((v) => !v)}
              aria-expanded={askOpen}
              aria-label="Ask Ethara"
              className={`relative inline-flex items-center gap-2.5 rounded-full border bg-surface py-[5px] pl-1.5 pr-3 text-left transition-[border-color,transform,box-shadow] duration-[260ms] ease-[var(--ease-out-soft)] hover:-translate-y-px ${
                askOpen ? 'border-accent' : 'border-line-strong hover:border-accent'
              }`}
              style={askOpen ? undefined : { boxShadow: 'none' }}
            >
              <AgentFace />
              <span className="block leading-tight">
                <span className="block text-[12.5px] font-semibold tracking-[-0.01em] text-ink">Ask Ethara</span>
                <span className="mt-px block text-[10.5px] text-ink-3">Happy to move slots or redraft</span>
              </span>
              <span className="shrink-0 rounded-[4px] border border-line-strong px-[5px] text-[11px] text-ink-3">⌘K</span>
            </button>

            {askOpen ? (
              <div
                role="dialog"
                aria-label="Ask Ethara about this week"
                className="absolute right-0 top-[calc(100%+10px)] z-30 w-[420px] max-w-[calc(100vw-48px)] origin-top-right overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-2xl"
                style={{ animation: `eth-pop 380ms ${EASE} both` }}
              >
                <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-[11px] tracking-[0.1em] text-ink-3">
                  SCOPED TO {weekLabel} · PLANS BEFORE IT RUNS
                  <button type="button" onClick={() => setAskOpen(false)} aria-label="Close" className="ml-auto text-ink-3 transition-colors hover:text-ink">✕</button>
                </div>
                <div className="max-h-[520px] overflow-y-auto">
                  <CalendarAssistant />
                </div>
              </div>
            ) : null}
          </div>
        </div>
      </header>

      {/* ── The week, and the queue ─────────────────────────────────────── */}
      {/*
       * The queue sits BESIDE the week only where both fit — from 1536px up.
       * At a 1440px laptop the two together left seven day-columns 118px wide,
       * which is what made every title a tower of single words. Below that
       * width the queue stacks under a full-width week instead: the whole week
       * is visible without scrolling, and the queue is one scroll away.
       */}
      <div className="flex min-h-0 flex-1 flex-col 2xl:flex-row">
        <section
          className="relative min-w-0 flex-1 overflow-auto border-b border-line px-[14px] py-3.5 2xl:border-b-0 2xl:border-r"
        >
          <div className="relative z-10 mb-2.5 flex items-center gap-2.5">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.015em] text-ink">
              {totalPlaced} slot{totalPlaced === 1 ? '' : 's'} placed
            </h2>
            <span className="text-[10.5px] text-ink-3">
              {totalFree} of {cap * PLATFORMS.length} slots free · drag a card to another day, or open it to edit
            </span>
          </div>

          {/*
           * SEVEN COLUMNS THAT NEVER GET NARROWER THAN A TITLE CAN READ.
           *
           * The week is a fixed shape — seven days — so it must not reflow into
           * fewer columns the way a card grid would: a Wednesday stacked under a
           * Monday is not a calendar. Below the width where seven readable
           * columns fit, the week scrolls sideways instead, which is what every
           * calendar a person has used does. The floor is what stopped a title
           * from becoming a tower of single words at 1440px and below.
           */}
          <div
            ref={gridRef}
            className="grid items-start gap-2"
            style={{ gridTemplateColumns: `repeat(7, minmax(${cardWidth}px, 1fr))` }}
          >
              {days.map((day, i) => {
                const iso = isoDate(day)
                const dayIdeas = primary
                  .filter((idea) => idea.scheduled_date === iso)
                  .sort((a, b) => timeValue(a.scheduled_time) - timeValue(b.scheduled_time))
                const isToday = iso === todayIso
                const platformsToday = [...new Set(dayIdeas.map((idea) => idea.platform))]
                const isDropTarget = drag !== null && drag.overIso === iso && drag.idea.scheduled_date !== iso
                return (
                  <div
                    key={iso}
                    data-day={iso}
                    // Today is a lit column, not just a label — the eye finds it
                    // from anywhere on the grid. A column under a dragged card
                    // lights the same way, brighter, so the drop reads before it lands.
                    className={`flex min-w-0 flex-col gap-2 rounded-[12px] px-1 pb-1 transition-[background-color,box-shadow] duration-[var(--dur-fast)] ${
                      isDropTarget
                        ? 'bg-accent/[0.12] ring-2 ring-accent/60'
                        : isToday
                          ? 'bg-accent/[0.06] ring-1 ring-accent/25'
                          : drag !== null
                            ? 'ring-1 ring-line-strong'
                            : ''
                    }`}
                    style={{ animation: `eth-rise 420ms ${EASE} ${120 + i * 50}ms both` }}
                  >
                    <header className="px-1 pt-1">
                      <div className="flex items-baseline gap-1.5">
                        <span className={`text-[11px] font-medium tracking-[0.12em] ${isToday ? 'text-accent-bright' : 'text-ink-3'}`}>
                          {day.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}
                        </span>
                        <span className={`text-[14px] font-semibold ${isToday ? 'text-ink' : 'text-ink-2'}`}>{day.getDate()}</span>
                        {isToday ? <span className="ml-auto rounded-[4px] bg-accent/15 px-1.5 py-px text-[10px] font-semibold tracking-[0.1em] text-accent-bright">TODAY</span> : null}
                      </div>
                      {/* The day's shape before its cards: how many, on which
                          platforms — a dot per platform in its own colour. */}
                      <div className="mt-0.5 flex items-center gap-1.5 text-[10.5px] text-ink-3">
                        <span>{dayIdeas.length === 0 ? 'no posts' : `${dayIdeas.length} post${dayIdeas.length === 1 ? '' : 's'}`}</span>
                        {platformsToday.map((p) => (
                          <span key={p} className="h-1.5 w-1.5 rounded-full" style={{ background: PLATFORM_TOKEN[p] }} title={PLATFORM_LABEL[p]} aria-label={PLATFORM_LABEL[p]} />
                        ))}
                      </div>
                    </header>

                    {dayIdeas.map((idea) => (
                      <SlotCard
                        key={idea.id}
                        idea={idea}
                        shape={shape}
                        dragging={drag?.idea.id === idea.id}
                        landed={justMoved === idea.id}
                        onOpen={() => openReview(idea.id)}
                        onDrag={onCardDrag}
                      />
                    ))}

                    {/* A day with room left says so — and while a card is in
                        flight it says where the card would land. */}
                    <div
                      className={`flex min-h-[52px] items-center justify-center rounded-[9px] border border-dashed text-[10.5px] tracking-[0.1em] transition-colors duration-[var(--dur-fast)] ${
                        isDropTarget ? 'border-accent text-accent-bright' : 'border-line-strong text-ink-3'
                      }`}
                    >
                      {isDropTarget ? 'MOVE HERE' : dayIdeas.length === 0 ? 'NO SLOT TAKEN' : 'ROOM FOR MORE'}
                    </div>
                  </div>
                )
              })}
          </div>
        </section>

        <Queue queued={queued} capacity={capacity} weekPrimary={weekPrimary} cap={cap} />
      </div>

      {/* The card in flight. Pointer-transparent, so the day under the pointer
          is always the day under the card. */}
      {drag ? (
        <div
          ref={ghostRef}
          aria-hidden="true"
          className="pointer-events-none fixed left-0 top-0 z-[120] rounded-[10px] border border-accent bg-surface px-3 py-2.5"
          style={{
            width: Math.max(180, Math.min(280, drag.width)),
            transform: `translate(${pointRef.current.x - 20}px, ${pointRef.current.y - 18}px) rotate(1.5deg)`,
            boxShadow: '0 24px 60px -18px var(--color-glow), 0 8px 24px -12px rgba(0, 0, 0, 0.6)',
          }}
        >
          <p className="line-clamp-1 text-[10.5px] font-semibold uppercase tracking-[0.12em] text-accent-bright">{topicOf(drag.idea)}</p>
          <p className="mt-1 line-clamp-2 text-[12.5px] font-semibold leading-snug text-ink">{hookOf(drag.idea)}</p>
          <p className={`mt-1.5 text-[10.5px] font-medium ${drag.overIso && drag.overIso !== drag.idea.scheduled_date ? 'text-accent-bright' : 'text-ink-3'}`}>
            {drag.overIso === null
              ? 'Drop on a day'
              : drag.overIso === drag.idea.scheduled_date
                ? 'Already on this day'
                : `Move to ${dayLabelOf(drag.overIso)}`}
          </p>
        </div>
      ) : null}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CARD — a title, with a small creative under it
   ═══════════════════════════════════════════════════════════════════════════ */

function SlotCard({
  idea,
  shape,
  dragging,
  landed,
  onOpen,
  onDrag,
}: {
  idea: Idea
  shape: ReturnType<typeof cardShape>
  dragging: boolean
  landed: boolean
  onOpen: () => void
  onDrag: (idea: Idea, phase: DragPhase, point: DragPoint, rect?: DOMRect) => void
}) {
  const ink = STATUS_INK[idea.status] ?? 'var(--color-ink-3)'
  const chip = STATUS_CHIP[idea.status] ?? idea.status.toUpperCase()
  const colour = PLATFORM_TOKEN[idea.platform]
  const topic = topicOf(idea)
  const hook = hookOf(idea)
  const angle = typeof idea.analysis.angle === 'string' ? idea.analysis.angle : null

  /*
   * PRESS, THEN EITHER A CLICK OR A DRAG — NEVER BOTH.
   *
   * The press is recorded on pointer-down and decided on movement: six pixels
   * of travel makes it a drag, and the card takes pointer capture so the
   * gesture keeps reporting even when the pointer leaves it. A press that
   * ends without that travel is a click, and opens the card. A finger is
   * held to a higher bar — 220ms of stillness first — because on a touch
   * screen the same gesture is how a person scrolls, and scrolling must win.
   */
  const node = useRef<HTMLElement | null>(null)
  const press = useRef<{ id: number; x: number; y: number; dragging: boolean; timer: number | null } | null>(null)

  const begin = (x: number, y: number): void => {
    const p = press.current
    const el = node.current
    if (!p || !el || p.dragging) return
    p.dragging = true
    if (p.timer !== null) {
      window.clearTimeout(p.timer)
      p.timer = null
    }
    try {
      el.setPointerCapture(p.id)
    } catch {
      // The pointer is already gone; the drag simply will not start.
    }
    onDrag(idea, 'start', { x, y }, el.getBoundingClientRect())
  }
  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    press.current = { id: event.pointerId, x: event.clientX, y: event.clientY, dragging: false, timer: null }
    if (event.pointerType === 'touch') {
      const { clientX, clientY } = event
      press.current.timer = window.setTimeout(() => begin(clientX, clientY), 220)
    }
  }
  const onPointerMove = (event: React.PointerEvent<HTMLElement>): void => {
    const p = press.current
    if (!p) return
    if (p.dragging) {
      onDrag(idea, 'move', { x: event.clientX, y: event.clientY })
      return
    }
    if (Math.hypot(event.clientX - p.x, event.clientY - p.y) < 6) return
    if (event.pointerType === 'touch') {
      // Moved before the hold completed: this is a scroll, not a drag.
      if (p.timer !== null) window.clearTimeout(p.timer)
      press.current = null
      return
    }
    begin(event.clientX, event.clientY)
  }
  const onPointerUp = (event: React.PointerEvent<HTMLElement>): void => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.timer !== null) window.clearTimeout(p.timer)
    if (p.dragging) onDrag(idea, 'end', { x: event.clientX, y: event.clientY })
    else onOpen()
  }
  const onPointerCancel = (): void => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.timer !== null) window.clearTimeout(p.timer)
    if (p.dragging) onDrag(idea, 'cancel', { x: 0, y: 0 })
  }

  /*
   * OPENING A CARD THAT IS ALSO DRAGGABLE.
   *
   * `draggable` + `onClick` looks right and fails in practice: the browser starts
   * a drag on a movement of one or two pixels, and a drag SUPPRESSES the click.
   * On a trackpad that is most attempts, so the card simply did not open and
   * there was nothing to debug — no error, no event.
   *
   * So the intent is measured rather than inferred. Pointer-down records where it
   * began; pointer-up opens the card only if the pointer barely moved. A real
   * drag moves further than the threshold and never opens anything.
   */
  /*
   * OPENING A CARD: A PLAIN CLICK, AND NOTHING CLEVER.
   *
   * This went through three failed mechanisms, and the history matters because
   * each one looked correct:
   *
   *   1. `draggable` + `onClick` — the browser starts a drag on a 1–2px movement
   *      and a drag DISCARDS the click. Most trackpad attempts did nothing.
   *   2. Pointer-down/up with a distance threshold — better, until you notice
   *      that `draggable` also fires `pointercancel` when the drag begins. The
   *      cancel handler cleared the press origin, so `pointerup` found nothing
   *      and refused to open. That made it worse than (1).
   *
   * The lesson is that `draggable` and a reliable click on the SAME element are
   * not compatible. Opening a post to edit it is the primary action; dragging to
   * reschedule is a convenience. So the element is no longer draggable and the
   * click is an ordinary one, which is the only mechanism here that has ever been
   * reliable. Rescheduling stays available by asking Ethara to move a post.
   */
  return (
    <article
      ref={node}
      role="button"
      tabIndex={0}
      aria-label={`Open “${idea.title}” for editing. Drag to another day to reschedule it.`}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={`group relative flex cursor-grab select-none flex-col overflow-hidden rounded-[9px] border bg-surface py-2 pl-[11px] pr-[9px] transition-[border-color,transform,opacity,box-shadow] duration-[320ms] ease-[var(--ease-out-soft)] active:cursor-grabbing ${
        dragging
          ? 'border-dashed border-accent/50 opacity-35'
          : 'border-line-strong hover:-translate-y-0.5 hover:border-accent/60 hover:shadow-[0_14px_36px_-16px_var(--color-glow)]'
      } ${landed ? 'anim-pop-in' : ''}`}
      style={{ touchAction: 'manipulation' }}
    >
      {/* The rail is the PLATFORM, so the week's mix reads across the grid
          at a glance. Status lives on the chip over the creative. */}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-[3px]" style={{ background: colour }} />

      {/* TOPIC FIRST, ON ITS OWN LINE. The one phrase that says what the post
          is about, before anything else on the card is read. It wraps rather
          than truncates — a topic clipped to "AG…" says nothing — and the NEW
          flag flows after it so the two never fight for the width. */}
      <p className="line-clamp-2 text-[10.5px] font-semibold uppercase leading-snug tracking-[0.12em] text-accent-bright" title={topic}>
        {topic}
        {idea.is_new_trend ? <span className="ml-1.5 text-magenta">NEW</span> : null}
      </p>

      {/* THE HOOK. The post's opening line, as it will read on the platform —
          enough to know what the post says without opening it. */}
      <p className={`mt-1.5 font-semibold leading-[1.35] text-ink ${shape.hookLines} ${shape.hookText}`} title={hook}>
        {hook}
      </p>

      {/* THE ANGLE. The direction the post takes, in the agent's own words. */}
      {angle && shape.showAngle ? (
        <p className="mt-1.5 line-clamp-2 text-[11.5px] leading-snug text-ink-2" title={angle}>
          <span className="text-ink-3" aria-hidden="true">↳ </span>
          {angle}
        </p>
      ) : null}

      {/* The platform is the rail, the icon, and the dot in the day header —
          named in full on the overview strip. Spelling it out here too clipped
          to "Faceb…" at every width, which said less than the icon does. */}
      <div className="mt-2 flex items-center gap-1.5 text-[10.5px] text-ink-3">
        <PlatformIcon platform={idea.platform} size={12} className="shrink-0" />
        <span className="sr-only">{PLATFORM_LABEL[idea.platform]}</span>
        <span className="tabular shrink-0">{clock(idea.scheduled_time)}</span>
        <span className="tabular ml-auto shrink-0 font-medium" style={{ color: ink }} title="Confidence">
          {idea.confidence}
        </span>
      </div>

      <div
        className="relative mt-2 overflow-hidden rounded-md"
        style={{
          height: shape.thumb,
          display: shape.thumb === 0 ? 'none' : undefined,
          background: idea.media?.dataUri ? undefined : `linear-gradient(135deg, var(--color-surface-3) 0%, ${colour} 100%)`,
          boxShadow: 'inset 0 0 0 1px color-mix(in srgb, var(--color-ink) 6%, transparent)',
        }}
      >
        {idea.media?.dataUri ? (
          <img
            src={idea.media.dataUri}
            alt=""
            /*
             * NOT DRAGGABLE, AND NOT A POINTER TARGET.
             *
             * An `<img>` is natively draggable. Pressing on one starts an image
             * drag, so `pointerup` never reached the card and the post did not
             * open — which is why only the cards a person happened to click by
             * the TEXT appeared to work. The preview is decoration; the card owns
             * the interaction.
             */
            draggable={false}
            className="pointer-events-none h-full w-full object-cover"
          />
        ) : (
          <>
            <span aria-hidden="true" className="absolute inset-0" style={{ background: 'radial-gradient(120% 90% at 100% 0%, rgba(255, 255, 255, 0.18), transparent 60%)' }} />
            <span className="absolute bottom-[5px] left-[7px] text-[10px] tracking-[0.12em] text-white/85">
              {idea.media?.model ? idea.media.model.toUpperCase() : 'ETHARA · NO CREATIVE YET'}
            </span>
          </>
        )}
        <span
          className="absolute right-1.5 top-[5px] rounded-[3px] px-[5px] py-px text-[10px] tracking-[0.08em]"
          style={{ color: ink, background: 'color-mix(in srgb, var(--color-page) 55%, transparent)' }}
        >
          {chip}
        </span>
      </div>
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE QUEUE — every idea below the cut, with the rank it holds
   ═══════════════════════════════════════════════════════════════════════════ */

function Queue({
  queued,
  capacity,
  weekPrimary,
  cap,
}: {
  queued: Idea[]
  capacity: Array<{ platform: Platform; placed: number; free: number; waiting: number }>
  weekPrimary: Idea[]
  cap: number
}) {
  const promoteIdea = useStore((s) => s.promoteIdea)
  const deleteIdea = useStore((s) => s.deleteIdea)
  const openReview = useStore((s) => s.openReview)
  const [armed, setArmed] = useState<string | null>(null)

  return (
    <section className="flex w-full shrink-0 flex-col bg-surface-2 2xl:sticky 2xl:top-0 2xl:h-[calc(100vh-56px)] 2xl:w-[340px]" aria-label="Ranked queue">
      <div className="min-h-0 flex-1 overflow-y-auto">
        {queued.length === 0 ? (
          <div className="px-4 py-8">
            <p className="text-[13px] font-medium text-ink">Nothing below the cut</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">Every idea the agents formed is on the calendar. Run discovery and Dora will rank more.</p>
          </div>
        ) : null}
        {capacity.map((c) => {
          const rows = queued.filter((i) => i.platform === c.platform).sort((a, b) => (a.platform_rank ?? 99) - (b.platform_rank ?? 99))
          if (rows.length === 0) return null
          // The weakest placed post on this platform is the one a promotion displaces.
          const placed = weekPrimary.filter((i) => i.platform === c.platform)
          const weakest = placed.length >= cap ? placed.reduce((lo, i) => (i.confidence < lo.confidence ? i : lo)) : null
          return (
            <div key={c.platform}>
              <div className="sticky top-0 z-[2] flex items-center gap-2 border-y border-line bg-surface-2 px-3.5 py-[9px]">
                <PlatformIcon platform={c.platform} size={12} />
                <span className="text-[12px] font-semibold tracking-[-0.01em] text-ink">{PLATFORM_LABEL[c.platform]}</span>
                <span className="text-[11px] text-ink-3">{rows.length} waiting</span>
                <span className={`ml-auto text-[11px] tracking-[0.08em] ${c.free > 0 ? 'text-serious' : 'text-ink-3'}`}>
                  {c.free > 0 ? `${c.free} SLOT${c.free === 1 ? '' : 'S'} FREE` : 'FULL'}
                </span>
              </div>
              {rows.map((idea, i) => {
                const isArmed = armed === idea.id
                return (
                  <article
                    key={idea.id}
                    className="border-t border-line px-3.5 py-2.5 transition-colors duration-200 hover:bg-surface-3"
                    style={{ animation: `eth-row-stream 200ms ${EASE} ${i * 40}ms both` }}
                  >
                    <div className="flex items-start gap-2">
                      <span className="tabular w-[22px] shrink-0 pt-px text-[10.5px] text-ink-3">#{idea.platform_rank ?? '–'}</span>
                      <div className="min-w-0 flex-1">
                        {/* Topic first, here as on the calendar cards. */}
                        <div className="flex items-center gap-1.5">
                          <span className="min-w-0 truncate text-[10px] font-semibold uppercase tracking-[0.12em] text-accent-bright" title={topicOf(idea)}>
                            {topicOf(idea)}
                          </span>
                          <PlatformIcon platform={idea.platform} size={10} className="shrink-0" />
                          <span className="tabular ml-auto shrink-0 text-[10.5px] text-ink-3">{idea.confidence}%</span>
                        </div>
                        <button type="button" onClick={() => openReview(idea.id)} className="mt-0.5 block w-full text-left text-[12px] font-medium leading-snug text-ink hover:text-accent-bright">
                          {idea.title}
                        </button>
                        {typeof idea.analysis.angle === 'string' ? (
                          <p className="mt-0.5 line-clamp-1 text-[11px] leading-snug text-ink-3" title={idea.analysis.angle}>
                            <span aria-hidden="true">↳ </span>
                            {idea.analysis.angle}
                          </p>
                        ) : null}
                      </div>
                    </div>

                    {isArmed ? (
                      <div className={`mt-2 border-l pl-[9px] ${c.free > 0 ? 'border-good/60' : 'border-serious/60'}`} style={{ animation: `eth-row-stream 260ms ${EASE} both` }}>
                        {c.free > 0 ? (
                          <>
                            <div className="text-[10.5px] tracking-[0.12em] text-good-ink">A SLOT IS FREE</div>
                            <div className="mt-1 text-[11.5px] leading-relaxed text-ink-2">Takes the first open slot on {PLATFORM_LABEL[c.platform]}. Nothing is displaced.</div>
                          </>
                        ) : (
                          <>
                            <div className="text-[10.5px] tracking-[0.12em] text-serious">PROMOTING THIS DISPLACES</div>
                            <div className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
                              #{cap} <strong className="font-semibold">“{weakest?.title ?? 'the weakest placed post'}”</strong> — which returns to this queue with its rank. Nothing is deleted.
                            </div>
                          </>
                        )}
                        {idea.status === 'suggested' ? (
                          <div className="mt-1 text-[11px] text-ink-3">no caption yet · SpongeBob drafts it once it holds a slot</div>
                        ) : null}
                      </div>
                    ) : null}

                    <div className="mt-[9px] flex gap-1.5">
                      <button
                        type="button"
                        onClick={() => {
                          if (!isArmed) {
                            setArmed(idea.id)
                            return
                          }
                          setArmed(null)
                          void promoteIdea(idea.id)
                        }}
                        className={`rounded-[5px] border px-2.5 py-1 text-[11px] font-semibold transition-colors duration-[220ms] ${
                          isArmed
                            ? 'border-accent bg-accent text-on-accent hover:bg-accent-bright'
                            : 'border-hud-strong bg-accent/12 text-accent-bright hover:border-accent'
                        }`}
                      >
                        {isArmed ? 'Confirm promotion' : 'Promote'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          if (isArmed) {
                            setArmed(null)
                            return
                          }
                          void deleteIdea(idea.id)
                        }}
                        className="rounded-[5px] border border-line-strong px-2.5 py-1 text-[11px] font-medium text-ink-2 transition-colors duration-[220ms] hover:border-critical/50 hover:text-critical-ink"
                      >
                        {isArmed ? 'Cancel' : 'Withdraw'}
                      </button>
                    </div>
                  </article>
                )
              })}
            </div>
          )
        })}
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   GROUND AND FACE
   ═══════════════════════════════════════════════════════════════════════════ */

function AgentFace() {
  return (
    <span aria-hidden="true" className="relative inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center">
      <span className="absolute -inset-[3px] rounded-full" style={{ background: 'radial-gradient(circle, var(--color-hud-strong), transparent 70%)', animation: 'eth-agent-glow 4.5s cubic-bezier(0.37, 0, 0.63, 1) infinite' }} />
      <svg viewBox="0 0 40 40" width={34} height={34} className="relative" style={{ animation: 'eth-agent-bob 3.6s cubic-bezier(0.37, 0, 0.63, 1) infinite' }}>
        <defs>
          <linearGradient id="eth-face" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="var(--color-surface-3)" />
            <stop offset="100%" stopColor="var(--color-surface)" />
          </linearGradient>
        </defs>
        <line x1={20} y1={7} x2={20} y2={3.5} stroke="var(--color-accent)" strokeWidth={1.6} strokeLinecap="round" />
        <circle cx={20} cy={2.6} r={1.9} fill="var(--color-magenta)">
          <animate attributeName="opacity" values="1;0.35;1" dur="2.4s" repeatCount="indefinite" />
        </circle>
        <rect x={6} y={8} width={28} height={26} rx={11} fill="url(#eth-face)" stroke="var(--color-accent)" strokeWidth={1.2} />
        <rect x={9.5} y={12} width={21} height={16} rx={8} fill="var(--color-page)" />
        <g style={{ transformOrigin: '14.5px 19px', animation: 'eth-agent-blink 5.2s linear infinite' }}>
          <ellipse cx={14.5} cy={19} rx={2} ry={2.6} fill="var(--color-accent-bright)" />
          <circle cx={15.1} cy={18.1} r={0.7} fill="var(--color-ink)" />
        </g>
        <g style={{ transformOrigin: '25.5px 19px', animation: 'eth-agent-blink 5.2s linear 0.08s infinite' }}>
          <ellipse cx={25.5} cy={19} rx={2} ry={2.6} fill="var(--color-accent-bright)" />
          <circle cx={26.1} cy={18.1} r={0.7} fill="var(--color-ink)" />
        </g>
        <path d="M15.5 24.2 Q20 27.4 24.5 24.2" fill="none" stroke="var(--color-accent-bright)" strokeWidth={1.5} strokeLinecap="round" />
        <circle cx={11.2} cy={23} r={1.3} fill="var(--color-magenta)" opacity={0.7} />
        <circle cx={28.8} cy={23} r={1.3} fill="var(--color-magenta)" opacity={0.7} />
      </svg>
    </span>
  )
}

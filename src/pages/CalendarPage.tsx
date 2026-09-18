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
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { useStore } from '../store'
import { CalendarAssistant } from '../components/assistant/calendar-assistant'
import { PlatformIcon, PLATFORM_LABEL, PLATFORM_TOKEN } from '../components/ui'
import { BackToHub } from '../components/layout'
import type { Idea, IdeaStatus, Platform } from '../types'

const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'x', 'facebook']
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

/*
 * ── Column width, shared across the whole week ──────────────────────────────
 *
 * The seven day-columns share ONE width. Resizing any column's edge writes this
 * single number, so every column changes together — a week is not a week if
 * Tuesday is wider than Wednesday. Zero means "auto": the responsive grid
 * decides, which is the original behaviour. Any positive value pins every column
 * to that pixel width and the week scrolls sideways when the total overflows.
 *
 * The floor is the narrowest a title stays readable; the ceiling is wide enough
 * to show a whole hook and topic without opening the card, which is the point of
 * being able to widen it at all.
 */
const COLUMN_MIN = 150
const COLUMN_MAX = 460
const COLUMN_WIDTH_KEY = 'ethara.calendar.columnWidth'

/** Above this width a card stops clamping and shows the whole topic and hook. */
const WIDE_CARD_AT = 260

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


/**
 * What a card shows at a given width. Narrow cards drop the creative and
 * keep two lines of hook; wide ones show five lines and a taller creative.
 * The width is the one control; everything else follows from it.
 */

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

/**
 * HORIZONTAL GESTURES CHANGE THE WEEK.
 *
 * The arrows worked, but a calendar is a thing people expect to swipe, and on a
 * trackpad a two-finger horizontal gesture had no meaning at all — it nudged the
 * grid a few pixels against its own edge and stopped.
 *
 * Three inputs, one outcome: touch drag, and trackpad horizontal wheel.
 *
 * WHY NOT JUST A SCROLL CONTAINER. The week is seven fixed columns; there is no
 * eighth column to scroll to. Interpreting the gesture as a week change is what
 * gives it meaning instead of letting it dead-end.
 *
 * The drag offset renders live so the grid follows the finger, then snaps back.
 * A gesture that only acts on release feels broken on touch, because nothing
 * moves while you are moving.
 */
function useWeekSwipe(onChange: (direction: 1 | -1) => void): {
  handlers: {
    onTouchStart: (e: React.TouchEvent) => void
    onTouchMove: (e: React.TouchEvent) => void
    onTouchEnd: () => void
    onWheel: (e: React.WheelEvent) => void
  }
  style: { transform?: string; transition?: string }
} {
  const [dragX, setDragX] = useState(0)
  const start = useRef<{ x: number; y: number } | null>(null)
  /*
   * A wheel gesture arrives as dozens of events. Without this latch one flick
   * would advance five weeks — the same reason a carousel debounces a trackpad.
   */
  const wheelLocked = useRef(false)

  /** Past this many pixels the gesture is a week change, not stray movement. */
  const THRESHOLD = 70

  return {
    handlers: {
      onTouchStart: (e) => {
        const t = e.touches[0]
        if (t) start.current = { x: t.clientX, y: t.clientY }
      },
      onTouchMove: (e) => {
        const t = e.touches[0]
        if (!t || start.current === null) return
        const dx = t.clientX - start.current.x
        const dy = t.clientY - start.current.y
        // Vertical intent wins: someone scrolling the page must not change week.
        if (Math.abs(dy) > Math.abs(dx)) return
        setDragX(dx)
      },
      onTouchEnd: () => {
        // Drag LEFT (negative) reveals what lies to the right: the next week.
        if (Math.abs(dragX) >= THRESHOLD) onChange(dragX < 0 ? 1 : -1)
        setDragX(0)
        start.current = null
      },
      onWheel: (e) => {
        // Only a decisively horizontal gesture. A slightly-off vertical scroll
        // must keep scrolling the page.
        if (Math.abs(e.deltaX) <= Math.abs(e.deltaY) || Math.abs(e.deltaX) < 24) return
        if (wheelLocked.current) return
        wheelLocked.current = true
        onChange(e.deltaX > 0 ? 1 : -1)
        window.setTimeout(() => {
          wheelLocked.current = false
        }, 420)
      },
    },
    style:
      dragX === 0
        ? { transition: 'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)' }
        : // Damped, so the grid follows the finger without sliding off-screen.
          { transform: `translateX(${dragX * 0.35}px)`, transition: 'none' },
  }
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
  const scheduleIdeaOnDay = useStore((s) => s.scheduleIdeaOnDay)
  const deleteIdea = useStore((s) => s.deleteIdea)

  /* ── Card size ────────────────────────────────────────────────────── */
  /** So a day with room can point at the only place a post reaches a slot. */
  const queueRef = useRef<HTMLElement | null>(null)

  /*
   * ── Column width, one value for all seven columns ──────────────────────
   *
   * Restored from localStorage so a chosen width survives a reload. Zero is the
   * responsive "auto" default. A resize handle on any column's edge writes here,
   * and every column reads from it — so widening one widens the week.
   */
  const [columnWidth, setColumnWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 0
    const stored = Number(window.localStorage.getItem(COLUMN_WIDTH_KEY))
    if (!Number.isFinite(stored) || stored <= 0) return 0
    return Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, stored))
  })
  useEffect(() => {
    if (typeof window === 'undefined') return
    if (columnWidth <= 0) window.localStorage.removeItem(COLUMN_WIDTH_KEY)
    else window.localStorage.setItem(COLUMN_WIDTH_KEY, String(columnWidth))
  }, [columnWidth])

  /*
   * The resize gesture. Grabbing a column edge captures the pointer and maps
   * horizontal travel to the shared width, clamped to a readable range. It reads
   * the grabbed column's real rendered width first, so a drag that starts in
   * "auto" mode continues smoothly from wherever the layout had placed it rather
   * than jumping to a default.
   */
  const resizeRef = useRef<{ id: number; startX: number; startWidth: number } | null>(null)
  const beginResize = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const column = event.currentTarget.closest<HTMLElement>('[data-day]')
    const startWidth = columnWidth > 0 ? columnWidth : (column?.getBoundingClientRect().width ?? COLUMN_MIN)
    resizeRef.current = { id: event.pointerId, startX: event.clientX, startWidth }
    try {
      event.currentTarget.setPointerCapture(event.pointerId)
    } catch {
      // Pointer already released; the resize simply will not start.
    }
    document.body.classList.add('is-resizing')
  }
  const onResizeMove = (event: React.PointerEvent<HTMLElement>): void => {
    const r = resizeRef.current
    if (!r) return
    const next = Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, r.startWidth + (event.clientX - r.startX)))
    setColumnWidth(next)
  }
  const endResize = (event: React.PointerEvent<HTMLElement>): void => {
    if (!resizeRef.current) return
    resizeRef.current = null
    document.body.classList.remove('is-resizing')
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Capture already gone.
    }
  }
  // Only an explicitly-widened column shows the whole topic and hook; "auto"
  // keeps the original responsive clamp so a narrow laptop still reads cleanly.
  const isWide = columnWidth >= WIDE_CARD_AT

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
    if (!target) return
    const isSuggestion = current.idea.calendar_slot !== 'primary'
    // A suggestion promotes onto the day even when its stored date already
    // matches — it was never on the grid. A primary only counts as a move when
    // the day actually changes.
    if (isSuggestion) {
      setJustMoved(current.idea.id)
      void scheduleIdeaOnDay(current.idea.id, target)
    } else if (target !== current.idea.scheduled_date) {
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
  /* Swipe or two-finger scroll the grid to move a week. */
  const weekSwipe = useWeekSwipe((direction) => setWeekOffset((w) => w + direction))
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


  /*
   * The page grows with its content and `main` scrolls it. Inner scrollers
   * here trapped the height: the week section held `flex-1 overflow-auto`, so
   * it consumed the viewport, never grew, and the suggestions beneath it
   * could not be reached by scrolling the page.
   */
  return (
    <div className="-mx-4 -mt-4 -mb-2 flex min-h-0 flex-1 flex-col">
      {/* ── Command bar ─────────────────────────────────────────────────── */}
      <header className="glass relative z-20 flex min-h-[58px] shrink-0 flex-wrap items-center gap-3.5 border-b border-line px-[18px] py-1.5">
        <div className="min-w-0">
          <BackToHub className="!mb-0.5" />
          <h1 className="whitespace-nowrap text-[20px] font-semibold tracking-[-0.02em] text-ink">Weekly Calendar</h1>
        </div>
        <div className="ml-auto flex items-center gap-2">
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
      <div className="flex flex-1 flex-col">
        <section className="relative min-w-0 px-[18px] pb-3.5 pt-3.5">
          <div className="glass-panel rounded-[18px] px-4 py-3.5">
          <div className="relative z-10 mb-2.5 flex items-center gap-2.5">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.015em] text-ink">
              {totalPlaced} slot{totalPlaced === 1 ? '' : 's'} placed
            </h2>
            <span className="text-[10.5px] text-ink-3">
              {totalFree} of {cap * PLATFORMS.length} slots free · drag a card to another day, or drag a column edge to resize
            </span>
            <span className="flex-1" />
            {columnWidth > 0 ? (
              <button
                type="button"
                onClick={() => setColumnWidth(0)}
                title="Return every column to the automatic width"
                className="mono rounded-[6px] border border-line-strong px-2 py-[3px] text-[8.5px] uppercase tracking-[0.08em] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
              >
                {columnWidth}px · reset width
              </button>
            ) : null}
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
              {...weekSwipe.handlers}
              className={
                // `touch-pan-y` keeps vertical page scrolling native while the
                // horizontal axis becomes ours to read as a week change.
                `touch-pan-y ${
                  columnWidth > 0
                    ? 'grid items-start gap-2 overflow-x-auto pb-1'
                    : 'grid items-start gap-2 md:grid-cols-4 xl:grid-cols-7'
                }`
              }
              style={{
                ...(columnWidth > 0 ? { gridTemplateColumns: `repeat(7, ${columnWidth}px)` } : {}),
                ...weekSwipe.style,
              }}
          >
            {days.map((day, i) => {
              const iso = isoDate(day)
              const dayIdeas = primary
                .filter((idea) => idea.scheduled_date === iso)
                .sort((a, b) => timeValue(a.scheduled_time) - timeValue(b.scheduled_time))
              const isToday = iso === todayIso
              // A suggestion is not on the grid, so any day under it is a valid
              // drop; a primary only highlights a day other than the one it holds.
              const isDropTarget =
                drag !== null &&
                drag.overIso === iso &&
                (drag.idea.calendar_slot !== 'primary' || drag.idea.scheduled_date !== iso)
              return (
                <div
                  key={iso}
                  data-day={iso}
                  /* Today is a lit column and a dragged card lights the one
                     under it, brighter — the drop reads before it lands. */
                  className={`group/day relative flex min-w-0 flex-col gap-[7px] rounded-[13px] p-1.5 transition-[background-color,box-shadow] duration-[var(--dur-fast)] ${
                    isDropTarget
                      ? 'bg-accent/[0.14] ring-2 ring-accent/60'
                      : isToday
                        ? 'bg-accent/[0.08] ring-1 ring-accent/35'
                        : drag !== null
                          ? 'ring-1 ring-line'
                          : ''
                  }`}
                  style={{ animation: `eth-rise 420ms ${EASE} ${120 + i * 50}ms both` }}
                >
                  <header className="flex items-baseline gap-[5px] px-0.5">
                    <span className={`mono text-[8px] uppercase ${isToday ? 'text-accent-bright' : 'text-ink-3'}`}>
                      {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                    </span>
                    <span className="text-[13px] font-bold text-ink">{day.getDate()}</span>
                    <span className="flex-1" />
                    {isToday ? (
                      <span className="mono rounded-[5px] bg-accent px-1.5 py-px text-[7px] uppercase tracking-[0.08em] text-on-accent">today</span>
                    ) : (
                      <span className="mono text-[7.5px] uppercase text-ink-3">
                        {dayIdeas.length === 0 ? '—' : `${dayIdeas.length} post${dayIdeas.length === 1 ? '' : 's'}`}
                      </span>
                    )}
                  </header>

                  {dayIdeas.map((idea) => (
                    <SlotCard
                      key={idea.id}
                      idea={idea}
                      wide={isWide}
                      dragging={drag?.idea.id === idea.id}
                      landed={justMoved === idea.id}
                      onOpen={() => openReview(idea.id)}
                      onDrag={onCardDrag}
                      onWithdraw={() => void deleteIdea(idea.id)}
                    />
                  ))}

                  {/* A day with room. It says where a dragged card would land,
                      and otherwise points at the queue — which is the only way
                      a post actually reaches a slot. */}
                  <button
                    type="button"
                    onClick={() => queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                    className={`mono rounded-[9px] border border-dashed py-[7px] text-center text-[7.5px] uppercase tracking-[0.08em] transition-colors duration-[var(--dur-fast)] ${
                      isDropTarget ? 'border-accent text-accent-bright' : 'border-line-strong text-ink-3 hover:border-accent hover:text-accent-bright'
                    } ${dayIdeas.length === 0 ? 'py-[22px]' : ''}`}
                  >
                    {isDropTarget ? 'move here' : dayIdeas.length === 0 ? 'no posts · promote one' : 'promote one'}
                  </button>

                  {/* RESIZE HANDLE — the right edge of every column is a grip,
                      and all seven write the same shared width, so widening one
                      widens the week. It sits half over the gap between columns,
                      is faint until the column is hovered, and never starts a
                      card drag because it stops the pointer at its own edge. */}
                  <span
                    role="separator"
                    aria-label="Resize calendar columns"
                    aria-orientation="vertical"
                    title="Drag to resize every column"
                    onPointerDown={beginResize}
                    onPointerMove={onResizeMove}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    className="absolute -right-1 top-0 z-20 flex h-full w-2 cursor-col-resize touch-none items-center justify-center opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover/day:opacity-100"
                  >
                    <span className="h-10 w-[3px] rounded-full bg-line-strong transition-colors hover:bg-accent" aria-hidden="true" />
                  </span>
                </div>
              )
            })}
          </div>
          </div>
        </section>

        <Queue
          queueRef={queueRef}
          queued={queued}
          capacity={capacity}
          weekPrimary={weekPrimary}
          cap={cap}
          onDrag={onCardDrag}
          draggingId={drag?.idea.id ?? null}
        />
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
              : drag.idea.calendar_slot !== 'primary'
                ? `Schedule on ${dayLabelOf(drag.overIso)}`
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
  wide,
  dragging,
  landed,
  onOpen,
  onDrag,
  onWithdraw,
}: {
  idea: Idea
  wide: boolean
  dragging: boolean
  landed: boolean
  onOpen: () => void
  onDrag: (idea: Idea, phase: DragPhase, point: DragPoint, rect?: DOMRect) => void
  onWithdraw: () => void
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
      className={`group relative flex cursor-grab select-none flex-col overflow-hidden rounded-[11px] border bg-surface-2/60 px-2.5 py-2.5 transition-[border-color,translate,box-shadow,opacity] duration-[var(--dur-base)] active:cursor-grabbing ${
        dragging
          ? 'border-dashed border-accent/50 opacity-35'
          : 'border-line hover:!translate-y-[-2px] hover:border-accent/60 hover:shadow-[0_14px_36px_-16px_var(--color-glow)]'
      } ${landed ? 'anim-pop-in' : ''}`}
      style={{ touchAction: 'manipulation' }}
    >
      {/* Taking a card out of the week. The platform never destroys a post:
          this withdraws it, which frees the slot and keeps the idea and its
          lineage on record. It is revealed on hover so the week stays calm,
          and it stops the press from starting a drag or opening the editor. */}
      <button
        type="button"
        title={`Withdraw “${idea.title}” from this slot`}
        aria-label={`Withdraw “${idea.title}” from this slot. The post is kept on record, not deleted.`}
        onPointerDown={(event) => event.stopPropagation()}
        onPointerUp={(event) => event.stopPropagation()}
        onClick={(event) => { event.stopPropagation(); onWithdraw() }}
        onKeyDown={(event) => event.stopPropagation()}
        className="absolute right-1.5 top-1.5 z-10 flex h-[18px] w-[18px] items-center justify-center rounded-md border border-line-strong bg-surface text-ink-3 opacity-0 transition-[opacity,color,border-color] duration-[var(--dur-fast)] hover:border-critical hover:text-critical focus-visible:opacity-100 group-hover:opacity-100"
      >
        <X size={10} aria-hidden="true" />
      </button>

      {/* platform · time · status — the design's top row */}
      <div className="flex items-center gap-1.5">
        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]"
          style={{ background: `color-mix(in srgb, ${colour} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${colour} 35%, transparent)` }}
        >
          <PlatformIcon platform={idea.platform} size={9} />
        </span>
        <span className="sr-only">{PLATFORM_LABEL[idea.platform]}</span>
        <span className="mono text-[8.5px] text-accent-bright">{clock(idea.scheduled_time)}</span>
        <span className="flex-1" />
        <span
          className="mono shrink-0 rounded-[5px] px-[5px] py-px text-[7px] uppercase tracking-[0.08em]"
          style={{ color: ink, background: `color-mix(in srgb, ${ink} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${ink} 34%, transparent)` }}
        >
          {chip}
        </span>
      </div>

      {/* The hook. Clamped to two lines at the default width; a widened column
          drops the clamp so the whole opening line reads without opening the card. */}
      <p className={`mt-[7px] text-[11px] font-medium leading-[1.35] text-ink ${wide ? '' : 'line-clamp-2'}`} title={hook}>
        {hook}
        {idea.is_new_trend ? <span className="mono ml-1.5 text-[8px] text-magenta">NEW</span> : null}
      </p>

      {/* the angle the agent took, and its confidence */}
      <div className="mt-[7px] flex items-center gap-1.5">
        <span className={`mono min-w-0 flex-1 text-[8px] text-ink-3 ${wide ? '' : 'truncate'}`} title={angle ?? topic}>
          <span aria-hidden="true">↳ </span>
          {angle ?? topic}
        </span>
        <span className="mono shrink-0 text-[8.5px] text-accent-bright" title="Confidence">{idea.confidence}</span>
      </div>
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE QUEUE — every idea below the cut, with the rank it holds
   ═══════════════════════════════════════════════════════════════════════════ */

function Queue({
  queueRef,
  queued,
  capacity,
  weekPrimary,
  cap,
  onDrag,
  draggingId,
}: {
  queueRef: React.Ref<HTMLElement>
  queued: Idea[]
  capacity: Array<{ platform: Platform; placed: number; free: number; waiting: number }>
  weekPrimary: Idea[]
  cap: number
  onDrag: (idea: Idea, phase: DragPhase, point: DragPoint, rect?: DOMRect) => void
  draggingId: string | null
}) {
  const promoteIdea = useStore((s) => s.promoteIdea)
  const deleteIdea = useStore((s) => s.deleteIdea)
  const openReview = useStore((s) => s.openReview)
  const [armed, setArmed] = useState<string | null>(null)

  /** Which platform the suggestions list is narrowed to, or null for all. */
  const [suggestionFilter, setSuggestionFilter] = useState<Platform | null>(null)

  /*
   * One ranked line per idea, strongest rank first — narrowed to one platform
   * when a chip is active.
   *
   * The filter applies to the LIST, not to `queued`: the chips themselves must
   * keep showing every platform's counts, or selecting one would hide the way
   * back to the others.
   */
  const ranked = [...queued]
    .filter((i) => suggestionFilter === null || i.platform === suggestionFilter)
    .sort(
      (a, b) => (a.platform_rank ?? 99) - (b.platform_rank ?? 99) || b.confidence - a.confidence,
    )
  /* What each platform has free, and what a promotion there would displace. */
  const seats = new Map(
    capacity.map((c) => {
      const placed = weekPrimary.filter((i) => i.platform === c.platform)
      return [
        c.platform,
        {
          free: c.free,
          weakest: placed.length >= cap && placed.length > 0
            ? placed.reduce((lo, i) => (i.confidence < lo.confidence ? i : lo))
            : null,
        },
      ] as const
    }),
  )
  return (
    <section ref={queueRef} className="flex w-full shrink-0 flex-col border-t border-line bg-surface-2" aria-label="Ranked queue">
      <header className="flex flex-wrap items-center gap-2.5 px-[18px] pb-2 pt-3.5">
        <h2 className="text-[12.5px] font-bold text-ink">More suggestions</h2>
        <span className="text-[10px] text-ink-3">
          {queued.length === 0
            ? 'everything the agents formed is on the calendar'
            : suggestionFilter !== null
              ? `${ranked.length} ${PLATFORM_LABEL[suggestionFilter]} suggestion${ranked.length === 1 ? '' : 's'} · click the chip again to show all`
              : `${queued.length} ranked below the cut · drag one onto a day, or promote it`}
        </span>
        <span className="flex-1" />
        {/*
          THE NUMBER MUST BE THE ONE THE CONTROL ACTS ON.
          These chips filter the SUGGESTIONS list, but they were rendering
          `free` — how many calendar slots were open — under a "slots free"
          label. Instagram then read 5 while having nothing queued, so clicking
          it filtered to an empty list, and the tooltip said "nothing waiting"
          directly beneath the 5. Two true numbers, one of them answering a
          question nobody asked here.
        */}
        <span className="mono text-[7.5px] uppercase tracking-[0.06em] text-ink-3">waiting</span>
        {capacity.map((c) => {
          const isActive = suggestionFilter === c.platform
          const waiting = queued.filter((i) => i.platform === c.platform).length
          return (
            <button
              key={c.platform}
              type="button"
              /*
               * A FILTER, NOT A READOUT.
               *
               * These already carried the one piece of information needed to
               * decide which platform to look at, so making them the control
               * that narrows the list removes a separate filter row. Clicking an
               * active chip clears it — a filter with no visible way back out
               * traps the operator in a subset of their own queue.
               */
              onClick={() => setSuggestionFilter(isActive ? null : c.platform)}
              aria-pressed={isActive}
              title={
                waiting === 0
                  ? `${PLATFORM_LABEL[c.platform]}: nothing waiting · ${c.free} of ${cap} slots free`
                  : isActive
                    ? `Showing ${PLATFORM_LABEL[c.platform]} only — click to show every platform`
                    : `Show only ${PLATFORM_LABEL[c.platform]} — ${waiting} waiting · ${c.free} of ${cap} slots free`
              }
              className={`mono inline-flex items-center gap-1 rounded-[5px] px-1.5 py-px text-[8px] transition-[box-shadow,opacity] duration-200 hover:opacity-100 ${
                // A chip for a platform with nothing queued would filter to an
                // empty list, so it is dimmed rather than presented as useful.
                waiting === 0 ? 'opacity-45' : 'cursor-pointer'
              }`}
              style={{
                color: PLATFORM_TOKEN[c.platform],
                background: `color-mix(in srgb, ${PLATFORM_TOKEN[c.platform]} ${isActive ? 26 : 13}%, transparent)`,
                border: `1px solid color-mix(in srgb, ${PLATFORM_TOKEN[c.platform]} ${isActive ? 70 : 32}%, transparent)`,
                boxShadow: isActive
                  ? `0 0 0 1px color-mix(in srgb, ${PLATFORM_TOKEN[c.platform]} 45%, transparent)`
                  : undefined,
              }}
            >
              <PlatformIcon platform={c.platform} size={8} />
              {waiting}
            </button>
          )
        })}
      </header>
      {ranked.length === 0 ? (
        <div className="px-[18px] pb-5">
          {suggestionFilter === null ? (
            <>
              <p className="text-[13px] font-medium text-ink">Nothing below the cut</p>
              <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">Every idea the agents formed is on the calendar. Run discovery and Dora will rank more.</p>
            </>
          ) : (
            /* A filtered-empty list is a different fact from an empty queue, and
               saying so is what tells the operator to clear the filter rather
               than run discovery again. */
            <>
              <p className="text-[13px] font-medium text-ink">Nothing waiting for {PLATFORM_LABEL[suggestionFilter]}</p>
              <button
                type="button"
                onClick={() => setSuggestionFilter(null)}
                className="mt-1 text-[11.5px] leading-relaxed text-accent-bright underline decoration-dotted"
              >
                Show every platform
              </button>
            </>
          )}
        </div>
      ) : (
        /*
         * ONE RANKED LIST, THE WAY THE DESIGN DRAWS IT.
         *
         * This was four per-platform columns. The design is a single ranked
         * line-per-idea list, and it does not lose the platform: each row
         * carries its own badge, the header counts free slots per platform,
         * and the footer names the platforms holding nothing. A flat list also
         * stops the tallest platform dictating the height of three empty
         * neighbours.
         */
        <div className="flex flex-col gap-2.5 px-[18px] pb-5">
          <div className="flex flex-col gap-1.5" role="list" aria-label="Ranked suggestions">
            {ranked.map((idea, i) => {
              const isArmed = armed === idea.id
              const seat = seats.get(idea.platform)
              const free = seat?.free ?? 0
              return (
                <QueueRow
                  key={idea.id}
                  idea={idea}
                  index={i}
                  isArmed={isArmed}
                  free={free}
                  weakestTitle={seat?.weakest?.title ?? null}
                  cap={cap}
                  dragging={draggingId === idea.id}
                  onDrag={onDrag}
                  onOpen={() => openReview(idea.id)}
                  onPromote={() => {
                    if (!isArmed) { setArmed(idea.id); return }
                    setArmed(null)
                    void promoteIdea(idea.id)
                  }}
                  onWithdraw={() => {
                    if (isArmed) { setArmed(null); return }
                    void deleteIdea(idea.id)
                  }}
                />
              )
            })}
          </div>

          {/* What the list is not showing, said plainly. */}
          <footer className="mono flex flex-wrap items-center gap-x-3.5 gap-y-1 border-t border-line pt-[9px] text-[8px] uppercase tracking-[0.06em] text-ink-3">
            <span>{ranked.length} waiting · every one is listed</span>
          </footer>
        </div>
      )}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   A QUEUE ROW — a ranked suggestion that can be dragged onto a calendar day
   ───────────────────────────────────────────────────────────────────────────
   Same drag mechanism as the calendar's SlotCard, and for the same reason:
   the file's history records that the HTML5 `draggable` API and a reliable
   click on one element are incompatible. So the drag is pointer events by
   hand — a press that travels more than six pixels becomes a drag; one that
   does not leaves the row's own buttons (open · promote · withdraw) to handle
   the click. Those buttons stop pointer propagation so a press on them never
   starts a drag. Dropping the row on a day PROMOTES it onto the calendar and
   lands it there, via scheduleIdeaOnDay.
   ═══════════════════════════════════════════════════════════════════════════ */

function QueueRow({
  idea,
  index,
  isArmed,
  free,
  weakestTitle,
  cap,
  dragging,
  onDrag,
  onOpen,
  onPromote,
  onWithdraw,
}: {
  idea: Idea
  index: number
  isArmed: boolean
  free: number
  weakestTitle: string | null
  cap: number
  dragging: boolean
  onDrag: (idea: Idea, phase: DragPhase, point: DragPoint, rect?: DOMRect) => void
  onOpen: () => void
  onPromote: () => void
  onWithdraw: () => void
}) {
  const angle = typeof idea.analysis.angle === 'string' ? idea.analysis.angle : topicOf(idea)
  const colour = PLATFORM_TOKEN[idea.platform]

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
  }
  const onPointerCancel = (): void => {
    const p = press.current
    press.current = null
    if (!p) return
    if (p.timer !== null) window.clearTimeout(p.timer)
    if (p.dragging) onDrag(idea, 'cancel', { x: 0, y: 0 })
  }

  // The row's own controls: a press that lands on one must not begin a drag,
  // so each stops the pointer at its edge and keeps its ordinary click.
  const stop = {
    onPointerDown: (event: React.PointerEvent) => event.stopPropagation(),
    onPointerUp: (event: React.PointerEvent) => event.stopPropagation(),
  }

  return (
    <article
      ref={node}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      aria-label={`${idea.title}. Drag onto a day to schedule it, or use the buttons.`}
      className={`cursor-grab select-none rounded-[11px] border bg-surface px-2.5 py-[7px] transition-colors duration-200 active:cursor-grabbing ${
        dragging ? 'border-dashed border-accent/50 opacity-35' : 'border-line hover:border-accent/60'
      }`}
      style={{ animation: `eth-row-stream 200ms ${EASE} ${index * 40}ms both`, touchAction: 'manipulation' }}
    >
      <div className="flex items-center gap-2.5">
        <span className="tabular w-[22px] shrink-0 text-[8.5px] text-ink-3" title="Rank on its platform">
          #{idea.platform_rank ?? '–'}
        </span>

        <button
          type="button"
          {...stop}
          onClick={onOpen}
          className="min-w-0 flex-1 text-left"
          title={idea.title}
        >
          <span className="block truncate text-[11px] font-medium text-ink transition-colors hover:text-accent-bright">
            {idea.title}
          </span>
          <span className="mono mt-0.5 block truncate text-[8px] text-ink-3" title={angle}>
            <span aria-hidden="true">↳ </span>{angle}
          </span>
        </button>

        <span
          className="flex h-4 w-4 shrink-0 items-center justify-center rounded-[5px]"
          style={{ background: `color-mix(in srgb, ${colour} 14%, transparent)`, border: `1px solid color-mix(in srgb, ${colour} 35%, transparent)` }}
          title={PLATFORM_LABEL[idea.platform]}
        >
          <PlatformIcon platform={idea.platform} size={9} />
        </span>
        <span className="sr-only">{PLATFORM_LABEL[idea.platform]}</span>

        <span className="tabular w-[30px] shrink-0 text-right text-[8.5px] text-accent-bright" title="Confidence">
          {idea.confidence}%
        </span>

        <button
          type="button"
          {...stop}
          onClick={onPromote}
          className={`shrink-0 rounded-[8px] border px-3 py-1 text-[10px] font-semibold transition-colors duration-[220ms] ${
            isArmed
              ? 'border-accent bg-accent text-on-accent hover:bg-accent-bright'
              : 'border-hud-strong bg-accent/12 text-accent-bright hover:border-accent'
          }`}
        >
          {isArmed ? 'Confirm' : 'Promote'}
        </button>
        <button
          type="button"
          {...stop}
          onClick={onWithdraw}
          className="shrink-0 rounded-[8px] border border-line-strong px-2.5 py-1 text-[10px] font-medium text-ink-2 transition-colors duration-[220ms] hover:border-critical/50 hover:text-critical-ink"
        >
          {isArmed ? 'Cancel' : 'Withdraw'}
        </button>
      </div>

      {/* Promotion can displace a placed post, so it states the
          consequence and waits. Nothing here is irreversible. */}
      {isArmed ? (
        <div
          className={`mt-2 border-l pl-[9px] ${free > 0 ? 'border-good/60' : 'border-serious/60'}`}
          style={{ animation: `eth-row-stream 260ms ${EASE} both` }}
        >
          {free > 0 ? (
            <>
              <div className="mono text-[9px] uppercase tracking-[0.12em] text-good-ink">A slot is free</div>
              <div className="mt-1 text-[11px] leading-relaxed text-ink-2">
                Takes the first open slot on {PLATFORM_LABEL[idea.platform]}. Nothing is displaced.
              </div>
            </>
          ) : (
            <>
              <div className="mono text-[9px] uppercase tracking-[0.12em] text-serious">Promoting this displaces</div>
              <div className="mt-1 text-[11px] leading-relaxed text-ink-2">
                #{cap} <strong className="font-semibold">“{weakestTitle ?? 'the weakest placed post'}”</strong> — which returns to this queue with its rank. Nothing is deleted.
              </div>
            </>
          )}
          {idea.status === 'suggested' ? (
            <div className="mt-1 text-[11px] text-ink-3">no caption yet · SpongeBob drafts it once it holds a slot</div>
          ) : null}
        </div>
      ) : null}
    </article>
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

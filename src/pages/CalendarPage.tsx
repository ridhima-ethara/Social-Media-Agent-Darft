/**
 * WEEKLY CALENDAR
 *
 *   Validated topics → Calendar Agent
 *     → today:     post ready
 *     → tomorrow:  post ready when the posting schedule requires it
 *     → later:     topic only, in the Topic Queue → Generate Post on demand
 *
 * Capacity is the first thing you see: five pips per platform, filled or free.
 * The week shows every placed topic; a post-ready day's card carries its
 * written post, and a later day's card is a topic with no caption, image or
 * hashtags. Below the week, the Topic Queue lists those future topics with
 * their date, platform, content pillar, source trend and validation status —
 * editable, reorderable, and each with its own Generate Post. There is no
 * suggestion list: an idea the calendar did not place is not kept aside.
 *
 * The assistant lives in a popover under Ask Ethara, scoped to this week.
 */

import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, X } from 'lucide-react'
import { prefersReducedMotion, useStore } from '../store'
import { CalendarAssistant } from '../components/assistant/calendar-assistant'
import { PlatformIcon, PLATFORM_LABEL, PLATFORM_TOKEN } from '../components/ui'
import { BackToHub } from '../components/layout'
import { isPostReadyDay, isQueuedTopic, resolveHorizon, type CalendarHorizonView } from '../lib/calendar-horizon'
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

/* The design's three tones: approved reads blue, published green, drafted amber. */
const STATUS_INK: Partial<Record<IdeaStatus, string>> = {
  approved: 'var(--color-accent-bright)',
  scheduled: 'var(--color-accent-bright)',
  published: 'var(--color-good-ink)',
  drafted: 'var(--color-warn)',
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
  /** True while a finger is down, so the caller can disable easing. */
  dragging: boolean
  /** The live drag offset, or undefined when at rest. */
  transform: string | undefined
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
    dragging: dragX !== 0,
    // Damped, so the grid follows the finger without sliding off-screen.
    transform: dragX === 0 ? undefined : `translateX(${dragX * 0.35}px)`,
  }
}

/**
 * THE WEEK SHOWS A CHANGE HAPPENING, NOT JUST ITS RESULT.
 *
 * When state is refetched — the assistant moved a post, a run wrote one, another
 * operator dragged one — a card that changed day or time used to vanish from
 * one column and appear in another between two frames, which reads as a
 * reload rather than a move. This is FLIP: each card's position is remembered
 * after every commit; when a card's slot changes, it is drawn back at its old
 * position and animated to its new one, lifting slightly on the way, and lands
 * with a brief glow. A card that newly arrives on the grid rises into place.
 *
 * Positions are kept relative to the grid (plus its scroll), so a page scroll
 * between two commits does not read as movement. Changing week resets the
 * memory — a new week's cards are not "arriving". The card being dropped by
 * hand has its own landing and is skipped. Nothing runs under reduced motion.
 */
function useCardFlip(
  grid: React.RefObject<HTMLDivElement | null>,
  ideas: Idea[],
  weekKey: string,
  skipId: string | null,
): void {
  const memory = useRef<{ week: string; cards: Map<string, { x: number; y: number; slot: string }> }>({
    week: '',
    cards: new Map(),
  })

  useLayoutEffect(() => {
    const container = grid.current
    if (!container) return
    const origin = container.getBoundingClientRect()
    const slotOf = new Map(ideas.map((i) => [i.id, `${i.scheduled_date}|${i.scheduled_time}`]))
    const before = memory.current
    const fresh = before.week !== weekKey || before.cards.size === 0
    const motion = !prefersReducedMotion()
    const next = new Map<string, { x: number; y: number; slot: string }>()

    container.querySelectorAll<HTMLElement>('[data-flip]').forEach((element) => {
      const id = element.dataset.flip ?? ''
      const rect = element.getBoundingClientRect()
      const x = rect.left - origin.left + container.scrollLeft
      const y = rect.top - origin.top + container.scrollTop
      const slot = slotOf.get(id) ?? ''
      next.set(id, { x, y, slot })
      if (fresh || !motion || id === skipId) return

      const was = before.cards.get(id)
      if (was === undefined) {
        element.animate(
          [
            { opacity: 0, transform: 'translateY(10px) scale(0.94)' },
            { opacity: 1, transform: 'none' },
          ],
          { duration: 460, easing: EASE },
        )
        return
      }
      if (was.slot === slot) return
      const dx = was.x - x
      const dy = was.y - y
      if (Math.abs(dx) < 1 && Math.abs(dy) < 1) return

      element.animate(
        [
          { transform: `translate(${dx}px, ${dy}px)`, zIndex: 30 },
          { transform: `translate(${dx * 0.45}px, ${dy * 0.45 - 16}px) scale(1.04)`, zIndex: 30, offset: 0.45 },
          { transform: 'none', zIndex: 30 },
        ],
        { duration: 760, easing: EASE },
      )
      element.animate(
        [
          { boxShadow: '0 0 0 0 transparent' },
          { boxShadow: '0 0 0 2px var(--color-accent), 0 18px 44px -14px var(--color-glow)', offset: 0.62 },
          { boxShadow: '0 0 0 0 transparent' },
        ],
        { duration: 1500, easing: 'ease-out' },
      )
    })

    // Re-measured on every commit, so the remembered positions stay true after
    // a resize or a week swipe; a card only animates when its slot changed.
    memory.current = { week: weekKey, cards: next }
  }, [grid, ideas, weekKey, skipId])
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
    // Arriving to edit one post (Leadership's "Edit post"): open on its week,
    // so the card being edited is on the grid behind its editor.
    const focus = ideas.find((idea) => idea.id === useStore.getState().calendarSpotlight)
    if (focus && typeof focus.scheduled_date === 'string') {
      const week = startOfWeek(new Date(`${String(focus.scheduled_date).slice(0, 10)}T12:00:00`)).getTime()
      return Math.round((week - today) / (7 * DAY_MS))
    }
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
  const deleteIdea = useStore((s) => s.deleteIdea)
  const generatePost = useStore((s) => s.generatePost)
  const generatingPosts = useStore((s) => s.generatingPosts)
  const serverHorizon = useStore((s) => s.calendarHorizon)
  const horizon = useMemo(() => resolveHorizon(serverHorizon), [serverHorizon])

  /* ── Card size ────────────────────────────────────────────────────── */
  /** The Topic Queue, so a topic card and an empty day can point at it. */
  const queueRef = useRef<HTMLElement | null>(null)
  /** The queue row a topic card asked to be shown, briefly lit. */
  const [queueFocus, setQueueFocus] = useState<string | null>(null)
  const showInQueue = (ideaId: string): void => {
    setQueueFocus(ideaId)
    const row = queueRef.current?.querySelector<HTMLElement>(`[data-topic="${CSS.escape(ideaId)}"]`)
    ;(row ?? queueRef.current)?.scrollIntoView({ behavior: prefersReducedMotion() ? 'auto' : 'smooth', block: 'center' })
  }
  useEffect(() => {
    if (queueFocus === null) return
    const timer = window.setTimeout(() => setQueueFocus(null), 1600)
    return () => window.clearTimeout(timer)
  }, [queueFocus])

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
  /*
   * True only while a pointer is actively dragging the edge. The grid follows
   * the pointer instantly during a drag (a transition here would lag the cursor
   * and feel like rubber), and glides for every OTHER width change — the reset
   * to auto, a keyboard nudge, a width restored from localStorage on load.
   */
  const [isResizing, setIsResizing] = useState(false)
  const beginResize = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    event.preventDefault()
    event.stopPropagation()
    const column = event.currentTarget.closest<HTMLElement>('[data-day]')
    const startWidth = columnWidth > 0 ? columnWidth : (column?.getBoundingClientRect().width ?? COLUMN_MIN)
    resizeRef.current = { id: event.pointerId, startX: event.clientX, startWidth }
    setIsResizing(true)
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
    setIsResizing(false)
    document.body.classList.remove('is-resizing')
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // Capture already gone.
    }
  }
  // Keyboard resize: the same shared width, nudged. Starts from the real
  // rendered width when the grid is still in "auto", so the first keypress does
  // not jump. Not a pointer drag, so the grid glides to the new width.
  const nudgeWidth = (event: React.KeyboardEvent<HTMLElement>): void => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    const base =
      columnWidth > 0
        ? columnWidth
        : (event.currentTarget.closest<HTMLElement>('[data-day]')?.getBoundingClientRect().width ?? COLUMN_MIN)
    const next = base + (event.key === 'ArrowRight' ? 24 : -24)
    setColumnWidth(Math.min(COLUMN_MAX, Math.max(COLUMN_MIN, Math.round(next))))
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

  /*
   * THE PAGE FOLLOWS THE CARD.
   *
   * The Topic Queue sits BELOW the week grid, so dragging a card from low on
   * the page onto a day means dragging upward — and on a full week the grid is already off the
   * top of the viewport by the time you reach the queue. `dayUnder()` resolves
   * by `elementFromPoint`, which only ever sees what is actually on screen, so
   * the drop found no day and silently did nothing. The card picked up fine and
   * then went nowhere, which is exactly what was reported.
   *
   * Nudging the scroller while the pointer is near an edge brings the grid back
   * into view without the operator having to let go, scroll, and start again.
   * The step is proportional to how deep into the margin the pointer is, so a
   * small overshoot creeps and a decisive one moves.
   */
  const autoScroll = (p: DragPoint): void => {
    const MARGIN = 110
    const MAX_STEP = 22
    const scroller = document.querySelector<HTMLElement>('main')
    if (!scroller) return

    const top = p.y - MARGIN
    const bottom = window.innerHeight - MARGIN - p.y

    if (top < 0) scroller.scrollBy({ top: Math.max(-MAX_STEP, top / 4) })
    else if (bottom < 0) scroller.scrollBy({ top: Math.min(MAX_STEP, -bottom / 4) })
  }

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
      autoScroll(p)
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
    // Every card is already on the calendar; a drop only counts when the day
    // actually changes. Moving a topic writes nothing — its post is generated
    // on demand, or by the next run once its date is post-ready.
    if (target !== current.idea.scheduled_date) {
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
  const todayIso = horizon.today
  const weekIsos = useMemo(() => new Set(days.map(isoDate)), [days])

  /*
   * EVERY PLACED TOPIC IS ON THE GRID. THERE IS NO SIDE LIST.
   *
   * The calendar keeps dated topics only. A post-ready date (today, tomorrow
   * when the schedule requires it) carries its written post; a later date
   * carries the topic alone, and the same topic is listed in the Topic Queue
   * below with its Generate Post. A written post on a later date — generated on
   * demand, or by an earlier release — is simply a post on the grid.
   */
  const live = ideas.filter((i) => i.status !== 'rejected')
  const primary = live.filter((i) => i.calendar_slot === 'primary')
  const topicQueue = primary
    .filter((i) => isQueuedTopic(i, horizon))
    .sort((a, b) => a.scheduled_date.localeCompare(b.scheduled_date) || timeValue(a.scheduled_time) - timeValue(b.scheduled_time))

  /*
   * ONE ROW PER TOPIC, NOT ONE PER PLATFORM.
   *
   * The Calendar Agent plans a cross-platform variant per platform, so a single
   * topic arrives as four ideas (LinkedIn, Instagram, X, Facebook) that all sit
   * in the `primary` slot. Listing them as four rows made the queue read as four
   * different topics — the same subject repeated, which is exactly the thing a
   * queue must not do.
   *
   * So the table groups by topic: the soonest idea represents the group, and the
   * platforms it will publish to are shown together. The per-platform ideas are
   * untouched — `topicQueue` above still feeds the per-platform capacity counts,
   * and Generate Post still acts on a real idea.
   */
  const topicGroups = useMemo(() => {
    const groups = new Map<string, { lead: Idea; platforms: Platform[]; ideas: Idea[] }>()
    for (const idea of topicQueue) {
      const key = (idea.source_topic ?? idea.title ?? idea.id).trim().toLowerCase()
      const existing = groups.get(key)
      if (existing === undefined) {
        groups.set(key, { lead: idea, platforms: [idea.platform], ideas: [idea] })
        continue
      }
      existing.ideas.push(idea)
      if (!existing.platforms.includes(idea.platform)) existing.platforms.push(idea.platform)
    }
    return [...groups.values()]
  }, [topicQueue])
  const weekPrimary = primary.filter((i) => weekIsos.has(i.scheduled_date))
  useCardFlip(gridRef, weekPrimary, isoDate(days[0] as Date), justMoved)

  /*
   * ARRIVING TO EDIT ONE POST (Leadership's "Edit post").
   *
   * The week already opened on the post's week (see `weekOffset`). Here its
   * card is scrolled into view and pulses, so the redirect reads as one — then
   * its editor opens over it. Closing the editor leaves the operator on the
   * calendar, beside the card they came for.
   */
  const spotlight = useStore((s) => s.calendarSpotlight)
  const clearSpotlight = useStore((s) => s.clearCalendarSpotlight)
  useEffect(() => {
    if (spotlight === null) return
    const card = gridRef.current?.querySelector<HTMLElement>(`[data-flip="${CSS.escape(spotlight)}"]`)
    const motion = !prefersReducedMotion()
    if (card) {
      card.scrollIntoView({ behavior: motion ? 'smooth' : 'auto', block: 'center', inline: 'center' })
      if (motion) {
        card.animate(
          [
            { boxShadow: '0 0 0 0 transparent', transform: 'none' },
            { boxShadow: '0 0 0 3px var(--color-accent), 0 20px 48px -12px var(--color-glow)', transform: 'scale(1.03)', offset: 0.4 },
            { boxShadow: '0 0 0 0 transparent', transform: 'none' },
          ],
          { duration: 1100, easing: EASE },
        )
      }
    }
    const id = spotlight
    const timer = window.setTimeout(() => {
      clearSpotlight()
      openReview(id)
    }, card && motion ? 1100 : 0)
    return () => window.clearTimeout(timer)
  }, [spotlight, clearSpotlight, openReview])

  const capacity = PLATFORMS.map((platform) => {
    const placed = weekPrimary.filter((i) => i.platform === platform).length
    const topics = topicQueue.filter((i) => i.platform === platform).length
    return { platform, placed, free: Math.max(0, cap - placed), topics }
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
   * it consumed the viewport, never grew, and the Topic Queue beneath it
   * could not be reached by scrolling the page.
   */
  return (
    /*
     * THE PAGE GROWS; THE SHELL SCROLLS IT.
     *
     * This was `min-h-0 flex-1`, which pins the page to the viewport and makes
     * every child responsible for its own overflow. The effect was that the
     * document never grew, so the browser had nothing to scroll and the ranked
     * queue below the week could only be reached through a nested scroller.
     *
     * `<main>` in the shell already carries `overflow-y-auto`, so letting this
     * column take its natural height is all that is needed: the whole page
     * scrolls as one document, and the Topic Queue keeps its own bounded
     * scroll for a long plan.
     */
    <div className="-mx-4 -mt-4 -mb-2 flex flex-col">
      {/* ── Command bar ─────────────────────────────────────────────────── */}
      <header className="glass relative z-20 flex min-h-[58px] shrink-0 flex-wrap items-center gap-3.5 border-b border-line px-[18px] py-1.5">
        <div className="flex min-w-0 items-center gap-2.5">
          {/* A lit edge beside the title, so the header reads as a command bar
              rather than a line of text on a dark field. */}
          <span
            aria-hidden="true"
            className="hidden h-[30px] w-[2px] shrink-0 rounded-full sm:block"
            style={{ background: 'linear-gradient(180deg, var(--color-magenta), var(--color-accent))' }}
          />
          <div className="min-w-0">
            <BackToHub className="!mb-0.5" />
            <h1 className="whitespace-nowrap text-[20px] font-semibold tracking-[-0.02em] text-ink">Weekly Calendar</h1>
          </div>
        </div>

        {/*
         * CAPACITY, WHICH IS WHAT THIS SCREEN IS ABOUT.
         *
         * This file opens by saying capacity is the first thing you see — five
         * pips per platform, filled or free — and nothing drew them. The panel
         * below counts twenty slots in one number, which cannot say WHICH
         * platform is full; two of these strips full and two empty reads at a
         * glance. Every pip is one real slot: filled ones are topics or posts
         * placed this week.
         */}
        <div className="ml-5 hidden items-center gap-3.5 rounded-[10px] border border-line bg-surface/60 px-3 py-1.5 xl:flex">
          {capacity.map((c) => (
            <span
              key={c.platform}
              className="flex items-center gap-1.5"
              title={`${PLATFORM_LABEL[c.platform]}: ${c.placed} of ${cap} placed this week · ${c.topics} future topic(s) in the Topic Queue`}
            >
              <PlatformIcon platform={c.platform} size={10} />
              <span className="flex gap-[3px]" aria-hidden="true">
                {Array.from({ length: cap }, (_, i) => (
                  <span
                    key={i}
                    className="h-[5px] w-[5px] rounded-full transition-colors duration-[var(--dur-base)]"
                    style={
                      i < c.placed
                        ? { background: PLATFORM_TOKEN[c.platform] }
                        : { background: 'var(--color-surface-3)', border: '1px solid var(--color-line-strong)' }
                    }
                  />
                ))}
              </span>
              <span className="sr-only">
                {PLATFORM_LABEL[c.platform]}: {c.placed} of {cap} placed, {c.topics} in the Topic Queue
              </span>
            </span>
          ))}
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

          {/* Paging away from this week had no way back but counting clicks. */}
          {weekOffset !== 0 ? (
            <button
              type="button"
              onClick={() => setWeekOffset(0)}
              title="Back to the current week"
              className="mono rounded-[7px] border border-line-strong px-2.5 py-[5px] text-[10px] uppercase tracking-[0.08em] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
            >
              Today
            </button>
          ) : null}

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
                  <button type="button" onClick={() => setAskOpen(false)} aria-label="Close" className="ml-auto text-ink-3 transition-colors hover:text-ink">✕</button>
                </div>
                {/*
                  NO OUTER SCROLLER.

                  This was `max-h-[520px] overflow-y-auto`, which made the whole
                  panel scroll — header, transcript and composer together — while
                  the transcript's OWN scroller never bounded and so never
                  scrolled at all. Two nested scrollers, and the wrong one was
                  moving: reading back through a conversation dragged the
                  composer off the bottom of the popover.

                  The panel now owns its height and scrolls only its transcript,
                  so the header and the input stay put.
                */}
                <div>
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
      <div className="flex flex-col">
        <section className="relative min-w-0 px-[18px] pb-3.5 pt-3.5">
          <div className="glass-panel rounded-[18px] px-4 py-3.5">
          <div className="relative z-10 mb-2.5 flex items-center gap-2.5">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.015em] text-ink">
              {totalPlaced} slot{totalPlaced === 1 ? '' : 's'} placed
            </h2>
            <span className="text-[10.5px] text-ink-3">
              {totalFree} of {cap * PLATFORMS.length} slots free · today{horizon.postReadyDates.length > 1 ? ' and tomorrow are' : ' is'} post-ready; later days hold topics — generate a post from the Topic Queue, or drag a card to another day
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
            /*
             * TWO ANIMATED PROPERTIES, ONE `transition` SHORTHAND.
             *
             * The column width glides when it changes by itself — reset, keyboard,
             * restore-on-load — and the week swipe eases the transform back after a
             * drag. Both want `transition`, and spreading one style object over the
             * other would silently drop whichever lost, so the value is COMPOSED
             * rather than overwritten.
             *
             * Both are cut to `none` while a pointer is down: mid-drag the columns
             * must track the cursor exactly, and the grid must follow the finger
             * without easing behind it.
             */
            style={{
              ...(columnWidth > 0
                ? { gridTemplateColumns: `repeat(7, ${columnWidth}px)` }
                : {}),
              ...(weekSwipe.dragging ? { transform: weekSwipe.transform } : {}),
              transition:
                isResizing || weekSwipe.dragging
                  ? 'none'
                  : [
                      'grid-template-columns var(--dur-base) var(--ease-out-soft)',
                      'transform 220ms cubic-bezier(0.22, 1, 0.36, 1)',
                    ].join(', '),
            }}
          >
            {days.map((day, i) => {
              const iso = isoDate(day)
              const dayIdeas = primary
                .filter((idea) => idea.scheduled_date === iso)
                .sort((a, b) => timeValue(a.scheduled_time) - timeValue(b.scheduled_time))
              const isToday = iso === todayIso
              const isPostReady = horizon.postReadyDates.includes(iso)
              // A card only highlights a day other than the one it holds.
              const isDropTarget = drag !== null && drag.overIso === iso && drag.idea.scheduled_date !== iso
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
                      <span className="mono rounded-full border border-magenta/40 px-2 py-px text-[7px] font-semibold uppercase tracking-[0.12em] text-magenta-ink">today</span>
                    ) : isPostReady ? (
                      <span
                        className="mono rounded-full border border-accent/40 px-2 py-px text-[7px] font-semibold uppercase tracking-[0.12em] text-accent-bright"
                        title="Tomorrow is a posting day, so its post is written ahead"
                      >
                        post-ready
                      </span>
                    ) : dayIdeas.length > 0 ? (
                      <span className="mono text-[7.5px] uppercase tracking-[0.1em] text-ink-3">
                        {dayIdeas.length} post{dayIdeas.length === 1 ? '' : 's'}
                      </span>
                    ) : null}
                  </header>

                  {dayIdeas.map((idea) => {
                    const topicOnly = isQueuedTopic(idea, horizon)
                    return (
                      <SlotCard
                        key={idea.id}
                        idea={idea}
                        horizon={horizon}
                        wide={isWide}
                        dragging={drag?.idea.id === idea.id}
                        landed={justMoved === idea.id}
                        generating={generatingPosts.includes(idea.id)}
                        // A future topic has no post to open; it is shown in
                        // the Topic Queue, where it is edited and generated.
                        onOpen={() => (topicOnly ? showInQueue(idea.id) : openReview(idea.id))}
                        onGenerate={() => void generatePost(idea.id)}
                        onDrag={onCardDrag}
                        onWithdraw={() => void deleteIdea(idea.id)}
                      />
                    )
                  })}

                  {/* A day with room. It says where a dragged card would land;
                      an empty day says so and points at the Topic Queue. */}
                  {dayIdeas.length === 0 || isDropTarget ? (
                    <button
                      type="button"
                      onClick={() => queueRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
                      className={`mono flex items-center justify-center rounded-[10px] border border-dashed px-2 py-[9px] text-center text-[7.5px] uppercase tracking-[0.1em] transition-colors duration-[var(--dur-fast)] ${
                        isDropTarget ? 'border-accent text-accent-bright' : 'border-line-strong text-ink-3 hover:border-magenta/50 hover:text-magenta-ink'
                      } ${dayIdeas.length === 0 ? 'min-h-[110px]' : ''}`}
                    >
                      {isDropTarget ? 'move here' : 'no posts · topic queue ↓'}
                    </button>
                  ) : null}

                  {/* RESIZE HANDLE — the right edge of every column is a grip,
                      and all seven write the same shared width, so widening one
                      widens the week. It sits half over the gap between columns,
                      is faint until the column is hovered, and never starts a
                      card drag because it stops the pointer at its own edge. */}
                  <span
                    role="separator"
                    aria-label="Resize calendar columns"
                    aria-orientation="vertical"
                    aria-valuenow={columnWidth > 0 ? columnWidth : undefined}
                    aria-valuemin={COLUMN_MIN}
                    aria-valuemax={COLUMN_MAX}
                    tabIndex={0}
                    title="Drag to resize every column · arrow keys also work"
                    onPointerDown={beginResize}
                    onPointerMove={onResizeMove}
                    onPointerUp={endResize}
                    onPointerCancel={endResize}
                    onKeyDown={nudgeWidth}
                    className="absolute -right-1 top-0 z-20 flex h-full w-2 cursor-col-resize touch-none items-center justify-center opacity-0 outline-none transition-opacity duration-[var(--dur-fast)] group-hover/day:opacity-100 focus-visible:opacity-100"
                  >
                    <span className="h-10 w-[3px] rounded-full bg-line-strong transition-colors hover:bg-accent" aria-hidden="true" />
                  </span>
                </div>
              )
            })}
          </div>
          </div>
        </section>

        <TopicQueue queueRef={queueRef} groups={topicGroups} focusId={queueFocus} />
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
   THE PRESS — one gesture, read the same way on a calendar card and a queue row
   ═══════════════════════════════════════════════════════════════════════════ */

/** Past this much travel a press is a drag rather than a click. */
const DRAG_THRESHOLD = 6
/** A finger must hold still this long first: on touch, the same gesture scrolls. */
const TOUCH_HOLD_MS = 220

/**
 * A press that becomes either a click or a drag, never both.
 *
 * Pointer-down records the press; movement decides. Six pixels of travel makes
 * it a drag; a release without that travel opens the post. A finger is held to
 * a higher bar — 220ms of stillness first — because on a touch screen the same
 * gesture is how a person scrolls, and scrolling must win.
 *
 * THE MOVE AND THE RELEASE ARE HEARD ON THE WINDOW, NOT ON THE CARD.
 *
 * They used to be React handlers on the card, which relied on the first move
 * after the press still landing inside it — pointer capture was only taken once
 * the drag had already begun. Pointer events arrive every few milliseconds, not
 * every pixel, so one quick flick off the card jumped the gesture straight past
 * its own handler: no ghost, no drop target, no error, and a card dragged onto
 * a day did nothing at all. Measured, a first move of sixteen pixels skipped it
 * every time. The window always hears the pointer.
 *
 * `draggable` is deliberately not used: this file's history records three
 * attempts built on it, and the lesson was that the HTML5 drag API and a
 * reliable click on the same element are not compatible.
 */
function useCardPress({
  idea,
  onDrag,
  onOpen,
}: {
  idea: Idea
  onDrag: (idea: Idea, phase: DragPhase, point: DragPoint, rect?: DOMRect) => void
  onOpen: () => void
}): {
  node: React.MutableRefObject<HTMLElement | null>
  onPointerDown: (event: React.PointerEvent<HTMLElement>) => void
} {
  const node = useRef<HTMLElement | null>(null)
  const press = useRef<{ id: number; dragging: boolean; timer: number | null } | null>(null)
  const detach = useRef<(() => void) | null>(null)

  // A card unmounted mid-press — moved, withdrawn, or the week paged — must
  // not leave its listeners behind on the window.
  useEffect(() => () => detach.current?.(), [])

  const onPointerDown = (event: React.PointerEvent<HTMLElement>): void => {
    if (event.button !== 0) return
    detach.current?.()

    const startX = event.clientX
    const startY = event.clientY
    press.current = { id: event.pointerId, dragging: false, timer: null }

    const begin = (x: number, y: number): void => {
      const p = press.current
      const el = node.current
      if (!p || !el || p.dragging) return
      p.dragging = true
      if (p.timer !== null) {
        window.clearTimeout(p.timer)
        p.timer = null
      }
      onDrag(idea, 'start', { x, y }, el.getBoundingClientRect())
    }
    const stop = (): void => {
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
      window.removeEventListener('pointercancel', cancel)
      detach.current = null
    }
    const move = (e: PointerEvent): void => {
      const p = press.current
      if (!p || e.pointerId !== p.id) return
      if (p.dragging) {
        onDrag(idea, 'move', { x: e.clientX, y: e.clientY })
        return
      }
      if (Math.hypot(e.clientX - startX, e.clientY - startY) < DRAG_THRESHOLD) return
      if (e.pointerType === 'touch') {
        // Moved before the hold completed: this is a scroll, and scrolling wins.
        if (p.timer !== null) window.clearTimeout(p.timer)
        press.current = null
        stop()
        return
      }
      begin(e.clientX, e.clientY)
    }
    const up = (e: PointerEvent): void => {
      const p = press.current
      if (!p || e.pointerId !== p.id) return
      press.current = null
      stop()
      if (p.timer !== null) window.clearTimeout(p.timer)
      if (p.dragging) onDrag(idea, 'end', { x: e.clientX, y: e.clientY })
      else onOpen()
    }
    const cancel = (): void => {
      const p = press.current
      press.current = null
      stop()
      if (!p) return
      if (p.timer !== null) window.clearTimeout(p.timer)
      if (p.dragging) onDrag(idea, 'cancel', { x: 0, y: 0 })
    }

    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
    window.addEventListener('pointercancel', cancel)
    detach.current = stop

    if (event.pointerType === 'touch') {
      press.current.timer = window.setTimeout(() => begin(startX, startY), TOUCH_HOLD_MS)
    }
  }

  return { node, onPointerDown }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CARD — a title, with a small creative under it
   ═══════════════════════════════════════════════════════════════════════════ */

function SlotCard({
  idea,
  horizon,
  wide,
  dragging,
  landed,
  generating,
  onOpen,
  onGenerate,
  onDrag,
  onWithdraw,
}: {
  idea: Idea
  horizon: CalendarHorizonView
  wide: boolean
  dragging: boolean
  landed: boolean
  generating: boolean
  onOpen: () => void
  onGenerate: () => void
  onDrag: (idea: Idea, phase: DragPhase, point: DragPoint, rect?: DOMRect) => void
  onWithdraw: () => void
}) {
  /*
   * THREE STATES A PLACED CARD CAN BE IN BEFORE REVIEW.
   *
   *   A future TOPIC — dated after the post-ready horizon, no post by design.
   *   Neutral ink, "TOPIC · IN QUEUE": nothing is missing, it waits for
   *   Generate Post.
   *
   *   A POST DUE — a post-ready date (today, or tomorrow when required) whose
   *   post has not been written yet: the run is writing it, or it failed.
   *   Warning amber, because this one is expected to exist.
   *
   *   A written post — its own status chip.
   */
  const unwritten = idea.status === 'suggested' && !idea.draft?.body
  const topicOnly = isQueuedTopic(idea, horizon)
  const due = unwritten && !topicOnly && isPostReadyDay(idea, horizon)
  const ink = topicOnly
    ? 'var(--color-ink-3)'
    : unwritten
      ? 'var(--color-warn)'
      : (STATUS_INK[idea.status] ?? 'var(--color-ink-3)')
  const chip = generating
    ? 'GENERATING…'
    : topicOnly
      ? 'TOPIC · IN QUEUE'
      : due
        ? 'POST DUE'
        : unwritten
          ? 'NO POST YET'
          : (STATUS_CHIP[idea.status] ?? idea.status.toUpperCase())
  const colour = PLATFORM_TOKEN[idea.platform]
  const topic = topicOf(idea)
  const hook = hookOf(idea)
  const angle = typeof idea.analysis.angle === 'string' ? idea.analysis.angle : null
  /* The chip names the subject only when one was recorded; a platform label
     standing in for a topic is not a topic. */
  const topicChip = (idea.source_topic ?? idea.hashtag_display)?.replace(/^#/, '') ?? null

  const { node, onPointerDown } = useCardPress({ idea, onDrag, onOpen })

  return (
    <article
      ref={node}
      data-flip={idea.id}
      role="button"
      tabIndex={0}
      aria-label={
        topicOnly
          ? `Topic “${idea.title}” — no post yet. Opens its row in the Topic Queue. Drag to another day to reschedule it.`
          : `Open “${idea.title}” for editing. Drag to another day to reschedule it.`
      }
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className={`group relative flex cursor-grab select-none flex-col overflow-hidden rounded-[11px] border bg-surface-2/60 px-2.5 py-2.5 transition-[border-color,translate,box-shadow,opacity] duration-[var(--dur-base)] active:cursor-grabbing ${
        dragging
          ? 'border-dashed border-accent/50 opacity-35'
          : `${topicOnly ? 'border-dashed border-line-strong' : unwritten ? 'border-dashed border-warn/45' : 'border-line'} hover:!translate-y-[-2px] hover:border-accent/60 hover:shadow-[0_14px_36px_-16px_var(--color-glow)]`
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

      {/* what the post is about — the design's pink topic chip */}
      {topicChip ? (
        <span
          className={`mt-[7px] max-w-full self-start rounded-full border border-magenta/30 bg-magenta/8 px-2 py-[2px] text-[8.5px] font-semibold tracking-[0.04em] text-magenta-ink ${wide ? '' : 'truncate'}`}
          title={topicChip}
        >
          #{topicChip}
        </span>
      ) : null}

      {/* The hook. Clamped to two lines at the default width; a widened column
          drops the clamp so the whole opening line reads without opening the card. */}
      <p className={`mt-[7px] text-[12px] font-semibold leading-[1.4] text-ink ${wide ? '' : 'line-clamp-2'}`} title={hook}>
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

      {/* A card with no post yet can have one generated for it alone — the
          same action as its Topic Queue row. Stops the press so a click here is
          never read as a drag or an open. */}
      {unwritten ? (
        <button
          type="button"
          disabled={generating}
          onPointerDown={(event) => event.stopPropagation()}
          onPointerUp={(event) => event.stopPropagation()}
          onKeyDown={(event) => event.stopPropagation()}
          onClick={(event) => { event.stopPropagation(); onGenerate() }}
          className="mt-2 self-start rounded-[7px] border border-magenta/40 px-2 py-[3px] text-[9.5px] font-semibold text-magenta-ink transition-colors duration-[var(--dur-fast)] hover:border-magenta/70 hover:bg-magenta/12 disabled:cursor-wait disabled:opacity-60"
        >
          {generating ? 'Generating…' : 'Generate post'}
        </button>
      ) : null}
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE TOPIC QUEUE — every future date's validated topic, and its Generate Post
   ───────────────────────────────────────────────────────────────────────────
   One row per topic dated after the post-ready horizon, in date order: date,
   topic, platform, content pillar, source trend, validation status, and the
   action. Nothing here has a caption, image or hashtags — pressing Generate
   Post writes the complete post for that ONE topic, and the row leaves the
   queue for the grid. The topic's line, date and platform are editable; the
   arrows reorder the queue by handing its dates out again in the new order.
   Nothing is deleted: withdraw keeps the topic and its reasons on record.
   ═══════════════════════════════════════════════════════════════════════════ */

const VALIDATION_INK: Record<string, string> = {
  validated: 'var(--color-good)',
  needs_review: 'var(--color-warn)',
  pending: 'var(--color-ink-3)',
  duplicate: 'var(--color-ink-3)',
  rejected: 'var(--color-critical)',
}

function TopicQueue({
  queueRef,
  groups,
  focusId,
}: {
  queueRef: React.Ref<HTMLElement>
  /** One entry per TOPIC. `platforms` is every platform that topic publishes to. */
  groups: Array<{ lead: Idea; platforms: Platform[]; ideas: Idea[] }>
  focusId: string | null
}) {
  const generatePost = useStore((s) => s.generatePost)
  const generatingPosts = useStore((s) => s.generatingPosts)
  const editTopic = useStore((s) => s.editTopic)
  const reorderTopicQueue = useStore((s) => s.reorderTopicQueue)
  const deleteIdea = useStore((s) => s.deleteIdea)

  const topics = groups.map((g) => g.lead)

  const move = (index: number, by: -1 | 1): void => {
    const target = index + by
    if (target < 0 || target >= topics.length) return
    const ids = topics.map((t) => t.id)
    const [picked] = ids.splice(index, 1)
    if (picked === undefined) return
    ids.splice(target, 0, picked)
    void reorderTopicQueue(ids)
  }

  return (
    <section ref={queueRef} className="flex w-full shrink-0 flex-col px-[18px] pb-7 pt-3" aria-label="Topic Queue">
      <header className="flex flex-wrap items-baseline gap-2.5 pb-3">
        <h2 className="text-[15px] font-semibold tracking-[-0.015em] text-ink">Topic Queue</h2>
        <span className="text-[10.5px] text-ink-3">
          {topics.length === 0
            ? 'no future topics waiting — every placed date is post-ready or already written'
            : `${topics.length} validated topic${topics.length === 1 ? '' : 's'} on future dates · one row per topic, adapted per platform · topic only, no post yet · generate one when you need it`}
        </span>
      </header>

      {topics.length === 0 ? (
        <div className="glass-panel rounded-[14px] px-4 py-6 text-center text-[11px] text-ink-3">
          The Calendar Agent writes today&rsquo;s post, and tomorrow&rsquo;s when the posting schedule requires it. Later dates appear here as topics after the next run.
        </div>
      ) : (
        <div className="glass-panel overflow-x-auto rounded-[14px]">
          <table className="w-full min-w-[920px] border-collapse text-left">
            <thead>
              <tr className="mono border-b border-line text-[8.5px] uppercase tracking-[0.1em] text-ink-3">
                <th scope="col" className="w-[64px] px-3 py-2 font-medium">Order</th>
                <th scope="col" className="px-2 py-2 font-medium">Date</th>
                <th scope="col" className="px-2 py-2 font-medium">Topic</th>
                <th scope="col" className="px-2 py-2 font-medium">Platform</th>
                <th scope="col" className="px-2 py-2 font-medium">Content pillar</th>
                <th scope="col" className="px-2 py-2 font-medium">Source / trend</th>
                <th scope="col" className="px-2 py-2 font-medium">Validation</th>
                <th scope="col" className="px-3 py-2 text-right font-medium">Action</th>
              </tr>
            </thead>
            <tbody className="tabular">
              {groups.map((group, index) => (
                <TopicRow
                  key={group.lead.id}
                  topic={group.lead}
                  platforms={group.platforms}
                  index={index}
                  last={index === groups.length - 1}
                  focused={focusId === group.lead.id}
                  generating={group.ideas.some((i) => generatingPosts.includes(i.id))}
                  onUp={() => move(index, -1)}
                  onDown={() => move(index, 1)}
                  onEdit={(patch) => void editTopic(group.lead.id, patch)}
                  onGenerate={() => void generatePost(group.lead.id)}
                  onWithdraw={() => void deleteIdea(group.lead.id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

function TopicRow({
  topic,
  platforms,
  index,
  last,
  focused,
  generating,
  onUp,
  onDown,
  onEdit,
  onGenerate,
  onWithdraw,
}: {
  topic: Idea
  /** Every platform this topic publishes to — the whole cross-platform group. */
  platforms: Platform[]
  index: number
  last: boolean
  focused: boolean
  generating: boolean
  onUp: () => void
  onDown: () => void
  onEdit: (patch: { title?: string; date?: string; platform?: Platform }) => void
  onGenerate: () => void
  onWithdraw: () => void
}) {
  const [editing, setEditing] = useState(false)
  const [draftTitle, setDraftTitle] = useState(topic.title)

  const commitTitle = (): void => {
    setEditing(false)
    const next = draftTitle.trim()
    if (next.length >= 3 && next !== topic.title) onEdit({ title: next })
    else setDraftTitle(topic.title)
  }

  const trend = topic.source_topic ?? topic.hashtag_display
  const validation = topic.source_validation ?? null
  const validationInk = validation ? (VALIDATION_INK[validation] ?? 'var(--color-ink-3)') : 'var(--color-ink-3)'
  const arrow =
    'flex h-[20px] w-[20px] items-center justify-center rounded-[6px] border border-line-strong text-[10px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright disabled:cursor-not-allowed disabled:opacity-30'

  return (
    <tr
      data-topic={topic.id}
      className={`border-b border-line/70 align-top text-[11.5px] text-ink-2 transition-colors duration-[var(--dur-base)] last:border-b-0 ${
        focused ? 'bg-accent/[0.12]' : 'hover:bg-surface-3/40'
      }`}
      style={{ animation: `eth-row-stream 200ms ${EASE} ${Math.min(index, 12) * 30}ms both` }}
    >
      <td className="px-3 py-2.5">
        <div className="flex items-center gap-1">
          <button type="button" onClick={onUp} disabled={index === 0} className={arrow} aria-label={`Move “${topic.title}” earlier in the queue`} title="Earlier — takes the previous topic's date">
            ↑
          </button>
          <button type="button" onClick={onDown} disabled={last} className={arrow} aria-label={`Move “${topic.title}” later in the queue`} title="Later — takes the next topic's date">
            ↓
          </button>
        </div>
      </td>

      <td className="whitespace-nowrap px-2 py-2.5">
        <input
          type="date"
          value={String(topic.scheduled_date).slice(0, 10)}
          onChange={(event) => {
            if (event.target.value) onEdit({ date: event.target.value })
          }}
          aria-label={`Date for “${topic.title}”`}
          className="mono rounded-[6px] border border-line-strong bg-surface px-1.5 py-[3px] text-[10.5px] text-ink outline-none focus:border-accent"
        />
        <span className="mono ml-1.5 text-[9.5px] text-ink-3">{clock(topic.scheduled_time)}</span>
      </td>

      <td className="min-w-[220px] px-2 py-2.5">
        {editing ? (
          <input
            autoFocus
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            onBlur={commitTitle}
            onKeyDown={(event) => {
              if (event.key === 'Enter') commitTitle()
              if (event.key === 'Escape') {
                setDraftTitle(topic.title)
                setEditing(false)
              }
            }}
            aria-label="Topic"
            className="w-full rounded-[6px] border border-accent bg-surface px-2 py-[3px] text-[11.5px] text-ink outline-none"
          />
        ) : (
          <button
            type="button"
            onClick={() => {
              setDraftTitle(topic.title)
              setEditing(true)
            }}
            title="Edit this topic — editing never writes a post"
            className="text-left font-semibold leading-snug text-ink hover:text-accent-bright"
          >
            {topic.title}
            {topic.is_new_trend ? <span className="mono ml-1.5 text-[8px] font-medium text-magenta">NEW</span> : null}
          </button>
        )}
      </td>

      <td className="whitespace-nowrap px-2 py-2.5">
        {/*
          EVERY PLATFORM THIS TOPIC GOES TO, IN ONE CELL.

          A topic is planned once and adapted per platform, so the row shows the
          whole set. The select edits the lead idea's platform; the extra icons
          state the others rather than implying the topic is four topics.
        */}
        <span className="flex items-center gap-1.5">
          <span className="flex items-center gap-1">
            {platforms.map((p) => (
              <PlatformIcon key={p} platform={p} size={10} />
            ))}
          </span>
          {platforms.length > 1 ? (
            <span className="mono text-[9.5px] text-ink-3" title={platforms.map((p) => PLATFORM_LABEL[p]).join(', ')}>
              ×{platforms.length}
            </span>
          ) : (
            <select
              value={topic.platform}
              onChange={(event) => onEdit({ platform: event.target.value as Platform })}
              aria-label={`Platform for “${topic.title}”`}
              className="rounded-[6px] border border-line-strong bg-surface px-1 py-[2px] text-[10.5px] text-ink outline-none focus:border-accent"
            >
              {PLATFORMS.map((p) => (
                <option key={p} value={p}>
                  {PLATFORM_LABEL[p]}
                </option>
              ))}
            </select>
          )}
        </span>
      </td>

      <td className="px-2 py-2.5">
        {topic.content_pillar ? (
          <span className="rounded-full border border-accent/30 px-2 py-[2px] text-[9.5px] text-accent-bright">{topic.content_pillar}</span>
        ) : (
          <span className="text-[10px] text-ink-3" title="The topic touches none of Ethara's declared pillars">none matched</span>
        )}
      </td>

      <td className="max-w-[220px] px-2 py-2.5">
        {trend ? <span className="block truncate text-magenta-ink" title={trend}>#{trend.replace(/^#/, '')}</span> : null}
        {topic.source_url ? (
          <a
            href={topic.source_url}
            target="_blank"
            rel="noreferrer noopener"
            className="block truncate text-[10px] text-ink-3 underline decoration-line-strong underline-offset-2 hover:text-accent-bright"
            title={topic.source_title ?? topic.source_url}
          >
            {topic.source_name ?? topic.source_title ?? 'source post'}
          </a>
        ) : !trend ? (
          <span className="text-[10px] text-ink-3">no source recorded</span>
        ) : null}
      </td>

      <td className="whitespace-nowrap px-2 py-2.5">
        <span
          className="mono rounded-[5px] px-[6px] py-px text-[8.5px] uppercase tracking-[0.08em]"
          style={{ color: validationInk, background: `color-mix(in srgb, ${validationInk} 12%, transparent)`, border: `1px solid color-mix(in srgb, ${validationInk} 34%, transparent)` }}
          title={validation ? `The Validation Agent's verdict on this topic's source post` : 'No captured source post to validate'}
        >
          {validation ? validation.replace('_', ' ') : 'not stated'}
        </span>
      </td>

      <td className="whitespace-nowrap px-3 py-2.5 text-right">
        <button
          type="button"
          onClick={onGenerate}
          disabled={generating}
          className="rounded-[8px] border border-magenta/50 bg-magenta/10 px-3 py-[5px] text-[10.5px] font-semibold text-magenta-ink transition-colors duration-[220ms] hover:border-magenta hover:bg-magenta/20 disabled:cursor-wait disabled:opacity-60"
        >
          {generating ? 'Generating…' : 'Generate Post'}
        </button>
        <button
          type="button"
          onClick={onWithdraw}
          aria-label={`Withdraw “${topic.title}”`}
          title="Withdraw this topic — it keeps its reasons on record, and nothing is deleted"
          className="ml-1.5 inline-flex h-[24px] w-[24px] items-center justify-center rounded-[7px] border border-line-strong text-ink-3 align-middle transition-colors hover:border-critical hover:text-critical"
        >
          <X size={11} aria-hidden="true" />
        </button>
      </td>
    </tr>
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

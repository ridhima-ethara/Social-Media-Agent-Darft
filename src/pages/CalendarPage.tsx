/**
 * WEEKLY CALENDAR
 *
 * The grid renders only `primary` cards — the top five per platform. Everything
 * the agents placed but kept off the calendar sits below in More suggestions,
 * with its rank, promotable in one click.
 */

import { useMemo, useRef, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Trash2, ArrowUp, ArrowDown, Check } from 'lucide-react'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { CalendarAssistant } from '../components/assistant/calendar-assistant'
import { gradientPlaceholder } from '../lib/image-gen'
import {
  Badge,
  Btn,
  EmptyState,
  PlatformIcon,
  PLATFORM_LABEL,
  fmt,
} from '../components/ui'
import type { Idea, Platform } from '../types'

const PLATFORMS: Platform[] = ['linkedin', 'instagram', 'x', 'facebook']

/* ── Resizable suggestion columns ─────────────────────────────────────────────
   Frontend-only state: a panel height is a viewing preference, not something the
   server has an opinion about, so it lives in localStorage and no API changes
   with it. */

const SUGGESTION_HEIGHT_KEY = 'ethara.calendar.suggestionHeight'
const CARD_DETAIL_KEY = 'ethara.calendar.cardDetail'

/**
 * How much of a card is shown on the calendar itself.
 *
 * The cards clamped the title to two lines and the description to two, so
 * reading either in full meant opening the post. These levels trade the number
 * of cards visible at once against how much of each you can read — one control
 * for the whole grid, so the columns stay the same shape as each other.
 */
export type CardDetail = 'compact' | 'standard' | 'detailed'

const CARD_DETAIL_LABEL: Record<CardDetail, string> = {
  compact: 'Compact',
  standard: 'Standard',
  detailed: 'Detailed',
}

const CARD_DETAIL_HINT: Record<CardDetail, string> = {
  compact: 'Full title and the platform line — the most cards on screen',
  standard: 'Full title, the creative, and a two-line summary',
  detailed: 'Full title, longer summary, and the caption itself',
}

const CARD_DETAILS: CardDetail[] = ['compact', 'standard', 'detailed']

function isCardDetail(value: string | null): value is CardDetail {
  return value === 'compact' || value === 'standard' || value === 'detailed'
}
/** Below this the header and one row stop fitting; above it the page is unusable. */
const MIN_PANEL_HEIGHT = 180
const MAX_PANEL_HEIGHT = 900
/** One keyboard press. Large enough to feel, small enough to aim with. */
const HEIGHT_STEP = 32

function clampHeight(value: number): number {
  return Math.min(MAX_PANEL_HEIGHT, Math.max(MIN_PANEL_HEIGHT, Math.round(value)))
}

/**
 * The grip along the bottom of a suggestion column.
 *
 * Pointer events rather than mouse events, so a trackpad, a mouse and a touch
 * drag all work through one path. `setPointerCapture` keeps the drag alive when
 * the pointer leaves the handle, which is what makes a fast drag not stick.
 *
 * It is a real `separator` with a value, so the panel is resizable from the
 * keyboard as well — arrows nudge, Home and End go to the extremes.
 */
function ResizeHandle({
  height,
  onResize,
}: {
  height: number
  onResize: (next: number) => void
}) {
  const drag = useRef<{ startY: number; startHeight: number } | null>(null)

  return (
    <div
      role="separator"
      aria-orientation="horizontal"
      aria-label="Resize the suggestion panels"
      aria-valuenow={height}
      aria-valuemin={MIN_PANEL_HEIGHT}
      aria-valuemax={MAX_PANEL_HEIGHT}
      tabIndex={0}
      onPointerDown={(event) => {
        drag.current = { startY: event.clientY, startHeight: height }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const state = drag.current
        if (!state) return
        onResize(state.startHeight + (event.clientY - state.startY))
      }}
      onPointerUp={(event) => {
        drag.current = null
        event.currentTarget.releasePointerCapture(event.pointerId)
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowDown') {
          event.preventDefault()
          onResize(height + HEIGHT_STEP)
        }
        if (event.key === 'ArrowUp') {
          event.preventDefault()
          onResize(height - HEIGHT_STEP)
        }
        if (event.key === 'Home') {
          event.preventDefault()
          onResize(MIN_PANEL_HEIGHT)
        }
        if (event.key === 'End') {
          event.preventDefault()
          onResize(MAX_PANEL_HEIGHT)
        }
      }}
      title="Drag to resize every column · arrows to nudge"
      className="group mt-1.5 flex shrink-0 cursor-ns-resize touch-none items-center justify-center rounded py-1 outline-none focus-visible:ring-1 focus-visible:ring-accent"
    >
      <span
        className="h-0.5 w-8 rounded-full bg-line-strong transition-colors duration-[var(--dur-fast)] group-hover:bg-accent group-focus-visible:bg-accent"
        aria-hidden="true"
      />
    </div>
  )
}

function startOfWeek(date: Date): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + (out.getDay() === 0 ? -6 : 1 - out.getDay()))
  out.setHours(0, 0, 0, 0)
  return out
}

function addDays(date: Date, days: number): Date {
  const out = new Date(date)
  out.setDate(out.getDate() + days)
  return out
}

/**
 * The calendar date of a moment, in the operator's own timezone.
 *
 * `toISOString()` gives the UTC date, and local midnight in Kolkata is the
 * previous evening in UTC — so every day column was labelled with the day
 * before, matched nothing the server had scheduled, and the week read as
 * empty while nine ideas sat on it. The column header says Monday 7th; the
 * string it compares against must say the same.
 */
function isoDate(date: Date): string {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

/** A `YYYY-MM-DD` as a local calendar day, never as UTC midnight. */
function localDate(iso: string): Date {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Sorts by clock time, so a day column reads top-to-bottom in posting order. */
function timeValue(time: string): number {
  const match = /(\d{1,2}):(\d{2})\s*(AM|PM)/i.exec(time)
  if (!match) return 0
  let hour = Number(match[1]) % 12
  if (/PM/i.test(match[3] ?? '')) hour += 12
  return hour * 60 + Number(match[2])
}

export function CalendarPage() {
  const ideas = useStore((s) => s.ideas)
  const moveIdea = useStore((s) => s.moveIdea)
  const openReview = useStore((s) => s.openReview)

  /*
   * OPEN ON THE WEEK THAT ACTUALLY HOLDS THE CONTENT.
   *
   * This opened on the current week, always. The Calendar Agent plans forward
   * from today and skips weekends, so a run on a Friday afternoon has one weekday
   * left in this week and places the rest of the platform's slots in the next
   * one. The operator then opened the calendar, saw a nearly empty grid, and
   * concluded the agent had produced nothing — while five primaries sat one click
   * to the right.
   *
   * So the initial week follows the work: the week containing the earliest
   * primary that has not already passed. Ideas dated in the past do not pull the
   * view backwards, and with nothing scheduled at all it stays on this week,
   * where the empty state explains itself. Only the INITIAL value is derived —
   * once the operator pages, that is their choice and it is left alone.
   */
  const [weekOffset, setWeekOffset] = useState(() => {
    const today = startOfWeek(new Date()).getTime()
    const upcoming = ideas
      .filter((idea) => idea.calendar_slot === 'primary' && typeof idea.scheduled_date === 'string')
      .map((idea) => startOfWeek(new Date(`${String(idea.scheduled_date).slice(0, 10)}T12:00:00`)).getTime())
      .filter((week) => week >= today)
      .sort((a, b) => a - b)
    const earliest = upcoming[0]
    if (earliest === undefined) return 0
    return Math.round((earliest - today) / (7 * 24 * 60 * 60 * 1000))
  })
  const [dragging, setDragging] = useState<string | null>(null)
  /**
   * ONE height for every suggestion column.
   *
   * Deliberately shared rather than per-column: the four columns sit in a grid,
   * so letting one grow on its own leaves the row ragged and the others short.
   * Dragging any handle sets this, every column follows, and they stay aligned —
   * which is what "resize one and the others are managed accordingly" has to
   * mean in a grid. Persisted, because a size an operator chose should survive a
   * reload.
   */
  const [cardDetail, setCardDetail] = useState<CardDetail>(() => {
    const stored = window.localStorage.getItem(CARD_DETAIL_KEY)
    return isCardDetail(stored) ? stored : 'standard'
  })

  const commitDetail = (next: CardDetail): void => {
    setCardDetail(next)
    window.localStorage.setItem(CARD_DETAIL_KEY, next)
  }

  const [panelHeight, setPanelHeight] = useState<number>(() => {
    const stored = Number(window.localStorage.getItem(SUGGESTION_HEIGHT_KEY))
    return Number.isFinite(stored) && stored > 0 ? clampHeight(stored) : 320
  })

  const commitHeight = (next: number): void => {
    const clamped = clampHeight(next)
    setPanelHeight(clamped)
    window.localStorage.setItem(SUGGESTION_HEIGHT_KEY, String(clamped))
  }

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const todayIso = isoDate(new Date())

  /*
   * THE CALENDAR CARRIES DRAFTED WORK. SUGGESTIONS CARRY IDEAS.
   *
   * A slot alone was enough to put a card on the grid, so an idea the Calendar
   * Agent had merely placed — no caption written, status still `suggested` —
   * appeared beside a finished post and looked equally ready. Twenty-one of
   * twenty-nine cards on the grid were in that state.
   *
   * `calendar_slot` still decides placement, so promoting and demoting keep
   * working exactly as before; the added condition is that the post must
   * actually have been written. A `suggested` idea therefore waits in
   * suggestions until the Content Agent drafts it, whichever slot it holds.
   */
  const live = ideas.filter((i) => i.status !== 'rejected')
  const primary = live.filter((i) => i.calendar_slot === 'primary' && i.status !== 'suggested')
  const suggestions = live.filter(
    (i) => i.calendar_slot === 'suggestion' || i.status === 'suggested',
  )

  const weekRows = useMemo(() => {
    const counts = days.map((day) => {
      const iso = isoDate(day)
      return primary.filter((idea) => idea.scheduled_date === iso).length
    })
    return Math.max(1, ...counts) + 1
  }, [days, primary])

  const weekIdeas = primary.filter((idea) =>
    days.some((day) => isoDate(day) === idea.scheduled_date),
  )

  return (
    <>
      <PageHeader
        title="Weekly Calendar"
        subtitle="Drafted posts take a calendar slot. Ideas still waiting on a caption are ranked below."
        agents={['calendar', 'caption', 'image', 'review']}
        actions={
          <>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={() => setWeekOffset(weekOffset - 1)}
                aria-label="Previous week"
                className="rounded-lg border border-line p-1.5 text-ink-3 transition-colors hover:text-ink"
              >
                <ChevronLeft size={15} />
              </button>
              <span className="tabular min-w-40 text-center text-[12px] text-ink-2">
                {weekStart.toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} –{' '}
                {addDays(weekStart, 6).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })}
              </span>
              <button
                type="button"
                onClick={() => setWeekOffset(weekOffset + 1)}
                aria-label="Next week"
                className="rounded-lg border border-line p-1.5 text-ink-3 transition-colors hover:text-ink"
              >
                <ChevronRight size={15} />
              </button>
            </div>

            {/* One control for every card, so the seven columns stay the same
                shape as each other. */}
            <div
              role="group"
              aria-label="How much of each card to show"
              className="flex items-center rounded-lg border border-line p-0.5"
            >
              {CARD_DETAILS.map((level) => (
                <button
                  key={level}
                  type="button"
                  onClick={() => commitDetail(level)}
                  aria-pressed={cardDetail === level}
                  title={CARD_DETAIL_HINT[level]}
                  className={`rounded-md px-2 py-1 text-[11px] transition-colors duration-[var(--dur-fast)] ${
                    cardDetail === level
                      ? 'bg-surface-3 font-medium text-ink'
                      : 'text-ink-3 hover:text-ink-2'
                  }`}
                >
                  {CARD_DETAIL_LABEL[level]}
                </button>
              ))}
            </div>
          </>
        }
      />

      {/* Two columns on wide screens: the calendar on the left, the assistant as
          an ordinary right-hand column. Both scroll with the page, so nothing
          floats over the cards. Below `xl` the assistant stacks underneath. */}
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_340px]">
        <div className="min-w-0">
          {weekIdeas.length === 0 ? (
            <EmptyState
              title="No scheduled content this week"
              body="Nothing drafted for this week yet. Ideas waiting on a caption are listed below."
              action={
                <Btn variant="primary" onClick={() => useStore.getState().openBar('Run SocialAI')}>
                  Ask Ethara to run discovery
                </Btn>
              }
              className="mb-6"
            />
          ) : (
            <section
              className="mb-6 grid grid-cols-2 gap-x-2.5 gap-y-2 md:grid-cols-4 2xl:grid-cols-7"
              style={{ gridAutoRows: 'auto' }}
            >
              {days.map((day) => {
                const iso = isoDate(day)
                const dayIdeas = primary
                  .filter((idea) => idea.scheduled_date === iso)
                  .sort((a, b) => timeValue(a.scheduled_time) - timeValue(b.scheduled_time))
                const isToday = iso === todayIso
                const spare = weekRows - 1 - dayIdeas.length

                return (
                  <div
                    key={iso}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={() => {
                      if (dragging) void moveIdea(dragging, iso)
                      setDragging(null)
                    }}
                    className="grid min-h-40"
                    // Subgrid: every day's Nth card sits on the same row, so a
                    // card growing in one column grows its whole row. Browsers
                    // without subgrid fall back to an independent column.
                    style={{ gridTemplateRows: 'subgrid', gridRow: `span ${weekRows}` }}
                  >
                    <header
                      className={`flex items-baseline gap-1.5 px-1 pb-1 ${isToday ? 'text-accent-bright' : 'text-ink-3'}`}
                    >
                      <span className="text-[11px] font-medium uppercase tracking-[0.08em]">
                        {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                      </span>
                      <span className="tabular text-[11px]">{day.getDate()}</span>
                    </header>

                    {dayIdeas.map((idea, i) => (
                      <IdeaCard
                        key={idea.id}
                        idea={idea}
                        index={i}
                        detail={cardDetail}
                        onDragStart={() => setDragging(idea.id)}
                        onOpen={() => openReview(idea.id)}
                      />
                    ))}

                    {/* The rest of the column is a drop target: dashed and labelled
                        when the day is empty, quiet otherwise, lit while dragging. */}
                    {spare > 0 ? (
                      <div
                        className={`flex items-center justify-center rounded-xl border border-dashed px-2 py-6 text-center text-[10.5px] transition-colors ${
                          dragging
                            ? 'border-accent bg-accent/6 text-accent-bright'
                            : dayIdeas.length === 0
                              ? 'border-line text-ink-3'
                              : 'border-transparent text-transparent'
                        }`}
                        style={{ gridRow: `span ${spare}` }}
                      >
                        Drop content here
                      </div>
                    ) : null}
                  </div>
                )
              })}
            </section>
          )}

      {/* ── More suggestions ──────────────────────────────────────────────── */}
          <section>
            <header className="mb-3">
              <h2 className="display text-lg">More suggestions</h2>
              <p className="mt-0.5 text-[12px] text-ink-3">
                Ideas the agents formed that have no caption yet, plus anything ranked below the
                calendar cut. They move onto the calendar once the Content Agent drafts them. Drag the
                grip under any column to resize all four.
              </p>
            </header>

            {suggestions.length === 0 ? (
              <EmptyState title="Nothing waiting" body="Every idea the agents formed is on the calendar." />
            ) : (
              <div className="grid gap-3 lg:grid-cols-2">
                {PLATFORMS.map((platform) => {
                  const rows = suggestions
                    .filter((idea) => idea.platform === platform)
                    .sort((a, b) => (a.platform_rank ?? 99) - (b.platform_rank ?? 99))

                  return (
                    <div
                      key={platform}
                      className="card flex flex-col overflow-hidden p-3"
                      style={{ height: panelHeight }}
                    >
                      <header className="mb-2 flex shrink-0 items-center justify-between gap-2">
                        <span className="flex items-center gap-1.5">
                          <PlatformIcon platform={platform} size={13} />
                          <span className="text-[12px] font-medium text-ink">{PLATFORM_LABEL[platform]}</span>
                        </span>
                        <span className="tabular text-[11px] text-ink-3">{rows.length}</span>
                      </header>

                      {/* Every row is here — the panel scrolls instead of hiding
                          them behind a "show all", so making the panel taller is
                          the only thing needed to read more. */}
                      {rows.length === 0 ? (
                        <p className="px-1 py-3 text-[11px] text-ink-3">
                          Nothing in the queue for this platform.
                        </p>
                      ) : (
                        <ul className="min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-0.5">
                          {rows.map((idea) => (
                            <SuggestionRow key={idea.id} idea={idea} />
                          ))}
                        </ul>
                      )}

                      <ResizeHandle height={panelHeight} onResize={commitHeight} />
                    </div>
                  )
                })}
              </div>
            )}
          </section>
        </div>

        <aside className="min-w-0">
          <CalendarAssistant />
        </aside>
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CARD
   ═══════════════════════════════════════════════════════════════════════════ */

const STATUS_TONE: Record<string, 'neutral' | 'accent' | 'good' | 'warn' | 'serious' | 'critical'> = {
  suggested: 'neutral',
  drafted: 'accent',
  in_review: 'warn',
  pending_leadership: 'serious',
  approved: 'good',
  scheduled: 'accent',
  published: 'good',
  rejected: 'critical',
}

const STATUS_LABEL: Record<string, string> = {
  suggested: 'Suggested',
  drafted: 'Drafted',
  in_review: 'In review',
  pending_leadership: 'With Leadership',
  approved: 'Approved',
  scheduled: 'Scheduled',
  published: 'Published',
  rejected: 'Rejected',
}

function IdeaCard({
  idea,
  index,
  detail,
  onDragStart,
  onOpen,
}: {
  idea: Idea
  index: number
  detail: CardDetail
  onDragStart: () => void
  onOpen: () => void
}) {
  const approveIdea = useStore((s) => s.approveIdea)
  const duplicateIdea = useStore((s) => s.duplicateIdea)
  const demoteIdea = useStore((s) => s.demoteIdea)
  const deleteIdea = useStore((s) => s.deleteIdea)

  const media = idea.media?.dataUri ?? gradientPlaceholder(idea.platform, idea.title)

  return (
    <article
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="group card card-hover anim-fade-up flex h-full cursor-pointer flex-col overflow-hidden"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      {/* Compact keeps a thin strip of the creative so the platform look still
          reads; standard shows the full creative; detailed gives the height to
          the words, since that level exists for reading. */}
      <div
        className="relative shrink-0 overflow-hidden"
        style={{ aspectRatio: detail === 'compact' ? '6 / 1' : detail === 'detailed' ? '4 / 1' : '1.91 / 1' }}
      >
        <img src={media} alt="" className="h-full w-full object-cover" />
        <span className="absolute bottom-1 right-1 rounded-full bg-page/80 px-1.5 py-0.5 text-[9px] text-ink-3 backdrop-blur-sm">
          {idea.media?.model ?? 'brand-svg'}
        </span>
      </div>

      <div className="flex flex-1 flex-col p-2.5">
        <div className="flex flex-wrap items-center gap-1">
          <Badge tone={STATUS_TONE[idea.status] ?? 'neutral'}>{STATUS_LABEL[idea.status] ?? idea.status}</Badge>
          {idea.is_new_trend ? <Badge tone="magenta">New trend</Badge> : null}
        </div>

        {/* The full title, always. A card the operator cannot read without
            opening is a card that fails at its one job. */}
        <h4 className="mt-1.5 text-[12.5px] font-semibold leading-snug text-ink">{idea.title}</h4>

        {detail !== 'compact' && idea.description ? (
          <p
            className={`mt-1 text-[10.5px] leading-relaxed text-ink-3 ${
              detail === 'detailed' ? 'line-clamp-4' : 'line-clamp-2'
            }`}
          >
            {idea.description}
          </p>
        ) : null}

        {detail === 'detailed' ? (
          idea.draft?.body ? (
            <p className="mt-1.5 line-clamp-6 whitespace-pre-wrap border-l-2 border-line pl-2 text-[10.5px] leading-relaxed text-ink-2">
              {idea.draft.body}
            </p>
          ) : (
            <p className="mt-1.5 border-l-2 border-dashed border-line pl-2 text-[10.5px] italic leading-relaxed text-ink-3">
              No caption written yet.
            </p>
          )
        ) : null}

        {/* Pinned to the bottom so the meta line sits at the same height on
            every card in the row, whatever the title above it took. */}
        <div className="mt-auto pt-2">
          {detail !== 'compact' ? (
            <div className="mb-1.5 flex flex-wrap items-center gap-1">
              {idea.draft ? <Badge tone="good">Caption</Badge> : null}
              {idea.media ? <Badge tone="accent">Image</Badge> : null}
            </div>
          ) : null}

          <div className="flex items-center gap-1.5 border-t border-line pt-1.5 text-[10.5px] text-ink-3">
            <PlatformIcon platform={idea.platform} size={11} />
            <span className="truncate">{PLATFORM_LABEL[idea.platform]}</span>
            <span className="tabular whitespace-nowrap">{idea.scheduled_time}</span>
            <span className="tabular ml-auto text-ink-2">{idea.confidence}%</span>
          </div>

          <div
            className="mt-1.5 flex items-center gap-1 opacity-0 transition-opacity duration-[var(--dur-fast)] focus-within:opacity-100 group-hover:opacity-100"
            onClick={(event) => event.stopPropagation()}
          >
            <IconAction label="Approve" onClick={() => void approveIdea(idea.id)}>
              <Check size={12} />
            </IconAction>
            <IconAction label="Duplicate" onClick={() => duplicateIdea(idea.id)}>
              <Copy size={12} />
            </IconAction>
            <IconAction label="Demote to suggestions" onClick={() => void demoteIdea(idea.id)}>
              <ArrowDown size={12} />
            </IconAction>
            <IconAction label="Withdraw" danger onClick={() => void deleteIdea(idea.id)}>
              <Trash2 size={12} />
            </IconAction>
          </div>
        </div>
      </div>
    </article>
  )
}

function IconAction({
  label,
  onClick,
  danger = false,
  children,
}: {
  label: string
  onClick: () => void
  danger?: boolean
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className={`rounded-md border border-line p-1 transition-colors ${
        danger ? 'text-ink-3 hover:border-critical/50 hover:text-critical-ink' : 'text-ink-3 hover:border-accent hover:text-accent-bright'
      }`}
    >
      {children}
    </button>
  )
}

function SuggestionRow({ idea }: { idea: Idea }) {
  const promoteIdea = useStore((s) => s.promoteIdea)
  const openReview = useStore((s) => s.openReview)

  return (
    <li className="flex items-start gap-2 rounded-lg border border-line px-2 py-2 transition-colors hover:border-line-strong hover:bg-surface-2">
      <span className="tabular mt-0.5 shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
        #{idea.platform_rank}
      </span>

      <img
        src={idea.media?.dataUri ?? gradientPlaceholder(idea.platform, idea.title)}
        alt=""
        className="mt-0.5 h-9 w-14 shrink-0 rounded object-cover"
      />

      {/* The title wraps instead of truncating, and the description comes with
          it. Reading a suggestion should not require opening it — that was the
          only way to see what one actually said. */}
      <button type="button" onClick={() => openReview(idea.id)} className="min-w-0 flex-1 text-left">
        <span className="line-clamp-2 block text-[11.5px] font-medium leading-snug text-ink">
          {idea.title}
        </span>
        {idea.description ? (
          <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-relaxed text-ink-3">
            {idea.description}
          </span>
        ) : null}
        <span className="tabular mt-1 block text-[10px] text-ink-3">
          {localDate(idea.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ·{' '}
          {idea.scheduled_time} · {fmt(idea.confidence)}%
        </span>
      </button>

      <button
        type="button"
        onClick={() => void promoteIdea(idea.id)}
        title="Promote to calendar"
        aria-label={`Promote ${idea.title} to the calendar`}
        className="shrink-0 rounded-md border border-line p-1 text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
      >
        <ArrowUp size={12} />
      </button>
    </li>
  )
}

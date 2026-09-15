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

/* ── Status → tone ──────────────────────────────────────────────────────── */

const STATUS_TONE: Partial<Record<IdeaStatus, string>> = {
  approved: 'var(--color-good)',
  scheduled: 'var(--color-good)',
  published: 'var(--color-good)',
  drafted: 'var(--color-accent)',
  in_review: 'var(--color-serious)',
  pending_leadership: 'var(--color-serious)',
}
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
        <h1 className="whitespace-nowrap text-[17px] font-semibold tracking-[-0.02em] text-ink">Weekly Calendar</h1>
        <span className="inline-flex items-center gap-[7px] whitespace-nowrap rounded-md border border-line-strong px-[9px] py-1 text-[9.5px] tracking-[0.1em] text-ink-3">
          TOP {cap} PER PLATFORM
        </span>
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
              <span className="shrink-0 rounded-[4px] border border-line-strong px-[5px] text-[9.5px] text-ink-3">⌘K</span>
            </button>

            {askOpen ? (
              <div
                role="dialog"
                aria-label="Ask Ethara about this week"
                className="absolute right-0 top-[calc(100%+10px)] z-30 w-[420px] max-w-[calc(100vw-48px)] origin-top-right overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-2xl"
                style={{ animation: `eth-pop 380ms ${EASE} both` }}
              >
                <div className="flex items-center gap-2 border-b border-line px-3.5 py-2 text-[9.5px] tracking-[0.1em] text-ink-3">
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
      <div className="flex min-h-0 flex-1 flex-col xl:flex-row">
        <section
          className="relative min-w-0 flex-1 overflow-hidden border-r border-line px-[18px] py-3.5"
        >
          <div className="relative z-10 mb-2.5 flex items-center gap-2.5">
            <h2 className="text-[13.5px] font-semibold tracking-[-0.015em] text-ink">
              {totalPlaced} slot{totalPlaced === 1 ? '' : 's'} placed
            </h2>
            <span className="text-[10px] text-ink-3">
              {totalFree} of {cap * PLATFORMS.length} slots free · open a card to edit it or move its day
            </span>
          </div>

          <div
            ref={gridRef}
            className="grid grid-cols-2 items-start gap-[9px] md:grid-cols-4 xl:grid-cols-7"
          >
              {days.map((day, i) => {
                const iso = isoDate(day)
                const dayIdeas = primary
                  .filter((idea) => idea.scheduled_date === iso)
                  .sort((a, b) => timeValue(a.scheduled_time) - timeValue(b.scheduled_time))
                const isToday = iso === todayIso
                return (
                  <div
                    key={iso}
                    className="flex min-w-0 flex-col gap-[7px]"
                    style={{ animation: `eth-rise 420ms ${EASE} ${120 + i * 50}ms both` }}
                  >
                    <header className="flex items-baseline gap-1.5 px-0.5 pb-0.5">
                      <span className={`text-[9.5px] tracking-[0.12em] ${isToday ? 'text-accent-bright' : 'text-ink-3'}`}>
                        {day.toLocaleDateString('en-GB', { weekday: 'short' }).toUpperCase()}
                      </span>
                      <span className={`text-[11px] ${isToday ? 'text-ink' : 'text-ink-3'}`}>{day.getDate()}</span>
                      {isToday ? <span className="ml-auto text-[8.5px] tracking-[0.1em] text-accent-bright">TODAY</span> : null}
                    </header>

                    {dayIdeas.map((idea) => (
                      <SlotCard
                        key={idea.id}
                        idea={idea}
                        onOpen={() => openReview(idea.id)}
                      />
                    ))}

                    {/* A day with room left says so. It is a label, not a drop
                        target — nothing on this grid is draggable. */}
                    <div className="flex min-h-[84px] items-center justify-center rounded-[9px] border border-dashed border-line-strong text-[9px] tracking-[0.1em] text-ink-3">
                      {dayIdeas.length === 0 ? 'NO SLOT TAKEN' : 'ROOM FOR MORE'}
                    </div>
                  </div>
                )
              })}
          </div>
        </section>

        <Queue queued={queued} capacity={capacity} weekPrimary={weekPrimary} cap={cap} />
      </div>
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CARD — a title, with a small creative under it
   ═══════════════════════════════════════════════════════════════════════════ */

function SlotCard({ idea, onOpen }: { idea: Idea; onOpen: () => void }) {
  const bar = STATUS_TONE[idea.status] ?? 'var(--color-line-strong)'
  const ink = STATUS_INK[idea.status] ?? 'var(--color-ink-3)'
  const chip = STATUS_CHIP[idea.status] ?? idea.status.toUpperCase()
  const colour = PLATFORM_TOKEN[idea.platform]

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
      onClick={onOpen}
      role="button"
      tabIndex={0}
      aria-label={`Open “${idea.title}” for editing`}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onOpen()
        }
      }}
      className="group relative flex cursor-pointer select-none flex-col overflow-hidden rounded-[9px] border border-line-strong bg-surface py-2 pl-[11px] pr-[9px] transition-[border-color,transform,opacity,box-shadow] duration-[320ms] ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:border-accent/60"
    >
      <span aria-hidden="true" className="absolute inset-y-0 left-0 w-0.5" style={{ background: bar }} />
      <div className="flex items-center gap-1.5">
        <PlatformIcon platform={idea.platform} size={11} />
        <span className="text-[9.5px] text-ink-3">{clock(idea.scheduled_time)}</span>
        {idea.is_new_trend ? <span className="text-[8.5px] tracking-[0.1em] text-magenta">NEW</span> : null}
        <span className="ml-auto text-[9.5px]" style={{ color: ink }}>{idea.confidence}</span>
      </div>
      <div className="mt-1.5 text-[11.5px] font-semibold leading-snug text-ink">{idea.title}</div>
      <div
        className="relative mt-2 h-[54px] overflow-hidden rounded-md"
        style={{
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
            <span className="absolute bottom-[5px] left-[7px] text-[7.5px] tracking-[0.12em] text-white/85">
              {idea.media?.model ? idea.media.model.toUpperCase() : 'ETHARA · NO CREATIVE YET'}
            </span>
          </>
        )}
        <span
          className="absolute right-1.5 top-[5px] rounded-[3px] px-[5px] py-px text-[8px] tracking-[0.08em]"
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
    <section className="flex w-full shrink-0 flex-col bg-surface-2 xl:sticky xl:top-0 xl:h-[calc(100vh-56px)] xl:w-[400px]" aria-label="Ranked queue">
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
                <span className="text-[9.5px] text-ink-3">{rows.length} waiting</span>
                <span className={`ml-auto text-[9.5px] tracking-[0.08em] ${c.free > 0 ? 'text-serious' : 'text-ink-3'}`}>
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
                    <div className="flex items-center gap-2">
                      <span className="w-[18px] shrink-0 text-[10px] text-ink-3">#{idea.platform_rank ?? '–'}</span>
                      <PlatformIcon platform={idea.platform} size={11} />
                      <button type="button" onClick={() => openReview(idea.id)} className="min-w-0 flex-1 text-left text-[11.5px] font-medium leading-snug text-ink hover:text-accent-bright">
                        {idea.title}
                      </button>
                      <span className="text-[10px] text-ink-3">{idea.confidence}%</span>
                    </div>

                    {isArmed ? (
                      <div className={`mt-2 border-l pl-[9px] ${c.free > 0 ? 'border-good/60' : 'border-serious/60'}`} style={{ animation: `eth-row-stream 260ms ${EASE} both` }}>
                        {c.free > 0 ? (
                          <>
                            <div className="text-[9px] tracking-[0.12em] text-good-ink">A SLOT IS FREE</div>
                            <div className="mt-1 text-[11.5px] leading-relaxed text-ink-2">Takes the first open slot on {PLATFORM_LABEL[c.platform]}. Nothing is displaced.</div>
                          </>
                        ) : (
                          <>
                            <div className="text-[9px] tracking-[0.12em] text-serious">PROMOTING THIS DISPLACES</div>
                            <div className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
                              #{cap} <strong className="font-semibold">“{weakest?.title ?? 'the weakest placed post'}”</strong> — which returns to this queue with its rank. Nothing is deleted.
                            </div>
                          </>
                        )}
                        {idea.status === 'suggested' ? (
                          <div className="mt-1 text-[9.5px] text-ink-3">no caption yet · SpongeBob drafts it once it holds a slot</div>
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

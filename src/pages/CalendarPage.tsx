/**
 * WEEKLY CALENDAR
 *
 * The grid renders only `primary` cards — the top ten per platform. Everything
 * the agents placed but kept off the calendar sits below in More suggestions,
 * with its rank, promotable in one click.
 */

import { useMemo, useState } from 'react'
import { ChevronLeft, ChevronRight, Copy, Trash2, ArrowUp, ArrowDown, Check } from 'lucide-react'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { gradientPlaceholder } from '../lib/image-gen'
import { Tilt } from '../components/tilt'
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

function isoDate(date: Date): string {
  return date.toISOString().slice(0, 10)
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
  const settings = useStore((s) => s.settings)
  const moveIdea = useStore((s) => s.moveIdea)
  const openReview = useStore((s) => s.openReview)

  const [weekOffset, setWeekOffset] = useState(0)
  const [dragging, setDragging] = useState<string | null>(null)
  const [showAllSuggestions, setShowAllSuggestions] = useState(false)

  const weekStart = useMemo(() => addDays(startOfWeek(new Date()), weekOffset * 7), [weekOffset])
  const days = useMemo(() => Array.from({ length: 7 }, (_, i) => addDays(weekStart, i)), [weekStart])
  const todayIso = isoDate(new Date())

  const primary = ideas.filter((i) => i.calendar_slot === 'primary' && i.status !== 'rejected')
  const suggestions = ideas.filter((i) => i.calendar_slot === 'suggestion' && i.status !== 'rejected')

  const weekIdeas = primary.filter((idea) =>
    days.some((day) => isoDate(day) === idea.scheduled_date),
  )

  const counts = PLATFORMS.map((platform) => ({
    platform,
    primary: primary.filter((i) => i.platform === platform).length,
    suggestions: suggestions.filter((i) => i.platform === platform).length,
  }))

  return (
    <>
      <PageHeader
        title="Weekly Calendar"
        subtitle="The top ten per platform take a slot. Everything else is ranked and waiting below."
        agents={['calendar', 'caption', 'image', 'review']}
        askPrompt="Draft Thursday's LinkedIn post"
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

            <div className="flex flex-wrap items-center gap-1.5">
              {counts.map((count) => (
                <span
                  key={count.platform}
                  className="flex items-center gap-1.5 rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3"
                >
                  <PlatformIcon platform={count.platform} size={11} />
                  <span className="tabular">
                    {count.primary}/{settings.topPerPlatform}
                  </span>
                </span>
              ))}
              <span className="tabular text-[11px] text-ink-3">· {suggestions.length} in suggestions</span>
            </div>
          </>
        }
      />

      {weekIdeas.length === 0 ? (
        <EmptyState
          title="No scheduled content this week"
          body="Move to another week, or ask Ethara to run discovery."
          action={
            <Btn variant="primary" onClick={() => useStore.getState().openBar('Run SocialAI')}>
              Ask Ethara to run discovery
            </Btn>
          }
          className="mb-6"
        />
      ) : (
        <section className="mb-6 grid grid-cols-2 gap-2.5 md:grid-cols-4 xl:grid-cols-7">
          {days.map((day) => {
            const iso = isoDate(day)
            const dayIdeas = primary
              .filter((idea) => idea.scheduled_date === iso)
              .sort((a, b) => timeValue(a.scheduled_time) - timeValue(b.scheduled_time))
            const isToday = iso === todayIso

            return (
              <div
                key={iso}
                onDragOver={(event) => event.preventDefault()}
                onDrop={() => {
                  if (dragging) void moveIdea(dragging, iso)
                  setDragging(null)
                }}
                className="flex min-h-40 flex-col gap-2"
              >
                <header className={`flex items-baseline gap-1.5 px-1 ${isToday ? 'text-accent-bright' : 'text-ink-3'}`}>
                  <span className="text-[11px] font-medium uppercase tracking-[0.08em]">
                    {day.toLocaleDateString('en-GB', { weekday: 'short' })}
                  </span>
                  <span className="tabular text-[11px]">{day.getDate()}</span>
                </header>

                {dayIdeas.length === 0 ? (
                  <div className="flex flex-1 items-center justify-center rounded-xl border border-dashed border-line px-2 py-6 text-center text-[10.5px] text-ink-3">
                    Drop content here
                  </div>
                ) : (
                  dayIdeas.map((idea, i) => (
                    <IdeaCard
                      key={idea.id}
                      idea={idea}
                      index={i}
                      onDragStart={() => setDragging(idea.id)}
                      onOpen={() => openReview(idea.id)}
                    />
                  ))
                )}
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
            Ranked 11 and below. The agents placed these but kept them off the calendar — promote any of
            them to take a slot.
          </p>
        </header>

        {suggestions.length === 0 ? (
          <EmptyState title="Nothing waiting" body="Every idea the agents formed is on the calendar." />
        ) : (
          <div className="grid gap-3 lg:grid-cols-3">
            {PLATFORMS.map((platform) => {
              const rows = suggestions
                .filter((idea) => idea.platform === platform)
                .sort((a, b) => (a.platform_rank ?? 99) - (b.platform_rank ?? 99))
              const shown = showAllSuggestions ? rows : rows.slice(0, 6)

              return (
                <div key={platform} className="card p-3">
                  <header className="mb-2 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <PlatformIcon platform={platform} size={13} />
                      <span className="text-[12px] font-medium text-ink">{PLATFORM_LABEL[platform]}</span>
                    </span>
                    <span className="tabular text-[11px] text-ink-3">{rows.length}</span>
                  </header>

                  {rows.length === 0 ? (
                    <p className="px-1 py-3 text-[11px] text-ink-3">Nothing in the queue for this platform.</p>
                  ) : (
                    <ul className="space-y-1.5">
                      {shown.map((idea) => (
                        <SuggestionRow key={idea.id} idea={idea} />
                      ))}
                    </ul>
                  )}

                  {rows.length > 6 ? (
                    <button
                      type="button"
                      onClick={() => setShowAllSuggestions(!showAllSuggestions)}
                      className="mt-2 text-[11px] text-accent-bright transition-colors hover:text-accent"
                    >
                      {showAllSuggestions ? 'Show fewer' : `Show all ${rows.length}`}
                    </button>
                  ) : null}
                </div>
              )
            })}
          </div>
        )}
      </section>
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
  onDragStart,
  onOpen,
}: {
  idea: Idea
  index: number
  onDragStart: () => void
  onOpen: () => void
}) {
  const approveIdea = useStore((s) => s.approveIdea)
  const duplicateIdea = useStore((s) => s.duplicateIdea)
  const demoteIdea = useStore((s) => s.demoteIdea)
  const deleteIdea = useStore((s) => s.deleteIdea)

  const media = idea.media?.dataUri ?? gradientPlaceholder(idea.platform, idea.title)

  return (
    <Tilt maxDeg={6} className="rounded-[14px]">
    <article
      draggable
      onDragStart={onDragStart}
      onClick={onOpen}
      className="group card card-hover anim-fade-up cursor-pointer overflow-hidden"
      style={{ animationDelay: `${Math.min(index, 12) * 30}ms` }}
    >
      <div className="relative overflow-hidden" style={{ aspectRatio: '1.91 / 1' }}>
        <img
          src={media}
          alt=""
          className="h-full w-full object-cover transition-transform duration-[var(--dur-slow)] ease-[var(--ease-out-soft)] group-hover:scale-105"
        />
        <span className="absolute bottom-1 right-1 rounded-full bg-page/80 px-1.5 py-0.5 text-[9px] text-ink-3 backdrop-blur-sm">
          {idea.media?.model ?? 'brand-svg'}
        </span>
      </div>

      <div className="p-2.5">
        <div className="flex items-start gap-1.5">
          {idea.is_new_trend ? <Badge tone="magenta">NEW TREND</Badge> : null}
        </div>
        <h4 className="mt-1 line-clamp-2 text-[12px] font-medium leading-snug text-ink">{idea.title}</h4>
        <p className="mt-0.5 line-clamp-2 text-[10.5px] leading-relaxed text-ink-3">{idea.description}</p>

        <div className="mt-1.5 flex flex-wrap items-center gap-1">
          {idea.draft ? <Badge tone="good">Caption</Badge> : null}
          {idea.media ? <Badge tone="accent">Image</Badge> : null}
        </div>

        <div className="mt-1.5 flex items-center gap-1.5 text-[10.5px] text-ink-3">
          <PlatformIcon platform={idea.platform} size={11} />
          <span>{PLATFORM_LABEL[idea.platform]}</span>
          <span className="tabular">{idea.scheduled_time}</span>
          <span className="tabular ml-auto">{idea.confidence}%</span>
        </div>

        <div className="mt-1.5">
          <Badge tone={STATUS_TONE[idea.status] ?? 'neutral'}>{STATUS_LABEL[idea.status] ?? idea.status}</Badge>
        </div>

        <div
          className="mt-2 flex items-center gap-1 opacity-0 transition-opacity duration-[var(--dur-fast)] group-hover:opacity-100"
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
    </article>
    </Tilt>
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
    <li className="flex items-center gap-2 rounded-lg border border-line px-2 py-1.5 transition-colors hover:border-line-strong hover:bg-surface-2">
      <span className="tabular shrink-0 rounded-full border border-line px-1.5 py-0.5 text-[10px] text-ink-3">
        #{idea.platform_rank}
      </span>

      <img
        src={idea.media?.dataUri ?? gradientPlaceholder(idea.platform, idea.title)}
        alt=""
        className="h-8 w-12 shrink-0 rounded object-cover"
      />

      <button type="button" onClick={() => openReview(idea.id)} className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[11.5px] font-medium text-ink">{idea.title}</span>
        <span className="tabular block text-[10px] text-ink-3">
          {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ·{' '}
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

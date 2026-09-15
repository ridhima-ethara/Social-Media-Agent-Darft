/**
 * THE CALENDAR ASSISTANT — the right-hand column of the Weekly Calendar.
 *
 * The same command plane the ⌘K bar drives (Qwen3 over Ollama when configured,
 * the in-bundle deterministic parser otherwise), surfaced on the Weekly Calendar
 * so an operator can change the calendar and edit a post's caption or image
 * without leaving the screen. Every rule the plane enforces holds here: the plan
 * is shown before it runs, and the confirm gate is token-validated.
 *
 * The transcript itself is `Exchange`, shared with the narration rail, so the two
 * surfaces cannot drift apart in what a turn looks like.
 *
 * ONLY THIS SESSION'S EXCHANGES. `/state` returns the whole stored conversation,
 * which meant a panel opened on a fresh calendar led with hours-old turns about
 * something else. It shows the most recent few and says how many are older,
 * rather than presenting stale work as though it just happened.
 */

import { useEffect, useRef, useState } from 'react'
import { CornerDownLeft, Eraser, Sparkles } from 'lucide-react'
import { useStore } from '../../store'
import { Select, Btn, PLATFORM_LABEL } from '../ui'
import { AssistantCore } from './core'
import { ConfirmCard } from './confirm-card'
import { Exchange } from './exchange'

/** Real examples, each mapping to a tool the plane already holds. */
const EXAMPLES = ['Move it to Friday', 'Promote the top suggestion', 'Shorten the caption', 'How did last month perform?']

/** Older turns stay reachable in the rail; the panel leads with recent work. */
const VISIBLE_EXCHANGES = 4

export function CalendarAssistant() {
  const turns = useStore((s) => s.assistant.turns)
  const coreState = useStore((s) => s.assistant.coreState)
  const streaming = useStore((s) => s.assistant.streaming)
  const pendingConfirm = useStore((s) => s.assistant.pendingConfirm)
  const apiMode = useStore((s) => s.apiMode)
  const ideas = useStore((s) => s.ideas)
  const sendCommand = useStore((s) => s.sendCommand)
  const confirmPlan = useStore((s) => s.confirmPlan)
  const toggleRail = useStore((s) => s.toggleRail)

  const [value, setValue] = useState('')
  const [targetId, setTargetId] = useState('')
  const [cleared, setCleared] = useState(false)
  const scroller = useRef<HTMLDivElement | null>(null)

  /*
   * Both groups are targetable, and the grouping says which is which.
   *
   * The calendar now carries only drafted posts, so listing just those would
   * make the twenty-odd ideas still waiting on a caption unreachable — and
   * "draft this one" is exactly the instruction they need.
   */
  const live = ideas.filter((idea) => idea.status !== 'rejected')
  const onCalendar = live.filter(
    (idea) => idea.calendar_slot === 'primary' && idea.status !== 'suggested',
  )
  const waiting = live.filter(
    (idea) => idea.calendar_slot === 'suggestion' || idea.status === 'suggested',
  )
  const targets = [...onCalendar, ...waiting]
  const target = targets.find((idea) => idea.id === targetId) ?? null

  /*
   * One row per exchange, so a live turn and a reloaded one render identically.
   * A live send appends a second, assistant-speaker turn locally; once the state
   * refetch lands, the server's single row supersedes it. Filtering the
   * assistant-speaker rows keeps the same exchange from appearing twice during
   * that hand-over.
   */
  const all = turns.filter((turn) => turn.speaker === 'operator' || turn.plan || turn.narration)
  const shown = cleared ? [] : all.slice(-VISIBLE_EXCHANGES)
  const older = cleared ? 0 : all.length - shown.length

  useEffect(() => {
    const element = scroller.current
    if (!element) return
    element.scrollTop = element.scrollHeight
  }, [turns, pendingConfirm])

  const send = (raw: string): void => {
    const text = raw.trim()
    if (text.length === 0) return
    setValue('')
    setCleared(false)

    // The chosen post travels with the instruction as the screen's focus, so the
    // plane resolves "shorten the caption" instead of asking which post and which
    // platform — it can already see both.
    void sendCommand(
      text,
      'text',
      target === null
        ? undefined
        : { type: 'idea', id: target.id, title: target.title, platform: target.platform },
    )

    // The conversation stays on this panel; the plane opens the slide-over rail
    // by default and the transcript is already inline here.
    if (useStore.getState().assistant.railOpen) toggleRail()
  }

  const hasTranscript = shown.length > 0 || pendingConfirm !== null

  return (
    <section
      className="card flex flex-col overflow-hidden"
      aria-label="Calendar assistant"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2.5">
        <AssistantCore state={coreState} size={22} className="shrink-0" />

        <span className="min-w-0 flex-1">
          <span className="display block truncate text-[13px] leading-tight">Calendar Assistant</span>
          <span className="flex items-center gap-1.5 text-[10.5px] leading-tight text-ink-3">
            <span
              className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                apiMode === 'connected' ? 'bg-good' : 'bg-warn'
              }`}
              aria-hidden="true"
            />
            {apiMode === 'connected' ? 'Qwen3 · live' : 'Standalone parser'}
          </span>
        </span>

        {hasTranscript ? (
          <button
            type="button"
            onClick={() => setCleared(true)}
            title="Clear this panel"
            aria-label="Clear this panel"
            className="shrink-0 rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
          >
            <Eraser size={13} />
          </button>
        ) : null}
      </header>

      {/* ── Target ─────────────────────────────────────────────────────────── */}
      {targets.length > 0 ? (
        <div className="shrink-0 border-b border-line px-3 py-2">
          <label
            htmlFor="calendar-assistant-target"
            className="mb-1 block text-[10px] uppercase tracking-[0.09em] text-ink-3"
          >
            Working on
          </label>
          <Select
            id="calendar-assistant-target"
            value={targetId}
            onChange={setTargetId}
            className="w-full"
            size="sm"
            options={[
              { value: '', label: 'The whole calendar' },
              ...onCalendar.map((idea) => ({
                value: idea.id,
                label: `${PLATFORM_LABEL[idea.platform]} · ${idea.scheduled_date} · ${idea.title.slice(0, 34)}`,
                group: 'On the calendar (drafted)',
              })),
              ...waiting.map((idea) => ({
                value: idea.id,
                label: `${PLATFORM_LABEL[idea.platform]} · ${idea.scheduled_date} · ${idea.title.slice(0, 34)}`,
                group: 'Waiting on a caption',
              })),
            ]}
          />
        </div>
      ) : null}

      {/* ── Transcript, or the opening prompts ─────────────────────────────── */}
      {hasTranscript ? (
        <div ref={scroller} className="max-h-[26rem] min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {older > 0 ? (
            <button
              type="button"
              onClick={toggleRail}
              className="mb-2.5 w-full rounded-lg border border-dashed border-line py-1 text-[10.5px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
            >
              {older} earlier exchange{older === 1 ? '' : 's'} — open the full transcript
            </button>
          ) : null}

          <ul className="space-y-3.5">
            {shown.map((turn) => (
              <Exchange key={turn.id} turn={turn} streaming={streaming} />
            ))}
          </ul>

          {pendingConfirm ? (
            <div className="mt-3">
              <ConfirmCard confirm={pendingConfirm} onDecision={confirmPlan} />
            </div>
          ) : null}
        </div>
      ) : (
        <div className="min-h-0 flex-1 px-3 py-3">
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            {target
              ? `Working on “${target.title.slice(0, 32)}…”. I show the plan before I run it.`
              : 'Pick a post above to act on one, or ask about the week. I show the plan before I run it.'}
          </p>

          {/* Full-width rows rather than wrapped pills: at this column width a
              pill row broke after every second chip and read as ragged. */}
          <ul className="mt-2.5 space-y-1">
            {EXAMPLES.map((example) => (
              <li key={example}>
                <button
                  type="button"
                  onClick={() => send(example)}
                  className="group flex w-full items-center gap-2 rounded-lg border border-line px-2.5 py-1.5 text-left text-[11.5px] text-ink-2 transition-colors hover:border-accent hover:bg-surface-2 hover:text-ink"
                >
                  <Sparkles
                    size={11}
                    className="shrink-0 text-ink-3 transition-colors group-hover:text-accent-bright"
                    aria-hidden="true"
                  />
                  <span className="truncate">{example}</span>
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* ── Composer ───────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-t border-line px-3 py-2.5">
        <input
          value={value}
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              send(value)
            }
          }}
          placeholder={target ? 'Change this post…' : 'Ask about the calendar…'}
          aria-label="Ask the calendar assistant"
          className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
        />
        <Btn
          variant="primary"
          onClick={() => send(value)}
          disabled={value.trim().length === 0}
          aria-label="Send"
        >
          <CornerDownLeft size={13} />
        </Btn>
      </div>
    </section>
  )
}

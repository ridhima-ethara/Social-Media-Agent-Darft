/**
 * THE CALENDAR ASSISTANT — the right-hand column of the Weekly Calendar.
 *
 * The same command plane the ⌘K bar drives (the configured text model — Gemini
 * on this deployment — or the in-bundle deterministic parser without one), surfaced on the Weekly Calendar
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
import { CornerDownLeft, Eraser } from 'lucide-react'
import { useStore } from '../../store'
import { Select, Btn, PLATFORM_LABEL } from '../ui'
import { AssistantCore } from './core'
import { ConfirmCard } from './confirm-card'
import { Exchange } from './exchange'

/*
 * NO CANNED PROMPTS.
 *
 * Four suggestion rows used to fill the panel before a single word had been
 * exchanged, so the assistant looked busy while holding nothing — and they
 * pushed the actual conversation below the fold once one started. The composer
 * placeholder already says what the panel accepts, which is the same
 * information in a line instead of a screenful.
 */

/**
 * How much history the panel shows.
 *
 * Raised from 4: the panel's job is the conversation, and four exchanges meant
 * a normal back-and-forth scrolled its own beginning away. Anything older stays
 * one click from here in the full transcript.
 */
const VISIBLE_EXCHANGES = 12

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
   * Written posts, and the topics with no post yet — the Topic Queue's future
   * topics and any post-ready date still being written. "Generate the post for
   * this one" is exactly the instruction a topic needs.
   */
  const live = ideas.filter((idea) => idea.status !== 'rejected' && idea.calendar_slot === 'primary')
  const onCalendar = live.filter((idea) => idea.status !== 'suggested')
  const waiting = live.filter((idea) => idea.status === 'suggested')
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
    /*
     * A PENDING CONFIRMATION MUST NOT ARRIVE BELOW THE FOLD.
     *
     * A bulk calendar instruction stops and waits for an answer. If the card
     * asking for it renders off the bottom of the transcript, the operator sees
     * their instruction accepted and the calendar unchanged, and concludes the
     * assistant is broken — which is exactly what was reported.
     *
     * Scrolled on the next frame rather than immediately: the card is being
     * laid out in this same commit, so measuring now would use the height the
     * transcript had before it existed.
     */
    const toBottom = (): void => {
      element.scrollTop = element.scrollHeight
    }
    toBottom()
    if (pendingConfirm) requestAnimationFrame(toBottom)
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
      /*
       * A BOUNDED HEIGHT, SO THE TRANSCRIPT CAN SCROLL.
       *
       * `flex-1 min-h-0 overflow-y-auto` on the transcript only scrolls when
       * something above it constrains the height. This section used to take its
       * height from its content, so the transcript grew forever and the popover
       * around it did the scrolling instead.
       *
       * `max-h-[68vh]` bounds it against the viewport rather than a fixed pixel
       * count, so it adapts to a laptop and a large monitor without a second
       * breakpoint, and `min-h-0` lets the flex child actually shrink.
       */
      className="card flex max-h-[68vh] min-h-0 flex-col overflow-hidden"
      aria-label="Calendar assistant"
    >
      {/* ── Header ─────────────────────────────────────────────────────────── */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-line px-3 py-2.5">
        <AssistantCore state={coreState} size={22} className="shrink-0" />

        <span className="min-w-0 flex-1">
          <span className="display block truncate text-[13px] leading-tight">Calendar Assistant</span>
          {/* Only the degraded state is worth a line. Connected needs no label —
              and the old one was a hard-coded "Qwen3" that was not the model
              answering: the plane runs on the configured text provider. */}
          {apiMode === 'connected' ? null : (
            <span className="flex items-center gap-1.5 text-[10.5px] leading-tight text-ink-3">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warn" aria-hidden="true" />
              Offline · built-in parser
            </span>
          )}
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
                group: 'Topics with no post yet',
              })),
            ]}
          />
        </div>
      ) : null}

      {/* ── Transcript, or the opening prompts ─────────────────────────────── */}
      {hasTranscript ? (
        <div ref={scroller} className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
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
        /*
         * The empty state is one line, not a menu. An assistant that has done
         * nothing yet should look like it has done nothing yet.
         */
        <div className="min-h-0 flex-1 px-3 py-6">
          <p className="text-[11.5px] leading-relaxed text-ink-3">
            {target
              ? `Working on “${target.title.slice(0, 32)}…”. I show the plan before I run it.`
              : 'Ask about the week, or pick a post above to act on one. I show the plan before I run it.'}
          </p>
        </div>
      )}

      {/* ── Composer ───────────────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-end gap-2 border-t border-line px-3 py-2.5">
        {/*
          A TEXTAREA THAT GROWS, NOT A ONE-LINE INPUT.

          This was `<input>`, so anything longer than the box scrolled sideways
          and the operator could see about eight words of what they had typed.
          A caption instruction is routinely two sentences — "make it shorter
          and open on the benchmark rather than the model" — and you cannot
          check an instruction you cannot read.

          It grows with the content up to a ceiling, then scrolls, so a long
          paste is still reachable and the composer never eats the panel.
          Enter still sends; Shift+Enter makes a new line, which is the pairing
          people already expect from every other message box.
        */}
        <textarea
          value={value}
          rows={1}
          onChange={(event) => setValue(event.target.value)}
          onInput={(event) => {
            const el = event.currentTarget
            el.style.height = 'auto'
            el.style.height = `${Math.min(el.scrollHeight, 160)}px`
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter' || event.shiftKey) return
            event.preventDefault()
            send(value)
            const el = event.currentTarget
            el.style.height = 'auto'
          }}
          placeholder={target ? 'Change this post…' : 'Ask about the calendar…'}
          aria-label="Ask the calendar assistant"
          className="min-w-0 flex-1 resize-none bg-transparent py-1 text-[12.5px] leading-relaxed text-ink outline-none placeholder:text-ink-3"
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

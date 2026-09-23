/**
 * ONE EXCHANGE — the question, the work, the answer
 *
 * Shared by the ⌘K narration rail and the calendar's embedded panel, so the two
 * surfaces cannot disagree about what a turn looks like. They did: the rail still
 * rendered only `utterance` for an operator turn while the panel had been fixed,
 * so the same conversation showed replies in one place and silence in the other.
 *
 * ONE ROW PER EXCHANGE. The server persists a turn as a single row with
 * `speaker: 'operator'` carrying BOTH the utterance and the narration — the
 * answer is a column on the question, not a second row. Anything that renders
 * only the utterance drops every answer on the floor.
 */

import { useState } from 'react'
import { Check, ChevronDown, Loader, Volume2, X } from 'lucide-react'
import { RiskPill, timeAgo } from '../ui'
import { AssistantCore } from './core'
import type { AssistantTurn, PlanStep } from '../../types'

/* ═══════════════════════════════════════════════════════════════════════════
   ONE STEP — what the plane is doing, or did
   ═══════════════════════════════════════════════════════════════════════════ */

export function WorkStep({ step }: { step: PlanStep }) {
  const running = step.status === 'running'
  const failed = step.status === 'failed'
  const done = step.status === 'completed'

  return (
    <li className="flex items-start gap-2 py-1">
      <span className="mt-[3px] flex h-3.5 w-3.5 shrink-0 items-center justify-center" aria-hidden="true">
        {running ? (
          <Loader size={12} className="animate-spin text-accent-bright" />
        ) : done ? (
          <Check size={12} className="text-good-ink" />
        ) : failed ? (
          <X size={12} className="text-critical-ink" />
        ) : (
          <span className="h-1.5 w-1.5 rounded-full bg-ink-3" />
        )}
      </span>

      <span className="min-w-0 flex-1">
        <span className="flex flex-wrap items-baseline gap-x-1.5">
          <span className={`text-[11.5px] font-medium ${done || running ? 'text-ink' : 'text-ink-3'}`}>
            {step.toolName}
          </span>
          {step.durationMs !== undefined && done ? (
            <span className="tabular text-[10px] text-ink-3">{step.durationMs}ms</span>
          ) : null}
        </span>

        {/* What it found. After the fact that matters more than why it ran. */}
        {step.summary ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-2">{step.summary}</span>
        ) : running ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{step.why}</span>
        ) : null}

        {step.error ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-critical-ink">{step.error}</span>
        ) : null}
        {step.fallbackReason ? (
          <span className="mt-0.5 block text-[11px] leading-relaxed text-warn">{step.fallbackReason}</span>
        ) : null}
      </span>
    </li>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE OUTCOME LINE
   ═══════════════════════════════════════════════════════════════════════════ */

const WEEKDAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const MONTH = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

/**
 * "2026-09-27" → "Sun 27 Sep". A person reads a weekday, not an ISO date.
 * Spelled out rather than `toLocaleDateString`, whose en-GB month is "Sept".
 */
function humanDate(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const date = new Date(Date.UTC(y ?? 0, (m ?? 1) - 1, d ?? 1))
  if (Number.isNaN(date.getTime())) return iso
  return `${WEEKDAY[date.getUTCDay()]} ${date.getUTCDate()} ${MONTH[date.getUTCMonth()]}`
}

function humanDates(text: string): string {
  return text.replace(/\b\d{4}-\d{2}-\d{2}\b/g, humanDate)
}

/**
 * The move tool's sentence — `“Title” is now LinkedIn on 2026-09-27 at 10:30 AM.`
 * — read back into its parts, so the reply can show the post and where it went
 * as two clean lines. Any other sentence is shown as written.
 */
function parseMove(line: string): { title: string; when: string; platform: string } | null {
  const match = /^“(.+)” is now (.+?) on (\d{4}-\d{2}-\d{2}) at (.+?)\.?$/.exec(line.trim())
  if (!match) return null
  const [, title, platform, date, time] = match
  return { title: title ?? '', platform: platform ?? '', when: `${humanDate(date ?? '')} · ${time ?? ''}` }
}

/**
 * What changed, in one or two lines — the part the operator asked for.
 *
 * A reply used to open with every tool's finding, then the model's paraphrase
 * of those findings, then the plan: three tellings of one move, the first of
 * which could be a read step's "Nothing matches that" sitting above the move
 * that then succeeded. For a turn that changed something, the summaries of the
 * steps that WROTE are the outcome; the reads that led there are detail.
 * A turn that only read has no such step, and its answer is the narration.
 */
function outcomeOf(turn: AssistantTurn, steps: PlanStep[]): { kind: 'done' | 'answer' | 'failed'; lines: string[] } {
  if (turn.status === 'failed') return { kind: 'failed', lines: [turn.narration ?? ''] }
  const writes = steps.filter((s) => s.status === 'completed' && s.risk !== 'safe' && s.summary)
  if (writes.length > 0) {
    return { kind: 'done', lines: [...new Set(writes.map((s) => s.summary as string))] }
  }
  return { kind: 'answer', lines: [humanDates(turn.narration ?? '')] }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE EXCHANGE
   ═══════════════════════════════════════════════════════════════════════════ */

export function Exchange({
  turn,
  streaming,
  onSpeak,
}: {
  turn: AssistantTurn
  streaming: boolean
  /**
   * Reads the narration aloud. Optional because only the rail offers it — the
   * calendar panel sits beside the work it describes, where speech adds nothing.
   * Passed in rather than read from the store so this component stays a pure
   * renderer of a turn.
   */
  onSpeak?: (text: string) => void
}) {
  // Executed steps carry status and results; the stored plan only knows what was queued.
  const steps = (turn.steps && turn.steps.length > 0 ? turn.steps : turn.plan?.steps) ?? []
  const running = turn.status === 'running' || turn.status === 'planning'
  const awaiting = turn.status === 'awaiting_confirmation'
  const done = steps.filter((s) => s.status === 'completed').length
  const finished = turn.status === 'completed' || turn.status === 'failed' || turn.status === 'cancelled'
  // The work is what the operator watches while it runs, and what they can
  // check afterwards. Once the answer is in, it folds beneath the answer.
  const [showWork, setShowWork] = useState(!finished)
  // A live turn starts unfinished with its work open; when the answer lands the
  // work folds away, exactly as it is on a turn reloaded after the fact.
  // Adjusted during render rather than in an effect, so there is no frame in
  // which the finished answer shows with its work still open.
  const [wasFinished, setWasFinished] = useState(finished)
  if (finished !== wasFinished) {
    setWasFinished(finished)
    if (finished) setShowWork(false)
  }
  // The operator's own row carries the question and nothing else while a
  // conversation is live; the answer is the assistant's row that follows it.
  const questionOnly = turn.speaker === 'operator' && !turn.narration && !turn.plan && steps.length === 0

  return (
    <li className="anim-fade-up space-y-2">
      {/* The question */}
      {turn.utterance.trim().length > 0 ? (
        <div className="flex justify-end">
          <div className="max-w-[88%] rounded-2xl rounded-br-md border border-accent/35 bg-accent/10 px-3 py-2">
            {/*
              THE WHOLE QUERY, AS IT WAS TYPED.

              `whitespace-pre-wrap` keeps the line breaks a multi-line
              instruction was written with — the composer takes Shift+Enter now,
              and collapsing those breaks turned a structured brief into one run
              of prose. `break-words` stops a long URL or hashtag from forcing
              the bubble wider than the panel and clipping the rest.

              Nothing truncates: the bubble grows to whatever was asked, because
              the point of showing the question back is that it can be checked.
            */}
            <p className="whitespace-pre-wrap break-words text-[12px] leading-relaxed text-ink">
              {turn.utterance}
            </p>
            <p className="mono mt-0.5 text-right text-[10px] text-ink-3">
              {turn.channel === 'voice' ? 'voice · ' : ''}
              {timeAgo(turn.created_at)}
            </p>
          </div>
        </div>
      ) : null}

      {/* The work, then the answer — unless this row is only the question. */}
      {questionOnly ? null : (
      <div className="flex gap-2">
        <AssistantCore
          state={running ? 'working' : awaiting ? 'attention' : 'dormant'}
          size={18}
          className="mt-2.5 shrink-0"
        />

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* The outcome, first, once there is one. The explanation and the
              steps behind it are one tap away rather than stacked on top. */}
          {turn.narration && finished ? (() => {
            const outcome = outcomeOf(turn, steps)
            const hasDetail = steps.length > 0 || outcome.kind === 'done'
            const frame =
              outcome.kind === 'done'
                ? 'border-good/25 bg-good/[0.05]'
                : outcome.kind === 'failed'
                  ? 'border-critical/35 bg-critical/[0.05]'
                  : 'border-line-strong bg-surface'
            return (
              <div className={`rounded-[12px] border px-3 py-2.5 ${frame}`}>
                {outcome.kind === 'answer' ? (
                  <p className="whitespace-pre-wrap text-[12.5px] leading-relaxed text-ink">{humanDates(outcome.lines[0] ?? '')}</p>
                ) : (
                  <>
                    <p className={`flex items-center gap-1.5 text-[11.5px] font-semibold ${outcome.kind === 'done' ? 'text-good-ink' : 'text-critical-ink'}`}>
                      <span
                        className={`anim-pop-in flex h-4 w-4 shrink-0 items-center justify-center rounded-full ${
                          outcome.kind === 'done' ? 'bg-good/20' : 'bg-critical/20'
                        }`}
                        aria-hidden="true"
                      >
                        {outcome.kind === 'done' ? <Check size={10} strokeWidth={3.2} /> : <X size={10} strokeWidth={3.2} />}
                      </span>
                      {outcome.kind === 'done' ? 'Done' : 'Not done'}
                    </p>
                    <ul className="mt-1.5 space-y-2">
                      {outcome.lines.map((line) => {
                        const move = parseMove(line)
                        return (
                          <li key={line} className="min-w-0">
                            {move ? (
                              <>
                                <p className="text-[12.5px] font-medium leading-snug text-ink">{move.title}</p>
                                <p className="mt-0.5 text-[11.5px] leading-snug text-ink-3">
                                  Moved to <span className="text-ink-2">{move.when}</span> · {move.platform}
                                </p>
                              </>
                            ) : (
                              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{humanDates(line)}</p>
                            )}
                          </li>
                        )
                      })}
                    </ul>
                  </>
                )}

                {hasDetail || onSpeak ? (
                  <div className="mt-2 flex items-center gap-3">
                    {hasDetail ? (
                      <button
                        type="button"
                        onClick={() => setShowWork((v) => !v)}
                        aria-expanded={showWork}
                        className="inline-flex items-center gap-0.5 text-[10.5px] text-ink-3 transition-colors hover:text-ink-2"
                      >
                        {showWork ? 'Hide details' : 'Details'}
                        <ChevronDown
                          size={11}
                          aria-hidden="true"
                          className={`transition-transform duration-[var(--dur-fast)] ${showWork ? 'rotate-180' : ''}`}
                        />
                      </button>
                    ) : null}
                    {onSpeak ? (
                      <button
                        type="button"
                        onClick={() => onSpeak(turn.narration ?? '')}
                        aria-label="Speak this"
                        className="inline-flex items-center gap-1 text-[10.5px] text-ink-3 transition-colors hover:text-ink-2"
                      >
                        <Volume2 size={11} /> Speak
                      </button>
                    ) : null}
                  </div>
                ) : null}

                {/* The model's own telling of it, for a turn whose outcome line
                    came from the steps. Detail, not headline. */}
                {showWork && outcome.kind === 'done' ? (
                  <p className="mt-2 border-t border-line pt-2 text-[11.5px] leading-relaxed text-ink-3">
                    {humanDates(turn.narration)}
                  </p>
                ) : null}
              </div>
            )
          })() : null}

          {turn.plan && (showWork || !finished) ? (
            <div className="rounded-xl border border-line bg-surface-2 px-2.5 py-2">
              <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
                <span className="min-w-0 flex-1 text-[11px] font-medium leading-snug text-ink">
                  {turn.plan.summary}
                </span>
                <RiskPill risk={turn.plan.risk} />
                {steps.length > 0 ? (
                  <span className="tabular text-[10px] text-ink-3">
                    {done}/{steps.length}
                  </span>
                ) : null}
              </div>

              {/* Determinate, because the step count is known. */}
              {steps.length > 0 ? (
                <span
                  className="mt-1.5 block h-0.5 w-full overflow-hidden rounded-full bg-surface-3"
                  aria-hidden="true"
                >
                  <span
                    className="block h-full rounded-full bg-accent transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out-soft)]"
                    style={{ width: `${(done / steps.length) * 100}%` }}
                  />
                </span>
              ) : null}

              {steps.length > 0 ? (
                <ul className="mt-1">
                  {steps.map((step) => (
                    <WorkStep key={step.idx} step={step} />
                  ))}
                </ul>
              ) : null}
            </div>
          ) : null}

          {questionOnly || (turn.narration && finished) ? null : turn.narration ? (
            <div className="group">
              <p
                className={`whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2 ${
                  streaming && running ? 'assistant-caret' : ''
                }`}
              >
                {turn.narration}
              </p>
              {onSpeak ? (
                <button
                  type="button"
                  onClick={() => onSpeak(turn.narration ?? '')}
                  aria-label="Speak this"
                  className="mt-1 inline-flex items-center gap-1 text-[10px] text-ink-3 opacity-0 transition-opacity hover:text-ink-2 group-hover:opacity-100 focus-visible:opacity-100"
                >
                  <Volume2 size={11} /> Speak
                </button>
              ) : null}
            </div>
          ) : running ? (
            <p className="flex items-center gap-1.5 text-[12px] text-ink-3">
              <Loader size={11} className="animate-spin" aria-hidden="true" />
              Working on it.
            </p>
          ) : awaiting ? (
            /*
             * A turn held at the confirmation gate has no narration YET, and that
             * is the correct state rather than a missing one — the plane says what
             * it will do, then waits. The blanket "no narration was recorded"
             * message read as a fault every time a plan needed confirming.
             */
            <p className="text-[12px] leading-relaxed text-ink-3">
              Waiting for your confirmation before running this.
            </p>
          ) : turn.status === 'failed' ? (
            <p className="text-[12px] leading-relaxed text-critical-ink">
              This turn failed and recorded no explanation.
            </p>
          ) : turn.status === 'cancelled' ? (
            <p className="text-[12px] leading-relaxed text-ink-3">Cancelled before it ran.</p>
          ) : steps.length > 0 ? (
            /*
             * Steps ran but no prose came back — most often a stream that ended
             * before its `result` frame. The work is still legible above, so say
             * that rather than implying nothing happened.
             */
            <p className="text-[11.5px] leading-relaxed text-ink-3">
              {done} of {steps.length} step{steps.length === 1 ? '' : 's'} completed. No summary was
              returned.
            </p>
          ) : (
            // Genuinely nothing: no plan, no steps, no prose. Still stated.
            <p className="text-[11.5px] italic leading-relaxed text-ink-3">
              No narration was recorded for this turn.
            </p>
          )}
        </div>
      </div>
      )}
    </li>
  )
}

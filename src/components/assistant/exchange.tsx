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
import { Check, Loader, Volume2, X } from 'lucide-react'
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
  // The operator's own row carries the question and nothing else while a
  // conversation is live; the answer is the assistant's row that follows it.
  const questionOnly = turn.speaker === 'operator' && !turn.narration && !turn.plan && steps.length === 0
  // What the tools actually found, in their own words — the evidence the
  // prose is a reading of. Shown first, because it is the part that is measured.
  const evidence = [...new Set(steps.filter((s) => s.status === 'completed' && s.summary).map((s) => s.summary as string))]

  return (
    <li className="anim-fade-up space-y-2">
      {/* The question */}
      {turn.utterance.trim().length > 0 ? (
        <div className="flex justify-end">
          <div className="max-w-[88%] rounded-2xl rounded-br-md border border-accent/35 bg-accent/10 px-3 py-2">
            <p className="text-[12px] leading-relaxed text-ink">{turn.utterance}</p>
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
          className="mt-0.5 shrink-0"
        />

        <div className="min-w-0 flex-1 space-y-1.5">
          {/* The answer, first, once there is one. */}
          {turn.narration && finished ? (
            <div className="group rounded-[10px] border border-line-strong bg-surface px-3 py-2.5">
              {evidence.length > 0 ? (
                <>
                  <p className="mono text-[9px] uppercase tracking-[0.12em] text-ink-3">What the tools found</p>
                  <ul className="mt-1 space-y-1">
                    {evidence.map((line) => (
                      <li key={line} className="flex gap-2 text-[12.5px] leading-relaxed text-ink">
                        <span className="mt-[9px] h-[3px] w-[3px] shrink-0 rounded-full bg-accent" aria-hidden="true" />
                        <span className="min-w-0">{line}</span>
                      </li>
                    ))}
                  </ul>
                  <p className="mono mt-2.5 text-[9px] uppercase tracking-[0.12em] text-ink-3">Ethara’s reading</p>
                </>
              ) : (
                <p className="mono text-[9px] uppercase tracking-[0.12em] text-ink-3">Answer</p>
              )}
              <p className={`mt-1 whitespace-pre-wrap leading-relaxed ${evidence.length > 0 ? 'text-[12px] text-ink-2' : 'text-[12.5px] text-ink'}`}>{turn.narration}</p>
              <div className="mt-1.5 flex items-center gap-3">
                {steps.length > 0 ? (
                  <button
                    type="button"
                    onClick={() => setShowWork((v) => !v)}
                    aria-expanded={showWork}
                    className="mono text-[9.5px] uppercase tracking-[0.1em] text-ink-3 transition-colors hover:text-ink"
                  >
                    {showWork ? 'hide the work' : `how I got there · ${steps.length} step${steps.length === 1 ? '' : 's'}`}
                  </button>
                ) : null}
                {onSpeak ? (
                  <button
                    type="button"
                    onClick={() => onSpeak(turn.narration ?? '')}
                    aria-label="Speak this"
                    className="inline-flex items-center gap-1 text-[10px] text-ink-3 transition-colors hover:text-ink-2"
                  >
                    <Volume2 size={11} /> Speak
                  </button>
                ) : null}
              </div>
            </div>
          ) : null}

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

/**
 * THE AGENT RUN PANEL
 *
 * What the eight-agent backend is doing, while it does it.
 *
 * Two things this deliberately does not do. It shows no percentage, because
 * the run has no measurable percentage — it has agents, and each one is either
 * waiting, working or done, which is what the stages below show. And it writes
 * none of its own prose about what an agent achieved: every line is the
 * agent's own summary, forwarded verbatim.
 *
 * The counts at the bottom come in two rows on purpose. The run reports what
 * it produced; the database reports what it kept. A run can succeed and still
 * fail to land, and an operator staring at an unchanged calendar deserves to
 * see which of the two happened.
 */

import { AlertTriangle, Check, Database, X } from 'lucide-react'
import { useStore } from '../store'
import { Badge, Metric } from './ui'
import type { AgentRunState } from '../types'

/** Agent id → the short label for its stage marker. */
const STAGE_LABEL: Record<string, string> = {
  scraping_agent: 'Scrape',
  validation_agent: 'Validate',
  calendar_agent: 'Plan',
  content_agent: 'Write',
  image_agent: 'Illustrate',
  publishing_agent: 'Publish',
  analytics_agent: 'Measure',
  learning_agent: 'Learn',
}

type StageState = 'done' | 'running' | 'waiting'

function stageStateOf(run: AgentRunState, agentId: string, index: number): StageState {
  if (run.done.includes(agentId)) return 'done'
  // The current agent is tracked in the UI's namespace, so position in the
  // order is what identifies it here — the first agent not yet done, while the
  // run is live, is the one working.
  const firstPending = run.order.findIndex((id) => !run.done.includes(id))
  if (run.running && index === firstPending) return 'running'
  return 'waiting'
}

const STAGE_DOT: Record<StageState, string> = {
  done: 'bg-good',
  running: 'bg-accent anim-pulse-dot',
  waiting: 'bg-ink-3/40',
}

function num(source: Record<string, unknown> | null, key: string): number {
  return Number(source?.[key] ?? 0)
}

export function AgentRunPanel() {
  const run = useStore((s) => s.agentRun)

  const finished = run.frames.filter((f) => f.event === 'agent.finished')
  if (!run.running && finished.length === 0 && !run.error) return null

  const summary = run.summary
  const wrote = run.persisted
  const skipped = Array.isArray(wrote?.skipped) ? (wrote.skipped as string[]) : []

  return (
    <section className="card mb-3 p-3" aria-live="polite">
      <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <h2 className="text-[13px] font-medium text-ink-1">Agent backend</h2>
          <Badge tone={run.running ? 'accent' : run.error ? 'critical' : 'good'}>
            {run.running
              ? `${run.done.length} of ${run.order.length || 8} agents done`
              : run.error
                ? 'Stopped'
                : 'Finished'}
          </Badge>
        </div>
        {summary ? (
          <span className="tabular text-[11px] text-ink-3">
            {num(summary, 'duration_ms')}ms · {summary.used_model ? 'model-driven' : 'deterministic path'}
          </span>
        ) : null}
      </header>

      {/* The hand-off order, derived by the backend from each agent's own
          `hands_off_to`. If it looks wrong, the graph is wrong. */}
      <ol className="mb-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {run.order.map((agentId, index) => {
          const state = stageStateOf(run, agentId, index)
          return (
            <li key={agentId} className="flex items-center gap-1.5 text-[11.5px]">
              <span className={`h-1.5 w-1.5 rounded-full ${STAGE_DOT[state]}`} aria-hidden="true" />
              <span className={state === 'waiting' ? 'text-ink-3' : 'text-ink-2'}>
                {STAGE_LABEL[agentId] ?? agentId}
              </span>
            </li>
          )
        })}
      </ol>

      <div className="mono max-h-56 overflow-y-auto text-[11.5px]">
        {finished.map((frame, i) => {
          const failed = frame.status === 'failed'
          return (
            <p
              key={`${String(frame.agent_id)}-${i}`}
              className="anim-stream-in flex flex-wrap items-baseline gap-2 border-b border-line/40 py-1 last:border-0"
            >
              <span
                className={`inline-flex shrink-0 items-center ${failed ? 'text-critical-ink' : 'text-good-ink'}`}
                aria-label={failed ? 'Failed' : 'Completed'}
              >
                {failed ? <X size={12} aria-hidden="true" /> : <Check size={12} aria-hidden="true" />}
              </span>
              <span className="shrink-0 text-ink-3">{STAGE_LABEL[String(frame.agent_id)] ?? String(frame.agent_id)}</span>
              <span className="min-w-0 flex-1 text-ink-2">{String(frame.summary ?? '')}</span>
              <span className="tabular shrink-0 text-ink-3">{Number(frame.duration_ms ?? 0)}ms</span>
            </p>
          )
        })}
      </div>

      {summary ? (
        <div className="mt-3 flex flex-wrap gap-3">
          <Metric label="Posts captured" value={num(summary, 'posts_captured')} className="min-w-28" />
          <Metric label="Keywords trending" value={num(summary, 'keywords_trending')} className="min-w-28" />
          <Metric label="Hashtags" value={num(summary, 'hashtags_consolidated')} className="min-w-24" />
          <Metric label="On the calendar" value={num(summary, 'ideas_on_calendar')} className="min-w-28" />
          <Metric label="In suggestions" value={num(summary, 'ideas_in_suggestions')} className="min-w-28" />
          <Metric label="Lessons learned" value={num(summary, 'knowledge_learned')} className="min-w-28" />
        </div>
      ) : null}

      {wrote ? (
        <p className="mt-3 flex flex-wrap items-center gap-1.5 text-[11.5px] text-ink-2">
          <Database size={12} aria-hidden="true" className="text-ink-3" />
          Written to the database: {num(wrote, 'ideasCreated')} new idea(s), {num(wrote, 'ideasUpdated')} updated,{' '}
          {num(wrote, 'hashtags')} hashtag(s), {num(wrote, 'signals')} keyword signal(s).
        </p>
      ) : null}

      {skipped.map((line) => (
        <p key={line} className="mt-1.5 flex items-start gap-1.5 text-[11.5px] text-warn">
          <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          {line}
        </p>
      ))}

      {run.error ? (
        <p className="mt-3 flex items-start gap-1.5 text-[11.5px] text-critical-ink">
          <AlertTriangle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          {run.error}
        </p>
      ) : null}
    </section>
  )
}

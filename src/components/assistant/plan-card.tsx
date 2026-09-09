/**
 * THE PLAN CARD
 *
 * Rule §6.5.5 — the plan is shown before it runs, always, even when it is
 * safe. Each step names the tool, why it is in the plan, its risk class and a
 * live status glyph; a step that produced data expands to show it inline.
 */

import type { ReactNode } from 'react'
import { RiskPill, StepRow, Badge, PlatformChip, fmt } from '../ui'
import type { AssistantPlan, PlanStep, Platform } from '../../types'

/* ═══════════════════════════════════════════════════════════════════════════
   RESULT RENDERERS — a table for a list, a KPI row for figures, and so on
   ═══════════════════════════════════════════════════════════════════════════ */

function ResultTable({ data }: { data: Record<string, unknown> }) {
  const columns = (data.columns as string[] | undefined) ?? []
  const rows = (data.rows as string[][] | undefined) ?? []
  const reasons = (data.reasons as string[] | undefined) ?? []

  if (columns.length === 0 || rows.length === 0) return null

  return (
    <div className="overflow-x-auto rounded-lg border border-line bg-surface-2">
      <table className="w-full text-left text-[11px]">
        <thead>
          <tr className="border-b border-line">
            {columns.map((column) => (
              <th key={column} className="px-2.5 py-1.5 font-medium uppercase tracking-[0.07em] text-ink-3">
                {column}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-b border-line/60 last:border-0">
              {row.map((cell, j) => (
                <td key={j} className={`px-2.5 py-1.5 ${j === 0 ? 'text-ink-2' : 'tabular text-ink-2'}`}>
                  {cell}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
      {reasons.filter(Boolean).length > 0 ? (
        <ul className="space-y-1 border-t border-line px-2.5 py-2">
          {reasons.filter(Boolean).map((reason, i) => (
            <li key={i} className="text-[11px] leading-relaxed text-ink-3">
              {reason}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  )
}

function ResultKpis({ data }: { data: Record<string, unknown> }) {
  const entries = Object.entries(data).filter(
    ([, value]) => typeof value === 'number' || typeof value === 'string',
  )
  if (entries.length === 0) return null

  return (
    <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
      {entries.slice(0, 8).map(([key, value]) => (
        <div key={key} className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
          <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{humanise(key)}</p>
          <p className="tabular mt-0.5 text-[13px] font-medium text-ink">
            {typeof value === 'number' ? fmt(value) : String(value)}
          </p>
        </div>
      ))}
    </div>
  )
}

function ResultQueue({ data }: { data: Record<string, unknown> }) {
  const items = (data.items as Array<{ id: string; entity_title: string | null; reason: string; decision_requested: string }> | undefined) ?? []
  if (items.length === 0) return <p className="text-[11px] text-ink-3">The queue is clear.</p>

  return (
    <ul className="space-y-1.5">
      {items.slice(0, 5).map((item) => (
        <li key={item.id} className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
          <p className="text-[12px] font-medium text-ink">{item.entity_title ?? 'Untitled'}</p>
          <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{item.reason}</p>
          <p className="mt-1 text-[11px] text-accent-bright">{item.decision_requested}</p>
        </li>
      ))}
    </ul>
  )
}

function ResultKnowledge({ data }: { data: Record<string, unknown> }) {
  const entries = (data.entries as Array<{ id: string; title: string; content: string; confidence: string }> | undefined) ?? []
  return (
    <ul className="space-y-1.5">
      {entries.map((entry) => (
        <li key={entry.id} className="rounded-lg border border-line bg-surface-2 px-2.5 py-2">
          <div className="flex items-start justify-between gap-2">
            <p className="text-[12px] font-medium text-ink">{entry.title}</p>
            <Badge tone={entry.confidence === 'High' ? 'good' : 'neutral'}>{entry.confidence}</Badge>
          </div>
          <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">{entry.content}</p>
        </li>
      ))}
    </ul>
  )
}

function ResultDraft({ data }: { data: Record<string, unknown> }) {
  const body = String(data.body ?? data.draft ?? '')
  const platform = data.platform as Platform | undefined
  if (body.length === 0) return null

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      {platform ? <PlatformChip platform={platform} className="mb-2" /> : null}
      <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-ink-2">{body.slice(0, 640)}</p>
    </div>
  )
}

function ResultCompliance({ data }: { data: Record<string, unknown> }) {
  const verdict = String(data.verdict ?? 'APPROVED')
  const violations = (data.violations as Array<{ rule: number; title: string; detail: string }> | undefined) ?? []

  return (
    <div className="rounded-lg border border-line bg-surface-2 p-3">
      <Badge tone={verdict === 'APPROVED' ? 'good' : verdict === 'REVISE' ? 'warn' : 'serious'}>{verdict}</Badge>
      {violations.length === 0 ? (
        <p className="mt-2 text-[11px] text-ink-3">No violations across the twenty rules.</p>
      ) : (
        <ul className="mt-2 space-y-1.5">
          {violations.map((violation) => (
            <li key={violation.rule} className="text-[11px] leading-relaxed text-ink-3">
              <span className="font-medium text-ink-2">
                Rule {violation.rule} · {violation.title}
              </span>{' '}
              — {violation.detail}
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function humanise(key: string): string {
  return key.replace(/([a-z])([A-Z])/g, '$1 $2').replace(/^./, (c) => c.toUpperCase())
}

/** Chooses the renderer a step's `render` hint asks for. */
function StepResult({ step }: { step: PlanStep }): ReactNode {
  const data = step.data ?? {}
  switch (step.render) {
    case 'table':
      return <ResultTable data={data} />
    case 'kpi':
      return <ResultKpis data={data} />
    case 'queue':
      return <ResultQueue data={data} />
    case 'knowledge':
      return <ResultKnowledge data={data} />
    case 'draft':
      return <ResultDraft data={data} />
    case 'compliance':
      return <ResultCompliance data={data} />
    default:
      return Object.keys(data).length > 0 ? <ResultKpis data={data} /> : null
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CARD
   ═══════════════════════════════════════════════════════════════════════════ */

export function PlanCard({
  plan,
  /** Irreversible plans render their steps greyed until the gate is passed. */
  greyed = false,
  compact = false,
}: {
  plan: AssistantPlan
  greyed?: boolean
  compact?: boolean
}) {
  return (
    <div className={`anim-assistant-plan-in card border-line ${compact ? 'p-3' : 'p-3.5'}`}>
      <div className="flex flex-wrap items-start justify-between gap-2">
        <p className="flex-1 text-[12px] font-medium leading-relaxed text-ink">{plan.summary}</p>
        <RiskPill risk={plan.risk} />
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-ink-3">
        <span className="tabular">{plan.confidence}% confidence</span>
        <span>·</span>
        <span>{plan.parser === 'model' ? 'Model parser' : 'Deterministic parser'}</span>
        <span>·</span>
        <span className="tabular">
          {plan.steps.length} step{plan.steps.length === 1 ? '' : 's'}
        </span>
      </div>

      {plan.parserReason ? (
        <p className="mt-1.5 text-[11px] leading-relaxed text-warn">{plan.parserReason}</p>
      ) : null}

      <div className="mt-2.5 space-y-0.5">
        {plan.steps.map((step) => (
          <StepRow
            key={`${step.idx}-${step.toolId}`}
            index={step.idx}
            name={step.toolName}
            why={step.why}
            risk={step.risk}
            status={step.status ?? 'queued'}
            greyed={greyed}
            {...(step.summary ? { summary: step.summary } : {})}
          >
            <StepResult step={step} />
          </StepRow>
        ))}
      </div>

      {plan.trimmed && plan.trimmed.length > 0 ? (
        <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
          I trimmed {plan.trimmed.length} step{plan.trimmed.length === 1 ? '' : 's'} to stay inside the
          plan cap: {plan.trimmed.join(', ')}.
        </p>
      ) : null}
    </div>
  )
}

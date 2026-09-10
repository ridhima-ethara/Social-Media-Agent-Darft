/**
 * THE MODEL MENU
 *
 * Sits under the review panel's composer, once per target: the caption writer
 * and the image painter are both chosen here. Every entry carries a licence pill
 * and, when its service is unreachable, the reason and what will be used
 * instead — a selection is never silently ignored.
 *
 * Reachability is read from `mode.integrations`, which is the server's own
 * adapter sweep, keyed by the adapter id each model declares. Guessing the key
 * here would drift from what `/health` reports.
 */

import { useState } from 'react'
import { ChevronDown, Check, AlertTriangle } from 'lucide-react'
import { IMAGE_MODELS } from '@shared/image-models'
import { IMAGE_MODEL_ADAPTER, TEXT_MODELS } from '@shared/text-models'
import { Badge, useOutsideClick } from './ui'
import { useStore } from '../store'

/** What a model needs, reduced to the two things the menu renders. */
interface MenuEntry {
  id: string
  label: string
  summary: string
  licence: string
  /** '' = needs no service. null = reachability cannot be determined here. */
  adapterId: string | null
}

type Reach = 'ready' | 'unreachable' | 'unknown'

export function ModelMenu({
  target,
  selected,
  onSelect,
}: {
  target: 'caption' | 'image'
  selected: string
  onSelect: (modelId: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClick<HTMLDivElement>(() => setOpen(false))
  const apiMode = useStore((s) => s.apiMode)
  const integrations = useStore((s) => s.integrations)

  const entries: MenuEntry[] =
    target === 'caption'
      ? TEXT_MODELS.map((model) => ({
          id: model.id,
          label: model.label,
          summary: model.summary,
          licence: model.licence,
          adapterId: model.adapterId,
        }))
      : IMAGE_MODELS.map((model) => ({
          id: model.id,
          label: model.label,
          summary: model.summary,
          licence: model.licence,
          adapterId: IMAGE_MODEL_ADAPTER[model.id] ?? null,
        }))

  /**
   * A model is ready when it needs no service, or when the server reports its
   * adapter configured. With the API down nothing remote can be reached, so the
   * local floor is the only ready entry.
   */
  const reach = (entry: MenuEntry): Reach => {
    if (entry.adapterId === '') return 'ready'
    if (apiMode !== 'connected') return 'unreachable'
    if (entry.adapterId === null) return 'unknown'
    const report = integrations.find((i) => i.id === entry.adapterId)
    if (!report) return 'unknown'
    return report.configured ? 'ready' : 'unreachable'
  }

  const floor = target === 'caption' ? 'the Ethara template writer' : 'the local brand renderer'
  const current = entries.find((entry) => entry.id === selected) ?? entries[0]

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        className="inline-flex w-full items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-left transition-colors hover:border-line-strong"
      >
        <span className="min-w-0">
          <span className="block text-[11px] text-ink-3">
            {target === 'caption' ? 'Caption model' : 'Image model'}
          </span>
          <span className="block truncate text-[12px] font-medium text-ink">{current?.label}</span>
        </span>
        <ChevronDown size={13} className="shrink-0 text-ink-3" />
      </button>

      {open ? (
        <div
          role="menu"
          className="anim-pop-in card absolute bottom-full left-0 z-40 mb-1.5 w-full overflow-hidden p-1 shadow-xl"
        >
          {entries.map((entry) => {
            const state = reach(entry)
            const report = entry.adapterId ? integrations.find((i) => i.id === entry.adapterId) : undefined

            return (
              <button
                key={entry.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect(entry.id)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className="mt-0.5 w-3.5 shrink-0">
                  {entry.id === selected ? <Check size={13} className="text-accent-bright" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-medium text-ink">{entry.label}</span>
                    <Badge tone="neutral">{entry.licence}</Badge>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{entry.summary}</span>

                  {state === 'unreachable' ? (
                    <span className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed text-warn">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      {apiMode === 'connected'
                        ? (report?.reason ?? 'Not configured')
                        : 'The API is unreachable'}{' '}
                      — {floor} will be used instead.
                    </span>
                  ) : null}

                  {state === 'unknown' ? (
                    <span className="mt-1 flex items-start gap-1 text-[11px] leading-relaxed text-ink-3">
                      <AlertTriangle size={11} className="mt-0.5 shrink-0" />
                      Reachability is not reported for this model, so it cannot be verified from here.
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}

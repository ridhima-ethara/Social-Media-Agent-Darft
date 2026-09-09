/**
 * THE MODEL MENU
 *
 * Sits under the review panel's composer. The caption writer is locked to
 * "Ethara Writer"; the image models are listed with a licence pill and a
 * "needs runtime" warning when unreachable. Selecting a reachable one
 * re-renders immediately.
 */

import { useState } from 'react'
import { ChevronDown, Check, AlertTriangle } from 'lucide-react'
import { IMAGE_MODELS } from '@shared/image-models'
import { Badge, useOutsideClick } from './ui'
import { useStore } from '../store'

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

  /** A model is reachable only when the runtime is up and its adapter is configured. */
  const reachable = (modelId: string): boolean => {
    if (modelId === 'brand-svg') return true
    if (apiMode !== 'connected') return false
    const key = modelId === 'gcp-imagen' ? 'gcp' : 'z-image'
    return integrations.find((i) => i.id === key)?.configured ?? false
  }

  if (target === 'caption') {
    return (
      <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5">
        <span className="text-[11px] text-ink-3">Writer</span>
        <span className="text-[12px] font-medium text-ink">Ethara Writer</span>
        <Badge tone="neutral">locked</Badge>
      </div>
    )
  }

  const current = IMAGE_MODELS.find((m) => m.id === selected) ?? IMAGE_MODELS[0]

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
          <span className="block text-[11px] text-ink-3">Image model</span>
          <span className="block truncate text-[12px] font-medium text-ink">{current?.label}</span>
        </span>
        <ChevronDown size={13} className="shrink-0 text-ink-3" />
      </button>

      {open ? (
        <div role="menu" className="anim-pop-in card absolute bottom-full left-0 z-40 mb-1.5 w-full overflow-hidden p-1 shadow-xl">
          {IMAGE_MODELS.map((model) => {
            const available = reachable(model.id)
            return (
              <button
                key={model.id}
                type="button"
                role="menuitem"
                onClick={() => {
                  onSelect(model.id)
                  setOpen(false)
                }}
                className="flex w-full items-start gap-2 rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
              >
                <span className="mt-0.5 w-3.5 shrink-0">
                  {model.id === selected ? <Check size={13} className="text-accent-bright" /> : null}
                </span>
                <span className="min-w-0 flex-1">
                  <span className="flex flex-wrap items-center gap-1.5">
                    <span className="text-[12px] font-medium text-ink">{model.label}</span>
                    <Badge tone="neutral">{model.licence}</Badge>
                  </span>
                  <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{model.summary}</span>
                  {!available ? (
                    <span className="mt-1 inline-flex items-center gap-1 text-[11px] text-warn">
                      <AlertTriangle size={11} />
                      {apiMode === 'connected' ? 'Not configured' : 'Needs runtime'} — the local brand
                      renderer will be used instead.
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

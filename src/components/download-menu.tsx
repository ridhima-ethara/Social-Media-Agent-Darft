/**
 * THE DOWNLOAD MENU
 *
 * Every analytics view is exportable as CSV or JSON, generated in the browser
 * from state already on screen — so an export never depends on the API.
 */

import { useState } from 'react'
import { ChevronDown, Download } from 'lucide-react'
import { useOutsideClick } from './ui'

export interface DownloadOption {
  id: string
  label: string
  hint?: string
  onSelect: (format: 'csv' | 'json') => void
}

export function DownloadMenu({
  options,
  compact = false,
  label = 'Export',
}: {
  options: DownloadOption[]
  compact?: boolean
  label?: string
}) {
  const [open, setOpen] = useState(false)
  const ref = useOutsideClick<HTMLDivElement>(() => setOpen(false))

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={`inline-flex items-center gap-1.5 rounded-lg border border-line text-ink-3 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-ink ${
          compact ? 'p-1.5' : 'px-3 py-1.5 text-[13px] font-medium'
        }`}
      >
        <Download size={compact ? 13 : 14} />
        {compact ? null : (
          <>
            {label}
            <ChevronDown size={13} />
          </>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="anim-pop-in card absolute right-0 z-40 mt-1.5 w-64 overflow-hidden p-1 shadow-xl"
        >
          {options.map((option) => (
            <div key={option.id} className="rounded-lg px-2 py-1.5 hover:bg-surface-2">
              <p className="text-[12px] font-medium text-ink">{option.label}</p>
              {option.hint ? <p className="mt-0.5 text-[11px] text-ink-3">{option.hint}</p> : null}
              <div className="mt-1.5 flex items-center gap-1.5">
                {(['csv', 'json'] as const).map((format) => (
                  <button
                    key={format}
                    type="button"
                    role="menuitem"
                    onClick={() => {
                      option.onSelect(format)
                      setOpen(false)
                    }}
                    className="rounded-md border border-line px-2 py-0.5 text-[11px] uppercase tracking-wide text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                  >
                    {format}
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  )
}

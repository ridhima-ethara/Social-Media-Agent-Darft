/**
 * THE DOWNLOAD MENU
 *
 * Every analytics view is exportable as CSV or JSON, generated in the browser
 * from state already on screen — so an export never depends on the API.
 *
 * The menu renders through a portal, fixed to the viewport. Page headers are
 * glass — a backdrop filter, so a stacking context — inside a scrolling pane
 * with hidden horizontal overflow. A menu positioned inside one was clipped
 * by the pane and painted under the sections that follow it, which is why it
 * appeared cut off at the header's edge. Nothing can clip or cover a fixed
 * element mounted on <body>, so the menu is placed from the trigger's
 * measured rectangle and kept inside the viewport.
 */

import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { ChevronDown, Download } from 'lucide-react'

export interface DownloadOption {
  id: string
  label: string
  hint?: string
  onSelect: (format: 'csv' | 'json') => void
}

const MENU_WIDTH = 264
const GUTTER = 8
const GAP = 6

export function DownloadMenu({
  options,
  compact = false,
  label = 'Export',
}: {
  options: DownloadOption[]
  compact?: boolean
  label?: string
}) {
  const [at, setAt] = useState<{ top: number; left: number } | null>(null)
  const open = at !== null
  const triggerRef = useRef<HTMLButtonElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  /** Under the trigger, right-aligned to it, never past either viewport edge. */
  const openAtTrigger = (): void => {
    const rect = triggerRef.current?.getBoundingClientRect()
    if (!rect) return
    const left = Math.max(GUTTER, Math.min(rect.right - MENU_WIDTH, window.innerWidth - MENU_WIDTH - GUTTER))
    setAt({ top: rect.bottom + GAP, left })
  }

  useEffect(() => {
    if (!open) return
    const close = (): void => setAt(null)
    const onDown = (event: MouseEvent): void => {
      const target = event.target as Node
      if (triggerRef.current?.contains(target) || menuRef.current?.contains(target)) return
      close()
    }
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', onDown)
    document.addEventListener('keydown', onKey)
    // The page can scroll under a fixed menu. Closing is more honest than
    // letting it drift away from the button it belongs to.
    window.addEventListener('resize', close)
    document.addEventListener('scroll', close, true)
    return () => {
      document.removeEventListener('mousedown', onDown)
      document.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', close)
      document.removeEventListener('scroll', close, true)
    }
  }, [open])

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => (open ? setAt(null) : openAtTrigger())}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={label}
        className={`inline-flex items-center gap-1.5 rounded-md border text-ink-2 transition-colors duration-[var(--dur-fast)] hover:border-accent hover:text-ink ${
          open ? 'border-accent text-ink' : 'border-line-strong'
        } ${compact ? 'p-1.5' : 'px-2.5 py-[6px] text-[12px] font-medium'}`}
      >
        <Download size={compact ? 13 : 13} aria-hidden="true" />
        {compact ? null : (
          <>
            {label}
            <ChevronDown
              size={12}
              aria-hidden="true"
              style={{ transform: open ? 'rotate(180deg)' : 'none', transition: 'transform var(--dur-fast) var(--ease-out-soft)' }}
            />
          </>
        )}
      </button>

      {at
        ? createPortal(
            <div
              ref={menuRef}
              role="menu"
              aria-label={`${label} options`}
              className="fixed z-[120] overflow-hidden rounded-[10px] border border-line-strong bg-surface p-1 shadow-xl"
              style={{
                top: at.top,
                left: at.left,
                width: MENU_WIDTH,
                animation: 'eth-rise 220ms cubic-bezier(0.22, 1, 0.36, 1) both',
              }}
            >
              {options.map((option) => (
                <div key={option.id} className="rounded-md px-2.5 py-2 transition-colors hover:bg-surface-2">
                  <p className="text-[12px] font-medium text-ink">{option.label}</p>
                  {option.hint ? <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{option.hint}</p> : null}
                  <div className="mt-1.5 flex items-center gap-1.5">
                    {(['csv', 'json'] as const).map((format) => (
                      <button
                        key={format}
                        type="button"
                        role="menuitem"
                        onClick={() => {
                          option.onSelect(format)
                          setAt(null)
                        }}
                        className="mono rounded-[3px] border border-line-strong px-2 py-[3px] text-[10px] uppercase tracking-[0.08em] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                      >
                        {format}
                      </button>
                    ))}
                  </div>
                </div>
              ))}
            </div>,
            document.body,
          )
        : null}
    </>
  )
}

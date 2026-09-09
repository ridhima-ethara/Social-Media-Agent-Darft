/**
 * THE PLAY BUTTON
 *
 * The one control that starts real work. Deliberately larger than every other
 * button on its screen, with a hint line naming what will happen, so nobody
 * starts a pipeline run by accident.
 */

import { Loader2, Play } from 'lucide-react'
import type { ReactNode } from 'react'

export function PlayButton({
  label,
  hint,
  onClick,
  running = false,
  disabled = false,
  icon,
  className = '',
}: {
  label: string
  hint?: string
  onClick: () => void
  running?: boolean
  disabled?: boolean
  icon?: ReactNode
  className?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled || running}
      className={`group inline-flex items-center gap-3 rounded-xl border border-accent/50 bg-accent/10 px-3.5 py-2
        transition-[background-color,border-color,transform] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]
        hover:border-accent hover:bg-accent/16 active:scale-[0.97]
        disabled:pointer-events-none disabled:opacity-40 ${className}`}
    >
      <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-accent text-on-accent">
        {running ? (
          <Loader2 size={15} className="animate-[ring-spin_1.4s_linear_infinite]" aria-hidden="true" />
        ) : (
          (icon ?? <Play size={14} fill="currentColor" aria-hidden="true" />)
        )}
        {!running && !disabled ? (
          <span className="anim-ping-slow absolute inset-0 rounded-full border border-accent" aria-hidden="true" />
        ) : null}
      </span>

      <span className="text-left">
        <span className="block text-[13px] font-medium text-ink">{running ? 'Running…' : label}</span>
        {hint ? <span className="block text-[11px] text-ink-3">{hint}</span> : null}
      </span>
    </button>
  )
}

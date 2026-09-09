/**
 * THE EMBLEM
 *
 * The company mark, as the actual image — `public/brand/emblem.jpeg`, embedded
 * by `scripts/build-brand-assets.ts` so it needs no fetch and cannot drift from
 * the creative renderer or the favicon.
 *
 * The animation never redraws the logo. In `draw` mode a ring strokes itself
 * around the real image while the image blooms in behind it; the pixels are
 * always the original file. Both keyframes already exist in the motion
 * vocabulary and are killed by the reduced-motion block.
 */

import { EMBLEM_COLOURS, EMBLEM_DATA_URI } from '@shared/logo-mark'

export interface LogoProps {
  size?: number
  /** `draw` rings and blooms the mark in; `static` is the resting state. */
  mode?: 'static' | 'draw'
  className?: string
}

export function Logo({ size = 32, mode = 'static', className = '' }: LogoProps) {
  const drawing = mode === 'draw'
  const ringWidth = Math.max(1.5, size * 0.04)
  const r = 50 - ringWidth / 2

  return (
    <span
      className={`relative inline-block shrink-0 ${className}`}
      style={{ width: size, height: size }}
      role="img"
      aria-label="Ethara"
    >
      <img
        src={EMBLEM_DATA_URI}
        alt=""
        width={size}
        height={size}
        draggable={false}
        className="block h-full w-full rounded-full object-cover select-none"
        style={{
          background: EMBLEM_COLOURS.disc,
          ...(drawing ? { animation: 'mark-fillin 620ms var(--ease-out-expo) 120ms both' } : {}),
        }}
      />

      {drawing ? (
        <svg
          viewBox="0 0 100 100"
          className="pointer-events-none absolute inset-0 h-full w-full"
          aria-hidden="true"
        >
          <circle
            cx="50"
            cy="50"
            r={r}
            fill="none"
            stroke={EMBLEM_COLOURS.ink}
            strokeWidth={ringWidth}
            strokeLinecap="round"
            pathLength={320}
            strokeDasharray={320}
            transform="rotate(-90 50 50)"
            style={{ animation: 'mark-draw 900ms var(--ease-out-expo) both, fade-in 400ms linear 900ms reverse both' }}
          />
        </svg>
      ) : null}
    </span>
  )
}

/**
 * The wordmark. The `.AI` is always magenta and always attached — it is
 * "Ethara.AI", never "Ethara AI".
 */
export function Wordmark({ className = '' }: { className?: string }) {
  return (
    <span className={`display tracking-tight ${className}`}>
      Ethara<span className="text-magenta">.AI</span>
    </span>
  )
}

/**
 * DEPTH — the 3D layer
 *
 * `Tilt` gives a surface a real perspective response to the pointer: the card
 * rotates a few degrees toward the cursor, a soft glare follows it, and it
 * settles back on leave. `Holo` is the orbiting-ring stage the reactor sits on.
 *
 * Rules, held here so no consumer can break them: only `transform` and
 * `opacity` animate; the tilt never exceeds `maxDeg`; everything is a no-op
 * under `prefers-reduced-motion`, and touch devices get the resting state.
 */

import { useCallback, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { prefersReducedMotion } from '../store'

export interface TiltProps {
  children: ReactNode
  /** Maximum rotation in degrees. Cards want 5–7; a whole panel wants 2–3. */
  maxDeg?: number
  /** Lift on hover, in px along Z. */
  lift?: number
  glare?: boolean
  className?: string
  style?: CSSProperties
}

export function Tilt({ children, maxDeg = 6, lift = 10, glare = true, className = '', style }: TiltProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const [pose, setPose] = useState({ rx: 0, ry: 0, gx: 50, gy: 50, active: false })

  const onMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch' || prefersReducedMotion()) return
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const px = (event.clientX - rect.left) / rect.width
      const py = (event.clientY - rect.top) / rect.height
      setPose({
        rx: (0.5 - py) * maxDeg * 2,
        ry: (px - 0.5) * maxDeg * 2,
        gx: px * 100,
        gy: py * 100,
        active: true,
      })
    },
    [maxDeg],
  )

  const onLeave = useCallback(() => setPose({ rx: 0, ry: 0, gx: 50, gy: 50, active: false }), [])

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`tilt-surface ${className}`}
      style={{
        ...style,
        transform: pose.active
          ? `perspective(900px) rotateX(${pose.rx.toFixed(2)}deg) rotateY(${pose.ry.toFixed(2)}deg) translateZ(${lift}px)`
          : 'perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0px)',
      }}
    >
      {children}
      {glare ? (
        <span
          aria-hidden="true"
          className="tilt-glare"
          style={{
            opacity: pose.active ? 1 : 0,
            background: `radial-gradient(circle at ${pose.gx}% ${pose.gy}%, var(--color-hud-strong), transparent 55%)`,
          }}
        />
      ) : null}
    </div>
  )
}

/**
 * The orbiting-ring stage. Two or three tilted rings rotate in true 3D around
 * whatever sits at the centre — the reactor in the header, the emblem at boot.
 */
export function Holo({
  children,
  size,
  rings = 2,
  className = '',
}: {
  children: ReactNode
  size: number
  rings?: 1 | 2 | 3
  className?: string
}) {
  return (
    <span
      className={`stage-3d relative inline-flex items-center justify-center ${className}`}
      style={{ width: size, height: size }}
    >
      <span className="holo-ring holo-ring-1" aria-hidden="true" style={{ inset: size * -0.14 }} />
      {rings >= 2 ? <span className="holo-ring holo-ring-2" aria-hidden="true" style={{ inset: size * -0.06 }} /> : null}
      {rings >= 3 ? <span className="holo-ring holo-ring-3" aria-hidden="true" style={{ inset: size * -0.22 }} /> : null}
      <span className="relative" style={{ transform: 'translateZ(24px)' }}>
        {children}
      </span>
    </span>
  )
}

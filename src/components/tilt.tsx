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

import { useCallback, useEffect, useRef, type CSSProperties, type ReactNode } from 'react'
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

/**
 * THE POINTER IS NOT REACT STATE.
 *
 * This used to call `setPose` on every `pointermove`, which put a React render
 * and a full subtree reconciliation between the pointer and the pixels — at
 * 120Hz on a trackpad, hundreds of renders a second for a value that only ever
 * lands on two inline styles. That is what made the tilt feel heavy: the work
 * was real, but none of it was rendering work.
 *
 * The pose now lives in refs and is written straight to the two nodes inside a
 * single `requestAnimationFrame`, so at most one write happens per displayed
 * frame no matter how fast the pointer moves, and the component never re-renders
 * while tracking. `transform` and `opacity` are the only properties touched, so
 * the compositor does the work without layout or paint.
 *
 * The transition is also dropped while tracking. A 260ms ease on `transform` is
 * what you want when the surface settles back on leave, but while the pointer is
 * driving it that same ease is 260ms of lag chasing the cursor — so the surface
 * is untransitioned under the pointer and transitioned on the way home.
 */
export function Tilt({ children, maxDeg = 6, lift = 10, glare = true, className = '', style }: TiltProps) {
  const ref = useRef<HTMLDivElement | null>(null)
  const glareRef = useRef<HTMLSpanElement | null>(null)
  /** The latest pointer reading, and the frame that has not yet flushed it. */
  const next = useRef<{ rx: number; ry: number; gx: number; gy: number } | null>(null)
  const frame = useRef<number | null>(null)

  const rest = `perspective(900px) rotateX(0deg) rotateY(0deg) translateZ(0px)`

  /** One write per displayed frame, straight to the DOM. */
  const flush = useCallback(() => {
    frame.current = null
    const el = ref.current
    const pose = next.current
    if (!el || !pose) return
    el.style.transform = `perspective(900px) rotateX(${pose.rx.toFixed(2)}deg) rotateY(${pose.ry.toFixed(2)}deg) translateZ(${lift}px)`
    const g = glareRef.current
    if (g) {
      g.style.opacity = '1'
      g.style.background = `radial-gradient(circle at ${pose.gx.toFixed(1)}% ${pose.gy.toFixed(1)}%, var(--color-hud-strong), transparent 55%)`
    }
  }, [lift])

  const onMove = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      if (event.pointerType === 'touch' || prefersReducedMotion()) return
      const el = ref.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const px = (event.clientX - rect.left) / rect.width
      const py = (event.clientY - rect.top) / rect.height
      next.current = {
        rx: (0.5 - py) * maxDeg * 2,
        ry: (px - 0.5) * maxDeg * 2,
        gx: px * 100,
        gy: py * 100,
      }
      // Untransitioned while the pointer drives it; see the note above.
      el.dataset.tilting = 'true'
      if (frame.current === null) frame.current = requestAnimationFrame(flush)
    },
    [maxDeg, flush],
  )

  /** Settle home. The transition is restored first, so the return is eased. */
  const onLeave = useCallback(() => {
    if (frame.current !== null) {
      cancelAnimationFrame(frame.current)
      frame.current = null
    }
    next.current = null
    const el = ref.current
    if (el) {
      delete el.dataset.tilting
      el.style.transform = rest
    }
    if (glareRef.current) glareRef.current.style.opacity = '0'
  }, [rest])

  // A pending frame must not outlive the component.
  useEffect(
    () => () => {
      if (frame.current !== null) cancelAnimationFrame(frame.current)
    },
    [],
  )

  return (
    <div
      ref={ref}
      onPointerMove={onMove}
      onPointerLeave={onLeave}
      className={`tilt-surface ${className}`}
      style={{ ...style, transform: rest }}
    >
      {children}
      {glare ? (
        <span
          ref={glareRef}
          aria-hidden="true"
          className="tilt-glare"
          style={{
            opacity: 0,
            background: 'radial-gradient(circle at 50% 50%, var(--color-hud-strong), transparent 55%)',
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

/**
 * THE BOOT EMBLEM
 *
 * What the logo sits inside on the boot screen, and only there.
 *
 * WHY IT IS NOT `AssistantCore` + `Holo`. Those two were built for the header
 * and the rail, where a HUD reads as instrumentation: three dashed rings, a tick
 * ring of 24 marks, an orbiting scan sweep, and two skewed elliptical planes. At
 * 236px on an otherwise empty screen all of that resolves into a thin, busy
 * tangle — dashes and a stray magenta ellipse crossing the mark — which is
 * exactly what it looked like.
 *
 * This borrows the visual language of the platforms the product publishes to
 * instead:
 *
 *   · a STORY RING — one continuous conic gradient turning slowly around the
 *     mark, the way a story ring frames an avatar. No dashes, so nothing
 *     flickers as it rotates.
 *   · BROADCAST PULSES — soft rings swelling outward and fading, the live
 *     indicator every platform uses for "this is on air".
 *   · a solid disc under the mark, so the logo sits on something rather than
 *     floating over a gradient.
 *
 * Motion is slow and eased on purpose: three staggered pulses on a 3.4s cycle
 * read as breathing. Everything is a CSS keyframe, so the global
 * `prefers-reduced-motion` block neutralises it without this component knowing.
 * Every colour is a token — nothing here hard-codes a hex.
 */

import { Logo } from '../logo'
import type { AssistantCoreState } from '../../types'

/** How fast the story ring turns. Faster while the plane is actually busy. */
const SPIN_MS: Partial<Record<AssistantCoreState, number>> = {
  thinking: 9_000,
  working: 6_000,
  listening: 7_000,
}
const SPIN_IDLE_MS = 16_000

export function BootEmblem({
  state,
  size = 236,
  logoSize = 122,
}: {
  state: AssistantCoreState
  size?: number
  logoSize?: number
}) {
  const spin = SPIN_MS[state] ?? SPIN_IDLE_MS
  const active = state === 'thinking' || state === 'working' || state === 'listening'

  return (
    <span
      className="relative inline-flex items-center justify-center"
      style={{ width: size, height: size }}
      aria-hidden="true"
    >
      {/* The bloom. Sits furthest back and never moves. */}
      <span
        className="absolute rounded-full blur-2xl"
        style={{
          inset: size * -0.18,
          background: 'radial-gradient(circle, var(--color-glow), transparent 68%)',
          opacity: 0.7,
        }}
      />

      {/* Broadcast pulses — three, staggered, so one is always mid-flight. */}
      {[0, 1, 2].map((i) => (
        <span
          key={i}
          className="absolute rounded-full border"
          style={{
            inset: 0,
            borderColor: i === 1 ? 'var(--color-magenta)' : 'var(--color-accent)',
            animation: `boot-broadcast 3400ms var(--ease-out-soft) ${i * 1133}ms infinite`,
          }}
        />
      ))}

      {/* The story ring: one continuous gradient, masked to a band. */}
      <span
        className="absolute rounded-full"
        style={{
          inset: size * 0.02,
          background:
            'conic-gradient(from 0deg, var(--color-accent), var(--color-magenta), var(--color-accent-bright), var(--color-accent))',
          // A ring rather than a disc. Both spellings, because WebKit still
          // wants the prefix and Firefox wants the standard one.
          WebkitMaskImage: 'radial-gradient(closest-side, transparent 88%, #000 90%)',
          maskImage: 'radial-gradient(closest-side, transparent 88%, #000 90%)',
          animation: `boot-story-spin ${spin}ms linear infinite`,
          opacity: active ? 0.95 : 0.6,
          transition: 'opacity var(--dur-slow) var(--ease-out-soft)',
        }}
      />

      {/* A second, tighter band turning the other way — depth without dashes. */}
      <span
        className="absolute rounded-full"
        style={{
          inset: size * 0.12,
          background:
            'conic-gradient(from 180deg, transparent, var(--color-accent) 40%, transparent 70%)',
          WebkitMaskImage: 'radial-gradient(closest-side, transparent 90%, #000 92%)',
          maskImage: 'radial-gradient(closest-side, transparent 90%, #000 92%)',
          animation: `boot-story-spin ${Math.round(spin * 1.9)}ms linear infinite reverse`,
          opacity: 0.5,
        }}
      />

      {/* A single light travelling the ring — the one thing that visibly moves
          at reading speed, so the eye has somewhere to rest. */}
      <span
        className="absolute rounded-full"
        style={{ inset: size * 0.02, animation: `boot-story-spin ${Math.round(spin * 0.55)}ms linear infinite` }}
      >
        <span
          className="absolute left-1/2 top-0 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            background: 'var(--color-accent-bright)',
            boxShadow: '0 0 14px 3px var(--color-glow)',
            opacity: active ? 1 : 0.55,
            transition: 'opacity var(--dur-slow) var(--ease-out-soft)',
          }}
        />
      </span>

      {/* The disc the mark sits on. */}
      <span
        className="absolute rounded-full"
        style={{
          inset: size * 0.17,
          background: 'var(--color-surface)',
          boxShadow: '0 18px 48px -22px var(--color-glow)',
        }}
      />

      <span className="relative flex items-center justify-center">
        <Logo size={logoSize} mode="draw" />
      </span>
    </span>
  )
}

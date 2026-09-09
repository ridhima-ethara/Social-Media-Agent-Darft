/**
 * THE AMBIENT LAYER — `AssistantHud`
 *
 * Behind the app, `aria-hidden`, `pointer-events: none`: four corner brackets
 * that draw themselves in on boot and breathe at 8s, a faint 40px grid panning
 * at 60s, a bottom-edge telemetry ticker, and a scan line that sweeps once
 * every 12s.
 *
 * Every element is disabled under `prefers-reduced-motion` (the CSS block
 * hides `.assistant-hud` outright) and hidden below `lg`.
 */

import { useEffect, useRef, useState } from 'react'
import { useStore } from '../../store'

/* ═══════════════════════════════════════════════════════════════════════════
   THE TICKER — every figure flips when it changes
   ═══════════════════════════════════════════════════════════════════════════ */

function TickerFigure({ label, value }: { label: string; value: string }) {
  const [flipping, setFlipping] = useState(false)
  const previous = useRef(value)

  useEffect(() => {
    if (previous.current === value) return
    previous.current = value
    setFlipping(true)
    const timer = window.setTimeout(() => setFlipping(false), 120)
    return () => window.clearTimeout(timer)
  }, [value])

  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="text-hud-strong">{label}</span>
      <span className={`tabular text-ink-3 ${flipping ? 'ticker-flip' : ''}`}>{value}</span>
    </span>
  )
}

export function AssistantHud() {
  const agents = useStore((s) => s.agents)
  const pipeline = useStore((s) => s.pipeline)
  const scrapeRun = useStore((s) => s.scrapeRun)
  const reviewQueue = useStore((s) => s.reviewQueue)
  const knowledge = useStore((s) => s.knowledge)
  const apiMode = useStore((s) => s.apiMode)
  const publishMode = useStore((s) => s.mode.publishMode)

  const running = agents.filter((a) => a.status === 'running').length
  const pipelineState = scrapeRun.running
    ? 'RUNNING'
    : (pipeline?.status ?? 'idle').toUpperCase()

  return (
    <div className="assistant-hud pointer-events-none fixed inset-0 z-0 hidden lg:block" aria-hidden="true">
      {/* The panning grid. */}
      <div
        className="hud-grid absolute inset-0 opacity-[0.5]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-hud) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hud) 1px, transparent 1px)',
          backgroundSize: '40px 40px',
        }}
      />

      {/* Four corner brackets. */}
      <span className="hud-bracket left-4 top-4 border-l-2 border-t-2" />
      <span className="hud-bracket right-4 top-4 border-r-2 border-t-2" />
      <span className="hud-bracket bottom-4 left-4 border-b-2 border-l-2" />
      <span className="hud-bracket bottom-4 right-4 border-b-2 border-r-2" />

      {/* The top-edge scan line, once every 12s. */}
      <span className="hud-scan scanline top-0" />

      {/* The telemetry ticker. */}
      <div className="mono absolute bottom-2 left-1/2 flex -translate-x-1/2 items-center gap-4 text-[10px] uppercase tracking-[0.14em]">
        <TickerFigure label="AGENTS" value={`${agents.length - running}/${agents.length}`} />
        <TickerFigure label="PIPELINE" value={pipelineState} />
        <TickerFigure label="QUEUE" value={String(reviewQueue.filter((q) => !q.resolved).length)} />
        <TickerFigure label="KB" value={String(knowledge.filter((k) => k.active).length)} />
        <TickerFigure label="MODE" value={apiMode === 'connected' ? publishMode.toUpperCase() : 'STANDALONE'} />
      </div>
    </div>
  )
}

/**
 * The drifting background: a veil, three slow orbs and a panning grid.
 * Decorative, and the first thing reduced motion silences.
 */
export function LiveBackground() {
  return (
    <div className="bg-live fixed inset-0 z-0" aria-hidden="true">
      <div
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(1200px 640px at 12% 0%, var(--color-hud-glow), transparent 60%), radial-gradient(900px 520px at 92% 12%, var(--color-hud), transparent 62%)',
        }}
      />
      <span
        className="drift-a absolute h-[420px] w-[420px] rounded-full blur-3xl"
        style={{ top: '-8%', left: '4%', background: 'var(--color-glow)', opacity: 0.28 }}
      />
      <span
        className="drift-b absolute h-[360px] w-[360px] rounded-full blur-3xl"
        style={{ top: '32%', right: '2%', background: 'var(--color-hud-strong)', opacity: 0.22 }}
      />
      <span
        className="drift-c absolute h-[300px] w-[300px] rounded-full blur-3xl"
        style={{ bottom: '-6%', left: '38%', background: 'var(--color-glow)', opacity: 0.2 }}
      />
      <div
        className="grid-pan absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-hud) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hud) 1px, transparent 1px)',
          backgroundSize: '64px 64px',
        }}
      />
    </div>
  )
}

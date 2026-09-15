/**
 * THE BOOT · a pre-flight
 *
 * "Shall I start them?" is a question the screen can already answer. The
 * emblem, a greeting, and the eight-stage rail — but the rail carries the
 * last run's real outcome under each stage, and the two that need a person
 * are amber. What a run will and will not do is read off the stages, so the
 * greeting says nothing twice and the primary action just runs.
 *
 * The rail stands on a shallow arc that recedes at both ends and turns a
 * few degrees toward the pointer. Labels stay upright: depth comes from
 * position and scale, never from skewing text. Under reduced motion the
 * whole screen lands at once, complete.
 */

import { useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent, type ReactNode } from 'react'
import { Brain, CalendarDays, Gauge, Network, Play, Search, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { EMBLEM_DATA_URI } from '../../../shared/emblem-data'
import { prefersReducedMotion, useStore } from '../../store'
import { Btn } from '../ui'
import { STAGES } from '../layout'

const STAGE_ICON = [Search, ShieldCheck, Gauge, CalendarDays, Sparkles, Send, Network, Brain]
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'
/** The brand definition is configuration, not a lesson. */
const BRAND_DEFINITION_CATEGORIES = ['Brand Corpus', 'Brand Voice', 'Brand Guideline', 'Visual Identity', 'Compliance Rule']

interface StageReading {
  /** What the last run returned at this stage. */
  line: string
  /** Whether a person is needed here. */
  attention: boolean
}

export function BootSequence() {
  const bootOpen = useStore((s) => s.bootOpen)
  const user = useStore((s) => s.user)
  const theme = useStore((s) => s.theme)
  const apiMode = useStore((s) => s.apiMode)
  const publishMode = useStore((s) => s.mode.publishMode)
  const scraped = useStore((s) => s.scraped)
  const signals = useStore((s) => s.keywordSignals)
  const ideas = useStore((s) => s.ideas)
  const published = useStore((s) => s.published)
  const knowledge = useStore((s) => s.knowledge)
  const reviewQueue = useStore((s) => s.reviewQueue)

  const [leaving, setLeaving] = useState(false)
  const [tilt, setTilt] = useState({ x: 6, y: 0 })
  const frameRef = useRef<HTMLDivElement | null>(null)

  /* ── What the last run returned, stage by stage ─────────────────────── */
  const readings = useMemo<StageReading[]>(() => {
    const openVerdicts = reviewQueue.filter((q) => !q.resolved).length
    const scored = scraped.filter((s) => s.validation !== 'pending').length
    const trending = signals.filter((s) => s.is_trending).length
    const drafted = ideas.filter((i) => i.status !== 'suggested').length
    const gated = ideas.filter((i) => i.status === 'pending_leadership' || i.status === 'in_review').length
    const lessons = knowledge.filter((e) => e.active && !BRAND_DEFINITION_CATEGORIES.includes(e.category)).length
    const n = (count: number, noun: string, none: string): string => (count === 0 ? none : `${count} ${noun}`)
    return [
      { line: n(scraped.length, 'kept', 'nothing yet'), attention: false },
      openVerdicts > 0 ? { line: `${openVerdicts} for you`, attention: true } : { line: n(scored, 'scored', '0 new'), attention: false },
      { line: n(trending, 'trends', 'no trends'), attention: false },
      { line: n(ideas.length, 'ranked', 'none ranked'), attention: false },
      { line: n(drafted, 'drafted', 'none drafted'), attention: false },
      gated > 0 ? { line: `${gated} gated`, attention: true } : { line: n(published.length, 'out', 'none out'), attention: false },
      { line: n(published.length, 'posts', 'nothing measured'), attention: false },
      { line: n(lessons, 'lessons', 'no lessons'), attention: false },
    ]
  }, [scraped, signals, ideas, published, knowledge, reviewQueue])

  const forYou = readings.filter((r) => r.attention).length

  const hour = new Date().getHours()
  const salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const dismiss = (): void => {
    setLeaving(true)
    window.setTimeout(() => {
      useStore.setState({ bootOpen: false })
      setLeaving(false)
    }, 320)
  }

  useEffect(() => {
    if (!bootOpen) return
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') dismiss()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [bootOpen])

  if (!bootOpen) return null

  const start = (): void => {
    dismiss()
    useStore.getState().openTheater()
    void useStore.getState().runScraping()
  }

  const calm = prefersReducedMotion()
  const onMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (calm || event.pointerType === 'touch') return
    const rect = frameRef.current?.getBoundingClientRect()
    if (!rect) return
    const px = (event.clientX - rect.left) / rect.width - 0.5
    const py = (event.clientY - rect.top) / rect.height - 0.5
    setTilt({ x: 6 - py * 6, y: px * 6 })
  }

  const light = theme === 'light'
  const mid = (STAGES.length - 1) / 2

  return (
    <div
      ref={frameRef}
      onPointerMove={onMove}
      onPointerLeave={() => setTilt({ x: 6, y: 0 })}
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center overflow-hidden bg-page px-6 text-ink"
      style={leaving ? { animation: 'boot-leave 320ms var(--ease-out-soft) both' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Starting Ethara SocialAI"
    >
      <Ground light={light} />

      <button
        type="button"
        onClick={dismiss}
        className="mono absolute right-6 top-6 z-10 text-[10.5px] uppercase tracking-[0.14em] text-ink-3 transition-colors hover:text-ink"
      >
        Skip · Esc
      </button>

      <div className="relative z-10 flex w-full max-w-[1000px] flex-col items-center">
        {/* ── The mark ──────────────────────────────────────────────────── */}
        <div className="relative flex h-[150px] w-[150px] shrink-0 items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute -inset-[14px] rounded-full"
            style={{ background: 'radial-gradient(circle, var(--color-hud), transparent 70%)', animation: 'eth-mark-breathe 6.5s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
          />
          <span
            aria-hidden="true"
            className="absolute -inset-[3px] rounded-full border border-line-strong"
            style={{ animation: 'eth-mark-ring 6.5s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
          />
          <span
            role="img"
            aria-label="Ethara"
            className="relative block h-[116px] w-[116px] overflow-hidden rounded-full"
            style={{ animation: `eth-mark-settle 900ms ${EASE} 180ms both` }}
          >
            <img src={EMBLEM_DATA_URI} alt="" width={116} height={116} draggable={false} className="block h-full w-full rounded-full object-cover" style={{ background: 'var(--color-surface)' }} />
            <span
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background: `linear-gradient(100deg, transparent 42%, color-mix(in srgb, var(--color-ink) ${light ? 80 : 30}%, transparent) 50%, transparent 58%)`,
                animation: 'eth-mark-sheen 9s cubic-bezier(0.4, 0, 0.2, 1) 1.2s infinite',
              }}
            />
          </span>
        </div>

        <h1 className="mt-[26px] text-[28px] font-semibold leading-tight tracking-[-0.028em]" style={{ animation: `eth-rise 520ms ${EASE} 240ms both` }}>
          {salutation}.
        </h1>

        {/* ── The rail, in depth ────────────────────────────────────────── */}
        <div className="mt-10 w-full" style={{ perspective: 1400, perspectiveOrigin: '50% 30%' }}>
          <div
            className="relative flex w-full items-start justify-between px-0 pb-[26px] pt-[18px]"
            style={{
              transformStyle: 'preserve-3d',
              transform: `rotateX(${tilt.x.toFixed(2)}deg) rotateY(${tilt.y.toFixed(2)}deg)`,
              transition: `transform 700ms ${EASE}`,
            }}
          >
            {/* a floor arc under the stages */}
            <span
              aria-hidden="true"
              className="pointer-events-none absolute -bottom-[22px] left-[-6%] right-[-6%] h-[120px] rounded-[50%] border border-line-strong"
              style={{
                borderTopColor: 'transparent',
                transform: 'translateZ(-120px) rotateX(70deg)',
                background: 'radial-gradient(ellipse at 50% 100%, color-mix(in srgb, var(--color-hud) 60%, transparent), transparent 70%)',
              }}
            />

            {STAGES.map((stage, i) => {
              const Icon = STAGE_ICON[i] ?? Sparkles
              const reading = readings[i] ?? { line: '', attention: false }
              const t = (i - mid) / mid
              const z = -Math.round(t * t * 150)
              const y = Math.round(t * t * 10)
              const s = (1 - t * t * 0.08).toFixed(3)
              const rest = `translate3d(0, ${y}px, ${z}px) scale(${s})`
              const from = `translate3d(0, ${y + 24}px, ${z - 220}px) scale(${s})`
              const opacity = (1 - t * t * 0.18).toFixed(3)
              const tone = reading.attention ? 'var(--color-serious)' : null
              return (
                <StageAndLink key={stage.id} first={i === 0} linkT={(i - 0.5 - mid) / mid}>
                  <div
                    className="group flex w-[96px] shrink-0 flex-col items-center gap-[9px]"
                    style={
                      {
                        transformStyle: 'preserve-3d',
                        '--from': from,
                        '--rest': rest,
                        '--op': opacity,
                        animation: `eth-stage-in 720ms ${EASE} ${380 + i * 60}ms both`,
                      } as CSSProperties
                    }
                    title={`${stage.label} · ${reading.line}`}
                  >
                    <span
                      className="relative flex h-[46px] w-[46px] items-center justify-center rounded-full border transition-[transform,box-shadow] duration-[260ms] ease-[var(--ease-out-soft)] group-hover:[transform:translateZ(26px)_scale(1.1)]"
                      style={{
                        borderColor: tone ?? 'var(--color-line-strong)',
                        color: tone ?? 'var(--color-ink-3)',
                        background: light
                          ? 'radial-gradient(circle at 35% 30%, var(--color-surface), var(--color-surface-3) 70%)'
                          : 'radial-gradient(circle at 35% 30%, var(--color-surface-3), var(--color-page) 72%)',
                        boxShadow:
                          `inset 0 1px 0 color-mix(in srgb, var(--color-ink) ${light ? 95 : 8}%, transparent), ` +
                          `inset 0 -6px 12px rgba(0, 0, 0, ${light ? 0.06 : 0.45}), ` +
                          `0 18px 30px -18px rgba(0, 0, 0, ${light ? 0.35 : 0.85})` +
                          (tone ? `, 0 0 0 4px color-mix(in srgb, ${tone} 12%, transparent)` : ''),
                      }}
                    >
                      <Icon size={19} strokeWidth={1.6} aria-hidden="true" style={tone ? { filter: `drop-shadow(0 0 6px color-mix(in srgb, ${tone} 55%, transparent))` } : undefined} />
                      {reading.attention ? (
                        <span
                          aria-hidden="true"
                          className="absolute -inset-[3px] rounded-full border border-serious opacity-40"
                          style={{ animation: 'eth-attention-breathe 4s ease-in-out infinite' }}
                        />
                      ) : null}
                    </span>
                    <span className={`text-[11.5px] font-semibold tracking-[-0.01em] ${reading.attention ? 'text-ink' : 'text-ink-2'}`}>{stage.label}</span>
                    <span className={`mono text-[10px] ${reading.attention ? 'text-serious' : 'text-ink-3'}`}>{reading.line}</span>
                  </div>
                </StageAndLink>
              )
            })}
          </div>
        </div>

        {/* ── One action ────────────────────────────────────────────────── */}
        <div className="mt-[46px] flex items-center gap-2.5" style={{ animation: `eth-rise 520ms ${EASE} 920ms both` }}>
          {user?.role === 'leadership' ? (
            <>
              <PrimaryAction label="Open final approvals" icon={<ShieldCheck size={13} aria-hidden="true" />} onClick={() => { useStore.getState().setPage('leadership'); dismiss() }} />
              <Btn variant="ghost" onClick={start} className="!rounded-[9px] !px-4 !py-[11px] !text-[13.5px]">Run Social AI</Btn>
            </>
          ) : (
            <>
              <PrimaryAction label="Run Social AI" icon={<Play size={12} fill="currentColor" aria-hidden="true" />} onClick={start} />
              <Btn variant="ghost" onClick={dismiss} className="!rounded-[9px] !px-4 !py-[11px] !text-[13.5px]">Dashboard</Btn>
            </>
          )}
        </div>

        {/* Mode is stated, not implied: the three things that change what to do next. */}
        <p className="mono mt-5 text-[10px] uppercase tracking-[0.14em] text-ink-3" style={{ animation: `eth-rise 520ms ${EASE} 1040ms both` }}>
          {apiMode === 'connected' ? `Live runtime · ${publishMode} mode` : 'Standalone · bundled data'}
          {forYou > 0 ? <span className="text-serious"> · {forYou} for you</span> : null}
        </p>
      </div>
    </div>
  )
}

/** A stage, preceded by its link from the stage before — the link sits on the same arc. */
function StageAndLink({ first, linkT, children }: { first: boolean; linkT: number; children: ReactNode }) {
  if (first) return <>{children}</>
  const z = -Math.round(linkT * linkT * 150)
  const y = Math.round(linkT * linkT * 10)
  return (
    <>
      <span
        aria-hidden="true"
        className="mt-[18px] h-px min-w-3 flex-1 bg-line-strong"
        style={{ transform: `translate3d(0, ${y}px, ${z}px)`, opacity: 1 - linkT * linkT * 0.18 }}
      />
      {children}
    </>
  )
}

function PrimaryAction({ label, icon, onClick }: { label: string; icon: ReactNode; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex items-center gap-[11px] rounded-[9px] border border-accent bg-accent px-[18px] py-[11px] text-left transition-[transform,background-color] duration-[220ms] ease-[var(--ease-out-soft)] hover:-translate-y-0.5 hover:bg-accent-bright active:translate-y-0"
    >
      <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-on-accent text-accent">{icon}</span>
      <span className="block text-[14px] font-semibold leading-snug text-on-accent">{label}</span>
    </button>
  )
}

/**
 * The ground. Dark: one bloom, a floor receding to the horizon, a vignette.
 * Light: a gradient ground, two slow blooms, a masked dot grid, the floor,
 * a beam at the horizon, and the vignette.
 */
function Ground({ light }: { light: boolean }) {
  const gridLine = 'var(--color-hud)'
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      {light ? (
        <>
          <span className="absolute inset-0" style={{ background: 'linear-gradient(180deg, var(--color-surface) 0%, var(--color-page) 52%, var(--color-surface-3) 100%)' }} />
          <span
            className="absolute -left-[10%] -top-[22%] h-[620px] w-[820px] rounded-full blur-[70px]"
            style={{ background: 'radial-gradient(circle, var(--color-hud-strong), transparent 66%)', animation: 'eth-lbloom-a 40s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
          />
          <span
            className="absolute -right-[14%] top-[6%] h-[560px] w-[720px] rounded-full blur-[78px]"
            style={{ background: 'radial-gradient(circle, var(--color-hud-glow), transparent 66%)', animation: 'eth-lbloom-b 52s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
          />
          <span className="absolute -bottom-[30%] left-[30%] h-[560px] w-[760px] rounded-full blur-[80px]" style={{ background: 'radial-gradient(circle, var(--color-hud-strong), transparent 66%)' }} />
          <span
            className="absolute inset-0"
            style={{
              backgroundImage: 'radial-gradient(var(--color-line-strong) 0.8px, transparent 0.8px)',
              backgroundSize: '22px 22px',
              maskImage: 'radial-gradient(70% 60% at 50% 42%, #000 20%, transparent 100%)',
              WebkitMaskImage: 'radial-gradient(70% 60% at 50% 42%, #000 20%, transparent 100%)',
            }}
          />
        </>
      ) : (
        <span
          className="absolute left-1/2 top-[30%] h-[720px] w-[1080px] -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{ background: 'radial-gradient(circle, var(--color-hud), transparent 66%)' }}
        />
      )}

      <div className="absolute inset-x-0 bottom-0 h-[400px]" style={{ perspective: light ? 760 : 720, perspectiveOrigin: '50% 0%' }}>
        <div
          className="absolute -bottom-1/2 -left-[34%] -right-[34%] top-0 origin-top"
          style={{
            transform: 'rotateX(80deg)',
            backgroundImage: `linear-gradient(to right, ${gridLine} 1px, transparent 1px), linear-gradient(to bottom, ${gridLine} 1px, transparent 1px)`,
            backgroundSize: light ? '76px 76px' : '84px 84px',
            maskImage: 'linear-gradient(to bottom, transparent 0%, #000 42%, transparent 92%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 42%, transparent 92%)',
            animation: `eth-floorpan-slow ${light ? 30 : 34}s cubic-bezier(0.37, 0, 0.63, 1) infinite`,
          }}
        />
      </div>

      {light ? (
        <span
          className="absolute inset-x-0 top-[60%] h-px"
          style={{
            background: 'linear-gradient(90deg, transparent, var(--color-hud-strong) 30%, var(--color-hud-strong) 70%, transparent)',
            animation: 'eth-lbeam 11s cubic-bezier(0.37, 0, 0.63, 1) infinite',
          }}
        />
      ) : null}

      <span
        className="absolute inset-0"
        style={{
          background: light
            ? 'radial-gradient(118% 84% at 50% 40%, transparent 52%, color-mix(in srgb, var(--color-surface-3) 55%, transparent) 100%)'
            : 'radial-gradient(118% 84% at 50% 40%, transparent 48%, color-mix(in srgb, var(--color-page) 88%, transparent) 100%)',
        }}
      />
    </div>
  )
}

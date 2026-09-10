/**
 * THE BOOT SEQUENCE
 *
 * A full-screen boot in three beats, dismissible via Skip, Esc or the final
 * action. Every count in it is real, read from state — a boot screen that lied
 * about the numbers would be the worst possible first impression of a system
 * whose whole claim is that it knows.
 *
 *   1  Ignition   — the emblem blooms in over a soft ground, with three short
 *                   status lines beneath it.
 *   2  Assembly   — the eight stages land left to right, then light in pipeline
 *                   order, one every 150ms, while a single lit line draws along
 *                   the rail behind them with a light at its head. One moving
 *                   element, timed to the lighting — the earlier free-running
 *                   spark dot fought the stages instead of leading them.
 *   3  Hand-off   — the greeting streams in, then the one action.
 *
 * WHAT IS DELIBERATELY NOT HERE. The twelve agents used to roll-call as
 * individual chips beneath the stages, and each stage carried its own agent
 * count. Both restated what the greeting says in one line — "twelve agents are
 * online" — and between them they turned the calmest screen in the product into
 * the densest. The stage rail answers "what will happen"; the greeting answers
 * "what is waiting". Nothing needs to answer either twice.
 *
 * TIMING IS DERIVED, NOT GUESSED. The hand-off waits for the last stage to
 * light, computed from the same constants that drive the lighting. It used to be
 * a hardcoded 2400ms while the stages finished at 2740ms, so the greeting cut
 * across the assembly it was supposed to follow.
 *
 * Under reduced motion the whole thing lands at once, complete.
 */

import { useEffect, useMemo, useState } from 'react'
import { Brain, CalendarDays, Gauge, Network, Search, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { REGISTRY_SUMMARY } from '@shared/agent-registry'
import { addressOperator } from '@shared/assistant-persona'
import { useStore, prefersReducedMotion } from '../../store'
import { Btn } from '../ui'
import { PlayButton } from '../play-button'
import { BootEmblem } from './boot-emblem'
import { STAGES } from '../layout'

const STAGE_ICON = [Search, ShieldCheck, Gauge, CalendarDays, Sparkles, Send, Network, Brain]

/* ── Timing ───────────────────────────────────────────────────────────────────
   One place, and the hand-off is computed from the rest so the beats cannot
   drift out of order when a value is tuned. */

/** When the emblem settles and the stage rail begins to land. */
const T_ASSEMBLY = 800
/** How long after assembly the first stage lights. */
const T_SPARK_LEAD = 360
/** Gap between one stage lighting and the next. Slow enough to read. */
const T_STAGE_STEP = 150
/** The greeting follows the last stage, never overlaps it. */
const T_HANDOFF = T_ASSEMBLY + T_SPARK_LEAD + T_STAGE_STEP * STAGES.length + 140

/** Streams text in at a fixed cadence. Whole under reduced motion. */
function useTypewriter(text: string, active: boolean, cadenceMs = 16): string {
  const [shown, setShown] = useState(0)

  useEffect(() => {
    if (!active) return
    if (prefersReducedMotion()) {
      setShown(text.length)
      return
    }
    setShown(0)
    const timer = window.setInterval(() => {
      setShown((n) => {
        if (n >= text.length) {
          window.clearInterval(timer)
          return n
        }
        return n + 1
      })
    }, cadenceMs)
    return () => window.clearInterval(timer)
  }, [text, active, cadenceMs])

  return text.slice(0, shown)
}

export function BootSequence() {
  const bootOpen = useStore((s) => s.bootOpen)
  const user = useStore((s) => s.user)
  const agents = useStore((s) => s.agents)
  const ideas = useStore((s) => s.ideas)
  const apiMode = useStore((s) => s.apiMode)
  const settings = useStore((s) => s.settings)
  const publishMode = useStore((s) => s.mode.publishMode)

  const [beat, setBeat] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [linesShown, setLinesShown] = useState(0)
  const [litStages, setLitStages] = useState(0)

  const awaitingLeadership = ideas.filter((i) => i.status === 'pending_leadership').length

  /** Three lines, not five: the registry, whether it is live, and the mode. */
  const bootLines = useMemo(
    () => [
      `${REGISTRY_SUMMARY.agents} agents · ${REGISTRY_SUMMARY.skills} skills`,
      apiMode === 'connected' ? 'Runtime connected' : 'Runtime standalone',
      `Mode ${apiMode === 'connected' ? publishMode : 'demo'}`,
    ],
    [apiMode, publishMode],
  )

  const who = addressOperator(user?.role ?? 'marketing', settings.assistantAddressStyle)
  const hour = new Date().getHours()
  const salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  /**
   * Two clauses, no counts.
   *
   * It used to read "12 agents online, 10 awaiting a verdict, 1 with
   * Leadership" — three numbers in the one place nobody acts on them. The
   * queue counts belong on the screens that can clear them, and the sidebar and
   * Leadership badge already carry them. Here the only question is whether to
   * start, so that is the only thing asked.
   */
  const greeting =
    `${salutation}, ${who}. Agents are online. ` +
    (user?.role === 'leadership' ? 'Shall I open the approvals?' : 'Shall I start them?')

  const typed = useTypewriter(greeting, bootOpen && beat >= 2)
  const greetingDone = typed.length === greeting.length

  const dismiss = (): void => {
    setLeaving(true)
    window.setTimeout(() => {
      useStore.setState({ bootOpen: false })
      setLeaving(false)
      setBeat(0)
      setLinesShown(0)
      setLitStages(0)
    }, 320)
  }

  // The three beats. Under reduced motion everything lands at once.
  useEffect(() => {
    if (!bootOpen) return

    if (prefersReducedMotion()) {
      setBeat(2)
      setLinesShown(bootLines.length)
      setLitStages(STAGES.length)
      return
    }

    const timers: number[] = []
    for (const [i] of bootLines.entries()) {
      timers.push(window.setTimeout(() => setLinesShown(i + 1), 160 * (i + 1)))
    }
    timers.push(window.setTimeout(() => setBeat(1), T_ASSEMBLY))
    // The spark lights each stage as it arrives, in pipeline order.
    for (let i = 0; i < STAGES.length; i += 1) {
      timers.push(
        window.setTimeout(
          () => setLitStages(i + 1),
          T_ASSEMBLY + T_SPARK_LEAD + T_STAGE_STEP * (i + 1),
        ),
      )
    }
    timers.push(window.setTimeout(() => setBeat(2), T_HANDOFF))
    return () => {
      for (const timer of timers) window.clearTimeout(timer)
    }
  }, [bootOpen, bootLines])

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

  return (
    <div
      className="fixed inset-0 z-[95] flex flex-col items-center justify-center overflow-hidden bg-page px-6"
      style={leaving ? { animation: 'boot-leave 320ms var(--ease-out-soft) both' } : undefined}
      role="dialog"
      aria-modal="true"
      aria-label="Starting Ethara SocialAI"
    >
      {/* Ambient ground. One soft glow and a very faint grid — quiet enough that
          the emblem is the only thing that reads as lit. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <span
          className="absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{
            background: 'var(--color-glow)',
            opacity: 0.2,
            animation: 'glow-pulse 11s var(--ease-in-out-soft) infinite',
          }}
        />
        <span
          className="absolute left-[28%] top-[26%] h-[380px] w-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{ background: 'var(--color-accent)', opacity: 0.11, animation: 'drift-a 20s var(--ease-in-out-soft) infinite' }}
        />
        <span
          className="absolute left-[70%] top-[52%] h-[320px] w-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{ background: 'var(--color-magenta)', opacity: 0.09, animation: 'drift-b 24s var(--ease-in-out-soft) infinite' }}
        />
        <div
          className="grid-pan absolute inset-0 opacity-[0.14]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-hud) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hud) 1px, transparent 1px)',
            backgroundSize: '72px 72px',
          }}
        />
      </div>

      <button
        type="button"
        onClick={dismiss}
        className="absolute right-6 top-6 z-10 text-[11px] uppercase tracking-[0.14em] text-ink-3 transition-colors hover:text-ink"
      >
        Skip · Esc
      </button>

      {/* ── Beat 1 · Ignition ─────────────────────────────────────────────── */}
      <div
        className="relative z-10 flex items-center justify-center transition-all duration-[var(--dur-cinematic)] ease-[var(--ease-out-expo)]"
        style={{ transform: beat >= 1 ? 'translateY(-4px) scale(0.5)' : 'scale(1)' }}
      >
        <BootEmblem state={beat === 0 ? 'thinking' : greetingDone ? 'dormant' : 'working'} size={236} />
        {beat >= 1 ? (
          <span
            className="pointer-events-none absolute inset-[14%] rounded-full border-2 border-accent"
            style={{ animation: 'boot-settle 900ms var(--ease-out-soft) both' }}
            aria-hidden="true"
          />
        ) : null}
      </div>

      {beat === 0 ? (
        <div className="relative z-10 mt-6 flex flex-col items-center gap-1 text-[11.5px] text-ink-3">
          {bootLines.slice(0, linesShown).map((line) => (
            <p key={line} style={{ animation: 'boot-line 320ms var(--ease-out-soft) both' }}>
              {line}
            </p>
          ))}
        </div>
      ) : null}

      {/* ── Beat 2 · Assembly ─────────────────────────────────────────────── */}
      {beat >= 1 ? (
        <div className="relative z-10 mt-2 w-full max-w-3xl">
          <div className="relative flex items-start justify-center gap-3 overflow-x-auto pb-1">
            {/* The rail behind the icons: a track, and a lit line that draws
                across it stage by stage with a light at its head. */}
            <span className="pointer-events-none absolute left-[38px] right-[38px] top-5 h-px bg-line" aria-hidden="true" />
            <span
              className="pointer-events-none absolute left-[38px] top-5 h-px"
              style={{
                width: `calc((100% - 76px) * ${Math.max(0, litStages - 1) / Math.max(1, STAGES.length - 1)})`,
                background: 'linear-gradient(90deg, var(--color-accent), var(--color-accent-bright))',
                boxShadow: '0 0 10px -1px var(--color-glow)',
                transition: `width ${T_STAGE_STEP}ms var(--ease-out-soft)`,
              }}
              aria-hidden="true"
            >
              {litStages > 0 && litStages < STAGES.length ? (
                <span
                  className="absolute -right-1 top-1/2 h-2 w-2 -translate-y-1/2 rounded-full"
                  style={{ background: 'var(--color-accent-bright)', boxShadow: '0 0 12px 3px var(--color-glow)' }}
                />
              ) : null}
            </span>

            {STAGES.map((stage, i) => {
              const Icon = STAGE_ICON[i] ?? Sparkles
              const lit = i < litStages
              const running = stage.agents.some(
                (agentId) => agents.find((a) => a.agent_id === agentId)?.status === 'running',
              )
              return (
                <div
                  key={stage.id}
                  className="flex w-[76px] shrink-0 flex-col items-center gap-2 text-center"
                  style={{ animation: `boot-stage-in 520ms var(--ease-out-expo) ${0.04 + i * 0.08}s both` }}
                >
                  <span
                    className="relative flex h-10 w-10 items-center justify-center rounded-full border bg-surface-2 transition-[border-color,box-shadow] duration-[var(--dur-slow)] ease-[var(--ease-out-soft)]"
                    style={{
                      borderColor: lit ? 'var(--color-accent)' : 'var(--color-line)',
                      boxShadow: lit ? '0 0 22px -6px var(--color-glow)' : 'none',
                      ...(lit ? { animation: 'boot-stage-light 560ms var(--ease-out-expo) both' } : {}),
                    }}
                  >
                    <Icon
                      size={15}
                      className={`transition-colors duration-[var(--dur-slow)] ${lit || running ? 'text-accent-bright' : 'text-ink-3'}`}
                      aria-hidden="true"
                    />
                    {/* One ring bursts outward the moment the stage lights. */}
                    {lit ? (
                      <span
                        className="absolute inset-0 rounded-full border border-accent"
                        style={{ animation: 'boot-ring 760ms var(--ease-out-soft) both' }}
                        aria-hidden="true"
                      />
                    ) : null}
                    {running ? (
                      <span className="anim-ping-slow absolute inset-0 rounded-full border border-accent" aria-hidden="true" />
                    ) : null}
                  </span>
                  <span
                    className={`text-[11px] transition-colors duration-[var(--dur-slow)] ${
                      lit ? 'font-medium text-ink' : 'text-ink-3'
                    }`}
                  >
                    {stage.label}
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      ) : null}

      {/* ── Beat 3 · Hand-off ─────────────────────────────────────────────── */}
      {beat >= 2 ? (
        <div className="anim-fade-up relative z-10 mt-7 flex max-w-xl flex-col items-center gap-6 text-center">
          <p
            className={`min-h-[2.6em] text-[15px] leading-relaxed text-ink ${
              greetingDone ? '' : 'assistant-caret'
            }`}
          >
            {typed}
          </p>

          <div
            className="flex flex-wrap items-center justify-center gap-2.5 transition-opacity duration-[var(--dur-slow)]"
            style={{ opacity: greetingDone ? 1 : 0.35 }}
          >
            {user?.role === 'leadership' ? (
              <>
                <span className="anim-fade-up" style={{ animationDelay: '80ms' }}>
                  <PlayButton
                    label="Open final approvals"
                    hint={`${awaitingLeadership} awaiting your decision`}
                    icon={<ShieldCheck size={14} />}
                    onClick={() => {
                      useStore.getState().setPage('leadership')
                      dismiss()
                    }}
                    className="boot-cta"
                  />
                </span>
                <span className="anim-fade-up" style={{ animationDelay: '200ms' }}>
                  <Btn variant="ghost" onClick={start}>
                    Run Ethara SocialAI
                  </Btn>
                </span>
              </>
            ) : (
              <>
                <span className="anim-fade-up" style={{ animationDelay: '80ms' }}>
                  <PlayButton
                    label="Run Ethara SocialAI"
                    hint="Scrape → Validate → Analyse → Plan → Create"
                    onClick={start}
                    className="boot-cta"
                  />
                </span>
                <span className="anim-fade-up" style={{ animationDelay: '200ms' }}>
                  <Btn variant="ghost" onClick={dismiss}>
                    Take me to the dashboard
                  </Btn>
                </span>
              </>
            )}
          </div>

          {/* Law 9 — the mode is always visible. One clause, not a sentence that
              repeats what the greeting just said. */}
          <p className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
            {apiMode === 'connected' ? 'Live runtime' : 'Standalone · bundled data'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

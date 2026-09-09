/**
 * THE BOOT SEQUENCE
 *
 * A full-screen boot in three beats, dismissible via Skip, Esc or the final
 * action. Every count in it is real, read from state — a boot screen that lied
 * about the numbers would be the worst possible first impression of a system
 * whose whole claim is that it knows.
 *
 *   1  Ignition   — the company emblem blooms in, the reactor rings orbit it,
 *                   a monospace boot log types beneath.
 *   2  Assembly   — the eight stages land left to right; a spark travels the
 *                   connectors and lights each stage as it passes; the twelve
 *                   agents roll-call online.
 *   3  Hand-off   — the greeting streams in, then "Run Ethara SocialAI".
 *
 * Under reduced motion the whole thing lands at once, complete.
 */

import { useEffect, useMemo, useState } from 'react'
import { Brain, CalendarDays, Gauge, Network, Search, Send, ShieldCheck, Sparkles } from 'lucide-react'
import { AGENTS, REGISTRY_SUMMARY } from '@shared/agent-registry'
import { addressOperator } from '@shared/assistant-persona'
import { useStore, prefersReducedMotion } from '../../store'
import { Btn } from '../ui'
import { PlayButton } from '../play-button'
import { Logo } from '../logo'
import { AssistantCore } from './core'
import { Holo } from '../tilt'
import { STAGES } from '../layout'

const STAGE_ICON = [Search, ShieldCheck, Gauge, CalendarDays, Sparkles, Send, Network, Brain]

/** Beat boundaries, in ms. */
const T_ASSEMBLY = 900
const T_STAGE_STEP = 160
const T_HANDOFF = 2_400

/** Streams text in at a fixed cadence. Whole under reduced motion. */
function useTypewriter(text: string, active: boolean, cadenceMs = 14): string {
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
  const knowledge = useStore((s) => s.knowledge)
  const reviewQueue = useStore((s) => s.reviewQueue)
  const ideas = useStore((s) => s.ideas)
  const apiMode = useStore((s) => s.apiMode)
  const settings = useStore((s) => s.settings)
  const publishMode = useStore((s) => s.mode.publishMode)

  const [beat, setBeat] = useState(0)
  const [leaving, setLeaving] = useState(false)
  const [linesShown, setLinesShown] = useState(0)
  const [litStages, setLitStages] = useState(0)
  const [online, setOnline] = useState(0)

  const openQueue = reviewQueue.filter((q) => !q.resolved).length
  const awaitingLeadership = ideas.filter((i) => i.status === 'pending_leadership').length
  const activeKnowledge = knowledge.filter((k) => k.active).length

  const bootLines = useMemo(
    () => [
      `REGISTRY ${REGISTRY_SUMMARY.agents} AGENTS / ${REGISTRY_SUMMARY.skills} SKILLS / ${REGISTRY_SUMMARY.knobs} SETTINGS`,
      apiMode === 'connected' ? 'RUNTIME CONNECTED' : 'RUNTIME STANDALONE · LOCAL DEMO DATA',
      `KNOWLEDGE ${activeKnowledge} ENTRIES`,
      'PIPELINE IDLE',
      `MODE ${apiMode === 'connected' ? publishMode.toUpperCase() : 'DEMO'}`,
    ],
    [apiMode, activeKnowledge, publishMode],
  )

  const who = addressOperator(user?.role ?? 'marketing', settings.assistantAddressStyle)
  const hour = new Date().getHours()
  const salutation = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening'

  const greeting =
    `${salutation}, ${who}. ${agents.length} agents are online. ` +
    `${openQueue === 0 ? 'Nothing is waiting on a verdict' : `${openQueue} item${openQueue === 1 ? ' is' : 's are'} waiting on a verdict`}` +
    ` and ${awaitingLeadership} post${awaitingLeadership === 1 ? ' is' : 's are'} with Leadership. ` +
    (user?.role === 'leadership' ? 'Shall I open the approvals?' : 'Shall I start the agents?')

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
      setOnline(0)
    }, 320)
  }

  // The three beats. Under reduced motion everything lands at once.
  useEffect(() => {
    if (!bootOpen) return

    if (prefersReducedMotion()) {
      setBeat(2)
      setLinesShown(bootLines.length)
      setLitStages(STAGES.length)
      setOnline(AGENTS.length)
      return
    }

    const timers: number[] = []
    for (const [i] of bootLines.entries()) {
      timers.push(window.setTimeout(() => setLinesShown(i + 1), 120 * (i + 1)))
    }
    timers.push(window.setTimeout(() => setBeat(1), T_ASSEMBLY))
    // The spark lights each stage as it arrives, 160ms apart, after the stage has landed.
    for (let i = 0; i < STAGES.length; i += 1) {
      timers.push(window.setTimeout(() => setLitStages(i + 1), T_ASSEMBLY + 550 + T_STAGE_STEP * (i + 1)))
    }
    // The roll-call: twelve agents, 90ms apart, overlapping the stage assembly.
    for (let i = 0; i < AGENTS.length; i += 1) {
      timers.push(window.setTimeout(() => setOnline(i + 1), T_ASSEMBLY + 700 + 90 * i))
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
      {/* Ambient ground: a soft glow and a slow grid, so the emblem sits on something. */}
      <div className="pointer-events-none absolute inset-0" aria-hidden="true">
        <span
          className="absolute left-1/2 top-[38%] h-[520px] w-[520px] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
          style={{ background: 'var(--color-glow)', opacity: 0.35, animation: 'glow-pulse 8s var(--ease-in-out-soft) infinite' }}
        />
        <div
          className="grid-pan absolute inset-0 opacity-[0.3]"
          style={{
            backgroundImage:
              'linear-gradient(to right, var(--color-hud) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hud) 1px, transparent 1px)',
            backgroundSize: '56px 56px',
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

      {/* ── Beat 1 · Ignition: the emblem, with the reactor rings orbiting it. */}
      <div
        className="relative z-10 flex items-center justify-center transition-all duration-[var(--dur-cinematic)] ease-[var(--ease-out-expo)]"
        style={{ transform: beat >= 1 ? 'translateY(-6px) scale(0.56)' : 'scale(1)' }}
      >
        <Holo size={236} rings={3}>
          <span className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <AssistantCore state={beat === 0 ? 'thinking' : greetingDone ? 'dormant' : 'working'} size={236} />
          </span>
          <span className="relative flex h-[236px] w-[236px] items-center justify-center">
            <Logo size={128} mode="draw" className="relative" />
          </span>
        </Holo>
      </div>

      {beat === 0 ? (
        <div className="mono relative z-10 mt-8 space-y-1 text-center text-[11px] tracking-[0.12em] text-ink-3">
          {bootLines.slice(0, linesShown).map((line) => (
            <p key={line} className="flex items-center justify-center gap-2" style={{ animation: 'boot-line 240ms var(--ease-out-soft) both' }}>
              <span>{line}</span>
              <span className="text-good-ink" style={{ animation: 'fade-in 160ms var(--ease-out-soft) 80ms both' }}>
                OK
              </span>
            </p>
          ))}
        </div>
      ) : null}

      {/* ── Beat 2 · Assembly: stages land, the spark lights them, the agents roll-call. */}
      {beat >= 1 ? (
        <div className="relative z-10 mt-1 w-full max-w-4xl">
          <div className="flex items-start justify-center gap-1.5 overflow-x-auto pb-2">
            {STAGES.map((stage, i) => {
              const Icon = STAGE_ICON[i] ?? Sparkles
              const lit = i < litStages
              const running = stage.agents.some(
                (agentId) => agents.find((a) => a.agent_id === agentId)?.status === 'running',
              )
              return (
                <div key={stage.id} className="flex items-center">
                  <div
                    className="flex w-[92px] shrink-0 flex-col items-center gap-1.5 text-center"
                    style={{ animation: `boot-stage-in 420ms var(--ease-out-expo) ${0.05 + i * 0.16}s both` }}
                  >
                    <span
                      className="relative flex h-11 w-11 items-center justify-center rounded-full border bg-surface-2 transition-[border-color,box-shadow,transform] duration-[var(--dur-base)] ease-[var(--ease-out-soft)]"
                      style={{
                        borderColor: lit ? 'var(--color-accent)' : 'var(--color-line)',
                        boxShadow: lit ? '0 0 22px -6px var(--color-glow)' : 'none',
                        transform: lit ? 'scale(1.06)' : 'scale(1)',
                      }}
                    >
                      <Icon size={16} className={lit || running ? 'text-accent-bright' : 'text-ink-3'} aria-hidden="true" />
                      <span
                        className="absolute inset-0 rounded-full border border-accent/40"
                        style={{ animation: `boot-ring 620ms var(--ease-out-expo) ${0.05 + i * 0.16}s both` }}
                        aria-hidden="true"
                      />
                      {lit && i === litStages - 1 && litStages < STAGES.length ? (
                        <span className="anim-ping-slow absolute inset-0 rounded-full border border-magenta" aria-hidden="true" />
                      ) : null}
                      {running ? (
                        <span className="anim-ping-slow absolute inset-0 rounded-full border border-accent" aria-hidden="true" />
                      ) : null}
                    </span>
                    <span className={`text-[11px] font-medium transition-colors ${lit ? 'text-ink' : 'text-ink-3'}`}>{stage.label}</span>
                    <span className="tabular text-[9px] text-ink-3">
                      {stage.agents.length} agent{stage.agents.length === 1 ? '' : 's'}
                    </span>
                  </div>

                  {i < STAGES.length - 1 ? (
                    <span
                      className="relative -mt-6 h-px w-5 shrink-0 overflow-visible transition-colors duration-[var(--dur-base)]"
                      style={{
                        background: i < litStages - 1 ? 'var(--color-accent)' : 'var(--color-line-strong)',
                        animation: `flowbar-connector-in 320ms var(--ease-out-soft) ${0.2 + i * 0.16}s both`,
                      }}
                      aria-hidden="true"
                    >
                      <span
                        className="absolute -top-[2px] h-[5px] w-[5px] rounded-full bg-magenta"
                        style={{ animation: `flow-right 900ms var(--ease-in-out-soft) ${0.3 + i * 0.16}s both` }}
                      />
                    </span>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* The roll-call: twelve agents come online one by one. */}
          <div className="mt-3 flex flex-wrap items-center justify-center gap-1.5">
            {AGENTS.map((agent, i) => {
              const up = i < online
              return (
                <span
                  key={agent.id}
                  className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] transition-[opacity,border-color,color] duration-[var(--dur-base)]"
                  style={{
                    opacity: up ? 1 : 0.3,
                    borderColor: up ? 'var(--color-line-strong)' : 'var(--color-line)',
                    color: up ? 'var(--color-ink-2)' : 'var(--color-ink-3)',
                  }}
                >
                  <span
                    className={`h-1.5 w-1.5 rounded-full ${up ? 'bg-good' : 'bg-ink-3'}`}
                    style={up && i === online - 1 ? { animation: 'pulse-dot 1.4s var(--ease-in-out-soft) infinite' } : undefined}
                    aria-hidden="true"
                  />
                  {agent.name.replace(' Agent', '')}
                </span>
              )
            })}
            <span className="tabular ml-1 text-[10px] text-ink-3">
              {online}/{AGENTS.length} online
            </span>
          </div>
        </div>
      ) : null}

      {/* ── Beat 3 · Hand-off: the greeting streams, then the one action. */}
      {beat >= 2 ? (
        <div className="anim-fade-up relative z-10 mt-6 flex max-w-2xl flex-col items-center gap-5 text-center">
          <p className={`min-h-[3.2em] text-[15px] leading-relaxed text-ink ${greetingDone ? '' : 'assistant-caret'}`}>{typed}</p>

          <div
            className="flex flex-wrap items-center justify-center gap-2.5 transition-opacity duration-[var(--dur-slow)]"
            style={{ opacity: greetingDone ? 1 : 0.35 }}
          >
            {user?.role === 'leadership' ? (
              <>
                <PlayButton
                  label="Open final approvals"
                  hint={`${awaitingLeadership} awaiting your decision`}
                  icon={<ShieldCheck size={14} />}
                  onClick={() => {
                    useStore.getState().setPage('leadership')
                    dismiss()
                  }}
                />
                <Btn variant="ghost" onClick={start}>
                  Run Ethara SocialAI
                </Btn>
              </>
            ) : (
              <>
                <span className="relative">
                  {greetingDone ? (
                    <span className="anim-ping-slow pointer-events-none absolute -inset-1 rounded-2xl border border-accent/50" aria-hidden="true" />
                  ) : null}
                  <PlayButton
                    label="Run Ethara SocialAI"
                    hint="Scrape → Validate → Analyse → Plan → Create"
                    onClick={start}
                    className="relative"
                  />
                </span>
                <Btn variant="ghost" onClick={dismiss}>
                  Just take me to the dashboard
                </Btn>
              </>
            )}
          </div>

          <p className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
            {apiMode === 'connected'
              ? 'Live runtime · twelve agents will run and report as each finishes'
              : 'Standalone · the run replays the bundled corpus and labels itself'}
          </p>
        </div>
      ) : null}
    </div>
  )
}

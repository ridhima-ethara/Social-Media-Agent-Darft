/**
 * THE Ethara CONSOLE
 *
 * The full-page home of the command layer. Fully usable with the server down,
 * on the bundled deterministic parser — and it says so rather than pretending.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown, Mic, MicOff, Send, Sparkles } from 'lucide-react'
import { AGENT_BY_ID } from '@shared/agent-registry'
import { BAR_PLACEHOLDERS } from '@shared/assistant-persona'
import { TOOLS, TOOLS_BY_AGENT } from '@shared/tool-registry'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { AssistantCore } from '../components/assistant/core'
import { PlanCard } from '../components/assistant/plan-card'
import { ConfirmCard } from '../components/assistant/confirm-card'
import { useMicAmplitudes, Waveform } from '../components/assistant/waveform'
import { startListening as beginListening, voiceSupport, type ListenHandle } from '../lib/voice'
import { Badge, Btn, Metric, RiskPill, timeAgo } from '../components/ui'
import type { AgentId } from '../types'

export function AssistantConsole() {
  const turns = useStore((s) => s.assistant.turns)
  const coreState = useStore((s) => s.assistant.coreState)
  const listening = useStore((s) => s.assistant.listening)
  const streaming = useStore((s) => s.assistant.streaming)
  const pendingConfirm = useStore((s) => s.assistant.pendingConfirm)
  const notices = useStore((s) => s.assistant.notices)
  const brief = useStore((s) => s.assistant.brief)
  const conversation = useStore((s) => s.conversation)
  const apiMode = useStore((s) => s.apiMode)
  const assistantProvider = useStore((s) => s.mode.assistantProvider)
  const agents = useStore((s) => s.agents)
  const reviewQueue = useStore((s) => s.reviewQueue)
  const ideas = useStore((s) => s.ideas)
  const knowledge = useStore((s) => s.knowledge)
  const pipeline = useStore((s) => s.pipeline)
  const publishMode = useStore((s) => s.mode.publishMode)

  const sendCommand = useStore((s) => s.sendCommand)
  const confirmPlan = useStore((s) => s.confirmPlan)
  const startListening = useStore((s) => s.startListening)
  const stopListening = useStore((s) => s.stopListening)
  const runBrief = useStore((s) => s.runBrief)
  const dismissNotice = useStore((s) => s.dismissNotice)

  const [value, setValue] = useState('')
  const [interim, setInterim] = useState('')
  const [placeholderIndex, setPlaceholderIndex] = useState(0)
  const [openAgent, setOpenAgent] = useState<string | null>('validation')

  const scroller = useRef<HTMLDivElement | null>(null)
  const recogniser = useRef<ListenHandle | null>(null)
  const amplitudes = useMicAmplitudes(listening)

  useEffect(() => {
    const timer = window.setInterval(
      () => setPlaceholderIndex((i) => (i + 1) % BAR_PLACEHOLDERS.length),
      4_000,
    )
    return () => window.clearInterval(timer)
  }, [])

  useEffect(() => {
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns, pendingConfirm])

  useEffect(() => () => recogniser.current?.stop(), [])

  const stopMic = (): void => {
    recogniser.current?.stop()
    recogniser.current = null
    setInterim('')
    stopListening()
  }

  const toggleMic = (): void => {
    if (listening) {
      stopMic()
      return
    }
    const handle = beginListening({
      onInterim: setInterim,
      onFinal: (text) => {
        setInterim('')
        stopMic()
        void sendCommand(text, 'voice')
      },
      onError: stopMic,
      onEnd: stopMic,
    })
    if (!handle) return
    recogniser.current = handle
    startListening()
  }

  const submit = (text: string): void => {
    const utterance = text.trim()
    if (utterance.length === 0) return
    setValue('')
    void sendCommand(utterance, listening ? 'voice' : 'text')
  }

  /** History grouped by day, with the count of tools each conversation ran. */
  const history = useMemo(() => {
    const groups = new Map<string, Array<{ id: string; title: string; tools: number; at: string }>>()
    const operatorTurns = turns.filter((t) => t.speaker === 'operator')
    for (const turn of operatorTurns) {
      const day = new Date(turn.created_at).toLocaleDateString('en-GB', {
        weekday: 'long',
        day: 'numeric',
        month: 'short',
      })
      const response = turns.find((t) => t.seq === turn.seq + 1 && t.speaker === 'assistant')
      groups.set(day, [
        ...(groups.get(day) ?? []),
        {
          id: turn.id,
          title: turn.utterance,
          tools: response?.plan?.steps.length ?? 0,
          at: turn.created_at,
        },
      ])
    }
    return [...groups.entries()]
  }, [turns])

  const openQueue = reviewQueue.filter((q) => !q.resolved).length
  const awaitingLeadership = ideas.filter((i) => i.status === 'pending_leadership').length
  const running = agents.filter((a) => a.status === 'running').length

  return (
    <>
      <PageHeader
        title="Command Console"
        subtitle="Ask for anything the twelve agents can do. I will show you the plan before I run it."
        actions={
          <Badge tone={apiMode === 'connected' ? 'good' : 'warn'}>
            {apiMode === 'connected'
              ? assistantProvider === 'gcp'
                ? 'Gemini'
                : 'Deterministic'
              : 'Standalone — local demo data'}
          </Badge>
        }
      />

      <div className="grid gap-4 xl:grid-cols-[300px_1fr_340px]">
        {/* ── Left rail ─────────────────────────────────────────────────── */}
        <aside className="space-y-3">
          <section className="card max-h-[38vh] overflow-y-auto p-3">
            <h3 className="display mb-2 text-[13px]">Conversations</h3>
            {history.length === 0 ? (
              <p className="text-[11.5px] text-ink-3">Nothing yet.</p>
            ) : (
              history.map(([day, entries]) => (
                <div key={day} className="mb-3">
                  <p className="text-[10px] uppercase tracking-[0.09em] text-ink-3">{day}</p>
                  <ul className="mt-1 space-y-1">
                    {entries.map((entry) => (
                      <li key={entry.id}>
                        <button
                          type="button"
                          onClick={() => submit(entry.title)}
                          className="w-full rounded-lg px-2 py-1.5 text-left transition-colors hover:bg-surface-2"
                        >
                          <span className="block truncate text-[11.5px] text-ink-2">{entry.title}</span>
                          <span className="tabular block text-[10px] text-ink-3">
                            {entry.tools} tool{entry.tools === 1 ? '' : 's'} · {timeAgo(entry.at)}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                </div>
              ))
            )}
            {conversation ? (
              <p className="mt-1 text-[10px] text-ink-3">
                Session started {timeAgo(conversation.started_at)} · {conversation.actor}
              </p>
            ) : null}
          </section>

          <section className="card max-h-[46vh] overflow-y-auto p-3">
            <h3 className="display mb-2 text-[13px]">Capabilities</h3>
            <p className="mb-2 text-[10.5px] leading-relaxed text-ink-3">
              {TOOLS.length} tools, grouped by the agent that does the work. Click an example to run it.
            </p>

            {Object.entries(TOOLS_BY_AGENT).map(([agentId, tools]) => {
              const expanded = openAgent === agentId
              return (
                <div key={agentId} className="border-b border-line/60 last:border-0">
                  <button
                    type="button"
                    onClick={() => setOpenAgent(expanded ? null : agentId)}
                    aria-expanded={expanded}
                    className="flex w-full items-center gap-2 py-1.5 text-left"
                  >
                    <ChevronDown
                      size={12}
                      className="shrink-0 text-ink-3 transition-transform duration-[var(--dur-fast)]"
                      style={{ transform: expanded ? undefined : 'rotate(-90deg)' }}
                      aria-hidden="true"
                    />
                    <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-ink-2">
                      {AGENT_BY_ID[agentId as AgentId]?.name ?? agentId}
                    </span>
                    <span className="tabular text-[10px] text-ink-3">{tools.length}</span>
                  </button>

                  {expanded ? (
                    <ul className="anim-fade-in space-y-1.5 pb-2 pl-5">
                      {tools.map((tool) => (
                        <li key={tool.id}>
                          <div className="flex flex-wrap items-center gap-1.5">
                            <span className="text-[11px] font-medium text-ink-2">{tool.name}</span>
                            <RiskPill risk={tool.risk} />
                          </div>
                          <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{tool.summary}</p>
                          {tool.examples[0] ? (
                            <button
                              type="button"
                              onClick={() => submit(tool.examples[0] as string)}
                              className="mt-0.5 text-left text-[10.5px] text-accent-bright transition-colors hover:text-accent"
                            >
                              “{tool.examples[0]}”
                            </button>
                          ) : null}
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </div>
              )
            })}
          </section>
        </aside>

        {/* ── Centre ────────────────────────────────────────────────────── */}
        <section className="card flex h-[74vh] flex-col overflow-hidden">
          <div ref={scroller} className="flex-1 overflow-y-auto px-4 py-4">
            <div className="mx-auto max-w-[820px] space-y-4">
              {turns.length === 0 ? (
                <div className="flex flex-col items-center gap-3 py-12 text-center">
                  <AssistantCore state="dormant" size={72} />
                  <p className="max-w-md text-[12.5px] leading-relaxed text-ink-3">
                    Ask for anything the twelve agents can do. I will show you the plan before I run it,
                    and stop for your confirmation before anything irreversible.
                  </p>
                  <div className="flex flex-wrap justify-center gap-1.5">
                    {BAR_PLACEHOLDERS.slice(0, 4).map((example) => (
                      <button
                        key={example}
                        type="button"
                        onClick={() => submit(example)}
                        className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                      >
                        {example}
                      </button>
                    ))}
                  </div>
                </div>
              ) : null}

              {turns.map((turn) =>
                turn.speaker === 'operator' ? (
                  <div key={turn.id} className="anim-fade-up flex justify-end">
                    <div className="max-w-[80%] rounded-xl rounded-br-sm border border-accent/35 bg-accent/10 px-3.5 py-2.5">
                      <p className="text-[13px] leading-relaxed text-ink">{turn.utterance}</p>
                      <p className="mono mt-1 text-right text-[10px] text-ink-3">
                        {turn.channel === 'voice' ? 'voice · ' : ''}
                        {timeAgo(turn.created_at)}
                      </p>
                    </div>
                  </div>
                ) : (
                  <div key={turn.id} className="anim-fade-up flex gap-3">
                    <AssistantCore
                      state={turn.status === 'running' ? 'working' : 'dormant'}
                      size={26}
                      className="mt-0.5 shrink-0"
                    />
                    <div className="min-w-0 flex-1 space-y-2.5">
                      {turn.plan ? (
                        <PlanCard plan={turn.plan} greyed={turn.status === 'awaiting_confirmation'} />
                      ) : null}

                      {turn.narration ? (
                        <p
                          className={`whitespace-pre-wrap text-[13px] leading-relaxed text-ink-2 ${
                            streaming && turn.status === 'running' ? 'assistant-caret' : ''
                          }`}
                        >
                          {turn.narration}
                        </p>
                      ) : turn.status === 'planning' ? (
                        <p className="text-[13px] text-ink-3">Working.</p>
                      ) : null}
                    </div>
                  </div>
                ),
              )}

              {pendingConfirm ? <ConfirmCard confirm={pendingConfirm} onDecision={confirmPlan} /> : null}
            </div>
          </div>

          {/* ── Composer ────────────────────────────────────────────── */}
          <form
            onSubmit={(event) => {
              event.preventDefault()
              submit(value)
            }}
            className="border-t border-line p-3"
          >
            <div className="mx-auto flex max-w-[820px] items-center gap-2">
              <AssistantCore state={coreState} size={30} amplitudes={amplitudes} />

              <div className="relative flex-1">
                {listening && interim.length === 0 ? (
                  <Waveform amplitudes={amplitudes} bars={44} height={22} />
                ) : (
                  <input
                    value={interim.length > 0 ? interim : value}
                    onChange={(event) => setValue(event.target.value)}
                    placeholder={BAR_PLACEHOLDERS[placeholderIndex]}
                    aria-label="Ask Ethara"
                    className={`w-full rounded-lg border border-line bg-surface-2 px-3 py-2.5 text-[13px] outline-none focus:border-accent ${
                      interim.length > 0 ? 'text-ink-3' : 'text-ink'
                    }`}
                  />
                )}
              </div>

              {voiceSupport.input ? (
                <button
                  type="button"
                  onClick={toggleMic}
                  aria-label={listening ? 'Stop listening' : 'Start listening'}
                  className={`rounded-lg border p-2 transition-colors duration-[var(--dur-fast)] ${
                    listening
                      ? 'border-magenta text-magenta-ink'
                      : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
                  }`}
                >
                  {listening ? <MicOff size={15} /> : <Mic size={15} />}
                </button>
              ) : null}

              <Btn type="submit" variant="primary" disabled={value.trim().length === 0 && !listening}>
                <Send size={14} />
              </Btn>
            </div>
          </form>
        </section>

        {/* ── Right rail ────────────────────────────────────────────────── */}
        <aside className="space-y-3">
          <section className="card p-3">
            <h3 className="display mb-2 text-[13px]">Situational awareness</h3>
            <div className="grid grid-cols-2 gap-1.5">
              <Metric label="Agents online" value={`${agents.length - running}/${agents.length}`} />
              <Metric
                label="Pipeline"
                value={(pipeline?.status ?? 'idle').replace(/^\w/, (c) => c.toUpperCase())}
              />
              <Metric label="Review queue" value={openQueue} tone={openQueue > 0 ? 'warn' : undefined} />
              <Metric
                label="With Leadership"
                value={awaitingLeadership}
                tone={awaitingLeadership > 0 ? 'serious' : undefined}
              />
              <Metric label="KB entries" value={knowledge.filter((k) => k.active).length} />
              <Metric label="Mode" value={apiMode === 'connected' ? publishMode : 'standalone'} />
            </div>
          </section>

          <section className="card p-3">
            <div className="flex items-center justify-between gap-2">
              <h3 className="display text-[13px]">Last brief</h3>
              <Btn variant="ghost" onClick={() => void runBrief()}>
                <Sparkles size={12} /> Run now
              </Btn>
            </div>

            {brief ? (
              <>
                <ul className="mt-2 space-y-1.5">
                  {brief.signals.map((signal) => (
                    <li key={signal.label} className="text-[11px] leading-relaxed text-ink-3">
                      <span className="text-ink-2">{signal.label}:</span> {signal.detail}
                    </li>
                  ))}
                </ul>
                {brief.recommendation ? (
                  <p className="mt-2 rounded-lg border border-accent/40 bg-accent/8 px-2.5 py-2 text-[11.5px] leading-relaxed text-ink">
                    {brief.recommendation}
                  </p>
                ) : null}
                <p className="mt-1.5 text-[10px] text-ink-3">Composed {timeAgo(brief.created_at)}</p>
              </>
            ) : (
              <p className="mt-2 text-[11.5px] text-ink-3">No briefing yet today.</p>
            )}
          </section>

          <section className="card p-3">
            <h3 className="display mb-2 text-[13px]">Ambient notices</h3>
            {notices.length === 0 ? (
              <p className="text-[11.5px] text-ink-3">Nothing worth interrupting you for.</p>
            ) : (
              <ul className="space-y-2">
                {notices.map((notice) => (
                  <li key={notice.id} className="anim-assistant-notice-in border-l-2 border-serious pl-2.5">
                    <p className="text-[11px] leading-relaxed text-ink-2">{notice.message}</p>
                    <div className="mt-1 flex items-center gap-2">
                      {notice.action ? (
                        <button
                          type="button"
                          onClick={() => {
                            dismissNotice(notice.id)
                            submit(notice.action?.utterance ?? '')
                          }}
                          className="text-[11px] text-accent-bright underline decoration-line-strong underline-offset-2"
                        >
                          {notice.action.label}
                        </button>
                      ) : null}
                      <button
                        type="button"
                        onClick={() => dismissNotice(notice.id)}
                        className="text-[11px] text-ink-3 transition-colors hover:text-ink-2"
                      >
                        Dismiss
                      </button>
                      <span className="ml-auto text-[10px] text-ink-3">{timeAgo(notice.at)}</span>
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </aside>
      </div>
    </>
  )
}

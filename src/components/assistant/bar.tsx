/**
 * THE COMMAND BAR — ⌘K / Ctrl-K from anywhere, hold-Space for push-to-talk.
 *
 * The agent sits in the bar: its mark beside the field, five things it can do
 * for this screen ranked underneath, a cost note on each, and — under the
 * highlighted one — the plan in one line, so Enter is never a guess. A typed
 * query is matched by the grammar instead, and shown the same way. Nothing
 * runs until Enter.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, CornerDownLeft, History } from 'lucide-react'
import { BAR_PLACEHOLDERS } from '@shared/assistant-persona'
import { useStore } from '../../store'
import { AssistantCore } from './core'
import { useMicAmplitudes, Waveform } from './waveform'
import { startListening as beginListening, voiceSupport, type ListenHandle } from '../../lib/voice'
import { describeUtterance, screenSuggestions, type BarSuggestion, type BarKind } from '../../lib/bar-suggestions'
import { timeAgo } from '../ui'

const KIND_TONE: Record<BarKind, string> = {
  ask: 'text-ink-3',
  do: 'text-accent-bright',
  gate: 'text-serious',
  open: 'text-ink-3',
}

export function AssistantBar() {
  const barOpen = useStore((s) => s.assistant.barOpen)
  const prefill = useStore((s) => s.assistant.prefill)
  const coreState = useStore((s) => s.assistant.coreState)
  const listening = useStore((s) => s.assistant.listening)
  const fetched = useStore((s) => s.assistant.suggestions)
  const turns = useStore((s) => s.assistant.turns)
  const closeBar = useStore((s) => s.closeBar)
  const sendCommand = useStore((s) => s.sendCommand)
  const fetchSuggestions = useStore((s) => s.fetchSuggestions)
  const startListening = useStore((s) => s.startListening)
  const stopListening = useStore((s) => s.stopListening)
  const setPage = useStore((s) => s.setPage)
  const openReview = useStore((s) => s.openReview)
  const openTheater = useStore((s) => s.openTheater)

  // What this screen is, and what the answers draw on. All from state.
  const page = useStore((s) => s.page)
  const ideas = useStore((s) => s.ideas)
  const keywords = useStore((s) => s.keywords)
  const topPerPlatform = useStore((s) => s.settings.topPerPlatform)
  const confirmMutating = useStore((s) => s.settings.assistantConfirmMutating)
  const reviewIdeaId = useStore((s) => s.reviewIdeaId)
  const knowledgeActive = useStore((s) => s.knowledge.filter((k) => k.active).length)
  const runStartedAt = useStore((s) => s.scrapeRun.startedAt ?? null)
  const runEndedAt = useStore((s) => s.scrapeRun.endedAt ?? null)
  const lastRunAt = useStore((s) => s.agents.find((a) => a.agent_id === 'scraping')?.last_run ?? null)
  const apiMode = useStore((s) => s.apiMode)

  const [value, setValue] = useState('')
  const [interim, setInterim] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [placeholderIndex, setPlaceholderIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const recogniser = useRef<ListenHandle | null>(null)
  const amplitudes = useMicAmplitudes(listening)

  const ctx = useMemo(
    () => ({
      page,
      ideas,
      keywords,
      topPerPlatform,
      confirmMutating,
      reviewIdeaId,
      lastRunSeconds: runStartedAt !== null && runEndedAt !== null ? Math.round((runEndedAt - runStartedAt) / 1000) : null,
    }),
    [page, ideas, keywords, topPerPlatform, confirmMutating, reviewIdeaId, runStartedAt, runEndedAt],
  )

  /**
   * With nothing typed: five things for this screen. With a query: what the
   * grammar matched (server first, local fallback), described the same way.
   */
  const suggestions = useMemo((): BarSuggestion[] => {
    if (value.trim().length === 0) return screenSuggestions(ctx)
    return fetched.slice(0, 5).map((s) => {
      const label = s.example ?? s.name
      return { id: s.toolId, label, ...describeUtterance(label, ctx) }
    })
  }, [value, fetched, ctx])

  /** The plan for whatever Enter would send right now. */
  const preview = useMemo(() => {
    if (highlighted > 0) return suggestions[highlighted - 1] ?? null
    if (value.trim().length === 0) return null
    return { id: 'typed', label: value.trim(), ...describeUtterance(value, ctx) } as BarSuggestion
  }, [highlighted, suggestions, value, ctx])

  /** The last four operator utterances, re-runnable in one click. */
  const recents = useMemo(
    () =>
      [...turns]
        .reverse()
        .filter((t) => t.speaker === 'operator' && t.utterance.trim().length > 0)
        .slice(0, 4),
    [turns],
  )

  useEffect(() => {
    if (!barOpen) {
      setValue('')
      setInterim('')
      setHighlighted(0)
      return
    }
    setValue(prefill)
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [barOpen, prefill])

  useEffect(() => {
    if (!barOpen) return
    const timer = window.setInterval(() => setPlaceholderIndex((i) => (i + 1) % BAR_PLACEHOLDERS.length), 4_000)
    return () => window.clearInterval(timer)
  }, [barOpen])

  // Live grammar matches, debounced so typing does not thrash the endpoint.
  useEffect(() => {
    if (!barOpen) return
    const timer = window.setTimeout(() => void fetchSuggestions(value), 140)
    return () => window.clearTimeout(timer)
  }, [value, barOpen, fetchSuggestions])

  useEffect(() => setHighlighted(0), [suggestions.length, value])

  const stopMic = (): void => {
    recogniser.current?.stop()
    recogniser.current = null
    setInterim('')
    stopListening()
  }

  const focus = useMemo(() => {
    const idea = reviewIdeaId ? ideas.find((i) => i.id === reviewIdeaId) : undefined
    return idea ? { type: 'idea', id: idea.id, title: idea.title, platform: idea.platform } : undefined
  }, [reviewIdeaId, ideas])

  /** Runs the chosen thing: opens a screen, or sends the utterance as written. */
  const run = (suggestion: BarSuggestion | null, text: string, channel: 'text' | 'voice'): void => {
    if (suggestion?.kind === 'open' && suggestion.nav) {
      closeBar()
      if (suggestion.nav.reviewId) openReview(suggestion.nav.reviewId)
      else if (suggestion.nav.theater) openTheater()
      else if (suggestion.nav.page) setPage(suggestion.nav.page)
      return
    }
    const utterance = (suggestion?.label ?? text).trim()
    if (utterance.length === 0) return
    // The post in focus travels with the words, so "this" needs no follow-up.
    void sendCommand(utterance, channel, focus)
  }

  const toggleMic = (): void => {
    if (listening) {
      stopMic()
      return
    }
    const handle = beginListening({
      onInterim: (text) => setInterim(text),
      onFinal: (text) => {
        setInterim('')
        setValue(text)
        stopMic()
        run(null, text, 'voice')
      },
      onError: () => stopMic(),
      onEnd: () => stopMic(),
    })
    if (!handle) return
    recogniser.current = handle
    startListening()
  }

  useEffect(() => () => recogniser.current?.stop(), [])

  if (!barOpen) return null

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[13vh]">
      <div className="absolute inset-0 bg-page/60 backdrop-blur-sm" onClick={closeBar} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ethara command bar"
        className="anim-assistant-bar-rise relative z-10 w-full max-w-[880px] overflow-hidden rounded-[14px] border border-line-strong bg-surface shadow-2xl"
      >
        {/* ── the field, with the agent beside it ────────────────────── */}
        <div className="flex items-center gap-3 px-4 py-3">
          <AssistantCore state={coreState} size={30} amplitudes={amplitudes} />

          <div className="relative min-w-0 flex-1">
            {listening && interim.length === 0 ? (
              <Waveform amplitudes={amplitudes} bars={38} height={20} />
            ) : (
              <input
                ref={inputRef}
                value={interim.length > 0 ? interim : value}
                onChange={(event) => setValue(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Escape') {
                    stopMic()
                    closeBar()
                  }
                  if (event.key === 'ArrowDown') {
                    event.preventDefault()
                    setHighlighted((i) => Math.min(suggestions.length, i + 1))
                  }
                  if (event.key === 'ArrowUp') {
                    event.preventDefault()
                    setHighlighted((i) => Math.max(0, i - 1))
                  }
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    run(highlighted > 0 ? (suggestions[highlighted - 1] ?? null) : null, value, listening ? 'voice' : 'text')
                  }
                }}
                placeholder={BAR_PLACEHOLDERS[placeholderIndex]}
                aria-label="Ask Ethara"
                aria-autocomplete="list"
                aria-controls="ethara-bar-suggestions"
                className={`w-full rounded-[9px] border bg-surface px-3 py-2 text-[14px] outline-none transition-colors ${
                  interim.length > 0 ? 'text-ink-3' : 'text-ink'
                } border-line-strong placeholder:text-ink-3 focus:border-accent`}
              />
            )}
          </div>

          {voiceSupport.input ? (
            <button
              type="button"
              onClick={toggleMic}
              aria-label={listening ? 'Stop listening' : 'Start listening'}
              className={`rounded-md border p-2 transition-colors duration-[var(--dur-fast)] ${
                listening ? 'border-serious text-serious' : 'border-line-strong text-ink-3 hover:border-accent hover:text-ink'
              }`}
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => run(highlighted > 0 ? (suggestions[highlighted - 1] ?? null) : null, value, 'text')}
            aria-label="Send"
            className="rounded-md border border-line-strong p-2 text-ink-3 transition-colors hover:border-accent hover:text-ink"
          >
            <CornerDownLeft size={15} />
          </button>
        </div>

        {/* ── five things, ranked for this screen ───────────────────── */}
        {suggestions.length > 0 ? (
          <div id="ethara-bar-suggestions" role="listbox" aria-label="Suggestions" className="border-t border-line">
            {suggestions.map((suggestion, i) => {
              const active = highlighted === i + 1
              return (
                <div key={suggestion.id} role="option" aria-selected={active}>
                  <button
                    type="button"
                    onMouseEnter={() => setHighlighted(i + 1)}
                    onClick={() => run(suggestion, suggestion.label, 'text')}
                    className={`flex w-full items-center gap-3 px-4 py-[9px] text-left transition-colors duration-[var(--dur-fast)] ${
                      active ? 'bg-accent/10' : 'hover:bg-surface-2'
                    }`}
                  >
                    <span className={`min-w-0 flex-1 truncate text-[12.5px] ${active ? 'text-ink' : 'text-ink-2'}`}>
                      {suggestion.label.charAt(0).toUpperCase() + suggestion.label.slice(1)}
                    </span>
                    <span className={`mono shrink-0 text-[9.5px] tracking-[0.1em] ${KIND_TONE[suggestion.kind]}`}>{suggestion.note}</span>
                    {active ? <CornerDownLeft size={12} className="shrink-0 text-ink-3" aria-hidden="true" /> : null}
                  </button>
                  {/* The plan, under the highlighted row, before anything runs. */}
                  {active && suggestion.plan ? (
                    <p
                      className="flex items-start gap-2 bg-accent/10 px-4 pb-2.5 text-[11.5px] leading-relaxed text-ink-2"
                      style={{ animation: 'eth-rise 220ms cubic-bezier(0.22, 1, 0.36, 1) both' }}
                    >
                      <span className="mono mt-[3px] shrink-0 text-[9px] tracking-[0.12em] text-ink-3">↩ PLAN</span>
                      <span className="min-w-0 flex-1">{suggestion.plan}</span>
                    </p>
                  ) : null}
                </div>
              )
            })}
          </div>
        ) : null}

        {/* A typed query with nothing highlighted still shows what Enter will do. */}
        {highlighted === 0 && preview ? (
          <p className="flex items-start gap-2 border-t border-line px-4 py-2.5 text-[11.5px] leading-relaxed text-ink-2">
            <span className="mono mt-[3px] shrink-0 text-[9px] tracking-[0.12em] text-ink-3">↩ PLAN</span>
            <span className="min-w-0 flex-1">{preview.plan}</span>
            <span className={`mono shrink-0 text-[9.5px] tracking-[0.1em] ${KIND_TONE[preview.kind]}`}>{preview.note}</span>
          </p>
        ) : null}

        {recents.length > 0 && value.trim().length === 0 ? (
          <div className="flex items-center gap-2 overflow-x-auto border-t border-line px-4 py-2">
            <History size={12} className="shrink-0 text-ink-3" aria-hidden="true" />
            <span className="mono shrink-0 text-[9px] tracking-[0.12em] text-ink-3">RECENT</span>
            {recents.map((turn) => (
              <button
                key={turn.id}
                type="button"
                onClick={() => run(null, turn.utterance, 'text')}
                className="shrink-0 rounded-full border border-line-strong px-2.5 py-[3px] text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-ink"
              >
                {turn.utterance.length > 46 ? `${turn.utterance.slice(0, 46)}…` : turn.utterance}
              </button>
            ))}
          </div>
        ) : null}

        {/* ── what the answers draw on, and the keys ────────────────── */}
        <div className="mono flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line px-4 py-1.5 text-[9.5px] uppercase tracking-[0.1em] text-ink-3">
          <span>↑↓ select · ↩ send · esc close</span>
          <span className="ml-auto flex items-center gap-x-3">
            <span title="Every answer is grounded in what the system holds: the Knowledge Base, the calendar and the run record.">
              grounded in · kb {knowledgeActive} · {ideas.length} posts · last run {lastRunAt ? timeAgo(lastRunAt) : 'none'}
              {apiMode === 'standalone' ? ' · standalone' : ''}
            </span>
            {voiceSupport.input ? <span>hold space to talk</span> : null}
          </span>
        </div>
      </div>
    </div>
  )
}

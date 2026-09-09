/**
 * THE COMMAND BAR — ⌘K / Ctrl-K from anywhere, hold-Space for push-to-talk.
 *
 * A centred glass panel that rises 12px with a blurred backdrop, carrying the
 * core mark, one input, a mic, live tool suggestions with risk pills, and the
 * last four commands.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Mic, MicOff, CornerDownLeft, History } from 'lucide-react'
import { BAR_PLACEHOLDERS } from '@shared/assistant-persona'
import { useStore } from '../../store'
import { RiskPill } from '../ui'
import { AssistantCore } from './core'
import { useMicAmplitudes, Waveform } from './waveform'
import { startListening as beginListening, voiceSupport, type ListenHandle } from '../../lib/voice'

export function AssistantBar() {
  const barOpen = useStore((s) => s.assistant.barOpen)
  const prefill = useStore((s) => s.assistant.prefill)
  const coreState = useStore((s) => s.assistant.coreState)
  const listening = useStore((s) => s.assistant.listening)
  const suggestions = useStore((s) => s.assistant.suggestions)
  const turns = useStore((s) => s.assistant.turns)
  const closeBar = useStore((s) => s.closeBar)
  const sendCommand = useStore((s) => s.sendCommand)
  const fetchSuggestions = useStore((s) => s.fetchSuggestions)
  const startListening = useStore((s) => s.startListening)
  const stopListening = useStore((s) => s.stopListening)

  const [value, setValue] = useState('')
  const [interim, setInterim] = useState('')
  const [highlighted, setHighlighted] = useState(0)
  const [placeholderIndex, setPlaceholderIndex] = useState(0)

  const inputRef = useRef<HTMLInputElement | null>(null)
  const recogniser = useRef<ListenHandle | null>(null)
  const amplitudes = useMicAmplitudes(listening)

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
    // Focus after the rise animation has begun, so the caret does not jump.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 40)
    return () => window.clearTimeout(timer)
  }, [barOpen, prefill])

  // The placeholder cycles every 4s through real examples from the registry.
  useEffect(() => {
    if (!barOpen) return
    const timer = window.setInterval(
      () => setPlaceholderIndex((i) => (i + 1) % BAR_PLACEHOLDERS.length),
      4_000,
    )
    return () => window.clearInterval(timer)
  }, [barOpen])

  // Live suggestions, debounced so typing does not thrash the endpoint.
  useEffect(() => {
    if (!barOpen) return
    const timer = window.setTimeout(() => void fetchSuggestions(value), 140)
    return () => window.clearTimeout(timer)
  }, [value, barOpen, fetchSuggestions])

  useEffect(() => setHighlighted(0), [suggestions.length])

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
      onInterim: (text) => setInterim(text),
      onFinal: (text) => {
        setInterim('')
        setValue(text)
        stopMic()
        void sendCommand(text, 'voice')
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

  const submit = (text: string): void => {
    const utterance = text.trim()
    if (utterance.length === 0) return
    void sendCommand(utterance, listening ? 'voice' : 'text')
  }

  return (
    <div className="fixed inset-0 z-[80] flex items-start justify-center pt-[14vh]">
      <div className="absolute inset-0 bg-page/60 backdrop-blur-sm" onClick={closeBar} aria-hidden="true" />

      <div
        role="dialog"
        aria-modal="true"
        aria-label="Ethara command bar"
        className="anim-assistant-bar-rise glass relative z-10 w-full max-w-[720px] overflow-hidden rounded-2xl shadow-2xl"
      >
        <div className="flex items-center gap-3 px-4 py-3">
          <AssistantCore state={coreState} size={28} amplitudes={amplitudes} />

          <div className="relative flex-1">
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
                    const chosen = highlighted > 0 ? suggestions[highlighted - 1] : null
                    submit(chosen?.example ?? value)
                  }
                }}
                placeholder={BAR_PLACEHOLDERS[placeholderIndex]}
                aria-label="Ask Ethara"
                className={`w-full bg-transparent text-[14px] outline-none placeholder:text-ink-3 ${
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
              className={`rounded-lg border p-1.5 transition-colors duration-[var(--dur-fast)] ${
                listening
                  ? 'border-magenta text-magenta-ink'
                  : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
              }`}
            >
              {listening ? <MicOff size={15} /> : <Mic size={15} />}
            </button>
          ) : null}

          <button
            type="button"
            onClick={() => submit(value)}
            aria-label="Send"
            className="rounded-lg border border-line p-1.5 text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
          >
            <CornerDownLeft size={15} />
          </button>
        </div>

        {suggestions.length > 0 ? (
          <div className="border-t border-line">
            {suggestions.map((suggestion, i) => {
              const active = highlighted === i + 1
              return (
                <button
                  key={suggestion.toolId}
                  type="button"
                  onMouseEnter={() => setHighlighted(i + 1)}
                  onClick={() => submit(suggestion.example ?? suggestion.name)}
                  className={`flex w-full items-start gap-3 px-4 py-2.5 text-left transition-colors duration-[var(--dur-fast)] ${
                    active ? 'bg-accent/10' : 'hover:bg-surface-2'
                  }`}
                >
                  <div className="min-w-0 flex-1">
                    <p className="text-[12px] font-medium text-ink">{suggestion.name}</p>
                    <p className="mt-0.5 line-clamp-1 text-[11px] text-ink-3">{suggestion.summary}</p>
                  </div>
                  <RiskPill risk={suggestion.risk} />
                </button>
              )
            })}
          </div>
        ) : null}

        {recents.length > 0 ? (
          <div className="flex items-center gap-2 overflow-x-auto border-t border-line px-4 py-2">
            <History size={12} className="shrink-0 text-ink-3" aria-hidden="true" />
            {recents.map((turn) => (
              <button
                key={turn.id}
                type="button"
                onClick={() => submit(turn.utterance)}
                className="shrink-0 rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-line-strong hover:text-ink-2"
              >
                {turn.utterance.length > 46 ? `${turn.utterance.slice(0, 46)}…` : turn.utterance}
              </button>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between border-t border-line px-4 py-1.5 text-[10px] uppercase tracking-[0.09em] text-ink-3">
          <span>↑↓ select · ⏎ send · Esc close</span>
          {voiceSupport.input ? <span>Hold Space to talk</span> : null}
        </div>
      </div>
    </div>
  )
}

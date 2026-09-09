/**
 * VOICE — Web Speech API only, and entirely optional.
 *
 * Every feature here is feature-detected. Where the API is absent the mic
 * button is not rendered and nothing in the UI references speech: the product
 * is complete without it (§6.10).
 */

import { spokenSummary } from '@shared/assistant-persona'

/* ═══════════════════════════════════════════════════════════════════════════
   THE VENDOR SURFACE
   These interfaces exist because `SpeechRecognition` is not in lib.dom.
   ═══════════════════════════════════════════════════════════════════════════ */

interface SpeechRecognitionAlternative {
  transcript: string
  confidence: number
}

interface SpeechRecognitionResult {
  readonly length: number
  isFinal: boolean
  [index: number]: SpeechRecognitionAlternative
}

interface SpeechRecognitionResultList {
  readonly length: number
  [index: number]: SpeechRecognitionResult
}

interface SpeechRecognitionEventLike extends Event {
  resultIndex: number
  results: SpeechRecognitionResultList
}

interface SpeechRecognitionErrorEventLike extends Event {
  error: string
}

interface SpeechRecognitionLike extends EventTarget {
  continuous: boolean
  interimResults: boolean
  lang: string
  maxAlternatives: number
  start(): void
  stop(): void
  abort(): void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: ((event: SpeechRecognitionErrorEventLike) => void) | null
  onend: (() => void) | null
  onstart: (() => void) | null
}

type SpeechRecognitionCtor = new () => SpeechRecognitionLike

interface SpeechWindow {
  SpeechRecognition?: SpeechRecognitionCtor
  webkitSpeechRecognition?: SpeechRecognitionCtor
}

function recognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as SpeechWindow
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAPABILITY
   ═══════════════════════════════════════════════════════════════════════════ */

export const voiceSupport = {
  /** `SpeechRecognition` for input. */
  get input(): boolean {
    return recognitionCtor() !== null
  },
  /** `speechSynthesis` for output. */
  get output(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window
  },
  /** Microphone access, needed for the waveform's `AnalyserNode`. */
  get analyser(): boolean {
    return (
      typeof navigator !== 'undefined' &&
      typeof navigator.mediaDevices?.getUserMedia === 'function' &&
      typeof window !== 'undefined' &&
      'AudioContext' in window
    )
  },
  get any(): boolean {
    return this.input || this.output
  },
}

/* ═══════════════════════════════════════════════════════════════════════════
   INPUT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ListenHandlers {
  onInterim: (text: string) => void
  onFinal: (text: string) => void
  onError?: (reason: string) => void
  onEnd?: () => void
}

export interface ListenHandle {
  stop: () => void
}

/**
 * Starts a single-utterance recogniser. `en-IN` first, falling back to `en-GB`
 * when the browser rejects the locale.
 */
export function startListening(handlers: ListenHandlers): ListenHandle | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null

  let recognition: SpeechRecognitionLike
  try {
    recognition = new Ctor()
  } catch {
    return null
  }

  recognition.continuous = false
  recognition.interimResults = true
  recognition.maxAlternatives = 1
  recognition.lang = 'en-IN'

  recognition.onresult = (event) => {
    let interim = ''
    for (let i = event.resultIndex; i < event.results.length; i += 1) {
      const result = event.results[i]
      if (!result) continue
      const text = result[0]?.transcript ?? ''
      if (result.isFinal) {
        handlers.onFinal(text.trim())
      } else {
        interim += text
      }
    }
    if (interim.length > 0) handlers.onInterim(interim.trim())
  }

  recognition.onerror = (event) => {
    if (event.error === 'language-not-supported') {
      recognition.lang = 'en-GB'
      try {
        recognition.start()
        return
      } catch {
        // Falls through to the error report below.
      }
    }
    handlers.onError?.(
      event.error === 'not-allowed'
        ? 'Microphone access was refused by the browser.'
        : `Speech recognition stopped: ${event.error}.`,
    )
  }

  recognition.onend = () => handlers.onEnd?.()

  try {
    recognition.start()
  } catch {
    return null
  }

  return {
    stop: () => {
      try {
        recognition.stop()
      } catch {
        // Already stopped.
      }
    },
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE WAKE PHRASE — off by default, enabled in Settings
   ═══════════════════════════════════════════════════════════════════════════ */

export const WAKE_PHRASE = (
  (import.meta.env.VITE_ASSISTANT_WAKE_PHRASE as string | undefined) ?? 'assistant'
).toLowerCase()

/**
 * A low-cost continuous recogniser that listens only for the wake phrase and
 * then calls `onWake`. Restarts itself when the browser ends the session.
 */
export function startWakeListener(onWake: () => void): ListenHandle | null {
  const Ctor = recognitionCtor()
  if (!Ctor) return null

  let stopped = false
  let recognition: SpeechRecognitionLike | null = null

  const begin = (): void => {
    if (stopped) return
    try {
      recognition = new Ctor()
    } catch {
      return
    }
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-IN'

    recognition.onresult = (event) => {
      for (let i = event.resultIndex; i < event.results.length; i += 1) {
        const text = (event.results[i]?.[0]?.transcript ?? '').toLowerCase()
        if (text.includes(WAKE_PHRASE)) {
          onWake()
          return
        }
      }
    }
    recognition.onerror = () => {}
    recognition.onend = () => {
      if (!stopped) window.setTimeout(begin, 400)
    }

    try {
      recognition.start()
    } catch {
      // The browser refused; the next restart attempt will retry.
    }
  }

  begin()

  return {
    stop: () => {
      stopped = true
      try {
        recognition?.abort()
      } catch {
        // Already gone.
      }
    },
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   OUTPUT
   ═══════════════════════════════════════════════════════════════════════════ */

const VOICE_KEY = 'ethara-socialai-voice'

export function voiceEnabled(): boolean {
  if (typeof localStorage === 'undefined') return false
  const stored = localStorage.getItem(VOICE_KEY)
  if (stored !== null) return stored === 'on'
  return (import.meta.env.VITE_ASSISTANT_VOICE as string | undefined) !== 'false'
}

export function setVoiceEnabled(enabled: boolean): void {
  try {
    localStorage.setItem(VOICE_KEY, enabled ? 'on' : 'off')
  } catch {
    // Private mode. The choice simply does not persist.
  }
}

/** Prefers an `en-GB` voice, as the persona asks. */
function preferredVoice(): SpeechSynthesisVoice | null {
  if (!voiceSupport.output) return null
  const voices = window.speechSynthesis.getVoices()
  return (
    voices.find((v) => v.lang === 'en-GB' && /daniel|male|google/i.test(v.name)) ??
    voices.find((v) => v.lang === 'en-GB') ??
    voices.find((v) => v.lang.startsWith('en')) ??
    null
  )
}

export function listVoices(): SpeechSynthesisVoice[] {
  if (!voiceSupport.output) return []
  return window.speechSynthesis.getVoices().filter((v) => v.lang.startsWith('en'))
}

/**
 * Speaks the narration's summary sentence only — never tables, never code.
 * Silently does nothing when unsupported or muted.
 */
export function speak(text: string, options: { voiceURI?: string; onEnd?: () => void } = {}): void {
  if (!voiceSupport.output || !voiceEnabled()) {
    options.onEnd?.()
    return
  }

  const summary = spokenSummary(text)
  if (summary.length === 0) {
    options.onEnd?.()
    return
  }

  try {
    window.speechSynthesis.cancel()
    const utterance = new SpeechSynthesisUtterance(summary)
    const chosen = options.voiceURI
      ? (listVoices().find((v) => v.voiceURI === options.voiceURI) ?? preferredVoice())
      : preferredVoice()
    if (chosen) utterance.voice = chosen
    utterance.rate = 1.05
    utterance.pitch = 0.95
    utterance.onend = () => options.onEnd?.()
    utterance.onerror = () => options.onEnd?.()
    window.speechSynthesis.speak(utterance)
  } catch {
    options.onEnd?.()
  }
}

export function stopSpeaking(): void {
  if (!voiceSupport.output) return
  try {
    window.speechSynthesis.cancel()
  } catch {
    // Nothing was speaking.
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ANALYSER — what drives the waveform
   ═══════════════════════════════════════════════════════════════════════════ */

export interface MicAnalyser {
  /** 0–1 amplitudes, one per bar. */
  read: (bars: number) => number[]
  stop: () => void
}

/**
 * Opens the microphone and returns an amplitude reader for the waveform.
 * Returns `null` on refusal — the bar then falls back to its idle animation.
 */
export async function openMicAnalyser(): Promise<MicAnalyser | null> {
  if (!voiceSupport.analyser) return null

  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
    const context = new AudioContext()
    const source = context.createMediaStreamSource(stream)
    const analyser = context.createAnalyser()
    analyser.fftSize = 128
    analyser.smoothingTimeConstant = 0.72
    source.connect(analyser)

    const buffer = new Uint8Array(analyser.frequencyBinCount)

    return {
      read: (bars: number) => {
        analyser.getByteFrequencyData(buffer)
        const perBar = Math.max(1, Math.floor(buffer.length / bars))
        const out: number[] = []
        for (let i = 0; i < bars; i += 1) {
          let sum = 0
          for (let j = 0; j < perBar; j += 1) sum += buffer[i * perBar + j] ?? 0
          out.push(Math.min(1, sum / perBar / 190))
        }
        return out
      },
      stop: () => {
        for (const track of stream.getTracks()) track.stop()
        void context.close()
      },
    }
  } catch {
    return null
  }
}

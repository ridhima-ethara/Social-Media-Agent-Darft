/**
 * THE MIC WAVEFORM
 *
 * Bar heights are driven by an `AnalyserNode`, so it shows what the microphone
 * is actually hearing rather than a canned animation. When the mic is refused
 * or unsupported it falls back to a slow idle drift, and never pretends.
 */

import { useEffect, useRef, useState } from 'react'
import { openMicAnalyser, type MicAnalyser } from '../../lib/voice'

const IDLE = [0.18, 0.3, 0.22, 0.44, 0.28, 0.52, 0.34, 0.46, 0.24, 0.38, 0.2, 0.3]

export function useMicAmplitudes(active: boolean, bars = 24): number[] {
  const [amplitudes, setAmplitudes] = useState<number[]>(() => new Array(bars).fill(0))
  const analyser = useRef<MicAnalyser | null>(null)
  const frame = useRef(0)

  useEffect(() => {
    let cancelled = false

    if (!active) {
      analyser.current?.stop()
      analyser.current = null
      cancelAnimationFrame(frame.current)
      setAmplitudes(new Array(bars).fill(0))
      return
    }

    void openMicAnalyser().then((mic) => {
      if (cancelled || !mic) return
      analyser.current = mic
      const loop = (): void => {
        if (cancelled || !analyser.current) return
        setAmplitudes(analyser.current.read(bars))
        frame.current = requestAnimationFrame(loop)
      }
      frame.current = requestAnimationFrame(loop)
    })

    return () => {
      cancelled = true
      cancelAnimationFrame(frame.current)
      analyser.current?.stop()
      analyser.current = null
    }
  }, [active, bars])

  return amplitudes
}

export function Waveform({
  amplitudes,
  bars = 32,
  height = 22,
  className = '',
}: {
  amplitudes?: number[]
  bars?: number
  height?: number
  className?: string
}) {
  const live = amplitudes && amplitudes.some((a) => a > 0.01)

  return (
    <div className={`flex items-center gap-[3px] ${className}`} style={{ height }} aria-hidden="true">
      {Array.from({ length: bars }, (_, i) => {
        const value = live
          ? (amplitudes?.[i % (amplitudes.length || 1)] ?? 0)
          : (IDLE[i % IDLE.length] as number)
        const barHeight = Math.max(2, value * height)
        return (
          <span
            key={i}
            className="assistant-wave-bar w-[2px] rounded-full bg-magenta-ink"
            style={{
              height: `${barHeight}px`,
              opacity: live ? 0.5 + value * 0.5 : 0.42,
              // The idle drift is staggered so it reads as breathing, not blinking.
              animationDelay: live ? undefined : `${(i % 12) * 90}ms`,
            }}
          />
        )
      })}
    </div>
  )
}

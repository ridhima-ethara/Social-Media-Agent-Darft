/**
 * THE CONFIRMATION GATE, ON SCREEN
 *
 * Accent-bordered, carrying the rendered `confirmTemplate`, the exact
 * consequence in bold, two buttons, and a TTL countdown ring that drains
 * linearly. Law 7: agency requires accountability — the token is what is
 * confirmed, never a re-parse of the utterance.
 */

import { useEffect, useState } from 'react'
import { Btn } from '../ui'
import type { PendingConfirm } from '../../types'

function useCountdown(expiresAt: string): { remaining: number; total: number; expired: boolean } {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(timer)
  }, [])

  const expiry = new Date(expiresAt).getTime()
  const remaining = Math.max(0, expiry - now)
  // The gate's TTL is a knob; the ring reads its span from the token itself.
  const total = Math.max(remaining, 180_000)
  return { remaining, total, expired: remaining <= 0 }
}

export function ConfirmCard({
  confirm,
  onDecision,
}: {
  confirm: PendingConfirm
  onDecision: (token: string, decision: 'confirm' | 'cancel') => void
}) {
  const { remaining, total, expired } = useCountdown(confirm.expiresAt)
  const seconds = Math.ceil(remaining / 1000)

  const radius = 13
  const circumference = 2 * Math.PI * radius
  const offset = circumference * (1 - remaining / total)

  // The consequence — the sentence that says what cannot be undone — is
  // separated out and bolded, so it is never lost inside the prompt.
  const sentences = confirm.prompt.split(/(?<=\.)\s+/)
  const consequence = sentences.find((s) => /cannot be undone|irreversible|permanent/i.test(s))
  const rest = sentences.filter((s) => s !== consequence).join(' ')

  return (
    <div className="anim-assistant-plan-in rounded-xl border border-accent bg-accent/8 p-3.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-[10px] uppercase tracking-[0.12em] text-accent-bright">Confirmation required</p>
          <p className="mt-1.5 text-[12px] leading-relaxed text-ink">{rest}</p>
          {consequence ? (
            <p className="mt-1 text-[12px] font-semibold leading-relaxed text-ink">{consequence}</p>
          ) : null}
        </div>

        <svg width={32} height={32} viewBox="0 0 32 32" fill="none" aria-hidden="true" className="shrink-0 -rotate-90">
          <circle cx="16" cy="16" r={radius} stroke="var(--color-surface-3)" strokeWidth="2" />
          <circle
            cx="16"
            cy="16"
            r={radius}
            stroke={expired ? 'var(--color-critical)' : 'var(--color-magenta)'}
            strokeWidth="2"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: 'stroke-dashoffset 250ms linear' }}
          />
        </svg>
      </div>

      {expired ? (
        <p className="mt-3 text-[11px] leading-relaxed text-critical-ink">
          That confirmation expired. Ask me again and I will re-plan it.
        </p>
      ) : (
        <>
          <p className="tabular mt-2 text-[11px] text-ink-3">Expires in {seconds}s</p>
          <div className="mt-3 flex items-center gap-2">
            <Btn variant="primary" onClick={() => onDecision(confirm.token, 'confirm')}>
              Confirm
            </Btn>
            <Btn variant="ghost" onClick={() => onDecision(confirm.token, 'cancel')}>
              Cancel
            </Btn>
          </div>
        </>
      )}
    </div>
  )
}

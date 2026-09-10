/**
 * THE NARRATION RAIL — ⌥J
 *
 * A 360px right-hand rail docked *over* the page, never pushing content. It is
 * the transcript of the operator's session: their turns right-aligned, the command plane's
 * turns left with the core mark and token-by-token arrival, plan cards, confirm
 * cards, and ambient notices.
 */

import { useEffect, useRef } from 'react'
import { X, Bell } from 'lucide-react'
import { useStore } from '../../store'
import { Badge, Btn } from '../ui'
import { ConfirmCard } from './confirm-card'
import { Exchange } from './exchange'
import { voiceSupport } from '../../lib/voice'

export function AssistantRail() {
  const railOpen = useStore((s) => s.assistant.railOpen)
  const turns = useStore((s) => s.assistant.turns)
  const notices = useStore((s) => s.assistant.notices)
  const pendingConfirm = useStore((s) => s.assistant.pendingConfirm)
  const streaming = useStore((s) => s.assistant.streaming)
  const apiMode = useStore((s) => s.apiMode)
  const toggleRail = useStore((s) => s.toggleRail)
  const confirmPlan = useStore((s) => s.confirmPlan)
  const dismissNotice = useStore((s) => s.dismissNotice)
  const sendCommand = useStore((s) => s.sendCommand)
  const speak = useStore((s) => s.speak)

  const scroller = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!railOpen) return
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [turns, railOpen, pendingConfirm])

  if (!railOpen) return null

  return (
    <aside
      className="anim-slide-in fixed right-0 top-0 z-[60] flex h-full w-[360px] flex-col border-l border-line bg-surface/95 backdrop-blur-xl"
      aria-label="Command narration"
    >
      <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="display text-[13px]">Ethara</span>
          <Badge tone={apiMode === 'connected' ? 'good' : 'warn'}>
            {apiMode === 'connected' ? 'Connected' : 'Standalone'}
          </Badge>
        </div>
        <button
          type="button"
          onClick={toggleRail}
          aria-label="Close the narration rail"
          className="rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
        >
          <X size={15} />
        </button>
      </header>

      {notices.length > 0 ? (
        <div className="border-b border-line">
          {notices.slice(0, 3).map((notice) => (
            <div
              key={notice.id}
              className="anim-assistant-notice-in flex items-start gap-2.5 border-l-2 border-serious px-4 py-2.5"
            >
              <Bell size={13} className="mt-0.5 shrink-0 text-serious" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-[11px] leading-relaxed text-ink-2">{notice.message}</p>
                <div className="mt-1.5 flex items-center gap-2">
                  {notice.action ? (
                    <button
                      type="button"
                      onClick={() => {
                        dismissNotice(notice.id)
                        void sendCommand(notice.action?.utterance ?? '')
                      }}
                      className="text-[11px] font-medium text-accent-bright underline decoration-line-strong underline-offset-2"
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
                </div>
              </div>
            </div>
          ))}
        </div>
      ) : null}

      <div ref={scroller} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {turns.length === 0 ? (
          <p className="text-[12px] leading-relaxed text-ink-3">
            Nothing yet. Press ⌘K and ask for anything the twelve agents can do — I will show you the
            plan before I run it.
          </p>
        ) : null}

        {/* The shared renderer, so the rail and the calendar panel agree. It
            reads the narration off the operator turn — the server stores one row
            per exchange, and the rail used to drop every answer by rendering
            only the utterance. */}
        <ul className="space-y-3.5">
          {turns
            .filter((turn) => turn.speaker === 'operator' || turn.plan || turn.narration)
            .map((turn) => (
              <Exchange
                key={turn.id}
                turn={turn}
                streaming={streaming}
                {...(voiceSupport.output ? { onSpeak: speak } : {})}
              />
            ))}
        </ul>

        {pendingConfirm ? <ConfirmCard confirm={pendingConfirm} onDecision={confirmPlan} /> : null}
      </div>

      <footer className="border-t border-line px-4 py-2.5">
        <Btn variant="ghost" className="w-full" onClick={() => useStore.getState().openBar()}>
          Ask Ethara · ⌘K
        </Btn>
      </footer>
    </aside>
  )
}

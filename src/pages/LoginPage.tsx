/**
 * SIGN IN
 *
 * One column, one decision, the mark doing the talking. The backdrop is a
 * depth grid: a 60px floor panning toward a lit horizon, a 130px parallax
 * layer behind it, and a bloom breathing on the horizon. The mark settles,
 * takes a lens pass every nine seconds, and otherwise holds still — the form
 * is where the operator reads and types, and nothing on it moves once it has
 * arrived.
 *
 * Every colour is a token. The design was drawn against this palette, so the
 * dark and light themes are the same page, not two pages.
 */

import { useState } from 'react'
import { ArrowRight, Check, Eye, EyeOff, Loader2, Megaphone, Moon, ShieldCheck, Sun } from 'lucide-react'
import { useStore } from '../store'
import { EMBLEM_DATA_URI } from '../../shared/emblem-data'
import type { OperatorRole } from '../types'

const ROLES: Array<{
  id: OperatorRole
  label: string
  email: string
  approval: string
  icon: typeof Megaphone
}> = [
  { id: 'marketing', label: 'Marketing', email: 'ridhima@ethara.ai', approval: 'first approval', icon: Megaphone },
  { id: 'leadership', label: 'Leadership', email: 'arjun.mehta@ethara.ai', approval: 'final approval', icon: ShieldCheck },
]

const WORDMARK = [...'Ethara']
/** The letters follow the mark settling: 900ms at 180ms, then 33ms apart. */
const LETTER_START_MS = 1041
const LETTER_STEP_MS = 33
const EASE = 'cubic-bezier(0.22, 1, 0.36, 1)'

export function LoginPage() {
  const login = useStore((s) => s.login)
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)
  const [role, setRole] = useState<OperatorRole>('marketing')
  const [password, setPassword] = useState('ethara-demo')
  const [showPassword, setShowPassword] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [refusal, setRefusal] = useState<string | null>(null)

  /**
   * Sign in for real. On success the store sets the user and this screen
   * unmounts. On refusal the server's own sentence is shown under the field,
   * after the pressed state has held for at least the reveal's own beat, so
   * a wrong password reads as an answer rather than a flicker.
   */
  const submit = async (): Promise<void> => {
    setSubmitting(true)
    setRefusal(null)
    const started = Date.now()
    try {
      await login(role, password)
    } catch (error) {
      await new Promise((resolve) => window.setTimeout(resolve, Math.max(0, 500 - (Date.now() - started))))
      setRefusal(error instanceof Error ? error.message : 'Sign-in was refused.')
      setSubmitting(false)
    }
  }

  const onRoleKey = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return
    event.preventDefault()
    const i = ROLES.findIndex((r) => r.id === role)
    const next = ROLES[(i + (event.key === 'ArrowDown' ? 1 : ROLES.length - 1)) % ROLES.length]
    if (next) setRole(next.id)
  }

  return (
    <div className="relative flex h-screen w-screen items-center justify-center overflow-hidden bg-page text-ink">
      <DepthGrid />

      <button
        type="button"
        onClick={toggleTheme}
        aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
        className="mono absolute right-[22px] top-[22px] z-20 inline-flex items-center gap-[7px] rounded-md border border-line-strong px-2.5 py-[5px] text-[10px] tracking-[0.08em] text-ink-3 backdrop-blur-md transition-colors duration-[var(--dur-fast)] hover:border-accent/50 hover:text-ink"
        style={{ background: 'color-mix(in srgb, var(--color-surface) 60%, transparent)' }}
      >
        {theme === 'dark' ? <Sun size={12} aria-hidden="true" /> : <Moon size={12} aria-hidden="true" />}
        {theme === 'dark' ? 'LIGHT' : 'DARK'}
      </button>

      <div className="relative z-10 flex w-[396px] max-w-[calc(100vw-48px)] flex-col items-center">
        {/* ── The mark ────────────────────────────────────────────────── */}
        <div className="relative flex h-[132px] w-[132px] items-center justify-center">
          <span
            aria-hidden="true"
            className="absolute -inset-[14px] rounded-full"
            style={{
              background: 'radial-gradient(circle, var(--color-hud), transparent 70%)',
              animation: 'eth-mark-breathe 6.5s cubic-bezier(0.4, 0, 0.2, 1) infinite',
            }}
          />
          <span
            aria-hidden="true"
            className="absolute -inset-[3px] rounded-full border border-line-strong"
            style={{ animation: 'eth-mark-ring 6.5s cubic-bezier(0.4, 0, 0.2, 1) infinite' }}
          />
          <span
            role="img"
            aria-label="Ethara"
            className="relative block h-[112px] w-[112px] overflow-hidden rounded-full"
            style={{ animation: `eth-mark-settle 900ms ${EASE} 180ms both` }}
          >
            <img
              src={EMBLEM_DATA_URI}
              alt=""
              width={112}
              height={112}
              draggable={false}
              className="block h-full w-full rounded-full object-cover"
              style={{ background: 'var(--color-surface)' }}
            />
            <span
              aria-hidden="true"
              className="absolute inset-0"
              style={{
                background:
                  'linear-gradient(100deg, transparent 42%, color-mix(in srgb, var(--color-ink) 30%, transparent) 50%, transparent 58%)',
                animation: 'eth-mark-sheen 9s cubic-bezier(0.4, 0, 0.2, 1) 1.2s infinite',
              }}
            />
          </span>
        </div>

        {/* ── Wordmark ────────────────────────────────────────────────── */}
        <h1 className="display mt-[26px] text-[38px] font-semibold leading-none tracking-[-0.03em]">
          {WORDMARK.map((letter, i) => (
            <span
              key={`${letter}-${i}`}
              className="inline-block"
              style={{ animation: `eth-track-in 620ms ${EASE} ${LETTER_START_MS + i * LETTER_STEP_MS}ms both` }}
            >
              {letter}
            </span>
          ))}
          <span className="inline-block text-magenta" style={{ animation: `eth-track-in 680ms ${EASE} 1180ms both` }}>
            .AI
          </span>
        </h1>

        <p
          className="mono mt-2.5 text-[10px] uppercase tracking-[0.2em] text-ink-3"
          style={{ animation: `eth-rise 560ms ${EASE} 1120ms both` }}
        >
          Social Media Agent
        </p>

        <span
          aria-hidden="true"
          className="mt-[30px] h-px w-full origin-center"
          style={{
            background:
              'linear-gradient(90deg, transparent, var(--color-line-strong) 22%, var(--color-line-strong) 78%, transparent)',
            animation: `eth-rule-draw 720ms ${EASE} 1320ms both`,
          }}
        />

        {/* ── The form ────────────────────────────────────────────────── */}
        <form
          onSubmit={(event) => {
            event.preventDefault()
            void submit()
          }}
          className="mt-[26px] flex w-full flex-col gap-3.5"
        >
          <div
            role="radiogroup"
            aria-label="Sign in as"
            onKeyDown={onRoleKey}
            className="flex flex-col gap-2"
            style={{ animation: `eth-rise 520ms ${EASE} 1320ms both` }}
          >
            {ROLES.map((option) => {
              const active = option.id === role
              return (
                <button
                  key={option.id}
                  type="button"
                  role="radio"
                  aria-checked={active}
                  tabIndex={active ? 0 : -1}
                  onClick={() => setRole(option.id)}
                  className={`flex w-full items-center gap-[11px] rounded-[9px] border px-[13px] py-[11px] text-left transition-[border-color,background-color] duration-[var(--dur-base)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent ${
                    active ? 'border-accent' : 'border-line-strong hover:border-accent/50 hover:bg-surface'
                  }`}
                  style={active ? { background: 'color-mix(in srgb, var(--color-accent) 16%, transparent)' } : undefined}
                >
                  <option.icon
                    size={14}
                    className={`shrink-0 ${active ? 'text-accent-bright' : 'text-ink-3'}`}
                    aria-hidden="true"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block text-[13px] font-semibold text-ink">{option.label}</span>
                    <span className="mono block text-[10px] text-ink-3">
                      {option.email} · {option.approval}
                    </span>
                  </span>
                  {active ? <Check size={15} className="shrink-0 text-accent-bright" strokeWidth={2.4} aria-hidden="true" /> : null}
                </button>
              )
            })}
          </div>

          <span className="relative block" style={{ animation: `eth-rise 520ms ${EASE} 1380ms both` }}>
            <input
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              aria-label="Password"
              autoComplete="current-password"
              aria-invalid={refusal !== null}
              className="mono w-full rounded-[9px] border border-line-strong bg-surface py-[11px] pl-[13px] pr-10 text-[13px] tracking-[0.1em] text-ink outline-none transition-colors duration-[var(--dur-fast)] focus:border-accent"
            />
            <button
              type="button"
              onClick={() => setShowPassword(!showPassword)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className="absolute right-[9px] top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-3 transition-colors duration-[var(--dur-fast)] hover:text-ink"
            >
              {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </span>

          {refusal ? (
            <p
              role="alert"
              className="-mt-1 flex items-start gap-[7px] text-[11.5px] leading-relaxed text-critical-ink"
              style={{ animation: `eth-rise 320ms ${EASE} both` }}
            >
              <span className="mt-[6px] h-[5px] w-[5px] shrink-0 rounded-full bg-critical" aria-hidden="true" />
              {refusal}
            </p>
          ) : null}

          <button
            type="submit"
            disabled={submitting}
            aria-live="polite"
            className="group flex w-full items-center justify-center gap-[9px] rounded-[9px] border border-accent bg-accent p-3 text-[13.5px] font-semibold text-on-accent transition-[background-color,border-color,transform] duration-[var(--dur-fast)] hover:border-accent-bright hover:bg-accent-bright active:scale-[0.99] disabled:opacity-70"
            style={{ animation: `eth-rise 520ms ${EASE} 1440ms both` }}
          >
            {submitting ? (
              <>
                <Loader2 size={15} style={{ animation: 'auth-spin 900ms linear infinite' }} aria-hidden="true" />
                Signing in…
              </>
            ) : (
              <>
                Sign in
                <ArrowRight
                  size={15}
                  strokeWidth={2.2}
                  className="transition-transform duration-[var(--dur-fast)] group-hover:translate-x-0.5"
                  aria-hidden="true"
                />
              </>
            )}
          </button>
        </form>
      </div>

      <p className="mono absolute inset-x-0 bottom-[22px] text-center text-[11px] uppercase tracking-[0.18em] text-ink-3">
        Ethara.AI · marketing operations
      </p>
    </div>
  )
}

/**
 * Infrastructure receding to a horizon. A 60px floor panning toward the
 * viewer, a slower 130px layer behind it for parallax, one lit horizon line,
 * a bloom on the horizon, and a vignette holding the edges. Everything else
 * is still.
 */
function DepthGrid() {
  const grid = (colour: string) =>
    `linear-gradient(to right, ${colour} 1px, transparent 1px), linear-gradient(to bottom, ${colour} 1px, transparent 1px)`
  const far = 'color-mix(in srgb, var(--color-hud) 50%, transparent)'
  const near = 'var(--color-hud)'

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <span
        className="absolute inset-0"
        style={{
          background:
            'linear-gradient(to bottom, var(--color-page) 0%, var(--color-page) 44%, color-mix(in srgb, var(--color-page) 70%, var(--color-surface)) 100%)',
        }}
      />

      {/* The far floor: larger cells, slower pan, fainter. */}
      <div className="absolute inset-x-0 bottom-0 h-[560px]" style={{ perspective: 900, perspectiveOrigin: '50% 0%' }}>
        <div
          className="absolute -left-[45%] -right-[45%] -bottom-[60%] top-0 origin-top"
          style={{
            transform: 'rotateX(79deg)',
            backgroundImage: grid(far),
            backgroundSize: '130px 130px',
            maskImage: 'linear-gradient(to bottom, transparent 0%, #000 42%, transparent 94%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 42%, transparent 94%)',
            animation: 'eth-floorpan-slow 36s linear infinite',
          }}
        />
      </div>

      {/* The near floor: 60px cells panning toward the viewer. */}
      <div className="absolute inset-x-0 bottom-0 h-[520px]" style={{ perspective: 420, perspectiveOrigin: '50% 0%' }}>
        <div
          className="absolute -left-[30%] -right-[30%] -bottom-[40%] top-0 origin-top"
          style={{
            transform: 'rotateX(76deg)',
            backgroundImage: grid(near),
            backgroundSize: '60px 60px',
            maskImage: 'linear-gradient(to bottom, transparent 0%, #000 34%, #000 76%, transparent 100%)',
            WebkitMaskImage: 'linear-gradient(to bottom, transparent 0%, #000 34%, #000 76%, transparent 100%)',
            animation: 'eth-floorpan 14s linear infinite',
          }}
        />
      </div>

      {/* The horizon, lit magenta at its centre. */}
      <span
        className="absolute inset-x-0 h-px"
        style={{
          top: '43.25%',
          background:
            'linear-gradient(90deg, transparent, color-mix(in srgb, var(--color-accent-bright) 70%, transparent) 30%, var(--color-magenta) 50%, color-mix(in srgb, var(--color-accent-bright) 70%, transparent) 70%, transparent)',
          animation: 'eth-horizon 9s ease-in-out infinite',
        }}
      />
      <span
        className="absolute left-1/2 h-[430px] w-[1260px] rounded-full"
        style={{
          top: '43.25%',
          background: 'radial-gradient(circle, var(--color-hud), transparent 64%)',
          animation: 'eth-bloom 13s ease-in-out infinite',
        }}
      />

      {/* The vignette: page colour closing in from the edges. */}
      <span
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(110% 80% at 50% 42%, transparent 46%, color-mix(in srgb, var(--color-page) 88%, transparent) 100%)',
        }}
      />
    </div>
  )
}

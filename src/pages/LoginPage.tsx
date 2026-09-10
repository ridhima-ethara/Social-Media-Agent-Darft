/**
 * SIGN IN
 *
 * Two panels, each with its own animated backdrop. The left states what the
 * product is; the right decides which of the two roles you are, because the
 * role controls which screens and approvals exist for you.
 */

import { useEffect, useState } from 'react'
import { Eye, EyeOff, Megaphone, ShieldCheck, Sparkles, Loader2 } from 'lucide-react'
import { useStore } from '../store'
import { Logo, Wordmark } from '../components/logo'
import { ThemeToggle } from '../components/theme-toggle'
import { Tilt } from '../components/tilt'
import type { OperatorRole } from '../types'

const ROLES: Array<{
  id: OperatorRole
  label: string
  person: string
  blurb: string
  email: string
  icon: typeof Megaphone
}> = [
  {
    id: 'marketing',
    label: 'Marketing team',
    person: 'Ridhima · Marketing Lead',
    blurb: 'Runs the agents end to end and gives first approval',
    email: 'ridhima@ethara.ai',
    icon: Megaphone,
  },
  {
    id: 'leadership',
    label: 'Leadership',
    person: 'Arjun Mehta · CMO',
    blurb: 'Final approval on every post before it is published',
    email: 'arjun.mehta@ethara.ai',
    icon: ShieldCheck,
  },
]

const WORDMARK_LETTERS = [...'Ethara']

export function LoginPage() {
  const login = useStore((s) => s.login)
  const [role, setRole] = useState<OperatorRole>('marketing')
  const [password, setPassword] = useState('ethara-demo')
  const [showPassword, setShowPassword] = useState(false)
  const [keepSignedIn, setKeepSignedIn] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const selected = ROLES.find((r) => r.id === role) as (typeof ROLES)[number]

  useEffect(() => {
    if (!submitting) return
    const timer = window.setTimeout(() => {
      setSubmitting(false)
      login(role)
    }, 700)
    return () => window.clearTimeout(timer)
  }, [submitting, role, login])

  return (
    <div className="relative flex h-screen w-screen overflow-hidden bg-page text-ink">
      <ThemeToggle className="absolute right-5 top-5 z-30" />

      {/* ── Brand panel ──────────────────────────────────────────────────── */}
      <section className="relative hidden flex-1 items-center justify-center overflow-hidden border-r border-line px-10 lg:flex">
        <AuthBackdrop />

        <div className="relative z-10 max-w-lg">
          <div className="relative mb-8 flex h-[150px] w-[150px] items-center justify-center">
            <span
              className="absolute inset-0 rounded-full"
              style={{
                background: 'radial-gradient(circle, var(--color-glow), transparent 68%)',
                animation: 'auth-halo 16s var(--ease-in-out-soft) infinite',
              }}
              aria-hidden="true"
            />
            <span
              className="absolute inset-[6px] rounded-full border border-line-strong"
              style={{ animation: 'auth-orbit-in 900ms var(--ease-out-expo) both, auth-orbit-spin 90s linear infinite 900ms' }}
              aria-hidden="true"
            />
            <span
              className="absolute inset-[22px] rounded-full border border-magenta/35"
              style={{ animation: 'auth-orbit-in 900ms var(--ease-out-expo) 160ms both, auth-orbit-spin-reverse 140s linear infinite 1060ms' }}
              aria-hidden="true"
            />
            {/* The mark, drawn once. It used to sit inside three holographic
                rings tumbling in 3D and a float on top — five rings orbiting
                one logo. The two slow rings above are the whole orbit now. */}
            <Logo size={92} mode="draw" />
          </div>

          <p className="mb-3 flex items-center gap-2 text-[11px] uppercase tracking-[0.22em] text-ink-3">
            <Sparkles size={12} className="text-magenta" aria-hidden="true" />
            Social media agent
          </p>

          <h1 className="display text-5xl leading-none">
            {WORDMARK_LETTERS.map((letter, i) => (
              <span
                key={`${letter}-${i}`}
                className="inline-block"
                style={{ animation: `auth-letter 520ms var(--ease-out-expo) ${240 + i * 70}ms both` }}
              >
                {letter}
              </span>
            ))}
            <span
              className="inline-block text-magenta"
              style={{ animation: 'auth-letter-ai 620ms var(--ease-out-expo) 700ms both' }}
            >
              .AI
            </span>
          </h1>

          <p
            className="mt-3 text-[15px] text-ink-2"
            style={{ animation: 'auth-reveal 620ms var(--ease-out-expo) 820ms both' }}
          >
            Twelve agents · one intelligence
          </p>

          <p
            className="mt-4 max-w-md text-[13px] leading-relaxed text-ink-3"
            style={{ animation: 'auth-reveal 620ms var(--ease-out-expo) 940ms both' }}
          >
            Ethara runs the agents. Marketing shapes and approves. Leadership gives the final word.
            Every decision is remembered, so the next post is better than the last.
          </p>

          <div
            className="mt-6 flex flex-wrap gap-2"
            style={{ animation: 'auth-reveal 620ms var(--ease-out-expo) 1060ms both' }}
          >
            {['Role controlled', 'Two-stage approval', 'Knowledge base'].map((item) => (
              <span key={item} className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3">
                {item}
              </span>
            ))}
          </div>

          <p className="mt-10 text-[10px] uppercase tracking-[0.18em] text-ink-3">
            Ethara social media agent · marketing operations
          </p>
        </div>
      </section>

      {/* ── Form panel ───────────────────────────────────────────────────── */}
      <section className="relative flex flex-1 items-center justify-center overflow-hidden px-6">
        <AuthBackdrop subtle />

        <form
          onSubmit={(event) => {
            event.preventDefault()
            setSubmitting(true)
          }}
          className="glass relative z-10 w-full max-w-md rounded-2xl p-7 shadow-2xl"
          style={{ animation: 'auth-card-rise 720ms var(--ease-out-expo) both' }}
        >
          {/* A magenta beam used to sweep the top edge of this card every six
              seconds, forever. The card is where the operator is reading and
              typing; nothing on it should move once it has arrived. */}

          <div className="mb-6 flex items-center gap-2.5 lg:hidden">
            <Logo size={28} />
            <Wordmark className="text-[16px]" />
          </div>

          <p className="text-[11px] uppercase tracking-[0.18em] text-ink-3">Ethara SocialAI</p>
          <h1 className="display mt-1 text-2xl">Sign in</h1>
          <p className="mt-1 text-[13px] text-ink-3">
            Access the agents, calendar, approvals and analytics.
          </p>

          <label className="mt-6 block" style={{ animation: 'auth-field 520ms var(--ease-out-soft) 200ms both' }}>
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Email</span>
            <input
              value={selected.email}
              readOnly
              className="mt-1 w-full cursor-default rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] text-ink-2 outline-none"
            />
          </label>

          <fieldset className="mt-4" style={{ animation: 'auth-field 520ms var(--ease-out-soft) 280ms both' }}>
            <legend className="mb-1.5 text-[11px] uppercase tracking-[0.1em] text-ink-3">Sign in as</legend>
            <div className="grid gap-2" role="radiogroup" aria-label="Role">
              {ROLES.map((option) => {
                const active = option.id === role
                return (
                  <Tilt key={option.id} maxDeg={4} lift={6} className="rounded-xl">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={active}
                    onClick={() => setRole(option.id)}
                    className={`flex w-full items-start gap-3 rounded-xl border px-3 py-2.5 text-left transition-[border-color,background-color] duration-[var(--dur-base)] ${
                      active ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong'
                    }`}
                  >
                    <span
                      className={`mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${
                        active ? 'border-accent text-accent-bright' : 'border-line text-ink-3'
                      }`}
                    >
                      <option.icon size={15} aria-hidden="true" />
                    </span>
                    <span className="min-w-0">
                      <span className="block text-[13px] font-medium text-ink">{option.label}</span>
                      <span className="block text-[11px] text-ink-2">{option.person}</span>
                      <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">{option.blurb}</span>
                    </span>
                  </button>
                  </Tilt>
                )
              })}
            </div>
          </fieldset>

          <label className="mt-4 block" style={{ animation: 'auth-field 520ms var(--ease-out-soft) 360ms both' }}>
            <span className="text-[11px] uppercase tracking-[0.1em] text-ink-3">Password</span>
            <span className="relative mt-1 block">
              <input
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                className="w-full rounded-lg border border-line bg-surface-2 px-3 py-2 pr-10 text-[13px] outline-none focus:border-accent"
              />
              <button
                type="button"
                onClick={() => setShowPassword(!showPassword)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
              >
                {showPassword ? <EyeOff size={14} /> : <Eye size={14} />}
              </button>
            </span>
          </label>

          <label className="mt-3 flex items-center gap-2 text-[12px] text-ink-3">
            <input
              type="checkbox"
              checked={keepSignedIn}
              onChange={(event) => setKeepSignedIn(event.target.checked)}
              className="h-3.5 w-3.5 accent-[var(--color-accent)]"
            />
            Keep me signed in
          </label>

          <button
            type="submit"
            disabled={submitting}
            className="mt-5 flex w-full items-center justify-center gap-2 rounded-lg border border-accent bg-accent px-3 py-2.5 text-[13px] font-medium text-on-accent transition-[background-color,transform] duration-[var(--dur-fast)] hover:bg-accent-bright active:scale-[0.98] disabled:opacity-60"
            style={{ animation: 'auth-field 520ms var(--ease-out-soft) 440ms both' }}
          >
            {submitting ? (
              <>
                <Loader2 size={14} style={{ animation: 'auth-spin 900ms linear infinite' }} aria-hidden="true" />
                Signing in…
              </>
            ) : (
              'Sign in'
            )}
          </button>
        </form>
      </section>
    </div>
  )
}

/** Soft glow, a drifting grid, signal lines, an accent sweep and seven particles. */
function AuthBackdrop({ subtle = false }: { subtle?: boolean }) {
  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
      <span
        className="absolute inset-0"
        style={{
          background:
            'radial-gradient(900px 520px at 20% 10%, var(--color-glow), transparent 62%), radial-gradient(700px 420px at 84% 78%, var(--color-hud), transparent 60%)',
          opacity: subtle ? 0.5 : 1,
          animation: 'auth-glow-drift 48s var(--ease-in-out-soft) infinite',
        }}
      />
      <span
        className="absolute inset-0 opacity-[0.4]"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--color-hud) 1px, transparent 1px), linear-gradient(to bottom, var(--color-hud) 1px, transparent 1px)',
          backgroundSize: '52px 52px',
        }}
      />
      {/* The sweeping lines, the accent sweep and the rising particles used to
          live here. Together with the mark and the card that was twenty
          things moving on a screen whose only job is one form. The glow
          above is the one thing left that moves, and it takes most of a
          minute to do it. */}
    </div>
  )
}

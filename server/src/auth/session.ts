/**
 * IDENTITY AND ROLE, ON THE SERVER.
 *
 * The product documents two guarantees that were not enforced anywhere:
 * "nothing publishes without two human approvals", and that the two approvals
 * come from two different roles. Both were app-logic conventions — the login
 * screen accepted any password and never spoke to the server, and the approval
 * routes took the actor from the request body with a default of `'Ridhima'`. Any
 * HTTP client could supply both signatures.
 *
 * WHY A SIGNED COOKIE AND NOT A SESSION TABLE. The claim is small (a role and a
 * name), short-lived, and needs no revocation list for a two-operator tool. An
 * HMAC over the payload means no storage, no lookup on every request, and no new
 * dependency — `node:crypto` is enough. If revocation ever matters, the secret
 * rotates and every session ends at once, which is the behaviour you want.
 *
 * The cookie is httpOnly and SameSite=Lax: httpOnly so a script cannot read the
 * role, and Lax rather than Strict so that following a link into the app keeps
 * the session while still refusing cross-site form posts.
 */

import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto'

import type { OperatorRole } from '../../../shared/agent-contract'
import { config } from '../config'

export const SESSION_COOKIE = 'ethara_session'

export interface Session {
  role: OperatorRole
  actor: string
  /** Unix seconds. */
  issuedAt: number
  expiresAt: number
}

/** The two roles, and the person each signs as. */
const OPERATORS: Record<OperatorRole, string> = {
  marketing: 'Ridhima · Marketing Lead',
  leadership: 'Arjun Mehta · CMO',
}

export function actorFor(role: OperatorRole): string {
  return OPERATORS[role]
}

/* ═══════════════════════════════════════════════════════════════════════════
   SIGNING
   ═══════════════════════════════════════════════════════════════════════════ */

function secret(): string {
  const configured = config.auth.sessionSecret
  if (configured !== '') return configured

  /*
   * A per-process random secret when none is configured.
   *
   * Deliberately NOT a hardcoded default: a shipped constant would mean every
   * deployment shares a signing key, and anyone could mint a leadership cookie.
   * The cost of randomness is that sessions end when the API restarts, which is
   * a visible, harmless inconvenience — and the message at boot says so.
   */
  return processSecret
}

const processSecret = randomBytes(32).toString('hex')

function sign(payload: string): string {
  return createHmac('sha256', secret()).update(payload).digest('base64url')
}

/** `<base64url payload>.<signature>` */
export function encodeSession(session: Session): string {
  const payload = Buffer.from(JSON.stringify(session), 'utf8').toString('base64url')
  return `${payload}.${sign(payload)}`
}

/**
 * Verifies and decodes, or `null`.
 *
 * Returns `null` for every failure — bad signature, expired, malformed — because
 * a caller has exactly one useful response to all of them, and distinguishing
 * them in the reply would tell an attacker which part they got right.
 */
export function decodeSession(raw: string | undefined): Session | null {
  if (raw === undefined || raw === '') return null

  const dot = raw.lastIndexOf('.')
  if (dot <= 0) return null

  const payload = raw.slice(0, dot)
  const provided = raw.slice(dot + 1)
  const expected = sign(payload)

  // Constant-time: a length-varying or short-circuiting comparison leaks the
  // signature one byte at a time.
  const a = Buffer.from(provided)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null

  let session: Session
  try {
    session = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Session
  } catch {
    return null
  }

  if (session.role !== 'marketing' && session.role !== 'leadership') return null
  if (typeof session.expiresAt !== 'number' || session.expiresAt * 1000 < Date.now()) return null

  return session
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE CREDENTIAL
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SignInOutcome {
  session: Session | null
  /** Why sign-in was refused, or an empty string on success. */
  reason: string
}

/**
 * Validates a password against the configured credential.
 *
 * WITH NO CREDENTIAL CONFIGURED, ANY PASSWORD IS ACCEPTED — and that is stated
 * rather than hidden. The product is designed to run with an empty `.env`, and
 * refusing every sign-in would make it unusable out of the box. What must never
 * happen is the *appearance* of a locked door: `/api/health` reports
 * `auth.enforced: false`, so an operator can see that the gate is open.
 */
export function signIn(role: unknown, password: unknown): SignInOutcome {
  if (role !== 'marketing' && role !== 'leadership') {
    return { session: null, reason: 'Choose a role: marketing or leadership.' }
  }

  const expected = config.auth.operatorPassword
  if (expected !== '') {
    const supplied = typeof password === 'string' ? password : ''
    const a = Buffer.from(supplied)
    const b = Buffer.from(expected)
    if (a.length !== b.length || !timingSafeEqual(a, b)) {
      return { session: null, reason: 'That password is not correct.' }
    }
  }

  const now = Math.floor(Date.now() / 1000)
  return {
    session: {
      role,
      actor: actorFor(role),
      issuedAt: now,
      expiresAt: now + config.auth.sessionTtlSeconds,
    },
    reason: '',
  }
}

/** Whether a password is actually required. Reported at `/api/health`. */
export function authEnforced(): boolean {
  return config.auth.operatorPassword !== ''
}

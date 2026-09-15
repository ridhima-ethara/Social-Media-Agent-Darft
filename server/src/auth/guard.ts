/**
 * THE GUARD.
 *
 * One middleware and two helpers, so no route re-implements the question "who is
 * this, and may they do that".
 *
 * WHAT IS GUARDED. Every mutating request — anything that is not GET or OPTIONS —
 * except the session routes themselves and `/health`. Reads stay open: the
 * product is a single-tenant internal tool, the screens are designed to render
 * for anyone who can reach the port, and gating reads would break the documented
 * "every screen renders with the API stopped" behaviour for no gain that the
 * threat model asks for. Writes are where the guarantees live.
 *
 * WHY 401 AND NOT 403. An unauthenticated caller can fix their situation by
 * signing in, which is what 401 means. A caller with the wrong ROLE cannot, and
 * gets 403 with the required role named.
 */

import type { NextFunction, Request, Response } from 'express'

import type { OperatorRole } from '../../../shared/agent-contract'
import { SESSION_COOKIE, decodeSession, type Session } from './session'

/** The session on a request, once `requireSession` has run. */
export interface Authed extends Request {
  session?: Session
}

/** Reads one cookie without adding a cookie-parser dependency. */
function cookie(req: Request, name: string): string | undefined {
  const header = req.headers.cookie
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return decodeURIComponent(part.slice(eq + 1).trim())
  }
  return undefined
}

/** The verified session on this request, or `null`. */
export function sessionOf(req: Request): Session | null {
  const existing = (req as Authed).session
  if (existing !== undefined) return existing
  const decoded = decodeSession(cookie(req, SESSION_COOKIE))
  if (decoded !== null) (req as Authed).session = decoded
  return decoded
}

/** Routes reachable without a session. Everything else that mutates is guarded. */
const OPEN_PATHS = new Set(['/session', '/health'])

/**
 * Rejects unauthenticated mutating requests with 401.
 *
 * Mounted once on the API router, so a route added later is guarded by default
 * — the opposite of the previous arrangement, where a route was unguarded unless
 * someone remembered.
 */
export function requireSession(req: Request, res: Response, next: NextFunction): void {
  if (req.method === 'GET' || req.method === 'OPTIONS' || req.method === 'HEAD') {
    next()
    return
  }
  if (OPEN_PATHS.has(req.path)) {
    next()
    return
  }

  if (sessionOf(req) === null) {
    res.status(401).json({
      error:
        'Not signed in. This action changes state, so it needs an operator behind it — ' +
        'sign in first (POST /api/session with a role and password).',
    })
    return
  }

  next()
}

/**
 * Refuses unless the session carries one of `roles`.
 *
 * The refusal names the role required and the role held, because "forbidden"
 * alone leaves an operator guessing which of two accounts they should be using.
 * This is what makes the two-approval rule real: Marketing cannot cast the
 * Leadership decision even by calling the route directly.
 */
export function requireRole(
  res: Response,
  session: Session | null,
  roles: OperatorRole[],
): boolean {
  if (session === null) {
    res.status(401).json({ error: 'Not signed in.' })
    return false
  }
  if (!roles.includes(session.role)) {
    const needed = roles.join(' or ')
    res.status(403).json({
      error:
        `This action requires the ${needed} role, and you are signed in as ${session.role}. ` +
        'Nothing publishes without both signatures, so one account cannot supply both.',
    })
    return false
  }
  return true
}

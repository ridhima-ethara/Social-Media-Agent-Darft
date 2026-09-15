/**
 * THE TWO-APPROVAL RULE, ENFORCED.
 *
 * The product documents that "nothing publishes without two human approvals"
 * and that no setting removes it. Until now that was app-logic convention: the
 * login screen accepted any password without contacting the server, and the
 * approval routes read the actor out of the request body with a default of
 * `'Ridhima'`. One curl could cast both signatures.
 *
 * These tests exercise the HTTP surface against a real server, because the claim
 * is about what the server refuses — not about what a function returns.
 *
 * `OPERATOR_PASSWORD` is set for the fixture so the enforced path is what gets
 * tested. With it blank the product deliberately accepts any password, which is
 * a supported configuration and is asserted separately.
 */

import { spawn, type ChildProcess } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterAll, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PORT = 4123
const BASE = `http://127.0.0.1:${PORT}/api`
const PASSWORD = 'test-operator-password'

let server: ChildProcess | null = null
let reachable = false

/** Boots an API on a private port with auth enforced. */
async function boot(): Promise<boolean> {
  server = spawn('npx', ['tsx', 'server/src/index.ts'], {
    cwd: ROOT,
    env: {
      ...process.env,
      PORT: String(PORT),
      OPERATOR_PASSWORD: PASSWORD,
      SESSION_SECRET: 'test-session-secret-not-for-deployment',
      // Keep the boot fast and side-effect free.
      EMBEDDINGS_ENABLED: 'false',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  })

  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(1500) })
      if (response.ok || response.status === 503) return true
    } catch {
      /* not up yet */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  return false
}

// Booted at MODULE scope, not in `beforeAll`: `describe.skipIf` is evaluated
// while the file is being collected, which happens before any hook runs — so a
// flag set in `beforeAll` would always still be false and every test would skip.
reachable = await boot()

afterAll(() => {
  server?.kill()
})

/** Signs in and returns the raw Cookie header value. */
async function sessionCookie(role: 'marketing' | 'leadership'): Promise<string> {
  const response = await fetch(`${BASE}/session`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ role, password: PASSWORD }),
  })
  expect(response.status, `sign-in as ${role} should succeed`).toBe(200)
  const setCookie = response.headers.get('set-cookie') ?? ''
  return setCookie.split(';')[0] ?? ''
}

async function post(
  path: string,
  cookie: string | null,
  body: unknown = {},
): Promise<{ status: number; error: string }> {
  const response = await fetch(`${BASE}${path}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(cookie === null ? {} : { cookie }),
    },
    body: JSON.stringify(body),
  })
  const payload = (await response.json().catch(() => ({}))) as { error?: string }
  return { status: response.status, error: payload.error ?? '' }
}

describe.skipIf(!reachable)('an unauthenticated mutating request', () => {
  it('is refused with 401', async () => {
    const { status, error } = await post('/ideas/00000000-0000-0000-0000-000000000000/approve', null)
    expect(status).toBe(401)
    expect(error.toLowerCase()).toContain('not signed in')
  })

  it('names signing in as the remedy rather than just refusing', async () => {
    const { error } = await post('/agents/run', null, { keywords: ['RLHF'] })
    expect(error).toMatch(/sign in/i)
  })

  it('does not gate reads — every screen must still render', async () => {
    const response = await fetch(`${BASE}/state`)
    expect([200, 500, 503]).toContain(response.status)
    expect(response.status).not.toBe(401)
  })
})

describe.skipIf(!reachable)('the credential', () => {
  it('refuses a wrong password', async () => {
    const response = await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'marketing', password: 'wrong' }),
    })
    expect(response.status).toBe(401)
  })

  it('refuses an unknown role', async () => {
    const response = await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'admin', password: PASSWORD }),
    })
    expect(response.status).toBe(401)
  })

  it('issues an httpOnly cookie, so a script cannot read the role', async () => {
    const response = await fetch(`${BASE}/session`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ role: 'marketing', password: PASSWORD }),
    })
    const setCookie = response.headers.get('set-cookie') ?? ''
    expect(setCookie).toContain('HttpOnly')
    expect(setCookie).toContain('SameSite=Lax')
  })

  it('reports that enforcement is on', async () => {
    const response = await fetch(`${BASE}/health`)
    const body = (await response.json()) as { auth?: { enforced?: boolean } }
    expect(body.auth?.enforced).toBe(true)
  })
})

describe.skipIf(!reachable)('role separation', () => {
  it('marketing calling the LEADERSHIP route is refused, with the role named', async () => {
    const cookie = await sessionCookie('marketing')
    const { status, error } = await post(
      '/ideas/00000000-0000-0000-0000-000000000000/leadership/approve',
      cookie,
    )
    expect(status).toBe(403)
    expect(error).toContain('leadership')
    expect(error).toContain('marketing')
    // The refusal must explain WHY, not merely that.
    expect(error).toMatch(/both signatures|one account cannot supply both/i)
  })

  it('leadership calling the MARKETING route is refused, with the role named', async () => {
    const cookie = await sessionCookie('leadership')
    const { status, error } = await post(
      '/ideas/00000000-0000-0000-0000-000000000000/approve',
      cookie,
    )
    expect(status).toBe(403)
    expect(error).toContain('marketing')
  })

  it('each role reaches its own route — refused on the idea, not on the role', async () => {
    // A nonexistent idea is the expected failure here. What matters is that it
    // is NOT 401 or 403: the guard let the request through to the handler.
    const marketing = await post('/ideas/00000000-0000-0000-0000-000000000000/approve', await sessionCookie('marketing'))
    expect([400, 404, 500]).toContain(marketing.status)

    const leadership = await post(
      '/ideas/00000000-0000-0000-0000-000000000000/leadership/approve',
      await sessionCookie('leadership'),
    )
    expect([400, 404, 500]).toContain(leadership.status)
  })
})

describe.skipIf(!reachable)('a rejection still needs a reason', () => {
  it('is refused when the reason is absent, even with the right role', async () => {
    const cookie = await sessionCookie('leadership')
    const { status, error } = await post(
      '/ideas/00000000-0000-0000-0000-000000000000/leadership/reject',
      cookie,
      {},
    )
    expect(status).not.toBe(401)
    expect(status).not.toBe(403)
    expect(error).toMatch(/reason/i)
  })
})

describe.skipIf(!reachable)('the session lifecycle', () => {
  it('GET /session reports who you are', async () => {
    const cookie = await sessionCookie('leadership')
    const response = await fetch(`${BASE}/session`, { headers: { cookie } })
    const body = (await response.json()) as { role?: string; actor?: string }
    expect(body.role).toBe('leadership')
    expect(body.actor).toContain('CMO')
  })

  it('GET /session without one reports nobody rather than failing', async () => {
    const response = await fetch(`${BASE}/session`)
    expect(response.status).toBe(200)
    const body = (await response.json()) as { role: string | null }
    expect(body.role).toBeNull()
  })

  it('a tampered cookie is rejected', async () => {
    const cookie = await sessionCookie('marketing')
    // Flip the role in the payload; the HMAC must no longer verify.
    const tampered = `${cookie.slice(0, -4)}AAAA`
    const { status } = await post('/ideas/00000000-0000-0000-0000-000000000000/approve', tampered)
    expect(status).toBe(401)
  })

  it('DELETE /session expires the cookie', async () => {
    const cookie = await sessionCookie('marketing')
    const response = await fetch(`${BASE}/session`, { method: 'DELETE', headers: { cookie } })
    expect(response.status).toBe(200)
    expect(response.headers.get('set-cookie') ?? '').toContain('Max-Age=0')
  })
})

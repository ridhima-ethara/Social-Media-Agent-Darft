/**
 * BUFFER PUBLISHING — the config gate, channel resolution and refusals.
 *
 * The behaviour that matters: Buffer must never be reported as ready when it
 * cannot post, and it must never GUESS which channel to post to when an account
 * holds two for the same service. The second is the expensive one — a wrong guess
 * publishes to the wrong feed and cannot be undone.
 *
 * The network is never reached. `fetch` is stubbed per case, and the module
 * registry is reset so the config getters re-read `process.env`.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const KEYS = [
  'BUFFER_ACCESS_TOKEN',
  'BUFFER_API_BASE',
  'BUFFER_TIMEOUT_MS',
  'BUFFER_PROFILE_ID_LINKEDIN',
  'BUFFER_PROFILE_ID_X',
] as const

const saved = new Map<string, string | undefined>()
const realFetch = globalThis.fetch

async function loadWith(
  env: Partial<Record<(typeof KEYS)[number], string>>,
): Promise<typeof import('../server/src/integrations/buffer')> {
  for (const key of KEYS) delete process.env[key]
  for (const [key, value] of Object.entries(env)) process.env[key] = value
  vi.resetModules()
  return import('../server/src/integrations/buffer')
}

/**
 * Loads the adapter with the config stubbed, for the cases that must observe an
 * ABSENT token.
 *
 * The environment cannot express that here: `server/secrets.env` may hold a real
 * key, and the loader refills any variable left unset or empty, so deleting it and
 * resetting modules puts it straight back. Stubbing config is the only way to
 * assert the unconfigured path on a machine that is actually configured — and that
 * path is the one that must never silently pass.
 */
async function loadUnconfigured(): Promise<
  typeof import('../server/src/integrations/buffer')
> {
  vi.resetModules()
  vi.doMock('../server/src/config', () => ({
    config: {
      buffer: {
        accessToken: '',
        apiBase: 'https://api.buffer.com',
        timeoutMs: 1000,
        profileIdFor: () => '',
        configured: false,
      },
    },
  }))
  const mod = await import('../server/src/integrations/buffer')
  return mod
}

/**
 * Replies to GraphQL requests.
 *
 * Channel discovery is two round trips — organisations, then channels — so the
 * stub inspects the query and answers each. `data` is wrapped for callers that
 * pass a bare payload, matching GraphQL's envelope.
 */
function stubGraphql(
  answers: { orgs?: unknown; channels?: unknown; createPost?: unknown; errors?: unknown },
  status = 200,
): void {
  globalThis.fetch = vi.fn(async (_url: unknown, init?: { body?: string }) => {
    const query = String(JSON.parse(init?.body ?? '{}').query ?? '')
    let data: Record<string, unknown> = {}
    if (query.includes('GetOrganizations')) {
      data = { account: { organizations: answers.orgs ?? [{ id: 'org-1' }] } }
    } else if (query.includes('GetChannels')) {
      data = { channels: answers.channels ?? [] }
    } else if (query.includes('CreatePost')) {
      data = { createPost: answers.createPost ?? {} }
    }
    const body =
      answers.errors === undefined ? { data } : { errors: answers.errors }
    return new Response(JSON.stringify(body), {
      status,
      headers: { 'content-type': 'application/json' },
    })
  }) as unknown as typeof fetch
}

beforeEach(() => {
  for (const key of KEYS) saved.set(key, process.env[key])
})

afterEach(() => {
  vi.doUnmock('../server/src/config')
  vi.resetModules()
  globalThis.fetch = realFetch
  for (const key of KEYS) {
    const value = saved.get(key)
    if (value === undefined) delete process.env[key]
    else process.env[key] = value
  }
})

describe('the Buffer config gate', () => {
  it('is not configured without a token, and says where to get one', async () => {
    const b = await loadUnconfigured()
    expect(b.isConfigured()).toBe(false)
    expect(b.unavailableReason()).toContain('BUFFER_ACCESS_TOKEN')
    expect(b.unavailableReason()).toContain('buffer.com')
  })

  /* One token is the whole credential — unlike the four-key LinkedIn app it replaced. */
  it('is configured on the token alone', async () => {
    const b = await loadWith({ BUFFER_ACCESS_TOKEN: 'tok-123' })
    expect(b.isConfigured()).toBe(true)
    expect(b.unavailableReason()).toBe('')
    expect(b.describeBuffer()).toContain('Ready')
  })

  it('reports which channels are pinned', async () => {
    const b = await loadWith({
      BUFFER_ACCESS_TOKEN: 'tok-123',
      BUFFER_PROFILE_ID_LINKEDIN: 'prof-li',
    })
    expect(b.describeBuffer()).toContain('linkedin')
  })
})

describe('channel resolution', () => {
  it('prefers an explicitly pinned id without calling the API', async () => {
    const b = await loadWith({
      BUFFER_ACCESS_TOKEN: 'tok',
      BUFFER_PROFILE_ID_LINKEDIN: 'pinned-id',
    })
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    await expect(b.channelFor('linkedin')).resolves.toBe('pinned-id')
    expect(spy).not.toHaveBeenCalled()
  })

  it('discovers a single channel from the token', async () => {
    const b = await loadWith({ BUFFER_ACCESS_TOKEN: 'tok' })
    stubGraphql({ channels: [{ id: 'li-1', service: 'linkedin', name: 'smilingdayzz', type: 'page' }] })
    await expect(b.channelFor('linkedin')).resolves.toBe('li-1')
  })

  /*
   * THE CENTRAL ASSERTION.
   *
   * Two LinkedIn channels — a personal profile and a Company Page — must NOT be
   * resolved by list order. Publishing to the wrong feed is unrecoverable, so the
   * ambiguity is refused and the operator is told which knob settles it.
   */
  it('refuses to guess when one service has two channels', async () => {
    const b = await loadWith({ BUFFER_ACCESS_TOKEN: 'tok' })
    stubGraphql({
      channels: [
        { id: 'li-personal', service: 'linkedin', name: 'Ridhima', type: 'profile' },
        { id: 'li-page', service: 'linkedin', name: 'smilingdayzz', type: 'page' },
      ],
    })
    await expect(b.channelFor('linkedin')).rejects.toThrow(/BUFFER_PROFILE_ID_LINKEDIN/)
  })

  it('names what IS connected when the platform is not', async () => {
    const b = await loadWith({ BUFFER_ACCESS_TOKEN: 'tok' })
    stubGraphql({ channels: [{ id: 'x-1', service: 'x', name: '@brand', type: 'profile' }] })
    await expect(b.channelFor('linkedin')).rejects.toThrow(/Connected: x/)
  })
})

describe('dispatch', () => {
  it('refuses before touching the network when unconfigured', async () => {
    const b = await loadUnconfigured()
    const spy = vi.fn()
    globalThis.fetch = spy as unknown as typeof fetch
    await expect(
      b.dispatch({ platform: 'linkedin', body: 'hi', altText: '', mediaUrl: null, timeoutMs: 500 }),
    ).rejects.toThrow(/BUFFER_ACCESS_TOKEN/)
    expect(spy).not.toHaveBeenCalled()
  })

  it('returns Buffer\u2019s update id as the receipt', async () => {
    const b = await loadWith({ BUFFER_ACCESS_TOKEN: 'tok', BUFFER_PROFILE_ID_LINKEDIN: 'p1' })
    stubGraphql({ createPost: { post: { id: 'upd-999' } } })
    const receipt = await b.dispatch({
      platform: 'linkedin',
      body: 'hello world',
      altText: 'a chart',
      mediaUrl: null,
      timeoutMs: 500,
    })
    expect(receipt.externalId).toBe('upd-999')
    // Buffer's own record, not a fabricated platform permalink.
    expect(receipt.url).toContain('buffer.com')
  })

  it('fails loudly when Buffer confirms no update', async () => {
    const b = await loadWith({ BUFFER_ACCESS_TOKEN: 'tok', BUFFER_PROFILE_ID_LINKEDIN: 'p1' })
    stubGraphql({ createPost: { message: 'channel disconnected' } })
    await expect(
      b.dispatch({ platform: 'linkedin', body: 'x', altText: '', mediaUrl: null, timeoutMs: 500 }),
    ).rejects.toThrow(/channel disconnected/)
  })

  it('translates a 401 into an instruction naming the key', async () => {
    const b = await loadWith({ BUFFER_ACCESS_TOKEN: 'bad', BUFFER_PROFILE_ID_LINKEDIN: 'p1' })
    stubGraphql({}, 401)
    await expect(
      b.dispatch({ platform: 'linkedin', body: 'x', altText: '', mediaUrl: null, timeoutMs: 500 }),
    ).rejects.toThrow(/BUFFER_ACCESS_TOKEN/)
  })
})

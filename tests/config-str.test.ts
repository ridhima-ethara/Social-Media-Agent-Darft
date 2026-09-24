/**
 * `str()` — BLANK IS ABSENT.
 *
 * The single most load-bearing behaviour in `server/src/config.ts`, and the one
 * with the worst failure mode if it regresses: `PARALLEL_API_KEY=` written as a
 * bare key IS present in `process.env`, as the empty string. If `str()` returned
 * it, every `isConfigured()` built on `has()` would answer true, and the product
 * would report a credential it does not have — then fail at call time, three
 * minutes into a run, blaming the vendor.
 *
 * Tested through the PUBLIC config surface rather than by exporting the private
 * `str()`. The contract that matters is "a blank key behaves exactly like a key
 * that is not there", and that is a statement about `config.*`, not about a
 * helper. Testing the getters also proves the readers are genuinely lazy, which
 * is what lets an adapter answer honestly after the process has started.
 */

import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const KEYS = [
  'GCP_TEXT_MODEL',
  'GCP_API_KEY',
  'GCP_SERVICE_ACCOUNT_JSON',
  'APIFY_API_TOKEN',
  'PARALLEL_API_KEY',
  'EMBEDDING_MODEL',
  'WORKSPACE_SLUG',
  'PORT',
] as const

let saved: Record<string, string | undefined> = {}

beforeEach(() => {
  saved = {}
  for (const key of KEYS) saved[key] = process.env[key]
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
})

describe('config.str() — blank is absent', () => {
  it('falls back to the default when a key is blank, exactly as when it is unset', async () => {
    const { config } = await import('../server/src/config')

    process.env.GCP_TEXT_MODEL = 'some-other-model'
    expect(config.gcp.textModel).toBe('some-other-model')

    // Blank — the case that matters. A bare `KEY=` line in a .env file.
    process.env.GCP_TEXT_MODEL = ''
    const whenBlank = config.gcp.textModel

    delete process.env.GCP_TEXT_MODEL
    const whenUnset = config.gcp.textModel

    expect(whenBlank).toBe(whenUnset)
    expect(whenBlank).not.toBe('')
  })

  it('treats whitespace as blank, so an accidental space is not a value', async () => {
    const { config } = await import('../server/src/config')

    process.env.WORKSPACE_SLUG = '   '
    expect(config.core.workspaceSlug).toBe('ethara')
  })

  it('reports a blank credential as NOT configured', async () => {
    const { config } = await import('../server/src/config')

    process.env.PARALLEL_API_KEY = ''
    expect(config.parallel.configured).toBe(false)

    process.env.PARALLEL_API_KEY = 'a-real-looking-key'
    expect(config.parallel.configured).toBe(true)
  })

  it('strips a trailing inline comment, which dotenv preserves for unquoted values', async () => {
    const { config } = await import('../server/src/config')

    process.env.EMBEDDING_MODEL = 'gemini-embedding-001 # the hosted embedder'
    expect(config.embeddings.model).toBe('gemini-embedding-001')
  })

  it('falls back to the default for an unparseable integer rather than NaN', async () => {
    const { config } = await import('../server/src/config')

    process.env.PORT = 'not-a-number'
    expect(config.core.port).toBe(4001)

    process.env.PORT = ''
    expect(config.core.port).toBe(4001)
  })

  it('reads lazily, so a key filled in after boot is seen without a restart', async () => {
    const { config } = await import('../server/src/config')

    delete process.env.GCP_API_KEY
    delete process.env.GCP_SERVICE_ACCOUNT_JSON
    expect(config.embeddings.configured).toBe(false)

    process.env.GCP_API_KEY = 'a-real-looking-key'
    expect(config.embeddings.configured).toBe(true)
  })
})

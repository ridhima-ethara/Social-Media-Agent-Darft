/**
 * ONE HOME PER FACT.
 *
 * The port, the database name and the API base each used to be stated in several
 * files that disagreed. The consequences were not cosmetic: `server/.env.example`
 * named database `ethara_sma` while docker-compose created `ethara_socialai`, so
 * copying the example file as the README instructs produced a URL pointing at a
 * database nothing had created — and the API refused to start for a reason no
 * message explained.
 *
 * These tests read the OTHER files off disk rather than restating their values,
 * which is the only way a test like this can hold. Hard-coding 4001 here would
 * make this a fourth home for the number.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

/** `KEY=value` out of a dotenv-style file, ignoring comments. */
function envValue(body: string, key: string): string | undefined {
  for (const line of body.split('\n')) {
    if (/^\s*#/.test(line)) continue
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`).exec(line)
    if (match) return (match[1] ?? '').replace(/\s+#.*$/, '').replace(/^["']|["']$/g, '').trim()
  }
  return undefined
}

/** The database name at the end of a postgres connection string. */
const databaseOf = (url: string): string | undefined => /\/([^/?]+)(\?|$)/.exec(url)?.[1]

describe('the database name has one home', () => {
  const compose = read('docker-compose.yml')

  /** `POSTGRES_DB: ${POSTGRES_DB:-ethara_socialai}` → `ethara_socialai`. */
  const composeDatabase = /POSTGRES_DB:\s*\$\{POSTGRES_DB:-([a-z0-9_]+)\}/i.exec(compose)?.[1]

  it('docker-compose.yml declares one', () => {
    expect(composeDatabase).toBeDefined()
  })

  it("config.ts's default names the database docker-compose creates", async () => {
    const { config } = await import('../server/src/config')
    const saved = process.env.DATABASE_URL
    delete process.env.DATABASE_URL
    try {
      expect(databaseOf(config.core.databaseUrl)).toBe(composeDatabase)
    } finally {
      if (saved === undefined) delete process.env.DATABASE_URL
      else process.env.DATABASE_URL = saved
    }
  })

  it('server/.env.example names the same database', () => {
    const url = envValue(read('server/.env.example'), 'DATABASE_URL')
    expect(url).toBeDefined()
    expect(databaseOf(url as string)).toBe(composeDatabase)
  })

  it('.env.docker.example names the same database', () => {
    expect(envValue(read('.env.docker.example'), 'POSTGRES_DB')).toBe(composeDatabase)
  })
})

describe('the API port has one home', () => {
  const compose = read('docker-compose.yml')
  const composePort = /PORT:\s*'?(\d+)'?/.exec(compose)?.[1]

  it('docker-compose.yml declares one', () => {
    expect(composePort).toBeDefined()
  })

  it("config.ts's default matches docker-compose", async () => {
    const { config } = await import('../server/src/config')
    const saved = process.env.PORT
    delete process.env.PORT
    try {
      expect(String(config.core.port)).toBe(composePort)
    } finally {
      if (saved === undefined) delete process.env.PORT
      else process.env.PORT = saved
    }
  })

  it('server/.env.example states the same port', () => {
    expect(envValue(read('server/.env.example'), 'PORT')).toBe(composePort)
  })

  it("nginx proxies to the same port in the container image", () => {
    const nginx = read('docker/nginx.conf')
    expect(nginx).toContain(`:${composePort}`)
  })

  it('vite.config.ts derives the proxy target instead of hard-coding it', () => {
    const vite = read('vite.config.ts')
    expect(vite).toMatch(/target:\s*`http:\/\/127\.0\.0\.1:\$\{API_PORT\}`/)
    // A literal four-digit port in the proxy target would be a second home.
    expect(vite).not.toMatch(/target:\s*'http:\/\/127\.0\.0\.1:\d{4}'/)
  })
})

describe('the API base is relative, so the bundle travels', () => {
  it('src/lib/api.ts defaults to /api rather than an absolute origin', () => {
    const source = read('src/lib/api.ts')
    expect(source).toMatch(/\|\|\s*'\/api'/)
    expect(source).not.toMatch(/\?\?\s*'http:\/\/localhost:\d+\/api'/)
  })

  it('.env.example does not ship an absolute VITE_API_URL', () => {
    const body = read('.env.example')
    // Documented as an override in comments is fine; an active assignment is not.
    expect(envValue(body, 'VITE_API_URL')).toBeUndefined()
  })

  it('the root .env, if present, does not pin an absolute localhost URL', () => {
    const path = join(ROOT, '.env')
    if (!existsSync(path)) return
    const value = envValue(readFileSync(path, 'utf8'), 'VITE_API_URL')
    if (value === undefined || value === '') return
    expect(
      value,
      'An absolute VITE_API_URL breaks LAN access — a phone resolves localhost to itself. ' +
        'Leave it unset so the relative /api base and the dev proxy are used.',
    ).not.toMatch(/^https?:\/\/(localhost|127\.0\.0\.1)/)
  })
})

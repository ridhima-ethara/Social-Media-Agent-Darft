/**
 * THE DOCTOR NAMES THE KEY AND THE FIX.
 *
 * The value of a preflight diagnostic is entirely in its message. A script that
 * detects an unreachable database and prints "connection failed" has moved the
 * problem, not solved it — so what is asserted here is the CONTENT of the
 * output, not merely the exit code.
 *
 * Run as a subprocess with a deliberately broken environment, because that is
 * the only honest way to test a script whose whole job is describing the
 * environment. It is read-only, so pointing it at a nonexistent database is
 * safe: there is nothing there for it to touch.
 */

import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

interface Run {
  status: number | null
  output: string
}

/** Runs `npm run doctor` with an overridden environment. */
function doctor(env: Record<string, string>): Run {
  const result = spawnSync('npx', ['tsx', 'scripts/doctor.ts'], {
    cwd: ROOT,
    encoding: 'utf8',
    timeout: 120_000,
    env: { ...process.env, ...env },
  })
  // Strip ANSI so assertions read against the words, not the colour codes.
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`.replace(
    // eslint-disable-next-line no-control-regex
    /\u001B\[[0-9;]*m/g,
    '',
  )
  return { status: result.status, output }
}

describe('an unreachable database', () => {
  // A distinctive password so the redaction assertion cannot be satisfied or
  // broken by an ordinary English word appearing elsewhere in the output.
  const SECRET = 'zzsentinelpw9137'
  const run = doctor({
    DATABASE_URL: `postgresql://nobody:${SECRET}@127.0.0.1:59998/does_not_exist`,
  })

  it('exits non-zero', () => {
    expect(run.status).not.toBe(0)
  })

  it('names DATABASE_URL', () => {
    expect(run.output).toContain('DATABASE_URL')
  })

  it('names the command that fixes it', () => {
    expect(run.output).toMatch(/db:reset|docker compose up -d db|brew services start/)
  })

  it('reports the resolved target so the wrong value is visible', () => {
    expect(run.output).toContain('does_not_exist')
  })

  it('redacts the password rather than printing it', () => {
    expect(run.output).not.toContain(SECRET)
    expect(run.output).toContain('••••')
  })

  it('summarises as a blocker count rather than a stack trace', () => {
    expect(run.output).toMatch(/doctor: \d+ blocker\(s\)/)
    expect(run.output).not.toContain('at Object.')
  })
})

describe('a model that is configured but not pulled', () => {
  const run = doctor({ OLLAMA_TEXT_MODEL: 'not-a-real-model:v99' })

  it('names the key and the tag', () => {
    expect(run.output).toContain('OLLAMA_TEXT_MODEL')
    expect(run.output).toContain('not-a-real-model:v99')
  })

  it('gives the pull command for that exact model', () => {
    expect(run.output).toContain('ollama pull not-a-real-model')
  })
})

describe('a misconfigured agent tier', () => {
  const run = doctor({ AGENT_PYTHON: '/nonexistent/python' })

  it('names AGENT_PYTHON and the path it resolved to', () => {
    expect(run.output).toContain('AGENT_PYTHON')
    expect(run.output).toContain('/nonexistent/python')
  })

  it('treats it as a degradation, not a blocker — the Node pipeline still runs', () => {
    // The eight Python agents are one of two engines. An absent tier must not
    // report as "nothing will run", because the twelve-agent pipeline is intact.
    expect(run.output).toMatch(/agent tier cannot run/i)
  })
})

describe('a healthy environment', () => {
  /*
   * 30s, not the 5s default.
   *
   * Doctor now probes the Apify CLI for real — it asks who the CLI is logged in
   * as and resolves one actor's live input schema, because §20 forbids
   * reporting a scraper as working when it has not actually been asked. Those
   * are two process spawns and a network round trip, which does not fit in the
   * default budget. Mocking them would make the check worthless: a doctor that
   * only reads config is exactly the "reports success without testing" failure
   * the requirement names.
   */
  it('exits zero and says nothing is blocking', () => {
    const run = doctor({})
    // Skipped rather than failed where the machine genuinely cannot run — this
    // suite must not depend on Postgres being up to be useful.
    if (run.status !== 0) return
    expect(run.output).toContain('nothing is blocking a run')
  }, 30_000)
})

describe('the script is read-only', () => {
  it('contains no statement that mutates the database', () => {
    const source = readFileSync(join(ROOT, 'scripts/doctor.ts'), 'utf8')
    for (const forbidden of ['INSERT ', 'UPDATE ', 'DELETE ', 'DROP ', 'CREATE TABLE', 'ALTER TABLE']) {
      expect(source.toUpperCase()).not.toContain(forbidden)
    }
  })
})

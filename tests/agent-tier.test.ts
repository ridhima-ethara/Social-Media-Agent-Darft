/**
 * THE AGENT TIER RESOLVER.
 *
 * The behaviour under test is "resolves the same way regardless of where the
 * process was launched from", which is precisely what the old
 * `join(process.cwd(), '..', ...)` did not do. So every test here changes the
 * working directory and asserts the answer does not move.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

const KEYS = ['AGENT_PYTHON', 'AGENT_BACKEND_ROOT'] as const
let saved: Record<string, string | undefined> = {}
let cwd = ''

beforeEach(() => {
  saved = {}
  for (const key of KEYS) saved[key] = process.env[key]
  cwd = process.cwd()
})

afterEach(() => {
  for (const key of KEYS) {
    if (saved[key] === undefined) delete process.env[key]
    else process.env[key] = saved[key]
  }
  process.chdir(cwd)
})

describe('the derived default', () => {
  it('points at the venv inside <repo>/backend', async () => {
    delete process.env.AGENT_PYTHON
    delete process.env.AGENT_BACKEND_ROOT
    const { agentPython, agentApiScript, backendRoot } = await import(
      '../server/src/integrations/agent-tier'
    )

    expect(backendRoot()).toBe(join(ROOT, 'backend'))
    expect(agentPython()).toBe(join(ROOT, 'backend', '.venv', 'bin', 'python'))
    expect(agentApiScript()).toBe(join(ROOT, 'backend', 'api.py'))
  })

  it('resolves identically from the repo root and from server/', async () => {
    delete process.env.AGENT_PYTHON
    delete process.env.AGENT_BACKEND_ROOT
    const { agentPython } = await import('../server/src/integrations/agent-tier')

    process.chdir(ROOT)
    const fromRoot = agentPython()

    process.chdir(join(ROOT, 'server'))
    const fromServer = agentPython()

    process.chdir(join(ROOT, 'backend'))
    const fromBackend = agentPython()

    expect(fromServer).toBe(fromRoot)
    expect(fromBackend).toBe(fromRoot)
  })

  it('spawns with the repo root as cwd, stated rather than inherited', async () => {
    const { agentCwd } = await import('../server/src/integrations/agent-tier')
    process.chdir(join(ROOT, 'server'))
    expect(agentCwd()).toBe(ROOT)
  })
})

describe('the explicit override', () => {
  it('AGENT_PYTHON wins over the derived default', async () => {
    process.env.AGENT_PYTHON = '/opt/pythons/3.14/bin/python'
    const { agentPython } = await import('../server/src/integrations/agent-tier')
    expect(agentPython()).toBe('/opt/pythons/3.14/bin/python')
  })

  it('a relative AGENT_PYTHON resolves against the repo root, not the cwd', async () => {
    process.env.AGENT_PYTHON = 'backend/.venv/bin/python'
    const { agentPython } = await import('../server/src/integrations/agent-tier')

    process.chdir(join(ROOT, 'server'))
    expect(agentPython()).toBe(join(ROOT, 'backend', '.venv', 'bin', 'python'))
  })

  it('AGENT_BACKEND_ROOT moves both the interpreter and the script', async () => {
    delete process.env.AGENT_PYTHON
    process.env.AGENT_BACKEND_ROOT = '/srv/ethara-agents'
    const { agentPython, agentApiScript } = await import(
      '../server/src/integrations/agent-tier'
    )

    expect(agentPython()).toBe('/srv/ethara-agents/.venv/bin/python')
    expect(agentApiScript()).toBe('/srv/ethara-agents/api.py')
  })

  it('a blank override falls back to the derived default', async () => {
    process.env.AGENT_PYTHON = ''
    const { agentPython } = await import('../server/src/integrations/agent-tier')
    expect(agentPython()).toBe(join(ROOT, 'backend', '.venv', 'bin', 'python'))
  })
})

describe('the missing-interpreter message', () => {
  it('names AGENT_PYTHON when the override is wrong', async () => {
    process.env.AGENT_PYTHON = '/nonexistent/python'
    const { isConfigured, unavailableReason } = await import(
      '../server/src/integrations/agent-tier'
    )

    expect(isConfigured()).toBe(false)
    const reason = unavailableReason()
    expect(reason).toContain('AGENT_PYTHON')
    expect(reason).toContain('/nonexistent/python')
    // It must say what to do, not merely what is wrong.
    expect(reason.toLowerCase()).toMatch(/correct the key|unset it/)
  })

  it('names the venv command when nothing is overridden and the venv is absent', async () => {
    delete process.env.AGENT_PYTHON
    process.env.AGENT_BACKEND_ROOT = '/nonexistent/backend'
    const { isConfigured, unavailableReason } = await import(
      '../server/src/integrations/agent-tier'
    )

    expect(isConfigured()).toBe(false)
    const reason = unavailableReason()
    expect(reason).toContain('/nonexistent/backend')
    expect(reason).toContain('venv')
    expect(reason).toContain('requirements.txt')
  })

  it('agentSpawn returns the reason instead of throwing', async () => {
    process.env.AGENT_PYTHON = '/nonexistent/python'
    const { agentSpawn } = await import('../server/src/integrations/agent-tier')

    const outcome = agentSpawn(['brain'])
    expect('error' in outcome).toBe(true)
    if ('error' in outcome) expect(outcome.error).toContain('AGENT_PYTHON')
  })

  it('agentSpawn returns a runnable command when the tier is present', async () => {
    delete process.env.AGENT_PYTHON
    delete process.env.AGENT_BACKEND_ROOT
    const { agentSpawn, isConfigured } = await import('../server/src/integrations/agent-tier')

    // Only meaningful on a machine that has built the venv; skip rather than
    // fail, so a Node-only contributor is not blocked by a missing tier.
    if (!isConfigured()) return

    const outcome = agentSpawn(['brain'])
    expect('error' in outcome).toBe(false)
    if (!('error' in outcome)) {
      expect(existsSync(outcome.python)).toBe(true)
      expect(outcome.args[0]).toBe(join(ROOT, 'backend', 'api.py'))
      expect(outcome.cwd).toBe(ROOT)
    }
  })
})

describe('no call site rebuilds the path itself', () => {
  it('api.ts and brain-bridge.ts derive nothing from process.cwd()', () => {
    for (const file of ['server/src/api.ts', 'server/src/agents/brain-bridge.ts']) {
      const body = readFileSync(join(ROOT, file), 'utf8')
      expect(body, `${file} still builds an agent path from the working directory`).not.toMatch(
        /join\(process\.cwd\(\),\s*'\.\.'/,
      )
    }
  })
})

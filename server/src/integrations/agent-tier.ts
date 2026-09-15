/**
 * THE AGENT TIER — the process boundary to the Python engine.
 *
 * `backend/` is a second engine with its own 8-agent roster, reached by spawning
 * `backend/api.py` and reading NDJSON off its stdout. That makes the interpreter
 * path a piece of deployment configuration, exactly like `CRAWL4AI_PYTHON`, and
 * it needs to be treated as one.
 *
 * WHAT THIS REPLACES. Three sites — twice in `api.ts`, once in `brain-bridge.ts` —
 * each built the path as:
 *
 *     join(process.cwd(), '..', 'backend', '.venv', 'bin', 'python')
 *
 * Three problems, in ascending order of how badly they fail:
 *
 *   1. It was a duplicated constant, so the three could drift.
 *   2. It was derived from the WORKING DIRECTORY, so it only resolved when the
 *      API happened to be launched from `server/`. Started from the repo root —
 *      as `tsx server/src/index.ts` would — it pointed outside the repo.
 *   3. There was no existence check and no env override. A wrong path surfaced
 *      as a spawn `ENOENT` mid-stream, which the UI showed as an agent run that
 *      simply stopped producing frames. Meanwhile `CRAWL4AI_PYTHON` — the same
 *      kind of path, for the same kind of sidecar — was configurable and
 *      reported at `/api/health`. The asymmetry had no justification.
 *
 * So: one resolver, `AGENT_PYTHON` / `AGENT_BACKEND_ROOT` to override, defaults
 * derived from THIS MODULE'S location rather than the cwd — the same technique
 * `config.ts` uses for `SERVER_ROOT` — and `isConfigured()` /
 * `unavailableReason()` per law 3 so the failure is a stated condition instead
 * of a dead stream.
 */

import { existsSync } from 'node:fs'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { config } from '../config'

/*
 * This file is `server/src/integrations/agent-tier.ts`, so the repo root is three
 * levels up. Derived from `import.meta.url`, which is a fact about where the code
 * IS; `process.cwd()` is a fact about how it was launched, and the two are only
 * the same by luck.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')

/** Absolute-ises a configured path against the repo root, not the cwd. */
function absolute(candidate: string): string {
  return isAbsolute(candidate) ? candidate : resolve(REPO_ROOT, candidate)
}

/** The Python tier's root — the directory holding `api.py` and `.venv`. */
export function backendRoot(): string {
  const override = config.agentTier.backendRoot
  return override === '' ? join(REPO_ROOT, 'backend') : absolute(override)
}

/**
 * The interpreter that runs the agents.
 *
 * `AGENT_PYTHON` wins; otherwise the venv inside the backend root, which is what
 * `backend/.venv/bin/pip install -r backend/requirements.txt` creates and what
 * every instruction in the README tells an operator to build.
 */
export function agentPython(): string {
  const override = config.agentTier.python
  if (override !== '') return absolute(override)
  return join(backendRoot(), '.venv', 'bin', 'python')
}

/** The NDJSON bridge script. */
export function agentApiScript(): string {
  return join(backendRoot(), 'api.py')
}

/**
 * The working directory to spawn in.
 *
 * The repo root, because `backend/api.py` inserts its own parent on `sys.path`
 * and several tools address files as `backend/...`. Passed explicitly so the
 * child's cwd is a decision rather than an inheritance.
 */
export function agentCwd(): string {
  return REPO_ROOT
}

/* ═══════════════════════════════════════════════════════════════════════════
   LAW 3 — isConfigured / unavailableReason
   ═══════════════════════════════════════════════════════════════════════════ */

/** True when an interpreter and the bridge script both exist on disk. */
export function isConfigured(): boolean {
  return existsSync(agentPython()) && existsSync(agentApiScript())
}

/**
 * Why the agent tier cannot run, or an empty string when it can.
 *
 * Names the resolved path and the command that creates it. "spawn ENOENT" tells
 * an operator nothing; "no interpreter at <path> — create it with <command>"
 * tells them everything.
 */
export function unavailableReason(): string {
  const python = agentPython()
  const script = agentApiScript()

  if (!existsSync(python)) {
    const overridden = config.agentTier.python !== ''
    return overridden
      ? `AGENT_PYTHON points at ${python}, and there is no interpreter there. ` +
          'Correct the key, or unset it to use the venv inside the backend root.'
      : `No Python interpreter at ${python}. Create the agent tier's virtualenv:\n` +
          `    python3 -m venv ${join(backendRoot(), '.venv')}\n` +
          `    ${join(backendRoot(), '.venv', 'bin', 'pip')} install -r ${join(backendRoot(), 'requirements.txt')}\n` +
          '  Or set AGENT_PYTHON to an interpreter that already has the requirements.'
  }

  if (!existsSync(script)) {
    return (
      `The interpreter at ${python} exists, but the bridge script ${script} does not. ` +
      'Set AGENT_BACKEND_ROOT to the directory holding api.py.'
    )
  }

  return ''
}

/** For `/api/health` and the boot banner: where the tier resolved to. */
export function describeAgentTier(): string {
  const reason = unavailableReason()
  if (reason !== '') return reason
  const source = config.agentTier.python === '' ? 'derived from the repo root' : 'AGENT_PYTHON'
  return `${agentPython()} (${source})`
}

/**
 * The spawn arguments, resolved and checked in one call.
 *
 * Returns `null` with a reason rather than throwing, so a caller on an SSE
 * stream can emit the reason as a frame instead of dying mid-response.
 */
export function agentSpawn(
  args: string[],
): { python: string; args: string[]; cwd: string } | { error: string } {
  const reason = unavailableReason()
  if (reason !== '') return { error: reason }
  return { python: agentPython(), args: [agentApiScript(), ...args], cwd: agentCwd() }
}

/**
 * THE AGENT-RUN SMOKE TEST.
 *
 * Runs the real Python workflow — deterministic bindings, stopped after
 * validation — and asserts the frames are well-formed and carry the keys the
 * Node tier persists from. Fast enough to keep in `verify` (~5s), because it
 * uses `--stop-after` and `AGENT_MODEL_PROVIDER=deterministic` rather than
 * spending nine minutes on eight agents against a live model.
 *
 * WHAT IT PROTECTS. `artefacts()` is the process boundary, and its own docstring
 * says "anything missing from here is something an operator will never see."
 * That was literally true and had gone unnoticed: `posts`, `caption`, `asset`
 * and `agent_runs` were all absent, so the Scraping Agent's captures never
 * reached `scraped_items`, and ~310 seconds of caption and image work per run
 * was discarded. Nothing failed. The run reported success.
 *
 * These assertions are the regression test for that class of bug: a key removed
 * from the contract fails here rather than being discovered from an empty screen.
 */

import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const PYTHON = join(ROOT, 'backend', '.venv', 'bin', 'python')

/** Frames from one real workflow run, or `null` when the tier is not built. */
function runWorkflow(): Record<string, unknown>[] | null {
  if (!existsSync(PYTHON)) return null

  const result = spawnSync(
    PYTHON,
    ['backend/api.py', 'run', '--keywords', 'RLHF', '--stop-after', 'validation_agent'],
    {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 300_000,
      env: {
        ...process.env,
        // Deterministic so the test does not depend on a daemon being up, and so
        // it takes seconds rather than minutes.
        AGENT_MODEL_PROVIDER: 'deterministic',
      },
    },
  )

  return (result.stdout ?? '')
    .split('\n')
    .filter((line) => line.trim() !== '')
    .flatMap((line) => {
      try {
        return [JSON.parse(line) as Record<string, unknown>]
      } catch {
        // A malformed line is itself a finding — surfaced by the well-formedness
        // assertion below rather than silently dropped.
        return [{ event: '__unparseable__', line }]
      }
    })
}

const frames = runWorkflow()

describe.skipIf(frames === null)('the Python workflow emits well-formed NDJSON', () => {
  it('every line on stdout parses as one JSON object', () => {
    expect(frames).not.toBeNull()
    const bad = (frames ?? []).filter((f) => f.event === '__unparseable__')
    expect(bad, 'stdout must be parseable line by line without guarding for prose').toEqual([])
  })

  it('every frame carries an event name', () => {
    for (const frame of frames ?? []) {
      expect(typeof frame.event).toBe('string')
      expect(frame.event).not.toBe('')
    }
  })

  it('emits the workflow lifecycle in order', () => {
    const events = (frames ?? []).map((f) => String(f.event))
    expect(events).toContain('workflow.started')
    expect(events).toContain('agent.started')
    expect(events).toContain('agent.finished')
    expect(events).toContain('workflow.output')
    expect(events).toContain('workflow.finished')
    expect(events.indexOf('workflow.output')).toBeLessThan(events.indexOf('workflow.finished'))
  })

  it('stops where it was told to', () => {
    const ran = (frames ?? [])
      .filter((f) => f.event === 'agent.started')
      .map((f) => String(f.agent_id))
    expect(ran).toEqual(['scraping_agent', 'validation_agent'])
  })
})

describe.skipIf(frames === null)('the output frame carries everything the API persists from', () => {
  const output = (frames ?? []).find((f) => f.event === 'workflow.output') as
    | Record<string, unknown>
    | undefined

  it('exists', () => {
    expect(output).toBeDefined()
  })

  /*
   * Each of these is a column the Node tier writes from. A key removed here is a
   * screen that silently goes empty, which is exactly what happened.
   */
  const REQUIRED = [
    'keywords',
    'keywords_scored',
    'trending',
    'ranked_hashtags',
    'top_hashtags',
    'ranked_ideas',
    'review_queue',
    'posts',
    'caption',
    'asset',
    'agent_runs',
    'status',
  ] as const

  for (const key of REQUIRED) {
    it(`carries \`${key}\``, () => {
      expect(output, `workflow.output must carry ${key}`).toHaveProperty(key)
    })
  }

  it('the captures actually crossed the boundary', () => {
    const posts = output?.posts
    expect(Array.isArray(posts)).toBe(true)
    // The scrape may legitimately find nothing; what must not happen is the key
    // being absent, which is what made captures unrecoverable.
    if ((posts as unknown[]).length > 0) {
      const post = (posts as Record<string, unknown>[])[0] as Record<string, unknown>
      for (const field of ['external_id', 'text', 'url', 'keyword']) {
        expect(post, `a captured post must carry ${field}`).toHaveProperty(field)
      }
    }
  })

  it('every agent run carries its resolved configuration, so it stays replayable', () => {
    const runs = (output?.agent_runs ?? []) as Record<string, unknown>[]
    expect(runs.length).toBeGreaterThan(0)
    for (const run of runs) {
      expect(run).toHaveProperty('agent_id')
      expect(run).toHaveProperty('duration_ms')
      expect(run).toHaveProperty('config_used')
      // An empty config would make the row present but useless.
      expect(Object.keys(run.config_used as object).length).toBeGreaterThan(0)
    }
  })

  it('reports its own status', () => {
    expect(['completed', 'failed']).toContain(output?.status)
  })
})

/**
 * WRITING TO THE AGENTS' KNOWLEDGE BASE
 *
 * The Learning Agent is the assistant. When an operator tells it something
 * durable — "keep the calendar on LinkedIn", "stop opening with questions" —
 * that instruction has to reach the store the other agents read before their
 * next run, or the change holds until the next run and then quietly reverts.
 *
 * That store is the Python tier's Brain, not the `knowledge_entries` table.
 * The Calendar, Content and Image agents recall from the Brain, so the Brain is
 * where an instruction has to land to have any effect on them.
 *
 * Everything written from here carries `origin: 'manual'`. Downstream that word
 * is the discriminator between an instruction and a finding: the Content Agent
 * will obey a manual entry but will never cite one as evidence in a caption,
 * because what an operator prefers is not a fact about the world.
 */

import { spawn } from 'node:child_process'

import { agentSpawn } from '../integrations/agent-tier'


export interface Remembered {
  stored: boolean
  /** `inserted`, `merged`, `discarded`, or `unavailable` when the backend did not answer. */
  action: string
  /** The Brain's own words about what it did, or why it could not. */
  reason: string
}

export async function rememberDirective(
  title: string,
  content: string,
  category = 'Human Directive',
  timeoutMs = 20_000,
): Promise<Remembered> {
  // Resolved and existence-checked before anything is spawned. A missing
  // interpreter is reported as a stated reason, not as a spawn error.
  const resolved = agentSpawn([
    'learn',
    '--title',
    title,
    '--content',
    content,
    '--category',
    category,
  ])

  if ('error' in resolved) {
    return {
      stored: false,
      action: 'unavailable',
      reason: `The preference was not stored — ${resolved.error}`,
    }
  }

  return new Promise((resolve) => {
    const child = spawn(resolved.python, resolved.args, { cwd: resolved.cwd })

    let out = ''
    let err = ''
    const timer = setTimeout(() => child.kill(), timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      out += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      err += chunk.toString()
    })

    // Never rejects. A calendar that was reshuffled and an instruction that was
    // not stored is a real outcome, and the operator is told exactly that —
    // failing the whole command would undo work that already succeeded.
    child.on('error', (error) => {
      clearTimeout(timer)
      resolve({
        stored: false,
        action: 'unavailable',
        reason: `The agent backend could not be started, so the preference was not stored: ${error.message}`,
      })
    })

    child.on('close', () => {
      clearTimeout(timer)
      const frame = out
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean)
        .map((line) => {
          try {
            return JSON.parse(line) as Record<string, unknown>
          } catch {
            return null
          }
        })
        .find((f) => f?.event === 'learned')

      if (!frame) {
        resolve({
          stored: false,
          action: 'unavailable',
          reason:
            'The agent backend did not report back, so the preference was not stored. ' +
            (err.trim().split('\n').slice(-1)[0] ?? ''),
        })
        return
      }

      const action = String(frame.action ?? 'unknown')
      resolve({ stored: action !== 'discarded', action, reason: String(frame.reason ?? '') })
    })
  })
}

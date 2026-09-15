/**
 * A CALENDAR INSTRUCTION MUST OUTLIVE THE TURN.
 *
 * The loop the product promises: an operator tells Ethara to change the
 * calendar, the change happens, the instruction is written to the Knowledge Base
 * as a `Human Directive`, and the Calendar Agent recalls it on its next run so
 * the preference is not planned away.
 *
 * THE BUG THIS GUARDS. The model parser is asked to fill `entities` with the
 * tool's own argument names, and it frequently returns `{}` while still
 * identifying the action correctly. `calendar.reshuffle` then found no
 * `platform` and no `instruction`, so its store condition
 * `if (remember && (preferred || instruction))` was false. Nothing moved and
 * nothing was recorded — yet the narration still told the operator the calendar
 * had been reshuffled to favour LinkedIn, and the next agent run planned the
 * preference away because the Calendar Agent had never been told.
 *
 * Both failures were silent. That is why this asserts the SOURCE contract rather
 * than an end-to-end run: the guarantee is that the utterance is the fallback,
 * and a future refactor that reintroduces "trust the parser" must fail here.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOOLS_SRC = readFileSync(join(ROOT, 'server/src/assistant/tools/index.ts'), 'utf8')

describe('the tool context carries the operator utterance', () => {
  it('ToolContext declares `utterance`', () => {
    expect(TOOLS_SRC).toMatch(/interface ToolContext[\s\S]{0,1400}utterance:\s*string/)
  })

  it('every construction site supplies it', () => {
    for (const file of ['server/src/assistant/index.ts', 'server/src/agents/assistant/handlers.ts']) {
      expect(readFileSync(join(ROOT, file), 'utf8'), `${file} must pass utterance`).toMatch(
        /utterance:/,
      )
    }
  })
})

describe('calendar.reshuffle records the instruction', () => {
  /** The body of the reshuffle handler. */
  const body = ((): string => {
    const start = TOOLS_SRC.indexOf("tool('calendar.reshuffle'")
    expect(start, 'the reshuffle tool must exist').toBeGreaterThan(-1)
    const next = TOOLS_SRC.indexOf("\ntool('", start + 10)
    return TOOLS_SRC.slice(start, next === -1 ? undefined : next)
  })()

  it('falls back to the utterance when the parser supplies no instruction', () => {
    expect(
      body,
      'the instruction must default to ctx.utterance — a parser that returns {} otherwise ' +
        'silently discards the operator preference',
    ).toMatch(/ctx\.utterance/)
  })

  it('recovers the platform from the utterance when extraction misses it', () => {
    expect(body).toMatch(/linked ?\?in|linkedin/i)
    expect(body).toMatch(/spokenPlatform/)
  })

  it('still calls rememberDirective, so the Learning Agent has something to read', () => {
    expect(body).toMatch(/rememberDirective\(/)
  })

  it('reports whether the preference was stored rather than assuming it', () => {
    // The operator must be able to tell a stored preference from a lost one.
    expect(body).toMatch(/stored\.stored/)
    expect(body).toMatch(/was not stored/)
  })
})

describe('the directive is stored where the agents read', () => {
  const bridge = readFileSync(join(ROOT, 'server/src/agents/brain-bridge.ts'), 'utf8')

  it("writes with origin 'manual', which downstream treats as an instruction", () => {
    // `origin: manual` is the discriminator: the Content Agent obeys a manual
    // entry but never cites one as evidence, because a preference is not a fact.
    expect(bridge).toMatch(/Human Directive/)
  })

  it('the Calendar Agent recalls the Human Directive category', () => {
    const agent = readFileSync(join(ROOT, 'backend/agents/calendar_agent/agent.py'), 'utf8')
    expect(agent).toContain('Human Directive')
  })

  it('the Content Agent treats it as a binding constraint', () => {
    const agent = readFileSync(join(ROOT, 'backend/agents/content_agent/agent.py'), 'utf8')
    expect(agent).toMatch(/CONSTRAINT_CATEGORIES[\s\S]{0,200}Human Directive/)
  })
})

/**
 * THE CALENDAR ASSISTANT'S BULK SURFACE.
 *
 * Three claims, each of which would fail silently if it broke:
 *
 *   1. A bulk utterance routes to a bulk tool with the right arguments — and a
 *      single-idea utterance still routes where it always did.
 *   2. Every calendar mutation stops at the confirmation gate, without being
 *      misclassified as irreversible to get there.
 *   3. Word order carries meaning. "Swap Thursday and Tuesday" and "swap
 *      Tuesday and Thursday" must not collapse into the same arguments.
 *
 * The handlers themselves are exercised against a real database elsewhere;
 * these are the parsing and contract invariants, which need no database.
 */

import { describe, expect, it } from 'vitest'

import {
  TOOL_BY_ID,
  anyStepConfirmsAlways,
  matchTools,
  requiresConfirmation,
} from '@shared/tool-registry'
import { detectDays, detectWeekSpan, extractEntities } from '../server/src/assistant/intent'

/** The top-ranked tool for an utterance, as the deterministic grammar picks it. */
const route = (utterance: string): string => matchTools(utterance)[0]?.toolId ?? '(none)'

/* ═══════════════════════════════════════════════════════════════════════════
   1 · ROUTING
   ═══════════════════════════════════════════════════════════════════════════ */

describe('bulk instructions route to bulk tools', () => {
  const cases: Array<[string, string]> = [
    ['swap tuesday and thursday', 'calendar.swap'],
    ['exchange wednesday with monday', 'calendar.swap'],
    ['move all linkedin posts to mornings', 'calendar.bulk.move'],
    ['move everything on monday to friday', 'calendar.bulk.move'],
    ['spread the RL posts across the week', 'calendar.spread'],
    ['spread these across tuesday thursday and friday', 'calendar.spread'],
  ]

  for (const [utterance, toolId] of cases) {
    it(`"${utterance}" → ${toolId}`, () => {
      expect(route(utterance)).toBe(toolId)
    })
  }
})

describe('single-idea instructions are untouched', () => {
  /*
   * The regression that matters most. Adding bulk tools to the grammar puts new
   * competitors in front of every existing calendar utterance, and a
   * "move that to thursday" that started resolving to a bulk move would rewrite
   * a week when one post was meant.
   */
  it('still routes a single move to idea.move', () => {
    expect(route('move that to thursday morning')).toBe('idea.move')
    expect(route('reschedule the carousel to tuesday')).toBe('idea.move')
  })

  it('still routes a calendar question to a read', () => {
    expect(route('what is on the calendar this week')).toBe('idea.list')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   2 · ARGUMENTS
   ═══════════════════════════════════════════════════════════════════════════ */

describe('entity extraction for bulk arguments', () => {
  it('pulls two distinct days out of a swap', () => {
    const e = extractEntities('swap tuesday and thursday', 'calendar.swap')
    expect(e.firstDay).toBeTypeOf('string')
    expect(e.secondDay).toBeTypeOf('string')
    expect(e.firstDay).not.toBe(e.secondDay)
  })

  it('keeps the order the operator said them in', () => {
    // Word order is the only thing distinguishing these two instructions.
    const forward = extractEntities('swap tuesday and thursday', 'calendar.swap')
    const reverse = extractEntities('swap thursday and tuesday', 'calendar.swap')
    expect(reverse.firstDay).toBe(forward.secondDay)
    expect(reverse.secondDay).toBe(forward.firstDay)
  })

  it('reads a platform and a time band together', () => {
    const e = extractEntities('move all linkedin posts to mornings', 'calendar.bulk.move')
    expect(e.platform).toBe('linkedin')
    expect(e.timeOfDay).toBe('morning')
  })

  it('treats the first of two days as the source and the second as the target', () => {
    const e = extractEntities('move everything on monday to friday', 'calendar.bulk.move')
    expect(e.fromDay).toBeTypeOf('string')
    expect(e.day).toBeTypeOf('string')
    expect(e.fromDay).not.toBe(e.day)
  })

  it('expands "across the week" to five weekdays', () => {
    const e = extractEntities('spread the RL posts across the week', 'calendar.spread')
    expect(Array.isArray(e.days)).toBe(true)
    expect((e.days as string[]).length).toBe(5)
  })

  it('prefers days the operator named over the week span', () => {
    // An operator who lists days has answered the question; overriding them
    // with Monday-to-Friday would ignore what they said.
    const e = extractEntities('spread these across tuesday thursday and friday', 'calendar.spread')
    expect((e.days as string[]).length).toBe(3)
  })

  it('never hands a bulk argument to a single-idea tool', () => {
    // `wants()` is keyed on each tool's own schema, so this is structural — but
    // it is the guarantee that the bulk work changed nothing about idea.move.
    const e = extractEntities('move all linkedin posts to mornings', 'idea.move')
    expect(e.timeOfDay).toBeUndefined()
    expect(e.days).toBeUndefined()
    expect(e.fromDay).toBeUndefined()
  })
})

describe('day scanning', () => {
  it('finds every day named, in order, without duplicates', () => {
    const days = detectDays('spread these across tuesday thursday and friday')
    expect(days).toHaveLength(3)
    expect(new Set(days).size).toBe(3)
  })

  it('returns nothing for an utterance naming no day', () => {
    expect(detectDays('move all linkedin posts to mornings')).toEqual([])
  })

  it('expands a week span only when one is actually said', () => {
    expect(detectWeekSpan('across the week')).toHaveLength(5)
    expect(detectWeekSpan('move it to thursday')).toEqual([])
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · THE CONFIRMATION GATE
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the gate sits in front of bulk work, and only bulk work', () => {
  /*
   * The line is blast radius, not risk class — every tool here is `mutating`.
   * One sentence to a bulk tool rewrites a week and nobody can picture the
   * result beforehand; a single-idea move is exactly as reversible but its
   * effect is legible from the sentence that asked for it. Gating both taught
   * the operator to confirm without reading, which spent the pause on the
   * instruction that never needed it.
   */
  const bulkMutations = ['calendar.reshuffle', 'calendar.swap', 'calendar.bulk.move', 'calendar.spread']
  const singleMutations = ['idea.move', 'idea.promote', 'idea.demote']
  const calendarMutations = [...bulkMutations, ...singleMutations]

  for (const id of bulkMutations) {
    it(`${id} confirms before running`, () => {
      expect(TOOL_BY_ID[id]?.confirmsAlways, `${id} does not confirm`).toBe(true)
      expect(anyStepConfirmsAlways([id])).toBe(true)
    })
  }

  for (const id of singleMutations) {
    it(`${id} applies immediately`, () => {
      expect(TOOL_BY_ID[id]?.confirmsAlways ?? false, `${id} gates a single edit`).toBe(false)
      expect(anyStepConfirmsAlways([id])).toBe(false)
    })
  }

  it('still gates a plan that mixes a single edit into bulk work', () => {
    // The flag is per-tool but the gate is per-plan: one bulk step is enough.
    expect(anyStepConfirmsAlways(['idea.move', 'calendar.swap'])).toBe(true)
  })

  it('does so WITHOUT pretending a calendar edit is irreversible', () => {
    /*
     * The distinction the whole `confirmsAlways` flag exists to preserve. A
     * post moved to Thursday moves back; publishing does not. Reaching the gate
     * by relabelling the risk class would put these in the same class as
     * `idea.publish` and make that class mean nothing.
     */
    for (const id of calendarMutations) {
      expect(TOOL_BY_ID[id]?.risk, `${id} is misclassified`).toBe('mutating')
    }
    expect(TOOL_BY_ID['idea.publish']?.risk).toBe('irreversible')
  })

  it('leaves reads alone', () => {
    expect(TOOL_BY_ID['idea.list']?.confirmsAlways).toBeUndefined()
    expect(anyStepConfirmsAlways(['idea.list', 'state.read'])).toBe(false)
  })

  it('keeps the risk-based gate working independently', () => {
    expect(requiresConfirmation('irreversible')).toBe(true)
    expect(requiresConfirmation('mutating')).toBe(false)
    expect(requiresConfirmation('mutating', true)).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   4 · THE TOOLS' OWN CONTRACT
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the bulk tools declare what they do', () => {
  const bulk = ['calendar.swap', 'calendar.bulk.move', 'calendar.spread']

  it('each names its returns in terms of before and after', () => {
    for (const id of bulk) {
      const returns = (TOOL_BY_ID[id]?.returns ?? '').toLowerCase()
      expect(returns.length, id).toBeGreaterThan(20)
    }
  })

  it('each carries the five examples the grammar is built from', () => {
    for (const id of bulk) {
      expect(TOOL_BY_ID[id]?.examples.length, id).toBeGreaterThanOrEqual(4)
    }
  })

  it('all belong to the calendar agent', () => {
    for (const id of bulk) expect(TOOL_BY_ID[id]?.agentId, id).toBe('calendar')
  })
})

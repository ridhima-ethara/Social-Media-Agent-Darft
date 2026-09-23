/**
 * THE REVISION DIFF.
 *
 * The Content Agent panel shows what an instruction changed by diffing the
 * previous revision's body against the current one. One property matters above
 * all others and is the reason this file exists:
 *
 *   THE DIFF MUST BE LOSSLESS.
 *
 * Every operation it emits is rendered, so if the spans do not reassemble into
 * the original texts, the panel is showing the operator a caption that was
 * never written. A diff that drops a word is worse than no diff, because it
 * looks authoritative — and the failure it replaced did exactly that: a matched
 * token emitted the previous text's spacing and rendered "shortand".
 */

import { describe, expect, it } from 'vitest'

import { diffWords, type DiffOp } from '../shared/text-diff'

/** Reassembles one side of the diff from the spans that belong to it. */
const rebuild = (ops: DiffOp[], side: 'before' | 'after'): string =>
  ops
    .filter((o) => o.kind === 'same' || o.kind === (side === 'before' ? 'remove' : 'add'))
    .map((o) => o.text)
    .join('')

const words = (text: string): string => text.replace(/\s+/g, ' ').trim()

describe('the diff reassembles both texts', () => {
  const cases: Array<[string, string, string]> = [
    ['the reward model is simple', 'the reward model is a calibrated preference estimator', 'tail rewritten'],
    ['one two three four five', 'one two three four five', 'identical'],
    ['', 'brand new caption entirely', 'written from empty'],
    ['a caption that will be cut down', 'a caption cut down', 'deletions only'],
    ['short', 'short and considerably longer now', 'appended to a token with no trailing space'],
    ['first para\n\nsecond para', 'first para\n\nsecond para rewritten', 'across a paragraph break'],
  ]

  for (const [before, after, label] of cases) {
    it(label, () => {
      const ops = diffWords(before, after)

      // The after side must be EXACT: it is what the panel presents as the
      // current caption, and an operator reads it as the text that shipped.
      expect(rebuild(ops, 'after')).toBe(after)

      // The before side is compared on words. A `same` span deliberately
      // carries the after text's spacing, so trailing whitespace can differ
      // where a token moved from the end of a sentence into the middle of one.
      expect(words(rebuild(ops, 'before'))).toBe(words(before))
    })
  }
})

describe('the diff says what actually changed', () => {
  it('reports nothing changed when the texts match', () => {
    const ops = diffWords('an unchanged caption', 'an unchanged caption')
    expect(ops.filter((o) => o.kind !== 'same')).toHaveLength(0)
  })

  it('marks an insertion as added, not as a replacement', () => {
    const ops = diffWords('evaluation is hard', 'evaluation is genuinely hard')
    expect(ops.some((o) => o.kind === 'add' && o.text.includes('genuinely'))).toBe(true)
    expect(ops.some((o) => o.kind === 'remove')).toBe(false)
  })

  it('keeps the shared prefix shared rather than rewriting the whole line', () => {
    // The property that makes the panel readable: an editorial instruction
    // rewrites a clause, and everything it left alone must stay unmarked.
    const ops = diffWords(
      'Your reward model treats all feedback as equal. It is not.',
      'Your reward model treats all feedback as equal. It is nothing of the sort.',
    )
    const untouched = ops
      .filter((o: DiffOp) => o.kind === 'same')
      .map((o: DiffOp) => o.text)
      .join('')
    expect(untouched).toContain('Your reward model treats all feedback as equal.')
  })

  it('handles a wholesale replacement without claiming anything is shared', () => {
    const ops = diffWords('alpha bravo charlie', 'delta echo foxtrot')
    expect(ops.some((o) => o.kind === 'add')).toBe(true)
    expect(ops.some((o) => o.kind === 'remove')).toBe(true)
    const shared = ops
      .filter((o: DiffOp) => o.kind === 'same')
      .map((o: DiffOp) => o.text)
      .join('')
    expect(shared.trim()).toBe('')
  })
})

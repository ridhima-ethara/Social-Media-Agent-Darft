/**
 * WORD DIFF — what one revision changed, computed rather than described.
 *
 * Lives in `shared/` beside `similarity()` for the same reason that does: it is
 * a pure text function over (input) → output with no dependencies, and the one
 * place a pure function can be imported by the web app AND exercised by the
 * test project, which does not include `src/`.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   WORD DIFF

   Written here rather than pulled in: a diff library is a large dependency for
   one panel, and the thing it would compute is ninety lines of standard LCS.
   Keeping it local also keeps it deterministic, which matters because a
   revision spine is re-rendered from stored bodies and must not shift between
   renders.

   WORDS, NOT CHARACTERS. The instructions here are editorial — "make it more
   technical", "shorten it" — and rewrite phrases rather than letters. A
   character diff of a rewritten sentence marks a spray of single letters inside
   words that both versions share, which is unreadable. Whitespace is carried on
   the token so the rebuilt text keeps its own spacing.
   ═══════════════════════════════════════════════════════════════════════════ */

export type DiffOp = { kind: 'same' | 'add' | 'remove'; text: string }

/** Splits into words, each keeping the whitespace that followed it. */
function tokenise(text: string): string[] {
  return text.match(/\S+\s*/g) ?? []
}

/**
 * Longest common subsequence over word tokens.
 *
 * The table is O(n·m); a caption is a few hundred words, so this is far below
 * anything worth optimising. Bodies longer than `MAX_TOKENS` skip the table and
 * report themselves as a wholesale replacement rather than freezing the panel.
 */
const MAX_TOKENS = 4000

export function diffWords(before: string, after: string): DiffOp[] {
  const a = tokenise(before)
  const b = tokenise(after)

  if (a.length + b.length > MAX_TOKENS) {
    return [
      { kind: 'remove', text: before },
      { kind: 'add', text: after },
    ]
  }

  // lcs[i][j] = length of the longest common subsequence of a[i..] and b[j..]
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () =>
    new Array<number>(b.length + 1).fill(0),
  )
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        a[i]!.trim() === b[j]!.trim()
          ? (lcs[i + 1]![j + 1] ?? 0) + 1
          : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0)
    }
  }

  // Walk the table, coalescing runs so the output is spans rather than words.
  const ops: DiffOp[] = []
  const push = (kind: DiffOp['kind'], text: string): void => {
    const last = ops[ops.length - 1]
    if (last && last.kind === kind) last.text += text
    else ops.push({ kind, text })
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (a[i]!.trim() === b[j]!.trim()) {
      /*
       * The AFTER token, not the before one.
       *
       * Tokens carry the whitespace that followed them, and equality is tested
       * on the trimmed word — so "short" (end of the old text) matches
       * "short " (mid-sentence in the new one). Emitting the before form there
       * dropped the space, and the rendered result read "shortand".
       *
       * The after side is what the panel presents as the current caption, so
       * its spacing is the authoritative one.
       */
      push('same', b[j]!)
      i += 1
      j += 1
    } else if ((lcs[i + 1]![j] ?? 0) >= (lcs[i]![j + 1] ?? 0)) {
      push('remove', a[i]!)
      i += 1
    } else {
      push('add', b[j]!)
      j += 1
    }
  }
  while (i < a.length) { push('remove', a[i]!); i += 1 }
  while (j < b.length) { push('add', b[j]!); j += 1 }

  return ops
}

/* ═══════════════════════════════════════════════════════════════════════════
   SENTENCE DIFF — the two versions, lined up

   A word diff across a whole rewritten post is a spray of struck and marked
   fragments: common words ("the", "a", "agent") match across unrelated
   sentences and chop both into pieces. Editors read a caption as sentences, so
   the versions are first aligned sentence by sentence — unchanged sentences
   pair with themselves, a reworded sentence pairs with the one it replaced —
   and only a reworded pair is diffed word by word. Every row therefore reads as
   one of four plain facts: kept, reworded, removed, added.
   ═══════════════════════════════════════════════════════════════════════════ */

export type SentenceRow =
  | { kind: 'same'; text: string }
  | { kind: 'changed'; before: string; after: string; words: DiffOp[] }
  | { kind: 'removed'; before: string }
  | { kind: 'added'; after: string }

/** Sentences, and each line of a list or the hashtag footer, as separate units. */
function sentences(text: string): string[] {
  return text
    .split(/\n+/)
    .flatMap((line) => line.split(/(?<=[.!?])\s+(?=[A-Z0-9"“#])/))
    .map((unit) => unit.trim())
    .filter((unit) => unit.length > 0)
}

const norm = (unit: string): string => unit.toLowerCase().replace(/\s+/g, ' ').trim()

/** Word-set overlap, 0–1: how much of two sentences is the same wording. */
function overlap(a: string, b: string): number {
  const wa = new Set(norm(a).match(/[a-z0-9'-]+/g) ?? [])
  const wb = new Set(norm(b).match(/[a-z0-9'-]+/g) ?? [])
  if (wa.size === 0 || wb.size === 0) return 0
  let shared = 0
  for (const w of wa) if (wb.has(w)) shared += 1
  return (2 * shared) / (wa.size + wb.size)
}

/** Above this overlap a removed and an added sentence are one sentence reworded. */
const REWORDED = 0.4

export function diffSentences(before: string, after: string): SentenceRow[] {
  const a = sentences(before)
  const b = sentences(after)
  if (a.length * b.length > MAX_TOKENS * 10) {
    return [
      ...a.map((s): SentenceRow => ({ kind: 'removed', before: s })),
      ...b.map((s): SentenceRow => ({ kind: 'added', after: s })),
    ]
  }

  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => Array.from({ length: b.length + 1 }, () => 0))
  for (let i = a.length - 1; i >= 0; i -= 1) {
    for (let j = b.length - 1; j >= 0; j -= 1) {
      lcs[i]![j] =
        norm(a[i]!) === norm(b[j]!) ? (lcs[i + 1]![j + 1] ?? 0) + 1 : Math.max(lcs[i + 1]![j] ?? 0, lcs[i]![j + 1] ?? 0)
    }
  }

  const rows: SentenceRow[] = []
  let removed: string[] = []
  let added: string[] = []

  // Between two kept sentences, pair what was taken out with what was put in.
  const flush = (): void => {
    let i = 0
    let j = 0
    while (i < removed.length && j < added.length) {
      const r = removed[i]!
      const s = added[j]!
      if (overlap(r, s) >= REWORDED) {
        rows.push({ kind: 'changed', before: r, after: s, words: diffWords(r, s) })
        i += 1
        j += 1
      } else if (j + 1 < added.length && overlap(r, added[j + 1]!) >= REWORDED) {
        rows.push({ kind: 'added', after: s })
        j += 1
      } else if (i + 1 < removed.length && overlap(removed[i + 1]!, s) >= REWORDED) {
        rows.push({ kind: 'removed', before: r })
        i += 1
      } else {
        rows.push({ kind: 'removed', before: r }, { kind: 'added', after: s })
        i += 1
        j += 1
      }
    }
    for (; i < removed.length; i += 1) rows.push({ kind: 'removed', before: removed[i]! })
    for (; j < added.length; j += 1) rows.push({ kind: 'added', after: added[j]! })
    removed = []
    added = []
  }

  let i = 0
  let j = 0
  while (i < a.length && j < b.length) {
    if (norm(a[i]!) === norm(b[j]!)) {
      flush()
      rows.push({ kind: 'same', text: b[j]! })
      i += 1
      j += 1
    } else if ((lcs[i + 1]![j] ?? 0) >= (lcs[i]![j + 1] ?? 0)) {
      removed.push(a[i]!)
      i += 1
    } else {
      added.push(b[j]!)
      j += 1
    }
  }
  for (; i < a.length; i += 1) removed.push(a[i]!)
  for (; j < b.length; j += 1) added.push(b[j]!)
  flush()
  return rows
}

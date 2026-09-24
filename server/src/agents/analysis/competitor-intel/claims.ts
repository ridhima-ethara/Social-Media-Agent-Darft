/**
 * CLAIMS — how a statement Claude writes becomes a claim in a profile.
 *
 *   · kind is one of fact / source_derived / inference / analysis;
 *   · source ids must be ids the bridge sent — any other id is dropped;
 *   · a fact or source-derived claim left with no source is relabelled
 *     inference: it cannot be presented as fact;
 *   · ranking language ("best competitor", "winner", "#1", a score) is not a
 *     claim this module makes — such a statement is dropped.
 */

import { z } from 'zod'
import { CLAIM_KINDS, type Claim } from '../../../../../shared/competitor-intel'

export const RANKING_LANGUAGE =
  /(?:\b(?:best|worst|top|leading|number\s+one)|#\s?1)\s+(competitor|company|player|rival)\b|\bwinners?\b|\blosers?\b|\bcompetitor\s+score\b|\bscored?\s+\d+(\.\d+)?\s*(\/|out of)\s*\d+|\branked\s+#?\d/i

export const rawClaimSchema = z.object({
  text: z.string().transform((s) => s.replace(/\s+/g, ' ').trim().slice(0, 700)),
  kind: z.enum(CLAIM_KINDS).catch('inference'),
  source_ids: z.array(z.string()).default([]).catch([]),
})
export type RawClaim = z.infer<typeof rawClaimSchema>

/** A lenient list of raw claims: anything unreadable is skipped, not fatal. */
export const claimList = (max: number) =>
  z
    .array(z.unknown())
    .default([])
    .catch([])
    .transform((xs) => xs.map((x) => (typeof x === 'string' ? { text: x, kind: 'inference', source_ids: [] } : x)).map((x) => rawClaimSchema.safeParse(x)).filter((r) => r.success).map((r) => r.data).slice(0, max))

export const optionalClaim = rawClaimSchema.nullable().default(null).catch(null)

export function toClaim(raw: RawClaim | null | undefined, known: ReadonlySet<string>): Claim | null {
  if (!raw || raw.text === '') return null
  if (RANKING_LANGUAGE.test(raw.text)) return null
  const ids = [...new Set(raw.source_ids.map((i) => i.trim()).filter((i) => known.has(i)))]
  const needsSource = raw.kind === 'fact' || raw.kind === 'source_derived'
  return { text: raw.text, kind: needsSource && ids.length === 0 ? 'inference' : raw.kind, source_ids: ids }
}

export function toClaims(raws: readonly RawClaim[], known: ReadonlySet<string>): Claim[] {
  return raws.map((r) => toClaim(r, known)).filter((c): c is Claim => c !== null)
}

/** The first JSON object in a reply (Claude sometimes fences it). */
export function jsonIn(text: string): unknown {
  const body = text.match(/```(?:json)?\s*([\s\S]*?)```/)?.[1] ?? text
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start < 0 || end <= start) return null
  try {
    return JSON.parse(body.slice(start, end + 1))
  } catch {
    return null
  }
}

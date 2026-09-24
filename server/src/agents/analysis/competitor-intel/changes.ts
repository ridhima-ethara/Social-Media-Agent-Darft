/**
 * CHANGE TRACKING — "Changes since previous analysis".
 *
 * Deterministic, over the structured fields the skill says to re-check first
 * (pricing, products, recent announcements, content) and then SEO. Nothing is
 * judged by a model here: a change is a difference between two stored
 * versions, stated as + added / ~ changed / − removed.
 */

import type { CompetitorProfile, ProfileChange } from '../../../../../shared/competitor-intel'
import { NOT_AVAILABLE } from '../../../../../shared/competitor-intel'

const norm = (s: string): string => s.toLowerCase().replace(/[^\p{L}\p{N}$€£.]+/gu, ' ').trim()

/** Word-set overlap, 0–1 — enough to tell a reworded tagline from a new one. */
function overlap(a: string, b: string): number {
  const A = new Set(norm(a).split(' ').filter(Boolean))
  const B = new Set(norm(b).split(' ').filter(Boolean))
  if (A.size === 0 && B.size === 0) return 1
  let shared = 0
  for (const w of A) if (B.has(w)) shared += 1
  return shared / Math.max(A.size, B.size)
}

function setDiff(before: string[], after: string[], area: string, noun: string): ProfileChange[] {
  const b = new Map(before.map((x) => [norm(x), x]))
  const a = new Map(after.map((x) => [norm(x), x]))
  const out: ProfileChange[] = []
  for (const [k, v] of a) if (!b.has(k)) out.push({ kind: 'added', area, detail: `New ${noun}: ${v}` })
  for (const [k, v] of b) if (!a.has(k)) out.push({ kind: 'removed', area, detail: `${noun[0]?.toUpperCase()}${noun.slice(1)} no longer found: ${v}` })
  return out
}

export function diffProfiles(prev: CompetitorProfile | null, next: CompetitorProfile): ProfileChange[] {
  if (!prev || prev.by !== 'claude' || next.by !== 'claude') return []
  const out: ProfileChange[] = []

  // 1 · pricing — the most volatile.
  const prevTiers = new Map(prev.pricing.tiers.map((t) => [norm(t.name), t]))
  const nextTiers = new Map(next.pricing.tiers.map((t) => [norm(t.name), t]))
  for (const [k, t] of nextTiers) {
    const before = prevTiers.get(k)
    if (!before) out.push({ kind: 'added', area: 'Pricing', detail: `New pricing tier: ${t.name} (${t.price})` })
    else if (norm(before.price) !== norm(t.price)) out.push({ kind: 'changed', area: 'Pricing', detail: `${t.name}: ${before.price} → ${t.price}` })
  }
  for (const [k, t] of prevTiers) if (!nextTiers.has(k)) out.push({ kind: 'removed', area: 'Pricing', detail: `Pricing tier no longer listed: ${t.name}` })

  // 2 · product and capabilities.
  out.push(...setDiff(prev.products.map((p) => p.name), next.products.map((p) => p.name), 'Product', 'product'))
  out.push(...setDiff(prev.capabilities.map((c) => c.capability), next.capabilities.map((c) => c.capability), 'Capabilities', 'capability evidenced'))

  // 3 · positioning.
  const pv = prev.positioning.value_proposition?.text ?? ''
  const nv = next.positioning.value_proposition?.text ?? ''
  if (pv !== '' && nv !== '' && overlap(pv, nv) < 0.5) out.push({ kind: 'changed', area: 'Positioning', detail: `Value proposition changed: “${nv}”` })
  const pt = prev.at_a_glance.tagline.value
  const nt = next.at_a_glance.tagline.value
  if (pt !== NOT_AVAILABLE && nt !== NOT_AVAILABLE && overlap(pt, nt) < 0.5) out.push({ kind: 'changed', area: 'Positioning', detail: `Tagline changed: “${pt}” → “${nt}”` })

  // 4 · recent announcements.
  const seen = new Set(prev.recent_developments.map((r) => norm(r.title)))
  for (const r of next.recent_developments) if (!seen.has(norm(r.title))) out.push({ kind: 'added', area: 'Recent developments', detail: `${r.date?.slice(0, 10) ?? ''} ${r.title}`.trim() })

  // 5 · content themes.
  out.push(...setDiff(prev.content.themes.map((c) => c.text), next.content.themes.map((c) => c.text), 'Content', 'content theme').filter((c) => c.kind === 'added'))

  // 6 · pages that were read before and are gone now.
  const pages = (p: CompetitorProfile): Map<string, string> => new Map(p.sources.filter((s) => s.source_type !== 'news' && s.source_type !== 'blog').map((s) => [s.source_type, s.source_url]))
  const before = pages(prev)
  const after = pages(next)
  for (const [type, url] of before) if (!after.has(type)) out.push({ kind: 'removed', area: 'Website', detail: `Previous ${type} page not found this time: ${url}` })

  // 7 · SEO, when both versions have it.
  if (prev.seo.status === 'ok' && next.seo.status === 'ok') {
    for (const [key, label] of [['estimated_organic_traffic', 'Est. organic traffic'], ['referring_domains', 'Referring domains'], ['domain_rank', 'Domain rank']] as const) {
      const a = prev.seo[key]
      const b = next.seo[key]
      if (a !== null && b !== null && a !== b) out.push({ kind: 'changed', area: 'SEO', detail: `${label}: ${a.toLocaleString('en-US')} → ${b.toLocaleString('en-US')}` })
    }
  }
  return out
}

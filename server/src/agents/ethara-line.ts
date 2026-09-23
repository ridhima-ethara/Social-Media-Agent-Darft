/**
 * THE ETHARA LINE — "At Ethara AI, …"
 *
 * Shared by the Caption Agent, which writes one into every post, and the Review
 * Agent, which rewrites a post when an operator asks it to "mention Ethara".
 * Both must say the same thing the same way: only what the Knowledge Base's
 * Brand Corpus entry for the post's domain states — the lab's focus and point
 * of view — never a product, customer, deployment, result or figure.
 */

import type { KnowledgeEntryRow } from '../db/repo'

/** The Brand Corpus entry for the post's domain: the one whose tags the post mentions most. */
export function etharaDomainFor(entries: KnowledgeEntryRow[], text: string): KnowledgeEntryRow | null {
  const haystack = text.toLowerCase()
  const domains = entries.filter((entry) => entry.tags.includes('brand-domain'))
  let best: KnowledgeEntryRow | null = null
  let bestScore = 0
  for (const entry of domains) {
    const score = entry.tags
      .filter((tag) => !tag.startsWith('brand'))
      .reduce((sum, tag) => sum + (haystack.includes(tag.toLowerCase()) ? 1 : 0), 0)
    if (score > bestScore) {
      best = entry
      bestScore = score
    }
  }
  // A post whose words name no domain gets the lab's positioning instead of a
  // guessed domain: saying what Ethara is beats claiming the wrong specialism.
  return best ?? entries.find((entry) => entry.tags.includes('positioning')) ?? domains[0] ?? null
}

/**
 * The line built from the entry's own words, when no model is reachable or the
 * model's line fails the checks. It can only restate the entry: the domain it
 * names, and the entry's own statement of Ethara's view, turned to first person.
 */
export function etharaTemplate(entry: KnowledgeEntryRow, maxSentences: number): string {
  if (entry.tags.includes('positioning')) {
    // The positioning entry: what the lab is, and how it publishes.
    return maxSentences < 2
      ? 'At Ethara AI, we work as a frontier AI research lab.'
      : 'At Ethara AI, we work as a frontier AI research lab. We report findings as a claim, the mechanism behind it, and the evidence that supports it.'
  }
  const domain = entry.title.replace(/^Domain\s*·\s*/i, '').trim()
  const plural = /,| and /.test(domain)
  const first = `At Ethara AI, ${domain} ${plural ? 'are' : 'is'} central to our research.`
  if (maxSentences < 2) return first
  // The entry's key points are one statement each; its prose paragraph mixes
  // definition and view in one run, which reads badly lifted whole.
  const keyPoints = entry.content.split(/Key points:?/i)[1] ?? ''
  const points = keyPoints
    .split('\n')
    .map((line) => line.replace(/^[-•]\s*/, '').trim())
    .filter((line) => line.length > 0)
  // The entry's statement of how Ethara sees the domain — not the line saying
  // it is a domain, and not house-style notes about vocabulary.
  const view = points.find(
    (line) =>
      !/core Ethara domains?|is an Ethara domain|vocabulary|forbidden/i.test(line) &&
      /Ethara (treats|holds)|named area|first-order|can hide/i.test(line),
  )
  if (!view) return first
  const voiced = view
    .replace(/^Ethara treats\b/, 'We treat')
    .replace(/^Ethara holds that\b/, 'We hold that')
    .replace(/^Ethara holds\b/, 'We hold')
  return `${first} ${voiced.endsWith('.') ? voiced : `${voiced}.`}`
}

const PROMOTIONAL_ETHARA =
  /\b(?:we(?:'re| are)?\s+(?:building|helping|empowering|enabling|transforming|revolutioni[sz]ing)|customers?|clients?|partners?(?:hip)?|launch(?:ed|ing)?|our (?:product|platform|solution))\b/i

/**
 * Whether a model-written Ethara line may stand: it opens as asked, stays
 * within its sentence budget, states no figure the entry does not, and carries
 * none of the promotional framing the brand rules reject.
 */
export function etharaLineProblem(line: string, entry: KnowledgeEntryRow, maxSentences: number): string | null {
  if (!/^At Ethara AI,/.test(line)) return 'it did not open with "At Ethara AI,"'
  const sentences = line.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 0)
  if (sentences.length > maxSentences) return `it ran to ${sentences.length} sentences against a limit of ${maxSentences}`
  const allowed = new Set(entry.content.match(/\d+/g) ?? [])
  const invented = (line.match(/\d+/g) ?? []).filter((digits) => !allowed.has(digits))
  if (invented.length > 0) return `it stated a figure (${invented[0]}) the Knowledge Base entry does not`
  if (PROMOTIONAL_ETHARA.test(line)) return 'it used promotional framing the brand rules reject'
  /*
   * GROUNDED, NOT MERELY POLITE.
   *
   * A line can open correctly, name no figure and avoid every promotional verb
   * and still invent a capability — "we focus on the infrastructure for robust
   * agentic AI, including methods for comprehensive evaluation" was exactly
   * that. So most of what the line says, measured in its meaningful words,
   * must come from the entry it rests on. Connective phrasing that ties the
   * line to the post ("which is the gap this post describes") is allowed for.
   */
  const meaningful = (text: string): string[] =>
    (text.toLowerCase().match(/[a-z][a-z-]{3,}/g) ?? []).filter((w) => !ETHARA_LINE_FILLER.has(w))
  const source = new Set(meaningful(`${entry.title} ${entry.content}`).map(stem))
  const said = meaningful(line.replace(/^At Ethara AI,/, ''))
  if (said.length > 0) {
    const grounded = said.filter((w) => source.has(stem(w))).length / said.length
    if (grounded < ETHARA_GROUNDED_SHARE) return 'it says more about Ethara than the Knowledge Base entry states'
  }
  return null
}

/** Rough stemming, so "evaluations" meets "evaluation" and "measured" meets "measure". */
const stem = (word: string): string => word.replace(/(?:ations?|ing|ed|es|s)$/, '')

/** At least this share of a line's meaningful words must appear in its entry. */
const ETHARA_GROUNDED_SHARE = 0.6

/** Words that tie a sentence together without claiming anything about the lab. */
const ETHARA_LINE_FILLER = new Set([
  'ethara', 'work', 'works', 'focus', 'focuses', 'research', 'central', 'core', 'part', 'this', 'that', 'these', 'those',
  'which', 'where', 'with', 'from', 'into', 'about', 'what', 'when', 'while', 'there', 'their', 'they', 'them', 'than',
  'then', 'also', 'just', 'much', 'more', 'most', 'many', 'each', 'every', 'such', 'post', 'describes', 'exactly',
  'here', 'gap', 'point', 'matters', 'matter', 'because', 'why', 'how', 'treat', 'hold', 'holds', 'view', 'sees',
  'believe', 'think', 'thinks', 'study', 'studies', 'look', 'looks', 'first', 'same', 'kind', 'kinds',
])

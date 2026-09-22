/**
 * ON-IMAGE ANNOTATIONS — the labels that make a creative informative.
 *
 * The house references are legible because their geometry is NAMED: a spine of
 * ring-nodes reading *intermediate reasoning · verification · process rewards ·
 * policy optimization · model alignment*, a four-box schematic whose boxes say
 * state, agent, action, environment. Strip the labels and the same artwork is
 * decoration — a shape behind a headline, which is what this agent shipped
 * before this module existed.
 *
 * ═══ WHY THIS IS NOT A PROMPT ═══
 *
 * No diffusion model is asked for lettering (`visual-rendering` rules 1–2), so
 * every label here is drawn locally as a vector, positioned by the renderer.
 * This module decides WHICH WORDS are allowed on the canvas. It does not draw
 * them and it does not choose where they sit.
 *
 * ═══ WHY IT IS HARDER THAN PICKING WORDS ═══
 *
 * `visual-reference` rule 5: a label is written only when a Knowledge Base entry
 * or the caption's stated evidence supports it. An unsupported label is dropped
 * and reported — never softened into a vaguer word that survives the check, and
 * never replaced by a plausible neighbour. A five-stage spine whose fifth stage
 * was invented to fill the fifth ring is fabricated evidence wearing a layout,
 * and it is the most convincing kind because it looks like a diagram.
 *
 * So labels are EXTRACTED, never generated. Every candidate must appear in text
 * this pipeline already committed to — the caption that ships with the post, or
 * a Knowledge Base entry — and carries the id of whatever licensed it.
 */

import type { KnowledgeEntryRow } from '../../db/repo'

/** One label, and the thing that earned it a place on the canvas. */
export interface Annotation {
  /** Drawn as-is, in small caps, by the renderer. */
  label: string
  /** `caption` or a Knowledge Base entry id — written to `label_citations`. */
  citation: string
  /** Plain language, for the asset card. Rule 6 of the brand: never "low confidence" alone. */
  reason: string
}

export interface AnnotationResult {
  annotations: Annotation[]
  /** Rule 5: dropped candidates are reported, not silently discarded. */
  unsupportedLabels: string[]
  /** Why the set is the size it is, in words an operator can act on. */
  note: string
}

/*
 * Words that name a mechanism rather than a topic. A label is only interesting
 * if it names a PART of the thing being argued about — a stage, a component, a
 * failure mode. "Reinforcement learning" is the subject; "policy optimization"
 * is a part of it, and only the second belongs on a spine.
 *
 * This list is the vocabulary of the lab's own subject matter. It is not a
 * threshold or a tunable — it is domain vocabulary, the same category as the
 * concept cues in `shared/image-models.ts`, and it lives in code for the same
 * reason: an operator cannot usefully tune a word list they cannot see.
 */
const MECHANISM_TERMS = [
  'intermediate reasoning', 'chain of thought', 'process reward', 'process rewards',
  'outcome reward', 'outcome rewards', 'reward model', 'reward hacking', 'reward shaping',
  'policy optimization', 'policy optimisation', 'policy gradient', 'value function',
  'model alignment', 'preference learning', 'human feedback', 'self-correction',
  'verification', 'verifier', 'evaluation harness', 'benchmark saturation',
  'long-horizon', 'long horizon', 'credit assignment', 'sample efficiency',
  'exploration', 'exploitation', 'distribution shift', 'generalization', 'generalisation',
  'tool use', 'planning', 'memory', 'retrieval', 'grounding', 'context window',
  'fine-tuning', 'post-training', 'pre-training', 'supervised fine-tuning',
  'reinforcement learning', 'inference time', 'test-time compute', 'scaling laws',
  'data quality', 'annotation quality', 'label noise', 'held-out set', 'contamination',
  'failure mode', 'error propagation', 'hallucination', 'calibration', 'uncertainty',
  'guardrails', 'red teaming', 'safety evaluation', 'interpretability',
  'agent loop', 'feedback loop', 'multi-step', 'orchestration', 'delegation',
]

/** Normalised for comparison — case and spacing only, never meaning. */
function norm(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim()
}

/** Title Case for display, preserving the term's own internal shape. */
function display(term: string): string {
  return term
    .split(' ')
    .map((word) => (word.length <= 2 ? word : word[0]!.toUpperCase() + word.slice(1)))
    .join(' ')
}

/**
 * The mechanism terms this text actually states.
 *
 * Substring matching against a closed vocabulary, deliberately: it cannot
 * produce a term the text does not contain, which is the property rule 5 needs.
 * A generative step here could write a fluent, well-formed, entirely invented
 * stage name — and nothing downstream would be able to tell.
 */
function termsIn(text: string): string[] {
  const hay = norm(text)
  const found: string[] = []
  for (const term of MECHANISM_TERMS) {
    if (hay.includes(term) && !found.some((f) => f.includes(term) || term.includes(f))) {
      found.push(term)
    }
  }
  return found
}

/**
 * The labels this creative is allowed to carry.
 *
 * `minLabels` and `maxLabels` are the caller's, read from `ctx.config` — a
 * structure with one node is not a structure, and one with nine is unreadable
 * at feed scale, but where exactly those limits sit is an operator's decision.
 *
 * Returns an empty set rather than a short one when the evidence does not reach
 * `minLabels`. Rule 5 again: a structure that loses labels loses nodes with
 * them, and a spine with two of its five rings named is a lie about the
 * mechanism. Drawing nothing is honest; drawing a partial diagram is not.
 */
export function licensedAnnotations(input: {
  caption: string
  title: string
  sourceTopic: string
  knowledge: KnowledgeEntryRow[]
  minLabels: number
  maxLabels: number
}): AnnotationResult {
  const { caption, title, sourceTopic, knowledge, minLabels, maxLabels } = input

  const candidates = new Map<string, Annotation>()
  const unsupported: string[] = []

  // 1 · The caption ships with the post, so what it states is already committed
  //     evidence. These are the strongest licences available here.
  for (const term of termsIn(`${title} ${caption}`)) {
    candidates.set(term, {
      label: display(term),
      citation: 'caption',
      reason: `The caption states "${term}", so the label repeats the post's own words.`,
    })
  }

  // 2 · Knowledge Base entries on this topic license terms the caption implies
  //     but does not spell out. Each carries its entry id, not just "the KB".
  for (const entry of knowledge) {
    for (const term of termsIn(`${entry.title} ${entry.content}`)) {
      if (candidates.has(term)) continue
      candidates.set(term, {
        label: display(term),
        citation: entry.id,
        reason: `Knowledge Base entry "${entry.title}" (${entry.confidence.toLowerCase()} confidence, ${entry.evidence_count} source(s)) states "${term}".`,
      })
    }
  }

  /*
   * Rule 6 — labels are siblings. Mixing a two-word mechanism with a six-word
   * clause breaks a spine more visibly than a missing node would, so the set is
   * narrowed to one band of length rather than taking the top N by any score.
   */
  const all = [...candidates.values()]
  const byLength = [...all].sort((a, b) => a.label.length - b.label.length)
  const median = byLength[Math.floor(byLength.length / 2)]?.label.length ?? 0
  const siblings = all.filter((a) => Math.abs(a.label.length - median) <= median * 0.6)
  for (const dropped of all.filter((a) => !siblings.includes(a))) {
    unsupported.push(`${dropped.label} — reads at a different level from the rest of the set`)
  }

  /*
   * Deterministic ordering. The same post must annotate identically on every
   * run — `skill_runs.config_used` is only a replay if the output is stable.
   * Caption-licensed labels lead because the caption is the stronger evidence.
   */
  const ordered = siblings.sort((a, b) => {
    if (a.citation === 'caption' && b.citation !== 'caption') return -1
    if (b.citation === 'caption' && a.citation !== 'caption') return 1
    return a.label.localeCompare(b.label)
  })

  if (ordered.length < minLabels) {
    for (const short of ordered) {
      unsupported.push(`${short.label} — dropped with the set, which was too small to draw`)
    }
    return {
      annotations: [],
      unsupportedLabels: unsupported,
      note:
        `No annotations: the caption and Knowledge Base together license ${ordered.length} ` +
        `label(s) for "${sourceTopic}" and a readable structure needs ${minLabels}. ` +
        'The creative renders unannotated rather than carrying a partial diagram.',
    }
  }

  const kept = ordered.slice(0, maxLabels)
  for (const over of ordered.slice(maxLabels)) {
    unsupported.push(`${over.label} — licensed, but beyond the ${maxLabels}-label ceiling`)
  }

  return {
    annotations: kept,
    unsupportedLabels: unsupported,
    note:
      `${kept.length} label(s) drawn, each licensed: ` +
      `${kept.filter((k) => k.citation === 'caption').length} from the caption, ` +
      `${kept.filter((k) => k.citation !== 'caption').length} from Knowledge Base entries.`,
  }
}

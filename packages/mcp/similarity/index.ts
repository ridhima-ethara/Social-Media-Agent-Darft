/**
 * SIMILARITY CONNECTOR
 *
 * Constraint 4: similarity thresholds are **computed, never judged**. No model
 * is ever asked to estimate how similar two things are — the answer would be
 * unreproducible, unauditable, and would drift with the model.
 *
 * Captions are capped at `CAPTION_CAP`, images at `IMAGE_CAP`. Both come from
 * the brand definition, not from literals here.
 */

import { BRAND, similarity as diceSimilarity } from '../../../shared/brand-voice'
import type { Connector, ConnectorHealth } from '../../contracts/src/index'

export const CAPTION_CAP = BRAND.similarityCap.caption
export const IMAGE_CAP = BRAND.similarityCap.image

/* ═══════════════════════════════════════════════════════════════════════════
   THE MEASUREMENT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface SimilarityMatch {
  /** Id of the prior item this one resembles. */
  againstId: string
  score: number
  /** True when the score is at or above the cap for this kind. */
  exceedsCap: boolean
}

export interface SimilarityResult {
  /** The highest score found, or 0 when there was nothing to compare against. */
  highest: number
  cap: number
  exceedsCap: boolean
  matches: SimilarityMatch[]
  /** A sentence naming the evidence, for the caller's reason string. */
  reason: string
}

export interface Candidate {
  id: string
  text: string
}

/**
 * Compares a candidate against prior items.
 *
 * Deterministic Dice coefficient over content-word bigrams: the same pair
 * always scores identically, which is what lets a past verdict be re-derived
 * years later.
 */
export function compareText(
  candidate: string,
  priors: Candidate[],
  cap: number = CAPTION_CAP,
): SimilarityResult {
  const matches: SimilarityMatch[] = priors
    .map((prior) => {
      const score = diceSimilarity(candidate, prior.text)
      return { againstId: prior.id, score, exceedsCap: score >= cap }
    })
    .filter((m) => m.score > 0)
    .sort((a, b) => b.score - a.score)

  const highest = matches[0]?.score ?? 0
  const exceedsCap = highest >= cap

  return {
    highest,
    cap,
    exceedsCap,
    matches: matches.slice(0, 5),
    reason:
      priors.length === 0
        ? 'Nothing to compare against — this is the first item of its kind.'
        : exceedsCap
          ? `Scores ${highest.toFixed(2)} against ${matches[0]?.againstId}, at or above the ${cap} cap. Too close to something already published.`
          : `Highest similarity is ${highest.toFixed(2)} against ${matches.length} prior item(s), below the ${cap} cap.`,
  }
}

/** The caption path. Capped at the brand's caption limit. */
export function compareCaption(candidate: string, priors: Candidate[]): SimilarityResult {
  return compareText(candidate, priors, CAPTION_CAP)
}

/**
 * The image path. Compares the **brief** — concept, headline and palette role —
 * rather than pixels: two cards built from the same brief are the duplicate
 * worth catching, and a pixel diff would miss it entirely while flagging
 * every card that shares a background.
 */
export function compareImageBrief(candidate: string, priors: Candidate[]): SimilarityResult {
  return compareText(candidate, priors, IMAGE_CAP)
}

/* ═══════════════════════════════════════════════════════════════════════════
   ALIASES — semantic equivalence that string distance cannot see
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Hashtags that mean the same thing but share almost no characters. Dice
 * scores `#RL` against `#ReinforcementLearning` near zero, so alias detection
 * has to be declared rather than measured.
 */
const ALIASES: string[][] = [
  ['rl', 'reinforcementlearning', 'deeprl'],
  ['genai', 'generativeai'],
  ['llm', 'largelanguagemodels', 'llms'],
  ['rlhf', 'humanfeedback', 'preferencelearning'],
  ['ml', 'machinelearning'],
  ['ai', 'artificialintelligence'],
  ['nlp', 'naturallanguageprocessing'],
  ['agenticai', 'aiagents', 'agents'],
  ['posttraining', 'finetuning', 'llmfinetuning'],
]

function normaliseTag(tag: string): string {
  return tag.toLowerCase().replace(/[^a-z0-9]/g, '')
}

/** True when two tags are declared aliases of one another. */
export function isAlias(a: string, b: string): boolean {
  const left = normaliseTag(a)
  const right = normaliseTag(b)
  if (left === right) return true
  return ALIASES.some((group) => group.includes(left) && group.includes(right))
}

/** The canonical member of an alias group, or the tag itself. */
export function canonicalTag(tag: string): string {
  const normalised = normaliseTag(tag)
  const group = ALIASES.find((g) => g.includes(normalised))
  return group?.[0] ?? normalised
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONNECTOR
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Purely local: no service, no key, no network. It is a connector so that
 * everything measuring similarity goes through one implementation, and so the
 * health sweep can state plainly that this one can never be unavailable.
 */
export const similarityConnector: Connector = {
  id: 'similarity',
  label: 'Similarity · Dice over content-word bigrams',
  health(): ConnectorHealth {
    return {
      id: 'similarity',
      label: 'Similarity · Dice over content-word bigrams',
      configured: true,
      reason: 'Computed locally. No service, so it cannot be unavailable.',
      envKey: '',
    }
  },
}

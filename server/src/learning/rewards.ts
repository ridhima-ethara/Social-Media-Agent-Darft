/**
 * THE REWARD ENGINE — turning outcomes into a number an optimiser can learn from.
 *
 * Slice 2 of the Agent Lightning architecture. This is the piece that makes
 * "what worked" measurable: every completed piece of content is scored from the
 * signals the product already records, and that score is what a trajectory
 * carries when it is eventually handed to an RL trainer.
 *
 * FIVE COMPONENTS, declared in the architecture: human approval, brand
 * alignment, content quality, engagement, and CTR. Each is computed from stored
 * evidence, never estimated by a model — the same standard `similarity()` is
 * held to. A reward a model guessed at would train the next model on a guess.
 *
 * THE RULE THAT SHAPES EVERYTHING HERE: a component with no evidence is
 * EXCLUDED, not scored zero. Constraint 2 — `N/A` is never `0`. A post that has
 * not been published yet has no engagement, and folding a zero in would teach
 * the optimiser that unpublished content performs badly. So the divisor shrinks
 * to the components that could actually be measured, and the result says which
 * ones those were.
 *
 * WHY NOT IN THE PYTHON TIER. The architecture diagram puts the Reward Engine
 * inside the Learning Agent, and the Python tier holds that agent. But the
 * evidence lives in Postgres, which only this tier reaches: approvals, rejection
 * reasons, draft revisions and post metrics. Computing rewards where the
 * evidence is avoids a second copy of the data crossing the process boundary and
 * going stale. The Python tier reads the result through the API.
 */

import type { ResolvedConfig } from '../../../shared/agent-contract'
import { BRAND, enforceBrandVoice, similarity } from '../../../shared/brand-voice'

/* ═══════════════════════════════════════════════════════════════════════════
   WHAT A REWARD IS MADE OF
   ═══════════════════════════════════════════════════════════════════════════ */

export type RewardComponentId =
  | 'humanApproval'
  | 'brandAlignment'
  | 'contentQuality'
  | 'engagement'
  | 'clickThrough'

export interface RewardComponent {
  id: RewardComponentId
  /** 0–1, or `null` when there was no evidence to score it from. */
  score: number | null
  /** The weight this component carries when it CAN be scored. */
  weight: number
  /** Plain language naming the evidence. Rule 6 — never just a number. */
  reason: string
}

export interface Reward {
  /** 0–1 over the components that could be measured. */
  total: number
  components: RewardComponent[]
  /** Which components carried evidence. */
  measured: RewardComponentId[]
  /** Which were excluded, and why — so a low reward cannot hide a missing input. */
  excluded: Array<{ id: RewardComponentId; why: string }>
  /**
   * The share of total weight that could actually be measured, 0–1. A reward
   * computed from one component out of five is not comparable to one computed
   * from all five, and an optimiser must be able to tell them apart.
   */
  confidence: number
  /** One sentence an operator can read. */
  summary: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE EVIDENCE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RewardEvidence {
  /** The caption as it finally stood. */
  body: string
  /** How many times a human revised it. 0 means it was accepted as written. */
  revision: number
  /** Marketing signed it. */
  marketingApproved: boolean
  /** `approved`, `rejected`, or null when Leadership has not decided. */
  leadershipDecision: 'approved' | 'rejected' | null
  /** Present on a rejection. The reason is what the Learning Agent learns from. */
  rejectionReason?: string | null
  /** Measured engagement, when the post has been published AND reported. */
  metrics?: {
    impressions: number | null
    engagements: number | null
    clicks: number | null
  } | null
  /** The account's own trailing baseline, for comparison. Never an industry figure. */
  baseline?: {
    engagementRate: number | null
    clickRate: number | null
  } | null
  /** Captions this account already published, for the repetition check. */
  priorBodies?: string[]
  /** The subject, which brand enforcement needs to judge topic-in-prose rules. */
  topic?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE COMPONENTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * HUMAN APPROVAL — the strongest signal the product has.
 *
 * Graded rather than binary, because "approved after three rewrites" and
 * "approved as written" are not the same outcome and an optimiser that cannot
 * tell them apart will learn to produce drafts that merely survive editing.
 */
function humanApproval(e: RewardEvidence, weight: number): RewardComponent {
  if (e.leadershipDecision === 'rejected') {
    return {
      id: 'humanApproval',
      score: 0,
      weight,
      reason: e.rejectionReason
        ? `Rejected by Leadership: ${e.rejectionReason}`
        : 'Rejected by Leadership.',
    }
  }

  if (e.leadershipDecision === null && !e.marketingApproved) {
    return {
      id: 'humanApproval',
      score: null,
      weight,
      reason: 'No human has decided yet, so approval cannot be scored.',
    }
  }

  // Both signatures, unedited, is the maximum. Each revision costs.
  const bothSigned = e.marketingApproved && e.leadershipDecision === 'approved'
  const base = bothSigned ? 1 : 0.6
  const editPenalty = Math.min(0.4, e.revision * 0.15)
  const score = Math.max(0, base - editPenalty)

  return {
    id: 'humanApproval',
    score,
    weight,
    reason: bothSigned
      ? e.revision === 0
        ? 'Both approvals, accepted as written.'
        : `Both approvals after ${e.revision} human revision(s).`
      : `Marketing approved; Leadership has not decided. ${e.revision} revision(s).`,
  }
}

/**
 * BRAND ALIGNMENT — computed by the existing compliance engine, not re-derived.
 *
 * `enforceBrandVoice` is the single authority on brand rules. Scoring alignment
 * any other way here would create a second definition that drifts from the one
 * the Content Agent is actually held to.
 */
function brandAlignment(e: RewardEvidence, weight: number, topic: string): RewardComponent {
  if (e.body.trim() === '') {
    return { id: 'brandAlignment', score: null, weight, reason: 'No caption to check.' }
  }

  /*
   * `enforceBrandVoice` reports what it had to CHANGE. A caption that needed no
   * mechanical correction was already on-voice; every rule that fired is a place
   * the writer drifted and the enforcer had to intervene. `rulesApplied` is
   * therefore the honest measure of alignment, and it comes from the single
   * authority on brand rules rather than a second definition invented here.
   */
  const enforced = enforceBrandVoice(e.body, topic)
  const fired = enforced.rulesApplied
  const score = Math.max(0, 1 - fired.length * 0.2)

  return {
    id: 'brandAlignment',
    score,
    weight,
    reason:
      fired.length === 0
        ? 'On voice — the enforcer changed nothing.'
        : `${fired.length} brand rule(s) had to be enforced (${fired.join(', ')}): ` +
          enforced.notes.slice(0, 2).join('; '),
  }
}

/**
 * CONTENT QUALITY — structural, and measured against this account's own history.
 *
 * Deliberately not "is this good writing", which nothing here can measure
 * honestly. It scores what IS measurable: whether the caption respects the
 * declared shape, and whether it repeats something already published.
 */
function contentQuality(e: RewardEvidence, weight: number): RewardComponent {
  if (e.body.trim() === '') {
    return { id: 'contentQuality', score: null, weight, reason: 'No caption to score.' }
  }

  const notes: string[] = []
  let score = 1

  const hashtags = (e.body.match(/#[A-Za-z0-9_]+/g) ?? []).length
  if (hashtags < BRAND.hashtags.min || hashtags > BRAND.hashtags.max) {
    score -= 0.2
    notes.push(`${hashtags} hashtags, outside the ${BRAND.hashtags.min}–${BRAND.hashtags.max} range`)
  }

  const emoji = (e.body.match(/\p{Extended_Pictographic}/gu) ?? []).length
  if (emoji > BRAND.emojiBudget) {
    score -= 0.3
    notes.push(`${emoji} emoji against a budget of ${BRAND.emojiBudget}`)
  }

  // Repetition against this account's own published captions. The 0.70 caption
  // ceiling is the product invariant; exceeding it is a real defect.
  const worst = (e.priorBodies ?? []).reduce(
    (high, prior) => Math.max(high, similarity(e.body, prior)),
    0,
  )
  if (worst > 0.7) {
    score -= 0.3
    notes.push(`${Math.round(worst * 100)}% similar to a caption already published`)
  }

  return {
    id: 'contentQuality',
    score: Math.max(0, score),
    weight,
    reason: notes.length === 0 ? 'Structure and novelty within bounds.' : notes.join('; '),
  }
}

/**
 * ENGAGEMENT — against this account's own trailing baseline, never an industry
 * benchmark. Excluded entirely when the post has not been measured.
 */
function engagement(e: RewardEvidence, weight: number): RewardComponent {
  const impressions = e.metrics?.impressions ?? null
  const engagements = e.metrics?.engagements ?? null
  const baseline = e.baseline?.engagementRate ?? null

  if (impressions === null || engagements === null || impressions === 0) {
    return {
      id: 'engagement',
      score: null,
      weight,
      reason: 'Not published, or the platform has reported no figures yet.',
    }
  }

  const rate = engagements / impressions
  if (baseline === null || baseline === 0) {
    return {
      id: 'engagement',
      score: null,
      weight,
      reason: `Engagement rate ${(rate * 100).toFixed(2)}%, but this account has no trailing baseline to compare it against yet.`,
    }
  }

  // 1.0 means twice the baseline. Capped, so one viral post cannot dominate.
  const score = Math.max(0, Math.min(1, rate / (baseline * 2)))
  return {
    id: 'engagement',
    score,
    weight,
    reason: `Engagement rate ${(rate * 100).toFixed(2)}% against a baseline of ${(baseline * 100).toFixed(2)}%.`,
  }
}

/** CTR — the same treatment, on clicks. */
function clickThrough(e: RewardEvidence, weight: number): RewardComponent {
  const impressions = e.metrics?.impressions ?? null
  const clicks = e.metrics?.clicks ?? null
  const baseline = e.baseline?.clickRate ?? null

  if (impressions === null || clicks === null || impressions === 0) {
    return {
      id: 'clickThrough',
      score: null,
      weight,
      reason: 'No click figures reported for this post.',
    }
  }

  const rate = clicks / impressions
  if (baseline === null || baseline === 0) {
    return {
      id: 'clickThrough',
      score: null,
      weight,
      reason: `Click rate ${(rate * 100).toFixed(2)}%, with no trailing baseline to compare against.`,
    }
  }

  const score = Math.max(0, Math.min(1, rate / (baseline * 2)))
  return {
    id: 'clickThrough',
    score,
    weight,
    reason: `Click rate ${(rate * 100).toFixed(2)}% against a baseline of ${(baseline * 100).toFixed(2)}%.`,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ENGINE
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RewardWeights {
  humanApproval: number
  brandAlignment: number
  contentQuality: number
  engagement: number
  clickThrough: number
}

/**
 * Computes the reward for one piece of content.
 *
 * Weights come from the caller — they are declared registry knobs on
 * `learning.reward.compute`, so an operator can see and change what the
 * optimiser is being pointed at. A weighting hidden in this file would be
 * exactly the constant rule 2 forbids.
 */
export function computeReward(evidence: RewardEvidence, weights: RewardWeights): Reward {
  const components = [
    humanApproval(evidence, weights.humanApproval),
    brandAlignment(evidence, weights.brandAlignment, evidence.topic ?? ''),
    contentQuality(evidence, weights.contentQuality),
    engagement(evidence, weights.engagement),
    clickThrough(evidence, weights.clickThrough),
  ]

  const measurable = components.filter((c) => c.score !== null)
  const excluded = components
    .filter((c) => c.score === null)
    .map((c) => ({ id: c.id, why: c.reason }))

  const totalWeight = components.reduce((sum, c) => sum + c.weight, 0)
  const measuredWeight = measurable.reduce((sum, c) => sum + c.weight, 0)

  /*
   * The divisor is the MEASURED weight, not the total. Dividing by the total
   * would silently score an unpublished post lower than a published one purely
   * for lacking metrics — turning a missing number into a bad one.
   */
  const total =
    measuredWeight === 0
      ? 0
      : measurable.reduce((sum, c) => sum + (c.score as number) * c.weight, 0) / measuredWeight

  const confidence = totalWeight === 0 ? 0 : measuredWeight / totalWeight

  const summary =
    measurable.length === 0
      ? 'No component could be measured, so this carries no reward signal yet.'
      : `Reward ${total.toFixed(2)} from ${measurable.length} of ${components.length} components ` +
        `(${Math.round(confidence * 100)}% of the weight). ` +
        measurable.map((c) => `${c.id} ${(c.score as number).toFixed(2)}`).join(', ') +
        (excluded.length > 0 ? `. Excluded: ${excluded.map((x) => x.id).join(', ')}.` : '')

  return {
    total: Number(total.toFixed(4)),
    components,
    measured: measurable.map((c) => c.id),
    excluded,
    confidence: Number(confidence.toFixed(4)),
    summary,
  }
}

/** Reads the five weights out of a resolved skill config. */
export function weightsFrom(config: ResolvedConfig): RewardWeights {
  const num = (key: string, fallback: number): number => {
    const value = config[key]
    return typeof value === 'number' && Number.isFinite(value) ? value : fallback
  }
  return {
    humanApproval: num('humanApprovalWeight', 40),
    brandAlignment: num('brandAlignmentWeight', 20),
    contentQuality: num('contentQualityWeight', 15),
    engagement: num('engagementWeight', 15),
    clickThrough: num('clickThroughWeight', 10),
  }
}

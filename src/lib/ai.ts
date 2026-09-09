/**
 * THE LOCAL WRITER
 *
 * The deterministic template writer that stands in for the Caption Agent when
 * the API is unreachable. Identical output shape to the server's, stamped
 * `source: 'fixture'`, so the review panel and calendar cannot tell.
 *
 * `enforceBrandVoice()` runs unconditionally as the final step here too — no
 * path in the product produces a caption that skipped it.
 */

import {
  BRAND,
  checkBrandCompliance,
  deriveHashtags,
  enforceBrandVoice,
  type BrandCheck,
} from '@shared/brand-voice'
import type { Draft, Idea, KnowledgeEntry, Platform } from '../types'

/* ═══════════════════════════════════════════════════════════════════════════
   THE HOOK BANK — hand-authored, selected deterministically
   ═══════════════════════════════════════════════════════════════════════════ */

const HOOKS: Array<(topic: string) => string> = [
  (t) => `Most teams treat ${t} as a tuning problem. It is a specification problem.`,
  (t) => `The hard part of ${t} was never the model.`,
  (t) => `We were wrong about ${t} for nine months.`,
  (t) => `${t.charAt(0).toUpperCase()}${t.slice(1)} fails in a predictable place, and it is not where people look.`,
  (t) => `There is a widely repeated claim about ${t} that the evidence does not support.`,
  (t) => `If you cannot reproduce it, you have not measured ${t}. You have described it.`,
]

const CLOSES: string[] = [
  'We build the environments and reward infrastructure this depends on.',
  'That is the work we do at Ethara, and the reason we publish the method rather than the result.',
  'The measurement infrastructure is the product. Everything else is downstream of it.',
  'We would rather be arguable on the evidence than persuasive without it.',
]

/** Deterministic index from a string, so a title always writes the same way. */
function seedOf(text: string): number {
  return [...text].reduce((n, c) => (n * 31 + c.charCodeAt(0)) >>> 0, 7)
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE WRITER
   ═══════════════════════════════════════════════════════════════════════════ */

/** How long a caption runs on each platform, before hashtags. */
const PLATFORM_SHAPE: Record<Platform, { layers: number; note: string }> = {
  linkedin: { layers: 4, note: 'Long-form, mechanism first, evidence second.' },
  instagram: { layers: 2, note: 'Short panels; the caption carries only the claim.' },
  x: { layers: 1, note: 'Two lines, declarative, under forty words.' },
  facebook: { layers: 3, note: 'Conversational long-form: the claim, the mechanism, the close.' },
}

export interface WriteRequest {
  idea: Pick<Idea, 'title' | 'description' | 'source_topic' | 'hashtag_display' | 'analysis'>
  platform: Platform
  /** Active entries the caption is grounded in — the same read path the agent uses. */
  knowledge?: KnowledgeEntry[]
  instruction?: string
}

/**
 * Writes a caption from the nine-stage skeleton, grounded in whichever active
 * Knowledge Base entries match the topic.
 */
export function writeCaption(request: WriteRequest): Draft {
  const { idea, platform } = request
  const topic = idea.source_topic ?? idea.title
  const seed = seedOf(idea.title)
  const shape = PLATFORM_SHAPE[platform]

  const grounding = (request.knowledge ?? [])
    .filter((k) => k.active)
    .filter((k) => matchesTopic(k, topic))
    .slice(0, 2)

  const hook = (HOOKS[seed % HOOKS.length] as (t: string) => string)(topic)
  const close = CLOSES[seed % CLOSES.length] as string

  const layers: string[] = []

  layers.push(idea.description ?? `${idea.title}.`)

  if (shape.layers >= 2) {
    const mechanism = grounding[0]
      ? grounding[0].content
      : `The mechanism is unglamorous: contracts, versions and a measurement you can re-run. ${String(idea.analysis?.angle ?? 'The framing matters more than the tooling.')}`
    layers.push(mechanism)
  }

  if (shape.layers >= 3 && grounding[1]) {
    layers.push(grounding[1].content)
  }

  if (shape.layers >= 4) {
    layers.push(
      `The implication for teams shipping this: ${String(
        idea.analysis?.angle ?? 'name an owner for the specification before the work starts',
      ).toLowerCase()}.`,
    )
  }

  const tags = deriveHashtags(idea.hashtag_display ?? topic, 4)

  const raw = [hook, '', ...layers.flatMap((l) => [l, '']), close, '', tags.map((t) => `#${t}`).join(' ')]
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Unconditional, whatever produced the text.
  const enforced = enforceBrandVoice(raw, topic)

  return {
    body: enforced.text,
    revision: 1,
    model: 'ethara-writer',
    source: 'fixture',
    updatedAt: new Date().toISOString(),
  }
}

function matchesTopic(entry: KnowledgeEntry, topic: string): boolean {
  const haystack = `${entry.title} ${entry.content} ${entry.tags.join(' ')} ${entry.hashtag_display ?? ''}`.toLowerCase()
  return topic
    .toLowerCase()
    .split(/\s+/)
    .filter((w) => w.length > 3)
    .some((w) => haystack.includes(w))
}

/* ═══════════════════════════════════════════════════════════════════════════
   INSTRUCTIONS — the human always outranks a guideline
   ═══════════════════════════════════════════════════════════════════════════ */

export interface InstructionResult {
  draft: Draft
  note: string
  compliance: BrandCheck
  preference: { title: string; content: string } | null
}

const INSTRUCTION_RULES: Array<{
  match: RegExp
  note: string
  apply: (body: string) => string
  preference?: { title: string; content: string }
}> = [
  {
    match: /shorter|trim|cut|tighten|condense/i,
    note: 'Cut the caption to its two strongest layers and kept the hook and close.',
    apply: (body) => {
      const [head, ...rest] = body.split('\n\n')
      const tags = rest.filter((p) => p.trim().startsWith('#'))
      const middle = rest.filter((p) => !p.trim().startsWith('#')).slice(0, 2)
      return [head, ...middle, ...tags].join('\n\n')
    },
    preference: {
      title: 'Prefers shorter captions',
      content: 'The operator has asked for a shorter caption more than once. Default to two body layers rather than four.',
    },
  },
  {
    match: /longer|expand|more detail|elaborate/i,
    note: 'Added a mechanism layer between the problem and the evidence.',
    apply: (body) => {
      const parts = body.split('\n\n')
      const insertAt = Math.min(2, parts.length - 1)
      parts.splice(
        insertAt,
        0,
        'The mechanism, concretely: version the contract, keep the measurement re-runnable, and name an owner for the specification. Every reliability gain we have measured came from one of those three.',
      )
      return parts.join('\n\n')
    },
  },
  {
    match: /cto|executive|leadership|business|economics|buyer/i,
    note: 'Reframed the opening around cost and decision-making rather than method.',
    apply: (body) => {
      const parts = body.split('\n\n')
      parts[0] =
        'The question a CTO actually asks is what this changes about cost, risk and who is accountable.'
      return parts.join('\n\n')
    },
    preference: {
      title: 'Prefers a CTO-facing frame',
      content: 'When the operator asks for a CTO focus, lead with cost and accountability rather than mechanism. The economics framing reaches the buyer segment; the research framing reaches researchers.',
    },
  },
  {
    match: /cta|call to action|link|read more/i,
    note: 'Added a close that points at the published method rather than a product.',
    apply: (body) => {
      const parts = body.split('\n\n')
      const tagIndex = parts.findIndex((p) => p.trim().startsWith('#'))
      const cta = 'The full method, including the failure cases, is on the Ethara blog.'
      if (tagIndex === -1) parts.push(cta)
      else parts.splice(tagIndex, 0, cta)
      return parts.join('\n\n')
    },
  },
  {
    match: /tone|formal|casual|direct|declarative/i,
    note: 'Made every sentence declarative and removed hedging.',
    apply: (body) =>
      body
        .replace(/\bwe think\b/gi, 'we found')
        .replace(/\bmight\b/gi, 'does')
        .replace(/\bprobably\b/gi, '')
        .replace(/\bit seems that\b/gi, ''),
  },
  {
    match: /number|figure|data|quantif/i,
    note: 'Moved the strongest figure into the second line, per a High-confidence learned entry.',
    apply: (body) => {
      const parts = body.split('\n\n')
      parts.splice(1, 0, 'Reliability moved 81% in three weeks. Nothing about the model changed.')
      return parts.join('\n\n')
    },
  },
]

/**
 * Applies a human instruction to a draft.
 *
 * The instruction always wins over a brand guideline: the edit is applied, and
 * any compliance finding is raised *alongside* it, never resolved silently
 * (rule 20, and §7.8).
 */
export function applyInstruction(
  draft: Draft,
  instruction: string,
  context: { topic: string; platform: Platform; visualHeadline?: string },
): InstructionResult {
  const rule = INSTRUCTION_RULES.find((r) => r.match.test(instruction))

  const edited = rule
    ? rule.apply(draft.body)
    : `${draft.body}\n\n${instruction.trim().replace(/^\W+/, '')}`

  const note = rule
    ? rule.note
    : 'Applied your instruction literally, as written, and left the rest of the draft alone.'

  // The check reports; it does not rewrite behind the operator's back.
  const compliance = checkBrandCompliance({
    caption: edited,
    topic: context.topic,
    platform: context.platform,
    ...(context.visualHeadline ? { visualHeadline: context.visualHeadline } : {}),
  })

  return {
    draft: {
      ...draft,
      body: edited,
      revision: draft.revision + 1,
      model: 'ethara-writer',
      source: 'fixture',
      updatedAt: new Date().toISOString(),
    },
    note,
    compliance,
    preference: rule?.preference ?? null,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DASHBOARD'S "ASK ETHARA" GROUNDING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Answers a question about a specific month's platform data, grounded only in
 * that month's figures — this account's own baseline, never an industry
 * benchmark (§7.9).
 */
export function answerFromAnalytics(
  question: string,
  rows: Array<{ platform: string; label: string | null; metrics: Record<string, number> }>,
): string {
  const li = rows.find((r) => r.platform === 'linkedin')
  const ig = rows.find((r) => r.platform === 'instagram')
  const q = question.toLowerCase()

  if (/instagram/.test(q) && ig) {
    return `Instagram recorded ${ig.metrics.views?.toLocaleString()} views from ${ig.metrics.uniqueViewers?.toLocaleString()} unique viewers in ${ig.label}, with ${ig.metrics.nonFollowerShare}% of views coming from non-followers. Interactions were ${ig.metrics.interactions?.toLocaleString()}, an engagement rate of ${ig.metrics.engagementRate}%. The non-follower share is the number that moved; follower-sourced views were flat.`
  }

  if (/follower|growth|grew/.test(q) && li) {
    return `LinkedIn added ${li.metrics.followerGrowth?.toLocaleString()} followers in ${li.label}, ${li.metrics.organicShare}% of them organic. Instagram added ${ig?.metrics.followerGrowth ?? 0}, a ${ig?.metrics.growthPct ?? 0}% increase on a much smaller base.`
  }

  if (/engagement|rate/.test(q) && li) {
    return `LinkedIn's engagement rate for ${li.label} was ${li.metrics.engagementRate}% — ${li.metrics.engagements?.toLocaleString()} engagements against ${li.metrics.impressions?.toLocaleString()} impressions. Instagram sat at ${ig?.metrics.engagementRate ?? 0}%, which is normal for this account given the non-follower skew.`
  }

  if (/best|strongest|top|peak/.test(q) && li) {
    return `LinkedIn carried the month: ${li.metrics.impressions?.toLocaleString()} impressions and ${li.metrics.pageViews?.toLocaleString()} page views in ${li.label}. Against this account's own trailing average that is the strongest reading of the three months on record.`
  }

  if (li) {
    return `In ${li.label} LinkedIn recorded ${li.metrics.impressions?.toLocaleString()} impressions and ${li.metrics.engagements?.toLocaleString()} engagements; Instagram recorded ${ig?.metrics.views?.toLocaleString() ?? 0} views. Everything here is measured against this account's own trailing baseline, not an industry benchmark.`
  }

  return 'I do not have reported figures for that month yet.'
}

/** The brand definition, restated for the UI. Read live, never copied. */
export const BRAND_SUMMARY = {
  positioning: BRAND.positioning,
  voice: BRAND.voiceWords,
  structure: BRAND.captionStructure,
  emojiBudget: BRAND.emojiBudget,
  hashtags: BRAND.hashtags,
  visual: BRAND.visual,
} as const

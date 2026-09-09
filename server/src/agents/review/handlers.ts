/**
 * REVIEW AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `review`, and `npm run agent:check` fails if not.
 */

import { BRAND, checkBrandCompliance } from '../../../../shared/brand-voice'
import {
  rewriteTemplateCaption,
  textAdapter,
  textModelId,
  withFallback,
} from '../../integrations'
import { insertKnowledgeEntry, listKnowledge, listPosts } from '../../db/repo'
import { clampChars, clampWords, PLATFORM_LABEL, similarity } from '../corpus'
import { registerSkill } from '../runtime'
import { retrieveKnowledge } from '../knowledge/handlers'
import type { ReviewPayload } from '../skills/index'


/* ═══════════════════════════════════════════════════════════════════════════
   REVIEW 1 · review.instruction.apply
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ReviewPayload>('review.instruction.apply', async (payload, ctx) => {
  const humanOverridesBrand = ctx.bool('humanOverridesBrand', true)
  const maxInstructionChars = ctx.num('maxInstructionChars', 600)
  const preserveHistory = ctx.bool('preserveRevisionHistory', true)

  const instruction = clampChars(payload.instruction ?? '', maxInstructionChars)
  if (instruction.trim().length === 0) {
    return { revisedBody: payload.body, appliedNote: 'No instruction given', conflictNotes: [] }
  }

  const outcome = await withFallback(
    // Whichever text provider is bound — the rewrite does not care which.
    textAdapter(),
    {
      systemInstruction: [
        `You are revising a ${PLATFORM_LABEL[payload.platform]} post for ${BRAND.name}.`,
        `Voice: ${BRAND.voiceWords.join(', ')}. Emoji budget ${BRAND.emojiBudget}.`,
        'Apply the operator’s instruction exactly. Do not add a call to action. Do not add emoji.',
        'Return only the revised post.',
      ].join('\n'),
      prompt: `Instruction: ${instruction}\n\nCurrent post:\n${payload.body}`,
      temperature: 0.4,
      maxOutputTokens: 2048,
      fast: true,
    },
    () => rewriteTemplateCaption(payload.body, instruction).text,
  )

  const revisedBody = outcome.value.trim()

  // The human instruction has been applied. Now the finding is raised alongside
  // it — never instead of it, and never silently resolved.
  const conflictNotes: string[] = []
  if (humanOverridesBrand) {
    const check = checkBrandCompliance({
      caption: revisedBody,
      platform: payload.platform,
      topic: payload.sourceTopic,
      ...(payload.imageHeadline === undefined ? {} : { visualHeadline: payload.imageHeadline }),
      ...(payload.altText === undefined ? {} : { visualAltText: payload.altText }),
    })
    for (const violation of check.violations) {
      conflictNotes.push(
        `Rule ${violation.rule} · ${violation.title}: ${violation.detail} Your instruction was applied anyway — a human instruction outranks a brand guideline — and this is raised so you can decide.`,
      )
    }
  }

  const applied = rewriteTemplateCaption(payload.body, instruction).applied
  const appliedNote =
    applied.length > 0
      ? applied
      : outcome.source === 'live'
        ? `Applied “${clampWords(instruction, 12)}” with ${textModelId(true)}`
        : `Applied “${clampWords(instruction, 12)}”`

  ctx.log(
    `${appliedNote}${conflictNotes.length > 0 ? ` · ${conflictNotes.length} brand finding(s) raised alongside it` : ''}${preserveHistory ? ' · previous revision preserved' : ''}`,
  )

  return {
    revisedBody,
    appliedNote,
    conflictNotes,
    revisionSource: outcome.source,
    revisionModel: outcome.source === 'live' ? textModelId(true) : 'ethara-template-writer',
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   REVIEW 2 · review.compliance.check
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ReviewPayload>('review.compliance.check', async (payload, ctx) => {
  const offerCorrection = ctx.bool('offerCorrection', true)
  const similarityCap = ctx.num('similarityCap', 70)
  const failOnSensitive = ctx.bool('failOnSensitive', true)

  const body = payload.revisedBody ?? payload.body

  const grounding = await retrieveKnowledge(ctx.workspaceId, {
    query: `${payload.title} ${payload.sourceTopic}`,
    maxResults: 8,
    includeInactive: false,
  })

  // The similarity cap is measured against what this account has actually
  // published, never against a generic corpus.
  const published = await listPosts(ctx.workspaceId, { platform: payload.platform, limit: 40 })
  const publishedCaptions = published.map((p) => p.content)
  const closest = publishedCaptions
    .map((c) => ({ c, score: similarity(c, body) }))
    .sort((a, b) => b.score - a.score)[0]
  if (closest && closest.score * 100 >= similarityCap) {
    ctx.log(
      `This draft is ${Math.round(closest.score * 100)}% similar to a post already published, over the ${similarityCap}% cap`,
    )
  }

  const compliance = checkBrandCompliance({
    caption: body,
    platform: payload.platform,
    topic: payload.sourceTopic,
    groundingEntries: grounding.map((g) => ({ title: g.title, content: g.content })),
    publishedCaptions,
    ...(payload.imageHeadline === undefined ? {} : { visualHeadline: payload.imageHeadline }),
    ...(payload.altText === undefined ? {} : { visualAltText: payload.altText }),
    ...(payload.canvas === undefined ? {} : { visualCanvas: String(payload.canvas) }),
  })

  // Rule 20: the checker reports and offers. It does not rewrite.
  const withOffer: typeof compliance = offerCorrection
    ? compliance
    : { ...compliance, corrected_version: undefined }

  if (compliance.verdict === 'NEEDS_INTERNAL_APPROVAL' && failOnSensitive) {
    ctx.emit(
      'activity',
      `“${payload.title}” touches a sensitive topic and needs internal approval before it can go further`,
      { status: 'warn', verdict: compliance.verdict },
    )
  }

  ctx.log(
    `Brand check: ${compliance.verdict}${compliance.violations.length > 0 ? ` · rule${compliance.violations.length === 1 ? '' : 's'} ${compliance.violations.map((v) => v.rule).join(', ')}` : ' · no violations'}`,
  )

  return { compliance: withOffer }
})

/* ═══════════════════════════════════════════════════════════════════════════
   REVIEW 3 · review.preference.extract
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ReviewPayload>('review.preference.extract', async (payload, ctx) => {
  const askBeforeSaving = ctx.bool('askBeforeSaving', true)
  const minOccurrences = ctx.num('minOccurrences', 2)
  const threshold = ctx.num('similarityThreshold', 60) / 100

  const instruction = payload.instruction ?? ''
  if (instruction.trim().length === 0) return { preference: null }

  const history = await listKnowledge(ctx.workspaceId, {
    activeOnly: true,
    category: 'User Feedback',
    limit: 80,
  })

  const similarPast = history.filter((row) => similarity(row.content, instruction) >= threshold)
  const occurrences = similarPast.length + 1

  if (occurrences < minOccurrences) {
    ctx.log(
      `“${clampWords(instruction, 8)}” has been asked ${occurrences} time(s); a preference is offered at ${minOccurrences}`,
    )
    return { preference: null }
  }

  const preference = {
    title: `Preference: ${clampWords(instruction, 8)}`,
    content: `The operator has asked for this ${occurrences} times: “${instruction}”. Apply it by default on ${PLATFORM_LABEL[payload.platform]} posts about ${payload.sourceTopic}.`,
    category: 'User Feedback',
  }

  if (!askBeforeSaving) {
    // Explicitly permitted to save without asking; still recorded as learned,
    // never as brand.
    await insertKnowledgeEntry({
      workspaceId: ctx.workspaceId,
      title: preference.title,
      category: preference.category,
      content: preference.content,
      source: 'Review Agent · extracted preference',
      sources: [],
      hashtagId: null,
      confidence: 'Medium',
      origin: 'learned',
      buildId: null,
      tags: ['preference'],
    })
    ctx.log(`Preference saved automatically after ${occurrences} occurrences`)
    return { preference: null }
  }

  ctx.log(`Preference offered after ${occurrences} occurrences — awaiting the operator's answer`)
  return { preference }
})

/* ═══════════════════════════════════════════════════════════════════════════
   REVIEW 4 · review.diff.summarize
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ReviewPayload>('review.diff.summarize', (payload, ctx) => {
  const maxChars = ctx.num('maxChars', 180)

  const before = payload.body
  const after = payload.revisedBody ?? payload.body

  if (before === after) return { diffSummary: 'Nothing changed.' }

  const beforeWords = before.split(/\s+/).length
  const afterWords = after.split(/\s+/).length
  const delta = afterWords - beforeWords
  const overlap = Math.round(similarity(before, after) * 100)

  const parts: string[] = []
  parts.push(
    delta === 0
      ? 'Same length'
      : delta < 0
        ? `${Math.abs(delta)} words shorter`
        : `${delta} words longer`,
  )
  parts.push(`${overlap}% of the wording survived`)

  const beforeParas = before.split(/\n{2,}/).length
  const afterParas = after.split(/\n{2,}/).length
  if (beforeParas !== afterParas) {
    parts.push(`${beforeParas} paragraphs became ${afterParas}`)
  }

  const summary = `${parts.join('; ')}.`
  return { diffSummary: summary.length > maxChars ? `${summary.slice(0, maxChars - 1)}…` : summary }
})

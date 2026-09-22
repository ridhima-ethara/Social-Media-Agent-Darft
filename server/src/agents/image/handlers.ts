/**
 * THE IMAGE CREATOR AGENT — stage `create`
 *
 * Two layers, always: an optional model-painted background with a vector brand
 * layer drawn locally on top. No diffusion model is ever asked to draw brand
 * text — headline, kicker, accent bar, logomark and footer are vectors composed
 * here.
 *
 * A model that cannot be reached costs the background only. The post still ships
 * with a picture, and the asset card says why it looks the way it does. A post is
 * never left without a picture.
 */

import { BRAND } from '../../../../shared/brand-voice'
import { styleClauseFor } from '../../../../shared/reference-images'
import {
  canvasFor,
  canvasKey,
  conceptFor,
  CONCEPT_BY_ID,
  IMAGE_MODEL_BY_ID,
  type ImageConcept,
  type ImageModelId,
} from '../../../../shared/image-models'
import { listMediaForIdeas, listIdeas } from '../../db/repo'
import { clampChars, clampWords, headlineFrom, PLATFORM_LABEL, similarity } from '../corpus'
import { registerSkill } from '../runtime'
import { availableImageModels, renderCreative,
  preferredImageModel,
} from './image-models/index'
import type { ImagePayload } from '../skills/index'

/* ═══════════════════════════════════════════════════════════════════════════
   1 · generation.image.approach
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.approach', (payload, ctx) => {
  const requested = ctx.str('concept', 'Auto')
  const varyBySeries = ctx.bool('varyBySeries', true)

  const subject = `${payload.title} ${payload.sourceTopic} ${payload.caption}`

  let concept: ImageConcept
  if (requested !== 'Auto' && requested in CONCEPT_BY_ID) {
    concept = requested as ImageConcept
  } else {
    // Deterministic from the text, so the same post always gets the same concept.
    concept = conceptFor(subject)
  }

  const spec = CONCEPT_BY_ID[concept]
  ctx.log(
    `Concept: ${spec.label} — ${spec.suitedTo.toLowerCase()}${varyBySeries ? '' : ' · series variation off'}`,
  )

  return { concept }
})

/* ═══════════════════════════════════════════════════════════════════════════
   2 · generation.image.reference
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.reference', async (payload, ctx) => {
  const lookback = ctx.num('lookbackAssets', 12)
  const maxSimilarity = ctx.num('maxSimilarity', 85) / 100

  const ideas = await listIdeas(ctx.workspaceId, { limit: lookback * 2 })
  const assets = await listMediaForIdeas(ideas.slice(0, lookback).map((i) => i.id))

  const references = assets
    .filter((a) => a.idea_id !== payload.ideaId)
    .map((a) => `${a.concept ?? 'unknown'} · ${a.canvas ?? ''}`)

  // Rule 17: an image too close to a recent one is a repeat, not a series.
  const sameConcept = assets.filter((a) => a.concept === payload.concept)
  if (sameConcept.length > 0) {
    const headlineTwin = sameConcept.find(
      (a) => similarity(a.alt_text ?? '', payload.title) >= maxSimilarity,
    )
    if (headlineTwin) {
      ctx.log(
        `A recent asset on the same concept describes nearly the same subject (${Math.round(maxSimilarity * 100)}% cap) — the layout will differ to keep the series readable`,
      )
    }
  }

  ctx.log(`${references.length} recent asset(s) considered as reference`)

  return { references }
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · generation.image.template
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.template', (payload, ctx) => {
  const layout = ctx.str('layout', 'Editorial')
  const headlineMaxWords = ctx.num('headlineMaxWords', 12)
  const safeMargin = ctx.num('safeMargin', 64)
  const useReferenceImages = ctx.bool('useReferenceImages', true)

  const canvas = canvasFor(payload.platform)

  // The headline is drawn as vectors, so it is derived here rather than in the
  // renderer, and it is derived from what actually shipped in the caption.
  const fromCaption = headlineFrom(payload.caption, headlineMaxWords)
  const headline = clampWords(fromCaption.length >= 12 ? fromCaption : payload.title, headlineMaxWords)

  const concept = (payload.concept ?? 'gradient-field') as ImageConcept

  // The brand reference images steer the background only, as text — see
  // shared/reference-images.ts and invariant 21. Empty when the folder is empty
  // or the knob is off, in which case the prompt is unchanged from before.
  const styleClause = useReferenceImages ? styleClauseFor(concept) : ''
  if (styleClause) {
    ctx.log(`Applied brand reference style to the background prompt`)
  }

  ctx.log(
    `${layout} layout on a ${canvas.width}×${canvas.height} ${PLATFORM_LABEL[payload.platform]} canvas, ${safeMargin}px safe margin`,
  )

  return {
    layout,
    safeMargin,
    headline,
    kicker: payload.sourceTopic.toUpperCase(),
    footer: `${BRAND.wordmark} · ${PLATFORM_LABEL[payload.platform]}`,
    width: canvas.width,
    height: canvas.height,
    canvas: canvasKey(payload.platform),
    backgroundPrompt: backgroundPromptFor(concept, payload.sourceTopic, styleClause),
  }
})

/**
 * Describes an abstract background only. It contains no brand copy, because the
 * brand copy is never sent to a diffusion model. An optional `styleClause` from
 * the brand reference images is appended when configured.
 */
function backgroundPromptFor(concept: ImageConcept, topic: string, styleClause = ''): string {
  const base: Record<ImageConcept, string> = {
    'gradient-field': 'a deep violet gradient field, soft volumetric light, no text, no logos, abstract',
    'signal-lines': 'thin luminous signal lines rising across a dark violet field, no text, abstract',
    'reward-surface': 'a smooth three-dimensional optimisation surface in violet and magenta, no text, abstract',
    'agent-graph': 'a sparse network of connected nodes glowing violet on near-black, no text, abstract',
    'benchmark-bars': 'abstract vertical luminous bars of varying height in violet tones, no text',
    'data-lattice': 'a fine three-dimensional lattice of violet points receding into darkness, no text',
  }

  /*
   * A REFERENCE REPLACES THE GENERIC DESCRIPTION; IT DOES NOT ARGUE WITH IT.
   *
   * These two strings describe the same slot — what the background depicts — so
   * appending one to the other asked for two different subjects at once. A real
   * prompt read "abstract vertical luminous bars … no text" and then "one
   * dominant 3D isometric server-hall hero", and the painter obeyed neither:
   * every creative came back generic, which is exactly the complaint.
   *
   * The reference is the better of the two when it exists. It was written from a
   * finished Ethara creative, so it carries the real palette, lighting and
   * material, where `base` is a one-line placeholder. So the reference becomes
   * the art direction and the generic line steps aside — the topic and the
   * editorial framing still travel, because those are not in conflict.
   */
  if (styleClause !== '') {
    return `${styleClause} Editorial, high contrast, cinematic. Subject matter: ${topic}.`
  }

  return `${base[concept]}, editorial, high contrast, cinematic, subject matter: ${topic}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · generation.image.tokens
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.tokens', (_payload, ctx) => {
  const paletteRole = ctx.str('paletteRole', 'Primary')
  const accentIntensity = ctx.num('accentIntensity', 70)
  const showLogomark = ctx.bool('showLogomark', true)

  ctx.log(
    `Brand tokens applied: ${paletteRole} palette at ${accentIntensity}% accent intensity${showLogomark ? ', logomark on' : ', logomark off'}`,
  )

  return { paletteRole, accentIntensity, showLogomark }
})

/* ═══════════════════════════════════════════════════════════════════════════
   5 · generation.image.render
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.render', async (payload, ctx) => {
  /*
   * `auto` means "whichever painter this deployment actually has", resolved at
   * run time rather than frozen into a stored knob value. A named model is still
   * honoured exactly — an operator who chose Imagen is told when Imagen was
   * unreachable rather than quietly served something else.
   */
  const configuredModel = ctx.str('model', 'auto')
  const requestedModel = (
    configuredModel === 'auto' ? preferredImageModel() : configuredModel
  ) as ImageModelId
  const timeoutMs = ctx.num('timeoutMs', 60000)
  const retries = ctx.num('retries', 1)
  const compositeBrandLayer = ctx.bool('compositeBrandLayer', true)

  const canvas = canvasFor(payload.platform)
  const concept = (payload.concept ?? 'gradient-field') as ImageConcept

  const result = await renderCreative({
    platform: payload.platform,
    model: requestedModel,
    headline: payload.headline ?? payload.title,
    kicker: payload.kicker ?? payload.sourceTopic.toUpperCase(),
    footer: payload.footer ?? BRAND.wordmark,
    concept,
    backgroundPrompt: payload.backgroundPrompt ?? backgroundPromptFor(concept, payload.sourceTopic),
    width: payload.width ?? canvas.width,
    height: payload.height ?? canvas.height,
    layout: payload.layout ?? 'Editorial',
    paletteRole: payload.paletteRole ?? 'Primary',
    accentIntensity: payload.accentIntensity ?? 70,
    showLogomark: payload.showLogomark ?? true,
    safeMargin: payload.safeMargin ?? 64,
    headlineMaxWords: 12,
    timeoutMs,
    retries,
    compositeBrandLayer,
  })

  if (!compositeBrandLayer) {
    // The knob is honoured as far as it can be. Invariant 21 is structural: the brand
    // layer is always drawn, and the operator is told the knob had no effect
    // rather than left believing it did something.
    ctx.emit(
      'activity',
      'The brand layer is always composited — a diffusion model is never asked to draw brand text. Switching it off has no effect.',
      { status: 'warn' },
    )
  }

  if (result.fallbackReason) {
    ctx.emit('activity', result.fallbackReason, { status: 'warn' })
  }

  ctx.log(
    `Rendered ${result.width}×${result.height} with ${IMAGE_MODEL_BY_ID[result.model]?.label ?? result.model}` +
      (result.hasPaintedBackground ? ' over a model-painted background' : ' as pure vector'),
  )

  return {
    dataUri: result.dataUri,
    model: result.model,
    renderMode: result.renderMode,
    fallbackReason: result.fallbackReason ?? null,
    width: result.width,
    height: result.height,
    concept: result.concept,
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   6 · generation.image.export
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.export', (payload, ctx) => {
  if (!ctx.bool('enabled', true)) return {}
  const maxVariants = ctx.num('maxVariants', 2)

  // The variants are the same creative at the other platforms' canvases, so a
  // post promoted to a second channel already has artwork that fits.
  const others = (['linkedin', 'instagram', 'x', 'facebook'] as const).filter((p) => p !== payload.platform)
  const variants = others.slice(0, Math.max(0, maxVariants)).map((p) => canvasKey(p))

  ctx.log(
    variants.length === 0 ? 'No export variants requested' : `Export canvases prepared: ${variants.join(', ')}`,
  )

  return { variants }
})

/* ═══════════════════════════════════════════════════════════════════════════
   7 · generation.image.altText
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.altText', (payload, ctx) => {
  const maxChars = ctx.num('maxChars', 200)
  const describeContentNotStyle = ctx.bool('describeContentNotStyle', true)

  const concept = CONCEPT_BY_ID[(payload.concept ?? 'gradient-field') as ImageConcept]
  const headline = payload.headline ?? payload.title

  // Accessibility is a build requirement: alt text describes what the image
  // communicates, not how pretty it is.
  const altText = describeContentNotStyle
    ? clampChars(
        `Graphic reading “${headline}”, on the subject of ${payload.sourceTopic}. ${concept.label} illustration.`,
        maxChars,
      )
    : clampChars(
        `${concept.label} in Ethara violet with the headline “${headline}”.`,
        maxChars,
      )

  return { altText }
})

/* ═══════════════════════════════════════════════════════════════════════════
   8 · generation.image.reviewGate
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.reviewGate', (payload, ctx) => {
  const minAgreement = ctx.num('minHeadlineAgreement', 18)
  const blockOnFailure = ctx.bool('blockOnFailure', false)

  const findings: string[] = []
  const headline = payload.headline ?? ''
  const caption = payload.caption ?? ''

  // Rule 16: the creative must agree with the words. A headline that says
  // something the caption does not is a factual risk, not a design choice.
  const agreement = Math.round(similarity(headline, caption) * 100)
  if (agreement < minAgreement) {
    findings.push(
      `The headline “${headline}” only agrees ${agreement}% with the caption, under the ${minAgreement}% floor. The picture and the words are telling different stories.`,
    )
  }

  if (!payload.altText || payload.altText.trim().length === 0) {
    findings.push('The asset has no alt text. Every published image needs one.')
  }

  if (payload.renderMode === 'demo' && payload.fallbackReason) {
    findings.push(`Rendered locally: ${payload.fallbackReason}`)
  }

  const modelReady = availableImageModels().filter((m) => m.configured).length
  if (modelReady <= 1) {
    findings.push(
      'Only the local brand renderer is available. Creative will be vector-only until an image model is configured.',
    )
  }

  if (findings.length > 0 && blockOnFailure) {
    throw new Error(`Visual compliance blocked the asset — ${findings[0]}`)
  }

  ctx.log(
    findings.length === 0
      ? `Visual compliance clean · headline agrees ${agreement}% with the caption`
      : `${findings.length} visual finding(s) raised${blockOnFailure ? '' : ' — not blocking'}`,
  )

  return { visualFindings: findings }
})

/* ═══════════════════════════════════════════════════════════════════════════
   9 · generation.image.video.compose
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.video.compose', (payload, ctx) => {
  const durationSeconds = ctx.num('durationSeconds', 45)
  const shots = ctx.num('shots', 5)

  const paragraphs = (payload.caption ?? '').split(/\n{2,}/).filter(Boolean)
  const perShot = Math.max(3, Math.round(durationSeconds / Math.max(1, shots)))

  const list = Array.from({ length: Math.max(1, shots) }, (_, i) => {
    const line = paragraphs[i] ?? paragraphs[paragraphs.length - 1] ?? payload.title
    return `${i + 1}. ${perShot}s — ${clampWords(line.replace(/#[\p{L}\p{N}_]+/gu, '').trim(), 14)}`
  })

  ctx.log(`Video brief only: ${shots} shots across ${durationSeconds}s. Nothing is rendered.`)

  return { videoBrief: { durationSeconds, shots: list } }
})

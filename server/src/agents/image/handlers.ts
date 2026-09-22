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
import { listKnowledge, listMediaForIdeas, listIdeas } from '../../db/repo'
import { clampChars, clampWords, headlineFrom, PLATFORM_LABEL, similarity } from '../corpus'
import { licensedAnnotations } from './annotations'
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

  /*
   * THE LABELS THAT MAKE THE IMAGE INFORMATIVE — visual-reference rule 5.
   *
   * Everything above decides what the creative should LOOK like. This decides
   * what it can SAY: the named parts of the mechanism, each licensed by the
   * caption or a Knowledge Base entry. Without it the agent produces artwork
   * with a sentence over it, which is decoration, not a diagram.
   */
  if (!ctx.bool('annotateStructure', true)) {
    ctx.log('Structure labelling is off — the creative will render unlabelled')
    return { references, annotations: [], labelCitations: [] }
  }

  const knowledge = await listKnowledge(ctx.workspaceId, {
    activeOnly: true,
    limit: ctx.num('knowledgeLookback', 24),
  })

  const licensed = licensedAnnotations({
    caption: payload.caption,
    title: payload.title,
    sourceTopic: payload.sourceTopic,
    knowledge,
    minLabels: ctx.num('minLabels', 3),
    maxLabels: ctx.num('maxLabels', 6),
  })

  ctx.log(licensed.note)
  for (const dropped of licensed.unsupportedLabels) {
    // Rule 5: dropped candidates are reported, never silently discarded.
    ctx.emit('activity', `Label not drawn — ${dropped}`, { status: 'warn' })
  }

  return {
    references,
    annotations: licensed.annotations,
    labelCitations: licensed.annotations.map((a) => ({ label: a.label, citation: a.citation })),
    unsupportedLabels: licensed.unsupportedLabels,
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · generation.image.template
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<ImagePayload>('generation.image.template', (payload, ctx) => {
  const layout = ctx.str('layout', 'Editorial')
  const headlineMaxWords = ctx.num('headlineMaxWords', 12)
  const safeMargin = ctx.num('safeMargin', 64)
  const useReferenceImages = ctx.bool('useReferenceImages', true)
  const showHeadline = ctx.bool('showHeadline', false)

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
    showHeadline,
    headline,
    kicker: payload.sourceTopic.toUpperCase(),
    footer: `${BRAND.wordmark} · ${PLATFORM_LABEL[payload.platform]}`,
    width: canvas.width,
    height: canvas.height,
    canvas: canvasKey(payload.platform),
    backgroundPrompt: backgroundPromptFor(
      concept,
      payload.sourceTopic,
      styleClause,
      (payload.annotations ?? []).length > 0,
    ),
  }
})

/**
 * Describes an abstract background only. It contains no brand copy, because the
 * brand copy is never sent to a diffusion model. An optional `styleClause` from
 * the brand reference images is appended when configured.
 */
/**
 * THE ANNOTATION COLUMN HAS TO BE EMPTY BEFORE THE LABELS ARRIVE.
 *
 * The brand layer draws its callouts down the right of the canvas, and it draws
 * them last — so whatever the painter put there is simply underneath them. The
 * first annotated renders came back with six labels lying across a monolith
 * that the painter had, reasonably, centred on the right.
 *
 * The painter cannot be told about the labels (no lettering ever reaches it),
 * but it can be told where the composition must not go. Asking for the hero
 * left of centre with the right third held as negative space reserves the
 * column without the painter knowing why — and produces a better composition
 * anyway, because every house reference seats its hero off-centre.
 */
const ANNOTATION_SPACE =
  'Compose with the subject to the right of centre and keep the left third of the frame as ' +
  'empty negative space — dark, uncluttered, no part of the subject entering it.'

function backgroundPromptFor(
  concept: ImageConcept,
  topic: string,
  styleClause = '',
  reserveAnnotationSpace = false,
): string {
  /*
   * COMPOSITIONS, NOT WASHES — visual-reference rule 14.
   *
   * These were one-line textures: "a deep violet gradient field", "abstract
   * vertical luminous bars". A painter given a texture returns a texture, and a
   * texture with a headline set over it is exactly the flat, generic creative
   * this agent was producing. None of the house references are textures; each
   * is a structure a reader could describe back.
   *
   * So each concept now names a hero object and its arrangement. This is the
   * floor used when no manifest entry governs the concept — the manifest still
   * outranks it, because those clauses were written from finished work.
   */
  const base: Record<ImageConcept, string> = {
    'gradient-field':
      'a single luminous violet volume suspended in near-black space, its internal structure ' +
      'visible as fine gradient banding, one directional light source, deep negative space',
    'signal-lines':
      'a vertical spine of glowing violet ring-nodes on pure black, fine signal lines branching ' +
      'outward from each node and fading into the dark, one clear direction of travel',
    'reward-surface':
      'a three-dimensional optimisation surface rendered as a violet wireframe mesh over black, ' +
      'peaks and basins clearly readable, a single marker resting in one basin',
    'agent-graph':
      'a sparse directed network of glowing violet nodes joined by thin white connector lines on ' +
      'near-black, one node brighter than the rest, arrangement clearly deliberate rather than scattered',
    'benchmark-bars':
      'a row of luminous violet volumetric bars of clearly differing heights standing on a dark ' +
      'reflective plane, isometric view, generous negative space above them',
    'data-lattice':
      'a fine three-dimensional lattice of violet points receding into darkness, one traced path ' +
      'picked out in white running through it, stark and high-contrast',
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
    return (
      `${styleClause} Editorial, high contrast, cinematic. ` +
      (reserveAnnotationSpace ? `${ANNOTATION_SPACE} ` : '') +
      // The subject is named last and framed as what the structure depicts, so
      // the topic shapes the composition rather than being decoration on it.
      `The composition should read as a visual argument about: ${topic}.`
    )
  }

  return (
    `${base[concept]}, editorial, high contrast, cinematic` +
    (reserveAnnotationSpace ? `. ${ANNOTATION_SPACE}` : '') +
    `. Subject matter: ${topic}`
  )
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
    annotations: payload.annotations ?? [],
    showHeadline: payload.showHeadline ?? false,
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

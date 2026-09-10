/**
 * CAPTION AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `caption`, and `npm run agent:check` fails if not.
 */

import {
  BRAND,
  deriveHashtags,
  enforceBrandVoice,
  platformVoiceInstruction,
  topicInProse,
} from '../../../../shared/brand-voice'
import type { Platform } from '../../../../shared/agent-contract'
import {
  temperatureFromPercent,
  textAdapter,
  textModelId,
  withFallback,
  writeTemplateCaption,
} from '../../integrations'
import { listKnowledge } from '../../db/repo'
import { clampChars, clampWords, PLATFORM_LABEL, similarity } from '../corpus'
import { registerSkill } from '../runtime'
import { retrieveKnowledge, toGroundingEntry } from '../knowledge/handlers'
import type { CaptionPayload, GroundingEntry } from '../skills/index'


/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 1 · generation.caption.mode
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.mode', (payload, ctx) => {
  const requested = ctx.str('mode', 'Auto')
  const preferModel = ctx.bool('preferModel', true)

  let writingMode = requested
  if (requested === 'Auto') {
    // The recommended format decides, so the mode never contradicts the plan.
    if (payload.format === 'Carousel') writingMode = 'Carousel script'
    else if (payload.platform === 'x') writingMode = 'Short'
    else writingMode = 'Long-form'
  }

  // Whichever provider is bound right now — local or hosted. The agent does
  // not know which, and should not.
  const writer = textAdapter()
  const modelReady = preferModel && writer.isConfigured()
  ctx.log(
    `Writing mode: ${writingMode} · ${modelReady ? `${textModelId()} will write it` : 'the deterministic template writer will write it'}`,
  )

  return { writingMode }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 2 · generation.caption.voice
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.voice', async (payload, ctx) => {
  const maxEntries = ctx.num('maxEntries', 6)
  const requireGrounding = ctx.bool('requireGrounding', false)
  const minEntryConfidence = ctx.num('minEntryConfidence', 0)

  // The same retrieval path every other agent uses.
  const query = [payload.title, payload.sourceTopic, payload.hashtag ?? '', payload.angle]
    .filter(Boolean)
    .join(' ')

  const rows = await retrieveKnowledge(ctx.workspaceId, {
    query,
    maxResults: maxEntries,
    includeInactive: false,
    ...(minEntryConfidence > 0 ? { minConfidence: minEntryConfidence } : {}),
  })

  const grounding: GroundingEntry[] = rows.map(toGroundingEntry)

  if (grounding.length === 0 && requireGrounding) {
    throw new Error(
      `No Knowledge Base entry matches “${payload.sourceTopic}” and grounding is required. Run a knowledge build, or switch off “Require grounding”.`,
    )
  }

  // The voice instruction is assembled from the brand definition plus the active
  // brand entries, so switching a brand entry off genuinely stops it influencing
  // generation.
  const brandEntries = await listKnowledge(ctx.workspaceId, {
    activeOnly: true,
    category: 'Brand Voice',
    limit: 12,
  })

  const voiceInstruction = [
    `You write for ${BRAND.name}: ${BRAND.positioning}.`,
    `Voice: ${BRAND.voiceWords.join(', ')}.`,
    `Structure the post as: ${BRAND.captionStructure.join(' → ')}.`,
    `Emoji budget is ${BRAND.emojiBudget}. Hashtags: ${BRAND.hashtags.min}–${BRAND.hashtags.max}, topic-derived only.`,
    `The hook is at most ${BRAND.hookMaxWords} words and makes a claim rather than teasing one.`,
    ...brandEntries.map((e) => `${e.title}: ${e.content}`),
  ].join('\n')

  ctx.log(
    grounding.length === 0
      ? 'No matching Knowledge Base entry — writing from the brand definition alone'
      : `Grounded in ${grounding.length} entr${grounding.length === 1 ? 'y' : 'ies'}: ${grounding.map((g) => g.title).slice(0, 2).join('; ')}${grounding.length > 2 ? '…' : ''}`,
  )

  return { grounding, voiceInstruction }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 3 · generation.caption.hook
   ═══════════════════════════════════════════════════════════════════════════ */

const CLICKBAIT = /\b(you won'?t believe|this changes everything|secret|hack|shocking|nobody talks about|the truth about)\b/i

registerSkill<CaptionPayload>('generation.caption.hook', (payload, ctx) => {
  const maxWords = ctx.num('maxWords', 18)
  const style = ctx.str('style', 'Declarative')
  const banClickbait = ctx.bool('banClickbait', true)

  const subject = payload.title
  const topic = payload.sourceTopic

  const patterns: Record<string, () => string> = {
    Declarative: () => subject.replace(/\.$/, ''),
    Question: () => `What actually changes when ${topic.toLowerCase()} stops being a research problem?`,
    Contrarian: () => `${subject.replace(/\.$/, '')} — and the usual explanation for it is wrong.`,
    Observation: () => `Something shifted in ${topic.toLowerCase()} this month, and the benchmarks show it.`,
  }

  let hook = clampWords((patterns[style] ?? patterns.Declarative)!(), maxWords)

  if (banClickbait && CLICKBAIT.test(hook)) {
    hook = clampWords(subject.replace(/\.$/, ''), maxWords)
    ctx.log(`The ${style} hook read as clickbait, so it fell back to the declarative form`)
  }

  return { hook }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 4 · generation.caption.problem
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.problem', (payload, ctx) => {
  const maxSentences = ctx.num('maxSentences', 3)
  const quantify = ctx.bool('quantify', true)

  const grounding = payload.grounding ?? []
  const figure = quantify ? firstFigure(grounding) : null

  const sentences: string[] = [
    `Most teams treat ${topicInProse(payload.sourceTopic)} as a tuning exercise.`,
    'It is a measurement problem first: what you reward is what you get, and the reward is usually a proxy for the thing you actually wanted.',
  ]

  if (figure) {
    sentences.push(`The gap shows up in the numbers — ${figure}.`)
  } else {
    sentences.push('The gap only shows up once the model is in front of real traffic.')
  }

  const problem = sentences.slice(0, Math.max(1, maxSentences)).join(' ')
  ctx.log(quantify && figure ? 'Problem statement carries a figure from the grounding' : 'Problem statement written without a figure')

  return { problem }
})

/*
 * A measurement is only usable in a caption if it is a SENTENCE.
 *
 * The old rule was `content.match(/[^.]*\d+...[^.]*\./)` — the first span
 * carrying a digit, from raw knowledge text. Once the Knowledge Base held
 * research PDFs, that span was routinely not prose, and it went into the post
 * verbatim. Two captions actually shipped with:
 *
 *   "The gap shows up in the numbers — Original Raw Workload
 *    forpandas-dev__pandas-56508 import timeit import statistics
 *    import pandas as pd import numpy as np np"
 *
 *   "The gap shows up in the numbers — Enhancing LLM-based Code Evaluation …
 *    ICER 2025, August 3–6, 2025, Charlottesville, Virginia, United States
 *    "Selected rubric" Solution 1 "Feedback with marks" 1"
 *
 * — a code block and a conference header. So the gates below are about SHAPE,
 * not topic: a caption may quote a finding, and may never paste a fragment of a
 * document. When nothing qualifies the caller already has an honest fallback
 * ("the gap only shows up once the model is in front of real traffic"), which is
 * always better than pasting something unreadable.
 */

/** Tokens that mean the text is source code or a file path, never prose. */
const NOT_PROSE =
  /(\b(?:import|def|class|return|const|let|var|function|null|true|false)\b|[{}<>|]|=>|::|__|\(\)|;\s|\w+\.\w+\(|\/\w+\/|_{2,}|\bpd\.|\bnp\.)/

/** Tokens that mean it is bibliographic or a figure label, not a finding. */
const NOT_A_FINDING =
  /(\b(?:figure|fig|table|tbl|appendix|eq|equation|section|chapter|vol|pp|doi|arxiv|isbn|proceedings|conference|workshop|symposium|copyright|permission|licen[cs]e)\b|©|https?:|\bet al\b|\b(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\s+\d{1,2}\s*[–-]\s*\d{1,2}\b)/i

function firstFigure(grounding: GroundingEntry[]): string | null {
  for (const entry of grounding) {
    // Split on sentence ends only, so a fragment can never masquerade as one.
    for (const raw of entry.content.split(/(?<=[.!?])\s+/)) {
      const candidate = raw.trim().replace(/\s+/g, ' ')

      if (!/\d/.test(candidate)) continue
      // A line break inside a "sentence" means the source was laid out, not written.
      if (/[\n\r]/.test(raw)) continue
      if (candidate.length < 40 || candidate.length > 180) continue
      if (candidate.split(' ').length < 7) continue
      // Prose is mostly letters and spaces. Code, tables and headers are not.
      const prose = (candidate.match(/[a-z ]/gi) ?? []).length / candidate.length
      if (prose < 0.75) continue
      if (candidate.split('"').length - 1 > 1) continue
      if (NOT_PROSE.test(candidate)) continue
      if (NOT_A_FINDING.test(candidate)) continue
      // It has to read like a claim about a quantity, not merely contain a year.
      if (/^(?:\d|\W)/.test(candidate)) continue
      if (!/\d+(?:\.\d+)?\s*(?:%|percent|x\b|times|points?|posts?|hours?|days?|weeks?|months?|tokens?|users?|teams?|models?|runs?|cases?|tasks?)/i.test(candidate))
        continue

      return candidate.replace(/[.!?]$/, '')
    }
  }
  return null
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 5 · generation.caption.explanation — THE MODEL CALL
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.explanation', async (payload, ctx) => {
  const temperature = ctx.num('temperature', 60)
  const maxOutputTokens = ctx.num('maxOutputTokens', 2048)
  const layers = ctx.num('layers', 3)
  const citeGrounding = ctx.bool('citeGrounding', true)

  const grounding = payload.grounding ?? []
  const systemInstruction = [
    payload.voiceInstruction ?? '',
    // The declared per-platform difference. Without it the same finding came
    // back as near-identical copy on all four channels.
    platformVoiceInstruction(payload.platform),
    citeGrounding && grounding.length > 0
      ? `Ground every claim in these entries and do not invent figures:\n${grounding
          .map((g) => `· ${g.title} (${g.confidence} confidence): ${g.content}`)
          .join('\n')}`
      : 'You have no retrieved evidence. Make no numeric claims.',
    payload.hashtag ? `The originating hashtag is #${payload.hashtag}.` : '',
  ]
    .filter(Boolean)
    .join('\n\n')

  const prompt = [
    `Write the mechanism section of a ${payload.writingMode ?? 'Long-form'} ${PLATFORM_LABEL[payload.platform]} post.`,
    `Hook already written: "${payload.hook ?? ''}"`,
    `Problem already stated: "${payload.problem ?? ''}"`,
    `Angle: ${payload.angle}`,
    `Audience: ${payload.audience}`,
    `Write exactly ${layers} short paragraphs that explain how it works and what it implies. No hook, no close, no hashtags.`,
  ].join('\n')

  const outcome = await withFallback(
    textAdapter(),
    {
      systemInstruction,
      prompt,
      temperature: temperatureFromPercent(temperature),
      maxOutputTokens,
    },
    () =>
      // The template writer produces a whole caption; the mechanism layers are
      // lifted out of it so the shape matches the live path exactly.
      extractLayers(
        writeTemplateCaption({
          title: payload.title,
          description: payload.description,
          topic: payload.sourceTopic,
          angle: payload.angle,
          audience: payload.audience,
          grounding: grounding.map((g) => ({ title: g.title, content: g.content })),
          hookStyle: 'Declarative',
          hookMaxWords: BRAND.hookMaxWords,
          layers,
          closeStyle: 'Implication',
        }),
        layers,
      ),
    (reason) => {
      ctx.emit('activity', `Caption written by the template writer — ${reason}`, {
        status: 'warn',
        reason,
      })
    },
  )

  const explanation = outcome.value.trim()

  ctx.log(
    `${layers}-layer explanation written by ${outcome.source === 'live' ? textModelId() : 'the deterministic template writer'}`,
  )

  return {
    explanation,
    captionSource: outcome.source,
    captionModel: outcome.source === 'live' ? textModelId() : 'ethara-template-writer',
    ...(outcome.fallbackReason === undefined ? {} : { captionFallbackReason: outcome.fallbackReason }),
  }
})

/** Pulls the middle paragraphs out of a whole template caption. */
function extractLayers(caption: string, layers: number): string {
  const paragraphs = caption.split(/\n{2,}/).map((p) => p.trim()).filter(Boolean)
  const middle = paragraphs.slice(1, Math.max(2, paragraphs.length - 1))
  const chosen = middle.length >= layers ? middle.slice(0, layers) : middle
  return (chosen.length > 0 ? chosen : paragraphs).join('\n\n')
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 6 · generation.caption.close
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.close', (payload, ctx) => {
  const closeStyle = ctx.str('closeStyle', 'Implication')
  const bannedCta = ctx.bool('bannedCta', true)

  const closes: Record<string, string> = {
    Implication: `The implication for anyone shipping ${topicInProse(payload.sourceTopic)}: measure the behaviour you actually want, then reward it. Everything else is downstream of that.`,
    'Open question': `The open question is which of these results survive contact with production traffic. We are running that experiment now.`,
    'Forward look': `The next twelve months of ${topicInProse(payload.sourceTopic)} will be decided by evaluation, not by model size.`,
    None: '',
  }

  let close = closes[closeStyle] ?? closes.Implication ?? ''

  if (bannedCta && /\b(comment below|dm me|link in bio|sign up|book a demo|follow for more)\b/i.test(close)) {
    close = closes.Implication ?? ''
    ctx.log('The close contained a call to action, which rule 5 forbids — replaced with the implication form')
  }

  return { close }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 7 · generation.caption.hashtags
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.hashtags', (payload, ctx) => {
  const requested = ctx.num('count', 4)
  const useSourceHashtag = ctx.bool('useSourceHashtag', true)

  // The brand range is the ceiling and the floor. The knob narrows within it;
  // it cannot escape it.
  const count = Math.min(Math.max(requested, BRAND.hashtags.min), BRAND.hashtags.max)

  /*
   * `deriveHashtags` returns bare names. They must carry the hash here, because
   * the brand enforcer finds the block by matching `#tag` — an unprefixed block
   * is invisible to it, survives untouched, and the enforcer then appends a
   * second, prefixed one. The post ships with its tags twice.
   */
  const derived = deriveHashtags(`${payload.sourceTopic} ${payload.title}`, count)
  const tags = derived.map((tag) => `#${tag.replace(/^#/, '')}`)

  if (useSourceHashtag && payload.hashtag) {
    const source = `#${payload.hashtag.replace(/^#/, '')}`
    if (!tags.some((t) => t.toLowerCase() === source.toLowerCase())) {
      tags.unshift(source)
      if (tags.length > count) tags.length = count
    }
  }

  ctx.log(`${tags.length} hashtag(s): ${tags.join(' ')}`)

  return { hashtagBlock: tags.join(' ') }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 8 · generation.caption.adapt — AND THE UNCONDITIONAL BRAND PASS
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.adapt', (payload, ctx) => {
  const limits: Record<Platform, number> = {
    linkedin: ctx.num('linkedinMaxChars', 2400),
    instagram: ctx.num('instagramMaxChars', 1600),
    x: ctx.num('xMaxChars', 280),
    facebook: ctx.num('facebookMaxChars', 2000),
  }
  const preserveLineBreaks = ctx.bool('preserveLineBreaks', true)

  const parts = [payload.hook, payload.problem, payload.explanation, payload.close].filter(
    (p): p is string => typeof p === 'string' && p.trim().length > 0,
  )

  let body = preserveLineBreaks ? parts.join('\n\n') : parts.join(' ')
  const limit = limits[payload.platform]

  if (payload.platform === 'x') {
    // X is a different medium, not a truncated LinkedIn post: the hook plus one
    // load-bearing sentence, and the hashtag block has to fit inside the limit.
    const tags = payload.hashtagBlock ?? ''
    const room = Math.max(60, limit - tags.length - 2)
    const lead = [payload.hook, firstSentence(payload.explanation ?? payload.problem ?? '')]
      .filter(Boolean)
      .join(' ')
    body = `${clampChars(lead, room).trim()}${tags ? `\n${tags}` : ''}`
  } else {
    const tags = payload.hashtagBlock ?? ''
    const sep = preserveLineBreaks ? '\n\n' : ' '
    const assemble = (explanation: string): string => {
      const blocks = [payload.hook, payload.problem, explanation, payload.close].filter(
        (p): p is string => typeof p === 'string' && p.trim().length > 0,
      )
      const text = blocks.join(sep)
      return tags === '' ? text : `${text}${sep}${tags}`
    }

    const whole = assemble(payload.explanation ?? '')
    if (whole.length <= limit) {
      body = whole
    } else {
      // Trimming from the end amputates the close, and the close is the block
      // that carries the point of the post — a caption that stops mid-argument
      // and jumps to hashtags is a broken post, not a shorter one. The
      // explanation is the compressible block, so it absorbs the overflow and
      // the hook, problem, close and hashtags all survive whole.
      const skeleton = assemble('')
      const room = limit - skeleton.length - sep.length
      const trimmed = room > 0 ? clampChars(payload.explanation ?? '', room) : ''
      const rebuilt = assemble(trimmed)
      if (rebuilt.length <= limit) {
        body = rebuilt
        ctx.log(
          trimmed === ''
            ? `Over the ${limit}-character ${payload.platform} limit — the explanation was dropped so the hook, problem and close stay whole`
            : `Explanation compressed to fit the ${limit}-character ${payload.platform} limit; hook, problem and close are intact`,
        )
      } else {
        // Even the skeleton overruns. Nothing structural can be preserved, so
        // this reports what it had to do rather than doing it quietly.
        body = `${clampChars(assemble(''), Math.max(1, limit - tags.length - sep.length))}${
          tags === '' ? '' : `${sep}${tags}`
        }`
        ctx.log(
          `The hook, problem and close alone exceed the ${limit}-character ${payload.platform} limit, so the caption was cut short. Shorten the hook or raise the limit in Agent Studio.`,
        )
      }
    }
  }

  // Unconditional. Whatever wrote the text, this is the last thing that touches
  // it before it is stored.
  const enforced = enforceBrandVoice(body.trim(), `${payload.sourceTopic} ${payload.title}`)

  if (enforced.changed) {
    ctx.log(
      `Brand voice enforced (rule${enforced.rulesApplied.length === 1 ? '' : 's'} ${enforced.rulesApplied.join(', ')}): ${enforced.notes.slice(0, 3).join('; ')}`,
    )
  }

  return {
    caption: enforced.text,
    captionBody: body.trim(),
    brandNotes: enforced.notes,
  }
})

function firstSentence(text: string): string {
  return (text.split(/(?<=[.!?])\s/)[0] ?? text).trim()
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 9 · generation.caption.variants
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.variants', (payload, ctx) => {
  const count = ctx.num('count', 2)
  const minDivergence = ctx.num('minDivergence', 25) / 100

  const base = payload.caption ?? ''
  if (base.length === 0) return { variants: [] }

  const paragraphs = base.split(/\n{2,}/).filter(Boolean)
  const candidates: string[] = []

  // Variant 1 — lead with the evidence rather than the claim.
  if (paragraphs.length >= 3) {
    const reordered = [paragraphs[1], paragraphs[0], ...paragraphs.slice(2)].filter(Boolean)
    candidates.push(reordered.join('\n\n'))
  }

  // Variant 2 — the compressed read: hook, mechanism, close.
  if (paragraphs.length >= 4) {
    candidates.push(
      [paragraphs[0], paragraphs[2], paragraphs[paragraphs.length - 1]].filter(Boolean).join('\n\n'),
    )
  }

  const variants = candidates
    .filter((candidate) => 1 - similarity(candidate, base) >= minDivergence)
    .slice(0, Math.max(0, count))

  ctx.log(
    variants.length === 0
      ? `No variant diverged by the required ${Math.round(minDivergence * 100)}%, so none were kept`
      : `${variants.length} variant(s) kept above ${Math.round(minDivergence * 100)}% divergence`,
  )

  return { variants }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 10 · generation.caption.sourceLink
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.sourceLink', (payload, ctx) => {
  if (!ctx.bool('enabled', true)) return {}

  const placement = ctx.str('placement', 'End of post')
  const grounding = payload.grounding ?? []
  const source = grounding.flatMap((g) => g.sources)[0]

  if (!source) {
    ctx.log('No cited source on the grounding entries, so no citation was attached')
    return { citation: '' }
  }

  const citation = `Source: ${source.title} — ${source.url}`
  let caption = payload.caption ?? ''

  if (placement === 'End of post') {
    caption = `${caption}\n\n${citation}`
  } else if (placement === 'Inline') {
    // Inline means after the evidence paragraph, not glued to the hook.
    const paragraphs = caption.split(/\n{2,}/)
    const insertAt = Math.min(2, Math.max(1, paragraphs.length - 1))
    paragraphs.splice(insertAt, 0, `(${citation})`)
    caption = paragraphs.join('\n\n')
  }
  // 'First comment' leaves the caption alone and carries the citation separately.

  ctx.log(`Citation placement: ${placement}`)

  return { caption, citation }
})

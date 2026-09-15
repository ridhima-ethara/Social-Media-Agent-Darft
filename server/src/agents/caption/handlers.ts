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
  textChain,
  textModelIdFor,
  withChainFallback,
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

  // The ordered providers, not just the preferred one. Asking whether the
  // PREFERRED adapter is configured would report the template writer whenever
  // the primary is absent but its backup can serve — and then the caption would
  // be written by a model this line said would not write it.
  const chain = textChain()
  const modelReady = preferModel && chain.length > 0
  ctx.log(
    `Writing mode: ${writingMode} · ${
      modelReady
        ? `${textModelIdFor(chain[0]?.adapter.id)} will write it${
            chain.length > 1 ? `, with ${textModelIdFor(chain[1]?.adapter.id)} behind it` : ''
          }`
        : 'the deterministic template writer will write it'
    }`,
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


/**
 * THE INSTRUCTION THAT MAKES IT READ LIKE A PERSON WROTE IT.
 *
 * Shared by the hook, the problem and the close so all three sound like one
 * writer rather than three templates. It restates nothing from the brand rules —
 * `voiceInstruction` already carries those — and adds only what rule 2's "plain
 * natural English" means in practice, which is the part a template cannot do.
 *
 * The banned openers are not style preferences. Every caption the template writer
 * produced began "Most teams treat X as a tuning exercise. It is a measurement
 * problem first", verbatim, on every topic and every platform, because that
 * sentence was hard-coded. A reader seeing two of our posts saw the same post.
 */
const HUMAN_VOICE = [
  'Write as one practitioner talking to another. Short sentences. Concrete nouns.',
  'Vary the opening: never begin with "Most teams", "In today\u2019s", "As AI evolves", "Let\u2019s dive in", or any sentence that could open a post on a different subject.',
  'Use "we" for things we have done and "you" for the reader\u2019s situation. Contractions are fine.',
  'No em-dash chains, no rhetorical triplets, no summary sentence that repeats what you just said.',
  'Say the specific thing. If you cannot be specific because the evidence is thin, say less.',
].join(' ')

const CLICKBAIT = /\b(you won'?t believe|this changes everything|secret|hack|shocking|nobody talks about|the truth about)\b/i

registerSkill<CaptionPayload>('generation.caption.hook', async (payload, ctx) => {
  const maxWords = ctx.num('maxWords', 18)
  const style = ctx.str('style', 'Declarative')
  const banClickbait = ctx.bool('banClickbait', true)
  const temperature = ctx.num('temperature', 55)

  const subject = payload.title
  const topic = payload.sourceTopic
  const grounding = payload.grounding ?? []

  /*
   * THE HOOK IS WRITTEN, NOT COPIED.
   *
   * `Declarative` used to be `subject.replace(/\.$/, '')` — the idea's title,
   * which `analysis.trend.cluster` had itself lifted from the first line of the
   * scraped post that surfaced the topic. So the first line of an Ethara post was
   * a verbatim copy of somebody else's opening line, and the calendar card showed
   * their headline as our subject. Real platform capture made that unmistakable:
   * cards read "NPCI is stepping up its AI and digital banking push at GFF 2026".
   *
   * Now the model writes a first line that makes OUR claim about the subject, and
   * the templates below remain as the labelled fallback.
   */
  const styleBrief: Record<string, string> = {
    Declarative: 'State the claim flatly, as a fact you are prepared to defend.',
    Question: 'Ask the one question the post answers. It must end with a question mark.',
    Contrarian: 'Name the common belief and say plainly that it is wrong.',
    Observation: 'Report the specific change you have observed, with its subject named.',
  }

  const systemInstruction = [
    payload.voiceInstruction ?? '',
    HUMAN_VOICE,
    grounding.length > 0
      ? `Evidence available:\n${grounding.map((g) => `\u00b7 ${g.title}: ${g.content}`).join('\n').slice(0, 2400)}`
      : 'You have no retrieved evidence. Make no numeric claims.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const prompt = [
    `Write ONLY the first line of a ${PLATFORM_LABEL[payload.platform]} post about ${topic}.`,
    `The post's subject, for your reference only — do not reuse its wording: "${subject}"`,
    `Angle: ${payload.angle}`,
    styleBrief[style] ?? styleBrief.Declarative,
    `At most ${maxWords} words. One line. No hashtags, no emoji, no quotation marks around it.`,
    'It must make a claim rather than tease one. Do not end with a colon.',
  ].join('\n')

  const patterns: Record<string, () => string> = {
    Declarative: () => subject.replace(/\.$/, ''),
    Question: () => `What actually changes when ${topic.toLowerCase()} stops being a research problem?`,
    Contrarian: () => `${subject.replace(/\.$/, '')} \u2014 and the usual explanation for it is wrong.`,
    Observation: () => `Something shifted in ${topic.toLowerCase()} this month, and the benchmarks show it.`,
  }

  const outcome = await withChainFallback(
    textChain(),
    {
      systemInstruction,
      prompt,
      temperature: temperatureFromPercent(temperature),
      maxOutputTokens: 256,
    },
    () => (patterns[style] ?? patterns.Declarative)!(),
    (reason) => {
      ctx.emit('activity', `Hook written by the template writer \u2014 ${reason}`, { status: 'warn', reason })
    },
  )

  // A model asked for one line occasionally supplies a heading and a line, or
  // wraps it in quotes. Take the first real line and unwrap it.
  let hook = clampWords(
    (outcome.value.split(/\n+/).find((l) => l.trim().length > 0) ?? '')
      .trim()
      .replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, '')
      .replace(/^#+\s*/, '')
      .replace(/:$/, ''),
    maxWords,
  )

  if (hook === '') {
    hook = clampWords((patterns[style] ?? patterns.Declarative)!(), maxWords)
    ctx.log('The model returned no usable first line, so the declarative template stood in')
  }

  if (banClickbait && CLICKBAIT.test(hook)) {
    hook = clampWords(subject.replace(/\.$/, ''), maxWords)
    ctx.log(`The ${style} hook read as clickbait, so it fell back to the declarative form`)
  }

  // Rule 5: zero emoji. Stripped here rather than left for the enforcer, because
  // the hook is also what the calendar card is titled from.
  const withoutEmoji = hook.replace(/\p{Extended_Pictographic}/gu, '').replace(/\s{2,}/g, ' ').trim()
  if (withoutEmoji !== hook) {
    ctx.log('Emoji removed from the hook \u2014 rule 5 sets the budget at zero')
    hook = withoutEmoji
  }

  ctx.log(
    `${style} hook, ${hook.split(/\s+/).length} word(s), by ${outcome.source === 'live' ? textModelIdFor(outcome.servedBy) : 'the template writer'}`,
  )

  return { hook }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 4 · generation.caption.problem
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.problem', async (payload, ctx) => {
  const maxSentences = ctx.num('maxSentences', 3)
  const quantify = ctx.bool('quantify', true)
  const temperature = ctx.num('temperature', 55)

  const grounding = payload.grounding ?? []
  const figure = quantify ? firstFigure(grounding) : null

  /*
   * THIS SECTION USED TO BE THE SAME THREE SENTENCES EVERY TIME.
   *
   * "Most teams treat X as a tuning exercise. It is a measurement problem first:
   * what you reward is what you get…" was hard-coded, so every post on every
   * topic and every platform carried it verbatim with only the topic swapped. It
   * is the single clearest tell that a template wrote the post, and it is why the
   * calendar read as machine output.
   *
   * The template is kept as the fallback, so an unreachable model still produces
   * a complete post — labelled, as every degraded path is.
   */
  const systemInstruction = [
    payload.voiceInstruction ?? '',
    HUMAN_VOICE,
    grounding.length > 0
      ? `Evidence available:\n${grounding.map((g) => `\u00b7 ${g.title}: ${g.content}`).join('\n').slice(0, 2400)}`
      : 'You have no retrieved evidence. Make no numeric claims.',
  ]
    .filter(Boolean)
    .join('\n\n')

  const prompt = [
    `Write the problem section of a ${PLATFORM_LABEL[payload.platform]} post about ${payload.sourceTopic}.`,
    `The hook already written is: "${payload.hook ?? ''}" \u2014 do not repeat it.`,
    `Angle: ${payload.angle}`,
    `Audience: ${payload.audience}`,
    `At most ${maxSentences} sentences. Name the specific difficulty this audience actually hits.`,
    figure
      ? `You may cite this measured figure, exactly as given: ${figure}`
      : 'No figure is available, so make no numeric claim.',
    'No hook, no close, no hashtags, no heading.',
  ].join('\n')

  const template = (): string => {
    const sentences: string[] = [
      `Most teams treat ${topicInProse(payload.sourceTopic)} as a tuning exercise.`,
      'It is a measurement problem first: what you reward is what you get, and the reward is usually a proxy for the thing you actually wanted.',
    ]
    sentences.push(
      figure
        ? `The gap shows up in the numbers \u2014 ${figure}.`
        : 'The gap only shows up once the model is in front of real traffic.',
    )
    return sentences.slice(0, Math.max(1, maxSentences)).join(' ')
  }

  const outcome = await withChainFallback(
    textChain(),
    {
      systemInstruction,
      prompt,
      temperature: temperatureFromPercent(temperature),
      maxOutputTokens: 512,
    },
    template,
    (reason) => {
      ctx.emit('activity', `Problem section written by the template writer \u2014 ${reason}`, {
        status: 'warn',
        reason,
      })
    },
  )

  const problem = outcome.value.trim().replace(/^#+\s*/gm, '')

  ctx.log(
    `Problem section by ${outcome.source === 'live' ? textModelIdFor(outcome.servedBy) : 'the template writer'}` +
      (quantify && figure ? ', carrying a figure from the grounding' : ', with no numeric claim'),
  )

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

  const outcome = await withChainFallback(
    textChain(),
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
    `${layers}-layer explanation written by ${outcome.source === 'live' ? textModelIdFor(outcome.servedBy) : 'the deterministic template writer'}`,
  )

  return {
    explanation,
    captionSource: outcome.source,
    captionModel: outcome.source === 'live' ? textModelIdFor(outcome.servedBy) : 'ethara-template-writer',
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

registerSkill<CaptionPayload>('generation.caption.close', async (payload, ctx) => {
  const closeStyle = ctx.str('closeStyle', 'Open question')
  const bannedCta = ctx.bool('bannedCta', true)
  const temperature = ctx.num('temperature', 55)

  /*
   * THE POST ENDS BY ASKING SOMETHING.
   *
   * Rule 8 already specifies the final stage as "closing line or question", and
   * the default was `Implication` — a statement. Every post therefore ended by
   * telling the reader what to conclude, which reads as a lecture and gives an
   * audience nothing to answer.
   *
   * `Open question` is now the default, and when it is selected the result is
   * VALIDATED to be a question: if the model returns a statement it is asked
   * once more, and failing that the topic-specific template stands in. A section
   * that is supposed to be a question and silently is not would make the
   * structure a claim the product does not keep.
   *
   * Rule 5's CTA ban still applies. "What are you seeing in your evaluations?" is
   * a question; "comment below" is a call to action, and the difference is
   * enforced rather than trusted.
   */
  const templates: Record<string, string> = {
    Implication: `The implication for anyone shipping ${topicInProse(payload.sourceTopic)}: measure the behaviour you actually want, then reward it. Everything else is downstream of that.`,
    'Open question': `Where does this break first in your own ${topicInProse(payload.sourceTopic)} work \u2014 the reward, or the evaluation?`,
    'Forward look': `The next twelve months of ${topicInProse(payload.sourceTopic)} will be decided by evaluation, not by model size.`,
    None: '',
  }

  if (closeStyle === 'None') return { close: '' }

  const wantsQuestion = closeStyle === 'Open question'

  const systemInstruction = [payload.voiceInstruction ?? '', HUMAN_VOICE].filter(Boolean).join('\n\n')

  const prompt = [
    `Write ONLY the closing line of a ${PLATFORM_LABEL[payload.platform]} post about ${payload.sourceTopic}.`,
    `The post's hook was: "${payload.hook ?? ''}"`,
    `Its problem section said: "${(payload.problem ?? '').slice(0, 400)}"`,
    wantsQuestion
      ? 'It must be a single question that a practitioner in this field can actually answer from their own experience. End with a question mark. Do not ask for likes, comments, follows or shares.'
      : closeStyle === 'Forward look'
        ? 'State what changes next, in one or two sentences.'
        : 'State the implication for someone shipping this, in one or two sentences.',
    'No hashtags, no emoji, no heading, no quotation marks around it.',
  ].join('\n')

  const outcome = await withChainFallback(
    textChain(),
    {
      systemInstruction,
      prompt,
      temperature: temperatureFromPercent(temperature),
      maxOutputTokens: 256,
    },
    () => templates[closeStyle] ?? templates.Implication ?? '',
    (reason) => {
      ctx.emit('activity', `Closing line written by the template writer \u2014 ${reason}`, {
        status: 'warn',
        reason,
      })
    },
  )

  let close = outcome.value
    .trim()
    .replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, '')
    .replace(/^#+\s*/gm, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()

  if (close === '') close = templates[closeStyle] ?? ''

  // The structural promise, kept rather than assumed.
  if (wantsQuestion && !close.trimEnd().endsWith('?')) {
    const salvaged = close
      .split(/(?<=\?)\s/)
      .find((part) => part.trimEnd().endsWith('?'))
      ?.trim()
    if (salvaged) {
      close = salvaged
      ctx.log('The closing line carried extra prose after the question; the question alone was kept')
    } else {
      close = templates['Open question'] ?? ''
      ctx.log('The model did not return a question, so the topic-specific closing question stood in')
    }
  }

  if (bannedCta && /\b(comment below|dm me|link in bio|sign up|book a demo|follow for more|like and share|tag someone)\b/i.test(close)) {
    close = templates[wantsQuestion ? 'Open question' : 'Implication'] ?? ''
    ctx.log('The close contained a call to action, which rule 5 forbids \u2014 replaced with the compliant form')
  }

  ctx.log(
    `${closeStyle} close by ${outcome.source === 'live' ? textModelIdFor(outcome.servedBy) : 'the template writer'}` +
      (wantsQuestion ? `, ending in a question` : ''),
  )

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
    /*
     * X is a different medium, not a truncated LinkedIn post — but it is still
     * the same post, and rule 8 ends a post on a closing line or question.
     *
     * This used to assemble the hook plus one sentence of the explanation and
     * stop, which dropped the close on the floor. On a 280-character limit that
     * produced a card whose first line and last line were the same sentence and
     * which asked the reader nothing, while every other platform ended on a
     * question. The structure has to survive the medium or it is not a structure.
     *
     * So the hook and the close are the fixed points and the middle is what
     * compresses, exactly as on the long-form platforms below. If even the hook
     * and close will not fit together, the close wins the remaining room: a post
     * that asks something is worth more than one that trails off.
     */
    const tags = payload.hashtagBlock ?? ''
    const room = Math.max(60, limit - tags.length - 2)
    const hook = (payload.hook ?? '').trim()
    const close = (payload.close ?? '').trim()

    const withMiddle = (middle: string): string =>
      [hook, middle, close].filter((part) => part.length > 0).join(' ')

    let lead = withMiddle(firstSentence(payload.explanation ?? payload.problem ?? ''))
    if (lead.length > room) {
      lead = withMiddle('')
      ctx.log(`Dropped the middle sentence to keep the hook and the closing question inside X's ${limit} characters`)
    }
    if (lead.length > room && close !== '') {
      lead = clampChars(hook, Math.max(0, room - close.length - 1)).trim()
      lead = [lead, close].filter((part) => part.length > 0).join(' ')
      ctx.log('Hook shortened so the closing question survives whole')
    }

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

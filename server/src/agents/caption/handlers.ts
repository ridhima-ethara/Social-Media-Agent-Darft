/**
 * CAPTION AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `caption`, and `npm run agent:check` fails if not.
 */

import {
  BRAND,
  deriveHashtags,
  deriveKeywords,
  enforceBrandVoice,
  platformVoiceInstruction,
  topicInProse,
} from '../../../../shared/brand-voice'
import { closeReference, hookReference } from '../../../../shared/caption-examples'
import type { ContentFormat, HookPattern, Platform } from '../../../../shared/agent-contract'
import {
  HOOK_PATTERNS,
  HOOK_PATTERN_BRIEF,
  HOOK_PATTERN_LABEL,
  SIGNALS_CATEGORY,
  DISCOVERED_HASHTAG_CATEGORY,
} from '../../../../shared/agent-contract'
import {
  temperatureFromPercent,
  textChain,
  textModelIdFor,
  withChainFallback,
  writeTemplateCaption,
} from '../../integrations'
import {
  activeVoiceProfile,
  capturedPostPerformance,
  insertVoiceProfile,
  listKnowledge,
  listVoiceSamples,
  publishedPostPerformance,
  type VoiceProfileRow,
} from '../../db/repo'
import { clamp, clampChars, clampWords, contentWords, mean, PLATFORM_LABEL, seededFor, similarity } from '../corpus'
import { withCaptionSpec } from '../skills/skill-spec'
import { etharaDomainFor, etharaLineProblem, etharaTemplate } from '../ethara-line'
import { registerSkill } from '../runtime'
import { retrieveKnowledge, toGroundingEntry } from '../knowledge/handlers'
import type { CaptionPayload, GroundingEntry } from '../skills/index'


/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 1 · generation.caption.mode
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   NARRATIVE STANCE — the argumentative shape, not the register

   Declared here beside the writing mode because both are resolved in the same
   skill and an operator reads them together. The rotation is WEIGHTED toward
   `default`: the caption skill names it the most common stance, and a calendar
   where two posts in three argue from the brand would read as advertising.

   Deterministic from the idea id, so the same post always draws the same stance
   and a re-run is replayable rather than producing a different shape each time.
   ═══════════════════════════════════════════════════════════════════════════ */

export type CaptionStance = 'default' | 'how-ethara-thinks' | 'problem-solution-trajectory'

const STANCE_BY_LABEL: Record<string, CaptionStance> = {
  Default: 'default',
  'How Ethara thinks': 'how-ethara-thinks',
  'Problem and solution': 'problem-solution-trajectory',
}

/** Two of four are `default`, so the mix stays mostly ordinary posts. */
const STANCE_ROTATION: CaptionStance[] = [
  'default',
  'how-ethara-thinks',
  'default',
  'problem-solution-trajectory',
]

export const STANCE_LABEL: Record<CaptionStance, string> = {
  default: 'Default',
  'how-ethara-thinks': 'How Ethara thinks',
  'problem-solution-trajectory': 'Problem and solution',
}

/**
 * WHAT THE STANCE ASKS THE WRITER FOR.
 *
 * Appended to `voiceInstruction`, so it reaches the hook, the problem and the
 * close through the one channel all three already read. The wording is
 * deliberately defensive on the middle beat of the solution stance: that beat is
 * the single place in this agent where a model will invent an Ethara capability,
 * and the skill's boundary is that it is grounded or it is dropped.
 */
export function stanceInstruction(stance: CaptionStance): string {
  switch (stance) {
    case 'how-ethara-thinks':
      return [
        'STANCE — how Ethara thinks. Say what the topic is, then what we take from it:',
        'which distinction matters, which assumption we would not make, what we would measure instead.',
        'The topic comes from the scraped evidence; the reasoning comes from the grounding entries.',
        'This is a point of view on evidence. Do not claim a product, a customer or a result.',
      ].join(' ')
    case 'problem-solution-trajectory':
      return [
        'STANCE — problem, what Ethara does about it, where the world is moving. Three beats:',
        'first the problem the scraped evidence shows, and who it breaks for;',
        'second how Ethara approaches it, using ONLY what the grounding entries state about our',
        'capability — describe the approach, never an outcome, and state no customer, deployment,',
        'figure or result that an entry does not;',
        'third close on where the evidence points, as a direction of travel rather than a prediction of fact.',
        'If the grounding says nothing about an Ethara capability here, omit the second beat entirely',
        'and write an ordinary post. Do not substitute the positioning line for evidence.',
      ].join(' ')
    default:
      return ''
  }
}

registerSkill<CaptionPayload>('generation.caption.mode', (payload, ctx) => {
  const requested = ctx.str('mode', 'Auto')
  const requestedStance = ctx.str('stance', 'Rotate')
  const preferModel = ctx.bool('preferModel', true)

  let writingMode = requested
  if (requested === 'Auto') {
    // The recommended format decides, so the mode never contradicts the plan.
    if (payload.format === 'Carousel') writingMode = 'Carousel script'
    else if (payload.platform === 'x') writingMode = 'Short'
    else writingMode = 'Long-form'
  }

  /*
   * The stance. `Rotate` spreads the three shapes across the calendar; a named
   * stance is honoured exactly. Whether the grounding it needs actually exists
   * is decided in `generation.caption.voice`, which is the skill that holds the
   * Knowledge Base entries — deciding it here would mean guessing.
   */
  const stance: CaptionStance =
    requestedStance === 'Rotate'
      ? ((STANCE_ROTATION[
          Math.floor(seededFor(payload.ideaId || payload.title)() * STANCE_ROTATION.length)
        ] ?? 'default') as CaptionStance)
      : (STANCE_BY_LABEL[requestedStance] ?? 'default')

  // The ordered providers, not just the preferred one. Asking whether the
  // PREFERRED adapter is configured would report the template writer whenever
  // the primary is absent but its backup can serve — and then the caption would
  // be written by a model this line said would not write it.
  const chain = textChain()
  const modelReady = preferModel && chain.length > 0
  ctx.log(
    `Writing mode: ${writingMode} · stance: ${STANCE_LABEL[stance]} · ${
      modelReady
        ? `${textModelIdFor(chain[0]?.adapter.id)} will write it${
            chain.length > 1 ? `, with ${textModelIdFor(chain[1]?.adapter.id)} behind it` : ''
          }`
        : 'the deterministic template writer will write it'
    }`,
  )

  return { writingMode, stance }
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

  /*
   * SCRAPED SIGNAL RECORDS ARE NOT EVIDENCE.
   *
   * `recordScrapedTopicsAsKnowledge` writes a `Signal · <keyword>` entry per
   * capture so an operator can see what was scraped. Those entries are
   * bookkeeping: their content reads "Scraped signal for X. Topics: … Seen on 5
   * pages this scrape." Left in the grounding pool they do two kinds of damage —
   * the writer treats them as a finding it may assert, and `firstFigure()` will
   * happily lift that "5" into a caption as though it were a measured result.
   *
   * They stay in the Knowledge Base and stay visible on its own screen. They
   * simply do not ground a claim, and they are not citable (see `sourceLink`).
   */
  const grounding: GroundingEntry[] = rows
    .map(toGroundingEntry)
    .filter((entry) => entry.category !== SIGNALS_CATEGORY && entry.category !== DISCOVERED_HASHTAG_CATEGORY)

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

  /*
   * THE STANCE IS GROUNDED OR IT IS ABANDONED.
   *
   * Decided here rather than in `generation.caption.mode` because this is the
   * skill that holds the Knowledge Base entries — checking it there would mean
   * guessing at what retrieval would return. A stance that asks the writer to
   * speak for Ethara needs a corpus entry behind it; without one it degrades to
   * `default` and the reason travels on the payload, because a stance that
   * silently became something else is the kind of thing rule 6 exists to stop.
   */
  const requestedStance = (payload.stance ?? 'default') as CaptionStance
  const corpusEntries = grounding.filter(
    (entry) => entry.category !== 'Brand Voice' && entry.content.trim() !== '',
  )
  const brandCorpus = [...brandEntries, ...corpusEntries]

  let stance = requestedStance
  let stanceDegradedReason = ''

  if (requestedStance !== 'default' && brandCorpus.length === 0) {
    stance = 'default'
    stanceDegradedReason =
      `The “${STANCE_LABEL[requestedStance]}” stance needs a Knowledge Base corpus entry behind it and none is active for “${payload.sourceTopic}”. ` +
      'Written as an ordinary post instead — the positioning line is not evidence.'
    ctx.emit('activity', stanceDegradedReason, { status: 'warn' })
  }

  const clause = stanceInstruction(stance)
  const instruction = clause === '' ? voiceInstruction : `${voiceInstruction}\n${clause}`

  ctx.log(
    grounding.length === 0
      ? 'No matching Knowledge Base entry — writing from the brand definition alone'
      : `Grounded in ${grounding.length} entr${grounding.length === 1 ? 'y' : 'ies'}: ${grounding.map((g) => g.title).slice(0, 2).join('; ')}${grounding.length > 2 ? '…' : ''}`,
  )

  if (stance !== 'default') {
    ctx.log(`Stance: ${STANCE_LABEL[stance]} — ${brandCorpus.length} corpus entr${brandCorpus.length === 1 ? 'y' : 'ies'} behind it`)
  }

  return {
    grounding,
    voiceInstruction: instruction,
    stance,
    ...(stanceDegradedReason === '' ? {} : { stanceDegradedReason }),
  }
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
/**
 * Instagram's hashtag count is a fixed number in the caption skill, not a range:
 * exactly five, followed by the bracketed keyword line. Declared here so the
 * skill handler and the acceptance check read the same value.
 */
const INSTAGRAM_HASHTAGS = 5

const HUMAN_VOICE = [
  'Write as one practitioner talking to another. Short sentences. Concrete nouns.',
  'Vary the opening: never begin with "Most teams", "In today\u2019s", "As AI evolves", "Let\u2019s dive in", or any sentence that could open a post on a different subject.',
  'Use "we" for things we have done and "you" for the reader\u2019s situation. Contractions are fine.',
  'No em-dash chains, no rhetorical triplets, no summary sentence that repeats what you just said.',
  'Say the specific thing. If you cannot be specific because the evidence is thin, say less.',
].join(' ')

const CLICKBAIT = /\b(you won'?t believe|this changes everything|secret|hack|shocking|nobody talks about|the truth about)\b/i

/* ── The whole post, in one pass ────────────────────────────────────────── */

interface WholePost {
  claim: string
  hook: string
  problem: string
  explanation: string
  close: string
}

function parseWholePost(raw: string): WholePost | null {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced ? (fenced[1] as string) : raw
  const start = body.indexOf('{')
  const end = body.lastIndexOf('}')
  if (start === -1 || end <= start) return null
  try {
    const parsed = JSON.parse(body.slice(start, end + 1)) as Record<string, unknown>
    const field = (key: string): string => (typeof parsed[key] === 'string' ? (parsed[key] as string).trim() : '')
    const post = { claim: field('claim'), hook: field('hook'), problem: field('problem'), explanation: field('explanation'), close: field('close') }
    return post.hook && post.explanation && post.close ? post : null
  } catch {
    return null
  }
}

const wordCount = (text: string): number => text.split(/\s+/).filter((w) => w.length > 0).length

/** What a whole-post draft gets wrong against its own brief, in words the retry can act on. */
function wholePostProblems(post: WholePost, opts: { minWords: number; maxWords: number; hookWords: number; evidence: string }): string[] {
  const problems: string[] = []
  const words = wordCount([post.hook, post.problem, post.explanation, post.close].join(' '))
  if (words > opts.maxWords) problems.push(`it ran to ${words} words; the target is ${opts.minWords}\u2013${opts.maxWords}`)
  if (words < opts.minWords * 0.7) problems.push(`it ran to only ${words} words; the target is ${opts.minWords}\u2013${opts.maxWords}`)
  if (wordCount(post.hook) > opts.hookWords) problems.push(`the hook ran to ${wordCount(post.hook)} words; at most ${opts.hookWords}`)
  if (!post.close.trimEnd().endsWith('?')) problems.push('the close is not a single question')
  if (/\b(thoughts|agree|comment below|tag someone|like and share)\?*\s*$/i.test(post.close)) problems.push('the close is engagement bait')
  const allowed = new Set(opts.evidence.match(/\d+(?:\.\d+)?/g) ?? [])
  const invented = [post.hook, post.problem, post.explanation, post.close]
    .join(' ')
    .match(/\d+(?:\.\d+)?/g)
    ?.filter((n) => !allowed.has(n))
  if (invented && invented.length > 0) problems.push(`it states a figure the evidence does not (${invented[0]})`)
  if (/ethara/i.test([post.hook, post.problem, post.explanation, post.close].join(' ')))
    problems.push('it mentions Ethara, which is added separately from the Knowledge Base')
  return problems
}

/**
 * THE WHOLE POST, CLAIM FIRST.
 *
 * The caption used to be four separate model calls — hook, then problem, then
 * explanation, then close — each seeing only fragments of the others. The body
 * restated the hook, the mechanism restated the problem, and "This means… /
 * The implication is that…" filled the gaps. The skill asks for the opposite:
 * one primary insight, identified BEFORE the hook, then the narrative in order
 * with every line earning its place.
 *
 * So the post is written in one pass that returns its parts as JSON, and is
 * checked against its own brief — length, hook length, a question close, no
 * figure the evidence lacks, no Ethara mention (that line comes from the
 * Knowledge Base) — with one retry naming what was wrong. It returns null when
 * no model answers or the answer cannot be parsed; the section-by-section steps
 * then run as before, so nothing is worse than it was.
 */
export async function writeWholePost(
  payload: CaptionPayload,
  ctx: Parameters<Parameters<typeof registerSkill<CaptionPayload>>[1]>[1],
  opts: { hookWords: number; styleBrief: string; temperature: number; minWords: number; maxWords: number },
): Promise<{ post: WholePost; model: string } | null> {
  const grounding = payload.grounding ?? []
  const evidence = [
    payload.title,
    payload.description,
    ...grounding.map((g) => `${g.title}: ${g.content}`),
  ].join('\n')

  const systemInstruction = withCaptionSpec(
    [
      payload.voiceInstruction ?? '',
      HUMAN_VOICE,
      platformVoiceInstruction(payload.platform),
      grounding.length > 0
        ? `Evidence you may use — and nothing else for facts or figures:\n${grounding.map((g) => `\u00b7 ${g.title}: ${g.content}`).join('\n').slice(0, 3200)}`
        : 'You have no retrieved evidence beyond the idea itself. Make no numeric claims.',
    ]
      .filter(Boolean)
      .join('\n\n'),
  )

  const brief = [
    `Write one complete ${PLATFORM_LABEL[payload.platform]} post about ${payload.sourceTopic}.`,
    `The idea: ${payload.title}. ${payload.description}`,
    `Angle: ${payload.angle}. Written for: ${payload.audience}.`,
    '',
    'Work in this order, and return the parts as JSON:',
    '1. "claim": the ONE central insight the post argues, in one sentence, drawn from the evidence. Everything else serves it.',
    `2. "hook": the first line, written AFTER the claim, at most ${opts.hookWords} words. ${opts.styleBrief} It must create tension from a real limitation, trade-off or overlooked consequence, and name or clearly signal THIS subject \u2014 a line that could open any AI post is a failure. Never "can" turned into "will", never an unsupported figure.`,
    '3. "problem": a few short lines of context: what breaks, and for whom. Do not restate the hook. If the hook is a question, start answering it here.',
    '4. "explanation": the mechanism, then a concrete example or the evidence, then the implication. Short connected lines, one complete thought per line, a blank line between thoughts. Every line must add something the earlier lines did not \u2014 never restate the hook, the problem or an earlier line. Label a hypothetical as an example.',
    '5. "close": exactly one question a practitioner can answer from their own work, specific to this post\u2019s mechanism, returning to the issue the hook raised. Never "Thoughts?", "Agree?", or a request to like, comment, share or follow.',
    '',
    `Length: the hook, problem, explanation and close together run ${opts.minWords}\u2013${opts.maxWords} words. Shorter is right when the evidence is thin; never pad.`,
    'Plain text inside each field: no hashtags, no emoji, no Markdown, no bold, no labels such as "Hook:", and no em dashes.',
    'Do not mention Ethara \u2014 the Ethara line is added separately. State no number that is not in the evidence.',
    'Return ONLY a JSON object with the string keys "claim", "hook", "problem", "explanation" and "close".',
  ].join('\n')

  const call = async (prompt: string) =>
    withChainFallback(
      textChain(),
      { systemInstruction, prompt, temperature: opts.temperature, maxOutputTokens: 3000 },
      () => '',
      (reason) => {
        ctx.emit('activity', `Whole-post pass unavailable \u2014 ${reason}; writing section by section`, { status: 'warn', reason })
      },
    )

  const first = await call(brief)
  if (first.source !== 'live') return null
  let post = parseWholePost(first.value)
  let model = textModelIdFor(first.servedBy)
  if (!post) {
    ctx.log('The whole-post pass returned no usable JSON; writing section by section')
    return null
  }

  const checks = { minWords: opts.minWords, maxWords: opts.maxWords, hookWords: opts.hookWords, evidence }
  const problems = wholePostProblems(post, checks)
  if (problems.length > 0) {
    ctx.log(`Whole-post draft sent back once: ${problems.join('; ')}`)
    const retry = await call(
      `${brief}\n\nYour previous draft is below. Fix exactly these problems and keep the same central claim: ${problems.join('; ')}.\n\n${JSON.stringify(post)}`,
    )
    const second = retry.source === 'live' ? parseWholePost(retry.value) : null
    if (second && wholePostProblems(second, checks).length < problems.length) {
      post = second
      model = textModelIdFor(retry.servedBy)
    }
    const left = wholePostProblems(post, checks)
    if (left.length > 0) ctx.emit('activity', `Caption kept with ${left.length} open issue(s): ${left.join('; ')}`, { status: 'warn' })
  }

  // The hook is one line and stays inside its budget whatever came back.
  post.hook = clampWords(post.hook.split(/\n+/)[0]?.trim().replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, '') ?? '', opts.hookWords)
  ctx.log(`Whole post written in one pass by ${model} \u2014 claim: \u201c${post.claim.slice(0, 120)}\u201d`)
  return { post, model }
}

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
    Provocative:
      'Name the uncomfortable thing directly. State a real limitation, trade-off or ' +
      'overlooked consequence that the body then examines. Address the reader\u2019s own ' +
      'situation where it is honest to \u2014 "your agent", "your benchmark" \u2014 and let the ' +
      'line sting without exaggerating. A short second clause that turns the knife is ' +
      'allowed: "A flawless demo can hide a fragile agent."',
    Question:
      'Ask the one question the post answers, about this specific subject. It must end ' +
      'with a question mark, and the body must begin answering it immediately.',
    Contrarian: 'Name the common belief and say plainly that it is wrong.',
    Declarative: 'State the claim flatly, as a fact you are prepared to defend.',
    Observation: 'Report the specific change you have observed, with its subject named.',
  }

  const systemInstructionRaw = [
    payload.voiceInstruction ?? '',
    HUMAN_VOICE,
    grounding.length > 0
      ? `Evidence available:\n${grounding.map((g) => `\u00b7 ${g.title}: ${g.content}`).join('\n').slice(0, 2400)}`
      : 'You have no retrieved evidence. Make no numeric claims.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const systemInstruction = withCaptionSpec(systemInstructionRaw)

  /*
   * The reference bank, rotated per idea.
   *
   * Without it every hook converged on the same two or three shapes, because the
   * only guidance was the style brief and that is a sentence long. The examples
   * demonstrate register; the rotation keyed on the idea keeps two posts from
   * being shown the same four lines. Neither may be copied — the prompt says so
   * twice, and `hookReference` says it again in its closing instruction.
   */
  const reference = hookReference(topic, payload.ideaId ?? subject)

  if (ctx.bool('wholePost', true)) {
    const wordsFor = payload.platform === 'facebook'
      ? { min: ctx.num('facebookMinWords', 100), max: ctx.num('facebookMaxWords', 180) }
      : payload.platform === 'x'
        ? { min: 0, max: ctx.num('linkedinMaxWords', 230) }
        : { min: ctx.num('linkedinMinWords', 150), max: ctx.num('linkedinMaxWords', 230) }
    const whole = await writeWholePost(payload, ctx, {
      hookWords: maxWords,
      styleBrief: `${styleBrief[style] ?? styleBrief.Declarative ?? ''}\n${reference}`,
      temperature: temperatureFromPercent(temperature),
      minWords: wordsFor.min,
      maxWords: wordsFor.max,
    })
    if (whole) {
      return {
        hook: whole.post.hook,
        problem: whole.post.problem,
        explanation: whole.post.explanation,
        close: whole.post.close,
        wholePost: true,
        centralClaim: whole.post.claim,
      }
    }
  }

  const prompt = [
    `Write ONLY the first line of a ${PLATFORM_LABEL[payload.platform]} post about ${topic}.`,
    `The post's subject, for your reference only — do not reuse its wording: "${subject}"`,
    `Angle: ${payload.angle}`,
    styleBrief[style] ?? styleBrief.Declarative,
    '',
    reference,
    '',
    `At most ${maxWords} words. One line. No hashtags, no emoji, no quotation marks around it.`,
    'It must make a claim rather than tease one. Do not end with a colon.',
    // The specification's hook test, stated as a requirement rather than left to
    // the examples to imply. A line that could open a post on a different subject
    // is the single most common failure, so it is named explicitly.
    'It must create tension from something real in the evidence \u2014 a limitation, a ' +
      'trade-off, an overlooked consequence, or an assumption the post will challenge. ' +
      'A line that could open almost any AI post is a failure: name or clearly signal ' +
      'THIS subject. Do not manufacture urgency, fear, or an unsupported figure.',
  ].join('\n')

  const patterns: Record<string, () => string> = {
    // The template fallback for the default style. Phrased as a tension rather
    // than a restatement, so an unreachable model still yields a usable hook.
    Provocative: () =>
      `${subject.replace(/\.$/, '')} \u2014 and the score will not tell you.`,
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
  // Written by the whole-post pass alongside the hook it follows from.
  if (payload.wholePost && payload.problem) {
    ctx.log('Problem kept from the whole-post pass')
    return {}
  }
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
  const systemInstructionRaw = [
    payload.voiceInstruction ?? '',
    HUMAN_VOICE,
    grounding.length > 0
      ? `Evidence available:\n${grounding.map((g) => `\u00b7 ${g.title}: ${g.content}`).join('\n').slice(0, 2400)}`
      : 'You have no retrieved evidence. Make no numeric claims.',
  ]
    .filter(Boolean)
    .join('\n\n')
  const systemInstruction = withCaptionSpec(systemInstructionRaw)

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
  if (payload.wholePost && payload.explanation) {
    ctx.log('Explanation kept from the whole-post pass')
    return {}
  }
  const temperature = ctx.num('temperature', 60)
  const maxOutputTokens = ctx.num('maxOutputTokens', 2048)
  const layers = ctx.num('layers', 3)
  const citeGrounding = ctx.bool('citeGrounding', true)

  const grounding = payload.grounding ?? []
  const systemInstructionRaw = [
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
  const systemInstruction = withCaptionSpec(systemInstructionRaw)

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

/* ── The Ethara connection ───────────────────────────────────────────────── */

registerSkill<CaptionPayload>('generation.caption.close', async (payload, ctx) => {
  const closeStyle = ctx.str('closeStyle', 'Open question')
  const bannedCta = ctx.bool('bannedCta', true)
  const temperature = ctx.num('temperature', 55)
  const etharaConnection = ctx.bool('etharaConnection', true)
  const etharaMaxSentences = Math.max(1, ctx.num('etharaMaxSentences', 2))

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

  const ethara = etharaConnection
    ? await writeEtharaLine(payload, ctx, etharaMaxSentences, temperatureFromPercent(temperature))
    : {}

  if (closeStyle === 'None') return { close: '', ...ethara }

  const wantsQuestion = closeStyle === 'Open question'

  const systemInstructionRaw = [payload.voiceInstruction ?? '', HUMAN_VOICE].filter(Boolean).join('\n\n')
  const systemInstruction = withCaptionSpec(systemInstructionRaw)

  const prompt = [
    `Write ONLY the closing line of a ${PLATFORM_LABEL[payload.platform]} post about ${payload.sourceTopic}.`,
    `The post's hook was: "${payload.hook ?? ''}"`,
    `Its problem section said: "${(payload.problem ?? '').slice(0, 400)}"`,
    wantsQuestion
      ? [
          'It must be a single question a practitioner can answer from their own work.',
          // The specification's close test. A close that merely gestures at the
          // topic is the other half of the "every post reads the same" problem:
          // the hook was generic and the question was generic, so the post had
          // no edge at either end.
          'Make it specific to THIS post\u2019s mechanism \u2014 name the thing at stake: the',
          'failure that would go unseen, the measurement that is missing, the',
          'trade-off they would have to accept. It must return to the issue the hook',
          'raised, not restate the topic. A question that could close almost any AI',
          'post is a failure.',
          'End with a question mark. One question, not several. Never ask for likes,',
          'comments, follows or shares, and never ask for confidential information.',
        ].join(' ')
      : closeStyle === 'Forward look'
        ? 'State what changes next, in one or two sentences. Name the specific thing that changes, not a general direction.'
        : 'State the implication for someone shipping this, in one or two sentences. Name what they should now measure, change or stop assuming.',
    '',
    // Rotated per idea, and it carries the hook so the pairing discipline is
    // visible: a close has to answer the question its own opening raised.
    closeReference(payload.sourceTopic, payload.ideaId ?? payload.title, payload.hook ?? ''),
    '',
    'No hashtags, no emoji, no heading, no quotation marks around it.',
  ].join('\n')

  // The whole-post pass already wrote the close with the body it answers; it is
  // kept, and held to exactly the same checks below as a close written here.
  const preset = payload.wholePost && payload.close ? payload.close : null
  const outcome = preset !== null
    ? { value: preset, source: 'live' as const, servedBy: 'whole-post', viaBackup: false }
    : await withChainFallback(
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
    `${closeStyle} close ${preset !== null ? 'kept from the whole-post pass' : `by ${outcome.source === 'live' ? textModelIdFor(outcome.servedBy) : 'the template writer'}`}` +
      (wantsQuestion ? `, ending in a question` : ''),
  )

  return { close, ...ethara }
})

/**
 * WHAT ETHARA DOES HERE — "At Ethara AI, …".
 *
 * Every post says, in its own words, where the lab stands on the subject it
 * has just explained. The line is written from ONE Brand Corpus domain entry —
 * the one the post's words match most — and may say only what that entry says:
 * the lab's focus and its view. The model phrases it to connect with the post;
 * the checks in `etharaLineProblem` decide whether that phrasing may stand, and
 * the entry's own words stand in when it may not. So the line can be more or
 * less fluent, but never more than the Knowledge Base supports.
 */
export async function writeEtharaLine(
  payload: CaptionPayload,
  ctx: Parameters<Parameters<typeof registerSkill<CaptionPayload>>[1]>[1],
  maxSentences: number,
  temperature: number,
): Promise<{ etharaLine?: string; etharaEntryId?: string }> {
  const corpus = await listKnowledge(ctx.workspaceId, { activeOnly: true, category: 'Brand Corpus', limit: 40 })
  const text = [payload.sourceTopic, payload.title, payload.hashtag ?? '', payload.hook ?? '', payload.explanation ?? ''].join(' ')
  const entry = etharaDomainFor(corpus, text)
  if (!entry) {
    ctx.log('No Ethara line: the Knowledge Base has no active Brand Corpus domain entry to draw it from')
    return {}
  }

  const template = etharaTemplate(entry, maxSentences)
  const prompt = [
    `Write the Ethara connection for a ${PLATFORM_LABEL[payload.platform]} post about ${payload.sourceTopic}.`,
    'It sits after the post has explained its point and before the closing question.',
    `The post's hook: "${payload.hook ?? ''}"`,
    `What the post explains: "${(payload.explanation ?? payload.problem ?? '').slice(0, 700)}"`,
    '',
    'What Ethara\u2019s Knowledge Base says about this domain \u2014 the ONLY source you may use:',
    entry.content,
    '',
    `Write at most ${maxSentences} sentence${maxSentences === 1 ? '' : 's'}. Begin with exactly "At Ethara AI," and say what the lab works on`,
    'and how it thinks about this post\u2019s subject, in a way that connects to the point the post just made.',
    'Use only what the entry states. Name no product, customer, partner, deployment, result, figure or date.',
    'Do not write "we are building", "helping", "empowering", "enabling" or "transforming".',
    'Plain text: no hashtags, no emoji, no quotation marks around it.',
  ].join('\n')

  const outcome = await withChainFallback(
    textChain(),
    {
      systemInstruction: withCaptionSpec([payload.voiceInstruction ?? '', HUMAN_VOICE].filter(Boolean).join('\n\n')),
      prompt,
      temperature,
      maxOutputTokens: 256,
    },
    () => template,
    (reason) => {
      ctx.emit('activity', `Ethara line written from the Knowledge Base entry directly \u2014 ${reason}`, { status: 'warn', reason })
    },
  )

  let line = outcome.value
    .trim()
    .replace(/^["'\u201c\u2018]|["'\u201d\u2019]$/g, '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/\s{2,}/g, ' ')
    .trim()
  const problem = line === '' ? 'it came back empty' : etharaLineProblem(line, entry, maxSentences)
  if (problem !== null) {
    if (outcome.source === 'live') ctx.log(`The model's Ethara line was set aside because ${problem}; the entry's own words stand in`)
    line = template
  }

  ctx.log(`Ethara line drawn from \u201c${entry.title}\u201d${problem === null && outcome.source === 'live' ? ` by ${textModelIdFor(outcome.servedBy)}` : ''}`)
  return { etharaLine: line, etharaEntryId: entry.id }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 7 · generation.caption.hashtags
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('generation.caption.hashtags', (payload, ctx) => {
  const requested = ctx.num('count', 6)
  const useSourceHashtag = ctx.bool('useSourceHashtag', true)
  const keywordCount = ctx.num('instagramKeywordCount', 7)

  /*
   * INSTAGRAM TAKES EXACTLY FIVE. EVERY OTHER PLATFORM TAKES THE BRAND RANGE.
   *
   * The caption skill fixes Instagram at five hashtags followed by a bracketed
   * keyword line, and leaves LinkedIn, Facebook and X on the 5–7 range. The
   * count knob used to apply to all four, so Instagram shipped six tags and no
   * keyword line — which fails the skill's own acceptance check for the one
   * platform that has a hard number.
   */
  const isInstagram = payload.platform === 'instagram'
  const count = isInstagram
    ? INSTAGRAM_HASHTAGS
    : Math.min(Math.max(requested, BRAND.hashtags.min), BRAND.hashtags.max)

  /*
   * `deriveHashtags` returns bare names. They must carry the hash here, because
   * the brand enforcer finds the block by matching `#tag` — an unprefixed block
   * is invisible to it, survives untouched, and the enforcer then appends a
   * second, prefixed one. The post ships with its tags twice.
   */
  // The post's own text, so the tags follow what it discusses (see deriveHashtags).
  const derived = deriveHashtags(
    `${payload.sourceTopic} ${payload.title}`,
    count,
    [payload.hook, payload.problem, payload.explanation].filter(Boolean).join(' '),
  )
  const tags = derived.map((tag) => `#${tag.replace(/^#/, '')}`)

  if (useSourceHashtag && payload.hashtag) {
    const source = `#${payload.hashtag.replace(/^#/, '')}`
    if (!tags.some((t) => t.toLowerCase() === source.toLowerCase())) {
      tags.unshift(source)
      if (tags.length > count) tags.length = count
    }
  }
  // Exactly, not at most: a five-tag rule that ships four is still a failure.
  if (isInstagram && tags.length > INSTAGRAM_HASHTAGS) tags.length = INSTAGRAM_HASHTAGS

  ctx.log(`${tags.length} hashtag(s): ${tags.join(' ')}`)

  /*
   * The keyword footer is built here beside the hashtags because they are one
   * footer, but it is APPLIED after the brand enforcer in `adapt` — the enforcer
   * lifts every `#tag` out of the body and re-appends the block at the end, so a
   * keyword line added before it would end up above the hashtags and invert the
   * order the skill specifies.
   */
  if (!isInstagram) return { hashtagBlock: tags.join(' ') }

  const keywords = deriveKeywords(`${payload.sourceTopic} ${payload.title}`, keywordCount)
  ctx.log(`${keywords.length} Instagram keyword(s): ${keywords.join(', ')}`)

  return {
    hashtagBlock: tags.join(' '),
    keywordBlock: keywords.length > 0 ? `[${keywords.join(', ')}]` : '',
  }
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

  const parts = [payload.hook, payload.problem, payload.explanation, payload.etharaLine, payload.close].filter(
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

    const ethara = (payload.etharaLine ?? '').trim()
    const withMiddle = (middle: string, withEthara = true): string =>
      [hook, middle, withEthara ? ethara : '', close].filter((part) => part.length > 0).join(' ')

    // The Ethara line outranks the middle sentence: the hook and the close are
    // the fixed points, the Ethara line is what every post must say, and the
    // explanation is what compresses first.
    let lead = withMiddle(firstSentence(payload.explanation ?? payload.problem ?? ''))
    if (lead.length > room) {
      lead = withMiddle('')
      ctx.log(`Dropped the middle sentence to keep the hook, the Ethara line and the closing question inside X's ${limit} characters`)
    }
    if (lead.length > room && ethara !== '') {
      lead = withMiddle('', false)
      ctx.log(`The Ethara line would not fit X's ${limit} characters beside the hook and the close, so this X post goes without it`)
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
      const blocks = [payload.hook, payload.problem, explanation, payload.etharaLine, payload.close].filter(
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

  /*
   * THE KEYWORD LINE GOES ON AFTER THE ENFORCER, NOT BEFORE IT.
   *
   * `enforceBrandVoice` lifts every `#tag` out of the text and re-appends the
   * hashtag block as the final line. Anything added before it therefore ends up
   * ABOVE the hashtags, and the skill's required order is hashtags then
   * keywords. So the bracketed line is appended here, last, where nothing
   * reorders it.
   *
   * It is metadata, not prose, so it sits outside the brand pass by design: it
   * carries no hashes for rule 11 to clamp and no sentences for the voice rules
   * to judge.
   */
  let text = enforced.text
  const keywordBlock = typeof payload.keywordBlock === 'string' ? payload.keywordBlock.trim() : ''
  if (payload.platform === 'instagram' && keywordBlock !== '') {
    text = `${text}\n\n${keywordBlock}`
    const overrun = text.length - limit
    if (overrun > 0) {
      /*
       * Reported, never silently cut. The skill is explicit: if the shared prose
       * cannot fit Instagram with its required footer, flag the conflict for a
       * human rather than truncating the caption or quietly editing only
       * Instagram — the pair would then disagree about what the post says.
       */
      ctx.emit(
        'activity',
        `The Instagram caption is ${overrun} character(s) over the ${limit}-character limit once its 5 hashtags and keyword line are added. The prose is shared with LinkedIn, so it was left intact — shorten it on both, or raise the limit in Agent Studio.`,
        { status: 'warn' },
      )
    }
  }

  return {
    caption: text,
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

  /*
   * WHICH SOURCE GETS CITED, AND WHY IT IS NOT SIMPLY THE FIRST ONE.
   *
   * This was `grounding.flatMap((g) => g.sources)[0]` — the first citation of
   * the highest-ranked entry, every time. Two faults compounded.
   *
   *   The `Signals` entries are not citable. `recordScrapedTopicsAsKnowledge`
   *   writes one per capture, citing the URL of every page it captured, so the
   *   pool was dominated by raw social posts. A Facebook post is a record of
   *   WHAT WE SCRAPED, not evidence for a research claim, and presenting one as
   *   "Source:" under a caption about agent evaluation is fabricated
   *   attribution. Same distinction the duplicate check draws.
   *
   *   `[0]` never varies. Captions on one topic retrieve the same entry, so
   *   twelve of fourteen posts across a fortnight carried the identical URL.
   *   A citation that is the same on every post is decoration, not evidence.
   *
   * So: drop the signal records, dedupe by URL, and prefer the source whose own
   * title actually overlaps this post's subject. Where nothing overlaps — the
   * common case, since a citation title rarely echoes a headline — rotate
   * deterministically on the idea id, which spreads the pool across the calendar
   * and still yields the same citation for the same post on every re-run.
   */
  const citable = grounding.filter((entry) => entry.category !== SIGNALS_CATEGORY && entry.category !== DISCOVERED_HASHTAG_CATEGORY)

  const byUrl = new Map<string, { title: string; url: string; publishedAt?: string }>()
  for (const candidate of citable.flatMap((entry) => entry.sources ?? [])) {
    if (candidate?.url && !byUrl.has(candidate.url)) byUrl.set(candidate.url, candidate)
  }
  const pool = [...byUrl.values()]

  const subject = `${payload.title} ${payload.sourceTopic} ${payload.angle ?? ''}`
  const ranked = pool
    .map((candidate) => ({ candidate, score: similarity(subject, candidate.title) }))
    .sort((a, b) => b.score - a.score)

  // A real topical match wins. Otherwise the pool is walked by a seed taken from
  // the idea, so two posts grounded in the same entry cite different pages.
  const best = ranked[0]
  const source =
    best && best.score > 0
      ? best.candidate
      : pool.length > 0
        ? pool[Math.floor(seededFor(payload.ideaId, 6151)() * pool.length) % pool.length]
        : undefined

  if (!source) {
    ctx.log(
      citable.length === 0 && grounding.length > 0
        ? 'The only matching entries were scraped signal records, which are not citable sources, so no citation was attached'
        : 'No cited source on the grounding entries, so no citation was attached',
    )
    return { citation: '' }
  }

  const citation = `Source: ${source.title} — ${source.url}`
  let caption = payload.caption ?? ''

  if (placement === 'End of post') {
    /*
     * "END OF POST" MEANS END OF THE PROSE, NOT AFTER THE FOOTER.
     *
     * This skill runs after `adapt`, so by now the caption already carries its
     * footer: the hashtag line, and on Instagram a bracketed keyword line below
     * it. Appending the citation to the whole string put `Source: …` underneath
     * both, which breaks the order the caption skill fixes — hashtags, then
     * keywords, and the keyword line last. It also read as though the keywords
     * were part of the attribution.
     *
     * Attribution belongs to the body, so the trailing footer blocks are lifted
     * off, the citation is added to the prose, and the footer is put back in the
     * order it was already in.
     */
    const blocks = caption.split(/\n{2,}/)
    const isFooter = (block: string): boolean =>
      /^#[\p{L}\p{N}_]/u.test(block.trim()) || /^\[[^\]]*\]$/.test(block.trim())

    const footer: string[] = []
    while (blocks.length > 0 && isFooter(blocks[blocks.length - 1] as string)) {
      footer.unshift(blocks.pop() as string)
    }

    caption = [...blocks, citation, ...footer].join('\n\n')
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

/* ═══════════════════════════════════════════════════════════════════════════
   THE SHORT-FORM FAMILY — ADR-007

   Four skills on the same agent, reading the same grounding the ten caption
   skills read, producing a different artefact: a spoken script and the hooks
   that open it.

   Three rules govern all four and are worth stating once here rather than
   four times below:

     · ADR-008 — a voice profile is scoped to a content format. Every read
       below names `'short_form_script'`, and the filter lives in the SQL. No
       caption skill asks for a profile, and none can accidentally receive one.
     · The brand rules are never relaxed. A profile shapes PHRASING. It cannot
       raise the emoji budget, cannot authorise a sales CTA, and is not
       consulted by `enforceBrandVoice`.
     · A confidence is a factual claim. Where the evidence is absent, the output
       is no score and a stated reason — never a default.
   ═══════════════════════════════════════════════════════════════════════════ */

/** The content format these four skills serve. Named once (ADR-008). */
const SHORT_FORM: ContentFormat = 'short_form_script'

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 11 · caption.voice.derive
   ───────────────────────────────────────────────────────────────────────────
   A PROFILE IS AN OBSERVATION, NOT AN ASSERTION.

   Everything written below is COUNTED from stored samples: which terms recur,
   how long the sentences run, how the openings and closes are shaped. Nothing
   is inferred about the writer, and nothing is generated — a model asked to
   "describe this voice" produces fluent prose that reads like evidence and is
   not, which is exactly the failure the never-fabricate rule exists to stop.

   Below the sample floor it REFUSES and names the count it has. "A voice
   learned from four scripts" is a claim four scripts cannot support.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('caption.voice.derive', async (_payload, ctx) => {
  const minimum = ctx.num('voiceSampleMinimum', 20)
  const maxSamples = ctx.num('maxSamples', 40)
  const vocabularyTerms = ctx.num('vocabularyTerms', 40)
  const minOccurrences = ctx.num('minTermOccurrences', 3)

  const samples = await listVoiceSamples(ctx.workspaceId, {
    contentFormat: SHORT_FORM,
    limit: maxSamples,
  })

  if (samples.length < minimum) {
    // Refused, not failed. The pipeline continues without a profile and the
    // script writer falls back to the brand register alone, which is a real
    // implementation rather than a degraded pretence of one.
    const message =
      `Not deriving a voice profile: ${samples.length} stored sample(s), below the ${minimum} required. ` +
      'Paste more past scripts under Voice samples. Nothing is inferred from a short sample set.'
    ctx.log(message)
    ctx.emit('activity', message, { status: 'warn', have: samples.length, need: minimum })
    return { voiceProfile: null, voiceProfileReason: message }
  }

  const bodies = samples.map((s) => s.body)

  /* ── Vocabulary · counted, never characterised ───────────────────────────*/
  const counts = new Map<string, number>()
  for (const body of bodies) {
    for (const word of contentWords(body)) {
      counts.set(word, (counts.get(word) ?? 0) + 1)
    }
  }
  const vocabulary = [...counts.entries()]
    .filter(([, n]) => n >= minOccurrences)
    .sort((a, b) => b[1] - a[1])
    .slice(0, vocabularyTerms)
    .map(([term, occurrences]) => ({ term, occurrences }))

  /* ── Sentence shape · measured ───────────────────────────────────────────*/
  const sentences = bodies.flatMap((b) =>
    b.split(/(?<=[.!?])\s+|\n+/).map((x) => x.trim()).filter((x) => x !== ''),
  )
  const lengths = sentences.map((x) => x.split(/\s+/).length)
  const sorted = [...lengths].sort((a, b) => a - b)
  const sentenceStats = {
    sentences: sentences.length,
    meanWords: lengths.length === 0 ? 0 : Math.round(mean(lengths) * 10) / 10,
    medianWords: sorted.length === 0 ? 0 : (sorted[Math.floor(sorted.length / 2)] ?? 0),
    shortestWords: sorted[0] ?? 0,
    longestWords: sorted[sorted.length - 1] ?? 0,
    /** What share run under eight words. The clearest single tell of pace. */
    shortLineShare:
      lengths.length === 0
        ? 0
        : Math.round((lengths.filter((n) => n <= 8).length / lengths.length) * 100),
  }

  /* ── Structure · the first and last lines, which is what shape means ─────*/
  const openings = bodies
    .map((b) => (b.split('\n').find((l) => l.trim() !== '') ?? '').trim())
    .filter((l) => l !== '')
  const closes = bodies
    .map((b) => {
      const lines = b.split('\n').map((l) => l.trim()).filter((l) => l !== '')
      return lines[lines.length - 1] ?? ''
    })
    .filter((l) => l !== '')

  const structurePattern = {
    samplesRead: bodies.length,
    meanLines:
      Math.round(mean(bodies.map((b) => b.split('\n').filter((l) => l.trim() !== '').length)) * 10) /
      10,
    // Verbatim openings, capped. Stored because a pattern an operator can read
    // is auditable and a summary of one is not.
    openings: openings.slice(0, 12),
    openingMeanWords:
      openings.length === 0 ? 0 : Math.round(mean(openings.map((o) => o.split(/\s+/).length))),
  }

  /* ── CTA · counted by shape, because a CTA IS its shape ──────────────────*/
  const question = closes.filter((c) => c.endsWith('?')).length
  const imperative = closes.filter((c) => /^(try|read|watch|comment|tell|ask|check|drop|share)\b/i.test(c)).length
  const ctaPattern = {
    closesRead: closes.length,
    questionShare: closes.length === 0 ? 0 : Math.round((question / closes.length) * 100),
    imperativeShare: closes.length === 0 ? 0 : Math.round((imperative / closes.length) * 100),
    closes: closes.slice(0, 12),
  }

  const profile = await insertVoiceProfile(ctx.workspaceId, {
    name: `Short-form voice · ${samples.length} samples · ${new Date().toISOString().slice(0, 10)}`,
    contentFormat: SHORT_FORM,
    sampleIds: samples.map((s) => s.id),
    vocabulary: { terms: vocabulary },
    sentenceStats,
    structurePattern,
    ctaPattern,
  })

  ctx.log(
    `Voice profile derived from ${samples.length} sample(s): ${sentenceStats.meanWords}-word mean sentence, ` +
      `${sentenceStats.shortLineShare}% of lines under eight words, ${vocabulary.length} characteristic term(s), ` +
      `${ctaPattern.questionShare}% of closes are questions.`,
  )

  return { voiceProfile: profile, voiceProfileReason: null }
})

/**
 * Turns a stored profile into instructions a writer can follow.
 *
 * Deliberately a pure function over the stored row: everything it says is
 * traceable to a counted figure, so a model cannot be told the account "sounds
 * energetic" on the strength of nobody having measured that.
 *
 * It never emits anything that could loosen a brand rule — no emoji guidance,
 * no CTA that asks for a sale. Those come from BRAND, which this cannot reach.
 */
function voiceInstructionFrom(profile: VoiceProfileRow): string {
  const stats = profile.sentence_stats as Record<string, number>
  const cta = profile.cta_pattern as Record<string, number>
  const vocab = (profile.vocabulary as { terms?: Array<{ term: string }> }).terms ?? []

  const lines = [
    `Write in the account's own observed voice, learned from ${profile.sample_count} past scripts:`,
    `· Sentences average ${stats.meanWords ?? 0} words; ${stats.shortLineShare ?? 0}% of lines run to eight words or fewer. Match that pace.`,
    vocab.length > 0
      ? `· Terms this account actually uses: ${vocab.slice(0, 24).map((v) => v.term).join(', ')}.`
      : '',
    (cta.questionShare ?? 0) >= 50
      ? '· This account usually closes on a question. Do the same.'
      : (cta.imperativeShare ?? 0) >= 50
        ? '· This account usually closes by asking for one specific action. Do the same.'
        : '',
    'Every one of these is a measurement of past scripts, not a style you are being asked to invent.',
  ]
  return lines.filter((l) => l !== '').join('\n')
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 12 · caption.script.write
   ───────────────────────────────────────────────────────────────────────────
   Beats, then a close. Deliberately NO HOOK — `caption.hook.generate` writes
   five competing ones, and a script that already opens with a hook produces two
   first lines that fight each other.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('caption.script.write', async (payload, ctx) => {
  const beatCount = ctx.num('scriptBeatCount', 3)
  const sentencesPerBeat = ctx.num('sentencesPerBeat', 3)
  const temperature = ctx.num('temperature', 55)
  const includeHook = ctx.bool('includeHook', false)
  const requireCta = ctx.bool('requireCta', true)
  const useVoiceProfile = ctx.bool('useVoiceProfile', true)

  const grounding = payload.grounding ?? []

  /*
   * ADR-008, at the one place it matters.
   *
   * The format is named in the call, and `activeVoiceProfile` filters on it in
   * SQL. A caption skill would have to ask for `'post'` explicitly to receive a
   * profile, and none of them asks for one at all.
   */
  const profile = useVoiceProfile
    ? await activeVoiceProfile(ctx.workspaceId, SHORT_FORM)
    : null

  const voiceBlock = profile === null ? '' : voiceInstructionFrom(profile)
  if (useVoiceProfile && profile === null) {
    ctx.log(
      'No active short-form voice profile, so the script is written in the brand register alone. ' +
        'Derive one from stored samples to change that.',
    )
  }

  const groundingBlock =
    grounding.length === 0
      ? 'No Knowledge Base entry covers this topic, so make no factual claim that needs a citation.'
      : `Grounding — every factual claim must come from these:\n${grounding
          .map((g) => `· ${g.title}: ${g.content}`)
          .join('\n')
          .slice(0, 2400)}`

  const systemInstruction = withCaptionSpec(
    [
      `You are writing a spoken short-form video script for ${BRAND.wordmark}, ${BRAND.positioning}.`,
      `Audience: ${payload.audience}.`,
      `Voice: ${BRAND.voiceWords.join(', ')}. No emoji. No sales call to action.`,
      voiceBlock,
      groundingBlock,
    ]
      .filter((b) => b !== '')
      .join('\n\n'),
  )

  const prompt = [
    `Topic: ${payload.title}`,
    `Angle: ${payload.angle}`,
    payload.sourceTopic ? `Subject area: ${payload.sourceTopic}` : '',
    '',
    `Write exactly ${beatCount} beat(s), each at most ${sentencesPerBeat} sentence(s).`,
    'Label them [BEAT 1], [BEAT 2] and so on, one per line.',
    requireCta
      ? 'End with a line labelled [CTA] asking the viewer to do one specific thing. It must never ask for a sale, a demo or a booking.'
      : 'Do not write a call to action.',
    includeHook
      ? 'Open with a line labelled [HOOK].'
      : 'Do NOT write a hook or an opening line. The script begins at BEAT 1; hooks are written separately.',
    'This is spoken, not read. Short sentences. No headings, no hashtags, no markdown.',
  ]
    .filter((l) => l !== '')
    .join('\n')

  /**
   * The deterministic writer, for a completely empty `.env`.
   *
   * It composes from the grounding that is actually present and says plainly
   * when there is none, which is the same standard the model path is held to.
   * It is not a fixture: every sentence is built from this idea's own fields.
   */
  const template = (): string => {
    const beats: string[] = []
    for (let i = 0; i < beatCount; i += 1) {
      const entry = grounding[i % Math.max(1, grounding.length)]
      const sentences =
        entry === undefined
          ? [
              `${topicInProse(payload.sourceTopic || payload.title)} is being treated as settled.`,
              'It is not, and the difference shows up in what gets measured.',
            ]
          : [
              `${entry.title}.`,
              clampChars(entry.content.replace(/\s+/g, ' ').trim(), 220),
            ]
      beats.push(`[BEAT ${i + 1}] ${sentences.slice(0, sentencesPerBeat).join(' ')}`)
    }
    if (requireCta) {
      beats.push(
        `[CTA] If you have measured this differently in your own work, say what you saw.`,
      )
    }
    return beats.join('\n')
  }

  const outcome = await withChainFallback(
    textChain(),
    {
      systemInstruction,
      prompt,
      temperature: temperatureFromPercent(temperature),
      maxOutputTokens: 1024,
    },
    template,
    (reason) => {
      ctx.emit('activity', `Script written by the template writer — ${reason}`, {
        status: 'warn',
        reason,
      })
    },
  )

  let script = outcome.value.trim().replace(/^#+\s*/gm, '')

  /*
   * THE BRAND RULES ARE NOT RELAXED FOR A SCRIPT (ADR-008, clause 3).
   *
   * A voice profile shaped the phrasing above. It does not get a vote here.
   * `enforceBrandVoice` reads BRAND and only BRAND — the emoji budget is zero
   * for a script exactly as it is for a post, and nothing on a profile can
   * reach this call.
   */
  const enforced = enforceBrandVoice(script, payload.sourceTopic || payload.title)
  script = enforced.text
  const brandNotes = enforced.notes

  ctx.log(
    `Script written by ${outcome.source === 'live' ? textModelIdFor(outcome.servedBy) : 'the template writer'} · ` +
      `${beatCount} beat(s)${requireCta ? ' and a close' : ''}${profile === null ? ', brand register only' : `, in the voice learned from ${profile.sample_count} samples`}` +
      (brandNotes.length > 0 ? ` · ${brandNotes.length} brand correction(s)` : ''),
  )

  return {
    script,
    scriptSource: outcome.source,
    scriptModel: outcome.source === 'live' ? textModelIdFor(outcome.servedBy) : 'ethara-template-writer',
    ...(outcome.source === 'live' ? {} : { scriptFallbackReason: outcome.fallbackReason }),
    voiceProfileId: profile?.id ?? null,
    brandNotes,
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 13 · caption.hook.generate
   ───────────────────────────────────────────────────────────────────────────
   One hook per declared pattern, so the five are alternatives rather than five
   rewordings of one idea. Structural distinctness comes from the patterns;
   lexical distinctness is checked afterwards, and a variant too close to one
   already written is dropped with the reason recorded rather than shipped as a
   fake choice.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('caption.hook.generate', async (payload, ctx) => {
  const wanted = ctx.num('hookVariantCount', 5)
  const maxLines = ctx.num('hookMaxLines', 2)
  const maxSeconds = ctx.num('hookMaxSpokenSeconds', 4)
  const wpm = ctx.num('spokenWordsPerMinute', 150)
  const temperature = ctx.num('temperature', 70)
  const minDivergence = ctx.num('minDivergence', 30)

  /*
   * SPOKEN LENGTH, EXPRESSED AS SOMETHING A MODEL CAN COUNT.
   *
   * "Under four seconds" is the real constraint and is unenforceable: a model
   * cannot time speech. Words at a stated rate is the same constraint in a unit
   * that can be checked mechanically after generation, and the rate is a knob
   * so a genuinely faster delivery gets correspondingly longer hooks.
   */
  const maxWords = Math.max(3, Math.round((maxSeconds / 60) * wpm))

  const patterns = HOOK_PATTERNS.slice(0, Math.max(1, Math.min(wanted, HOOK_PATTERNS.length)))
  if (patterns.length < HOOK_PATTERNS.length) {
    ctx.log(
      `Writing ${patterns.length} of ${HOOK_PATTERNS.length} patterns — ${HOOK_PATTERNS.slice(patterns.length)
        .map((p) => HOOK_PATTERN_LABEL[p])
        .join(', ')} were not written because the variant count is set below five.`,
    )
  }

  const grounding = payload.grounding ?? []
  const script = typeof payload.script === 'string' ? payload.script : ''

  const accepted: Array<{ pattern: HookPattern; body: string }> = []
  const rejected: string[] = []
  let source: 'live' | 'fixture' = 'fixture'
  let servedBy: string | undefined
  let fallbackReason: string | undefined

  for (const pattern of patterns) {
    const systemInstruction = withCaptionSpec(
      [
        `You are writing the opening line of a short-form video for ${BRAND.wordmark}, ${BRAND.positioning}.`,
        `Voice: ${BRAND.voiceWords.join(', ')}. No emoji. No clickbait, no manufactured urgency, no curiosity gap that the video does not actually close.`,
        grounding.length === 0
          ? 'There is no cited grounding for this topic, so the hook may not state a number or a finding.'
          : `Grounding you may draw a specific claim from:\n${grounding.map((g) => `· ${g.title}: ${g.content}`).join('\n').slice(0, 1400)}`,
      ].join('\n\n'),
    )

    const prompt = [
      `Topic: ${payload.title}`,
      script === '' ? '' : `The script it opens:\n${script.slice(0, 900)}`,
      '',
      `Write ONE hook using this pattern — ${HOOK_PATTERN_LABEL[pattern]}: ${HOOK_PATTERN_BRIEF[pattern]}`,
      `At most ${maxLines} line(s) and ${maxWords} words, so it can be said in ${maxSeconds} seconds.`,
      pattern === 'specific_claim'
        ? 'It must carry a real number taken from the grounding above. If no number is available there, say exactly: NO EVIDENCE.'
        : '',
      'Return the hook alone. No label, no quotation marks, no explanation.',
    ]
      .filter((l) => l !== '')
      .join('\n')

    const outcome = await withChainFallback(
      textChain(),
      {
        systemInstruction,
        prompt,
        temperature: temperatureFromPercent(temperature),
        maxOutputTokens: 120,
        fast: true,
      },
      () => templateHook(pattern, payload, grounding, maxWords),
      (reason) => {
        fallbackReason = reason
      },
    )

    if (outcome.source === 'live') {
      source = 'live'
      servedBy = outcome.servedBy
    } else if (fallbackReason === undefined) {
      fallbackReason = outcome.fallbackReason
    }

    let body = outcome.value
      .trim()
      .replace(/^["'“‘]|["'”’]$/g, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .trim()

    /*
     * THE ONE PATTERN THAT CAN REFUSE ITSELF.
     *
     * A specific-claim hook without a number is not a specific-claim hook; it
     * is an aspirational one wearing the wrong label. Dropping it is the honest
     * outcome — the alternative is a variant tagged with a pattern it does not
     * follow, which makes the whole tagging worthless.
     */
    if (body === '' || /^NO EVIDENCE/i.test(body)) {
      rejected.push(
        `${HOOK_PATTERN_LABEL[pattern]} was not written: it needs a measured number and the grounding states none.`,
      )
      continue
    }

    // Trim to the spoken ceiling rather than discard: a hook two words over is
    // a good hook that ran long.
    const lines = body.split('\n').filter((l) => l.trim() !== '').slice(0, maxLines)
    body = clampWords(lines.join('\n'), maxWords)

    const tooClose = accepted.find(
      (other) => similarity(other.body, body) * 100 >= 100 - minDivergence,
    )
    if (tooClose) {
      rejected.push(
        `${HOOK_PATTERN_LABEL[pattern]} was dropped: ${Math.round(similarity(tooClose.body, body) * 100)}% similar to the ${HOOK_PATTERN_LABEL[tooClose.pattern]} hook, below the ${minDivergence}% divergence floor. Five near-identical hooks are not five choices.`,
      )
      continue
    }

    accepted.push({ pattern, body })
  }

  for (const reason of rejected) {
    ctx.emit('activity', reason, { status: 'warn' })
  }

  ctx.log(
    `${accepted.length} hook(s) across ${accepted.map((a) => HOOK_PATTERN_LABEL[a.pattern]).join(', ') || 'no patterns'}` +
      (rejected.length > 0 ? ` · ${rejected.length} not kept` : '') +
      ` · by ${source === 'live' ? textModelIdFor(servedBy) : 'the template writer'}`,
  )

  return {
    hooks: accepted.map((a, index) => ({ ...a, rank: index + 1 })),
    hookSource: source,
    hookModel: source === 'live' ? textModelIdFor(servedBy) : 'ethara-template-writer',
    ...(source === 'live' || fallbackReason === undefined ? {} : { hookFallbackReason: fallbackReason }),
    hookNotes: rejected,
  }
})

/**
 * The deterministic hook writer.
 *
 * Every line is built from this idea's own fields and the grounding actually
 * retrieved — there is no bank of pre-written hooks to draw from, because a
 * stock line dressed as a generated one is a fixture pretending to be work.
 */
function templateHook(
  pattern: HookPattern,
  payload: CaptionPayload,
  grounding: GroundingEntry[],
  maxWords: number,
): string {
  const topic = topicInProse(payload.sourceTopic || payload.title)
  const figure = grounding
    .map((g) => /(\d+(?:\.\d+)?\s*(?:%|x|ms|k|M|B)?)/.exec(g.content)?.[1] ?? '')
    .find((f) => f !== '')

  const line = ((): string => {
    switch (pattern) {
      case 'aspirational':
        return `This is what ${topic} looks like when it is actually measured.`
      case 'pain_point':
        return `Your ${topic} numbers move and nobody can tell you why.`
      case 'insider':
        return `Most teams shipping ${topic} have never checked this.`
      case 'specific_claim':
        // Refuses rather than inventing a number — the same contract the model
        // path is held to, for the same reason.
        return figure === undefined ? 'NO EVIDENCE' : `${figure} of the gain in ${topic} is not the model.`
      case 'curiosity_gap':
        return `What breaks first when ${topic} scales?`
    }
  })()

  return clampWords(line, maxWords)
}

/* ═══════════════════════════════════════════════════════════════════════════
   CAPTION 14 · caption.hook.score
   ───────────────────────────────────────────────────────────────────────────
   THE SKILL THAT MOST EASILY BECOMES A LIE.

   "Confidence 8/10" is a factual claim about how this hook will perform. It is
   only defensible if a stored row supports it. So:

     · a score is derived ONLY from the measured performance of a stored post
       the hook demonstrably resembles;
     · `confidence_basis` names that post and its real figures, in plain
       language, every time;
     · where nothing comparable exists the output is NO SCORE and a sentence
       saying why. Not 5. Not 0. Not "low confidence".

   The database agrees: `hook_variants` has a CHECK requiring a non-empty basis,
   and a second one refusing a confidence with no matched row behind it. Getting
   this wrong is a constraint violation, not a code review note.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<CaptionPayload>('caption.hook.score', async (payload, ctx) => {
  const hooks = (payload.hooks ?? []) as Array<{ pattern: HookPattern; body: string; rank: number }>
  if (hooks.length === 0) return {}

  const minSimilarity = ctx.num('minMatchSimilarity', 35) / 100
  const lookbackDays = ctx.num('lookbackDays', 180)
  const minComparisons = ctx.num('minComparisons', 1)
  const includeCaptured = ctx.bool('includeCaptured', true)

  const corpus = await hookComparisonCorpus(ctx.workspaceId, {
    lookbackDays,
    includeCaptured,
  })

  if (corpus.length === 0) {
    // Every hook returns unscored, each with the same honest reason. Not an
    // error: a young account has nothing to compare against, and saying so is
    // the correct output.
    const basis =
      `No comparable post is stored yet — nothing published or captured in the last ${lookbackDays} days ` +
      'carries measured performance. A confidence would have no evidence behind it, so none is given.'
    ctx.log(`No confidence scored for ${hooks.length} hook(s) — ${basis}`)
    return {
      scoredHooks: hooks.map((h) => ({
        ...h,
        confidence: null,
        confidenceBasis: basis,
        matchedPostId: null,
        matchedItemId: null,
      })),
    }
  }

  const scored = hooks.map((hook) => {
    const ranked = corpus
      .map((row) => ({ row, score: similarity(hook.body, row.text) }))
      .filter((m) => m.score >= minSimilarity)
      .sort((a, b) => b.score - a.score)

    if (ranked.length < minComparisons) {
      const basis =
        `No confidence: the closest stored post is ${Math.round((ranked[0]?.score ?? (corpus.length > 0 ? Math.max(...corpus.map((c) => similarity(hook.body, c.text))) : 0)) * 100)}% similar, ` +
        `below the ${Math.round(minSimilarity * 100)}% needed to treat it as evidence about this hook` +
        (minComparisons > 1 ? `, and ${minComparisons} comparisons are required.` : '.')
      return {
        ...hook,
        confidence: null as number | null,
        confidenceBasis: basis,
        matchedPostId: null as string | null,
        matchedItemId: null as string | null,
      }
    }

    const used = ranked.slice(0, Math.max(minComparisons, 1))
    const best = used[0] as (typeof ranked)[number]

    /*
     * THE SCORE ITSELF — a normalised reading of the matched posts' measured
     * performance, weighted by how similar each one actually is.
     *
     * Not a judgement about the hook's craft. It says: posts this hook
     * resembles performed at this level, on this evidence. The basis sentence
     * below says exactly that, so nobody can read more into the number than the
     * number supports.
     */
    const weighted =
      used.reduce((t, m) => t + m.row.performance * m.score, 0) /
      used.reduce((t, m) => t + m.score, 0)
    const confidence = Math.round(clamp(weighted, 0, 100))

    const kindWord = best.row.kind === 'published' ? 'our own published post' : 'a captured post'
    const basis =
      `${confidence}/100, derived from ${used.length} stored comparison(s). ` +
      `Closest is ${kindWord} “${best.row.title.slice(0, 70)}” at ${Math.round(best.score * 100)}% similarity, ` +
      `which measured ${best.row.evidence}.` +
      (best.row.kind === 'published'
        ? ''
        : ' That post is someone else’s, so it is evidence about the topic rather than about this account.')

    return {
      ...hook,
      confidence,
      confidenceBasis: basis,
      matchedPostId: best.row.kind === 'published' ? best.row.id : null,
      matchedItemId: best.row.kind === 'captured' ? best.row.id : null,
    }
  })

  const withScore = scored.filter((s) => s.confidence !== null).length
  ctx.log(
    `${withScore} of ${scored.length} hook(s) scored against stored evidence; ` +
      `${scored.length - withScore} left unscored with the reason stated. A default score would be fabricated evidence.`,
  )

  return { scoredHooks: scored }
})

/**
 * The stored posts a hook may be compared against, each reduced to a
 * comparable text and a measured performance.
 *
 * `performance` is NORMALISED WITHIN THE CORPUS, not against an absolute. An
 * account's 400-reaction post and a viral reel's 400,000 plays are not
 * comparable on a shared axis, and pretending otherwise would let one corpus
 * make every hook look weak and another make every hook look strong.
 *
 * Rows with no measured performance are excluded entirely rather than scored at
 * zero — the same rule as everywhere else, applied where it would be easiest to
 * forget.
 */
async function hookComparisonCorpus(
  workspaceId: string,
  opts: { lookbackDays: number; includeCaptured: boolean },
): Promise<
  Array<{
    id: string
    kind: 'published' | 'captured'
    title: string
    text: string
    performance: number
    evidence: string
  }>
> {
  const since = new Date(Date.now() - opts.lookbackDays * 86_400_000).toISOString()

  const published = await publishedPostPerformance(workspaceId, since)
  const captured = opts.includeCaptured ? await capturedPostPerformance(workspaceId, since) : []

  const build = (
    rows: Array<{ id: string; title: string; text: string; raw: number; evidence: string }>,
    kind: 'published' | 'captured',
  ) => {
    const max = rows.reduce((m, r) => Math.max(m, r.raw), 0)
    if (max === 0) return []
    return rows.map((r) => ({
      id: r.id,
      kind,
      title: r.title,
      text: r.text,
      performance: (r.raw / max) * 100,
      evidence: r.evidence,
    }))
  }

  return [...build(published, 'published'), ...build(captured, 'captured')]
}

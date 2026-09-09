/**
 * NARRATE — renders the plan and every result as Ethara speech.
 *
 * Two implementations, one voice. Gemini writes the prose when configured; the
 * template narrator writes it when not. Either way `enforceAssistantVoice()` is the
 * last thing that touches the string, so an emoji or a "Great question" can never
 * reach the operator.
 *
 * The shape is fixed by the phrasebook: outcome, then the number it rests on,
 * then the consequence. One sentence of answer, one of evidence, one of offer.
 */

import {
  enforceAssistantVoice,
  NARRATION_TEMPLATES,
  pickOpener,
  renderTemplate,
  spokenSummary,
} from '../../../shared/assistant-persona'
import { TOOL_BY_ID } from '../../../shared/tool-registry'
import { AGENT_BY_ID } from '../../../shared/agent-registry'
import type { AgentId } from '../../../shared/agent-contract'
import { config } from '../config'
import { gcpText } from '../integrations'
import type { SituationSnapshot } from './context'
import type { Plan } from './planner'
import type { StepOutcome } from './dispatch'

export type Verbosity = 'terse' | 'normal' | 'detailed'

export interface NarratorOptions {
  verbosity: Verbosity
  speakSummaryOnly: boolean
  tokenDelayMs: number
  maxSpokenChars: number
}

/* ═══════════════════════════════════════════════════════════════════════════
   AGENT NAMES
   ═══════════════════════════════════════════════════════════════════════════ */

function agentNameFor(toolId: string): string {
  const tool = TOOL_BY_ID[toolId]
  if (!tool?.agentId) return 'Ethara'
  return AGENT_BY_ID[tool.agentId as AgentId]?.name ?? 'Ethara Command'
}

/* ═══════════════════════════════════════════════════════════════════════════
   ACKNOWLEDGEMENT — opener + restated intent + scope
   ═══════════════════════════════════════════════════════════════════════════ */

export function narratePlan(plan: Plan, opts: NarratorOptions): string {
  const seed = plan.steps.length + plan.summary.length
  const opener = pickOpener('acknowledge', seed)

  if (plan.steps.length === 0) return enforceAssistantVoice(plan.summary)

  const base =
    plan.steps.length > 1 && opts.verbosity !== 'terse'
      ? renderTemplate(NARRATION_TEMPLATES.planComposedMultiStep, {
          opener,
          summary: plan.summary,
          stepCount: plan.steps.length,
        })
      : renderTemplate(NARRATION_TEMPLATES.planComposed, { opener, summary: plan.summary })

  const extras: string[] = []
  if (plan.trimmed && plan.trimmed.length > 0 && opts.verbosity === 'detailed') {
    extras.push(`I dropped ${plan.trimmed.join(' and ')} to stay inside the step limit.`)
  }

  return enforceAssistantVoice([base, ...extras].join(' '))
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEPS — agent name + verb + live count
   ═══════════════════════════════════════════════════════════════════════════ */

export function narrateStepStarted(toolId: string, why: string): string {
  return enforceAssistantVoice(
    renderTemplate(NARRATION_TEMPLATES.stepStarted, { agentName: agentNameFor(toolId), why }),
  )
}

export function narrateStepFinished(outcome: StepOutcome): string {
  return enforceAssistantVoice(
    renderTemplate(NARRATION_TEMPLATES.stepFinished, {
      agentName: agentNameFor(outcome.toolId),
      resultSummary: outcome.summary,
    }),
  )
}

/**
 * A failure names what failed, what already stands, and the one thing that would
 * fix it. It never apologises twice, and it never claims the rest is fine when it
 * is not.
 */
export function narrateFailure(
  outcome: StepOutcome,
  completed: StepOutcome[],
  fix?: string,
): string {
  const toolName = TOOL_BY_ID[outcome.toolId]?.name ?? outcome.toolId
  const parts: string[] = [
    renderTemplate(NARRATION_TEMPLATES.stepFailed, {
      agentName: agentNameFor(outcome.toolId),
      toolName,
      error: outcome.error ?? 'No reason was returned.',
    }),
  ]

  const done = completed.filter((s) => s.status === 'completed')
  if (done.length > 0) {
    const mutating = done.filter((s) => (TOOL_BY_ID[s.toolId]?.risk ?? 'safe') !== 'safe')
    parts.push(
      mutating.length > 0
        ? `${done.length} earlier step(s) completed, and ${mutating.length} of them changed state — that stands.`
        : `${done.length} earlier step(s) completed; they were reads, so nothing was changed.`,
    )
  } else {
    parts.push('Nothing had run yet, so nothing was changed.')
  }

  if (fix) parts.push(fix)

  return enforceAssistantVoice(parts.join(' '))
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE RESULT — outcome + the number + the consequence
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FinalNarrationInput {
  plan: Plan
  outcomes: StepOutcome[]
  snapshot: SituationSnapshot
  options: NarratorOptions
}

export async function narrateResult(input: FinalNarrationInput): Promise<{
  text: string
  spoken: string
  source: 'model' | 'template'
  fallbackReason?: string
}> {
  const template = narrateResultTemplate(input)

  const modelReady = config.assistant.provider === 'gcp' && gcpText.isConfigured()
  if (!modelReady) {
    return {
      text: template,
      spoken: spokenSummary(template, input.options.maxSpokenChars),
      source: 'template',
    }
  }

  try {
    const raw = await gcpText.run({
      systemInstruction: buildNarratorSystemPrompt(input.options.verbosity),
      prompt: [
        `The operator asked: ${input.plan.intent.restated}`,
        '',
        'What happened, step by step:',
        ...input.outcomes.map(
          (o) => `· ${TOOL_BY_ID[o.toolId]?.name ?? o.toolId} (${o.status}): ${o.summary}`,
        ),
        '',
        'Structured results:',
        JSON.stringify(input.outcomes.map((o) => ({ tool: o.toolId, data: o.data })), null, 0).slice(0, 4000),
        '',
        'The deterministic narrator wrote this. Improve the prose without changing a number:',
        template,
      ].join('\n'),
      temperature: 0.3,
      maxOutputTokens: 600,
      fast: true,
    })

    const text = enforceAssistantVoice(raw.trim())
    // A model that returns nothing usable does not get to silence Ethara.
    if (text.length < 12) throw new Error('the narration came back empty')

    return { text, spoken: spokenSummary(text, input.options.maxSpokenChars), source: 'model' }
  } catch (error) {
    return {
      text: template,
      spoken: spokenSummary(template, input.options.maxSpokenChars),
      source: 'template',
      fallbackReason: error instanceof Error ? error.message : String(error),
    }
  }
}

export function buildNarratorSystemPrompt(verbosity: Verbosity): string {
  const length =
    verbosity === 'terse'
      ? 'One sentence. Two at most.'
      : verbosity === 'detailed'
        ? 'Up to five sentences, and name every figure you have.'
        : 'Three sentences: the answer, the evidence, the offer.'

  return [
    'You are Ethara, the operating intelligence of Ethara SocialAI. You are reporting to the operator.',
    '',
    'Voice: calm, concise, quantified, anticipatory. Dry, never jokey. Never apologetic.',
    'Shape: the outcome, then the number it rests on, then the consequence or the next useful action.',
    '',
    'Forbidden: emoji, exclamation marks, "Great question", "I think", "Certainly", "Let me know if",',
    '"I hope this helps", "As an AI". Never invent a figure that is not in the data you were given.',
    '',
    length,
    '',
    'Return only the narration. No preamble, no markdown fences.',
  ].join('\n')
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE TEMPLATE NARRATOR — always available, always the floor
   ═══════════════════════════════════════════════════════════════════════════ */

export function narrateResultTemplate(input: FinalNarrationInput): string {
  const { plan, outcomes, options } = input

  if (plan.steps.length === 0) {
    return enforceAssistantVoice(plan.summary)
  }

  const failed = outcomes.find((o) => o.status === 'failed')
  if (failed) {
    return narrateFailure(
      failed,
      outcomes.filter((o) => o !== failed),
      suggestFix(failed),
    )
  }

  // The act is the highest-risk step; the reads around it are supporting evidence.
  const act =
    [...outcomes].reverse().find((o) => (TOOL_BY_ID[o.toolId]?.risk ?? 'safe') !== 'safe') ??
    outcomes[outcomes.length - 1]

  if (!act) return enforceAssistantVoice(plan.summary)

  const opener = pickOpener('report', act.summary.length)
  const sentences: string[] = [renderTemplate(NARRATION_TEMPLATES.commandFinished, {
    opener,
    resultSummary: act.summary,
  })]

  if (options.verbosity !== 'terse') {
    const supporting = outcomes
      .filter((o) => o !== act && o.status === 'completed' && o.summary.length > 0)
      .slice(-2)
      .map((o) => o.summary)
    sentences.push(...supporting)
  }

  const offer = offerFor(act, input.snapshot)
  if (offer && options.verbosity !== 'terse') sentences.push(offer)

  // A fallback anywhere in the plan is stated plainly, once.
  const fallback = outcomes.find((o) => o.fallbackReason)
  if (fallback?.fallbackReason) {
    sentences.push(fallback.fallbackReason)
  }

  return enforceAssistantVoice(sentences.filter(Boolean).join(' '))
}

/** The next useful action, named without being asked. */
function offerFor(act: StepOutcome, snapshot: SituationSnapshot): string | null {
  switch (act.toolId) {
    case 'pipeline.run':
      return snapshot.counts.reviewQueue > 0
        ? `${snapshot.counts.reviewQueue} item(s) are waiting on a verdict — I can walk you through them.`
        : 'The calendar is updated. I can draft the strongest one next.'
    case 'keyword.trending':
      return 'I can draft against any of them.'
    case 'review.queue.list':
      return snapshot.counts.reviewQueue === 0
        ? 'Nothing is blocked on you.'
        : 'I can resolve any of them on your word.'
    case 'draft.generate':
      return 'I can render the creative next, or open it in review.'
    case 'draft.instruct':
      return 'I can save that as a standing preference if you want it applied by default.'
    case 'image.render':
      return 'I can adjust it further, or send the post to Leadership.'
    case 'idea.publish':
    case 'idea.approve.leadership':
      return 'The Analytics Agent will report the first reading in about an hour.'
    case 'knowledge.build':
      return 'The Caption Agent will read these before the next draft.'
    case 'keyword.add':
      return 'It joins the next discovery run.'
    case 'analytics.compare':
      return 'I can explain any individual post in that period.'
    default:
      return null
  }
}

/** The one thing that would fix a failure. Specific, or nothing at all. */
function suggestFix(failed: StepOutcome): string | undefined {
  const error = (failed.error ?? '').toLowerCase()
  if (error.includes('timed out')) {
    return 'Raising the retry count on that skill in Agent Studio would likely clear it.'
  }
  if (error.includes('not set') || error.includes('not configured')) {
    const key = /([A-Z_]{6,})/.exec(failed.error ?? '')?.[1]
    return key ? `Set ${key} and I will run it live.` : undefined
  }
  if (error.includes('needs a reason')) {
    return 'Tell me the reason and I will resubmit it.'
  }
  if (error.includes('no such') || error.includes('not found')) {
    return 'Name it differently and I will find it.'
  }
  return undefined
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOKENISATION — the streamed narration
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Splits narration into display tokens, keeping the trailing space on each so
 * the client can concatenate without guessing at spacing.
 */
export function tokenise(text: string): string[] {
  return text.match(/\S+\s*/g) ?? []
}

export { spokenSummary }

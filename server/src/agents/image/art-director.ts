/**
 * THE ART DIRECTOR — Gemini 2.5 Pro, writing the brief the painter works from.
 *
 * ═══ WHY A SECOND MODEL, AND WHY THIS ONE ═══
 *
 * Gemini 2.5 Pro cannot paint. Asked for an image it returns HTTP 400: it is a
 * reasoning model, and no pro-tier image model is enabled on this project —
 * every Imagen id and every `*-pro-image` variant answers 404. So "use Pro for
 * the images" cannot mean Pro renders them.
 *
 * What Pro is good at is the step that was missing. The painter was being handed
 * a prompt assembled from a concept lookup and a manifest sentence, neither of
 * which had read the post. Every creative on a given concept therefore got the
 * same art direction regardless of what the caption argued, which is the
 * mechanical quality the brief describes as "raw output".
 *
 * Pro reads the caption and writes ONE composition for THAT argument: what the
 * hero object is, how it is lit, what the arrangement says. The painter then
 * renders it. Two models, each doing the thing it is actually able to do.
 *
 * ═══ WHAT IT IS NOT ALLOWED TO DO ═══
 *
 * It writes no text for the canvas — invariant 21 is absolute, and a brief that
 * asked for a headline would reintroduce lettering through the back door. It
 * invents no figures: a composition is a visual argument, not a chart of
 * numbers nobody measured. And when it is unreachable the render proceeds on
 * the assembled prompt exactly as before, stamped with the reason.
 */

import { config } from '../../config'
import { gcpText } from '../../integrations/gcp-llm'

export interface ArtDirection {
  /** The composition brief, ready to send to the painter. */
  brief: string
  /** `model` when Pro wrote it, `template` when the assembled prompt stood in. */
  source: 'model' | 'template'
  /** Present only when Pro was asked and could not answer. */
  fallbackReason?: string
}

const SYSTEM = [
  'You are the art director for Ethara.AI, a frontier AI research lab.',
  'You write the composition brief for a single social creative. You do not write copy.',
  '',
  'HOUSE STYLE: near-black ground, one violet accent family, one hero object or arrangement,',
  'dramatic controlled lighting, generous negative space, editorial and restrained.',
  'Every house creative is legible because its GEOMETRY carries the claim — a mass below a',
  'waterline, a closed loop, a maze with one traced path. Never a texture with words over it.',
  '',
  'RULES:',
  '1. Describe ONE hero object or arrangement, and what its structure argues about the topic.',
  '2. Name the lighting, the material and where the negative space sits.',
  '3. The subject sits RIGHT of centre. The left third stays empty and dark.',
  '4. Write NO text, letters, labels, numbers, headlines or logos into the composition.',
  '   Every word on the finished creative is added afterwards as vector type.',
  '5. Invent no statistics, percentages or quantities. You are describing a picture.',
  '6. Two to three sentences. No preamble, no markdown, no lists.',
].join('\n')

/**
 * A composition brief for one post.
 *
 * `styleClause` is the house reference's own description and travels into the
 * prompt so Pro composes within the family rather than inventing a new look.
 */
export async function directArt(input: {
  caption: string
  title: string
  sourceTopic: string
  concept: string
  styleClause: string
  model: string
  temperature: number
  maxTokens: number
  /** Used verbatim when the model cannot be reached. */
  assembledPrompt: string
}): Promise<ArtDirection> {
  if (!gcpText.isConfigured()) {
    return {
      brief: input.assembledPrompt,
      source: 'template',
      fallbackReason: `art direction skipped — ${gcpText.unavailableReason()}`,
    }
  }

  const prompt = [
    `TOPIC: ${input.sourceTopic}`,
    `THE POST ARGUES: ${input.title}`,
    '',
    'CAPTION:',
    input.caption.slice(0, 1800),
    '',
    input.styleClause === ''
      ? ''
      : `THE HOUSE REFERENCE GOVERNING THIS CREATIVE:\n${input.styleClause}`,
    '',
    'Write the composition brief.',
  ]
    .filter((line) => line !== '')
    .join('\n')

  try {
    const written = await gcpText.run({
      systemInstruction: SYSTEM,
      prompt,
      temperature: input.temperature,
      maxOutputTokens: input.maxTokens,
      model: input.model,
    })

    const brief = written.trim()

    /*
     * A brief that came back empty, or as a single word, is not art direction —
     * it is a failed call that happened to return 200. The assembled prompt is
     * a real composition, so it stands in rather than sending the painter
     * something that would produce nothing recognisable.
     */
    if (brief.length < 40) {
      return {
        brief: input.assembledPrompt,
        source: 'template',
        fallbackReason: `${input.model} returned ${brief.length} characters, too short to be a composition`,
      }
    }

    return { brief, source: 'model' }
  } catch (error) {
    return {
      brief: input.assembledPrompt,
      source: 'template',
      fallbackReason: `${input.model} could not be reached — ${error instanceof Error ? error.message : String(error)}`,
    }
  }
}

/** The reasoning model this deployment has, for the knob's default. */
export function defaultArtDirectorModel(): string {
  return config.gcp.textModel
}

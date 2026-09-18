/**
 * THE SKILL SPECIFICATION, FOR THE NODE TIER.
 *
 * CLAUDE.md's opening rule: "Skills are the specification. Code implements them.
 * Prompts point at them. Any conflict between a skill and anything else — this
 * file included — the skill wins."
 *
 * The Python tier honours this — `core/agent.py` reads each agent's SKILL.md
 * into the system prompt at run time. The Node tier did not: its handlers
 * reimplemented the rules in TypeScript and never read the file, so a skill
 * could not actually "win" because nothing at run time could see it. Editing
 * `caption-writing/SKILL.md` changed nothing about a caption the Node tier
 * wrote.
 *
 * This closes that gap. It reads the SAME `Rules` and `Boundaries` sections the
 * Python tier reads, so both engines are governed by one document.
 *
 * WHAT IT DOES NOT DO. It does not replace the mechanical enforcement.
 * `enforceBrandVoice` computing the emoji budget is more reliable than asking a
 * model to respect it, and those invariants (`similarity()` thresholds, the
 * hashtag clamp) stay in code where `verify` can assert them. The spec injected
 * here governs the JUDGEMENT — voice, angle, structure, what counts as evidence
 * — which is the half a prompt can actually influence.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// server/src/agents/skills → repo root is four levels up.
const HERE = dirname(fileURLToPath(import.meta.url))
const SKILLS_DIR = join(HERE, '..', '..', '..', '..', 'packages', 'skills')

/**
 * One `## <heading>` section of a SKILL.md, heading line excluded.
 *
 * Deliberately the same shape as `core/agent.py::_section`, so the two tiers
 * extract identically and a rule cannot mean one thing to Python and another to
 * Node. Returns an empty string when the section is absent.
 */
function section(body: string, heading: string): string {
  const lines = body.split('\n')
  const target = `## ${heading}`.toLowerCase()
  const out: string[] = []
  let collecting = false
  for (const line of lines) {
    if (line.trim().toLowerCase() === target) {
      collecting = true
      continue
    }
    if (collecting && line.startsWith('## ')) break
    if (collecting) out.push(line)
  }
  return out.join('\n').trim()
}

/**
 * The Rules and Boundaries of one or more skills, as a prompt block.
 *
 * Cached, because a SKILL.md does not change within a process and re-reading it
 * on every caption call would be pointless IO. A missing file is reported once
 * and then treated as empty — a skill whose spec cannot be found must not throw
 * inside a generation path and lose the caption.
 */
const cache = new Map<string, string>()
const warned = new Set<string>()

/*
 * WHICH SECTIONS ARE DIRECTIVES.
 *
 * Rules and Boundaries alone were being injected, which silently dropped the
 * parts of a SKILL.md that tell the model what audience it is writing for, which
 * language mode to use, what to avoid, and what its own output must satisfy. A
 * specification the writer never receives is documentation, not a specification.
 *
 * Purpose, Inputs, Outputs and Failure modes are deliberately excluded: they
 * describe the skill to a reader of the repository, and repeating them in every
 * prompt would spend context without changing what gets written.
 *
 * Order is fixed so the prompt is stable across runs — an unstable prompt makes
 * two captions incomparable for no reason.
 */
const DIRECTIVE_SECTIONS = [
  'Audience and positioning',
  'Language modes',
  'Rules',
  // Worked examples teach the pattern in a way a rule cannot — a rule can say a
  // hook must be specific; only an example shows the difference between
  // "AI is changing everything" and a hook that names its own topic.
  'Examples',
  'Avoid',
  'Boundaries',
  'Acceptance checks',
] as const

export function skillSpecification(skillIds: string[]): string {
  const key = skillIds.join('+')
  const hit = cache.get(key)
  if (hit !== undefined) return hit

  const blocks: string[] = []
  for (const id of skillIds) {
    const path = join(SKILLS_DIR, id, 'SKILL.md')
    if (!existsSync(path)) {
      if (!warned.has(id)) {
        // Reported, not thrown. The mechanical enforcement still runs, so a
        // missing spec degrades the guidance rather than breaking generation.
        console.warn(`  · caption spec: packages/skills/${id}/SKILL.md not found; skipping`)
        warned.add(id)
      }
      continue
    }
    const body = readFileSync(path, 'utf8')
    const parts = [`## Skill · ${id}`]
    for (const heading of DIRECTIVE_SECTIONS) {
      const found = section(body, heading)
      if (found) parts.push(`### ${heading}\n\n${found}`)
    }
    if (parts.length > 1) blocks.push(parts.join('\n\n'))
  }

  const spec =
    blocks.length === 0
      ? ''
      : 'The following is the behavioural specification for this work, taken from the ' +
        'skill files that define it. Where anything else in this prompt appears to conflict ' +
        'with it, the specification wins.\n\n' +
        blocks.join('\n\n')

  cache.set(key, spec)
  return spec
}

/** The caption agent is specified by these two skills, per its folder spec. */
export const CAPTION_SKILLS = ['caption-writing', 'brand-voice'] as const

/**
 * Prepends the caption specification to a system instruction.
 *
 * The spec leads: a model weights the top of its context most, and this is the
 * authority the rest of the instruction serves. One call at every caption site,
 * so no handler has to remember the skill exists.
 */
export function withCaptionSpec(systemInstruction: string): string {
  const spec = skillSpecification([...CAPTION_SKILLS])
  return spec === '' ? systemInstruction : `${spec}\n\n---\n\n${systemInstruction}`
}

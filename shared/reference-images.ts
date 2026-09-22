/**
 * BRAND REFERENCE IMAGES
 *
 * The visual guidance an operator gives the Image Agent: drop reference images
 * in `public/brand/references/` and describe each one's style in
 * `references.json` beside them. Those DESCRIPTIONS — not the pixels — are what
 * steer generation, because three of the four background painters (Imagen, FLUX
 * via mflux, Z-Image) take a text prompt only and cannot accept an image. A
 * literal image can additionally be sent to the Gemini painter, which does
 * accept image input, but the text style clause is the portable floor that
 * reaches every model.
 *
 * WHY A MANIFEST RATHER THAN JUST FILES. A folder of JPEGs tells the text
 * painters nothing — they never see the pixels. The manifest is the bridge: it
 * turns "this is the look we want" into words the prompt builder can append,
 * and it keeps the guidance visible, editable and versioned rather than buried
 * in a binary. A reference with no `style` text is still recorded, but it can
 * only reach the image-capable painter; it contributes nothing to the others,
 * and that is stated rather than hidden.
 *
 * Invariant 21 is untouched: references steer the BACKGROUND only. Brand text —
 * headline, kicker, logomark, footer — is still composited locally as vectors
 * and is never sent to any model.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

export interface ReferenceImage {
  /** The file in `public/brand/references/`, e.g. `mood-01.jpg`. */
  file: string
  /**
   * The words that reach the text painters. Describe palette, mood, texture,
   * composition — never brand copy. Empty means the entry only informs the
   * image-capable painter.
   */
  style: string
  /** Optional label shown in the UI and logs. */
  label?: string
  /**
   * Which concepts this reference applies to. Empty or absent means all of
   * them, so a single house style needs no per-concept tagging.
   */
  concepts?: string[]
  /** Off excludes it without deleting it — nothing is ever deleted. */
  active?: boolean
}

export interface ReferenceManifest {
  references: ReferenceImage[]
}

const HERE = dirname(fileURLToPath(import.meta.url))
/** `shared/` sits beside `public/`, so the manifest is one level up. */
export const REFERENCES_DIR = join(HERE, '..', 'public', 'brand', 'references')
export const REFERENCES_MANIFEST = join(REFERENCES_DIR, 'references.json')

/**
 * Reads the manifest. A missing file is not an error — it means no references
 * were configured, and the Image Agent runs exactly as it did before. A
 * malformed file is reported by returning empty rather than throwing, so a bad
 * edit can never break a render.
 */
export function loadReferenceManifest(): ReferenceImage[] {
  let raw: string
  try {
    raw = readFileSync(REFERENCES_MANIFEST, 'utf8')
  } catch {
    return []
  }
  try {
    const parsed = JSON.parse(raw) as ReferenceManifest
    if (!parsed || !Array.isArray(parsed.references)) return []
    return parsed.references.filter((r) => r && typeof r.file === 'string' && r.active !== false)
  } catch {
    return []
  }
}

/**
 * The references that apply to one concept — those with no `concepts` list, or
 * one that names it.
 */
export function referencesFor(concept: string): ReferenceImage[] {
  return loadReferenceManifest().filter(
    (r) => !r.concepts || r.concepts.length === 0 || r.concepts.includes(concept),
  )
}

/**
 * Clauses that describe TEXT, and therefore must never reach the painter.
 *
 * The reference descriptions are written from finished creatives, so they name
 * the things a finished creative has: "bold white display headline upper-left",
 * "thin callout labels with dot leaders". Those are the brand layer's job — it
 * composites headline, kicker and logomark locally as vectors, and invariant 21
 * forbids asking a diffusion model for lettering at all.
 *
 * Passing them through produced a prompt that argued with itself: the base said
 * "no text" and the reference asked for a headline and labelled callouts. A model
 * given both obeys neither cleanly, which is why the output matched no reference.
 */
const TEXT_CLAUSE =
  /\b(headline|heading|label(s|led)?|caption|callout|dot leaders?|lettering|type|typography|wordmark|logo(mark)?|text)\b/i

/**
 * Keeps the clauses that describe LIGHT, MATERIAL, PALETTE and COMPOSITION, and
 * drops the ones describing text. Split on commas because the styles are written
 * as comma-separated clause lists.
 */
function paintableClauses(style: string): string {
  return style
    .split(',')
    .map((clause) => clause.trim())
    .filter((clause) => clause !== '' && !TEXT_CLAUSE.test(clause))
    .join(', ')
}

/**
 * The style clause for one concept — ONE reference, sanitised.
 *
 * WHY ONE AND NOT ALL. This used to join every applicable reference with
 * semicolons. With most entries tagged for all concepts, a single prompt asked
 * for "one dominant 3D isometric server-hall hero" AND "a single tall textured
 * monolith hero" in the same breath. Two hero subjects is not a style, it is a
 * contradiction, and the painter resolved it by ignoring both.
 *
 * So one reference is chosen: a concept-tagged entry first, because that is the
 * operator saying which look belongs to which treatment, and otherwise a
 * deterministic pick from the concept name so the same concept always draws the
 * same reference and a run stays replayable.
 *
 * Returns empty when nothing applies or nothing survives sanitising, so the
 * caller appends nothing rather than a dangling connective.
 */
export function styleClauseFor(concept: string): string {
  const applicable = referencesFor(concept)
  if (applicable.length === 0) return ''

  // An entry that names this concept is a deliberate pairing; prefer it.
  const tagged = applicable.filter((r) => (r.concepts ?? []).includes(concept))
  const pool = tagged.length > 0 ? tagged : applicable

  // Deterministic, not random: the same concept must always pick the same one.
  let seed = 0
  for (let i = 0; i < concept.length; i += 1) seed = (seed * 31 + concept.charCodeAt(i)) >>> 0
  const chosen = pool[seed % pool.length]
  if (!chosen) return ''

  const style = paintableClauses(chosen.style)
  if (style === '') return ''

  /*
   * Phrased as the treatment of the background rather than "in the style of",
   * and it ends by restating the text exclusion. The restatement is deliberate:
   * it is the last thing in the prompt, and the clause it defends against is the
   * one the reference descriptions keep reintroducing.
   */
  return (
    `Match this art direction: ${style}. ` +
    'Render the background only — no lettering, no labels, no logo of any kind.'
  )
}

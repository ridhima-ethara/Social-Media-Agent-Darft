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
 * The single style clause to append to a background prompt for a concept.
 * Joins every applicable reference's `style` text. Empty when nothing applies,
 * so the caller appends nothing rather than a dangling connective.
 */
export function styleClauseFor(concept: string): string {
  const styles = referencesFor(concept)
    .map((r) => r.style.trim())
    .filter(Boolean)
  if (styles.length === 0) return ''
  return `In the style of the brand references: ${styles.join('; ')}.`
}

/**
 * BRAND VOICE — consumed from the SMA's existing configuration.
 *
 * Three layers, each recorded in `sources` when it contributed:
 *   1. `shared/brand-voice.ts` — positioning, domains, topic vocabulary, the
 *      hype and pitch vocabularies, generic hashtags, sensitive subjects;
 *   2. the workspace row — `workspaces.brand_voice` / `audience`, when an
 *      operator has set them, override the code defaults;
 *   3. the Knowledge Base — the titles of its brand-voice and guideline
 *      entries, so the rules an operator added there are carried along.
 *
 * Nothing about the brand is restated here.
 */

import {
  BRAND,
  BRAND_TOPICS,
  FORBIDDEN_LANGUAGE,
  GENERIC_HASHTAGS,
  PITCH_LANGUAGE,
  SENSITIVE_TOPICS,
} from '../../../../../shared/brand-voice'
import { config } from '../../../config'
import { query as dbQuery } from '../../../db/pool'
import type { BridgeConfig } from '../config'
import type { BrandVoice, KnowledgeBase } from './types'

const GUIDELINE_CATEGORY = /brand voice|brand guideline|compliance/i

export function brandVoiceFromCode(): BrandVoice {
  return {
    sources: ['shared/brand-voice.ts'],
    name: BRAND.wordmark,
    positioning: BRAND.positioning,
    audience: BRAND.audience,
    voice_words: [...BRAND.voiceWords],
    domains: [...BRAND.domains],
    topics: [...BRAND_TOPICS],
    generic_hashtags: [...GENERIC_HASHTAGS],
    hype_patterns: [...FORBIDDEN_LANGUAGE, ...PITCH_LANGUAGE].map((p) => ({
      source: p.pattern.source,
      flags: p.pattern.flags.replace('g', ''),
      why: p.why,
    })),
    restrictions: SENSITIVE_TOPICS.map((t) => ({
      id: t.id,
      label: t.label,
      source: t.pattern.source,
      flags: t.pattern.flags.replace('g', ''),
    })),
    guidelines: [],
    excluded_terms: [],
  }
}

export async function loadBrandVoice(cfg: BridgeConfig, kb: KnowledgeBase): Promise<BrandVoice> {
  const voice = brandVoiceFromCode()

  try {
    const rows = await dbQuery<{ brand_voice: string | null; audience: string | null }>(
      'SELECT brand_voice, audience FROM workspaces WHERE slug = $1',
      [config.core.workspaceSlug],
    )
    const row = rows[0]
    if (row?.brand_voice?.trim()) {
      voice.positioning = row.brand_voice.trim()
      voice.sources.push('database:workspaces.brand_voice')
    }
    if (row?.audience?.trim()) {
      voice.audience = row.audience.trim()
      voice.sources.push('database:workspaces.audience')
    }
  } catch {
    // The code layer stands on its own; the database layer is an override.
  }

  return withKnowledgeGuidelines(voice, kb, cfg)
}

/** Adds the KB's guideline titles and exclusion-category titles to a brand voice. */
export function withKnowledgeGuidelines(voice: BrandVoice, kb: KnowledgeBase, cfg: BridgeConfig): BrandVoice {
  const guidelines = kb.entries.filter((e) => GUIDELINE_CATEGORY.test(e.category)).map((e) => e.title)
  const exclusionCategories = new Set(cfg.context.knowledge_base.exclusion_categories.map((c) => c.toLowerCase()))
  const excludedFromKb = kb.entries
    .filter((e) => exclusionCategories.has(e.category.toLowerCase()))
    .map((e) => e.title.trim())
    .filter((t) => t !== '')
  return {
    ...voice,
    sources: guidelines.length > 0 ? [...voice.sources, `knowledge_base:${guidelines.length} guideline entries`] : voice.sources,
    guidelines: [...voice.guidelines, ...guidelines],
    excluded_terms: [...new Set([...voice.excluded_terms, ...cfg.context.excluded_terms, ...excludedFromKb])],
  }
}

/**
 * Loads the bridge's context — from the running SMA (project mode), or from
 * the sample files under `tests/fixtures/claude-bridge/` (sample mode, used by
 * `npm run test:linkedin-trends` so the pipeline runs with no database and no
 * network).
 */

import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { z } from 'zod'
import { repoPath, type BridgeConfig } from '../config'
import { loadBrandVoice, withKnowledgeGuidelines } from './brand-voice'
import { loadKeywords } from './keywords'
import { loadKnowledgeBase, parseKnowledgeEntries } from './knowledge-base'
import { ContextError, type BrandVoice, type BridgeContext, type KeywordSet, type KnowledgeBase } from './types'

export * from './types'
export { prioritiseKeywords } from './keywords'

export const SAMPLE_CONTEXT_DIR = 'tests/fixtures/claude-bridge'

/**
 * A missing Knowledge Base is a configuration error when
 * `require_knowledge_base` is on (the default); off, the bridge proceeds with
 * an empty one and relevance runs on keywords and brand topics alone.
 */
export async function loadProjectContext(cfg: BridgeConfig, now: Date): Promise<BridgeContext> {
  let knowledgeBase: KnowledgeBase
  try {
    knowledgeBase = await loadKnowledgeBase(cfg)
  } catch (error) {
    if (cfg.require_knowledge_base || !(error instanceof ContextError)) throw error
    knowledgeBase = { source: `none (${error.message})`, entries: [] }
  }
  const [brandVoice, keywords] = await Promise.all([loadBrandVoice(cfg, knowledgeBase), loadKeywords(cfg, now)])
  return { knowledgeBase, brandVoice, keywords }
}

const patternSchema = z.object({ source: z.string(), flags: z.string().default('i'), why: z.string() })

const sampleBrandSchema = z.object({
  name: z.string().nullable(),
  positioning: z.string().nullable(),
  audience: z.string().nullable(),
  voice_words: z.array(z.string()),
  domains: z.array(z.string()),
  topics: z.array(z.string()),
  generic_hashtags: z.array(z.string()),
  hype_patterns: z.array(patternSchema),
  restrictions: z.array(z.object({ id: z.string(), label: z.string(), source: z.string(), flags: z.string().default('i') })),
  excluded_terms: z.array(z.string()).default([]),
})

const sampleKeywordsSchema = z.object({
  keywords: z.array(
    z.object({
      term: z.string(),
      weight: z.number().min(0).max(100),
      category: z.string().default('Core'),
      synonyms: z.array(z.string()).default([]),
      scheduled: z.enum(['constant', 'this_week']).nullable().default(null),
    }),
  ),
})

function readJson(path: string): unknown {
  if (!existsSync(path)) throw new ContextError(`Sample context file not found: ${path}`)
  return JSON.parse(readFileSync(path, 'utf8'))
}

export function loadSampleContext(cfg: BridgeConfig, dir: string = SAMPLE_CONTEXT_DIR): BridgeContext {
  const base = repoPath(dir)

  const kbPath = join(base, 'sample-knowledge-base.json')
  const entries = parseKnowledgeEntries(readJson(kbPath))
  if (entries === null) throw new ContextError(`The sample Knowledge Base at ${kbPath} holds no entries`)
  const knowledgeBase = { source: `file:${kbPath}`, entries }

  const brandPath = join(base, 'sample-brand-voice.json')
  const brand = sampleBrandSchema.parse(readJson(brandPath))
  const voice: BrandVoice = { ...brand, sources: [`file:${brandPath}`], guidelines: [] }

  const kwPath = join(base, 'sample-keywords.json')
  const kw = sampleKeywordsSchema.parse(readJson(kwPath))
  const keywords: KeywordSet = { source: `file:${kwPath}`, keywords: kw.keywords }

  return { knowledgeBase, brandVoice: withKnowledgeGuidelines(voice, knowledgeBase, cfg), keywords }
}

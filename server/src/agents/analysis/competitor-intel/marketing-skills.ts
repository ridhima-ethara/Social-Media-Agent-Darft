/**
 * THE MARKETING SKILLS ADAPTER — the methodology layer, loosely coupled.
 *
 * Competitor Intelligence follows the `competitor-profiling` skill (and, for
 * the comparison view, the principles of `competitors`) from
 * coreyhaines31/marketingskills. The skills are vendored — only those two —
 * in `packages/marketing-skills/`, pinned by `SOURCE.json`, and refreshed with
 * `npm run marketing-skills:sync`. This adapter reads them AT RUN TIME, so a
 * sync changes the methodology the Analysis Agent follows without a code
 * change, and nothing else in the module imports the skill files directly.
 *
 * The skill names tools (Firecrawl, DataForSEO). `TOOL_BINDINGS` maps each to
 * the SMA source that answers it, or states that none is configured — the
 * profile then says "Not available from current sources" for what it would
 * have supplied.
 */

import { existsSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..', '..', '..')
export const MARKETING_SKILLS_DIR = join(ROOT, 'packages', 'marketing-skills')

export interface SkillSource {
  repository: string
  commit: string | null
  committed_at: string | null
  synced_at: string | null
  skills: Array<{ name: string; path: string; version: string | null }>
}

export interface LoadedSkill {
  name: string
  version: string | null
  commit: string | null
  /** SKILL.md without its front matter. */
  body: string
  references: Record<string, string>
}

function read(path: string): string | null {
  try {
    return readFileSync(path, 'utf8')
  } catch {
    return null
  }
}

export function skillSource(): SkillSource | null {
  const raw = read(join(MARKETING_SKILLS_DIR, 'SOURCE.json'))
  if (!raw) return null
  try {
    return JSON.parse(raw) as SkillSource
  } catch {
    return null
  }
}

export function loadSkill(name: 'competitor-profiling' | 'competitors'): LoadedSkill | null {
  const dir = join(MARKETING_SKILLS_DIR, name)
  const md = read(join(dir, 'SKILL.md'))
  if (!md) return null
  const references: Record<string, string> = {}
  for (const ref of ['tool-reference.md', 'templates.md', 'content-architecture.md']) {
    const text = read(join(dir, 'references', ref))
    if (text) references[ref] = text
  }
  const src = skillSource()
  return {
    name,
    version: md.match(/^\s*version:\s*([^\s]+)/m)?.[1] ?? null,
    commit: src?.commit ?? null,
    body: md.replace(/^---[\s\S]*?---\s*/, ''),
    references,
  }
}

/** A `## Heading` section of a skill body, up to the next `## `. */
export function section(body: string, heading: string): string {
  const start = body.search(new RegExp(`^## ${heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*$`, 'm'))
  if (start < 0) return ''
  const rest = body.slice(start)
  const next = rest.slice(3).search(/^## /m)
  return (next < 0 ? rest : rest.slice(0, next + 3)).trim()
}

export function marketingSkillsAvailable(): { available: boolean; reason: string | null } {
  if (!existsSync(join(MARKETING_SKILLS_DIR, 'competitor-profiling', 'SKILL.md'))) {
    return { available: false, reason: 'packages/marketing-skills/competitor-profiling is missing — run `npm run marketing-skills:sync`.' }
  }
  return { available: true, reason: null }
}

/* ── the skill's tools, bound to SMA sources ─────────────────────────── */

export type SkillTool =
  | 'firecrawl_map'
  | 'firecrawl_scrape'
  | 'firecrawl_search'
  | 'dataforseo_labs_google_domain_rank_overview'
  | 'backlinks_summary'
  | 'dataforseo_labs_google_relevant_pages'
  | 'dataforseo_labs_google_competitors_domain'

export interface ToolBinding {
  tool: SkillTool
  /** What in the SMA answers it. */
  bound_to: string
  /** Whether that source is configured in this deployment. */
  available: boolean
  note: string
}

export function toolBindings(seoConfigured: boolean): ToolBinding[] {
  const seo = (tool: SkillTool): ToolBinding => ({
    tool,
    bound_to: 'DataForSEO REST API (DATAFORSEO_LOGIN / DATAFORSEO_PASSWORD)',
    available: seoConfigured,
    note: seoConfigured ? 'Live.' : 'Not configured — SEO figures read "Not available from current sources".',
  })
  return [
    { tool: 'firecrawl_map', bound_to: 'Website reader: robots.txt-checked sitemap.xml + homepage links', available: true, note: 'Key pages found by path (/pricing, /about, /blog, /research, /changelog…).' },
    { tool: 'firecrawl_scrape', bound_to: 'Website reader: robots.txt-checked page fetch → readable text', available: true, note: 'Raw text saved per page under data/competitor-profiles/raw/<slug>/<date>/scrapes/.' },
    { tool: 'firecrawl_search', bound_to: 'News reader: Bing News RSS (robots-allowed), dated by the feed', available: true, note: 'Recent developments, funding and launch coverage.' },
    seo('dataforseo_labs_google_domain_rank_overview'),
    seo('backlinks_summary'),
    seo('dataforseo_labs_google_relevant_pages'),
    seo('dataforseo_labs_google_competitors_domain'),
  ]
}

/** Page types the skill's Step 1 prioritises, in order — quick scan takes the first two. */
export const KEY_PAGES: Array<{ type: 'website' | 'pricing' | 'about' | 'blog' | 'research' | 'docs' | 'changelog' | 'customers' | 'careers'; pattern: RegExp }> = [
  { type: 'pricing', pattern: /\/(pricing|plans|packages)(\/|$)/i },
  { type: 'about', pattern: /\/(about|company|about-us|who-we-are)(\/|$)/i },
  { type: 'blog', pattern: /\/(blog|news|newsroom|press|updates)(\/|$)/i },
  { type: 'research', pattern: /\/(research|publications|papers)(\/|$)/i },
  { type: 'changelog', pattern: /\/(changelog|release-notes|whats-new|what-s-new)(\/|$)/i },
  { type: 'customers', pattern: /\/(customers|case-studies|stories)(\/|$)/i },
  { type: 'docs', pattern: /\/(docs|documentation|developers)(\/|$)/i },
  { type: 'careers', pattern: /\/(careers|jobs)(\/|$)/i },
]

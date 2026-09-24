/**
 * KEYWORDS — the SMA's configured keyword set.
 *
 * Read from the `keywords` table (what an operator edits under Settings →
 * Keywords & Sources), marked with the weekly rota from `keyword_schedule` so
 * the terms the SMA is capturing this week come first. When the database is
 * unreachable the seed set in `shared/keywords.ts` stands in, and the source
 * says so.
 */

import { defaultSkillConfig } from '../../../../../shared/agent-registry'
import { cycleWeekFor } from '../../../../../shared/keyword-schedule'
import { SEED_KEYWORDS, synonymsFor } from '../../../../../shared/keywords'
import { config } from '../../../config'
import { query as dbQuery } from '../../../db/pool'
import type { BridgeConfig } from '../config'
import { ContextError, type KeywordEntry, type KeywordSet } from './types'

interface KeywordDbRow {
  term: string
  weight: number
  category: string
  kinds: string[] | null
  weeks: number[] | null
}

/** The rota anchor as the Scraping Agent resolves it: workspace override, else registry default. */
async function scheduleAnchor(): Promise<Date | null> {
  const defaults = defaultSkillConfig('scraping.keyword.resolve')
  let raw = typeof defaults.scheduleAnchorDate === 'string' ? defaults.scheduleAnchorDate : ''
  const rows = await dbQuery<{ anchor: string | null }>(
    `SELECT s.config->>'scheduleAnchorDate' AS anchor
       FROM agent_skills s JOIN workspaces w ON w.id = s.workspace_id
      WHERE w.slug = $1 AND s.skill_id = 'scraping.keyword.resolve'`,
    [config.core.workspaceSlug],
  )
  if (rows[0]?.anchor) raw = rows[0].anchor
  const anchor = new Date(`${raw}T00:00:00Z`)
  return Number.isNaN(anchor.getTime()) ? null : anchor
}

async function fromDatabase(now: Date): Promise<KeywordSet> {
  const rows = await dbQuery<KeywordDbRow>(
    `SELECT k.term, k.weight, k.category,
            array_agg(ks.kind) FILTER (WHERE ks.active) AS kinds,
            array_agg(ks.cycle_week) FILTER (WHERE ks.active AND ks.cycle_week IS NOT NULL) AS weeks
       FROM keywords k
       JOIN workspaces w ON w.id = k.workspace_id
       LEFT JOIN keyword_schedule ks ON ks.keyword_id = k.id
      WHERE w.slug = $1 AND k.active = true
      GROUP BY k.id
      ORDER BY k.weight DESC, k.term`,
    [config.core.workspaceSlug],
  )
  const anchor = await scheduleAnchor()
  const today = new Date(now.toLocaleDateString('en-CA', { timeZone: config.core.tz }))
  const week = anchor === null ? null : cycleWeekFor(today, anchor)

  const keywords: KeywordEntry[] = rows.map((r) => ({
    term: r.term,
    weight: r.weight,
    category: r.category,
    synonyms: synonymsFor(r.term),
    scheduled: r.kinds?.includes('constant')
      ? 'constant'
      : week !== null && (r.weeks ?? []).includes(week)
        ? 'this_week'
        : null,
  }))
  return { source: `database:keywords (workspace ${config.core.workspaceSlug}${week === null ? '' : `, rota week ${week}`})`, keywords }
}

function fromSeed(): KeywordSet {
  return {
    source: 'seed:shared/keywords.ts',
    keywords: SEED_KEYWORDS.filter((k) => k.active !== false).map((k) => ({
      term: k.term,
      weight: k.weight,
      category: k.category,
      synonyms: synonymsFor(k.term),
      scheduled: null,
    })),
  }
}

export async function loadKeywords(cfg: BridgeConfig, now: Date): Promise<KeywordSet> {
  if (cfg.context.keywords.merge_sources) return mergedKeywords(cfg, now)
  const reasons: string[] = []
  for (const source of cfg.context.keywords.sources) {
    if (source === 'seed') return fromSeed()
    try {
      const set = await fromDatabase(now)
      if (set.keywords.length > 0) return set
      reasons.push('the keywords table holds no active keyword')
    } catch (error) {
      reasons.push(`the database could not be read — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  throw new ContextError(`No keyword source answered: ${reasons.join('; ')}`)
}

/**
 * Every keyword the SMA holds: the `keywords` table AND the seed set in
 * `shared/keywords.ts`, the table winning on a shared term (it carries the
 * operator's weight and the rota). Used when `merge_sources` is on, so the
 * reference is every keyword added anywhere — not only one source's.
 */
async function mergedKeywords(cfg: BridgeConfig, now: Date): Promise<KeywordSet> {
  const parts: KeywordSet[] = []
  const reasons: string[] = []
  for (const source of cfg.context.keywords.sources) {
    if (source === 'seed') {
      parts.push(fromSeed())
      continue
    }
    try {
      parts.push(await fromDatabase(now))
    } catch (error) {
      reasons.push(`the database could not be read — ${error instanceof Error ? error.message : String(error)}`)
    }
  }
  const byTerm = new Map<string, KeywordEntry>()
  for (const part of parts) for (const k of part.keywords) if (!byTerm.has(k.term.toLowerCase())) byTerm.set(k.term.toLowerCase(), k)
  if (byTerm.size === 0) throw new ContextError(`No keyword source answered: ${reasons.join('; ') || 'every source was empty'}`)
  return { source: parts.map((p) => `${p.source} (${p.keywords.length})`).join(' + '), keywords: [...byTerm.values()] }
}

/**
 * The order keywords are queried in: this week's rota first (constants, then
 * the rotating set) when configured, then by weight.
 */
export function prioritiseKeywords(set: KeywordSet, cfg: BridgeConfig): KeywordEntry[] {
  const rank = (k: KeywordEntry): number =>
    !cfg.context.keywords.prioritise_schedule ? 0 : k.scheduled === 'constant' ? 0 : k.scheduled === 'this_week' ? 1 : 2
  return [...set.keywords].sort((a, b) => rank(a) - rank(b) || b.weight - a.weight || a.term.localeCompare(b.term))
}

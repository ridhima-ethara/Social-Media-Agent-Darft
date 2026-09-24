/**
 * Competitor Intelligence storage — the universe, versioned profiles and
 * market reports. Kept apart from `repo.ts`, which is already the largest file
 * in the server; the SQL style is the same.
 */

import type { Competitor, CompetitorProfile, CompetitorStatus, CompetitorTier, MarketReport, MonitoringFrequency } from '../../../shared/competitor-intel'
import { query, queryOne } from './pool'

interface CompetitorRow {
  id: string
  slug: string
  name: string
  tier: CompetitorTier
  category: string
  description: string
  website_url: string
  social_urls: string[]
  keywords: string[]
  status: CompetitorStatus
  monitoring_frequency: MonitoringFrequency
  created_at: Date | string
  updated_at: Date | string
  last_analyzed_at: Date | string | null
  is_self: boolean
}

const iso = (v: Date | string | null): string | null => (v === null ? null : v instanceof Date ? v.toISOString() : new Date(v).toISOString())

function toCompetitor(r: CompetitorRow): Competitor {
  return {
    id: r.id,
    slug: r.slug,
    name: r.name,
    tier: r.tier,
    category: r.category,
    description: r.description,
    website_url: r.website_url,
    social_urls: Array.isArray(r.social_urls) ? r.social_urls : [],
    keywords: Array.isArray(r.keywords) ? r.keywords : [],
    status: r.status,
    monitoring_frequency: r.monitoring_frequency,
    created_at: iso(r.created_at) as string,
    updated_at: iso(r.updated_at) as string,
    last_analyzed_at: iso(r.last_analyzed_at),
    is_self: r.is_self === true,
  }
}

const COLUMNS = 'id, slug, name, tier, category, description, website_url, social_urls, keywords, status, monitoring_frequency, created_at, updated_at, last_analyzed_at, is_self'

export async function listCompetitors(workspaceId: string): Promise<Competitor[]> {
  const rows = await query<CompetitorRow>(`SELECT ${COLUMNS} FROM competitors WHERE workspace_id = $1 ORDER BY is_self DESC, tier, name`, [workspaceId])
  return rows.map(toCompetitor)
}

export async function countCompetitors(workspaceId: string): Promise<number> {
  const row = await queryOne<{ n: string }>('SELECT count(*)::text AS n FROM competitors WHERE workspace_id = $1', [workspaceId])
  return Number(row?.n ?? 0)
}

export async function getCompetitor(workspaceId: string, id: string): Promise<Competitor | null> {
  const row = await queryOne<CompetitorRow>(`SELECT ${COLUMNS} FROM competitors WHERE workspace_id = $1 AND id = $2`, [workspaceId, id])
  return row ? toCompetitor(row) : null
}

export interface CompetitorInput {
  slug: string
  name: string
  tier: CompetitorTier
  category: string
  description: string
  website_url: string
  social_urls: string[]
  keywords: string[]
  status: CompetitorStatus
  monitoring_frequency: MonitoringFrequency
  is_self?: boolean
}

/** Inserts; a slug already present is left exactly as it is (an operator's edit is never overwritten by a seed). */
export async function insertCompetitor(workspaceId: string, c: CompetitorInput): Promise<Competitor | null> {
  const row = await queryOne<CompetitorRow>(
    `INSERT INTO competitors (workspace_id, slug, name, tier, category, description, website_url, social_urls, keywords, status, monitoring_frequency, is_self)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb,$10,$11,$12)
     ON CONFLICT (workspace_id, slug) DO NOTHING
     RETURNING ${COLUMNS}`,
    [workspaceId, c.slug, c.name, c.tier, c.category, c.description, c.website_url, JSON.stringify(c.social_urls), JSON.stringify(c.keywords), c.status, c.monitoring_frequency, c.is_self === true],
  )
  return row ? toCompetitor(row) : null
}

export async function updateCompetitor(workspaceId: string, id: string, patch: Partial<CompetitorInput>): Promise<Competitor | null> {
  const sets: string[] = []
  const params: Array<string | number | null> = [workspaceId, id]
  const add = (column: string, value: string | null, cast = ''): void => {
    params.push(value)
    sets.push(`${column} = $${params.length}${cast}`)
  }
  if (patch.name !== undefined) add('name', patch.name)
  if (patch.tier !== undefined) add('tier', patch.tier)
  if (patch.category !== undefined) add('category', patch.category)
  if (patch.description !== undefined) add('description', patch.description)
  if (patch.website_url !== undefined) add('website_url', patch.website_url)
  if (patch.social_urls !== undefined) add('social_urls', JSON.stringify(patch.social_urls), '::jsonb')
  if (patch.keywords !== undefined) add('keywords', JSON.stringify(patch.keywords), '::jsonb')
  if (patch.status !== undefined) add('status', patch.status)
  if (patch.monitoring_frequency !== undefined) add('monitoring_frequency', patch.monitoring_frequency)
  if (sets.length === 0) return getCompetitor(workspaceId, id)
  const row = await queryOne<CompetitorRow>(
    `UPDATE competitors SET ${sets.join(', ')}, updated_at = now() WHERE workspace_id = $1 AND id = $2 RETURNING ${COLUMNS}`,
    params,
  )
  return row ? toCompetitor(row) : null
}

/** Removes a competitor and (by cascade) its profile history. Deactivating keeps the history. */
export async function deleteCompetitor(workspaceId: string, id: string): Promise<boolean> {
  const rows = await query<{ id: string }>('DELETE FROM competitors WHERE workspace_id = $1 AND id = $2 RETURNING id', [workspaceId, id])
  return rows.length > 0
}

export async function markCompetitorAnalyzed(workspaceId: string, id: string, at: string): Promise<void> {
  await query('UPDATE competitors SET last_analyzed_at = $3 WHERE workspace_id = $1 AND id = $2', [workspaceId, id, at])
}

/* ── profiles ─────────────────────────────────────────────────────────── */

export async function latestProfile(workspaceId: string, competitorId: string): Promise<CompetitorProfile | null> {
  const row = await queryOne<{ profile: CompetitorProfile }>(
    'SELECT profile FROM competitor_profiles WHERE workspace_id = $1 AND competitor_id = $2 ORDER BY version DESC LIMIT 1',
    [workspaceId, competitorId],
  )
  return row?.profile ?? null
}

/** The latest profile of every competitor that has one. */
export async function latestProfiles(workspaceId: string): Promise<CompetitorProfile[]> {
  const rows = await query<{ profile: CompetitorProfile }>(
    `SELECT DISTINCT ON (competitor_id) profile
       FROM competitor_profiles
      WHERE workspace_id = $1
      ORDER BY competitor_id, version DESC`,
    [workspaceId],
  )
  return rows.map((r) => r.profile)
}

export async function profileVersions(workspaceId: string, competitorId: string): Promise<Array<{ version: number; generated_at: string; changes: number }>> {
  const rows = await query<{ version: number; generated_at: Date; changes: string }>(
    `SELECT version, generated_at, jsonb_array_length(coalesce(profile->'changes', '[]'::jsonb))::text AS changes
       FROM competitor_profiles WHERE workspace_id = $1 AND competitor_id = $2 ORDER BY version DESC`,
    [workspaceId, competitorId],
  )
  return rows.map((r) => ({ version: r.version, generated_at: iso(r.generated_at) as string, changes: Number(r.changes) }))
}

export async function insertProfile(workspaceId: string, profile: CompetitorProfile): Promise<void> {
  await query(
    'INSERT INTO competitor_profiles (workspace_id, competitor_id, version, profile, generated_at) VALUES ($1,$2,$3,$4::jsonb,$5)',
    [workspaceId, profile.competitor_id, profile.profile_version, JSON.stringify(profile), profile.generated_at],
  )
}

/* ── market reports ───────────────────────────────────────────────────── */

export async function insertMarketReport(workspaceId: string, report: MarketReport): Promise<void> {
  await query('INSERT INTO competitor_market_reports (workspace_id, report, generated_at) VALUES ($1,$2::jsonb,$3)', [workspaceId, JSON.stringify(report), report.generated_at])
}

export async function latestMarketReport(workspaceId: string): Promise<MarketReport | null> {
  const row = await queryOne<{ report: MarketReport }>(
    'SELECT report FROM competitor_market_reports WHERE workspace_id = $1 ORDER BY generated_at DESC LIMIT 1',
    [workspaceId],
  )
  return row?.report ?? null
}

export async function profileByVersion(workspaceId: string, competitorId: string, version: number): Promise<CompetitorProfile | null> {
  const row = await queryOne<{ profile: CompetitorProfile }>(
    'SELECT profile FROM competitor_profiles WHERE workspace_id = $1 AND competitor_id = $2 AND version = $3',
    [workspaceId, competitorId, version],
  )
  return row?.profile ?? null
}

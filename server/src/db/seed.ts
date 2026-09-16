#!/usr/bin/env tsx
/**
 * `npm run db:seed` — the STRUCTURAL seed.
 *
 * What this writes is definition, not content: the workspace and its brand, the
 * keyword set the Scraping Agent works from, the source registry, one
 * agent_state row per agent, and the brand rules as Knowledge Base entries.
 *
 * What it deliberately does NOT write is a corpus. There are no invented posts,
 * hashtags, ideas, published results or analytics here, and no fabricated
 * competitors. Every figure the product displays is therefore something a run
 * actually captured — an empty dashboard before the first run is the honest
 * state, and `npm run agents:run` (or Run Discovery in the console) is what
 * fills it, from the live web via crawl4ai.
 *
 * The seed is idempotent at the workspace level: it clears the workspace's own
 * rows and rebuilds them, so running it twice leaves the same database rather
 * than doubling every table. Nothing outside the workspace is touched.
 */

import { AGENTS } from '../../../shared/agent-registry'
import { BRAND, brandCorpusAsKnowledge, brandRulesAsKnowledge } from '../../../shared/brand-voice'
import { SEED_KEYWORDS } from '../../../shared/keywords'
import { CONSTANT_KEYWORDS, SCHEDULE_WEEKS } from '../../../shared/keyword-schedule'

import { config } from '../config'
import { embedMany, embeddableText, embeddingModelId, toSqlVector } from '../integrations/embeddings'
import { seedKeywordSchedule } from './repo'
import { closePool, query, queryOne } from './pool'

/* ═══════════════════════════════════════════════════════════════════════════
   THE SOURCE REGISTRY
   ───────────────────────────────────────────────────────────────────────────
   The lanes and publications the Scraping Agent draws from, all reached the
   same way: a crawl4ai search, scoped by `site:` for the four platforms and
   unscoped for the open web.

   `Competitor` rows are absent on purpose. A fabricated competitor produces a
   fabricated saturation reading, and the Analysis Agent would then decline real
   opportunities on the strength of it. Register real ones under
   Settings → Keywords & Sources and `scraping.competitor.track` will read them.
   ═══════════════════════════════════════════════════════════════════════════ */

interface SourceRegistryEntry {
  name: string
  kind: string
  sourceType: string
  url: string
  trusted: boolean
  enabled: boolean
}

const SOURCES: SourceRegistryEntry[] = [
  { name: 'LinkedIn · indexed public posts', kind: 'linkedin', sourceType: 'Social', url: 'https://www.linkedin.com/', trusted: true, enabled: true },
  { name: 'Instagram · indexed public posts', kind: 'instagram', sourceType: 'Social', url: 'https://www.instagram.com/', trusted: false, enabled: true },
  { name: 'X · indexed public posts', kind: 'x', sourceType: 'Social', url: 'https://x.com/', trusted: false, enabled: true },
  { name: 'Facebook · indexed public pages', kind: 'facebook', sourceType: 'Social', url: 'https://www.facebook.com/', trusted: false, enabled: true },
  { name: 'Open web · unscoped search', kind: 'web', sourceType: 'Website', url: '', trusted: false, enabled: true },
]

/* ═══════════════════════════════════════════════════════════════════════════
   THE SEED RUN
   ═══════════════════════════════════════════════════════════════════════════ */

const counts: Record<string, number> = {}

function tally(table: string, n = 1): void {
  counts[table] = (counts[table] ?? 0) + n
}

async function ensureWorkspace(): Promise<string> {
  const slug = config.core.workspaceSlug
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM workspaces WHERE slug = $1',
    [slug],
  )
  if (existing) return existing.id

  const row = await queryOne<{ id: string }>(
    `INSERT INTO workspaces (name, slug, brand_voice, audience, settings)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      'Ethara.AI · Main',
      slug,
      BRAND.voiceWords.join(', '),
      BRAND.audience,
      JSON.stringify({
        positioning: BRAND.positioning,
        emojiBudget: BRAND.emojiBudget,
        hashtags: BRAND.hashtags,
      }),
    ],
  )
  if (!row) throw new Error('Failed to create workspace')
  return row.id
}

/**
 * Clears this workspace's rows so the seed is idempotent.
 * Ordered by dependency. Nothing outside the workspace is touched.
 */
async function clearWorkspace(workspaceId: string): Promise<void> {
  const byWorkspace = [
    'lineage_edges',
    'review_queue',
    'activity_events',
    'skill_runs',
    'agent_runs',
    'pipeline_runs',
    'agent_state',
    'agent_skills',
    'platform_analytics',
    'knowledge_entries',
    'knowledge_builds',
  ]

  // Children whose parents are scoped by workspace.
  await query(
    `DELETE FROM post_metrics WHERE post_id IN (SELECT id FROM posts WHERE workspace_id = $1)`,
    [workspaceId],
  )
  await query(
    `DELETE FROM assistant_steps WHERE turn_id IN (
       SELECT t.id FROM assistant_turns t
       JOIN assistant_conversations c ON c.id = t.conversation_id
       WHERE c.workspace_id = $1)`,
    [workspaceId],
  )
  await query(
    `DELETE FROM assistant_confirmations WHERE turn_id IN (
       SELECT t.id FROM assistant_turns t
       JOIN assistant_conversations c ON c.id = t.conversation_id
       WHERE c.workspace_id = $1)`,
    [workspaceId],
  )
  await query(
    `DELETE FROM assistant_turns WHERE conversation_id IN (
       SELECT id FROM assistant_conversations WHERE workspace_id = $1)`,
    [workspaceId],
  )
  await query('DELETE FROM assistant_conversations WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM assistant_briefs WHERE workspace_id = $1', [workspaceId])

  await query(
    `DELETE FROM drafts WHERE idea_id IN (SELECT id FROM content_ideas WHERE workspace_id = $1)`,
    [workspaceId],
  )
  await query(
    `DELETE FROM media_assets WHERE idea_id IN (SELECT id FROM content_ideas WHERE workspace_id = $1)`,
    [workspaceId],
  )
  await query('DELETE FROM posts WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM content_ideas WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM scraped_items WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM hashtags WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM keyword_signals WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM keywords WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM sources WHERE workspace_id = $1', [workspaceId])

  for (const table of byWorkspace) {
    await query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId])
  }
}

/* ── Keywords ──────────────────────────────────────────────────────────────
   The terms every capture lane is searched for. This is the starting position;
   the table is editable under Settings → Keywords and editing it does not touch
   `shared/keywords.ts`.
   ────────────────────────────────────────────────────────────────────────── */

async function seedKeywords(workspaceId: string): Promise<void> {
  for (const kw of SEED_KEYWORDS) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO keywords (workspace_id, term, category, weight, active)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [workspaceId, kw.term, kw.category, kw.weight],
    )
    if (row) tally('keywords')
  }
}

/* ── Sources ─────────────────────────────────────────────────────────────── */

async function seedSources(workspaceId: string): Promise<void> {
  for (const s of SOURCES) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO sources (workspace_id, name, kind, source_type, url, trusted, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [workspaceId, s.name, s.kind, s.sourceType, s.url === '' ? null : s.url, s.trusted, s.enabled],
    )
    if (row) tally('sources')
  }
}

/* ── Agent state ───────────────────────────────────────────────────────────
   One row per agent, all idle and all at zero. A success rate before any run
   has happened would be a number nothing measured.
   ────────────────────────────────────────────────────────────────────────── */

async function seedAgentState(workspaceId: string): Promise<void> {
  for (const agent of AGENTS) {
    await query(
      `INSERT INTO agent_state
         (workspace_id, agent_id, status, current_task, last_run, processed, success_rate)
       VALUES ($1,$2,'idle',$3,NULL,0,0)
       ON CONFLICT (workspace_id, agent_id) DO UPDATE
         SET status = EXCLUDED.status,
             current_task = EXCLUDED.current_task,
             last_run = EXCLUDED.last_run,
             processed = EXCLUDED.processed,
             success_rate = EXCLUDED.success_rate`,
      [workspaceId, agent.id, agent.id === 'assistant' ? 'Listening' : 'Idle'],
    )
    tally('agent_state')
  }
}

/* ── The brand, as knowledge ───────────────────────────────────────────────
   The brand rules live in the same table as everything the product learns, so
   switching a brand entry off genuinely stops it influencing generation.

   Two different things are seeded here, and the distinction is load-bearing:

     the RULES   how to write. Tagged `brand-rule`, and deliberately EXCLUDED
                 from the Scraping Agent's alignment vocabulary — otherwise
                 "hashtag", "punctuation" and "vocabulary" would read as
                 on-brand subject matter and a compliance document would end up
                 deciding which articles are relevant.

     the CORPUS  what we know and talk about. Tagged `brand-corpus` and carrying
                 domain vocabulary, so the Scraping Agent has something real to
                 score against on the very first run, before any research build
                 has happened, and so rule 6 has key points to trace claims to.
   ────────────────────────────────────────────────────────────────────────── */

async function seedBrandKnowledge(workspaceId: string): Promise<void> {
  const rows = [
    ...brandRulesAsKnowledge().map((r) => ({ ...r, source: 'Brand definition' })),
    ...brandCorpusAsKnowledge().map((r) => ({ ...r, source: 'Brand corpus' })),
  ]

  /*
   * Embedded here, in one batch, rather than left for `db:embed`.
   *
   * The brand rules and corpus are what the Scraping Agent scores against on the
   * very first run, before any research build exists — so if they seeded without
   * vectors, the first run's retrieval would be lexical no matter how the
   * embedder was configured. `embedMany` never rejects, so an absent embedder
   * still seeds a complete corpus; the rows simply carry NULL until `db:embed`.
   */
  const embedded = await embedMany(
    rows.map((row) => embeddableText(row.title, row.content)),
    'document',
  )
  const modelId = embeddingModelId()

  for (const [index, row] of rows.entries()) {
    const vector = embedded.vectors[index] ?? null
    await query(
      `INSERT INTO knowledge_entries
         (workspace_id, title, category, content, source, sources, confidence,
          evidence_count, active, origin, tags,
          embedding, embedding_model, embedded_at)
       VALUES ($1,$2,$3,$4,$5,'[]'::jsonb,$6,1,true,'brand',$7,
          $8::vector, $9, CASE WHEN $8 IS NULL THEN NULL ELSE now() END)`,
      [
        workspaceId,
        row.title,
        row.category,
        row.content,
        row.source,
        row.confidence,
        row.tags,
        vector === null ? null : toSqlVector(vector),
        vector === null ? null : modelId,
      ],
    )
    tally('knowledge_entries')
  }

  if (embedded.reason !== undefined) {
    console.log(`  · knowledge seeded without vectors — ${embedded.reason}`)
    console.log('    run `npm run db:embed` once an embedder is reachable')
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════════ */

async function main(): Promise<void> {
  console.log('\n  Ethara SocialAI · structural seed')
  console.log(`  workspace: ${config.core.workspaceSlug}`)
  console.log('  content:   none — every figure comes from a real run\n')

  const workspaceId = await ensureWorkspace()
  await clearWorkspace(workspaceId)

  await seedKeywords(workspaceId)
  await seedSources(workspaceId)
  await seedAgentState(workspaceId)
  /*
   * The weekly keyword rota. Seeded AFTER the brand knowledge because it creates
   * keywords of its own, and `createKeyword` upserts on `lower(term)` — so a term
   * already tracked keeps its operator-set weight rather than being reset here.
   */
  const rota = await seedKeywordSchedule(workspaceId, CONSTANT_KEYWORDS, SCHEDULE_WEEKS)
  console.log(
    `  keyword_schedule     ${rota.constants} constant + ${rota.rotating} rotating ` +
      `across ${SCHEDULE_WEEKS.length} weeks (${rota.keywords} keywords)`,
  )

  await seedBrandKnowledge(workspaceId)

  const width = Math.max(...Object.keys(counts).map((k) => k.length))
  for (const key of Object.keys(counts).sort()) {
    console.log(`  ${key.padEnd(width)}  ${String(counts[key]).padStart(4)}`)
  }

  console.log(
    '\n  ✓ Seed complete. Run discovery to capture real material:' +
      '\n      npm run dev:server   then POST /api/pipeline/run, or Run Discovery in the console\n',
  )
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('\n  ✗ Seed failed:', error instanceof Error ? error.message : error)
    if (error instanceof Error && error.stack) {
      console.error(error.stack.split('\n').slice(1, 5).join('\n'))
    }
    await closePool().catch(() => undefined)
    process.exit(1)
  })

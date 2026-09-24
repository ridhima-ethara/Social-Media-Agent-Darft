/**
 * KNOWLEDGE BASE — the SMA's own, discovered rather than assumed.
 *
 * Tried in the configured order:
 *   `database` — active rows of `knowledge_entries` for the workspace, which
 *                is what the Knowledge Base screen shows and edits;
 *   `file`     — the first JSON file found under the configured search paths
 *                whose name mentions knowledge/kb and which holds an array of
 *                `{ title, content }` entries (the Python tier writes
 *                `backend/data/knowledge.json`, but no name is hardcoded).
 *
 * `LINKEDIN_TRENDS_KB_FILE` names a file explicitly and wins over discovery.
 */

import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { config } from '../../../config'
import { query as dbQuery } from '../../../db/pool'
import { repoPath, type BridgeConfig } from '../config'
import { ContextError, type KnowledgeBase, type KnowledgeEntry } from './types'

interface Loose {
  [key: string]: unknown
}

function str(v: unknown): string {
  return typeof v === 'string' ? v : ''
}

/** Parses an array of KB-shaped objects; `null` when the file is not a knowledge base. */
export function parseKnowledgeEntries(raw: unknown): KnowledgeEntry[] | null {
  const list = Array.isArray(raw)
    ? raw
    : raw !== null && typeof raw === 'object' && Array.isArray((raw as Loose).entries)
      ? ((raw as Loose).entries as unknown[])
      : null
  if (list === null) return null
  const entries: KnowledgeEntry[] = []
  for (const item of list) {
    if (item === null || typeof item !== 'object') continue
    const row = item as Loose
    if (row.active === false) continue
    const title = str(row.title)
    const content = str(row.content)
    if (title === '' && content === '') continue
    entries.push({
      id: str(row.id) || title,
      title,
      category: str(row.category) || 'Uncategorised',
      content,
      tags: Array.isArray(row.tags) ? row.tags.filter((t): t is string => typeof t === 'string') : [],
    })
  }
  return entries.length > 0 ? entries : null
}

async function fromDatabase(limit: number): Promise<KnowledgeBase> {
  const rows = await dbQuery<{ id: string; title: string; category: string; content: string; tags: string[] }>(
    `SELECT ke.id, ke.title, ke.category, ke.content, ke.tags
       FROM knowledge_entries ke JOIN workspaces w ON w.id = ke.workspace_id
      WHERE w.slug = $1 AND ke.active = true
      ORDER BY ke.updated_at DESC
      LIMIT $2`,
    [config.core.workspaceSlug, limit],
  )
  return { source: `database:knowledge_entries (workspace ${config.core.workspaceSlug})`, entries: rows }
}

/** Candidate KB files under the search paths, most specific name first. */
export function discoverKnowledgeFiles(searchPaths: readonly string[]): string[] {
  const found: string[] = []
  for (const dir of searchPaths) {
    const abs = repoPath(dir)
    if (!existsSync(abs) || !statSync(abs).isDirectory()) continue
    for (const name of readdirSync(abs)) {
      if (!name.toLowerCase().endsWith('.json')) continue
      if (!/knowledge|(^|[-_.])kb([-_.]|$)/i.test(name)) continue
      found.push(join(abs, name))
    }
  }
  return found
}

function fromFile(path: string, limit: number): KnowledgeBase | null {
  try {
    const entries = parseKnowledgeEntries(JSON.parse(readFileSync(path, 'utf8')))
    return entries === null ? null : { source: `file:${path}`, entries: entries.slice(0, limit) }
  } catch {
    return null
  }
}

export async function loadKnowledgeBase(cfg: BridgeConfig): Promise<KnowledgeBase> {
  const kb = cfg.context.knowledge_base
  const reasons: string[] = []

  const explicit = process.env.LINKEDIN_TRENDS_KB_FILE?.trim()
  if (explicit) {
    const loaded = fromFile(repoPath(explicit), kb.max_entries)
    if (loaded) return loaded
    reasons.push(`LINKEDIN_TRENDS_KB_FILE (${explicit}) is missing or holds no entries`)
  }

  for (const source of kb.sources) {
    if (source === 'database') {
      try {
        const loaded = await fromDatabase(kb.max_entries)
        if (loaded.entries.length > 0) return loaded
        reasons.push('knowledge_entries holds no active entry for the workspace')
      } catch (error) {
        reasons.push(`the database could not be read — ${error instanceof Error ? error.message : String(error)}`)
      }
    } else {
      const files = discoverKnowledgeFiles(kb.search_paths)
      for (const file of files) {
        const loaded = fromFile(file, kb.max_entries)
        if (loaded) return loaded
      }
      reasons.push(`no Knowledge Base file found under ${kb.search_paths.join(', ')}`)
    }
  }

  throw new ContextError(`The Knowledge Base is unavailable: ${reasons.join('; ')}`)
}

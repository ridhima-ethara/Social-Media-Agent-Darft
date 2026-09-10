/**
 * THE KNOWLEDGE AGENT — stage `learn`
 *
 * The only agent whose primary product is knowledge. It researches the
 * consolidated top-25 hashtags against the live web every Sunday at 06:00 (and
 * on demand), and writes cited, confidence-scored entries that every other agent
 * reads before it acts.
 *
 * One rule dominates: an uncited claim never enters the Knowledge Base. An entry
 * with fewer than `minSources` cited URLs is discarded and the discard is
 * recorded — not quietly written with a shrug.
 */

import type { Confidence } from '../../../../shared/agent-contract'
import { BRAND_RULE_TAG, similarity } from '../../../../shared/brand-voice'
import {
  insertKnowledgeEntry,
  insertLineage,
  insertReviewQueueRow,
  listHashtags,
  listKnowledge,
  markHashtagResearched,
  mergeKnowledgeEntry,
  setKnowledgeConfidence,
  type KnowledgeEntryRow,
} from '../../db/repo'
import {
  AdapterError,
  crawl4aiSearch,
  mapWithConcurrency,
  parallelResearch,
  RESEARCH_DOMAIN,
  withFallback,
  type ResearchFinding,
} from '../../integrations'
import { config } from '../../config'
import {
  clamp,
  clampChars,
  confidenceFromSources,
  confidenceRank,
  contentWords,
  demoteConfidence,
  normaliseTag,
  promoteConfidence,
  round,
} from '../corpus'
import { registerSkill } from '../runtime'
import type {
  CandidateEntry,
  GroundingEntry,
  KnowledgePayload,
  RawResearch,
  ResearchTarget,
} from '../skills/index'

/* ═══════════════════════════════════════════════════════════════════════════
   1 · knowledge.hashtag.select
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<KnowledgePayload>('knowledge.hashtag.select', async (_payload, ctx) => {
  const hashtagCount = ctx.num('hashtagCount', 25)
  const recencyDays = ctx.num('recencyDays', 5)
  const forceRefresh = ctx.bool('forceRefresh', false)

  const rows = await listHashtags(ctx.workspaceId, { top: true, limit: hashtagCount * 2 })
  const cutoff = Date.now() - recencyDays * 86_400_000

  const all: ResearchTarget[] = rows.map((row) => ({
    hashtagId: row.id,
    tag: row.tag,
    displayTag: row.display_tag,
    rank: row.rank ?? 999,
    lastResearchedAt: row.researched_at,
  }))

  const eligible = forceRefresh
    ? all
    : all.filter(
        (t) => t.lastResearchedAt === null || new Date(t.lastResearchedAt).getTime() < cutoff,
      )

  const targets = eligible
    .sort((a, b) => a.rank - b.rank)
    .slice(0, Math.max(1, hashtagCount))

  const skipped = all.length - eligible.length
  ctx.log(
    `${targets.length} hashtag(s) selected for research` +
      (skipped > 0
        ? ` · ${skipped} skipped, already researched within ${recencyDays} days`
        : '') +
      (forceRefresh ? ' · forced refresh' : ''),
  )

  if (targets.length === 0) {
    ctx.emit(
      'activity',
      `Every hashtag in the top set was researched within the last ${recencyDays} days. Switch on “Force refresh” to research them again.`,
      { status: 'warn' },
    )
  }

  return { targets }
})

/* ═══════════════════════════════════════════════════════════════════════════
   2 · knowledge.research.search
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<KnowledgePayload>('knowledge.research.search', async (payload, ctx) => {
  const targets = payload.targets ?? []
  if (targets.length === 0) return { raw: [], researchSource: 'fixture' as const }

  /**
   * Tier 2 of the research chain. When Parallel cannot answer, crawl4ai reads
   * the open web for the tag itself — real, citable pages instead of nothing.
   *
   * Every page captured for one hashtag becomes ONE finding rather than one
   * each, because the pages ARE the citations: `knowledge.research.extract`
   * discards any entry citing fewer than `minSources` independent URLs, and a
   * per-page finding could never clear that bar however many pages were read.
   * Grouping them makes the citation count mean what the rule assumes it means.
   */
  async function webResearch(tag: string, displayTag: string): Promise<ResearchFinding[]> {
    const rows = await crawl4aiSearch.run({
      // `#RewardModeling` is a tag, not a query. Split on the camel-case seams
      // so the engine sees the words a person would have typed.
      keyword: displayTag.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim(),
      maxItems: Math.min(maxResults, config.crawl4ai.maxPagesPerKeyword),
      maxCharsPerPage: config.crawl4ai.maxCharsPerPage,
    })
    if (rows.length === 0) return []
    return [
      {
        hashtag: tag,
        title: `Open-web reading on ${displayTag}`,
        // The bodies stay whole: the extract step is what trims and dedupes,
        // and trimming twice would cut a claim away from the sentence that
        // qualifies it.
        content: rows.map((r) => r.text).join('\n\n'),
        category: 'Research',
        citations: rows.map((r) => ({
          title: r.authorHeadline || r.sourceName,
          url: r.url,
          publishedAt: r.postedAt.slice(0, 10),
        })),
      },
    ]
  }

  const maxParallel = Math.max(1, ctx.num('maxParallel', 4))
  const windowDays = ctx.num('windowDays', 14)
  const processor = ctx.str('processor', 'base')
  const maxResults = ctx.num('maxResults', 10)
  const retries = ctx.num('retries', 2)

  const reasons: string[] = []
  let anyLive = false
  /** True once the open-web tier produced a citable reading for any hashtag. */
  let webServed = false

  const perTag = await mapWithConcurrency(targets, maxParallel, async (target) => {
    ctx.emit('activity', `Researching #${target.displayTag}`, {
      status: 'running',
      hashtag: target.displayTag,
    })

    const outcome = await withFallback(
      {
        ...parallelResearch,
        run: async (input) => {
          let lastError: unknown
          for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
              return await parallelResearch.run(input)
            } catch (error) {
              lastError = error
              if (attempt === retries) break
              await new Promise((r) => setTimeout(r, 500 * 2 ** attempt))
            }
          }
          throw lastError
        },
      },
      {
        hashtag: target.tag,
        domain: RESEARCH_DOMAIN,
        windowDays,
        processor,
        maxResults,
      },
      async () => {
        // A failure HERE is recorded and returns nothing. There is no third
        // tier: an uncited claim never enters the Knowledge Base, so "no
        // findings" is the correct answer, not a substituted one.
        try {
          const findings = await webResearch(target.tag, target.displayTag)
          if (findings.length > 0) webServed = true
          return findings
        } catch (error) {
          const reason =
            error instanceof AdapterError
              ? error.toReason()
              : `crawl4ai failed — ${error instanceof Error ? error.message : String(error)}`
          if (!reasons.includes(reason)) reasons.push(reason)
          return []
        }
      },
      (reason) => {
        if (!reasons.includes(reason)) reasons.push(reason)
      },
    )

    if (outcome.source === 'live') anyLive = true

    return outcome.value.map<RawResearch>((finding) => ({
      hashtag: target.displayTag,
      hashtagId: target.hashtagId,
      title: finding.title,
      content: finding.content,
      category: finding.category,
      citations: finding.citations,
    }))
  })

  const raw = perTag.flat()
  // A crawled page IS a live reading of the web, so a run served by tier 2 is
  // stamped live. `'fixture'` survives only as the storage value for "neither
  // tier answered", which now means the run found nothing rather than that it
  // invented something.
  const researchSource: 'live' | 'fixture' = anyLive || webServed ? 'live' : 'fixture'

  if (reasons.length > 0) {
    ctx.emit(
      'activity',
      webServed
        ? `Parallel did not serve every hashtag — ${reasons[0]}. Read the open web with ${crawl4aiSearch.label} instead.`
        : `Research found nothing citable — ${reasons[0]}`,
      { status: 'warn', reason: reasons[0], via: webServed ? crawl4aiSearch.id : 'none' },
    )
  }

  ctx.log(
    `${raw.length} raw finding(s) across ${targets.length} hashtag(s) via ` +
      (anyLive ? parallelResearch.label : webServed ? crawl4aiSearch.label : 'no reachable source'),
  )

  return {
    raw,
    researchSource,
    ...(reasons.length === 0 ? {} : { researchFallbackReason: reasons[0] as string }),
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · knowledge.research.extract
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<KnowledgePayload>('knowledge.research.extract', (payload, ctx) => {
  const minSources = ctx.num('minSources', 2)
  const maxChars = ctx.num('maxChars', 900)
  const maxPerHashtag = ctx.num('maxEntriesPerHashtag', 3)

  const raw = payload.raw ?? []
  const candidates: CandidateEntry[] = []
  const discarded: Array<{ title: string; reason: string }> = []
  const perHashtag = new Map<string, number>()

  for (const finding of raw) {
    // Independent sources only — two citations from the same domain are one
    // source wearing two URLs.
    const unique = dedupeCitations(finding.citations)

    if (unique.length < minSources) {
      discarded.push({
        title: finding.title,
        reason: `Only ${unique.length} independent source${unique.length === 1 ? '' : 's'} cited, below the ${minSources}-source minimum. An uncited claim does not enter the Knowledge Base.`,
      })
      continue
    }

    const used = perHashtag.get(finding.hashtag) ?? 0
    if (used >= maxPerHashtag) {
      discarded.push({
        title: finding.title,
        reason: `#${finding.hashtag} already produced ${used} entries this build, at the ${maxPerHashtag}-per-hashtag ceiling.`,
      })
      continue
    }

    candidates.push({
      hashtag: finding.hashtag,
      hashtagId: finding.hashtagId,
      title: finding.title,
      content: clampChars(finding.content, maxChars),
      category: finding.category || 'Research',
      confidence: confidenceFromSources(unique.length),
      sources: unique,
    })
    perHashtag.set(finding.hashtag, used + 1)
  }

  ctx.log(
    `${candidates.length} candidate entr${candidates.length === 1 ? 'y' : 'ies'} kept` +
      (discarded.length > 0 ? ` · ${discarded.length} discarded for thin citation` : ''),
  )

  return { candidates, discarded }
})

function dedupeCitations(
  citations: Array<{ title: string; url: string; publishedAt?: string }>,
): Array<{ title: string; url: string; publishedAt?: string }> {
  const byDomain = new Map<string, { title: string; url: string; publishedAt?: string }>()
  for (const citation of citations) {
    if (!citation.url) continue
    let domain = citation.url
    try {
      domain = new URL(citation.url).hostname.replace(/^www\./, '')
    } catch {
      domain = citation.url
    }
    if (!byDomain.has(domain)) byDomain.set(domain, citation)
  }
  return [...byDomain.values()]
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · knowledge.entry.upsert
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<KnowledgePayload>('knowledge.entry.upsert', async (payload, ctx) => {
  const dedupeThreshold = ctx.num('dedupeThreshold', 72) / 100
  const promoteOnMerge = ctx.bool('promoteOnMerge', true)

  const candidates = payload.candidates ?? []
  const existing = await listKnowledge(ctx.workspaceId, { activeOnly: true, limit: 500 })

  const written: Array<{ id: string; title: string; hashtag: string }> = []
  const merged: Array<{ id: string; title: string }> = []
  let sourcesCited = 0

  // A local mirror so two candidates inside one build cannot both insert the
  // same finding.
  const pool = existing.map((row) => ({ id: row.id, title: row.title, content: row.content }))

  for (const candidate of candidates) {
    const twin = pool
      .map((row) => ({
        row,
        score: Math.max(
          similarity(row.title, candidate.title),
          similarity(row.content, candidate.content) * 0.9,
        ),
      }))
      .sort((a, b) => b.score - a.score)[0]

    if (twin && twin.score >= dedupeThreshold) {
      // Merge: increment the evidence count, union the sources, promote the
      // confidence. Nothing is overwritten.
      await mergeKnowledgeEntry(twin.row.id, candidate.sources, promoteOnMerge)
      merged.push({ id: twin.row.id, title: twin.row.title })
      sourcesCited += candidate.sources.length
      continue
    }

    const inserted = await insertKnowledgeEntry({
      workspaceId: ctx.workspaceId,
      title: candidate.title,
      category: candidate.category,
      content: candidate.content,
      source: 'Parallel Web Systems research',
      sources: candidate.sources,
      hashtagId: candidate.hashtagId,
      confidence: candidate.confidence,
      origin: 'research',
      buildId: payload.buildId,
      tags: [normaliseTag(candidate.hashtag)],
    })

    if (!inserted) continue

    written.push({ id: inserted.id, title: candidate.title, hashtag: candidate.hashtag })
    sourcesCited += candidate.sources.length
    pool.push({ id: inserted.id, title: candidate.title, content: candidate.content })

    if (candidate.hashtagId) {
      await insertLineage({
        workspaceId: ctx.workspaceId,
        fromType: 'hashtag',
        fromId: candidate.hashtagId,
        toType: 'knowledge_entry',
        toId: inserted.id,
        agentId: 'knowledge',
      })
      await markHashtagResearched(ctx.workspaceId, candidate.hashtagId)
    }

    ctx.emit('knowledge.written', candidate.title, {
      id: inserted.id,
      hashtag: candidate.hashtag,
      confidence: candidate.confidence,
      sources: candidate.sources.length,
    })
  }

  ctx.log(
    `${written.length} entr${written.length === 1 ? 'y' : 'ies'} written, ${merged.length} merged, ${sourcesCited} source(s) cited`,
  )

  return { written, merged, sourcesCited }
})

/* ═══════════════════════════════════════════════════════════════════════════
   5 · knowledge.entry.retrieve — THE READ PATH EVERY AGENT USES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Scores an entry against a query. Term overlap on content words plus a title
 * bonus — deliberately simple, deliberately explainable, and good enough that
 * the caption agent is grounded in the right entries.
 */
export function scoreEntryAgainstQuery(entry: { title: string; content: string; tags: string[] }, query: string): number {
  const queryWords = new Set(contentWords(query))
  if (queryWords.size === 0) return 0

  const titleWords = contentWords(entry.title)
  const bodyWords = contentWords(entry.content)
  const tagWords = entry.tags.flatMap((t) => contentWords(t))

  let score = 0
  for (const word of titleWords) if (queryWords.has(word)) score += 8
  for (const word of tagWords) if (queryWords.has(word)) score += 6
  for (const word of bodyWords) if (queryWords.has(word)) score += 2

  const direct = similarity(entry.title, query) * 40
  return clamp(Math.round(score + direct), 0, 100)
}

export interface RetrieveOptions {
  /**
   * Include brand RULE entries. Off by default: grounding is for facts, and
   * the rules govern the writing rather than supplying its evidence.
   */
  includeRules?: boolean
  query: string
  maxResults: number
  includeInactive: boolean
  category?: string
  minConfidence?: number
}

/**
 * The single retrieval path. the command plane's `knowledge.search` tool, the caption
 * agent's grounding step and the review agent's compliance context all land
 * here, so what one sees is what the others see.
 */
export async function retrieveKnowledge(
  workspaceId: string,
  opts: RetrieveOptions,
): Promise<Array<KnowledgeEntryRow & { score: number }>> {
  const rows = await listKnowledge(workspaceId, {
    activeOnly: !opts.includeInactive,
    ...(opts.category === undefined ? {} : { category: opts.category }),
    /*
     * Rule 6 grounding is a factual question, and a compliance rule is not a
     * fact about the world. "Two human approvals before publication" is true of
     * how we ship, not of reward modelling, and offering it as grounding for a
     * claim about reward modelling both wastes a grounding slot and invites a
     * caption to cite the approval policy as evidence. The rules still govern
     * the writing — they arrive through the brand voice layer, which is where
     * they belong.
     */
    ...(opts.includeRules ? {} : { withoutTag: BRAND_RULE_TAG }),
    limit: 500,
  })

  const scored = rows
    .map((row) => ({ ...row, score: scoreEntryAgainstQuery(row, opts.query) }))
    .filter((row) => {
      if (opts.minConfidence !== undefined && confidenceRank(row.confidence) < opts.minConfidence) {
        return false
      }
      return true
    })

  // An empty query means "give me the strongest entries", not "give me nothing".
  const ordered =
    opts.query.trim().length === 0
      ? scored.sort((a, b) => confidenceRank(b.confidence) - confidenceRank(a.confidence))
      : scored
          .filter((row) => row.score > 0)
          .sort((a, b) => b.score - a.score || confidenceRank(b.confidence) - confidenceRank(a.confidence))

  return ordered.slice(0, Math.max(1, opts.maxResults))
}

/** Shapes a retrieved row as the grounding contract the caption agent reads. */
/**
 * Lines that are layout, not language.
 *
 * A corpus section extracted from a research PDF carries the document's
 * furniture along with its prose: code listings, figure and table labels,
 * running headers, page numbers, citation blocks. Handed to a caption writer as
 * grounding, that furniture is indistinguishable from a finding — so captions
 * came back quoting `import pandas as pd` and a conference venue line.
 *
 * Dropped here, at the one function that turns a stored row into grounding, so
 * every consumer — the caption writer, the review rewriter, the image brief —
 * sees the same cleaned text. The stored entry is untouched: this is a reading
 * filter, not an edit, and the Knowledge Base still shows the section as
 * captured.
 */
const LAYOUT_LINE =
  /^(?:\s*(?:\d+|[ivxlc]+)\s*$|\s*(?:figure|fig\.?|table|tbl\.?|algorithm|listing|appendix|eq\.?|equation)\s*\d|\s*(?:abstract|references|bibliography|acknowledge?ments|keywords|index terms|ccs concepts)\s*:?\s*$|\s*(?:copyright|©|permission to make digital)|\s*(?:arxiv|doi|isbn)\b)/i

const CODE_LINE =
  /(?:^\s*(?:import|from|def|class|return|const|let|var|function|package|public|private|#include|\$|>>>)\b|[{};]\s*$|=>|::|\w+\.\w+\(|^\s*[\w.]+\s*=\s*[^=]|_{2,})/

/** Keeps the sentences and drops the furniture. */
export function groundingProse(content: string): string {
  const kept = content
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => {
      if (line.length === 0) return false
      if (LAYOUT_LINE.test(line)) return false
      if (CODE_LINE.test(line)) return false
      // Prose is mostly letters and spaces; a table row or an equation is not.
      const prose = (line.match(/[a-z ]/gi) ?? []).length / line.length
      return prose >= 0.7
    })

  // If filtering took everything, the entry had no prose to offer. Returning the
  // original would reintroduce exactly what this exists to remove.
  return kept.join('\n')
}

export function toGroundingEntry(row: KnowledgeEntryRow): GroundingEntry {
  return {
    id: row.id,
    title: row.title,
    content: groundingProse(row.content),
    confidence: row.confidence,
    category: row.category,
    sources: row.sources,
  }
}

registerSkill<KnowledgePayload>('knowledge.entry.retrieve', async (payload, ctx) => {
  const maxResults = ctx.num('maxResults', 12)
  const includeInactive = ctx.bool('includeInactive', false)
  const query = typeof payload.query === 'string' ? payload.query : ''

  const entries = await retrieveKnowledge(ctx.workspaceId, { query, maxResults, includeInactive })

  ctx.log(
    `${entries.length} entr${entries.length === 1 ? 'y' : 'ies'} retrieved${query ? ` for “${query}”` : ' (strongest first)'}`,
  )

  return { retrieved: entries.map(toGroundingEntry) }
})

/* ═══════════════════════════════════════════════════════════════════════════
   6 · knowledge.entry.rank
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<KnowledgePayload>('knowledge.entry.rank', (payload, ctx) => {
  const confidenceWeight = ctx.num('confidenceWeight', 55) / 100
  const retrieved = (payload.retrieved as GroundingEntry[] | undefined) ?? []
  if (retrieved.length === 0) return {}

  const query = typeof payload.query === 'string' ? payload.query : ''

  const ranked = retrieved
    .map((entry) => ({
      entry,
      score:
        confidenceRank(entry.confidence) * confidenceWeight +
        scoreEntryAgainstQuery({ title: entry.title, content: entry.content, tags: [] }, query) *
          (1 - confidenceWeight),
    }))
    .sort((a, b) => b.score - a.score)
    .map((r) => r.entry)

  ctx.log(
    `${ranked.length} entr${ranked.length === 1 ? 'y' : 'ies'} ranked at ${Math.round(confidenceWeight * 100)}% confidence weight`,
  )

  return { retrieved: ranked }
})

/* ═══════════════════════════════════════════════════════════════════════════
   7 · knowledge.conflict.resolve
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<KnowledgePayload>('knowledge.conflict.resolve', async (_payload, ctx) => {
  const strategy = ctx.str('strategy', 'Newest wins')
  const conflictSimilarity = ctx.num('conflictSimilarity', 55) / 100

  const rows = await listKnowledge(ctx.workspaceId, { activeOnly: true, limit: 400 })

  const conflicts: Array<{ a: string; b: string; outcome: string }> = []
  let escalations = 0

  // Only within a category: two entries about different things are not in
  // conflict just because they share words.
  const byCategory = new Map<string, KnowledgeEntryRow[]>()
  for (const row of rows) {
    const list = byCategory.get(row.category) ?? []
    list.push(row)
    byCategory.set(row.category, list)
  }

  for (const group of byCategory.values()) {
    for (let i = 0; i < group.length; i += 1) {
      for (let j = i + 1; j < group.length; j += 1) {
        const a = group[i] as KnowledgeEntryRow
        const b = group[j] as KnowledgeEntryRow
        if (similarity(a.content, b.content) < conflictSimilarity) continue

        // A genuine conflict needs disagreeing numbers, not merely similar prose.
        const numbersA = extractNumbers(a.content)
        const numbersB = extractNumbers(b.content)
        const disagree =
          numbersA.length > 0 &&
          numbersB.length > 0 &&
          numbersA.some((n) => !numbersB.includes(n)) &&
          numbersB.some((n) => !numbersA.includes(n))
        if (!disagree) continue

        if (strategy === 'Escalate to human') {
          // A real queue row, not a flag: the human queue is where escalations
          // actually live.
          await insertReviewQueueRow({
            workspaceId: ctx.workspaceId,
            kind: 'knowledge_conflict',
            entityId: a.id,
            reason: `“${a.title}” and “${b.title}” disagree on a figure — ${numbersA.slice(0, 2).join(', ')} against ${numbersB.slice(0, 2).join(', ')}. Both are cited, so neither can be dismissed automatically.`,
            decisionRequested: 'Which entry should the agents trust?',
            options: [`Keep “${a.title}”`, `Keep “${b.title}”`, 'Keep both'],
          })
          conflicts.push({ a: a.title, b: b.title, outcome: 'Escalated to a human' })
          escalations += 1
          continue
        }

        if (strategy === 'Highest confidence wins') {
          const loser = confidenceRank(a.confidence) >= confidenceRank(b.confidence) ? b : a
          const winner = loser === a ? b : a
          await setKnowledgeConfidence(loser.id, demoteConfidence(loser.confidence))
          conflicts.push({
            a: a.title,
            b: b.title,
            outcome: `“${winner.title}” kept its confidence (${winner.confidence}); “${loser.title}” was demoted.`,
          })
          continue
        }

        // Newest wins.
        const older = new Date(a.created_at) <= new Date(b.created_at) ? a : b
        const newer = older === a ? b : a
        await setKnowledgeConfidence(older.id, demoteConfidence(older.confidence))
        conflicts.push({
          a: a.title,
          b: b.title,
          outcome: `“${newer.title}” is newer and kept its confidence; “${older.title}” was demoted rather than removed.`,
        })
      }
    }
  }

  ctx.log(
    conflicts.length === 0
      ? 'No conflicting figures among the active entries'
      : `${conflicts.length} conflict(s) resolved by “${strategy}”` +
          (escalations > 0 ? ` · ${escalations} escalated to a human` : ''),
  )

  return { conflicts, escalations }
})

function extractNumbers(text: string): string[] {
  const matches = text.match(/\d+(?:\.\d+)?%?/g)
  return matches ? [...new Set(matches)] : []
}

/* ═══════════════════════════════════════════════════════════════════════════
   8 · knowledge.priority.tag
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<KnowledgePayload>('knowledge.priority.tag', async (_payload, ctx) => {
  const priorityBoost = ctx.num('priorityBoost', 25)
  const demoteUntagged = ctx.bool('demoteUntagged', true)

  const rows = await listKnowledge(ctx.workspaceId, { activeOnly: true, limit: 500 })

  // Brand entries and compliance rules are the priority set: they are what the
  // agents must never drift from.
  const PRIORITY_ORIGINS = new Set(['brand'])
  const PRIORITY_CATEGORIES = new Set(['Brand Voice', 'Brand Guideline', 'Compliance Rule', 'Visual Identity'])

  const priorities: Record<string, number> = {}
  let boosted = 0
  let demoted = 0

  for (const row of rows) {
    const isPriority = PRIORITY_ORIGINS.has(row.origin) || PRIORITY_CATEGORIES.has(row.category)
    const base = confidenceRank(row.confidence)
    if (isPriority) {
      priorities[row.id] = clamp(round(base * (1 + priorityBoost / 100)), 0, 200)
      boosted += 1
    } else if (demoteUntagged) {
      priorities[row.id] = clamp(round(base * 0.6), 0, 200)
      demoted += 1
    } else {
      priorities[row.id] = base
    }
  }

  ctx.log(
    `${boosted} priority entr${boosted === 1 ? 'y' : 'ies'} boosted ${priorityBoost}%` +
      (demoteUntagged ? ` · ${demoted} untagged entries demoted 40%` : ''),
  )

  return { priorities }
})

/** Exposed for the Learning Agent, which promotes and demotes the same way. */
export { promoteConfidence, demoteConfidence }
export type { Confidence }

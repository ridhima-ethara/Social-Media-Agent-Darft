/**
 * KNOWLEDGE BASE CONNECTOR
 *
 * Typed access to memory. **No agent writes raw SQL** — every read and write
 * goes through here, so the active-entry filter, the citation requirement and
 * the ranking are applied once, in one place.
 *
 * The store itself is injected: the server binds a Postgres-backed one, the
 * browser binds an in-memory one over the bundled dataset. Neither caller
 * branches on which is bound.
 */

import type {
  Citation,
  Confidence,
  Connector,
  ConnectorHealth,
  MemoryEntry,
  MemoryQuery,
} from '../../contracts/src/index'
import { compareText, canonicalTag } from '../similarity/index'

/* ═══════════════════════════════════════════════════════════════════════════
   THE STORE INTERFACE — what a backing implementation must provide
   ═══════════════════════════════════════════════════════════════════════════ */

export interface MemoryStore {
  list(options: { activeOnly: boolean; limit: number }): Promise<MemoryEntry[]>
  insert(entry: Omit<MemoryEntry, 'id' | 'createdAt'>): Promise<MemoryEntry>
  update(id: string, patch: Partial<MemoryEntry>): Promise<MemoryEntry | null>
  setActive(id: string, active: boolean): Promise<MemoryEntry | null>
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE RULES THAT ARE ENFORCED HERE, NOT IN THE CALLER
   ═══════════════════════════════════════════════════════════════════════════ */

/** Minimum independent sources before a researched claim may be stored. */
export const MIN_SOURCES_DEFAULT = 2

/** At or above this Dice score, a candidate merges rather than inserts. */
export const DEDUPE_THRESHOLD_DEFAULT = 0.72

/**
 * Confidence derives from independent source count. It is never asserted by a
 * caller, because a caller that could assert it would eventually assert it
 * wrongly.
 */
export function deriveConfidence(independentSources: number): Confidence {
  if (independentSources >= 3) return 'High'
  if (independentSources === 2) return 'Medium'
  return 'Low'
}

export interface WriteRequest {
  title: string
  category: string
  content: string
  sources: Citation[]
  origin: MemoryEntry['origin']
  /** Overrides the default source floor. Never below one for research. */
  minSources?: number
  dedupeThreshold?: number
}

export type WriteOutcome =
  | { action: 'inserted'; entry: MemoryEntry }
  | { action: 'merged'; entry: MemoryEntry; mergedInto: string; reason: string }
  | { action: 'discarded'; reason: string }

/* ═══════════════════════════════════════════════════════════════════════════
   THE CONNECTOR
   ═══════════════════════════════════════════════════════════════════════════ */

export class KnowledgeConnector implements Connector {
  readonly id = 'kb'
  readonly label = 'Knowledge Base'

  constructor(private readonly store: MemoryStore) {}

  health(): ConnectorHealth {
    return {
      id: this.id,
      label: this.label,
      configured: true,
      reason: 'Backed by the bound memory store.',
      envKey: '',
    }
  }

  /**
   * The read path every agent uses.
   *
   * Inactive entries are never returned to a generation path — that is what
   * makes "switch an entry off and generation changes" a true statement rather
   * than a decorative toggle.
   */
  async retrieve(query: MemoryQuery): Promise<MemoryEntry[]> {
    const entries = await this.store.list({
      activeOnly: !query.includeInactive,
      limit: 400,
    })

    const words = query.topic
      .toLowerCase()
      .split(/\s+/)
      .filter((word) => word.length > 3)

    const scored = entries
      .filter((entry) =>
        query.categories && query.categories.length > 0
          ? query.categories.includes(entry.category)
          : true,
      )
      .map((entry) => {
        const haystack = `${entry.title} ${entry.content}`.toLowerCase()
        const overlap = words.filter((word) => haystack.includes(word)).length
        const topical = words.length === 0 ? 0 : overlap / words.length
        // Confidence and topical fit both matter; neither alone ranks well.
        const confidenceRank = entry.confidence === 'High' ? 1 : entry.confidence === 'Medium' ? 0.6 : 0.3
        return { entry, score: topical * 0.6 + confidenceRank * 0.4 }
      })
      .filter((row) => row.score > 0.2)
      .sort((a, b) => b.score - a.score)

    return scored.slice(0, query.limit ?? 12).map((row) => row.entry)
  }

  /**
   * The write path.
   *
   * An entry citing fewer than the source floor is **discarded**, not stored
   * with low confidence — an uncited claim in the store is a claim something
   * downstream will eventually ground on.
   */
  async write(request: WriteRequest): Promise<WriteOutcome> {
    const minSources = request.minSources ?? MIN_SOURCES_DEFAULT
    const threshold = request.dedupeThreshold ?? DEDUPE_THRESHOLD_DEFAULT

    const independent = countDomains(request.sources)

    // Brand and manual entries are definitional, not evidential.
    const needsCitation = request.origin === 'research' || request.origin === 'learned'
    if (needsCitation && independent < minSources) {
      return {
        action: 'discarded',
        reason: `"${request.title}" cites ${independent} independent source(s), below the floor of ${minSources}. An uncited claim never enters the store.`,
      }
    }

    const existing = await this.store.list({ activeOnly: true, limit: 400 })
    const sameCategory = existing.filter((entry) => entry.category === request.category)

    const comparison = compareText(
      `${request.title} ${request.content}`,
      sameCategory.map((entry) => ({ id: entry.id, text: `${entry.title} ${entry.content}` })),
      threshold,
    )

    // Merging is how the store gets more confident rather than merely longer.
    if (comparison.exceedsCap && comparison.matches[0]) {
      const target = sameCategory.find((entry) => entry.id === comparison.matches[0]?.againstId)
      if (target) {
        const unionSources = dedupeCitations([...target.sources, ...request.sources])
        const merged = await this.store.update(target.id, {
          sources: unionSources,
          evidenceCount: target.evidenceCount + 1,
          confidence: deriveConfidence(countDomains(unionSources)),
        })
        if (merged) {
          return {
            action: 'merged',
            entry: merged,
            mergedInto: target.id,
            reason: `Merged into "${target.title}" at ${comparison.highest.toFixed(2)} similarity. Evidence count is now ${merged.evidenceCount}.`,
          }
        }
      }
    }

    const entry = await this.store.insert({
      title: request.title,
      category: request.category,
      content: request.content,
      sources: request.sources,
      confidence: deriveConfidence(independent),
      evidenceCount: 1,
      active: true,
      origin: request.origin,
    })

    return { action: 'inserted', entry }
  }

  /** Deactivates. There is deliberately no delete path (Law 4). */
  async deactivate(id: string): Promise<MemoryEntry | null> {
    return this.store.setActive(id, false)
  }

  async reactivate(id: string): Promise<MemoryEntry | null> {
    return this.store.setActive(id, true)
  }

  /**
   * Raises confidence after repeated confirmation, lowers it after
   * contradiction. The demotion path is not optional: a store that only ever
   * gains confidence is a store that cannot be corrected.
   */
  async adjustConfidence(
    id: string,
    direction: 'confirm' | 'contradict',
  ): Promise<MemoryEntry | null> {
    const entries = await this.store.list({ activeOnly: false, limit: 400 })
    const entry = entries.find((e) => e.id === id)
    if (!entry) return null

    const order: Confidence[] = ['Low', 'Medium', 'High']
    const index = order.indexOf(entry.confidence)
    const next =
      direction === 'confirm'
        ? (order[Math.min(order.length - 1, index + 1)] as Confidence)
        : (order[Math.max(0, index - 1)] as Confidence)

    return this.store.update(id, {
      confidence: next,
      evidenceCount: direction === 'confirm' ? entry.evidenceCount + 1 : entry.evidenceCount,
    })
  }

  /** Entries that disagree, for the conflict-resolution path. */
  async findConflicts(threshold = 0.55): Promise<Array<{ a: MemoryEntry; b: MemoryEntry; score: number }>> {
    const entries = await this.store.list({ activeOnly: true, limit: 400 })
    const conflicts: Array<{ a: MemoryEntry; b: MemoryEntry; score: number }> = []

    for (let i = 0; i < entries.length; i += 1) {
      for (let j = i + 1; j < entries.length; j += 1) {
        const a = entries[i] as MemoryEntry
        const b = entries[j] as MemoryEntry
        if (a.category !== b.category) continue

        const result = compareText(`${a.title} ${a.content}`, [{ id: b.id, text: `${b.title} ${b.content}` }], threshold)
        // Similar enough to be about the same thing, different enough to disagree.
        if (result.highest >= threshold && result.highest < 0.9 && hasDivergentNumbers(a.content, b.content)) {
          conflicts.push({ a, b, score: result.highest })
        }
      }
    }

    return conflicts
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HELPERS
   ═══════════════════════════════════════════════════════════════════════════ */

function countDomains(citations: Citation[]): number {
  const domains = new Set<string>()
  for (const citation of citations) {
    try {
      domains.add(new URL(citation.url).hostname.replace(/^www\./, ''))
    } catch {
      domains.add(citation.url)
    }
  }
  return domains.size
}

function dedupeCitations(citations: Citation[]): Citation[] {
  const seen = new Set<string>()
  return citations.filter((citation) => {
    if (seen.has(citation.url)) return false
    seen.add(citation.url)
    return true
  })
}

/** Two entries about the same thing quoting different figures is the conflict. */
function hasDivergentNumbers(a: string, b: string): boolean {
  const numbersOf = (text: string): string[] => text.match(/\b\d+(?:\.\d+)?%?\b/g) ?? []
  const left = numbersOf(a)
  const right = numbersOf(b)
  if (left.length === 0 || right.length === 0) return false
  return left.some((n) => !right.includes(n)) && right.some((n) => !left.includes(n))
}

/** Re-exported so callers normalise tags through one implementation. */
export { canonicalTag }

/* ═══════════════════════════════════════════════════════════════════════════
   AN IN-MEMORY STORE — what the browser and the tests bind
   ═══════════════════════════════════════════════════════════════════════════ */

export function inMemoryStore(seed: MemoryEntry[] = []): MemoryStore {
  const entries = [...seed]
  let counter = 0

  return {
    async list({ activeOnly, limit }) {
      return entries.filter((entry) => (activeOnly ? entry.active : true)).slice(0, limit)
    },

    async insert(entry) {
      counter += 1
      const created: MemoryEntry = {
        ...entry,
        id: `kb-local-${counter}`,
        createdAt: new Date().toISOString(),
      }
      entries.unshift(created)
      return created
    },

    async update(id, patch) {
      const index = entries.findIndex((entry) => entry.id === id)
      if (index === -1) return null
      const updated = { ...(entries[index] as MemoryEntry), ...patch }
      entries[index] = updated
      return updated
    },

    async setActive(id, active) {
      return this.update(id, { active })
    },
  }
}

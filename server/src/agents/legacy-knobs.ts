/**
 * LEGACY KNOBS
 *
 * Law: one id, forever. A skill id is a storage key written into `agent_skills`
 * and `skill_runs`; renaming it orphans history.
 *
 * That law holds going forward, but a workspace may already carry override rows
 * written before a knob was renamed or a percentage was split into weights. This
 * module is the one place that translates such a row into the current vocabulary,
 * at read time only. Nothing here ever rewrites the stored row — the original
 * remains on disk exactly as it was written, so an old run stays explainable.
 *
 * Adding an entry is a deliberate act: the old key is recorded, not erased.
 */

import { SKILL_BY_ID } from '../../../shared/agent-registry'
import type { ConfigValue } from '../../../shared/agent-contract'

/* ═══════════════════════════════════════════════════════════════════════════
   KEY ALIASES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `skillId → { storedKey: currentKey }`.
 *
 * A `'*'` skill id applies to every skill, for knobs that were renamed
 * consistently across the registry.
 */
const KEY_ALIASES: Record<string, Record<string, string>> = {
  '*': {
    // The registry settled on `retries` everywhere rather than a per-skill name.
    maxRetries: 'retries',
    retryCount: 'retries',
    // Timeouts carry their unit in the key.
    timeout: 'timeoutMs',
    stepTimeout: 'stepTimeoutMs',
    concurrency: 'maxParallel',
  },
  'scraping.linkedin.fetch': {
    // Was a bare count before the per-keyword scope was made explicit.
    maxItems: 'maxItemsPerKeyword',
    dateRange: 'datePosted',
  },
  'validation.keyword.trend': {
    // Was `topN` while there was only one "top" in the product.
    topN: 'topKeywords',
    window: 'trendWindowRuns',
  },
  'validation.hashtag.rank': {
    topHashtags: 'topHashtagsPerKeyword',
    halfLife: 'freshnessHalfLifeHours',
  },
  'validation.duplicate.detect': {
    threshold: 'similarityThreshold',
    windowDays: 'compareWindow',
  },
  'analysis.hashtag.consolidate': {
    topSet: 'topHashtags',
  },
  'calendar.rank.select': {
    topPerPlatformPerWeek: 'topPerPlatform',
  },
  'knowledge.hashtag.select': {
    count: 'hashtagCount',
  },
  'knowledge.entry.upsert': {
    mergeThreshold: 'dedupeThreshold',
  },
  'generation.image.render': {
    imageModel: 'model',
  },
  'jarvis.intent.parse': {
    confidenceThreshold: 'clarifyThreshold',
  },
  'jarvis.plan.compose': {
    maxPlanSteps: 'maxSteps',
  },
  'jarvis.confirm.gate': {
    ttl: 'ttlSeconds',
  },
}

/* ═══════════════════════════════════════════════════════════════════════════
   VALUE ALIASES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * `skillId → key → { storedValue: currentValue }`.
 * Enum options that were relabelled for the operator keep working.
 */
const VALUE_ALIASES: Record<string, Record<string, Record<string, string>>> = {
  'scraping.linkedin.fetch': {
    datePosted: {
      '24h': 'past-24h',
      day: 'past-24h',
      week: 'past-week',
      month: 'past-month',
    },
  },
  'scraping.competitor.track': {
    tier: {
      p0: 'P0 only',
      'p0+p1': 'P0+P1',
      all: 'All',
    },
  },
  'knowledge.conflict.resolve': {
    strategy: {
      newest: 'Newest wins',
      confidence: 'Highest confidence wins',
      escalate: 'Escalate to human',
    },
  },
  'analytics.baseline.compute': {
    measure: { mean: 'Mean', median: 'Median' },
  },
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRANSLATION
   ═══════════════════════════════════════════════════════════════════════════ */

export interface MigrationNote {
  skillId: string
  from: string
  to: string
}

export interface MigratedConfig {
  config: Record<string, ConfigValue>
  notes: MigrationNote[]
  /** Keys that match no current field. Kept out of the resolved config. */
  dropped: string[]
}

/**
 * Translates one stored override row into the current knob vocabulary.
 *
 * Unknown keys are dropped rather than passed through, because an unknown key
 * would be silently ignored by the handler and look like a knob that does
 * nothing. `dropped` is reported so the Studio can say so out loud.
 */
export function migrateStoredConfig(
  skillId: string,
  stored: Record<string, unknown>,
): MigratedConfig {
  const spec = SKILL_BY_ID[skillId]
  const notes: MigrationNote[] = []
  const dropped: string[] = []
  const config: Record<string, ConfigValue> = {}

  if (!spec) {
    // A skill that no longer exists: keep nothing, but say what was there.
    return { config, notes, dropped: Object.keys(stored) }
  }

  const validKeys = new Set(spec.config.map((f) => f.key))
  const perSkill = KEY_ALIASES[skillId] ?? {}
  const global = KEY_ALIASES['*'] ?? {}

  for (const [storedKey, rawValue] of Object.entries(stored)) {
    let key = storedKey
    if (!validKeys.has(key)) {
      const aliased = perSkill[key] ?? global[key]
      if (aliased && validKeys.has(aliased)) {
        key = aliased
        notes.push({ skillId, from: storedKey, to: aliased })
      } else {
        dropped.push(storedKey)
        continue
      }
    }

    let value = rawValue as ConfigValue
    const valueMap = VALUE_ALIASES[skillId]?.[key]
    if (valueMap && typeof value === 'string') {
      const mapped = valueMap[value.toLowerCase()]
      if (mapped !== undefined && mapped !== value) {
        notes.push({ skillId, from: `${key}=${value}`, to: `${key}=${mapped}` })
        value = mapped
      }
    }

    config[key] = value
  }

  return { config, notes, dropped }
}

/** True when this stored row would change shape on read — the Studio flags it. */
export function needsMigration(skillId: string, stored: Record<string, unknown>): boolean {
  const result = migrateStoredConfig(skillId, stored)
  return result.notes.length > 0 || result.dropped.length > 0
}

/**
 * Topic detection — computed, configurable, never judged by a model for posts.
 *
 * The categories and their keywords live in `topics.config.json` (edit that,
 * not this). A post carries every topic whose keyword appears as a whole word
 * in its text or hashtags; nothing matching is `Other`. Comments are topic-
 * tagged by Claude from the SAME list, so the two agree on vocabulary.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

const HERE = dirname(fileURLToPath(import.meta.url))

const topicFileSchema = z.object({
  topics: z.array(z.object({ topic: z.string().min(1), keywords: z.array(z.string().min(1)).min(1) })).min(1),
})

export const OTHER_TOPIC = 'Other'

export interface TopicRule {
  topic: string
  patterns: RegExp[]
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

export function loadTopicRules(path: string = join(HERE, 'topics.config.json')): TopicRule[] {
  const parsed = topicFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')))
  return parsed.topics.map((t) => ({
    topic: t.topic,
    patterns: t.keywords.map((k) => new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegex(k.toLowerCase())}($|[^\\p{L}\\p{N}])`, 'u')),
  }))
}

/** Every category name, `Other` last — the list Claude must choose comment topics from. */
export function topicNames(rules: readonly TopicRule[]): string[] {
  return [...rules.map((r) => r.topic), OTHER_TOPIC]
}

/** Unicode "mathematical bold" and friends → plain letters, so styled posts still match. */
export function plainText(text: string): string {
  return text.normalize('NFKC').toLowerCase()
}

export function topicsFor(text: string, hashtags: readonly string[], rules: readonly TopicRule[]): string[] {
  const haystack = ` ${plainText(`${text} ${hashtags.map((h) => h.replace(/^#/, '')).join(' ')}`)} `
  const hits = rules.filter((r) => r.patterns.some((p) => p.test(haystack))).map((r) => r.topic)
  return hits.length > 0 ? hits : [OTHER_TOPIC]
}

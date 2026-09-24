/**
 * A platform's source with a stand-in: the primary adapter answers when it can;
 * when it is unavailable (no key, no search for this platform) or its searches
 * all fail (e.g. SocialFetch out of credits), the fallback adapter answers
 * instead. The batch outcome names which source answered, so the platform's
 * report never hides it.
 */

import type { BatchOutcome, SearchRequest, TrendSourceAdapter } from './source-types'

export function withFallback(primary: TrendSourceAdapter, fallback: TrendSourceAdapter): TrendSourceAdapter {
  const primaryUp = (): boolean => primary.availability().available
  return {
    id: primary.id,
    label: `${primary.label} (falls back to ${fallback.label})`,
    kind: primary.kind,
    platform: primary.platform,
    availability() {
      const p = primary.availability()
      return p.available ? p : fallback.availability()
    },
    search_topics: (req) => (primaryUp() ? primary : fallback).search_topics(req),
    search_posts: (req) => (primaryUp() ? primary : fallback).search_posts(req),
    search_hashtags: (req) => (primaryUp() ? primary : fallback).search_hashtags(req),
    get_post: (url) => (primaryUp() ? primary : fallback).get_post(url),
    async searchBatch(reqs: SearchRequest[]): Promise<BatchOutcome> {
      const run = async (a: TrendSourceAdapter): Promise<BatchOutcome> => {
        if (a.searchBatch) return a.searchBatch(reqs)
        const out: BatchOutcome = { candidates: [], executed: [], errors: [] }
        for (const req of reqs) {
          out.candidates.push(...(await a.search_posts(req)))
          out.executed.push(req.query.text)
        }
        return out
      }
      const p = primary.availability()
      if (!p.available) {
        const f = await run(fallback)
        return { ...f, errors: [`${primary.label} unavailable (${p.reason}); ${fallback.label} answered instead.`, ...f.errors] }
      }
      const first = await run(primary)
      if (first.candidates.length > 0 || first.errors.length === 0) return first
      // Every search failed (credits, network): the fallback answers.
      const f = await run(fallback)
      return {
        ...f,
        errors: [`${primary.label} failed (${first.errors[0]}); ${fallback.label} answered instead.`, ...f.errors],
      }
    },
  }
}

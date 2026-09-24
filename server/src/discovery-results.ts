/**
 * DISCOVERY RESULTS — what the operator is shown once scraping and validation
 * are done.
 *
 *   Knowledge Base + Brand Voice + Keywords → Claude Bridge
 *     → LinkedIn | Instagram | Facebook | X → Scraping Agent → Validation Agent
 *     → Topic + Date + Hashtags + Post URL + Platform   ← this module
 *
 * A pure join, computed never judged: each captured post keeps the date the
 * bridge decoded from its post id, the hashtags it wrote, its URL and platform;
 * its topic, matched keyword and trend reason come from the platform trend it
 * belongs to; its verdict is the Validation Agent's, read, not re-made. Rows are
 * newest first. Nothing is invented for a post the bridge did not return.
 */

import type { PipelinePayload } from './agents/skills/index'
import { PLATFORM_LABEL } from './agents/corpus'
import { localIsoDate } from '../../shared/calendar-horizon'

export type DiscoveryVerdict = 'validated' | 'needs_review' | 'duplicate' | 'rejected' | 'pending'

export interface DiscoveryResultRow {
  /** The source platform, by label ("LinkedIn"). */
  platform: string
  platformId: string | null
  topic: string
  /** The post's own title or opening line, as the search result showed it. */
  title: string
  /** The account that posted it — the handle the post URL carries, else the stated author. */
  account: string | null
  /** Kept as related to Ethara's field (brand topics / Knowledge Base) without naming a keyword. */
  related: boolean
  /** Its hashtags Ethara did not track yet — learned into the Knowledge Base after validation. */
  newHashtags: string[]
  /** What the source stated; null when it stated none (a web search result). Never zeros for "unknown". */
  engagement: { reactions: number; comments: number; reposts: number; views: number | null } | null
  /** Decoded from the platform's own post id — never the capture time. */
  publishedAt: string
  /**
   * `today` — published on the current date (workspace time zone); `earlier` —
   * inside the window; `older` — before the window, listed only because the
   * platform had nothing newer indexed.
   */
  period: 'today' | 'earlier' | 'older'
  hashtags: string[]
  url: string
  matchedKeyword: string
  /** The trend's computed reason, naming its evidence. */
  reason: string
  validation: DiscoveryVerdict
  verdictReason: string
}

export interface DiscoveryResults {
  runId: string
  generatedAt: string
  /** The current date the rows were split against. */
  today: string
  rows: DiscoveryResultRow[]
  counts: Record<DiscoveryVerdict, number> & { total: number }
}

function periodOrder(p: DiscoveryResultRow['period']): number {
  return p === 'today' ? 0 : p === 'earlier' ? 1 : 2
}

export function buildDiscoveryResults(
  runId: string,
  payload: Pick<PipelinePayload, 'posts' | 'platformTrends'>,
  now: Date = new Date(),
  timeZone?: string,
): DiscoveryResults {
  const today = localIsoDate(now, timeZone)
  // Every post URL a platform trend holds → that trend, so a post carries its topic and reason.
  const trendByUrl = new Map<
    string,
    { trend: string; reason: string; keywords: string[]; period: 'today' | 'earlier' | 'older'; author: string | null; related: boolean; newHashtags: string[] }
  >()
  for (const trend of payload.platformTrends ?? []) {
    for (const post of trend.posts) {
      if (!trendByUrl.has(post.url)) {
        trendByUrl.set(post.url, {
          trend: trend.trend,
          reason: trend.reason,
          keywords: trend.matchedEtharaKeywords,
          period: post.period,
          author: post.author,
          related: trend.related,
          newHashtags: trend.newHashtags,
        })
      }
    }
  }

  const rows: DiscoveryResultRow[] = (payload.posts ?? [])
    .filter((post) => typeof post.url === 'string' && post.url !== '' && typeof post.postedAt === 'string' && post.postedAt !== '')
    .map((post) => {
      const trend = trendByUrl.get(post.url)
      const verdict = (post.validation ?? 'pending') as DiscoveryVerdict
      return {
        platform: post.platform ? PLATFORM_LABEL[post.platform] : 'Open web',
        platformId: post.platform ?? null,
        topic: trend?.trend ?? post.keyword,
        title: (post.title ?? '').replace(/^\s*\|\s*/, '').trim(),
        account: trend?.author ?? post.authorName ?? null,
        related: trend?.related ?? false,
        newHashtags: (() => {
          const fresh = new Set((trend?.newHashtags ?? []).map((t) => t.toLowerCase().replace(/^#/, '')))
          return [...new Set(post.hashtags ?? [])].filter((h) => fresh.has(h.toLowerCase().replace(/^#/, '')))
        })(),
        engagement: post.metricsAvailable
          ? { reactions: post.reactions, comments: post.comments, reposts: post.reposts, views: post.viewsAvailable ? post.views : null }
          : null,
        publishedAt: post.postedAt,
        // The bridge's own label wins (it knows the window); otherwise judged on the date.
        period: trend?.period ?? (localIsoDate(new Date(post.postedAt), timeZone) === today ? 'today' : 'earlier'),
        hashtags: [...new Set(post.hashtags ?? [])],
        url: post.url,
        matchedKeyword: post.keyword || trend?.keywords[0] || '',
        reason: trend?.reason ?? `Mentions the Ethara keyword “${post.keyword}”.`,
        validation: verdict,
        verdictReason: post.verdictReason ?? '',
      }
    })
    // Today's first, then the rest of the window, then older; newest first within each.
    .sort((a, b) => periodOrder(a.period) - periodOrder(b.period) || b.publishedAt.localeCompare(a.publishedAt))

  const counts = { total: rows.length, validated: 0, needs_review: 0, duplicate: 0, rejected: 0, pending: 0 }
  for (const row of rows) counts[row.validation] += 1

  return { runId, generatedAt: now.toISOString(), today, rows, counts }
}

/**
 * EVERY SCRAPING AGENT LANE, SERVED BY THE CLAUDE BRIDGE.
 *
 * This is the one seam between the bridge and the existing pipeline. It
 * implements the capture contract the Scraping Agent already consumes
 * (`CaptureSource` → `RawPost[]`, see `integrations/capture.ts`), so the
 * agent, the Validation Agent and everything after them see the same shapes
 * they always did — only the acquisition underneath changed.
 *
 * PER CALL: one keyword on one lane. The bridge loads the SMA's Knowledge Base,
 * brand voice and keyword configuration, builds that keyword's discovery
 * queries, runs them through `acquisition.scraping_agent_adapters` (Claude
 * Code's web search by default), and hands back the dated, de-duplicated,
 * in-window posts newest first.
 *
 * WHAT A ROW STATES, AND WHAT IT DOES NOT.
 *   · `postedAt` is always a verified date (decoded from the post id or stated
 *     by the source). The contract has no "unknown" for it, so an undated post
 *     is left out and counted — never given a date.
 *   · `metricsAvailable` is true only when a source stated engagement; a web
 *     search states none, so live rows carry `false` and the Validation Agent
 *     excludes them from engagement maths as it already does.
 *   · `text` is what the source showed (for a web search, the result title).
 *
 * FIVE LANES, ONE BRIDGE. LinkedIn, Instagram, X and Facebook each have a
 * platform module, and the open web (`platform === undefined` in the capture
 * contract) is the bridge's `web` module. No other scraping service sits behind
 * any lane. A lane whose module or adapter cannot run reports that, and the
 * Scraping Agent skips it once at the top of the run.
 *
 * FACEBOOK NOTE. Facebook post ids carry no date, so a Facebook post found by
 * search is undated and — because `RawPost.postedAt` cannot be unknown — is
 * counted and left out here. The lane runs; it only contributes posts whose
 * date a source states.
 */

import type { Platform } from '../../../../shared/agent-contract'
import { AdapterError, NothingInWindowError } from '../../integrations/adapter'
import type { CaptureInput, CaptureSource, RawPost } from '../../integrations/capture'
import { createAdapter } from './adapters/linkedin-source-adapter'
import { loadBridgeConfig } from './config'
import { runTrendIntelligence } from './pipeline'
import { platformModule } from './platforms'
import type { TrendIntelligenceOutput, TrendResult } from './schemas/trend-output'

/** Rolling windows in days. `current-month` is the calendar month so far, computed at call time. */
const WINDOW_DAYS: Record<Exclude<CaptureInput['datePosted'], 'current-month'>, number> = {
  'past-24h': 1,
  'past-48h': 2,
  'past-week': 7,
  'past-month': 30,
  'past-quarter': 90,
}

/** The bridge module id for a capture lane: the platform, or `web` for the open web. */
function laneId(platform: Platform | undefined): string {
  return platform ?? 'web'
}

/** Why the bridge cannot serve a lane, or `''` when it can. */
export function bridgeUnavailableReason(platform: Platform | undefined): string {
  const module = platformModule(laneId(platform))
  if (module === undefined) {
    return (
      `The Claude Bridge has no ${laneId(platform)} module, so this lane cannot run. ` +
      'Platform modules live in server/src/bridges/claude-bridge/platforms/.'
    )
  }
  let cfg
  try {
    cfg = loadBridgeConfig()
  } catch (error) {
    return error instanceof Error ? error.message : String(error)
  }
  const reasons: string[] = []
  const available: string[] = []
  for (const id of cfg.acquisition.scraping_agent_adapters) {
    const availability = createAdapter(id, { platform: module, config: cfg }).availability()
    if (availability.available) available.push(id)
    else reasons.push(availability.reason)
  }
  if (available.length === 0) return `No Claude Bridge acquisition adapter can run: ${reasons.join(' ')}`

  /*
   * A lane that can never yield a dated row is skipped, not run for nothing.
   * Capture requires a date; a platform whose search results cannot be dated
   * (Facebook) only contributes when a source that states dates — an operator's
   * URL file — is configured.
   */
  if (!module.canDateItems && !available.includes('manual_urls')) {
    return (
      `${module.label} post ids carry no date and a web search states none, so this lane cannot supply ` +
      'the dated posts capture requires. It is skipped rather than spending searches. Supply dated posts ' +
      'with LINKEDIN_TRENDS_MANUAL_URLS_FILE, or ask the Claude Code tool, which shows them as undated.'
    )
  }
  return ''
}

/** A bridge result in the capture contract. Returns `null` for an undated result. */
export function toRawPost(
  result: TrendResult,
  keyword: string,
  platform: Platform | undefined,
  sourceName: string,
): RawPost | null {
  if (result.published_at === null || result.post_url === null) return null
  const e = result.engagement
  /*
   * The author: a stated name when the bridge collects them
   * (`include_author_names`), else the public handle the post URL itself
   * carries. The Scraping Agent counts distinct voices by author; without this
   * every LinkedIn row would share the host `linkedin.com` and count as one.
   */
  const handle = platformModule(laneId(platform))?.authorHandleFromUrl(result.post_url) ?? null
  return {
    externalId: result.post_url,
    text: result.snippet ?? '',
    authorName: result.author ?? (handle === null ? '' : `@${handle}`),
    authorHeadline: '',
    authorFollowers: 0,
    url: result.post_url,
    postedAt: result.published_at,
    // Zero here means "not applicable" — `metricsAvailable` says which.
    reactions: e?.reactions ?? 0,
    comments: e?.comments ?? 0,
    reposts: e?.reposts ?? 0,
    views: 0,
    viewsAvailable: false,
    hashtags: result.hashtags.map((h) => h.replace(/^#/, '')),
    keyword,
    sourceName,
    platform: platform ?? null,
    metricsAvailable: result.engagement_available,
  }
}

function summarise(out: TrendIntelligenceOutput): string {
  const d = out.diagnostics
  const problems = out.adapters.filter((a) => a.reason && a.status !== 'skipped').map((a) => `${a.label}: ${a.reason}`)
  // The "freshest was published …" note, when there is one — the fact that
  // explains an empty window.
  const freshest = d.notes.find((n) => n.startsWith('Every dated post found was older'))
  return (
    `${d.candidates_found} found, ${d.invalid_removed} not posts, ${d.duplicates_removed} duplicates, ` +
    `${d.stale_results_removed} older than the window, ${d.undated_results} undated` +
    (freshest ? `. ${freshest.split(' Public search')[0]}` : '') +
    (problems.length > 0 ? ` — ${problems.join(' · ')}` : '')
  )
}

export function claudeBridgeCapture(platform: Platform | undefined): CaptureSource {
  const id = laneId(platform)
  const name = platformModule(id)?.label ?? id
  const label = `Claude Bridge · ${name} (Claude Code web search)`
  const sourceName = `Claude Bridge · ${name}`

  return {
    id: `claude-bridge.${id}`,
    label,

    isConfigured(): boolean {
      return bridgeUnavailableReason(platform) === ''
    },

    unavailableReason(): string {
      return bridgeUnavailableReason(platform)
    },

    async run(input: CaptureInput): Promise<RawPost[]> {
      const reason = bridgeUnavailableReason(platform)
      const module = platformModule(id)
      if (reason !== '' || module === undefined) throw new AdapterError(`claude-bridge.${id}`, reason)

      const now = new Date()
      const from =
        input.datePosted === 'current-month'
          ? new Date(now.getFullYear(), now.getMonth(), 1)
          : new Date(now.getTime() - WINDOW_DAYS[input.datePosted] * 86_400_000)
      const base = loadBridgeConfig()

      const out = await runTrendIntelligence({
        mode: 'scraping_agent',
        now,
        // One call per keyword per lane: a tighter per-keyword budget than a
        // whole-brand trend question, so a run across five lanes stays bounded.
        config: { ...base, max_queries_per_keyword: base.acquisition.scraping_agent.max_queries_per_keyword },
        input: {
          platform: module.id,
          keywords: [input.keyword],
          date_from: from.toISOString(),
          date_to: now.toISOString(),
          max_results: Math.min(100, Math.max(1, input.maxItems)),
          // The Scraping Agent applies its own brand-alignment gate to every
          // row; filtering here as well would apply two thresholds to one fact.
          min_brand_relevance: 'low',
        },
      })

      if (out.status === 'configuration_error') {
        throw new AdapterError(`claude-bridge.${id}`, out.error ?? 'the bridge reported a configuration error')
      }
      if (out.source_status === 'unavailable') {
        throw new AdapterError(`claude-bridge.${id}`, `no source could run — ${summarise(out)}`)
      }

      const rows = out.results
        .map((r) => toRawPost(r, input.keyword, platform, sourceName))
        .filter((r): r is RawPost => r !== null)
      const undated = out.results.length - rows.length
      if (rows.length === 0) {
        // Not a failure — the source answered and had nothing dated in the
        // window. Raised (not returned empty) so the run reports WHY per lane;
        // typed so the Scraping Agent does not retry it.
        throw new NothingInWindowError(
          `claude-bridge.${id}`,
          `nothing dated within ${input.datePosted} for “${input.keyword}” (${summarise(out)})`,
        )
      }
      if (undated > 0) {
        console.warn(`  · Claude Bridge · ${name} · ${input.keyword}: ${undated} undated item(s) left out (${summarise(out)})`)
      }
      return rows
    },
  }
}

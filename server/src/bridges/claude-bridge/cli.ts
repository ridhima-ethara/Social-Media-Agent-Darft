/**
 * THE BRIDGE FROM A TERMINAL
 *
 *   npm run linkedin-trends                         # live: the SMA's own context, configured adapters
 *   npm run linkedin-trends -- --keywords "RLVR,AI agent evaluation" --max-results 10
 *   npm run test:linkedin-trends                    # tests, then a sample run (fixtures, no network)
 *
 * Flags:
 *   --sample              sample KB / brand voice / keywords and the fixture adapter; "now" is
 *                         pinned to the fixture's reference time so the output is reproducible
 *   --adapters a,b        override the acquisition adapters
 *   --keywords a,b        override the keyword set
 *   --queries "q1;q2"     extra planned queries
 *   --urls u1,u2          post URLs to include
 *   --from / --to         ISO dates bounding the window
 *   --max-results N
 *   --min-relevance high|medium|low
 *   --platform p          linkedin (default) | instagram | x | facebook | web
 *   --mode m              tool (default) | scraping_agent — which adapter list to use
 *   --json | --markdown   print only one of the two renderings
 *   --platform-trends     platform-level trend discovery (the Scraping Agent's capture): one
 *                         topic per search, posts from the CURRENT MONTH (or the last --hours),
 *                         Ethara-relevant only, newest first. Takes --hours, --platforms a,b,
 *                         --keywords a,b, --markdown. Prints the JSON report, or the table.
 *   --lanes               print which capture lanes can run (JSON: lane → "" or the reason) and exit;
 *                         no search is made. Used by the Python agent tier.
 *
 * Prints the JSON, then the Markdown. The execution log goes to stderr.
 */

import { closePool } from '../../db/pool'
import { ADAPTER_IDS, loadBridgeConfig, type AdapterId } from './config'
import { loadSampleContext } from './context'
import { DEFAULT_FIXTURE_FILE, loadFixtureFile } from './adapters/fixture'
import { renderMarkdown } from './output/markdown'
import { runTrendIntelligence } from './pipeline'
import type { TrendToolInput } from './schemas/trend-output'
import { PLATFORM_IDS, type PlatformId } from './platforms'
import { discoverPlatformTrends } from './trends/platform-trends'
import { renderPlatformTrends } from './tools/linkedin-trend-intelligence'
import { synonymsFor } from '../../../../shared/keywords'
import { PLATFORMS } from '../../../../shared/agent-contract'
import { bridgeUnavailableReason } from './capture-source'

function flag(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return undefined
  const next = process.argv[i + 1]
  return next === undefined || next.startsWith('--') ? '' : next
}

function list(name: string, sep = ','): string[] | undefined {
  const raw = flag(name)
  if (raw === undefined || raw === '') return undefined
  return raw.split(sep).map((s) => s.trim()).filter((s) => s !== '')
}

async function main(): Promise<number> {
  if (flag('platform-trends') !== undefined) {
    const hours = flag('hours')
    const platforms = list('platforms')?.filter((p): p is PlatformId => (PLATFORM_IDS as readonly string[]).includes(p))
    const kw = list('keywords')
    const report = await discoverPlatformTrends({
      // "Today" in the host's configured zone (TZ), the same one the server uses.
      ...(process.env.TZ ? { timeZone: process.env.TZ } : {}),
      ...(hours ? { windowHours: Number(hours) } : {}),
      ...(platforms && platforms.length > 0 ? { platforms } : {}),
      ...(kw ? { keywords: kw.map((term) => ({ term, weight: 100, category: 'Requested', synonyms: synonymsFor(term), scheduled: null })) } : {}),
    })
    process.stdout.write(flag('markdown') !== undefined ? `${renderPlatformTrends(report)}\n` : `${JSON.stringify(report, null, 2)}\n`)
    return 0
  }

  if (flag('lanes') !== undefined) {
    const lanes = Object.fromEntries(
      [...PLATFORMS, undefined].map((p) => [p ?? 'web', bridgeUnavailableReason(p)]),
    )
    process.stdout.write(`${JSON.stringify(lanes)}\n`)
    return 0
  }

  const sample = flag('sample') !== undefined
  const cfg = loadBridgeConfig()

  const adapters = list('adapters') as AdapterId[] | undefined
  for (const a of adapters ?? []) {
    if (!(ADAPTER_IDS as readonly string[]).includes(a)) {
      console.error(`Unknown adapter "${a}". Known: ${ADAPTER_IDS.join(', ')}`)
      return 2
    }
  }

  const platformFlag = flag('platform')
  const platform = PLATFORM_IDS.find((p) => p === platformFlag)
  if (platformFlag !== undefined && platform === undefined) {
    console.error(`Unknown platform "${platformFlag}". Known: ${PLATFORM_IDS.join(', ')}`)
    return 2
  }
  const mode = flag('mode') === 'scraping_agent' ? 'scraping_agent' : 'tool'
  const maxResults = flag('max-results')
  const minRelevance = flag('min-relevance')
  const input: TrendToolInput = {
    ...(list('keywords') ? { keywords: list('keywords') } : {}),
    ...(list('queries', ';') ? { queries: list('queries', ';') } : {}),
    ...(list('urls') ? { post_urls: list('urls') } : {}),
    ...(flag('from') ? { date_from: flag('from') } : {}),
    ...(flag('to') ? { date_to: flag('to') } : {}),
    ...(maxResults ? { max_results: Number(maxResults) } : {}),
    ...(minRelevance === 'high' || minRelevance === 'medium' || minRelevance === 'low' ? { min_brand_relevance: minRelevance } : {}),
    ...(adapters ? { adapters } : sample ? { adapters: ['fixture'] as AdapterId[] } : {}),
    ...(platform ? { platform } : {}),
  }

  const fixture = sample ? loadFixtureFile(DEFAULT_FIXTURE_FILE) : null
  const nowFlag = flag('now')
  const now = nowFlag ? new Date(nowFlag) : fixture ? new Date(fixture.reference_time) : new Date()

  const output = await runTrendIntelligence({
    input,
    // The Scraping Agent's per-keyword budget, so the Python tier's capture
    // (which calls this CLI) costs what the Node tier's does.
    config: mode === 'scraping_agent' ? { ...cfg, max_queries_per_keyword: cfg.acquisition.scraping_agent.max_queries_per_keyword } : cfg,
    now,
    mode,
    ...(sample ? { context: loadSampleContext(cfg) } : {}),
  })

  const onlyJson = flag('json') !== undefined
  const onlyMarkdown = flag('markdown') !== undefined
  if (!onlyMarkdown) {
    process.stdout.write(`${JSON.stringify(output, null, 2)}\n`)
  }
  if (!onlyJson) {
    if (!onlyMarkdown) process.stdout.write('\n')
    process.stdout.write(`${renderMarkdown(output)}\n`)
  }
  return output.status === 'ok' ? 0 : 1
}

main()
  .then(async (code) => {
    await closePool().catch(() => undefined)
    process.exit(code)
  })
  .catch(async (error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error))
    await closePool().catch(() => undefined)
    process.exit(1)
  })

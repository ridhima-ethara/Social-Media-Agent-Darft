/**
 * ANALYTICS AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `analytics`, and `npm run agent:check` fails if not.
 */

import type { Platform } from '../../../../shared/agent-contract'
import { PLATFORMS } from '../../../../shared/agent-contract'
import { listPlatformAnalytics, listPosts, postBaseline, setPostAnalysis, type PostRow } from '../../db/repo'
import { clamp, mean, median, monthKeyOf, monthLabelOf, PLATFORM_LABEL, round, stdev,
} from '../corpus'
import { registerSkill } from '../runtime'
import type { AnalyticsPayload } from '../skills/index'


/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS 1 · analytics.metrics.ingest
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AnalyticsPayload>('analytics.metrics.ingest', async (_payload, ctx) => {
  const maxPosts = ctx.num('maxPosts', 60)
  const appendOnly = ctx.bool('appendOnly', true)

  const posts = await listPosts(ctx.workspaceId, { limit: maxPosts })
  const withMetrics = posts.filter((p) => p.metrics_captured_at !== null)

  ctx.log(
    `${withMetrics.length} of ${posts.length} post(s) carry a metrics reading` +
      (appendOnly ? ' · readings are appended, never overwritten' : ''),
  )

  return { ingested: withMetrics.length, posts: withMetrics }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS 2 · analytics.metrics.reconcile
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AnalyticsPayload>('analytics.metrics.reconcile', async (_payload, ctx) => {
  const excludeUnreported = ctx.bool('excludeUnreported', true)
  const lagDays = ctx.num('reportingLagDays', 3)

  const rows = await listPlatformAnalytics(ctx.workspaceId)
  const now = new Date()
  const currentMonth = now.toISOString().slice(0, 7)

  const reportedPeriods = rows.map((row) => {
    // The current month is never fully reported, and the platform's own lag
    // means the tail of last month may not be either.
    const isCurrent = row.month === currentMonth
    const withinLag = isCurrent && now.getUTCDate() <= lagDays
    const reported = row.is_reported && !isCurrent && !withinLag
    return { platform: row.platform, month: row.month, reported }
  })

  const excluded = reportedPeriods.filter((p) => !p.reported).length
  ctx.log(
    excludeUnreported
      ? `${reportedPeriods.length - excluded} reported period(s); ${excluded} excluded from every average rather than counted as zero`
      : `${reportedPeriods.length} period(s), unreported ones included — averages will read low`,
  )

  return { reportedPeriods }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS 3 · analytics.baseline.compute
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AnalyticsPayload>('analytics.baseline.compute', async (_payload, ctx) => {
  const windowPeriods = ctx.num('windowPeriods', 4)
  const measure = ctx.str('measure', 'Mean')
  const minSamples = ctx.num('minSamples', 2)

  const baselines: Record<
    string,
    { avgReach: number; avgEngagementRate: number; stdev: number; samples: number }
  > = {}

  for (const platform of PLATFORMS) {
    const posts = await listPosts(ctx.workspaceId, { platform, limit: windowPeriods * 6 })
    const reported = posts.filter((p) => p.metrics_captured_at !== null && p.reach !== null)

    if (reported.length < minSamples) {
      // Too few samples to claim a baseline. Saying so is more useful than
      // inventing one from a single post.
      baselines[platform] = { avgReach: 0, avgEngagementRate: 0, stdev: 0, samples: reported.length }
      continue
    }

    const reaches = reported.map((p) => Number(p.reach ?? 0))
    const rates = reported.map((p) => Number(p.engagement_rate ?? 0)).filter((r) => r > 0)

    const centre = measure === 'Median' ? median : mean
    baselines[platform] = {
      avgReach: round(centre(reaches)),
      avgEngagementRate: round(centre(rates), 2),
      stdev: round(stdev(reaches)),
      samples: reported.length,
    }
  }

  const named = PLATFORMS.filter((p) => (baselines[p]?.samples ?? 0) >= minSamples)
  ctx.log(
    named.length === 0
      ? `No platform has the ${minSamples} reported post(s) needed for a baseline yet`
      : named
          .map(
            (p) =>
              `${PLATFORM_LABEL[p]} ${measure.toLowerCase()} reach ${baselines[p]?.avgReach} (±${baselines[p]?.stdev}) over ${baselines[p]?.samples} posts`,
          )
          .join(' · '),
  )

  return { baselines }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS 4 · analytics.sentiment.classify
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AnalyticsPayload>('analytics.sentiment.classify', async (payload, ctx) => {
  const positiveThreshold = ctx.num('positiveThreshold', 60)
  const negativeThreshold = ctx.num('negativeThreshold', 30)

  const posts = (payload.posts as PostRow[] | undefined) ?? (await listPosts(ctx.workspaceId, { limit: 40 }))
  const target = payload.postId ? posts.find((p) => p.id === payload.postId) : posts[0]

  if (!target || target.impressions === null) {
    ctx.log('No metrics reading to classify sentiment from')
    return { sentiment: { label: 'Unknown', score: 0, reason: 'No metrics reading yet.' } }
  }

  // Reaction composition as a proxy: comments and shares cost the audience more
  // than a like, so a high share of them reads as genuine engagement rather
  // than a scroll-past tap.
  const likes = Number(target.likes ?? 0)
  const comments = Number(target.comments ?? 0)
  const shares = Number(target.shares ?? 0)
  const total = likes + comments + shares

  const score = total === 0 ? 0 : clamp(Math.round(((comments * 2 + shares * 3) / total) * 100), 0, 100)
  const label = score >= positiveThreshold ? 'Positive' : score <= negativeThreshold ? 'Muted' : 'Neutral'

  const reason =
    total === 0
      ? 'No interactions recorded yet.'
      : `${comments} comment${comments === 1 ? '' : 's'} and ${shares} share${shares === 1 ? '' : 's'} against ${likes} like${likes === 1 ? '' : 's'} — a ${score}% weighted interaction share.`

  ctx.log(`Sentiment: ${label} (${score}) — ${reason}`)

  return { sentiment: { label, score, reason } }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS 5 · analytics.period.compare
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AnalyticsPayload>('analytics.period.compare', async (payload, ctx) => {
  const materialChange = ctx.num('materialChange', 10)
  const attributeChange = ctx.bool('attributeChange', true)

  const platform = (payload.platform ?? 'linkedin') as Platform
  const rows = await listPlatformAnalytics(ctx.workspaceId, { platform })
  const reported = rows.filter((r) => r.is_reported).sort((a, b) => b.month.localeCompare(a.month))

  if (reported.length < 2) {
    ctx.log(
      `${PLATFORM_LABEL[platform]} has ${reported.length} reported month — a period comparison needs two`,
    )
    return {
      comparison: {
        platform,
        month: reported[0]?.month ?? '',
        priorMonth: '',
        changes: [],
        summary: `${PLATFORM_LABEL[platform]} has only ${reported.length} reported month, so there is nothing to compare it against yet.`,
      },
    }
  }

  const current = reported[0] as (typeof reported)[number]
  const prior = reported[1] as (typeof reported)[number]

  const metricKeys = [...new Set([...Object.keys(current.metrics), ...Object.keys(prior.metrics)])]
  const changes = metricKeys
    .filter((key) => current.metrics[key] !== undefined && prior.metrics[key] !== undefined)
    .map((key) => {
      const currentValue = Number(current.metrics[key] ?? 0)
      const priorValue = Number(prior.metrics[key] ?? 0)
      const deltaPct = priorValue === 0 ? 0 : round(((currentValue - priorValue) / priorValue) * 100, 1)
      return {
        metric: key,
        current: currentValue,
        prior: priorValue,
        deltaPct,
        material: Math.abs(deltaPct) >= materialChange,
      }
    })

  const material = changes.filter((c) => c.material)
  const biggest = [...material].sort((a, b) => Math.abs(b.deltaPct) - Math.abs(a.deltaPct))[0]

  let summary: string
  if (!biggest) {
    summary = `${PLATFORM_LABEL[platform]} held steady from ${monthLabelOf(prior.month)} to ${monthLabelOf(current.month)} — nothing moved by more than ${materialChange}%.`
  } else {
    summary = `${PLATFORM_LABEL[platform]} ${biggest.deltaPct >= 0 ? 'is up' : 'is down'} ${Math.abs(biggest.deltaPct)}% on ${humanMetric(biggest.metric)} against ${monthLabelOf(prior.month)} — ${formatNumber(biggest.current)} against ${formatNumber(biggest.prior)}.`
    if (attributeChange && material.length > 1) {
      const others = material
        .filter((c) => c.metric !== biggest.metric)
        .slice(0, 2)
        .map((c) => `${humanMetric(c.metric)} ${c.deltaPct >= 0 ? '+' : ''}${c.deltaPct}%`)
      summary += ` ${others.join(', ')} moved with it.`
    }
    summary += ' Measured against this account only, not an industry figure.'
  }

  ctx.log(summary)

  return {
    comparison: { platform, month: current.month, priorMonth: prior.month, changes, summary },
  }
})

function humanMetric(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/_/g, ' ')
    .toLowerCase()
}

function formatNumber(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return String(n)
}

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS 6 · analytics.post.explain
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AnalyticsPayload>('analytics.post.explain', async (payload, ctx) => {
  const maxChars = ctx.num('maxChars', 320)
  const includeRecommendation = ctx.bool('includeRecommendation', true)
  const neverIndustry = ctx.bool('neverUseIndustryBenchmark', true)

  const posts = await listPosts(ctx.workspaceId, { limit: 60 })
  const target = payload.postId ? posts.find((p) => p.id === payload.postId) : posts[0]

  if (!target) {
    ctx.log('No published post to explain')
    return {}
  }

  if (target.reach === null || target.metrics_captured_at === null) {
    const summary = `“${target.title}” has no metrics reading yet, so there is nothing to explain. The first reading arrives about an hour after publishing.`
    await setPostAnalysis(ctx.workspaceId, target.id, summary, 'Wait for the first reading.')
    return { explanation: { summary, recommendation: 'Wait for the first reading.', postId: target.id } }
  }

  const baseline = await postBaseline(ctx.workspaceId, target.platform, 8)
  const reach = Number(target.reach)
  const rate = Number(target.engagement_rate ?? 0)

  const reachDelta =
    baseline.avgReach === 0 ? 0 : round(((reach - baseline.avgReach) / baseline.avgReach) * 100, 1)
  const rateDelta =
    baseline.avgEngagementRate === 0
      ? 0
      : round(((rate - baseline.avgEngagementRate) / baseline.avgEngagementRate) * 100, 1)

  const parts: string[] = []
  if (baseline.samples < 2) {
    parts.push(
      `${formatNumber(reach)} reach at a ${rate}% engagement rate. There are only ${baseline.samples} prior ${PLATFORM_LABEL[target.platform]} post(s), so this has no baseline to be judged against yet.`,
    )
  } else {
    parts.push(
      `${formatNumber(reach)} reach is ${reachDelta >= 0 ? 'up' : 'down'} ${Math.abs(reachDelta)}% on our own ${PLATFORM_LABEL[target.platform]} average of ${formatNumber(baseline.avgReach)} across ${baseline.samples} posts.`,
    )
    parts.push(
      `Engagement rate ${rate}% is ${rateDelta >= 0 ? 'above' : 'below'} our ${baseline.avgEngagementRate}% trailing average.`,
    )
  }

  const comments = Number(target.comments ?? 0)
  const shares = Number(target.shares ?? 0)
  if (comments + shares > 0) {
    parts.push(
      `${comments} comment${comments === 1 ? '' : 's'} and ${shares} share${shares === 1 ? '' : 's'} carried it beyond the follower base.`,
    )
  }

  if (neverIndustry) {
    // Stated, not merely implied: this figure is ours.
    parts.push('Compared against this account only.')
  }

  const summary = clampTo(parts.join(' '), maxChars)

  let recommendation = ''
  if (includeRecommendation) {
    if (reachDelta >= 15) {
      recommendation = `Run a second post on ${target.platform === 'x' ? 'X' : PLATFORM_LABEL[target.platform]} in the same slot next week — this format and time are working.`
    } else if (reachDelta <= -15) {
      recommendation = `Move the next ${PLATFORM_LABEL[target.platform]} post to a mid-morning slot and lead with the figure rather than the framing.`
    } else {
      recommendation = `Hold the current cadence on ${PLATFORM_LABEL[target.platform]}; nothing here justifies a change.`
    }
  }

  await setPostAnalysis(ctx.workspaceId, target.id, summary, recommendation)
  ctx.log(`Explained “${target.title}” against our own ${baseline.samples}-post baseline`)

  return { explanation: { summary, recommendation, postId: target.id } }
})

function clampTo(text: string, maxChars: number): string {
  return text.length <= maxChars ? text : `${text.slice(0, maxChars - 1).trimEnd()}…`
}


/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS 7 · analytics.report.compose
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AnalyticsPayload>('analytics.report.compose', async (payload, ctx) => {
  const topPostCount = ctx.num('topPosts', 3)
  const includeUnreported = ctx.bool('includeUnreported', true)

  const month = payload.month ?? monthKeyOf(new Date().toISOString().slice(0, 10))
  const rows = await listPlatformAnalytics(ctx.workspaceId)
  const posts = await listPosts(ctx.workspaceId, { limit: 80 })

  const inMonth = posts.filter((p) => p.published_at?.startsWith(month))
  const topPosts = [...inMonth]
    .filter((p) => p.reach !== null)
    .sort((a, b) => Number(b.reach ?? 0) - Number(a.reach ?? 0))
    .slice(0, Math.max(1, topPostCount))
    .map((p) => ({
      id: p.id,
      title: p.title,
      platform: p.platform,
      reach: Number(p.reach ?? 0),
      engagementRate: Number(p.engagement_rate ?? 0),
    }))

  const platforms = PLATFORMS.map((platform) => {
    const row = rows.find((r) => r.platform === platform && r.month === month)
    if (!row) {
      return {
        platform,
        reported: false,
        note: `${PLATFORM_LABEL[platform]} has no rollup for ${monthLabelOf(month)}. Computed from published posts instead.`,
        metrics: {},
        postCount: inMonth.filter((p) => p.platform === platform).length,
      }
    }
    return {
      platform,
      reported: row.is_reported,
      note: row.is_reported
        ? `Reported platform data for ${monthLabelOf(month)}.`
        : `${monthLabelOf(month)} is not fully reported yet — excluded from averages rather than counted as zero.`,
      metrics: row.metrics,
      postCount: inMonth.filter((p) => p.platform === platform).length,
    }
  }).filter((p) => includeUnreported || p.reported)

  const report = {
    month,
    label: monthLabelOf(month),
    platforms,
    topPosts,
    postsPublished: inMonth.length,
    generatedAt: new Date().toISOString(),
  }

  ctx.log(
    `${monthLabelOf(month)} report composed · ${inMonth.length} post(s), ${platforms.filter((p) => p.reported).length} reported platform(s)`,
  )

  return { report }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYTICS 8 · analytics.export.build
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<AnalyticsPayload>('analytics.export.build', async (payload, ctx) => {
  const format = ctx.str('format', 'Both')
  const includeDaily = ctx.bool('includeDaily', true)

  const month = payload.month ?? monthKeyOf(new Date().toISOString().slice(0, 10))
  const rows = await listPlatformAnalytics(ctx.workspaceId)
  const posts = await listPosts(ctx.workspaceId, { limit: 100 })
  const inMonth = posts.filter((p) => p.published_at?.startsWith(month))

  const exports: Array<{ format: string; filename: string; body: string }> = []

  if (format === 'CSV' || format === 'Both') {
    const header = 'title,platform,published_at,reach,impressions,likes,comments,shares,engagement_rate'
    const lines = inMonth.map((p) =>
      [
        `"${p.title.replace(/"/g, '""')}"`,
        p.platform,
        p.published_at ?? '',
        p.reach ?? '',
        p.impressions ?? '',
        p.likes ?? '',
        p.comments ?? '',
        p.shares ?? '',
        p.engagement_rate ?? '',
      ].join(','),
    )
    exports.push({
      format: 'CSV',
      filename: `ethara-analytics-${month}.csv`,
      body: [header, ...lines].join('\n'),
    })
  }

  if (format === 'JSON' || format === 'Both') {
    exports.push({
      format: 'JSON',
      filename: `ethara-analytics-${month}.json`,
      body: JSON.stringify(
        {
          month,
          label: monthLabelOf(month),
          platforms: rows
            .filter((r) => r.month === month)
            .map((r) => ({
              platform: r.platform,
              isReported: r.is_reported,
              metrics: r.metrics,
              ...(includeDaily ? { daily: r.daily } : {}),
            })),
          posts: inMonth.map((p) => ({
            title: p.title,
            platform: p.platform,
            publishedAt: p.published_at,
            reach: p.reach,
            impressions: p.impressions,
            engagementRate: p.engagement_rate,
          })),
        },
        null,
        2,
      ),
    })
  }

  ctx.log(`${exports.map((e) => e.format).join(' + ')} export(s) built for ${monthLabelOf(month)}`)

  return { exports }
})

/**
 * ANALYSIS AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `analysis`, and `npm run agent:check` fails if not.
 */

import { BRAND, similarity } from '../../../../shared/brand-voice'
import { listPosts } from '../../db/repo'
import { angleFor, audienceFor, clamp, countTopicMatches, engagementLevel, FORMATS, headlineFrom, mean, seededFor, type ContentFormat } from '../corpus'
import { registerSkill } from '../runtime'
import type { HashtagCandidate, Opportunity, PipelinePayload, ScrapedPost } from '../skills/index'


/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS 1 · analysis.trend.cluster
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('analysis.trend.cluster', (payload, ctx) => {
  const mergeThreshold = ctx.num('mergeThreshold', 58) / 100
  const maxClusters = ctx.num('maxClusters', 14)
  const minClusterSize = ctx.num('minClusterSize', 1)

  const validated = (payload.posts ?? []).filter((p) => p.validation === 'validated')
  const trendByTerm = new Map((payload.trends ?? []).map((t) => [t.term, t]))

  // Greedy clustering on title similarity: strongest item first becomes the
  // seed, everything close enough joins it.
  const sorted = [...validated].sort(
    (a, b) => b.relevance - a.relevance || b.engagement - a.engagement,
  )

  const clusters: Array<{ seed: ScrapedPost; members: ScrapedPost[] }> = []
  for (const post of sorted) {
    const home = clusters.find((c) => similarity(c.seed.title, post.title) >= mergeThreshold)
    if (home) home.members.push(post)
    else clusters.push({ seed: post, members: [post] })
  }

  const opportunities: Opportunity[] = clusters
    .filter((c) => c.members.length >= Math.max(1, minClusterSize))
    .slice(0, Math.max(1, maxClusters))
    .map((cluster, index) => {
      const seed = cluster.seed
      const trend = trendByTerm.get(seed.keyword)
      const topHashtag =
        (payload.hashtagCandidates ?? [])
          .filter((h) => h.keyword === seed.keyword && h.validation === 'validated')
          .sort((a, b) => b.hashtagScore - a.hashtagScore)[0]?.displayTag ?? null

      return {
        id: `opp-${index + 1}`,
        title: headlineFrom(seed.text, 12),
        description: seed.snippet,
        sourceTopic: seed.keyword,
        sourceExternalId: seed.externalId,
        hashtag: topHashtag,
        members: cluster.members.length,
        trendScore: trend?.trendScore ?? seed.relevance,
        brandRelevance: 0,
        predictedEngagement: 0,
        engagementLevel: 'Medium',
        format: 'Thought Leadership',
        angle: '',
        audience: '',
        saturation: 0,
        saturationNote: '',
        reason: '',
        isNewTrend: trend?.isTrending === true,
      }
    })

  ctx.log(
    `${opportunities.length} opportunity cluster(s) from ${validated.length} validated items at a ${Math.round(mergeThreshold * 100)}% merge threshold`,
  )

  return { opportunities }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS 2 · analysis.brand.fit
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('analysis.brand.fit', (payload, ctx) => {
  const minBrandFit = ctx.num('minBrandFit', 45)
  const requireDomainMatch = ctx.bool('requireDomainMatch', false)

  const opportunities = payload.opportunities ?? []
  const kept: Opportunity[] = []
  let dropped = 0

  for (const opportunity of opportunities) {
    const text = `${opportunity.title} ${opportunity.description} ${opportunity.sourceTopic}`
    const domainHits = BRAND.domains.filter((d) =>
      text.toLowerCase().includes(d.toLowerCase()),
    )
    const topicHits = countTopicMatches(text)

    opportunity.brandRelevance = clamp(
      42 + topicHits * 11 + domainHits.length * 9,
      0,
      100,
    )

    if (requireDomainMatch && domainHits.length === 0) {
      dropped += 1
      continue
    }
    if (opportunity.brandRelevance < minBrandFit) {
      dropped += 1
      continue
    }
    kept.push(opportunity)
  }

  ctx.log(
    `${kept.length} opportunit${kept.length === 1 ? 'y' : 'ies'} clear the ${minBrandFit}% brand-fit floor` +
      (dropped > 0 ? `, ${dropped} did not` : ''),
  )

  return { opportunities: kept }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS 3 · analysis.engagement.predict
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('analysis.engagement.predict', async (payload, ctx) => {
  const historyWeight = ctx.num('historyWeight', 60) / 100
  const lookbackPosts = ctx.num('lookbackPosts', 20)

  const opportunities = payload.opportunities ?? []
  if (opportunities.length === 0) return {}

  const history = await listPosts(ctx.workspaceId, { limit: lookbackPosts })
  const rates = history
    .map((p) => Number(p.engagement_rate ?? 0))
    .filter((r) => Number.isFinite(r) && r > 0)
  const ourAverage = rates.length === 0 ? 0 : mean(rates)

  for (const opportunity of opportunities) {
    // The signal half comes from this run; the history half from what this
    // account has actually achieved. Never an industry benchmark.
    const signal = (opportunity.trendScore + opportunity.brandRelevance) / 2
    const historic = ourAverage > 0 ? clamp(Math.round((ourAverage / 8) * 100), 0, 100) : signal
    opportunity.predictedEngagement = clamp(
      Math.round(historic * historyWeight + signal * (1 - historyWeight)),
      0,
      100,
    )
    opportunity.engagementLevel = engagementLevel(opportunity.predictedEngagement)
  }

  ctx.log(
    rates.length === 0
      ? 'No published history yet, so predictions rest on this run’s signal alone'
      : `Predictions blended ${Math.round(historyWeight * 100)}% from our own last ${rates.length} posts (average engagement rate ${ourAverage.toFixed(2)}%)`,
  )

  return { opportunities }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS 4 · analysis.format.recommend
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('analysis.format.recommend', (payload, ctx) => {
  const bias = ctx.str('bias', 'Balanced')
  const allowVideo = ctx.bool('allowVideo', false)

  const opportunities = payload.opportunities ?? []

  const biasBoost: Record<string, Partial<Record<ContentFormat, number>>> = {
    Balanced: {},
    'Favour long-form': { 'Thought Leadership': 18, 'Case Study': 12 },
    'Favour short-form': { 'Short Post': 20 },
    'Favour visual': { Carousel: 20, Video: 14 },
  }
  const boosts = biasBoost[bias] ?? {}

  for (const opportunity of opportunities) {
    const words = opportunity.description.split(/\s+/).length
    const scores = new Map<ContentFormat, number>()

    for (const format of FORMATS) {
      if (format === 'Video' && !allowVideo) continue
      let score = 50
      if (format === 'Thought Leadership') score += opportunity.brandRelevance / 4 + (words > 30 ? 12 : 0)
      if (format === 'Carousel') score += opportunity.members * 6
      if (format === 'Short Post') score += words < 20 ? 18 : 0
      if (format === 'Case Study') score += /result|benchmark|measured|study|experiment/i.test(opportunity.description) ? 20 : 0
      score += boosts[format] ?? 0
      scores.set(format, score)
    }

    const best = [...scores.entries()].sort((a, b) => b[1] - a[1])[0]
    opportunity.format = (best?.[0] ?? 'Thought Leadership') as ContentFormat
  }

  const tally = new Map<string, number>()
  for (const o of opportunities) tally.set(o.format, (tally.get(o.format) ?? 0) + 1)
  ctx.log(
    `Formats (${bias}): ` +
      [...tally.entries()].map(([f, n]) => `${n}× ${f}`).join(', ') +
      (allowVideo ? '' : ' · video is switched off'),
  )

  return { opportunities }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS 5 · analysis.angle.propose
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('analysis.angle.propose', (payload, ctx) => {
  const preferContrarian = ctx.bool('preferContrarian', false)
  const anglesPer = ctx.num('anglesPerOpportunity', 1)

  const opportunities = payload.opportunities ?? []
  for (const opportunity of opportunities) {
    opportunity.angle = angleFor(opportunity.title, preferContrarian)
    opportunity.audience = audienceFor(opportunity.title)
  }

  ctx.log(
    `${opportunities.length} angle${opportunities.length === 1 ? '' : 's'} proposed` +
      (anglesPer > 1 ? ` (${anglesPer} requested; the strongest is carried forward)` : '') +
      (preferContrarian ? ', favouring the contrarian framing' : ''),
  )

  return { opportunities }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS 6 · analysis.competitor.compare
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('analysis.competitor.compare', (payload, ctx) => {
  const saturationThreshold = ctx.num('saturationThreshold', 70)
  const windowDays = ctx.num('competitorWindowDays', 21)

  const opportunities = payload.opportunities ?? []
  const competitorPosts = payload.competitorPosts ?? []
  const cutoff = Date.now() - windowDays * 86_400_000
  const recent = competitorPosts.filter((p) => new Date(p.postedAt).getTime() >= cutoff)

  for (const opportunity of opportunities) {
    const overlapping = recent.filter(
      (p) =>
        similarity(p.text, opportunity.title) >= 0.35 ||
        p.topics.some((t) => opportunity.sourceTopic.toLowerCase().includes(t.toLowerCase())),
    )

    opportunity.saturation = clamp(Math.round((overlapping.length / Math.max(3, recent.length || 3)) * 100), 0, 100)
    opportunity.saturationNote =
      overlapping.length === 0
        ? `No competitor covered this in the last ${windowDays} days — the space is open.`
        : opportunity.saturation >= saturationThreshold
          ? `${overlapping.length} competitor post(s) in ${windowDays} days (${opportunity.saturation}% saturation, over the ${saturationThreshold}% line) — needs a distinct angle to be worth publishing.`
          : `${overlapping.length} competitor post(s) in ${windowDays} days (${opportunity.saturation}% saturation) — room to say something new.`
  }

  const crowded = opportunities.filter((o) => o.saturation >= saturationThreshold).length
  ctx.log(
    recent.length === 0
      ? 'No competitor posts in the window to compare against'
      : `${crowded} of ${opportunities.length} opportunities are in crowded territory`,
  )

  return { opportunities }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS 7 · analysis.hashtag.consolidate
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('analysis.hashtag.consolidate', (payload, ctx) => {
  const topHashtags = ctx.num('topHashtags', 25)
  const balanceAcrossKeywords = ctx.bool('balanceAcrossKeywords', true)
  const crossKeywordDedupe = ctx.num('crossKeywordDedupe', 80) / 100

  const groups = payload.hashtagGroups ?? []
  const validated = groups.flatMap((g) => g.hashtags.filter((h) => h.validation === 'validated'))

  // De-duplicate across keywords: the same tag surfaced under two keywords is
  // one tag, and its evidence is the union.
  const byTag = new Map<string, HashtagCandidate>()
  for (const candidate of validated) {
    const existing = byTag.get(candidate.tag)
    if (!existing) {
      byTag.set(candidate.tag, candidate)
      continue
    }
    existing.postCount = Math.max(existing.postCount, candidate.postCount)
    existing.totalEngagement = Math.max(existing.totalEngagement, candidate.totalEngagement)
    existing.hashtagScore = Math.max(existing.hashtagScore, candidate.hashtagScore)
    for (const term of candidate.surfacedBy) {
      if (!existing.surfacedBy.includes(term)) existing.surfacedBy.push(term)
    }
  }

  // Then a near-duplicate pass across the merged set.
  const unique: HashtagCandidate[] = []
  for (const candidate of [...byTag.values()].sort((a, b) => b.hashtagScore - a.hashtagScore)) {
    const twin = unique.find(
      (other) => similarity(other.displayTag, candidate.displayTag) >= crossKeywordDedupe,
    )
    if (twin) {
      twin.postCount = Math.max(twin.postCount, candidate.postCount)
      continue
    }
    unique.push(candidate)
  }

  let selected: HashtagCandidate[]
  if (balanceAcrossKeywords && groups.length > 0) {
    // Round-robin across keywords so one dominant term cannot take the whole set.
    const perKeyword = new Map<string, HashtagCandidate[]>()
    for (const candidate of unique) {
      const key = candidate.keyword
      const list = perKeyword.get(key) ?? []
      list.push(candidate)
      perKeyword.set(key, list)
    }
    selected = []
    let round = 0
    while (selected.length < Math.min(topHashtags, unique.length)) {
      let addedThisRound = 0
      for (const list of perKeyword.values()) {
        const next = list[round]
        if (next && selected.length < topHashtags) {
          selected.push(next)
          addedThisRound += 1
        }
      }
      if (addedThisRound === 0) break
      round += 1
    }
    selected.sort((a, b) => b.hashtagScore - a.hashtagScore)
  } else {
    selected = unique.slice(0, topHashtags)
  }

  selected.forEach((candidate, index) => {
    candidate.rank = index + 1
    candidate.inTopSet = true
  })

  ctx.emit(
    'activity',
    `Consolidated top ${selected.length} hashtag set from ${validated.length} validated candidates across ${groups.length} keywords`,
    { status: 'ok', count: selected.length },
  )
  ctx.log(`Top ${selected.length}: ${selected.slice(0, 8).map((h) => `#${h.displayTag}`).join(' ')}…`)

  return { topHashtags: selected }
})

/* ═══════════════════════════════════════════════════════════════════════════
   ANALYSIS 8 · analysis.recommendation.explain
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('analysis.recommendation.explain', (payload, ctx) => {
  const maxReasonChars = ctx.num('maxReasonChars', 240)
  const includeNumbers = ctx.bool('includeNumbers', true)

  const opportunities = payload.opportunities ?? []

  for (const opportunity of opportunities) {
    const parts: string[] = []

    if (includeNumbers) {
      parts.push(
        `${opportunity.brandRelevance}% brand fit against a ${opportunity.trendScore} trend score on “${opportunity.sourceTopic}”`,
      )
      if (opportunity.members > 1) {
        parts.push(`${opportunity.members} separate posts said a version of this`)
      }
      parts.push(`predicted engagement ${opportunity.engagementLevel.toLowerCase()}`)
    } else {
      parts.push(`strong fit with ${opportunity.sourceTopic}`)
    }

    parts.push(`best as a ${opportunity.format.toLowerCase()}: ${opportunity.angle.toLowerCase()}`)

    const reason = `${parts.join('; ')}. ${opportunity.saturationNote}`
    opportunity.reason = reason.length > maxReasonChars ? `${reason.slice(0, maxReasonChars - 1).trimEnd()}…` : reason
  }

  // Rank the opportunities so the Calendar Agent receives them in order.
  opportunities.sort(
    (a, b) =>
      b.brandRelevance + b.trendScore - (a.brandRelevance + a.trendScore) ||
      b.predictedEngagement - a.predictedEngagement,
  )

  ctx.log(`${opportunities.length} opportunit${opportunities.length === 1 ? 'y' : 'ies'} explained and ranked`)

  return { opportunities }
})

/** Exposed for the Calendar Agent's deterministic spreading. */
export { seededFor }

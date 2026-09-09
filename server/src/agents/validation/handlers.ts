/**
 * VALIDATION AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `validation`, and `npm run agent:check` fails if not.
 */

import { similarity } from '../../../../shared/brand-voice'
import type { Confidence } from '../../../../shared/agent-contract'
import { listHashtags, listScrapedItems, priorKeywordAverages } from '../../db/repo'
import { aliasGroupLabel, aliasKey, clamp, contentWords, countTopicMatches, credibilityBase, credibilityLabel, growthPercent, halfLifeScore, hoursSince, matchedTopics, mean, normalise, normaliseTag, rescaleGrowth, round } from '../corpus'
import { registerSkill } from '../runtime'
import type { BucketCounts, HashtagCandidate, KeywordTrend, PipelinePayload, RankedHashtagGroup, ReviewRequest, ScrapedPost } from '../skills/index'


/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 1 · validation.keyword.trend
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.keyword.trend', async (payload, ctx) => {
  const keywords = payload.keywords ?? []
  const posts = payload.posts ?? []

  const topKeywords = ctx.num('topKeywords', 5)
  const volumeWeight = ctx.num('volumeWeight', 25)
  const engagementWeight = ctx.num('engagementWeight', 35)
  const velocityWeight = ctx.num('velocityWeight', 20)
  const growthWeight = ctx.num('growthWeight', 20)
  const trendWindowRuns = ctx.num('trendWindowRuns', 4)
  const minPostsToRank = ctx.num('minPostsToRank', 3)

  const weightTotal = volumeWeight + engagementWeight + velocityWeight + growthWeight
  let weightWarning: string | undefined
  if (weightTotal !== 100) {
    weightWarning = `The four trend weights sum to ${weightTotal}%, not 100%. Scores are normalised against that total, so the ranking still holds — but the numbers will not read as percentages.`
    ctx.emit('activity', weightWarning, { status: 'warn' })
  }
  const divisor = weightTotal === 0 ? 1 : weightTotal

  const priors = await priorKeywordAverages(ctx.workspaceId, trendWindowRuns, payload.runId)

  // Per-keyword aggregates from this run's corpus.
  const aggregates = keywords.map((keyword) => {
    const own = posts.filter((p) => p.keyword === keyword.term)
    const totalEngagement = own.reduce((t, p) => t + p.engagement, 0)
    const velocity = own.length === 0 ? 0 : round(mean(own.map((p) => p.velocity)), 2)
    const topPost = [...own].sort((a, b) => b.engagement - a.engagement)[0] ?? null
    return {
      keyword,
      topPost,
      postCount: own.length,
      totalEngagement,
      avgEngagement: own.length === 0 ? 0 : round(totalEngagement / own.length, 2),
      velocity,
    }
  })

  const maxPosts = aggregates.reduce((m, a) => Math.max(m, a.postCount), 0)
  const maxEngagement = aggregates.reduce((m, a) => Math.max(m, a.totalEngagement), 0)
  const maxVelocity = aggregates.reduce((m, a) => Math.max(m, a.velocity), 0)

  const trends: KeywordTrend[] = aggregates.map((agg) => {
    const prior = priors.get(agg.keyword.id)
    const priorAvg = prior?.avgEngagement ?? 0
    const growthPct = prior && prior.runs > 0 ? growthPercent(agg.totalEngagement, priorAvg) : 0

    const volumeScore = normalise(agg.postCount, maxPosts)
    const engagementScore = normalise(agg.totalEngagement, maxEngagement)
    const velocityScore = normalise(agg.velocity, maxVelocity)
    const growthScore = prior && prior.runs > 0 ? rescaleGrowth(growthPct) : 50

    const weighted =
      (volumeScore * volumeWeight +
        engagementScore * engagementWeight +
        velocityScore * velocityWeight +
        growthScore * growthWeight) /
      divisor

    // Below the floor a keyword has not produced enough evidence to be ranked
    // at all — it keeps its components but cannot claim a trend.
    const trendScore = agg.postCount < minPostsToRank ? 0 : clamp(Math.round(weighted), 0, 100)

    return {
      keywordId: agg.keyword.id,
      term: agg.keyword.term,
      postCount: agg.postCount,
      totalEngagement: agg.totalEngagement,
      avgEngagement: agg.avgEngagement,
      velocity: agg.velocity,
      growthPct,
      volumeScore,
      engagementScore,
      velocityScore,
      growthScore,
      trendScore,
      rank: 0,
      isTrending: false,
      trendReason: '',
      priorRuns: prior?.runs ?? 0,
      searchUrl: `https://www.linkedin.com/search/results/content/?keywords=${encodeURIComponent(agg.keyword.term)}&sortBy=%22date_posted%22`,
      topPostUrl: agg.topPost?.url ?? null,
      topPostTitle: agg.topPost?.title ?? null,
    }
  })

  trends.sort((a, b) => b.trendScore - a.trendScore || b.totalEngagement - a.totalEngagement)

  const take = clamp(topKeywords, 1, trends.length)
  trends.forEach((trend, index) => {
    trend.rank = index + 1
    trend.isTrending = index < take && trend.trendScore > 0
    trend.trendReason = describeTrend(trend, trends, minPostsToRank)
  })

  const trendingKeywords = trends.filter((t) => t.isTrending)

  for (const trend of trends) {
    ctx.emit('keyword.ranked', `${trend.term} · ${trend.trendScore}`, {
      keywordId: trend.keywordId,
      term: trend.term,
      trendScore: trend.trendScore,
      rank: trend.rank,
      isTrending: trend.isTrending,
      reason: trend.trendReason,
    })
  }

  ctx.log(
    `${trendingKeywords.length} trending keyword${trendingKeywords.length === 1 ? '' : 's'}: ` +
      trendingKeywords.map((t) => `${t.term} (${t.trendScore})`).join(', '),
  )

  return {
    trends,
    trendingKeywords,
    ...(weightWarning === undefined ? {} : { weightWarning }),
  }
})

/** A sentence naming the specific evidence behind a trend score. */
function describeTrend(trend: KeywordTrend, all: KeywordTrend[], minPosts: number): string {
  if (trend.postCount < minPosts) {
    return `Only ${trend.postCount} post${trend.postCount === 1 ? '' : 's'} this run, below the ${minPosts}-post floor needed to rank a trend.`
  }

  const volumeRank = [...all].sort((a, b) => b.postCount - a.postCount).findIndex((t) => t.keywordId === trend.keywordId) + 1
  const parts: string[] = []

  parts.push(
    `${ordinal(volumeRank)} highest volume this week (${trend.postCount} post${trend.postCount === 1 ? '' : 's'})`,
  )

  if (trend.priorRuns > 0) {
    const direction = trend.growthPct >= 0 ? 'up' : 'down'
    parts.push(
      `engagement is ${direction} ${Math.abs(trend.growthPct).toFixed(0)}% against its ${trend.priorRuns}-run average`,
    )
  } else {
    parts.push('no prior runs to compare against, so growth is scored neutral')
  }

  if (trend.velocity > 0) {
    parts.push(`${trend.velocity} engagements per hour`)
  }

  return `${parts.join(' and ')}.`
}

function ordinal(n: number): string {
  const s = ['th', 'st', 'nd', 'rd']
  const v = n % 100
  return `${n}${s[(v - 20) % 10] ?? s[v] ?? s[0]}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 2 · validation.hashtag.rank
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.hashtag.rank', (payload, ctx) => {
  const candidates = payload.hashtagCandidates ?? []
  const trending = payload.trendingKeywords ?? []
  const topPerKeyword = ctx.num('topHashtagsPerKeyword', 5)
  const halfLife = ctx.num('freshnessHalfLifeHours', 72)
  const now = new Date()

  const maxEngPerPost = candidates.reduce((m, c) => Math.max(m, c.engagementPerPost), 0)
  const maxVolume = candidates.reduce((m, c) => Math.max(m, c.postCount), 0)

  const groups: RankedHashtagGroup[] = []

  for (const keyword of trending) {
    const own = candidates.filter((c) => c.keyword === keyword.term || c.surfacedBy.includes(keyword.term))

    for (const candidate of own) {
      // Relevance to the keyword that surfaced it: shared content words plus a
      // direct-containment bonus, so #RLHF under "RLHF" scores as it should.
      const relevanceToKeyword = keywordRelevance(candidate.displayTag, keyword.term)
      const engagementNorm = normalise(candidate.engagementPerPost, maxEngPerPost)
      const volumeNorm = normalise(candidate.postCount, maxVolume)
      const recency = halfLifeScore(hoursSince(candidate.lastSeenAt, now), halfLife)

      candidate.hashtagScore = clamp(
        Math.round(
          0.3 * relevanceToKeyword + 0.3 * engagementNorm + 0.2 * volumeNorm + 0.2 * recency,
        ),
        0,
        100,
      )
      candidate.freshness = recency
    }

    const ranked = own
      .sort((a, b) => b.hashtagScore - a.hashtagScore || b.postCount - a.postCount)
      .slice(0, Math.max(1, topPerKeyword))

    ranked.forEach((candidate, index) => {
      candidate.rank = index + 1
    })

    groups.push({
      keywordId: keyword.keywordId,
      term: keyword.term,
      keywordRank: keyword.rank,
      hashtags: ranked,
    })
  }

  const kept = groups.reduce((total, g) => total + g.hashtags.length, 0)
  ctx.log(
    `${kept} hashtags ranked across ${groups.length} trending keyword${groups.length === 1 ? '' : 's'} (top ${topPerKeyword} each)`,
  )

  return { hashtagGroups: groups, hashtagCandidates: candidates }
})

function keywordRelevance(tag: string, keyword: string): number {
  const tagKey = normaliseTag(tag)
  const keywordCompact = keyword.toLowerCase().replace(/\s+/g, '')
  if (tagKey === keywordCompact) return 100
  if (tagKey.includes(keywordCompact) || keywordCompact.includes(tagKey)) return 88
  if (aliasKey(tagKey) === aliasKey(keywordCompact)) return 84

  const tagWords = new Set(contentWords(tag.replace(/([a-z])([A-Z])/g, '$1 $2')))
  const keyWords = contentWords(keyword)
  const overlap = keyWords.filter((w) => tagWords.has(w)).length
  if (keyWords.length === 0) return 40
  return clamp(Math.round(40 + (overlap / keyWords.length) * 50), 20, 95)
}

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 3 · validation.credibility.score
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.credibility.score', (payload, ctx) => {
  const trustedBonus = ctx.num('trustedBonus', 12)
  const communityPenalty = ctx.num('communityPenalty', 15)

  const posts = payload.posts ?? []
  const candidates = payload.hashtagCandidates ?? []

  for (const post of posts) {
    let score = credibilityBase(post.sourceType)
    // A large, named following is corroboration, not proof — a bounded bonus.
    if (post.authorFollowers >= 20_000) score += trustedBonus
    else if (post.authorFollowers >= 5_000) score += Math.round(trustedBonus / 2)
    if (post.sourceType === 'Community') score -= communityPenalty
    post.credibilityScore = clamp(score, 0, 100)
    // The label is always re-derived from the score, never carried separately.
    post.credibility = credibilityLabel(post.credibilityScore)
  }

  for (const candidate of candidates) {
    // A hashtag's credibility is the corroboration behind it: how many distinct
    // keyword queries surfaced it, and how much engagement it carries per post.
    const breadth = Math.min(3, candidate.surfacedBy.length)
    const independent = candidate.expandedSource ? 1 : 0
    let score = 45 + breadth * 8 + independent * trustedBonus
    if (candidate.postCount < 3) score -= communityPenalty
    candidate.credibilityScore = clamp(score, 0, 100)
    candidate.credibility = credibilityLabel(candidate.credibilityScore)
  }

  const buckets = { High: 0, Medium: 0, Low: 0 } as Record<Confidence, number>
  for (const post of posts) buckets[post.credibility] += 1
  ctx.log(
    `Credibility scored: ${buckets.High} High, ${buckets.Medium} Medium, ${buckets.Low} Low across ${posts.length} items`,
  )

  return { posts, hashtagCandidates: candidates }
})

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 4 · validation.relevance.score
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.relevance.score', (payload, ctx) => {
  const acceptThreshold = ctx.num('acceptThreshold', 70)
  const rejectThreshold = ctx.num('rejectThreshold', 40)
  const baseRelevance = ctx.num('baseRelevance', 45)

  const posts = payload.posts ?? []
  const candidates = payload.hashtagCandidates ?? []

  for (const post of posts) {
    // Topic overlap can only RAISE relevance. The absence of a keyword is not
    // evidence of irrelevance, so nothing here subtracts.
    const hits = countTopicMatches(`${post.text} ${post.hashtags.join(' ')}`)
    post.relevance = clamp(baseRelevance + hits * 14, 0, 100)
  }

  for (const candidate of candidates) {
    const spaced = candidate.displayTag.replace(/([a-z])([A-Z])/g, '$1 $2')
    const hits = countTopicMatches(`${spaced} ${candidate.surfacedBy.join(' ')}`)
    candidate.relevance = clamp(baseRelevance + hits * 16, 0, 100)
  }

  const above = posts.filter((p) => p.relevance >= acceptThreshold).length
  ctx.log(
    `${above} of ${posts.length} items clear the ${acceptThreshold}% accept threshold; anything under ${rejectThreshold}% will be rejected`,
  )

  // Threaded onto the payload so the verdict router uses the identical numbers
  // rather than reading its own copy of the same knobs.
  return {
    posts,
    hashtagCandidates: candidates,
    relevanceThresholds: { acceptThreshold, rejectThreshold },
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 5 · validation.freshness.score
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.freshness.score', (payload, ctx) => {
  const halfLife = ctx.num('halfLifeHours', 72)
  const now = new Date()

  const posts = payload.posts ?? []
  for (const post of posts) {
    post.freshness = halfLifeScore(hoursSince(post.postedAt, now), halfLife)
  }

  const candidates = payload.hashtagCandidates ?? []
  for (const candidate of candidates) {
    candidate.freshness = halfLifeScore(hoursSince(candidate.lastSeenAt, now), halfLife)
  }

  const avg = posts.length === 0 ? 0 : Math.round(mean(posts.map((p) => p.freshness)))
  ctx.log(`Average freshness ${avg}% on a ${halfLife}-hour half-life`)

  return { posts, hashtagCandidates: candidates }
})

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 6 · validation.duplicate.detect
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.duplicate.detect', async (payload, ctx) => {
  const threshold = ctx.num('similarityThreshold', 62) / 100
  const compareWindow = ctx.num('compareWindow', 30)
  const withinBatch = ctx.bool('withinBatch', true)
  const aliasMapEnabled = ctx.bool('aliasMapEnabled', true)

  const posts = payload.posts ?? []
  const candidates = payload.hashtagCandidates ?? []

  /* ── Items ─────────────────────────────────────────────────────────────── */

  const priorItems = await listScrapedItems(ctx.workspaceId, { limit: 400 })
  const cutoff = Date.now() - compareWindow * 86_400_000
  const priorInWindow = priorItems.filter(
    (row) => new Date(row.scraped_at).getTime() >= cutoff && row.validation === 'validated',
  )

  let exact = 0
  let near = 0
  let aliasHits = 0

  const acceptedInBatch: ScrapedPost[] = []

  for (const post of posts) {
    // Pass 1 — exact: the same external id already on record.
    const exactPrior = priorInWindow.find(
      (row) => row.external_id === post.externalId || (row.url && row.url === post.url),
    )
    if (exactPrior) {
      post.isDuplicate = true
      post.duplicateOfExternalId = exactPrior.external_id ?? exactPrior.id
      post.verdictReason = `Exact match on an item captured ${daysAgo(exactPrior.scraped_at)} — “${exactPrior.title}”. Linked to the original rather than dropped.`
      exact += 1
      continue
    }

    // Pass 2 — near: Dice bigram similarity against prior validated items…
    const priorMatch = priorInWindow
      .map((row) => ({ row, score: similarity(post.text, `${row.title} ${row.snippet ?? ''}`) }))
      .sort((a, b) => b.score - a.score)[0]

    if (priorMatch && priorMatch.score >= threshold) {
      post.isDuplicate = true
      post.duplicateOfExternalId = priorMatch.row.external_id ?? priorMatch.row.id
      post.verdictReason = `${Math.round(priorMatch.score * 100)}% similar to “${priorMatch.row.title}”, captured ${daysAgo(priorMatch.row.scraped_at)}. Linked to the original.`
      near += 1
      continue
    }

    // …and against others in this same batch.
    if (withinBatch) {
      const batchMatch = acceptedInBatch
        .map((other) => ({ other, score: similarity(post.text, other.text) }))
        .sort((a, b) => b.score - a.score)[0]

      if (batchMatch && batchMatch.score >= threshold) {
        post.isDuplicate = true
        post.duplicateOfExternalId = batchMatch.other.externalId
        post.verdictReason = `${Math.round(batchMatch.score * 100)}% similar to “${batchMatch.other.title}” in this same run. Linked to the first occurrence.`
        near += 1
        continue
      }
    }

    acceptedInBatch.push(post)
  }

  /* ── Hashtags ──────────────────────────────────────────────────────────── */

  const priorTags = await listHashtags(ctx.workspaceId, { limit: 500 })
  const priorByTag = new Map(priorTags.filter((h) => h.validation === 'validated').map((h) => [h.tag, h]))

  const acceptedTags: HashtagCandidate[] = []

  for (const candidate of candidates) {
    // Pass 1 — exact: the same normalised tag already validated.
    const priorTag = priorByTag.get(candidate.tag)
    if (priorTag) {
      candidate.duplicateOfTag = priorTag.tag
      candidate.verdictReason = `#${candidate.displayTag} is already on record as validated. Linked to the existing entry rather than duplicated.`
      exact += 1
      continue
    }

    // Pass 3 — semantic alias: #RL ≡ #ReinforcementLearning.
    if (aliasMapEnabled) {
      const aliasTarget =
        acceptedTags.find((other) => aliasKey(other.tag) === aliasKey(candidate.tag)) ??
        [...priorByTag.values()].find((row) => aliasKey(row.tag) === aliasKey(candidate.tag))

      if (aliasTarget) {
        const targetTag = 'displayTag' in aliasTarget ? aliasTarget.displayTag : aliasTarget.display_tag
        candidate.duplicateOfTag = 'tag' in aliasTarget ? aliasTarget.tag : ''
        candidate.verdictReason = `#${candidate.displayTag} is the same idea as #${targetTag} (${aliasGroupLabel(candidate.tag)}). Merged into the original so the trend is not double-counted.`
        aliasHits += 1
        continue
      }
    }

    // Pass 2 — near, within this batch.
    if (withinBatch) {
      const nearTag = acceptedTags
        .map((other) => ({ other, score: similarity(candidate.displayTag, other.displayTag) }))
        .sort((a, b) => b.score - a.score)[0]

      if (nearTag && nearTag.score >= threshold) {
        candidate.duplicateOfTag = nearTag.other.tag
        candidate.verdictReason = `#${candidate.displayTag} is ${Math.round(nearTag.score * 100)}% similar to #${nearTag.other.displayTag} in this run. Linked to the first occurrence.`
        near += 1
        continue
      }
    }

    acceptedTags.push(candidate)
  }

  ctx.log(
    `${exact} exact, ${near} near and ${aliasHits} alias duplicate(s) linked — none deleted`,
  )

  return { posts, hashtagCandidates: candidates }
})

function daysAgo(iso: string): string {
  const days = Math.round((Date.now() - new Date(iso).getTime()) / 86_400_000)
  if (days <= 0) return 'today'
  if (days === 1) return 'yesterday'
  return `${days} days ago`
}

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 7 · validation.verdict.route
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.verdict.route', (payload, ctx) => {
  const escalateUncertain = ctx.bool('escalateUncertain', true)
  const lowCredibilityAlwaysReviews = ctx.bool('lowCredibilityAlwaysReviews', true)

  // The thresholds the relevance skill actually used, so routing cannot diverge
  // from scoring by reading its own copy of the knobs.
  const thresholds = (payload.relevanceThresholds as
    | { acceptThreshold: number; rejectThreshold: number }
    | undefined) ?? { acceptThreshold: 70, rejectThreshold: 40 }
  const { acceptThreshold, rejectThreshold } = thresholds

  const buckets: BucketCounts = { validated: 0, needs_review: 0, duplicate: 0, rejected: 0 }

  const posts = payload.posts ?? []
  for (const post of posts) {
    const verdict = routeVerdict({
      isDuplicate: post.isDuplicate,
      relevance: post.relevance,
      credibility: post.credibility,
      existingReason: post.verdictReason,
      label: `“${post.title}”`,
      evidence: `relevance ${post.relevance}%, credibility ${post.credibility} (${post.credibilityScore}), ${post.engagement} engagements`,
      topics: matchedTopics(post.text),
      acceptThreshold,
      rejectThreshold,
      escalateUncertain,
      lowCredibilityAlwaysReviews,
    })
    post.validation = verdict.validation
    post.verdictReason = verdict.reason
    buckets[verdict.validation] += 1

    ctx.emit('item.validated', post.title, {
      externalId: post.externalId,
      validation: post.validation,
      reason: post.verdictReason,
      relevance: post.relevance,
      credibility: post.credibility,
      freshness: post.freshness,
      duplicate: post.isDuplicate,
    })
  }

  const candidates = payload.hashtagCandidates ?? []
  const inGroups = new Set(
    (payload.hashtagGroups ?? []).flatMap((g) => g.hashtags.map((h) => h.tag)),
  )

  for (const candidate of candidates) {
    // A tag that did not make its keyword's top 5 is not rejected — it simply
    // was not ranked. It keeps `pending` until a later run promotes it.
    const ranked = inGroups.has(candidate.tag)
    if (!ranked && candidate.duplicateOfTag === null) {
      candidate.validation = 'pending'
      candidate.verdictReason = `Outside the top ${ctx.num('topHashtagsPerKeyword', 5)} for its keyword this run — held, not rejected.`
      continue
    }

    const spaced = candidate.displayTag.replace(/([a-z])([A-Z])/g, '$1 $2')
    const verdict = routeVerdict({
      isDuplicate: candidate.duplicateOfTag !== null,
      relevance: candidate.relevance,
      credibility: candidate.credibility,
      existingReason: candidate.verdictReason,
      label: `#${candidate.displayTag}`,
      evidence: `relevance ${candidate.relevance}%, ${candidate.postCount} posts, ${candidate.engagementPerPost} engagements per post, composite score ${candidate.hashtagScore}`,
      topics: matchedTopics(spaced),
      acceptThreshold,
      rejectThreshold,
      escalateUncertain,
      lowCredibilityAlwaysReviews,
    })
    candidate.validation = verdict.validation
    candidate.verdictReason = verdict.reason
    buckets[verdict.validation] += 1

    ctx.emit('hashtag.validated', `#${candidate.displayTag}`, {
      tag: candidate.tag,
      validation: candidate.validation,
      reason: candidate.verdictReason,
      score: candidate.hashtagScore,
    })
  }

  ctx.emit(
    'activity',
    `Verdicts: ${buckets.validated} validated, ${buckets.needs_review} need review, ${buckets.duplicate} duplicate, ${buckets.rejected} rejected`,
    { status: buckets.needs_review > 0 ? 'warn' : 'ok', ...buckets },
  )
  ctx.log(
    `${buckets.validated} validated · ${buckets.needs_review} needs review · ${buckets.duplicate} duplicate · ${buckets.rejected} rejected`,
  )

  return { posts, hashtagCandidates: candidates, buckets }
})

interface RouteInput {
  isDuplicate: boolean
  relevance: number
  credibility: Confidence
  existingReason: string
  label: string
  evidence: string
  topics: string[]
  acceptThreshold: number
  rejectThreshold: number
  escalateUncertain: boolean
  lowCredibilityAlwaysReviews: boolean
}

/**
 * Strict priority, in this order and no other:
 *   duplicate → rejected (below the floor) → needs_review (low credibility)
 *   → needs_review (between the thresholds) → validated
 *
 * Every branch writes a reason naming the number it rests on. "Low confidence"
 * on its own is a bug, not a reason.
 */
function routeVerdict(input: RouteInput): {
  validation: 'validated' | 'needs_review' | 'duplicate' | 'rejected'
  reason: string
} {
  if (input.isDuplicate) {
    return {
      validation: 'duplicate',
      reason: input.existingReason || `${input.label} duplicates an item already on record. Linked to the original.`,
    }
  }

  if (input.relevance < input.rejectThreshold) {
    const topicNote =
      input.topics.length === 0
        ? 'it touches none of the brand domains'
        : `it only touches ${input.topics.join(', ')}`
    return {
      validation: 'rejected',
      reason: `Relevance is ${input.relevance}%, below the ${input.rejectThreshold}% floor — ${topicNote}. Kept on record with this reason.`,
    }
  }

  if (input.credibility === 'Low') {
    if (input.lowCredibilityAlwaysReviews) {
      return {
        validation: 'needs_review',
        reason: `Credibility reads Low (${input.evidence}). A person should decide this one: the signal is on-topic but the source is thin.`,
      }
    }
    if (!input.escalateUncertain) {
      return {
        validation: 'rejected',
        reason: `Credibility reads Low (${input.evidence}) and escalation is switched off, so it was rejected rather than queued.`,
      }
    }
  }

  if (input.relevance < input.acceptThreshold) {
    if (!input.escalateUncertain) {
      return {
        validation: 'rejected',
        reason: `Relevance is ${input.relevance}%, between the ${input.rejectThreshold}% floor and the ${input.acceptThreshold}% accept line, and escalation is switched off.`,
      }
    }
    return {
      validation: 'needs_review',
      reason: `Relevance is ${input.relevance}%, short of the ${input.acceptThreshold}% accept line (${input.evidence}). ${
        input.topics.length > 0 ? `It does touch ${input.topics.join(', ')}.` : 'It touches no named brand domain.'
      } Your call.`,
    }
  }

  return {
    validation: 'validated',
    reason: `Relevance ${input.relevance}% clears the ${input.acceptThreshold}% accept line with ${input.credibility} credibility${
      input.topics.length > 0 ? `, on ${input.topics.join(', ')}` : ''
    }.`,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 8 · validation.review.queue
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.review.queue', (payload, ctx) => {
  const maxQueueRows = ctx.num('maxQueueRows', 40)

  const requests: ReviewRequest[] = []

  for (const post of payload.posts ?? []) {
    if (post.validation !== 'needs_review') continue
    requests.push({
      kind: 'scraped_item',
      reference: post.externalId,
      title: post.title,
      reason: post.verdictReason,
      decisionRequested: 'Is this on-topic enough for Ethara to build content on?',
      options: ['Approve', 'Reject'],
    })
  }

  for (const candidate of payload.hashtagCandidates ?? []) {
    if (candidate.validation !== 'needs_review') continue
    requests.push({
      kind: 'hashtag',
      reference: candidate.tag,
      title: `#${candidate.displayTag}`,
      reason: candidate.verdictReason,
      decisionRequested: `Should #${candidate.displayTag} join the research set?`,
      options: ['Approve', 'Reject'],
    })
  }

  const capped = requests.slice(0, Math.max(1, maxQueueRows))
  if (capped.length < requests.length) {
    ctx.emit(
      'activity',
      `${requests.length - capped.length} further review item(s) were held back by the ${maxQueueRows}-row queue cap`,
      { status: 'warn' },
    )
  }

  ctx.log(
    capped.length === 0
      ? 'Nothing needs a human verdict from this run'
      : `${capped.length} item(s) queued for a human verdict`,
  )

  return { reviewRequests: capped }
})

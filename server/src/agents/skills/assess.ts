/**
 * THE VALIDATION AND ANALYSIS AGENTS — stage `assess`
 *
 * Validation answers two questions and issues one verdict:
 *   · which keywords are actually trending (take the top 5)
 *   · which hashtags under each of those keywords are worth keeping (top 5 each)
 *   · and then, for every candidate, exactly one of
 *     validated | needs_review | duplicate | rejected — with a reason that
 *     names its evidence.
 *
 * Analysis turns validated signal into ranked opportunities and consolidates the
 * 5×5 hashtags into one global top 25.
 *
 * Two rules run through all of it. Nothing is ever deleted: a duplicate is
 * LINKED to its original. And "low confidence" is never a reason on its own —
 * every verdict names the number it rests on.
 */

import { BRAND, similarity } from '../../../../shared/brand-voice'
import type { Confidence } from '../../../../shared/agent-contract'
import {
  listHashtags,
  listPosts,
  listScrapedItems,
  priorKeywordAverages,
} from '../../db/repo'
import {
  aliasGroupLabel,
  aliasKey,
  angleFor,
  audienceFor,
  clamp,
  contentWords,
  countTopicMatches,
  credibilityBase,
  credibilityLabel,
  engagementLevel,
  FORMATS,
  growthPercent,
  halfLifeScore,
  headlineFrom,
  hoursSince,
  matchedTopics,
  mean,
  normalise,
  normaliseTag,
  rescaleGrowth,
  round,
  seededFor,
  type ContentFormat,
} from '../corpus'
import { registerSkill } from '../runtime'
import type {
  BucketCounts,
  HashtagCandidate,
  KeywordTrend,
  Opportunity,
  PipelinePayload,
  RankedHashtagGroup,
  ReviewRequest,
  ScrapedPost,
} from './index'

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
    return {
      keyword,
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

/**
 * VALIDATION AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `validation`, and `npm run agent:check` fails if not.
 */

import { similarity } from '../../../../shared/brand-voice'
import type { Confidence, ValidationVerdict } from '../../../../shared/agent-contract'
import { SIGNALS_CATEGORY } from '../../../../shared/agent-contract'
import {
  insertDiscoveredKeywords,
  keywordRankHistory,
  listHashtags,
  listKnowledge,
  listScrapedItems,
  priorKeywordAverages,
} from '../../db/repo'
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

  /*
   * WHICH WEIGHT SET SCORES THIS RUN (ADR-009).
   *
   * One implementation, two declared weight sets. `long-form` is what every
   * stored `keyword_signals` row was produced under and stays the default, so
   * switching profiles cannot retroactively change what history meant.
   */
  const weightProfile = ctx.str('weightProfile', 'long-form')
  const shortForm = weightProfile === 'short-form'
  const viewsWeight = ctx.num('viewsWeight', 40)
  const engagementRateWeight = ctx.num('engagementRateWeight', 35)
  const commentVolumeWeight = ctx.num('commentVolumeWeight', 25)
  const highSignalViewFloor = ctx.num('highSignalViewFloor', 100000)

  const weightTotal = shortForm
    ? viewsWeight + engagementRateWeight + commentVolumeWeight
    : volumeWeight + engagementWeight + velocityWeight + growthWeight
  const weightCount = shortForm ? 'three' : 'four'
  let weightWarning: string | undefined
  if (weightTotal !== 100) {
    weightWarning = `The ${weightCount} ${weightProfile} trend weights sum to ${weightTotal}%, not 100%. Scores are normalised against that total, so the ranking still holds — but the numbers will not read as percentages.`
    ctx.emit('activity', weightWarning, { status: 'warn' })
  }
  const divisor = weightTotal === 0 ? 1 : weightTotal

  const priors = await priorKeywordAverages(ctx.workspaceId, trendWindowRuns, payload.runId)

  // Per-keyword aggregates from this run's corpus.
  //
  // VOLUME COUNTS EVERY POST; ENGAGEMENT COUNTS ONLY THE MEASURED ONES.
  //
  // A run mixes two kinds of row. An Apify lane read the platform and states
  // real reaction counts; a crawl4ai lane read a search-indexed page and states
  // none, carrying `metricsAvailable: false` and three zeros that mean "not
  // applicable". Averaging those zeros in would let an open-web page that
  // nobody could measure drag down an engagement figure that WAS measured on
  // LinkedIn — turning a missing number into a bad one, which is exactly what
  // the `N/A is never 0` rule exists to prevent.
  //
  // So volume runs over every post, because being findable is itself the
  // signal; engagement, velocity and growth run over the metric-bearing subset,
  // and the excluded count travels on the row so the reason is legible.
  const aggregates = keywords.map((keyword) => {
    const own = posts.filter((p) => p.keyword === keyword.term)
    const measured = own.filter((p) => p.metricsAvailable)
    const totalEngagement = measured.reduce((t, p) => t + p.engagement, 0)
    const velocity = measured.length === 0 ? 0 : round(mean(measured.map((p) => p.velocity)), 2)
    // The strongest post is only meaningfully "strongest" among those with a
    // stated figure; with none stated, the freshest stands in as the exemplar.
    const ranked = measured.length > 0 ? measured : own
    const topPost =
      [...ranked].sort((a, b) => b.engagement - a.engagement || b.postedAt.localeCompare(a.postedAt))[0] ??
      null
    /*
     * THE SHORT-FORM AXES — the same rule again, on a third kind of absence.
     *
     * Plays are stated by video lanes and by nothing else, so they get their own
     * subset: `viewsAvailable` rows, never `metricsAvailable` ones. A LinkedIn
     * text post with 400 reactions and no play count is measured on engagement
     * and unmeasurable on views, and both facts are true at once.
     *
     * Engagement rate needs BOTH figures, so it runs over the intersection.
     * Comment volume needs only `metricsAvailable`, like engagement does.
     */
    const withViews = own.filter((p) => p.viewsAvailable)
    const rateable = own.filter((p) => p.viewsAvailable && p.metricsAvailable && p.views > 0)
    const totalViews = withViews.reduce((t, p) => t + p.views, 0)
    const totalComments = measured.reduce((t, p) => t + p.comments, 0)
    const engagementRate =
      rateable.length === 0
        ? 0
        : round(
            mean(rateable.map((p) => ((p.reactions + p.comments) / p.views) * 100)),
            2,
          )
    const highSignalCount = withViews.filter((p) => p.views >= highSignalViewFloor).length

    return {
      keyword,
      topPost,
      postCount: own.length,
      measuredCount: measured.length,
      unmeasuredCount: own.length - measured.length,
      totalEngagement,
      avgEngagement: measured.length === 0 ? 0 : round(totalEngagement / measured.length, 2),
      velocity,
      // Short-form aggregates, each with the count of rows it rests on so the
      // reason line can say how thin the evidence is.
      viewsCount: withViews.length,
      totalViews,
      rateableCount: rateable.length,
      engagementRate,
      totalComments,
      highSignalCount,
    }
  })

  /** Whether ANY keyword this run carries engagement — see the scoring note below. */
  const anyKeywordMeasured = aggregates.some((a) => a.measuredCount > 0)
  /** The same question for plays, which is a separate availability entirely. */
  const anyKeywordHasViews = aggregates.some((a) => a.viewsCount > 0)

  const maxPosts = aggregates.reduce((m, a) => Math.max(m, a.postCount), 0)
  const maxEngagement = aggregates.reduce((m, a) => Math.max(m, a.totalEngagement), 0)
  const maxVelocity = aggregates.reduce((m, a) => Math.max(m, a.velocity), 0)
  const maxViews = aggregates.reduce((m, a) => Math.max(m, a.totalViews), 0)
  const maxRate = aggregates.reduce((m, a) => Math.max(m, a.engagementRate), 0)
  const maxComments = aggregates.reduce((m, a) => Math.max(m, a.totalComments), 0)

  const trends: KeywordTrend[] = aggregates.map((agg) => {
    const prior = priors.get(agg.keyword.id)
    const priorAvg = prior?.avgEngagement ?? 0
    const growthPct = prior && prior.runs > 0 ? growthPercent(agg.totalEngagement, priorAvg) : 0

    const volumeScore = normalise(agg.postCount, maxPosts)
    const engagementScore = normalise(agg.totalEngagement, maxEngagement)
    const velocityScore = normalise(agg.velocity, maxVelocity)
    const growthScore = prior && prior.runs > 0 ? rescaleGrowth(growthPct) : 50

    // WHAT TO DO WITH A KEYWORD NOTHING COULD BE MEASURED ON.
    //
    // It has no engagement, velocity or growth — not a zero for each. But the
    // fix depends on whether that absence is a property of the RUN or of the
    // KEYWORD, and the two want opposite treatment:
    //
    //   Uniform absence — no keyword in the run has a single measured post,
    //   because there is no Apify token and every lane read search-indexed
    //   pages. Nothing is comparable on engagement, so the three weights are
    //   dropped from the divisor for everyone. Every keyword is scored on the
    //   same basis and the ranking still means something.
    //
    //   Selective absence — some keywords WERE measured and this one was not.
    //   Renormalising here would let a keyword nobody could measure win an axis
    //   its rivals are judged on, and outrank them on thinner evidence. So the
    //   full divisor stands and the missing components contribute nothing: the
    //   keyword scores low because little is known about it, which is the true
    //   statement. The reason says so rather than leaving it to be inferred.
    const measurable = agg.measuredCount > 0
    const renormalise = !measurable && !anyKeywordMeasured
    const effectiveDivisor = renormalise
      ? Math.max(1, divisor - engagementWeight - velocityWeight - growthWeight)
      : divisor

    const longFormWeighted = measurable
      ? (volumeScore * volumeWeight +
          engagementScore * engagementWeight +
          velocityScore * velocityWeight +
          growthScore * growthWeight) /
        effectiveDivisor
      : (volumeScore * volumeWeight) / effectiveDivisor

    /*
     * THE SHORT-FORM SCORE — the same uniform/selective rule, on plays.
     *
     * Uniform absence: no lane this run stated a play count, so the views axis
     * is dropped from the divisor for EVERY keyword. Each one is judged on
     * engagement rate and comment volume on the same basis, and the ranking
     * still means something.
     *
     * Selective absence: some keywords had plays and this one did not.
     * Renormalising would let a keyword nobody could measure on views win
     * against rivals that were. So the full divisor stands, the views component
     * contributes nothing, and the keyword scores low because less is known
     * about it — which is the true statement, and the reason says it.
     */
    const viewsScore = normalise(agg.totalViews, maxViews)
    const rateScore = normalise(agg.engagementRate, maxRate)
    const commentScore = normalise(agg.totalComments, maxComments)

    const hasViews = agg.viewsCount > 0
    const shortFormDivisor =
      !hasViews && !anyKeywordHasViews ? Math.max(1, divisor - viewsWeight) : divisor

    const shortFormWeighted =
      ((hasViews ? viewsScore * viewsWeight : 0) +
        (agg.rateableCount > 0 ? rateScore * engagementRateWeight : 0) +
        (measurable ? commentScore * commentVolumeWeight : 0)) /
      shortFormDivisor

    const weighted = shortForm ? shortFormWeighted : longFormWeighted

    // Below the floor a keyword has not produced enough evidence to be ranked
    // at all — it keeps its components but cannot claim a trend.
    const trendScore = agg.postCount < minPostsToRank ? 0 : clamp(Math.round(weighted), 0, 100)

    return {
      keywordId: agg.keyword.id,
      term: agg.keyword.term,
      postCount: agg.postCount,
      totalEngagement: agg.totalEngagement,
      // Travels with the total so a consumer can tell "no reactions" from
      // "nothing stated a figure". Constraint 2.
      measuredCount: agg.measuredCount,
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

  const measurementByKeyword = new Map(
    aggregates.map((a) => [
      a.keyword.id,
      {
        measured: a.measuredCount,
        unmeasured: a.unmeasuredCount,
        viewsCount: a.viewsCount,
        totalViews: a.totalViews,
        rateableCount: a.rateableCount,
        engagementRate: a.engagementRate,
        highSignalCount: a.highSignalCount,
        postCount: a.postCount,
      },
    ]),
  )

  const take = clamp(topKeywords, 1, trends.length)
  trends.forEach((trend, index) => {
    trend.rank = index + 1
    trend.isTrending = index < take && trend.trendScore > 0
    // Rule 6: every automated decision names its evidence — including the
    // evidence it did not have. A score built on volume alone must say so, or
    // an operator comparing two keywords is comparing different things without
    // being told.
    const m = measurementByKeyword.get(trend.keywordId)
    const caveat =
      m === undefined || m.unmeasured === 0
        ? ''
        : m.measured > 0
          ? ` Engagement figures come from ${m.measured} of ${m.measured + m.unmeasured} page(s); the other ${m.unmeasured} state none and are excluded from those components.`
          : anyKeywordMeasured
            ? ` Scored on volume alone and therefore ranked below keywords that could be measured: none of its ${m.unmeasured} page(s) came from a source that states engagement, so the engagement, velocity and growth components are empty rather than zero.`
            : ` Scored on volume alone, as was every keyword this run: no lane returned a source that states engagement, so those three weights were set aside rather than counted as zero.`
    /*
     * THE SHORT-FORM CAVEAT, and the high-signal flag.
     *
     * A flag, not a filter: nothing is dropped and nothing is scored
     * differently because a post cleared the play floor. And a keyword with no
     * stated plays is never flagged, because an unflagged keyword has to mean
     * "did not reach the floor" rather than "we could not tell".
     */
    let shortFormNote = ''
    if (shortForm && m !== undefined) {
      const parts: string[] = []
      parts.push(
        m.viewsCount === 0
          ? anyKeywordHasViews
            ? `No page for this keyword stated a play count, so the views component is empty rather than zero and it ranks below keywords that could be measured on plays.`
            : `No lane this run stated a play count, so the views weight was set aside for every keyword rather than counted as zero.`
          : `${m.totalViews.toLocaleString()} play(s) across ${m.viewsCount} of ${m.postCount} page(s).`,
      )
      if (m.rateableCount > 0) {
        parts.push(
          `Engagement rate ${m.engagementRate}% over the ${m.rateableCount} page(s) stating both plays and reactions.`,
        )
      } else {
        parts.push('Engagement rate was not computable: no page stated both plays and reactions.')
      }
      if (m.highSignalCount > 0) {
        parts.push(
          `${m.highSignalCount} page(s) at or above the ${highSignalViewFloor.toLocaleString()}-play high-signal floor.`,
        )
      }
      shortFormNote = ` Scored on the short-form weight set. ${parts.join(' ')}`
    }

    trend.trendReason =
      describeTrend(trend, trends, minPostsToRank) + (shortForm ? shortFormNote : caveat)
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
   VALIDATION 3 · validation.item.filter
   ───────────────────────────────────────────────────────────────────────────
   THE LAW THE SOURCE SPECIFICATION BREAKS HARDEST.

   Its rule is "remove any post with under 10,000 views". In this corpus a post
   captured through the open-web lane carries `viewsAvailable: false` and a zero
   in `views` that means NOT APPLICABLE. Applied naively, that rule deletes
   every open-web capture in the run as underperforming — a whole class of
   evidence destroyed on the strength of a number nobody ever measured.

   So every floor here tests only the candidates that STATE the figure it tests,
   excludes the rest, and says so on the reason. And nothing is removed: a
   candidate that fails a floor gets a verdict and a reason, exactly as the
   "nothing is ever deleted" law requires everywhere else.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.item.filter', (payload, ctx) => {
  const posts = payload.posts ?? []
  if (posts.length === 0) return {}

  const minViews = ctx.num('minViewsToConsider', 10000)
  const minRate = ctx.num('minEngagementRate', 2)
  const windowDays = ctx.num('recencyWindowDays', 30)
  const failedVerdict = ctx.str('failedVerdict', 'rejected') as ValidationVerdict
  const exemptUnmeasured = ctx.bool('exemptUnmeasured', true)

  const now = new Date()
  let failed = 0
  let passed = 0
  let untestedViews = 0
  let untestedRate = 0
  let viral = 0

  for (const post of posts) {
    // A verdict already reached by a stronger rule is not re-litigated. A prior
    // rejection is a decision a human made; a duplicate is already linked.
    if (post.priorRejection !== null || post.isDuplicate) continue

    const failures: string[] = []
    const caveats: string[] = []

    /* ── Plays ─────────────────────────────────────────────────────────────
     * Tested only where a play count was stated. `exemptUnmeasured` off is the
     * naive reading, kept so the difference is demonstrable rather than
     * theoretical — it reads an absent count as zero and fails the row.
     */
    if (minViews > 0) {
      if (post.viewsAvailable) {
        if (post.views < minViews) {
          failures.push(
            `${post.views.toLocaleString()} play(s), below the ${minViews.toLocaleString()} floor`,
          )
        }
      } else if (exemptUnmeasured) {
        untestedViews += 1
        caveats.push('no play count was stated, so the plays floor was not applied')
      } else {
        failures.push(`no play count was stated and unstated figures are being read as zero`)
      }
    }

    /* ── Engagement rate ───────────────────────────────────────────────────
     * Needs BOTH figures. Either one missing makes the rate uncomputable, not
     * low — dividing by an absent denominator is not a small number.
     */
    if (minRate > 0) {
      const computable = post.viewsAvailable && post.metricsAvailable && post.views > 0
      if (computable) {
        const rate = ((post.reactions + post.comments) / post.views) * 100
        if (rate < minRate) {
          failures.push(`${rate.toFixed(2)}% engagement rate, below the ${minRate}% floor`)
        }
      } else if (exemptUnmeasured) {
        untestedRate += 1
        caveats.push(
          'engagement rate was not computable — it needs both a play count and a reaction count, and this item states ' +
            (post.viewsAvailable ? 'no reactions' : post.metricsAvailable ? 'no plays' : 'neither'),
        )
      } else {
        failures.push('engagement rate was not computable and is being read as zero')
      }
    }

    /* ── Recency ───────────────────────────────────────────────────────────
     * The one floor almost every candidate can be tested against. A capture
     * with no stated date took its capture time rather than being dropped, so
     * the reason says which of the two it was judged on.
     */
    const ageDays = hoursSince(post.postedAt, now) / 24
    if (ageDays > windowDays) {
      failures.push(`posted ${Math.round(ageDays)} days ago, outside the ${windowDays}-day window`)
    }

    /* ── THE VIRAL TAG ─────────────────────────────────────────────────────
     *
     * The specification's rule: "flag any post with ER above 5% or views above
     * 100K with a VIRAL tag". Both halves read their own knob, and both are
     * applied ONLY where the figure was stated.
     *
     * A flag, never a verdict: nothing is dropped, promoted or scored
     * differently because of it. And an unflagged post has to mean "did not
     * reach the threshold" rather than "we could not tell", which is exactly
     * why a post with no stated play count is never flagged and never
     * un-flagged — it is simply not eligible, and the reason says so.
     */
    const flags: string[] = []
    const viralRate = ctx.num('viralEngagementRate', 5)
    const highSignalViews = ctx.num('highSignalViewFloor', 100000)

    if (post.viewsAvailable && post.views >= highSignalViews) {
      flags.push('high-signal-views')
    }
    if (post.engagementRate !== null && post.engagementRate >= viralRate) {
      flags.push('viral-er')
    }
    if (flags.length > 0) {
      flags.push('VIRAL')
      viral += 1
    }
    post.signalFlags = flags

    if (failures.length > 0) {
      failed += 1
      post.validation = failedVerdict
      post.verdictReason =
        `Failed the performance floors: ${failures.join('; ')}.` +
        (caveats.length > 0 ? ` Not judged on the rest — ${caveats.join('; ')}.` : '')
    } else {
      passed += 1
      if (caveats.length > 0) {
        // The caveat travels even on a pass. "Survived the floors" and
        // "survived the floors it could actually be tested against" are
        // different claims, and the second is the true one.
        post.verdictReason =
          `Cleared every floor it could be tested against. Caveat: ${caveats.join('; ')}.`
      }
    }
  }

  ctx.log(
    `${passed} cleared the floors, ${failed} failed and were marked ${failedVerdict}` +
      (viral > 0
        ? ` · ${viral} flagged VIRAL (at or above ${ctx.num('viralEngagementRate', 5)}% engagement rate, or ${ctx.num('highSignalViewFloor', 100000).toLocaleString()} plays)`
        : '') +
      (untestedViews > 0 || untestedRate > 0
        ? ` · ${untestedViews} were not tested on plays and ${untestedRate} not on engagement rate, because they state no such figure — they were not failed for it`
        : ''),
  )

  return { posts }
})

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 4 · validation.credibility.score
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
    const topical = clamp(baseRelevance + hits * 14, 0, 100)
    // The Scraping Agent already scored this body against the brand topics AND
    // the live Knowledge Base at capture. Reading that score rather than
    // re-deriving half of it means a page that echoes what the company has
    // actually learned is not marked irrelevant for missing a declared topic
    // word — and it keeps the two agents from disagreeing about the same body.
    post.relevance = Math.max(topical, post.brandRelevance ?? 0)
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
   VALIDATION 7 · validation.duplicate.detect
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.duplicate.detect', async (payload, ctx) => {
  const threshold = ctx.num('similarityThreshold', 62) / 100
  const compareWindow = ctx.num('compareWindow', 30)
  const withinBatch = ctx.bool('withinBatch', true)
  const aliasMapEnabled = ctx.bool('aliasMapEnabled', true)
  const checkKnowledgeBase = ctx.bool('checkKnowledgeBase', true)
  const checkPriorRejections = ctx.bool('checkPriorRejections', true)

  const posts = payload.posts ?? []
  const candidates = payload.hashtagCandidates ?? []

  /* ── Items ─────────────────────────────────────────────────────────────── */

  const priorItems = await listScrapedItems(ctx.workspaceId, { limit: 400 })
  const cutoff = Date.now() - compareWindow * 86_400_000
  const priorInWindow = priorItems.filter(
    (row) => new Date(row.scraped_at).getTime() >= cutoff && row.validation === 'validated',
  )

  // Items a human or the agent rejected before. No time window: a rejection is
  // a decision, and a decision does not expire just because the calendar turned.
  const priorRejected = checkPriorRejections
    ? await listScrapedItems(ctx.workspaceId, { limit: 400, validation: 'rejected' })
    : []

  /*
   * The active Knowledge Base — RESEARCH entries only, and every URL they cite.
   * An item whose citation is already cited by a live entry is already known,
   * and an item whose body closely matches an entry is telling us what we
   * already recorded.
   *
   * WHY THE SIGNAL ENTRIES ARE EXCLUDED, AND WHY THIS IS NOT OPTIONAL.
   *
   * `recordScrapedTopicsAsKnowledge` writes one `Signal · <keyword>` entry per
   * capture, citing the URL of every page it captured. That record is written in
   * the SCRAPING stage, which runs before this one. So on the next line, without
   * this filter, every page in the current run is "already cited by the
   * Knowledge Base" — by the entry the same run created seconds earlier. The
   * effect is total: a 133-item capture came back 133 duplicates, the Analysis
   * Agent received nothing validated, and the calendar filled with nothing.
   *
   * The distinction is real rather than a workaround. A `Signals` entry is a
   * record of WHAT WE SCRAPED; a research entry is a record of WHAT WE LEARNED.
   * Only the second is grounds for calling a fresh page redundant. Filtering on
   * the pair — `origin: 'learned'` AND `category: 'Signals'` — keeps a genuine
   * operator-taught lesson (also `learned`, but never `Signals`) doing its job.
   */
  const knowledgeAll = checkKnowledgeBase
    ? await listKnowledge(ctx.workspaceId, { activeOnly: true, limit: 500 })
    : []
  const knowledge = knowledgeAll.filter(
    (entry) => !(entry.origin === 'learned' && entry.category === SIGNALS_CATEGORY),
  )
  const citedUrls = new Map<string, string>() // url → entry title
  for (const entry of knowledge) {
    for (const src of entry.sources ?? []) {
      if (src.url) citedUrls.set(src.url, entry.title)
    }
  }

  let exact = 0
  let near = 0
  let aliasHits = 0
  let knownAlready = 0
  let priorRejects = 0

  const acceptedInBatch: ScrapedPost[] = []

  for (const post of posts) {
    // Pass 0a — prior rejection: a decision already made, not re-litigated.
    // Highest priority, ahead of the duplicate passes: rejecting a repeat is
    // more informative than linking it to an original that itself was rejected.
    if (checkPriorRejections) {
      const rejectedHit =
        priorRejected.find(
          (row) => row.external_id === post.externalId || (row.url && row.url === post.url),
        ) ??
        priorRejected
          .map((row) => ({ row, score: similarity(post.text, `${row.title} ${row.snippet ?? ''}`) }))
          .sort((a, b) => b.score - a.score)
          .find((m) => m.score >= threshold)?.row

      if (rejectedHit) {
        post.priorRejection = {
          reason: rejectedHit.verdict_reason ?? 'Rejected on an earlier run.',
          title: rejectedHit.title,
          when: rejectedHit.scraped_at,
        }
        priorRejects += 1
        // Not `continue`d: the verdict router reads `priorRejection` first and
        // routes it to rejected, so no further pass can override it — but the
        // item still carries its other signals for the record.
        continue
      }
    }

    // Pass 0b — Knowledge Base: already-known content is a duplicate of what we
    // researched, not new. Cite the entry it matched as its original.
    if (checkKnowledgeBase) {
      const knownByUrl = post.url ? citedUrls.get(post.url) : undefined
      if (knownByUrl) {
        post.isDuplicate = true
        post.verdictReason = `Already in the Knowledge Base — this URL is cited by “${knownByUrl}”. Linked to the entry rather than re-processed.`
        knownAlready += 1
        continue
      }
      const knownByText = knowledge
        .map((entry) => ({ entry, score: similarity(post.text, `${entry.title} ${entry.content}`) }))
        .sort((a, b) => b.score - a.score)[0]
      if (knownByText && knownByText.score >= threshold) {
        post.isDuplicate = true
        post.verdictReason = `${Math.round(knownByText.score * 100)}% similar to the Knowledge Base entry “${knownByText.entry.title}”. Already known — linked to the entry.`
        knownAlready += 1
        continue
      }
    }

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
    `${exact} exact, ${near} near and ${aliasHits} alias duplicate(s) linked · ` +
      `${knownAlready} already in the Knowledge Base · ${priorRejects} matched an earlier rejection — none deleted`,
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
   VALIDATION 8 · validation.signal.repeat
   ───────────────────────────────────────────────────────────────────────────
   "This topic has come up three times." A claim about history, so it is read
   from `keyword_signals` — the rows past runs actually wrote — and never
   inferred from the current run alone.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.signal.repeat', async (payload, ctx) => {
  const trends = payload.trends ?? []
  if (trends.length === 0) return {}

  const repeatSignalCount = ctx.num('repeatSignalCount', 3)
  const lookbackRuns = ctx.num('lookbackRuns', 6)
  const topRankThreshold = ctx.num('topRankThreshold', 5)

  const history = await keywordRankHistory(ctx.workspaceId, lookbackRuns)
  let flagged = 0

  for (const trend of trends) {
    const rows = history.get(trend.keywordId) ?? []
    // This run counts too, when it ranked — the specification's "appearing in
    // top results" includes the results being looked at.
    const appearances = rows.filter((r) => r.rank !== null && r.rank <= topRankThreshold).length
    const thisRun = trend.rank > 0 && trend.rank <= topRankThreshold ? 1 : 0
    const total = appearances + thisRun

    if (total >= repeatSignalCount) {
      flagged += 1
      trend.isRepeatSignal = true
      trend.repeatCount = total
      // Rule 6: the reason names the evidence, which here is the runs
      // themselves — "three times" is only meaningful with a window attached.
      trend.trendReason +=
        ` Repeat signal: ranked in the top ${topRankThreshold} on ${total} of the last ${rows.length + 1} run(s), at or above the ${repeatSignalCount}-appearance threshold.`
    } else {
      trend.isRepeatSignal = false
      trend.repeatCount = total
    }
  }

  ctx.log(
    flagged === 0
      ? `No keyword reached ${repeatSignalCount} top-${topRankThreshold} appearances across the last ${lookbackRuns} runs`
      : `${flagged} repeat signal(s) across the last ${lookbackRuns} runs`,
  )

  return { trends }
})

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 9 · validation.signal.sustained
   ───────────────────────────────────────────────────────────────────────────
   A DIFFERENT CLAIM FROM THE ONE ABOVE, which is why it is a second skill.

   "Three times in six runs" and "in both of the last two runs" are different
   findings: the first is recurrence, the second is that something is holding.
   A topic that ranked in runs 1, 2 and 6 is a repeat signal and is not a
   sustained one, and merging them would let the weaker evidence borrow the
   stronger claim.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.signal.sustained', async (payload, ctx) => {
  const trends = payload.trends ?? []
  if (trends.length === 0) return {}

  const windowCount = ctx.num('sustainedWindowCount', 2)
  const topRankThreshold = ctx.num('topRankThreshold', 10)
  const requireUnbroken = ctx.bool('requireUnbroken', true)

  // One more than the window, because this run is the most recent member of it.
  const history = await keywordRankHistory(ctx.workspaceId, windowCount + 2)
  let flagged = 0

  for (const trend of trends) {
    const rows = history.get(trend.keywordId) ?? []
    // Most recent first: this run, then the prior runs in descending order.
    const sequence = [
      trend.rank > 0 && trend.rank <= topRankThreshold,
      ...rows.map((r) => r.rank !== null && r.rank <= topRankThreshold),
    ]

    let streak = 0
    if (requireUnbroken) {
      for (const held of sequence) {
        if (!held) break
        streak += 1
      }
    } else {
      streak = sequence.slice(0, windowCount).filter(Boolean).length
    }

    if (streak >= windowCount) {
      flagged += 1
      trend.isSustainedSignal = true
      trend.sustainedRuns = streak
      trend.trendReason +=
        ` Sustained trend: held a top-${topRankThreshold} rank in ${streak} ${requireUnbroken ? 'consecutive' : 'of the last ' + String(windowCount)} run(s).`
    } else {
      trend.isSustainedSignal = false
      trend.sustainedRuns = streak
      // Stated rather than left silent: "not sustained" with no window attached
      // is unreadable, and a keyword with no history at all has not failed the
      // test — it has not been able to take it.
      if (rows.length === 0) {
        trend.trendReason +=
          ' No prior run to compare against, so a sustained trend could not be established either way.'
      }
    }
  }

  ctx.log(
    flagged === 0
      ? `No keyword held a top-${topRankThreshold} rank across ${windowCount} run(s)`
      : `${flagged} sustained trend(s) across ${windowCount} run(s)`,
  )

  return { trends }
})


/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 10 · validation.keyword.emerge
   ───────────────────────────────────────────────────────────────────────────
   Scores what `scraping.keyword.discover` found and decides what is worth
   keeping. It PROPOSES: a stored candidate is inactive unless `autoActivate`
   is on, because a keyword is not a label — it is an instruction to spend money
   on every lane, every run (ADR-012).

   Scoring reuses the existing axes exactly, including their absences. Volume
   runs over every post carrying the term; engagement runs over the
   metric-bearing subset; plays run over the view-bearing subset. A term
   surfaced entirely by open-web captures scores on volume and says so, rather
   than being penalised for a figure that was never stated.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('validation.keyword.emerge', async (payload, ctx) => {
  const candidates = payload.keywordCandidates ?? []
  if (candidates.length === 0) return {}

  const threshold = ctx.num('emergenceThreshold', 45)
  const maxPromotions = ctx.num('maxPromotionsPerRun', 5)
  const autoActivate = ctx.bool('autoActivate', false)
  const newTermWeight = ctx.num('newTermWeight', 45)
  const category = ctx.str('category', 'Adjacent')

  // Normalised WITHIN this run's candidate set, like every other score in the
  // Validation Agent. An absolute scale would make a quiet week's best
  // discovery look like a failure and a loud week's worst look like a finding.
  const maxPosts = candidates.reduce((m, c) => Math.max(m, c.posts), 0)
  const maxAuthors = candidates.reduce((m, c) => Math.max(m, c.distinctAuthors), 0)
  const maxEngagement = candidates.reduce(
    (m, c) => Math.max(m, c.measuredPosts > 0 ? c.totalEngagement / c.measuredPosts : 0),
    0,
  )

  const anyMeasured = candidates.some((c) => c.measuredPosts > 0)

  const scored = candidates.map((candidate) => {
    const volumeScore = normalise(candidate.posts, maxPosts)
    const authorScore = normalise(candidate.distinctAuthors, maxAuthors)
    const perPost = candidate.measuredPosts > 0 ? candidate.totalEngagement / candidate.measuredPosts : 0
    const engagementScore = normalise(perPost, maxEngagement)
    const relevanceScore = candidate.brandRelevance

    /*
     * THE SAME UNIFORM/SELECTIVE RULE the trend scorer applies, on a third set
     * of axes. When NO candidate this run carries engagement, the axis is
     * dropped from the divisor for everyone and the remaining three are scored
     * on the same basis. When some were measured and this one was not, the full
     * divisor stands and the missing component contributes nothing — so the
     * candidate scores lower because less is known about it, which is the true
     * statement rather than a penalty.
     */
    const measurable = candidate.measuredPosts > 0
    const renormalise = !measurable && !anyMeasured
    const weights = { volume: 35, authors: 20, engagement: 25, relevance: 20 }
    const divisor = renormalise
      ? weights.volume + weights.authors + weights.relevance
      : weights.volume + weights.authors + weights.engagement + weights.relevance

    const emergenceScore = clamp(
      Math.round(
        (volumeScore * weights.volume +
          authorScore * weights.authors +
          (measurable ? engagementScore * weights.engagement : 0) +
          relevanceScore * weights.relevance) /
          divisor,
      ),
      0,
      100,
    )

    // Rule 6: the reason names the evidence, including the evidence it lacked.
    const engagementClause = measurable
      ? `averaging ${Math.round(perPost)} engagements across the ${candidate.measuredPosts} post(s) that stated any`
      : anyMeasured
        ? 'with no post stating engagement, so that component is empty rather than zero and it ranks below candidates that could be measured'
        : 'with no post this run stating engagement, so that axis was set aside for every candidate'

    const viewClause =
      candidate.viewedPosts > 0
        ? ` ${candidate.totalViews.toLocaleString()} play(s) across ${candidate.viewedPosts} post(s).`
        : ''

    const emergenceReason =
      `Surfaced by the corpus, not seeded: appeared in ${candidate.posts} captured post(s) ` +
      `from ${candidate.distinctAuthors} distinct author(s), ${engagementClause}, ` +
      `at ${candidate.brandRelevance}% mean brand alignment.${viewClause}` +
      (candidate.examples.length > 0 ? ` Example: ${candidate.examples[0]}` : '')

    return { ...candidate, emergenceScore, emergenceReason }
  })

  scored.sort((a, b) => b.emergenceScore - a.emergenceScore)

  const clearing = scored.filter((c) => c.emergenceScore >= threshold)
  const promoted = clearing.slice(0, Math.max(1, maxPromotions))
  const heldBack = clearing.length - promoted.length

  const stored = await insertDiscoveredKeywords(
    ctx.workspaceId,
    promoted.map((c) => ({
      term: c.term,
      category,
      weight: newTermWeight,
      // ADR-012: inactive unless the operator has explicitly opted in. Discovery
      // proposes; a human disposes.
      active: autoActivate,
      emergenceScore: c.emergenceScore,
      reason: c.emergenceReason,
      runId: payload.runId,
    })),
  )

  for (const row of stored) {
    ctx.emit(
      'activity',
      `New keyword “${row.term}” ${row.active ? 'discovered and switched on' : 'discovered — waiting for approval'} · score ${row.emergence_score ?? 0}`,
      { status: 'ok', term: row.term, active: row.active, score: row.emergence_score },
    )
  }

  ctx.log(
    stored.length === 0
      ? `No candidate reached the ${threshold}% emergence bar. Strongest was “${scored[0]?.term ?? 'none'}” at ${scored[0]?.emergenceScore ?? 0}%.`
      : `${stored.length} keyword(s) discovered: ${stored.map((r) => `${r.term} (${r.emergence_score ?? 0})`).join(', ')}` +
        (autoActivate
          ? ' — switched on, so the next run captures them.'
          : ' — stored inactive. Switch them on under Settings → Keywords to start capturing them.') +
        (heldBack > 0 ? ` ${heldBack} more cleared the bar but sat outside the ${maxPromotions}-per-run ceiling.` : ''),
  )

  return {
    keywordCandidates: scored,
    discoveredKeywords: stored.map((r) => ({
      id: r.id,
      term: r.term,
      score: r.emergence_score ?? 0,
      active: r.active,
    })),
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   VALIDATION 11 · validation.verdict.route
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
  // Items and hashtags are judged by the same rules but are different
  // things, and the theater's four buckets count items. Folding hashtag
  // verdicts into the same totals made the run's own note contradict the
  // buckets beside it.
  const hashtagBuckets: BucketCounts = { validated: 0, needs_review: 0, duplicate: 0, rejected: 0 }

  const posts = payload.posts ?? []
  for (const post of posts) {
    const verdict = routeVerdict({
      isDuplicate: post.isDuplicate,
      priorRejection: post.priorRejection,
      relevance: post.relevance,
      credibility: post.credibility,
      existingReason: post.verdictReason,
      label: `“${post.title}”`,
      // Constraint 2: a source that states no reaction count has none, and
      // “0 engagements” would read as a performance verdict rather than as an
      // absent measurement.
      evidence:
        `relevance ${post.relevance}%, credibility ${post.credibility} (${post.credibilityScore}), ` +
        (post.metricsAvailable
          ? `${post.engagement} engagements`
          : 'engagement not stated by the source'),
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
    hashtagBuckets[verdict.validation] += 1

    ctx.emit('hashtag.validated', `#${candidate.displayTag}`, {
      tag: candidate.tag,
      validation: candidate.validation,
      reason: candidate.verdictReason,
      score: candidate.hashtagScore,
    })
  }

  ctx.emit(
    'activity',
    posts.length === 0
      ? `No items reached scoring this run. Hashtags: ${describe(hashtagBuckets)}`
      : `Items: ${describe(buckets)} · Hashtags: ${describe(hashtagBuckets)}`,
    {
      status: buckets.needs_review > 0 || hashtagBuckets.needs_review > 0 ? 'warn' : 'ok',
      items: posts.length,
      ...buckets,
      hashtags: hashtagBuckets,
    },
  )
  ctx.log(
    `Items ${buckets.validated} validated · ${buckets.needs_review} needs review · ${buckets.duplicate} duplicate · ${buckets.rejected} rejected` +
      ` · hashtags ${hashtagBuckets.validated} validated · ${hashtagBuckets.needs_review} needs review · ${hashtagBuckets.duplicate} duplicate · ${hashtagBuckets.rejected} rejected`,
  )

  return { posts, hashtagCandidates: candidates, buckets, hashtagBuckets }
})

function describe(b: BucketCounts): string {
  return `${b.validated} validated, ${b.needs_review} need review, ${b.duplicate} duplicate, ${b.rejected} rejected`
}

interface RouteInput {
  isDuplicate: boolean
  priorRejection?: { reason: string; title: string; when: string } | null
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
 *   prior rejection → duplicate → rejected (below the floor) → needs_review
 *   (low credibility) → needs_review (between the thresholds) → validated
 *
 * Every branch writes a reason naming the number it rests on. "Low confidence"
 * on its own is a bug, not a reason.
 */
function routeVerdict(input: RouteInput): {
  validation: 'validated' | 'needs_review' | 'duplicate' | 'rejected'
  reason: string
} {
  // A decision a human already made comes first — a repeat of a rejected item
  // is rejected again with the original reason rather than re-queued.
  if (input.priorRejection) {
    return {
      validation: 'rejected',
      reason: `Rejected before as “${input.priorRejection.title}” — ${input.priorRejection.reason} Rejected again on the same grounds rather than re-queued.`,
    }
  }

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

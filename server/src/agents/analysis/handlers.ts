/**
 * ANALYSIS AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `analysis`, and `npm run agent:check` fails if not.
 */

import { BRAND, similarity } from '../../../../shared/brand-voice'
import { insertListenerReport, latestListenerReport, listPosts } from '../../db/repo'
import { socialFetchConfigured, socialFetchUnavailableReason } from '../../integrations/socialfetch'
import { runSocialListener, type ListenerPlatform, type SocialMediaListener } from './social-listener'
import { runCompetitorIntel, type CompetitorIntelConfig } from './competitor-intel'
import { loadBridgeConfig } from '../../bridges/claude-bridge/config'
import type { SkillContext } from '../../../../shared/agent-contract'
import { angleFor, audienceFor, clamp, countTopicMatches, engagementLevel, EDITORIAL_FORMATS, headlineFrom, mean, seededFor, type EditorialFormat } from '../corpus'
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
    /*
     * A CLUSTER WHOSE SEED HAS NO PROSE IS NOT AN OPPORTUNITY.
     *
     * `headlineFrom` returns empty when a body carries nothing but hashtags and
     * emoji, which real platform capture does produce. Forming an opportunity
     * from one stored an idea with a zero-length title — it reached the calendar,
     * where it rendered as a blank card that could still be scheduled and
     * published. Dropped here, at the point the title is derived, rather than
     * patched with a placeholder further down: a made-up title would be
     * fabricated evidence about what the source said.
     */
    .filter((c) => headlineFrom(c.seed.text, 12) !== '')
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
        /*
         * The mean of what capture actually measured on these pages.
         *
         * Every member carries a `brandRelevance` scored at capture against the
         * brand topics AND the live Knowledge Base. Averaging the cluster's own
         * members keeps that evidence attached to the opportunity, which is what
         * lets `analysis.brand.fit` produce a real number instead of a step.
         */
        capturedRelevance:
          cluster.members.length === 0
            ? 0
            : Math.round(
                cluster.members.reduce((sum, m) => sum + (m.brandRelevance ?? 0), 0) /
                  cluster.members.length,
              ),
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

/**
 * SUBJECTS THAT ARE SOMEBODY ELSE'S POST, NOT A TOPIC WE CAN WRITE ABOUT.
 *
 * The corpus is other people's LinkedIn and Instagram posts, so it contains job
 * ads, certification announcements, personal model reviews and event promotion
 * alongside actual research discussion. Those mention our vocabulary — a job ad
 * for an "AI agent engineer" hits `agent` and `AI` — so they clear a keyword
 * based brand-fit score and become Ethara post ideas. The observed result was a
 * More suggestions list holding "Hire a hands-on generative AI engineer with
 * seven to ten years" and "Share insights from passing the Azure AI Apps
 * certification".
 *
 * Brand fit cannot catch these because they ARE on-topic; what disqualifies them
 * is that the subject is an announcement about a person or a company rather than
 * a finding about the world. That is a different test, so it is a different
 * filter, and it is declared here rather than hidden in a score.
 */
const NON_EDITORIAL_SUBJECT: Array<{ label: string; pattern: RegExp }> = [
  { label: 'recruitment', pattern: /\b(hir(e|ing)|we'?re hiring|apply now|job opening|open role|vacancy|candidates?|years of experience|résumé|resume|recruit)\b/i },
  { label: 'credential', pattern: /\b(certifica(te|tion)|certified|passed the|earned my|completed my|badge|diploma|graduat(ed|ion))\b/i },
  { label: 'self-promotion', pattern: /\b(i reviewed|i built|my new|check out my|excited to (share|announce)|proud to (share|announce)|thrilled to|happy to share|i'?m joining)\b/i },
  { label: 'event promotion', pattern: /\b(register now|sign up now|join us|webinar|livestream|our booth|see you at|save the date|don'?t miss)\b/i },
  { label: 'engagement bait', pattern: /\b(giveaway|tag someone|follow for more|like and share|link in bio|dm me|comment below)\b/i },
]

registerSkill<PipelinePayload>('analysis.brand.fit', (payload, ctx) => {
  const minBrandFit = ctx.num('minBrandFit', 45)
  const requireDomainMatch = ctx.bool('requireDomainMatch', false)
  const dropNonEditorial = ctx.bool('dropNonEditorial', true)
  const titleMergeThreshold = ctx.num('titleMergeThreshold', 70) / 100

  const opportunities = payload.opportunities ?? []
  const kept: Opportunity[] = []
  let dropped = 0
  let nonEditorial = 0
  let merged = 0

  for (const opportunity of opportunities) {
    const text = `${opportunity.title} ${opportunity.description} ${opportunity.sourceTopic}`

    /*
     * Checked before the score, because no score should be able to rescue it. A
     * job ad is not a post we can write, however many brand words it contains.
     */
    if (dropNonEditorial) {
      const match = NON_EDITORIAL_SUBJECT.find((rule) => rule.pattern.test(text))
      if (match) {
        nonEditorial += 1
        dropped += 1
        ctx.log(
          `Dropped “${opportunity.title.slice(0, 60)}” — the subject is ${match.label}, not a finding we can write about`,
        )
        continue
      }
    }

    const domainHits = BRAND.domains.filter((d) =>
      text.toLowerCase().includes(d.toLowerCase()),
    )
    const topicHits = countTopicMatches(text)

    /*
     * THE SCORE IS MEASURED, NOT STEPPED.
     *
     * This was `42 + topicHits * 11 + domainHits * 9`. Both terms are small
     * integer counts, so the result could only ever land on `42 + 11k + 9m` —
     * and across fifty-four stored LinkedIn ideas it produced exactly five
     * distinct values, four of them plain multiples of eleven: 64, 75, 86, 97.
     * The card presented that as "BRAND 86" out of 100, which claims a precision
     * the number does not have and reads as identical on most posts.
     *
     * The evidence for this already existed and was being ignored. Every captured
     * page is scored 0-100 at capture against the brand topic set AND the live
     * Knowledge Base, and those scores are genuinely continuous — thirty-six
     * distinct values between 24 and 100 across the validated corpus. The cluster
     * carries the mean of its own members as `capturedRelevance`.
     *
     * So the measured mean leads, and the keyword signal adjusts it. The keyword
     * terms are kept because they test something the page score cannot: whether
     * the TITLE AND ANGLE this opportunity will be written from are on-brand, not
     * merely the pages behind it. They move the number rather than define it.
     */
    const measured = clamp(opportunity.capturedRelevance, 0, 100)
    // Saturating rather than linear: the difference between touching one brand
    // topic and touching two is large, between five and six is not.
    const topicSignal = 100 * (1 - Math.exp(-0.55 * topicHits))
    const domainSignal = 100 * (1 - Math.exp(-0.7 * domainHits.length))

    opportunity.brandRelevance = clamp(
      Math.round(
        measured * 0.62 +
          topicSignal * 0.26 +
          domainSignal * 0.12,
      ),
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

    /*
     * NEAR-IDENTICAL TITLES ARE ONE IDEA, NOT TWO SUGGESTIONS.
     *
     * `analysis.trend.cluster` merges on the POST text, which leaves two posts
     * that made the same point in different words as two clusters — and the
     * titles derived from them then differ only by phrasing. The list carried
     * "An AI agent optimizes for the reward it is given, not the outcome you
     * intended" beside "An AI agent will optimise for the reward you give it,
     * not the outcome you wanted": one claim, two slots, and an operator reading
     * More suggestions sees the same post twice.
     *
     * So titles are compared once they exist. The first occurrence wins, which
     * keeps selection deterministic; the second is folded away rather than
     * ranked, and the merge is reported.
     */
    const twin = kept.find(
      (existing) => similarity(existing.title, opportunity.title) >= titleMergeThreshold,
    )
    if (twin) {
      merged += 1
      ctx.log(
        `Merged “${opportunity.title.slice(0, 52)}” into “${twin.title.slice(0, 52)}” — ${Math.round(
          similarity(twin.title, opportunity.title) * 100,
        )}% the same claim`,
      )
      continue
    }

    kept.push(opportunity)
  }

  ctx.log(
    `${kept.length} opportunit${kept.length === 1 ? 'y' : 'ies'} clear the ${minBrandFit}% brand-fit floor` +
      (dropped > 0 ? `, ${dropped} did not` : '') +
      (nonEditorial > 0 ? ` (${nonEditorial} were recruitment, credential or promotional posts)` : '') +
      (merged > 0 ? `, ${merged} folded into a near-identical idea` : ''),
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

  const biasBoost: Record<string, Partial<Record<EditorialFormat, number>>> = {
    Balanced: {},
    'Favour long-form': { 'Thought Leadership': 18, 'Case Study': 12 },
    'Favour short-form': { 'Short Post': 20 },
    'Favour visual': { Carousel: 20, Video: 14 },
  }
  const boosts = biasBoost[bias] ?? {}

  for (const opportunity of opportunities) {
    const words = opportunity.description.split(/\s+/).length
    const scores = new Map<EditorialFormat, number>()

    for (const format of EDITORIAL_FORMATS) {
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
    opportunity.format = (best?.[0] ?? 'Thought Leadership') as EditorialFormat
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

/* ═══════════════════════════════════════════════════════════════════════════
   9 · analysis.social.listen — THE SOCIAL MEDIA LISTENER
   ═══════════════════════════════════════════════════════════════════════════

   What is happening around Ethara.AI on social media, and what are people
   saying about the company? SocialFetch supplies the data (the only source);
   the computation is in `social-listener/`; Claude reads the comments and
   writes the insights from computed facts. Non-critical: a failure here is
   recorded and never stops the rest of the Analysis Agent.
*/

registerSkill<PipelinePayload>('analysis.social.listen', async (payload, ctx) => {
  const refreshHours = ctx.num('refreshHours', 24)
  if (payload.listenerForceRefresh !== true && refreshHours > 0) {
    const latest = await latestListenerReport<SocialMediaListener>(ctx.workspaceId)
    if (latest && Date.now() - Date.parse(latest.created_at) < refreshHours * 3_600_000) {
      ctx.log(`Social Media Listener: reusing the report from ${latest.created_at} (younger than ${refreshHours} h) — no SocialFetch call made.`)
      return { socialMediaListener: latest.report }
    }
  }
  if (!socialFetchConfigured()) throw new Error(socialFetchUnavailableReason() ?? 'SocialFetch is not configured.')

  const company = ctx.str('company', 'Ethara.AI')
  const platforms: ListenerPlatform[] = [
    ...(ctx.bool('includeLinkedin', true) ? (['linkedin'] as const) : []),
    ...(ctx.bool('includeInstagram', true) ? (['instagram'] as const) : []),
    ...(ctx.bool('includeFacebook', true) ? (['facebook'] as const) : []),
    ...(ctx.bool('includeX', true) ? (['x'] as const) : []),
  ]
  ctx.emit('activity', `Social Media Listener: reading ${company} on ${platforms.length} platform(s) through SocialFetch`, { status: 'running' })

  const report = await runSocialListener({
    company,
    targets: {
      linkedin: ctx.str('linkedinPage', ''),
      instagram: ctx.str('instagramHandle', ''),
      facebook: ctx.str('facebookPage', ''),
      x: ctx.str('xHandle', ''),
    },
    platforms,
    postsPerPlatform: ctx.num('postsPerPlatform', 10),
    commentPostsPerPlatform: ctx.num('commentPostsPerPlatform', 4),
    commentsPerPost: ctx.num('commentsPerPost', 20),
    topPosts: ctx.num('topPostsCount', 3),
    lowestPosts: ctx.num('lowestPostsCount', 2),
    includeReposts: ctx.bool('includeReposts', true),
    claude: {
      enabled: ctx.bool('claudeAnalysis', true),
      model: ctx.str('claudeModel', 'sonnet'),
      maxBudgetUsd: ctx.num('claudeBudgetCents', 50) / 100,
      timeoutMs: 180_000,
      batchSize: ctx.num('claudeBatchSize', 40),
    },
    glassdoor: {
      enabled: ctx.bool('includeGlassdoor', true),
      employer: ctx.str('glassdoorEmployer', 'Ethara.AI'),
      reviewLimit: ctx.num('glassdoorReviewLimit', 15),
    },
  })

  for (const p of Object.values(report.platforms)) {
    ctx.emit(
      'activity',
      p.status === 'ok'
        ? `Social Media Listener · ${p.label}: ${p.posts_analyzed} post(s), ${p.comments_analyzed} comment(s)`
        : `Social Media Listener · ${p.label}: ${p.reason ?? p.status}`,
      { status: p.status === 'ok' ? 'ok' : 'warn', platform: p.platform },
    )
  }
  if (report.glassdoor) {
    const g = report.glassdoor
    ctx.emit(
      'activity',
      g.status === 'ok'
        ? `Social Media Listener · Glassdoor: ${g.overall_rating ?? '—'}/5 from ${g.reviews_analyzed} review(s) read`
        : `Social Media Listener · Glassdoor: ${g.reason ?? g.status}`,
      { status: g.status === 'ok' ? 'ok' : 'warn' },
    )
  }
  ctx.log(
    `Social Media Listener: ${report.sample_size.posts} posts and ${report.sample_size.comments} comments analysed across ` +
      `${report.sample_size.platforms_with_data} platform(s) · ${report.credits_used} SocialFetch credit(s)` +
      (report.glassdoor?.status === 'ok' ? ` · Glassdoor ${report.glassdoor.overall_rating ?? '—'}/5 (${report.glassdoor.credits_used} FetchLayer credit(s))` : '') +
      (report.claude_cost_usd > 0 ? ` · Claude $${report.claude_cost_usd}` : ''),
  )

  await insertListenerReport(ctx.workspaceId, report, {
    pipelineRunId: ctx.runId ?? null,
    trigger: payload.listenerForceRefresh === true ? 'manual' : 'pipeline',
    creditsUsed: report.credits_used,
  })
  return { socialMediaListener: report }
})

/* ═══════════════════════════════════════════════════════════════════════════
   10 · analysis.competitor.intel — COMPETITOR INTELLIGENCE
   ═══════════════════════════════════════════════════════════════════════════

   The competitor-profiling skill (coreyhaines31/marketingskills) as the
   methodology; the SMA's universe, sources, storage and history. Inside a
   pipeline run it profiles at most `maxCompetitorsPerPipelineRun` DUE
   competitors (zero by default — a universe takes many minutes); the tab's Run
   action passes `competitorIds` and `competitorForce`. Non-critical.
*/

export function competitorIntelConfig(ctx: Pick<SkillContext, 'num' | 'bool' | 'str'>, depthOverride?: 'quick' | 'deep'): CompetitorIntelConfig {
  const depth = depthOverride ?? (ctx.str('depth', 'quick') === 'deep' ? 'deep' : 'quick')
  const model = ctx.str('claudeModel', 'sonnet')
  return {
    depth,
    maxPagesPerCompetitor: Math.max(1, ctx.num('maxPagesPerCompetitor', 5) + (depth === 'deep' ? 3 : 0)),
    maxCharsPerPage: depth === 'deep' ? 9_000 : 6_000,
    newsWindowDays: ctx.num('newsWindowDays', 30),
    maxNewsItems: ctx.num('maxNewsItems', 8),
    includeSeo: ctx.bool('includeSeo', true),
    includeReviews: ctx.bool('includeReviews', true),
    concurrency: ctx.num('concurrency', 2),
    runMarketAnalysis: ctx.bool('runMarketAnalysis', true),
    profileClaude: { model, maxBudgetUsd: ctx.num('claudeBudgetCents', 60) / 100, timeoutMs: 360_000 },
    marketClaude: { model, maxBudgetUsd: ctx.num('marketBudgetCents', 120) / 100, timeoutMs: 480_000 },
    userAgent: loadBridgeConfig().page_metadata.user_agent,
  }
}

registerSkill<PipelinePayload>('analysis.competitor.intel', async (payload, ctx) => {
  const explicit = payload.competitorIds ?? []
  const perRun = payload.competitorForce === true ? 100 : ctx.num('maxCompetitorsPerPipelineRun', 0)
  if (explicit.length === 0 && perRun <= 0) {
    ctx.log('Competitor Intelligence: not run inside the pipeline (Due competitors per pipeline run is 0) — run it from Analysis → Competitor Intelligence.')
    return {}
  }
  const cfg = competitorIntelConfig(ctx, payload.competitorDepth)
  ctx.emit('activity', `Competitor Intelligence: ${explicit.length > 0 ? `${explicit.length} competitor(s)` : 'due competitors'} · ${cfg.depth} scan`, { status: 'running' })
  const result = await runCompetitorIntel(
    ctx.workspaceId,
    cfg,
    explicit.length > 0 ? { competitorIds: explicit } : { onlyDue: true, maxCompetitors: perRun },
    (m) => ctx.emit('activity', m, { status: 'running' }),
  )
  ctx.log(`Competitor Intelligence: ${result.profiled} profile(s) written · Claude $${result.costUsd.toFixed(2)}${result.errors.length > 0 ? ` · ${result.errors.length} issue(s): ${result.errors.slice(0, 3).join(' | ')}` : ''}`)
  return {}
})

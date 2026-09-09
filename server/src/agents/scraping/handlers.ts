/**
 * THE SCRAPING AGENT — stage `discover`
 *
 * Reads the keyword set, asks Apify what LinkedIn has been saying about each
 * term, harvests the hashtags out of those bodies, and takes an independent
 * reading of the strongest tags from their own feeds.
 *
 * Every external call goes through an adapter with a fixture fallback, and every
 * artefact is stamped with which implementation produced it. With an empty
 * `.env` this agent produces a complete, believable corpus and says so.
 */

import { GENERIC_HASHTAGS } from '../../../../shared/brand-voice'
import { synonymsFor } from '../../../../shared/keywords'
import type { SkillContext } from '../../../../shared/agent-contract'
import { config } from '../../config'
import {
  apifyFixtureCompetitorPosts,
  apifyFixtureHashtagFeed,
  apifyFixturePosts,
  apifyHashtagFeed,
  apifyPostSearch,
  apifyProfilePosts,
  extractHashtagsFromText,
  mapWithConcurrency,
  withFallback,
  type RawPost,
} from '../../integrations'
import { prepareEvidence } from '../../../../packages/runtime/src/evidence'
import { COMPETITORS } from '../../integrations/fixtures/competitors'
import { listKeywords, listSources, recentExternalIds } from '../../db/repo'
import {
  clampChars,
  credibilityBase,
  credibilityLabel,
  engagementOf,
  headlineFrom,
  hoursSince,
  normalise,
  normaliseTag,
  velocityOf,
} from '../corpus'
import { registerSkill } from '../runtime'
import type {
  CompetitorPostRecord,
  HashtagCandidate,
  PipelinePayload,
  ResolvedKeyword,
  ScrapedPost,
  SourceConnection,
} from '../skills/index'

const GENERIC_SET = new Set(GENERIC_HASHTAGS.map((t) => normaliseTag(t)))

/* ═══════════════════════════════════════════════════════════════════════════
   1 · scraping.keyword.resolve
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.keyword.resolve', async (payload, ctx) => {
  const maxKeywords = ctx.num('maxKeywordsPerRun', 12)
  const minWeight = ctx.num('minWeight', 40)
  const expand = ctx.bool('expandSynonyms', true)

  const all = await listKeywords(ctx.workspaceId, true)

  // A scoped run (Ethara: "run discovery on RLHF") narrows the set but still
  // honours the weight floor, so the operator gets the same quality bar.
  const scoped =
    payload.keywordIds && payload.keywordIds.length > 0
      ? all.filter((k) => payload.keywordIds?.includes(k.id))
      : all

  const eligible = scoped
    .filter((k) => k.weight >= minWeight)
    .sort((a, b) => b.weight - a.weight)
    .slice(0, Math.max(1, maxKeywords))

  const keywords: ResolvedKeyword[] = eligible.map((k) => ({
    id: k.id,
    term: k.term,
    category: k.category,
    weight: k.weight,
    synonyms: expand ? synonymsFor(k.term) : [],
  }))

  const belowFloor = scoped.length - eligible.length
  ctx.log(
    `${keywords.length} keyword${keywords.length === 1 ? '' : 's'} resolved` +
      (belowFloor > 0 ? `, ${belowFloor} below the ${minWeight}% weight floor` : ''),
  )

  return { keywords }
})

/* ═══════════════════════════════════════════════════════════════════════════
   2 · scraping.source.connect
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.source.connect', async (_payload, ctx) => {
  const failIfNoSource = ctx.bool('failIfNoSource', false)

  const configured = apifyPostSearch.isConfigured()
  const mode: 'live' | 'fixture' = configured ? 'live' : 'fixture'
  const rows = await listSources(ctx.workspaceId)

  const sources: SourceConnection[] = rows
    .filter((s) => s.enabled)
    .map((s) => ({
      name: s.name,
      kind: s.kind,
      sourceType: s.source_type,
      reachable: configured || s.kind !== 'linkedin',
      reason: configured ? 'Configured' : apifyPostSearch.unavailableReason(),
    }))

  const unreachable = configured ? [] : [apifyPostSearch.label]

  if (!configured) {
    const reason = apifyPostSearch.unavailableReason()
    // Fail in the open: name the reason, switch the run to fixtures, carry on.
    ctx.emit('activity', `Apify is not configured — ${reason}. Running on the bundled LinkedIn corpus.`, {
      status: 'warn',
      mode,
      reason,
    })
    if (failIfNoSource) {
      throw new Error(
        `No live source available — ${reason}. Switch off "Fail when no source is reachable" to run on the bundled corpus.`,
      )
    }
  } else {
    ctx.log(`Apify reachable · ${config.apify.postsActor}`)
  }

  return { mode, sources, unreachable }
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · scraping.linkedin.fetch
   ═══════════════════════════════════════════════════════════════════════════ */

function toScrapedPost(
  raw: RawPost,
  keywordId: string | null,
  captureSource: 'live' | 'fixture',
  fallbackReason: string | undefined,
  sourceType: string,
): ScrapedPost {
  const engagement = engagementOf(raw)
  return {
    externalId: raw.externalId,
    text: raw.text,
    title: headlineFrom(raw.text, 14),
    snippet: clampChars(raw.text.replace(/\s+/g, ' ').trim(), 240),
    authorName: raw.authorName,
    authorHeadline: raw.authorHeadline,
    authorFollowers: raw.authorFollowers,
    url: raw.url,
    postedAt: raw.postedAt,
    reactions: raw.reactions,
    comments: raw.comments,
    reposts: raw.reposts,
    hashtags: raw.hashtags.length > 0 ? raw.hashtags : extractHashtagsFromText(raw.text),
    keyword: raw.keyword,
    keywordId,
    sourceName: raw.sourceName,
    sourceType,
    engagement,
    engagementScore: 0,
    velocity: 0,
    captureSource,
    ...(fallbackReason === undefined ? {} : { fallbackReason }),
    relevance: 0,
    credibility: 'Medium',
    credibilityScore: 55,
    freshness: 0,
    isDuplicate: false,
    duplicateOfExternalId: null,
    validation: 'pending',
    verdictReason: '',
  }
}

registerSkill<PipelinePayload>('scraping.linkedin.fetch', async (payload, ctx) => {
  const keywords = payload.keywords ?? []
  if (keywords.length === 0) throw new Error('No keywords resolved — nothing to fetch.')

  const maxItems = ctx.num('maxItemsPerKeyword', 50)
  const datePosted = ctx.str('datePosted', 'past-week') as 'past-24h' | 'past-week' | 'past-month'
  const sortBy = ctx.str('sortBy', 'date') as 'relevance' | 'date'
  const retries = ctx.num('retries', 2)
  const minAuthorFollowers = ctx.num('minAuthorFollowers', 0)
  const maxParallel = Math.max(1, ctx.num('maxParallel', 4))
  const runOffset = payload.runOffset ?? 0
  const now = new Date()

  const fallbackReasons: string[] = []
  let anyLive = false

  const perKeyword = await mapWithConcurrency(keywords, maxParallel, async (keyword) => {
    ctx.emit('activity', `Scraping LinkedIn for “${keyword.term}”`, {
      status: 'running',
      keyword: keyword.term,
    })

    // withRetry lives inside the adapter's run for the live path; the retries
    // knob is threaded through so the operator's number is the one that applies.
    const outcome = await withFallback(
      {
        ...apifyPostSearch,
        run: async (input) => {
          let lastError: unknown
          for (let attempt = 0; attempt <= retries; attempt += 1) {
            try {
              return await apifyPostSearch.run(input)
            } catch (error) {
              lastError = error
              if (attempt === retries) break
              await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
            }
          }
          throw lastError
        },
      },
      { keyword: keyword.term, maxItems, datePosted, sortBy, minAuthorFollowers },
      () => apifyFixturePosts(keyword.term, maxItems, runOffset, now),
      (reason) => {
        if (!fallbackReasons.includes(reason)) fallbackReasons.push(reason)
      },
    )

    if (outcome.source === 'live') anyLive = true

    const kept = outcome.value.filter((p) => p.authorFollowers >= minAuthorFollowers)
    const posts = kept.map((raw) =>
      toScrapedPost(raw, keyword.id, outcome.source, outcome.fallbackReason, 'Social'),
    )

    for (const post of posts) {
      ctx.emit('item.scraped', post.title, {
        keyword: keyword.term,
        engagement: post.engagement,
        source: post.sourceName,
        externalId: post.externalId,
        captureSource: post.captureSource,
      })
    }

    ctx.emit('activity', `${keyword.term}: ${posts.length} posts`, {
      status: 'ok',
      keyword: keyword.term,
      count: posts.length,
      source: outcome.source,
    })

    return posts
  })

  const posts = perKeyword.flat()
  const captureSource: 'live' | 'fixture' = anyLive && fallbackReasons.length === 0 ? 'live' : anyLive ? 'live' : 'fixture'

  // Constraint 5: scraped bodies are untrusted. They are wrapped and scanned
  // here, at the point of capture, so nothing downstream can reach a model with
  // raw third-party text. Directives found inside are reported, never followed.
  const evidence = prepareEvidence(
    posts.map((post) => ({
      id: post.externalId ?? post.title,
      source: post.sourceName ?? 'LinkedIn',
      ...(post.url ? { url: post.url } : {}),
      ...(post.authorName ? { author: post.authorName } : {}),
      content: post.text ?? post.snippet ?? '',
    })),
  )

  for (const attempt of evidence.injectionAttempts) {
    ctx.emit('activity', `Injection attempt in scraped content: ${attempt.label}`, {
      status: 'warn',
      itemId: attempt.itemId,
      pattern: attempt.patternId,
      excerpt: attempt.excerpt,
    })
  }

  if (evidence.injectionAttempts.length > 0) {
    ctx.log(
      `${evidence.injectionAttempts.length} scraped item(s) contain text that reads as an instruction. Wrapped as evidence and reported — not followed.`,
    )
  }

  ctx.log(
    `${posts.length} posts across ${keywords.length} keywords` +
      (fallbackReasons.length > 0 ? ` · ${fallbackReasons.length} keyword(s) fell back to fixtures` : ''),
  )

  return {
    posts,
    postsBeforeDedupe: posts.length,
    captureSource,
    captureFallbackReasons: fallbackReasons,
    /** The wrapped, escaped block. The only form in which a model may read these bodies. */
    evidenceText: evidence.text,
    injectionAttempts: evidence.injectionAttempts,
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   4 · scraping.hashtag.harvest
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.hashtag.harvest', (payload, ctx) => {
  const posts = payload.posts ?? []
  const minOccurrences = ctx.num('minOccurrences', 2)
  const dropGeneric = ctx.bool('dropGeneric', true)
  const maxPerKeyword = ctx.num('maxPerKeyword', 25)

  interface Accumulator {
    tag: string
    /** The most common display casing wins, so #RLHF does not become #rlhf. */
    casings: Map<string, number>
    postCount: number
    totalEngagement: number
    firstSeenAt: string
    lastSeenAt: string
    keywords: Map<string, number>
    /** The strongest post carrying the tag, by engagement. */
    topPost: { url: string; title: string; engagement: number } | null
  }

  const acc = new Map<string, Accumulator>()
  let generic = 0

  for (const post of posts) {
    const tags = post.hashtags.length > 0 ? post.hashtags : extractHashtagsFromText(post.text)
    for (const rawTag of tags) {
      const key = normaliseTag(rawTag)
      if (key.length < 2) continue
      if (dropGeneric && GENERIC_SET.has(key)) {
        generic += 1
        continue
      }

      let entry = acc.get(key)
      if (!entry) {
        entry = {
          tag: key,
          casings: new Map(),
          postCount: 0,
          totalEngagement: 0,
          firstSeenAt: post.postedAt,
          lastSeenAt: post.postedAt,
          keywords: new Map(),
          topPost: null,
        }
        acc.set(key, entry)
      }

      const display = rawTag.replace(/^#/, '')
      entry.casings.set(display, (entry.casings.get(display) ?? 0) + 1)
      entry.postCount += 1
      entry.totalEngagement += post.engagement
      if (!entry.topPost || post.engagement > entry.topPost.engagement) {
        entry.topPost = { url: post.url, title: post.title, engagement: post.engagement }
      }
      if (post.postedAt < entry.firstSeenAt) entry.firstSeenAt = post.postedAt
      if (post.postedAt > entry.lastSeenAt) entry.lastSeenAt = post.postedAt
      entry.keywords.set(post.keyword, (entry.keywords.get(post.keyword) ?? 0) + 1)
    }
  }

  const keywordIdByTerm = new Map((payload.keywords ?? []).map((k) => [k.term, k.id]))

  // Per surfacing keyword, keep the strongest `maxPerKeyword` tags.
  const byKeyword = new Map<string, Accumulator[]>()
  for (const entry of acc.values()) {
    if (entry.postCount < minOccurrences) continue
    const topKeyword = [...entry.keywords.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
    const list = byKeyword.get(topKeyword) ?? []
    list.push(entry)
    byKeyword.set(topKeyword, list)
  }

  const candidates: HashtagCandidate[] = []
  for (const [term, entries] of byKeyword) {
    const kept = entries
      .sort((a, b) => b.totalEngagement - a.totalEngagement || b.postCount - a.postCount)
      .slice(0, Math.max(1, maxPerKeyword))

    for (const entry of kept) {
      const display =
        [...entry.casings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? entry.tag
      candidates.push({
        tag: entry.tag,
        displayTag: display,
        keyword: term,
        keywordId: keywordIdByTerm.get(term) ?? null,
        postCount: entry.postCount,
        totalEngagement: entry.totalEngagement,
        engagementPerPost: Math.round((entry.totalEngagement / Math.max(1, entry.postCount)) * 100) / 100,
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        surfacedBy: [...entry.keywords.keys()],
        feedUrl: `https://www.linkedin.com/feed/hashtag/${encodeURIComponent(entry.tag)}/`,
        topPostUrl: entry.topPost?.url ?? null,
        topPostTitle: entry.topPost?.title ?? null,
        relevance: 0,
        credibility: 'Medium',
        credibilityScore: 55,
        freshness: 0,
        hashtagScore: 0,
        rank: null,
        validation: 'pending',
        verdictReason: '',
        duplicateOfTag: null,
        inTopSet: false,
      })
    }
  }

  for (const candidate of candidates) {
    ctx.emit('hashtag.captured', `#${candidate.displayTag}`, {
      tag: candidate.tag,
      keyword: candidate.keyword,
      postCount: candidate.postCount,
      engagement: candidate.totalEngagement,
    })
  }

  ctx.log(
    `${candidates.length} hashtag candidates` +
      (generic > 0 ? ` · ${generic} generic reach-bait tag(s) dropped` : ''),
  )

  return { hashtagCandidates: candidates }
})

/* ═══════════════════════════════════════════════════════════════════════════
   5 · scraping.hashtag.expand
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.hashtag.expand', async (payload, ctx) => {
  if (!ctx.bool('enabled', true)) return {}

  const candidates = payload.hashtagCandidates ?? []
  if (candidates.length === 0) return {}

  const expandTop = ctx.num('expandTop', 15)
  const itemsPerHashtag = ctx.num('itemsPerHashtag', 25)
  const runOffset = payload.runOffset ?? 0
  const now = new Date()

  const targets = [...candidates]
    .sort((a, b) => b.totalEngagement - a.totalEngagement)
    .slice(0, Math.max(1, expandTop))

  const byTag = new Map(candidates.map((c) => [c.tag, c]))
  let liveReadings = 0

  await mapWithConcurrency(targets, 4, async (candidate) => {
    const outcome = await withFallback(
      apifyHashtagFeed,
      { hashtag: candidate.tag, maxItems: itemsPerHashtag },
      () => apifyFixtureHashtagFeed(candidate.tag, itemsPerHashtag, runOffset, now),
    )

    if (outcome.source === 'live') liveReadings += 1

    const target = byTag.get(candidate.tag)
    if (!target) return

    // An independent reading, not biased by the keyword query that surfaced it.
    target.independentPostCount = outcome.value.length
    target.independentEngagement = outcome.value.reduce((total, p) => total + engagementOf(p), 0)
    target.expandedSource = outcome.source

    // Merge the independent reading in rather than replacing the keyword-scoped
    // one: both are evidence, and the union is the truer volume.
    const merged = Math.max(target.postCount, outcome.value.length)
    target.postCount = merged
    target.totalEngagement = Math.max(target.totalEngagement, target.independentEngagement)
    target.engagementPerPost =
      Math.round((target.totalEngagement / Math.max(1, target.postCount)) * 100) / 100

    if (outcome.value.length > 0) {
      const dates = outcome.value.map((p) => p.postedAt).sort()
      if ((dates[0] as string) < target.firstSeenAt) target.firstSeenAt = dates[0] as string
      const last = dates[dates.length - 1] as string
      if (last > target.lastSeenAt) target.lastSeenAt = last
    }
  })

  ctx.log(
    `${targets.length} hashtag feed(s) read independently` +
      (liveReadings === 0 ? ' from the bundled corpus' : ` · ${liveReadings} live`),
  )

  return { hashtagCandidates: candidates }
})

/* ═══════════════════════════════════════════════════════════════════════════
   6 · scraping.engagement.capture
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.engagement.capture', (payload, ctx) => {
  const posts = payload.posts ?? []
  if (posts.length === 0) return {}

  const shouldNormalise = ctx.bool('normalise', true)
  const windowHours = ctx.num('velocityWindowHours', 72)
  const now = new Date()

  const batchMax = posts.reduce((max, p) => Math.max(max, p.engagement), 0)

  for (const post of posts) {
    const ageHours = hoursSince(post.postedAt, now)
    post.velocity = velocityOf(post.engagement, ageHours, windowHours)
    post.engagementScore = shouldNormalise
      ? normalise(post.engagement, batchMax)
      : Math.min(100, post.engagement)
  }

  const peak = posts.reduce((best, p) => (p.velocity > best.velocity ? p : best), posts[0] as ScrapedPost)
  ctx.log(
    `Engagement normalised against a batch maximum of ${batchMax}; fastest mover is “${peak.title}” at ${peak.velocity}/hour`,
  )

  return { posts }
})

/* ═══════════════════════════════════════════════════════════════════════════
   7 · scraping.competitor.track
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.competitor.track', async (_payload, ctx) => {
  const tier = ctx.str('tier', 'P0+P1')
  const postsPer = ctx.num('postsPerCompetitor', 3)
  const now = new Date()

  const allowedTiers =
    tier === 'P0 only' ? ['P0'] : tier === 'All' ? ['P0', 'P1', 'P2'] : ['P0', 'P1']

  const selected = COMPETITORS.filter((c) => allowedTiers.includes(c.tier))
  if (selected.length === 0) {
    ctx.log('No competitors match the selected tier')
    return { competitorPosts: [] }
  }

  const results = await mapWithConcurrency(selected, 4, async (competitor) => {
    const outcome = await withFallback(
      apifyProfilePosts,
      {
        handle: competitor.handle,
        competitorName: competitor.name,
        maxItems: postsPer,
      },
      () => apifyFixtureCompetitorPosts(competitor.name, postsPer, now),
    )
    return outcome.value.map<CompetitorPostRecord>((p) => ({
      competitor: p.competitor,
      text: p.text,
      format: p.format,
      engagementIndex: p.engagementIndex,
      postedAt: p.postedAt,
      topics: p.topics,
      tier: competitor.tier,
    }))
  })

  const competitorPosts = results.flat()
  ctx.log(`${competitorPosts.length} competitor posts across ${selected.length} accounts (${tier})`)

  return { competitorPosts }
})

/* ═══════════════════════════════════════════════════════════════════════════
   8 · scraping.dedupe.prefilter
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.dedupe.prefilter', async (payload, ctx) => {
  const posts = payload.posts ?? []
  if (posts.length === 0) return {}

  const historyDays = ctx.num('historyDays', 14)
  const seen = await recentExternalIds(ctx.workspaceId, historyDays)

  // Within-batch identity as well as against history: the same post can arrive
  // twice from two keyword queries.
  const batch = new Set<string>()
  const kept: ScrapedPost[] = []
  let droppedHistory = 0
  let droppedBatch = 0

  for (const post of posts) {
    if (seen.has(post.externalId) || (post.url && seen.has(post.url))) {
      droppedHistory += 1
      continue
    }
    if (batch.has(post.externalId)) {
      droppedBatch += 1
      continue
    }
    batch.add(post.externalId)
    kept.push(post)
  }

  const dropped = droppedHistory + droppedBatch
  ctx.log(
    dropped === 0
      ? `No repeats in the last ${historyDays} days`
      : `${dropped} already-captured post(s) filtered — ${droppedHistory} seen within ${historyDays} days, ${droppedBatch} repeated inside this batch`,
  )

  return { posts: kept }
})

/* ═══════════════════════════════════════════════════════════════════════════
   Shared helper — used by the Validation Agent for source-tier credibility
   ═══════════════════════════════════════════════════════════════════════════ */

export function baseCredibilityFor(post: { sourceType: string }, ctx: SkillContext): number {
  void ctx
  return credibilityBase(post.sourceType)
}

export { credibilityLabel }

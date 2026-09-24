/**
 * SOCIAL MEDIA LISTENER — part of the Analysis Agent.
 *
 *   SocialFetch data (LinkedIn · Instagram · Facebook · X)
 *     → Post analysis        computed: engagement, rate, ranking, topics
 *     → Comment analysis     Claude: sentiment, feedback kinds, topic
 *     → Sentiment            computed from Claude's readings, per post and platform
 *     → Topic detection      computed from the configurable topic map
 *     → Social insights      Claude, from the computed facts only (computed fallback)
 *     → Answers + ORM        Claude: what people say, how they react, which topics
 *                            get attention; reputation overview, issues, risks and
 *                            recommended responses (`reputation.ts`)
 *
 * Answers: what is happening around Ethara.AI on social media, and what are
 * people saying about the company? Every number is traceable to a SocialFetch
 * call in `fetch_log`; a platform that is missing, not found or failing is
 * reported as such and never breaks the rest.
 */

import { classifyComments, writeInsights, type ClaudeInsights, type ClaudeOptions } from './claude'
import { fetchGlassdoor } from './glassdoor'
import { buildReputation } from './reputation'
import { LISTENER_SOURCES } from './sources'
import type { SourceContext } from './sources'
import { loadTopicRules, topicNames, topicsFor, type TopicRule } from './topics'
import {
  PLATFORM_NAME,
  type AnalysedPost,
  type CommentReading,
  type FeedbackItem,
  type FeedbackKind,
  type ListenerAccount,
  type ListenerComment,
  type ListenerPlatform,
  type ListenerPost,
  type PlatformListening,
  type SentimentCounts,
  type SocialMediaListener,
  type TopicStat,
} from './types'

export * from './types'
export { buildReputation, ORM_QUESTION, LISTENING_QUESTIONS } from './reputation'

export interface ListenerConfig {
  company: string
  /** Page URL / handle per platform; empty = not configured. */
  targets: Record<ListenerPlatform, string>
  platforms: ListenerPlatform[]
  postsPerPlatform: number
  /** Comments are fetched for this many posts per platform — those with the most comments. */
  commentPostsPerPlatform: number
  commentsPerPost: number
  topPosts: number
  lowestPosts: number
  includeReposts: boolean
  claude: ClaudeOptions & { enabled: boolean }
  /** Glassdoor (via FetchLayer). `enabled` off skips it; `employer` empty skips it. */
  glassdoor: { enabled: boolean; employer: string; reviewLimit: number }
}

interface Collected {
  platform: ListenerPlatform
  status: PlatformListening['status']
  reason: string | null
  account: ListenerAccount | null
  posts: ListenerPost[]
  comments: ListenerComment[]
}

/* ── collection ───────────────────────────────────────────────────────── */

async function collect(platform: ListenerPlatform, cfg: ListenerConfig, ctx: SourceContext): Promise<Collected> {
  const identifier = cfg.targets[platform].trim()
  const base: Collected = { platform, status: 'ok', reason: null, account: null, posts: [], comments: [] }
  if (identifier === '') {
    return { ...base, status: 'not_configured', reason: `No ${PLATFORM_NAME[platform]} page is configured for ${cfg.company}; nothing was fetched.` }
  }
  const source = LISTENER_SOURCES[platform]
  const acct = await source.fetchAccount({ identifier }, ctx)
  if (acct.result.status === 'not_found' || acct.result.status === 'private') {
    return { ...base, status: 'not_found', reason: `${PLATFORM_NAME[platform]}: ${acct.result.reason ?? 'not found'} (${identifier})` }
  }
  if (acct.result.status === 'error') {
    return { ...base, status: 'error', reason: `${PLATFORM_NAME[platform]}: ${acct.result.reason ?? 'SocialFetch failed'}` }
  }
  const got = await source.fetchPosts({ identifier }, acct.account, cfg.postsPerPlatform, ctx)
  const posts = cfg.includeReposts ? got.posts : got.posts.filter((p) => !p.isRepost)
  if (got.result.status === 'error') {
    return { ...base, account: acct.account, status: 'error', reason: `${PLATFORM_NAME[platform]} posts: ${got.result.reason ?? 'SocialFetch failed'}` }
  }
  if (posts.length === 0) {
    return { ...base, account: acct.account, status: 'empty', reason: `${PLATFORM_NAME[platform]}: SocialFetch returned no public posts.` }
  }

  // Only posts that have comments are worth a comments call — no unnecessary spend.
  const withComments = posts
    .filter((p) => (p.comments ?? 0) > 0)
    .sort((a, b) => (b.comments ?? 0) - (a.comments ?? 0))
    .slice(0, cfg.commentPostsPerPlatform)
  const comments: ListenerComment[] = []
  for (const post of withComments) {
    const res = await source.fetchComments(post, cfg.commentsPerPost, ctx)
    comments.push(...res.comments)
  }
  return { ...base, account: acct.account, posts, comments }
}

/* ── computation ──────────────────────────────────────────────────────── */

function round1(n: number): number {
  return Math.round(n * 10) / 10
}

export function sentimentOf(readings: readonly (CommentReading | null)[]): SentimentCounts | null {
  const known = readings.filter((r): r is CommentReading => r !== null)
  if (known.length === 0) return null
  const positive = known.filter((r) => r.sentiment === 'positive').length
  const neutral = known.filter((r) => r.sentiment === 'neutral').length
  const negative = known.filter((r) => r.sentiment === 'negative').length
  const pct = (n: number): number => round1((n / known.length) * 100)
  return {
    positive,
    neutral,
    negative,
    classified: known.length,
    positive_percent: pct(positive),
    neutral_percent: pct(neutral),
    negative_percent: pct(negative),
  }
}

/** likes/reactions + comments + video views (when stated). Null when reactions or comments are unstated. */
export function totalEngagement(post: Pick<ListenerPost, 'reactions' | 'comments' | 'views'>): number | null {
  if (post.reactions === null || post.comments === null) return null
  return post.reactions + post.comments + (post.views ?? 0)
}

/** (reactions + comments) / followers × 100 — views are reach, not interaction. Null without followers. */
export function engagementRate(post: Pick<ListenerPost, 'reactions' | 'comments'>, followers: number | null): number | null {
  if (followers === null || followers <= 0 || post.reactions === null || post.comments === null) return null
  // Percent, to two decimals — company pages often sit well below 1%.
  return Math.round(((post.reactions + post.comments) / followers) * 100 * 100) / 100
}

function topicStats(posts: readonly AnalysedPost[], comments: readonly (ListenerComment & { reading: CommentReading | null })[]): TopicStat[] {
  const stats = new Map<string, TopicStat>()
  const get = (topic: string): TopicStat => {
    const s = stats.get(topic) ?? { topic, posts: 0, comments: 0, engagement: 0, positive_comments: 0, negative_comments: 0 }
    stats.set(topic, s)
    return s
  }
  for (const p of posts) {
    for (const t of p.topics) {
      const s = get(t)
      s.posts += 1
      s.engagement += p.total_engagement ?? 0
    }
  }
  for (const c of comments) {
    if (!c.reading) continue
    const s = get(c.reading.topic)
    s.comments += 1
    if (c.reading.sentiment === 'positive') s.positive_comments += 1
    if (c.reading.sentiment === 'negative') s.negative_comments += 1
  }
  return [...stats.values()].sort((a, b) => b.posts + b.comments - (a.posts + a.comments) || b.engagement - a.engagement)
}

function excerpt(text: string, n = 90): string {
  const flat = text.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat || '(no text)'
}

/** Feedback grouped by kind, computed from Claude's readings — the fallback when no Claude summary exists. */
function computedFeedback(comments: readonly (ListenerComment & { reading: CommentReading | null })[], urlOf: (postId: string) => string): FeedbackItem[] {
  const kinds: FeedbackKind[] = ['praise', 'question', 'request', 'suggestion', 'complaint', 'concern']
  const items: FeedbackItem[] = []
  for (const kind of kinds) {
    const hits = comments.filter((c) => c.reading?.kinds.includes(kind))
    if (hits.length === 0) continue
    items.push({
      kind,
      summary: `${hits.length} comment${hits.length === 1 ? '' : 's'} read as ${kind}${hits.length === 1 ? '' : 's'}, e.g. “${excerpt(hits[0]?.text ?? '', 80)}”`,
      count: hits.length,
      post_urls: [...new Set(hits.map((h) => urlOf(h.postId)))].slice(0, 5),
    })
  }
  return items
}

function computedInsights(p: PlatformListening): { insights: string[]; signals: string[] } {
  const insights: string[] = []
  const signals: string[] = []
  const top = p.top_posts[0]
  if (top && top.total_engagement !== null) {
    insights.push(
      `The strongest post (${top.published_at?.slice(0, 10) ?? 'undated'}) drew ${top.total_engagement} interactions: “${excerpt(top.text, 70)}”.`,
    )
  }
  const lead = [...p.topics].filter((t) => t.posts > 0).sort((a, b) => b.engagement - a.engagement)[0]
  if (lead && lead.engagement > 0) {
    insights.push(`Most engagement came from ${lead.topic} content — ${lead.engagement} interactions across ${lead.posts} post${lead.posts === 1 ? '' : 's'}.`)
  }
  if (p.engagement.average_rate !== null) {
    insights.push(`Average engagement rate is ${p.engagement.average_rate}% of ${p.account?.followers ?? '—'} followers per post.`)
  }
  if (p.sentiment) {
    insights.push(
      `Of ${p.sentiment.classified} comment${p.sentiment.classified === 1 ? '' : 's'} read, ${p.sentiment.positive_percent}% are positive, ${p.sentiment.neutral_percent}% neutral and ${p.sentiment.negative_percent}% negative (a small-sample signal).`,
    )
    if (p.sentiment.negative > 0) signals.push(`${p.sentiment.negative} negative comment${p.sentiment.negative === 1 ? '' : 's'} to review.`)
  } else {
    insights.push('Audience sentiment is not measurable here: no comments were available to read.')
  }
  const questions = p.audience_feedback.find((f) => f.kind === 'question')
  if (questions) signals.push(`${questions.count} question${questions.count === 1 ? '' : 's'} from the audience.`)
  return { insights, signals }
}

/* ── the run ──────────────────────────────────────────────────────────── */

export async function runSocialListener(cfg: ListenerConfig, now: Date = new Date()): Promise<SocialMediaListener> {
  const log: SourceContext['log'] = []
  const ctx: SourceContext = { log }
  const rules: TopicRule[] = loadTopicRules()
  const topicList = topicNames(rules)

  const collected = await Promise.all(cfg.platforms.map((p) => collect(p, cfg, ctx)))

  // Glassdoor (via FetchLayer) runs alongside the platform reads — a different
  // question ("what do employees say") on the same company, attached to the
  // same report. Non-fatal: it states its own status and never blocks the rest.
  const glassdoor = cfg.glassdoor.enabled
    ? await fetchGlassdoor({ employer: cfg.glassdoor.employer, reviewLimit: cfg.glassdoor.reviewLimit })
    : undefined

  // Claude reads every comment once, across platforms, in batches.
  const allComments = collected.flatMap((c) => c.comments)
  const classified =
    cfg.claude.enabled && allComments.length > 0
      ? await classifyComments(allComments, topicList, cfg.claude)
      : { readings: new Map<string, CommentReading>(), costUsd: 0, error: cfg.claude.enabled ? null : 'Claude comment analysis is switched off.', injectionAttempts: 0 }
  const readingOf = (id: string): CommentReading | null => classified.readings.get(id) ?? null

  const platforms: Partial<Record<ListenerPlatform, PlatformListening>> = {}
  const everyPost: AnalysedPost[] = []
  const everyComment: Array<ListenerComment & { reading: CommentReading | null }> = []

  for (const c of collected) {
    const followers = c.account?.followers ?? null
    const comments = c.comments.map((x) => ({ ...x, reading: readingOf(x.id) }))
    const posts: AnalysedPost[] = c.posts.map((p) => {
      const mine = comments.filter((x) => x.postId === p.id)
      return {
        platform: p.platform,
        post_id: p.id,
        post_url: p.url,
        published_at: p.publishedAt,
        text: p.text,
        media_type: p.mediaType,
        hashtags: p.hashtags,
        reactions: p.reactions,
        comments: p.comments,
        shares: p.shares,
        video_views: p.views,
        total_engagement: totalEngagement(p),
        engagement_rate: engagementRate(p, followers),
        is_repost: p.isRepost,
        topics: topicsFor(p.text, p.hashtags, rules),
        rank_on_platform: null,
        comments_analysed: mine.length,
        comment_sentiment: sentimentOf(mine.map((m) => m.reading)),
      }
    })
    // Rank within the platform by engagement; posts with unstated metrics are not ranked.
    const ranked = posts.filter((p) => p.total_engagement !== null).sort((a, b) => (b.total_engagement as number) - (a.total_engagement as number))
    ranked.forEach((p, i) => {
      p.rank_on_platform = i + 1
    })
    const rates = posts.map((p) => p.engagement_rate).filter((r): r is number => r !== null)
    const totalEng = ranked.length > 0 ? ranked.reduce((n, p) => n + (p.total_engagement as number), 0) : null
    const urlOf = (postId: string): string => posts.find((p) => p.post_id === postId)?.post_url ?? ''

    const listening: PlatformListening = {
      platform: c.platform,
      label: PLATFORM_NAME[c.platform],
      status: c.status,
      reason: c.reason,
      account: c.account,
      posts_analyzed: posts.length,
      comments_analyzed: comments.length,
      engagement: {
        total: totalEng,
        average_per_post: totalEng !== null ? round1(totalEng / ranked.length) : null,
        average_rate: rates.length > 0 ? Math.round((rates.reduce((a, b) => a + b, 0) / rates.length) * 100) / 100 : null,
        posts_with_metrics: ranked.length,
      },
      sentiment: sentimentOf(comments.map((x) => x.reading)),
      posts: [...posts].sort((a, b) => (a.rank_on_platform ?? 1e9) - (b.rank_on_platform ?? 1e9)),
      comments: comments.map((x) => ({
        post_id: x.postId,
        post_url: urlOf(x.postId),
        text: x.text.length > 500 ? `${x.text.slice(0, 499)}…` : x.text,
        published_at: x.publishedAt,
        likes: x.likes,
        sentiment: x.reading?.sentiment ?? null,
        kinds: x.reading?.kinds ?? [],
        topic: x.reading?.topic ?? null,
      })),
      top_posts: ranked.slice(0, cfg.topPosts),
      lowest_posts: ranked.length > cfg.topPosts ? ranked.slice(-cfg.lowestPosts).reverse() : [],
      topics: topicStats(posts, comments),
      audience_feedback: computedFeedback(comments, urlOf),
      signals: [],
      insights: [],
    }
    if (c.status === 'ok') {
      const computed = computedInsights(listening)
      listening.insights = computed.insights
      listening.signals = computed.signals
    }
    platforms[c.platform] = listening
    everyPost.push(...posts)
    everyComment.push(...comments)
  }

  const withData = Object.values(platforms).filter((p) => p.status === 'ok')
  const crossTopics = topicStats(everyPost, everyComment)
  const overall = sentimentOf(everyComment.map((c) => c.reading))

  // Claude writes the prose from the computed facts; the computed version stands if it cannot.
  let claudeInsights: ClaudeInsights | null = null
  let insightError: string | null = null
  let insightCost = 0
  if (cfg.claude.enabled && withData.length > 0) {
    const facts = {
      company: cfg.company,
      sample_size: { posts: everyPost.length, comments: everyComment.length },
      overall_sentiment: overall,
      topics: crossTopics.slice(0, 10),
      platforms: Object.fromEntries(
        withData.map((p) => [
          p.platform,
          {
            followers: p.account?.followers ?? null,
            posts_analyzed: p.posts_analyzed,
            comments_analyzed: p.comments_analyzed,
            engagement: p.engagement,
            sentiment: p.sentiment,
            topics: p.topics.slice(0, 6),
            top_posts: p.top_posts.map((x) => ({ date: x.published_at, engagement: x.total_engagement, topics: x.topics, excerpt: excerpt(x.text, 160), repost: x.is_repost })),
            lowest_posts: p.lowest_posts.map((x) => ({ date: x.published_at, engagement: x.total_engagement, topics: x.topics, excerpt: excerpt(x.text, 120) })),
          },
        ]),
      ),
    }
    const res = await writeInsights(facts, everyComment, cfg.claude)
    claudeInsights = res.insights
    insightError = res.error
    insightCost = res.costUsd
  }

  if (claudeInsights) {
    for (const p of withData) {
      const ci = claudeInsights.platforms[p.platform]
      if (!ci) continue
      if (ci.insights.length > 0) p.insights = ci.insights
      if (ci.signals.length > 0) p.signals = ci.signals
      if (ci.audience_feedback.length > 0) {
        p.audience_feedback = ci.audience_feedback.map((f) => ({ ...f, post_urls: [] }))
      }
    }
  }

  const questions = everyComment.filter((c) => c.reading?.kinds.includes('question'))
  const crossComputed = {
    summary:
      withData.length === 0
        ? `No usable social data for ${cfg.company} was returned by SocialFetch, so there is nothing to report.`
        : `${everyPost.length} posts and ${everyComment.length} comments were analysed across ${withData.map((p) => p.label).join(', ')}.` +
          (overall ? ` Of ${overall.classified} comments read, ${overall.positive_percent}% are positive and ${overall.negative_percent}% negative.` : ' No comments could be read for sentiment.'),
    positive_signals: [] as string[],
    negative_signals: overall && overall.negative > 0 ? [`${overall.negative} negative comment(s) across the channels.`] : [],
    repeated_questions: questions.slice(0, 5).map((q) => excerpt(q.text, 120)),
    important_observations: withData.flatMap((p) => p.insights.slice(0, 1).map((i) => `${p.label}: ${i}`)),
    audience_feedback: computedFeedback(everyComment, (id) => everyPost.find((p) => p.post_id === id)?.post_url ?? ''),
  }
  const cross = claudeInsights
    ? { ...claudeInsights.cross, audience_feedback: claudeInsights.cross.audience_feedback.map((f) => ({ ...f, post_urls: [] })) }
    : crossComputed

  const sentimentBy = classified.readings.size > 0 ? 'claude' : 'unavailable'
  const notes: string[] = []
  if (sentimentBy === 'claude') notes.push('Comment sentiment, feedback kinds and comment topics are Claude’s reading of each comment — an analytical signal, not certainty.')
  else if (everyComment.length > 0) notes.push(`Comment sentiment could not be read: ${classified.error ?? 'Claude was unavailable'}.`)
  if (claudeInsights) notes.push('Insights were written by Claude from the computed figures and the comments only.')
  else if (withData.length > 0) notes.push(`Insights are computed from the figures${insightError ? ` (Claude insights unavailable: ${insightError})` : ''}.`)
  if (classified.injectionAttempts > 0) notes.push(`${classified.injectionAttempts} comment(s) contained instruction-like text; it was ignored.`)
  notes.push('Engagement = reactions + comments + video views where stated; rate = (reactions + comments) ÷ followers. Unstated metrics are left out, never counted as zero.')

  const report: SocialMediaListener = {
    generated_at: now.toISOString(),
    company: cfg.company,
    sample_size: { posts: everyPost.length, comments: everyComment.length, platforms_with_data: withData.length },
    analysis: {
      sentiment_by: sentimentBy,
      insights_by: claudeInsights ? 'claude' : 'computed',
      note: notes.join(' '),
    },
    credits_used: log.reduce((n, e) => n + e.credits, 0),
    warnings: [
      ...(ctx.outOfCredits
        ? [`SocialFetch ran out of credits during this run: ${log.filter((e) => e.status === 'error' || e.status === 'skipped').length} call(s) returned no data, so the figures cover only what was fetched before that. Top up SocialFetch and run the listener again.`]
        : []),
      ...Object.values(platforms)
        .filter((p) => p.status === 'error')
        .map((p) => p.reason ?? `${p.label} failed.`),
      ...(glassdoor && glassdoor.status === 'error' ? [`Glassdoor: ${glassdoor.reason ?? 'FetchLayer failed.'}`] : []),
    ],
    claude_cost_usd: Math.round((classified.costUsd + insightCost) * 10_000) / 10_000,
    fetch_log: log,
    platforms,
    ...(glassdoor ? { glassdoor } : {}),
    cross_platform_insights: {
      overall_sentiment: overall,
      top_topics: crossTopics.filter((t) => t.posts + t.comments > 0).slice(0, 8),
      most_engaging_topics: [...crossTopics].filter((t) => t.engagement > 0).sort((a, b) => b.engagement - a.engagement).slice(0, 5),
      audience_feedback: cross.audience_feedback,
      positive_signals: cross.positive_signals,
      negative_signals: cross.negative_signals,
      repeated_questions: cross.repeated_questions,
      important_observations: cross.important_observations,
      summary: cross.summary,
    },
  }

  // The three questions and the ORM layer, from the finished report.
  const orm = await buildReputation(report, cfg.claude, now)
  report.answers = orm.answers
  report.reputation = orm.reputation
  report.claude_cost_usd = Math.round((report.claude_cost_usd + orm.costUsd) * 10_000) / 10_000
  return report
}

export type { ClaudeOptions }

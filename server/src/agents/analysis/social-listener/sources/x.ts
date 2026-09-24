/**
 * X (Twitter) through SocialFetch.
 *
 *   profile   GET /v1/twitter/profiles/{handle}          (1 credit) — followers
 *   tweets    GET /v1/twitter/profiles/{handle}/tweets   (1 credit) — likes, replies, retweets, quotes, views
 *   replies   GET /v1/twitter/tweets/replies?url=         (1 credit per tweet)
 */

import type { ListenerComment, ListenerPost } from '../types'
import { arr, call, count, hashtagsIn, isoDate, rec, str, type ListenerSource } from './common'

function handleOf(identifier: string): string {
  const m = identifier.trim().match(/(?:x|twitter)\.com\/([^/?#]+)/i)
  return (m?.[1] ?? identifier.trim()).replace(/^@/, '')
}

export const xSource: ListenerSource = {
  platform: 'x',

  async fetchAccount(target, ctx) {
    const handle = handleOf(target.identifier)
    const result = await call('x', 'profile', `/v1/twitter/profiles/${encodeURIComponent(handle)}`, { by: 'handle' }, ctx)
    if (result.status !== 'found' || !result.data) return { account: null, result }
    const p = rec(result.data.profile)
    return {
      account: {
        platform: 'x',
        name: str(p.displayName),
        handle: str(p.handle) ?? handle,
        url: str(p.profileUrl) ?? `https://x.com/${handle}`,
        followers: count(rec(result.data.metrics).followers),
        description: str(p.bio),
        sourceId: str(p.platformUserId),
      },
      result,
    }
  },

  async fetchPosts(target, _account, limit, ctx) {
    const handle = handleOf(target.identifier)
    const result = await call('x', 'profile tweets', `/v1/twitter/profiles/${encodeURIComponent(handle)}/tweets`, { by: 'handle', limit, includeReplies: false }, ctx)
    if (result.status !== 'found' || !result.data) return { posts: [], result }
    const posts: ListenerPost[] = []
    for (const raw of arr(result.data.tweets).slice(0, limit)) {
      const t = rec(raw)
      const id = str(t.id)
      const url = str(t.url) ?? (id ? `https://x.com/${handle}/status/${id}` : null)
      if (!id || !url) continue
      const text = str(t.text) ?? ''
      const m = rec(t.metrics)
      const media = arr(t.media).map(rec)
      const retweets = count(m.retweets)
      const quotes = count(m.quotes)
      posts.push({
        platform: 'x',
        id,
        url,
        publishedAt: isoDate(t.createdAt),
        text,
        mediaType: media.length > 0 ? (str(media[0]?.type) ?? 'media') : 'text',
        hashtags: hashtagsIn(text),
        reactions: count(m.likes),
        comments: count(m.replies),
        shares: retweets === null && quotes === null ? null : (retweets ?? 0) + (quotes ?? 0),
        // X states impressions for every tweet; counted as views only for video, per the engagement formula.
        views: media.some((x) => str(x.type) === 'video' || str(x.type) === 'animated_gif') ? count(m.views) : null,
        isRepost: t.isRetweet === true,
        commentRef: url,
      })
    }
    return { posts, result }
  },

  async fetchComments(post, limit, ctx) {
    const result = await call('x', 'tweet replies', '/v1/twitter/tweets/replies', { url: post.commentRef, sortBy: 'relevance' }, ctx)
    if (result.status !== 'found' || !result.data) return { comments: [], result }
    const comments: ListenerComment[] = []
    for (const raw of arr(result.data.replies).slice(0, limit)) {
      const r = rec(raw)
      const text = str(r.text)
      const id = str(r.id)
      if (!text || !id) continue
      comments.push({
        platform: 'x',
        id,
        postId: post.id,
        text,
        publishedAt: isoDate(r.createdAt),
        likes: count(rec(r.metrics).likes),
        author: str(rec(r.author).handle),
      })
    }
    return { comments, result }
  },
}

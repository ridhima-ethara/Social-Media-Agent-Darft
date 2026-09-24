/**
 * Instagram through SocialFetch.
 *
 *   profile   GET /v1/instagram/profiles/{handle}          (1 credit) — followers
 *   posts     GET /v1/instagram/profiles/{handle}/posts    (1 credit) — likes, comments, plays (video), media type
 *   comments  GET /v1/instagram/posts/comments?url=         (1 credit per post, top-level comments)
 */

import type { ListenerComment, ListenerPost } from '../types'
import { arr, call, count, hashtagsIn, isoDate, rec, str, type ListenerSource } from './common'

function handleOf(identifier: string): string {
  const m = identifier.trim().match(/instagram\.com\/([^/?#]+)/i)
  return (m?.[1] ?? identifier.trim()).replace(/^@/, '')
}

export const instagramSource: ListenerSource = {
  platform: 'instagram',

  async fetchAccount(target, ctx) {
    const handle = handleOf(target.identifier)
    const result = await call('instagram', 'profile', `/v1/instagram/profiles/${encodeURIComponent(handle)}`, {}, ctx)
    if (result.status !== 'found' || !result.data) return { account: null, result }
    const p = rec(result.data.profile)
    return {
      account: {
        platform: 'instagram',
        name: str(p.displayName),
        handle: str(p.handle) ?? handle,
        url: str(p.profileUrl) ?? `https://www.instagram.com/${handle}/`,
        followers: count(rec(result.data.metrics).followers),
        description: str(p.bio),
        sourceId: str(p.platformUserId),
      },
      result,
    }
  },

  async fetchPosts(target, _account, limit, ctx) {
    const handle = handleOf(target.identifier)
    const result = await call('instagram', 'profile posts', `/v1/instagram/profiles/${encodeURIComponent(handle)}/posts`, {}, ctx)
    if (result.status !== 'found' || !result.data) return { posts: [], result }
    const posts: ListenerPost[] = []
    for (const raw of arr(result.data.posts).slice(0, limit)) {
      const p = rec(raw)
      const url = str(p.url)
      const id = str(p.id) ?? str(p.shortcode)
      if (!url || !id) continue
      const text = str(p.caption) ?? ''
      const mediaType = str(p.mediaType)
      posts.push({
        platform: 'instagram',
        id,
        url,
        publishedAt: isoDate(p.createdAt) ?? isoDate(p.takenAt),
        text,
        mediaType,
        hashtags: hashtagsIn(text),
        reactions: count(p.likeCount),
        comments: count(p.commentCount),
        shares: null,
        // Plays are stated for video only; a photo has no view count, not zero views.
        views: mediaType === 'video' ? count(p.playCount ?? p.viewCount) : null,
        isRepost: false,
        commentRef: url,
      })
    }
    return { posts, result }
  },

  async fetchComments(post, limit, ctx) {
    const result = await call('instagram', 'post comments', '/v1/instagram/posts/comments', { url: post.commentRef }, ctx)
    if (result.status !== 'found' || !result.data) return { comments: [], result }
    const comments: ListenerComment[] = []
    for (const raw of arr(result.data.comments).slice(0, limit)) {
      const c = rec(raw)
      const text = str(c.text)
      const id = str(c.id)
      if (!text || !id) continue
      comments.push({
        platform: 'instagram',
        id,
        postId: post.id,
        text,
        publishedAt: isoDate(c.createdAt),
        likes: count(c.likeCount),
        author: str(rec(c.author).handle),
      })
    }
    return { comments, result }
  },
}

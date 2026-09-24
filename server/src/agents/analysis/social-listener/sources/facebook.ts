/**
 * Facebook through SocialFetch.
 *
 *   page      GET /v1/facebook/profiles?url=         (1 credit)
 *   posts     GET /v1/facebook/profiles/posts?url=   (1 credit) — reactions, comments, shares when stated
 *   comments  GET /v1/facebook/posts/comments?url=   (1 credit per post)
 *
 * The page URL is the `facebookPage` knob (Ethara.AI's page, supplied by the
 * operator); an empty value skips Facebook with that reason.
 */

import type { ListenerComment, ListenerPost } from '../types'
import { arr, call, count, hashtagsIn, isoDate, rec, str, type ListenerSource } from './common'

export const facebookSource: ListenerSource = {
  platform: 'facebook',

  async fetchAccount(target, ctx) {
    const result = await call('facebook', 'page', '/v1/facebook/profiles', { url: target.identifier }, ctx)
    if (result.status !== 'found' || !result.data) return { account: null, result }
    const p = rec(result.data.profile)
    const metrics = rec(result.data.metrics)
    return {
      account: {
        platform: 'facebook',
        name: str(p.displayName),
        handle: null,
        url: str(p.profileUrl) ?? target.identifier,
        followers: count(metrics.followers ?? metrics.followerCount ?? metrics.likes),
        description: str(p.bio) ?? str(p.about),
        sourceId: str(p.platformUserId),
      },
      result,
    }
  },

  async fetchPosts(target, _account, limit, ctx) {
    const result = await call('facebook', 'page posts', '/v1/facebook/profiles/posts', { url: target.identifier }, ctx)
    if (result.status !== 'found' || !result.data) return { posts: [], result }
    const posts: ListenerPost[] = []
    for (const raw of arr(result.data.posts).slice(0, limit)) {
      const p = rec(raw)
      const url = str(p.url)
      if (!url) continue
      const text = str(p.text) ?? ''
      const hasVideo = str(p.videoHdUrl) !== null || str(p.videoSdUrl) !== null
      posts.push({
        platform: 'facebook',
        id: str(p.id) ?? url,
        url,
        publishedAt: isoDate(p.createdAt),
        text,
        mediaType: hasVideo ? 'video' : str(p.imageUrl) ? 'image' : 'text',
        hashtags: hashtagsIn(text),
        reactions: count(p.reactionCount),
        comments: count(p.commentCount),
        shares: count(p.shareCount),
        views: hasVideo ? count(p.viewCount ?? p.playCount) : null,
        isRepost: false,
        commentRef: url,
      })
    }
    return { posts, result }
  },

  async fetchComments(post, limit, ctx) {
    const result = await call('facebook', 'post comments', '/v1/facebook/posts/comments', { url: post.commentRef }, ctx)
    if (result.status !== 'found' || !result.data) return { comments: [], result }
    const comments: ListenerComment[] = []
    for (const raw of arr(result.data.comments).slice(0, limit)) {
      const c = rec(raw)
      const text = str(c.text)
      const id = str(c.id)
      if (!text || !id) continue
      comments.push({
        platform: 'facebook',
        id,
        postId: post.id,
        text,
        publishedAt: isoDate(c.createdAt),
        likes: count(c.reactionCount),
        author: str(rec(c.author).name),
      })
    }
    return { comments, result }
  },
}

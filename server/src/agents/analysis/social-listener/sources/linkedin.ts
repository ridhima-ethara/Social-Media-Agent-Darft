/**
 * LinkedIn through SocialFetch.
 *
 *   company   GET /v1/linkedin/companies?url=            (1 credit) — id, followers
 *   posts     GET /v2/linkedin/organizations/{id}/posts   (3 credits) — exact time, reactions, comments, reposts, media
 *   comments  GET /v2/linkedin/activities/{id}/comments   (3 credits per post)
 *
 * The v1 posts list states no engagement, so the v2 organization route is used.
 */

import type { ListenerAccount, ListenerComment, ListenerPost } from '../types'
import { arr, call, count, hashtagsIn, isoDate, rec, skipped, str, type ListenerSource } from './common'

function companyUrl(identifier: string): string {
  const id = identifier.trim()
  return /^https?:\/\//.test(id) ? id : `https://www.linkedin.com/company/${id.replace(/^\/+|\/+$/g, '')}`
}

export const linkedinSource: ListenerSource = {
  platform: 'linkedin',

  async fetchAccount(target, ctx) {
    const result = await call('linkedin', 'company', '/v1/linkedin/companies', { url: companyUrl(target.identifier) }, ctx)
    if (result.status !== 'found' || !result.data) return { account: null, result }
    const company = rec(result.data.company)
    const metrics = rec(result.data.metrics)
    const account: ListenerAccount = {
      platform: 'linkedin',
      name: str(company.name),
      handle: str(company.handle),
      url: str(company.companyUrl) ?? companyUrl(target.identifier),
      followers: count(metrics.followers),
      description: str(company.description),
      // The organisation id the v2 posts route needs.
      sourceId: str(company.id),
    }
    return { account, result }
  },

  async fetchPosts(_target, account, limit, ctx) {
    const orgId = account?.sourceId ?? null
    if (!orgId) {
      return { posts: [], result: skipped('linkedin', 'organization posts', 'No LinkedIn organisation id — the company lookup did not return one.', ctx) }
    }
    const result = await call('linkedin', 'organization posts', `/v2/linkedin/organizations/${encodeURIComponent(orgId)}/posts`, {}, ctx)
    if (result.status !== 'found' || !result.data) return { posts: [], result }
    const posts: ListenerPost[] = []
    for (const raw of arr(result.data.activities).slice(0, limit)) {
      const a = rec(raw)
      const id = str(a.entityId)
      const url = str(a.url)
      if (!id || !url) continue
      const text = str(a.text) ?? ''
      const eng = rec(a.engagements)
      const media = arr(a.mediaContent).map(rec)
      const header = str(a.header) ?? ''
      posts.push({
        platform: 'linkedin',
        id,
        url,
        publishedAt: isoDate(rec(a.postedAt).timestamp) ?? isoDate(rec(a.postedAt).fullDate),
        text,
        mediaType: media.length > 0 ? (str(media[0]?.type) ?? 'media') : 'text',
        hashtags: hashtagsIn(text),
        reactions: count(eng.totalReactions),
        comments: count(eng.commentsCount),
        shares: count(eng.repostsCount),
        views: null,
        isRepost: /reposted/i.test(header),
        commentRef: id,
      })
    }
    return { posts, result }
  },

  async fetchComments(post, limit, ctx) {
    const result = await call('linkedin', 'post comments', `/v2/linkedin/activities/${encodeURIComponent(post.commentRef)}/comments`, { sortBy: 'relevance', count: limit }, ctx)
    if (result.status !== 'found' || !result.data) return { comments: [], result }
    const comments: ListenerComment[] = []
    for (const [i, raw] of arr(result.data.comments).slice(0, limit).entries()) {
      const c = rec(raw)
      const text = str(c.comment) ?? str(c.text)
      if (!text) continue
      comments.push({
        platform: 'linkedin',
        id: str(c.permalink) ?? `${post.id}:${i}`,
        postId: post.id,
        text,
        publishedAt: isoDate(c.createdAt),
        likes: count(rec(c.engagements).totalReactions),
        author: str(rec(c.author).name),
      })
    }
    return { comments, result }
  },
}

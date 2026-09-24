/**
 * The four new lanes: X, Instagram, Facebook and the open web. Every date here
 * is a DECODING of something the platform or page published — the tests pin the
 * decodings to posts whose dates are publicly known.
 */

import { describe, expect, it } from 'vitest'
import { x } from '../../server/src/bridges/claude-bridge/platforms/x'
import { instagram, shortcodeToMediaId } from '../../server/src/bridges/claude-bridge/platforms/instagram'
import { facebook } from '../../server/src/bridges/claude-bridge/platforms/facebook'
import { dateFromUrlPath, web } from '../../server/src/bridges/claude-bridge/platforms/web'
import { normalizeCandidates } from '../../server/src/bridges/claude-bridge/processing/normalizer'
import { scopedQuery } from '../../server/src/bridges/claude-bridge/adapters/claude-code'
import { NOW, candidate, cfg } from './helpers'

describe('X', () => {
  it('decodes the snowflake timestamp of a status id', () => {
    // "the bird is freed" — widely reported as posted 2022-10-28.
    expect(x.dateFromItemId('1585841080431321088')?.toISOString()).toBe('2022-10-28T03:49:11.734Z')
    expect(x.dateFromItemId('20')).toBeNull()
  })

  it('accepts status URLs on x.com and twitter.com, canonicalised to x.com, and rejects profiles', () => {
    expect(x.classifyUrl('https://twitter.com/elonmusk/status/1585841080431321088?s=20')).toEqual({
      canonical: 'https://x.com/elonmusk/status/1585841080431321088',
      itemId: '1585841080431321088',
      contentType: 'post',
    })
    expect(x.classifyUrl('https://x.com/AndrewYNg')).toBeNull()
    expect(x.classifyUrl('https://x.com/search?q=ai')).toBeNull()
    expect(x.authorHandleFromUrl('https://x.com/emollick/status/2020303173362012667')).toBe('emollick')
  })
})

describe('Instagram', () => {
  it('decodes the date from a shortcode', () => {
    // world_record_egg — widely reported as posted 2019-01-04.
    const id = shortcodeToMediaId('BsOGulcndj-')!
    expect(instagram.dateFromItemId(id)?.toISOString().slice(0, 10)).toBe('2019-01-04')
  })

  it('accepts posts and reels, with or without the author prefix, and rejects profiles and tag pages', () => {
    expect(instagram.classifyUrl('https://www.instagram.com/p/BsOGulcndj-/')?.canonical).toBe('https://www.instagram.com/p/BsOGulcndj-/')
    expect(instagram.classifyUrl('https://www.instagram.com/googlecloud/reel/C-vsYoEMMc5/')?.canonical).toBe(
      'https://www.instagram.com/reel/C-vsYoEMMc5/',
    )
    expect(instagram.authorHandleFromUrl('https://www.instagram.com/googlecloud/reel/C-vsYoEMMc5/')).toBe('googlecloud')
    expect(instagram.classifyUrl('https://www.instagram.com/therealaiagents/')).toBeNull()
    expect(instagram.classifyUrl('https://www.instagram.com/explore/tags/ai/')).toBeNull()
  })
})

describe('Facebook', () => {
  it('accepts posts, videos and permalinks, rejects pages, and never decodes a date', () => {
    expect(facebook.classifyUrl('https://www.facebook.com/googlecloud/posts/ai-agents-key-differences')?.contentType).toBe('post')
    expect(facebook.classifyUrl('https://www.facebook.com/Benzinga/videos/zuckerberg-on-ai/473317825485615/')?.itemId).toBe('473317825485615')
    expect(facebook.classifyUrl('https://www.facebook.com/permalink.php?story_fbid=123&id=456')?.canonical).toBe(
      'https://www.facebook.com/permalink.php?story_fbid=123&id=456',
    )
    expect(facebook.classifyUrl('https://www.facebook.com/aiagentspro')).toBeNull()
    expect(facebook.dateFromItemId('473317825485615')).toBeNull()
    expect(facebook.canDateItems).toBe(false)
  })

  it('leaves a Facebook post undated rather than estimating', () => {
    const [item] = normalizeCandidates(
      [candidate({ url: 'https://www.facebook.com/page/posts/pfbid0abc' })],
      facebook,
      cfg,
      NOW,
    ).items
    expect(item!.published_at).toBeNull()
    expect(item!.date_status).toBe('unknown')
  })
})

describe('the open web', () => {
  it('accepts content pages on any non-platform host and rejects the platforms and navigation pages', () => {
    expect(web.classifyUrl('https://www.example.com/blog/agents?utm_source=x&ref=y')?.canonical).toBe('https://example.com/blog/agents')
    expect(web.classifyUrl('https://youtube.com/watch?v=abc123&si=track')?.canonical).toBe('https://youtube.com/watch?v=abc123')
    expect(web.classifyUrl('https://www.linkedin.com/posts/a_b-activity-1')).toBeNull()
    expect(web.classifyUrl('https://example.com/')).toBeNull()
    expect(web.classifyUrl('https://example.com/search?q=ai')).toBeNull()
    expect(web.isPlatformHost('https://x.com/a/status/1')).toBe(false)
  })

  it('reads only a full calendar date from a URL path', () => {
    expect(dateFromUrlPath('https://news.example.com/2026/09/21/agents', NOW)?.toISOString()).toBe('2026-09-21T00:00:00.000Z')
    expect(dateFromUrlPath('https://blog.example.com/2026-09-20-rlvr-notes', NOW)?.toISOString().slice(0, 10)).toBe('2026-09-20')
    expect(dateFromUrlPath('https://arxiv.org/abs/2607.19409', NOW)).toBeNull()
    expect(dateFromUrlPath('https://example.com/2026/02/31/x', NOW)).toBeNull()
    expect(dateFromUrlPath('https://example.com/2099/01/01/x', NOW)).toBeNull()
  })

  it('scopes open-web queries by excluding the platforms', () => {
    const q = scopedQuery(web, '"RLVR"')
    expect(q.startsWith('"RLVR"')).toBe(true)
    for (const host of ['linkedin.com', 'instagram.com', 'x.com', 'facebook.com']) expect(q).toContain(`-site:${host}`)
    expect(scopedQuery(x, '"RLVR"')).toBe('site:x.com "RLVR"')
  })
})

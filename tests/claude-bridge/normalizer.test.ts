import { describe, expect, it } from 'vitest'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'
import { extractHashtags, normalizeCandidates, toSnippet } from '../../server/src/bridges/claude-bridge/processing/normalizer'
import { NOW, activityIdFor, candidate, cfg, daysAgo, postUrl } from './helpers'

describe('LinkedIn platform module', () => {
  it('accepts posts and articles, and rejects profiles, companies, jobs, shorteners and other hosts', () => {
    expect(linkedin.classifyUrl(postUrl('a', 'x', daysAgo(1)))?.contentType).toBe('post')
    expect(linkedin.classifyUrl('https://www.linkedin.com/pulse/some-article-author')?.contentType).toBe('article')
    expect(linkedin.classifyUrl(`https://www.linkedin.com/feed/update/urn:li:activity:${activityIdFor(daysAgo(1))}/`)?.contentType).toBe('post')
    for (const url of [
      'https://www.linkedin.com/in/someone/',
      'https://linkedin.com/company/ethara-ai',
      'https://www.linkedin.com/jobs/view/123',
      'https://www.linkedin.com/feed/update/not-an-id',
      'https://lnkd.in/abc',
      'https://medium.com/posts/x',
      'not a url',
    ]) {
      expect(linkedin.classifyUrl(url)).toBeNull()
    }
  })

  it('canonicalises country subdomains, query strings and trailing slashes', () => {
    const url = postUrl('a', 'x', daysAgo(1))
    expect(linkedin.classifyUrl(`${url.replace('www.', 'uk.')}/?utm_source=share`)?.canonical).toBe(url)
  })

  it('decodes the exact timestamp from an activity id, and rejects implausible ids', () => {
    const when = new Date('2026-09-20T12:34:56.789Z')
    expect(linkedin.dateFromItemId(activityIdFor(when))?.toISOString()).toBe(when.toISOString())
    expect(linkedin.dateFromItemId('12345')).toBeNull()
    expect(linkedin.dateFromItemId(activityIdFor(new Date('2099-01-01T00:00:00Z')))).toBeNull()
    // A real public post id: 7446814100447346688 → 2026-04-06T07:00:36.662Z.
    expect(linkedin.dateFromItemId('7446814100447346688')?.toISOString()).toBe('2026-04-06T07:00:36.662Z')
  })

  it('reads the author handle only from the URL itself', () => {
    expect(linkedin.authorHandleFromUrl(postUrl('sample-person', 'x', daysAgo(1)))).toBe('sample-person')
    expect(linkedin.authorHandleFromUrl('https://www.linkedin.com/pulse/x')).toBeNull()
  })
})

describe('normaliser', () => {
  it('counts what it rejects instead of dropping it silently', () => {
    const { items, rejected } = normalizeCandidates(
      [
        candidate({ url: 'https://www.linkedin.com/in/someone' }),
        candidate({ url: 'https://example.com/ai-agents' }),
        candidate({ url: null, title: null, text: null }),
        candidate({ url: postUrl('a', 'ok', daysAgo(1)) }),
      ],
      linkedin,
      cfg,
      NOW,
    )
    expect(items).toHaveLength(1)
    expect(rejected).toEqual({ off_platform: 1, not_a_post: 1, empty: 1 })
  })

  it('takes hashtags only from what the source stated or wrote, never derives them', () => {
    expect(extractHashtags(['#AIAgents'], 'Text with #RLVR and #1 and #aiagents', null).map((h) => h.display)).toEqual([
      '#AIAgents',
      '#RLVR',
    ])
    const [item] = normalizeCandidates([candidate({ url: postUrl('a', 'no-tags', daysAgo(1)), title: 'AI agents without tags' })], linkedin, cfg, NOW).items
    expect(item!.hashtags).toEqual([])
  })

  it('withholds author names unless configured, and trims snippets', () => {
    const [item] = normalizeCandidates([candidate({ url: postUrl('a', 'x', daysAgo(1)), author: 'Some Person' })], linkedin, cfg, NOW).items
    expect(item!.author).toBeNull()
    const [shown] = normalizeCandidates([candidate({ url: postUrl('a', 'x', daysAgo(1)), author: 'Some Person' })], linkedin, { ...cfg, include_author_names: true }, NOW).items
    expect(shown!.author).toBe('Some Person')
    const long = 'word '.repeat(200)
    expect(toSnippet(long, 50)!.length).toBeLessThanOrEqual(50)
    expect(toSnippet(long, 50)!.endsWith('…')).toBe(true)
  })
})

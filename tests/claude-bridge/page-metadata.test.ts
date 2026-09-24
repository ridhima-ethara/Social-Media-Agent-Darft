import { describe, expect, it } from 'vitest'
import { extractPageMetadata, parseRobots, robotsAllows } from '../../server/src/bridges/claude-bridge/processing/page-metadata'
import { NOW } from './helpers'

const UA = 'EtharaSMA-ClaudeBridge/1.0'

describe('robots.txt', () => {
  it('obeys the * group: disallowed paths are not read, the rest are', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /private/\nAllow: /private/public\n', UA)
    expect(robotsAllows(rules, '/blog/post')).toBe(true)
    expect(robotsAllows(rules, '/private/x')).toBe(false)
    expect(robotsAllows(rules, '/private/public/page')).toBe(true)
  })

  it('honours a disallow-everything site, and a group that names this agent', () => {
    expect(robotsAllows(parseRobots('User-agent: *\nDisallow: /\n', UA), '/anything')).toBe(false)
    const named = parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: EtharaSMA-ClaudeBridge\nAllow: /\n', UA)
    expect(robotsAllows(named, '/anything')).toBe(true)
  })

  it('supports wildcards and end anchors, and an empty Disallow allows all', () => {
    const rules = parseRobots('User-agent: *\nDisallow: /*.pdf$\nDisallow:\n', UA)
    expect(robotsAllows(rules, '/paper.pdf')).toBe(false)
    expect(robotsAllows(rules, '/paper.pdf.html')).toBe(true)
  })
})

describe('page metadata', () => {
  it('reads article:published_time and the description', () => {
    const html = `<html><head>
      <meta property="article:published_time" content="2026-09-21T08:30:00Z">
      <meta property="og:description" content="What RLVR changed in post-training &amp; why.">
    </head></html>`
    expect(extractPageMetadata(html, NOW)).toEqual({
      publishedAt: '2026-09-21T08:30:00.000Z',
      description: 'What RLVR changed in post-training & why.',
    })
  })

  it('falls back to JSON-LD, then <time datetime>', () => {
    expect(extractPageMetadata('<script type="application/ld+json">{"datePublished":"2026-09-19"}</script>', NOW).publishedAt).toBe(
      '2026-09-19T00:00:00.000Z',
    )
    expect(extractPageMetadata('<article><time datetime="2026-09-18T10:00:00Z">Sept 18</time></article>', NOW).publishedAt).toBe(
      '2026-09-18T10:00:00.000Z',
    )
  })

  it('states nothing when the page declares nothing, and ignores future dates', () => {
    expect(extractPageMetadata('<html><body>No dates here.</body></html>', NOW)).toEqual({ publishedAt: null, description: null })
    expect(extractPageMetadata('<meta name="date" content="2099-01-01">', NOW).publishedAt).toBeNull()
  })
})

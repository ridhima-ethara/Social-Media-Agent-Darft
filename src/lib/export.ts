/**
 * EXPORT — CSV and JSON of any analytics view.
 *
 * Everything is generated in the browser from state already on screen, so a
 * download never depends on the API being reachable.
 */

import type { PlatformAnalytics, PublishedPost } from '../types'

/* ═══════════════════════════════════════════════════════════════════════════
   PRIMITIVES
   ═══════════════════════════════════════════════════════════════════════════ */

/** RFC 4180 quoting: anything containing a comma, quote or newline is quoted. */
function csvCell(value: unknown): string {
  const text = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

export function toCsv(headers: string[], rows: Array<Array<unknown>>): string {
  return [headers.map(csvCell).join(','), ...rows.map((r) => r.map(csvCell).join(','))].join('\r\n')
}

function download(filename: string, mime: string, content: string): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8` })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  document.body.append(anchor)
  anchor.click()
  anchor.remove()
  // Revoke on the next frame so Safari has finished reading the blob.
  requestAnimationFrame(() => URL.revokeObjectURL(url))
}

export function downloadCsv(filename: string, headers: string[], rows: Array<Array<unknown>>): void {
  download(filename, 'text/csv', toCsv(headers, rows))
}

export function downloadJson(filename: string, payload: unknown): void {
  download(filename, 'application/json', JSON.stringify(payload, null, 2))
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE VIEWS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Combined: one row per platform per month, with every reported metric. */
export function exportCombined(analytics: PlatformAnalytics[], format: 'csv' | 'json'): void {
  const stamp = new Date().toISOString().slice(0, 10)

  if (format === 'json') {
    downloadJson(`ethara-analytics-combined-${stamp}.json`, analytics)
    return
  }

  const metricKeys = [...new Set(analytics.flatMap((a) => Object.keys(a.metrics)))].sort()
  downloadCsv(
    `ethara-analytics-combined-${stamp}.csv`,
    ['Platform', 'Month', 'Label', 'Reported', ...metricKeys],
    analytics.map((a) => [
      a.platform,
      a.month,
      a.label ?? '',
      a.is_reported ? 'yes' : 'no',
      ...metricKeys.map((k) => a.metrics[k] ?? ''),
    ]),
  )
}

/** Per-post: every published post with its latest metric reading. */
export function exportPerPost(posts: PublishedPost[], format: 'csv' | 'json'): void {
  const stamp = new Date().toISOString().slice(0, 10)

  if (format === 'json') {
    downloadJson(`ethara-posts-${stamp}.json`, posts)
    return
  }

  downloadCsv(
    `ethara-posts-${stamp}.csv`,
    [
      'Title', 'Platform', 'Published', 'Reach', 'Impressions', 'Likes',
      'Comments', 'Shares', 'Engagement rate %', 'Publish mode', 'Metrics captured',
    ],
    posts.map((p) => [
      p.title,
      p.platform,
      p.published_at ?? '',
      p.reach ?? '',
      p.impressions ?? '',
      p.likes ?? '',
      p.comments ?? '',
      p.shares ?? '',
      p.engagement_rate ?? '',
      p.publish_mode,
      p.metrics_captured_at ?? '',
    ]),
  )
}

/** One post, on its own — used by the per-row menu in Published Posts. */
export function exportSinglePost(post: PublishedPost, format: 'csv' | 'json'): void {
  const slug = post.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 48)

  if (format === 'json') {
    downloadJson(`ethara-post-${slug}.json`, post)
    return
  }

  downloadCsv(
    `ethara-post-${slug}.csv`,
    ['Field', 'Value'],
    [
      ['Title', post.title],
      ['Platform', post.platform],
      ['Published', post.published_at ?? ''],
      ['Reach', post.reach ?? ''],
      ['Impressions', post.impressions ?? ''],
      ['Likes', post.likes ?? ''],
      ['Comments', post.comments ?? ''],
      ['Shares', post.shares ?? ''],
      ['Engagement rate %', post.engagement_rate ?? ''],
      ['Analysis', post.analysis_summary ?? ''],
      ['Recommendation', post.analysis_recommendation ?? ''],
      ['Content', post.content],
    ],
  )
}

/** The daily series behind one platform-month, for the InsightChart view. */
export function exportDaily(row: PlatformAnalytics, format: 'csv' | 'json'): void {
  if (format === 'json') {
    downloadJson(`ethara-${row.platform}-${row.month}-daily.json`, row)
    return
  }
  downloadCsv(
    `ethara-${row.platform}-${row.month}-daily.csv`,
    ['Date', 'Value'],
    row.daily.map((d) => [d.date, d.value]),
  )
}

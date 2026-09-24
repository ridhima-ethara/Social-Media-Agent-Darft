/**
 * The human-readable rendering: a date-ordered table, then the reasons.
 *
 * It keeps the three layers apart on the page — which fields were observed at
 * the source, which were computed by the bridge — and Claude's own reading is
 * a third layer that belongs in the conversation, not here. Only URLs that
 * were actually discovered are printed.
 */

import { platformModule } from '../platforms'
import type { TrendIntelligenceOutput, TrendResult } from '../schemas/trend-output'

const STATUS_NOTE: Record<TrendIntelligenceOutput['source_status'], string> = {
  ok: 'Source data acquired.',
  partial: 'Some sources answered and some could not — see Sources below.',
  unavailable: 'No source could run, so nothing was acquired — see Sources below.',
  empty: 'Sources ran but returned nothing usable in the window.',
  fixture: '**FIXTURE DATA — these rows are test samples, not observed on the platform.**',
}

function cell(text: string): string {
  return text.replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim()
}

function dateCell(r: TrendResult): string {
  return r.published_at === null ? 'unknown' : r.published_at.slice(0, 10)
}

function postCell(r: TrendResult): string {
  return r.post_url === null ? '—' : `[${r.content_type === 'article' ? 'page' : 'post'}](${r.post_url})`
}

export function renderMarkdown(out: TrendIntelligenceOutput): string {
  const lines: string[] = []
  const platform = platformModule(out.source)?.label ?? out.source
  lines.push(`## ${platform} Trend Intelligence`)
  lines.push('')
  lines.push(
    `Generated: ${out.generated_at.slice(0, 10)} · Window: ${out.search_window.from.slice(0, 10)} → ${out.search_window.to.slice(0, 10)} · ` +
      `Sorted: newest first · ${out.results.length} result${out.results.length === 1 ? '' : 's'} of ${out.total_candidates} candidate${out.total_candidates === 1 ? '' : 's'}`,
  )
  lines.push('')
  lines.push(STATUS_NOTE[out.source_status])

  if (out.status === 'configuration_error') {
    lines.push('')
    lines.push(`**Configuration error:** ${out.error ?? 'unknown'}`)
    return lines.join('\n')
  }

  lines.push('')
  if (out.results.length === 0) {
    lines.push('_No trend met the freshness and relevance rules. Nothing has been substituted._')
  } else {
    lines.push(`| # | Date | Trending Topic | Hashtags | Relevance | ${out.source === 'web' ? 'Page' : `${platform} Post`} |`)
    lines.push('|---|------|----------------|----------|-----------|---------------|')
    for (const r of out.results) {
      lines.push(
        `| ${r.rank} | ${dateCell(r)} | ${cell(r.topic)} | ${cell(r.hashtags.join(' ') || '—')} | ${r.brand_relevance} | ${postCell(r)} |`,
      )
    }
    lines.push('')
    lines.push(
      '_Verified source data:_ Date (decoded from the post id, read from the URL or the page\'s own published-date tag, or stated by the source; "unknown" when none), ' +
        'Hashtags (only those written in the observed text), Post URL. ' +
        '_Bridge analysis (computed, not observed):_ Topic, Relevance, and the reasons below.',
    )
    lines.push('')
    for (const r of out.results) {
      lines.push(`**${r.rank}. ${cell(r.topic)}** — ${dateCell(r)} · trend score ${r.trend_score}`)
      if (r.snippet) lines.push(`> ${cell(r.snippet)}`)
      lines.push(`- Why this is relevant: ${r.relevance_reason}`)
      lines.push(`- Why it is trending: ${r.trend_reason}`)
      lines.push('')
    }
  }

  if (out.trending_hashtags.length > 0) {
    const specific = out.trending_hashtags.filter((h) => !h.generic).slice(0, 10)
    if (specific.length > 0) {
      lines.push(`**Hashtags seen across results:** ${specific.map((h) => `${h.hashtag} (${h.post_count})`).join(', ')}`)
      lines.push('')
    }
  }

  lines.push('**Sources**')
  for (const a of out.adapters) {
    lines.push(
      `- ${a.label}: ${a.status}${a.queries_executed > 0 ? ` · ${a.queries_executed} queries` : ''} · ${a.candidates} candidates` +
        (a.reason ? ` — ${cell(a.reason)}` : ''),
    )
  }
  const d = out.diagnostics
  lines.push('')
  lines.push(
    `_Diagnostics:_ ${d.queries_generated} queries generated, ${d.queries_executed} executed · ${d.candidates_found} found · ` +
      `${d.invalid_removed} not posts/off-platform · ${d.duplicates_removed} duplicates · ${d.stale_results_removed} stale · ` +
      `${d.below_relevance_removed} below relevance · ${d.undated_results} undated kept`,
  )
  for (const n of d.notes) lines.push(`- ${cell(n)}`)
  for (const e of d.errors) lines.push(`- ⚠ ${cell(e)}`)
  return lines.join('\n')
}

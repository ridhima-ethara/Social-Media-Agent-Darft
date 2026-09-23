/** 
 * CONTENT INTELLIGENCE
 *
 * Everything the discovery half of the pipeline produced, with the evidence
 * behind every verdict. Five tabs, live counts, and inline resolution wherever
 * something is waiting on a human.
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, Search, X, Sparkles, ArrowRight, Brain, ExternalLink, Download, Maximize2 } from 'lucide-react'
import { API_BASE } from '../lib/api'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { PlayButton } from '../components/play-button'
import {
  Badge,
  Btn,
  EmptyState,
  Metric,
  Progress,
  ScoreRing,
  Tabs,
  fmt,
  timeAgo,
  Select,
} from '../components/ui'
import type { Platform } from '@shared/agent-contract'
import type { Hashtag, ScrapedItem, ValidationVerdict } from '../types'

/*
 * Rows per page in the keyword table.
 *
 * A presentation constant, not a pipeline tunable: it describes how many rows
 * fit before paging beats scrolling. Nothing about what gets scored changes
 * with it, so it is not a knob an operator would set.
 */
const KEYWORD_PAGE = 20

/** Rows per page in the scraped-data table. Same reasoning as KEYWORD_PAGE. */
const SCRAPED_PAGE = 20

type TabId = 'keywords' | 'hashtags' | 'scraped' | 'validation' | 'analysis'

const VERDICT_TONE: Record<ValidationVerdict, 'good' | 'warn' | 'neutral' | 'critical'> = {
  validated: 'good',
  needs_review: 'warn',
  duplicate: 'neutral',
  rejected: 'critical',
  pending: 'neutral',
}

/**
 * How a capture lane is named in the UI.
 *
 * `null` is the OPEN-WEB lane, not a missing value — an item captured by the
 * unscoped search genuinely belongs to no platform, and rendering it as an em
 * dash would read as "we failed to record this".
 */
function platformLabel(platform: Platform | null): string {
  if (platform === null) return 'Open web'
  return PLATFORM_LABEL[platform]
}

const PLATFORM_LABEL: Record<Platform, string> = {
  linkedin: 'LinkedIn',
  instagram: 'Instagram',
  x: 'X',
  facebook: 'Facebook',
}

const VERDICT_LABEL: Record<ValidationVerdict, string> = {
  validated: 'Validated',
  needs_review: 'Needs review',
  duplicate: 'Duplicate',
  rejected: 'Rejected',
  pending: 'Pending',
}

export function ContentIntelligence() {
  const keywords = useStore((s) => s.keywords)
  const keywordSignals = useStore((s) => s.keywordSignals)
  const hashtags = useStore((s) => s.hashtags)
  const topHashtags = useStore((s) => s.topHashtags)
  const scraped = useStore((s) => s.scraped)
  const scrapeRun = useStore((s) => s.scrapeRun)
  const validating = useStore((s) => s.validating)
  const runScraping = useStore((s) => s.runScraping)
  const openTheater = useStore((s) => s.openTheater)
  const isLeadership = useStore((s) => s.user?.role === 'leadership')

  const [tab, setTab] = useState<TabId>('keywords')

  const needsReview = useMemo(
    () =>
      scraped.filter((s) => s.validation === 'needs_review').length +
      hashtags.filter((h) => h.validation === 'needs_review').length,
    [scraped, hashtags],
  )

  return (
    <>
      <PageHeader
        title="Content Intelligence"
        subtitle="What the discovery pipeline found, why each candidate was scored the way it was, and what is still waiting on you."
        agents={['scraping', 'validation', 'analysis']}
        /* Marketing runs discovery from here. Leadership reads this page
           and runs the pipeline from the Dashboard instead. */
        actions={
          isLeadership ? undefined : (
            <PlayButton
              label="Run SocialAI"
              hint={`${keywords.filter((k) => k.active).length} keywords active`}
              running={scrapeRun.running}
              onClick={() => {
                openTheater()
                void runScraping()
              }}
            />
          )
        }
      />

      {/* The same strip as the dashboard's, and the same contract: it is the way
          back into the run once the theater has been closed. */}
      {scrapeRun.running || validating ? (
        <button
          type="button"
          onClick={openTheater}
          aria-label="Reopen the pipeline run screen"
          className="anim-fade-in group mb-4 block w-full rounded-xl border border-accent/40 bg-accent/8 px-4 py-3 text-left transition-colors hover:border-accent hover:bg-accent/12 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-accent"
        >
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-ink">
              {scrapeRun.running
                ? `Sherlock · ${scrapeRun.currentKeyword || 'starting'}`
                : 'Dexter · scoring candidates against the four-verdict gate'}
            </p>
            <p className="tabular flex items-center gap-2 text-[12px] text-ink-3">
              {scrapeRun.running ? `${scrapeRun.found} items · ${scrapeRun.progress}%` : 'in progress'}
              <span className="flex items-center gap-1 rounded-full border border-line px-1.5 py-0.5 text-[10px] transition-colors group-hover:border-accent group-hover:text-accent-bright">
                <Maximize2 size={10} aria-hidden="true" /> Open run
              </span>
            </p>
          </div>
          <Progress value={scrapeRun.running ? scrapeRun.progress : 45} className="mt-2" />
        </button>
      ) : null}

      <Tabs<TabId>
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'keywords', label: 'Keywords', count: keywords.length },
          { id: 'hashtags', label: 'Hashtags', count: hashtags.length },
          { id: 'scraped', label: 'Scraped Data', count: scraped.length },
          { id: 'validation', label: 'Validation', count: needsReview },
          { id: 'analysis', label: 'AI Analysis', count: 8 },
        ]}
      />

      {tab === 'keywords' ? <KeywordsTab /> : null}
      {tab === 'hashtags' ? <HashtagsTab /> : null}
      {tab === 'scraped' ? <ScrapedTab /> : null}
      {tab === 'validation' ? <ValidationTab /> : null}
      {tab === 'analysis' ? <AnalysisTab /> : null}

      {/* Signals are read by two tabs, so they are fetched once here. */}
      <span className="sr-only">
        {keywordSignals.length} signals · {topHashtags.length} in the consolidated set
      </span>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · KEYWORDS
   ═══════════════════════════════════════════════════════════════════════════ */

function KeywordsTab() {
  const signals = useStore((s) => s.keywordSignals)
  const trending = [...signals].filter((s) => s.is_trending).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 5)

  /*
   * SHOWCASE THE KEYWORDS ACTUALLY IN PLAY, NOT THE WHOLE RECORDED SET.
   *
   * Content Intelligence is the discovery/showcase screen, so it shows the
   * keywords this run actually scored — ranked by trend score — rather than
   * every recorded keyword. The full editable keyword table (all recorded
   * terms, add/edit/weight) lives on Settings via `<KeywordBoard compact />`,
   * which stays the single place to manage the set.
   */
  const showcased = [...signals].sort(
    (a, b) => (a.rank ?? 999) - (b.rank ?? 999) || b.trend_score - a.trend_score,
  )

  /* ── Paging the keyword table ──────────────────────────────────────────
     A run scores well over a hundred terms and every one of them landed in a
     single table, so reading the tail meant scrolling past everything above it
     and losing the header on the way.

     Page 1 is the highest-ranked terms, which is the order the table already
     sorts in — paging forward walks DOWN the ranking rather than back through
     time, so `KEYWORD_PAGE` rows is simply the top twenty, then the next twenty.
  */
  const keywordPages = Math.max(1, Math.ceil(showcased.length / KEYWORD_PAGE))
  const [keywordPage, setKeywordPage] = useState(1)

  // Clamped rather than reset, so a shorter list after a new run does not throw
  // the reader back to page 1 when page 2 still exists.
  const kwPage = Math.min(keywordPage, keywordPages)
  const pagedSignals = showcased.slice((kwPage - 1) * KEYWORD_PAGE, kwPage * KEYWORD_PAGE)

  return (
    <>
      {trending.length > 0 ? (
        <section className="mb-4">
          <h3 className="display mb-2 text-sm">Top 5 trending this week</h3>
          <div className="stagger-fade grid gap-3 md:grid-cols-2 xl:grid-cols-5">
            {trending.map((signal, i) => {
              const total = signal.post_count + signal.total_engagement / 100
              const bars = [
                { label: 'Volume', value: Math.min(100, (signal.post_count / 50) * 100) },
                { label: 'Engagement', value: Math.min(100, (signal.total_engagement / 9_000) * 100) },
                { label: 'Velocity', value: Math.min(100, Number(signal.velocity) * 3.2) },
                { label: 'Growth', value: Math.min(100, Math.max(0, Number(signal.growth_pct) + 30)) },
              ]

              return (
                <article
                  key={signal.id}
                  // A column that fills its grid cell, so the link chips sit on
                  // one baseline across the row however long each reason runs.
                  className="card card-hover anim-fade-up flex h-full flex-col p-3"
                  style={{ ['--i' as string]: i, animationDelay: `${i * 30}ms` }}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <Badge tone="accent">#{signal.rank}</Badge>
                      <h4 className="mt-1.5 truncate text-[13px] font-medium text-ink">{signal.term}</h4>
                      <p className="tabular text-[10.5px] text-ink-3">
                        {signal.post_count} posts · {fmt(signal.total_engagement)} engagement
                      </p>
                    </div>
                    <ScoreRing value={signal.trend_score} size={46} />
                  </div>

                  <div className="mt-2.5 space-y-1">
                    {bars.map((bar) => (
                      <div key={bar.label} className="flex items-center gap-2">
                        <span className="w-16 shrink-0 text-[10px] text-ink-3">{bar.label}</span>
                        <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                          <span
                            className="block h-full rounded-full bg-accent transition-[width] duration-[var(--dur-slow)] ease-[var(--ease-out-expo)]"
                            style={{ width: `${bar.value}%` }}
                          />
                        </span>
                      </div>
                    ))}
                  </div>

                  {signal.trend_reason ? (
                    <p className="mt-2 line-clamp-4 text-[11.5px] leading-relaxed text-ink-3" title={signal.trend_reason}>
                      {signal.trend_reason}
                    </p>
                  ) : null}

                  <div className="mt-auto flex flex-wrap gap-1.5 pt-2.5">
                    {signal.search_url ? (
                      <a
                        href={signal.search_url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                      >
                        <ExternalLink size={10} /> Search on LinkedIn
                      </a>
                    ) : null}
                    {signal.top_post_url ? (
                      <a
                        href={signal.top_post_url}
                        target="_blank"
                        rel="noreferrer"
                        title={signal.top_post_title ?? 'Top post'}
                        className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                      >
                        <ExternalLink size={10} /> Top post
                      </a>
                    ) : null}
                  </div>

                  <span className="sr-only">{total}</span>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {showcased.length > 0 ? (
        <section className="card overflow-hidden">
          <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
            <div>
              <h3 className="display text-sm">Keywords in play this week</h3>
              <p className="mt-0.5 text-[11px] text-ink-3">
                <span className="tabular">{showcased.length}</span> scored this run, ranked by trend score.
                Manage the full keyword set under Settings.
              </p>
            </div>
          </header>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-[12px]">
              <thead className="bg-surface">
                <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-ink-3">
                  <th className="px-4 py-2 font-medium">Rank</th>
                  <th className="px-4 py-2 font-medium">Term</th>
                  <th className="px-3 py-2 font-medium">Posts</th>
                  <th className="px-3 py-2 font-medium">Engagement</th>
                  <th className="px-3 py-2 font-medium">Velocity</th>
                  <th className="px-3 py-2 font-medium">Growth</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                </tr>
              </thead>
              <tbody>
                {pagedSignals.map((signal) => {
                  const growth = Number(signal.growth_pct ?? 0)
                  return (
                    <tr
                      key={signal.id}
                      className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2"
                    >
                      <td className="px-4 py-2">
                        {signal.is_trending ? (
                          <Badge tone="accent">#{signal.rank}</Badge>
                        ) : (
                          <span className="tabular text-ink-3">{signal.rank ?? '—'}</span>
                        )}
                      </td>
                      <td className="px-4 py-2 font-medium text-ink">{signal.term}</td>
                      <td className="tabular px-3 py-2 text-ink-2">{signal.post_count}</td>
                      {/* N/A, never 0 — constraint 2. A keyword read from
                          search-indexed pages has no engagement to report, and
                          a literal 0 here reads as "this performed badly". */}
                      <td className="tabular px-3 py-2 text-ink-2">
                        {(signal.measured_count ?? 0) === 0 ? (
                          <span
                            className="text-ink-3"
                            title="No captured post for this keyword stated an engagement figure, so there is no total to report."
                          >
                            N/A
                          </span>
                        ) : (
                          fmt(signal.total_engagement)
                        )}
                      </td>
                      <td className="tabular px-3 py-2 text-ink-2">{Number(signal.velocity).toFixed(1)}</td>
                      <td className={`tabular px-3 py-2 ${growth >= 0 ? 'text-good-ink' : 'text-critical-ink'}`}>
                        {`${growth >= 0 ? '+' : ''}${growth.toFixed(0)}%`}
                      </td>
                      <td className="px-3 py-2">
                        <span
                          className="tabular font-semibold"
                          style={{
                            color:
                              signal.trend_score >= 75
                                ? 'var(--color-good-ink)'
                                : signal.trend_score >= 50
                                  ? 'var(--color-accent-bright)'
                                  : 'var(--color-ink-3)',
                          }}
                        >
                          {signal.trend_score}
                        </span>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>

          {/* Stated as a range, not a page number: "21–40 of 151" answers where
              in the ranking you are, which is the only thing this table is for. */}
          {keywordPages > 1 ? (
            <div className="flex items-center justify-between gap-3 border-t border-line px-4 py-2.5">
              <button
                type="button"
                disabled={kwPage <= 1}
                onClick={() => setKeywordPage(Math.max(1, kwPage - 1))}
                className="rounded-[7px] border border-line-strong px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-ink-2"
              >
                Previous
              </button>
              <span className="tabular text-[11px] text-ink-3">
                {(kwPage - 1) * KEYWORD_PAGE + 1}\u2013{Math.min(kwPage * KEYWORD_PAGE, showcased.length)} of{' '}
                {showcased.length}
              </span>
              <button
                type="button"
                disabled={kwPage >= keywordPages}
                onClick={() => setKeywordPage(Math.min(keywordPages, kwPage + 1))}
                className="rounded-[7px] border border-line-strong px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-ink-2"
              >
                Next
              </button>
            </div>
          ) : null}
        </section>
      ) : (
        <EmptyState
          icon={<Search size={22} />}
          title="No keywords scored yet"
          body="Run discovery and the keywords in play this week will be ranked here. Manage the full keyword set under Settings."
        />
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · HASHTAGS
   ═══════════════════════════════════════════════════════════════════════════ */

function HashtagsTab() {
  const hashtags = useStore((s) => s.hashtags)
  const topHashtags = useStore((s) => s.topHashtags)
  const signals = useStore((s) => s.keywordSignals)
  const setHashtagValidation = useStore((s) => s.setHashtagValidation)
  const buildKnowledge = useStore((s) => s.buildKnowledge)
  const apiMode = useStore((s) => s.apiMode)

  const trending = [...signals].filter((s) => s.is_trending).sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99)).slice(0, 5)

  const groups = trending.map((signal) => ({
    signal,
    tags: hashtags
      .filter((h) => h.keyword_id === signal.keyword_id && h.rank !== null)
      .sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99))
      .slice(0, 5),
  }))

  const maxScore = Math.max(1, ...topHashtags.map((h) => h.hashtag_score))

  return (
    <>
      <div className="grid gap-3 xl:grid-cols-2">
        {groups.map((group) => (
          <section key={group.signal.id} className="card overflow-hidden">
            <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
              <div className="flex items-center gap-2">
                <Badge tone="accent">#{group.signal.rank}</Badge>
                <h3 className="display text-[13px]">{group.signal.term}</h3>
              </div>
              <span className="tabular text-[11px] text-ink-3">top {group.tags.length}</span>
            </header>

            <ul>
              {group.tags.map((tag) => (
                <li key={tag.id} className="flex flex-wrap items-center gap-2 border-b border-line/60 px-4 py-2 last:border-0">
                  <span className="tabular w-5 shrink-0 text-[11px] text-ink-3">{tag.rank}</span>
                  <a
                    href={tag.feed_url ?? `https://www.linkedin.com/feed/hashtag/${encodeURIComponent(tag.tag)}/`}
                    target="_blank"
                    rel="noreferrer"
                    title="Open the hashtag feed on LinkedIn"
                    className="min-w-0 flex-1 truncate text-[12px] font-medium text-ink transition-colors hover:text-accent-bright"
                  >
                    #{tag.display_tag}
                  </a>
                  {tag.top_post_url ? (
                    <a
                      href={tag.top_post_url}
                      target="_blank"
                      rel="noreferrer"
                      title={tag.top_post_title ?? 'Strongest post carrying this tag'}
                      aria-label={`Open the strongest post for #${tag.display_tag}`}
                      className="text-ink-3 transition-colors hover:text-accent-bright"
                    >
                      <ExternalLink size={11} />
                    </a>
                  ) : null}
                  <span className="tabular hidden text-[11px] text-ink-3 sm:block">{tag.post_count} posts</span>
                  <span className="tabular hidden text-[11px] text-ink-3 md:block">
                    {Number(tag.engagement_per_post).toFixed(0)}/post
                  </span>
                  <span className="tabular hidden text-[11px] text-ink-3 lg:block">rel {tag.relevance}%</span>
                  <span className="tabular hidden text-[11px] text-ink-3 lg:block">fresh {tag.freshness}%</span>
                  <span className="tabular text-[11px] font-semibold text-accent-bright">{tag.hashtag_score}</span>
                  <Badge tone={VERDICT_TONE[tag.validation]}>{VERDICT_LABEL[tag.validation]}</Badge>

                  {tag.validation === 'needs_review' ? (
                    <span className="flex items-center gap-1">
                      <button
                        type="button"
                        aria-label={`Approve #${tag.display_tag}`}
                        onClick={() => void setHashtagValidation(tag.id, 'validated')}
                        className="rounded-md border border-good/40 p-1 text-good-ink transition-colors hover:bg-good/10"
                      >
                        <Check size={12} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Reject #${tag.display_tag}`}
                        onClick={() => void setHashtagValidation(tag.id, 'rejected')}
                        className="rounded-md border border-critical/40 p-1 text-critical-ink transition-colors hover:bg-critical/10"
                      >
                        <X size={12} />
                      </button>
                    </span>
                  ) : null}

                  {tag.validation === 'duplicate' && tag.duplicate_of_tag ? (
                    <button
                      type="button"
                      className="text-[11px] text-accent-bright underline decoration-line-strong underline-offset-2"
                    >
                      → merged into #{tag.duplicate_of_tag}
                    </button>
                  ) : null}

                  {tag.verdict_reason ? (
                    <p className="w-full text-[11px] leading-relaxed text-ink-3">{tag.verdict_reason}</p>
                  ) : null}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>

      <section className="card mt-4 p-4">
        <header className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="display text-sm">Top 25 · consolidated</h3>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Merged across all five trending keywords, de-duplicated, and re-ranked globally. This is the
              set the Knowledge Agent researches every Sunday.
            </p>
          </div>
          <div className="flex items-center gap-2">
            {apiMode === 'connected' ? (
              <a
                href={`${API_BASE}/trends.csv`}
                className="inline-flex items-center gap-1.5 rounded-lg border border-line px-3 py-1.5 text-[13px] font-medium text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
              >
                <Download size={13} /> Export with URLs
              </a>
            ) : null}
            <Btn variant="ghost" onClick={() => void buildKnowledge()}>
              <Brain size={13} /> Send to Knowledge Base
            </Btn>
          </div>
        </header>

        <div className="flex flex-wrap gap-2">
          {topHashtags.map((tag, i) => {
            const scale = 0.82 + (tag.hashtag_score / maxScore) * 0.42
            return (
              <a
                key={tag.id}
                href={tag.feed_url ?? `https://www.linkedin.com/feed/hashtag/${encodeURIComponent(tag.tag)}/`}
                target="_blank"
                rel="noreferrer"
                title={tag.top_post_title ? `Strongest post: ${tag.top_post_title}` : 'Open the hashtag feed on LinkedIn'}
                className="anim-fade-up inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2.5 py-1 transition-colors hover:border-accent"
                style={{ fontSize: `${(11 * scale).toFixed(1)}px`, animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <span className="tabular text-ink-3">{i + 1}</span>
                <span className="font-medium text-ink">#{tag.display_tag}</span>
                <span className="tabular text-ink-3">{tag.hashtag_score}</span>
                {tag.researched_at ? (
                  <span className="text-[10.5px] text-good-ink">researched {timeAgo(tag.researched_at)}</span>
                ) : null}
              </a>
            )
          })}
        </div>
      </section>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   3 · SCRAPED DATA
   ═══════════════════════════════════════════════════════════════════════════ */

function ScrapedTab() {
  const scraped = useStore((s) => s.scraped)
  const openTheater = useStore((s) => s.openTheater)
  const runScraping = useStore((s) => s.runScraping)

  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<ValidationVerdict | 'all'>('all')
  /** The content-scraper specification asks for a table sorted by views, highest first. */
  const [sort, setSort] = useState<'views' | 'engagement' | 'captured'>('views')
  const [viralOnly, setViralOnly] = useState(false)

  const rows = scraped
    .filter((item) => {
      if (filter !== 'all' && item.validation !== filter) return false
      if (viralOnly && !(item.signal_flags ?? []).includes('VIRAL')) return false
      if (query.trim().length === 0) return true
      const haystack = `${item.title} ${item.snippet ?? ''} ${item.keyword_term ?? ''} ${item.author_name ?? ''}`.toLowerCase()
      return haystack.includes(query.toLowerCase())
    })
    /*
     * ROWS THAT STATE THE FIGURE SORT ABOVE ROWS THAT DO NOT.
     *
     * Sorting by views with an absent count read as 0 would bury every
     * open-web capture at the bottom as though it had been watched by nobody.
     * They are not the worst performers; they are unmeasured, so they sort
     * after the measured ones as a group and the cell says so.
     */
    .slice()
    .sort((a, b) => {
      if (sort === 'captured') return b.scraped_at.localeCompare(a.scraped_at)
      if (sort === 'engagement') {
        if (a.metrics_available !== b.metrics_available) return a.metrics_available ? -1 : 1
        return b.engagement - a.engagement
      }
      if (a.views_available !== b.views_available) return a.views_available ? -1 : 1
      return b.views - a.views
    })

  const viralCount = scraped.filter((s) => (s.signal_flags ?? []).includes('VIRAL')).length

  /* ── Paging the scraped table ─────────────────────────────────────────
     A run leaves hundreds of captured pages here and every one of them was in
     a single table, so the sort order only ever showed its own head and the
     tail was reachable by scrolling alone.

     Page 1 is the top of whatever sort is selected, so paging forward walks
     down the ranking the operator chose rather than back through time. The
     page resets whenever the filter, search or sort changes, because the list
     underneath is then a different list and holding position in it would land
     the reader somewhere arbitrary.
  */
  const scrapedPages = Math.max(1, Math.ceil(rows.length / SCRAPED_PAGE))
  const [scrapedPage, setScrapedPage] = useState(1)
  const sPage = Math.min(scrapedPage, scrapedPages)
  const pagedRows = rows.slice((sPage - 1) * SCRAPED_PAGE, sPage * SCRAPED_PAGE)

  useEffect(() => {
    setScrapedPage(1)
  }, [filter, query, sort, viralOnly])

  if (scraped.length === 0) {
    return (
      <EmptyState
        icon={<Search size={22} />}
        title="Nothing captured yet"
        body="Run discovery and Sherlock will surface LinkedIn posts across the active keyword set."
        action={
          <PlayButton
            label="Run SocialAI"
            onClick={() => {
              openTheater()
              void runScraping()
            }}
          />
        }
      />
    )
  }

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative flex-1 min-w-56">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search captured posts…"
            aria-label="Search captured posts"
            className="w-full rounded-lg border border-line bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] outline-none focus:border-accent"
          />
        </label>
        <Select
          value={sort}
          onChange={(v) => setSort(v as 'views' | 'engagement' | 'captured')}
          ariaLabel="Sort captured posts"
          options={[
            { value: 'views', label: 'Sort: views' },
            { value: 'engagement', label: 'Sort: engagement' },
            { value: 'captured', label: 'Sort: newest' },
          ]}
        />
        <button
          type="button"
          onClick={() => setViralOnly(!viralOnly)}
          aria-pressed={viralOnly}
          title="Posts at or above the viral engagement rate or the play floor. Both thresholds are knobs on the validation agent."
          className={`rounded-lg border px-3 py-1.5 text-[11.5px] font-semibold transition-colors ${
            viralOnly ? 'border-magenta text-magenta-ink' : 'border-line text-ink-3 hover:text-ink'
          }`}
        >
          VIRAL <span className="tabular">{viralCount}</span>
        </button>
        <Tabs<ValidationVerdict | 'all'>
          active={filter}
          onChange={setFilter}
          tabs={[
            { id: 'all', label: 'All', count: scraped.length },
            { id: 'validated', label: 'Validated', count: scraped.filter((s) => s.validation === 'validated').length },
            { id: 'needs_review', label: 'Needs review', count: scraped.filter((s) => s.validation === 'needs_review').length },
            { id: 'duplicate', label: 'Duplicate', count: scraped.filter((s) => s.validation === 'duplicate').length },
            { id: 'rejected', label: 'Rejected', count: scraped.filter((s) => s.validation === 'rejected').length },
          ]}
        />
      </div>

      <div className="card overflow-x-auto">
        <table className="w-full min-w-[880px] text-left text-[12px]">
          <thead>
            <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-ink-3">
              <th className="px-4 py-2 font-medium">Hook &amp; caption</th>
              <th className="px-3 py-2 font-medium">Platform</th>
              <th className="px-3 py-2 font-medium">Format</th>
              <th className="px-3 py-2 font-medium">Views</th>
              <th className="px-3 py-2 font-medium">Likes</th>
              <th className="px-3 py-2 font-medium">Comments</th>
              <th className="px-3 py-2 font-medium">ER</th>
              <th className="px-3 py-2 font-medium">Posted</th>
              <th className="px-3 py-2 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {pagedRows.map((item) => {
              const fresh = Date.now() - new Date(item.scraped_at).getTime() < 15 * 60_000
              return (
                <tr key={item.id} className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2">
                  {/* Hook first: it is what a reader decides on, and the
                      specification collects it as a field of its own. */}
                  <td className="max-w-[340px] px-4 py-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      {/*
                        THE HOOK LINKS TO THE PAGE IT WAS SCRAPED FROM.

                        This row carries a hook, a snippet, an author and a
                        verdict, all lifted from a page it never named — so a
                        row that looked wrong could not be checked against its
                        source, which is the first thing anyone wants to do with
                        scraped data.

                        Plain text when the capture recorded no URL. Some lanes
                        genuinely return none, and a dead link that looks live
                        is worse than no link at all.
                      */}
                      {item.url ? (
                        <a
                          href={item.url}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="group/src inline-flex min-w-0 items-center gap-1 truncate font-medium text-ink underline decoration-line-strong decoration-dotted underline-offset-[3px] transition-colors hover:text-accent-bright hover:decoration-accent"
                          title={`${item.title}\n${item.url}`}
                        >
                          <span className="truncate">{item.hook ?? item.title}</span>
                          <ExternalLink
                            size={11}
                            className="shrink-0 opacity-0 transition-opacity group-hover/src:opacity-100"
                            aria-hidden="true"
                          />
                          <span className="sr-only">(opens the scraped page in a new tab)</span>
                        </a>
                      ) : (
                        <span className="truncate font-medium text-ink">{item.hook ?? item.title}</span>
                      )}
                      {(item.signal_flags ?? []).includes('VIRAL') ? (
                        <Badge tone="magenta">VIRAL</Badge>
                      ) : null}
                      {fresh ? <Badge tone="accent">NEW</Badge> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-3">
                      {item.snippet}
                    </span>
                    <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">
                      {item.author_name ?? 'Unknown author'} · {item.keyword_term ?? 'no keyword'}
                      {item.transcript === null ? '' : ' · transcribed'}
                    </span>
                  </td>
                  <td className="px-3 py-2 text-ink-3">{platformLabel(item.platform)}</td>
                  <td className="px-3 py-2 text-ink-3">{item.media_format ?? '—'}</td>
                  {/*
                    CONSTRAINT 2, THREE TIMES OVER.

                    Views, likes and engagement rate each have their OWN
                    availability, and an em dash with a title attribute is the
                    honest cell for each. A zero in any of these would read as a
                    verdict on the post rather than as the absence of a figure —
                    and "0 views" is the single most misleading thing this table
                    could say about an article that was never a video.
                  */}
                  <td className="tabular px-3 py-2 text-ink-2">
                    {item.views_available ? (
                      fmt(item.views)
                    ) : (
                      <span className="text-ink-3" title="This source states no play count. It is not a video that nobody watched.">
                        n/a
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-ink-2">
                    {item.metrics_available ? (
                      fmt(item.reactions)
                    ) : (
                      <span className="text-ink-3" title="This source states no engagement figures">
                        n/a
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2 text-ink-2">
                    {item.metrics_available ? (
                      fmt(item.comments)
                    ) : (
                      <span className="text-ink-3" title="This source states no engagement figures">
                        n/a
                      </span>
                    )}
                  </td>
                  <td className="tabular px-3 py-2">
                    {item.engagement_rate === null ? (
                      <span
                        className="text-ink-3"
                        title="Not computable: an engagement rate needs both a play count and a reaction count, and this post states only one."
                      >
                        n/a
                      </span>
                    ) : (
                      <span
                        className="font-medium"
                        style={{
                          color: (item.signal_flags ?? []).includes('viral-er')
                            ? 'var(--color-magenta-ink)'
                            : 'var(--color-ink-2)',
                        }}
                      >
                        {item.engagement_rate}%
                      </span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-ink-3">
                    {item.posted_at === null ? (
                      <span title="This source stated no post date; capture time was used instead.">
                        {timeAgo(item.scraped_at)}
                      </span>
                    ) : (
                      timeAgo(item.posted_at)
                    )}
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={VERDICT_TONE[item.validation]}>{VERDICT_LABEL[item.validation]}</Badge>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* Stated as a range against the filtered total, so the count agrees with
          the tabs above it rather than with the whole capture history. */}
      {scrapedPages > 1 ? (
        <div className="mt-2 flex items-center justify-between gap-3 rounded-[10px] border border-line px-4 py-2.5">
          <button
            type="button"
            disabled={sPage <= 1}
            onClick={() => setScrapedPage(Math.max(1, sPage - 1))}
            className="rounded-[7px] border border-line-strong px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-ink-2"
          >
            Previous
          </button>
          <span className="tabular text-[11px] text-ink-3">
            {(sPage - 1) * SCRAPED_PAGE + 1}–{Math.min(sPage * SCRAPED_PAGE, rows.length)} of {rows.length}
          </span>
          <button
            type="button"
            disabled={sPage >= scrapedPages}
            onClick={() => setScrapedPage(Math.min(scrapedPages, sPage + 1))}
            className="rounded-[7px] border border-line-strong px-2.5 py-1 text-[11px] text-ink-2 transition-colors hover:border-accent hover:text-ink disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-line-strong disabled:hover:text-ink-2"
          >
            Next
          </button>
        </div>
      ) : null}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   4 · VALIDATION
   ═══════════════════════════════════════════════════════════════════════════ */

function ValidationTab() {
  const scraped = useStore((s) => s.scraped)
  const validating = useStore((s) => s.validating)
  const setValidation = useStore((s) => s.setValidation)

  const cards: ScrapedItem[] = [...scraped]
    .sort((a, b) => {
      if (a.validation === 'needs_review' && b.validation !== 'needs_review') return -1
      if (b.validation === 'needs_review' && a.validation !== 'needs_review') return 1
      return b.relevance - a.relevance
    })
    .slice(0, 24)

  return (
    <div className="stagger-fade grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((item, i) => (
        <article
          key={item.id}
          className="card card-hover anim-fade-up p-3"
          style={{ ['--i' as string]: i, animationDelay: `${Math.min(i, 12) * 30}ms` }}
        >
          <div className="flex items-start justify-between gap-2">
            <h4 className="line-clamp-2 flex-1 text-[12.5px] font-medium text-ink">{item.title}</h4>
            {validating ? (
              <span
                className="h-3 w-3 shrink-0 rounded-full border-2 border-accent border-t-transparent"
                style={{ animation: 'ring-spin 1.4s linear infinite' }}
                aria-label="Scoring"
              />
            ) : (
              <Badge tone={VERDICT_TONE[item.validation]}>{VERDICT_LABEL[item.validation]}</Badge>
            )}
          </div>

          <p className="mt-1 line-clamp-2 text-[11px] leading-relaxed text-ink-3">{item.snippet}</p>

          <div className="mt-2.5 grid grid-cols-3 gap-1.5">
            <Metric label="Source" value={item.source_type ?? '—'} />
            <Metric
              label="Credibility"
              value={item.credibility}
              tone={item.credibility === 'High' ? 'good' : item.credibility === 'Low' ? 'critical' : 'warn'}
            />
            <Metric label="Relevance" value={`${item.relevance}%`} />
            <Metric label="Freshness" value={`${item.freshness}%`} />
            <Metric label="Duplicate" value={item.is_duplicate ? 'Yes' : 'No'} tone={item.is_duplicate ? 'warn' : undefined} />
            <Metric label="Quality" value={Math.round((item.relevance + item.freshness) / 2)} />
          </div>

          {item.verdict_reason ? (
            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{item.verdict_reason}</p>
          ) : null}

          {item.validation === 'needs_review' ? (
            <div className="mt-2.5 flex items-center gap-2">
              <Btn variant="primary" onClick={() => void setValidation(item.id, 'validated')}>
                <Check size={12} /> Approve
              </Btn>
              <Btn variant="ghost" onClick={() => void setValidation(item.id, 'rejected')}>
                <X size={12} /> Reject
              </Btn>
            </div>
          ) : null}
        </article>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · AI ANALYSIS
   ═══════════════════════════════════════════════════════════════════════════ */

function AnalysisTab() {
  const scraped = useStore((s) => s.scraped)
  const hashtags = useStore((s) => s.hashtags)
  const toast = useStore((s) => s.toast)
  const setPage = useStore((s) => s.setPage)

  const top = [...scraped]
    .filter((s) => s.validation === 'validated')
    .sort((a, b) => b.relevance - a.relevance)
    .slice(0, 8)

  const hashtagFor = (item: ScrapedItem): Hashtag | undefined =>
    hashtags.find((h) => item.hashtags.includes(h.display_tag))

  return (
    <div className="stagger-fade grid gap-3 lg:grid-cols-2">
      {top.map((item, i) => {
        const tag = hashtagFor(item)
        // The score the Scraping Agent computed at capture, not a derivation
        // of the Validation Agent's relevance. Two different measurements.
        const brandRelevance = item.brand_relevance
        const trendScore = tag?.hashtag_score ?? Math.round(item.relevance * 0.92)

        return (
          <article
            key={item.id}
            className="card card-hover anim-fade-up p-4"
            style={{ ['--i' as string]: i, animationDelay: `${Math.min(i, 12) * 30}ms` }}
          >
            <div className="flex items-start gap-3">
              <ScoreRing value={item.relevance} size={54} label="rel" />
              <div className="min-w-0 flex-1">
                <h4 className="text-[13px] font-medium text-ink">{item.title}</h4>
                <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">{item.snippet}</p>
              </div>
            </div>

            <div className="mt-3 grid grid-cols-2 gap-1.5 sm:grid-cols-3">
              <Metric label="Brand relevance" value={`${brandRelevance}%`} />
              <Metric label="Trend score" value={trendScore} />
              <Metric
                label="Engagement"
                value={item.metrics_available ? fmt(item.engagement) : 'Not stated'}
              />
              <Metric label="Source" value={item.source_type ?? '—'} />
              <Metric label="Platform" value={platformLabel(item.platform)} />
              <Metric
                label="Best day"
                value={new Date(item.posted_at ?? item.scraped_at).toLocaleDateString('en-GB', { weekday: 'long' })}
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Btn
                variant="primary"
                onClick={() => {
                  toast(`"${item.title}" queued for Dora.`, 'good')
                  setPage('calendar')
                }}
              >
                <Sparkles size={12} /> Add to calendar
              </Btn>
              {item.url ? (
                <a
                  href={item.url}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 text-[11px] text-ink-3 transition-colors hover:text-accent-bright"
                >
                  Open source <ArrowRight size={11} />
                </a>
              ) : null}
            </div>
          </article>
        )
      })}
    </div>
  )
}

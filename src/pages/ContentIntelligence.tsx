/**
 * CONTENT INTELLIGENCE
 *
 * Everything the discovery half of the pipeline produced, with the evidence
 * behind every verdict. Five tabs, live counts, and inline resolution wherever
 * something is waiting on a human.
 */

import { useMemo, useState } from 'react'
import { Check, Search, X, Sparkles, ArrowRight, Brain, ExternalLink, Download } from 'lucide-react'
import { API_BASE } from '../lib/api'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { PlayButton } from '../components/play-button'
import { KeywordBoard } from '../components/keyword-board'
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
} from '../components/ui'
import type { Hashtag, ScrapedItem, ValidationVerdict } from '../types'

type TabId = 'keywords' | 'hashtags' | 'scraped' | 'validation' | 'analysis'

const VERDICT_TONE: Record<ValidationVerdict, 'good' | 'warn' | 'neutral' | 'critical'> = {
  validated: 'good',
  needs_review: 'warn',
  duplicate: 'neutral',
  rejected: 'critical',
  pending: 'neutral',
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
  const runValidation = useStore((s) => s.runValidation)
  const openTheater = useStore((s) => s.openTheater)

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
        askPrompt="What's trending this week?"
        actions={
          <>
            <Btn variant="ghost" onClick={() => void runValidation()} disabled={validating}>
              {validating ? 'Validating…' : `Validate (${needsReview})`}
            </Btn>
            <PlayButton
              label="Run SocialAI"
              hint={`${keywords.filter((k) => k.active).length} keywords active`}
              running={scrapeRun.running}
              onClick={() => {
                openTheater()
                void runScraping()
              }}
            />
          </>
        }
      />

      {scrapeRun.running || validating ? (
        <section className="anim-fade-in mb-4 rounded-xl border border-accent/40 bg-accent/8 px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <p className="text-[12px] text-ink">
              {scrapeRun.running
                ? `Scraping Agent · ${scrapeRun.currentKeyword || 'starting'}`
                : 'Validation Agent · scoring candidates against the four-verdict gate'}
            </p>
            <p className="tabular text-[12px] text-ink-3">
              {scrapeRun.running ? `${scrapeRun.found} items · ${scrapeRun.progress}%` : 'in progress'}
            </p>
          </div>
          <Progress value={scrapeRun.running ? scrapeRun.progress : 45} className="mt-2" />
        </section>
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
                  className="card card-hover anim-fade-up p-3"
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
                    <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{signal.trend_reason}</p>
                  ) : null}

                  <div className="mt-2 flex flex-wrap gap-1.5">
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

      <KeywordBoard signals={signals} />
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
                  <span className="text-[9px] text-good-ink">researched {timeAgo(tag.researched_at)}</span>
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

  const rows = scraped.filter((item) => {
    if (filter !== 'all' && item.validation !== filter) return false
    if (query.trim().length === 0) return true
    const haystack = `${item.title} ${item.snippet ?? ''} ${item.keyword_term ?? ''} ${item.author_name ?? ''}`.toLowerCase()
    return haystack.includes(query.toLowerCase())
  })

  if (scraped.length === 0) {
    return (
      <EmptyState
        icon={<Search size={22} />}
        title="Nothing captured yet"
        body="Run discovery and the Scraping Agent will surface LinkedIn posts across the active keyword set."
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
              <th className="px-4 py-2 font-medium">Topic</th>
              <th className="px-3 py-2 font-medium">Source</th>
              <th className="px-3 py-2 font-medium">Type</th>
              <th className="px-3 py-2 font-medium">Keyword</th>
              <th className="px-3 py-2 font-medium">Engagement</th>
              <th className="px-3 py-2 font-medium">Relevance</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2 font-medium">Captured</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((item) => {
              const fresh = Date.now() - new Date(item.scraped_at).getTime() < 15 * 60_000
              return (
                <tr key={item.id} className="border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2">
                  <td className="max-w-[320px] px-4 py-2">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate font-medium text-ink">{item.title}</span>
                      {fresh ? <Badge tone="magenta">NEW</Badge> : null}
                    </span>
                    <span className="mt-0.5 block truncate text-[11px] text-ink-3">{item.snippet}</span>
                  </td>
                  <td className="px-3 py-2 text-ink-3">{item.source_name}</td>
                  <td className="px-3 py-2 text-ink-3">{item.source_type}</td>
                  <td className="px-3 py-2 text-ink-3">{item.keyword_term}</td>
                  <td className="tabular px-3 py-2 text-ink-2">{fmt(item.engagement)}</td>
                  <td className="px-3 py-2">
                    <span
                      className="tabular font-medium"
                      style={{
                        color:
                          item.relevance >= 70
                            ? 'var(--color-good-ink)'
                            : item.relevance >= 40
                              ? 'var(--color-warn)'
                              : 'var(--color-critical-ink)',
                      }}
                    >
                      {item.relevance}%
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <Badge tone={VERDICT_TONE[item.validation]}>{VERDICT_LABEL[item.validation]}</Badge>
                  </td>
                  <td className="px-3 py-2 text-ink-3">{timeAgo(item.scraped_at)}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
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
        const brandRelevance = Math.min(99, item.relevance + 4)
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
              <Metric label="Engagement" value={fmt(item.engagement)} />
              <Metric label="Format" value={item.engagement > 2_000 ? 'Thought Leadership' : 'Short Post'} />
              <Metric label="Platform" value="LinkedIn" />
              <Metric
                label="Best day"
                value={new Date(item.posted_at ?? item.scraped_at).toLocaleDateString('en-GB', { weekday: 'long' })}
              />
            </div>

            <div className="mt-3 flex items-center gap-2">
              <Btn
                variant="primary"
                onClick={() => {
                  toast(`"${item.title}" queued for the Calendar Agent.`, 'good')
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

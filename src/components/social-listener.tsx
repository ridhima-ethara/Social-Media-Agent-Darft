/**
 * SOCIAL MEDIA LISTENER — the Analysis Agent's report on Ethara.AI's own
 * channels (SocialFetch data; Claude reads comments and writes insights).
 *
 * Answers: what is happening around Ethara.AI on social media, and what are
 * people saying about the company?
 *
 *   Summary + sample size  →  The three answers  →  Reputation (ORM)
 *   →  Platform cards  →  Post performance  →  What people are saying  →  Key insights
 *
 * Business-friendly: no raw model output, every figure from the stored report,
 * the sample size always stated, and sentiment labelled as a signal.
 */

import { ExternalLink, RefreshCw, ShieldCheck, Star } from 'lucide-react'
import type {
  AnalysedPost,
  FeedbackItem,
  GlassdoorAnalysis,
  ListenerAnswers,
  PlatformListening,
  ReputationIssue,
  ReputationReport,
  SentimentCounts,
  SocialMediaListener,
} from '@shared/social-listener'
import { useStore } from '../store'
import type { Platform } from '../types'
import { Badge, PlatformIcon, timeAgo } from './ui'

type Report = SocialMediaListener & { stored_at?: string }

const ORDER = ['linkedin', 'instagram', 'facebook', 'x'] as const

const FEEDBACK_LABEL: Record<FeedbackItem['kind'], string> = {
  praise: 'Positive feedback',
  complaint: 'Negative feedback',
  concern: 'Concerns',
  question: 'Questions',
  request: 'Requests',
  suggestion: 'Suggestions',
  topic: 'Common discussion',
}

const FEEDBACK_TONE: Record<FeedbackItem['kind'], 'good' | 'warn' | 'serious' | 'neutral' | 'accent'> = {
  praise: 'good',
  complaint: 'serious',
  concern: 'warn',
  question: 'accent',
  request: 'accent',
  suggestion: 'neutral',
  topic: 'neutral',
}

function asPlatform(id: string): Platform | null {
  return id === 'linkedin' || id === 'instagram' || id === 'x' || id === 'facebook' ? id : null
}

function fmt(n: number | null | undefined): string {
  if (n === null || n === undefined) return '—'
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-GB')
}

function excerpt(text: string, n = 110): string {
  const flat = text.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat || '(no text — a repost or media-only post)'
}

/** The three-way sentiment split as one bar. Nothing is drawn when nothing was read. */
export function SentimentBar({ s, compact = false }: { s: SentimentCounts | null; compact?: boolean }) {
  if (!s || s.classified === 0) {
    return <span className="text-[10.5px] text-ink-3">not measured — no comments read</span>
  }
  const parts = [
    { key: 'positive', n: s.positive, pct: s.positive_percent ?? 0, colour: 'var(--color-good)' },
    { key: 'neutral', n: s.neutral, pct: s.neutral_percent ?? 0, colour: 'var(--color-ink-3)' },
    { key: 'negative', n: s.negative, pct: s.negative_percent ?? 0, colour: 'var(--color-critical)' },
  ]
  return (
    <span className="block min-w-0">
      <span className="flex h-[7px] w-full overflow-hidden rounded-full bg-surface-3" aria-hidden="true">
        {parts.map((p) => (p.pct > 0 ? <span key={p.key} style={{ width: `${p.pct}%`, background: p.colour }} /> : null))}
      </span>
      {!compact ? (
        <span className="tabular mt-1 flex flex-wrap gap-x-2.5 text-[10px] text-ink-3">
          {parts.map((p) => (
            <span key={p.key}>
              <span className="inline-block h-1.5 w-1.5 rounded-full align-middle" style={{ background: p.colour }} /> {p.pct}% {p.key}{' '}
              <span className="text-ink-3/80">({p.n})</span>
            </span>
          ))}
          <span>· {s.classified} comment{s.classified === 1 ? '' : 's'} read</span>
        </span>
      ) : (
        <span className="sr-only">
          {s.positive_percent}% positive, {s.neutral_percent}% neutral, {s.negative_percent}% negative of {s.classified} comments
        </span>
      )}
    </span>
  )
}

function PlatformCard({ p }: { p: PlatformListening }) {
  const icon = asPlatform(p.platform)
  const ok = p.status === 'ok'
  return (
    <div className="rounded-xl border border-line bg-surface-2/50 p-3">
      <div className="flex items-center gap-2">
        {icon ? <PlatformIcon platform={icon} size={14} /> : null}
        <span className="text-[13px] font-semibold text-ink">{p.label}</span>
        {p.account?.followers !== null && p.account?.followers !== undefined ? (
          <span className="tabular text-[10.5px] text-ink-3">{fmt(p.account.followers)} followers</span>
        ) : null}
        <Badge tone={ok ? 'good' : p.status === 'not_configured' ? 'neutral' : 'warn'} className="ml-auto">
          {ok ? 'listening' : p.status.replace('_', ' ')}
        </Badge>
      </div>
      {ok ? (
        <>
          <div className="tabular mt-2.5 grid grid-cols-3 gap-2 text-center">
            <Figure label="posts" value={String(p.posts_analyzed)} />
            <Figure label="comments" value={String(p.comments_analyzed)} />
            <Figure label="avg engagement" value={fmt(p.engagement.average_per_post)} />
          </div>
          <p className="tabular mt-1.5 text-center text-[10px] text-ink-3">
            {p.engagement.average_rate !== null ? `${p.engagement.average_rate}% avg engagement rate` : 'engagement rate not measurable'}
            {p.engagement.total !== null ? ` · ${fmt(p.engagement.total)} total` : ''}
          </p>
          <div className="mt-2.5">
            <SentimentBar s={p.sentiment} />
          </div>
        </>
      ) : (
        <p className="mt-2 text-[11px] leading-snug text-ink-3">{p.reason}</p>
      )}
    </div>
  )
}

function Figure({ label, value }: { label: string; value: string }) {
  return (
    <span className="block">
      <span className="block text-[16px] font-semibold leading-none text-ink">{value}</span>
      <span className="mono mt-1 block text-[8.5px] uppercase tracking-[0.1em] text-ink-3">{label}</span>
    </span>
  )
}

function PostTable({ posts }: { posts: AnalysedPost[] }) {
  if (posts.length === 0) return <p className="text-[11.5px] text-ink-3">No post data was returned.</p>
  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-[760px] border-collapse text-left">
        <thead>
          <tr className="mono border-b border-line text-[8.5px] uppercase tracking-[0.1em] text-ink-3">
            <th scope="col" className="py-2 pr-2 font-medium">Post</th>
            <th scope="col" className="px-2 py-2 font-medium">Date</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Engagement</th>
            <th scope="col" className="px-2 py-2 font-medium">Theme</th>
            <th scope="col" className="py-2 pl-2 font-medium">Comment sentiment</th>
          </tr>
        </thead>
        <tbody className="tabular">
          {posts.map((post) => {
            const icon = asPlatform(post.platform)
            return (
              <tr key={`${post.platform}:${post.post_id}`} className="border-b border-line/60 align-top text-[11.5px] last:border-b-0">
                <td className="max-w-[320px] py-2 pr-2">
                  <a
                    href={post.post_url}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="group inline-flex items-start gap-1.5 text-ink hover:text-accent-bright"
                    title={post.text}
                  >
                    {icon ? <PlatformIcon platform={icon} size={11} /> : null}
                    <span>
                      {excerpt(post.text)}
                      {post.is_repost ? <span className="mono ml-1 text-[8.5px] uppercase text-ink-3">repost</span> : null}
                    </span>
                    <ExternalLink size={10} className="mt-0.5 shrink-0 opacity-60" aria-hidden="true" />
                  </a>
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-ink-2" title={post.published_at ?? ''}>
                  {post.published_at ? post.published_at.slice(0, 10) : 'undated'}
                </td>
                <td className="whitespace-nowrap px-2 py-2 text-right">
                  <span className="font-semibold text-ink">{fmt(post.total_engagement)}</span>
                  <span className="block text-[9.5px] text-ink-3">
                    {fmt(post.reactions)} reactions · {fmt(post.comments)} comments
                    {post.video_views !== null ? ` · ${fmt(post.video_views)} views` : ''}
                  </span>
                  {post.engagement_rate !== null ? <span className="block text-[9.5px] text-ink-3">{post.engagement_rate}% rate</span> : null}
                </td>
                <td className="px-2 py-2">
                  <span className="flex flex-wrap gap-1">
                    {post.topics.map((t) => (
                      <span key={t} className="rounded-full border border-line-strong px-1.5 py-px text-[9.5px] text-ink-2">
                        {t}
                      </span>
                    ))}
                  </span>
                </td>
                <td className="min-w-[150px] py-2 pl-2">
                  {post.comment_sentiment ? (
                    <SentimentBar s={post.comment_sentiment} compact />
                  ) : (
                    <span className="text-[10px] text-ink-3">{post.comments_analysed > 0 ? 'not read' : 'no comments read'}</span>
                  )}
                  {post.comment_sentiment ? (
                    <span className="mt-1 block text-[9.5px] text-ink-3">
                      {post.comment_sentiment.positive_percent}% positive of {post.comment_sentiment.classified}
                    </span>
                  ) : null}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function FeedbackList({ items }: { items: Array<FeedbackItem & { platform?: string }> }) {
  if (items.length === 0) {
    return <p className="text-[11.5px] text-ink-3">Nothing to summarise — no comments were read on these channels.</p>
  }
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {items.map((f, i) => (
        <li key={`${f.kind}-${i}`} className="rounded-lg border border-line bg-surface-2/40 p-2.5">
          <div className="flex items-center gap-1.5">
            <Badge tone={FEEDBACK_TONE[f.kind]}>{FEEDBACK_LABEL[f.kind]}</Badge>
            {f.platform ? <span className="text-[10px] text-ink-3">{f.platform}</span> : null}
            <span className="tabular ml-auto text-[10px] text-ink-3">
              {f.count} comment{f.count === 1 ? '' : 's'}
            </span>
          </div>
          <p className="mt-1.5 text-[11.5px] leading-snug text-ink-2">{f.summary}</p>
        </li>
      ))}
    </ul>
  )
}

/** A 0–5 star rating rendered as filled/empty stars plus the number. */
function StarRating({ rating }: { rating: number | null }) {
  if (rating === null) return <span className="text-[10.5px] text-ink-3">not rated</span>
  const rounded = Math.round(rating)
  return (
    <span className="inline-flex items-center gap-1" title={`${rating} out of 5`}>
      <span className="inline-flex" aria-hidden="true">
        {[1, 2, 3, 4, 5].map((i) => (
          <Star key={i} size={12} className={i <= rounded ? 'fill-accent text-accent' : 'text-ink-3'} />
        ))}
      </span>
      <span className="tabular text-[12px] font-semibold text-ink">{rating}</span>
      <span className="text-[10px] text-ink-3">/ 5</span>
    </span>
  )
}

/**
 * GLASSDOOR — what employees say about Ethara.AI, read through FetchLayer.
 *
 * A distinct panel from the social channels: the rating, recommend/CEO
 * approval, the sub-ratings Glassdoor breaks out, review sentiment, the
 * recurring pros and cons, and the most recent reviews. Every figure is
 * Glassdoor's own; an unstated one shows as "—", never a zero.
 */
/** The Glassdoor heading, with a refresh that re-reads Glassdoor only (FetchLayer), never the platforms. */
function GlassdoorHeading() {
  const running = useStore((s) => s.glassdoorRunning)
  const refresh = useStore((s) => s.refreshGlassdoor)
  return (
    <div className="mt-4 flex items-center gap-2">
      <h4 className="text-[12px] font-semibold text-ink">Glassdoor · what employees say</h4>
      <button
        type="button"
        onClick={() => void refresh()}
        disabled={running}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-accent/50 px-2.5 py-1 text-[10.5px] font-semibold text-accent-bright transition-colors hover:border-accent hover:bg-accent/10 disabled:cursor-wait disabled:opacity-50"
      >
        <RefreshCw size={11} className={running ? 'animate-spin' : ''} aria-hidden="true" />
        {running ? 'Reading Glassdoor…' : 'Read Glassdoor'}
      </button>
    </div>
  )
}

function GlassdoorSection({ g }: { g: GlassdoorAnalysis }) {
  if (g.status !== 'ok') {
    return (
      <>
        <GlassdoorHeading />
        <div className="mt-2 rounded-xl border border-line bg-surface-2/50 p-3">
          <p className="text-[11.5px] leading-snug text-ink-3">
            {g.status === 'not_configured'
              ? g.reason ?? 'Glassdoor is not configured (FETCHLAYER_API_KEY).'
              : g.status === 'not_found'
                ? g.reason ?? `No Glassdoor employer found for ${g.employer ?? 'the company'}.`
                : g.reason ?? 'Glassdoor could not be read this run.'}
          </p>
        </div>
      </>
    )
  }
  return (
    <>
      <GlassdoorHeading />
      <div className="mt-2 rounded-xl border border-line bg-surface-2/50 p-3">
        {/* headline figures */}
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
          <div>
            <StarRating rating={g.overall_rating} />
            <p className="tabular mt-0.5 text-[10px] text-ink-3">
              {g.employerUrl ? (
                <a href={g.employerUrl} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 hover:text-accent-bright">
                  {g.employer ?? 'Employer'} on Glassdoor <ExternalLink size={9} aria-hidden="true" />
                </a>
              ) : (
                g.employer ?? 'Employer'
              )}
              {g.review_count !== null ? ` · ${fmt(g.review_count)} reviews` : ''}
            </p>
          </div>
          <div className="tabular grid grid-cols-2 gap-x-4 gap-y-1">
            <Figure label="recommend" value={g.recommend_percent !== null ? `${g.recommend_percent}%` : '—'} />
            <Figure label="CEO approval" value={g.ceo_approval_percent !== null ? `${g.ceo_approval_percent}%` : '—'} />
          </div>
        </div>

        {/* sub-ratings, only the ones stated */}
        {g.category_ratings.length > 0 ? (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {g.category_ratings.map((c) => (
              <span key={c.label} className="tabular rounded-full border border-line-strong px-2 py-0.5 text-[10px] text-ink-2">
                {c.label} <span className="font-semibold text-ink">{c.rating}</span>
              </span>
            ))}
          </div>
        ) : null}

        {/* review sentiment */}
        <div className="mt-3 max-w-[420px]">
          <p className="mb-1 text-[10.5px] text-ink-3">
            Review sentiment {g.reviews_analyzed > 0 ? `· ${g.reviews_analyzed} review${g.reviews_analyzed === 1 ? '' : 's'} read` : ''}
          </p>
          <SentimentBar s={g.sentiment} />
        </div>

        {/* pros and cons themes */}
        {(g.pros_themes.length > 0 || g.cons_themes.length > 0) ? (
          <div className="mt-3 grid gap-2 md:grid-cols-2">
            <div className="rounded-lg border border-good/40 bg-good/[0.06] p-2.5">
              <p className="text-[11px] font-semibold text-ink">What employees like</p>
              {g.pros_themes.length === 0 ? (
                <p className="mt-1 text-[10.5px] text-ink-3">No recurring positive theme in the reviews read.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {g.pros_themes.slice(0, 5).map((t) => (
                    <li key={t.label} className="text-[11px] leading-snug text-ink-2">
                      <span className="font-medium text-ink">{t.label}</span> <span className="text-ink-3">· {t.count}</span>
                      {t.example ? <span className="block text-[10px] text-ink-3">“{t.example}”</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
            <div className="rounded-lg border border-warn/40 bg-warn/[0.06] p-2.5">
              <p className="text-[11px] font-semibold text-ink">Common concerns</p>
              {g.cons_themes.length === 0 ? (
                <p className="mt-1 text-[10.5px] text-ink-3">No recurring concern in the reviews read.</p>
              ) : (
                <ul className="mt-1 space-y-1">
                  {g.cons_themes.slice(0, 5).map((t) => (
                    <li key={t.label} className="text-[11px] leading-snug text-ink-2">
                      <span className="font-medium text-ink">{t.label}</span> <span className="text-ink-3">· {t.count}</span>
                      {t.example ? <span className="block text-[10px] text-ink-3">“{t.example}”</span> : null}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {/* recent reviews */}
        {g.recent_reviews.length > 0 ? (
          <div className="mt-3">
            <p className="text-[11px] font-semibold text-ink-2">Recent reviews</p>
            <ul className="mt-1.5 space-y-2">
              {g.recent_reviews.slice(0, 5).map((r, i) => (
                <li key={`${r.title ?? 'review'}-${i}`} className="rounded-lg border border-line bg-surface-2/40 p-2.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <StarRating rating={r.rating} />
                    {r.title ? <span className="text-[11.5px] font-semibold text-ink">{r.title}</span> : null}
                    <span className="tabular ml-auto text-[10px] text-ink-3">
                      {[r.reviewerRole, r.jobTitle, r.publishedAt ? r.publishedAt.slice(0, 10) : null].filter(Boolean).join(' · ')}
                    </span>
                  </div>
                  {r.pros ? <p className="mt-1 text-[11px] leading-snug text-ink-2"><span className="text-good">+ </span>{excerpt(r.pros, 200)}</p> : null}
                  {r.cons ? <p className="mt-0.5 text-[11px] leading-snug text-ink-2"><span className="text-critical">− </span>{excerpt(r.cons, 200)}</p> : null}
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        {/* computed takeaways */}
        {g.insights.length > 0 ? (
          <ul className="mt-3 space-y-1">
            {g.insights.map((o) => (
              <li key={o} className="flex gap-2 text-[11.5px] leading-snug text-ink-2">
                <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                {o}
              </li>
            ))}
          </ul>
        ) : null}

        <p className="tabular mt-3 text-[10px] text-ink-3">
          Source: Glassdoor via FetchLayer{g.credits_used > 0 ? ` · ${g.credits_used} credit${g.credits_used === 1 ? '' : 's'}` : ''}. Sentiment is inferred from star ratings — a signal, not certainty.
        </p>
      </div>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE THREE ANSWERS — what people say, how they react, which topics get
   attention. Claude's answer from the report's figures and the comments it read.
   ═══════════════════════════════════════════════════════════════════════════ */

function AnswersPanel({ answers }: { answers: ListenerAnswers }) {
  const items = [answers.what_people_say, answers.how_they_react, answers.topics_getting_attention]
  return (
    <div className="mt-3 grid gap-2 lg:grid-cols-3" aria-label="What people are saying, how they react, which topics get attention">
      {items.map((a) => (
        <div key={a.question} className="rounded-xl border border-line-strong bg-surface-2 p-3">
          <p className="text-[11.5px] font-semibold text-ink">{a.question}</p>
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-2">{a.answer}</p>
          {a.evidence.length > 0 ? (
            <ul className="mt-1.5 space-y-0.5">
              {a.evidence.map((e) => (
                <li key={e} className="text-[10.5px] leading-snug text-ink-3">
                  · {e}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ))}
    </div>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPUTATION (ORM) — Reputation Overview → Positive / Negative Issues →
   Emerging Risks → Recommended Responses. The status and net sentiment are
   computed from Claude's comment readings and Glassdoor's stars; the rest is
   Claude's analysis of them. Draft replies are for a person to approve.
   ═══════════════════════════════════════════════════════════════════════════ */

const REPUTATION_TONE = { positive: 'good', mixed: 'warn', negative: 'serious', insufficient_data: 'neutral' } as const
const SEVERITY_TONE = { low: 'neutral', medium: 'warn', high: 'serious' } as const
const PRIORITY_LABEL = { now: 'now', this_week: 'this week', monitor: 'monitor' } as const
const PRIORITY_TONE = { now: 'serious', this_week: 'warn', monitor: 'neutral' } as const

function EvidenceLinks({ urls }: { urls: string[] }) {
  if (urls.length === 0) return null
  return (
    <span className="mt-1 flex flex-wrap gap-2">
      {urls.map((u, i) => (
        <a key={u} href={u} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-0.5 text-[10px] text-accent-bright underline decoration-line-strong underline-offset-2 hover:decoration-accent">
          source {i + 1}
          <ExternalLink size={9} aria-hidden="true" />
        </a>
      ))}
    </span>
  )
}

function IssueList({ title, items, tone }: { title: string; items: ReputationIssue[]; tone: 'good' | 'serious' }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className={`text-[11.5px] font-semibold ${tone === 'good' ? 'text-good' : 'text-critical'}`}>{title}</p>
      {items.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-3">None in this sample.</p>
      ) : (
        <ul className="mt-1.5 space-y-2">
          {items.map((i) => (
            <li key={`${i.source}-${i.summary}`} className="text-[11.5px] leading-snug text-ink-2">
              <span className="text-ink">{i.summary}</span>
              <span className="tabular ml-1.5 text-[10px] text-ink-3">
                {i.source} · {i.count}
              </span>
              {i.quote ? <span className="mt-0.5 block text-[10.5px] italic text-ink-3">“{i.quote}”</span> : null}
              <EvidenceLinks urls={i.evidence_urls} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

function ReputationSection({ r }: { r: ReputationReport | undefined }) {
  const running = useStore((s) => s.reputationRunning)
  const analyse = useStore((s) => s.analyseReputation)
  const b = r?.overview.basis
  return (
    <section className="mt-4" aria-label="Online reputation (ORM)">
      <div className="flex flex-wrap items-center gap-2">
        <ShieldCheck size={14} className="text-accent-bright" aria-hidden="true" />
        <h4 className="text-[12px] font-semibold text-ink">Online reputation (ORM)</h4>
        <span className="text-[10.5px] text-ink-3">What is Ethara’s online reputation, and what should we do about positive and negative feedback?</span>
        <button
          type="button"
          onClick={() => void analyse()}
          disabled={running}
          title="Re-run Claude’s reputation analysis over this report — no SocialFetch call"
          className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-accent/50 px-2.5 py-1 text-[10.5px] font-semibold text-accent-bright transition-colors hover:border-accent hover:bg-accent/10 disabled:cursor-wait disabled:opacity-50"
        >
          <RefreshCw size={11} className={running ? 'animate-spin' : ''} aria-hidden="true" />
          {running ? 'Analysing reputation…' : r ? 'Re-analyse reputation' : 'Analyse reputation'}
        </button>
      </div>
      {!r ? (
        <p className="mt-2 rounded-xl border border-line bg-surface-2/50 p-3 text-[11.5px] text-ink-3">
          This report was saved before the reputation layer existed. Analyse reputation to have Claude read it — it uses the
          comments and Glassdoor reviews already here and spends no SocialFetch credits.
        </p>
      ) : (
        <>
          {/* 1 · Reputation overview */}
          <div className="mt-2 rounded-xl border border-accent/30 bg-accent/[0.06] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={REPUTATION_TONE[r.overview.status]}>{r.overview.status.replace('_', ' ')}</Badge>
              {r.overview.net_sentiment !== null ? (
                <span className="tabular text-[11.5px] text-ink" title="positive% − negative% over every classified comment and rated review">
                  net sentiment {r.overview.net_sentiment > 0 ? '+' : ''}
                  {r.overview.net_sentiment}
                </span>
              ) : null}
              {b ? (
                <span className="tabular text-[10.5px] text-ink-3">
                  {b.comments_classified} comments (Claude) · {b.reviews_rated} Glassdoor reviews · {b.positive} positive · {b.neutral} neutral · {b.negative} negative
                </span>
              ) : null}
              <span className="ml-auto text-[10px] text-ink-3">{r.by === 'claude' ? 'Analysis by Claude' : 'Computed'} · {timeAgo(r.generated_at)}</span>
            </div>
            <p className="mt-2 text-[12px] leading-relaxed text-ink">{r.overview.summary}</p>
            {r.error ? <p className="mt-1 text-[10.5px] text-warn">{r.error}</p> : null}
          </div>

          {/* 2 · Positive / negative issues */}
          <div className="mt-2 grid gap-2 lg:grid-cols-2">
            <IssueList title="Positive issues" items={r.positive_issues} tone="good" />
            <IssueList title="Negative issues" items={r.negative_issues} tone="serious" />
          </div>

          {/* 3 · Emerging risks */}
          <div className="mt-2 rounded-xl border border-line p-3">
            <p className="text-[11.5px] font-semibold text-ink">Emerging risks</p>
            {r.emerging_risks.length === 0 ? (
              <p className="mt-1 text-[11px] text-ink-3">No emerging risk in this sample.</p>
            ) : (
              <ul className="mt-1.5 space-y-2">
                {r.emerging_risks.map((k) => (
                  <li key={k.risk} className="text-[11.5px] leading-snug text-ink-2">
                    <Badge tone={SEVERITY_TONE[k.severity]}>{k.severity}</Badge> <span className="text-ink">{k.risk}</span>
                    <span className="mt-0.5 block text-[10.5px] text-ink-3">{k.why}</span>
                    <EvidenceLinks urls={k.evidence_urls} />
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* 4 · Recommended responses */}
          <div className="mt-2 rounded-xl border border-line p-3">
            <p className="text-[11.5px] font-semibold text-ink">Recommended responses</p>
            {r.recommended_responses.length === 0 ? (
              <p className="mt-1 text-[11px] text-ink-3">Nothing to respond to in this sample.</p>
            ) : (
              <ul className="mt-1.5 space-y-2.5">
                {r.recommended_responses.map((x) => (
                  <li key={`${x.addresses}-${x.action}`} className="text-[11.5px] leading-snug text-ink-2">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={PRIORITY_TONE[x.priority]}>{PRIORITY_LABEL[x.priority]}</Badge>
                      <span className="text-ink">{x.action}</span>
                    </span>
                    <span className="mt-0.5 block text-[10.5px] text-ink-3">
                      For: {x.addresses} · where: {x.channel}
                    </span>
                    {x.draft_reply ? (
                      <span className="mt-1 block rounded-md border border-line bg-surface-2 px-2 py-1.5 text-[11px] text-ink-2">
                        <span className="mono mr-1 text-[8.5px] uppercase tracking-[0.1em] text-ink-3">draft reply · approve before posting</span>
                        {x.draft_reply}
                      </span>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
          </div>
        </>
      )}
    </section>
  )
}

/** The full section — used on the Social Listener screen and the AI Analysis tab. */
export function SocialListenerSection({ report }: { report: Report | null }) {
  const configured = useStore((s) => s.socialListenerConfigured)
  const running = useStore((s) => s.socialListenerRunning)
  const run = useStore((s) => s.runSocialListener)

  const header = (
    <div className="flex flex-wrap items-center gap-2.5">
      <div className="min-w-0">
        <h3 className="display text-[15px] text-ink">Social Media Listener</h3>
        <p className="text-[11px] text-ink-3">
          What is happening around {report?.company ?? 'Ethara.AI'} on LinkedIn, Instagram, Facebook and X — plus what employees say on Glassdoor.
        </p>
      </div>
      <button
        type="button"
        onClick={() => void run()}
        disabled={running || configured === false}
        title={configured === false ? 'SOCIALFETCH_API_KEY is not set on the server' : 'Fetch fresh data from SocialFetch and analyse it'}
        className="ml-auto inline-flex items-center gap-1.5 rounded-lg border border-accent/50 px-3 py-1.5 text-[11.5px] font-semibold text-accent-bright transition-colors hover:border-accent hover:bg-accent/10 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <RefreshCw size={12} className={running ? 'animate-spin' : ''} aria-hidden="true" />
        {running ? 'Listening… (1–3 min)' : report ? 'Run listener again' : 'Run listener'}
      </button>
    </div>
  )

  if (!report) {
    return (
      <section className="card p-4" aria-label="Social Media Listener">
        {header}
        <p className="mt-3 text-[12px] text-ink-3">
          {configured === false
            ? 'SocialFetch is not configured on the server (SOCIALFETCH_API_KEY), so the listener cannot read any platform.'
            : 'No listener report yet. Run the listener to read Ethara.AI’s channels through SocialFetch.'}
        </p>
      </section>
    )
  }

  const platforms = ORDER.map((k) => report.platforms[k]).filter((p): p is PlatformListening => p !== undefined)
  const live = platforms.filter((p) => p.status === 'ok')
  const posts = live
    .flatMap((p) => p.posts)
    .sort((a, b) => (b.published_at ?? '').localeCompare(a.published_at ?? ''))
  const cross = report.cross_platform_insights
  const feedback = [
    ...cross.audience_feedback,
    ...(cross.audience_feedback.length === 0 ? live.flatMap((p) => p.audience_feedback.map((f) => ({ ...f, platform: p.label }))) : []),
  ]

  return (
    <section className="card p-4" aria-label="Social Media Listener">
      {header}

      {/* sample size and provenance — always stated */}
      <p className="tabular mt-2 text-[10.5px] text-ink-3">
        {report.sample_size.posts} posts · {report.sample_size.comments} comments · {report.sample_size.platforms_with_data} platform
        {report.sample_size.platforms_with_data === 1 ? '' : 's'} with data · source: SocialFetch ({report.credits_used} credit
        {report.credits_used === 1 ? '' : 's'}) · {timeAgo(report.stored_at ?? report.generated_at)}
      </p>
      {/* Reports stored before `warnings` existed carry none. */}
      {(report.warnings ?? []).length > 0 ? (
        <ul className="mt-2 space-y-1">
          {(report.warnings ?? []).map((w) => (
            <li key={w} className="rounded-md border border-warn/40 bg-warn/10 px-2.5 py-1.5 text-[11px] text-ink-2">
              {w}
            </li>
          ))}
        </ul>
      ) : null}

      {/* the answer, first */}
      <div className="mt-3 rounded-xl border border-accent/30 bg-accent/[0.06] p-3">
        <p className="text-[12.5px] leading-relaxed text-ink">{cross.summary}</p>
        <div className="mt-2 max-w-[420px]">
          <SentimentBar s={cross.overall_sentiment} />
        </div>
      </div>

      {/* the three listening questions, answered */}
      {report.answers ? <AnswersPanel answers={report.answers} /> : null}

      {/* the ORM layer */}
      <ReputationSection r={report.reputation} />

      {/* platform cards */}
      <h4 className="mt-4 text-[12px] font-semibold text-ink">Platforms</h4>
      <div className="mt-2 grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
        {platforms.map((p) => (
          <PlatformCard key={p.platform} p={p} />
        ))}
      </div>

      {/* Glassdoor — what employees say (FetchLayer). Rendered whenever the
          report carries a Glassdoor block, in whatever state it is. */}
      {report.glassdoor ? (
        <GlassdoorSection g={report.glassdoor} />
      ) : (
        <>
          <GlassdoorHeading />
          <div className="mt-2 rounded-xl border border-line bg-surface-2/50 p-3">
            <p className="text-[11.5px] leading-snug text-ink-3">
              This report was saved before Glassdoor was part of the listener. Read Glassdoor to add what employees say about
              the company — it keeps the platform figures above as they are.
            </p>
          </div>
        </>
      )}

      {/* topics */}
      {cross.top_topics.length > 0 ? (
        <>
          <h4 className="mt-4 text-[12px] font-semibold text-ink">Topics</h4>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {cross.top_topics.map((t) => (
              <span key={t.topic} className="tabular rounded-full border border-line-strong px-2 py-0.5 text-[10.5px] text-ink-2" title={`${t.posts} posts · ${t.comments} comments · ${t.engagement} engagement`}>
                {t.topic} <span className="text-ink-3">· {t.posts} posts · {t.comments} comments</span>
              </span>
            ))}
          </div>
          {cross.most_engaging_topics.length > 0 ? (
            <p className="mt-1.5 text-[10.5px] text-ink-3">
              Most engaging: {cross.most_engaging_topics.slice(0, 3).map((t) => `${t.topic} (${fmt(t.engagement)})`).join(' · ')}
            </p>
          ) : null}
        </>
      ) : null}

      {/* post performance */}
      <h4 className="mt-4 text-[12px] font-semibold text-ink">Post performance · newest first</h4>
      <div className="mt-2">
        <PostTable posts={posts} />
      </div>

      {/* what people are saying */}
      <h4 className="mt-4 text-[12px] font-semibold text-ink">What people are saying</h4>
      <div className="mt-2">
        <FeedbackList items={feedback} />
      </div>
      {cross.repeated_questions.length > 0 ? (
        <div className="mt-2">
          <p className="text-[11px] font-semibold text-ink-2">Repeated questions</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[11px] text-ink-2">
            {cross.repeated_questions.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
        </div>
      ) : null}

      {/* key insights */}
      <h4 className="mt-4 text-[12px] font-semibold text-ink">Key insights</h4>
      <div className="mt-2 grid gap-3 lg:grid-cols-2">
        <ul className="space-y-1.5">
          {cross.important_observations.map((o) => (
            <li key={o} className="flex gap-2 text-[11.5px] leading-snug text-ink-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" aria-hidden="true" />
              {o}
            </li>
          ))}
          {cross.positive_signals.map((o) => (
            <li key={o} className="flex gap-2 text-[11.5px] leading-snug text-ink-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-good" aria-hidden="true" />
              {o}
            </li>
          ))}
          {cross.negative_signals.map((o) => (
            <li key={o} className="flex gap-2 text-[11.5px] leading-snug text-ink-2">
              <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-critical" aria-hidden="true" />
              {o}
            </li>
          ))}
        </ul>
        <div className="space-y-2">
          {live.map((p) => (
            <div key={p.platform} className="rounded-lg border border-line p-2.5">
              <p className="flex items-center gap-1.5 text-[11.5px] font-semibold text-ink">
                {asPlatform(p.platform) ? <PlatformIcon platform={p.platform as Platform} size={11} /> : null}
                {p.label}
              </p>
              <ul className="mt-1 space-y-1">
                {[...p.insights, ...p.signals].slice(0, 5).map((i) => (
                  <li key={i} className="text-[11px] leading-snug text-ink-2">
                    – {i}
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <p className="mt-4 text-[10px] leading-relaxed text-ink-3">{report.analysis.note}</p>
    </section>
  )
}

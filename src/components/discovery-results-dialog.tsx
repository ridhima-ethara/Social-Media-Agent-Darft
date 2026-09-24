/**
 * DISCOVERY RESULTS — the popup that opens once scraping and validation are done.
 *
 *   Knowledge Base + Brand Voice + Keywords → Claude Bridge
 *     → LinkedIn | Instagram | Facebook | X → Scraping Agent → Validation Agent
 *     → Topic + Date + Hashtags + Post URL + Platform
 *
 * Server-truth: it renders `pipeline.summary.discoveryResults`, which the
 * orchestrator records right after validation, so reopening it (or refreshing)
 * shows exactly what the run found. Newest first. An empty run is shown as
 * empty, with each platform's own reason — never padded.
 */

import { ExternalLink } from 'lucide-react'
import { z } from 'zod'
import { useStore } from '../store'
import { readDiscovery, windowText } from './platform-discovery'
import { Badge, Dialog, PlatformIcon, timeAgo } from './ui'

const VERDICTS = ['validated', 'needs_review', 'duplicate', 'rejected', 'pending'] as const

const rowSchema = z.object({
  platform: z.string(),
  platformId: z.string().nullable(),
  topic: z.string(),
  /** Absent on runs recorded before titles and accounts were. */
  title: z.string().default(''),
  account: z.string().nullable().default(null),
  related: z.boolean().default(false),
  newHashtags: z.array(z.string()).default([]),
  engagement: z
    .object({ reactions: z.number(), comments: z.number(), reposts: z.number(), views: z.number().nullable() })
    .nullable()
    .default(null),
  publishedAt: z.string(),
  /** Absent on runs recorded before the split; read as `earlier`. */
  period: z.enum(['today', 'earlier', 'older']).default('earlier'),
  hashtags: z.array(z.string()),
  url: z.string(),
  matchedKeyword: z.string(),
  reason: z.string(),
  validation: z.enum(VERDICTS),
  verdictReason: z.string(),
})


const resultsSchema = z.object({
  runId: z.string(),
  generatedAt: z.string(),
  today: z.string().optional(),
  rows: z.array(rowSchema),
  counts: z.object({
    total: z.number(),
    validated: z.number(),
    needs_review: z.number(),
    duplicate: z.number(),
    rejected: z.number(),
    pending: z.number(),
  }),
})

export type DiscoveryResults = z.infer<typeof resultsSchema>

/** Reads the recorded results off a run summary, or `null` when the run has none. */
export function readDiscoveryResults(summary: Record<string, unknown> | undefined): DiscoveryResults | null {
  const parsed = resultsSchema.safeParse(summary?.discoveryResults)
  return parsed.success ? parsed.data : null
}

const PLATFORM_STATUS = {
  ok: 'posts in the window',
  older: 'older posts only',
  undated: 'date not stated',
  empty: 'nothing relevant',
  skipped: 'skipped',
  error: 'error',
} as const

const VERDICT_TONE = {
  validated: 'good',
  needs_review: 'warn',
  duplicate: 'neutral',
  rejected: 'serious',
  pending: 'neutral',
} as const


function formatDate(iso: string): string {
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleString('en-GB', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function DiscoveryResultsDialog() {
  const open = useStore((s) => s.discoveryResultsOpen)
  const close = useStore((s) => s.closeDiscoveryResults)
  const run = useStore((s) => s.pipeline)
  const summary = run?.summary as Record<string, unknown> | undefined
  const results = readDiscoveryResults(summary)
  const discovery = readDiscovery(summary)

  if (!open) return null

  const counts = results?.counts

  return (
    <Dialog
      open={open}
      onClose={close}
      size="fit"
      header={
        <div className="min-w-0">
          <h2 className="display text-[15px] text-ink">Discovery results</h2>
          <p className="mt-0.5 text-[11px] text-ink-3">
            Claude Bridge → LinkedIn · Instagram · Facebook · X → Scraping Agent → Validation Agent · trending today
            and over {windowText(discovery)}
            {results ? ` · ${timeAgo(results.generatedAt)}` : ''}
          </p>
        </div>
      }
      footer={
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
          {counts ? (
            <>
              <span className="tabular">{counts.total} post{counts.total === 1 ? '' : 's'}</span>
              <Badge tone="good">{counts.validated} validated</Badge>
              {counts.needs_review > 0 ? <Badge tone="warn">{counts.needs_review} needs review</Badge> : null}
              {counts.duplicate > 0 ? <Badge tone="neutral">{counts.duplicate} duplicate</Badge> : null}
              {counts.rejected > 0 ? <Badge tone="serious">{counts.rejected} rejected</Badge> : null}
            </>
          ) : null}
          <span className="flex-1" />
          <span>Today first, then newest first · dates decoded from each post’s own id · validated topics feed today’s and tomorrow’s posts, the rest go to the Topic Queue</span>
        </div>
      }
    >
      <div className="py-3">
        <PlatformBreakdown summary={summary} />
      </div>
    </Dialog>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLATFORM BREAKDOWN — the run's output, platform by platform
   ───────────────────────────────────────────────────────────────────────────
   LinkedIn · Instagram · Facebook · X, each with its status and reason, then
   its posts: Date · Trending topic · Account · Hashtags · Post URL ·
   Validation. Today first, then the rest of the window, then (only when the
   platform had nothing newer) older posts, labelled. Facebook's posts cannot
   be dated, so they are listed "date not stated" and are not validated.
   Shared by the run-complete report and the Discovery results popup.
   ═══════════════════════════════════════════════════════════════════════════ */

const PLATFORM_ORDER = [
  { id: 'linkedin', label: 'LinkedIn' },
  { id: 'instagram', label: 'Instagram' },
  { id: 'facebook', label: 'Facebook' },
  { id: 'x', label: 'X' },
] as const

function fmtCount(n: number): string {
  return n >= 10_000 ? `${(n / 1000).toFixed(1)}k` : n.toLocaleString('en-GB')
}

const learnedSchema = z.object({ written: z.array(z.string()), merged: z.array(z.string()) })

function readLearned(summary: Record<string, unknown> | undefined): z.infer<typeof learnedSchema> | null {
  const parsed = learnedSchema.safeParse(summary?.learnedHashtags)
  return parsed.success ? parsed.data : null
}

const PERIOD_LABEL = { today: 'today', earlier: 'in the window', older: 'older than the window' } as const
const PERIOD_TONE = { today: 'good', earlier: 'neutral', older: 'warn' } as const

interface BreakdownRow {
  key: string
  date: string | null
  period: 'today' | 'earlier' | 'older' | null
  topic: string
  title: string
  account: string | null
  hashtags: string[]
  url: string
  related: boolean
  newHashtags: string[]
  engagement: DiscoveryResults['rows'][number]['engagement']
  validation: DiscoveryResults['rows'][number]['validation'] | null
  verdictReason: string
}

export function PlatformBreakdown({ summary }: { summary: Record<string, unknown> | undefined }) {
  const results = readDiscoveryResults(summary)
  const discovery = readDiscovery(summary)
  if (!results && !discovery) {
    return <p className="px-4 text-[12px] text-ink-3">This run recorded no platform discovery.</p>
  }
  const span = discovery ? windowText(discovery) : 'the window'

  const learned = readLearned(summary)
  return (
    <div className="flex flex-col gap-3">
      {learned && (learned.written.length > 0 || learned.merged.length > 0) ? (
        <p className="rounded-[10px] border border-accent/40 bg-accent/[0.06] px-3.5 py-2 text-[11.5px] text-ink-2">
          <span className="font-semibold text-ink">New hashtags learned into the Knowledge Base</span>
          {learned.written.length > 0 ? `: ${learned.written.join(' ')}` : ': none new'}
          {learned.merged.length > 0 ? ` · seen again: ${learned.merged.join(' ')}` : ''} — the next run searches them too.
        </p>
      ) : null}
      {PLATFORM_ORDER.map(({ id, label }) => {
        const report = discovery?.platforms.find((p) => p.platformId === id) ?? null
        const ofLane = (platformId: string | null): boolean => platformId === id
        const rows: BreakdownRow[] = [
          ...(results?.rows ?? [])
            .filter((r) => ofLane(r.platformId))
            .map((r) => ({
              key: r.url,
              date: r.publishedAt,
              period: r.period,
              topic: r.topic,
              title: r.title,
              account: r.account,
              hashtags: r.hashtags,
              url: r.url,
              related: r.related,
              newHashtags: r.newHashtags,
              engagement: r.engagement,
              validation: r.validation,
              verdictReason: r.verdictReason,
            })),
          ...(discovery?.undated ?? [])
            .filter((u) => u.platformId === id)
            .map((u) => ({
              key: u.url,
              date: null,
              period: null,
              topic: u.trend,
              title: u.title,
              account: null,
              hashtags: u.hashtags,
              url: u.url,
              related: false,
              newHashtags: [],
              engagement: null,
              validation: null,
              verdictReason: '',
            })),
        ]
        const status = report?.status ?? (rows.length > 0 ? 'ok' : 'empty')
        return (
          <section key={id} className="rounded-[12px] border border-line-strong bg-surface" aria-label={`${label} results`}>
            <header className="flex flex-wrap items-center gap-2 border-b border-line px-3.5 py-2.5">
              <PlatformIcon platform={id} size={14} />
              <h3 className="text-[13px] font-semibold text-ink">{label}</h3>
              <span className="tabular text-[11px] text-ink-3">
                {rows.length} post{rows.length === 1 ? '' : 's'}
              </span>
              <Badge
                tone={status === 'ok' ? 'good' : status === 'older' || status === 'empty' ? 'warn' : status === 'error' ? 'serious' : 'neutral'}
                className="ml-auto"
              >
                {status === 'ok' ? `trending in ${span}` : PLATFORM_STATUS[status]}
              </Badge>
            </header>
            {report?.reason && status !== 'ok' ? (
              <p className="border-b border-line px-3.5 py-2 text-[11px] leading-relaxed text-ink-3">{report.reason}</p>
            ) : null}
            {report && report.notes.length > 0 ? (
              <ul className="border-b border-line px-3.5 py-2 text-[10.5px] leading-relaxed text-ink-3" aria-label={`${label} sources`}>
                {report.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
            ) : null}
            {rows.length === 0 ? (
              <p className="px-3.5 py-3 text-[11.5px] text-ink-3">Nothing relevant to show for {label} on this run.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[900px] border-collapse text-left">
                  <thead>
                    <tr className="mono border-b border-line text-[8.5px] uppercase tracking-[0.1em] text-ink-3">
                      <th scope="col" className="px-3.5 py-2 font-medium">Date</th>
                      <th scope="col" className="px-2 py-2 font-medium">Trending topic</th>
                      <th scope="col" className="px-2 py-2 font-medium">Account</th>
                      <th scope="col" className="px-2 py-2 font-medium">Hashtags</th>
                      <th scope="col" className="px-2 py-2 text-right font-medium">Engagement</th>
                      <th scope="col" className="px-2 py-2 font-medium">Post URL</th>
                      <th scope="col" className="px-3.5 py-2 font-medium">Validation</th>
                    </tr>
                  </thead>
                  <tbody className="tabular">
                    {rows.map((row) => (
                      <tr key={row.key} className="border-b border-line/60 align-top text-[11.5px] text-ink-2 last:border-b-0 hover:bg-surface-3/40">
                        <td className="whitespace-nowrap px-3.5 py-2.5">
                          {row.date ? (
                            <>
                              <span className="block text-ink" title={row.date}>
                                {formatDate(row.date)}
                              </span>
                              <span className="block text-[10px] text-ink-3">{timeAgo(row.date)}</span>
                            </>
                          ) : (
                            <span className="text-[10.5px] text-ink-3">not stated by {label}</span>
                          )}
                          {row.period ? (
                            <span className="mt-1 block">
                              <Badge tone={PERIOD_TONE[row.period]}>{PERIOD_LABEL[row.period]}</Badge>
                            </span>
                          ) : null}
                        </td>
                        <td className="max-w-[300px] px-2 py-2.5">
                          <span className="block font-semibold leading-snug text-ink">
                            {row.topic || '—'}
                            {row.related ? (
                              <span className="ml-1.5 align-middle">
                                <Badge tone="accent">related</Badge>
                              </span>
                            ) : null}
                          </span>
                          {row.title ? (
                            <span className="mt-0.5 block text-[10.5px] leading-snug text-ink-3" title={row.title}>
                              {row.title.length > 140 ? `${row.title.slice(0, 139)}…` : row.title}
                            </span>
                          ) : null}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-ink-2">{row.account ?? '—'}</td>
                        <td className="max-w-[180px] px-2 py-2.5">
                          {row.hashtags.length === 0 ? (
                            <span className="text-ink-3">—</span>
                          ) : (
                            <span className="flex flex-wrap gap-1">
                              {row.hashtags.slice(0, 6).map((tag) => {
                                const isNew = row.newHashtags.some((n) => n.replace(/^#/, '').toLowerCase() === tag.replace(/^#/, '').toLowerCase())
                                return (
                                  <span
                                    key={tag}
                                    title={isNew ? 'New — not tracked by Ethara yet; learned into the Knowledge Base' : undefined}
                                    className={`rounded-full border px-1.5 py-px text-[10px] ${isNew ? 'border-accent/60 bg-accent/10 text-accent-bright' : 'border-magenta/30 text-magenta-ink'}`}
                                  >
                                    {tag.startsWith('#') ? tag : `#${tag}`}
                                    {isNew ? <span className="mono ml-1 text-[8px] uppercase">new</span> : null}
                                  </span>
                                )
                              })}
                            </span>
                          )}
                        </td>
                        <td className="whitespace-nowrap px-2 py-2.5 text-right">
                          {row.engagement ? (
                            <>
                              <span className="block font-semibold text-ink">
                                {fmtCount(row.engagement.reactions + row.engagement.comments + row.engagement.reposts)}
                              </span>
                              <span className="block text-[9.5px] text-ink-3">
                                {fmtCount(row.engagement.reactions)} reactions · {fmtCount(row.engagement.comments)} comments
                              </span>
                              {row.engagement.views !== null ? (
                                <span className="block text-[9.5px] text-ink-3">{fmtCount(row.engagement.views)} views</span>
                              ) : null}
                            </>
                          ) : (
                            <span className="text-[10px] text-ink-3" title="The source stated no engagement for this post">not stated</span>
                          )}
                        </td>
                        <td className="max-w-[220px] px-2 py-2.5">
                          <a
                            href={row.url}
                            target="_blank"
                            rel="noreferrer noopener"
                            className="inline-flex max-w-full items-center gap-1 text-accent-bright underline decoration-line-strong underline-offset-2 hover:decoration-accent"
                            title={row.url}
                          >
                            <span className="truncate">link</span>
                            <ExternalLink size={10} className="shrink-0" aria-hidden="true" />
                          </a>
                        </td>
                        <td className="px-3.5 py-2.5">
                          {row.validation ? (
                            <span title={row.verdictReason || undefined}>
                              <Badge tone={VERDICT_TONE[row.validation]}>{row.validation.replace('_', ' ')}</Badge>
                            </span>
                          ) : (
                            <span className="text-[10.5px] text-ink-3">not validated</span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}

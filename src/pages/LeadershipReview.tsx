/**
 * FINAL APPROVAL — the Leadership screen
 *
 * Everything Marketing has approved lands here. Nothing publishes until
 * Leadership says so, and a rejection cannot be submitted without a reason —
 * the reason is what the agents learn from.
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, ExternalLink, Pencil, ShieldCheck, X } from 'lucide-react'
import { useStore } from '../store'
import { usePostLinks } from '../lib/post-links'
import { PageHeader } from '../components/layout'
import { PlatformPreview } from '../components/previews'
import {
  Badge,
  Btn,
  EmptyState,
  Metric,
  Modal,
  PlatformChip,
  PLATFORM_LABEL,
  timeAgo,
} from '../components/ui'

const QUICK_REASONS = [
  'Tone is too promotional for a research audience',
  'Claim needs a citation before it can go out',
  'Timing conflicts with something already scheduled',
  "Not aligned with this quarter's positioning",
]

const PHASES = [
  'Preparing content',
  'Validating platform format',
  'Uploading media',
  'Publishing',
  'Published successfully',
]

export function LeadershipReview() {
  const ideas = useStore((s) => s.ideas)
  const drafts = useStore((s) => s.drafts)
  const media = useStore((s) => s.media)
  const knowledge = useStore((s) => s.knowledge)
  const user = useStore((s) => s.user)
  const publishPhase = useStore((s) => s.publishPhase)
  const leadershipPublish = useStore((s) => s.leadershipPublish)
  const editOnCalendar = useStore((s) => s.editOnCalendar)
  const leadershipReject = useStore((s) => s.leadershipReject)
  const ensureDraft = useStore((s) => s.ensureDraft)
  const ensureImage = useStore((s) => s.ensureImage)

  const queue = useMemo(
    () =>
      ideas
        .filter((idea) => idea.status === 'pending_leadership')
        .sort((a, b) =>
          (a.marketing_approved_at ?? '').localeCompare(b.marketing_approved_at ?? ''),
        ),
    [ideas],
  )

  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')

  const selected = queue.find((idea) => idea.id === selectedId) ?? queue[0] ?? null

  useEffect(() => {
    if (!selected) return
    void ensureDraft(selected.id)
    void ensureImage(selected.id)
  }, [selected?.id, ensureDraft, ensureImage, selected])

  const decided = ideas.filter((idea) => idea.leadership_decision !== null)
  // Each recent decision's published post, so its platform chip can open the
  // post where it went out. Only the cards on screen are asked about.
  const published = useStore((s) => s.published)
  const postFor = (ideaId: string) => published.find((post) => post.idea_id === ideaId && post.status === 'published')
  const linkFor = usePostLinks(decided.slice(0, 6).map((idea) => postFor(idea.id)))
  const approvedByMe = decided.filter((i) => i.leadership_decision?.decision === 'approved').length
  const rejectedByMe = decided.filter((i) => i.leadership_decision?.decision === 'rejected').length
  const lessons = knowledge.filter((k) => k.category === 'Rejected Post' || k.category === 'Approved Post').length

  const draft = selected ? drafts[`${selected.id}|${selected.platform}`] : undefined
  const asset = selected ? media[`${selected.id}|${selected.platform}`] : undefined

  return (
    <>
      <PageHeader
        title="Final Approval"
        subtitle="Everything Marketing has approved lands here. Nothing publishes until you say so."
        agents={['review', 'publishing', 'knowledge']}
      />

      <section className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric label="Awaiting your decision" value={queue.length} tone={queue.length > 0 ? 'serious' : undefined} />
        <Metric label="Approved by you" value={approvedByMe} tone="good" />
        <Metric label="Rejected by you" value={rejectedByMe} />
        <Metric label="Lessons stored" value={lessons} />
      </section>

      {queue.length === 0 ? (
        <EmptyState
          icon={<ShieldCheck size={22} className="text-good-ink" />}
          title="Your queue is clear"
          body="Nothing is waiting on a decision. Marketing will send the next batch through as they approve it."
        />
      ) : (
        <section className="grid gap-4 xl:grid-cols-[300px_1fr]">
          {/* ── Queue rail ────────────────────────────────────────────── */}
          <aside className="card max-h-[70vh] overflow-y-auto p-2">
            <ul className="space-y-1">
              {queue.map((idea, i) => {
                const active = idea.id === selected?.id
                return (
                  <li key={idea.id}>
                    <button
                      type="button"
                      onClick={() => setSelectedId(idea.id)}
                      className={`flex w-full items-start gap-2.5 rounded-lg border px-2.5 py-2 text-left transition-colors ${
                        active ? 'border-accent bg-accent/10' : 'border-transparent hover:border-line hover:bg-surface-2'
                      }`}
                    >
                      <span className="tabular mt-0.5 shrink-0 text-[11px] text-ink-3">{i + 1}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12px] font-medium text-ink">{idea.title}</span>
                        <span className="mt-1 flex flex-wrap items-center gap-1.5">
                          <PlatformChip platform={idea.platform} />
                          <span className="tabular text-[10px] text-ink-3">
                            {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ·{' '}
                            {idea.scheduled_time}
                          </span>
                        </span>
                        <span className="mt-0.5 block text-[10px] text-ink-3">
                          Approved by {idea.marketing_approved_by ?? 'Marketing'} {timeAgo(idea.marketing_approved_at)}
                        </span>
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          </aside>

          {/* ── Decision workspace ────────────────────────────────────── */}
          {selected ? (
            <div className="grid gap-4 xl:grid-cols-[1fr_300px]">
              <div className="card p-4">
                {/* The decision reads from the post itself, exactly as it will
                    appear — the creative is inside that preview, not repeated
                    below it. The status and scoring badges, the brand-voice
                    findings, and the card title and scraped description above
                    the preview were removed from this view by request. The
                    compliance rules still gate publishing server-side. */}
                <h3 className="display text-[12px]">
                  How it will appear on {PLATFORM_LABEL[selected.platform]}
                </h3>
                <div className="mt-2 max-w-lg">
                  <PlatformPreview
                    platform={selected.platform}
                    body={draft?.body ?? selected.description ?? ''}
                    media={asset?.dataUri ?? null}
                  />
                </div>

              </div>

              {/* ── Context rail ──────────────────────────────────────── */}
              <aside className="space-y-3">
                <section className="card p-3">
                  <h3 className="display text-[12px]">Marketing hand-off</h3>
                  <div className="mt-2 space-y-1.5 text-[11.5px] text-ink-3">
                    <p>
                      <span className="text-ink-2">Approved by:</span> {selected.marketing_approved_by ?? '—'}
                    </p>
                    <p>
                      <span className="text-ink-2">When:</span> {timeAgo(selected.marketing_approved_at)}
                    </p>
                    <p>
                      <span className="text-ink-2">Slot:</span>{' '}
                      {new Date(selected.scheduled_date).toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long' })}{' '}
                      · {selected.scheduled_time}
                    </p>
                    <p>
                      <span className="text-ink-2">Edits applied:</span>{' '}
                      {draft && draft.revision > 1 ? `${draft.revision - 1} revision(s)` : 'none — this is the first draft'}
                    </p>
                  </div>
                </section>

                <section className="card p-3">
                  <h3 className="display text-[12px]">Why the agents chose this</h3>
                  <div className="mt-2 grid grid-cols-2 gap-1.5">
                    <Metric label="Brand relevance" value={`${selected.analysis?.brandRelevance ?? '—'}%`} />
                    <Metric label="Trend score" value={`${selected.analysis?.trendScore ?? '—'}%`} />
                  </div>
                  <div className="mt-2 space-y-1.5 text-[11.5px] text-ink-3">
                    <p>
                      <span className="text-ink-2">Angle:</span> {String(selected.analysis?.angle ?? '—')}
                    </p>
                    <p>
                      <span className="text-ink-2">Audience:</span> {String(selected.analysis?.audience ?? '—')}
                    </p>
                    <p>
                      <span className="text-ink-2">Source hashtag:</span>{' '}
                      {selected.hashtag_display ? `#${selected.hashtag_display}` : '—'}
                    </p>
                  </div>
                </section>

                <section className="rounded-xl border border-accent/40 bg-accent/8 p-3">
                  <h3 className="display text-[12px]">Your decision</h3>

                  {publishPhase ? (
                    <ul className="mt-2 space-y-1.5">
                      {PHASES.map((phase, i) => {
                        const index = PHASES.indexOf(publishPhase)
                        return (
                          <li key={phase} className="flex items-center gap-2 text-[11.5px]">
                            {i < index ? (
                              <Check size={12} className="text-good-ink" aria-hidden="true" />
                            ) : i === index ? (
                              <span
                                className="h-3 w-3 rounded-full border-2 border-accent border-t-transparent"
                                style={{ animation: 'ring-spin 1.4s linear infinite' }}
                                aria-hidden="true"
                              />
                            ) : (
                              <span className="h-3 w-3 rounded-full border border-line" aria-hidden="true" />
                            )}
                            <span className={i <= index ? 'text-ink-2' : 'text-ink-3'}>{phase}</span>
                          </li>
                        )
                      })}
                    </ul>
                  ) : (
                    <div className="mt-2 space-y-2">
                      <Btn variant="primary" className="w-full" onClick={() => void leadershipPublish(selected.id)}>
                        <Check size={13} /> Approve &amp; publish
                      </Btn>
                      {/* Changes are made where the post is written: the Weekly
                          Calendar's editor, opened on this post and its week. */}
                      <Btn variant="ghost" className="w-full" onClick={() => editOnCalendar(selected.id)}>
                        <Pencil size={13} /> Edit post
                      </Btn>
                      <Btn variant="danger" className="w-full" onClick={() => setRejecting(true)}>
                        <X size={13} /> Reject with a reason
                      </Btn>
                    </div>
                  )}

                  <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
                    Either way, the outcome is written to the Knowledge Base so the agents learn from it.
                  </p>
                </section>
              </aside>
            </div>
          ) : null}
        </section>
      )}

      {/* ── Recent decisions ──────────────────────────────────────────── */}
      {decided.length > 0 ? (
        <section className="mt-6">
          <h2 className="display mb-3 text-lg">Recent decisions</h2>
          <div className="stagger-fade grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {decided.slice(0, 6).map((idea, i) => {
              const decision = idea.leadership_decision
              if (!decision) return null
              return (
                <article
                  key={idea.id}
                  className="card anim-fade-up p-3"
                  style={{ ['--i' as string]: i, animationDelay: `${Math.min(i, 12) * 30}ms` }}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge tone={decision.decision === 'approved' ? 'good' : 'critical'}>
                      {decision.decision === 'approved' ? 'Approved' : 'Rejected'}
                      {decision.published ? ' · Published' : ''}
                    </Badge>
                    <span className="text-[10.5px] text-ink-3">{timeAgo(decision.at)}</span>
                  </div>
                  <h4 className="mt-1.5 text-[12.5px] font-medium text-ink">{idea.title}</h4>
                  {decision.reason ? (
                    <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">“{decision.reason}”</p>
                  ) : null}
                  <div className="mt-2 flex items-center gap-2">
                    {/* The platform chip opens the post where it was published,
                        once the platform has returned its address. */}
                    {linkFor(postFor(idea.id)).url ? (
                      <a
                        href={linkFor(postFor(idea.id)).url ?? undefined}
                        target="_blank"
                        rel="noreferrer noopener"
                        title={`Open this post on ${PLATFORM_LABEL[idea.platform]}`}
                        aria-label={`Open “${idea.title}” on ${PLATFORM_LABEL[idea.platform]}`}
                        className="group/chip inline-flex items-center gap-1 rounded-full transition-opacity hover:opacity-80"
                      >
                        <PlatformChip platform={idea.platform} />
                        <ExternalLink size={11} className="text-ink-3 transition-colors group-hover/chip:text-accent-bright" aria-hidden="true" />
                      </a>
                    ) : (
                      <PlatformChip platform={idea.platform} />
                    )}
                    <span className="text-[10.5px] text-ink-3">{decision.by}</span>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      ) : null}

      {/* ── Reject modal ──────────────────────────────────────────────── */}
      <Modal
        open={rejecting}
        onClose={() => {
          setRejecting(false)
          setReason('')
        }}
        title="Reject with a reason"
        subtitle="A rejection needs a reason — it is what the agents learn from."
        footer={
          <div className="flex justify-end gap-2">
            <Btn
              variant="ghost"
              onClick={() => {
                setRejecting(false)
                setReason('')
              }}
            >
              Cancel
            </Btn>
            <Btn
              variant="danger"
              disabled={reason.trim().length === 0}
              onClick={() => {
                if (selected) void leadershipReject(selected.id, reason.trim())
                setRejecting(false)
                setReason('')
              }}
            >
              Reject
            </Btn>
          </div>
        }
      >
        <div className="space-y-3">
          <div className="flex flex-wrap gap-1.5">
            {QUICK_REASONS.map((quick) => (
              <button
                key={quick}
                type="button"
                onClick={() => setReason(quick)}
                className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                  reason === quick
                    ? 'border-accent bg-accent/10 text-accent-bright'
                    : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
                }`}
              >
                {quick}
              </button>
            ))}
          </div>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Reason</span>
            <textarea
              rows={4}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
              placeholder="What needs to change, and why?"
              className="mt-1 w-full resize-y rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-accent"
            />
          </label>

          <p className="text-[11px] leading-relaxed text-ink-3">
            {user?.name ?? 'You'} will be recorded as the decider. The reason is written to the Knowledge
            Base as a Rejected Post entry, and Velma, the Learning Agent, reads it before the next draft.
          </p>
        </div>
      </Modal>
    </>
  )
}

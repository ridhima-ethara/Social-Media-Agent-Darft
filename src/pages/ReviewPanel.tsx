/**
 * THE REVIEW PANEL
 *
 * A full-screen `Dialog`, three columns, the outer two sticky and
 * independently scrollable so the composer never leaves view. This is where a
 * human shapes what the agents wrote.
 */

import { useEffect, useState } from 'react'
import { AlertTriangle, Check, ExternalLink, FileText, Paperclip, RefreshCw, Send, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'
import { ModelMenu } from '../components/model-menu'
import { PlatformPreview } from '../components/previews'
import { AssistantCore } from '../components/assistant/core'
import {
  Badge,
  Btn,
  Dialog,
  Metric,
  PlatformChip,
  PLATFORM_LABEL,
  Tabs,
  timeAgo,
} from '../components/ui'
import type { Idea, Platform } from '../types'

const POSTING_TIMES = [
  '07:00 AM', '08:00 AM', '08:30 AM', '09:00 AM', '09:30 AM', '10:00 AM', '10:30 AM',
  '11:00 AM', '11:30 AM', '01:00 PM', '02:00 PM', '03:30 PM', '04:30 PM',
]

const CAPTION_ACTIONS = [
  { label: 'Improve', instruction: 'Improve the clarity without changing the claim' },
  { label: 'Shorten', instruction: 'Make it shorter' },
  { label: 'Expand', instruction: 'Expand with more detail on the mechanism' },
  { label: 'Change Tone', instruction: 'Make the tone more declarative' },
  { label: 'Add CTA', instruction: 'Add a call to action pointing at the published method' },
]

const IMAGE_ACTIONS = [
  { label: 'Brighter', instruction: 'Brighter, more contrast in the background field' },
  { label: 'Simpler', instruction: 'Simpler composition, fewer elements' },
  { label: 'More accent', instruction: 'Lean harder on the accent family' },
  { label: 'Add depth', instruction: 'Add depth with a layered gradient field' },
]

const CAPTION_PROMPTS = [
  'Make it shorter and more CTO-focused',
  'Lead with the number instead of the framing',
  'Remove the second paragraph',
  'Rewrite the close so it points at the blog',
]

const IMAGE_PROMPTS = [
  'Make the background darker',
  'Use the deep end of the accent family',
  'Simplify — the headline is getting lost',
  'Re-render at higher contrast',
]

interface Bubble {
  id: string
  speaker: 'operator' | 'assistant'
  text: string
}

/**
 * One file the operator attached for the model to work from.
 *
 * `text` is filled for anything textual; `dataUri` for an image. Both are
 * optional because a file whose contents could not be read is still reported as
 * attached — with the reason — rather than dropped silently.
 */
interface Reference {
  id: string
  name: string
  mimeType: string
  size: number
  text?: string
  dataUri?: string
  unreadableReason?: string
}

/** Anything larger is truncated, and the truncation is stated on the chip. */
const MAX_REFERENCE_CHARS = 8_000
const MAX_REFERENCE_BYTES = 4 * 1024 * 1024

async function readReference(file: File): Promise<Reference> {
  const base: Reference = {
    id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
  }

  if (file.size > MAX_REFERENCE_BYTES) {
    return { ...base, unreadableReason: 'over 4 MB, so its contents were not read' }
  }

  const isImage = file.type.startsWith('image/')
  const isTextual =
    file.type.startsWith('text/') ||
    /json|csv|xml|yaml|markdown/.test(file.type) ||
    /\.(md|txt|csv|json|ya?ml)$/i.test(file.name)

  try {
    if (isImage) {
      const dataUri = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader()
        reader.onload = () => resolve(String(reader.result))
        reader.onerror = () => reject(new Error('the file could not be read'))
        reader.readAsDataURL(file)
      })
      return { ...base, dataUri }
    }
    if (isTextual) {
      const raw = await file.text()
      return { ...base, text: raw.slice(0, MAX_REFERENCE_CHARS) }
    }
    return { ...base, unreadableReason: 'this file type cannot be read as text or an image' }
  } catch (error) {
    return { ...base, unreadableReason: error instanceof Error ? error.message : 'unreadable' }
  }
}

export function ReviewPanel() {
  const reviewIdeaId = useStore((s) => s.reviewIdeaId)
  const closeReview = useStore((s) => s.closeReview)
  const ideas = useStore((s) => s.ideas)
  const drafts = useStore((s) => s.drafts)
  const media = useStore((s) => s.media)
  const user = useStore((s) => s.user)
  const settings = useStore((s) => s.settings)
  const publishPhase = useStore((s) => s.publishPhase)
  const canPublish = useStore((s) => s.apiMode === 'connected' && s.mode.publishMode === 'live')
  const ensureDraft = useStore((s) => s.ensureDraft)
  const ensureImage = useStore((s) => s.ensureImage)
  const regenerateDraft = useStore((s) => s.regenerateDraft)
  const regenerateImage = useStore((s) => s.regenerateImage)
  const updateDraft = useStore((s) => s.updateDraft)
  const instructAI = useStore((s) => s.instructAI)
  const instructImage = useStore((s) => s.instructImage)
  const setIdeaTime = useStore((s) => s.setIdeaTime)
  const setIdeaPlatform = useStore((s) => s.setIdeaPlatform)
  const approveIdea = useStore((s) => s.approveIdea)
  const leadershipApprove = useStore((s) => s.leadershipApprove)
  const publishIdea = useStore((s) => s.publishIdea)
  const addKnowledge = useStore((s) => s.addKnowledge)
  const updateSettings = useStore((s) => s.updateSettings)

  const idea = ideas.find((i) => i.id === reviewIdeaId)

  const [target, setTarget] = useState<'caption' | 'image'>('caption')
  const [body, setBody] = useState('')
  const [imagePrompt, setImagePrompt] = useState('')
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [chatValue, setChatValue] = useState('')
  const [thinking, setThinking] = useState<string | null>(null)
  const [preference, setPreference] = useState<{ title: string; content: string } | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)
  const [references, setReferences] = useState<Reference[]>([])
  const [attaching, setAttaching] = useState(false)

  const draft = idea ? drafts[`${idea.id}|${idea.platform}`] : undefined
  const asset = idea ? media[`${idea.id}|${idea.platform}`] : undefined

  // Ensure the composer is never empty when the panel opens.
  useEffect(() => {
    if (!idea) return
    void ensureDraft(idea.id)
    void ensureImage(idea.id)
    setBubbles([])
    setPreference(null)
    setConfirmPublish(false)
  }, [idea?.id, ensureDraft, ensureImage, idea])

  useEffect(() => {
    setBody(draft?.body ?? '')
  }, [draft?.body])

  useEffect(() => {
    setImagePrompt(asset?.concept ? `${asset.concept} · ${idea?.source_topic ?? ''}` : '')
  }, [asset?.concept, idea?.source_topic])

  if (!idea) return null

  const slotReasons = (idea.analysis?.slotReasons as string[] | undefined) ?? []
  const isLeadership = user?.role === 'leadership'

  const send = (instruction: string): void => {
    const text = instruction.trim()
    if (text.length === 0) return

    // The attachments travel with the instruction they were attached for, and
    // are named in the transcript so the record shows what the model was given.
    const attached = references
    const attachedNote =
      attached.length === 0
        ? ''
        : `\n\nReferences: ${attached.map((reference) => reference.name).join(', ')}`

    setBubbles((prev) => [
      ...prev,
      { id: `q-${Date.now()}`, speaker: 'operator', text: `${text}${attachedNote}` },
    ])
    setChatValue('')
    setThinking(target === 'caption' ? 'Rewriting draft…' : `Re-rendering with ${asset?.model ?? 'brand-svg'}…`)

    if (target === 'image') {
      void instructImage(idea.id, text, attached).then(() => {
        setThinking(null)
        setBubbles((prev) => [
          ...prev,
          { id: `a-${Date.now()}`, speaker: 'assistant', text: 'Re-rendered. The brand layer is drawn locally, so the headline is unchanged.' },
        ])
      })
      return
    }

    void instructAI(idea.id, text, attached).then((note) => {
      setThinking(null)
      setBubbles((prev) => [...prev, { id: `a-${Date.now()}`, speaker: 'assistant', text: note }])
      // Offer to remember it, rather than silently learning.
      if (/shorter|cto|tone|number/i.test(text)) {
        setPreference({
          title: `Prefers: ${text.slice(0, 48)}`,
          content: `The operator asked for this on "${idea.title}". Apply it by default on ${PLATFORM_LABEL[idea.platform]} drafts.`,
        })
      }
    })
  }

  const attach = async (files: FileList | null): Promise<void> => {
    if (!files || files.length === 0) return
    setAttaching(true)
    try {
      const read = await Promise.all(Array.from(files).map(readReference))
      setReferences((prev) => [...prev, ...read])
    } finally {
      setAttaching(false)
    }
  }

  return (
    <Dialog
      open={Boolean(reviewIdeaId)}
      onClose={closeReview}
      header={
        <div className="flex min-w-0 flex-wrap items-center gap-2.5">
          <h2 className="display truncate text-[15px]">{idea.title}</h2>
          <span className="tabular text-[11px] text-ink-3">
            Calendar Review · {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'long' })} ·{' '}
            {idea.scheduled_time}
          </span>
          <Badge tone={idea.status === 'approved' ? 'good' : idea.status === 'pending_leadership' ? 'serious' : 'accent'}>
            {idea.status.replace(/_/g, ' ')}
          </Badge>
        </div>
      }
    >
      <div className="grid h-full grid-cols-1 overflow-y-auto lg:grid-cols-[260px_1fr_300px] lg:grid-rows-[minmax(0,1fr)] lg:overflow-hidden">
        {/* ── LEFT ────────────────────────────────────────────────────── */}
        <aside className="overflow-y-auto border-r border-line p-4">
          <section>
            <h3 className="display text-[12px]">Content information</h3>
            <div className="mt-2 space-y-2">
              <Field label="Source topic" value={idea.source_topic ?? '—'} />
              <Field label="Originating hashtag" value={idea.hashtag_display ? `#${idea.hashtag_display}` : '—'} />
              <ReferenceField idea={idea} />
              <Field label="Suggested angle" value={String(idea.analysis?.angle ?? '—')} />
              <Field label="Target audience" value={String(idea.analysis?.audience ?? '—')} />
              <Field label="Format" value={String(idea.analysis?.format ?? '—')} />
              <div className="grid grid-cols-2 gap-1.5">
                <Metric label="Brand relevance" value={`${idea.analysis?.brandRelevance ?? '—'}%`} />
                <Metric label="Trend score" value={`${idea.analysis?.trendScore ?? '—'}%`} />
              </div>
            </div>
          </section>

          <section className="mt-4">
            <h3 className="display text-[12px]">AI recommendation</h3>
            <p className="mt-1 text-[11px] text-ink-3">
              Scheduled for{' '}
              <span className="text-ink-2">
                {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { weekday: 'long' })} {idea.scheduled_time}
              </span>
            </p>

            {slotReasons.length > 0 ? (
              <>
                <p className="mt-2 text-[11px] font-medium text-ink-2">Why this slot?</p>
                <ul className="mt-1 space-y-1">
                  {slotReasons.slice(0, 4).map((reason) => (
                    <li key={reason} className="flex gap-1.5 text-[11px] leading-relaxed text-ink-3">
                      <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      {reason}
                    </li>
                  ))}
                </ul>
              </>
            ) : null}

            <label className="mt-2.5 block">
              <span className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Posting time</span>
              <select
                value={idea.scheduled_time}
                onChange={(event) => void setIdeaTime(idea.id, event.target.value)}
                className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2 py-1.5 text-[12px] outline-none focus:border-accent"
              >
                {POSTING_TIMES.map((time) => (
                  <option key={time} value={time}>
                    {time}
                  </option>
                ))}
              </select>
            </label>
          </section>

          <section className="mt-4">
            <h3 className="display text-[12px]">Platform</h3>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
              Selecting an alternate regenerates the format-specific caption and creative.
            </p>
            <div className="mt-2 space-y-1.5">
              <PlatformRow platform={idea.platform} score={idea.analysis?.platformScore ?? 90} active />
              {idea.alt_platforms.map((alt) => (
                <PlatformRow
                  key={alt.platform}
                  platform={alt.platform}
                  score={alt.score}
                  onSelect={() => void setIdeaPlatform(idea.id, alt.platform)}
                />
              ))}
            </div>
          </section>
        </aside>

        {/* ── CENTRE ──────────────────────────────────────────────────── */}
        <div className="overflow-y-auto p-4">
          <section className="card p-3">
            <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <div>
                <h3 className="display text-[12px]">AI-Generated Post · editable</h3>
                <p className="text-[10.5px] text-ink-3">
                  {draft ? `Revision ${draft.revision} · ${draft.model} · ${draft.source}` : 'Writing…'}
                </p>
              </div>
              <Btn variant="ghost" onClick={() => void regenerateDraft(idea.id)}>
                <RefreshCw size={12} /> Regenerate
              </Btn>
            </header>

            <div className="mb-2 flex flex-wrap gap-1.5">
              {CAPTION_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    setTarget('caption')
                    send(action.instruction)
                  }}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                >
                  {action.label}
                </button>
              ))}
            </div>

            <textarea
              rows={13}
              value={body}
              onChange={(event) => setBody(event.target.value)}
              onBlur={() => updateDraft(idea.id, body)}
              aria-label="Caption"
              className="w-full resize-y rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] leading-relaxed outline-none focus:border-accent"
            />
            <p className="tabular mt-1 text-right text-[10.5px] text-ink-3">{body.length} characters</p>
          </section>

          <section className="card mt-3 p-3">
            <header className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="display text-[12px]">Image Creator</h3>
              <div className="flex flex-wrap items-center gap-1.5">
                <Badge tone="neutral">{asset?.canvas ?? '—'}</Badge>
                <Badge tone="neutral">{asset?.concept ?? '—'}</Badge>
                <Badge tone="accent">{asset?.model ?? 'brand-svg'}</Badge>
              </div>
            </header>

            {asset ? (
              <img
                src={asset.dataUri}
                alt={asset.altText ?? ''}
                className="w-full rounded-lg border border-line object-contain"
                style={{ maxHeight: 440 }}
              />
            ) : (
              <div className="h-48 animate-pulse rounded-lg bg-surface-2" />
            )}

            {asset?.fallbackReason ? (
              <p className="mt-2 flex items-start gap-1.5 rounded-lg border border-warn/40 bg-warn/10 px-2.5 py-2 text-[11px] leading-relaxed text-warn">
                <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                {asset.fallbackReason}
              </p>
            ) : null}

            <div className="mt-2 flex flex-wrap gap-1.5">
              {IMAGE_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => {
                    setTarget('image')
                    send(action.instruction)
                  }}
                  className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                >
                  {action.label}
                </button>
              ))}
            </div>

            <div className="mt-2 flex items-center gap-2">
              <input
                value={imagePrompt}
                onChange={(event) => setImagePrompt(event.target.value)}
                aria-label="Image prompt"
                className="flex-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11.5px] outline-none focus:border-accent"
              />
              <Btn variant="subtle" onClick={() => void regenerateImage(idea.id)}>
                Re-render
              </Btn>
            </div>

            {asset?.altText ? (
              <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
                <span className="text-ink-2">Alt text:</span> {asset.altText}
              </p>
            ) : null}
          </section>

          <section className="mt-3">
            <h3 className="display mb-2 text-[12px]">How it will appear on {PLATFORM_LABEL[idea.platform]}</h3>
            <PlatformPreview platform={idea.platform} body={body} media={asset?.dataUri ?? null} />
          </section>
        </div>

        {/* ── RIGHT ───────────────────────────────────────────────────── */}
        <aside className="flex flex-col overflow-hidden border-l border-line">
          <div className="border-b border-line p-3">
            <Tabs<'caption' | 'image'>
              active={target}
              onChange={setTarget}
              tabs={[
                { id: 'caption', label: 'Caption' },
                { id: 'image', label: 'Image' },
              ]}
            />
          </div>

          <div className="flex-1 space-y-2.5 overflow-y-auto p-3">
            {bubbles.length === 0 ? (
              <>
                <p className="text-[11.5px] leading-relaxed text-ink-3">
                  Tell me what to change. A human instruction always outranks a brand guideline — I apply
                  it, and raise the finding alongside it rather than resolving it silently.
                </p>
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {(target === 'caption' ? CAPTION_PROMPTS : IMAGE_PROMPTS).map((prompt) => (
                    <button
                      key={prompt}
                      type="button"
                      onClick={() => send(prompt)}
                      className="rounded-full border border-line px-2.5 py-1 text-[11px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                    >
                      {prompt}
                    </button>
                  ))}
                </div>
              </>
            ) : null}

            {bubbles.map((bubble) =>
              bubble.speaker === 'operator' ? (
                <div key={bubble.id} className="anim-fade-up flex justify-end">
                  <p className="max-w-[88%] rounded-xl rounded-br-sm border border-accent/35 bg-accent/10 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink">
                    {bubble.text}
                  </p>
                </div>
              ) : (
                <div key={bubble.id} className="anim-fade-up flex gap-2">
                  <AssistantCore state="dormant" size={18} className="mt-0.5 shrink-0" />
                  <p className="max-w-[88%] text-[11.5px] leading-relaxed text-ink-2">{bubble.text}</p>
                </div>
              ),
            )}

            {thinking ? (
              <div className="flex gap-2">
                <AssistantCore state="thinking" size={18} className="mt-0.5 shrink-0" />
                <p className="text-[11.5px] text-ink-3">{thinking}</p>
              </div>
            ) : null}

            {preference ? (
              <div className="anim-fade-up rounded-xl border border-accent/40 bg-accent/8 p-2.5">
                <p className="text-[11.5px] font-medium text-ink">Save this preference to the Knowledge Base?</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{preference.content}</p>
                <div className="mt-2 flex items-center gap-2">
                  <Btn
                    variant="primary"
                    onClick={() => {
                      void addKnowledge({ ...preference, category: 'User Feedback' })
                      setPreference(null)
                    }}
                  >
                    Save
                  </Btn>
                  <Btn variant="ghost" onClick={() => setPreference(null)}>
                    Dismiss
                  </Btn>
                </div>
              </div>
            ) : null}
          </div>

          <div className="border-t border-line p-3">
            {references.length > 0 ? (
              <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached references">
                {references.map((reference) => (
                  <li
                    key={reference.id}
                    className="flex max-w-full items-center gap-1.5 rounded-lg border border-line bg-surface-2 px-2 py-1"
                  >
                    {reference.dataUri ? (
                      <img src={reference.dataUri} alt="" className="h-5 w-5 rounded object-cover" />
                    ) : (
                      <FileText size={12} className="shrink-0 text-ink-3" aria-hidden="true" />
                    )}
                    <span className="min-w-0">
                      <span className="block truncate text-[11px] text-ink-2">{reference.name}</span>
                      {reference.unreadableReason ? (
                        <span className="block text-[10px] text-warn">
                          Attached by name only — {reference.unreadableReason}.
                        </span>
                      ) : reference.text && reference.text.length >= MAX_REFERENCE_CHARS ? (
                        <span className="block text-[10px] text-ink-3">
                          truncated to {MAX_REFERENCE_CHARS.toLocaleString()} characters
                        </span>
                      ) : null}
                    </span>
                    <button
                      type="button"
                      onClick={() => setReferences((prev) => prev.filter((r) => r.id !== reference.id))}
                      aria-label={`Remove ${reference.name}`}
                      className="shrink-0 rounded p-0.5 text-ink-3 transition-colors hover:text-critical-ink"
                    >
                      <X size={11} />
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}

            <form
              onSubmit={(event) => {
                event.preventDefault()
                send(chatValue)
              }}
              className="flex items-center gap-2"
            >
              <label
                title="Attach a reference file for the model"
                className="shrink-0 cursor-pointer rounded-lg border border-line p-1.5 text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
              >
                <Paperclip size={13} aria-hidden="true" />
                <span className="sr-only">Attach a reference file</span>
                <input
                  type="file"
                  multiple
                  accept="image/*,text/*,.md,.txt,.csv,.json,.yml,.yaml"
                  className="hidden"
                  onChange={(event) => {
                    void attach(event.target.files)
                    event.target.value = ''
                  }}
                />
              </label>

              <input
                value={chatValue}
                onChange={(event) => setChatValue(event.target.value)}
                placeholder={target === 'caption' ? 'Change the caption…' : 'Change the creative…'}
                aria-label="Instruction"
                className="min-w-0 flex-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11.5px] outline-none focus:border-accent"
              />
              <Btn type="submit" variant="primary" disabled={chatValue.trim().length === 0}>
                <Sparkles size={12} />
              </Btn>
            </form>

            {attaching ? (
              <p className="mt-1 text-[10.5px] text-ink-3">Reading the attachment…</p>
            ) : null}

            {/* Both models are chosen here — the writer for the caption tab, the
                painter for the image tab, each switching with the tab. */}
            <div className="mt-2">
              {target === 'caption' ? (
                <ModelMenu
                  target="caption"
                  selected={settings.captionModel}
                  onSelect={(modelId) => updateSettings({ captionModel: modelId })}
                />
              ) : (
                <ModelMenu
                  target="image"
                  selected={settings.imageModel}
                  onSelect={(modelId) => {
                    updateSettings({ imageModel: modelId })
                    void regenerateImage(idea.id, idea.platform, modelId)
                  }}
                />
              )}
            </div>

            <FinalApproval
              status={idea.status}
              isLeadership={isLeadership}
              approvedBy={idea.marketing_approved_by}
              rejectionReason={idea.leadership_decision?.reason}
              publishPhase={publishPhase}
              onApprove={() => void approveIdea(idea.id)}
              onLeadershipApprove={() => void leadershipApprove(idea.id)}
              onPublish={() => setConfirmPublish(true)}
              scheduledTime={idea.scheduled_time}
            />
          </div>
        </aside>
      </div>

      {/* ── Publish confirmation ─────────────────────────────────────── */}
      {confirmPublish ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-page/85 p-6 backdrop-blur-md">
          <div className="anim-dialog-in card w-full max-w-2xl overflow-hidden">
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h3 className="display text-sm">Publish to {PLATFORM_LABEL[idea.platform]}?</h3>
              <button
                type="button"
                onClick={() => setConfirmPublish(false)}
                aria-label="Cancel"
                className="rounded-md p-1 text-ink-3 hover:text-ink"
              >
                <X size={15} />
              </button>
            </header>

            <div className="max-h-[52vh] overflow-y-auto p-4">
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <PlatformChip platform={idea.platform} />
                <Badge tone="neutral">
                  {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ·{' '}
                  {idea.scheduled_time}
                </Badge>
                <Badge tone="warn">Demo mode — publishing is simulated</Badge>
              </div>
              <PlatformPreview platform={idea.platform} body={body} media={asset?.dataUri ?? null} />
            </div>

            {/* Demo mode does not publish, and the button says so rather than
                accepting a click and failing. The server refuses regardless. */}
            <footer className="flex flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
              {!canPublish ? (
                <p className="mr-auto flex items-start gap-1.5 text-[11px] leading-relaxed text-warn">
                  <AlertTriangle size={12} className="mt-0.5 shrink-0" aria-hidden="true" />
                  Publishing is disabled in demo mode. Set{' '}
                  <code className="mono rounded bg-surface-2 px-1">PUBLISH_MODE=live</code> and supply
                  the platform token.
                </p>
              ) : null}
              <Btn variant="ghost" onClick={() => setConfirmPublish(false)}>
                Cancel
              </Btn>
              <Btn
                variant="primary"
                disabled={!canPublish}
                onClick={() => {
                  setConfirmPublish(false)
                  void publishIdea(idea.id)
                }}
              >
                <Send size={12} /> Publish now
              </Btn>
            </footer>
          </div>
        </div>
      ) : null}
    </Dialog>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   PIECES
   ═══════════════════════════════════════════════════════════════════════════ */

/** The captured page the idea was formed from — or, for a hashtag-born idea, the strongest post carrying the tag. */
function ReferenceField({ idea }: { idea: Idea }) {
  const url = idea.source_url ?? idea.hashtag_url
  const title = idea.source_url ? idea.source_title : idea.hashtag_display ? `Strongest post carrying #${idea.hashtag_display}` : null
  let host: string | null = null
  if (url) {
    try {
      host = new URL(url).hostname.replace(/^www\./, '')
    } catch {
      host = null
    }
  }

  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Reference</p>
      {url ? (
        <a
          href={url}
          target="_blank"
          rel="noreferrer"
          className="group mt-0.5 block rounded-lg border border-line bg-surface-2 px-2.5 py-2 transition-colors hover:border-accent"
        >
          <span className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <ExternalLink size={11} className="shrink-0 transition-colors group-hover:text-accent-bright" aria-hidden="true" />
            <span className="truncate">{idea.source_name ?? host ?? url}</span>
          </span>
          {title ? <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-relaxed text-ink-2">{title}</span> : null}
          <span className="mt-0.5 block truncate text-[10.5px] text-ink-3">{url}</span>
        </a>
      ) : (
        <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">No captured page is linked to this idea.</p>
      )}
    </div>
  )
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-2">{value}</p>
    </div>
  )
}

function PlatformRow({
  platform,
  score,
  active = false,
  onSelect,
}: {
  platform: Platform
  score: number
  active?: boolean
  onSelect?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={active}
      className={`flex w-full items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left transition-colors ${
        active ? 'border-accent bg-accent/10' : 'border-line hover:border-line-strong hover:bg-surface-2'
      }`}
    >
      <PlatformChip platform={platform} />
      <span className="tabular ml-auto text-[11px] text-ink-3">{score}% match</span>
      {active ? <Check size={12} className="text-accent-bright" aria-hidden="true" /> : null}
    </button>
  )
}

function FinalApproval({
  status,
  isLeadership,
  approvedBy,
  rejectionReason,
  publishPhase,
  scheduledTime,
  onApprove,
  onLeadershipApprove,
  onPublish,
}: {
  status: string
  isLeadership: boolean
  approvedBy: string | null
  rejectionReason?: string
  publishPhase: string | null
  scheduledTime: string
  onApprove: () => void
  onLeadershipApprove: () => void
  onPublish: () => void
}) {
  const PHASES = [
    'Preparing content',
    'Validating platform format',
    'Uploading media',
    'Publishing',
    'Published successfully',
  ]

  if (publishPhase) {
    const index = PHASES.indexOf(publishPhase)
    return (
      <div className="mt-3 rounded-xl border border-accent/40 bg-accent/8 p-3">
        <p className="text-[11px] uppercase tracking-[0.1em] text-accent-bright">Publishing</p>
        <ul className="mt-2 space-y-1.5">
          {PHASES.map((phase, i) => (
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
          ))}
        </ul>
      </div>
    )
  }

  return (
    <div className="mt-3 rounded-xl border border-accent/40 bg-accent/8 p-3">
      <p className="text-[11px] uppercase tracking-[0.1em] text-accent-bright">Final approval</p>

      {status === 'rejected' ? (
        <p className="mt-1.5 text-[11.5px] leading-relaxed text-critical-ink">
          Rejected: “{rejectionReason ?? 'no reason recorded'}”
        </p>
      ) : status === 'approved' ? (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <Btn variant="primary" onClick={onPublish}>
            <Send size={12} /> Publish now
          </Btn>
          <Btn variant="subtle" onClick={onPublish}>
            Schedule for {scheduledTime}
          </Btn>
        </div>
      ) : status === 'pending_leadership' ? (
        isLeadership ? (
          <Btn variant="primary" className="mt-2 w-full" onClick={onLeadershipApprove}>
            Give final approval
          </Btn>
        ) : (
          <p className="mt-1.5 text-[11.5px] leading-relaxed text-ink-3">
            Approved by {approvedBy ?? 'Marketing'}. Waiting for Leadership's final decision — nothing
            publishes until then.
          </p>
        )
      ) : (
        <Btn variant="primary" className="mt-2 w-full" onClick={onApprove}>
          Approve &amp; send to Leadership
        </Btn>
      )}

      <p className="mt-2 text-[10.5px] leading-relaxed text-ink-3">
        Either way, the outcome is written to the Knowledge Base so the agents learn from it.
      </p>
    </div>
  )
}

/** Kept for the drawer's relative timestamps. */
export { timeAgo }

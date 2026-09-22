/**
 * THE REVIEW PANEL
 *
 * A full-screen `Dialog`, three columns: why the post exists, the editor, and
 * the live preview with the agent under it. The outer two scroll on their own
 * so the composer never leaves view. This is where a human shapes what the
 * agents wrote.
 */

import { useEffect, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, Check, ChevronLeft, ChevronRight, Clock, ExternalLink, FileText, Paperclip, RefreshCw, Send, Shuffle, Sparkles, X } from 'lucide-react'
import { useStore } from '../store'

/* The right column — the live preview with the agent under it — is draggable
   from its left edge. The bounds keep it useful at both ends: narrower stops
   showing a post at a believable width, wider starves the editor beside it.
   The width outlives the dialog. */
const ASIDE_MIN = 300
const ASIDE_MAX = 720
const ASIDE_DEFAULT = 392
const ASIDE_KEY = 'ethara.review.asideWidth'
import { ModelMenu } from '../components/model-menu'
import { DEFAULT_CROP, PREVIEW_CROPS, PlatformPreview, type PreviewCrop } from '../components/previews'
import { AssistantCore } from '../components/assistant/core'
import {
  Badge,
  Btn,
  Dialog,
  PlatformChip,
  PlatformIcon,
  PLATFORM_LABEL,
  PLATFORM_TOKEN,
  Select,
  timeAgo,
} from '../components/ui'
import { defaultSkillConfig } from '../../shared/agent-registry'
import type { Idea, Platform } from '../types'

/**
 * Where each platform's caption is cut.
 *
 * These are the caption agent's own knobs, read from the registry rather than
 * restated here, so the counter on this screen and the limit the writer works
 * to can never drift apart.
 */
const CAPTION_LIMITS = defaultSkillConfig('generation.caption.adapt')
const CAPTION_CAP: Record<Platform, number> = {
  linkedin: Number(CAPTION_LIMITS.linkedinMaxChars),
  instagram: Number(CAPTION_LIMITS.instagramMaxChars),
  x: Number(CAPTION_LIMITS.xMaxChars),
  facebook: Number(CAPTION_LIMITS.facebookMaxChars),
}

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

/*
 * The starter instructions, as a short chip and the sentence actually sent.
 * The chips used to BE the sentences, and four of them stacked one per line
 * filled the agent panel with more text than the post it was editing.
 */
const CAPTION_PROMPTS = [
  { label: 'Shorter, for CTOs', instruction: 'Make it shorter and more CTO-focused' },
  { label: 'Lead with the number', instruction: 'Lead with the number instead of the framing' },
  { label: 'Cut the second para', instruction: 'Remove the second paragraph' },
  { label: 'Close on the blog', instruction: 'Rewrite the close so it points at the blog' },
]

/* The design's tones: approved reads blue, published green, drafted amber. */
const STATUS_INK: Partial<Record<Idea['status'], string>> = {
  approved: 'var(--color-accent-bright)',
  scheduled: 'var(--color-accent-bright)',
  published: 'var(--color-good-ink)',
  drafted: 'var(--color-warn)',
  in_review: 'var(--color-serious)',
  pending_leadership: 'var(--color-serious)',
  rejected: 'var(--color-critical-ink)',
}

/** One step on the revision spine: what was asked, and what it changed. */
interface Revision {
  id: string
  revision: number
  instruction: string | null
  summary: string
  charDelta: number
  paraDelta: number
  body: string
  finding: string | null
}

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
/** Blank-line separated blocks — the unit the Content Agent writes in. */
function paragraphs(text: string): number {
  return text.split(/\n\s*\n/).filter((block) => block.trim().length > 0).length
}

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
  const leadershipPublish = useStore((s) => s.leadershipPublish)
  const publishIdea = useStore((s) => s.publishIdea)
  const leadershipReject = useStore((s) => s.leadershipReject)
  const deleteIdea = useStore((s) => s.deleteIdea)
  const addKnowledge = useStore((s) => s.addKnowledge)
  const updateSettings = useStore((s) => s.updateSettings)

  const idea = ideas.find((i) => i.id === reviewIdeaId)
  // A primitive, so effects can depend on identity of the POST rather than on
  // the identity of the object the last refetch happened to allocate.
  const ideaId = idea?.id ?? null

  const [target, setTarget] = useState<'caption' | 'image'>('caption')
  const [body, setBody] = useState('')
  const [bubbles, setBubbles] = useState<Bubble[]>([])
  const [chatValue, setChatValue] = useState('')
  const [thinking, setThinking] = useState<string | null>(null)
  const [preference, setPreference] = useState<{ title: string; content: string } | null>(null)
  const [confirmPublish, setConfirmPublish] = useState(false)
  /** Open, plus the reason — a rejection without one is refused by the store. */
  const [rejecting, setRejecting] = useState(false)
  const [rejectReason, setRejectReason] = useState('')
  const [references, setReferences] = useState<Reference[]>([])
  const [attaching, setAttaching] = useState(false)
  /**
   * The revision spine. Each entry is one instruction and what it measurably
   * did to the draft — the character delta and the paragraph delta, both
   * counted here rather than described by the model.
   */
  const [spine, setSpine] = useState<Revision[]>([])
  const [savedAt, setSavedAt] = useState<number | null>(null)
  const [view, setView] = useState<'edit' | 'preview' | 'diff'>('edit')
  /** The feed crop the preview shows the creative in. Null means the platform's own. */
  const [cropChoice, setCropChoice] = useState<PreviewCrop | null>(null)
  /** The left column, folded sideways. Open by default: it answers "why". */
  const [whyOpen, setWhyOpen] = useState(true)

  /* ── the draggable right column ── */
  const [asideWidth, setAsideWidth] = useState(() => {
    if (typeof window === 'undefined') return ASIDE_DEFAULT
    const stored = Number(window.localStorage.getItem(ASIDE_KEY))
    return Number.isFinite(stored) && stored >= ASIDE_MIN && stored <= ASIDE_MAX ? stored : ASIDE_DEFAULT
  })
  const [resizing, setResizing] = useState(false)
  const resizeFrom = useRef<{ x: number; width: number } | null>(null)
  const clampAside = (width: number) => Math.min(ASIDE_MAX, Math.max(ASIDE_MIN, Math.round(width)))

  useEffect(() => {
    /* Storage throws in private mode; a preference is not worth a crash. */
    try { window.localStorage.setItem(ASIDE_KEY, String(asideWidth)) } catch { /* ignored */ }
  }, [asideWidth])

  const startResize = (event: React.PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    resizeFrom.current = { x: event.clientX, width: asideWidth }
    setResizing(true)
  }
  const moveResize = (event: React.PointerEvent<HTMLDivElement>) => {
    const from = resizeFrom.current
    if (!from) return
    /* The handle is on the column's left edge, so dragging left widens it. */
    setAsideWidth(clampAside(from.width - (event.clientX - from.x)))
  }
  const endResize = (event: React.PointerEvent<HTMLDivElement>) => {
    if (!resizeFrom.current) return
    resizeFrom.current = null
    setResizing(false)
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
  }
  const keyResize = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return
    event.preventDefault()
    setAsideWidth((width) => clampAside(width + (event.key === 'ArrowLeft' ? 24 : -24)))
  }
  const [restorePoint, setRestorePoint] = useState<string | null>(null)

  const draft = idea ? drafts[`${idea.id}|${idea.platform}`] : undefined
  const asset = idea ? media[`${idea.id}|${idea.platform}`] : undefined

  /*
   * Ensure the composer is never empty when the panel opens.
   *
   * KEYED ON THE ID, NOT THE OBJECT. `idea` was in this dependency array
   * alongside `idea?.id`, and `idea` is a fresh object on every `/state`
   * refetch — so the effect re-ran, called `ensureDraft`/`ensureImage`, those
   * wrote to the store, the store produced a new `idea` object, and the effect
   * ran again. An unbounded loop that hammered the draft and image endpoints and
   * left the panel unable to settle.
   *
   * The id is the only thing that should retrigger this: a different post needs
   * a different draft. The same post re-fetched does not.
   */
  useEffect(() => {
    if (!ideaId) return
    void ensureDraft(ideaId)
    void ensureImage(ideaId)
    setBubbles([])
    setPreference(null)
    setConfirmPublish(false)
    setSpine([])
    setSavedAt(null)
    setView('edit')
    setRestorePoint(null)
  }, [ideaId, ensureDraft, ensureImage])

  useEffect(() => {
    setBody(draft?.body ?? '')
  }, [draft?.body])

  // The first draft opens the spine, so R1 is always the agent's own writing.
  useEffect(() => {
    if (!draft?.body) return
    setSpine((prev) => {
      if (prev.length > 0) return prev
      return [
        {
          id: 'r1',
          revision: draft.revision,
          instruction: null,
          summary: `First draft · ${draft.body.length} characters, ${paragraphs(draft.body)} paragraphs.`,
          charDelta: 0,
          paraDelta: 0,
          body: draft.body,
          finding: null,
        },
      ]
    })
  }, [draft?.body, draft?.revision])

  /*
   * NEVER FAIL SILENTLY.
   *
   * This was `if (!idea) return null` — a click set `reviewIdeaId`, the lookup
   * missed, and the panel rendered nothing. From the outside that is
   * indistinguishable from the card not being clickable at all, which is exactly
   * how it was reported, and it left nothing to diagnose.
   *
   * A click must always produce visible feedback. If the post cannot be resolved
   * the dialog still opens and says so, naming the id, so the failure is
   * reportable instead of invisible.
   */
  if (!idea) {
    return (
      <Dialog
        open={Boolean(reviewIdeaId)}
        onClose={closeReview}
        header={<h2 className="display text-[15px]">Post unavailable</h2>}
      >
        <div className="p-6 text-[13px] leading-relaxed text-ink-2">
          <p className="mb-3">
            This post could not be loaded into the editor. It was on the calendar a moment ago,
            so the most likely cause is that the page&rsquo;s data is stale.
          </p>
          <p className="mb-3 text-ink-3">
            Reference: <span className="mono text-[11.5px]">{reviewIdeaId ?? 'none'}</span>
          </p>
          <button
            type="button"
            onClick={closeReview}
            className="rounded-lg border border-line-strong px-3 py-1.5 text-[12.5px] transition-colors hover:border-accent"
          >
            Close
          </button>
        </div>
      </Dialog>
    )
  }

  const crop: PreviewCrop = cropChoice ?? DEFAULT_CROP[idea.platform]
  const slotReasons = (idea.analysis?.slotReasons as string[] | undefined) ?? []
  /**
   * A recorded reason that names a platform this post is no longer on. Moving
   * a post does not rewrite the plan that put it where it was, so the reason
   * outlives the decision and has to be labelled as history.
   */
  const staleSlotReason = slotReasons.some((reason) =>
    (Object.entries(PLATFORM_LABEL) as Array<[Platform, string]>).some(
      ([id, label]) => id !== idea.platform && reason.includes(label),
    ),
  )
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

    const before = body
    void instructAI(idea.id, text, attached).then((note) => {
      setThinking(null)
      setBubbles((prev) => [...prev, { id: `a-${Date.now()}`, speaker: 'assistant', text: note }])
      /*
       * The spine records what changed, counted here. The model's own note is
       * kept as the summary, but the deltas are measured against the text that
       * was on screen a moment ago — a described change and a counted one are
       * not the same claim.
       */
      const after = useStore.getState().drafts[`${idea.id}|${idea.platform}`]?.body ?? before
      setSpine((prev) => [
        ...prev,
        {
          id: `r-${Date.now()}`,
          revision: (prev[prev.length - 1]?.revision ?? 1) + 1,
          instruction: text,
          summary: note,
          charDelta: after.length - before.length,
          paraDelta: paragraphs(after) - paragraphs(before),
          body: after,
          // A finding is raised, never resolved: the note says so when one applies.
          finding: /brand|voice|rule|guideline|outrank/i.test(note) ? note : null,
        },
      ])
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
        <div className="flex min-w-0 flex-1 items-center gap-3">
          <button
            type="button"
            onClick={closeReview}
            aria-label="Back to the calendar"
            className="mono inline-flex shrink-0 items-center gap-1.5 rounded-md border border-line-strong px-2.5 py-[5px] text-[10px] uppercase tracking-[0.08em] text-ink-3 transition-colors hover:border-accent hover:text-ink"
          >
            <ChevronLeft size={12} aria-hidden="true" />
            {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric' })} · {idea.scheduled_time}
          </button>

          <div className="min-w-0">
            <h2 className="truncate text-[15px] font-semibold tracking-[-0.02em] text-ink">{idea.title}</h2>
            <div className="mono flex flex-wrap items-center gap-2 text-[11px] text-ink-3">
              <span className="inline-flex items-center gap-1.5" style={{ color: PLATFORM_TOKEN[idea.platform] }}>
                <PlatformIcon platform={idea.platform} size={10} />
                {PLATFORM_LABEL[idea.platform].toUpperCase()}
              </span>
              {idea.analysis?.format ? <><span>·</span><span>{String(idea.analysis.format).toUpperCase()}</span></> : null}
              <span>·</span><span>CONF {idea.confidence}</span>
              <span>·</span>
              <span
                className="rounded-full border px-2 py-px text-[9px] font-semibold tracking-[0.12em]"
                style={{
                  color: STATUS_INK[idea.status] ?? 'var(--color-ink-2)',
                  borderColor: `color-mix(in srgb, ${STATUS_INK[idea.status] ?? 'var(--color-ink-3)'} 35%, transparent)`,
                  background: `color-mix(in srgb, ${STATUS_INK[idea.status] ?? 'var(--color-ink-3)'} 10%, transparent)`,
                }}
              >
                {idea.status.replace(/_/g, ' ').toUpperCase()}
              </span>
            </div>
          </div>

          {/* The decision lives here. It used to sit under the chat, where it
              scrolled out of reach on the one screen that exists to make it. */}
          <div className="ml-auto flex shrink-0 items-center gap-2">
            {savedAt ? (
              <span className="mono hidden items-center gap-1.5 text-[11px] uppercase tracking-[0.08em] text-ink-3 xl:inline-flex">
                <span className="h-[5px] w-[5px] rounded-full bg-good" aria-hidden="true" />
                saved {timeAgo(new Date(savedAt).toISOString())}
              </span>
            ) : null}
            <HeaderDecision
              status={idea.status}
              isLeadership={isLeadership}
              approvedBy={idea.marketing_approved_by}
              publishPhase={publishPhase}
              onApprove={() => void approveIdea(idea.id)}
              onLeadershipPublish={() => setConfirmPublish(true)}
              onPublish={() => setConfirmPublish(true)}
              onReject={() => { setRejectReason(''); setRejecting(true) }}
            />
          </div>
        </div>
      }
    >
      {/* A flex row, not a grid: the rail animates its own width and the
          centre takes what is left, which a fixed grid template cannot do. */}
      <div className="flex h-full min-h-0 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">

        {/* ── LEFT · why this exists ────────────────────────────────────
            The column folds sideways to a rail rather than each section
            folding down: folding down left three truncated headings
            ("WHY WEDN…") and still took the width. */}
        <aside
          className="relative flex min-h-0 flex-col border-r border-line bg-surface-2 transition-[width] duration-[var(--dur-base)] ease-[var(--ease-out-soft)] lg:overflow-hidden"
          style={{ width: whyOpen ? 236 : 52 }}
          aria-label="Why this post exists"
        >
          {whyOpen ? (
            <header className="flex h-9 shrink-0 items-center gap-2 border-b border-line px-3">
              <span className="h-[14px] w-[2px] shrink-0 rounded-full bg-magenta" aria-hidden="true" />
              <span className="mono min-w-0 flex-1 truncate text-[9px] uppercase tracking-[0.14em] text-ink-2">
                Why this post exists
              </span>
              <button
                type="button"
                onClick={() => setWhyOpen(false)}
                aria-expanded
                title="Collapse this column"
                aria-label="Collapse this column"
                className="flex h-[22px] w-[22px] shrink-0 items-center justify-center rounded-[7px] border border-line-strong text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
              >
                <ChevronLeft size={12} aria-hidden="true" />
              </button>
            </header>
          ) : (
            /*
             * COLLAPSED, THE RAIL STILL SAYS WHAT IT HOLDS.
             *
             * It was a bare strip with one chevron and a line of vertical text,
             * which reads as a border rather than a control. Now the whole
             * column is the button, and the four glyphs name what is behind it
             * — the scores, the captured page, the slot, the other platforms —
             * so the rail advertises its contents instead of hiding them.
             */
            <button
              type="button"
              onClick={() => setWhyOpen(true)}
              aria-expanded={false}
              title="Show why this post exists"
              aria-label="Show why this post exists"
              className="group relative flex h-full w-full flex-col items-center gap-3 overflow-hidden py-3 outline-none"
            >
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-[var(--dur-base)] group-hover:opacity-100 group-focus-visible:opacity-100"
                style={{ background: 'linear-gradient(180deg, var(--color-hud-glow), transparent 55%)' }}
              />
              <span
                aria-hidden="true"
                className="pointer-events-none absolute inset-y-0 right-0 w-px"
                style={{ background: 'linear-gradient(180deg, transparent, var(--color-magenta), transparent)', opacity: 0.45 }}
              />

              <span className="relative flex h-[26px] w-[26px] shrink-0 items-center justify-center rounded-[8px] border border-line-strong text-ink-3 transition-colors duration-[var(--dur-fast)] group-hover:border-accent group-hover:text-accent-bright group-focus-visible:border-accent">
                <ChevronRight size={12} aria-hidden="true" />
              </span>

              <span
                className="mono relative flex flex-1 items-center justify-center whitespace-nowrap text-[9px] uppercase tracking-[0.2em] text-ink-3 transition-colors duration-[var(--dur-fast)] group-hover:text-ink-2"
                style={{ writingMode: 'vertical-rl', transform: 'rotate(180deg)' }}
              >
                Why this post exists
              </span>

              {/* What the column holds, one glyph each. */}
              <span className="relative flex shrink-0 flex-col items-center gap-1.5" aria-hidden="true">
                {[
                  { icon: Sparkles, label: 'Brand and trend scores' },
                  { icon: ExternalLink, label: 'The captured page' },
                  { icon: Clock, label: 'Why this slot' },
                  { icon: Shuffle, label: 'Other platforms' },
                ].map((item) => (
                  <span
                    key={item.label}
                    title={item.label}
                    className="flex h-[22px] w-[22px] items-center justify-center rounded-[7px] border border-line text-ink-3 transition-colors duration-[var(--dur-fast)] group-hover:border-magenta/35 group-hover:text-magenta-ink"
                  >
                    <item.icon size={11} />
                  </span>
                ))}
              </span>
            </button>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto" style={{ display: whyOpen ? undefined : 'none' }}>
          <div className="border-b border-line px-3.5 py-3">
            <p className="text-[12px] leading-relaxed text-ink-2">
              {idea.hashtag_display ? <>Captured under <span className="mono text-[11px] text-accent-bright">#{idea.hashtag_display}</span>. </> : null}
              {idea.source_topic ? <>Topic <span className="text-ink">{idea.source_topic}</span>. </> : null}
              {idea.analysis?.angle ? <>Angle: {String(idea.analysis.angle)}.</> : null}
            </p>
            <div className="mt-2.5 flex gap-2">
              <ScoreBar label="BRAND" value={Number(idea.analysis?.brandRelevance ?? 0)} delay={220} />
              <ScoreBar label="TREND" value={Number(idea.analysis?.trendScore ?? 0)} delay={300} />
            </div>
            <div className="mt-2.5"><ReferenceField idea={idea} /></div>
          </div>

          <div className="border-b border-line px-3.5 py-3">
            <div className="flex items-center gap-2">
              <p className="mono min-w-0 flex-1 text-[10.5px] tracking-[0.14em] text-ink-3">
                WHY {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { weekday: 'long' }).toUpperCase()} {idea.scheduled_time}
              </p>
              <Select
                value={idea.scheduled_time}
                onChange={(time) => void setIdeaTime(idea.id, time)}
                options={POSTING_TIMES.map((time) => ({ value: time, label: time }))}
                ariaLabel="Posting time"
                mono
                size="xs"
              />
            </div>
            {slotReasons.length > 0 ? (
              <>
                <ul className="mt-2 flex flex-col gap-1.5">
                  {slotReasons.slice(0, 4).map((reason) => (
                    <li key={reason} className="flex gap-[7px] text-[11.5px] leading-relaxed text-ink-2">
                      <span className="mt-[7px] h-[3px] w-[3px] shrink-0 rounded-full bg-accent" aria-hidden="true" />
                      {reason}
                    </li>
                  ))}
                </ul>
                {/*
                 * These are Dora's words from when the slot was chosen, kept
                 * as written. If the post has since moved platform, a reason
                 * can still name the platform it was planned for — that is the
                 * record, so it is attributed rather than quietly rewritten.
                 */}
                <p className="mono mt-2 text-[10.5px] uppercase tracking-[0.08em] text-ink-3">
                  Dora’s reasoning when the slot was chosen
                  {staleSlotReason ? ' · planned before this post moved platform' : ''}
                </p>
              </>
            ) : (
              <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">Dora recorded no reasoning for this slot.</p>
            )}
          </div>

          <div className="px-3.5 py-3">
            <p className="mono text-[10.5px] tracking-[0.14em] text-ink-3">MOVE TO ANOTHER PLATFORM</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">Redrafts the caption and creative for that format.</p>
            <div className="mt-2.5 flex flex-col gap-1.5">
              {idea.alt_platforms.length === 0 ? (
                <p className="text-[11px] text-ink-3">No alternate platform scored well enough to offer.</p>
              ) : (
                idea.alt_platforms.map((alt) => (
                  <button
                    key={alt.platform}
                    type="button"
                    onClick={() => void setIdeaPlatform(idea.id, alt.platform)}
                    className="flex items-center gap-2 rounded-[7px] border border-line-strong px-2.5 py-[7px] text-left transition-colors hover:border-accent"
                  >
                    <PlatformIcon platform={alt.platform} size={12} />
                    <span className="flex-1 text-[12px] text-ink-2">{PLATFORM_LABEL[alt.platform]}</span>
                    <span className="mono text-[10px] text-ink-3">{alt.score}</span>
                  </button>
                ))
              )}
            </div>
          </div>
          </div>
        </aside>

        {/* ── CENTRE · the editor ──────────────────────────────────────
            Takes whatever the two rails give back. */}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          <div className="flex shrink-0 items-center gap-2 border-b border-line px-4 py-2.5">
            <div className="flex gap-0.5 rounded-md border border-line-strong p-0.5">
              {(['edit', 'preview', 'diff'] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`mono rounded-[4px] px-2.5 py-1 text-[10px] uppercase tracking-[0.08em] transition-colors ${
                    view === v ? 'bg-magenta/16 text-ink' : 'text-ink-3 hover:text-ink'
                  }`}
                >
                  {v}
                </button>
              ))}
            </div>
            <span className="mono truncate text-[11px] text-ink-3">
              {draft ? `SpongeBob · rev ${draft.revision}` : 'Writing…'}
            </span>
            <span
              className={`mono ml-auto shrink-0 text-[11px] ${body.length > CAPTION_CAP[idea.platform] ? 'text-critical-ink' : 'text-ink-3'}`}
              title={`${PLATFORM_LABEL[idea.platform]} captions are cut at ${CAPTION_CAP[idea.platform]} characters`}
            >
              {body.length} / {CAPTION_CAP[idea.platform]}
            </span>
          </div>

          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4">
            <div className="flex shrink-0 flex-wrap gap-1.5">
              {CAPTION_ACTIONS.map((action) => (
                <button
                  key={action.label}
                  type="button"
                  onClick={() => { setTarget('caption'); send(action.instruction) }}
                  className="rounded-full border border-line-strong px-3 py-1.5 text-[11.5px] text-ink-2 transition-colors hover:border-magenta/50 hover:text-magenta-ink"
                >
                  {action.label}
                </button>
              ))}
              <button
                type="button"
                onClick={() => void regenerateDraft(idea.id)}
                className="ml-auto inline-flex items-center gap-1.5 rounded-[9px] border border-line-strong px-3 py-1.5 text-[11.5px] font-semibold text-ink transition-colors hover:border-accent"
              >
                <RefreshCw size={11} aria-hidden="true" /> Regenerate
              </button>
            </div>

            {view === 'diff' ? (
              <DiffView spine={spine} />
            ) : view === 'preview' ? (
              <div className="mt-3 min-h-0 flex-1 overflow-y-auto">
                <div className="mx-auto max-w-[520px]">
                  <PlatformPreview platform={idea.platform} body={body} media={asset?.dataUri ?? null} crop={crop} />
                </div>
              </div>
            ) : (
              <>
                <textarea
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                  onBlur={() => { updateDraft(idea.id, body); setSavedAt(Date.now()) }}
                  aria-label="Caption"
                  className="mt-4 min-h-[320px] w-full flex-1 resize-none rounded-[12px] border border-line bg-page px-6 py-5 text-[14px] leading-[1.65] text-ink outline-none transition-colors focus:border-accent"
                />
                {/* A finding is raised beside the text it applies to, not buried. */}
                {spine.filter((r) => r.finding).slice(-1).map((r) => (
                  <div key={r.id} className="mt-2.5 flex shrink-0 items-center gap-2.5 rounded-lg border border-hud-strong bg-accent/10 px-3 py-2">
                    <Sparkles size={13} className="shrink-0 text-accent-bright" aria-hidden="true" />
                    <span className="flex-1 text-[11.5px] leading-relaxed text-ink-2">{r.finding}</span>
                    <button type="button" onClick={() => setView('diff')} className="mono shrink-0 text-[11px] text-ink-3 transition-colors hover:text-accent-bright">
                      SEE DIFF
                    </button>
                  </div>
                ))}
              </>
            )}
          </div>
        </div>

        {/* ── RIGHT · the live preview, then the agent under it ──────────
            One column, as the design draws it: what the post will look like
            sits above the agent that changes it. The column scrolls as a
            whole; the resize grip stays put on its left edge. */}
        <aside
          className="relative flex min-h-0 shrink-0 flex-col border-l border-line bg-surface-2 lg:w-[var(--aside-w)]"
          style={{ ['--aside-w' as string]: `${asideWidth}px` }}
          aria-label="Preview and agent"
        >
          {/* Drag this left edge to resize the column. Arrow keys do the same
              for anyone who cannot drag, which is why this is a focusable
              separator rather than a bare div with a cursor. */}
          <div
            role="separator"
            aria-orientation="vertical"
            aria-label="Resize the preview column"
            aria-valuenow={asideWidth}
            aria-valuemin={ASIDE_MIN}
            aria-valuemax={ASIDE_MAX}
            tabIndex={0}
            onPointerDown={startResize}
            onPointerMove={moveResize}
            onPointerUp={endResize}
            onPointerCancel={endResize}
            onKeyDown={keyResize}
            title="Drag to resize the column · arrow keys also work"
            className="group absolute inset-y-0 left-0 z-20 hidden w-2 cursor-col-resize outline-none lg:block"
          >
            <span
              className={`absolute inset-y-0 left-1/2 w-[2px] -translate-x-1/2 transition-colors ${
                resizing ? 'bg-accent' : 'bg-transparent group-hover:bg-accent group-focus-visible:bg-accent'
              }`}
              aria-hidden="true"
            />
          </div>

          <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto p-3.5">
            {/* ── the live preview ── */}
            <section className="flex flex-col gap-3.5 rounded-[16px] border border-line bg-surface p-4" aria-label="Live preview">
              <div className="flex flex-wrap items-center gap-2.5">
                <span className="h-[7px] w-[7px] rounded-full bg-good" aria-hidden="true" />
                <p className="mono text-[10.5px] tracking-[0.14em] text-ink-3">LIVE PREVIEW · FEED</p>
                {/* The crop the feed will show. The canvas is not changed, and
                    neither is the creative — it is fitted to the ratio whole,
                    never sliced to it. */}
                <div className="ml-auto flex overflow-hidden rounded-[9px] border border-line-strong" role="group" aria-label="Preview crop">
                  {PREVIEW_CROPS.map((option) => (
                    <button
                      key={option}
                      type="button"
                      onClick={() => setCropChoice(option)}
                      aria-pressed={crop === option}
                      className={`mono px-2.5 py-1 text-[10.5px] transition-colors ${
                        crop === option ? 'bg-magenta/16 text-ink' : 'text-ink-3 hover:text-ink'
                      }`}
                    >
                      {option}
                    </button>
                  ))}
                </div>
              </div>

              <PlatformPreview platform={idea.platform} body={body} media={asset?.dataUri ?? null} crop={crop} />

              {/* The creative's canvas and model are not printed here: the
                  picture above already shows what was rendered, and the model
                  is chosen a few lines down. A creative that FELL BACK still
                  says so — that is a fact about the image, not a caption. */}
              <div className="flex flex-wrap items-center gap-2">
                {asset?.fallbackReason ? (
                  <span title={asset.fallbackReason} className="mono inline-flex shrink-0 items-center gap-1.5 text-[10.5px] tracking-[0.08em] text-serious">
                    <span className="h-1 w-1 rounded-full bg-serious" aria-hidden="true" />
                    SVG FALLBACK
                  </span>
                ) : null}
                <button
                  type="button"
                  onClick={() => void regenerateImage(idea.id)}
                  className="ml-auto inline-flex shrink-0 items-center gap-1.5 rounded-[9px] border border-line-strong px-3 py-1.5 text-[11.5px] font-semibold text-ink transition-colors hover:border-accent"
                >
                  <RefreshCw size={11} aria-hidden="true" /> Regenerate
                </button>
              </div>
            </section>

            {/* ── the agent ── */}
            <section
              className="rounded-[17px] p-px"
              style={{
                background:
                  'linear-gradient(165deg, color-mix(in srgb, var(--color-magenta) 55%, transparent), color-mix(in srgb, var(--color-accent) 40%, transparent) 45%, var(--color-line))',
              }}
              aria-label={target === 'caption' ? 'SpongeBob, the content agent' : 'Minnie, the image agent'}
            >
              <div className="relative flex flex-col gap-3 overflow-hidden rounded-[16px] bg-surface p-3.5">
                <span
                  aria-hidden="true"
                  className="pointer-events-none absolute -left-16 -top-16 h-[200px] w-[200px] rounded-full"
                  style={{ background: 'radial-gradient(circle, var(--color-hud-glow), transparent 70%)' }}
                />

                <div className="relative flex items-center gap-2.5">
                  <span className="relative shrink-0">
                    <AssistantCore state={thinking ? 'thinking' : 'dormant'} size={34} />
                    <span className="absolute bottom-0 right-0 h-[9px] w-[9px] rounded-full border-2 border-surface bg-good" aria-hidden="true" />
                  </span>
                  <div className="flex min-w-0 flex-1 items-baseline gap-2">
                    <p className="shrink-0 text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                      {target === 'caption' ? 'SpongeBob' : 'Minnie'}
                    </p>
                    {/* The role, not the model. Which model wrote it is the
                        picker's business, a few lines down. */}
                    <span className="mono min-w-0 truncate text-[8.5px] font-semibold uppercase tracking-[0.12em] text-magenta-ink">
                      {target === 'caption' ? 'Content agent' : 'Image agent'}
                    </span>
                  </div>
                </div>

                {/* The latest step on the spine, in one line. The whole spine
                    is below, for anyone who wants to walk it. */}
                {spine.length > 0 ? (
                  <div className="relative flex items-center gap-2 text-[10.5px] text-ink-3">
                    <span className="mono shrink-0 rounded-[6px] border border-magenta/35 px-1.5 py-px text-[9.5px] font-semibold text-magenta-ink">
                      R{spine[spine.length - 1].revision}
                    </span>
                    <span className="min-w-0 truncate" title={spine[spine.length - 1].summary}>{spine[spine.length - 1].summary}</span>
                  </div>
                ) : null}

                <div className="relative flex overflow-hidden rounded-[10px] border border-line-strong" role="group" aria-label="What an instruction changes">
                  {(['caption', 'image'] as const).map((t) => (
                    <button
                      key={t}
                      type="button"
                      onClick={() => setTarget(t)}
                      aria-pressed={target === t}
                      className={`mono flex-1 px-3 py-[5px] text-center text-[9.5px] font-semibold uppercase tracking-[0.1em] transition-colors ${
                        target === t ? 'bg-magenta/16 text-ink' : 'text-ink-3 hover:text-ink'
                      }`}
                    >
                      {t}
                    </button>
                  ))}
                </div>

                <div className="relative flex flex-wrap gap-1.5">
                  {(target === 'caption' ? CAPTION_PROMPTS : IMAGE_ACTIONS).map((action) => (
                    <button
                      key={action.label}
                      type="button"
                      onClick={() => send(action.instruction)}
                      title={action.instruction}
                      className="rounded-full border border-line-strong px-2.5 py-1 text-[10.5px] text-ink-2 transition-colors hover:border-magenta/50 hover:text-magenta-ink"
                    >
                      {action.label}
                    </button>
                  ))}
                </div>

                {/* ── the revision spine, and the conversation around it ── */}
                {spine.length > 1 || bubbles.length > 0 || thinking || preference ? (
                  <div className="relative flex max-h-[300px] flex-col gap-3 overflow-y-auto border-t border-line pt-3.5">
                    {spine.map((rev, i) => (
                      <div key={rev.id} className="flex flex-col gap-2.5" style={{ animation: `eth-rise 340ms cubic-bezier(0.22, 1, 0.36, 1) ${i * 60}ms both` }}>
                        {rev.instruction ? (
                          <div className="flex justify-end">
                            <p className="max-w-[86%] rounded-[10px] rounded-br-[3px] border border-hud-strong bg-accent/12 px-2.5 py-1.5 text-[11.5px] leading-relaxed text-ink">
                              {rev.instruction}
                            </p>
                          </div>
                        ) : null}
                        <div className="flex gap-2.5">
                          <span className={`mono flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border text-[10.5px] ${
                            i === spine.length - 1 ? 'border-magenta/50 bg-magenta/10 text-magenta-ink' : 'border-line-strong text-ink-3'
                          }`}>
                            R{rev.revision}
                          </span>
                          <div className="min-w-0 flex-1">
                            <p className="text-[11.5px] leading-relaxed text-ink-2">{rev.summary}</p>
                            {rev.charDelta !== 0 || rev.paraDelta !== 0 ? (
                              <div className="mt-1.5 flex flex-wrap gap-1.5">
                                {rev.charDelta !== 0 ? (
                                  <span className={`mono rounded-[4px] border px-1.5 py-px text-[10.5px] tracking-[0.06em] ${
                                    rev.charDelta < 0 ? 'border-critical/50 text-critical-ink' : 'border-hud-strong text-accent-bright'
                                  }`}>
                                    {rev.charDelta > 0 ? '+' : ''}{rev.charDelta} CHARS
                                  </span>
                                ) : null}
                                {rev.paraDelta !== 0 ? (
                                  <span className="mono rounded-[4px] border border-line-strong px-1.5 py-px text-[10.5px] tracking-[0.06em] text-ink-3">
                                    {rev.paraDelta > 0 ? '+' : ''}{rev.paraDelta} PARA
                                  </span>
                                ) : null}
                                {i === spine.length - 1 ? (
                                  <span className="mono rounded-[4px] border border-line-strong px-1.5 py-px text-[10.5px] tracking-[0.06em] text-ink-3">CURRENT</span>
                                ) : null}
                              </div>
                            ) : null}
                            {rev.finding ? (
                              <div className="mt-2 border-l border-serious/60 pl-2.5">
                                <p className="mono text-[10.5px] tracking-[0.1em] text-serious">FINDING · RAISED, NOT RESOLVED</p>
                                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{rev.finding}</p>
                              </div>
                            ) : null}
                            {i < spine.length - 1 ? (
                              <button
                                type="button"
                                onClick={() => { setBody(rev.body); updateDraft(idea.id, rev.body); setRestorePoint(rev.id); setSavedAt(Date.now()) }}
                                className="mono mt-1 text-[11px] text-ink-3 transition-colors hover:text-accent-bright"
                              >
                                {restorePoint === rev.id ? 'RESTORED' : 'RESTORE'}
                              </button>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))}

                    {bubbles.filter((b) => b.speaker === 'assistant' && !spine.some((r) => r.summary === b.text)).map((bubble) => (
                      <div key={bubble.id} className="flex gap-2.5" style={{ animation: 'eth-rise 340ms cubic-bezier(0.22, 1, 0.36, 1) both' }}>
                        <span className="mono flex h-5 w-5 shrink-0 items-center justify-center rounded-[5px] border border-line-strong text-[10.5px] text-ink-3">IM</span>
                        <p className="min-w-0 flex-1 text-[11.5px] leading-relaxed text-ink-2">{bubble.text}</p>
                      </div>
                    ))}

                    {thinking ? (
                      <div className="flex gap-2.5">
                        <AssistantCore state="thinking" size={18} className="mt-0.5 shrink-0" />
                        <p className="text-[11.5px] text-ink-3">{thinking}</p>
                      </div>
                    ) : null}

                    {preference ? (
                      <div className="rounded-[9px] border border-hud-strong bg-accent/10 px-3 py-2.5" style={{ animation: 'eth-rise 340ms cubic-bezier(0.22, 1, 0.36, 1) both' }}>
                        <p className="text-[11.5px] font-semibold text-ink">Save this as a standing preference?</p>
                        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{preference.content}</p>
                        <div className="mt-2.5 flex gap-1.5">
                          <Btn variant="primary" onClick={() => { void addKnowledge({ ...preference, category: 'User Feedback' }); setPreference(null) }}>
                            Save to Knowledge Base
                          </Btn>
                          <Btn variant="ghost" onClick={() => setPreference(null)}>Just this post</Btn>
                        </div>
                      </div>
                    ) : null}
                  </div>
                ) : null}

                {/* ── the instruction ── */}
                <div className="relative border-t border-line pt-3">
                  {references.length > 0 ? (
                    <ul className="mb-2 flex flex-wrap gap-1.5" aria-label="Attached references">
                      {references.map((reference) => (
                        <li key={reference.id} className="flex max-w-full items-center gap-1.5 rounded-lg border border-line-strong bg-surface-2 px-2 py-1">
                          {reference.dataUri ? (
                            <img src={reference.dataUri} alt="" className="h-5 w-5 rounded object-cover" />
                          ) : (
                            <FileText size={12} className="shrink-0 text-ink-3" aria-hidden="true" />
                          )}
                          <span className="min-w-0">
                            <span className="block truncate text-[11px] text-ink-2">{reference.name}</span>
                            {reference.unreadableReason ? (
                              <span className="block text-[10px] text-warn">Attached by name only — {reference.unreadableReason}.</span>
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

                  <form onSubmit={(event) => { event.preventDefault(); send(chatValue) }} className="flex items-center gap-2">
                    <label
                      title="Attach a reference file for the model"
                      className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center rounded-[10px] border border-line-strong text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                    >
                      <Paperclip size={13} aria-hidden="true" />
                      <span className="sr-only">Attach a reference file</span>
                      <input
                        type="file"
                        multiple
                        accept="image/*,text/*,.md,.txt,.csv,.json,.yml,.yaml"
                        className="hidden"
                        onChange={(event) => { void attach(event.target.files); event.target.value = '' }}
                      />
                    </label>
                    <input
                      value={chatValue}
                      onChange={(event) => setChatValue(event.target.value)}
                      placeholder={target === 'caption' ? 'Tell SpongeBob what to change…' : 'Tell Minnie what to change…'}
                      aria-label="Instruction"
                      className="h-9 min-w-0 flex-1 rounded-[11px] border border-line-strong bg-surface-2 px-3 text-[12px] text-ink outline-none transition-colors focus:border-accent"
                    />
                    {/*
                      THE MODEL SITS BESIDE THE SEND BUTTON, NOT UNDER THE FORM.

                      It used to be a full-width block below the composer, which
                      put the choice of writer a whole row away from the action it
                      governs — an operator typed an instruction, pressed send, and
                      only then noticed which model would answer. Inline and
                      immediately before the button, it reads as part of the same
                      decision: what to ask, who answers, go.

                      Fixed width and `shrink-0` so the instruction field keeps the
                      remaining space, and the menu still opens upward from
                      `bottom-full` so it never covers the composer.
                    */}
                    <div className="w-[176px] shrink-0">
                      {target === 'caption' ? (
                        <ModelMenu target="caption" selected={settings.captionModel} onSelect={(modelId) => updateSettings({ captionModel: modelId })} />
                      ) : (
                        <ModelMenu
                          target="image"
                          selected={settings.imageModel}
                          onSelect={(modelId) => { updateSettings({ imageModel: modelId }); void regenerateImage(idea.id, idea.platform, modelId) }}
                        />
                      )}
                    </div>
                    <button
                      type="submit"
                      disabled={chatValue.trim().length === 0}
                      aria-label="Send the instruction"
                      className="flex h-9 w-9 shrink-0 items-center justify-center rounded-[10px] border border-transparent bg-[linear-gradient(135deg,var(--color-magenta),var(--color-accent))] text-on-accent transition-[filter,opacity] hover:brightness-110 disabled:opacity-40"
                    >
                      <ArrowRight size={14} aria-hidden="true" />
                    </button>
                  </form>

                  {attaching ? <p className="mt-1 text-[10.5px] text-ink-3">Reading the attachment…</p> : null}

                  <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                    Either outcome is written to the Knowledge Base, so the agents learn from it.
                  </p>
                </div>
              </div>
            </section>
          </div>
        </aside>
      </div>

      {/* ── Rejection, with its reason ───────────────────────────────── */}
      {rejecting ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-page/85 p-6 backdrop-blur-md">
          <form
            className="anim-dialog-in card w-full max-w-lg overflow-hidden"
            onSubmit={(event) => {
              event.preventDefault()
              const reason = rejectReason.trim()
              if (reason.length === 0) return
              setRejecting(false)
              // Leadership rejection is the one path that records a reason on
              // the decision itself. Before that stage the idea is withdrawn,
              // which keeps its lineage — nothing is ever deleted.
              if (idea.status === 'pending_leadership') void leadershipReject(idea.id, reason)
              else void deleteIdea(idea.id)
            }}
          >
            <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
              <h3 className="text-[13.5px] font-semibold tracking-[-0.01em] text-ink">
                {idea.status === 'pending_leadership' ? 'Reject this draft?' : 'Withdraw this draft?'}
              </h3>
              <button
                type="button"
                onClick={() => setRejecting(false)}
                aria-label="Cancel"
                className="rounded-md p-1 text-ink-3 transition-colors hover:text-ink"
              >
                <X size={15} />
              </button>
            </header>

            <div className="p-4">
              <p className="text-[11.5px] leading-relaxed text-ink-3">
                {idea.status === 'pending_leadership'
                  ? 'The reason is written back to the Knowledge Base, and it is what the agents learn from. Nothing is deleted — the draft keeps its history.'
                  : 'The draft is withdrawn rather than deleted, so its lineage stays reconstructable. Say why, so the next draft is better.'}
              </p>
              <label className="mt-3 block">
                <span className="mono text-[10.5px] uppercase tracking-[0.12em] text-ink-3">Reason</span>
                <textarea
                  value={rejectReason}
                  onChange={(event) => setRejectReason(event.target.value)}
                  rows={3}
                  autoFocus
                  placeholder="What is wrong with it, in your own words…"
                  className="mt-1.5 w-full resize-none rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[12px] leading-relaxed text-ink outline-none transition-colors focus:border-accent"
                />
              </label>
            </div>

            <footer className="flex items-center justify-end gap-2 border-t border-line px-4 py-3">
              <Btn variant="ghost" type="button" onClick={() => setRejecting(false)}>
                Cancel
              </Btn>
              <Btn variant="primary" type="submit" disabled={rejectReason.trim().length === 0}>
                <X size={12} /> {idea.status === 'pending_leadership' ? 'Reject' : 'Withdraw'}
              </Btn>
            </footer>
          </form>
        </div>
      ) : null}

      {/* ── Publish confirmation ─────────────────────────────────────── */}
      {confirmPublish ? (
        <div className="absolute inset-0 z-20 flex items-center justify-center bg-page/85 p-4 backdrop-blur-md sm:p-6">
          {/*
            A COLUMN THAT OWNS ITS HEIGHT.
            The dialog is capped against the viewport and lays out as a column, so
            the header and footer keep their natural height and the preview takes
            whatever is left. The previous fixed `max-h-[52vh]` on the body alone
            clipped a long caption while leaving empty space below the dialog —
            the operator was asked to approve a post they could not finish reading.
          */}
          <div className="anim-dialog-in card flex max-h-[90vh] w-full max-w-2xl flex-col overflow-hidden">
            <header className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-4 py-3">
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

            {/*
              `min-h-0` is what makes the scroll work: a flex child defaults to
              min-height:auto and refuses to shrink below its content, so without
              it the body pushes the footer off-screen instead of scrolling.
              `overscroll-contain` stops a scroll that reaches the end from
              chaining to the page behind the dialog.
            */}
            <div
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain p-4"
              tabIndex={0}
              role="region"
              aria-label={`${PLATFORM_LABEL[idea.platform]} post preview`}
            >
              <div className="mb-3 flex flex-wrap items-center gap-2">
                <PlatformChip platform={idea.platform} />
                <Badge tone="neutral">
                  {new Date(idea.scheduled_date).toLocaleDateString('en-GB', { day: 'numeric', month: 'short' })} ·{' '}
                  {idea.scheduled_time}
                </Badge>
                {/* Conditional, not decorative. This badge was hardcoded and kept
                    claiming demo mode after the deployment had been switched to
                    live — the one label on this screen that must never be wrong,
                    because it is what tells the operator whether the next click
                    is reversible. */}
                {canPublish ? (
                  <Badge tone="good">Live — this will publish for real</Badge>
                ) : (
                  <Badge tone="warn">Demo mode — publishing is simulated</Badge>
                )}
              </div>
              <PlatformPreview platform={idea.platform} body={body} media={asset?.dataUri ?? null} />
            </div>

            {/* The footer states what the button will do; the server refuses
                independently, so a stale client cannot publish by accident. */}
            <footer className="flex shrink-0 flex-wrap items-center justify-end gap-2 border-t border-line px-4 py-3">
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
                  // A post already signed off by leadership just publishes.
                  // Leadership publishing one that has NOT been signed off yet
                  // records their final approval and publishes in one step.
                  if (idea.status === 'approved') void publishIdea(idea.id)
                  else if (isLeadership) void leadershipPublish(idea.id)
                  else void publishIdea(idea.id)
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



/**
 * The decision, in the header.
 *
 * It used to sit at the bottom of the instruction column, below a scrolling
 * chat — on the one screen whose purpose is to make this decision. Here it is
 * always reachable, and the publish phases replace it in place while a
 * dispatch is running.
 */
function HeaderDecision({
  status,
  isLeadership,
  approvedBy,
  publishPhase,
  onApprove,
  onLeadershipPublish,
  onPublish,
  onReject,
}: {
  status: string
  isLeadership: boolean
  approvedBy: string | null
  publishPhase: string | null
  onApprove: () => void
  onLeadershipPublish: () => void
  onPublish: () => void
  onReject: () => void
}) {
  if (publishPhase) {
    return (
      <span className="mono inline-flex items-center gap-2 rounded-md border border-hud-strong bg-accent/10 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-accent-bright">
        <span
          className="h-3 w-3 rounded-full border-2 border-accent border-t-transparent"
          style={{ animation: 'ring-spin 1.4s linear infinite' }}
          aria-hidden="true"
        />
        {publishPhase}
      </span>
    )
  }

  if (status === 'rejected') {
    return <span className="mono rounded-md border border-critical/50 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-critical-ink">Rejected</span>
  }

  if (status === 'published') {
    return <span className="mono rounded-md border border-good/50 px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-good-ink">Published</span>
  }

  /*
   * LEADERSHIP PUBLISHES DIRECTLY.
   *
   * Leadership is the final sign-off, so on any draft that has not published
   * yet they get one action — Publish now — rather than the marketing hop of
   * "Approve → Leadership" or the intermediate "Give final approval". The
   * store's leadershipPublish records their approval and dispatches in the
   * same step, and the confirmation dialog still stands between the click and
   * a live post.
   */
  if (isLeadership) {
    return (
      <>
        <RejectButton onReject={onReject} />
        <Btn variant="primary" onClick={status === 'approved' ? onPublish : onLeadershipPublish} className="!py-1.5 !text-[12px]">
          <Send size={12} /> Publish now
        </Btn>
      </>
    )
  }

  if (status === 'approved') {
    return (
      <Btn variant="primary" onClick={onPublish} className="!py-1.5 !text-[12px]">
        <Send size={12} /> Publish now
      </Btn>
    )
  }

  if (status === 'pending_leadership') {
    return (
      <span className="mono max-w-[240px] truncate rounded-md border border-line-strong px-2.5 py-1.5 text-[10px] uppercase tracking-[0.08em] text-ink-3">
        With Leadership · approved by {approvedBy ?? 'Marketing'}
      </span>
    )
  }

  return (
    <>
      <RejectButton onReject={onReject} />
      <Btn variant="primary" onClick={onApprove} className="!py-1.5 !text-[12px]">
        <Check size={12} strokeWidth={2.4} /> Approve → Leadership
      </Btn>
    </>
  )
}

/**
 * Reject, with the reason it cannot go without.
 *
 * A rejection with no reason teaches the agents nothing, which is why the
 * store refuses one. So the reason is asked for here rather than after the
 * fact — the button opens the field, and only a filled field can submit.
 */
function RejectButton({ onReject }: { onReject: () => void }) {
  return (
    <Btn variant="ghost" onClick={onReject} className="!py-1.5 !text-[12px]">
      <X size={12} /> Reject
    </Btn>
  )
}

/** Two scored bars, filling from the left. */
function ScoreBar({ label, value, delay }: { label: string; value: number; delay: number }) {
  return (
    <div className="flex-1">
      <div className="flex items-baseline justify-between">
        <span className="mono text-[10.5px] tracking-[0.1em] text-ink-3">{label}</span>
        <span className="mono text-[11px] text-ink">{value || '—'}</span>
      </div>
      <span className="mt-1 block h-[3px] overflow-hidden rounded-[2px] bg-surface-3">
        <span
          className="block h-full bg-accent"
          style={{ width: `${Math.max(0, Math.min(100, value))}%`, transformOrigin: 'left', animation: `eth-seg 620ms cubic-bezier(0.16, 1, 0.3, 1) ${delay}ms both` }}
        />
      </span>
    </div>
  )
}

/**
 * What each revision changed, as a list rather than a character diff.
 *
 * A real inline diff needs the before and after text aligned token by token;
 * what is shown here is what was measured — the instruction, the counted
 * deltas, and the agent's own account. Claiming more than that would be a
 * picture of a diff rather than one.
 */
function DiffView({ spine }: { spine: Revision[] }) {
  if (spine.length <= 1) {
    return (
      <p className="mt-3 text-[11.5px] leading-relaxed text-ink-3">
        Only the first draft exists, so there is nothing to compare. Ask for a change and each
        revision will be listed here with what it altered.
      </p>
    )
  }
  return (
    <div className="mt-3 flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto">
      {spine.slice(1).map((rev) => (
        <div key={rev.id} className="rounded-lg border border-line-strong bg-surface px-3 py-2.5">
          <div className="flex items-center gap-2">
            <span className="mono text-[10.5px] tracking-[0.12em] text-accent-bright">R{rev.revision}</span>
            <span className="mono ml-auto text-[11px] text-ink-3">
              {rev.charDelta > 0 ? '+' : ''}{rev.charDelta} chars
              {rev.paraDelta !== 0 ? ` · ${rev.paraDelta > 0 ? '+' : ''}${rev.paraDelta} para` : ''}
            </span>
          </div>
          {rev.instruction ? <p className="mt-1.5 text-[12px] font-medium text-ink">“{rev.instruction}”</p> : null}
          <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">{rev.summary}</p>
        </div>
      ))}
    </div>
  )
}

/** Kept for the drawer's relative timestamps. */
export { timeAgo }

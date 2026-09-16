/**
 * PLATFORM PREVIEWS
 *
 * Pixel-faithful mini mockups driven by the live caption text and the rendered
 * media. Used in the review panel, the leadership queue and the publish
 * confirmation — so what Leadership approves is what the audience sees.
 *
 * Two rules keep these honest:
 *
 * 1. They fold the caption where the platform folds it. A 2,000-character
 *    draft is not what the feed shows; the feed shows the first few lines and
 *    a "…more". The fold is a button, so a reviewer can open it the way a
 *    reader would.
 * 2. They carry no engagement figures. A draft has never been published, so
 *    there is nothing to count — and a mock "312 likes" is exactly the kind
 *    of invented evidence this product does not show.
 *
 * The hex values are the platforms' own (LinkedIn blue, X black) rather than
 * our tokens, because these are pictures of someone else's surface.
 */

import { useState } from 'react'
import { Bookmark, Heart, MessageCircle, Repeat2, Send, Share2, ThumbsUp, MoreHorizontal, ChevronRight, Globe } from 'lucide-react'
import { gradientPlaceholder } from '../lib/image-gen'
import { Logo } from './logo'
import type { Platform } from '../types'

/** The crop the feed shows the creative in. The canvas itself is not changed. */
export type PreviewCrop = '1.91:1' | '1:1' | '4:5'
export const PREVIEW_CROPS: PreviewCrop[] = ['1.91:1', '1:1', '4:5']
const CROP_RATIO: Record<PreviewCrop, string> = { '1.91:1': '1.91 / 1', '1:1': '1 / 1', '4:5': '4 / 5' }
/** What each platform's feed crops to when nothing is chosen. */
export const DEFAULT_CROP: Record<Platform, PreviewCrop> = {
  linkedin: '1.91:1',
  facebook: '1.91:1',
  instagram: '4:5',
  x: '1.91:1',
}

/** Where each feed folds a caption, in characters, before "…more". */
const FOLD_AT: Record<Platform, number> = { linkedin: 210, facebook: 400, instagram: 125, x: 280 }

/** Splits a caption so hashtags can be tinted the way each platform tints them. */
function withTintedTags(text: string, tint: string) {
  return text.split(/(\s+)/).map((token, i) =>
    token.startsWith('#') ? (
      <span key={i} style={{ color: tint }}>
        {token}
      </span>
    ) : (
      <span key={i}>{token}</span>
    ),
  )
}

/** Cuts at the last whitespace before the limit, so a word is never split. */
function foldAt(text: string, limit: number): { shown: string; folded: boolean } {
  if (text.length <= limit) return { shown: text, folded: false }
  const cut = text.lastIndexOf(' ', limit)
  return { shown: text.slice(0, cut > limit * 0.6 ? cut : limit).trimEnd(), folded: true }
}

/**
 * The caption as the feed shows it: folded, with the platform's own word for
 * opening it. Opening is a real toggle, so a reviewer can read the whole
 * thing and then see the fold again.
 */
function FoldedCaption({
  body,
  platform,
  tint,
  more,
  className,
}: {
  body: string
  platform: Platform
  tint: string
  more: string
  className: string
}) {
  const [open, setOpen] = useState(false)
  const { shown, folded } = foldAt(body, FOLD_AT[platform])
  const text = open || !folded ? body : shown
  return (
    <p className={`whitespace-pre-wrap ${className}`}>
      {withTintedTags(text, tint)}
      {folded ? (
        <>
          {open ? ' ' : '… '}
          <button
            type="button"
            onClick={() => setOpen(!open)}
            className="font-medium opacity-70 transition-opacity hover:opacity-100"
            style={{ color: 'inherit' }}
          >
            {open ? 'less' : more}
          </button>
        </>
      ) : null}
    </p>
  )
}

/*
 * The creative, shown whole inside the crop the feed uses.
 *
 * `object-fit: cover` filled the frame by cutting the picture down to it, so
 * switching 1.91:1 → 4:5 sliced the sides off and the person editing could no
 * longer see what they were approving. The frame still holds the feed's real
 * ratio — that is the point of the control — but the image is CONTAINED in it,
 * so the whole creative stays on screen and reshapes itself as the ratio
 * changes. What is left over is filled by a blurred, scaled copy of the same
 * image (the way the feeds themselves letterbox), so a contained picture reads
 * as a deliberate frame rather than two empty bars.
 */
function Media({
  platform,
  media,
  seed,
  crop,
  className = '',
}: {
  platform: Platform
  media?: string | null
  seed: string
  crop: PreviewCrop
  className?: string
}) {
  const src = media ?? gradientPlaceholder(platform, seed)
  return (
    <div
      className={`relative w-full overflow-hidden bg-[#0d0b18] ${className}`}
      style={{ aspectRatio: CROP_RATIO[crop] }}
    >
      <img
        src={src}
        alt=""
        aria-hidden="true"
        className="absolute inset-0 h-full w-full scale-110 object-cover blur-2xl"
      />
      <img
        src={src}
        alt=""
        aria-hidden={media ? undefined : true}
        className="absolute inset-0 h-full w-full object-contain"
      />
    </div>
  )
}

export function GradientMedia({ platform, seed, className = '' }: { platform: Platform; seed: string; className?: string }) {
  return <img src={gradientPlaceholder(platform, seed)} alt="" aria-hidden="true" className={`w-full object-cover ${className}`} />
}

interface PreviewProps {
  body: string
  media?: string | null
  crop?: PreviewCrop
}

/* ═══════════════════════════════════════════════════════════════════════════
   LINKEDIN
   ═══════════════════════════════════════════════════════════════════════════ */

export function LinkedInPreview({ body, media, crop = DEFAULT_CROP.linkedin }: PreviewProps) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-white text-[#1b1930] shadow-sm">
      <header className="flex items-start gap-2.5 px-3.5 pt-3.5">
        <Logo size={44} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">Ethara AI</p>
          <p className="truncate text-[11px] leading-tight text-[#5c5a70]">Reinforcement Learning as a Service</p>
          <p className="flex items-center gap-1 text-[11px] leading-tight text-[#5c5a70]">
            Now · <Globe size={10} aria-label="Anyone" />
          </p>
        </div>
        <MoreHorizontal size={16} className="shrink-0 text-[#5c5a70]" aria-hidden="true" />
      </header>

      <FoldedCaption body={body} platform="linkedin" tint="#0a66c2" more="more" className="px-3.5 py-3 text-[13px] leading-relaxed" />

      <Media platform="linkedin" media={media} seed={body.slice(0, 24)} crop={crop} />

      <div className="grid grid-cols-4 border-t border-[#e6e6ec] text-[11px] font-medium text-[#5c5a70]">
        {[
          { label: 'Like', icon: ThumbsUp },
          { label: 'Comment', icon: MessageCircle },
          { label: 'Repost', icon: Repeat2 },
          { label: 'Send', icon: Send },
        ].map((action) => (
          <span key={action.label} className="flex items-center justify-center gap-1.5 py-2">
            <action.icon size={14} aria-hidden="true" />
            {action.label}
          </span>
        ))}
      </div>
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   INSTAGRAM
   ═══════════════════════════════════════════════════════════════════════════ */

export function InstagramPreview({ body, media, crop = DEFAULT_CROP.instagram }: PreviewProps) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-white text-[#1b1930] shadow-sm">
      <header className="flex items-center gap-2.5 px-3 py-2.5">
        <span
          className="flex h-8 w-8 items-center justify-center rounded-full p-[2px]"
          style={{ background: 'linear-gradient(45deg, #f09433, #dc2743, #bc1888)' }}
        >
          <Logo size={28} />
        </span>
        <p className="text-[12px] font-semibold">ethara.ai</p>
        <MoreHorizontal size={15} className="ml-auto text-[#5c5a70]" aria-hidden="true" />
      </header>

      <div className="relative">
        <Media platform="instagram" media={media} seed={body.slice(0, 24)} crop={crop} />
        <span className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white">
          <ChevronRight size={14} aria-hidden="true" />
        </span>
        <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
          {[0, 1, 2, 3, 4].map((dot) => (
            <span key={dot} className="h-1.5 w-1.5 rounded-full" style={{ background: dot === 0 ? '#ffffff' : 'rgba(255,255,255,0.45)' }} />
          ))}
        </span>
      </div>

      <div className="flex items-center gap-3.5 px-3 pt-2.5 text-[#1b1930]">
        <Heart size={19} aria-hidden="true" />
        <MessageCircle size={19} aria-hidden="true" />
        <Send size={19} aria-hidden="true" />
        <Bookmark size={19} className="ml-auto" aria-hidden="true" />
      </div>

      <div className="px-3 pb-3 pt-2 text-[12px] leading-relaxed">
        <span className="font-semibold">ethara.ai </span>
        <FoldedCaption body={body} platform="instagram" tint="#00376b" more="more" className="inline" />
      </div>
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   X
   ═══════════════════════════════════════════════════════════════════════════ */

export function XPreview({ body, media, crop = DEFAULT_CROP.x }: PreviewProps) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-black text-white shadow-sm">
      <div className="flex gap-2.5 p-3.5">
        <Logo size={40} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1 text-[13px] leading-tight">
            <span className="font-semibold">Ethara AI</span>
            <svg width={13} height={13} viewBox="0 0 24 24" fill="#1d9bf0" aria-hidden="true">
              <path d="M22.25 12c0-1.43-.88-2.67-2.19-3.34.46-1.39.2-2.9-.81-3.91s-2.52-1.27-3.91-.81C14.67 2.63 13.43 1.75 12 1.75s-2.67.88-3.34 2.19c-1.39-.46-2.9-.2-3.91.81s-1.27 2.52-.81 3.91C2.63 9.33 1.75 10.57 1.75 12s.88 2.67 2.19 3.34c-.46 1.39-.2 2.9.81 3.91s2.52 1.27 3.91.81c.67 1.31 1.91 2.19 3.34 2.19s2.67-.88 3.34-2.19c1.39.46 2.9.2 3.91-.81s1.27-2.52.81-3.91c1.31-.67 2.19-1.91 2.19-3.34zm-11.71 4.2L6.8 12.46l1.41-1.42 2.26 2.26 4.8-5.23 1.47 1.36-6.2 6.77z" />
            </svg>
            <span className="text-[12px] text-[#71767b]">@ethara_ai · now</span>
          </p>
          <FoldedCaption body={body} platform="x" tint="#1d9bf0" more="Show more" className="mt-1 text-[13px] leading-relaxed" />

          {media ? (
            <Media platform="x" media={media} seed={body.slice(0, 24)} crop={crop} className="mt-2.5 rounded-xl border border-[#2f3336]" />
          ) : null}

          <div className="mt-2.5 flex items-center justify-between pr-6 text-[#71767b]">
            <MessageCircle size={14} aria-hidden="true" />
            <Repeat2 size={14} aria-hidden="true" />
            <Heart size={14} aria-hidden="true" />
            <Share2 size={14} aria-hidden="true" />
          </div>
        </div>
      </div>
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   FACEBOOK
   ═══════════════════════════════════════════════════════════════════════════ */

export function FacebookPreview({ body, media, crop = DEFAULT_CROP.facebook }: PreviewProps) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-white text-[#1b1930] shadow-sm">
      <header className="flex items-start gap-2.5 px-3.5 pt-3.5">
        <Logo size={40} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">Ethara AI</p>
          <p className="flex items-center gap-1 text-[11px] leading-tight text-[#5c5a70]">
            Just now · <Globe size={10} aria-label="Public post" />
          </p>
        </div>
        <MoreHorizontal size={16} className="shrink-0 text-[#5c5a70]" aria-hidden="true" />
      </header>

      <FoldedCaption body={body} platform="facebook" tint="#1877f2" more="See more" className="px-3.5 py-3 text-[13px] leading-relaxed" />

      <Media platform="facebook" media={media} seed={body.slice(0, 24)} crop={crop} />

      <div className="grid grid-cols-3 border-t border-[#e6e6ec] text-[11px] font-medium text-[#5c5a70]">
        {[
          { label: 'Like', icon: ThumbsUp },
          { label: 'Comment', icon: MessageCircle },
          { label: 'Share', icon: Share2 },
        ].map((action) => (
          <span key={action.label} className="flex items-center justify-center gap-1.5 py-2">
            <action.icon size={14} aria-hidden="true" />
            {action.label}
          </span>
        ))}
      </div>
    </article>
  )
}

/** Renders the preview for whichever platform an idea targets. */
export function PlatformPreview({ platform, body, media, crop }: { platform: Platform } & PreviewProps) {
  if (platform === 'instagram') return <InstagramPreview body={body} media={media} crop={crop} />
  if (platform === 'x') return <XPreview body={body} media={media} crop={crop} />
  if (platform === 'facebook') return <FacebookPreview body={body} media={media} crop={crop} />
  return <LinkedInPreview body={body} media={media} crop={crop} />
}

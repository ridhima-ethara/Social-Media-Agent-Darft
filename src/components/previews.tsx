/**
 * PLATFORM PREVIEWS
 *
 * Pixel-faithful mini mockups driven by the live caption text and the rendered
 * media. Used in the review panel, the leadership queue and the publish
 * confirmation — so what Leadership approves is what the audience sees.
 */

import { Bookmark, Heart, MessageCircle, Repeat2, Send, Share2, ThumbsUp, MoreHorizontal, ChevronRight } from 'lucide-react'
import { gradientPlaceholder } from '../lib/image-gen'
import { fmt } from './ui'
import { Logo } from './logo'
import type { Platform } from '../types'

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

export function GradientMedia({
  platform,
  seed,
  className = '',
}: {
  platform: Platform
  seed: string
  className?: string
}) {
  return (
    <img
      src={gradientPlaceholder(platform, seed)}
      alt=""
      aria-hidden="true"
      className={`w-full object-cover ${className}`}
    />
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   LINKEDIN
   ═══════════════════════════════════════════════════════════════════════════ */

export function LinkedInPreview({ body, media }: { body: string; media?: string | null }) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-white text-[#1b1930] shadow-sm">
      <header className="flex items-start gap-2.5 px-3.5 pt-3.5">
        <Logo size={44} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">Ethara AI</p>
          <p className="truncate text-[11px] leading-tight text-[#5c5a70]">
            Reinforcement Learning as a Service · 14,807 followers
          </p>
          <p className="text-[11px] leading-tight text-[#5c5a70]">Just now · 🌐</p>
        </div>
        <MoreHorizontal size={16} className="shrink-0 text-[#5c5a70]" aria-hidden="true" />
      </header>

      <p className="whitespace-pre-wrap px-3.5 py-3 text-[13px] leading-relaxed">
        {withTintedTags(body, '#0a66c2')}
      </p>

      {media ? (
        <img src={media} alt="" className="w-full" style={{ aspectRatio: '1200 / 627', objectFit: 'cover' }} />
      ) : (
        <GradientMedia platform="linkedin" seed={body.slice(0, 24)} />
      )}

      <div className="flex items-center gap-1.5 px-3.5 py-2 text-[11px] text-[#5c5a70]">
        <span className="flex -space-x-1">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#0a66c2] text-white">
            <ThumbsUp size={9} fill="currentColor" />
          </span>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#c0392b] text-white">
            <Heart size={9} fill="currentColor" />
          </span>
        </span>
        <span className="tabular">312</span>
        <span className="ml-auto tabular">28 comments · 41 reposts</span>
      </div>

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

export function InstagramPreview({ body, media }: { body: string; media?: string | null }) {
  const caption = body.length > 220 ? `${body.slice(0, 220)}… more` : body

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
        {media ? (
          <img src={media} alt="" className="w-full" style={{ aspectRatio: '4 / 5', objectFit: 'cover' }} />
        ) : (
          <GradientMedia platform="instagram" seed={body.slice(0, 24)} />
        )}
        <span className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-full bg-black/45 text-white">
          <ChevronRight size={14} aria-hidden="true" />
        </span>
        <span className="absolute bottom-2 left-1/2 flex -translate-x-1/2 gap-1">
          {[0, 1, 2, 3, 4].map((dot) => (
            <span
              key={dot}
              className="h-1.5 w-1.5 rounded-full"
              style={{ background: dot === 0 ? '#ffffff' : 'rgba(255,255,255,0.45)' }}
            />
          ))}
        </span>
      </div>

      <div className="flex items-center gap-3.5 px-3 pt-2.5 text-[#1b1930]">
        <Heart size={19} aria-hidden="true" />
        <MessageCircle size={19} aria-hidden="true" />
        <Send size={19} aria-hidden="true" />
        <Bookmark size={19} className="ml-auto" aria-hidden="true" />
      </div>

      <p className="tabular px-3 pt-2 text-[12px] font-semibold">312 likes</p>
      <p className="whitespace-pre-wrap px-3 pb-3 pt-1 text-[12px] leading-relaxed">
        <span className="font-semibold">ethara.ai </span>
        {withTintedTags(caption, '#00376b')}
      </p>
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   X
   ═══════════════════════════════════════════════════════════════════════════ */

export function XPreview({ body, media }: { body: string; media?: string | null }) {
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
          <p className="mt-1 whitespace-pre-wrap text-[13px] leading-relaxed">
            {withTintedTags(body, '#1d9bf0')}
          </p>

          {media ? (
            <img
              src={media}
              alt=""
              className="mt-2.5 w-full rounded-xl border border-[#2f3336]"
              style={{ aspectRatio: '16 / 9', objectFit: 'cover' }}
            />
          ) : null}

          <div className="mt-2.5 flex items-center justify-between pr-6 text-[11px] text-[#71767b]">
            <span className="flex items-center gap-1.5">
              <MessageCircle size={14} aria-hidden="true" />
              <span className="tabular">19</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Repeat2 size={14} aria-hidden="true" />
              <span className="tabular">78</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Heart size={14} aria-hidden="true" />
              <span className="tabular">224</span>
            </span>
            <span className="flex items-center gap-1.5">
              <Share2 size={14} aria-hidden="true" />
              <span className="tabular">{fmt(5_640)}</span>
            </span>
          </div>
        </div>
      </div>
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   FACEBOOK
   ═══════════════════════════════════════════════════════════════════════════ */

export function FacebookPreview({ body, media }: { body: string; media?: string | null }) {
  return (
    <article className="overflow-hidden rounded-xl border border-line bg-white text-[#1b1930] shadow-sm">
      <header className="flex items-start gap-2.5 px-3.5 pt-3.5">
        <Logo size={40} className="shrink-0" />
        <div className="min-w-0 flex-1">
          <p className="text-[13px] font-semibold leading-tight">Ethara AI</p>
          <p className="text-[11px] leading-tight text-[#5c5a70]">Just now · 🌐</p>
        </div>
        <MoreHorizontal size={16} className="shrink-0 text-[#5c5a70]" aria-hidden="true" />
      </header>

      <p className="whitespace-pre-wrap px-3.5 py-3 text-[13px] leading-relaxed">
        {withTintedTags(body, '#1877f2')}
      </p>

      {media ? (
        <img src={media} alt="" className="w-full" style={{ aspectRatio: '1200 / 630', objectFit: 'cover' }} />
      ) : (
        <GradientMedia platform="facebook" seed={body.slice(0, 24)} />
      )}

      <div className="flex items-center gap-1.5 px-3.5 py-2 text-[11px] text-[#5c5a70]">
        <span className="flex -space-x-1">
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#1877f2] text-white">
            <ThumbsUp size={9} fill="currentColor" />
          </span>
          <span className="flex h-4 w-4 items-center justify-center rounded-full bg-[#f33e58] text-white">
            <Heart size={9} fill="currentColor" />
          </span>
        </span>
        <span className="tabular">184</span>
        <span className="ml-auto tabular">21 comments · 9 shares</span>
      </div>

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
export function PlatformPreview({
  platform,
  body,
  media,
}: {
  platform: Platform
  body: string
  media?: string | null
}) {
  if (platform === 'instagram') return <InstagramPreview body={body} media={media} />
  if (platform === 'x') return <XPreview body={body} media={media} />
  if (platform === 'facebook') return <FacebookPreview body={body} media={media} />
  return <LinkedInPreview body={body} media={media} />
}

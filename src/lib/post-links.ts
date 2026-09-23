/**
 * WHERE EACH PUBLISHED POST LIVES ON ITS PLATFORM.
 *
 * Buffer's receipt is its own id; the platform permalink appears on Buffer's
 * post record once the platform has accepted the post, and `GET
 * /posts/:id/link` asks for it. Screens that show published posts use this hook
 * so every platform label can be a real link — fetched when the post comes into
 * view, not on click, because an address fetched after a click has to be opened
 * by script, which browsers block as a pop-up.
 *
 * Each answer is kept per post for the life of the screen, so nothing is asked
 * twice. A demo post, or one the platform has not returned a link for, has
 * `url: null`, and the caller leaves its label plain rather than pointing
 * somewhere invented.
 */

import { useEffect, useState } from 'react'
import { api } from './api'
import { useStore } from '../store'
import type { PublishedPost } from '../types'

export interface PostLink {
  url: string | null
  reason: string | null
  loading: boolean
}

const NONE: PostLink = { url: null, reason: null, loading: false }

export function usePostLinks(posts: ReadonlyArray<PublishedPost | null | undefined>): (post: PublishedPost | null | undefined) => PostLink {
  const apiMode = useStore((s) => s.apiMode)
  const [links, setLinks] = useState<Record<string, { url: string | null; reason: string | null }>>({})

  const hasPage = (post: PublishedPost): boolean =>
    post.publish_mode === 'live' && Boolean(post.external_id) && apiMode === 'connected'

  const wantedKey = [
    ...new Set(
      posts
        .filter((post): post is PublishedPost => Boolean(post) && hasPage(post as PublishedPost))
        .filter((post) => links[post.id] === undefined)
        .map((post) => post.id),
    ),
  ].join(',')

  useEffect(() => {
    if (wantedKey === '') return
    let cancelled = false
    for (const id of wantedKey.split(',')) {
      api
        .postLink(id)
        .then((answer) => {
          if (!cancelled) setLinks((prev) => ({ ...prev, [id]: { url: answer.url, reason: answer.reason } }))
        })
        .catch((error: unknown) => {
          const reason = error instanceof Error ? error.message : 'The link could not be fetched.'
          if (!cancelled) setLinks((prev) => ({ ...prev, [id]: { url: null, reason } }))
        })
    }
    return () => {
      cancelled = true
    }
  }, [wantedKey])

  return (post) => {
    if (!post) return NONE
    const known = links[post.id]
    return {
      url: known?.url ?? null,
      reason: known?.reason ?? null,
      loading: hasPage(post) && known === undefined,
    }
  }
}

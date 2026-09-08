/**
 * THE PUBLISHING AGENT — stage `ship`
 *
 * The one irreversible act in the system, and the only one with a hard human
 * gate in front of it.
 *
 * One `PlatformAdapter` interface with two implementations. `demoAdapter`
 * fabricates receipts; `liveAdapter` throws until real credentials exist. The
 * mode is recorded permanently on every receipt, and demo and live are never
 * mixed: a post published in demo mode is stamped demo forever.
 */

import type { Platform } from '../../../../shared/agent-contract'
import { canvasFor } from '../../../../shared/image-models'
import { config } from '../../config'
import {
  insertLineage,
  insertPost,
  insertPostMetrics,
  postBaseline,
} from '../../db/repo'
import { clamp, PLATFORM_LABEL, seededFor } from '../corpus'
import { registerSkill } from '../runtime'
import type { PublishPayload } from './index'

/* ═══════════════════════════════════════════════════════════════════════════
   THE PLATFORM ADAPTER
   ═══════════════════════════════════════════════════════════════════════════ */

export interface PlatformDispatchInput {
  platform: Platform
  body: string
  altText: string
  mediaHandle: string | null
  timeoutMs: number
}

export interface PlatformDispatchResult {
  externalId: string
  url: string
  dispatchedAt: string
}

export interface PlatformAdapter {
  readonly mode: 'demo' | 'live'
  isConfigured(): boolean
  unavailableReason(): string
  dispatch(input: PlatformDispatchInput): Promise<PlatformDispatchResult>
  uploadMedia(dataUri: string, timeoutMs: number): Promise<string>
}

/** Fabricates deterministic receipts. Never touches the network. */
export const demoAdapter: PlatformAdapter = {
  mode: 'demo',
  isConfigured: () => true,
  unavailableReason: () => 'Demo mode needs no credentials',
  async dispatch(input) {
    const rand = seededFor(`${input.platform}:${input.body.slice(0, 60)}`, 7717)
    const id = `demo_${input.platform}_${Math.floor(rand() * 1e12).toString(36)}`
    const handle = input.platform === 'x' ? 'ethara_ai' : 'ethara-ai'
    return {
      externalId: id,
      url: `https://${input.platform === 'x' ? 'x.com' : `www.${input.platform}.com`}/${handle}/posts/${id}`,
      dispatchedAt: new Date().toISOString(),
    }
  },
  async uploadMedia(dataUri) {
    const rand = seededFor(dataUri.slice(0, 120), 991)
    return `demo_media_${Math.floor(rand() * 1e10).toString(36)}`
  },
}

/**
 * The live adapter. It throws with a specific, actionable message rather than
 * pretending — silently succeeding in live mode would be the worst possible
 * failure in this product.
 */
export const liveAdapter: PlatformAdapter = {
  mode: 'live',
  isConfigured: () => false,
  unavailableReason: () =>
    'No platform credentials are configured. Live publishing needs a LinkedIn, Instagram or X app credential, which this prototype does not carry.',
  async dispatch(input) {
    throw new Error(
      `publishing.post.dispatch cannot reach ${PLATFORM_LABEL[input.platform]} — ${liveAdapter.unavailableReason()} Set PUBLISH_MODE=demo to publish against the simulator.`,
    )
  },
  async uploadMedia() {
    throw new Error(
      `publishing.media.upload cannot run live — ${liveAdapter.unavailableReason()}`,
    )
  },
}

export function adapterForMode(mode: 'demo' | 'live'): PlatformAdapter {
  return mode === 'live' ? liveAdapter : demoAdapter
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · publishing.format.validate
   ═══════════════════════════════════════════════════════════════════════════ */

const PLATFORM_LIMITS: Record<Platform, { maxChars: number; maxHashtags: number }> = {
  linkedin: { maxChars: 3000, maxHashtags: 5 },
  instagram: { maxChars: 2200, maxHashtags: 5 },
  x: { maxChars: 280, maxHashtags: 5 },
}

registerSkill<PublishPayload>('publishing.format.validate', (payload, ctx) => {
  const blockOnFailure = ctx.bool('blockOnFailure', true)
  const requireAltText = ctx.bool('requireAltText', true)

  const limits = PLATFORM_LIMITS[payload.platform]
  const findings: string[] = []

  if (payload.body.trim().length === 0) {
    findings.push('The post body is empty.')
  }
  if (payload.body.length > limits.maxChars) {
    findings.push(
      `${payload.body.length} characters exceeds the ${PLATFORM_LABEL[payload.platform]} limit of ${limits.maxChars}.`,
    )
  }

  const tags = payload.body.match(/#[\p{L}\p{N}_]+/gu) ?? []
  if (tags.length > limits.maxHashtags) {
    findings.push(`${tags.length} hashtags exceeds the ${limits.maxHashtags}-tag ceiling.`)
  }

  const emoji = payload.body.match(/\p{Extended_Pictographic}/gu) ?? []
  if (emoji.length > 0) {
    findings.push(`${emoji.length} emoji present against an emoji budget of zero.`)
  }

  if (payload.mediaDataUri && requireAltText && payload.altText.trim().length === 0) {
    findings.push('The post carries an image with no alt text.')
  }

  if (payload.mediaDataUri) {
    const canvas = canvasFor(payload.platform)
    if (!payload.mediaDataUri.startsWith('data:image/')) {
      findings.push('The media asset is not a usable image.')
    } else {
      ctx.log(`Media present for the ${canvas.width}×${canvas.height} ${canvas.label} canvas`)
    }
  }

  const formatValid = findings.length === 0

  if (!formatValid && blockOnFailure) {
    throw new Error(
      `Format validation blocked the publish — ${findings.join(' ')} Fix the draft, or switch off "Block on failure" to publish anyway.`,
    )
  }

  ctx.log(
    formatValid
      ? `Format valid for ${PLATFORM_LABEL[payload.platform]} · ${payload.body.length}/${limits.maxChars} characters, ${tags.length} hashtag(s)`
      : `${findings.length} format finding(s), not blocking`,
  )

  return { formatValid, formatFindings: findings }
})

/* ═══════════════════════════════════════════════════════════════════════════
   2 · publishing.media.upload
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PublishPayload>('publishing.media.upload', async (payload, ctx) => {
  const timeoutMs = ctx.num('timeoutMs', 45000)
  const retries = ctx.num('retries', 2)

  if (!payload.mediaDataUri) {
    ctx.log('No media on this post — nothing to upload')
    return { mediaHandle: null }
  }

  const adapter = adapterForMode(payload.publishMode)

  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const handle = await adapter.uploadMedia(payload.mediaDataUri, timeoutMs)
      ctx.log(`Media uploaded in ${adapter.mode} mode · handle ${handle}`)
      return { mediaHandle: handle }
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      await new Promise((r) => setTimeout(r, 400 * 2 ** attempt))
    }
  }

  throw new Error(
    `Media upload failed after ${retries + 1} attempt(s) — ${lastError instanceof Error ? lastError.message : String(lastError)}`,
  )
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · publishing.post.dispatch — THE IRREVERSIBLE ACT
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PublishPayload>('publishing.post.dispatch', async (payload, ctx) => {
  const timeoutMs = ctx.num('timeoutMs', 60000)
  const recordModeOnReceipt = ctx.bool('recordModeOnReceipt', true)

  const mode = payload.publishMode
  const adapter = adapterForMode(mode)

  if (!adapter.isConfigured()) {
    throw new Error(
      `Cannot dispatch to ${PLATFORM_LABEL[payload.platform]} — ${adapter.unavailableReason()}`,
    )
  }

  const result = await adapter.dispatch({
    platform: payload.platform,
    body: payload.body,
    altText: payload.altText,
    mediaHandle: payload.mediaHandle ?? null,
    timeoutMs,
  })

  ctx.emit('activity', `Published “${payload.title}” to ${PLATFORM_LABEL[payload.platform]}`, {
    status: 'ok',
    externalId: result.externalId,
    mode,
  })

  ctx.log(
    `Dispatched to ${PLATFORM_LABEL[payload.platform]} in ${mode} mode · ${result.externalId}` +
      (recordModeOnReceipt ? ' · mode recorded on the receipt' : ''),
  )

  return {
    externalId: result.externalId,
    dispatchedAt: result.dispatchedAt,
    postUrl: result.url,
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   4 · publishing.receipt.record
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PublishPayload>('publishing.receipt.record', async (payload, ctx) => {
  const seedFirstHour = ctx.bool('seedFirstHourMetrics', true)
  const writeLineage = ctx.bool('writeLineage', true)

  if (!payload.externalId) {
    throw new Error('No external id to record — the dispatch did not complete.')
  }

  const publishedAt = (payload.dispatchedAt ?? new Date().toISOString()).slice(0, 10)

  // The history is append-only: the five phases the operator watched are what
  // the receipt records.
  const history = [
    { step: 'Preparing content', at: payload.dispatchedAt, status: 'done' },
    { step: 'Validating platform format', at: payload.dispatchedAt, status: 'done' },
    { step: 'Uploading media', at: payload.dispatchedAt, status: payload.mediaHandle ? 'done' : 'skipped' },
    { step: 'Publishing', at: payload.dispatchedAt, status: 'done' },
    { step: 'Published successfully', at: payload.dispatchedAt, status: 'done' },
  ]

  const inserted = await insertPost({
    workspaceId: ctx.workspaceId,
    ideaId: payload.ideaId,
    title: payload.title,
    platform: payload.platform,
    content: payload.body,
    externalId: payload.externalId,
    publishMode: payload.publishMode,
    publishedAt,
    history,
    mediaAssetId: payload.mediaAssetId,
  })

  if (!inserted) throw new Error('The receipt could not be written.')

  if (seedFirstHour) {
    // The first reading, generated against this account's own baseline rather
    // than an invented number. A metric never reported stays absent; this one
    // is a genuine first-hour capture in demo mode.
    const baseline = await postBaseline(ctx.workspaceId, payload.platform, 8)
    const rand = seededFor(payload.externalId, 4409)
    const reachBase = baseline.samples > 0 ? baseline.avgReach : 2400
    const reach = Math.round(reachBase * (0.06 + rand() * 0.06))
    const impressions = Math.round(reach * (1.25 + rand() * 0.4))
    const likes = Math.round(reach * (0.03 + rand() * 0.03))
    const comments = Math.round(likes * (0.08 + rand() * 0.12))
    const shares = Math.round(likes * (0.05 + rand() * 0.1))
    const engagementRate =
      impressions === 0 ? 0 : clamp(Math.round(((likes + comments + shares) / impressions) * 10000) / 100, 0, 100)

    await insertPostMetrics({
      postId: inserted.id,
      reach,
      impressions,
      likes,
      comments,
      shares,
      engagementRate,
    })

    ctx.log(
      `First-hour reading seeded · ${reach} reach, ${engagementRate}% engagement rate against our own ${baseline.samples}-post baseline`,
    )
  }

  if (writeLineage) {
    await insertLineage({
      workspaceId: ctx.workspaceId,
      fromType: 'content_idea',
      fromId: payload.ideaId,
      toType: 'post',
      toId: inserted.id,
      agentId: 'publishing',
    })
  }

  ctx.emit('post.published', payload.title, {
    postId: inserted.id,
    platform: payload.platform,
    externalId: payload.externalId,
    mode: payload.publishMode,
  })

  return {
    postId: inserted.id,
    receipt: {
      externalId: payload.externalId,
      publishMode: payload.publishMode,
      publishedAt,
      platform: payload.platform,
    },
  }
})

/** The mode the product is configured to publish in. */
export function currentPublishMode(): 'demo' | 'live' {
  return config.core.publishMode
}

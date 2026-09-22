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
import { BRAND } from '../../../../shared/brand-voice'
import * as buffer from '../../integrations/buffer'
import { clamp, PLATFORM_LABEL, seededFor } from '../corpus'
import { registerSkill } from '../runtime'
import type { PublishPayload } from '../skills/index'

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
  /**
   * Returns a handle the dispatch can attach.
   *
   * `assetId` is required by the live lane and ignored by the simulator: Buffer
   * fetches an image by URL, so what it needs is the creative's ADDRESS, not its
   * bytes. The data URI is still passed because the demo adapter derives a
   * deterministic handle from it.
   */
  uploadMedia(dataUri: string, timeoutMs: number, assetId: string | null): Promise<string>
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
/**
 * The live adapter — Buffer for every platform.
 *
 * One broker replaced four direct connectors. LinkedIn Company Page posting
 * needed a scope LinkedIn refused to issue this app (`unauthorized_scope_error`
 * on `w_organization_social`, gated behind the reviewed Community Management
 * programme), and Instagram, X and Facebook had no live path at all. Buffer
 * already holds all four grants, so the operator connects the channels there once
 * and every lane becomes live together.
 *
 * The receipt is Buffer's update id rather than the platform's post id, because
 * that is what this endpoint returns. Presenting it as a platform permalink would
 * be inventing a receipt.
 */
export const liveAdapter: PlatformAdapter = {
  mode: 'live',
  isConfigured: () => buffer.isConfigured(),
  unavailableReason: () => buffer.unavailableReason(),
  async dispatch(input) {
    const reason = buffer.unavailableReason()
    if (reason !== '') {
      throw new Error(
        `publishing.post.dispatch cannot reach ${PLATFORM_LABEL[input.platform]} — ${reason}`,
      )
    }
    return buffer.dispatch({
      platform: input.platform,
      body: input.body,
      altText: input.altText,
      // `uploadMedia` returns a URL Buffer can fetch, or null. Buffer pulls the
      // image itself, so a data URI would be silently dropped.
      mediaUrl: input.mediaHandle,
      timeoutMs: input.timeoutMs,
    })
  },
  async uploadMedia(dataUri, _timeoutMs, assetId) {
    /*
     * Buffer FETCHES the image, so this resolves an address rather than uploading
     * bytes. The creative is served as a PNG by `GET /api/media/:id.png`, which
     * rasterises the stored SVG on demand — no platform accepts SVG for a feed
     * image.
     *
     * An already-absolute URL passes through, which keeps a future hosted-creative
     * path working without another branch here.
     */
    if (/^https?:\/\//i.test(dataUri)) return dataUri

    if (config.buffer.publicBaseUrl === '') {
      throw new Error(
        'publishing.media.upload cannot attach this creative — PUBLIC_BASE_URL is not set, so ' +
          'there is no address Buffer can fetch the image from. Set it in server/.env to a URL ' +
          'reachable from the public internet (the Cloudflare tunnel host works). The caption ' +
          'publishes without the image until then.',
      )
    }
    if (assetId === null || assetId === '') {
      throw new Error(
        'publishing.media.upload cannot attach this creative — the post carries image data but no ' +
          'media asset id, so it has no stable URL. The caption publishes without the image.',
      )
    }
    return `${config.buffer.publicBaseUrl}/api/media/${assetId}.png`
  },
}

export function adapterForMode(mode: 'demo' | 'live'): PlatformAdapter {
  return mode === 'live' ? liveAdapter : demoAdapter
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · publishing.format.validate
   ═══════════════════════════════════════════════════════════════════════════ */

/*
 * The ceiling is BRAND.hashtags.max, not a literal.
 *
 * It was hardcoded at 5 while the caption spec asks for 5–7, which would have
 * flagged every compliant caption as over-tagged — a validator disagreeing with
 * the instruction the writer was given is the worst kind of drift, because both
 * look correct in isolation.
 */
const PLATFORM_LIMITS: Record<Platform, { maxChars: number; maxHashtags: number }> = {
  linkedin: { maxChars: 3000, maxHashtags: BRAND.hashtags.max },
  instagram: { maxChars: 2200, maxHashtags: BRAND.hashtags.max },
  x: { maxChars: 280, maxHashtags: BRAND.hashtags.max },
  facebook: { maxChars: 63206, maxHashtags: BRAND.hashtags.max },
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
      const handle = await adapter.uploadMedia(payload.mediaDataUri, timeoutMs, payload.mediaAssetId)
      ctx.log(`Media resolved in ${adapter.mode} mode · handle ${handle}`)
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

  /*
   * ═══ A LIVE POST NEVER GETS AN INVENTED READING ═══
   *
   * `seedFirstHourMetrics` writes a first metrics row from a seeded PRNG
   * against a baseline (or a hardcoded 2400 when there is no baseline). In
   * demo mode that is defensible: nothing was published, so nothing can be
   * measured, and a shaped number makes the screens explorable.
   *
   * On a LIVE post it is fabricated evidence about a real publication. A post
   * genuinely delivered to LinkedIn was showing "241 reach · 375 impressions ·
   * 4.53% engagement" minutes after dispatch, with nobody having asked
   * LinkedIn anything. Those figures then feed `postBaseline()`, which feeds
   * the Analytics Agent's comparisons and the Learning Agent's lessons — so
   * one invented row becomes the baseline that later invented rows are
   * generated against, and the whole measurement layer drifts away from
   * reality while looking more confident each week.
   *
   * Constraint 2 is the rule here as much as constraint 4: a metric nobody
   * reported stays ABSENT. It does not become a plausible number, and it does
   * not become zero. The post is published; its performance is simply not
   * known yet, and the screens say so.
   */
  const liveDispatch = payload.publishMode === 'live'
  if (seedFirstHour && liveDispatch) {
    ctx.log(
      'No first-hour reading was seeded: this went out for real, so its performance is ' +
        'whatever the platform reports and nothing is invented in the meantime.',
    )
  }

  if (seedFirstHour && !liveDispatch) {
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

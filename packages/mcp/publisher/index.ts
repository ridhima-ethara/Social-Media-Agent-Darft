/**
 * PUBLISHER CONNECTOR
 *
 * The one irreversible act in the system, behind one interface.
 *
 * Constraint 7: only the publisher may write `SCHEDULED` or `PUBLISHED`, and
 * only after a real platform call succeeded. In demo mode the demo adapter
 * returns and the receipt says `demo` — it never claims a live dispatch.
 */

import type { Connector, ConnectorHealth, Platform } from '../../contracts/src/index'
import { readRaw } from '../../config/src/loader'

export type PublishMode = 'demo' | 'live'

export interface PublishRequest {
  platform: Platform
  body: string
  mediaDataUri?: string
  altText?: string
  /** Both approvals, recorded. Dispatch is refused without them. */
  approvals: {
    marketing: { by: string; at: string } | null
    leadership: { by: string; at: string } | null
  }
}

export interface PublishReceipt {
  externalId: string
  platform: Platform
  /** Permanent on the receipt. Demo and live are never mixed within a run. */
  mode: PublishMode
  publishedAt: string
  /** What was actually sent, so the receipt is checkable. */
  bodyLength: number
  hadMedia: boolean
}

export interface PlatformAdapter extends Connector {
  readonly platform: Platform
  publish(request: PublishRequest): Promise<PublishReceipt>
}

/* ── The approval gate ─────────────────────────────────────────────────────── */

export class ApprovalMissingError extends Error {
  constructor(which: 'Marketing' | 'Leadership') {
    super(`${which} approval is missing. Nothing publishes without both.`)
    this.name = 'ApprovalMissingError'
  }
}

/**
 * Refuses rather than warns. This gate has no off switch, and it lives here
 * rather than in a caller so that no caller can forget it.
 */
function assertApproved(request: PublishRequest): void {
  if (!request.approvals.marketing) throw new ApprovalMissingError('Marketing')
  if (!request.approvals.leadership) throw new ApprovalMissingError('Leadership')
}

/* ── Format validation, before anything leaves the system ──────────────────── */

const LIMITS: Record<Platform, { maxChars: number; requiresMedia: boolean }> = {
  linkedin: { maxChars: 3000, requiresMedia: false },
  instagram: { maxChars: 2200, requiresMedia: true },
  x: { maxChars: 280, requiresMedia: false },
  facebook: { maxChars: 63206, requiresMedia: false },
}

export interface FormatIssue {
  field: string
  constraint: string
}

/** Returns every issue, not the first — one round trip should surface all of them. */
export function validateFormat(request: PublishRequest): FormatIssue[] {
  const limit = LIMITS[request.platform]
  const issues: FormatIssue[] = []

  if (request.body.trim().length === 0) {
    issues.push({ field: 'body', constraint: 'must not be empty' })
  }
  if (request.body.length > limit.maxChars) {
    issues.push({
      field: 'body',
      constraint: `${request.platform} allows ${limit.maxChars} characters; this is ${request.body.length}`,
    })
  }
  if (limit.requiresMedia && !request.mediaDataUri) {
    issues.push({ field: 'media', constraint: `${request.platform} requires an image` })
  }
  if (request.mediaDataUri && !request.altText) {
    issues.push({ field: 'altText', constraint: 'media requires alt text' })
  }

  return issues
}

/* ── The demo adapter ──────────────────────────────────────────────────────── */

function demoAdapter(platform: Platform): PlatformAdapter {
  return {
    id: `publisher-${platform}-demo`,
    label: `${platform} · demo`,
    platform,

    health(): ConnectorHealth {
      return {
        id: `publisher-${platform}`,
        label: `${platform} publishing`,
        configured: true,
        reason: 'Demo mode — dispatch is simulated and every receipt says so.',
        envKey: `${platform.toUpperCase()}_ACCESS_TOKEN`,
      }
    },

    async publish(request) {
      assertApproved(request)
      const issues = validateFormat(request)
      if (issues.length > 0) {
        throw new Error(
          `Format validation failed before dispatch: ${issues.map((i) => `${i.field} ${i.constraint}`).join('; ')}`,
        )
      }

      return {
        externalId: `demo-${platform}-${Date.now().toString(36)}`,
        platform,
        mode: 'demo',
        publishedAt: new Date().toISOString(),
        bodyLength: request.body.length,
        hadMedia: Boolean(request.mediaDataUri),
      }
    },
  }
}

/* ── The live adapter ──────────────────────────────────────────────────────── */

/**
 * Throws until real credentials exist rather than pretending to succeed.
 *
 * Falling back to demo here would be the worst possible behaviour: the operator
 * would believe a post went out when it did not.
 */
function liveAdapter(platform: Platform): PlatformAdapter {
  const envKey = `${platform.toUpperCase()}_ACCESS_TOKEN`

  return {
    id: `publisher-${platform}-live`,
    label: `${platform} · live`,
    platform,

    health(): ConnectorHealth {
      const token = readRaw(envKey)
      return {
        id: `publisher-${platform}`,
        label: `${platform} publishing`,
        configured: token.reported,
        reason: token.reported ? 'Credentials present.' : token.reason,
        envKey,
      }
    },

    async publish(request) {
      assertApproved(request)
      const issues = validateFormat(request)
      if (issues.length > 0) {
        throw new Error(
          `Format validation failed before dispatch: ${issues.map((i) => `${i.field} ${i.constraint}`).join('; ')}`,
        )
      }

      const token = readRaw(envKey)
      if (!token.reported) {
        throw new Error(
          `Live publishing to ${platform} is not possible: ${token.reason}. Set ${envKey}, or run in demo mode — I will not silently fall back and report a post that never went out.`,
        )
      }

      throw new Error(
        `${platform} live dispatch is not implemented in this prototype. The credential is present, but no real API call is wired.`,
      )
    },
  }
}

/** Binds the adapter for the current mode. Demo and live are never mixed. */
export function publisherFor(platform: Platform, mode: PublishMode): PlatformAdapter {
  return mode === 'live' ? liveAdapter(platform) : demoAdapter(platform)
}

export function publisherHealth(mode: PublishMode): ConnectorHealth[] {
  return (['linkedin', 'instagram', 'x', 'facebook'] as Platform[]).map((platform) =>
    publisherFor(platform, mode).health(),
  )
}

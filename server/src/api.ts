/**
 * THE REST SURFACE
 *
 * Every route under `/api`, zod on every body, one wrapper on every handler. The
 * wrapper resolves the workspace, serialises the result, and answers
 * `500 { error }` on a throw — so no route has to remember to.
 *
 * `GET /state` is the aggregate read that hydrates the whole UI in one call.
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { CORPUS_DIR, SUPPORTED_EXTENSIONS, ingestCorpusFiles, isSupportedCorpusFile } from './agents/knowledge/corpus-ingest'
import { spawn } from 'node:child_process'
import { basename, join } from 'node:path'
import express, { type Request, type Response, type Router } from 'express'
import { z } from 'zod'

import {
  CONTENT_FORMATS,
  PLATFORMS,
  type ContentFormat,
  type Platform,
} from '../../shared/agent-contract'
import {
  AGENTS,
  REGISTRY_SUMMARY,
  SKILLS,
  SKILL_BY_ID,
  STAGES,
  coerceConfigValue,
  defaultSkillConfig,
} from '../../shared/agent-registry'
import { TOOLS, TOOL_SUMMARY, matchTools, TOOL_BY_ID } from '../../shared/tool-registry'
import {
  BRAND,
  BRAND_CORPUS,
  BRAND_CORPUS_TAG,
  BRAND_DOMAIN_TAG,
  BRAND_RULES,
  BRAND_RULE_TAG,
  BRAND_TOPICS,
  brandCorpusAsKnowledge,
} from '../../shared/brand-voice'
import { synonymsFor } from '../../shared/keywords'
import { IMAGE_MODELS, IMAGE_MODEL_IDS } from '../../shared/image-models'
import { TEXT_MODELS } from '../../shared/text-models'
import { config, integrationStatuses } from './config'
import * as bufferAdapter from './integrations/buffer'
import { rasterise } from './integrations/rasterise'
import { databaseReachable } from './db/pool'
import {
  type IdeaRow,
  insertListenerReport,
  latestListenerReport,
  createKeyword,
  currentWorkspaceId,
  deactivateKeyword,
  deleteSkillOverride,
  getIdea,
  getWorkspace,
  insertActivity,
  insertKnowledgeEntry,
  latestKeywordSignals,
  latestRunKeywordSignals,
  latestKnowledgeBuild,
  latestPipelineRun,
  listActivity,
  listAgentRuns,
  listAgentState,
  listDraftsForIdeas,
  listHashtags,
  listIdeas,
  listKeywords,
  countKnowledge,
  listKnowledge,
  embeddingCoverage,
  listKnowledgeBuilds,
  listMediaForIdeas,
  listPlatformAnalytics,
  listPosts,
  listReviewQueue,
  listScrapedItems,
  listSkillOverrides,
  listSkillRuns,
  listSources,
  resolveQueueForEntity,
  resolveReviewQueueRow,
  setHashtagValidation,
  setItemValidation,
  setKnowledgeActive,
  skillRunsForRun,
  skillStats,
  traceLineage,
  trendingKeywords,
  updateIdea,
  updateKeyword,
  upsertDraft,
  upsertSkillOverride,
  withdrawIdea,
  mediaAssetById,
  countVoiceSamples,
  insertVoiceSamples,
  listHookVariants,
  listHookVariantsForIdeas,
  listTrackedAccounts,
  listVoiceProfiles,
  listVoiceSamples,
  selectHookVariant,
  setTrackedAccountActive,
  setVoiceProfileActive,
  upsertTrackedAccount,
  getPost,
} from './db/repo'
import {
  conversationTranscript,
  runCommand,
  resumeConfirmed,
  type CommandFrame,
} from './assistant/index'
import { composeBrief, sweepForNotices } from './assistant/watch'
import {
  latestBrief,
  latestConversation,
  listConversations,
  pendingConfirmation,
} from './db/assistant-repo'
import { describeImage } from './integrations/gcp-llm'
import { capabilities, registeredToolIds } from './assistant/tools/index'
import { agentSpawn, describeAgentTier, isConfigured as agentTierConfigured } from './integrations/agent-tier'
import { requireRole, requireSession, sessionOf } from './auth/guard'
import { SESSION_COOKIE, authEnforced, encodeSession, signIn } from './auth/session'
import { availableImageModels } from './agents/image/image-models/index'
import { integrationReport,
  describeGcpAuth,
  gcpAuthAvailable,
  platformLaneUnavailableReason,
} from './integrations'
import { runTrendIntelligence } from './bridges/claude-bridge/pipeline'
import { bridgeUnavailableReason } from './bridges/claude-bridge/capture-source'
import { renderMarkdown } from './bridges/claude-bridge/output/markdown'
import { trendToolInputSchema } from './bridges/claude-bridge/schemas/trend-output'
import { discoverPlatformTrends } from './bridges/claude-bridge/trends/platform-trends'
import { platformTrendsArgs, renderPlatformTrends } from './bridges/claude-bridge/tools/linkedin-trend-intelligence'
import {
  applyInstruction,
  approveMarketing,
  buildKnowledge,
  decideLeadership,
  generateDraft,
  generatePostForTopic,
  publishIdea,
  refreshAnalytics,
  renderIdeaImage,
  revertDraft,
  runDiscoveryPipeline,
} from './orchestrator'
import { bus, publish, recentEvents, subscribe, toSseFrame, REPLAY_SIZE } from './events'
import { labelToMinutes, PLATFORM_LABEL } from './agents/corpus'
import { resolveCalendarHorizon } from './calendar-horizon'
import { contentPillarFor } from '../../shared/content-pillars'
import { persistAgentRun } from './agents/persist-run'
import { resolveConfig, runSkill } from './agents/runtime'
import { fetchGlassdoor } from './agents/analysis/social-listener/glassdoor'
import { buildReputation } from './agents/analysis/social-listener/reputation'
import { ensureSelf as ensureSelfProfile, ensureUniverse, isDue as isCompetitorDue, markEnded as markCompetitorRunEnded, markQueued as markCompetitorRunQueued, normalized as competitorIntelligenceNow, runStatus as competitorRunStatus } from './agents/analysis/competitor-intel'
import { marketingSkillsAvailable, skillSource, toolBindings } from './agents/analysis/competitor-intel/marketing-skills'
import { seoConfigured } from './agents/analysis/competitor-intel/seo'
import {
  deleteCompetitor,
  getCompetitor,
  insertCompetitor,
  latestMarketReport,
  latestProfile,
  listCompetitors,
  profileByVersion,
  profileVersions,
  updateCompetitor,
} from './db/competitor-repo'
import { COMPETITOR_STATUSES, COMPETITOR_TIERS, MONITORING_FREQUENCIES } from '../../shared/competitor-intel'

/** Claude settings for the listener's reputation pass, from the skill's knobs (the same ones the listener run uses). */
function listenerClaudeOptions(knobs: Record<string, unknown>) {
  return {
    enabled: knobs.claudeAnalysis !== false,
    model: typeof knobs.claudeModel === 'string' && knobs.claudeModel !== '' ? knobs.claudeModel : 'sonnet',
    maxBudgetUsd: Number(knobs.claudeBudgetCents ?? 50) / 100,
    timeoutMs: 180_000,
    batchSize: Number(knobs.claudeBatchSize ?? 40),
  }
}
import type { SocialMediaListener } from '../../shared/social-listener'
import type { CaptionPayload, PipelinePayload } from './agents/skills/index'
import { socialFetchConfigured, socialFetchUnavailableReason } from './integrations/socialfetch'
import { fetchLayerConfigured, fetchLayerUnavailableReason } from './integrations/fetchlayer'
import { describeWhisper, whisperTranscribe } from './integrations/whisper'

/* ═══════════════════════════════════════════════════════════════════════════
   THE WRAPPER
   ═══════════════════════════════════════════════════════════════════════════ */

type Handler = (req: Request, res: Response, workspaceId: string) => Promise<unknown>

/**
 * A refusal with a status that says what KIND of refusal it is.
 *
 * Everything a route throws currently answers 500, which says "this broke".
 * Some refusals are not breakages: "18 samples, 20 required" is a well-formed
 * request whose answer is no, and a client cannot tell those apart from a crash
 * without a status that distinguishes them. 422 is that status.
 */
export class HttpError extends Error {
  readonly status: number
  constructor(status: number, message: string) {
    super(message)
    this.name = 'HttpError'
    this.status = status
  }
}

function route(handler: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = await currentWorkspaceId()
      const result = await handler(req, res, workspaceId)
      if (res.headersSent) return
      res.json(result ?? { ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      const status = error instanceof HttpError ? error.status : 500
      if (!res.headersSent) res.status(status).json({ error: message })
    }
  }
}

/*
 * THE HEARTBEAT FOR A SLOW ROUTE.
 *
 * Writing a caption and rendering its creative takes one to two minutes. The
 * public domain sits behind an nginx whose read timeout is sixty seconds, so a
 * Regenerate click was cut off with a 504 while the server was still writing —
 * the button looked dead, and the local stand-in draft was all that remained.
 *
 * A route that answers inside the first beat responds exactly as `route` does.
 * One that runs longer commits a 200 and writes a single space every beat:
 * whitespace before a JSON document is still valid JSON, and each byte resets
 * the proxy's read timer. An error after that point cannot change the status,
 * so it is written as `{ failed: true, error }`, which the client's `request()`
 * treats exactly like a non-2xx answer.
 */
const HEARTBEAT_MS = 15_000

function longRoute(handler: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    let committed = false
    const beat = setInterval(() => {
      if (res.writableEnded) return
      if (!committed) {
        committed = true
        res.status(200).setHeader('Content-Type', 'application/json; charset=utf-8')
        // Proxies that buffer would hold the beats back; this asks them not to.
        res.setHeader('X-Accel-Buffering', 'no')
      }
      res.write(' ')
    }, HEARTBEAT_MS)

    try {
      const workspaceId = await currentWorkspaceId()
      const result = await handler(req, res, workspaceId)
      clearInterval(beat)
      if (res.writableEnded) return
      if (committed) res.end(JSON.stringify(result ?? { ok: true }))
      else if (!res.headersSent) res.json(result ?? { ok: true })
    } catch (error) {
      clearInterval(beat)
      const message = error instanceof Error ? error.message : String(error)
      const status = error instanceof HttpError ? error.status : 500
      if (res.writableEnded) return
      if (committed) res.end(JSON.stringify({ failed: true, status, error: message }))
      else if (!res.headersSent) res.status(status).json({ error: message })
    }
  }
}

/** Parses a body and answers 400 with the specific field that was wrong. */
function parseBody<T extends z.ZodTypeAny>(schema: T, body: unknown): z.infer<T> {
  const parsed = schema.safeParse(body ?? {})
  if (!parsed.success) {
    const first = parsed.error.issues[0]
    throw new Error(`${first?.path.join('.') || 'body'}: ${first?.message ?? 'invalid'}`)
  }
  return parsed.data
}

const platformSchema = z.enum(PLATFORMS)

/** The caption models the review panel may choose between. */
const TEXT_MODEL_IDS = TEXT_MODELS.map((model) => model.id) as [string, ...string[]]

/**
 * One file the operator attached in the review panel for a model to work from.
 *
 * Bounded on every field: an unbounded `dataUri` is an unbounded request body,
 * and the client already truncates text to the same ceiling.
 */
const referenceSchema = z.object({
  name: z.string().min(1).max(200),
  mimeType: z.string().max(120).default('application/octet-stream'),
  size: z.number().int().nonnegative().optional(),
  text: z.string().max(8_000).optional(),
  dataUri: z.string().max(6_000_000).optional(),
  unreadableReason: z.string().max(300).optional(),
})

type ReferenceInput = z.infer<typeof referenceSchema>

/** Narrows a validated reference to what the skill payload carries. */
/**
 * Narrows a validated attachment to what the skill payload carries.
 *
 * ═══ THE BYTES NOW TRAVEL ═══
 *
 * This used to drop `dataUri` on the floor, so an attached image reached the
 * writer as a NAME and a note saying it could not be read. That was honest —
 * the model genuinely could not see it — but it was honest about a limitation
 * this layer was imposing, not one the model had.
 *
 * `image` now carries the data URI through for image attachments. Whether a
 * model actually receives it is decided further down, by whether that model can
 * accept image parts; a text-only writer still gets the name and the note. The
 * ceilings that matter — 6 MB per reference, 8 references — are enforced by
 * `referenceSchema` before this runs, so nothing here can exceed them.
 */
function toReference(reference: ReferenceInput): {
  name: string
  mimeType: string
  text?: string
  note?: string
  image?: string
} {
  const isImage =
    reference.dataUri !== undefined &&
    reference.text === undefined &&
    reference.mimeType.startsWith('image/')

  return {
    name: reference.name,
    mimeType: reference.mimeType,
    ...(reference.text === undefined ? {} : { text: reference.text }),
    ...(isImage ? { image: reference.dataUri } : {}),
    ...(reference.unreadableReason === undefined
      ? {}
      : { note: reference.unreadableReason }),
  }
}

/**
 * Folds attachments into an image instruction.
 *
 * The painters accept a prompt rather than an image, so an attached picture is
 * named and reported as not sent. A caller who believes their moodboard was
 * passed to the model would read the result as a response to it.
 */
/**
 * Folds attachments into an instruction.
 *
 * An attached IMAGE is now read rather than named and dropped. `describeImage`
 * puts it through the local vision model and returns words, which is the one
 * currency every painter and writer accepts. What reaches the model is a
 * DESCRIPTION of the reference, and the prompt says exactly that — an operator
 * must not be able to believe their picture was handed over when it was
 * paraphrased.
 *
 * `intent` shapes the description: an illustrator wants composition and palette,
 * a writer wants to know what the thing depicts.
 */
async function describeReferencesForPrompt(
  references: ReferenceInput[] | undefined,
  intent: 'caption' | 'image' = 'image',
): Promise<string> {
  if (!references || references.length === 0) return ''

  const lines = await Promise.all(
    references.map(async (reference) => {
      if (reference.text && reference.text.trim().length > 0) {
        return `· ${reference.name}: ${reference.text.slice(0, 1_200)}`
      }
      if (reference.dataUri) {
        const seen = await describeImage(reference.dataUri, intent)
        return seen === ''
          ? `· ${reference.name}: an image was attached but could not be read, so it did not influence this result.`
          : `· ${reference.name} (attached image, described by the vision model — not the image itself): ${seen}`
      }
      return `· ${reference.name}: contents unavailable — ${reference.unreadableReason ?? 'unreadable'}.`
    }),
  )

  return `\n\nOperator reference material:\n${lines.join('\n')}`
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ROUTER
   ═══════════════════════════════════════════════════════════════════════════ */

export function createApiRouter(): Router {
  const api = express.Router()

  /* ── SESSION ─────────────────────────────────────────────────────────────── */
  /*
   * Mounted before the guard so signing in does not require being signed in.
   * The guard itself also exempts `/session`, but ordering makes that explicit.
   */

  api.post('/session', (req, res) => {
    const body = (req.body ?? {}) as { role?: unknown; password?: unknown }
    const outcome = signIn(body.role, body.password)

    if (outcome.session === null) {
      res.status(401).json({ error: outcome.reason })
      return
    }

    res.setHeader(
      'Set-Cookie',
      [
        `${SESSION_COOKIE}=${encodeURIComponent(encodeSession(outcome.session))}`,
        'Path=/',
        'HttpOnly',
        'SameSite=Lax',
        `Max-Age=${config.auth.sessionTtlSeconds}`,
        ...(config.auth.secureCookie ? ['Secure'] : []),
      ].join('; '),
    )
    res.json({
      role: outcome.session.role,
      actor: outcome.session.actor,
      expiresAt: new Date(outcome.session.expiresAt * 1000).toISOString(),
      enforced: authEnforced(),
    })
  })

  api.get('/session', (req, res) => {
    const session = sessionOf(req)
    if (session === null) {
      res.status(200).json({ role: null, actor: null, enforced: authEnforced() })
      return
    }
    res.json({
      role: session.role,
      actor: session.actor,
      expiresAt: new Date(session.expiresAt * 1000).toISOString(),
      enforced: authEnforced(),
    })
  })

  api.delete('/session', (_req, res) => {
    // Expire rather than omit: a cleared cookie must actually replace the one
    // the browser holds.
    res.setHeader(
      'Set-Cookie',
      `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    )
    res.json({ ok: true })
  })

  /* ── PUBLIC MEDIA ────────────────────────────────────────────────────────────
   *
   * Serves a creative as a PNG for the one consumer that cannot authenticate:
   * Buffer's fetcher. `ImageAssetInput.url` is the only way to attach an image to
   * a Buffer post, so the bytes must be retrievable over the public internet by a
   * machine that holds no session.
   *
   * SECURITY — THIS ROUTE IS DELIBERATELY UNAUTHENTICATED, and that is a real
   * exposure worth stating rather than burying:
   *
   *   · It is mounted ABOVE `requireSession`, so anyone who can reach the API can
   *     read it.
   *   · It serves ONLY rendered creatives from `media_assets`, addressed by opaque
   *     UUID. It exposes no captions, no ideas, no approvals, no metrics and no
   *     account data.
   *   · A UUID is not a secret, but it is unguessable, and the blast radius of a
   *     leaked one is a single marketing image that is about to be published
   *     publicly anyway.
   *
   * A narrower design — a signed, expiring URL — would be better and is the
   * obvious next step if this ever fronts anything more sensitive than a brand
   * card. It is not built yet, and pretending otherwise would be worse than
   * saying so here.
   */
  /*
   * WHERE A PUBLISHED POST LIVES ON THE PLATFORM.
   *
   * Buffer's receipt is its own id, not the platform's; the permalink appears
   * on Buffer's post record once the platform has accepted it. Asked on demand
   * rather than stored, so it is always Buffer's current answer. `url` is null
   * — never guessed — while the platform has not returned one, and for a demo
   * post, which never left this machine.
   */
  api.get(
    '/posts/:id/link',
    route(async (req, _res, workspaceId) => {
      const post = await getPost(workspaceId, String(req.params.id ?? ''))
      if (!post) throw new HttpError(404, 'No such published post.')
      if (post.publish_mode !== 'live' || !post.external_id) {
        return { url: null, status: 'demo', reason: 'This post was published in demo mode, so it has no platform page.' }
      }
      const measured = await bufferAdapter.fetchPostMetrics(post.external_id)
      if (measured === null) {
        return { url: null, status: 'unknown', reason: 'Buffer returned no record for this post.' }
      }
      return {
        url: measured.externalLink,
        status: measured.status,
        reason: measured.externalLink ? null : `Buffer reports this post as “${measured.status}” and has no platform link for it yet.`,
      }
    }),
  )

  api.get('/media/:id.png', async (req, res) => {
    const id = String(req.params.id ?? '').replace(/\.png$/i, '')
    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      res.status(400).type('text/plain').send('Not a media id.')
      return
    }
    try {
      const asset = await mediaAssetById(id)
      if (asset === null || (asset.data_uri ?? '') === '') {
        res.status(404).type('text/plain').send('No creative stored for that id.')
        return
      }
      const raster = await rasterise(asset.data_uri ?? '', { width: 1200, format: 'png' })
      if (raster === null) {
        res.status(422).type('text/plain').send('That creative could not be rasterised.')
        return
      }
      // Immutable: a creative is addressed by the id of a row that is never
      // rewritten, so Buffer and any CDN in front of it may cache indefinitely.
      res.setHeader('content-type', raster.contentType)
      res.setHeader('cache-control', 'public, max-age=31536000, immutable')
      res.setHeader('content-length', String(raster.bytes.length))
      res.end(raster.bytes)
    } catch (error) {
      res
        .status(500)
        .type('text/plain')
        .send(`Rasterising failed — ${error instanceof Error ? error.message : 'unknown error'}`)
    }
  })

  // Everything below that MUTATES needs an operator behind it. Mounted here so a
  // route added later is guarded by default rather than by memory.
  api.use(requireSession)

  /* ── HEALTH AND REGISTRY ─────────────────────────────────────────────────── */

  api.get('/health', async (_req, res) => {
    const database = await databaseReachable()
    const statuses = integrationStatuses()
    const body = {
      ok: database,
      database: database ? 'postgres' : 'unreachable',
      publishMode: config.core.publishMode,
      // Whether a password is actually required. An open gate must be visible
      // rather than assumed shut: with no OPERATOR_PASSWORD configured any
      // password is accepted, and that is a fact an operator needs.
      auth: { enforced: authEnforced() },
      workspace: config.core.workspaceSlug,
      registry: REGISTRY_SUMMARY,
      tools: TOOL_SUMMARY,
      integrations: {
        // The one live publishing lane. Reported here because "will pressing
        // publish actually post" must be answerable before pressing it, not
        // discovered from a failed dispatch afterwards.
        buffer: {
          configured: bufferAdapter.isConfigured(),
          publishMode: config.core.publishMode,
          willPublishForReal:
            config.core.publishMode === 'live' && bufferAdapter.isConfigured(),
          detail: bufferAdapter.describeBuffer(),
        },
        // The Analysis Agent's Social Media Listener data source.
        socialFetch: { configured: socialFetchConfigured(), reason: socialFetchUnavailableReason() },
        // The Social Media Listener's Glassdoor source (FetchLayer).
        fetchLayer: { configured: fetchLayerConfigured(), reason: fetchLayerUnavailableReason() },
        // WHICH source the platform lanes will bind, for the same reason
        // `text.resolved` is reported below: "why does this post carry no
        // reaction count" should be answerable here rather than inferred from
        // the zeros on the card. The Scraping Agent's platform lanes are the
        // Claude Bridge; Apify is no longer one of its sources.
        claudeBridge: (() => {
          const reason = platformLaneUnavailableReason()
          // Per lane, because each platform module can be unavailable on its own
          // (Facebook, whose posts cannot be dated, skips itself in capture).
          const lanes = Object.fromEntries(
            [...PLATFORMS, undefined].map((p) => {
              const why = bridgeUnavailableReason(p)
              return [p ?? 'web', { runs: why === '', reason: why === '' ? 'Ready' : why }]
            }),
          )
          return {
            configured: reason === '',
            reason: reason === '' ? 'Configured' : reason,
            platformLanes: reason === '' ? ('claude-bridge' as const) : ('unavailable' as const),
            lanes,
          }
        })(),
        // The second engine's process boundary. Reported here for the same reason
        // crawl4ai is: it is a spawned sidecar, and "why did Run agents do
        // nothing" must be answerable from the health payload rather than from a
        // stream that stopped.
        agentTier: {
          configured: agentTierConfigured(),
          reason: describeAgentTier(),
        },
        parallel: { configured: statuses.parallel.configured, reason: statuses.parallel.reason },
        gcp: {
          // The ADAPTER's own answer, not the config's. `config.gcp.configured`
          // is true as soon as either credential key is non-empty; only the
          // adapter knows whether the service-account JSON it points at is
          // actually readable and signable. Reporting the config's optimism
          // here is how a 401 at caption time gets to look like a working setup.
          configured: gcpAuthAvailable(),
          reason: describeGcpAuth(),
        },
        // Semantic retrieval. `coverage` is the load-bearing part: an embedder
        // that is configured but has embedded nothing yet still retrieves
        // lexically, and an operator asking "why did search miss that" needs to
        // see the gap rather than infer it from a configured flag.
        embeddings: {
          configured: statuses.embeddings.configured,
          reason: statuses.embeddings.reason,
          model: statuses.embeddings.model,
          dimensions: statuses.embeddings.dimensions,
          coverage: database ? await embeddingCoverage() : [],
        },
        mflux: {
          configured: statuses.mflux.configured,
          reason: statuses.mflux.reason,
          model: statuses.mflux.model,
        },
        /*
         * THE MODE IS ALWAYS VISIBLE (R7 · ADR-011).
         *
         * "Why does this reel have no transcript" must be answerable from here
         * rather than inferred from a NULL column. Off is a supported state and
         * says so; on names the resolved interpreter, the model and the minute
         * ceiling that actually binds, because the operator's knob is capped by
         * the deployment one and a slider that stopped mattering has to be
         * visible.
         */
        whisper: {
          configured: whisperTranscribe.isConfigured(),
          reason: describeWhisper(),
          model: config.whisper.model,
          maxMinutesPerRun: config.whisper.maxMinutesPerRun,
          maxSecondsPerItem: config.whisper.maxSecondsPerItem,
        },
        // The learned-voice surface, for the same reason the embedding coverage
        // is reported: a feature that is configured but has nothing stored
        // behaves identically to one that is switched off, and an operator
        // asking "why does this not sound like us" needs to see which.
        voice: database
          ? {
              profiles: (await listVoiceProfiles(await currentWorkspaceId())).length,
              samples: await countVoiceSamples(await currentWorkspaceId(), 'short_form_script'),
            }
          : { profiles: 0, samples: 0 },
        // WHICH provider writes, not merely whether one can. An operator
        // reading this should not have to work out the precedence themselves.
        text: {
          provider: statuses.text.provider,
          resolved: statuses.text.resolved,
          // The ordered providers, so "why did Qwen write this when Gemini is
          // configured" is answerable here rather than inferred from the stamp
          // on the card.
          chain: statuses.text.chain,
          backup: statuses.text.backup,
          configured: statuses.text.configured,
          reason: statuses.text.reason,
        },
        assistant: {
          provider: config.assistant.provider,
          configured: statuses.assistant.configured,
          reason: statuses.assistant.reason,
        },
        images: availableImageModels(),
      },
      events: bus.stats(),
    }
    res.status(database ? 200 : 503).json(body)
  })

  api.get(
    '/registry',
    route(async (_req, _res, workspaceId) => {
      const [overrides, stats] = await Promise.all([
        listSkillOverrides(workspaceId),
        skillStats(workspaceId),
      ])

      return {
        stages: STAGES,
        agents: AGENTS,
        summary: REGISTRY_SUMMARY,
        skills: SKILLS.map((skill) => {
          const override = overrides.get(skill.id)
          const values = { ...defaultSkillConfig(skill.id), ...(override?.config ?? {}) }
          const stat = stats.get(skill.id)
          return {
            ...skill,
            enabled: override ? override.enabled : skill.enabledByDefault,
            values,
            isOverridden: override !== undefined,
            stats: { runs: stat?.runs ?? 0, failures: stat?.failures ?? 0, avgMs: stat?.avgMs ?? 0 },
          }
        }),
      }
    }),
  )

  api.get(
    '/tools',
    route(async () => ({
      summary: TOOL_SUMMARY,
      registered: registeredToolIds(),
      capabilities: capabilities(),
      tools: TOOLS.map((t) => ({
        id: t.id,
        name: t.name,
        summary: t.summary,
        agentId: t.agentId,
        risk: t.risk,
        returns: t.returns,
        confirmTemplate: t.confirmTemplate ?? null,
        examples: t.examples,
      })),
    })),
  )

  api.patch(
    '/skills/:skillId',
    route(async (req, _res, workspaceId) => {
      const skillId = String(req.params.skillId)
      const skill = SKILL_BY_ID[skillId]
      if (!skill) throw new Error(`No such skill: ${skillId}`)

      const body = parseBody(
        z.object({
          enabled: z.boolean().optional(),
          config: z.record(z.union([z.string(), z.number(), z.boolean()])).optional(),
        }),
        req.body,
      )

      if (body.enabled === false && skill.critical) {
        throw new Error(
          `${skill.name} is required — the pipeline would produce wrong output without it, so it cannot be switched off.`,
        )
      }

      // defaults < workspace < patch, with every value validated against its
      // declared type and bounds.
      const overrides = await listSkillOverrides(workspaceId)
      const existing = (overrides.get(skillId)?.config ?? {}) as Record<string, unknown>
      const merged: Record<string, unknown> = { ...existing }

      for (const [key, raw] of Object.entries(body.config ?? {})) {
        const field = skill.config.find((f) => f.key === key)
        if (!field) throw new Error(`${skill.name} has no setting called ${key}`)
        merged[key] = coerceConfigValue(field, raw)
      }

      const saved = await upsertSkillOverride(workspaceId, skillId, skill.agentId, {
        ...(body.enabled === undefined ? {} : { enabled: body.enabled }),
        config: merged,
      })

      await insertActivity({
        workspaceId,
        agentId: skill.agentId,
        message: `${skill.name} updated · ${JSON.stringify(body.config ?? { enabled: body.enabled })}`,
        status: 'ok',
      })

      return { ok: true, skillId, override: saved, values: { ...defaultSkillConfig(skillId), ...merged } }
    }),
  )

  api.post(
    '/skills/:skillId/reset',
    route(async (req, _res, workspaceId) => {
      const skillId = String(req.params.skillId)
      const removed = await deleteSkillOverride(workspaceId, skillId)
      return { ok: true, removed, values: defaultSkillConfig(skillId) }
    }),
  )

  /* ── SHORT-FORM · VOICE PROFILES, HOOKS, TRACKED ACCOUNTS ────────────────── */
  /*
   * Every route below is guarded by `requireSession` (mounted above) and
   * validated by zod. Reads are safe; the two generators mutate; nothing here
   * is irreversible, because nothing here deletes and nothing here publishes.
   */

  api.get(
    '/voice-profiles',
    route(async (_req, _res, workspaceId) => ({
      profiles: await listVoiceProfiles(workspaceId),
      // The count the derive route will refuse below, returned beside the
      // profiles so the screen can say "18 of 20" without a second request.
      sampleCount: await countVoiceSamples(workspaceId, 'short_form_script'),
    })),
  )

  api.get(
    '/voice-samples',
    route(async (req, _res, workspaceId) => ({
      samples: await listVoiceSamples(workspaceId, {
        contentFormat: (typeof req.query.contentFormat === 'string'
          ? req.query.contentFormat
          : 'short_form_script') as ContentFormat,
        limit: Number(req.query.limit ?? 200),
      }),
    })),
  )

  /**
   * Bulk paste of past scripts.
   *
   * De-duplicated on the body itself in the repository, because the realistic
   * input is a paste an operator repeats after fixing one entry — and twenty
   * samples counted as forty would inflate `sample_count`, which is a claim
   * about how much evidence a profile rests on.
   */
  api.post(
    '/voice-samples',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          samples: z
            .array(
              z.object({
                body: z.string().min(20),
                label: z.string().max(200).optional(),
              }),
            )
            .min(1)
            .max(200),
          contentFormat: z.enum(CONTENT_FORMATS).default('short_form_script'),
        }),
        req.body,
      )
      const result = await insertVoiceSamples(
        workspaceId,
        body.samples.map((s) => ({
          body: s.body,
          contentFormat: body.contentFormat,
          source: 'operator',
          ...(s.label === undefined ? {} : { label: s.label }),
        })),
      )
      return {
        ...result,
        total: await countVoiceSamples(workspaceId, body.contentFormat),
      }
    }),
  )

  /**
   * Derives a profile from the stored samples.
   *
   * REFUSES below the floor and names the count it has. That refusal lives in
   * the skill handler, not here — this route runs the skill and reports what it
   * decided, so the REST caller and a pipeline run get the same answer for the
   * same reason.
   */
  api.post(
    '/voice-profiles/derive',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({ contentFormat: z.enum(CONTENT_FORMATS).default('short_form_script') }),
        req.body,
      )
      const { payload, record } = await runSkill<CaptionPayload>(
        'caption.voice.derive',
        {
          ideaId: '',
          platform: 'linkedin',
          title: '',
          description: '',
          sourceTopic: '',
          hashtag: null,
          angle: '',
          audience: '',
          format: '',
          contentFormat: body.contentFormat,
        },
        { workspaceId, trigger: 'api' },
      )

      if (payload.voiceProfile === null || payload.voiceProfile === undefined) {
        // 422, not 500: the request was well formed and the answer is "not
        // enough evidence". The reason already names the counts.
        throw new HttpError(
          422,
          payload.voiceProfileReason ??
            'No profile was derived, and the skill gave no reason. That is a defect — report it.',
        )
      }

      return { profile: payload.voiceProfile, skill: record }
    }),
  )

  api.patch(
    '/voice-profiles/:id',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(z.object({ active: z.boolean() }), req.body)
      const profile = await setVoiceProfileActive(workspaceId, String(req.params.id), body.active)
      if (!profile) throw new Error('No such voice profile.')
      // Deactivated, never deleted — the samples behind it stay readable and
      // reactivating is one more call to this same route.
      return { profile }
    }),
  )

  api.get(
    '/tracked-accounts',
    route(async (_req, _res, workspaceId) => ({
      accounts: await listTrackedAccounts(workspaceId),
    })),
  )

  api.post(
    '/tracked-accounts',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          platform: platformSchema,
          handle: z.string().min(1).max(120),
          label: z.string().max(200).optional(),
          note: z.string().max(600).optional(),
        }),
        req.body,
      )
      const account = await upsertTrackedAccount(workspaceId, body)
      if (!account) throw new Error('That handle is empty once the @ is stripped.')
      return { account }
    }),
  )

  api.patch(
    '/tracked-accounts/:id',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(z.object({ active: z.boolean() }), req.body)
      const account = await setTrackedAccountActive(
        workspaceId,
        String(req.params.id),
        body.active,
      )
      if (!account) throw new Error('No such tracked account.')
      return { account }
    }),
  )

  api.get(
    '/ideas/:id/hooks',
    route(async (req, _res, workspaceId) => ({
      hooks: await listHookVariants(workspaceId, String(req.params.id)),
    })),
  )

  /**
   * Generates the variant set for an idea.
   *
   * Runs the same four skills the pipeline runs, through the same runtime, so
   * the `skill_runs` rows are indistinguishable from a scheduled run's — which
   * is what makes "explain this run" work for an operator-triggered one.
   */
  api.post(
    '/ideas/:id/hooks',
    longRoute(async (req, _res, workspaceId) => {
      const idea = await getIdea(workspaceId, String(req.params.id))
      if (!idea) throw new Error('No such idea.')

      const result = await generateDraft({
        workspaceId,
        trigger: 'api',
        ideaId: idea.id,
        withImage: false,
      })

      return {
        hooks: await listHookVariants(workspaceId, idea.id),
        contentFormat: result.contentFormat,
        ...(result.contentFormat === 'short_form_script'
          ? {}
          : {
              note:
                'This idea is a written post, not a short-form script, so no hook variants were ' +
                'produced. Change its content format to generate hooks for it.',
            }),
      }
    }),
  )

  api.patch(
    '/hooks/:id/select',
    route(async (req, _res, workspaceId) => {
      // Marks the chosen variant and unmarks the rest. The others are kept:
      // "the four we did not pick" is evidence about what this account decided.
      const hooks = await selectHookVariant(workspaceId, String(req.params.id))
      if (hooks.length === 0) throw new Error('No such hook variant.')
      return { hooks }
    }),
  )

  /**
   * Writes the short-form script for an idea.
   *
   * Refuses on a `post` idea rather than quietly writing one: a caption and a
   * script are different artefacts, and silently substituting one is how a
   * review screen ends up showing something nobody asked for.
   */
  api.post(
    '/ideas/:id/script',
    longRoute(async (req, _res, workspaceId) => {
      const idea = await getIdea(workspaceId, String(req.params.id))
      if (!idea) throw new Error('No such idea.')
      if (idea.content_format !== 'short_form_script') {
        throw new HttpError(
          422,
          `“${idea.title}” is a written post, not a short-form script. Set its content format to ` +
            'short_form_script first; writing a script for a post would produce an artefact in a ' +
            'different register from the one that was planned.',
        )
      }
      const result = await generateDraft({
        workspaceId,
        trigger: 'api',
        ideaId: idea.id,
        withImage: false,
      })
      return {
        script: result.body,
        source: result.source,
        model: result.model,
        ...(result.fallbackReason === undefined ? {} : { fallbackReason: result.fallbackReason }),
        hooks: result.hooks,
        skills: result.skills,
      }
    }),
  )

  /* ── STATE ───────────────────────────────────────────────────────────────── */

  api.get(
    '/state',
    route(async (_req, _res, workspaceId) => buildState(workspaceId)),
  )

  /* ── Ethara ──────────────────────────────────────────────────────────────── */

  api.post('/assistant/command', async (req, res) => {
    try {
      const workspaceId = await currentWorkspaceId()
      const body = parseBody(
        z.object({
          utterance: z.string().min(1),
          channel: z.enum(['text', 'voice', 'ambient', 'cron']).default('text'),
          conversationId: z.string().uuid().optional(),
          actor: z.string().optional(),
          role: z.enum(['marketing', 'leadership']).optional(),
          /**
           * What the operator is looking at. A screen-embedded assistant states
           * the post in focus so "make this shorter" needs no follow-up question.
           */
          focus: z
            .object({
              type: z.string().max(40),
              id: z.string().max(80),
              title: z.string().max(300).optional(),
              platform: platformSchema.optional(),
            })
            .optional(),
        }),
        req.body,
      )

      openStream(res)

      const send = (frame: CommandFrame): void => {
        res.write(`event: ${frame.kind}\ndata: ${JSON.stringify(frame)}\n\n`)
      }

      const result = await runCommand({
        workspaceId,
        utterance: body.utterance,
        channel: body.channel,
        ...(body.conversationId ? { conversationId: body.conversationId } : {}),
        actor: sessionOf(req)?.actor ?? body.actor ?? 'Operator',
        role: body.role ?? 'marketing',
        ...(body.focus === undefined ? {} : { focus: body.focus }),
        emit: send,
      })

      res.write(`event: end\ndata: ${JSON.stringify(result)}\n\n`)
      res.end()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ kind: 'error', message })}\n\n`)
        res.end()
      } else {
        res.status(400).json({ error: message })
      }
    }
  })

  api.post('/assistant/confirm', async (req, res) => {
    try {
      const workspaceId = await currentWorkspaceId()
      const body = parseBody(
        z.object({
          token: z.string().min(8),
          decision: z.enum(['confirm', 'cancel']),
          by: z.string().min(1),
          role: z.enum(['marketing', 'leadership']).optional(),
        }),
        req.body,
      )

      openStream(res)
      const send = (frame: CommandFrame): void => {
        res.write(`event: ${frame.kind}\ndata: ${JSON.stringify(frame)}\n\n`)
      }

      const result = await resumeConfirmed({
        workspaceId,
        token: body.token,
        decision: body.decision,
        by: body.by,
        role: body.role ?? 'marketing',
        emit: send,
      })

      res.write(`event: end\ndata: ${JSON.stringify(result)}\n\n`)
      res.end()
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (res.headersSent) {
        res.write(`event: error\ndata: ${JSON.stringify({ kind: 'error', message })}\n\n`)
        res.end()
      } else {
        res.status(400).json({ error: message })
      }
    }
  })

  api.get(
    '/assistant/conversation/:id',
    route(async (req) => conversationTranscript(String(req.params.id), 60)),
  )

  api.get(
    '/assistant/conversations',
    route(async (_req, _res, workspaceId) => ({
      conversations: await listConversations(workspaceId, 40),
    })),
  )

  api.get(
    '/assistant/brief',
    route(async (_req, _res, workspaceId) => ({
      brief: await latestBrief(workspaceId),
      notices: await sweepForNotices(workspaceId),
    })),
  )

  api.post(
    '/assistant/brief',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({ role: z.enum(['marketing', 'leadership']).default('marketing') }),
        req.body,
      )
      return {
        brief: await composeBrief(workspaceId, {
          trigger: 'manual',
          role: body.role,
          changesToReport: 3,
          includeRecommendation: true,
        }),
      }
    }),
  )

  api.get(
    '/assistant/suggestions',
    route(async (req) => {
      const q = typeof req.query.q === 'string' ? req.query.q : ''
      const matches = q.trim().length === 0 ? [] : matchTools(q).slice(0, 6)
      return {
        suggestions: matches.map((m) => {
          const spec = TOOL_BY_ID[m.toolId]
          return {
            toolId: m.toolId,
            name: spec?.name ?? m.toolId,
            summary: spec?.summary ?? '',
            risk: spec?.risk ?? 'safe',
            agentId: spec?.agentId ?? null,
            score: Math.round(m.score * 100),
            example: m.matchedExample,
          }
        }),
      }
    }),
  )

  /* ── KEYWORDS ────────────────────────────────────────────────────────────── */

  api.get(
    '/keywords',
    route(async (_req, _res, workspaceId) => ({
      keywords: await listKeywords(workspaceId, false),
      signals: await latestKeywordSignals(workspaceId),
    })),
  )

  api.post(
    '/keywords',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          term: z.string().min(2),
          category: z.enum(['Core', 'Adjacent', 'Positioning']).default('Adjacent'),
          weight: z.number().min(0).max(100).default(50),
        }),
        req.body,
      )
      const created = await createKeyword(workspaceId, body.term, body.category, body.weight)
      if (!created) throw new Error(`“${body.term}” is already in the keyword set.`)
      return { keyword: created }
    }),
  )

  api.patch(
    '/keywords/:id',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          term: z.string().min(2).optional(),
          category: z.enum(['Core', 'Adjacent', 'Positioning']).optional(),
          weight: z.number().min(0).max(100).optional(),
          active: z.boolean().optional(),
        }),
        req.body,
      )
      const updated = await updateKeyword(workspaceId, String(req.params.id), body)
      if (!updated) throw new Error('No such keyword.')
      return { keyword: updated }
    }),
  )

  api.delete(
    '/keywords/:id',
    route(async (req, _res, workspaceId) => ({
      // Deactivated, not deleted: historical signals keep a valid parent.
      deactivated: await deactivateKeyword(workspaceId, String(req.params.id)),
    })),
  )

  api.get(
    '/keywords/trending',
    route(async (_req, _res, workspaceId) => ({
      trending: await trendingKeywords(workspaceId, 5),
    })),
  )

  /* ── HASHTAGS ────────────────────────────────────────────────────────────── */

  api.get(
    '/hashtags',
    route(async (req, _res, workspaceId) => ({
      hashtags: await listHashtags(workspaceId, {
        ...(typeof req.query.status === 'string'
          ? { status: req.query.status as 'validated' }
          : {}),
        ...(typeof req.query.keywordId === 'string' ? { keywordId: req.query.keywordId } : {}),
        ...(req.query.top === 'true' ? { top: true } : {}),
        limit: Number(req.query.limit ?? 400),
      }),
    })),
  )

  api.get(
    '/hashtags/top',
    route(async (_req, _res, workspaceId) => ({
      topHashtags: await listHashtags(workspaceId, { top: true, limit: config.knowledge.hashtagCount }),
    })),
  )

  api.patch(
    '/hashtags/:id/validation',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          validation: z.enum(['pending', 'validated', 'needs_review', 'duplicate', 'rejected']),
          by: z.string().default('Ridhima'),
        }),
        req.body,
      )
      const id = String(req.params.id)
      const updated = await setHashtagValidation(
        workspaceId,
        id,
        body.validation,
        `Resolved by ${body.by}, overriding the automated verdict.`,
      )
      if (!updated) throw new Error('No such hashtag.')
      await resolveQueueForEntity(workspaceId, id, body.validation, body.by)
      await insertActivity({
        workspaceId,
        agentId: 'validation',
        message: `#${updated.display_tag} set to ${body.validation} by ${body.by}`,
        status: 'ok',
      })
      return { hashtag: updated }
    }),
  )

  /* ── PIPELINE ────────────────────────────────────────────────────────────── */

  api.post(
    '/pipeline/run',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          paceMs: z.number().min(0).max(4000).optional(),
          keywordIds: z.array(z.string().uuid()).optional(),
        }),
        req.body,
      )
      return runDiscoveryPipeline({
        workspaceId,
        trigger: 'api',
        ...(body.paceMs === undefined ? {} : { paceMs: body.paceMs }),
        ...(body.keywordIds === undefined ? {} : { keywordIds: body.keywordIds }),
      })
    }),
  )

  api.get(
    '/runs',
    route(async (_req, _res, workspaceId) => ({
      agentRuns: await listAgentRuns(workspaceId, 40),
      skillRuns: await listSkillRuns(workspaceId, 300),
      latest: await latestPipelineRun(workspaceId),
    })),
  )

  api.get(
    '/runs/:id/skills',
    route(async (req, _res, workspaceId) => ({
      skillRuns: await skillRunsForRun(workspaceId, String(req.params.id)),
    })),
  )

  api.patch(
    '/items/:id/validation',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          validation: z.enum(['pending', 'validated', 'needs_review', 'duplicate', 'rejected']),
          by: z.string().default('Ridhima'),
        }),
        req.body,
      )
      const id = String(req.params.id)
      const updated = await setItemValidation(
        workspaceId,
        id,
        body.validation,
        `Resolved by ${body.by}, overriding the automated verdict.`,
      )
      if (!updated) throw new Error('No such item.')
      await resolveQueueForEntity(workspaceId, id, body.validation, body.by)
      return { item: updated }
    }),
  )

  /* ── KNOWLEDGE ───────────────────────────────────────────────────────────── */

  api.post(
    '/knowledge/build',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          hashtagCount: z.number().min(1).max(60).optional(),
          forceRefresh: z.boolean().optional(),
        }),
        req.body,
      )
      return buildKnowledge({
        workspaceId,
        trigger: 'manual',
        ...(body.hashtagCount === undefined ? {} : { hashtagCount: body.hashtagCount }),
        ...(body.forceRefresh === undefined ? {} : { forceRefresh: body.forceRefresh }),
      })
    }),
  )

  api.get(
    '/knowledge/builds',
    route(async (_req, _res, workspaceId) => ({
      builds: await listKnowledgeBuilds(workspaceId, 12),
      latest: await latestKnowledgeBuild(workspaceId),
    })),
  )

  api.post(
    '/knowledge',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          title: z.string().min(3),
          category: z.string().min(2).default('User Feedback'),
          content: z.string().min(3),
          confidence: z.enum(['High', 'Medium', 'Low']).default('Medium'),
          tags: z.array(z.string().min(2).max(40)).max(12).optional(),
        }),
        req.body,
      )
      const inserted = await insertKnowledgeEntry({
        workspaceId,
        title: body.title,
        category: body.category,
        content: body.content,
        source: 'Manual entry',
        sources: [],
        hashtagId: null,
        confidence: body.confidence,
        origin: 'manual',
        buildId: null,
        tags: body.tags ?? [],
      })
      return { entry: inserted }
    }),
  )

  /* ── THE BRAND CORPUS ─────────────────────────────────────────────────────
     The corpus is the half of the Knowledge Base that says what this company
     talks about, as opposed to the rules that say how to write. It gets its own
     routes because it is the vocabulary the Scraping Agent scores every captured
     page against: adding a corpus entry changes what the next run admits, and
     that is a different operator intention from filing a research finding.
     ──────────────────────────────────────────────────────────────────────── */

  api.get(
    '/knowledge/corpus',
    route(async (_req, _res, workspaceId) => {
      const [entries, rules, keywords] = await Promise.all([
        listKnowledge(workspaceId, { tag: BRAND_CORPUS_TAG, limit: 200 }),
        listKnowledge(workspaceId, { tag: BRAND_RULE_TAG, limit: 200 }),
        listKeywords(workspaceId, true),
      ])

      // Exactly what alignment will read: corpus tags, minus the two bookkeeping
      // tags, plus the declared keyword terms and their synonyms.
      const vocabulary = new Set<string>()
      for (const entry of entries) {
        if (!entry.active) continue
        // Identity entries (voice, audience, visual) are corpus but not subject
        // matter, so they never reach alignment. See BRAND_DOMAIN_TAG.
        if (!entry.tags.includes(BRAND_DOMAIN_TAG)) continue
        for (const tag of entry.tags) {
          if (tag === 'brand' || tag === BRAND_CORPUS_TAG || tag === BRAND_DOMAIN_TAG) continue
          vocabulary.add(tag.toLowerCase())
        }
      }
      const keywordTerms = new Set<string>()
      for (const keyword of keywords) {
        keywordTerms.add(keyword.term.toLowerCase())
        for (const synonym of synonymsFor(keyword.term)) keywordTerms.add(synonym.toLowerCase())
      }

      return {
        entries,
        stats: {
          total: entries.length,
          active: entries.filter((e) => e.active).length,
          /** Subject-matter entries — the only ones that reach alignment. */
          domain: entries.filter((e) => e.tags.includes(BRAND_DOMAIN_TAG)).length,
          rules: rules.length,
          brandTopics: BRAND_TOPICS.length,
          corpusTerms: vocabulary.size,
          keywordTerms: keywordTerms.size,
          /** What the Scraping Agent will actually judge against on the next run. */
          alignmentTerms: BRAND_TOPICS.length + vocabulary.size + keywordTerms.size,
        },
        /** The declared defaults, so the UI can show what a reseed would restore. */
        available: BRAND_CORPUS.map((entry) => ({
          title: entry.title,
          category: entry.category,
          tags: entry.tags,
          keyPoints: entry.keyPoints,
          domain: entry.domain,
        })),
      }
    }),
  )

  api.post(
    '/knowledge/corpus',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          title: z.string().min(3),
          category: z.string().min(2).default('Brand Corpus'),
          content: z.string().min(3),
          confidence: z.enum(['High', 'Medium', 'Low']).default('High'),
          /** Domain vocabulary. This is the part that reaches the Scraping Agent. */
          tags: z.array(z.string().min(2).max(40)).min(1).max(20),
          keyPoints: z.array(z.string().min(3)).max(12).optional(),
          /**
           * Whether this entry is subject matter. True by default: an operator
           * adding domain terms is the common case, and it is the only case that
           * changes what discovery admits.
           */
          domain: z.boolean().default(true),
        }),
        req.body,
      )

      const keyPoints = (body.keyPoints ?? []).filter((p) => p.trim().length > 0)
      const content =
        keyPoints.length > 0
          ? `${body.content}\n\nKey points:\n${keyPoints.map((p) => `- ${p}`).join('\n')}`
          : body.content

      const inserted = await insertKnowledgeEntry({
        workspaceId,
        title: body.title,
        category: body.category,
        content,
        source: 'Brand corpus',
        sources: [],
        hashtagId: null,
        confidence: body.confidence,
        // `brand` rather than `manual`: retrieval already prioritises brand
        // origin, and this entry is a statement of what the company is about.
        origin: 'brand',
        buildId: null,
        tags: [
          'brand',
          BRAND_CORPUS_TAG,
          ...(body.domain ? [BRAND_DOMAIN_TAG] : []),
          ...body.tags.map((t) => t.trim().toLowerCase()),
        ],
      })

      return {
        entry: inserted,
        appliesTo: body.domain
          ? 'The next discovery run scores captured pages against it.'
          : 'Stored as brand knowledge. It grounds generation but does not decide which pages are on topic.',
      }
    }),
  )

  /**
   * The upload door into the corpus. Files are written under `corpus/uploads/`
   * — the same folder the ingest script walks — and ingested on the spot, so an
   * upload and a `git add corpus/` are indistinguishable in the store.
   */
  api.post(
    '/knowledge/corpus/upload',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          files: z
            .array(
              z.object({
                name: z.string().min(1).max(200),
                /** Base64 of the raw bytes. JSON keeps the route inside the one body parser the API has. */
                content: z.string().min(1),
              }),
            )
            .min(1)
            .max(20),
        }),
        req.body,
      )

      const uploadDir = join(CORPUS_DIR, 'uploads')
      mkdirSync(uploadDir, { recursive: true })

      const written: string[] = []
      const refused: Array<{ file: string; detail: string }> = []
      for (const file of body.files) {
        // Just the leaf name, sanitised: a path in the name never walks the tree.
        const safe = basename(file.name).replace(/[^\w.\- ()]+/g, '_').trim()
        if (safe.length === 0 || !isSupportedCorpusFile(safe)) {
          refused.push({ file: file.name, detail: `not a supported type (${SUPPORTED_EXTENSIONS.join(', ')})` })
          continue
        }
        const target = join(uploadDir, safe)
        writeFileSync(target, Buffer.from(file.content, 'base64'))
        written.push(target)
      }

      const report = written.length > 0 ? await ingestCorpusFiles(workspaceId, written) : { inserted: 0, skipped: 0, deactivated: 0, files: [] }

      const unreadable = report.files.filter((f) => f.outcome === 'unreadable').length + refused.length
      const summary =
        `${report.inserted > 0 ? `Stored ${report.inserted} section${report.inserted === 1 ? '' : 's'}` : 'Nothing new stored'}` +
        `${report.skipped > 0 ? `, ${report.skipped} already known` : ''}` +
        `${report.deactivated > 0 ? `, ${report.deactivated} superseded switched off` : ''}` +
        `${unreadable > 0 ? `; ${unreadable} file${unreadable === 1 ? '' : 's'} could not be read` : ''}.`

      return {
        ...report,
        files: [...report.files, ...refused.map((r) => ({ file: r.file, sections: 0, outcome: 'unreadable' as const, detail: r.detail }))],
        summary,
      }
    }),
  )

  /**
   * Restores any declared corpus entry that is missing.
   *
   * Additive by design: an entry the operator edited or switched off is left
   * exactly as it is, because silently reinstating a decision someone made on
   * purpose is the kind of behaviour that makes a system untrustworthy.
   */
  api.post(
    '/knowledge/corpus/restore',
    route(async (_req, _res, workspaceId) => {
      const existing = await listKnowledge(workspaceId, { tag: BRAND_CORPUS_TAG, limit: 200 })
      const have = new Set(existing.map((e) => e.title))

      const restored: string[] = []
      for (const seed of brandCorpusAsKnowledge()) {
        if (have.has(seed.title)) continue
        await insertKnowledgeEntry({
          workspaceId,
          title: seed.title,
          category: seed.category,
          content: seed.content,
          source: 'Brand corpus',
          sources: [],
          hashtagId: null,
          confidence: seed.confidence,
          origin: 'brand',
          buildId: null,
          tags: seed.tags,
        })
        restored.push(seed.title)
      }

      return {
        restored,
        skipped: existing.length,
        reason:
          restored.length === 0
            ? `All ${existing.length} declared corpus entries are already present. Nothing was changed.`
            : `Restored ${restored.length} missing corpus entr${restored.length === 1 ? 'y' : 'ies'}. ${existing.length} existing entr${existing.length === 1 ? 'y was' : 'ies were'} left untouched.`,
      }
    }),
  )

  // There is deliberately no DELETE route for knowledge. Entries deactivate.
  api.patch(
    '/knowledge/:id',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(z.object({ active: z.boolean() }), req.body)
      const updated = await setKnowledgeActive(workspaceId, String(req.params.id), body.active)
      if (!updated) throw new Error('No such entry.')
      return { entry: updated }
    }),
  )

  /* ── IDEAS AND CONTENT ───────────────────────────────────────────────────── */

  api.get(
    '/ideas',
    route(async (req, _res, workspaceId) => ({
      // Calendar topics only — there is no suggestion list to return.
      ideas: await listIdeas(workspaceId, {
        ...(typeof req.query.platform === 'string'
          ? { platform: req.query.platform as Platform }
          : {}),
        slot: 'primary',
        limit: Number(req.query.limit ?? 200),
      }),
    })),
  )

  api.post(
    '/ideas/:id/draft',
    longRoute(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          platform: platformSchema.optional(),
          withImage: z.boolean().optional(),
          /*
           * THE EDIT INSTRUCTION.
           *
           * This was absent from the schema, so zod stripped it silently: an
           * operator asking to "make it shorter and more CTO-focused" got a
           * regenerated caption that had never seen the request, and the length
           * moved in whatever direction the fresh generation happened to land.
           * The change looked like obedience and was coincidence.
           */
          instruction: z.string().max(2_000).optional(),
          references: z.array(referenceSchema).max(8).optional(),
        }),
        req.body,
      )

      // An attached image is read by the vision model and described to the
      // writer, so a moodboard influences the words rather than being named and
      // dropped. `caption` intent asks what the picture DEPICTS.
      const referenceNote = await describeReferencesForPrompt(body.references, 'caption')
      const instruction = `${body.instruction ?? ''}${referenceNote}`.trim()

      /*
       * An instruction REVISES; its absence GENERATES. `applyInstruction` is the
       * revision path — it rewrites the existing draft against what was asked and
       * raises a finding when the request conflicts with a brand rule, rather
       * than resolving the conflict silently. Regenerating instead would discard
       * the operator's words, which is what happened before.
       */
      if (instruction !== '') {
        // `platform` is required by the revision path, so it is resolved from the
        // idea when the caller did not name one.
        const target = await getIdea(workspaceId, String(req.params.id))
        if (!target) throw new Error('No such idea.')
        return applyInstruction({
          workspaceId,
          trigger: 'api',
          ideaId: target.id,
          platform: body.platform ?? target.platform,
          instruction,
          ...(body.references === undefined
            ? {}
            : { references: body.references.map(toReference) }),
        })
      }

      return generateDraft({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        ...(body.platform === undefined ? {} : { platform: body.platform }),
        ...(body.withImage === undefined ? {} : { withImage: body.withImage }),
      })
    }),
  )

  api.post(
    '/ideas/:id/image',
    longRoute(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          platform: platformSchema,
          model: z.enum(IMAGE_MODEL_IDS).optional(),
          prompt: z.string().optional(),
          instruction: z.string().optional(),
          references: z.array(referenceSchema).max(8).optional(),
        }),
        req.body,
      )

      // The painters take a prompt, not an image, so a textual reference folds
      // into the instruction and an attached picture is named rather than sent.
      // Saying which happened beats silently discarding the file.
      const referenceNote = await describeReferencesForPrompt(body.references, 'image')
      const instruction =
        body.instruction === undefined && referenceNote === ''
          ? undefined
          : `${body.instruction ?? ''}${referenceNote}`.trim()

      const media = await renderIdeaImage({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        platform: body.platform,
        ...(body.model === undefined ? {} : { model: body.model }),
        ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
        ...(instruction === undefined ? {} : { instruction }),
      })
      return { media }
    }),
  )

  api.post(
    '/ideas/:id/instruct',
    longRoute(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          platform: platformSchema,
          instruction: z.string().min(2),
          model: z.enum(TEXT_MODEL_IDS).optional(),
          references: z.array(referenceSchema).max(8).optional(),
        }),
        req.body,
      )
      const result = await applyInstruction({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        platform: body.platform,
        instruction: body.instruction,
        ...(body.model === undefined ? {} : { captionModel: body.model }),
        ...(body.references === undefined ? {} : { references: body.references.map(toReference) }),
      })
      return {
        draft: result.draft,
        applied: result.applied,
        note: result.note,
        compliance: result.compliance,
        preference: result.preference,
        conflicts: result.conflicts,
        diffSummary: result.diffSummary,
        skills: result.skills,
      }
    }),
  )

  /*
   * REVERT — the operator's undo.
   *
   * The step is named by its `at` stamp rather than a revision number: an
   * instruction that changed nothing leaves the number where it was, so a
   * number can address two entries and a stamp addresses exactly one.
   */
  api.post(
    '/ideas/:id/revert',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          platform: platformSchema,
          at: z.string().min(1),
        }),
        req.body,
      )
      return revertDraft({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        platform: body.platform,
        at: body.at,
      })
    }),
  )

  api.patch(
    '/ideas/:id',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          date: z.string().optional(),
          time: z.string().optional(),
          platform: platformSchema.optional(),
          status: z
            .enum([
              'suggested',
              'drafted',
              'in_review',
              'pending_leadership',
              'approved',
              'scheduled',
              'published',
              'rejected',
            ])
            .optional(),
          draft: z.string().optional(),
          /** A topic's own line, edited in the Topic Queue. Editing never writes a post. */
          title: z.string().trim().min(3).max(200).optional(),
        }),
        req.body,
      )

      const id = String(req.params.id)
      const idea = await getIdea(workspaceId, id)
      if (!idea) throw new Error('No such idea.')

      const updated = await updateIdea(workspaceId, id, {
        ...(body.date === undefined ? {} : { scheduledDate: body.date }),
        ...(body.time === undefined ? {} : { scheduledTime: body.time }),
        ...(body.platform === undefined ? {} : { platform: body.platform }),
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.title === undefined ? {} : { title: body.title }),
      })

      if (body.draft !== undefined) {
        await upsertDraft({
          ideaId: id,
          platform: body.platform ?? idea.platform,
          body: body.draft,
          generatedBy: 'operator',
          model: 'manual',
          source: 'fixture',
        })
      }

      return { ok: true, idea: updated }
    }),
  )

  /*
   * GENERATE POST — one topic, on demand.
   *
   * Future dates hold a validated topic only. This writes the complete post —
   * caption, hashtags, creative — for the ONE topic named, and never overwrites
   * an existing post unless `regenerate` is sent explicitly.
   */
  api.post(
    '/ideas/:id/generate-post',
    longRoute(async (req, _res, workspaceId) => {
      const body = parseBody(z.object({ regenerate: z.boolean().optional() }), req.body ?? {})
      return generatePostForTopic({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        ...(body.regenerate === undefined ? {} : { regenerate: body.regenerate }),
      })
    }),
  )

  /*
   * REORDER THE TOPIC QUEUE.
   *
   * The queue's dates and times are its slots; reordering hands those same
   * slots to the topics in the new order, so moving a topic up gives it an
   * earlier date. Only topics with no post yet, dated after the post-ready
   * horizon, can be reordered — a written post keeps its date.
   */
  api.post(
    '/calendar/topic-queue/order',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(z.object({ ids: z.array(z.string().uuid()).min(2).max(200) }), req.body)
      if (new Set(body.ids).size !== body.ids.length) throw new Error('A topic appears twice in the new order.')
      const horizon = await resolveCalendarHorizon(workspaceId)
      const topics: IdeaRow[] = []
      for (const id of body.ids) {
        const idea = await getIdea(workspaceId, id)
        if (!idea) throw new Error('No such topic.')
        const date = String(idea.scheduled_date).slice(0, 10)
        if (idea.status !== 'suggested' || idea.calendar_slot !== 'primary') {
          throw new Error(`“${idea.title}” already has a post, so it keeps its date.`)
        }
        if (date <= horizon.today || horizon.postReadyDates.includes(date)) {
          throw new Error(`“${idea.title}” is post-ready (${date}), not in the Topic Queue.`)
        }
        topics.push(idea)
      }
      const slots = topics
        .map((t) => ({ date: String(t.scheduled_date).slice(0, 10), time: t.scheduled_time }))
        .sort((a, b) => a.date.localeCompare(b.date) || labelToMinutes(a.time) - labelToMinutes(b.time))
      let moved = 0
      for (const [index, topic] of topics.entries()) {
        const slot = slots[index]
        if (!slot) continue
        if (slot.date === String(topic.scheduled_date).slice(0, 10) && slot.time === topic.scheduled_time) continue
        await updateIdea(workspaceId, topic.id, { scheduledDate: slot.date, scheduledTime: slot.time })
        moved += 1
      }
      return { ok: true, moved }
    }),
  )

  api.delete(
    '/ideas/:id',
    route(async (req, _res, workspaceId) => ({
      // Withdrawn, not deleted: the lineage stays reconstructable.
      withdrawn: await withdrawIdea(workspaceId, String(req.params.id)),
    })),
  )

  api.post(
    '/ideas/:id/approve',
    route(async (req, res, workspaceId) => {
      // The FIRST of two signatures. Marketing only — and `by` comes from the
      // session, not the body, so a caller cannot sign as someone else.
      const session = sessionOf(req)
      if (!requireRole(res, session, ['marketing'])) return undefined
      const idea = await approveMarketing({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        by: session?.actor ?? '',
      })
      return { idea }
    }),
  )

  api.post(
    '/ideas/:id/leadership/approve',
    route(async (req, res, workspaceId) => {
      // The SECOND signature. Leadership only, so one account cannot supply both.
      const session = sessionOf(req)
      if (!requireRole(res, session, ['leadership'])) return undefined
      const body = parseBody(z.object({ publish: z.boolean().default(true) }), req.body)
      return decideLeadership({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        decision: 'approved',
        by: session?.actor ?? '',
        publish: body.publish,
      })
    }),
  )

  api.post(
    '/ideas/:id/leadership/reject',
    route(async (req, res, workspaceId) => {
      // The reason is mandatory, enforced here as well as in the repository.
      const session = sessionOf(req)
      if (!requireRole(res, session, ['leadership'])) return undefined
      const parsed = z.object({ reason: z.string().min(1) }).safeParse(req.body ?? {})
      if (!parsed.success) {
        throw new Error('A rejection needs a reason — it is what the agents learn from.')
      }
      return decideLeadership({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        decision: 'rejected',
        by: session?.actor ?? '',
        reason: parsed.data.reason,
      })
    }),
  )

  api.post(
    '/ideas/:id/publish',
    route(async (req, res, workspaceId) => {
      if (!requireRole(res, sessionOf(req), ['marketing', 'leadership'])) return undefined
      const body = parseBody(z.object({ platform: platformSchema.optional() }), req.body)
      return publishIdea({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        ...(body.platform === undefined ? {} : { platform: body.platform }),
      })
    }),
  )

  /* ── ANALYTICS, IMAGES, LINEAGE, REVIEW ──────────────────────────────────── */

  api.post(
    '/analytics/refresh',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({ platform: platformSchema.optional(), month: z.string().optional() }),
        req.body,
      )
      const payload = await refreshAnalytics({
        workspaceId,
        trigger: 'api',
        ...(body.platform === undefined ? {} : { platform: body.platform }),
        ...(body.month === undefined ? {} : { month: body.month }),
      })
      return {
        baselines: payload.baselines,
        comparison: payload.comparison,
        explanation: payload.explanation,
        report: payload.report,
        exports: payload.exports,
      }
    }),
  )

  api.get(
    '/image-models',
    route(async () => ({
      models: IMAGE_MODELS.map((spec) => {
        const status = availableImageModels().find((m) => m.id === spec.id)
        return { ...spec, configured: status?.configured ?? false, reason: status?.reason ?? '' }
      }),
    })),
  )

  api.get(
    '/lineage/:type/:id',
    route(async (req, _res, workspaceId) => ({
      edges: await traceLineage(workspaceId, String(req.params.type), String(req.params.id), 8),
    })),
  )

  api.get(
    '/review-queue',
    route(async (req, _res, workspaceId) => ({
      queue: await listReviewQueue(workspaceId, req.query.resolved === 'true'),
    })),
  )

  api.post(
    '/review-queue/:id/resolve',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({ outcome: z.string().min(1), by: z.string().min(1) }),
        req.body,
      )
      const row = await resolveReviewQueueRow(workspaceId, String(req.params.id), body.outcome, body.by)
      if (!row) throw new Error('That queue item does not exist, or it is already resolved.')

      if (row.kind === 'hashtag' && row.entity_id) {
        await setHashtagValidation(
          workspaceId,
          row.entity_id,
          /approve|validate|keep/i.test(body.outcome) ? 'validated' : 'rejected',
          `${body.outcome} by ${body.by} — ${row.reason}`,
        )
      }
      if (row.kind === 'scraped_item' && row.entity_id) {
        await setItemValidation(
          workspaceId,
          row.entity_id,
          /approve|validate|keep/i.test(body.outcome) ? 'validated' : 'rejected',
          `${body.outcome} by ${body.by} — ${row.reason}`,
        )
      }

      return { queueItem: row }
    }),
  )

  /* ── TRENDS — the trending set, with the URLs to open ────────────────── */

  async function trendsPayload(workspaceId: string) {
    const [keywords, hashtags] = await Promise.all([
      trendingKeywords(workspaceId, 5),
      listHashtags(workspaceId, { top: true, limit: config.knowledge.hashtagCount }),
    ])
    return {
      generatedAt: new Date().toISOString(),
      keywords: keywords.map((r, i) => ({
        rank: r.rank ?? i + 1,
        term: r.term,
        trendScore: r.trend_score,
        postCount: r.post_count,
        totalEngagement: r.total_engagement,
        growthPct: Number(r.growth_pct),
        reason: r.trend_reason,
        searchUrl: r.search_url,
        topPostUrl: r.top_post_url,
        topPostTitle: r.top_post_title,
      })),
      hashtags: hashtags.map((r, i) => ({
        rank: r.rank ?? i + 1,
        tag: `#${r.display_tag}`,
        keyword: r.keyword_term,
        score: r.hashtag_score,
        postCount: r.post_count,
        engagementPerPost: Number(r.engagement_per_post),
        validation: r.validation,
        feedUrl: r.feed_url ?? `https://www.linkedin.com/feed/hashtag/${encodeURIComponent(r.tag)}/`,
        topPostUrl: r.top_post_url,
        topPostTitle: r.top_post_title,
      })),
    }
  }

  api.get(
    '/trends',
    route(async (_req, _res, workspaceId) => trendsPayload(workspaceId)),
  )

  api.get('/trends.csv', async (_req, res) => {
    try {
      const payload = await trendsPayload(await currentWorkspaceId())
      const cell = (v: unknown): string => {
        const t = v === null || v === undefined ? '' : String(v)
        return /[",\n]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t
      }
      const lines = ['kind,rank,name,keyword,score,posts,url,top_post_url,top_post_title,reason']
      for (const k of payload.keywords) {
        lines.push(
          ['keyword', k.rank, k.term, '', k.trendScore, k.postCount, k.searchUrl, k.topPostUrl, k.topPostTitle, k.reason]
            .map(cell)
            .join(','),
        )
      }
      for (const h of payload.hashtags) {
        lines.push(
          ['hashtag', h.rank, h.tag, h.keyword, h.score, h.postCount, h.feedUrl, h.topPostUrl, h.topPostTitle, '']
            .map(cell)
            .join(','),
        )
      }
      res.setHeader('Content-Type', 'text/csv; charset=utf-8')
      res.setHeader('Content-Disposition', 'attachment; filename="ethara-trends.csv"')
      res.send(lines.join('\r\n'))
    } catch (error) {
      res.status(500).json({ error: error instanceof Error ? error.message : String(error) })
    }
  })

  /* ── THE PYTHON AGENT BACKEND ────────────────────────────────────────────
     The agents live in `backend/`, one folder each. This spawns the workflow
     and streams its NDJSON events straight through as SSE, so the UI sees each
     agent start and finish in real time. There is no second HTTP server and no
     shared runtime — the process boundary is the interface. */

  /** Runs one backend command and parses its NDJSON. Never throws on bad output. */
  function runAgentCommand(args: string[], timeoutMs = 300_000): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      // Resolved and existence-checked here rather than at module load, so a
      // venv created after the API started is picked up without a restart —
      // and so a missing one is a named reason instead of a spawn ENOENT.
      const resolvedSpawn = agentSpawn(args)
      if ('error' in resolvedSpawn) {
        reject(new Error(resolvedSpawn.error))
        return
      }

      const child = spawn(resolvedSpawn.python, resolvedSpawn.args, { cwd: resolvedSpawn.cwd })
      const frames: Record<string, unknown>[] = []
      let stderr = ''
      let buffer = ''

      const timer = setTimeout(() => {
        child.kill()
        reject(new Error(`The agent backend did not finish within ${timeoutMs}ms.`))
      }, timeoutMs)

      child.stdout.on('data', (chunk: Buffer) => {
        buffer += chunk.toString()
        const lines = buffer.split('\n')
        buffer = lines.pop() ?? ''
        for (const line of lines) {
          if (!line.trim()) continue
          try {
            frames.push(JSON.parse(line) as Record<string, unknown>)
          } catch {
            // A malformed line costs one frame, never the run.
          }
        }
      })
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString()
      })
      child.on('error', (error) => {
        clearTimeout(timer)
        reject(new Error(`Could not start the agent backend: ${error.message}. Is backend/.venv present?`))
      })
      child.on('close', () => {
        clearTimeout(timer)
        if (frames.length === 0 && stderr) reject(new Error(stderr.trim().split('\n').slice(-3).join(' ')))
        else resolve(frames)
      })
    })
  }

  /** The roster, its contracts and every declared knob. */
  api.get(
    '/agents',
    route(async () => {
      const frames = await runAgentCommand(['agents'], 30_000)
      return frames.find((f) => f.event === 'agents') ?? { error: 'The backend returned no roster.' }
    }),
  )

  /** The Knowledge Base — the brain every agent reads before it acts. */
  api.get(
    '/agents/brain',
    route(async () => {
      const frames = await runAgentCommand(['brain'], 30_000)
      return frames.find((f) => f.event === 'brain') ?? { entries: [], stats: {} }
    }),
  )

  /**
   * Runs the workflow, streaming each agent's start and finish as SSE.
   *
   * Every frame is also mirrored onto the global event bus, so the activity feed
   * and the Orchestration screen light up without subscribing separately.
   */
  api.post('/agents/run', async (req, res) => {
    const body = parseBody(
      z.object({
        keywords: z.array(z.string().min(2)).min(1),
        overrides: z.record(z.record(z.union([z.string(), z.number(), z.boolean()]))).optional(),
        stopAfter: z.string().optional(),
      }),
      req.body,
    )

    openStream(res)

    const args = ['run', '--keywords', body.keywords.join(',')]
    if (body.overrides) args.push('--overrides', JSON.stringify(body.overrides))
    if (body.stopAfter) args.push('--stop-after', body.stopAfter)

    /*
     * THE CHECK THAT TURNS A DEAD STREAM INTO AN ANSWER.
     *
     * This route holds an SSE connection open for the whole run, so a spawn
     * failure used to arrive as `error` with "spawn ENOENT" — or, worse, as a
     * stream that simply stopped producing frames, which the activity feed shows
     * as an agent run that started and never finished. Resolving first means an
     * absent interpreter is a single frame naming the key and the fix.
     */
    const resolvedSpawn = agentSpawn(args)
    if ('error' in resolvedSpawn) {
      res.write(
        `event: error\ndata: ${JSON.stringify({
          message: `The agent backend cannot run — ${resolvedSpawn.error}`,
        })}\n\n`,
      )
      res.write(`event: end\ndata: ${JSON.stringify({ code: 1 })}\n\n`)
      res.end()
      return
    }

    const child = spawn(resolvedSpawn.python, resolvedSpawn.args, { cwd: resolvedSpawn.cwd })
    let buffer = ''
    let finished = false

    // The run's own writes to Postgres. `close` waits on this, so `end` is only
    // sent once what the agents produced is durable — an operator who sees the
    // run finish and refetches state gets the run, not the state before it.
    let persisting: Promise<unknown> = Promise.resolve()

    const forward = (frame: Record<string, unknown>): void => {
      res.write(`event: ${String(frame.event)}\ndata: ${JSON.stringify(frame)}\n\n`)
      const event = String(frame.event)
      if (event === 'agent.started' || event === 'agent.finished') {
        publish({
          type: event === 'agent.started' ? 'agent.started' : 'agent.finished',
          agentId: String(frame.agent_id ?? ''),
          message: String(frame.summary ?? frame.name ?? ''),
        })
      }
      if (event === 'workflow.output') {
        persisting = persistAgentRun(frame)
          .then((written) => {
            res.write(`event: agents.persisted\ndata: ${JSON.stringify(written)}\n\n`)
            // Law 8. The client reconciles by refetching `/state`; this only
            // tells it that there is now something new to refetch.
            publish({
              type: 'pipeline.finished',
              runId: written.runId,
              message:
                `${written.ideasCreated} idea(s) written, ${written.ideasUpdated} updated, ` +
                `${written.hashtags} hashtag(s) and ${written.signals} keyword signal(s) recorded.`,
              data: { ...written },
            })
          })
          .catch((error: unknown) => {
            // Reported, never swallowed. A run whose output did not land is a
            // run the operator must know about, because the screen will look
            // exactly like a run that never happened.
            const message = error instanceof Error ? error.message : String(error)
            res.write(
              `event: agents.persist_failed\ndata: ${JSON.stringify({
                message: `The agents finished but their output could not be written: ${message}`,
              })}\n\n`,
            )
          })
      }
    }

    child.stdout.on('data', (chunk: Buffer) => {
      buffer += chunk.toString()
      const lines = buffer.split('\n')
      buffer = lines.pop() ?? ''
      for (const line of lines) {
        if (!line.trim()) continue
        try {
          forward(JSON.parse(line) as Record<string, unknown>)
        } catch {
          // A malformed line costs one frame, never the stream.
        }
      }
    })

    child.stderr.on('data', (chunk: Buffer) => {
      res.write(`event: stderr\ndata: ${JSON.stringify({ message: chunk.toString() })}\n\n`)
    })

    child.on('error', (error) => {
      res.write(`event: error\ndata: ${JSON.stringify({ message: `Could not start the agent backend: ${error.message}` })}\n\n`)
      res.end()
    })

    child.on('close', (code) => {
      finished = true
      void persisting.finally(() => {
        res.write(`event: end\ndata: ${JSON.stringify({ code })}\n\n`)
        res.end()
      })
    })

    // The kill guard belongs on the RESPONSE, not the request: `req` closes as
    // soon as the POST body has been read, which would kill the child before it
    // had produced a single frame. Only an operator disconnecting should stop it.
    res.on('close', () => {
      if (!finished) child.kill()
    })
  })

  api.get(
    '/brand',
    route(async () => ({ brand: BRAND, rules: BRAND_RULES })),
  )

  /* ── SSE ─────────────────────────────────────────────────────────────────── */

  api.get('/events', (req, res) => {
    res.status(200)
    res.setHeader('Content-Type', 'text/event-stream')
    res.setHeader('Cache-Control', 'no-cache, no-transform')
    res.setHeader('Connection', 'keep-alive')
    res.setHeader('X-Accel-Buffering', 'no')
    res.flushHeaders?.()

    res.write(`event: hello\ndata: ${JSON.stringify({ at: new Date().toISOString(), replay: REPLAY_SIZE })}\n\n`)

    // Catch the fresh connection up, then stream. Liveness is restored; the
    // client still reconciles correctness by refetching /state.
    for (const event of recentEvents(REPLAY_SIZE)) {
      res.write(toSseFrame(event))
    }

    const unsubscribe = subscribe((event) => {
      res.write(toSseFrame(event))
    })

    const ping = setInterval(() => {
      res.write(': ping\n\n')
    }, 25_000)

    req.on('close', () => {
      clearInterval(ping)
      unsubscribe()
      res.end()
    })
  })

  /* ── CLAUDE BRIDGE · LinkedIn trend intelligence ─────────────────────────── */
  /*
   * The same pipeline the Claude Code tool runs, for the app: trends read from
   * the Knowledge Base, brand voice and keyword configuration, newest first.
   * A long route because a live run drives Claude Code web searches.
   * `?format=markdown` adds the rendered table beside the JSON.
   */
  api.post(
    '/bridges/linkedin-trends',
    longRoute(async (req) => {
      const input = parseBody(trendToolInputSchema, req.body)
      const output = await runTrendIntelligence({ input, mode: 'tool' })
      return req.query.format === 'markdown' ? { ...output, markdown: renderMarkdown(output) } : output
    }),
  )

  /*
   * Platform-level trend discovery on its own — the Scraping Agent's capture
   * without the rest of the pipeline. Reads only; writes nothing.
   */
  /*
   * THE SOCIAL MEDIA LISTENER (Analysis Agent · analysis.social.listen).
   *
   * GET returns the latest report; POST runs the skill now, always fresh, and
   * returns what it produced. SocialFetch is the only data source; the report
   * states the credits it spent and the sample it rests on.
   */
  api.get(
    '/analysis/social-listener',
    route(async (_req, _res, workspaceId) => {
      const latest = await latestListenerReport(workspaceId)
      return {
        configured: socialFetchConfigured(),
        reason: socialFetchUnavailableReason(),
        report: latest?.report ?? null,
        createdAt: latest?.created_at ?? null,
      }
    }),
  )

  /*
   * GLASSDOOR ONLY — refresh the listener report's Glassdoor block without
   * re-reading the social platforms (which spends SocialFetch credits). The
   * latest report is kept as it is; a new report row is saved with the fresh
   * Glassdoor block beside the same platform data, so history stays intact.
   */
  api.post(
    '/analysis/social-listener/glassdoor',
    longRoute(async (_req, _res, workspaceId) => {
      if (!fetchLayerConfigured()) throw new HttpError(503, fetchLayerUnavailableReason() ?? 'FetchLayer is not configured.')
      const skill = SKILL_BY_ID['analysis.social.listen']
      if (!skill) throw new Error('The Social Media Listener skill is not registered.')
      const overrides = await listSkillOverrides(workspaceId)
      const knobs = resolveConfig(skill, overrides.get(skill.id)?.config, undefined)
      if (knobs.includeGlassdoor === false) throw new HttpError(409, 'Glassdoor is switched off in the Social Media Listener settings.')
      const glassdoor = await fetchGlassdoor({
        employer: String(knobs.glassdoorEmployer ?? 'Ethara.AI'),
        reviewLimit: Number(knobs.glassdoorReviewLimit ?? 15),
      })
      const latest = await latestListenerReport<SocialMediaListener>(workspaceId)
      if (!latest) {
        // No platform report to sit beside yet: say so rather than inventing an empty one.
        return { glassdoor, saved: false, reason: 'No Social Media Listener report exists yet — run the listener once to attach Glassdoor to it.' }
      }
      const report: SocialMediaListener = { ...latest.report, glassdoor }
      // Glassdoor feeds the reputation, so the ORM layer is re-read with it.
      const orm = await buildReputation(report, listenerClaudeOptions(knobs))
      report.answers = orm.answers
      report.reputation = orm.reputation
      await insertListenerReport(workspaceId, report, { trigger: 'glassdoor', creditsUsed: 0 })
      publish({
        type: 'activity',
        agentId: 'analysis',
        message:
          glassdoor.status === 'ok'
            ? `Social Media Listener · Glassdoor refreshed: ${glassdoor.overall_rating ?? '—'}/5 · ${glassdoor.reviews_analyzed} review(s) read`
            : `Social Media Listener · Glassdoor: ${glassdoor.reason ?? glassdoor.status}`,
        data: { status: glassdoor.status === 'ok' ? 'ok' : 'warn' },
      })
      return { glassdoor, saved: true }
    }),
  )

  /*
   * REPUTATION ONLY — re-run the ORM layer (and the three answers) over the
   * latest stored report: no SocialFetch or FetchLayer call, only Claude.
   */
  api.post(
    '/analysis/social-listener/reputation',
    longRoute(async (_req, _res, workspaceId) => {
      const latest = await latestListenerReport<SocialMediaListener>(workspaceId)
      if (!latest) throw new HttpError(409, 'No Social Media Listener report exists yet — run the listener once first.')
      const skill = SKILL_BY_ID['analysis.social.listen']
      if (!skill) throw new Error('The Social Media Listener skill is not registered.')
      const overrides = await listSkillOverrides(workspaceId)
      const knobs = resolveConfig(skill, overrides.get(skill.id)?.config, undefined)
      const orm = await buildReputation(latest.report, listenerClaudeOptions(knobs))
      const report: SocialMediaListener = {
        ...latest.report,
        answers: orm.answers,
        reputation: orm.reputation,
        claude_cost_usd: Math.round((latest.report.claude_cost_usd + orm.costUsd) * 10_000) / 10_000,
      }
      await insertListenerReport(workspaceId, report, { trigger: 'reputation', creditsUsed: 0 })
      publish({
        type: 'activity',
        agentId: 'analysis',
        message: `Social Media Listener · reputation: ${orm.reputation.overview.status.replace('_', ' ')}${orm.reputation.overview.net_sentiment !== null ? ` (net ${orm.reputation.overview.net_sentiment})` : ''} · ${orm.reputation.recommended_responses.length} recommended response(s)`,
        data: { status: orm.reputation.by === 'claude' ? 'ok' : 'warn' },
      })
      return { report, createdAt: new Date().toISOString() }
    }),
  )

  /*
   * COMPETITOR INTELLIGENCE (Analysis Agent · analysis.competitor.intel).
   *
   * The universe is data: list, add, edit, deactivate, remove. A run is started
   * here and proceeds in the background (a universe takes many minutes); the
   * tab polls `/status`. Profiles are versioned; any version can be read.
   */
  const competitorBody = z.object({
    name: z.string().trim().min(1).max(120),
    slug: z.string().trim().regex(/^[a-z0-9-]+$/).max(60).optional(),
    tier: z.enum(COMPETITOR_TIERS),
    category: z.string().trim().max(80).default(''),
    description: z.string().trim().max(600).default(''),
    website_url: z.string().trim().url().or(z.literal('')).default(''),
    social_urls: z.array(z.string().trim().url()).max(20).default([]),
    keywords: z.array(z.string().trim().min(1).max(60)).max(30).default([]),
    status: z.enum(COMPETITOR_STATUSES).default('active'),
    monitoring_frequency: z.enum(MONITORING_FREQUENCIES).default('monthly'),
  })

  api.get(
    '/analysis/competitors',
    route(async (_req, _res, workspaceId) => {
      await ensureUniverse(workspaceId)
      await ensureSelfProfile(workspaceId)
      const src = skillSource()
      return {
        universe: await listCompetitors(workspaceId),
        intelligence: await competitorIntelligenceNow(workspaceId),
        market: await latestMarketReport(workspaceId),
        status: competitorRunStatus(workspaceId),
        methodology: {
          repository: src?.repository ?? null,
          commit: src?.commit ?? null,
          synced_at: src?.synced_at ?? null,
          skills: src?.skills ?? [],
          available: marketingSkillsAvailable(),
          tools: toolBindings(seoConfigured()),
        },
      }
    }),
  )

  api.get(
    '/analysis/competitors/status',
    route(async (_req, _res, workspaceId) => ({ status: competitorRunStatus(workspaceId) })),
  )

  api.post(
    '/analysis/competitors',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(competitorBody, req.body)
      const slug = body.slug ?? body.name.toLowerCase().replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
      const created = await insertCompetitor(workspaceId, { ...body, slug })
      if (!created) throw new HttpError(409, `A competitor with the slug “${slug}” already exists.`)
      return { competitor: created }
    }),
  )

  api.patch(
    '/analysis/competitors/:id',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(competitorBody.omit({ slug: true }).partial(), req.body)
      const updated = await updateCompetitor(workspaceId, String(req.params.id), body)
      if (!updated) throw new HttpError(404, 'No such competitor.')
      return { competitor: updated }
    }),
  )

  api.delete(
    '/analysis/competitors/:id',
    route(async (req, _res, workspaceId) => {
      const removed = await deleteCompetitor(workspaceId, String(req.params.id))
      if (!removed) throw new HttpError(404, 'No such competitor.')
      return { removed: true }
    }),
  )

  api.get(
    '/analysis/competitors/:id/profile',
    route(async (req, _res, workspaceId) => {
      const id = String(req.params.id)
      const competitor = await getCompetitor(workspaceId, id)
      if (!competitor) throw new HttpError(404, 'No such competitor.')
      const version = typeof req.query.version === 'string' ? Number(req.query.version) : null
      const profile = version !== null && Number.isInteger(version) ? await profileByVersion(workspaceId, id, version) : await latestProfile(workspaceId, id)
      return { competitor, profile, versions: await profileVersions(workspaceId, id) }
    }),
  )

  api.post(
    '/analysis/competitors/run',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({ competitorIds: z.array(z.string().uuid()).max(100).optional(), depth: z.enum(['quick', 'deep']).optional(), dueOnly: z.boolean().optional() }),
        req.body,
      )
      if (competitorRunStatus(workspaceId).running) throw new HttpError(409, 'A Competitor Intelligence run is already in progress.')
      await ensureUniverse(workspaceId)
      const universe = await listCompetitors(workspaceId)
      const ids =
        body.competitorIds && body.competitorIds.length > 0
          ? body.competitorIds
          : universe.filter((c) => !c.is_self && c.status === 'active' && (body.dueOnly !== true || isCompetitorDue(c, new Date()))).map((c) => c.id)
      if (ids.length === 0) throw new HttpError(409, body.dueOnly ? 'No active competitor is due.' : 'No active competitor to analyse.')
      // In the background: the tab polls /status. The skill run is recorded like any other.
      markCompetitorRunQueued(workspaceId, ids.length)
      void runSkill<PipelinePayload>(
        'analysis.competitor.intel',
        { runId: '', runOffset: 0, competitorIds: ids, competitorForce: true, ...(body.depth ? { competitorDepth: body.depth } : {}) },
        { workspaceId, trigger: 'api' },
      )
        .then(({ record }) => {
          markCompetitorRunEnded(workspaceId, record.status === 'failed' ? (record.note ?? 'The skill failed.') : null)
          publish({ type: 'activity', agentId: 'analysis', message: `Competitor Intelligence finished · ${record.note ?? record.status}`, data: { status: record.status === 'failed' ? 'warn' : 'ok' } })
        })
        .catch((error: unknown) => {
          const message = error instanceof Error ? error.message : String(error)
          markCompetitorRunEnded(workspaceId, message)
          publish({ type: 'activity', agentId: 'analysis', message: `Competitor Intelligence failed: ${message}`, data: { status: 'error' } })
        })
      return { started: true, competitors: ids.length }
    }),
  )

  api.post(
    '/analysis/social-listener/run',
    longRoute(async (_req, _res, workspaceId) => {
      if (!socialFetchConfigured()) throw new HttpError(503, socialFetchUnavailableReason() ?? 'SocialFetch is not configured.')
      const { payload, record } = await runSkill<PipelinePayload>(
        'analysis.social.listen',
        { runId: '', runOffset: 0, listenerForceRefresh: true },
        { workspaceId, trigger: 'api' },
      )
      if (!payload.socialMediaListener) {
        throw new HttpError(502, record.note ?? `The Social Media Listener did not produce a report (${record.status}).`)
      }
      publish({
        type: 'activity',
        agentId: 'analysis',
        message: `Social Media Listener refreshed · ${payload.socialMediaListener.sample_size.posts} posts, ${payload.socialMediaListener.sample_size.comments} comments`,
        data: { status: 'ok' },
      })
      return { report: payload.socialMediaListener, status: record.status }
    }),
  )

  api.post(
    '/bridges/platform-trends',
    longRoute(async (req) => {
      const args = parseBody(platformTrendsArgs, req.body)
      const report = await discoverPlatformTrends({
        // "Today" is the workspace's date, as in the Scraping Agent's run.
        timeZone: config.core.tz,
        ...(args.hours ? { windowHours: args.hours } : {}),
        ...(args.platforms ? { platforms: args.platforms } : {}),
        ...(args.keywords
          ? { keywords: args.keywords.map((term) => ({ term, weight: 100, category: 'Requested', synonyms: synonymsFor(term), scheduled: null })) }
          : {}),
      })
      return req.query.format === 'markdown' ? { ...report, markdown: renderPlatformTrends(report) } : report
    }),
  )

  return api
}

function openStream(res: Response): void {
  res.status(200)
  res.setHeader('Content-Type', 'text/event-stream')
  res.setHeader('Cache-Control', 'no-cache, no-transform')
  res.setHeader('Connection', 'keep-alive')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders?.()
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE AGGREGATE READ
   ═══════════════════════════════════════════════════════════════════════════ */

async function buildState(workspaceId: string): Promise<Record<string, unknown>> {
  const [
    workspace,
    keywords,
    keywordSignals,
    trending,
    hashtags,
    topHashtags,
    scraped,
    ideas,
    published,
    knowledge,
    knowledgeCounts,
    knowledgeBuild,
    agents,
    activity,
    analytics,
    reviewQueue,
    sources,
    conversation,
    brief,
    confirm,
    run,
    voiceProfiles,
    voiceSampleCount,
    trackedAccounts,
  ] = await Promise.all([
    getWorkspace(workspaceId),
    listKeywords(workspaceId, false),
    latestRunKeywordSignals(workspaceId),
    // Run-scoped, unlike `keywordSignals` above. The keyword table wants the
    // last thing known about every term; "what is trending" is a verdict the
    // LATEST run reached about the terms it actually scanned, and mixing the
    // two put five rank-1 keywords from five different runs on one panel.
    trendingKeywords(workspaceId, 5),
    listHashtags(workspaceId, { limit: 400 }),
    listHashtags(workspaceId, { top: true, limit: config.knowledge.hashtagCount }),
    listScrapedItems(workspaceId, { limit: 200 }),
    listIdeas(workspaceId, { limit: 200 }),
    listPosts(workspaceId, { limit: 80 }),
    listKnowledge(workspaceId, { activeOnly: false, limit: 400 }),
    countKnowledge(workspaceId),
    latestKnowledgeBuild(workspaceId),
    listAgentState(workspaceId),
    listActivity(workspaceId, 60),
    listPlatformAnalytics(workspaceId),
    listReviewQueue(workspaceId, false),
    listSources(workspaceId),
    latestConversation(workspaceId),
    latestBrief(workspaceId),
    pendingConfirmation(workspaceId),
    latestPipelineRun(workspaceId),
    listVoiceProfiles(workspaceId),
    countVoiceSamples(workspaceId, 'short_form_script'),
    listTrackedAccounts(workspaceId),
  ])

  const ideaIds = ideas.map((i) => i.id)
  const [drafts, media, hooks] = await Promise.all([
    listDraftsForIdeas(ideaIds),
    listMediaForIdeas(ideaIds),
    listHookVariantsForIdeas(workspaceId, ideaIds),
  ])

  /*
   * Hooks grouped by idea, the same shape `draftMap` and `mediaMap` use, so the
   * store reconciles all three identically. Rows rather than a blob all the way
   * to the client: a variant's confidence and the basis behind it belong to the
   * variant, and flattening them would lose which evidence went with which hook.
   */
  const hookMap: Record<string, unknown[]> = {}
  for (const h of hooks) {
    const list = hookMap[h.idea_id] ?? []
    list.push(h)
    hookMap[h.idea_id] = list
  }

  const draftMap: Record<string, Record<string, unknown>> = {}
  for (const d of drafts) {
    draftMap[`${d.idea_id}|${d.platform}`] = {
      body: d.body,
      revision: d.revision,
      model: d.model,
      source: d.source,
      updatedAt: d.updated_at,
    }
  }

  const mediaMap: Record<string, Record<string, unknown>> = {}
  for (const m of media) {
    mediaMap[`${m.idea_id}|${m.platform}`] = {
      /*
       * A URL, NOT THE BYTES.
       *
       * These used to carry the full base64 `data:` URI, and the same creative
       * was serialised twice — once under `media` and again nested in `ideas` —
       * so a workspace with nineteen assets answered `/api/state` with 65 MB.
       * On localhost that is 0.3s and invisible; over a tunnel it is over two
       * minutes, and the calendar never rendered because the state fetch had not
       * finished. The payload is the bug, not the renderer.
       *
       * `GET /api/media/:id.png` rasterises the stored SVG on demand, is mounted
       * ahead of the session guard so an image needs no cookie, and answers
       * `cache-control: immutable` — a creative is addressed by the id of a row
       * that is never rewritten, so the browser and any CDN fetch it once.
       *
       * The field keeps its name deliberately: every consumer puts it straight
       * into an `<img src>`, which takes a URL and a data URI identically, so
       * nothing downstream changes. The bytes still live in `media_assets`, and
       * the publishing path reads them from there rather than from here.
       *
       * Root-relative on purpose — the router is mounted at `/api`, and the
       * bundle already asks for `/api` on whatever host served it, so this
       * resolves through a tunnel, a container and localhost without a branch.
       */
      dataUri: m.id ? `/api/media/${m.id}.png` : null,
      model: m.model,
      renderMode: m.render_mode,
      concept: m.concept,
      canvas: m.canvas,
      width: m.width,
      height: m.height,
      altText: m.alt_text,
      fallbackReason: m.fallback_reason,
    }
  }

  const transcript = conversation ? await conversationTranscript(conversation.id, 40) : { turns: [] }
  const listenerLatest = await latestListenerReport(workspaceId)

  return {
    workspace: {
      name: workspace?.name ?? 'Ethara.AI',
      slug: workspace?.slug ?? config.core.workspaceSlug,
      brandVoice: workspace?.brand_voice ?? BRAND.voiceWords.join(', '),
      audience: workspace?.audience ?? BRAND.audience,
      settings: workspace?.settings ?? {},
    },
    keywords,
    keywordSignals,
    trending,
    hashtags,
    topHashtags,
    scraped,
    /*
     * No suggestion list. Every idea on the calendar is a dated topic; a row an
     * older release parked as a suggestion (all withdrawn by the ADR-016
     * migration, kept for lineage) is not returned.
     */
    ideas: ideas.filter((i) => i.calendar_slot !== 'suggestion').map((i) => ({
      ...i,
      content_pillar: contentPillarFor(i.title, i.source_topic, i.description),
      calendarSlot: i.calendar_slot,
      platformRank: i.platform_rank,
      draft: draftMap[`${i.id}|${i.platform}`] ?? null,
      media: mediaMap[`${i.id}|${i.platform}`] ?? null,
      hooks: hookMap[i.id] ?? [],
    })),
    drafts: draftMap,
    media: mediaMap,
    hooks: hookMap,
    /*
     * Same reason as `mediaMap` above: `listPosts` joins `ma.data_uri`, so the
     * published feed carried another several megabytes of base64. The published
     * screens render this through an `<img src>` too, so a URL substitutes
     * cleanly and the bytes stay in `media_assets`.
     */
    published: published.map((p) => ({
      ...p,
      data_uri: p.media_asset_id ? `/api/media/${p.media_asset_id}.png` : null,
    })),
    knowledge,
    knowledgeCounts,
    knowledgeBuild,
    agents,
    activity,
    analytics,
    reviewQueue,
    sources,
    voiceProfiles,
    voiceSampleCount,
    trackedAccounts,
    pipeline: run,
    /** The latest Social Media Listener report, for the Dashboard's Analysis card. */
    socialListener: listenerLatest ? { ...listenerLatest.report, stored_at: listenerLatest.created_at } : null,
    socialListenerConfigured: socialFetchConfigured(),
    /*
     * Which dates are post-ready (a written post) and which hold a topic only.
     * Resolved here, from the operator's knobs and the workspace time zone, so
     * the screen never computes its own "today" and disagrees with the writer.
     */
    calendarHorizon: await resolveCalendarHorizon(workspaceId),
    platformLabels: PLATFORM_LABEL,
    assistant: {
      conversation,
      turns: transcript.turns,
      brief,
      pendingConfirm: confirm
        ? {
            token: confirm.token,
            prompt: confirm.prompt,
            expiresAt: confirm.expires_at,
            plan: confirm.plan,
          }
        : null,
    },
    mode: {
      publishMode: config.core.publishMode,
      // Whether a password is actually required. An open gate must be visible
      // rather than assumed shut: with no OPERATOR_PASSWORD configured any
      // password is accepted, and that is a fact an operator needs.
      auth: { enforced: authEnforced() },
      assistantProvider: config.assistant.provider,
      // Off is a supported state, so it has to be stated rather than inferred
      // from an absent transcript.
      transcription: {
        configured: whisperTranscribe.isConfigured(),
        reason: describeWhisper(),
      },
      integrations: integrationReport().adapters,
    },
  }
}

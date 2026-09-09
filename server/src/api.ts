/**
 * THE REST SURFACE
 *
 * Every route under `/api`, zod on every body, one wrapper on every handler. The
 * wrapper resolves the workspace, serialises the result, and answers
 * `500 { error }` on a throw — so no route has to remember to.
 *
 * `GET /state` is the aggregate read that hydrates the whole UI in one call.
 */

import { spawn } from 'node:child_process'
import { join } from 'node:path'
import express, { type Request, type Response, type Router } from 'express'
import { z } from 'zod'

import { PLATFORMS, type Platform } from '../../shared/agent-contract'
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
import { BRAND, BRAND_RULES } from '../../shared/brand-voice'
import { IMAGE_MODELS } from '../../shared/image-models'
import { config, integrationStatuses } from './config'
import { databaseReachable } from './db/pool'
import {
  createKeyword,
  currentWorkspaceId,
  deactivateKeyword,
  deleteSkillOverride,
  getIdea,
  getWorkspace,
  insertActivity,
  insertKnowledgeEntry,
  latestKeywordSignals,
  latestKnowledgeBuild,
  latestPipelineRun,
  listActivity,
  listAgentRuns,
  listAgentState,
  listDraftsForIdeas,
  listHashtags,
  listIdeas,
  listKeywords,
  listKnowledge,
  listKnowledgeBuilds,
  listMediaForIdeas,
  listPlatformAnalytics,
  listPosts,
  listReviewQueue,
  listScrapedItems,
  listSkillOverrides,
  listSkillRuns,
  listSources,
  primaryIdeasForPlatform,
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
import { capabilities, registeredToolIds } from './assistant/tools/index'
import { availableImageModels } from './agents/image/image-models/index'
import { integrationReport } from './integrations'
import {
  applyInstruction,
  approveMarketing,
  buildKnowledge,
  decideLeadership,
  generateDraft,
  publishIdea,
  refreshAnalytics,
  renderIdeaImage,
  runDiscoveryPipeline,
} from './orchestrator'
import { bus, publish, recentEvents, subscribe, toSseFrame, REPLAY_SIZE } from './events'
import { PLATFORM_LABEL } from './agents/corpus'

/* ═══════════════════════════════════════════════════════════════════════════
   THE WRAPPER
   ═══════════════════════════════════════════════════════════════════════════ */

type Handler = (req: Request, res: Response, workspaceId: string) => Promise<unknown>

function route(handler: Handler) {
  return async (req: Request, res: Response): Promise<void> => {
    try {
      const workspaceId = await currentWorkspaceId()
      const result = await handler(req, res, workspaceId)
      if (res.headersSent) return
      res.json(result ?? { ok: true })
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      if (!res.headersSent) res.status(500).json({ error: message })
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

/* ═══════════════════════════════════════════════════════════════════════════
   THE ROUTER
   ═══════════════════════════════════════════════════════════════════════════ */

export function createApiRouter(): Router {
  const api = express.Router()

  /* ── HEALTH AND REGISTRY ─────────────────────────────────────────────────── */

  api.get('/health', async (_req, res) => {
    const database = await databaseReachable()
    const statuses = integrationStatuses()
    const body = {
      ok: database,
      database: database ? 'postgres' : 'unreachable',
      publishMode: config.core.publishMode,
      workspace: config.core.workspaceSlug,
      registry: REGISTRY_SUMMARY,
      tools: TOOL_SUMMARY,
      integrations: {
        apify: { configured: statuses.apify.configured, reason: statuses.apify.reason },
        parallel: { configured: statuses.parallel.configured, reason: statuses.parallel.reason },
        gcp: { configured: statuses.gcp.configured, reason: statuses.gcp.reason },
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
        actor: body.actor ?? 'Ridhima',
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
        tags: [],
      })
      return { entry: inserted }
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
      ideas: await listIdeas(workspaceId, {
        ...(typeof req.query.platform === 'string'
          ? { platform: req.query.platform as Platform }
          : {}),
        ...(typeof req.query.slot === 'string' ? { slot: req.query.slot as 'primary' } : {}),
        limit: Number(req.query.limit ?? 200),
      }),
    })),
  )

  api.post(
    '/ideas/:id/draft',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({ platform: platformSchema.optional(), withImage: z.boolean().optional() }),
        req.body,
      )
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
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({
          platform: platformSchema,
          model: z.enum(['brand-svg', 'gcp-imagen', 'z-image-turbo']).optional(),
          prompt: z.string().optional(),
          instruction: z.string().optional(),
        }),
        req.body,
      )
      const media = await renderIdeaImage({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        platform: body.platform,
        ...(body.model === undefined ? {} : { model: body.model }),
        ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
        ...(body.instruction === undefined ? {} : { instruction: body.instruction }),
      })
      return { media }
    }),
  )

  api.post(
    '/ideas/:id/instruct',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({ platform: platformSchema, instruction: z.string().min(2) }),
        req.body,
      )
      const result = await applyInstruction({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        platform: body.platform,
        instruction: body.instruction,
      })
      return {
        draft: result.draft,
        note: result.note,
        compliance: result.compliance,
        preference: result.preference,
        conflicts: result.conflicts,
        diffSummary: result.diffSummary,
        skills: result.skills,
      }
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
          calendarSlot: z.enum(['primary', 'suggestion']).optional(),
        }),
        req.body,
      )

      const id = String(req.params.id)
      const idea = await getIdea(workspaceId, id)
      if (!idea) throw new Error('No such idea.')

      let demoted: { id: string; title: string } | null = null

      // The top-10 rule, enforced server-side: promoting past the cap demotes the
      // weakest primary and says so.
      if (body.calendarSlot === 'primary' && idea.calendar_slot !== 'primary') {
        const cap = Number(defaultSkillConfig('calendar.rank.select').topPerPlatform ?? 10)
        const primaries = await primaryIdeasForPlatform(workspaceId, body.platform ?? idea.platform)
        if (primaries.length >= cap) {
          const weakest = primaries[primaries.length - 1]
          if (weakest && weakest.id !== id) {
            await updateIdea(workspaceId, weakest.id, { calendarSlot: 'suggestion' })
            demoted = { id: weakest.id, title: weakest.title }
          }
        }
      }

      const updated = await updateIdea(workspaceId, id, {
        ...(body.date === undefined ? {} : { scheduledDate: body.date }),
        ...(body.time === undefined ? {} : { scheduledTime: body.time }),
        ...(body.platform === undefined ? {} : { platform: body.platform }),
        ...(body.status === undefined ? {} : { status: body.status }),
        ...(body.calendarSlot === undefined ? {} : { calendarSlot: body.calendarSlot }),
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

      return { ok: true, idea: updated, demoted }
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
    route(async (req, _res, workspaceId) => {
      const body = parseBody(z.object({ by: z.string().min(1) }), req.body)
      const idea = await approveMarketing({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        by: body.by,
      })
      return { idea }
    }),
  )

  api.post(
    '/ideas/:id/leadership/approve',
    route(async (req, _res, workspaceId) => {
      const body = parseBody(
        z.object({ by: z.string().min(1), publish: z.boolean().default(true) }),
        req.body,
      )
      return decideLeadership({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        decision: 'approved',
        by: body.by,
        publish: body.publish,
      })
    }),
  )

  api.post(
    '/ideas/:id/leadership/reject',
    route(async (req, _res, workspaceId) => {
      // The reason is mandatory, enforced here as well as in the repository.
      const parsed = z
        .object({ by: z.string().min(1), reason: z.string().min(1) })
        .safeParse(req.body ?? {})
      if (!parsed.success) {
        throw new Error('A rejection needs a reason — it is what the agents learn from.')
      }
      return decideLeadership({
        workspaceId,
        trigger: 'api',
        ideaId: String(req.params.id),
        decision: 'rejected',
        by: parsed.data.by,
        reason: parsed.data.reason,
      })
    }),
  )

  api.post(
    '/ideas/:id/publish',
    route(async (req, _res, workspaceId) => {
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

  const PY = join(process.cwd(), '..', 'backend', '.venv', 'bin', 'python')
  const AGENT_API = join(process.cwd(), '..', 'backend', 'api.py')

  /** Runs one backend command and parses its NDJSON. Never throws on bad output. */
  function runAgentCommand(args: string[], timeoutMs = 300_000): Promise<Record<string, unknown>[]> {
    return new Promise((resolve, reject) => {
      const child = spawn(PY, [AGENT_API, ...args], { cwd: join(process.cwd(), '..') })
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
   * Every frame is also mirrored onto the global event bus, so the Run Console
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

    const child = spawn(PY, [AGENT_API, ...args], { cwd: join(process.cwd(), '..') })
    let buffer = ''
    let finished = false

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
      res.write(`event: end\ndata: ${JSON.stringify({ code })}\n\n`)
      res.end()
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
    hashtags,
    topHashtags,
    scraped,
    ideas,
    published,
    knowledge,
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
  ] = await Promise.all([
    getWorkspace(workspaceId),
    listKeywords(workspaceId, false),
    latestKeywordSignals(workspaceId),
    listHashtags(workspaceId, { limit: 400 }),
    listHashtags(workspaceId, { top: true, limit: config.knowledge.hashtagCount }),
    listScrapedItems(workspaceId, { limit: 200 }),
    listIdeas(workspaceId, { limit: 200 }),
    listPosts(workspaceId, { limit: 80 }),
    listKnowledge(workspaceId, { activeOnly: false, limit: 400 }),
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
  ])

  const ideaIds = ideas.map((i) => i.id)
  const [drafts, media] = await Promise.all([
    listDraftsForIdeas(ideaIds),
    listMediaForIdeas(ideaIds),
  ])

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
      dataUri: m.data_uri,
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
    hashtags,
    topHashtags,
    scraped,
    ideas: ideas.map((i) => ({
      ...i,
      calendarSlot: i.calendar_slot,
      platformRank: i.platform_rank,
      draft: draftMap[`${i.id}|${i.platform}`] ?? null,
      media: mediaMap[`${i.id}|${i.platform}`] ?? null,
    })),
    drafts: draftMap,
    media: mediaMap,
    published,
    knowledge,
    knowledgeBuild,
    agents,
    activity,
    analytics,
    reviewQueue,
    sources,
    pipeline: run,
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
      assistantProvider: config.assistant.provider,
      integrations: integrationReport().adapters,
    },
  }
}

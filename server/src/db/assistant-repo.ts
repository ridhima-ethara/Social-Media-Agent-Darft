/**
 * THE Ethara REPOSITORY
 *
 * Every stage of the command loop is persisted: the conversation, the turn, the
 * intent, the plan, each step with its result, the confirmation with who gave it
 * and when, and the briefings.
 *
 * Law 7: agency requires accountability. Nothing Ethara does is reconstructable
 * from an event stream alone, so all of it is written here.
 */

import type { OperatorRole } from '../../../shared/agent-contract'
import type { ToolRisk } from '../../../shared/tool-registry'
import { query, queryOne } from './pool'

/* ═══════════════════════════════════════════════════════════════════════════
   CONVERSATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AssistantConversationRow {
  id: string
  actor: string
  role: OperatorRole
  title: string | null
  started_at: string
  last_at: string
}

export async function latestConversation(
  workspaceId: string,
): Promise<AssistantConversationRow | null> {
  return queryOne<AssistantConversationRow>(
    `SELECT id, actor, role, title, started_at, last_at
       FROM assistant_conversations
      WHERE workspace_id = $1
      ORDER BY last_at DESC
      LIMIT 1`,
    [workspaceId],
  )
}

export async function listConversations(
  workspaceId: string,
  limit = 40,
): Promise<Array<AssistantConversationRow & { turn_count: number; tool_count: number }>> {
  return query<AssistantConversationRow & { turn_count: number; tool_count: number }>(
    `SELECT c.id, c.actor, c.role, c.title, c.started_at, c.last_at,
            COUNT(DISTINCT t.id)::int AS turn_count,
            COUNT(s.id)::int          AS tool_count
       FROM assistant_conversations c
       LEFT JOIN assistant_turns t ON t.conversation_id = c.id
       LEFT JOIN assistant_steps s ON s.turn_id = t.id
      WHERE c.workspace_id = $1
      GROUP BY c.id
      ORDER BY c.last_at DESC
      LIMIT $2`,
    [workspaceId, limit],
  )
}

export async function getConversation(
  workspaceId: string,
  id: string,
): Promise<AssistantConversationRow | null> {
  return queryOne<AssistantConversationRow>(
    `SELECT id, actor, role, title, started_at, last_at
       FROM assistant_conversations
      WHERE workspace_id = $1 AND id = $2`,
    [workspaceId, id],
  )
}

export async function startConversation(
  workspaceId: string,
  actor: string,
  role: OperatorRole,
  title: string,
): Promise<AssistantConversationRow> {
  const row = await queryOne<AssistantConversationRow>(
    `INSERT INTO assistant_conversations (workspace_id, actor, role, title)
     VALUES ($1, $2, $3, $4)
     RETURNING id, actor, role, title, started_at, last_at`,
    [workspaceId, actor, role, title],
  )
  if (!row) throw new Error('Could not open a Ethara conversation.')
  return row
}

/**
 * Resolves the conversation to append to: the one named, else the most recent,
 * else a new one. A dropped client never loses its transcript.
 */
export async function resolveConversation(
  workspaceId: string,
  conversationId: string | undefined,
  actor: string,
  role: OperatorRole,
  firstUtterance: string,
): Promise<AssistantConversationRow> {
  if (conversationId) {
    const existing = await getConversation(workspaceId, conversationId)
    if (existing) return existing
  }
  const latest = await latestConversation(workspaceId)
  if (latest) return latest
  return startConversation(workspaceId, actor, role, firstUtterance.slice(0, 80))
}

export async function touchConversation(id: string): Promise<void> {
  await query(`UPDATE assistant_conversations SET last_at = now() WHERE id = $1`, [id])
}

/* ═══════════════════════════════════════════════════════════════════════════
   TURNS
   ═══════════════════════════════════════════════════════════════════════════ */

export type TurnStatus =
  | 'planning'
  | 'awaiting_confirmation'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled'

export interface AssistantTurnRow {
  id: string
  conversation_id: string
  seq: number
  speaker: 'operator' | 'assistant'
  utterance: string | null
  channel: 'text' | 'voice' | 'ambient' | 'cron'
  intent: Record<string, unknown> | null
  plan: Record<string, unknown> | null
  narration: string | null
  confidence: number | null
  status: TurnStatus
  last_entity: Record<string, unknown> | null
  created_at: string
}

export async function nextTurnSeq(conversationId: string): Promise<number> {
  const row = await queryOne<{ next: number }>(
    `SELECT COALESCE(MAX(seq), 0) + 1 AS next FROM assistant_turns WHERE conversation_id = $1`,
    [conversationId],
  )
  return row?.next ?? 1
}

export async function insertTurn(t: {
  conversationId: string
  seq: number
  speaker: 'operator' | 'assistant'
  utterance: string
  channel: 'text' | 'voice' | 'ambient' | 'cron'
  status?: TurnStatus
}): Promise<AssistantTurnRow> {
  const row = await queryOne<AssistantTurnRow>(
    `INSERT INTO assistant_turns (conversation_id, seq, speaker, utterance, channel, status)
     VALUES ($1, $2, $3, $4, $5, $6)
     RETURNING *`,
    [t.conversationId, t.seq, t.speaker, t.utterance, t.channel, t.status ?? 'planning'],
  )
  if (!row) throw new Error('Could not record the turn.')
  return row
}

export async function updateTurn(
  id: string,
  patch: {
    intent?: Record<string, unknown>
    plan?: Record<string, unknown>
    narration?: string
    confidence?: number
    status?: TurnStatus
    lastEntity?: Record<string, unknown> | null
  },
): Promise<void> {
  const sets: string[] = []
  const params: Array<string | number | null> = []
  let i = 1

  if (patch.intent !== undefined) {
    sets.push(`intent = $${i}::jsonb`)
    params.push(JSON.stringify(patch.intent))
    i += 1
  }
  if (patch.plan !== undefined) {
    sets.push(`plan = $${i}::jsonb`)
    params.push(JSON.stringify(patch.plan))
    i += 1
  }
  if (patch.narration !== undefined) {
    sets.push(`narration = $${i}`)
    params.push(patch.narration)
    i += 1
  }
  if (patch.confidence !== undefined) {
    sets.push(`confidence = $${i}`)
    params.push(Math.round(patch.confidence))
    i += 1
  }
  if (patch.status !== undefined) {
    sets.push(`status = $${i}`)
    params.push(patch.status)
    i += 1
  }
  if (patch.lastEntity !== undefined) {
    sets.push(`last_entity = $${i}::jsonb`)
    params.push(patch.lastEntity === null ? null : JSON.stringify(patch.lastEntity))
    i += 1
  }

  if (sets.length === 0) return
  params.push(id)
  await query(`UPDATE assistant_turns SET ${sets.join(', ')} WHERE id = $${i}`, params)
}

/**
 * The conversation a turn belongs to.
 *
 * Exists for the confirmation path. Resuming starts from a stored turn id and
 * has no conversation in hand, and the thing it needs the conversation FOR is
 * writing the resumed turn back — a uuid column, which an empty string does not
 * satisfy. Passing `''` there threw after the tools had already run, so the
 * work landed and the operator was shown a Postgres error instead of the
 * result, which reads exactly like nothing happened.
 */
export async function conversationOfTurn(turnId: string): Promise<string> {
  const rows = await query<{ conversation_id: string }>(
    'SELECT conversation_id FROM assistant_turns WHERE id = $1',
    [turnId],
  )
  return rows[0]?.conversation_id ?? ''
}

export async function listTurns(conversationId: string, limit = 60): Promise<AssistantTurnRow[]> {
  return query<AssistantTurnRow>(
    `SELECT * FROM assistant_turns
      WHERE conversation_id = $1
      ORDER BY seq DESC
      LIMIT $2`,
    [conversationId, limit],
  ).then((rows) => rows.reverse())
}

export async function getTurn(id: string): Promise<AssistantTurnRow | null> {
  return queryOne<AssistantTurnRow>(`SELECT * FROM assistant_turns WHERE id = $1`, [id])
}

/**
 * The pronoun resolution target: the most recent entity Ethara or the operator
 * referred to. "Publish it" resolves against this.
 */
export async function lastReferencedEntity(
  conversationId: string,
): Promise<Record<string, unknown> | null> {
  const row = await queryOne<{ last_entity: Record<string, unknown> | null }>(
    `SELECT last_entity FROM assistant_turns
      WHERE conversation_id = $1 AND last_entity IS NOT NULL
      ORDER BY seq DESC
      LIMIT 1`,
    [conversationId],
  )
  return row?.last_entity ?? null
}

/* ═══════════════════════════════════════════════════════════════════════════
   STEPS
   ═══════════════════════════════════════════════════════════════════════════ */

export type StepStatus = 'queued' | 'running' | 'completed' | 'failed' | 'skipped'

export interface AssistantStepRow {
  id: string
  turn_id: string
  idx: number
  tool_id: string
  risk: ToolRisk
  args: Record<string, unknown>
  why: string | null
  status: StepStatus
  result_summary: string | null
  result: unknown
  duration_ms: number | null
  agent_run_id: string | null
  error: string | null
  started_at: string | null
  finished_at: string | null
}

export async function insertStep(s: {
  turnId: string
  idx: number
  toolId: string
  risk: ToolRisk
  args: unknown
  why: string
}): Promise<AssistantStepRow> {
  const row = await queryOne<AssistantStepRow>(
    `INSERT INTO assistant_steps (turn_id, idx, tool_id, risk, args, why, status)
     VALUES ($1, $2, $3, $4, $5::jsonb, $6, 'queued')
     RETURNING *`,
    [s.turnId, s.idx, s.toolId, s.risk, JSON.stringify(s.args ?? {}), s.why],
  )
  if (!row) throw new Error('Could not record the plan step.')
  return row
}

export async function startStep(id: string): Promise<void> {
  await query(`UPDATE assistant_steps SET status = 'running', started_at = now() WHERE id = $1`, [id])
}

export async function finishStep(
  id: string,
  patch: {
    status: StepStatus
    resultSummary?: string
    result?: unknown
    durationMs?: number
    agentRunId?: string | null
    error?: string
  },
): Promise<void> {
  await query(
    `UPDATE assistant_steps
        SET status = $2,
            result_summary = COALESCE($3, result_summary),
            result = COALESCE($4::jsonb, result),
            duration_ms = COALESCE($5, duration_ms),
            agent_run_id = COALESCE($6, agent_run_id),
            error = COALESCE($7, error),
            finished_at = now()
      WHERE id = $1`,
    [
      id,
      patch.status,
      patch.resultSummary ?? null,
      patch.result === undefined ? null : JSON.stringify(patch.result),
      patch.durationMs ?? null,
      patch.agentRunId ?? null,
      patch.error ?? null,
    ],
  )
}

export async function listSteps(turnId: string): Promise<AssistantStepRow[]> {
  return query<AssistantStepRow>(`SELECT * FROM assistant_steps WHERE turn_id = $1 ORDER BY idx`, [turnId])
}

export async function listStepsForTurns(turnIds: string[]): Promise<AssistantStepRow[]> {
  if (turnIds.length === 0) return []
  return query<AssistantStepRow>(
    `SELECT * FROM assistant_steps WHERE turn_id = ANY($1::uuid[]) ORDER BY turn_id, idx`,
    [turnIds],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIRMATIONS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AssistantConfirmationRow {
  id: string
  turn_id: string
  token: string
  plan: Record<string, unknown>
  prompt: string
  expires_at: string
  decided: 'confirmed' | 'cancelled' | 'expired' | null
  decided_by: string | null
  decided_at: string | null
  created_at: string
}

export async function mintConfirmation(c: {
  turnId: string
  token: string
  plan: unknown
  prompt: string
  ttlSeconds: number
}): Promise<AssistantConfirmationRow> {
  const row = await queryOne<AssistantConfirmationRow>(
    `INSERT INTO assistant_confirmations (turn_id, token, plan, prompt, expires_at)
     VALUES ($1, $2, $3::jsonb, $4, now() + ($5 || ' seconds')::interval)
     RETURNING *`,
    [c.turnId, c.token, JSON.stringify(c.plan), c.prompt, String(Math.max(1, c.ttlSeconds))],
  )
  if (!row) throw new Error('Could not mint the confirmation token.')
  return row
}

export async function findConfirmation(token: string): Promise<AssistantConfirmationRow | null> {
  return queryOne<AssistantConfirmationRow>(
    `SELECT * FROM assistant_confirmations WHERE token = $1`,
    [token],
  )
}

export async function decideConfirmation(
  token: string,
  decision: 'confirmed' | 'cancelled' | 'expired',
  by: string,
): Promise<void> {
  await query(
    `UPDATE assistant_confirmations
        SET decided = $2, decided_by = $3, decided_at = now()
      WHERE token = $1 AND decided IS NULL`,
    [token, decision, by],
  )
}

export async function pendingConfirmation(
  workspaceId: string,
): Promise<AssistantConfirmationRow | null> {
  return queryOne<AssistantConfirmationRow>(
    `SELECT f.* FROM assistant_confirmations f
       JOIN assistant_turns t        ON t.id = f.turn_id
       JOIN assistant_conversations c ON c.id = t.conversation_id
      WHERE c.workspace_id = $1 AND f.decided IS NULL AND f.expires_at > now()
      ORDER BY f.created_at DESC
      LIMIT 1`,
    [workspaceId],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   BRIEFS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AssistantBriefRow {
  id: string
  trigger: 'cron' | 'manual'
  signals: Array<{ label: string; detail: string; severity: string }>
  recommendation: string | null
  narration: string | null
  created_at: string
}

export async function insertBrief(b: {
  workspaceId: string
  trigger: 'cron' | 'manual'
  signals: Array<{ label: string; detail: string; severity: string }>
  recommendation: string
  narration: string
}): Promise<AssistantBriefRow | null> {
  return queryOne<AssistantBriefRow>(
    `INSERT INTO assistant_briefs (workspace_id, trigger, signals, recommendation, narration)
     VALUES ($1, $2, $3::jsonb, $4, $5)
     RETURNING id, trigger, signals, recommendation, narration, created_at`,
    [b.workspaceId, b.trigger, JSON.stringify(b.signals), b.recommendation, b.narration],
  )
}

export async function latestBrief(workspaceId: string): Promise<AssistantBriefRow | null> {
  return queryOne<AssistantBriefRow>(
    `SELECT id, trigger, signals, recommendation, narration, created_at
       FROM assistant_briefs
      WHERE workspace_id = $1
      ORDER BY created_at DESC
      LIMIT 1`,
    [workspaceId],
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOKENS
   ═══════════════════════════════════════════════════════════════════════════ */

/** A confirmation token. Random, single-use, and never derived from the plan. */
export function newConfirmToken(): string {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('')
}

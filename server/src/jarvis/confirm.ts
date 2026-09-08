/**
 * CONFIRM — the gate in front of the irreversible.
 *
 * Law 5 and Law 7 meet here. When a plan carries an irreversible step, dispatch
 * stops BEFORE step 1, the plan is persisted with a token, and nothing runs until
 * a human answers.
 *
 * Resuming runs the STORED plan, never a re-parse of the utterance, so what the
 * human approved is exactly what executes. No setting removes this gate; the
 * `jarvis.confirm.gate` skill cannot be disabled.
 */

import {
  decideConfirmation,
  findConfirmation,
  mintConfirmation,
  newConfirmToken,
  updateTurn,
  type JarvisConfirmationRow,
} from '../db/jarvis-repo'
import { NARRATION_TEMPLATES } from '../../../shared/jarvis-persona'
import { publish } from '../events'
import type { Plan } from './planner'

/* ═══════════════════════════════════════════════════════════════════════════
   MINTING
   ═══════════════════════════════════════════════════════════════════════════ */

export interface GateResult {
  blocked: boolean
  token?: string
  prompt?: string
  expiresAt?: string
}

/**
 * Blocks an irreversible plan and mints the token.
 * Called by dispatch before step 1, never after.
 */
export async function gatePlan(
  turnId: string,
  plan: Plan,
  ttlSeconds: number,
): Promise<GateResult> {
  if (!plan.requiresConfirmation) return { blocked: false }

  const token = newConfirmToken()
  const prompt = plan.confirmPrompt ?? 'This cannot be undone. Confirm, or cancel.'

  const row = await mintConfirmation({
    turnId,
    token,
    // The whole plan, verbatim. This is what resuming executes.
    plan: plan as unknown as Record<string, unknown>,
    prompt,
    ttlSeconds,
  })

  await updateTurn(turnId, { status: 'awaiting_confirmation' })

  publish({
    type: 'jarvis.confirm.required',
    turnId,
    message: prompt,
    data: {
      token,
      prompt,
      expiresAt: row.expires_at,
      ttlSeconds,
      risk: plan.risk,
      planId: plan.id,
      steps: plan.steps.map((s) => ({ toolId: s.toolId, why: s.why })),
    },
  })

  return { blocked: true, token, prompt, expiresAt: row.expires_at }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REDEEMING
   ═══════════════════════════════════════════════════════════════════════════ */

export type RedeemOutcome =
  | { status: 'confirmed'; row: JarvisConfirmationRow; plan: Plan }
  | { status: 'cancelled'; row: JarvisConfirmationRow; message: string }
  | { status: 'expired'; message: string }
  | { status: 'unknown'; message: string }
  | { status: 'already-decided'; message: string }

/**
 * Redeems a token.
 *
 * Every path is explicit and every refusal carries its exact message — an
 * operator must never be left guessing whether the irreversible thing happened.
 */
export async function redeemConfirmation(
  token: string,
  decision: 'confirm' | 'cancel',
  by: string,
): Promise<RedeemOutcome> {
  const row = await findConfirmation(token)

  if (!row) {
    return {
      status: 'unknown',
      message: 'I do not recognise that confirmation. Ask me again and I will re-plan it.',
    }
  }

  if (row.decided !== null) {
    return {
      status: 'already-decided',
      message:
        row.decided === 'confirmed'
          ? 'That was already confirmed and has run. I will not run it twice.'
          : 'That was already cancelled. Nothing was changed.',
    }
  }

  if (new Date(row.expires_at).getTime() <= Date.now()) {
    await decideConfirmation(token, 'expired', by)
    await updateTurn(row.turn_id, { status: 'cancelled' })
    publish({
      type: 'jarvis.confirm.resolved',
      turnId: row.turn_id,
      message: NARRATION_TEMPLATES.confirmExpired,
      data: { token, decision: 'expired' },
    })
    return { status: 'expired', message: NARRATION_TEMPLATES.confirmExpired }
  }

  if (decision === 'cancel') {
    await decideConfirmation(token, 'cancelled', by)
    await updateTurn(row.turn_id, { status: 'cancelled' })
    publish({
      type: 'jarvis.confirm.resolved',
      turnId: row.turn_id,
      message: NARRATION_TEMPLATES.cancelled,
      data: { token, decision: 'cancelled', by },
    })
    return { status: 'cancelled', row, message: NARRATION_TEMPLATES.cancelled }
  }

  await decideConfirmation(token, 'confirmed', by)
  publish({
    type: 'jarvis.confirm.resolved',
    turnId: row.turn_id,
    message: `Confirmed by ${by}.`,
    data: { token, decision: 'confirmed', by },
  })

  // The stored plan. Not a re-parse.
  return { status: 'confirmed', row, plan: row.plan as unknown as Plan }
}

/** Seconds left on a pending confirmation, for the TTL ring. */
export function secondsRemaining(expiresAt: string): number {
  return Math.max(0, Math.round((new Date(expiresAt).getTime() - Date.now()) / 1000))
}

/**
 * LEARNING AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `learning`, and `npm run agent:check` fails if not.
 */

import type { Confidence } from '../../../../shared/agent-contract'
import { similarity } from '../../../../shared/brand-voice'
import { insertKnowledgeEntry, listDraftsForIdeas, listIdeas, listKnowledge, listPosts, postBaseline, setKnowledgeActive, setKnowledgeConfidence, type KnowledgeEntryRow } from '../../db/repo'
import { confidenceRank, demoteConfidence, PLATFORM_LABEL, promoteConfidence } from '../corpus'
import { computeReward, weightsFrom } from '../../learning/rewards'
import { registerSkill } from '../runtime'
import type { LearningPayload } from '../skills/index'


/* ═══════════════════════════════════════════════════════════════════════════
   LEARNING 1 · learning.pattern.detect
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<LearningPayload>('learning.reward.compute', async (_payload, ctx) => {
  /*
   * SCORES EVERY DECIDED POST INTO A REWARD.
   *
   * Slice 2 of the Agent Lightning architecture. This is the "Reward Engine" box
   * in the diagram, and it is what makes the later RL layer possible: without a
   * number derived from real outcomes there is nothing to optimise against.
   *
   * It reads only stored evidence — approvals, revisions, rejection reasons,
   * measured metrics, and this account's own baseline. Nothing is estimated by a
   * model, because a reward a model guessed at would train the next model on a
   * guess.
   */
  const weights = weightsFrom(ctx.config)
  const minConfidence = ctx.num('minConfidenceToLearn', 50) / 100

  const ideas = await listIdeas(ctx.workspaceId, { limit: 200 })

  /** A post is scoreable once a human has decided on it. */
  const decided = ideas.filter(
    (idea) => idea.marketing_approved_by !== null || idea.leadership_decision !== null,
  )

  if (decided.length === 0) {
    ctx.log(
      'No post has been approved or rejected yet, so there is no outcome to score. ' +
        'The reward engine is registered and will score the first decision.',
    )
    return { rewards: [], scored: 0, learnable: 0, meanReward: null }
  }

  // Drafts carry the caption and the revision count — the human-effort signal.
  const drafts = await listDraftsForIdeas(decided.map((i) => i.id))
  const draftFor = new Map(drafts.map((d) => [`${d.idea_id}|${d.platform}`, d]))

  // This account's own published captions, for the repetition check.
  const published = await listPosts(ctx.workspaceId, { limit: 200 })
  const priorBodies = published.map((p) => p.content).filter((b) => b !== '')

  /*
   * The baseline is per platform, because engagement rates are not comparable
   * across them — a LinkedIn rate measured against an Instagram baseline would
   * be a fabricated comparison.
   */
  const baselineFor = new Map<string, { avgEngagementRate: number; samples: number }>()
  for (const platform of new Set(decided.map((i) => i.platform))) {
    baselineFor.set(platform, await postBaseline(ctx.workspaceId, platform, 4))
  }

  const rewards = decided.map((idea) => {
    const draft = draftFor.get(`${idea.id}|${idea.platform}`)
    const base = baselineFor.get(idea.platform)
    const body = draft?.body ?? ''

    const reward = computeReward(
      {
        body,
        revision: draft?.revision ?? 0,
        marketingApproved: idea.marketing_approved_by !== null,
        leadershipDecision: idea.leadership_decision as 'approved' | 'rejected' | null,
        // `feedback` is a JSONB array of notes, not a sentence — the reason is
        // read out of it rather than passed through as an object.
        rejectionReason: Array.isArray(idea.feedback)
          ? idea.feedback.map((f) => String((f as { note?: unknown }).note ?? f)).join('; ')
          : null,
        /*
         * Engagement is left absent rather than zero. `post_metrics` is written
         * only when a platform reports figures, and this tier publishes in demo
         * mode — so there is nothing measured to score. The reward reports the
         * exclusion instead of counting it against the post.
         */
        metrics: null,
        baseline: {
          engagementRate: base && base.samples > 0 ? base.avgEngagementRate / 100 : null,
          clickRate: null,
        },
        priorBodies: priorBodies.filter((b) => b !== body),
        topic: idea.source_topic ?? idea.title,
      },
      weights,
    )

    return { ideaId: idea.id, title: idea.title, platform: idea.platform, reward }
  })

  /*
   * A reward computed from too little evidence is noise, and batching it into an
   * optimisation run would teach the model from posts nobody has judged. Those
   * are recorded but withheld — the architecture's "batch experiences" step needs
   * a quality floor or it trains on its own uncertainty.
   */
  const learnable = rewards.filter((r) => r.reward.confidence >= minConfidence)

  for (const row of learnable.slice(0, 5)) {
    ctx.log(`${row.title.slice(0, 48)} — ${row.reward.summary}`)
  }
  if (rewards.length > learnable.length) {
    ctx.log(
      `${rewards.length - learnable.length} outcome(s) scored below the ` +
        `${Math.round(minConfidence * 100)}% evidence floor and are held back from optimisation.`,
    )
  }

  return {
    rewards,
    scored: rewards.length,
    learnable: learnable.length,
    meanReward:
      learnable.length === 0
        ? null
        : Number((learnable.reduce((s, r) => s + r.reward.total, 0) / learnable.length).toFixed(4)),
  }
})

registerSkill<LearningPayload>('learning.pattern.detect', async (_payload, ctx) => {
  const minOccurrences = ctx.num('minOccurrences', 2)
  const windowDays = ctx.num('windowDays', 60)
  const threshold = ctx.num('similarityThreshold', 62) / 100

  const cutoff = Date.now() - windowDays * 86_400_000

  // Three streams of evidence: what humans asked for, what leadership rejected,
  // and what actually performed.
  const ideas = await listIdeas(ctx.workspaceId, { limit: 200 })
  const posts = await listPosts(ctx.workspaceId, { limit: 80 })

  const signals: Array<{ text: string; category: string; source: string }> = []

  for (const idea of ideas) {
    if (new Date(idea.updated_at).getTime() < cutoff) continue

    for (const entry of idea.feedback) {
      const instruction = typeof entry.instruction === 'string' ? entry.instruction : ''
      if (instruction.trim().length > 0) {
        signals.push({ text: instruction, category: 'User Feedback', source: idea.title })
      }
    }

    const decision = idea.leadership_decision
    const reason = decision && typeof decision.reason === 'string' ? decision.reason : ''
    if (reason.trim().length > 0) {
      signals.push({
        text: reason,
        category: decision?.decision === 'rejected' ? 'Rejected Post' : 'Approved Post',
        source: idea.title,
      })
    }
  }

  for (const post of posts) {
    if (post.reach === null) continue
    const baseline = await postBaseline(ctx.workspaceId, post.platform, 8)
    if (baseline.samples < 2) continue
    const delta = ((Number(post.reach) - baseline.avgReach) / Math.max(1, baseline.avgReach)) * 100
    if (delta >= 25) {
      signals.push({
        text: `${PLATFORM_LABEL[post.platform]} posts like “${post.title}” outperform our average reach by ${Math.round(delta)}%.`,
        category: 'High Performer',
        source: post.title,
      })
    }
  }

  // Cluster the signals: a pattern is something said more than once.
  const clusters: Array<{ signal: string; occurrences: number; evidence: string[]; category: string }> = []
  for (const signal of signals) {
    const home = clusters.find(
      (c) => c.category === signal.category && similarity(c.signal, signal.text) >= threshold,
    )
    if (home) {
      home.occurrences += 1
      if (!home.evidence.includes(signal.source)) home.evidence.push(signal.source)
    } else {
      clusters.push({
        signal: signal.text,
        occurrences: 1,
        evidence: [signal.source],
        category: signal.category,
      })
    }
  }

  const patterns = clusters.filter((c) => c.occurrences >= minOccurrences)

  ctx.log(
    patterns.length === 0
      ? `No pattern reached ${minOccurrences} occurrences in the last ${windowDays} days (${signals.length} signal(s) seen)`
      : `${patterns.length} pattern(s) detected from ${signals.length} signal(s)`,
  )

  return { patterns }
})

/* ═══════════════════════════════════════════════════════════════════════════
   LEARNING 2 · learning.knowledge.write
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<LearningPayload>('learning.knowledge.write', async (payload, ctx) => {
  const defaultConfidence = ctx.str('defaultConfidence', 'Medium') as Confidence
  const askBeforeWriting = ctx.bool('askBeforeWriting', false)

  const patterns = payload.patterns ?? []
  if (patterns.length === 0) return { learned: [] }

  if (askBeforeWriting) {
    ctx.log(`${patterns.length} pattern(s) held for confirmation before writing`)
    return { learned: [] }
  }

  const existing = await listKnowledge(ctx.workspaceId, { activeOnly: true, limit: 400 })
  const learned: Array<{ id: string; title: string }> = []

  for (const pattern of patterns) {
    /*
     * Trim to a whole word only when the text was actually cut.
     *
     * The unconditional `replace(/\s+\S*$/, '')` removed the LAST word of every
     * signal, truncated or not: "Approved as submitted." is 22 characters, needed
     * no truncation, and became the title "Learned: Approved as" — which says
     * nothing. Three entries in the Knowledge Base read that way.
     */
    const signal = pattern.signal.trim()
    const clipped = signal.length > 60 ? signal.slice(0, 60).replace(/\s+\S*$/, '') : signal
    const title = `Learned: ${clipped.replace(/[.\s]+$/, '')}`

    // Already known? Confirm it rather than write it twice.
    const known = existing.find((row) => similarity(row.content, pattern.signal) >= 0.68)
    if (known) {
      ctx.log(`“${known.title}” already covers this pattern — confirmed rather than duplicated`)
      continue
    }

    const inserted = await insertKnowledgeEntry({
      workspaceId: ctx.workspaceId,
      title,
      category: pattern.category,
      content: `${pattern.signal} Seen ${pattern.occurrences} times across: ${pattern.evidence.slice(0, 4).join('; ')}.`,
      source: 'Velma',
      sources: [],
      hashtagId: null,
      confidence: defaultConfidence,
      origin: 'learned',
      buildId: null,
      tags: ['learned'],
    })

    if (inserted) {
      learned.push({ id: inserted.id, title })
      ctx.emit('knowledge.written', title, {
        id: inserted.id,
        origin: 'learned',
        occurrences: pattern.occurrences,
      })
    }
  }

  ctx.log(`${learned.length} lesson(s) written back to the Knowledge Base at ${defaultConfidence} confidence`)

  return { learned }
})

/* ═══════════════════════════════════════════════════════════════════════════
   LEARNING 3 · learning.confidence.promote
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<LearningPayload>('learning.confidence.promote', async (_payload, ctx) => {
  const promoteAfter = ctx.num('promoteAfter', 3)

  const rows = await listKnowledge(ctx.workspaceId, { activeOnly: true, limit: 400 })
  const learnedRows = rows.filter((r) => r.origin === 'learned' || r.origin === 'research')

  const promoted: Array<{ id: string; title: string; to: Confidence }> = []

  for (const row of learnedRows) {
    if (row.confidence === 'High') continue
    if (row.evidence_count < promoteAfter) continue

    const next = promoteConfidence(row.confidence)
    await setKnowledgeConfidence(row.id, next)
    promoted.push({ id: row.id, title: row.title, to: next })
  }

  ctx.log(
    promoted.length === 0
      ? `No entry has reached ${promoteAfter} confirmations`
      : `${promoted.length} entr${promoted.length === 1 ? 'y' : 'ies'} promoted after ${promoteAfter} confirmations`,
  )

  return { promoted }
})

/* ═══════════════════════════════════════════════════════════════════════════
   LEARNING 4 · learning.confidence.demote
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<LearningPayload>('learning.confidence.demote', async (_payload, ctx) => {
  const demoteAfter = ctx.num('demoteAfter', 2)
  const deactivateAtFloor = ctx.bool('deactivateAtFloor', true)

  const rows = await listKnowledge(ctx.workspaceId, { activeOnly: true, limit: 400 })
  const learnedRows = rows.filter((r) => r.origin === 'learned')

  // A contradiction is a rejection reason that argues against a learned entry.
  const ideas = await listIdeas(ctx.workspaceId, { limit: 200 })
  const rejections = ideas
    .map((i) => i.leadership_decision)
    .filter(
      (d): d is Record<string, unknown> =>
        d !== null && d.decision === 'rejected' && typeof d.reason === 'string',
    )
    .map((d) => String(d.reason))

  const demoted: Array<{ id: string; title: string; to: Confidence; deactivated: boolean }> = []

  for (const row of learnedRows) {
    const contradictions = rejections.filter((reason) => contradicts(reason, row)).length
    if (contradictions < demoteAfter) continue

    const next = demoteConfidence(row.confidence)
    const atFloor = row.confidence === 'Low'

    if (atFloor && deactivateAtFloor) {
      // Deactivated, never deleted: the lesson and the reason it stopped
      // applying both remain reconstructable.
      await setKnowledgeActive(ctx.workspaceId, row.id, false)
      demoted.push({ id: row.id, title: row.title, to: 'Low', deactivated: true })
      ctx.emit(
        'activity',
        `“${row.title}” was contradicted ${contradictions} times and has been switched off — it stays on record with its history.`,
        { status: 'warn' },
      )
      continue
    }

    await setKnowledgeConfidence(row.id, next)
    demoted.push({ id: row.id, title: row.title, to: next, deactivated: false })
  }

  ctx.log(
    demoted.length === 0
      ? `No learned entry has been contradicted ${demoteAfter} times`
      : `${demoted.length} entr${demoted.length === 1 ? 'y' : 'ies'} demoted; ${demoted.filter((d) => d.deactivated).length} deactivated at the floor`,
  )

  return { demoted }
})

function contradicts(reason: string, row: KnowledgeEntryRow): boolean {
  // A rejection contradicts a learned preference when it talks about the same
  // thing and carries an opposing instruction.
  if (similarity(reason, row.content) < 0.4) return false
  const negations = /\b(not|never|avoid|stop|too|less|remove|drop|instead)\b/i
  return negations.test(reason)
}

/** Exposed so the command plane memory writer can rank a candidate preference. */
export { confidenceRank }

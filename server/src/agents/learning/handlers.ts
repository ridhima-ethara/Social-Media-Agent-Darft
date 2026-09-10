/**
 * LEARNING AGENT — skill handlers
 *
 * One folder per agent. The skills registered here are exactly the ones the
 * registry declares for `learning`, and `npm run agent:check` fails if not.
 */

import type { Confidence } from '../../../../shared/agent-contract'
import { similarity } from '../../../../shared/brand-voice'
import { insertKnowledgeEntry, listIdeas, listKnowledge, listPosts, postBaseline, setKnowledgeActive, setKnowledgeConfidence, type KnowledgeEntryRow } from '../../db/repo'
import { confidenceRank, demoteConfidence, PLATFORM_LABEL, promoteConfidence } from '../corpus'
import { registerSkill } from '../runtime'
import type { LearningPayload } from '../skills/index'


/* ═══════════════════════════════════════════════════════════════════════════
   LEARNING 1 · learning.pattern.detect
   ═══════════════════════════════════════════════════════════════════════════ */

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

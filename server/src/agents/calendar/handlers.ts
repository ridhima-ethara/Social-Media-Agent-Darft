/**
 * THE CALENDAR & IDEAS AGENT — stage `plan`
 *
 * Turns ranked opportunities into dated, timed, platform-assigned ideas, then
 * applies the top-10 rule: per platform independently, the ten strongest ideas
 * take a calendar slot and everything else sits in More suggestions with its
 * rank intact.
 *
 * Nothing here is random. Slot choice is a lookup in an hour-weight table
 * filtered by the window knobs, spread deterministically, and every choice
 * carries up to four evidence-bearing reasons.
 */

import type { Platform } from '../../../../shared/agent-contract'
import { PLATFORMS } from '../../../../shared/agent-contract'
import { similarity } from '../../../../shared/brand-voice'
import { listIdeas, listPosts } from '../../db/repo'
import { textAdapter, textModelId } from '../../integrations'
import {
  addDays,
  clamp,
  clampWords,
  FORMAT_PLATFORM_FIT,
  HOUR_WEIGHTS,
  isoDate,
  isWeekend,
  labelToMinutes,
  nearestPostingTime,
  PLATFORM_LABEL,
  seededFor,
  planningStart,
  weekdayName,
  type ContentFormat,
} from '../corpus'
import { registerSkill } from '../runtime'
import type { PipelinePayload, PlannedIdea } from '../skills/index'

/* ═══════════════════════════════════════════════════════════════════════════
   1 · calendar.idea.form
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.idea.form', async (payload, ctx) => {
  const maxIdeas = ctx.num('maxIdeasPerRun', 16)
  const titleMaxWords = ctx.num('titleMaxWords', 12)
  const markNewTrends = ctx.bool('markNewTrends', true)
  const preferModel = ctx.bool('preferModel', true)

  const opportunities = (payload.opportunities ?? []).slice(0, Math.max(1, maxIdeas))

  const ideas: PlannedIdea[] = opportunities.map((opportunity, index) => ({
    key: `idea-${index + 1}`,
    title: clampWords(opportunity.title, titleMaxWords),
    description: opportunity.description,
    sourceTopic: opportunity.sourceTopic,
    sourceExternalId: opportunity.sourceExternalId,
    hashtag: opportunity.hashtag,
    // Placeholders until `platform.select` and `slot.optimize` decide.
    platform: 'linkedin',
    altPlatforms: [],
    scheduledDate: isoDate(new Date()),
    scheduledTime: '10:30 AM',
    confidence: clamp(Math.round((opportunity.brandRelevance + opportunity.predictedEngagement) / 2), 0, 100),
    priorityScore: 0,
    platformRank: null,
    calendarSlot: 'suggestion',
    isNewTrend: markNewTrends && opportunity.isNewTrend,
    format: opportunity.format,
    angle: opportunity.angle,
    audience: opportunity.audience,
    brandRelevance: opportunity.brandRelevance,
    trendScore: opportunity.trendScore,
    slotReasons: [],
    conflicts: [],
  }))

  // The phrasing pass. Everything the calendar DECIDES — confidence, platform,
  // date, time, rank — is computed above and below this point and is untouched
  // by it. The model is asked only to say the same thing better.
  const phrasing = await phraseIdeas(ideas, { enabled: preferModel, titleMaxWords })

  if (phrasing.applied > 0) {
    ctx.log(`${phrasing.applied} of ${ideas.length} idea(s) phrased by ${phrasing.model}`)
  }
  for (const rejection of phrasing.rejections) {
    // Rule 6: a rejected rewrite names the evidence that rejected it.
    ctx.emit('activity', rejection, { status: 'warn' })
  }
  if (phrasing.fallbackReason !== undefined) {
    ctx.emit('activity', `Idea titles left as formed — ${phrasing.fallbackReason}`, {
      status: 'warn',
      reason: phrasing.fallbackReason,
    })
  }

  for (const idea of ideas) {
    ctx.emit('idea.created', idea.title, {
      key: idea.key,
      sourceTopic: idea.sourceTopic,
      confidence: idea.confidence,
      isNewTrend: idea.isNewTrend,
    })
  }

  ctx.log(
    `${ideas.length} idea${ideas.length === 1 ? '' : 's'} formed` +
      (markNewTrends ? ` · ${ideas.filter((i) => i.isNewTrend).length} from a newly trending keyword` : ''),
  )

  return { ideas, ideaPhrasingSource: phrasing.source, ideaPhrasingModel: phrasing.model }
})

/* ── The phrasing pass ─────────────────────────────────────────────────────── */

interface PhrasingOutcome {
  applied: number
  source: 'live' | 'fixture'
  model: string
  fallbackReason?: string
  rejections: string[]
}

/**
 * Rewrites idea titles and descriptions in place, and ONLY where the rewrite
 * is safe to accept.
 *
 * Two properties are enforced rather than requested:
 *
 *  · A rewrite that introduces a digit the source material does not contain is
 *    rejected outright (constraint 3 — never fabricate evidence). Asking a
 *    model not to invent figures is a request; checking is an enforcement.
 *  · The title-length knob is applied after the rewrite, so the operator's
 *    ceiling holds whatever the model returned.
 *
 * A failure here is never fatal: the deterministically-formed titles are
 * already in place, so the worst case is that they stay.
 */
async function phraseIdeas(
  ideas: PlannedIdea[],
  opts: { enabled: boolean; titleMaxWords: number },
): Promise<PhrasingOutcome> {
  const rejections: string[] = []
  const writer = textAdapter()

  if (!opts.enabled) {
    return { applied: 0, source: 'fixture', model: 'ethara-template-writer', rejections }
  }
  if (!writer.isConfigured()) {
    return {
      applied: 0,
      source: 'fixture',
      model: 'ethara-template-writer',
      fallbackReason: writer.unavailableReason(),
      rejections,
    }
  }
  if (ideas.length === 0) {
    return { applied: 0, source: 'fixture', model: 'ethara-template-writer', rejections }
  }

  // One call for the whole batch: sixteen round trips to a local model would
  // dominate the stage's wall clock for no gain in quality.
  const brief = ideas
    .map((idea, index) =>
      [
        `${index + 1}. key=${idea.key}`,
        `   topic: ${idea.sourceTopic}`,
        `   angle: ${idea.angle}`,
        `   audience: ${idea.audience}`,
        `   format: ${idea.format}`,
        `   current title: ${idea.title}`,
        `   current description: ${idea.description}`,
      ].join('\n'),
    )
    .join('\n\n')

  let raw: string
  try {
    raw = await writer.run({
      systemInstruction: [
        'You phrase content-calendar ideas for a frontier AI research lab.',
        'Rewrite each title as a specific, declarative headline — no colons, no questions, no buzzwords, no emoji.',
        'Rewrite each description as one or two plain sentences saying what the post will argue.',
        'Introduce NO new facts, NO new numbers, NO dates and NO named entities that are not already present in the material you are given.',
        'Return ONLY a JSON array of objects with the keys "key", "title" and "description". No prose, no code fence.',
      ].join('\n'),
      prompt: brief,
      temperature: 0.3,
      maxOutputTokens: 2048,
    })
  } catch (error) {
    return {
      applied: 0,
      source: 'fixture',
      model: 'ethara-template-writer',
      fallbackReason:
        error instanceof Error ? error.message : 'the text model failed to phrase the ideas',
      rejections,
    }
  }

  const rows = parseIdeaRows(raw)
  if (rows === null) {
    return {
      applied: 0,
      source: 'fixture',
      model: 'ethara-template-writer',
      fallbackReason: 'the text model did not return a readable JSON array',
      rejections,
    }
  }

  let applied = 0
  for (const row of rows) {
    const idea = ideas.find((i) => i.key === row.key)
    if (!idea) continue

    // The digits the model is allowed to use are exactly the digits already in
    // the evidence for this idea.
    const permitted = `${idea.title} ${idea.description} ${idea.sourceTopic} ${idea.angle} ${idea.audience}`

    const nextTitle = row.title.trim()
    const nextDescription = row.description.trim()

    if (nextTitle.length >= 8 && nextTitle.length <= 200) {
      const invented = inventedFigures(permitted, nextTitle)
      if (invented.length > 0) {
        rejections.push(
          `Title rewrite for “${idea.title}” rejected: it introduced ${invented.join(', ')}, which is not in the evidence.`,
        )
      } else {
        idea.title = clampWords(nextTitle, opts.titleMaxWords)
        applied += 1
      }
    }

    if (nextDescription.length >= 20 && nextDescription.length <= 800) {
      const invented = inventedFigures(permitted, nextDescription)
      if (invented.length > 0) {
        rejections.push(
          `Description rewrite for “${idea.title}” rejected: it introduced ${invented.join(', ')}, which is not in the evidence.`,
        )
      } else {
        idea.description = nextDescription
      }
    }
  }

  return {
    applied,
    source: applied > 0 ? 'live' : 'fixture',
    model: applied > 0 ? textModelId() : 'ethara-template-writer',
    rejections,
  }
}

interface IdeaRow {
  key: string
  title: string
  description: string
}

/** Tolerant JSON extraction — a model may wrap the array in a fence or prose. */
function parseIdeaRows(raw: string): IdeaRow[] | null {
  const start = raw.indexOf('[')
  const end = raw.lastIndexOf(']')
  if (start === -1 || end <= start) return null

  let parsed: unknown
  try {
    parsed = JSON.parse(raw.slice(start, end + 1))
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null

  const rows: IdeaRow[] = []
  for (const entry of parsed) {
    if (typeof entry !== 'object' || entry === null) continue
    const record = entry as Record<string, unknown>
    if (
      typeof record.key === 'string' &&
      typeof record.title === 'string' &&
      typeof record.description === 'string'
    ) {
      rows.push({ key: record.key, title: record.title, description: record.description })
    }
  }
  return rows
}

/**
 * The numbers present in `candidate` but absent from `source`.
 *
 * Deliberately compares number-like tokens rather than characters, so "10" in
 * the source does not license "2010" in the rewrite. Percentages and decimals
 * are captured as written, because "40" and "40%" are different claims.
 */
export function inventedFigures(source: string, candidate: string): string[] {
  const tokensIn = (text: string): Set<string> => {
    const found = new Set<string>()
    for (const match of text.matchAll(/\d+(?:[.,]\d+)*\s*%?/g)) {
      found.add(match[0].replace(/\s+/g, '').toLowerCase())
    }
    return found
  }

  const permitted = tokensIn(source)
  const invented: string[] = []
  for (const token of tokensIn(candidate)) {
    if (!permitted.has(token)) invented.push(token)
  }
  return invented.slice(0, 4)
}

/* ═══════════════════════════════════════════════════════════════════════════
   2 · calendar.idea.dedupe
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.idea.dedupe', async (payload, ctx) => {
  const threshold = ctx.num('similarityThreshold', 68) / 100
  const lookbackDays = ctx.num('lookbackDays', 45)

  const ideas = payload.ideas ?? []
  if (ideas.length === 0) return {}

  const existing = await listIdeas(ctx.workspaceId, { limit: 200 })
  const published = await listPosts(ctx.workspaceId, { limit: 100 })
  const cutoff = Date.now() - lookbackDays * 86_400_000

  const priorTitles = [
    ...existing.map((i) => i.title),
    ...published
      .filter((p) => p.published_at !== null && new Date(p.published_at).getTime() >= cutoff)
      .map((p) => p.title),
  ]

  const kept: PlannedIdea[] = []
  const dropped: string[] = []

  for (const idea of ideas) {
    const priorTwin = priorTitles.find((title) => similarity(title, idea.title) >= threshold)
    if (priorTwin) {
      dropped.push(`“${idea.title}” repeats “${priorTwin}”`)
      continue
    }
    const batchTwin = kept.find((other) => similarity(other.title, idea.title) >= threshold)
    if (batchTwin) {
      dropped.push(`“${idea.title}” repeats “${batchTwin.title}” from this run`)
      continue
    }
    kept.push(idea)
  }

  ctx.log(
    dropped.length === 0
      ? `No repeats against the calendar or the last ${lookbackDays} days of published posts`
      : `${dropped.length} repeat idea(s) dropped: ${dropped.slice(0, 2).join('; ')}${dropped.length > 2 ? '…' : ''}`,
  )

  return { ideas: kept }
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · calendar.platform.select
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.platform.select', (payload, ctx) => {
  const primaryPlatform = ctx.str('primaryPlatform', 'linkedin') as Platform
  const alternateThreshold = ctx.num('alternateThreshold', 55)

  /*
   * WHICH PLATFORMS MAY BE CHOSEN AT ALL.
   *
   * `primaryPlatform` only ever added +1 as a tie-break, so it expressed a
   * preference and excluded nothing: a Carousel scores higher on Instagram than
   * on LinkedIn in the fit matrix, so it went to Instagram however the
   * preference was set. An operator who had "set it to LinkedIn" then found
   * Instagram, X and Facebook ideas on the calendar and was right to call it a
   * bug. This is the actual restriction.
   *
   * An unparseable or empty list falls back to every platform WITH a stated
   * reason rather than silently placing nothing — an empty calendar with no
   * explanation is the worse failure.
   */
  const configured = ctx
    .str('enabledPlatforms', PLATFORMS.join(','))
    .split(',')
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '')

  const unknown = configured.filter((part) => !PLATFORMS.includes(part as Platform))
  const enabled = configured.filter((part): part is Platform => PLATFORMS.includes(part as Platform))

  if (unknown.length > 0) {
    ctx.emit('activity', `Ignoring unknown platform id(s) in Platforms in play: ${unknown.join(', ')}.`, {
      status: 'warn',
    })
  }

  const inPlay: Platform[] = enabled.length > 0 ? enabled : [...PLATFORMS]
  if (enabled.length === 0) {
    ctx.emit(
      'activity',
      'Platforms in play named no valid platform, so every platform is considered this run.',
      { status: 'warn' },
    )
  }

  // The tie-break only means anything if it is one of the platforms in play.
  const tieBreak = inPlay.includes(primaryPlatform) ? primaryPlatform : (inPlay[0] as Platform)

  const ideas = payload.ideas ?? []

  for (const idea of ideas) {
    const fit = FORMAT_PLATFORM_FIT[idea.format as ContentFormat] ?? FORMAT_PLATFORM_FIT['Thought Leadership']

    const scored = inPlay
      .map((platform) => ({
        platform,
        // A tie breaks toward the declared platform rather than toward
        // whichever key the object happened to list first.
        score: fit[platform] + (platform === tieBreak ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score)

    const winner = scored[0] as { platform: Platform; score: number }
    idea.platform = winner.platform
    idea.altPlatforms = scored
      .slice(1)
      .filter((s) => s.score >= alternateThreshold)
      .map((s) => ({ platform: s.platform, score: s.score }))

    // Confidence is the average of the platform fit and the brand fit: how well
    // it suits the channel, and how well it suits us.
    idea.confidence = clamp(Math.round((winner.score + idea.brandRelevance) / 2), 0, 100)
  }

  const tally = new Map<Platform, number>()
  for (const idea of ideas) tally.set(idea.platform, (tally.get(idea.platform) ?? 0) + 1)
  ctx.log(
    'Platforms: ' +
      [...tally.entries()].map(([p, n]) => `${n} × ${PLATFORM_LABEL[p]}`).join(', ') +
      ` · in play ${inPlay.map((p) => PLATFORM_LABEL[p]).join(', ')}` +
      ` · alternates listed above ${alternateThreshold}%`,
  )

  return { ideas }
})

/* ═══════════════════════════════════════════════════════════════════════════
   4 · calendar.slot.optimize
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.slot.optimize', (payload, ctx) => {
  const windowStart = ctx.num('preferredWindowStart', 8)
  const windowEnd = ctx.num('preferredWindowEnd', 18)
  const avoidWeekends = ctx.bool('avoidWeekends', true)
  const minHoursBetween = ctx.num('minHoursBetweenPosts', 4)
  const maxReasons = ctx.num('maxReasons', 4)

  const ideas = payload.ideas ?? []
  if (ideas.length === 0) return {}

  // The hour-weight table filtered to the operator's window. The table is the
  // evidence; the knobs decide which part of it is admissible.
  const admissible = HOUR_WEIGHTS.map((weight, hour) => ({ hour, weight }))
    .filter((h) => h.hour >= windowStart && h.hour <= windowEnd)
    .sort((a, b) => b.weight - a.weight)

  const bestHour = admissible[0] ?? { hour: 10, weight: HOUR_WEIGHTS[10] as number }
  // Never before today: a slot in a day that has gone cannot be published.
  const weekStart = planningStart()

  // Deterministic spreading: day offsets walk the week, so two runs of the same
  // corpus place the same ideas on the same days.
  const taken = new Map<string, number[]>()

  ideas.forEach((idea, index) => {
    const rand = seededFor(idea.title, 4127)
    let dayOffset = index % 7
    let date = isoDate(addDays(weekStart, dayOffset))

    if (avoidWeekends) {
      let guard = 0
      while (isWeekend(date) && guard < 7) {
        dayOffset = (dayOffset + 1) % 7
        date = isoDate(addDays(weekStart, dayOffset))
        guard += 1
      }
    }

    // Choose an hour from the admissible set, preferring the strongest but
    // stepping down when the slot is already occupied inside the minimum gap.
    let chosen = bestHour
    let stepped = false
    for (const option of admissible) {
      const usedHours = taken.get(date) ?? []
      const clash = usedHours.some((h) => Math.abs(h - option.hour) < minHoursBetween)
      if (!clash) {
        chosen = option
        break
      }
      stepped = true
    }

    // A small deterministic jitter within the hour keeps a stack of posts from
    // sharing an identical timestamp without moving them off the grid.
    const label = nearestPostingTime(chosen.hour + (rand() < 0.5 ? 0 : 0.4))

    idea.scheduledDate = date
    idea.scheduledTime = label
    taken.set(date, [...(taken.get(date) ?? []), chosen.hour])

    const reasons: string[] = []
    reasons.push(
      `${weekdayName(date)} at ${label} is the strongest admissible slot in your ${windowStart}:00–${windowEnd}:00 window (audience weight ${chosen.weight} of 100).`,
    )
    if (avoidWeekends) {
      reasons.push('Weekends are skipped — this audience reads on working days.')
    }
    if (stepped) {
      reasons.push(
        `The peak hour was already taken within the ${minHoursBetween}-hour minimum gap, so this stepped down to the next strongest.`,
      )
    }
    reasons.push(
      `${PLATFORM_LABEL[idea.platform]} suits a ${idea.format.toLowerCase()} on ${idea.sourceTopic}, which is what this idea is.`,
    )

    idea.slotReasons = reasons.slice(0, Math.max(1, maxReasons))
  })

  ctx.log(
    `${ideas.length} idea(s) placed between ${windowStart}:00 and ${windowEnd}:00` +
      (avoidWeekends ? ', weekends skipped' : ''),
  )

  return { ideas }
})

/* ═══════════════════════════════════════════════════════════════════════════
   5 · calendar.cadence.balance
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.cadence.balance', (payload, ctx) => {
  const maxPerDay = ctx.num('maxPerDay', 3)
  const maxPerPlatformPerDay = ctx.num('maxPerPlatformPerDay', 1)
  const targetPerWeek = ctx.num('targetPerWeek', 3)

  const ideas = payload.ideas ?? []
  if (ideas.length === 0) return {}

  // The same base the placement used, so the weekly count below measures the
  // window that was actually planned rather than one starting before it.
  const weekStart = planningStart()
  const perDay = new Map<string, number>()
  const perDayPlatform = new Map<string, number>()
  let moved = 0

  for (const idea of ideas.sort((a, b) => b.confidence - a.confidence)) {
    let guard = 0
    for (;;) {
      const dayKey = idea.scheduledDate
      const platformKey = `${idea.scheduledDate}|${idea.platform}`
      const dayCount = perDay.get(dayKey) ?? 0
      const platformCount = perDayPlatform.get(platformKey) ?? 0

      if (dayCount < maxPerDay && platformCount < maxPerPlatformPerDay) {
        perDay.set(dayKey, dayCount + 1)
        perDayPlatform.set(platformKey, platformCount + 1)
        break
      }

      if (guard >= 14) break
      const next = isoDate(addDays(new Date(`${idea.scheduledDate}T12:00:00Z`), 1))
      idea.scheduledDate = next
      idea.slotReasons = [
        ...idea.slotReasons,
        `Moved to ${weekdayName(next)} — ${dayCount >= maxPerDay ? `the day already held ${dayCount} posts against a ${maxPerDay}-post ceiling` : `${PLATFORM_LABEL[idea.platform]} already had ${platformCount} post that day against a ${maxPerPlatformPerDay}-per-day ceiling`}.`,
      ]
      moved += 1
      guard += 1
    }
  }

  const perPlatformWeek = new Map<Platform, number>()
  const weekEnd = addDays(weekStart, 7)
  for (const idea of ideas) {
    const d = new Date(`${idea.scheduledDate}T12:00:00Z`)
    if (d >= weekStart && d < weekEnd) {
      perPlatformWeek.set(idea.platform, (perPlatformWeek.get(idea.platform) ?? 0) + 1)
    }
  }

  const short = PLATFORMS.filter((p) => (perPlatformWeek.get(p) ?? 0) < targetPerWeek)
  ctx.log(
    `${moved} idea(s) moved to respect the daily ceilings` +
      (short.length > 0
        ? ` · ${short.map((p) => `${PLATFORM_LABEL[p]} ${perPlatformWeek.get(p) ?? 0}/${targetPerWeek}`).join(', ')} this week`
        : ' · every platform meets its weekly target'),
  )

  return { ideas }
})

/* ═══════════════════════════════════════════════════════════════════════════
   6 · calendar.conflict.detect
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.conflict.detect', (payload, ctx) => {
  const windowHours = ctx.num('windowHours', 6)
  const topicConflicts = ctx.bool('topicConflicts', true)

  const ideas = payload.ideas ?? []
  let found = 0

  for (let i = 0; i < ideas.length; i += 1) {
    const a = ideas[i] as PlannedIdea
    for (let j = i + 1; j < ideas.length; j += 1) {
      const b = ideas[j] as PlannedIdea
      if (a.scheduledDate !== b.scheduledDate) continue

      const gapHours = Math.abs(labelToMinutes(a.scheduledTime) - labelToMinutes(b.scheduledTime)) / 60
      if (gapHours < windowHours && a.platform === b.platform) {
        const note = `${PLATFORM_LABEL[a.platform]} has two posts ${gapHours.toFixed(1)}h apart on ${weekdayName(a.scheduledDate)}, inside the ${windowHours}h window: “${a.title}” and “${b.title}”.`
        a.conflicts = [...a.conflicts, note]
        b.conflicts = [...b.conflicts, note]
        found += 1
        continue
      }

      if (topicConflicts && a.sourceTopic === b.sourceTopic && gapHours < windowHours * 4) {
        const note = `Both posts run on “${a.sourceTopic}” within ${Math.round(gapHours)}h — the second will read as a repeat.`
        a.conflicts = [...a.conflicts, note]
        b.conflicts = [...b.conflicts, note]
        found += 1
      }
    }
  }

  ctx.log(found === 0 ? 'No scheduling conflicts' : `${found} scheduling conflict(s) flagged`)

  return { ideas }
})

/* ═══════════════════════════════════════════════════════════════════════════
   7 · calendar.crossplatform.adapt
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.crossplatform.adapt', (payload, ctx) => {
  if (!ctx.bool('enabled', true)) return {}

  const maxVariants = ctx.num('maxVariants', 2)
  const staggerDays = ctx.num('staggerDays', 2)

  const ideas = payload.ideas ?? []
  const variants: PlannedIdea[] = []

  // Only the strongest ideas earn a second channel; adapting everything would
  // fill the calendar with echoes.
  const eligible = [...ideas]
    .filter((i) => i.altPlatforms.length > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, maxVariants))

  for (const idea of eligible) {
    const alt = idea.altPlatforms[0]
    if (!alt) continue

    const date = isoDate(addDays(new Date(`${idea.scheduledDate}T12:00:00Z`), staggerDays))
    variants.push({
      ...idea,
      key: `${idea.key}-alt-${alt.platform}`,
      platform: alt.platform,
      altPlatforms: [],
      scheduledDate: date,
      scheduledTime: nearestPostingTime(alt.platform === 'x' ? 9 : 16),
      confidence: clamp(Math.round((alt.score + idea.brandRelevance) / 2), 0, 100),
      calendarSlot: 'suggestion',
      platformRank: null,
      variantOf: idea.key,
      slotReasons: [
        `Adapted from the ${PLATFORM_LABEL[idea.platform]} post, staggered ${staggerDays} day${staggerDays === 1 ? '' : 's'} later so the two do not compete.`,
        `${PLATFORM_LABEL[alt.platform]} scored ${alt.score}% on this format, which cleared the alternate threshold.`,
      ],
      conflicts: [],
    })
  }

  ctx.log(
    variants.length === 0
      ? 'No cross-platform variants — no idea had an alternate above the threshold'
      : `${variants.length} cross-platform variant(s) added, staggered ${staggerDays} day(s)`,
  )

  return { ideas: [...ideas, ...variants] }
})

/* ═══════════════════════════════════════════════════════════════════════════
   8 · calendar.rank.select — THE TOP-10 RULE
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.rank.select', async (payload, ctx) => {
  // The registry declares 5. A different fallback here meant a run without the
  // knob resolved silently placed twice as many.
  const topPerPlatform = ctx.num('topPerPlatform', 5)
  const confidenceWeight = ctx.num('rankConfidenceWeight', 45) / 100
  const relevanceWeight = ctx.num('rankRelevanceWeight', 35) / 100
  const trendWeight = ctx.num('rankTrendWeight', 20) / 100
  const balance = ctx.bool('balanceAcrossPlatforms', true)

  const ideas = payload.ideas ?? []
  if (ideas.length === 0) return {}

  for (const idea of ideas) {
    idea.priorityScore = clamp(
      Math.round(
        idea.confidence * confidenceWeight +
          idea.brandRelevance * relevanceWeight +
          idea.trendScore * trendWeight,
      ),
      0,
      100,
    )
  }

  /*
   * THE CAP IS A PROPERTY OF THE CALENDAR, NOT OF A RUN.
   *
   * This ranked `payload.ideas` alone, so every run promoted its own top
   * `topPerPlatform` with no knowledge of what was already scheduled. Fifteen
   * runs therefore produced nineteen LinkedIn primaries against a declared cap
   * of five — each run individually correct, the calendar collectively wrong.
   *
   * Existing primaries are counted first and the run fills only the headroom
   * that is left. Ideas this run already owns are excluded from that count, so
   * re-running discovery re-ranks its own work instead of counting it twice.
   */
  const onCalendar = await listIdeas(ctx.workspaceId, { limit: 400 })
  // Title plus platform is how a stored idea is recognised — `persistIdeas`
  // upserts on it, so it is the same identity the write path uses.
  const own = new Set(ideas.map((i) => `${i.title.toLowerCase()}|${i.platform}`))
  const heldByPlatform = new Map<Platform, number>()
  for (const row of onCalendar) {
    if (row.calendar_slot !== 'primary') continue
    if (row.status === 'rejected') continue
    // Skip what this run is re-scoring, or it would be counted twice.
    if (own.has(`${row.title.toLowerCase()}|${row.platform}`)) continue
    heldByPlatform.set(row.platform, (heldByPlatform.get(row.platform) ?? 0) + 1)
  }

  // Per platform INDEPENDENTLY. A strong LinkedIn week must not consume the
  // Instagram slots.
  const primaries: string[] = []
  for (const platform of PLATFORMS) {
    const held = heldByPlatform.get(platform) ?? 0
    const headroom = Math.max(0, topPerPlatform - held)

    const forPlatform = ideas
      .filter((i) => i.platform === platform)
      .sort((a, b) => b.priorityScore - a.priorityScore || a.title.localeCompare(b.title))

    forPlatform.forEach((idea, index) => {
      idea.platformRank = held + index + 1
      idea.calendarSlot = index < headroom ? 'primary' : 'suggestion'
      if (idea.calendarSlot === 'primary') primaries.push(idea.key)
    })

    const placed = Math.min(forPlatform.length, headroom)
    ctx.emit(
      'idea.ranked',
      `${PLATFORM_LABEL[platform]}: ${placed} placed, ${Math.max(0, forPlatform.length - headroom)} to suggestions` +
        (held > 0 ? ` · ${held} already on the calendar of ${topPerPlatform}` : ''),
      { platform, primary: placed, suggestions: Math.max(0, forPlatform.length - headroom), held },
    )
  }

  const counts = PLATFORMS.map((p) => ({
    platform: p,
    primary: ideas.filter((i) => i.platform === p && i.calendarSlot === 'primary').length,
    suggestions: ideas.filter((i) => i.platform === p && i.calendarSlot === 'suggestion').length,
  }))

  ctx.log(
    counts
      .map((c) => `${PLATFORM_LABEL[c.platform]} ${c.primary}/${topPerPlatform} + ${c.suggestions}`)
      .join(' · ') + (balance ? '' : ' · cross-platform balancing off'),
  )

  return { ideas }
})

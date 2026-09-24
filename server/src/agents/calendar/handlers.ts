/**
 * THE CALENDAR & IDEAS AGENT — stage `plan`
 *
 * Turns validated opportunities into dated, timed, platform-assigned TOPICS,
 * then applies the per-platform cap: independently for each platform, the
 * strongest ideas up to `topPerPlatform` per week take a date on the calendar.
 * There is no suggestion list — an idea below the cut-off is not placed, and a
 * stored topic displaced from the calendar is withdrawn with its reason. The
 * cap belongs to the calendar, so a platform found over it is repaired rather
 * than left as earlier runs left it.
 *
 * This agent places topics; it writes no post. Which placed topics become
 * written posts now (today, and tomorrow when the schedule requires it) and
 * which wait in the Topic Queue is `shared/calendar-horizon.ts`, applied by the
 * orchestrator after this stage.
 *
 * Nothing here is random. Slot choice is a lookup in an hour-weight table
 * filtered by the window knobs, spread deterministically, and every choice
 * carries up to four evidence-bearing reasons.
 */

import type { IdeaStatus, Platform } from '../../../../shared/agent-contract'
import { PLATFORMS } from '../../../../shared/agent-contract'
import { similarity } from '../../../../shared/brand-voice'
// Aliased: `IdeaRow` below is the shape a model returns for a batch of ideas,
// which is a different thing from a stored row and must not shadow it.
import { listIdeas, listPosts, updateIdea, withdrawIdea, type IdeaRow as StoredIdea } from '../../db/repo'
import { textAdapter, textChain, textModelIdFor, withChainFallback } from '../../integrations'
import {
  addDays,
  clamp,
  clampWords,
  FORMAT_PLATFORM_FIT,
  HOUR_WEIGHTS,
  isoDate,
  labelToMinutes,
  nearestPostingTime,
  PLATFORM_LABEL,
  seededFor,
  inPlanningWindow,
  planningDays,
  planningStart,
  workspaceDay,
  weekdayName,
  type EditorialFormat,
} from '../corpus'
import { registerSkill } from '../runtime'
import type { PipelinePayload, PlannedIdea } from '../skills/index'
import { resolveCalendarHorizon } from '../../calendar-horizon'

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
    scheduledDate: isoDate(workspaceDay()),
    scheduledTime: '10:30 AM',
    confidence: clamp(Math.round((opportunity.brandRelevance + opportunity.predictedEngagement) / 2), 0, 100),
    priorityScore: 0,
    platformRank: null,
    // Every idea is a calendar topic; rank selection decides which are placed
    // and drops the rest rather than keeping a suggestion list.
    calendarSlot: 'primary',
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
  const chain = textChain()

  if (!opts.enabled) {
    return { applied: 0, source: 'fixture', model: 'ethara-template-writer', rejections }
  }
  if (chain.length === 0) {
    return {
      applied: 0,
      source: 'fixture',
      model: 'ethara-template-writer',
      fallbackReason: textAdapter().unavailableReason(),
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

  // Every configured provider in turn, then the template writer. An empty
  // string is the sentinel for "no provider answered": the chain's fixture
  // cannot return this function's structured result, so the branch is here.
  const outcome = await withChainFallback(
    chain,
    {
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
    },
    () => '',
  )

  if (outcome.source === 'fixture') {
    return {
      applied: 0,
      source: 'fixture',
      model: 'ethara-template-writer',
      fallbackReason:
        outcome.fallbackReason ?? 'the text model failed to phrase the ideas',
      rejections,
    }
  }

  const raw = outcome.value

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
    model: applied > 0 ? textModelIdFor(outcome.servedBy) : 'ethara-template-writer',
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
  const onePerTopic = ctx.bool('onePerTopic', true)
  const topicKey = (t: string): string => t.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '').replace(/s$/, '')

  // Strongest first, so "one per trend" keeps the best idea of each trend.
  for (const idea of [...ideas].sort((a, b) => b.trendScore + b.brandRelevance - (a.trendScore + a.brandRelevance))) {
    if (onePerTopic) {
      const sameTopic = kept.find((other) => topicKey(other.sourceTopic) === topicKey(idea.sourceTopic))
      if (sameTopic) {
        dropped.push(`“${idea.title}” is a second idea on “${idea.sourceTopic}”`)
        continue
      }
    }
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

  /*
   * WHERE IT IS TRENDING DECIDES WHERE IT GOES.
   *
   * Each platform's calendar is built from that platform's own trends: a topic
   * the Claude Bridge found trending on X is planned for X, one from LinkedIn
   * for LinkedIn — when that platform is in play. The format-fit matrix still
   * scores every platform, supplies the alternates, and decides for a topic
   * whose source platform is unknown or not in play.
   */
  const preferTrendPlatform = ctx.bool('preferTrendPlatform', true)
  const sourcePlatform = new Map(
    (payload.posts ?? []).filter((p) => p.platform).map((p) => [p.externalId, p.platform as Platform]),
  )

  for (const idea of ideas) {
    const fit = FORMAT_PLATFORM_FIT[idea.format as EditorialFormat] ?? FORMAT_PLATFORM_FIT['Thought Leadership']

    const scored = inPlay
      .map((platform) => ({
        platform,
        // A tie breaks toward the declared platform rather than toward
        // whichever key the object happened to list first.
        score: fit[platform] + (platform === tieBreak ? 1 : 0),
      }))
      .sort((a, b) => b.score - a.score)

    const trendedOn = preferTrendPlatform && idea.sourceExternalId ? sourcePlatform.get(idea.sourceExternalId) : undefined
    const fromTrend = trendedOn && inPlay.includes(trendedOn) ? scored.find((s) => s.platform === trendedOn) : undefined
    const winner = fromTrend ?? (scored[0] as { platform: Platform; score: number })
    if (fromTrend) {
      idea.slotReasons = [
        ...idea.slotReasons,
        `Planned for ${PLATFORM_LABEL[fromTrend.platform]} because that is where the topic was found trending (format fit ${fromTrend.score}%).`,
      ]
    }
    idea.platform = winner.platform
    idea.altPlatforms = scored
      .filter((s) => s.platform !== winner.platform)
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

  return { ideas, platformsInPlay: inPlay }
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

  /*
   * HOW FAR AHEAD THE CALENDAR REACHES.
   *
   * This was `index % 7` — a hardcoded week, which is a tunable the operator
   * could not see (rule 2) and the reason the calendar could only ever be
   * weekly. With `avoidWeekends` on, a 7-day horizon offers just five postable
   * days, so every idea beyond the fifth was pushed into the same handful of
   * slots and the cadence limits then had to fight over them.
   */
  const horizonDays = Math.max(1, ctx.num('planningHorizonDays', 14))
  // The postable days of the window, ending at the week boundary the horizon
  // reaches — so a fortnight is this week and next, never a third.
  const days = planningDays(horizonDays, avoidWeekends)

  // Deterministic spreading: ideas walk the window's postable days in order, so
  // two runs of the same corpus place the same ideas on the same days.
  const taken = new Map<string, number[]>()

  ideas.forEach((idea, index) => {
    const rand = seededFor(idea.title, 4127)
    const date = days[index % days.length] as string

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
  // Declared on this skill too, because a skill is pure with respect to its own
  // config — reading the placement skill's knob would couple the two.
  const avoidWeekends = ctx.bool('avoidWeekends', true)
  // Declared here for the same reason: the balancer must stay inside the window
  // the placement planned, and it cannot see the placement skill's config.
  const horizonDays = Math.max(1, ctx.num('planningHorizonDays', 14))

  const ideas = payload.ideas ?? []
  if (ideas.length === 0) return {}

  // The same base the placement used, so the weekly count below measures the
  // window that was actually planned rather than one starting before it.
  const weekStart = planningStart()
  /*
   * THE DAYS A DISPLACED POST MAY MOVE TO.
   *
   * This walked forward a day at a time for up to fourteen hops, so a post
   * displaced from a full second Friday landed in a third week the calendar
   * was never meant to plan. It now wraps around the window's own postable
   * days — weekends already excluded — and never leaves them.
   */
  const days = planningDays(horizonDays, avoidWeekends)
  const perDay = new Map<string, number>()
  const perDayPlatform = new Map<string, number>()
  let moved = 0

  for (const idea of ideas.sort((a, b) => b.confidence - a.confidence)) {
    const placed = idea.scheduledDate
    const placedReasons = idea.slotReasons
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

      // Every postable day in the window is full: keep the placed date rather
      // than escape the window. Rank selection then decides which ideas keep a
      // date on the calendar and which are not placed.
      if (guard >= days.length) {
        idea.scheduledDate = placed
        idea.slotReasons = [
          ...placedReasons,
          'Every postable day in the planning window is already at its ceiling, so this keeps its placed day rather than moving past the window.',
        ]
        moved -= guard
        break
      }
      const index = days.indexOf(idea.scheduledDate)
      const next = days[(index + 1) % days.length] as string
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
  const horizonDays = Math.max(1, ctx.num('planningHorizonDays', 14))

  const ideas = payload.ideas ?? []
  const variants: PlannedIdea[] = []
  let outsideWindow = 0

  /*
   * EVERY PLATFORM, EVERY TOPIC.
   *
   * With `everyPlatform` on, each planned topic is planned for every platform
   * in play on the same day — LinkedIn, X, Facebook and Instagram — so the
   * week has a recommendation for each channel, not only the one the format
   * fits best. Facebook and Instagram share ONE post (`shareMetaPost`): the
   * two entries point at each other, and whichever is written second reuses
   * the first one's caption; each still gets its own image size. The
   * per-platform cap (`calendar.rank.select`) then keeps each platform's week
   * to its target.
   */
  if (ctx.bool('everyPlatform', true)) {
    const inPlay = payload.platformsInPlay ?? [...PLATFORMS]
    const shareMeta = ctx.bool('shareMetaPost', true) && inPlay.includes('facebook') && inPlay.includes('instagram')
    const POSTING_HOUR: Record<Platform, number> = { linkedin: 9, x: 12, facebook: 16, instagram: 18 }
    const metaTwin = (p: Platform): Platform | undefined => (shareMeta ? (p === 'facebook' ? 'instagram' : p === 'instagram' ? 'facebook' : undefined) : undefined)
    for (const idea of ideas) {
      if (idea.variantOf) continue
      const own = metaTwin(idea.platform)
      if (own) idea.sharesPostWith = own
      for (const platform of inPlay.filter((p) => p !== idea.platform)) {
        const fit = idea.altPlatforms.find((a) => a.platform === platform)?.score ?? null
        const twin = metaTwin(platform)
        variants.push({
          ...idea,
          key: `${idea.key}-alt-${platform}`,
          platform,
          altPlatforms: [],
          scheduledTime: nearestPostingTime(POSTING_HOUR[platform]),
          confidence: fit === null ? idea.confidence : clamp(Math.round((fit + idea.brandRelevance) / 2), 0, 100),
          calendarSlot: 'primary',
          platformRank: null,
          variantOf: idea.key,
          ...(twin ? { sharesPostWith: twin } : {}),
          slotReasons: [
            `The same topic as the ${PLATFORM_LABEL[idea.platform]} post, planned for ${PLATFORM_LABEL[platform]} on the same day so every platform has a post.`,
            ...(twin ? [`Shares one post with its ${PLATFORM_LABEL[twin]} twin — the caption is written once and reused.`] : []),
          ],
          conflicts: [],
        })
      }
    }
    const tally = new Map<Platform, number>()
    for (const i of [...ideas, ...variants]) tally.set(i.platform, (tally.get(i.platform) ?? 0) + 1)
    ctx.log(
      `Every platform: ${variants.length} variant(s) added · ` +
        [...tally.entries()].map(([p, n]) => `${n} × ${PLATFORM_LABEL[p]}`).join(', ') +
        (shareMeta ? ' · Facebook and Instagram share one post' : ''),
    )
    return { ideas: [...ideas, ...variants] }
  }

  // Only the strongest ideas earn a second channel; adapting everything would
  // fill the calendar with echoes.
  const eligible = [...ideas]
    .filter((i) => i.altPlatforms.length > 0)
    .sort((a, b) => b.confidence - a.confidence)
    .slice(0, Math.max(0, maxVariants))

  for (const idea of eligible) {
    const alt = idea.altPlatforms[0]
    if (!alt) continue

    /*
     * Staggered later when that stays inside the planning window, earlier when
     * it does not — a variant of an idea on the window's last Friday would
     * otherwise open a third week. Neither fits: no variant, rather than a date
     * outside the window.
     */
    const base = new Date(`${idea.scheduledDate}T12:00:00Z`)
    const later = isoDate(addDays(base, staggerDays))
    const earlier = isoDate(addDays(base, -staggerDays))
    const date = inPlanningWindow(later, horizonDays)
      ? later
      : inPlanningWindow(earlier, horizonDays)
        ? earlier
        : null
    if (date === null) {
      outsideWindow += 1
      continue
    }
    const direction = date === later ? 'later' : 'earlier'
    variants.push({
      ...idea,
      key: `${idea.key}-alt-${alt.platform}`,
      platform: alt.platform,
      altPlatforms: [],
      scheduledDate: date,
      scheduledTime: nearestPostingTime(alt.platform === 'x' ? 9 : 16),
      confidence: clamp(Math.round((alt.score + idea.brandRelevance) / 2), 0, 100),
      calendarSlot: 'primary',
      platformRank: null,
      variantOf: idea.key,
      slotReasons: [
        `Adapted from the ${PLATFORM_LABEL[idea.platform]} post, staggered ${staggerDays} day${staggerDays === 1 ? '' : 's'} ${direction} so the two do not compete.`,
        `${PLATFORM_LABEL[alt.platform]} scored ${alt.score}% on this format, which cleared the alternate threshold.`,
      ],
      conflicts: [],
    })
  }

  const skipped = outsideWindow > 0 ? ` · ${outsideWindow} skipped, no staggered day inside the planning window` : ''
  ctx.log(
    (variants.length === 0
      ? 'No cross-platform variants — no idea had an alternate above the threshold'
      : `${variants.length} cross-platform variant(s) added, staggered ${staggerDays} day(s)`) + skipped,
  )

  return { ideas: [...ideas, ...variants] }
})

/* ═══════════════════════════════════════════════════════════════════════════
   8 · calendar.rank.select — THE PER-PLATFORM CAP
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('calendar.rank.select', async (payload, ctx) => {
  // The registry declares 5. A different fallback here meant a run without the
  // knob resolved silently placed twice as many.
  const topPerPlatform = ctx.num('topPerPlatform', 5)
  // How many weeks the cap above applies to. Declared in the registry as 2, so a
  // run fills this week and the next rather than thinning one week's worth of
  // posts across a fortnight.
  const planningWeeks = ctx.num('planningWeeks', 2)
  const confidenceWeight = ctx.num('rankConfidenceWeight', 45) / 100
  const relevanceWeight = ctx.num('rankRelevanceWeight', 35) / 100
  const trendWeight = ctx.num('rankTrendWeight', 20) / 100
  const balance = ctx.bool('balanceAcrossPlatforms', true)

  const ideas = payload.ideas ?? []

  /*
   * NOTE THE ABSENCE OF AN EARLY RETURN HERE.
   *
   * This used to be `if (ideas.length === 0) return {}`, which meant the cap
   * repair below never ran on the one occasion it matters most: a run that
   * captured nothing produces no ideas, so a calendar left over cap by an
   * earlier run stayed over cap for as long as the crawler kept coming back
   * empty. The cap belongs to the calendar, so it is checked whenever this
   * skill runs, whether or not this run brought anything with it.
   */
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
   * THE CALENDAR HOLDS THE STRONGEST IDEAS — NOT THE EARLIEST-ARRIVING ONES.
   *
   * This used to count existing primaries and fill only the headroom left over.
   * That kept the cap honest and made the calendar useless: once five slots were
   * taken, every later run — however much better its material — could only queue.
   * With real engagement data arriving from Apify the effect became stark. A run
   * produced sixteen ideas scoring up to 85, the calendar held five scoring 59–71
   * from an earlier volume-only run, and `primaryIdeas: 0` was the honest report
   * of a calendar that could no longer improve.
   *
   * So the cap is applied to the WHOLE calendar, per platform, every time:
   * everything already stored and everything this run produced are ranked
   * together, and the top `topPerPlatform` take the slots.
   *
   * THREE RULES BOUND IT.
   *
   *   Nothing a human has touched is moved. From `in_review` onward a person has
   *   acted on the idea, so it keeps its slot and consumes a slot.
   *
   *   Nothing already WRITTEN is moved either. `drafted` used to be demotable,
   *   so a post whose caption and creative were done could be pushed off the
   *   calendar by a higher-scoring newcomer from a later run — this week's
   *   finished posts were the ones at risk. Only `suggested` topics, which hold
   *   no caption yet, are placed, withdrawn or re-dated by an agent. A written
   *   post keeps its slot and date and counts against the cap.
   *
   *   Nothing is deleted, and nothing is kept aside either. There is no
   *   suggestion list: an idea from this run that ranks below the cut-off is
   *   not placed (and so not stored), and a stored topic with no post that a
   *   stronger one displaces is withdrawn with its rank and the cut-off as the
   *   reason. Its lineage survives on the row.
   */
  const reconcile = ctx.bool('reconcileOverCap', true)
  const MOVABLE: readonly IdeaStatus[] = ['suggested']

  const onCalendar = await listIdeas(ctx.workspaceId, { limit: 600 })
  // Title plus platform is how a stored idea is recognised — `persistIdeas`
  // upserts on it, so it is the same identity the write path uses.
  const own = new Set(ideas.map((i) => `${i.title.toLowerCase()}|${i.platform}`))

  /** One candidate for a date, from either source, with a common score. */
  interface Candidate {
    key: string
    score: number
    platform: Platform
    /** Set for a stored row; absent for an idea this run produced. */
    row?: StoredIdea
    /** Set for an idea this run produced. */
    idea?: PlannedIdea
    /** Already dated on the calendar (a stored topic or post). */
    placed: boolean
    /** Only a topic with no post yet may be re-dated or withdrawn by an agent. */
    movable: boolean
  }

  const candidates: Candidate[] = []

  for (const row of onCalendar) {
    if (row.status === 'rejected') continue
    // Whatever this run re-scored is represented by the run's own object, which
    // carries the fresher score. Counting the stored copy too would let one idea
    // occupy two slots.
    if (own.has(`${row.title.toLowerCase()}|${row.platform}`)) continue
    const movable = MOVABLE.includes(row.status)
    candidates.push({
      key: `row:${row.id}`,
      score: Number(row.priority_score ?? 0),
      platform: row.platform,
      row,
      // A written or reviewed post is on the calendar whatever slot an older
      // release stored for it.
      placed: row.calendar_slot === 'primary' || !movable,
      movable,
    })
  }

  for (const idea of ideas) {
    candidates.push({
      key: `idea:${idea.key}`,
      score: idea.priorityScore,
      platform: idea.platform,
      idea,
      placed: false,
      movable: true,
    })
  }

  const placedKeys = new Set<string>()
  /** Dates already carrying a topic for a platform, so a new placement lands free. */
  const bookedByPlatform = new Map<Platform, Set<string>>()
  for (const c of candidates) {
    if (!c.placed || !c.row) continue
    const date = String(c.row.scheduled_date ?? '').slice(0, 10)
    if (date === '') continue
    const set = bookedByPlatform.get(c.platform) ?? new Set<string>()
    set.add(date)
    bookedByPlatform.set(c.platform, set)
  }

  /**
   * The first weekday from today that this platform has no topic on.
   *
   * A placed idea keeps whatever date the cadence balancer gave it, and that
   * balancer pushes one post per platform per day — so the sixteenth LinkedIn
   * idea is dated sixteen days out. Placing it without re-dating it puts a
   * topic outside the weeks the calendar renders.
   */
  function nextFreeDate(platform: Platform): string {
    const booked = bookedByPlatform.get(platform) ?? new Set<string>()
    // Only the window's own weekdays. This searched `planningWeeks * 7 + 7`
    // days as "slack for weekends", but the weekends already sit inside the
    // weeks being planned — the slack was a whole third week.
    const days = planningDays(planningWeeks * 7, true)
    for (const date of days) {
      if (booked.has(date)) continue
      booked.add(date)
      bookedByPlatform.set(platform, booked)
      return date
    }
    return days[0] as string
  }

  let notPlacedTotal = 0

  for (const platform of PLATFORMS) {
    // A topic planned natively for this platform (where it trended) before another platform's topic adapted to it.
    const native = (c: Candidate): number => (c.idea && !c.idea.variantOf ? 1 : 0)
    const forPlatform = candidates
      .filter((c) => c.platform === platform)
      .sort((a, b) => native(b) - native(a) || b.score - a.score || a.key.localeCompare(b.key))

    if (forPlatform.length === 0) continue

    /*
     * THE CAP IS PER PLATFORM PER WEEK, NOT PER PLANNING HORIZON.
     *
     * It used to be `topPerPlatform` across the whole horizon. With a fortnight
     * of planning that meant five LinkedIn slots spread over fourteen days —
     * about two a week — so a freshly scraped week rendered almost empty. The
     * cap was being read as "five on the calendar" when the operator-facing
     * label says "slots per platform on the week".
     *
     * So the effective allowance is the weekly cap multiplied by the number of
     * weeks being planned. `nextFreeDate` then spreads the winners one per
     * platform per weekday, which distributes them across those weeks instead of
     * stacking them into the first few days.
     */
    const weeklyCap = topPerPlatform * Math.max(1, planningWeeks)

    // Dates a post or a person already owns. Counted first and never touched.
    const locked = forPlatform.filter((c) => c.placed && !c.movable)
    const headroom = Math.max(0, weeklyCap - locked.length)

    const contestable = forPlatform.filter((c) => !(c.placed && !c.movable))
    // Off, topics already on the calendar keep their dates even over the cap,
    // and only the headroom they leave is contested.
    const kept = reconcile ? [] : contestable.filter((c) => c.placed)
    const open = contestable.filter((c) => !kept.includes(c))
    const winners = [...kept, ...open.slice(0, Math.max(0, headroom - kept.length))]
    const winnerKeys = new Set(winners.map((c) => c.key))
    const cutOff = winners[winners.length - 1]?.score ?? null

    let placedNew = 0
    let notPlaced = 0
    let withdrawn = 0
    let rank = locked.length

    for (const c of contestable) {
      const onCalendarNow = winnerKeys.has(c.key)
      rank += 1

      if (c.idea) {
        c.idea.platformRank = rank
        if (!onCalendarNow) {
          notPlaced += 1
          continue
        }
        c.idea.calendarSlot = 'primary'
        placedKeys.add(c.idea.key)
        placedNew += 1
        const current = String(c.idea.scheduledDate ?? '').slice(0, 10)
        const booked = bookedByPlatform.get(platform) ?? new Set<string>()
        const withinWindow = current !== '' && inPlanningWindow(current, planningWeeks * 7)
        if (!withinWindow || booked.has(current)) {
          c.idea.scheduledDate = nextFreeDate(platform)
          c.idea.slotReasons = [
            ...c.idea.slotReasons,
            `Moved to ${weekdayName(c.idea.scheduledDate)} when it was placed — its balanced date sat outside the planning window or already held a ${PLATFORM_LABEL[platform]} topic.`,
          ]
        } else {
          booked.add(current)
          bookedByPlatform.set(platform, booked)
        }
        continue
      }

      const row = c.row
      if (!row) continue
      if (!onCalendarNow) {
        // A topic with no post, displaced by stronger ones. Withdrawn with the
        // evidence, never deleted and never parked in a side list.
        await withdrawIdea(
          ctx.workspaceId,
          row.id,
          `Ranked #${rank} on ${PLATFORM_LABEL[platform]} with a priority of ${Number(row.priority_score ?? 0)}; ` +
            `the calendar holds ${weeklyCap} (${topPerPlatform}/week × ${planningWeeks})` +
            (cutOff !== null ? ` and its cut-off was ${cutOff}` : '') +
            '. It had no post yet.',
        )
        withdrawn += 1
      } else if (!c.placed) {
        await updateIdea(ctx.workspaceId, row.id, {
          calendarSlot: 'primary',
          platformRank: rank,
          scheduledDate: nextFreeDate(platform),
        })
        placedNew += 1
      } else if (!inPlanningWindow(String(row.scheduled_date ?? ''), planningWeeks * 7)) {
        // A topic an earlier run dated past the window — or one the window has
        // since moved away from — is brought back inside it. Only a topic with
        // no post: a written post or a human's placement is never moved.
        await updateIdea(ctx.workspaceId, row.id, {
          platformRank: rank,
          scheduledDate: nextFreeDate(platform),
        })
      } else if (row.platform_rank !== rank) {
        await updateIdea(ctx.workspaceId, row.id, { platformRank: rank })
      }
    }

    notPlacedTotal += notPlaced
    const held = locked.length
    ctx.emit(
      'idea.ranked',
      `${PLATFORM_LABEL[platform]}: ${Math.min(weeklyCap, held + winners.length)} on the calendar of ${weeklyCap} (${topPerPlatform}/week × ${planningWeeks})` +
        (placedNew > 0 ? ` · ${placedNew} new topic(s) placed` : '') +
        (notPlaced > 0 ? ` · ${notPlaced} ranked below the cut-off, not placed` : '') +
        (withdrawn > 0 ? ` · ${withdrawn} withdrawn for stronger topics` : '') +
        (held > 0 ? ` · ${held} kept in place — already written or in review` : ''),
      { platform, placed: placedNew, notPlaced, withdrawn, locked: held, cap: weeklyCap, perWeek: topPerPlatform, weeks: planningWeeks },
    )

    if (withdrawn > 0 || placedNew > 0 || notPlaced > 0) {
      ctx.log(
        `${PLATFORM_LABEL[platform]} ranked ${forPlatform.length} candidate(s): ` +
          `${placedNew} placed, ${notPlaced} not placed, ${withdrawn} withdrawn, ${held} kept in place (written or in review). ` +
          `Cut-off score ${cutOff ?? '—'}.`,
      )
    }
  }

  /*
   * FRESHEST TRENDS ONTO THE POST-READY DATES.
   *
   * Today's post, and tomorrow's when the schedule requires it, are the only
   * ones written now, so they should come from what is trending NOW. Per
   * platform, this run's placed topics keep the same set of dates and times —
   * the cadence the balancer chose — but the freshest source posts take the
   * earliest of them: a topic from a post published today lands on today or
   * tomorrow, and last week's topics fill the later dates in the Topic Queue.
   * Only this run's topics move; a stored post or a person's placement never does.
   */
  if (ctx.bool('freshestFirst', true)) {
    const horizon = await resolveCalendarHorizon(ctx.workspaceId)
    const postedAt = new Map((payload.posts ?? []).map((p) => [p.externalId, p.postedAt ?? '']))
    const sourceDate = (idea: PlannedIdea): string => (idea.sourceExternalId ? (postedAt.get(idea.sourceExternalId) ?? '') : '')
    let reordered = 0
    for (const platform of PLATFORMS) {
      const mine = ideas.filter((i) => placedKeys.has(i.key) && i.platform === platform)
      if (mine.length < 2) continue
      const slots = mine
        .map((i) => ({ date: String(i.scheduledDate).slice(0, 10), time: i.scheduledTime }))
        .sort((a, b) => a.date.localeCompare(b.date) || labelToMinutes(a.time) - labelToMinutes(b.time))
      const byFreshness = [...mine].sort(
        (a, b) => sourceDate(b).localeCompare(sourceDate(a)) || b.priorityScore - a.priorityScore,
      )
      byFreshness.forEach((idea, index) => {
        const slot = slots[index]
        if (!slot || (slot.date === String(idea.scheduledDate).slice(0, 10) && slot.time === idea.scheduledTime)) return
        idea.scheduledDate = slot.date
        idea.scheduledTime = slot.time
        const published = sourceDate(idea).slice(0, 10)
        if (horizon.postReadyDates.includes(slot.date)) {
          idea.slotReasons = [
            ...idea.slotReasons,
            `Placed on ${weekdayName(slot.date)}, a post-ready day, because its source post${published ? ` (${published})` : ''} is among the freshest this run found — today's trends are written first.`,
          ]
        }
        reordered += 1
      })
    }
    if (reordered > 0) {
      ctx.log(`${reordered} topic(s) re-dated so the freshest trends take today and tomorrow (${horizon.postReadyDates.join(', ')})`)
    }
  }

  /*
   * THE BEST TOPIC IS TODAY'S POST. Each platform's top-ranked topic from this
   * run takes today's date when today is a posting day in the window and the
   * platform has nothing on it yet — so the one post per platform is written
   * now, not left for a later day.
   */
  if (ctx.bool('leadOnToday', true)) {
    const horizon = await resolveCalendarHorizon(ctx.workspaceId)
    const today = horizon.today
    if (horizon.postReadyDates.includes(today)) {
      for (const platform of PLATFORMS) {
        const mine = ideas.filter((i) => placedKeys.has(i.key) && i.platform === platform).sort((a, b) => (a.platformRank ?? 1e9) - (b.platformRank ?? 1e9))
        const top = mine[0]
        if (!top || String(top.scheduledDate).slice(0, 10) === today) continue
        const bookedToday = bookedByPlatform.get(platform)?.has(today) && !mine.some((i) => String(i.scheduledDate).slice(0, 10) === today)
        if (bookedToday) continue
        const other = mine.find((i) => String(i.scheduledDate).slice(0, 10) === today)
        if (other) other.scheduledDate = top.scheduledDate
        top.scheduledDate = today
        top.slotReasons = [...top.slotReasons, `Today’s post on ${PLATFORM_LABEL[platform]}: the strongest topic this run found for it.`]
      }
    }
  }

  /*
   * FACEBOOK AND INSTAGRAM TWINS ON THE SAME DAY.
   *
   * A topic's Facebook and Instagram entries share one post, so they belong on
   * the same date. The balancer and the freshness pass date each platform on
   * its own; here the Instagram twin moves to its Facebook twin's date when
   * Instagram is free that day, else Facebook moves to Instagram's, else the
   * two swap with another of this run's Instagram topics. When none of that
   * is possible (a written post holds the day) the pair is unlinked and each
   * is written on its own — stated in the log, never hidden.
   */
  {
    const placed = ideas.filter((i) => placedKeys.has(i.key))
    const groupOf = (i: PlannedIdea): string => i.variantOf ?? i.key
    const day = (i: PlannedIdea): string => String(i.scheduledDate ?? '').slice(0, 10)
    const booked = (p: Platform): Set<string> => {
      const set = bookedByPlatform.get(p) ?? new Set<string>()
      bookedByPlatform.set(p, set)
      return set
    }
    const move = (i: PlannedIdea, to: string): void => {
      booked(i.platform).delete(day(i))
      booked(i.platform).add(to)
      i.scheduledDate = to
    }
    let aligned = 0
    let unlinked = 0
    for (const ig of placed.filter((i) => i.platform === 'instagram' && i.sharesPostWith === 'facebook')) {
      const fb = placed.find((i) => i.platform === 'facebook' && groupOf(i) === groupOf(ig))
      if (!fb) {
        delete ig.sharesPostWith
        unlinked += 1
        continue
      }
      if (day(fb) === day(ig)) continue
      const target = day(fb)
      const occupant = placed.find((i) => i !== ig && i.platform === 'instagram' && day(i) === target)
      if (!booked('instagram').has(target)) move(ig, target)
      else if (!booked('facebook').has(day(ig))) move(fb, day(ig))
      else if (occupant) {
        const from = day(ig)
        occupant.scheduledDate = from
        ig.scheduledDate = target
      } else {
        delete ig.sharesPostWith
        delete fb.sharesPostWith
        unlinked += 1
        continue
      }
      ig.slotReasons = [...ig.slotReasons, `On ${weekdayName(day(ig))} with its Facebook twin — the two share one post.`]
      aligned += 1
    }
    for (const fb of placed.filter((i) => i.platform === 'facebook' && i.sharesPostWith === 'instagram')) {
      if (!placed.some((i) => i.platform === 'instagram' && i.sharesPostWith === 'facebook' && groupOf(i) === groupOf(fb))) delete fb.sharesPostWith
    }
    if (aligned > 0 || unlinked > 0) {
      ctx.log(`Facebook/Instagram twins: ${aligned} moved onto the same day` + (unlinked > 0 ? ` · ${unlinked} could not share a day and are written separately` : ''))
    }
  }

  // Only what the calendar placed goes on to be stored. There is no second
  // list for the rest; their count and the cut-off are in the log above.
  const placedIdeas = ideas.filter((i) => placedKeys.has(i.key))

  ctx.log(
    PLATFORMS.map(
      (p) => `${PLATFORM_LABEL[p]} ${placedIdeas.filter((i) => i.platform === p).length} placed`,
    ).join(' · ') +
      (notPlacedTotal > 0 ? ` · ${notPlacedTotal} not placed` : '') +
      (balance ? '' : ' · cross-platform balancing off'),
  )

  return { ideas: placedIdeas }
})

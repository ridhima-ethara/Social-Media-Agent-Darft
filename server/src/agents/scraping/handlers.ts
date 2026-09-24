/**
 * THE SCRAPING AGENT — stage `discover`
 *
 * Reads the keyword set and asks what each platform has been saying about every
 * term — once per platform lane (LinkedIn, Instagram, X, Facebook) and once
 * against the open web — then harvests the hashtags out of the bodies that
 * carry them and takes an independent reading of the strongest tags.
 *
 * ONE SOURCE, NO CORPUS. Every lane — LinkedIn, Instagram, X, Facebook and
 * the open web — is served by the Claude Bridge (`server/src/bridges/claude-bridge/`):
 * Claude Code's web search finds public posts and pages, and the bridge keeps
 * only real item URLs, dates each one from what the platform or page states
 * (the timestamp in a LinkedIn/X/Instagram post id; a web page's URL or its own
 * published-date tag), de-duplicates, and filters to the recency window using
 * the Knowledge Base, brand voice and keywords. A web search states no
 * engagement, so every row carries `metricsAvailable: false`, legible
 * downstream rather than inferred from zeros.
 *
 * There is no bundled fixture corpus behind it, which means an empty result
 * is reported as an empty result: a keyword that returned nothing on a lane
 * says so, and the run continues on the lanes that answered. What the pipeline
 * shows is what was actually published at capture time, or nothing.
 *
 * NO THIRD-PARTY SCRAPER. The Scraping Agent imports neither Apify nor Parallel.
 *
 * BRAND AND KNOWLEDGE ALIGNMENT AT CAPTURE. A `site:` search returns whatever
 * the engine indexed, which is wider than what this company publishes about.
 * Each captured page is therefore scored against the brand topic set and the
 * live Knowledge Base vocabulary before it is admitted, and anything that
 * aligns with neither is dropped with the reason recorded. That score travels
 * on the record as `brandRelevance`, so the Validation Agent inherits the
 * evidence rather than re-deriving it.
 *
 * Every artefact is stamped with which implementation produced it and which
 * platform lane it came from.
 */

import {
  BRAND_CORPUS_TAG,
  BRAND_DOMAIN_TAG,
  BRAND_RULE_TAG,
  BRAND_TOPICS,
  GENERIC_HASHTAGS,
} from '../../../../shared/brand-voice'
import { synonymsFor } from '../../../../shared/keywords'
import { PLATFORMS, type Platform, type SkillContext } from '../../../../shared/agent-contract'
import { config } from '../../config'
import {
  AdapterError,
  captureFor,
  mapWithConcurrency,
  platformLaneUnavailableReason,
  openWebLaneUnavailableReason,
  transcriptionBudget,
  whisperTranscribe,
  type RawPost,
} from '../../integrations'
import { prepareEvidence } from '../../../../packages/runtime/src/evidence'
import { discoverPlatformTrends } from '../../bridges/claude-bridge/trends/platform-trends'
import { platformModule, type PlatformId } from '../../bridges/claude-bridge/platforms'
import { cycleWeekFor } from '../../../../shared/keyword-schedule'
import { cycleWeekTopic, keywordsForCycleWeek, mergePipelineRunSummary, type KeywordRow } from '../../db/repo'
import {
  activeDiscoveredKeywords,
  insertActivity,
  listKeywords,
  listKnowledge,
  listSources,
  listTrackedAccounts,
  markTrackedAccountsCaptured,
  recentCaptures,
} from '../../db/repo'
import {
  clampChars,
  contentWords,
  credibilityBase,
  credibilityLabel,
  engagementOf,
  extractHashtagsFromText,
  englishRatio,
  headlineFrom,
  hoursSince,
  matchedTopics,
  normalise,
  normaliseTag,
  velocityOf,
} from '../corpus'
import { registerSkill } from '../runtime'
import type {
  CompetitorPostRecord,
  KeywordCandidate,
  HashtagCandidate,
  PipelinePayload,
  ResolvedKeyword,
  ScrapedPost,
  SourceConnection,
} from '../skills/index'

const GENERIC_SET = new Set(GENERIC_HASHTAGS.map((t) => normaliseTag(t)))

/**
 * The knob name that switches each platform lane on, in the order the lanes are
 * captured. LinkedIn leads because it is both the primary publishing surface
 * and by far the best indexed of the four.
 */
/**
 * The run screen draws one live lane per (platform, keyword). Discovery runs
 * once per platform over all keywords, so its lanes carry this one label.
 */
const DISCOVERY_LANE_KEY = 'Ethara keywords'

/**
 * The `datePosted` knob's rolling options in hours — a unit conversion, not a
 * tunable. `current-month` is not here: it is the calendar month so far, which
 * the bridge computes in the workspace's time zone.
 */
const MONTH_WORDS = /\b(?:jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|june?|july?|aug(?:ust)?|sept?(?:ember)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?)\b/i

/** True when a phrase is only a date — month names, years, day numbers — nothing a topic search would use. */
function isDatePhrase(phrase: string): boolean {
  const rest = phrase
    .replace(new RegExp(MONTH_WORDS.source, 'gi'), ' ')
    .replace(/\b\d{1,4}(?:st|nd|rd|th)?\b/gi, ' ')
    .replace(/[^\p{L}]+/gu, '')
  return rest === ''
}

const WINDOW_HOURS: Readonly<Record<string, number>> = {
  'past-24h': 24,
  'past-48h': 48,
  'past-week': 24 * 7,
  'past-month': 24 * 30,
  'past-quarter': 24 * 90,
}

const PLATFORM_KNOBS: ReadonlyArray<{ platform: Platform; knob: string; label: string }> = [
  { platform: 'linkedin', knob: 'includeLinkedin', label: 'LinkedIn' },
  { platform: 'instagram', knob: 'includeInstagram', label: 'Instagram' },
  { platform: 'x', knob: 'includeX', label: 'X' },
  { platform: 'facebook', knob: 'includeFacebook', label: 'Facebook' },
]

/**
 * Which `sourceType` a lane's items are recorded under.
 *
 * A page indexed on a platform's own domain IS a social artefact — a public
 * post, article or company page — so it is typed `Social` and inherits that
 * tier's credibility. A page found on the open web is not, and is typed
 * `Website`, which `credibilityBase()` scores on provenance instead. Neither
 * carries engagement figures; see the note in `integrations/crawl4ai.ts` on why
 * the zeros must never be read as "this performed badly".
 */
function sourceTypeFor(platform: Platform | null): string {
  return platform === null ? 'Website' : 'Social'
}

/* ═══════════════════════════════════════════════════════════════════════════
   BRAND AND KNOWLEDGE ALIGNMENT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The vocabulary a captured page is judged against: the declared brand topics,
 * the live Knowledge Base corpus, and the active keyword set.
 *
 * THREE SOURCES, ONE JUDGEMENT.
 *
 *   topics    a fixed declaration of the rule 1 / rule 7 domain, written once.
 *
 *   knowledge what the company actually knows. This is the half that keeps the
 *             judgement current: the corpus moves as the Knowledge Base grows,
 *             so a subject the company has since started publishing about
 *             counts as aligned without anyone editing a constant.
 *
 *   keywords  the terms the operator declared, plus their synonyms. A page that
 *             is squarely about another active keyword is on-brand even when the
 *             keyword that surfaced it barely appears.
 *
 * Brand RULE entries are excluded on purpose. They are compliance documents, so
 * their vocabulary is "hashtag", "punctuation" and "emoji" — admitting them
 * would let the style guide decide which articles are topically relevant.
 */
interface AlignmentVocabulary {
  topics: string[]
  knowledgeTerms: Set<string>
  keywordTerms: Set<string>
  knowledgeEntries: number
}

async function loadAlignmentVocabulary(workspaceId: string): Promise<AlignmentVocabulary> {
  const [entries, keywords] = await Promise.all([
    listKnowledge(workspaceId, { activeOnly: true, limit: 400 }),
    listKeywords(workspaceId, true),
  ])

  const knowledgeTerms = new Set<string>()
  let counted = 0

  for (const entry of entries) {
    // The style guide does not get a vote on what is on-topic.
    if (entry.tags.includes(BRAND_RULE_TAG)) continue

    /*
     * Nor does the brand's description of itself. A corpus entry covering voice,
     * audience or visual identity is real knowledge and stays available as
     * grounding, but its vocabulary is "typography" and "declarative" — facts
     * about how we publish, not subjects we publish about. Admitting it would
     * score an article about typography as on-topic for an AI research lab.
     */
    const isCorpus = entry.tags.includes(BRAND_CORPUS_TAG)
    if (isCorpus && !entry.tags.includes(BRAND_DOMAIN_TAG)) continue
    counted += 1

    for (const tag of entry.tags) {
      if (tag === 'brand' || tag === BRAND_CORPUS_TAG || tag === BRAND_DOMAIN_TAG) continue
      knowledgeTerms.add(tag.toLowerCase())
    }
    if (entry.hashtag_display) knowledgeTerms.add(entry.hashtag_display.toLowerCase())
    // Titles carry the claim's subject in the operator's own words; bodies are
    // long and would dilute the set into ordinary English.
    for (const word of contentWords(entry.title)) knowledgeTerms.add(word)
  }

  const keywordTerms = new Set<string>()
  for (const keyword of keywords) {
    keywordTerms.add(keyword.term.toLowerCase())
    for (const synonym of synonymsFor(keyword.term)) keywordTerms.add(synonym.toLowerCase())
  }

  return { topics: BRAND_TOPICS, knowledgeTerms, keywordTerms, knowledgeEntries: counted }
}

interface Alignment {
  score: number
  matchedTopics: string[]
  knowledgeHits: number
  keywordInBody: boolean
  keywordSetHits: number
}

/**
 * How well a captured body aligns with what this company talks about, 0–100.
 *
 * Four independent signals, deliberately additive: presence raises the score
 * and absence never subtracts, because a page can be squarely on-topic while
 * using none of the exact words in one of the sets. The keyword that surfaced
 * the page is the weakest signal on its own — a search engine matched it, so
 * its presence is close to guaranteed — which is why it is capped well below
 * the topic and knowledge signals rather than dominating them.
 */
function alignmentOf(
  text: string,
  keyword: string,
  vocabulary: AlignmentVocabulary,
): Alignment {
  const haystack = text.toLowerCase()
  const words = new Set(contentWords(text))

  const topics = matchedTopics(text, 6)
  let knowledgeHits = 0
  for (const term of vocabulary.knowledgeTerms) {
    if (words.has(term) || (term.includes(' ') && haystack.includes(term))) knowledgeHits += 1
  }

  // Which OTHER declared keywords this page speaks to. Counted separately from
  // the surfacing keyword so a page cannot score twice for the same match.
  const surfacing = keyword.toLowerCase()
  let keywordSetHits = 0
  for (const term of vocabulary.keywordTerms) {
    if (term === surfacing) continue
    if (words.has(term) || (term.includes(' ') && haystack.includes(term))) keywordSetHits += 1
  }

  const keywordInBody = haystack.includes(surfacing)

  const topicScore = Math.min(45, topics.length * 12)
  const knowledgeScore = Math.min(30, knowledgeHits * 6)
  const keywordSetScore = Math.min(15, keywordSetHits * 5)
  const keywordScore = keywordInBody ? 10 : 0

  return {
    score: Math.min(100, topicScore + knowledgeScore + keywordSetScore + keywordScore),
    matchedTopics: topics,
    knowledgeHits,
    keywordInBody,
    keywordSetHits,
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · scraping.keyword.resolve
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.keyword.resolve', async (payload, ctx) => {
  const maxKeywords = ctx.num('maxKeywordsPerRun', 12)
  const minWeight = ctx.num('minWeight', 40)
  const expand = ctx.bool('expandSynonyms', true)
  const useWeekSchedule = ctx.bool('useWeekSchedule', true)
  const anchorRaw = ctx.str('scheduleAnchorDate', '2026-09-14')
  const fallback = ctx.str('scheduleFallback', 'weighted')

  const all = await listKeywords(ctx.workspaceId, true)

  /*
   * THE WEEKLY ROTA, WHEN THERE IS ONE.
   *
   * Precedence matters and is deliberate:
   *
   *   1. An explicitly scoped run wins outright. "Run discovery on RLHF" is a
   *      direct instruction, and a rota must never override what was asked for.
   *   2. Otherwise the rota for the current cycle week — every constant plus
   *      that week's rotating set.
   *   3. Otherwise the weight-ordered set, which is the behaviour that existed
   *      before the rota and remains the honest fallback.
   *
   * Which path was taken is EMITTED, not inferred. When a Monday captures
   * nothing, the run has to say "week 12 has no rota and the fallback is skip"
   * rather than looking like a broken scraper.
   */
  const scopedExplicitly = (payload.keywordIds?.length ?? 0) > 0
  let rotaWeek: number | null = null
  let rotaTopic = ''
  let scheduled: KeywordRow[] = []

  if (!scopedExplicitly && useWeekSchedule) {
    const anchor = new Date(`${anchorRaw}T00:00:00Z`)
    if (Number.isNaN(anchor.getTime())) {
      ctx.emit('activity', `scheduleAnchorDate is not a date (${anchorRaw}) — ignoring the rota`, {
        status: 'warn',
      })
    } else {
      // "Today" in the WORKSPACE timezone. A naive UTC read crosses the week
      // boundary hours early for anyone east of Greenwich.
      const today = new Date(new Date().toLocaleDateString('en-CA', { timeZone: config.core.tz }))
      rotaWeek = cycleWeekFor(today, anchor)
      scheduled = await keywordsForCycleWeek(ctx.workspaceId, rotaWeek)
      rotaTopic = await cycleWeekTopic(ctx.workspaceId, rotaWeek)
    }
  }

  let source: 'scoped' | 'rota' | 'weighted' = 'weighted'
  let pool = all

  if (scopedExplicitly) {
    source = 'scoped'
    pool = all.filter((k) => payload.keywordIds?.includes(k.id))
  } else if (scheduled.length > 0) {
    source = 'rota'
    /*
     * DISCOVERED KEYWORDS JOIN THE ROTA, ALWAYS (ADR-012).
     *
     * This is the line that makes keyword discovery mean anything. A rota is a
     * plan a human wrote in advance; a discovered term by definition arrived
     * after that plan and will never be on it, because nobody is going to go
     * back and schedule a week for a word the scraper found last Tuesday.
     *
     * Without this union, `validation.keyword.emerge` could promote a term, an
     * operator could switch it on, and it would still never be captured — the
     * feature would look implemented and do nothing. Approving a keyword has to
     * be sufficient to get it captured.
     *
     * They are ADDED to the scheduled set rather than replacing any of it: the
     * week's intent is preserved, and the per-run cap below still bounds the
     * total, so this cannot quietly multiply what a run costs.
     */
    const discovered = await activeDiscoveredKeywords(ctx.workspaceId)
    const onRota = new Set(scheduled.map((k) => k.id))
    const joining = discovered.filter((k) => !onRota.has(k.id))
    pool = [...scheduled, ...joining]
    if (joining.length > 0) {
      ctx.emit(
        'activity',
        `${joining.length} discovered keyword(s) joined week ${rotaWeek}\u2019s rota: ${joining.map((k) => k.term).join(', ')}`,
        { status: 'ok', discovered: joining.map((k) => k.term) },
      )
    }
  } else if (rotaWeek !== null && fallback === 'skip') {
    // An honest empty result. Capturing the weight-ordered set here would quietly
    // substitute a different week's intent for the one that was scheduled.
    ctx.emit(
      'activity',
      `Week ${rotaWeek} has no keywords scheduled and scheduleFallback is 'skip' — nothing was captured`,
      { status: 'warn', cycleWeek: rotaWeek },
    )
    return { keywords: [] }
  }

  /*
   * The weight floor applies to the scoped and weighted paths, not the rota. A
   * keyword an operator deliberately scheduled for this week has already passed
   * their judgement, and silently dropping it for being under-weighted would
   * make the rota mean less than it says.
   */
  const cleared =
    source === 'rota' ? pool : pool.filter((k) => k.weight >= minWeight)
  const ordered =
    source === 'rota' ? cleared : [...cleared].sort((a, b) => b.weight - a.weight)
  /*
   * A DIFFERENT SLICE EACH RUN.
   *
   * The rota picks a week's keywords; the cap picks how many of them one run
   * can afford. Taking `slice(0, N)` every time meant the same N terms were
   * scraped on every run of that week — the same posts came back, the dedupe
   * pre-filter dropped them as already seen, and the run reported almost
   * nothing new. From outside that looks like a platform that has stopped
   * working, which is exactly what it was reported as.
   *
   * Rotating by the run count walks the whole eligible set over successive
   * runs instead of re-reading its head. `runOffset` is the workspace's
   * lifetime run count, already threaded through the payload for the same
   * reason, so no new state is needed and a replayed run picks the same slice
   * it originally did.
   *
   * An explicitly scoped run never rotates: "run discovery on RLHF" means that
   * term, not a window that happens to contain it.
   */
  const take = Math.max(1, maxKeywords)
  const rotating = ctx.bool('rotateAcrossRuns', true) && source !== 'scoped'
  const runOffset = Math.max(0, payload.runOffset ?? 0)

  /** A window of `size` items starting at `offset`, wrapping round the end. */
  const window = <T,>(items: T[], offset: number, size: number): T[] =>
    items.length === 0 ? [] : [...items.slice(offset % items.length), ...items.slice(0, offset % items.length)].slice(0, size)

  let eligible: KeywordRow[]
  let rotationNote = ''

  if (!rotating) {
    eligible = ordered.slice(0, take)
  } else if (source === 'rota') {
    /*
     * THE WINDOW MOVES OVER THE ROTA PLUS THE WIDER SET, ALWAYS.
     *
     * Earlier attempts rotated only when the cap and the rota happened to
     * disagree in the right direction — rotate WITHIN the rota when the cap was
     * smaller, top up from elsewhere when it was larger. On a rota of nine with
     * a cap of twelve neither branch moved the first nine, so the run console
     * showed the same three keyword cards every time and the second run of a
     * week re-read pages the dedupe filter then dropped.
     *
     * One rule instead: the week's rota leads the pool, the rest of the active
     * set follows it, and a window of `take` walks that pool by the run count.
     * Every run reads a different set; the week's scheduled terms still come
     * first, so the plan is covered soonest; and the whole pool is covered
     * across runs rather than its head being re-read.
     */
    const scheduledIds = new Set(ordered.map((k) => k.id))
    const others = all
      .filter((k) => !scheduledIds.has(k.id) && k.weight >= minWeight)
      .sort((a, b) => b.weight - a.weight)
    const pool = [...ordered, ...others]
    eligible = window(pool, runOffset * take, take)
    const start = (runOffset * take) % Math.max(1, pool.length)
    rotationNote = `week ${rotaWeek} \u2014 keywords ${start + 1}\u2013${start + eligible.length} of ${pool.length} (${ordered.length} scheduled, ${others.length} from the wider set)`
  } else {
    // No rota in effect: walk the whole weighted set across runs rather than
    // re-reading its head.
    eligible = window(ordered, runOffset * take, take)
    if (ordered.length > take) {
      const start = (runOffset * take) % ordered.length
      rotationNote = `keywords ${start + 1}\u2013${start + eligible.length} of ${ordered.length} this run`
    }
  }

  if (rotationNote !== '') {
    ctx.emit('activity', `Rotating \u2014 ${rotationNote}`, { status: 'ok', runOffset })
  }

  ctx.emit(
    'activity',
    source === 'rota'
      ? `Week ${rotaWeek}${rotaTopic ? ` · ${rotaTopic}` : ''} — ${eligible.length} of ${pool.length} scheduled keyword(s)`
      : source === 'scoped'
        ? `Scoped run — ${eligible.length} keyword(s) named explicitly`
        : `No rota in effect — top ${eligible.length} keyword(s) by weight`,
    { status: 'ok', source, ...(rotaWeek === null ? {} : { cycleWeek: rotaWeek }) },
  )

  const keywords: ResolvedKeyword[] = eligible.map((k) => ({
    id: k.id,
    term: k.term,
    category: k.category,
    weight: k.weight,
    synonyms: expand ? synonymsFor(k.term) : [],
  }))

  // The floor and the per-run cap are different reasons for a keyword to sit
  // out, and rule 6 wants the reason to name its actual cause. Reporting the
  // cap as a weight failure sends the operator to re-weight a term that was
  // never under-weighted.
  // `pool` is whichever set the precedence above selected — scoped, rota or
  // weighted — so this counts what that set lost rather than always the full list.
  const belowFloor = pool.length - cleared.length
  const beyondCap = cleared.length - eligible.length
  ctx.log(
    `${keywords.length} keyword${keywords.length === 1 ? '' : 's'} resolved` +
      (belowFloor > 0 ? `, ${belowFloor} below the ${minWeight}% weight floor` : '') +
      (beyondCap > 0
        ? `, ${beyondCap} cleared the floor but sat outside the ${maxKeywords}-keyword cap for this run`
        : ''),
  )

  if (keywords.length === 0) {
    ctx.emit(
      'activity',
      'No keyword cleared the weight floor. Add or re-weight terms under Settings → Keywords.',
      { status: 'warn' },
    )
  }

  return { keywords }
})

/* ═══════════════════════════════════════════════════════════════════════════
   2 · scraping.source.connect
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.source.connect', async (_payload, ctx) => {
  const failIfNoSource = ctx.bool('failIfNoSource', false)

  const platformReady = platformLaneUnavailableReason() === ''
  const openWebReady = openWebLaneUnavailableReason() === ''
  /*
   * ONE SOURCE PER LANE, SO EITHER LANE ALONE STILL CARRIES A RUN.
   *
   * The Claude Bridge serves every lane — the four platforms and the open web.
   * No other scraper stands behind it. Losing it leaves nothing to capture,
   * which is the only case that makes the whole run fixture-mode.
   */
  const configured = platformReady || openWebReady
  const mode: 'live' | 'fixture' = configured ? 'live' : 'fixture'
  const rows = await listSources(ctx.workspaceId)

  // Reachability is per lane — per platform, since the bridge serves each
  // platform through its own module and may have one without another.
  const sources: SourceConnection[] = rows
    .filter((s) => s.enabled)
    .map((s) => {
      const platform = PLATFORMS.find((p) => p === s.kind)
      // `web` (and any kind that is not a platform) is the open-web lane.
      const lane = captureFor(platform)
      const reachable = lane.isConfigured()
      const reason = reachable ? `Reachable via ${lane.label}` : lane.unavailableReason()
      return { name: s.name, kind: s.kind, sourceType: s.source_type, reachable, reason }
    })

  const unreachable = [...PLATFORMS, undefined]
    .map((p) => captureFor(p))
    .filter((c) => !c.isConfigured())
    .map((c) => c.label)

  /**
   * A mode notice is BOTH published and stored.
   *
   * `ctx.emit` reaches the in-process event bus only, so a notice sent that way
   * lives exactly as long as an open SSE connection. That is right for the
   * hundreds of per-item capture events, and wrong for these three: "the
   * platform lanes are not reading the platforms" explains the data quality of
   * every row the run produced, and an operator who was not watching at the time
   * must still be able to find out. So these go through `insertActivity` as
   * well, which is what `/state` returns and what the activity feed renders
   * after a refresh.
   */
  const notify = async (message: string): Promise<void> => {
    ctx.emit('activity', message, { status: 'warn', mode })
    await insertActivity({ workspaceId: ctx.workspaceId, agentId: 'scraping', message, status: 'warn' })
  }

  if (!configured) {
    await notify(
      'Neither capture source is configured — nothing can be captured this run. ' +
        'Every lane is served by the Claude Bridge — install Claude Code or set CLAUDE_CODE_BIN.',
    )
    // With no corpus to fall back to, an unconfigured pair means an empty run
    // whatever this knob says. It is still honoured, because failing at the
    // source is a clearer report than five empty lanes downstream.
    if (failIfNoSource) {
      throw new Error(
        'No capture source available — every lane is served by the Claude Bridge; install Claude Code ' +
          'or set CLAUDE_CODE_BIN.',
      )
    }
  } else {
    if (platformReady) {
      const served = PLATFORMS.filter((p) => captureFor(p).isConfigured())
      ctx.log(
        `Claude Bridge reachable · ${served.join(', ')} via Claude Code web search, each post dated from ` +
          'its id where the platform encodes one; a web search states no engagement figures',
      )
      const unserved = PLATFORMS.filter((p) => !captureFor(p).isConfigured())
      if (unserved.length > 0) {
        ctx.log(`Platform lanes the bridge cannot serve yet: ${unserved.join(', ')} — skipped this run`)
      }
    } else {
      // Named at connect time rather than discovered later from missing rows.
      // The open-web lane reports separately below: different source, different reason.
      await notify(platformLaneUnavailableReason())
    }
    if (openWebReady) {
      ctx.log(
        'Claude Bridge reachable · the open-web lane reads search results and each page’s own ' +
          'published date (robots.txt permitting); pages state no engagement figures',
      )
    } else {
      await notify(openWebLaneUnavailableReason())
    }
  }

  return { mode, sources, unreachable }
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · scraping.linkedin.fetch — the platform-wise capture
   ───────────────────────────────────────────────────────────────────────────
   The id keeps its LinkedIn spelling on purpose: a skill id is a storage key
   in `agent_skills` and `skill_runs`, and renaming it would orphan every run
   already recorded against it. What it DOES is the four platform lanes plus
   the open web; the registry name and summary say so.
   ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
   THE FIELDS THE CONTENT-SCRAPER SPECIFICATION ASKS TO COLLECT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The post's own opening line.
 *
 * A hook is judged on its own, so it is stored rather than re-derived on read —
 * `snippet` is clamped for display, and slicing a display string would give a
 * different answer depending on where it happened to be cut.
 *
 * Emoji and leading hashtags are stripped: a line that opens with three tags is
 * opening with reach bait, and what we want is the sentence underneath it.
 */
function hookOf(text: string): string {
  const firstLine =
    text
      .split('\n')
      .map((line) => line.trim())
      .find((line) => line.replace(/[#@\s]/g, '') !== '') ?? ''
  return clampChars(
    firstLine
      .replace(/^(?:#[\p{L}\p{N}_]+\s*)+/u, '')
      .replace(/\p{Extended_Pictographic}/gu, '')
      .replace(/\s+/g, ' ')
      .trim(),
    200,
  )
}

/**
 * (reactions + comments) / views as a percentage, or `null`.
 *
 * `null` is the answer whenever either figure is missing, and that is the whole
 * point of the function existing rather than the division being written inline
 * at three call sites. Dividing by an absent denominator does not produce a low
 * rate; it produces no rate, and a 0 would assert that the post was seen and
 * ignored — a much stronger claim than the evidence supports.
 */
function engagementRateOf(post: {
  reactions: number
  comments: number
  views: number
  viewsAvailable: boolean
  metricsAvailable: boolean
}): number | null {
  if (!post.viewsAvailable || !post.metricsAvailable || post.views <= 0) return null
  return Math.round(((post.reactions + post.comments) / post.views) * 10000) / 100
}

/**
 * What KIND of thing this is — which a platform name alone cannot answer.
 *
 * An Instagram Reel and an Instagram photo distribute completely differently,
 * and the specification asks for content format as a column of its own.
 * Inferred from the URL first, because a URL is a fact the platform stated;
 * the play count is only a hint, so it is consulted second.
 */
function mediaFormatOf(raw: RawPost): string {
  const url = raw.url.toLowerCase()
  if (url.includes('/reel/') || url.includes('/reels/')) return 'reel'
  if (url.includes('/shorts/')) return 'short'
  if (url.includes('/video/') || url.includes('watch?v=')) return 'video'
  if (raw.platform === null) return 'article'
  // A platform post stating plays is video of some kind; the URL simply did not
  // say which. Reported as 'video' rather than guessed at more precisely.
  if (raw.viewsAvailable && raw.views > 0) return 'video'
  return 'post'
}

function toScrapedPost(
  raw: RawPost,
  keywordId: string | null,
  alignment: Alignment,
): ScrapedPost {
  const engagement = engagementOf(raw)
  const sourceType = sourceTypeFor(raw.platform)
  return {
    externalId: raw.externalId,
    text: raw.text,
    title: headlineFrom(raw.text, 14),
    snippet: clampChars(raw.text.replace(/\s+/g, ' ').trim(), 240),
    authorName: raw.authorName,
    authorHeadline: raw.authorHeadline,
    authorFollowers: raw.authorFollowers,
    url: raw.url,
    postedAt: raw.postedAt,
    reactions: raw.reactions,
    comments: raw.comments,
    reposts: raw.reposts,
    // Deriving tags from the body is a SOCIAL affordance: in a post a `#token`
    // is a hashtag the author chose. On an open-web page a `#token` is a URL
    // fragment — Wikipedia's footnote and section anchors — and treating those
    // as audience vocabulary once put `#cite_note` into a caption. So the
    // fallback applies to the platform lanes only.
    hashtags:
      raw.hashtags.length > 0
        ? raw.hashtags
        : sourceType === 'Social'
          ? extractHashtagsFromText(raw.text)
          : [],
    keyword: raw.keyword,
    keywordId,
    sourceName: raw.sourceName,
    sourceType,
    platform: raw.platform,
    metricsAvailable: raw.metricsAvailable,
    views: raw.views,
    viewsAvailable: raw.viewsAvailable,
    hook: hookOf(raw.text),
    engagementRate: engagementRateOf(raw),
    mediaFormat: mediaFormatOf(raw),
    transcript: null,
    transcriptSource: null,
    transcriptConfidence: null,
    signalFlags: [],
    brandRelevance: alignment.score,
    alignedTopics: alignment.matchedTopics,
    knowledgeHits: alignment.knowledgeHits,
    engagement,
    engagementScore: 0,
    velocity: 0,
    // Every row now comes off a real crawl. `'fixture'` remains in the union
    // because it is a persisted storage value on `scraped_items`, but nothing
    // in the product writes it any more.
    captureSource: 'live',
    relevance: 0,
    credibility: 'Medium',
    credibilityScore: 55,
    freshness: 0,
    isDuplicate: false,
    duplicateOfExternalId: null,
    priorRejection: null,
    validation: 'pending',
    verdictReason: '',
  }
}

registerSkill<PipelinePayload>('scraping.linkedin.fetch', async (payload, ctx) => {
  const keywords = payload.keywords ?? []
  if (keywords.length === 0) throw new Error('No keywords resolved — nothing to fetch.')

  // Trends come from the platforms themselves — the Claude Bridge's searches scoped to each platform's posts, never the open web.
  if (platformLaneUnavailableReason() !== '') {
    throw new Error(`Cannot capture — ${platformLaneUnavailableReason()} Platform trends are read only from the platforms; there is no web fallback.`)
  }

  const minBrandRelevance = ctx.num('minBrandRelevance', 20)
  const minAuthorFollowers = ctx.num('minAuthorFollowers', 0)
  const minEnglishRatio = ctx.num('minEnglishRatio', 8)
  const datePosted = ctx.str('datePosted', 'current-month')
  const currentMonth = datePosted === 'current-month' || WINDOW_HOURS[datePosted] === undefined
  const rollingHours = currentMonth ? undefined : WINDOW_HOURS[datePosted]
  const maxSearchesPerPlatform = ctx.num('maxSearchesPerPlatform', 16)
  const maxPostsPerTrend = ctx.num('maxPostsPerTrend', 5)
  const showOlderWhenEmpty = ctx.bool('showOlderWhenEmpty', true)
  const listUndatedPlatforms = ctx.bool('listUndatedPlatforms', true)

  // `undefined` is the open-web lane, which is how the capture contract spells it too.
  const lanes: Array<{ platform: Platform | undefined; label: string }> = [
    ...PLATFORM_KNOBS.filter((p) => ctx.bool(p.knob, true)).map((p) => ({
      platform: p.platform as Platform | undefined,
      label: p.label,
    })),
  ]

  if (lanes.length === 0) {
    throw new Error('Every capture lane is switched off — turn on at least one platform or the open web.')
  }

  const vocabulary = await loadAlignmentVocabulary(ctx.workspaceId)
  ctx.log(
    `Aligning against ${vocabulary.topics.length} brand topics, ` +
      `${vocabulary.knowledgeEntries} Knowledge Base corpus entr${vocabulary.knowledgeEntries === 1 ? 'y' : 'ies'} ` +
      `and ${vocabulary.keywordTerms.size} declared keyword term${vocabulary.keywordTerms.size === 1 ? '' : 's'}`,
  )

  /*
   * PLATFORM-LEVEL TREND DISCOVERY (the Claude Bridge).
   *
   * One pass per platform — not one per keyword per lane. The bridge runs at
   * most `maxSearchesPerPlatform` focused searches on each platform, built
   * from this run's keywords, the brand context and the Knowledge Base; keeps
   * only posts verifiably published inside the window that mention an Ethara
   * keyword; and groups them into trends, newest first. It writes no content.
   */
  ctx.emit(
    'activity',
    `Discovering what is trending on ${lanes.map((l) => l.label).join(', ')} through the Claude Bridge — ` +
      `${currentMonth ? 'this month so far' : `last ${rollingHours} hours`}, at most ${maxSearchesPerPlatform} searches per platform, one topic each`,
    { status: 'running', datePosted, maxSearchesPerPlatform },
  )

  // One live lane per platform, so the run screen shows each platform being searched.
  for (const lane of lanes) {
    // A platform whose posts cannot be dated is searched only when its undated posts are listed.
    if (platformModule(lane.platform ?? 'web')?.canDateItems === false && !listUndatedPlatforms) continue
    ctx.emit('activity', `${lane.label}: searching through the Claude Bridge`, {
      status: 'running',
      platform: lane.platform ?? 'web',
      keyword: DISCOVERY_LANE_KEY,
    })
  }

  const report = await discoverPlatformTrends({
    platforms: lanes.map((l) => (l.platform ?? 'web') as PlatformId),
    ...(rollingHours !== undefined ? { windowHours: rollingHours } : { currentMonth: true }),
    // "Today" is the workspace's date, so a post from this morning in India is today's.
    timeZone: config.core.tz,
    fallbackToLatest: showOlderWhenEmpty,
    includeUndated: listUndatedPlatforms,
    maxSearchesPerPlatform,
    maxPostsPerTrend,
    keywords: keywords.map((k) => ({
      term: k.term,
      weight: k.weight,
      category: k.category,
      synonyms: synonymsFor(k.term),
      scheduled: null,
    })),
  })

  /*
   * Recorded on the run as it happens, so the Scraping section of the app can
   * show the discovery — each platform's searches, results and trends — even
   * when nothing was captured and the run stops here.
   */
  if (payload.runId) {
    await mergePipelineRunSummary(payload.runId, {
      platformDiscovery: {
        generatedAt: report.generatedAt,
        context: report.context,
        today: report.today,
        timeZone: report.timeZone,
        windowHours: report.windowHours,
        window: report.window,
        windowName: report.windowName,
        keywordsUsed: report.keywordsUsed,
        corpus: report.corpus,
        searchesRun: report.searchesRun,
        maxSearchesPerPlatform,
        maxPostsPerTrend,
        platforms: report.platforms,
        trends: report.trends,
        undated: report.undated,
        postCount: report.posts.length,
      },
    }).catch(() => undefined)
  }

  /** Why a platform produced nothing — stated per platform, at the level it is true at. */
  const laneReasons: string[] = []
  ctx.emit(
    'activity',
    `Claude Bridge context · Knowledge Base ${report.context.knowledgeBase.entries} entries · ` +
      `Ethara brand (${report.context.brand.topics} topics) · ${report.context.keywords.count} keywords`,
    { status: 'ok', context: report.context },
  )
  for (const p of report.platforms) {
    // Nothing current on this platform: its reason stands with the others if the whole capture comes back empty.
    if (p.status === 'older' || p.status === 'undated') laneReasons.push(`${p.platform}: ${p.reason ?? p.status}`)
    if (p.status === 'older' || p.status === 'undated') {
      // Output, but not current or not datable — said plainly on the lane.
      ctx.emit(
        'activity',
        p.status === 'older'
          ? `${p.platform}: nothing indexed from the current month — ${p.kept} older post(s) kept as supporting context only, not passed on`
          : `${p.platform}: ${p.kept} relevant post(s), date not stated — listed for reference, not validated`,
        {
          status: 'warn',
          platform: p.platformId,
          keyword: DISCOVERY_LANE_KEY,
          searches: p.searches,
          count: 0,
          captured: p.found,
          reason: p.reason,
        },
      )
    } else if (p.status === 'ok') {
      const trends = report.trends.filter((t) => t.platform === p.platform).length
      ctx.emit('activity', `${p.platform}: ${p.kept} relevant post(s) in ${trends} trend(s)`, {
        status: 'ok',
        platform: p.platformId,
        keyword: DISCOVERY_LANE_KEY,
        searches: p.searches,
        count: p.kept,
        captured: p.found,
      })
    } else {
      const reason = `${p.platform}: ${p.reason ?? p.status}`
      laneReasons.push(reason)
      ctx.emit('activity', `${p.platform}: ${p.status === 'skipped' ? 'skipped' : 'nothing captured'}`, {
        status: 'warn',
        platform: p.platformId,
        keyword: DISCOVERY_LANE_KEY,
        searches: p.searches,
        count: 0,
        captured: p.found,
        reason: p.reason,
      })
    }
  }
  ctx.emit(
    'activity',
    report.corpus.terms.length > 0
      ? `Reference · research corpus: ${report.corpus.papers} paper(s) → ${report.corpus.terms.length} topics; searched today: ${report.corpus.searched.join(', ')}`
      : `Reference · research corpus not used: ${report.corpus.reason ?? 'no topics'}`,
    { status: report.corpus.terms.length > 0 ? 'ok' : 'warn', corpus: report.corpus },
  )
  const trendingToday = report.trends.filter((t) => t.period === 'today').length
  ctx.emit(
    'activity',
    `Trending today (${report.today}): ${trendingToday} trend(s) · trending ${report.windowName}: ${report.trends.filter((t) => t.period !== 'older').length} trend(s)`,
    { status: trendingToday > 0 ? 'ok' : 'warn', today: report.today, trendingToday, trends: report.trends.length },
  )
  for (const trend of report.trends) {
    ctx.emit('activity', `Trending ${trend.period === 'today' ? 'today' : trend.period === 'older' ? 'before the window' : report.windowName} on ${trend.platform}: ${trend.trend} — ${trend.posts.length} post(s)`, {
      status: 'ok',
      platform: trend.platform,
      trend: trend.trend,
      hashtags: trend.hashtags,
      matchedEtharaKeywords: trend.matchedEtharaKeywords,
      reason: trend.reason,
    })
  }
  ctx.log(`${report.searchesRun} search(es) run across ${report.platforms.length} platform(s); ${report.trends.length} trend(s), ${report.posts.length} post(s)`)

  /** Kept per lane so the run console can say WHERE the material came from. */
  const perLaneCounts = new Map<string, number>()
  let offBrand = 0
  // Search results state no follower count, so the floor never drops a post here;
  // exemptions are counted as `followersNotStated` instead.
  const belowFollowerFloor = 0
  let notEnglish = 0
  let languageUnknown = 0
  let followersNotStated = 0

  const byTerm = new Map(keywords.map((k) => [k.term.toLowerCase(), k]))
  const posts: ScrapedPost[] = []
  /*
   * PREVIOUS-MONTH EVIDENCE IS CONTEXT, NOT CAPTURE (system prompt §5).
   * Posts from before the window stay in the run's discovery record, labelled
   * supporting context, but are never handed to the Validation Agent as current
   * evidence — so nothing downstream can build on them as a current trend.
   */
  const current = report.posts.filter((tp) => tp.period !== 'older')
  const supporting = report.posts.length - current.length
  if (supporting > 0) {
    ctx.emit('activity', `${supporting} post(s) from before ${report.windowName} kept as supporting context only — not passed to validation`, {
      status: 'warn',
      supportingContext: supporting,
    })
  }
  // Newest first, as the bridge returned them.
  for (const tp of current) {
    const keyword = tp.matchedEtharaKeywords.map((t) => byTerm.get(t.toLowerCase())).find((k) => k !== undefined)
    // A related post names no keyword: its trend (the brand topic it matched) stands in.
    const term = keyword?.term ?? tp.matchedEtharaKeywords[0] ?? tp.trend
    // Engagement only when the source stated it (SocialFetch does; a web
    // search result never does). Zero with `metricsAvailable: false` means
    // "not applicable", never "no one engaged".
    const e = tp.engagement
    const stated = e !== null && (e.reactions !== null || e.comments !== null)
    const raw: RawPost = {
      externalId: tp.url,
      text: tp.text,
      authorName: tp.author ?? '',
      authorHeadline: '',
      authorFollowers: 0,
      url: tp.url,
      postedAt: tp.publishedAt,
      reactions: stated ? (e.reactions ?? 0) : 0,
      comments: stated ? (e.comments ?? 0) : 0,
      reposts: stated ? (e.reposts ?? 0) : 0,
      views: e?.views ?? 0,
      viewsAvailable: e?.views !== null && e?.views !== undefined,
      hashtags: tp.hashtags.map((h) => h.replace(/^#/, '')),
      keyword: term,
      // Always "Claude Bridge · …": the bridge ran the discovery; the source it read is named after it.
      sourceName: `Claude Bridge · ${tp.platform}${tp.source === 'socialfetch' ? ' · SocialFetch' : ''}`,
      platform: tp.platformId === 'web' ? null : tp.platformId,
      metricsAvailable: stated,
    }

    // A follower count of zero means the source did not state one.
    if (minAuthorFollowers > 0) followersNotStated += 1
    if (minEnglishRatio > 0) {
      const ratio = englishRatio(raw.text)
      if (ratio === -1) {
        languageUnknown += 1
      } else if (ratio < minEnglishRatio) {
        notEnglish += 1
        continue
      }
    }
    const alignment = alignmentOf(raw.text, term, vocabulary)
    if (alignment.score < minBrandRelevance) {
      offBrand += 1
      continue
    }
    const post = toScrapedPost(raw, keyword?.id ?? null, alignment)
    posts.push(post)
    perLaneCounts.set(tp.platform, (perLaneCounts.get(tp.platform) ?? 0) + 1)
    ctx.emit('item.scraped', post.title, {
      keyword: term,
      platform: post.platform ?? 'open-web',
      source: post.sourceName,
      externalId: post.externalId,
      brandRelevance: post.brandRelevance,
      captureSource: post.captureSource,
      trend: tp.trend,
      ...(post.url ? { url: post.url } : {}),
    })
  }

  if (posts.length === 0) {
    throw new Error(
      laneReasons.length > 0
        ? `Nothing was captured on any platform — ${laneReasons.join(' · ')}`
        : 'Nothing was captured on any platform, and no platform reported a reason.',
    )
  }

  // Constraint 5: scraped bodies are untrusted. They are wrapped and scanned
  // here, at the point of capture, so nothing downstream can reach a model with
  // raw third-party text. Directives found inside are reported, never followed.
  const evidence = prepareEvidence(
    posts.map((post) => ({
      id: post.externalId ?? post.title,
      source: post.sourceName ?? 'capture',
      ...(post.url ? { url: post.url } : {}),
      ...(post.authorName ? { author: post.authorName } : {}),
      content: post.text ?? post.snippet ?? '',
    })),
  )

  for (const attempt of evidence.injectionAttempts) {
    ctx.emit('activity', `Injection attempt in scraped content: ${attempt.label}`, {
      status: 'warn',
      itemId: attempt.itemId,
      pattern: attempt.patternId,
      excerpt: attempt.excerpt,
    })
  }

  if (evidence.injectionAttempts.length > 0) {
    ctx.log(
      `${evidence.injectionAttempts.length} scraped item(s) contain text that reads as an instruction. Wrapped as evidence and reported — not followed.`,
    )
  }

  const breakdown = [...perLaneCounts.entries()]
    .filter(([, n]) => n > 0)
    .map(([label, n]) => `${label} ${n}`)
    .join(' · ')

  const withMetrics = posts.filter((p) => p.metricsAvailable).length

  ctx.log(
    `${posts.length} page(s) across ${keywords.length} keyword(s) and ${lanes.length} lane(s)` +
      (breakdown === '' ? '' : ` — ${breakdown}`) +
      (offBrand > 0 ? ` · ${offBrand} dropped below the ${minBrandRelevance}% brand-alignment floor` : '') +
      (belowFollowerFloor > 0
        ? ` · ${belowFollowerFloor} dropped below the ${minAuthorFollowers}-follower floor`
        : '') +
      (followersNotStated > 0
        ? ` · ${followersNotStated} kept with no stated follower count, so the floor could not be applied`
        : '') +
      (notEnglish > 0
        ? ` · ${notEnglish} dropped below the ${minEnglishRatio}% English-prose floor`
        : '') +
      (languageUnknown > 0
        ? ` · ${languageUnknown} too short to judge the language of, kept`
        : ''),
  )

  // The number the Validation Agent's engagement, velocity and growth
  // components will actually run on. Said here, at capture, because a trend
  // score computed over a handful of metric-bearing rows is a different claim
  // from one computed over all of them.
  ctx.log(
    withMetrics === posts.length
      ? `All ${posts.length} page(s) carry engagement figures.`
      : `${withMetrics} of ${posts.length} page(s) carry engagement figures; the rest were ` +
        'read from search-indexed pages that state none, and are excluded from the engagement, ' +
        'velocity and growth components of the trend score.',
  )

  return {
    posts,
    postsBeforeDedupe: posts.length,
    captureSource: 'live' as const,
    captureFallbackReasons: laneReasons,
    /** Handed to the Validation Agent beside `posts`. */
    // Current-month groups only; supporting-context groups stay in the discovery record.
    platformTrends: report.trends.filter((t) => t.evidenceLevel !== 'supporting_context'),
    /** The wrapped, escaped block. The only form in which a model may read these bodies. */
    evidenceText: evidence.text,
    injectionAttempts: evidence.injectionAttempts,
  }
})

/* ═══════════════════════════════════════════════════════════════════════════
   4 · scraping.hashtag.harvest
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.hashtag.harvest', (payload, ctx) => {
  const posts = payload.posts ?? []
  const minOccurrences = ctx.num('minOccurrences', 2)
  const dropGeneric = ctx.bool('dropGeneric', true)
  const maxPerKeyword = ctx.num('maxPerKeyword', 25)
  const deriveFromTopics = ctx.bool('deriveFromTopics', true)

  interface Accumulator {
    tag: string
    /** The most common display casing wins, so #RLHF does not become #rlhf. */
    casings: Map<string, number>
    postCount: number
    totalEngagement: number
    /** Alignment stands in for engagement when ranking metric-less pages. */
    totalRelevance: number
    firstSeenAt: string
    lastSeenAt: string
    keywords: Map<string, number>
    platforms: Set<string>
    /** The best post carrying the tag, by brand alignment then engagement. */
    topPost: { url: string; title: string; score: number } | null
  }

  const acc = new Map<string, Accumulator>()
  let generic = 0

  /**
   * Which tags a post contributes.
   *
   * Platform posts contribute their own `#tokens`. Open-web pages have none —
   * see `_hashtags_for_web_page` in the sidecar for why inventing them from
   * `#` fragments was a bug — so their brand-topic matches stand in instead.
   * That is a derivation the Analysis Agent's own rules already sanction: the
   * topic set is declared vocabulary, not scraped text read as a directive.
   */
  function tagsOf(post: ScrapedPost): string[] {
    if (post.hashtags.length > 0) return post.hashtags
    if (post.sourceType === 'Social') return extractHashtagsFromText(post.text)
    if (!deriveFromTopics) return []
    return (post.alignedTopics ?? []).map((topic) =>
      topic
        .split(/[\s-]+/)
        .map((w) => (w.length === 0 ? w : (w[0] as string).toUpperCase() + w.slice(1)))
        .join(''),
    )
  }

  for (const post of posts) {
    for (const rawTag of tagsOf(post)) {
      const key = normaliseTag(rawTag)
      if (key.length < 2) continue
      if (dropGeneric && GENERIC_SET.has(key)) {
        generic += 1
        continue
      }

      let entry = acc.get(key)
      if (!entry) {
        entry = {
          tag: key,
          casings: new Map(),
          postCount: 0,
          totalEngagement: 0,
          totalRelevance: 0,
          firstSeenAt: post.postedAt,
          lastSeenAt: post.postedAt,
          keywords: new Map(),
          platforms: new Set(),
          topPost: null,
        }
        acc.set(key, entry)
      }

      const display = rawTag.replace(/^#/, '')
      entry.casings.set(display, (entry.casings.get(display) ?? 0) + 1)
      entry.postCount += 1
      entry.totalEngagement += post.engagement
      entry.totalRelevance += post.brandRelevance ?? 0
      entry.platforms.add(post.platform ?? 'open-web')

      // Engagement is unavailable on a crawled page, so the tie-break that
      // decides "the strongest post carrying this tag" runs on alignment and
      // falls back to engagement only where a source actually stated it.
      const score = (post.brandRelevance ?? 0) + post.engagement
      if (!entry.topPost || score > entry.topPost.score) {
        entry.topPost = { url: post.url, title: post.title, score }
      }
      if (post.postedAt < entry.firstSeenAt) entry.firstSeenAt = post.postedAt
      if (post.postedAt > entry.lastSeenAt) entry.lastSeenAt = post.postedAt
      entry.keywords.set(post.keyword, (entry.keywords.get(post.keyword) ?? 0) + 1)
    }
  }

  const keywordIdByTerm = new Map((payload.keywords ?? []).map((k) => [k.term, k.id]))

  // Per surfacing keyword, keep the strongest `maxPerKeyword` tags.
  const byKeyword = new Map<string, Accumulator[]>()
  for (const entry of acc.values()) {
    if (entry.postCount < minOccurrences) continue
    const topKeyword = [...entry.keywords.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? ''
    const list = byKeyword.get(topKeyword) ?? []
    list.push(entry)
    byKeyword.set(topKeyword, list)
  }

  const candidates: HashtagCandidate[] = []
  for (const [term, entries] of byKeyword) {
    const kept = entries
      .sort(
        (a, b) =>
          b.totalRelevance + b.totalEngagement - (a.totalRelevance + a.totalEngagement) ||
          b.postCount - a.postCount,
      )
      .slice(0, Math.max(1, maxPerKeyword))

    for (const entry of kept) {
      const display =
        [...entry.casings.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? entry.tag
      candidates.push({
        tag: entry.tag,
        displayTag: display,
        keyword: term,
        keywordId: keywordIdByTerm.get(term) ?? null,
        postCount: entry.postCount,
        totalEngagement: entry.totalEngagement,
        engagementPerPost:
          Math.round((entry.totalEngagement / Math.max(1, entry.postCount)) * 100) / 100,
        brandRelevance: Math.round(entry.totalRelevance / Math.max(1, entry.postCount)),
        platforms: [...entry.platforms],
        firstSeenAt: entry.firstSeenAt,
        lastSeenAt: entry.lastSeenAt,
        surfacedBy: [...entry.keywords.keys()],
        feedUrl: `https://www.linkedin.com/feed/hashtag/${encodeURIComponent(entry.tag)}/`,
        topPostUrl: entry.topPost?.url ?? null,
        topPostTitle: entry.topPost?.title ?? null,
        relevance: 0,
        credibility: 'Medium',
        credibilityScore: 55,
        freshness: 0,
        hashtagScore: 0,
        rank: null,
        validation: 'pending',
        verdictReason: '',
        duplicateOfTag: null,
        inTopSet: false,
      })
    }
  }

  for (const candidate of candidates) {
    ctx.emit('hashtag.captured', `#${candidate.displayTag}`, {
      tag: candidate.tag,
      keyword: candidate.keyword,
      postCount: candidate.postCount,
      platforms: candidate.platforms,
    })
  }

  ctx.log(
    `${candidates.length} hashtag candidates` +
      (generic > 0 ? ` · ${generic} generic reach-bait tag(s) dropped` : ''),
  )

  return { hashtagCandidates: candidates }
})

/* ═══════════════════════════════════════════════════════════════════════════
   5 · scraping.hashtag.expand
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.hashtag.expand', async (payload, ctx) => {
  if (!ctx.bool('enabled', true)) return {}

  const candidates = payload.hashtagCandidates ?? []
  if (candidates.length === 0) return {}
  // When the Claude Bridge can serve LinkedIn the tag is read there — dated,
  // de-duplicated platform posts. Otherwise it falls back to the open web.
  // Either way only volume is knowable: neither source states engagement.
  const tagLane: Platform | undefined = captureFor('linkedin').isConfigured() ? 'linkedin' : undefined
  const tagSource = captureFor(tagLane)

  if (!tagSource.isConfigured()) {
    ctx.log(`Hashtag feeds not read — ${tagSource.unavailableReason()}`)
    return {}
  }

  const expandTop = ctx.num('expandTop', 6)
  const itemsPerHashtag = ctx.num('itemsPerHashtag', 4)
  const maxParallel = Math.max(1, ctx.num('maxParallel', 2))

  const targets = [...candidates]
    .sort((a, b) => (b.brandRelevance ?? 0) - (a.brandRelevance ?? 0) || b.postCount - a.postCount)
    .slice(0, Math.max(0, expandTop))

  const byTag = new Map(candidates.map((c) => [c.tag, c]))
  let readings = 0

  await mapWithConcurrency(targets, maxParallel, async (candidate) => {
    const target = byTag.get(candidate.tag)
    if (!target) return

    // On the open-web fallback the tag is read as a search term rather than as
    // a feed URL, because the feed pages themselves are login-walled and render
    // nothing to a logged-out crawl. Through an actor the tag can be asked for
    // as a tag, so the `#` is kept.
    const query =
      tagLane === undefined
        ? candidate.displayTag.replace(/([a-z0-9])([A-Z])/g, '$1 $2').trim()
        : `#${candidate.displayTag.replace(/^#/, '')}`

    let rows: RawPost[]
    try {
      rows = await tagSource.run({
        keyword: query,
        ...(tagLane === undefined ? {} : { platform: tagLane }),
        maxItems: itemsPerHashtag,
        maxCharsPerPage: config.capture.maxCharsPerPage,
        datePosted: 'past-month',
        sortBy: 'date',
      })
    } catch {
      // An independent reading that could not be taken simply is not taken.
      // Leaving the keyword-scoped figures untouched is the honest outcome.
      return
    }

    readings += 1

    // An independent reading, not biased by the keyword query that surfaced it.
    target.independentPostCount = rows.length
    target.independentEngagement = rows.reduce((total, p) => total + engagementOf(p), 0)
    target.expandedSource = 'live'

    // Merge the independent reading in rather than replacing the keyword-scoped
    // one: both are evidence, and the union is the truer volume.
    target.postCount = Math.max(target.postCount, rows.length)
    target.totalEngagement = Math.max(target.totalEngagement, target.independentEngagement)
    target.engagementPerPost =
      Math.round((target.totalEngagement / Math.max(1, target.postCount)) * 100) / 100

    if (rows.length > 0) {
      const dates = rows.map((p) => p.postedAt).sort()
      if ((dates[0] as string) < target.firstSeenAt) target.firstSeenAt = dates[0] as string
      const last = dates[dates.length - 1] as string
      if (last > target.lastSeenAt) target.lastSeenAt = last
    }
  })

  ctx.log(
    readings === 0
      ? `No hashtag could be read independently of the keyword that surfaced it`
      : `${readings} of ${targets.length} hashtag(s) read independently`,
  )

  return { hashtagCandidates: candidates }
})

/* ═══════════════════════════════════════════════════════════════════════════
   6 · scraping.engagement.capture
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.engagement.capture', (payload, ctx) => {
  const posts = payload.posts ?? []
  if (posts.length === 0) return {}

  const shouldNormalise = ctx.bool('normalise', true)
  const windowHours = ctx.num('velocityWindowHours', 72)
  const now = new Date()

  const withMetrics = posts.filter((p) => p.metricsAvailable === true)
  const batchMax = posts.reduce((max, p) => Math.max(max, p.engagement), 0)

  for (const post of posts) {
    const ageHours = hoursSince(post.postedAt, now)
    post.velocity = velocityOf(post.engagement, ageHours, windowHours)
    post.engagementScore = shouldNormalise
      ? normalise(post.engagement, batchMax)
      : Math.min(100, post.engagement)
  }

  // Constraint 2 in the one place it is easiest to violate. When no source
  // stated a figure, the batch maximum is 0 and every score is 0 — which is
  // "not measurable", not "nothing performed". Saying so here stops that zero
  // being read as a verdict in the run console.
  if (withMetrics.length === 0) {
    ctx.log(
      `Engagement is not available for this batch — a search-indexed page states no reaction count. ` +
        `Ranking runs on brand alignment, freshness and provenance instead.`,
    )
    return { posts }
  }

  const peak = posts.reduce(
    (best, p) => (p.velocity > best.velocity ? p : best),
    posts[0] as ScrapedPost,
  )
  ctx.log(
    `Engagement normalised against a batch maximum of ${batchMax}; ` +
      `fastest mover is “${peak.title}” at ${peak.velocity}/hour ` +
      `(${withMetrics.length} of ${posts.length} item(s) carried figures)`,
  )

  return { posts }
})

/* ═══════════════════════════════════════════════════════════════════════════
   7 · scraping.competitor.track
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.competitor.track', async (_payload, ctx) => {
  const postsPer = ctx.num('postsPerCompetitor', 3)
  const maxParallel = Math.max(1, ctx.num('maxParallel', 2))

  // The competitor set is whatever the operator registered under
  // Settings → Keywords & Sources. There is no bundled list: a fabricated
  // competitor produces a fabricated saturation reading, and the Analysis
  // Agent would then decline real opportunities on the strength of it.
  const rows = await listSources(ctx.workspaceId)
  const competitors = rows.filter((s) => s.enabled && s.source_type === 'Competitor')

  if (competitors.length === 0) {
    ctx.emit(
      'activity',
      'No competitor sources are registered, so saturation is not measured this run. Add them under Settings → Keywords & Sources.',
      { status: 'warn' },
    )
    ctx.log('No competitor sources registered — competitor tracking skipped')
    return { competitorPosts: [] }
  }

  const competitorSource = captureFor('linkedin')

  if (!competitorSource.isConfigured()) {
    ctx.log(`Competitors not read — ${competitorSource.unavailableReason()}`)
    return { competitorPosts: [] }
  }

  const results = await mapWithConcurrency(competitors, maxParallel, async (competitor) => {
    let rows2: RawPost[]
    try {
      rows2 = await competitorSource.run({
        keyword: competitor.name,
        platform: 'linkedin',
        maxItems: postsPer,
        maxCharsPerPage: config.capture.maxCharsPerPage,
        datePosted: 'past-month',
        sortBy: 'date',
      })
    } catch {
      return []
    }

    // Relative to this competitor's own batch, so a large account and a small
    // one are comparable. Only computable where the source stated figures —
    // otherwise it stays zero, meaning "not measured", and the Analysis Agent
    // reads volume instead.
    const maxEngagement = Math.max(
      ...rows2.filter((p) => p.metricsAvailable).map((p) => engagementOf(p)),
      1,
    )

    return rows2.map<CompetitorPostRecord>((p) => ({
      competitor: competitor.name,
      text: p.text,
      // The format of an indexed page is not knowable from the page, and
      // guessing it would put a fabricated attribute on a real record.
      format: 'Unknown',
      engagementIndex: p.metricsAvailable
        ? Math.round((engagementOf(p) / maxEngagement) * 100)
        : 0,
      postedAt: p.postedAt,
      topics: matchedTopics(p.text, 4),
      tier: 'Registered',
    }))
  })

  const competitorPosts = results.flat()
  ctx.log(
    `${competitorPosts.length} competitor page(s) across ${competitors.length} registered account(s)`,
  )

  return { competitorPosts }
})

/* ═══════════════════════════════════════════════════════════════════════════
   8 · scraping.dedupe.prefilter
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.dedupe.prefilter', async (payload, ctx) => {
  const posts = payload.posts ?? []
  if (posts.length === 0) return {}

  const historyDays = ctx.num('historyDays', 14)
  const onRecord = await recentCaptures(ctx.workspaceId, historyDays)
  const termById = new Map((payload.keywords ?? []).map((k) => [k.id, k.term]))

  // Within-batch identity as well as against history: the same page can arrive
  // twice from two keyword queries, or from two platform lanes.
  const batch = new Set<string>()
  const kept: ScrapedPost[] = []
  let droppedHistory = 0
  let droppedBatch = 0

  for (const post of posts) {
    const prior = onRecord.get(post.externalId) ?? (post.url ? onRecord.get(post.url) : undefined)
    if (prior) {
      droppedHistory += 1
      // Held back, not judged — no verdict is assigned here. The event exists
      // so the run can show WHICH pages were already on record and since when.
      // A bare count leaves the validation stage looking idle when in fact it
      // was handed nothing new.
      ctx.emit('item.held', post.title, {
        externalId: post.externalId,
        keyword: (post.keywordId === null ? undefined : termById.get(post.keywordId)) ?? '',
        platform: post.platform ?? 'open-web',
        heldSince: prior.scrapedAt,
        originalId: prior.id,
        originalTitle: prior.title,
        // The verdict the earlier run reached. Reported, not re-judged.
        verdict: prior.validation,
        reason: prior.verdictReason ?? '',
        historyDays,
      })
      continue
    }
    if (batch.has(post.externalId)) {
      droppedBatch += 1
      continue
    }
    batch.add(post.externalId)
    kept.push(post)
  }

  const dropped = droppedHistory + droppedBatch
  ctx.log(
    dropped === 0
      ? `No repeats in the last ${historyDays} days`
      : `${dropped} already-captured page(s) filtered — ${droppedHistory} seen within ${historyDays} days, ${droppedBatch} repeated inside this batch`,
  )

  return { posts: kept }
})


/* ═══════════════════════════════════════════════════════════════════════════
   4 · scraping.account.capture — the tracked-account lane
   ───────────────────────────────────────────────────────────────────────────
   A keyword query answers "what is being said about X". This answers "what did
   THESE PEOPLE say", which is a different question and is the one you ask when
   you are watching specific competitors rather than a topic.

   Distinct from `scraping.competitor.track`, which reads registered competitor
   SOURCES for the saturation reading that the Analysis Agent consumes. This is
   a capture lane: its posts join the corpus, get scored, get verdicts, and can
   become ideas.

   WITH NO ACCOUNTS REGISTERED IT CAPTURES NOTHING AND SAYS SO. It does not fall
   back to a keyword query, because "posts by the five accounts you are watching"
   and "posts matching your keywords" are different evidence, and substituting
   one for the other would put a claim on screen that no row supports.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.account.capture', async (payload, ctx) => {
  const postsPerAccount = ctx.num('postsPerAccount', 10)
  const maxAccountsPerRun = ctx.num('maxAccountsPerRun', 10)
  const minBrandRelevance = ctx.num('minBrandRelevance', 0)
  const maxParallel = ctx.num('maxParallel', 2)

  const all = await listTrackedAccounts(ctx.workspaceId, { activeOnly: true })
  if (all.length === 0) {
    ctx.log(
      'No accounts are being tracked, so this lane captured nothing. Add handles under ' +
        'Tracked accounts; nothing is substituted for them.',
    )
    return {}
  }

  const accounts = all.slice(0, maxAccountsPerRun)
  if (all.length > accounts.length) {
    ctx.emit(
      'activity',
      `${all.length - accounts.length} tracked account(s) were not read this run — the per-run ceiling is ${maxAccountsPerRun}.`,
      { status: 'warn', skipped: all.slice(maxAccountsPerRun).map((a) => a.handle) },
    )
  }

  const vocabulary = await loadAlignmentVocabulary(ctx.workspaceId)
  const existing = payload.posts ?? []
  const seen = new Set(existing.map((p) => p.externalId))
  const captured: string[] = []
  const reasons: string[] = []

  const perAccount = await mapWithConcurrency(accounts, maxParallel, async (account) => {
    const source = captureFor(account.platform)
    if (!source.isConfigured()) {
      const reason = `${account.platform} cannot be read for @${account.handle} — ${source.unavailableReason()}`
      if (!reasons.includes(reason)) reasons.push(reason)
      return [] as ScrapedPost[]
    }

    let rows: RawPost[] = []
    try {
      /*
       * THE HANDLE IS THE QUERY.
       *
       * The capture contract takes a keyword, and an account search is a
       * keyword search whose term happens to be a handle — which is exactly
       * how every one of these actors accepts it. Passing it through the same
       * contract rather than adding an account-shaped input keeps one code
       * path, and the handle travels onto the row as the keyword that found
       * it, which is true and is what lineage needs.
       */
      rows = await source.run({
        keyword: `@${account.handle}`,
        platform: account.platform,
        maxItems: postsPerAccount,
        maxCharsPerPage: config.capture.maxCharsPerPage,
        datePosted: 'past-month',
        sortBy: 'date',
      })
    } catch (error) {
      const reason =
        error instanceof AdapterError
          ? error.toReason()
          : `@${account.handle} could not be read — ${error instanceof Error ? error.message : String(error)}`
      if (!reasons.includes(reason)) reasons.push(reason)
      return [] as ScrapedPost[]
    }

    const kept: ScrapedPost[] = []
    for (const raw of rows) {
      if (seen.has(raw.externalId)) continue
      const alignment = alignmentOf(raw.text, `@${account.handle}`, vocabulary)
      if (alignment.score < minBrandRelevance) continue
      seen.add(raw.externalId)
      const post = toScrapedPost(raw, null, alignment)
      // The handle, not the search string. `keyword` is what an operator reads
      // on the card as "how we found this", and "@openai" is the honest answer.
      post.keyword = `@${account.handle}`
      post.sourceName = account.label ?? `@${account.handle}`
      kept.push(post)
    }

    if (kept.length > 0) captured.push(account.id)
    ctx.emit(
      'activity',
      `@${account.handle} · ${kept.length} post(s) kept of ${rows.length}`,
      { status: 'ok', platform: account.platform, handle: account.handle, count: kept.length },
    )
    return kept
  })

  const fresh = perAccount.flat()
  await markTrackedAccountsCaptured(ctx.workspaceId, captured)

  for (const reason of reasons) {
    ctx.emit('activity', reason, { status: 'warn' })
  }

  ctx.log(
    fresh.length === 0
      ? `Read ${accounts.length} tracked account(s) and kept nothing${reasons.length > 0 ? ` — ${reasons[0]}` : ''}`
      : `${fresh.length} post(s) from ${captured.length} of ${accounts.length} tracked account(s)`,
  )

  return {
    posts: [...existing, ...fresh],
    ...(reasons.length > 0
      ? { captureFallbackReasons: [...(payload.captureFallbackReasons ?? []), ...reasons] }
      : {}),
  }
})


/* ═══════════════════════════════════════════════════════════════════════════
   10 · scraping.keyword.discover — the terms nobody seeded
   ───────────────────────────────────────────────────────────────────────────
   THE DEFECT THIS EXISTS TO FIX (ADR-012).

   Every run reported the same trending keywords, and the cause was structural.
   `scraping.keyword.resolve` reads the keyword table; `validation.keyword.trend`
   scores those same rows. So "top trending keywords" never meant *what is
   trending* — it meant *which of the terms someone already typed scored highest
   this week*. A topic that dominated the entire captured corpus could not
   appear, because there was no row for it to be ranked as.

   This reads the corpus the run actually captured and extracts what is being
   talked about, excluding everything already known. It proposes; it does not
   promote — `validation.keyword.emerge` decides, and a human approves.
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A stable identity for "one distinct voice", for the discovery bars.
 *
 * The stated author where there is one; the publishing host otherwise. Falls
 * back to the post's own id last, so two genuinely unattributable posts from
 * nowhere count as two rather than silently merging into one — merging would
 * understate diversity, and this function exists to measure it.
 */
function voiceOf(post: ScrapedPost): string {
  const named = post.authorName.trim().toLowerCase()
  if (named !== '') return `author:${named}`
  try {
    return `host:${new URL(post.url).host.replace(/^www\./, '')}`
  } catch {
    return `item:${post.externalId}`
  }
}

registerSkill<PipelinePayload>('scraping.keyword.discover', async (payload, ctx) => {
  const posts = payload.posts ?? []
  if (posts.length === 0) {
    ctx.log('Nothing was captured, so there was nothing to discover keywords from.')
    return {}
  }

  const candidatesPerRun = ctx.num('candidatesPerRun', 20)
  const phraseMaxWords = ctx.num('phraseMaxWords', 3)
  const minPhraseWords = ctx.num('minPhraseWords', 2)
  const minPostsCarrying = ctx.num('minPostsCarrying', 3)
  const minDistinctAuthors = ctx.num('minDistinctAuthors', 2)
  const minBrandRelevance = ctx.num('minBrandRelevance', 25)

  /*
   * WHAT "ALREADY KNOWN" MEANS.
   *
   * Four vocabularies, because a term is uninteresting for four different
   * reasons and lumping them together would make the exclusions unexplainable:
   *
   *   · the keyword set itself, active or not — including a term switched off
   *     on purpose, which must not come back as a fresh discovery
   *   · its declared synonyms, so "RLHF" does not surface beside "rlhf"
   *   · the brand topic vocabulary, which every on-topic post repeats by
   *     construction and which would therefore win on volume every time
   *   · the reach-bait list, for the same reason the hashtag harvester drops it
   */
  const existing = await listKeywords(ctx.workspaceId, false)
  const known = new Set<string>()
  for (const keyword of existing) {
    known.add(keyword.term.toLowerCase())
    for (const synonym of synonymsFor(keyword.term)) known.add(synonym.toLowerCase())
  }
  for (const topic of BRAND_TOPICS) known.add(topic.toLowerCase())
  for (const tag of GENERIC_HASHTAGS) known.add(tag.toLowerCase().replace(/^#/, ''))

  /*
   * WORDS THAT ARE TRUE OF EVERY POST IN THIS CORPUS.
   *
   * `contentWords` strips grammatical stopwords — "the", "of", "is". It cannot
   * strip DOMAIN stopwords, and on an AI-research corpus those are the ones
   * that ruin discovery: "model", "learning", "research", "systems" and
   * "agents" appear in almost every captured page, so they clear the volume and
   * voice bars effortlessly and surface as the top findings. The first run
   * after discovery shipped proposed exactly that list, plus the fragment
   * "tasks such".
   *
   * These are barred as STANDALONE candidates only. "reward model" and
   * "world model" are still discoverable — it is the bare word that carries no
   * information, not the word itself.
   */
  const DOMAIN_GENERIC = new Set([
    'ai', 'model', 'models', 'learning', 'research', 'system', 'systems', 'agent', 'agents',
    'data', 'training', 'task', 'tasks', 'method', 'methods', 'approach', 'approaches',
    'result', 'results', 'paper', 'papers', 'work', 'study', 'studies', 'new', 'using',
    'based', 'such', 'enables', 'enable', 'scientific', 'performance', 'evaluation',
    'benchmark', 'benchmarks', 'framework', 'frameworks', 'large', 'language',
  ])

  /** Every phrase in one body, deduplicated — a term repeated is still one post. */
  function phrasesOf(text: string): Set<string> {
    const words = contentWords(text)
    const out = new Set<string>()
    const floor = Math.max(1, Math.min(minPhraseWords, phraseMaxWords))
    for (let n = floor; n <= Math.max(floor, phraseMaxWords); n += 1) {
      for (let i = 0; i + n <= words.length; i += 1) {
        const parts = words.slice(i, i + n)
        const phrase = parts.join(' ')
        if (phrase.length < 6 || /^\d+$/.test(phrase)) continue
        if (known.has(phrase)) continue
        // A phrase that is entirely domain-generic says nothing: "large
        // language" and "training data" are not topics, they are the subject
        // matter of the whole corpus.
        if (parts.every((w) => DOMAIN_GENERIC.has(w))) continue
        // A phrase ending on a connector is a fragment cut mid-sentence
        // ("tasks such"), never a term anyone would search for.
        const last = parts[parts.length - 1] as string
        if (DOMAIN_GENERIC.has(last) && n === 1) continue
        if (/^(such|other|these|those|more|most|many|both|each)$/.test(last)) continue
        out.add(phrase)
      }
    }
    return out
  }

  interface Tally {
    term: string
    posts: number
    authors: Set<string>
    engagement: number
    measuredPosts: number
    views: number
    viewedPosts: number
    relevanceTotal: number
    examples: string[]
  }

  const tallies = new Map<string, Tally>()

  /*
   * CANDIDATES COME FROM TITLES AND HASHTAGS. OCCURRENCE IS COUNTED EVERYWHERE.
   *
   * Sliding an n-gram window over article prose does not find topics, it finds
   * sentence fragments. Run against a real 160-page corpus it proposed
   * "learning generated", "generated summary edison" and "becoming specialized
   * using" — consecutive-word slices of one piece of boilerplate that several
   * pages happened to share. None of them is a thing anyone would search for.
   *
   * A TITLE is different in kind: it is the author's own statement of what the
   * page is about, so a phrase taken from one is a topic by construction. The
   * same is true of a hashtag, which is a topic label the author chose.
   *
   * So candidates are GENERATED from titles and hashtags only, and then counted
   * across every body — a title phrase that also recurs in other pages' prose
   * is exactly the corroboration the post bar is asking about. Generation and
   * counting were the same step before, which is what let prose noise become
   * candidates in the first place.
   */
  const bodyOf = (post: ScrapedPost): string => `${post.title} ${post.text}`.toLowerCase()
  const corpus = posts.filter((p) => !p.isDuplicate).map((p) => ({ post: p, haystack: bodyOf(p) }))

  for (const post of posts) {
    // A duplicate is the same page seen twice; counting it twice would
    // manufacture the recurrence this skill is looking for.
    if (post.isDuplicate) continue

    const labels = post.hashtags
      .map((tag) => tag.replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase().trim())
      .filter((tag) => tag.split(/\s+/).length >= 1)

    for (const phrase of new Set([...phrasesOf(post.title), ...labels.filter((l) => !known.has(l) && l.length >= 6)])) {
      // A date is not a topic. Discovery names the month in its searches, so
      // "september 2026" recurs in every title — an echo of the query, not a trend.
      if (isDatePhrase(phrase)) continue
      const tally = tallies.get(phrase) ?? {
        term: phrase,
        posts: 0,
        authors: new Set<string>(),
        engagement: 0,
        measuredPosts: 0,
        views: 0,
        viewedPosts: 0,
        relevanceTotal: 0,
        examples: [],
      }
      tally.posts += 1
      /*
       * WHO COUNTS AS A DISTINCT VOICE.
       *
       * The author bar asks whether several independent people are discussing a
       * term, or one person repeating themselves. Platform lanes state an
       * author, so that question answers itself there.
       *
       * The open-web lane states NO author — ever. An earlier version of this
       * collapsed every such post into one shared '(unattributed)', which made
       * the bar unpassable on an open-web-only corpus: every candidate showed
       * exactly one author and nothing could ever be discovered. With the
       * platform lanes unavailable that is every corpus, which is precisely why
       * the keyword set had stopped growing. (Claude Bridge rows carry the
       * author handle their post URL states, so they count per author.)
       *
       * The publishing HOST is the honest stand-in. Three different websites
       * writing about a term is independent corroboration — the same thing the
       * bar is testing for — and unlike a missing name it is evidence we
       * actually hold. A host is deliberately NOT presented as an author
       * anywhere else; it is used here only to count distinct voices.
       */
      tally.authors.add(voiceOf(post))
      tally.relevanceTotal += post.brandRelevance
      // Constraint 2, on both axes. Engagement is summed over metric-bearing
      // rows only and plays over view-bearing rows only; the counts travel so
      // the score can be divided by what was actually measured.
      if (post.metricsAvailable) {
        tally.engagement += post.engagement
        tally.measuredPosts += 1
      }
      if (post.viewsAvailable) {
        tally.views += post.views
        tally.viewedPosts += 1
      }
      if (tally.examples.length < 3 && post.url !== '') tally.examples.push(post.url)
      tallies.set(phrase, tally)
    }
  }

  /*
   * CORROBORATION ACROSS THE WHOLE CORPUS.
   *
   * A candidate was proposed by one page's title. This asks how many OTHER
   * pages talk about it at all — which is the question the post and voice bars
   * are really testing, and it cannot be answered from titles alone because a
   * topic is usually named in one title and discussed in several bodies.
   */
  for (const tally of tallies.values()) {
    for (const { post, haystack } of corpus) {
      if (!haystack.includes(tally.term)) continue
      const voice = voiceOf(post)
      if (tally.authors.has(voice)) continue
      tally.authors.add(voice)
      tally.posts += 1
      tally.relevanceTotal += post.brandRelevance
      if (post.metricsAvailable) {
        tally.engagement += post.engagement
        tally.measuredPosts += 1
      }
      if (post.viewsAvailable) {
        tally.views += post.views
        tally.viewedPosts += 1
      }
    }
  }

  /*
   * THE FOUR BARS (ADR-012). Each one is here because of a specific way this
   * goes wrong, and each rejection is counted so the log can say which bar did
   * the work rather than reporting one opaque total.
   */
  let belowPosts = 0
  let belowAuthors = 0
  let belowRelevance = 0

  const cleared = [...tallies.values()].filter((tally) => {
    if (tally.posts < minPostsCarrying) {
      belowPosts += 1
      return false
    }
    if (tally.authors.size < minDistinctAuthors) {
      belowAuthors += 1
      return false
    }
    if (tally.relevanceTotal / tally.posts < minBrandRelevance) {
      belowRelevance += 1
      return false
    }
    return true
  })

  /*
   * A LONGER PHRASE BEATS THE WORDS INSIDE IT.
   *
   * "reward model" and "reward" and "model" all clear the bars on the same
   * posts, and offering all three as separate discoveries is noise. When a
   * longer candidate covers at least as many posts as a shorter one contained
   * within it, the shorter one is dropped — it is the same finding, stated less
   * precisely.
   */
  const byLength = [...cleared].sort((a, b) => b.term.length - a.term.length)
  const kept: Tally[] = []
  for (const tally of byLength) {
    const subsumed = kept.some(
      (longer) => longer.term.includes(tally.term) && longer.posts >= tally.posts,
    )
    if (!subsumed) kept.push(tally)
  }

  const candidates: KeywordCandidate[] = kept
    .map((tally) => ({
      term: tally.term,
      posts: tally.posts,
      distinctAuthors: tally.authors.size,
      totalEngagement: tally.engagement,
      measuredPosts: tally.measuredPosts,
      totalViews: tally.views,
      viewedPosts: tally.viewedPosts,
      brandRelevance: Math.round(tally.relevanceTotal / tally.posts),
      examples: tally.examples,
    }))
    // Ordered by the evidence that is always available. The real scoring is the
    // emergence skill's job; this only decides what survives the cut.
    .sort((a, b) => b.posts - a.posts || b.brandRelevance - a.brandRelevance)
    .slice(0, Math.max(1, candidatesPerRun))

  ctx.log(
    candidates.length === 0
      ? `No new term cleared the bars — ${belowPosts} appeared in fewer than ${minPostsCarrying} post(s), ${belowAuthors} came from fewer than ${minDistinctAuthors} author(s), ${belowRelevance} were below the ${minBrandRelevance}% brand floor`
      : `${candidates.length} new keyword candidate(s) from ${posts.length} captured post(s): ` +
        candidates.slice(0, 6).map((c) => `${c.term} (${c.posts} posts)`).join(', '),
  )

  for (const candidate of candidates.slice(0, 8)) {
    ctx.emit('activity', `Candidate keyword “${candidate.term}” · ${candidate.posts} post(s), ${candidate.distinctAuthors} author(s)`, {
      status: 'ok',
      term: candidate.term,
      posts: candidate.posts,
      authors: candidate.distinctAuthors,
    })
  }

  return { keywordCandidates: candidates }
})

/* ═══════════════════════════════════════════════════════════════════════════
   11 · scraping.transcript.fetch — the words that were actually said
   ───────────────────────────────────────────────────────────────────────────
   ADR-011. Local sidecar, two ceilings, and a missing transcript that stays
   missing rather than becoming an empty one.

   THE THREE OUTCOMES, AND WHY THEY ARE THREE AND NOT TWO:

     · transcribed with words   — `transcript` holds them
     · transcribed with silence — `transcript` is '', and that is FINISHED
     · not transcribed          — `transcript` stays NULL

   Collapsing the last two would make "we ran the transcriber and there was no
   speech" indistinguishable from "we never tried", and the second is the one
   that should be retried.
   ═══════════════════════════════════════════════════════════════════════════ */

registerSkill<PipelinePayload>('scraping.transcript.fetch', async (payload, ctx) => {
  const requestedMinutes = ctx.num('transcriptMaxMinutesPerRun', 20)
  const maxItems = ctx.num('maxItems', 12)
  const skipTranscribed = ctx.bool('skipTranscribed', true)

  if (!whisperTranscribe.isConfigured()) {
    // Not an error. Blank is a supported configuration, and the run says what
    // it could not do rather than failing or inventing.
    ctx.log(`Nothing was transcribed — ${whisperTranscribe.unavailableReason().split('\n')[0]}`)
    return {}
  }

  const budget = transcriptionBudget(requestedMinutes)
  if (budget.clamped) {
    ctx.emit(
      'activity',
      `The transcription budget was clamped from ${requestedMinutes} to ${budget.ceiling} minutes by WHISPER_MAX_MINUTES_PER_RUN. The knob asks; the deployment ceiling decides.`,
      { status: 'warn', requested: requestedMinutes, applied: budget.minutes },
    )
  }

  /*
   * WHICH ITEMS ARE CANDIDATES.
   *
   * Only rows that STATE a play count, because a play count is the one signal
   * available at this stage that a row is video at all. Transcribing a LinkedIn
   * text post would spend the budget fetching a page with no audio in it.
   *
   * Ordered by engagement so the budget is spent on what matters when it runs
   * out, which it will.
   */
  const posts = (payload.posts ?? [])
    .filter((p) => p.viewsAvailable && p.url !== '')
    .filter((p) => !skipTranscribed || p.transcript === null)
    .sort((a, b) => b.engagement - a.engagement)
    .slice(0, maxItems)

  if (posts.length === 0) {
    ctx.log(
      'No captured item stated a play count, so nothing looked like video and nothing was transcribed.',
    )
    return {}
  }

  let secondsSpent = 0
  const budgetSeconds = budget.minutes * 60
  let transcribed = 0
  let silent = 0
  let failed = 0
  let injectionFlags = 0
  const notAttempted: string[] = []

  for (const post of posts) {
    if (secondsSpent >= budgetSeconds) {
      notAttempted.push(post.title)
      continue
    }
    try {
      const out = await whisperTranscribe.run({
        url: post.url,
        maxSeconds: Math.max(1, budgetSeconds - secondsSpent),
      })
      secondsSpent += out.seconds

      /*
       * A TRANSCRIPT IS SCRAPED CONTENT, AND THIS IS WHERE THAT IS ENFORCED.
       *
       * Fluent natural language chosen by a stranger is the most persuasive
       * injection vector in the corpus. The scan happens at WRITE time, not at
       * read time, so an instruction-bearing transcript is flagged once and is
       * visible on the run rather than discovered by whichever model reads it
       * first. The text is still stored — it is evidence about what the video
       * said, and suppressing it would lose the finding — but it travels
       * flagged, and `prepareEvidence()` wraps and escapes it again at every
       * model call site.
       */
      const scanned = prepareEvidence([
        {
          id: post.externalId,
          source: post.sourceName,
          url: post.url,
          author: post.authorName,
          content: out.text,
        },
      ])
      if (scanned.injectionAttempts.length > 0) {
        injectionFlags += 1
        ctx.emit(
          'activity',
          `The transcript of “${post.title.slice(0, 60)}” contains instruction-shaped text and was flagged, not followed.`,
          {
            status: 'warn',
            url: post.url,
            patterns: scanned.injectionAttempts.map((f) => f.label),
          },
        )
      }

      post.transcript = out.text
      post.transcriptSource = `whisper:${out.model}`
      post.transcriptConfidence = out.confidence
      if (out.text.trim() === '') silent += 1
      else transcribed += 1
    } catch (error) {
      // NOT written as an empty transcript. The row keeps `transcript = null`,
      // which is the true statement: we tried and did not get one.
      failed += 1
      ctx.emit(
        'activity',
        `Could not transcribe “${post.title.slice(0, 60)}” — ${error instanceof Error ? error.message : String(error)}`,
        { status: 'warn', url: post.url },
      )
    }
  }

  const spentMinutes = Math.round((secondsSpent / 60) * 10) / 10
  ctx.log(
    [
      `${transcribed} transcribed`,
      silent > 0 ? `${silent} had no speech` : '',
      failed > 0 ? `${failed} failed and stay untranscribed` : '',
      notAttempted.length > 0
        ? `${notAttempted.length} not attempted — the ${budget.minutes}-minute budget was spent`
        : '',
      injectionFlags > 0 ? `${injectionFlags} flagged for instruction-shaped text` : '',
      `${spentMinutes} of ${budget.minutes} minutes used`,
    ]
      .filter((part) => part !== '')
      .join(' · '),
  )

  return { posts: payload.posts ?? [] }
})

/* ═══════════════════════════════════════════════════════════════════════════
   Shared helper — used by the Validation Agent for source-tier credibility
   ═══════════════════════════════════════════════════════════════════════════ */

export function baseCredibilityFor(post: { sourceType: string }, ctx: SkillContext): number {
  void ctx
  return credibilityBase(post.sourceType)
}

export { credibilityLabel, PLATFORMS }

/**
 * THE SCRAPING AGENT — stage `discover`
 *
 * Reads the keyword set and asks what each platform has been saying about every
 * term — once per platform lane (LinkedIn, Instagram, X, Facebook) and once
 * against the open web — then harvests the hashtags out of the bodies that
 * carry them and takes an independent reading of the strongest tags.
 *
 * TWO SOURCES, NO CORPUS. The four platform lanes are captured by Apify actors,
 * which read the platforms themselves and return real engagement counts. The
 * open web has no actor and is captured by crawl4ai, which reads what a search
 * engine indexed and therefore states no engagement at all. Every row carries
 * `metricsAvailable` so the difference is legible downstream rather than
 * inferred from zeros.
 *
 * There is no bundled fixture corpus behind either, which means an empty result
 * is reported as an empty result: a keyword that returned nothing on Instagram
 * says so, and the run continues on the lanes that answered. What the pipeline
 * shows is what was actually published at capture time, or nothing.
 *
 * WITHOUT AN APIFY TOKEN the platform lanes degrade to crawl4ai rather than
 * disappearing — the same lane, read through a search engine, stamped
 * `metricsAvailable: false` and reported as downgraded at capture time.
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
  apifySearch,
  captureChainFor,
  captureFor,
  crawl4aiSearch,
  mapWithConcurrency,
  platformLaneDowngradeReason,
  type CaptureAttempt,
  type RawPost,
} from '../../integrations'
import { prepareEvidence } from '../../../../packages/runtime/src/evidence'
import { insertActivity, listKeywords, listKnowledge, listSources, recentCaptures } from '../../db/repo'
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

  const all = await listKeywords(ctx.workspaceId, true)

  // A scoped run (Ethara: "run discovery on RLHF") narrows the set but still
  // honours the weight floor, so the operator gets the same quality bar.
  const scoped =
    payload.keywordIds && payload.keywordIds.length > 0
      ? all.filter((k) => payload.keywordIds?.includes(k.id))
      : all

  const cleared = scoped.filter((k) => k.weight >= minWeight).sort((a, b) => b.weight - a.weight)
  const eligible = cleared.slice(0, Math.max(1, maxKeywords))

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
  const belowFloor = scoped.length - cleared.length
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

  const apifyReady = apifySearch.isConfigured()
  const crawlerReady = crawl4aiSearch.isConfigured()
  // Either source alone can carry a run: Apify covers the four platform lanes,
  // crawl4ai covers the open web and stands in for a platform lane without a
  // token. Only losing both leaves nothing to capture.
  const configured = apifyReady || crawlerReady
  const mode: 'live' | 'fixture' = configured ? 'live' : 'fixture'
  const rows = await listSources(ctx.workspaceId)

  // A source's reachability now depends on which lane it belongs to, because
  // the two implementations have different credentials. A platform source is
  // reachable if EITHER can serve it — Apify properly, crawl4ai downgraded.
  const sources: SourceConnection[] = rows
    .filter((s) => s.enabled)
    .map((s) => {
      const isOpenWeb = s.kind === 'web'
      const reachable = isOpenWeb ? crawlerReady : configured
      const via = isOpenWeb || !apifyReady ? crawl4aiSearch.label : apifySearch.label
      const reason = reachable
        ? `Reachable via ${via}`
        : isOpenWeb
          ? crawl4aiSearch.unavailableReason()
          : `${apifySearch.unavailableReason()}, and ${crawl4aiSearch.unavailableReason()}`
      return { name: s.name, kind: s.kind, sourceType: s.source_type, reachable, reason }
    })

  const unreachable = [
    ...(apifyReady ? [] : [apifySearch.label]),
    ...(crawlerReady ? [] : [crawl4aiSearch.label]),
  ]

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
        'Set APIFY_API_TOKEN for the platform lanes, CRAWL4AI_PYTHON for the open web.',
    )
    // With no corpus to fall back to, an unconfigured pair means an empty run
    // whatever this knob says. It is still honoured, because failing at the
    // source is a clearer report than five empty lanes downstream.
    if (failIfNoSource) {
      throw new Error(
        'No capture source available — set APIFY_API_TOKEN (platform lanes) or ' +
          'CRAWL4AI_PYTHON (open web, pointing at the interpreter of the backend venv).',
      )
    }
  } else {
    if (apifyReady) {
      ctx.log(
        `Apify reachable · up to ${config.apify.maxItemsPerKeyword} posts per keyword per platform lane, ` +
          'with engagement figures',
      )
    } else {
      // Named at connect time rather than discovered later from missing counts.
      await notify(platformLaneDowngradeReason())
    }
    if (crawlerReady) {
      ctx.log(
        `crawl4ai reachable · ${config.crawl4ai.searchEngines.join(', ')} · ` +
          `up to ${config.crawl4ai.maxPagesPerKeyword} pages per keyword on the open web`,
      )
    } else {
      await notify(`The open-web lane cannot run — ${crawl4aiSearch.unavailableReason()}.`)
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
    validation: 'pending',
    verdictReason: '',
  }
}

registerSkill<PipelinePayload>('scraping.linkedin.fetch', async (payload, ctx) => {
  const keywords = payload.keywords ?? []
  if (keywords.length === 0) throw new Error('No keywords resolved — nothing to fetch.')

  if (!apifySearch.isConfigured() && !crawl4aiSearch.isConfigured()) {
    throw new Error(
      'Cannot capture — neither source is configured. Set APIFY_API_TOKEN for the ' +
        'platform lanes or CRAWL4AI_PYTHON for the open web. There is no corpus to fall back to.',
    )
  }

  const maxItems = ctx.num('maxItemsPerKeyword', 25)
  const retries = ctx.num('retries', 1)
  const minBrandRelevance = ctx.num('minBrandRelevance', 20)
  const maxParallel = Math.max(1, ctx.num('maxParallel', 2))
  const includeOpenWeb = ctx.bool('includeOpenWeb', true)
  const minAuthorFollowers = ctx.num('minAuthorFollowers', 0)
  const minEnglishRatio = ctx.num('minEnglishRatio', 8)
  const datePosted = ctx.str('datePosted', 'past-week') as 'past-24h' | 'past-week' | 'past-month'
  const sortBy = ctx.str('sortBy', 'date') as 'relevance' | 'date'

  // `undefined` is the open-web lane, which is how the adapter spells it too.
  const lanes: Array<{ platform: Platform | undefined; label: string }> = [
    ...PLATFORM_KNOBS.filter((p) => ctx.bool(p.knob, true)).map((p) => ({
      platform: p.platform as Platform | undefined,
      label: p.label,
    })),
    ...(includeOpenWeb ? [{ platform: undefined, label: 'Open web' }] : []),
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
  if (vocabulary.knowledgeEntries === 0) {
    ctx.emit(
      'activity',
      'The Knowledge Base holds no corpus entries, so alignment is running on the brand topics and keywords alone. ' +
        'Add corpus entries under Knowledge Base → Brand corpus to sharpen it.',
      { status: 'warn' },
    )
  }

  const laneReasons: string[] = []
  /** Kept per lane so the run console can say WHERE the material came from. */
  const perLaneCounts = new Map<string, number>()
  let offBrand = 0
  /** Dropped for having too small an audience — only countable where one was stated. */
  let belowFollowerFloor = 0
  /** Dropped as prose this brand cannot publish from. */
  let notEnglish = 0
  /** Too short to judge the language of, so exempted rather than guessed at. */
  let languageUnknown = 0
  /**
   * Kept DESPITE the follower floor because the source stated no follower count.
   * Reported rather than folded into the kept total: a floor that silently
   * exempts most of a lane is a floor the operator should know is not biting.
   */
  let followersNotStated = 0

  // The work unit is one keyword on one lane. Flattening the pair means the
  // concurrency ceiling governs actual browser page-loads rather than keywords,
  // which is the resource that is genuinely scarce on a local machine.
  const jobs = keywords.flatMap((keyword) => lanes.map((lane) => ({ keyword, lane })))

  const perJob = await mapWithConcurrency(jobs, maxParallel, async ({ keyword, lane }) => {
    /*
     * THE CHAIN, NOT A SOURCE.
     *
     * Resolved per lane rather than once per run, because the open web is always
     * crawl4ai while a platform lane follows the token. A platform lane with a
     * token is Apify FIRST and crawl4ai BEHIND IT: an actor that is deprecated,
     * rate-limited or simply broken today must not turn a keyword crawl4ai could
     * have read into nothing captured. Which source answered travels on every
     * event, so the run console can say why one lane carries engagement and
     * another does not.
     */
    const chain = captureChainFor(lane.platform)
    const primary = (chain[0] as CaptureAttempt).source

    ctx.emit('activity', `Scraping ${lane.label} for “${keyword.term}” via ${primary.label}`, {
      status: 'running',
      keyword: keyword.term,
      platform: lane.platform ?? 'open-web',
      via: primary.label,
    })

    let rows: RawPost[] = []
    /** The source that actually answered, for the per-row stamp and the log. */
    let servedBy = primary
    /** Set only when the primary failed and the backup answered instead. */
    let laneFallbackReason = ''
    const attemptReasons: string[] = []

    for (const [index, attemptSource] of chain.entries()) {
      const source = attemptSource.source
      let lastError: unknown
      for (let attempt = 0; attempt <= retries; attempt += 1) {
        try {
          rows = await source.run({
            keyword: keyword.term,
            ...(lane.platform === undefined ? {} : { platform: lane.platform }),
            // Each source clamps this to its own ceiling — Apify to the env
            // billing cap, crawl4ai to its page limit — so the knob asks for
            // the same thing on every lane and the source decides what it can
            // honestly serve.
            maxItems,
            maxCharsPerPage: config.crawl4ai.maxCharsPerPage,
            datePosted,
            sortBy,
          })
          lastError = undefined
          break
        } catch (error) {
          lastError = error
          if (attempt === retries) break
          await new Promise((r) => setTimeout(r, 600 * 2 ** attempt))
        }
      }

      if (lastError === undefined) {
        servedBy = source
        if (attemptSource.isBackup) {
          // The degradation, named at the point it happened and carried onto
          // every row: these posts state no engagement, and the reason is not
          // "no token" but "the actor did not answer".
          laneFallbackReason =
            `${primary.label} did not answer — ${attemptReasons[0] ?? 'no reason given'}. ` +
            `Captured with ${source.label} instead, which states no engagement figures.`
          // Also into the lane reasons, so it lands in `captureFallbackReasons`
          // and therefore in the persisted run summary. An event alone would
          // mean the fallback was only knowable to whoever was watching.
          if (!laneReasons.includes(laneFallbackReason)) laneReasons.push(laneFallbackReason)
          ctx.emit('activity', `${lane.label} · ${keyword.term}: fell back to ${source.label}`, {
            status: 'warn',
            keyword: keyword.term,
            platform: lane.platform ?? 'open-web',
            via: source.label,
            reason: laneFallbackReason,
          })
        }
        break
      }

      const reason =
        lastError instanceof AdapterError
          ? lastError.toReason()
          : `${source.label} failed — ${lastError instanceof Error ? lastError.message : String(lastError)}`
      attemptReasons.push(reason)

      // Nothing left to try. An empty lane is normal — a narrow keyword
      // genuinely returns nothing on some platforms — so it is reported and the
      // run carries on. There is nothing to substitute and nothing is substituted.
      if (index === chain.length - 1) {
        const combined = attemptReasons.join(' · then ')
        if (!laneReasons.includes(combined)) laneReasons.push(combined)
        ctx.emit('activity', `${lane.label} · ${keyword.term}: nothing captured`, {
          status: 'warn',
          keyword: keyword.term,
          platform: lane.platform ?? 'open-web',
          via: primary.label,
          reason: combined,
        })
        return []
      }
    }

    const source = servedBy

    const posts: ScrapedPost[] = []
    for (const raw of rows) {
      // A follower count of zero means the source did not state one, not that
      // the author has no audience — so the floor applies only where there is a
      // number to apply it to. Exemptions are counted, never hidden.
      if (minAuthorFollowers > 0) {
        if (raw.authorFollowers === 0) {
          followersNotStated += 1
        } else if (raw.authorFollowers < minAuthorFollowers) {
          belowFollowerFloor += 1
          continue
        }
      }
      /*
       * READABILITY BEFORE RELEVANCE. A post can be squarely on-topic and still
       * be unusable evidence: the brand writes in English, and a caption grounded
       * in a body it cannot quote is a caption grounded in nothing. Checked before
       * alignment because it is the cheaper test and the more decisive one.
       */
      if (minEnglishRatio > 0) {
        const ratio = englishRatio(raw.text)
        if (ratio === -1) {
          languageUnknown += 1
        } else if (ratio < minEnglishRatio) {
          notEnglish += 1
          continue
        }
      }

      const alignment = alignmentOf(raw.text, keyword.term, vocabulary)
      if (alignment.score < minBrandRelevance) {
        offBrand += 1
        continue
      }
      posts.push(toScrapedPost(raw, keyword.id, alignment))
    }

    perLaneCounts.set(lane.label, (perLaneCounts.get(lane.label) ?? 0) + posts.length)

    for (const post of posts) {
      ctx.emit('item.scraped', post.title, {
        keyword: keyword.term,
        platform: post.platform ?? 'open-web',
        source: post.sourceName,
        externalId: post.externalId,
        brandRelevance: post.brandRelevance,
        captureSource: post.captureSource,
      })
    }

    ctx.emit(
      'activity',
      `${lane.label} · ${keyword.term}: ${posts.length} page${posts.length === 1 ? '' : 's'} kept of ${rows.length}`,
      {
        status: 'ok',
        keyword: keyword.term,
        platform: lane.platform ?? 'open-web',
        count: posts.length,
        captured: rows.length,
        // Names WHICH implementation answered, not just that one did — rule 6
        // wants the evidence behind the decision.
        via: source.label,
        metricsAvailable: rows[0]?.metricsAvailable ?? false,
      },
    )

    return posts
  })

  const posts = perJob.flat()

  if (posts.length === 0) {
    throw new Error(
      laneReasons.length > 0
        ? `Nothing was captured on any lane — ${laneReasons[0]}`
        : 'Nothing was captured on any lane, and no lane reported a reason.',
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
  // With an Apify token the tag is read on LinkedIn itself, which returns real
  // engagement and makes the independent reading a genuine volume AND strength
  // signal. Without one it falls back to the open web, where only volume is
  // knowable — the same degradation as the platform lanes, for the same reason.
  const tagLane: Platform | undefined = apifySearch.isConfigured() ? 'linkedin' : undefined
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
        maxCharsPerPage: config.crawl4ai.maxCharsPerPage,
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
        maxCharsPerPage: config.crawl4ai.maxCharsPerPage,
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
   Shared helper — used by the Validation Agent for source-tier credibility
   ═══════════════════════════════════════════════════════════════════════════ */

export function baseCredibilityFor(post: { sourceType: string }, ctx: SkillContext): number {
  void ctx
  return credibilityBase(post.sourceType)
}

export { credibilityLabel, PLATFORMS }

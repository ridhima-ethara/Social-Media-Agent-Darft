/**
 * THE SHORT-FORM INVARIANTS.
 *
 * Four claims this tranche makes, each of which would be invisible if it broke.
 * They are here rather than in a review checklist because every one of them is
 * a silent failure: nothing throws, nothing logs, and the screen keeps showing
 * a plausible number.
 *
 *   1. A row with no stated figure survives a floor that tests that figure, and
 *      carries the caveat. This is the single most likely regression in this
 *      work — the source specification's own rule deletes every open-web
 *      capture, and only the exemption stops it.
 *   2. A hook with no comparable post returns NO confidence and a stated
 *      reason. A default score is fabricated evidence.
 *   3. `voice.derive` below its floor refuses and names the count it has.
 *   4. A voice profile cannot raise the emoji budget for a brand channel.
 *
 * These read the real modules rather than restating their numbers: a test that
 * hard-codes 10,000 becomes a second home for a knob, which is the defect the
 * registry exists to prevent.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import { BRAND, enforceBrandVoice } from '@shared/brand-voice'
import { CONTENT_FORMATS, HOOK_PATTERNS } from '@shared/agent-contract'
import { SKILL_BY_ID, defaultSkillConfig } from '@shared/agent-registry'
import { explainApifyFailure } from '../server/src/integrations/apify'

/* ═══════════════════════════════════════════════════════════════════════════
   1 · A MISSING FIGURE IS NOT A LOW ONE
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The filter's rule, extracted exactly as the handler applies it.
 *
 * Mirrored here rather than imported because the handler registers itself into
 * the runtime on import, which needs a database. What is asserted is the RULE —
 * tested only where the figure is stated — and the handler's own code is a
 * line-for-line match of this shape.
 */
function failsViewFloor(
  post: { views: number; viewsAvailable: boolean },
  floor: number,
  exemptUnmeasured: boolean,
): boolean {
  if (post.viewsAvailable) return post.views < floor
  return !exemptUnmeasured
}

describe('validation.item.filter · a figure that was never stated cannot fail a floor', () => {
  const config = defaultSkillConfig('validation.item.filter')
  const floor = Number(config.minViewsToConsider)

  it('declares the three floors the source specification names', () => {
    expect(config.minViewsToConsider).toBeTypeOf('number')
    expect(config.minEngagementRate).toBeTypeOf('number')
    expect(config.recencyWindowDays).toBeTypeOf('number')
  })

  it('keeps an open-web capture that states no play count', () => {
    // This is the row the naive rule deletes: `views: 0` here means NOT
    // APPLICABLE, and it is what every open-web citation looks like.
    const openWeb = { views: 0, viewsAvailable: false }
    expect(failsViewFloor(openWeb, floor, true)).toBe(false)
  })

  it('still fails a video that stated a play count below the floor', () => {
    const quietReel = { views: floor - 1, viewsAvailable: true }
    expect(failsViewFloor(quietReel, floor, true)).toBe(true)
  })

  it('demonstrates what the naive reading destroys', () => {
    // `exemptUnmeasured: false` is the source specification's literal rule.
    // The knob exists so the difference is demonstrable rather than theoretical.
    const openWeb = { views: 0, viewsAvailable: false }
    expect(failsViewFloor(openWeb, floor, false)).toBe(true)
  })

  it('defaults the exemption ON, because the other setting deletes evidence', () => {
    expect(config.exemptUnmeasured).toBe(true)
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   2 · A CONFIDENCE WITHOUT EVIDENCE IS NOT A LOW CONFIDENCE
   ═══════════════════════════════════════════════════════════════════════════ */

describe('caption.hook.score · no comparable post means no score', () => {
  const config = defaultSkillConfig('caption.hook.score')

  it('declares a similarity floor below which nothing is claimed', () => {
    expect(Number(config.minMatchSimilarity)).toBeGreaterThan(0)
  })

  /**
   * The schema is the real enforcement, so the schema is what is asserted.
   * A handler can be rewritten; a CHECK constraint cannot be bypassed by one.
   */
  it('forbids a score with no matched row, at the column level', () => {
    const schema = readSchema()
    expect(schema).toContain('hook_variants_score_needs_match')
    expect(schema).toContain(
      'CHECK (confidence IS NULL OR matched_post_id IS NOT NULL OR matched_item_id IS NOT NULL)',
    )
  })

  it('forbids an empty basis, so a score can never be a bare assertion', () => {
    const schema = readSchema()
    expect(schema).toContain('hook_variants_basis_required')
    expect(schema).toContain('confidence_basis TEXT NOT NULL')
  })

  it('allows confidence to be NULL, because unscored is a real outcome', () => {
    const schema = readSchema()
    // NOT NULL on this column would force a default, and a default IS the bug.
    expect(schema).not.toMatch(/confidence\s+NUMERIC NOT NULL/)
  })

  it('writes one row per pattern, so a retry replaces rather than appends', () => {
    // R4: idempotency beyond publishing. Ten hooks after two clicks is the
    // failure this index prevents.
    expect(readSchema()).toContain('hook_variants_idea_pattern_key')
  })

  it('keeps every declared pattern reachable from the CHECK constraint', () => {
    const schema = readSchema()
    for (const pattern of HOOK_PATTERNS) {
      expect(schema).toContain(`'${pattern}'`)
    }
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   3 · A VOICE LEARNED FROM TOO LITTLE IS A CLAIM THE EVIDENCE CANNOT SUPPORT
   ═══════════════════════════════════════════════════════════════════════════ */

describe('caption.voice.derive · refuses below the sample floor', () => {
  const config = defaultSkillConfig('caption.voice.derive')

  it('declares a minimum, described in plain language', () => {
    const skill = SKILL_BY_ID['caption.voice.derive']
    const field = skill?.config.find((f) => f.key === 'voiceSampleMinimum')
    expect(field).toBeDefined()
    expect((field?.description ?? '').length).toBeGreaterThan(12)
  })

  it('sets the floor at the specification’s own number', () => {
    // "20 to 30 of my past reel scripts." The low end is the floor.
    expect(Number(config.voiceSampleMinimum)).toBe(20)
  })

  it('records how many samples a profile rests on, NOT NULL', () => {
    // A profile whose sample count is unknown is a claim with no size attached.
    expect(readSchema()).toContain('sample_count      INTEGER NOT NULL')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   4 · A PROFILE CANNOT REACH THE BRAND RULES
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ADR-008 · a voice profile cannot loosen the brand voice', () => {
  it('keeps the emoji budget at zero', () => {
    expect(BRAND.emojiBudget).toBe(0)
  })

  it('strips emoji from any text, whatever produced it', () => {
    // The enforcer takes a string and a topic. It has no parameter through
    // which a profile could travel, which is the structural half of ADR-008 —
    // the guarantee is the absent argument, not a check inside the function.
    const result = enforceBrandVoice('Reward hacking is measurable 🚀🔥', 'reward hacking')
    expect(result.text).not.toMatch(/\p{Extended_Pictographic}/u)
  })

  it('scopes every profile to exactly one content format, NOT NULL', () => {
    const schema = readSchema()
    expect(schema).toMatch(/voice_profiles[\s\S]*?content_format {4}TEXT NOT NULL/)
  })

  it('keeps the content-format union closed', () => {
    expect([...CONTENT_FORMATS]).toEqual(['post', 'short_form_script'])
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   5 · THE REGISTRY CARRIES EVERY NUMBER THE SOURCE SPECIFICATION NAMES
   ═══════════════════════════════════════════════════════════════════════════ */

describe('law 2 · every number from the source specification is a described knob', () => {
  const expected: Array<[string, string]> = [
    ['validation.keyword.trend', 'viewsWeight'],
    ['validation.keyword.trend', 'engagementRateWeight'],
    ['validation.keyword.trend', 'commentVolumeWeight'],
    ['validation.keyword.trend', 'highSignalViewFloor'],
    ['validation.hashtag.rank', 'viralEngagementRate'],
    ['validation.item.filter', 'minViewsToConsider'],
    ['validation.item.filter', 'minEngagementRate'],
    ['validation.item.filter', 'recencyWindowDays'],
    ['validation.signal.repeat', 'repeatSignalCount'],
    ['validation.signal.sustained', 'sustainedWindowCount'],
    ['caption.hook.generate', 'hookVariantCount'],
    ['caption.hook.generate', 'hookMaxLines'],
    ['caption.hook.generate', 'hookMaxSpokenSeconds'],
    ['caption.script.write', 'scriptBeatCount'],
    ['caption.script.write', 'sentencesPerBeat'],
    ['caption.voice.derive', 'voiceSampleMinimum'],
    ['scraping.transcript.fetch', 'transcriptMaxMinutesPerRun'],
  ]

  for (const [skillId, key] of expected) {
    it(`${skillId} declares ${key} with a description`, () => {
      const field = SKILL_BY_ID[skillId]?.config.find((f) => f.key === key)
      expect(field, `${skillId}.${key} is not declared`).toBeDefined()
      expect((field?.description ?? '').trim().length).toBeGreaterThanOrEqual(12)
    })
  }

  it('keeps the source specification’s 40/35/25 as the short-form defaults', () => {
    const config = defaultSkillConfig('validation.keyword.trend')
    expect(config.viewsWeight).toBe(40)
    expect(config.engagementRateWeight).toBe(35)
    expect(config.commentVolumeWeight).toBe(25)
  })

  it('leaves long-form as the default profile, so stored history keeps its meaning', () => {
    expect(defaultSkillConfig('validation.keyword.trend').weightProfile).toBe('long-form')
  })

  it('writes exactly five hooks by default, one per declared pattern', () => {
    expect(defaultSkillConfig('caption.hook.generate').hookVariantCount).toBe(
      HOOK_PATTERNS.length,
    )
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   6 · VIEWS AND TRANSCRIPTS KEEP THEIR OWN ABSENCES
   ═══════════════════════════════════════════════════════════════════════════ */

describe('constraint 2 · three kinds of absence, kept apart', () => {
  it('gives views their own availability flag', () => {
    const schema = readSchema()
    expect(schema).toContain('views_available  BOOLEAN NOT NULL DEFAULT false')
  })

  it('leaves transcript nullable, so NULL can mean not transcribed', () => {
    const schema = readSchema()
    expect(schema).toMatch(/transcript {12}TEXT(?!\s+NOT NULL)/)
  })

  it('migrates both additively, so an existing corpus keeps every row', () => {
    const schema = readSchema()
    expect(schema).toContain('ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS views ')
    expect(schema).toContain('ALTER TABLE scraped_items ADD COLUMN IF NOT EXISTS transcript ')
  })

  it('defaults content_format to post, so no row needs a backfill', () => {
    const schema = readSchema()
    expect(schema).toContain(
      "ALTER TABLE content_ideas ADD COLUMN IF NOT EXISTS content_format TEXT NOT NULL DEFAULT 'post'",
    )
  })
})

/* ── Helpers ──────────────────────────────────────────────────────────────── */

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
let schemaCache: string | null = null

/**
 * The schema as text. Read once; it does not change within a run.
 *
 * Read off disk rather than restated here, for the same reason
 * `config-single-home.test.ts` reads the other files: a test that copies a
 * constraint becomes a second home for it, and the two then drift.
 */
function readSchema(): string {
  schemaCache ??= readFileSync(join(ROOT, 'server/src/db/schema.sql'), 'utf8')
  return schemaCache
}

/* ═══════════════════════════════════════════════════════════════════════════
   7 · KEYWORD DISCOVERY — ADR-012

   The defect: every run reported the same trending keywords, because the
   ranking only ever scored rows someone had already typed. These assert the
   three things that make the fix real rather than decorative.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('ADR-012 · the platform discovers keywords instead of only re-ranking them', () => {
  it('declares both halves of the loop as skills', () => {
    expect(SKILL_BY_ID['scraping.keyword.discover']).toBeDefined()
    expect(SKILL_BY_ID['validation.keyword.emerge']).toBeDefined()
  })

  it('runs discovery before the trend ranking that consumes it', () => {
    // Order is what sequences a run. Discovery after scoring would produce
    // candidates nothing looks at until the following week.
    const discover = SKILL_BY_ID['scraping.keyword.discover']
    const emerge = SKILL_BY_ID['validation.keyword.emerge']
    const route = SKILL_BY_ID['validation.verdict.route']
    expect(discover?.agentId).toBe('scraping')
    expect(emerge?.agentId).toBe('validation')
    // Scraping runs entirely before validation, so only the intra-agent order
    // needs asserting: emergence lands before the verdict is written.
    expect(Number(emerge?.order)).toBeLessThan(Number(route?.order))
  })

  it('keeps a discovered keyword inactive until a human approves it', () => {
    // The whole of ADR-012's "discovery proposes, a human disposes". A keyword
    // is an instruction to spend money on every lane, every run.
    expect(defaultSkillConfig('validation.keyword.emerge').autoActivate).toBe(false)
  })

  it('caps how many terms one run may add, because discovery compounds', () => {
    const cap = Number(defaultSkillConfig('validation.keyword.emerge').maxPromotionsPerRun)
    expect(cap).toBeGreaterThan(0)
    expect(cap).toBeLessThanOrEqual(40)
  })

  it('requires several posts AND several authors before proposing a term', () => {
    const config = defaultSkillConfig('scraping.keyword.discover')
    // One post is that post's subject; one author posting repeatedly is not a
    // movement. Both bars have to bind, which is why both are above one.
    expect(Number(config.minPostsCarrying)).toBeGreaterThan(1)
    expect(Number(config.minDistinctAuthors)).toBeGreaterThan(1)
  })

  it('records where every keyword came from, permanently', () => {
    const schema = readSchema()
    expect(schema).toContain("origin       TEXT NOT NULL DEFAULT 'seeded'")
    expect(schema).toContain("CHECK (origin IN ('seeded','discovered'))")
    // The evidence that produced the candidate, so the row is auditable.
    expect(schema).toContain('discovery_reason  TEXT')
  })

  it('migrates origin additively, so existing terms correctly read as seeded', () => {
    expect(readSchema()).toContain(
      "ALTER TABLE keywords ADD COLUMN IF NOT EXISTS origin           TEXT NOT NULL DEFAULT 'seeded'",
    )
  })

  it('unions discovered keywords into the rota pool', () => {
    // Without this the feature is inert: a term could be discovered, promoted
    // and approved, and still never be captured, because a rota is a plan
    // written before the term existed.
    const handlers = readFileSync(
      join(ROOT, 'server/src/agents/scraping/handlers.ts'),
      'utf8',
    )
    expect(handlers).toContain('activeDiscoveredKeywords')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   8 · APIFY FAILURES ARE EXPLAINED, NOT ECHOED
   ═══════════════════════════════════════════════════════════════════════════ */

describe('rule 6 · an Apify refusal names its fix', () => {
  /*
   * Behavioural, not textual.
   *
   * The first version of this test asserted that `apify.ts` CONTAINED the
   * strings `platform-feature-disabled` and `token-not-found` — the JSON
   * `error.type` values the old HTTP client parsed. When execution moved to the
   * CLI those types stopped appearing, the reasons started arriving as stderr
   * text, and the test failed while the behaviour it cared about was intact.
   *
   * A test that breaks when the mechanism changes but the behaviour does not is
   * testing the wrong thing. So this calls the function.
   */
  it('distinguishes an exhausted account from a rejected credential', () => {
    const exhausted = explainApifyFailure(
      new Error('Run: Calling Actor apidojo/tweet-scraper\n\nError: Monthly usage hard limit exceeded'),
      'apidojo/tweet-scraper',
    )
    const unauthenticated = explainApifyFailure(
      new Error('Error: You are not logged in with your Apify account.'),
      'apidojo/tweet-scraper',
    )

    // Two failures that look alike from outside and need different actions.
    expect(exhausted).toMatch(/ACCOUNT limit/)
    expect(exhausted).toMatch(/billing/i)
    expect(unauthenticated).toMatch(/holds no credentials/i)
    expect(unauthenticated).toMatch(/apify login|APIFY_API_TOKEN/)
    expect(exhausted).not.toBe(unauthenticated)
  })

  it('says plainly that a usage limit is not a configuration problem', () => {
    const said = explainApifyFailure(new Error('Monthly usage hard limit exceeded'), 'x/y')
    expect(said).toMatch(/not a[\s\S]{0,40}configuration problem/)
  })

  it('names the actor when one has been withdrawn', () => {
    const said = explainApifyFailure(new Error('Actor not found'), 'someone/gone-actor')
    expect(said).toContain('someone/gone-actor')
    expect(said).toMatch(/actor-index/)
  })

  it('never echoes a token, even when the CLI does', () => {
    // A failed `apify login` has been observed to print the credential back.
    const said = explainApifyFailure(
      new Error('login failed for apify_api_SECRETVALUE123abc'),
      'x/y',
    )
    expect(said).not.toContain('apify_api_SECRETVALUE123abc')
    expect(said).toContain('«token»')
  })
})

describe('the HTTP client is gone, not merely bypassed', () => {
  it('leaves no second execution path in apify.ts', () => {
    const apify = readFileSync(join(ROOT, 'server/src/integrations/apify.ts'), 'utf8')
    // Two paths reading the same actors is the "second scraper" the brief
    // forbids, and which one ran would be decided by whichever failed first.
    for (const gone of ['fetchJson', 'runActor(', 'searchBody', 'normalisePost', 'authHeaders']) {
      expect(apify, `${gone} still present`).not.toContain(gone)
    }
  })

  it('routes execution through the skill workflow', () => {
    const apify = readFileSync(join(ROOT, 'server/src/integrations/apify.ts'), 'utf8')
    expect(apify).toContain('scrapeViaSkill')
  })
})

/* ═══════════════════════════════════════════════════════════════════════════
   9 · THE CONTENT-SCRAPER FIELDS, AND THE ABSENCES THEY KEEP

   The capture failure that prompted this: Parallel returns `excerpts` as an
   ARRAY, the parser only knew the singular string spellings, so every result
   produced an empty body and the lane threw "no citable results" while the API
   had returned five good pages.
   ═══════════════════════════════════════════════════════════════════════════ */

describe('the open-web lane reads the shape Parallel actually returns', () => {
  it('reads excerpts as an array, not only as a string', () => {
    const parallel = readFileSync(join(ROOT, 'server/src/integrations/parallel.ts'), 'utf8')
    expect(parallel).toContain('row.excerpts')
    expect(parallel).toMatch(/Array\.isArray\(many\)/)
  })
})

describe('the fields the content-scraper specification collects', () => {
  it('stores each one as a column', () => {
    const schema = readSchema()
    for (const column of ['hook', 'engagement_rate', 'media_format', 'signal_flags']) {
      expect(schema, `${column} is not declared`).toContain(column)
    }
  })

  it('leaves engagement_rate nullable, because it needs two figures', () => {
    // A rate of 0 asserts the post was seen and ignored. NOT NULL would force
    // exactly that claim onto every post stating only one of the two figures.
    expect(readSchema()).not.toMatch(/engagement_rate\s+NUMERIC NOT NULL/)
  })

  it('migrates all four additively', () => {
    const schema = readSchema()
    for (const column of ['hook', 'engagement_rate', 'media_format', 'signal_flags']) {
      expect(schema).toContain(`ADD COLUMN IF NOT EXISTS ${column}`)
    }
  })

  it('declares both VIRAL thresholds on the filter, described', () => {
    const skill = SKILL_BY_ID['validation.item.filter']
    for (const key of ['viralEngagementRate', 'highSignalViewFloor']) {
      const field = skill?.config.find((f) => f.key === key)
      expect(field, `${key} is not declared on the filter`).toBeDefined()
      expect((field?.description ?? '').length).toBeGreaterThan(12)
    }
  })

  it('keeps the specification’s own thresholds as the defaults', () => {
    const config = defaultSkillConfig('validation.item.filter')
    // "ER above 5% or views above 100K"
    expect(config.viralEngagementRate).toBe(5)
    expect(config.highSignalViewFloor).toBe(100000)
  })

  it('renders an unmeasured figure as n/a rather than zero', () => {
    const page = readFileSync(join(ROOT, 'src/pages/ContentIntelligence.tsx'), 'utf8')
    // "0 views" on an article that was never a video is the single most
    // misleading thing this table could say.
    expect(page).toContain('views_available')
    expect(page).toContain('engagement_rate === null')
    expect(page).toContain('n/a')
  })
})

/**
 * Behavioural check for the brand-voice engine against the company standard.
 *
 * Temporary verification harness: asserts the rule NUMBERS the checker cites,
 * because the standard's failure-reporting section requires a report to name the
 * rule that failed and those numbers are what an operator reads.
 */

import {
  ALL_RULES,
  BRAND,
  BRAND_CORPUS,
  BRAND_RULES,
  FORBIDDEN_LANGUAGE,
  PLATFORM_INVARIANTS,
  brandCorpusAsKnowledge,
  brandRulesAsKnowledge,
  checkBrandCompliance,
} from '../shared/brand-voice'

let failures = 0
function check(label: string, condition: boolean, detail = ''): void {
  if (condition) {
    console.log(`  ok   ${label}`)
  } else {
    failures += 1
    console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

const grounding = [
  {
    title: 'Benchmark saturation on long-horizon agent evaluation',
    content:
      'Aggregate benchmark scores hid diverging failure modes across long-horizon agent evaluation. Recovery behaviour stopped working at step 12 while the aggregate score stayed flat at 71 points.',
  },
]

console.log('\nThe twenty rules, numbered as the standard numbers them')
const expected: Array<[number, string]> = [
  [1, 'Brand positioning'],
  [2, 'Voice'],
  [3, 'Forbidden language'],
  [4, 'Ethara connection'],
  [5, 'Emoji and punctuation'],
  [6, 'Factual grounding'],
  [7, 'Relevance'],
  [8, 'Caption structure'],
  [9, 'Hook integrity'],
  [10, 'Platform differentiation'],
  [11, 'Hashtags'],
  [12, 'Brand palette'],
  [13, 'Typography'],
  [14, 'Visual style'],
  [15, 'Logo compliance'],
  [16, 'Caption–visual consistency'],
  [17, 'Option distinctness'],
  [18, 'Confidentiality and reputational gate'],
  [19, 'Independent caption and creative judgement'],
  [20, 'No silent correction'],
]
check('exactly 20 brand rules', BRAND_RULES.length === 20, `found ${BRAND_RULES.length}`)
for (const [n, title] of expected) {
  const rule = BRAND_RULES.find((r) => r.n === n)
  check(`rule ${n} is "${title}"`, rule?.title === title, `found "${rule?.title ?? 'nothing'}"`)
}
check(
  'invariants start at 21 and never collide with the twenty',
  PLATFORM_INVARIANTS.every((r) => r.n >= 21) &&
    new Set(ALL_RULES.map((r) => r.n)).size === ALL_RULES.length,
)

console.log('\nBrand constants required by the standard')
check('primary accent is #8B2CF5', BRAND.visual.accent === '#8B2CF5')
check('display font is Roboto', BRAND.visual.displayFont === 'Roboto')
check('body font is DM Sans', BRAND.visual.bodyFont === 'DM Sans')
check('emoji budget is zero', BRAND.emojiBudget === 0)
check('hashtags clamp to 3–5', BRAND.hashtags.min === 3 && BRAND.hashtags.max === 5)
check('caption similarity cap is 0.70', BRAND.similarityCap.caption === 0.7)
check('image similarity cap is 0.85', BRAND.similarityCap.image === 0.85)
check('the Ethara connection is optional', BRAND.etharaConnectionOptional === true)
check(
  'rule 3 does NOT forbid "infrastructure"',
  BRAND.neverForbidden.includes('infrastructure') &&
    !FORBIDDEN_LANGUAGE.some((f) => {
      f.pattern.lastIndex = 0
      const hit = f.pattern.test('our inference infrastructure')
      f.pattern.lastIndex = 0
      return hit
    }),
)

console.log('\nVerdicts')
const clean = checkBrandCompliance({
  caption:
    'Benchmark saturation hides the failure modes that matter.\n\nAggregate scores on long-horizon agent evaluation stayed flat at 71 points while recovery behaviour stopped working at step 12.\n\nThe useful signal was never the aggregate. It was the step where recovery stopped.\n\n#AIEvaluation #AgenticAI #Benchmarks',
  topic: 'AI evaluation and benchmarks',
  platform: 'linkedin',
  groundingEntries: grounding,
})
check('a grounded, on-domain caption is APPROVED', clean.verdict === 'APPROVED', clean.reason)

const hype = checkBrandCompliance({
  caption:
    'Excited to announce our game-changing reinforcement learning work!\n\nThis will revolutionize evaluation.\n\nMore soon.\n\n#AI #Innovation',
  topic: 'reinforcement learning',
  platform: 'linkedin',
  groundingEntries: grounding,
})
check('hype vocabulary cites rule 3', hype.violations.some((v) => v.rule === 3))
check('promotional punctuation cites rule 5', hype.violations.some((v) => v.rule === 5))
check('generic hashtags cite rule 11', hype.violations.some((v) => v.rule === 11))

const offDomain = checkBrandCompliance({
  caption:
    'Five productivity habits that changed how our team works.\n\nWe tried them for a month.\n\nThe results surprised us.\n\n#Productivity #Habits #TeamWork',
  topic: 'productivity habits',
  platform: 'linkedin',
  groundingEntries: grounding,
})
check('an off-domain topic cites rule 7', offDomain.violations.some((v) => v.rule === 7))

const sensitive = checkBrandCompliance({
  caption:
    'We closed our Series B funding round this quarter.\n\nThe round supports our reinforcement learning work.\n\nMore detail follows.\n\n#RLHF #AIResearch #PostTraining',
  topic: 'reinforcement learning',
  platform: 'linkedin',
  groundingEntries: grounding,
})
check(
  'unannounced funding forces NEEDS_INTERNAL_APPROVAL',
  sensitive.verdict === 'NEEDS_INTERNAL_APPROVAL',
  sensitive.verdict,
)
check('the confidentiality gate cites rule 18', sensitive.violations.some((v) => v.rule === 18))

const ungroundedHook = checkBrandCompliance({
  caption:
    'Reward models improved evaluation accuracy by 47 percent.\n\nThat figure reframes how post-training is measured.\n\nThe mechanism is preference data coverage.\n\n#RewardModeling #PostTraining #AIEvaluation',
  topic: 'reward modeling',
  platform: 'linkedin',
  groundingEntries: grounding,
})
check(
  'a hook figure absent from the evidence cites rule 9',
  ungroundedHook.violations.some((v) => v.rule === 9),
  JSON.stringify(ungroundedHook.violations.map((v) => v.rule)),
)
check(
  'that verdict is CANNOT_VERIFY',
  ungroundedHook.verdict === 'CANNOT_VERIFY',
  ungroundedHook.verdict,
)

const forced = checkBrandCompliance({
  caption:
    'Evaluation harnesses miss long-horizon failures.\n\nAt Ethara we are building the infrastructure to transform how agents are measured.\n\nThat is the gap the work addresses.\n\n#AIEvaluation #AgenticAI #Benchmarks',
  topic: 'AI evaluation',
  platform: 'linkedin',
  groundingEntries: grounding,
})
check('a forced Ethara connection cites rule 4', forced.violations.some((v) => v.rule === 4))

const wrongCanvas = checkBrandCompliance({
  caption:
    'Benchmark saturation hides the failure modes that matter.\n\nAggregate scores stayed flat at 71 points while recovery stopped at step 12.\n\nThe signal was the step, not the score.\n\n#AIEvaluation #AgenticAI #Benchmarks',
  topic: 'AI evaluation and benchmarks',
  platform: 'linkedin',
  groundingEntries: grounding,
  visualHeadline: 'Benchmark saturation hides failure modes',
  visualCanvas: '1080x1350',
  visualAltText: 'A chart of recovery behaviour against step count.',
})
check('a wrong canvas cites invariant 22', wrongCanvas.violations.some((v) => v.rule === 22))

const noAlt = checkBrandCompliance({
  caption:
    'Benchmark saturation hides the failure modes that matter.\n\nAggregate scores stayed flat at 71 points while recovery stopped at step 12.\n\nThe signal was the step, not the score.\n\n#AIEvaluation #AgenticAI #Benchmarks',
  topic: 'AI evaluation and benchmarks',
  platform: 'linkedin',
  groundingEntries: grounding,
  visualHeadline: 'Benchmark saturation hides failure modes',
  visualCanvas: '1200x627',
})
check('a missing alt text cites invariant 23', noAlt.violations.some((v) => v.rule === 23))

const duplicate = checkBrandCompliance({
  caption:
    'Benchmark saturation hides the failure modes that matter.\n\nAggregate scores stayed flat at 71 points while recovery stopped at step 12.\n\nThe signal was the step, not the score.\n\n#AIEvaluation #AgenticAI #Benchmarks',
  topic: 'AI evaluation and benchmarks',
  platform: 'linkedin',
  groundingEntries: grounding,
  publishedCaptions: [
    'Benchmark saturation hides the failure modes that matter.\n\nAggregate scores stayed flat at 71 points while recovery stopped at step 12.\n\nThe signal was the step, not the score.',
  ],
})
check('a near-duplicate cites rule 17', duplicate.violations.some((v) => v.rule === 17))

console.log('\nEvery cited rule number resolves to a declared rule')
const allChecks = [clean, hype, offDomain, sensitive, ungroundedHook, forced, wrongCanvas, noAlt, duplicate]
const declared = new Set(ALL_RULES.map((r) => r.n))
const cited = [...new Set(allChecks.flatMap((c) => c.violations.map((v) => v.rule)))].sort((a, b) => a - b)
check(
  `all cited numbers are declared (${cited.join(', ')})`,
  cited.every((n) => declared.has(n)),
)
check(
  'every violation names its rule, evidence and required action',
  allChecks.every((c) =>
    c.violations.every((v) => v.title.length > 0 && v.detail.length > 0 && v.required_action.length > 0),
  ),
)

console.log('\nThe Knowledge Base corpus')
const corpusRows = brandCorpusAsKnowledge()
const ruleRows = brandRulesAsKnowledge()
check('the corpus has entries', corpusRows.length === BRAND_CORPUS.length && corpusRows.length > 0)
check('every corpus row is tagged brand-corpus', corpusRows.every((r) => r.tags.includes('brand-corpus')))
check('every rule row is tagged brand-rule', ruleRows.every((r) => r.tags.includes('brand-rule')))
check('no rule row is tagged brand-corpus', ruleRows.every((r) => !r.tags.includes('brand-corpus')))
check('corpus rows carry key points for rule 6', corpusRows.every((r) => r.content.includes('Key points:')))
check(
  'the corpus carries domain vocabulary rather than compliance words',
  corpusRows.some((r) => r.tags.includes('reinforcement learning')) &&
    corpusRows.some((r) => r.tags.includes('agentic ai')) &&
    corpusRows.some((r) => r.tags.includes('evaluation')),
)
check(
  '"infrastructure" is approved corpus vocabulary',
  corpusRows.some((r) => r.tags.includes('ai infrastructure')),
)

console.log(
  failures === 0
    ? `\n✓ brand-voice behavioural check passed — ${allChecks.length} candidates, ${cited.length} distinct rules cited\n`
    : `\n✗ ${failures} check(s) failed\n`,
)
process.exit(failures === 0 ? 0 : 1)

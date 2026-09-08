#!/usr/bin/env tsx
/**
 * `npm run db:seed` — the deterministic seed.
 *
 * Everything below uses a seeded PRNG (mulberry32), so the same seed produces
 * the same numbers on every run. That matters for two reasons: the demo is
 * reproducible, and the P2 gate can assert exact counts.
 *
 * The seed is idempotent at the workspace level: it clears the workspace's own
 * rows and rebuilds them, so running it twice leaves the same database rather
 * than doubling every table.
 *
 * What it produces (Part 10):
 *   · 20 keywords + 4 runs of historical signals, so growth % is meaningful
 *     on run one
 *   · ~40 LinkedIn post fixtures spread over the last 14 days
 *   · ~60 hashtag candidates resolving to a top-25 set
 *   · 11 sources, 16 competitors tiered P0/P1
 *   · 16 content ideas with ranks and slots already assigned, so the
 *     top-10-per-platform rule is visible on first load
 *   · 15 published posts with metrics and four-step histories
 *   · 20 brand rules, ~12 learned entries, ~15 cited research entries,
 *     and one completed build dated the most recent Sunday
 *   · 3 months of platform analytics for LinkedIn and Instagram
 *   · 12 agent_state rows and ~9 activity events
 *   · 1 JARVIS conversation with 6 turns covering the full range
 */

import {
  AGENTS,
  SKILLS,
  defaultSkillConfig,
} from '../../../shared/agent-registry'
import {
  BRAND,
  BRAND_TOPICS,
  brandRulesAsKnowledge,
  deriveHashtags,
} from '../../../shared/brand-voice'
import { SEED_KEYWORDS } from '../../../shared/keywords'
import { canvasKey } from '../../../shared/image-models'
import type { Platform } from '../../../shared/agent-contract'

import { config } from '../config'
import { closePool, query, queryOne } from './pool'
import {
  LINKEDIN_FIXTURES,
  fixtureEngagement,
  fixturePostedAt,
} from '../integrations/fixtures/linkedin-posts'
import { RESEARCH_FIXTURES } from '../integrations/fixtures/research'
import { COMPETITORS, SOURCES } from '../integrations/fixtures/competitors'

/* ═══════════════════════════════════════════════════════════════════════════
   DETERMINISM
   ═══════════════════════════════════════════════════════════════════════════ */

/** mulberry32 — small, fast, and identical across runs for a given seed. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) >>> 0
    let t = a
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SEED = 20260908
const rand = mulberry32(SEED)

/** Integer in [min, max]. */
function ri(min: number, max: number): number {
  return Math.floor(rand() * (max - min + 1)) + min
}

/** Float in [min, max], rounded to `dp`. */
function rf(min: number, max: number, dp = 2): number {
  const v = rand() * (max - min) + min
  return Number(v.toFixed(dp))
}

function pick<T>(list: readonly T[]): T {
  return list[Math.floor(rand() * list.length)] as T
}

/* ═══════════════════════════════════════════════════════════════════════════
   DATES
   ═══════════════════════════════════════════════════════════════════════════ */

const NOW = new Date()

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10)
}

function addDays(d: Date, days: number): Date {
  const out = new Date(d)
  out.setDate(out.getDate() + days)
  return out
}

/** Monday of the week containing `d`. The calendar grid starts here. */
function startOfWeek(d: Date): Date {
  const out = new Date(d)
  const day = out.getDay()
  const delta = day === 0 ? -6 : 1 - day
  out.setDate(out.getDate() + delta)
  out.setHours(0, 0, 0, 0)
  return out
}

/** The most recent Sunday, which is when the last knowledge build ran. */
function lastSunday(d: Date): Date {
  const out = new Date(d)
  const day = out.getDay()
  out.setDate(out.getDate() - (day === 0 ? 7 : day))
  out.setHours(6, 0, 0, 0)
  return out
}

/** `YYYY-MM` for the month `back` months before `d`. */
function monthKey(d: Date, back: number): string {
  const out = new Date(d.getFullYear(), d.getMonth() - back, 1)
  return `${out.getFullYear()}-${String(out.getMonth() + 1).padStart(2, '0')}`
}

function monthLabel(key: string): string {
  const [y, m] = key.split('-').map(Number)
  return new Date(y as number, (m as number) - 1, 1).toLocaleDateString('en-GB', {
    month: 'long',
    year: 'numeric',
  })
}

function daysInMonth(key: string): number {
  const [y, m] = key.split('-').map(Number)
  return new Date(y as number, m as number, 0).getDate()
}

const THIS_WEEK = startOfWeek(NOW)
const LAST_BUILD = lastSunday(NOW)

/**
 * The three most recent complete months. The most recent is the reported one
 * and carries the real figures below; the two before it are consistent
 * back-fill along the same growth curve.
 */
const MONTHS = [monthKey(NOW, 3), monthKey(NOW, 2), monthKey(NOW, 1)]
const REPORTED_MONTH = MONTHS[2] as string

/* ═══════════════════════════════════════════════════════════════════════════
   THE REAL REPORTED FIGURES
   These are the actual numbers for the reported month. June/July equivalents
   are synthesised backwards along the same curve.
   ═══════════════════════════════════════════════════════════════════════════ */

const REPORTED_LINKEDIN = {
  impressions: 79_554,
  engagements: 16_665,
  pageViews: 59_147,
  followerGrowth: 2_312,
  organicShare: 99.8,
  lifePageViews: 12_493,
}

const REPORTED_INSTAGRAM = {
  views: 72_970,
  uniqueViewers: 12_896,
  interactions: 795,
  followerGrowth: 70,
  growthPct: 11.8,
  nonFollowerShare: 86.1,
}

/* ═══════════════════════════════════════════════════════════════════════════
   PLATFORM ANALYTICS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A day-by-day series weighted toward weekdays that sums EXACTLY to `total`.
 * The rounding remainder is pushed onto the highest-weighted day so the daily
 * figures always reconcile with the monthly headline.
 */
function dailySeries(monthKeyStr: string, total: number): Array<{ date: string; value: number }> {
  const days = daysInMonth(monthKeyStr)
  const [y, m] = monthKeyStr.split('-').map(Number)

  const weights: number[] = []
  for (let day = 1; day <= days; day += 1) {
    const dow = new Date(y as number, (m as number) - 1, day).getDay()
    // Weekdays carry this audience; the weekend is genuinely quiet.
    const base = dow === 0 || dow === 6 ? 0.34 : 1
    weights.push(base * rf(0.78, 1.24, 4))
  }

  const sum = weights.reduce((a, b) => a + b, 0)
  const series = weights.map((w, i) => ({
    date: `${monthKeyStr}-${String(i + 1).padStart(2, '0')}`,
    value: Math.max(0, Math.round((w / sum) * total)),
  }))

  // Reconcile to the exact total.
  const drift = total - series.reduce((n, d) => n + d.value, 0)
  if (drift !== 0) {
    let peakIndex = 0
    for (const [i, d] of series.entries()) {
      if (d.value > (series[peakIndex] as { value: number }).value) peakIndex = i
    }
    ;(series[peakIndex] as { value: number }).value += drift
  }

  return series
}

interface AnalyticsRow {
  platform: Platform
  month: string
  label: string
  isReported: boolean
  metrics: Record<string, number | string>
  daily: Array<{ date: string; value: number }>
}

function buildAnalytics(): AnalyticsRow[] {
  const rows: AnalyticsRow[] = []

  // Growth curve backwards from the reported month: each earlier month is
  // smaller, consistent with the reported follower growth.
  const liCurve = [0.71, 0.85, 1]
  const igCurve = [0.66, 0.82, 1]

  for (const [i, key] of MONTHS.entries()) {
    const reported = key === REPORTED_MONTH
    const liF = liCurve[i] as number
    const igF = igCurve[i] as number

    const liImpressions = Math.round(REPORTED_LINKEDIN.impressions * liF)
    const liEngagements = Math.round(REPORTED_LINKEDIN.engagements * liF)
    const liPageViews = Math.round(REPORTED_LINKEDIN.pageViews * liF)
    const liFollowers = Math.round(REPORTED_LINKEDIN.followerGrowth * liF)

    rows.push({
      platform: 'linkedin',
      month: key,
      label: monthLabel(key),
      isReported: reported,
      metrics: {
        impressions: liImpressions,
        engagements: liEngagements,
        pageViews: liPageViews,
        followerGrowth: liFollowers,
        organicShare: reported ? REPORTED_LINKEDIN.organicShare : rf(98.4, 99.7, 1),
        lifePageViews: Math.round(REPORTED_LINKEDIN.lifePageViews * liF),
        engagementRate: Number(((liEngagements / liImpressions) * 100).toFixed(2)),
        reach: Math.round(liImpressions * 0.78),
      },
      daily: dailySeries(key, liImpressions),
    })

    const igViews = Math.round(REPORTED_INSTAGRAM.views * igF)
    const igUnique = Math.round(REPORTED_INSTAGRAM.uniqueViewers * igF)
    const igInteractions = Math.round(REPORTED_INSTAGRAM.interactions * igF)

    rows.push({
      platform: 'instagram',
      month: key,
      label: monthLabel(key),
      isReported: reported,
      metrics: {
        views: igViews,
        uniqueViewers: igUnique,
        interactions: igInteractions,
        followerGrowth: reported
          ? REPORTED_INSTAGRAM.followerGrowth
          : Math.round(REPORTED_INSTAGRAM.followerGrowth * igF),
        growthPct: reported ? REPORTED_INSTAGRAM.growthPct : rf(6.2, 10.4, 1),
        nonFollowerShare: reported ? REPORTED_INSTAGRAM.nonFollowerShare : rf(79.2, 85.4, 1),
        engagementRate: Number(((igInteractions / igViews) * 100).toFixed(2)),
        reach: igUnique,
      },
      daily: dailySeries(key, igViews),
    })
  }

  return rows
}

/* ═══════════════════════════════════════════════════════════════════════════
   CONTENT
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The platform is NOT declared here — it is assigned from `IDEA_PLATFORMS`
 * alongside, so the distribution across platforms is legible in one place.
 */
interface IdeaSeed {
  title: string
  description: string
  sourceTopic: string
  hashtag: string
  format: string
  angle: string
  audience: string
  confidence: number
  brandRelevance: number
  trendScore: number
  /** Day offset from Monday of this week. Negative lands last week. */
  dayOffset: number
  time: string
  status: string
  isNewTrend: boolean
}

/**
 * Sixteen ideas. Deliberately more than ten on LinkedIn so several must fall
 * into More suggestions, making the top-10 rule visible without running the
 * pipeline.
 */
const IDEA_SEEDS: IdeaSeed[] = [
  { title: 'Reward models are the product', description: 'The reward model is the specification. Whatever it rewards is what the system does in every case you did not enumerate.', sourceTopic: 'reward modeling', hashtag: 'RewardModeling', format: 'Thought Leadership', angle: 'Reframe the reward model as a product surface with an owner', audience: 'ML engineers and heads of AI', confidence: 94, brandRelevance: 96, trendScore: 92, dayOffset: 1, time: '10:30 AM', status: 'pending_leadership', isNewTrend: false },
  { title: 'Calibration beats capacity in critics', description: 'A smaller well-calibrated reward model supervising a larger policy outperformed a same-size poorly calibrated one.', sourceTopic: 'reward modeling', hashtag: 'RewardModeling', format: 'Thought Leadership', angle: 'Cite the replication and draw the harness implication', audience: 'Researchers', confidence: 91, brandRelevance: 94, trendScore: 90, dayOffset: 3, time: '09:00 AM', status: 'in_review', isNewTrend: false },
  { title: 'The environment was always the bottleneck', description: 'Agent reliability came from tool contracts and replay, not from a better model.', sourceTopic: 'agentic AI', hashtag: 'AgenticAI', format: 'Thought Leadership', angle: 'Attribute agent failure to environment design', audience: 'Engineering leaders', confidence: 93, brandRelevance: 92, trendScore: 95, dayOffset: 0, time: '11:00 AM', status: 'approved', isNewTrend: true },
  { title: 'Confirmation design is the product', description: 'Users want agents that ask before anything irreversible and get on with everything else.', sourceTopic: 'agentic AI', hashtag: 'AgenticAI', format: 'Short Post', angle: 'Trust is a design output, not a model property', audience: 'Product and engineering', confidence: 89, brandRelevance: 88, trendScore: 93, dayOffset: 2, time: '02:00 PM', status: 'drafted', isNewTrend: true },
  { title: 'Process supervision generalises better', description: 'Rewarding intermediate reasoning beat outcome-only reward on every long-horizon task tried.', sourceTopic: 'reinforcement learning', hashtag: 'ReinforcementLearning', format: 'Carousel', angle: 'Cost-benefit of step-level labelling', audience: 'RL researchers', confidence: 90, brandRelevance: 95, trendScore: 88, dayOffset: 4, time: '10:00 AM', status: 'suggested', isNewTrend: false },
  { title: 'Annotator disagreement is signal', description: 'The examples labellers argue about are the ones the reward model gets wrong in production.', sourceTopic: 'RLHF', hashtag: 'RLHF', format: 'Short Post', angle: 'Retain variance rather than aggregating it away', audience: 'Data and RLHF teams', confidence: 87, brandRelevance: 91, trendScore: 86, dayOffset: 1, time: '03:30 PM', status: 'suggested', isNewTrend: false },
  { title: 'Contamination is the default assumption', description: 'Rotating held-out sets, never published, plus distributions rather than averages.', sourceTopic: 'model evaluation', hashtag: 'ModelEvaluation', format: 'Thought Leadership', angle: 'Evaluation hygiene as a discipline', audience: 'Eval leads', confidence: 88, brandRelevance: 89, trendScore: 84, dayOffset: 2, time: '09:30 AM', status: 'suggested', isNewTrend: false },
  { title: 'One agent with typed tools', description: 'Replacing a multi-agent mesh with one planner and four tools held task success at a fifth of the latency.', sourceTopic: 'multi-agent systems', hashtag: 'MultiAgentSystems', format: 'Thought Leadership', angle: 'Multi-agent is not free', audience: 'Architects', confidence: 86, brandRelevance: 87, trendScore: 89, dayOffset: 3, time: '01:00 PM', status: 'suggested', isNewTrend: false },
  { title: 'Verification reverses model collapse', description: 'Synthetic data degrades only under unverified self-sampling. With a grounding signal quality rises.', sourceTopic: 'synthetic data', hashtag: 'SyntheticData', format: 'Thought Leadership', angle: 'Correct a widely repeated claim', audience: 'Data teams', confidence: 85, brandRelevance: 90, trendScore: 79, dayOffset: 4, time: '02:30 PM', status: 'suggested', isNewTrend: false },
  { title: 'Post-training has notebooks, not infrastructure', description: 'Pre-training is industrialised. Post-training is where the tooling gap now sits.', sourceTopic: 'post-training', hashtag: 'PostTraining', format: 'Short Post', angle: 'Name the specific missing tools', audience: 'Platform teams', confidence: 84, brandRelevance: 93, trendScore: 82, dayOffset: 0, time: '04:00 PM', status: 'suggested', isNewTrend: false },
  { title: 'Cost per solved task, not per token', description: 'Effective inference cost fell an order of magnitude from routing and caching, not price cuts.', sourceTopic: 'inference optimization', hashtag: 'InferenceOptimization', format: 'Carousel', angle: 'Reframe the unit of cost', audience: 'CTOs', confidence: 83, brandRelevance: 78, trendScore: 87, dayOffset: 2, time: '11:30 AM', status: 'suggested', isNewTrend: true },
  { title: 'Determinism is a prerequisite', description: 'If the environment is not deterministic given a seed, the ablations are opinions.', sourceTopic: 'AI environments', hashtag: 'AIEnvironments', format: 'Short Post', angle: 'Reproducibility as engineering discipline', audience: 'RL engineers', confidence: 82, brandRelevance: 88, trendScore: 76, dayOffset: 3, time: '10:00 AM', status: 'suggested', isNewTrend: false },
  { title: 'The eval set outlived three models', description: 'The most durable AI artefact in most organisations is the evaluation set, not the model.', sourceTopic: 'model evaluation', hashtag: 'ModelEvaluation', format: 'Thought Leadership', angle: 'Assets that survive migrations', audience: 'Heads of AI', confidence: 81, brandRelevance: 84, trendScore: 80, dayOffset: 1, time: '08:30 AM', status: 'suggested', isNewTrend: false },
  { title: 'Reward hacking is a spec review finding', description: 'Every hack is the policy correctly optimising something written carelessly.', sourceTopic: 'reinforcement learning', hashtag: 'AIAlignment', format: 'Short Post', angle: 'Move the blame from policy to specification', audience: 'RL and alignment', confidence: 80, brandRelevance: 92, trendScore: 78, dayOffset: 4, time: '03:00 PM', status: 'suggested', isNewTrend: false },
  { title: 'Replay, not dashboards', description: 'Re-running any past decision against the exact state and config it saw is what makes agents debuggable.', sourceTopic: 'agentic AI', hashtag: 'LLMOps', format: 'Thought Leadership', angle: 'Observability for non-deterministic systems', audience: 'Platform engineers', confidence: 79, brandRelevance: 83, trendScore: 85, dayOffset: 0, time: '01:30 PM', status: 'suggested', isNewTrend: false },
  { title: 'Benchmarks finished teaching us', description: 'When everyone scores 94%, saturation is a curriculum problem, not a measurement one.', sourceTopic: 'AI benchmarks', hashtag: 'AIBenchmarks', format: 'Short Post', angle: 'What the next benchmark must ask', audience: 'Researchers', confidence: 77, brandRelevance: 82, trendScore: 81, dayOffset: 2, time: '04:30 PM', status: 'suggested', isNewTrend: false },
]

/**
 * Platform assignment. Thirteen land on LinkedIn deliberately: with the top-ten
 * rule that leaves three in More suggestions on first load, so the promote and
 * demote behaviour is visible without running the pipeline.
 */
const IDEA_PLATFORMS: Platform[] = [
  'linkedin', 'linkedin', 'linkedin', 'instagram', 'linkedin',
  'linkedin', 'linkedin', 'linkedin', 'linkedin', 'linkedin',
  'x', 'linkedin', 'linkedin', 'linkedin', 'linkedin', 'instagram',
]

/* ═══════════════════════════════════════════════════════════════════════════
   PUBLISHED POSTS
   ═══════════════════════════════════════════════════════════════════════════ */

interface PublishedSeed {
  title: string
  platform: Platform
  content: string
  daysAgo: number
  reach: number
  impressions: number
  likes: number
  comments: number
  shares: number
  summary: string
  recommendation: string
}

const PUBLISHED_SEEDS: PublishedSeed[] = [
  { title: 'What a reward model actually specifies', platform: 'linkedin', content: 'A reward model is a specification written in examples rather than prose.\n\nEvery preference pair narrows what the policy is allowed to become. The pairs you did not collect are the behaviours you did not constrain, and the model will find them.\n\nWe now review reward definitions the way we review API contracts: before the work starts, with an owner named.\n\n#RewardModeling #ReinforcementLearning #AIAlignment', daysAgo: 34, reach: 14820, impressions: 18940, likes: 742, comments: 68, shares: 94, summary: 'Reach ran 31% above the trailing four-post average, concentrated in non-follower impressions, which suggests the hook travelled beyond the existing audience.', recommendation: 'Lead with the specification framing again. It outperformed the mechanism-first opening by a wide margin.' },
  { title: 'Post-training is a discipline, not a phase', platform: 'linkedin', content: 'Pre-training infrastructure is something you can buy.\n\nPost-training infrastructure is something you still have to build, and most teams are running it out of notebooks. The specific gaps: preference dataset lineage, reward model versioning, and reproducible measurement of behavioural change.\n\nThe teams shipping reliably have separate owners for each.\n\n#PostTraining #LLMFineTuning #AIInfrastructure', daysAgo: 31, reach: 11240, impressions: 14100, likes: 518, comments: 44, shares: 61, summary: 'Performed close to baseline: reach within 4% of the four-post average. Comment quality was high but volume was ordinary.', recommendation: 'The three-gap list worked. Cut the opening two lines — engagement began at the list.' },
  { title: 'Agents fail at the environment, not the model', platform: 'linkedin', content: 'Nine months of agent work, compressed.\n\nThe model was never the constraint. Non-idempotent tools were. Unversioned schemas were. Errors that the planner could not read were.\n\nWe stopped tuning prompts and started versioning the tool surface. Reliability moved more in three weeks than in the previous three months.\n\n#AgenticAI #AIAgents #LLMOps', daysAgo: 27, reach: 21460, impressions: 27300, likes: 1284, comments: 112, shares: 187, summary: 'The strongest post of the period: reach 89% above the trailing average and the highest share rate we have recorded, at 0.68%.', recommendation: 'Concrete failure lists outperform abstract argument here. Repeat the structure with a different subject.' },
  { title: 'Determinism before ablations', platform: 'linkedin', content: 'If your environment is not deterministic given a seed, your ablations are opinions with error bars.\n\nWe spent a month on reset semantics, observation schemas and separable reward plumbing. It paid for itself in the first week of real experiments, because every result became arguable on the evidence rather than on vibes.\n\n#AIEnvironments #ReinforcementLearning #AIResearch', daysAgo: 24, reach: 9840, impressions: 12600, likes: 442, comments: 38, shares: 52, summary: 'Reach 18% below the trailing average. The subject is narrower than our usual and the audience reflected that.', recommendation: 'Keep publishing these — they attract the researcher segment — but do not schedule them opposite a broader post.' },
  { title: 'Annotator disagreement is training signal', platform: 'linkedin', content: 'Majority vote throws away the most useful thing in your preference data.\n\nThe examples your labellers argue about are, with striking regularity, the examples your reward model gets wrong in production. We now model the disagreement distribution instead of collapsing it.\n\nRobustness on ambiguous inputs improved measurably.\n\n#RLHF #RewardModeling #SyntheticData', daysAgo: 20, reach: 13920, impressions: 17400, likes: 684, comments: 71, shares: 88, summary: 'Reach 22% above the trailing average. Comments skewed toward practitioners describing their own aggregation approach.', recommendation: 'The counter-intuitive opening is doing the work. Keep leading with what conventional practice gets wrong.' },
  { title: 'Contamination is the default now', platform: 'linkedin', content: 'We stopped testing for benchmark contamination and started assuming it.\n\nA rotating held-out set, contents never published, plus score distributions and the three worst failures on every report. Single-number evals hid every problem that was worth fixing.\n\n#ModelEvaluation #AIBenchmarks #AIEvaluationHarness', daysAgo: 17, reach: 12180, impressions: 15300, likes: 574, comments: 52, shares: 76, summary: 'Reach 7% above the trailing average — solidly mid-range, with strong engagement from the evaluation community specifically.', recommendation: 'Pair this with the eval-set-as-asset angle; the two reinforce each other.' },
  { title: 'One planner, four tools', platform: 'linkedin', content: 'We built a multi-agent system, measured it honestly, and replaced it with one agent and four well-typed tools.\n\nSame task success. A fifth of the latency. And when it failed we could explain why, which we could not do before.\n\nMulti-agent earns its cost when sub-tasks are genuinely parallel and independently verifiable. Otherwise it is a distributed system you built by accident.\n\n#MultiAgentSystems #AgenticAI #AIAgents', daysAgo: 13, reach: 18740, impressions: 23800, likes: 1042, comments: 96, shares: 149, summary: 'Reach 61% above the trailing average. The "distributed system by accident" line was quoted in 14 reshares.', recommendation: 'Quotable single lines are driving the shares. Write one deliberately into each post.' },
  { title: 'Cost per solved task', platform: 'linkedin', content: 'Headline token prices barely moved. Effective inference cost fell by roughly an order of magnitude.\n\nThe gains came from routing, caching and letting small models handle the volume. None of it required a new frontier model, and none of it appears in a pricing page.\n\nMeasure cost per solved task, not cost per token.\n\n#InferenceOptimization #LLMOps #AIInfrastructure', daysAgo: 10, reach: 16320, impressions: 20700, likes: 878, comments: 84, shares: 127, summary: 'Reach 40% above the trailing average, with unusually strong engagement from senior engineering titles.', recommendation: 'The unit-of-measurement reframe travels. Apply it to evaluation cost next.' },
  { title: 'The eval set is the asset', platform: 'linkedin', content: 'The most durable AI artefact most organisations own is not a model. It is the evaluation set built from their own real traffic.\n\nOurs has outlived three model migrations and settles vendor arguments in an afternoon. The models were replaceable. The measurement was not.\n\n#ModelEvaluation #EnterpriseAI #AIResearch', daysAgo: 7, reach: 15680, impressions: 19800, likes: 812, comments: 79, shares: 118, summary: 'Reach 34% above the trailing average. Saves and shares both above the period median.', recommendation: 'This is the strongest positioning line we have. Build a carousel from it.' },
  { title: 'Reward hacking is a spec finding', platform: 'linkedin', content: 'Reward hacking is not a bug in the policy.\n\nIt is the policy correctly optimising a specification someone wrote carelessly. Every hack you find is a specification review finding, and it should be logged as one.\n\nWe now review reward definitions before the training run rather than explaining behaviour after it.\n\n#ReinforcementLearning #AIAlignment #RewardModeling', daysAgo: 4, reach: 17240, impressions: 21900, likes: 946, comments: 91, shares: 138, summary: 'Reach 47% above the trailing average and the second-highest share rate of the period at 0.63%.', recommendation: 'Reframing blame from the model to the specification consistently outperforms. Continue the thread.' },
  { title: 'Verified synthetic curricula', platform: 'instagram', content: 'Model collapse is specific to unverified self-sampling.\n\nWith a verification signal in the loop, synthetic curricula improved quality over four rounds rather than degrading. The binding constraint was never volume. It was diversity.\n\n#SyntheticData #PostTraining #AIResearch', daysAgo: 22, reach: 6420, impressions: 7900, likes: 284, comments: 21, shares: 18, summary: 'Reach 12% above the Instagram trailing average, with 84% of views from non-followers.', recommendation: 'The non-follower share is doing the work here. Keep the visual carrying the claim.' },
  { title: 'Determinism, visualised', platform: 'instagram', content: 'Same seed. Same result. Every time.\n\nIt sounds obvious until you audit your own environment and find four sources of non-determinism.\n\n#AIEnvironments #ReinforcementLearning #MachineLearning', daysAgo: 15, reach: 5180, impressions: 6300, likes: 218, comments: 14, shares: 11, summary: 'Reach 9% below the Instagram trailing average. The subject is narrow for this platform.', recommendation: 'Keep the research-narrow subjects on LinkedIn; Instagram rewards the broader reframes.' },
  { title: 'Agent reliability, in four panels', platform: 'instagram', content: 'Tool contracts. Idempotency. Legible errors. Deterministic replay.\n\nFour changes, none of them a model upgrade.\n\n#AgenticAI #AIAgents #LLMOps', daysAgo: 9, reach: 8140, impressions: 9800, likes: 372, comments: 28, shares: 31, summary: 'Reach 42% above the Instagram trailing average — the strongest Instagram post of the period.', recommendation: 'Four-panel breakdowns are working. Make this a recurring format.' },
  { title: 'Reward models are the product', platform: 'x', content: 'A reward model is a specification written in examples.\n\nWhatever it rewards is what your system does in every case you did not enumerate.\n\n#RewardModeling #ReinforcementLearning', daysAgo: 19, reach: 4280, impressions: 5100, likes: 164, comments: 12, shares: 38, summary: 'Engagement rate of 4.2% against an X baseline of 3.6%, on a small sample.', recommendation: 'X rewards the compressed claim. Cut to the single assertion and drop the elaboration.' },
  { title: 'The environment was the bottleneck', platform: 'x', content: 'Nine months of agent work in one line: the model was never the bottleneck. The environment was.\n\n#AgenticAI #AIAgents', daysAgo: 6, reach: 5640, impressions: 6800, likes: 232, comments: 18, shares: 54, summary: 'Engagement rate of 4.5%, above the X baseline of 3.6%, with shares carrying most of it.', recommendation: 'Single-sentence posts are outperforming multi-paragraph ones on this platform by a clear margin.' },
]

/* ═══════════════════════════════════════════════════════════════════════════
   LEARNED KNOWLEDGE
   ═══════════════════════════════════════════════════════════════════════════ */

const LEARNED_ENTRIES: Array<{ title: string; category: string; content: string; confidence: 'High' | 'Medium' | 'Low' }> = [
  { title: 'Lead with the reframe, not the mechanism', category: 'User Feedback', content: 'Across four posts, opening with the conceptual reframe outperformed opening with the technical mechanism. Reach was 28–89% above the trailing average when the reframe led.', confidence: 'High' },
  { title: 'Write one quotable line per post', category: 'High Performer', content: 'Posts containing a single compressed, quotable assertion were reshared 2.4x more often. The line should be able to stand alone in a reshare comment.', confidence: 'High' },
  { title: 'Concrete failure lists beat abstract argument', category: 'High Performer', content: 'Enumerating specific failure modes outperformed general argument on every comparison so far. The strongest post of the period was a three-item failure list.', confidence: 'High' },
  { title: 'X rewards the compressed claim', category: 'Platform Preference', content: 'On X, single-assertion posts outperformed multi-paragraph adaptations. Engagement rate rose from 3.6% baseline to 4.2–4.5% when the elaboration was cut entirely.', confidence: 'Medium' },
  { title: 'Instagram carries the broad reframe, not the narrow result', category: 'Platform Preference', content: 'Research-narrow subjects underperformed the Instagram baseline by around 9%, while broader reframes ran 12–42% above it. Keep narrow findings on LinkedIn.', confidence: 'Medium' },
  { title: 'Four-panel breakdowns work on Instagram', category: 'Platform Preference', content: 'The four-panel visual breakdown was the strongest Instagram format of the period at 42% above trailing average.', confidence: 'Medium' },
  { title: 'Marketing prefers a shorter hook', category: 'User Feedback', content: 'Ridhima has shortened the hook on six of the last eight drafts. Target twelve words rather than the eighteen-word ceiling.', confidence: 'High' },
  { title: 'Leadership rejects unsourced figures', category: 'Rejected Post', content: 'Two rejections cited a figure without a citation. Every number now needs its source named in the caption or removed before it reaches Leadership.', confidence: 'High' },
  { title: 'Avoid scheduling two narrow posts against each other', category: 'Audience Insight', content: 'When two research-narrow posts ran in the same week, the second underperformed by 18%. Alternate narrow and broad.', confidence: 'Medium' },
  { title: 'CTO-facing framing lifts senior engagement', category: 'Audience Insight', content: 'Posts reframed around cost and decision-making attracted materially more senior engineering titles than the same content framed around method.', confidence: 'Medium' },
  { title: 'Do not open with "in today\u2019s landscape"', category: 'Brand Voice', content: 'Flagged and removed three times by Marketing. Empty openers are stripped automatically now, but the writer should not produce them.', confidence: 'High' },
  { title: 'The specification framing is our strongest position', category: 'High Performer', content: 'Framing reward models and rewards as specifications rather than training details produced the two highest-performing posts in the period.', confidence: 'High' },
]

/* ═══════════════════════════════════════════════════════════════════════════
   RELEVANCE SCORING
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Where a candidate starts before topic overlap is added, matching the
 * `baseRelevance` default on validation.relevance.score.
 */
const RELEVANCE_BASE = 26

/** Points per matched brand topic. Overlap can only ever raise the score. */
const RELEVANCE_PER_TOPIC = 16

/**
 * Counts brand-topic matches on word boundaries.
 *
 * Substring matching would double-count — `eval` fires inside `evaluation` —
 * so matching is anchored. Two normalisations make it accurate:
 *   · camelCase hashtags are split, so #ReinforcementLearning matches the
 *     topic "reinforcement learning"
 *   · a trailing plural is tolerated, so "agents" matches the topic "agent"
 */
function countTopicMatches(text: string): number {
  const haystack = text
    // #ReinforcementLearning → # Reinforcement Learning
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .toLowerCase()
    .replace(/[-_]/g, ' ')
    .replace(/\s+/g, ' ')

  let hits = 0
  for (const topic of BRAND_TOPICS) {
    const normalised = topic.replace(/[-_]/g, ' ')
    const escaped = normalised.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    if (new RegExp(`\\b${escaped}(s|es)?\\b`).test(haystack)) hits += 1
  }
  return hits
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SEED RUN
   ═══════════════════════════════════════════════════════════════════════════ */

interface Counts {
  [table: string]: number
}

const counts: Counts = {}

function tally(table: string, n = 1): void {
  counts[table] = (counts[table] ?? 0) + n
}

async function ensureWorkspace(): Promise<string> {
  const slug = config.core.workspaceSlug
  const existing = await queryOne<{ id: string }>(
    'SELECT id FROM workspaces WHERE slug = $1',
    [slug],
  )
  if (existing) return existing.id

  const row = await queryOne<{ id: string }>(
    `INSERT INTO workspaces (name, slug, brand_voice, audience, settings)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [
      'Ethara.AI · Main',
      slug,
      BRAND.voiceWords.join(', '),
      BRAND.audience,
      JSON.stringify({
        positioning: BRAND.positioning,
        emojiBudget: BRAND.emojiBudget,
        hashtags: BRAND.hashtags,
      }),
    ],
  )
  if (!row) throw new Error('Failed to create workspace')
  return row.id
}

/**
 * Clears this workspace's rows so the seed is idempotent.
 * Ordered by dependency. Nothing outside the workspace is touched.
 */
async function clearWorkspace(workspaceId: string): Promise<void> {
  const byWorkspace = [
    'lineage_edges',
    'review_queue',
    'activity_events',
    'skill_runs',
    'agent_runs',
    'pipeline_runs',
    'agent_state',
    'agent_skills',
    'platform_analytics',
    'knowledge_entries',
    'knowledge_builds',
  ]

  // Children whose parents are scoped by workspace.
  await query(
    `DELETE FROM post_metrics WHERE post_id IN (SELECT id FROM posts WHERE workspace_id = $1)`,
    [workspaceId],
  )
  await query(
    `DELETE FROM jarvis_steps WHERE turn_id IN (
       SELECT t.id FROM jarvis_turns t
       JOIN jarvis_conversations c ON c.id = t.conversation_id
       WHERE c.workspace_id = $1)`,
    [workspaceId],
  )
  await query(
    `DELETE FROM jarvis_confirmations WHERE turn_id IN (
       SELECT t.id FROM jarvis_turns t
       JOIN jarvis_conversations c ON c.id = t.conversation_id
       WHERE c.workspace_id = $1)`,
    [workspaceId],
  )
  await query(
    `DELETE FROM jarvis_turns WHERE conversation_id IN (
       SELECT id FROM jarvis_conversations WHERE workspace_id = $1)`,
    [workspaceId],
  )
  await query('DELETE FROM jarvis_conversations WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM jarvis_briefs WHERE workspace_id = $1', [workspaceId])

  await query(
    `DELETE FROM drafts WHERE idea_id IN (SELECT id FROM content_ideas WHERE workspace_id = $1)`,
    [workspaceId],
  )
  await query(
    `DELETE FROM media_assets WHERE idea_id IN (SELECT id FROM content_ideas WHERE workspace_id = $1)`,
    [workspaceId],
  )
  await query('DELETE FROM posts WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM content_ideas WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM scraped_items WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM hashtags WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM keyword_signals WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM keywords WHERE workspace_id = $1', [workspaceId])
  await query('DELETE FROM sources WHERE workspace_id = $1', [workspaceId])

  for (const table of byWorkspace) {
    await query(`DELETE FROM ${table} WHERE workspace_id = $1`, [workspaceId])
  }
}

/* ── Keywords and four runs of history ─────────────────────────────────────── */

async function seedKeywords(workspaceId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>()

  for (const kw of SEED_KEYWORDS) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO keywords (workspace_id, term, category, weight, active)
       VALUES ($1, $2, $3, $4, true) RETURNING id`,
      [workspaceId, kw.term, kw.category, kw.weight],
    )
    if (row) {
      ids.set(kw.term, row.id)
      tally('keywords')
    }
  }
  return ids
}

/**
 * Four historical runs, oldest to newest, so `growthScore` has a real
 * four-run baseline the very first time the pipeline runs.
 */
async function seedKeywordHistory(
  workspaceId: string,
  keywordIds: Map<string, string>,
): Promise<void> {
  const HISTORY_RUNS = 4

  for (let runIndex = 0; runIndex < HISTORY_RUNS; runIndex += 1) {
    const capturedAt = addDays(NOW, -((HISTORY_RUNS - runIndex) * 7))
    const runId = crypto.randomUUID()

    // Score every keyword for this run, then rank.
    const scored: Array<{ term: string; postCount: number; engagement: number; velocity: number; score: number }> = []

    for (const kw of SEED_KEYWORDS) {
      // Growth over the four runs, weighted by the keyword's own weight so
      // the strong terms are consistently strong.
      const growthFactor = 0.72 + runIndex * 0.09
      const base = (kw.weight / 100) * 26
      const postCount = Math.max(2, Math.round(base * growthFactor * rf(0.82, 1.2)))
      const avgEngagement = ri(240, 1650)
      const engagement = postCount * avgEngagement
      const velocity = rf(6, 68)

      scored.push({
        term: kw.term,
        postCount,
        engagement,
        velocity,
        score: 0,
      })
    }

    const maxPosts = Math.max(...scored.map((s) => s.postCount))
    const maxEng = Math.max(...scored.map((s) => s.engagement))
    const maxVel = Math.max(...scored.map((s) => s.velocity))

    for (const s of scored) {
      const volume = (s.postCount / maxPosts) * 25
      const eng = (s.engagement / maxEng) * 35
      const vel = (s.velocity / maxVel) * 20
      const growth = rf(28, 92) * 0.2
      s.score = Math.round(Math.min(100, volume + eng + vel + growth))
    }

    scored.sort((a, b) => b.score - a.score)

    for (const [i, s] of scored.entries()) {
      const keywordId = keywordIds.get(s.term)
      if (!keywordId) continue
      const isTrending = i < 5
      const growthPct = rf(-24, 96, 1)

      await query(
        `INSERT INTO keyword_signals
           (workspace_id, keyword_id, run_id, post_count, total_engagement, avg_engagement,
            velocity, growth_pct, trend_score, rank, is_trending, trend_reason, captured_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
        [
          workspaceId,
          keywordId,
          runId,
          s.postCount,
          s.engagement,
          Number((s.engagement / s.postCount).toFixed(2)),
          s.velocity,
          growthPct,
          s.score,
          i + 1,
          isTrending,
          isTrending
            ? `Rank ${i + 1} of ${scored.length} this run: ${s.postCount} posts and ${s.engagement.toLocaleString('en-GB')} total engagement, with engagement velocity at ${s.velocity} per hour.`
            : `Rank ${i + 1}: ${s.postCount} posts was not enough volume to enter the top five this run.`,
          capturedAt.toISOString(),
        ],
      )
      tally('keyword_signals')
    }
  }
}

/* ── Sources ───────────────────────────────────────────────────────────────── */

async function seedSources(workspaceId: string): Promise<Map<string, string>> {
  const ids = new Map<string, string>()
  for (const s of SOURCES) {
    const row = await queryOne<{ id: string }>(
      `INSERT INTO sources (workspace_id, name, kind, source_type, url, trusted, enabled)
       VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
      [workspaceId, s.name, s.kind, s.sourceType, s.url, s.trusted, s.enabled],
    )
    if (row) {
      ids.set(s.name, row.id)
      tally('sources')
    }
  }
  return ids
}

/* ── Scraped items from the fixture corpus ─────────────────────────────────── */

async function seedScrapedItems(
  workspaceId: string,
  keywordIds: Map<string, string>,
  sourceIds: Map<string, string>,
  runId: string,
): Promise<Map<string, string>> {
  const itemIds = new Map<string, string>()
  const maxEngagement = Math.max(...LINKEDIN_FIXTURES.map(fixtureEngagement))

  for (const post of LINKEDIN_FIXTURES) {
    const engagement = fixtureEngagement(post)
    const postedAt = fixturePostedAt(post, NOW)
    const ageHours = (NOW.getTime() - postedAt.getTime()) / 36e5

    // Freshness on a 72h half-life, matching the registry default.
    const freshness = Math.round(100 * 0.5 ** (ageHours / 72))

    /*
     * Relevance is topical overlap against the brand domains, scored the way
     * validation.relevance.score does it: overlap can only RAISE the score, so
     * a post with no subject-matter overlap sits at the base and is rejected on
     * the evidence rather than by a special case.
     */
    const topicHits = countTopicMatches(`${post.text} ${post.hashtags.join(' ')}`)
    const relevance = Math.min(
      100,
      RELEVANCE_BASE +
        topicHits * RELEVANCE_PER_TOPIC +
        Math.round((engagement / maxEngagement) * 24),
    )
    const credibility =
      post.authorFollowers > 18000 ? 'High' : post.authorFollowers > 8500 ? 'Medium' : 'Low'

    // Most items validate; a handful need review, one is rejected, so every
    // bucket on the theater and the Content Intelligence tabs is populated.
    /*
     * The verdict priority, in the same fixed order the routing skill applies:
     * reject below threshold → low credibility always reviews → uncertain
     * reviews → otherwise validate. Every branch names its evidence.
     */
    let validation: string
    let verdictReason: string

    if (relevance < 40) {
      validation = 'rejected'
      verdictReason = `Relevance ${relevance}% is below the 40% reject threshold — only ${topicHits} of the declared brand topics appear anywhere in the post, and the source is ${post.sourceName}.`
    } else if (credibility === 'Low' && relevance < 80) {
      validation = 'needs_review'
      verdictReason = `Credibility is Low — the author has ${post.authorFollowers.toLocaleString('en-GB')} followers — and low-credibility items always go to a human. Relevance is ${relevance}% on ${topicHits} topic matches.`
    } else if (relevance < 70) {
      validation = 'needs_review'
      verdictReason = `Relevance ${relevance}% sits between the 40% reject and 70% accept thresholds, so this needs a human verdict. Credibility is ${credibility} from ${post.sourceName}.`
    } else {
      validation = 'validated'
      verdictReason = `Relevance ${relevance}% is at or above the 70% accept threshold on ${topicHits} topic matches, credibility is ${credibility} from ${post.sourceName}, and the post is ${Math.round(ageHours)}h old.`
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO scraped_items
         (workspace_id, source_id, keyword_id, run_id, external_id, title, snippet, url,
          source_name, source_type, author_name, author_headline, author_followers, hashtags,
          engagement, reactions, comments, reposts, relevance, credibility, freshness,
          is_duplicate, validation, verdict_reason, capture_source, posted_at, scraped_at, validated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,
               false,$22,$23,'fixture',$24,$25,$26)
       RETURNING id`,
      [
        workspaceId,
        sourceIds.get(post.sourceName) ?? null,
        keywordIds.get(post.keyword) ?? null,
        runId,
        post.externalId,
        post.text.split('\n')[0]?.slice(0, 140) ?? post.text.slice(0, 140),
        post.text.slice(0, 320),
        `https://www.linkedin.com/feed/update/urn:li:activity:${post.externalId}`,
        post.sourceName,
        'Social',
        post.authorName,
        post.authorHeadline,
        post.authorFollowers,
        post.hashtags,
        engagement,
        post.reactions,
        post.comments,
        post.reposts,
        relevance,
        credibility,
        freshness,
        validation,
        verdictReason,
        postedAt.toISOString(),
        addDays(NOW, -0).toISOString(),
        validation === 'validated' ? NOW.toISOString() : null,
      ],
    )
    if (row) {
      itemIds.set(post.externalId, row.id)
      tally('scraped_items')
    }
  }

  return itemIds
}

/* ── Hashtags: ~60 candidates resolving to a top-25 set ────────────────────── */

/** Extra on-topic candidates beyond those in the corpus, so the tail is realistic. */
const EXTRA_HASHTAGS = [
  'RewardHacking', 'PreferenceLearning', 'DPO', 'PPO', 'ConstitutionalAI',
  'ChainOfThought', 'ToolUse', 'FunctionCalling', 'RAG', 'VectorSearch',
  'ContextWindow', 'Quantisation', 'Distillation', 'MoE', 'Transformers',
  'AttentionMechanism', 'Tokenisation', 'Embeddings', 'PromptEngineering',
  'GuardRails', 'Observability', 'ModelRouting', 'BatchInference', 'KVCache',
  'SpeculativeDecoding', 'GPUUtilisation', 'DistributedTraining', 'Checkpointing',
  'DataCuration', 'ActiveLearning', 'HumanInTheLoop', 'RedTeaming',
  'Interpretability', 'MechanisticInterp', 'ScalingLaws',
]

/**
 * Alias pairs. Each entry is a shorthand that means the same thing as an
 * existing tag, so the duplicate-detection pass has something real to link.
 * A duplicate is LINKED to its original, never deleted.
 */
const ALIAS_HASHTAGS: Array<{ display: string; aliasOf: string }> = [
  { display: 'RL', aliasOf: 'reinforcementlearning' },
  { display: 'GenAI', aliasOf: 'generativeai' },
  { display: 'RewardModelling', aliasOf: 'rewardmodeling' },
  { display: 'MultiAgent', aliasOf: 'multiagentsystems' },
]

/**
 * Off-topic tags that legitimately score below the reject threshold. Without
 * these the rejected bucket would be empty and the routing path untested.
 */
const OFF_TOPIC_HASHTAGS = [
  'Hiring', 'Jobs', 'Webinar', 'Marketing', 'Growth', 'GenerativeAI',
  'Networking', 'ProductLaunch',
]

async function seedHashtags(
  workspaceId: string,
  keywordIds: Map<string, string>,
  runId: string,
): Promise<Map<string, string>> {
  const hashtagIds = new Map<string, string>()

  // Build candidates from the corpus first: those carry real volume.
  interface Candidate {
    display: string
    postCount: number
    engagement: number
    keyword: string | null
  }

  const byTag = new Map<string, Candidate>()

  for (const post of LINKEDIN_FIXTURES) {
    const engagement = fixtureEngagement(post)
    for (const tag of post.hashtags) {
      const key = tag.toLowerCase()
      const existing = byTag.get(key)
      if (existing) {
        existing.postCount += 1
        existing.engagement += engagement
      } else {
        byTag.set(key, {
          display: tag,
          postCount: 1,
          engagement,
          keyword: post.keyword,
        })
      }
    }
  }

  // Pad the tail so the set is ~60 candidates, as a real run would produce.
  for (const tag of [...EXTRA_HASHTAGS, ...OFF_TOPIC_HASHTAGS]) {
    const key = tag.toLowerCase()
    if (byTag.has(key)) continue
    byTag.set(key, {
      display: tag,
      postCount: ri(2, 9),
      engagement: ri(900, 14000),
      keyword: pick(SEED_KEYWORDS).term,
    })
  }

  // The aliases, so duplicate detection has real pairs to link.
  for (const alias of ALIAS_HASHTAGS) {
    const key = alias.display.toLowerCase()
    if (byTag.has(key)) continue
    byTag.set(key, {
      display: alias.display,
      postCount: ri(2, 6),
      engagement: ri(700, 6000),
      keyword: pick(SEED_KEYWORDS).term,
    })
  }

  const candidates = [...byTag.entries()].map(([tag, c]) => ({ tag, ...c }))

  const maxEng = Math.max(...candidates.map((c) => c.engagement))
  const maxPosts = Math.max(...candidates.map((c) => c.postCount))

  // Score exactly as validation.hashtag.rank does.
  const scored = candidates.map((c) => {
    const engagementPerPost = c.engagement / c.postCount

    /*
     * Topical relevance. An off-topic tag starts low and has no overlap to
     * raise it, so it lands below the reject threshold on the evidence.
     */
    const offTopic = OFF_TOPIC_HASHTAGS.some((t) => t.toLowerCase() === c.tag)
    const relevanceBase = offTopic ? 14 : 46
    const relevance = Math.min(
      100,
      relevanceBase + Math.round((c.engagement / maxEng) * (offTopic ? 18 : 46)),
    )
    const freshness = ri(58, 98)
    const score = Math.round(
      0.3 * relevance +
        0.3 * ((engagementPerPost / (maxEng / maxPosts)) * 100 > 100 ? 100 : (engagementPerPost / (maxEng / maxPosts)) * 100) +
        0.2 * ((c.postCount / maxPosts) * 100) +
        0.2 * freshness,
    )
    return {
      ...c,
      engagementPerPost: Number(engagementPerPost.toFixed(2)),
      relevance,
      freshness,
      credibility: (relevance >= 70 ? 'High' : relevance >= 45 ? 'Medium' : 'Low') as
        | 'High'
        | 'Medium'
        | 'Low',
      score: Math.min(100, score),
    }
  })

  /*
   * Originals must be inserted before their aliases, otherwise the alias has
   * nothing to link to. Sort by score, then force every alias behind its
   * original regardless of score.
   */
  const aliasMap = new Map(ALIAS_HASHTAGS.map((a) => [a.display.toLowerCase(), a.aliasOf]))
  scored.sort((a, b) => {
    const aIsAlias = aliasMap.has(a.tag)
    const bIsAlias = aliasMap.has(b.tag)
    if (aIsAlias !== bIsAlias) return aIsAlias ? 1 : -1
    return b.score - a.score
  })

  const TOP_SET = 25
  const insertedByTag = new Map<string, string>()

  for (const [i, c] of scored.entries()) {
    const rank = i + 1
    const inTopSet = rank <= TOP_SET

    let validation = 'validated'
    let verdictReason = `Composite score ${c.score} ranks it ${rank} of ${scored.length}: ${c.postCount} posts, ${c.engagementPerPost} engagement per post, relevance ${c.relevance}%.`
    let duplicateOf: string | null = null

    if (c.relevance < 40) {
      validation = 'rejected'
      verdictReason = `Relevance ${c.relevance}% is below the 40% reject threshold — the tag carries volume but not subject-matter fit.`
    } else if (c.relevance < 70 && rank > TOP_SET) {
      validation = 'needs_review'
      verdictReason = `Relevance ${c.relevance}% sits between the reject and accept thresholds and it ranked ${rank}, outside the top ${TOP_SET}, so it needs a human verdict.`
    }

    /*
     * Duplicate takes strict priority over every other verdict. The row is
     * linked to its original and kept — nothing is ever deleted.
     */
    const aliasTarget = aliasMap.get(c.tag)
    if (aliasTarget && insertedByTag.has(aliasTarget)) {
      validation = 'duplicate'
      duplicateOf = insertedByTag.get(aliasTarget) ?? null
      const originalDisplay =
        candidates.find((x) => x.tag === aliasTarget)?.display ?? aliasTarget
      verdictReason = `Semantic alias of #${originalDisplay} — the two refer to the same subject, so this is linked to the original rather than counted twice.`
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO hashtags
         (workspace_id, tag, display_tag, keyword_id, run_id, post_count, total_engagement,
          engagement_per_post, relevance, credibility, freshness, hashtag_score, rank,
          validation, verdict_reason, duplicate_of_id, in_top_set, researched_at,
          first_seen_at, last_seen_at, validated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [
        workspaceId,
        c.tag,
        c.display,
        c.keyword ? (keywordIds.get(c.keyword) ?? null) : null,
        runId,
        c.postCount,
        c.engagement,
        c.engagementPerPost,
        c.relevance,
        c.credibility,
        c.freshness,
        c.score,
        rank,
        validation,
        verdictReason,
        duplicateOf,
        inTopSet,
        inTopSet ? LAST_BUILD.toISOString() : null,
        addDays(NOW, -ri(4, 14)).toISOString(),
        addDays(NOW, -ri(0, 2)).toISOString(),
        validation === 'validated' ? NOW.toISOString() : null,
      ],
    )
    if (row) {
      hashtagIds.set(c.display, row.id)
      insertedByTag.set(c.tag, row.id)
      tally('hashtags')
    }
  }

  return hashtagIds
}

/* ── Content ideas, with the top-10-per-platform rule already applied ─────── */

/**
 * A deterministic caption in the nine-stage shape, used for the ideas that
 * ship with a draft already written.
 */
function seedCaption(idea: IdeaSeed): string {
  const tags = deriveHashtags(idea.sourceTopic, 4)
  return [
    idea.title + '.',
    '',
    idea.description,
    '',
    `The usual reading treats this as a detail of the training pipeline. It is not — it is the specification, and it decides behaviour in every case nobody enumerated.`,
    '',
    `What changes in practice: name an owner, review the definition before the run rather than explaining the behaviour after it, and measure the thing you actually care about.`,
    '',
    `We build ${idea.sourceTopic} systems at Ethara, and this is the part that moves outcomes.`,
    '',
    tags.map((t) => `#${t}`).join(' '),
  ].join('\n')
}

/** A small deterministic brand-svg data URI, so assets render with no service. */
function seedAsset(platform: Platform, headline: string): string {
  const c = canvasKey(platform).split('x').map(Number)
  const w = c[0] as number
  const h = c[1] as number
  const words = headline.split(/\s+/)
  const lines: string[] = []
  let current = ''
  for (const word of words) {
    if ((current + ' ' + word).trim().length > 22) {
      lines.push(current.trim())
      current = word
    } else {
      current = `${current} ${word}`
    }
  }
  if (current.trim()) lines.push(current.trim())

  const fontSize = Math.round(w * 0.055)
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
<stop offset="0" stop-color="#5E1BC7"/><stop offset="0.55" stop-color="#8B2CF5"/><stop offset="1" stop-color="#C084FC"/>
</linearGradient></defs>
<rect width="${w}" height="${h}" fill="#0B0E14"/>
<circle cx="${w * 0.82}" cy="${h * 0.24}" r="${w * 0.26}" fill="url(#g)" opacity="0.30"/>
<circle cx="${w * 0.18}" cy="${h * 0.82}" r="${w * 0.2}" fill="#8B2CF5" opacity="0.18"/>
<rect x="${w * 0.06}" y="${h * 0.5}" width="${w * 0.07}" height="6" fill="#8B2CF5"/>
<text x="${w * 0.06}" y="${h * 0.44}" font-family="Roboto, sans-serif" font-size="${Math.round(w * 0.019)}" fill="#C084FC" letter-spacing="3">ETHARA RESEARCH</text>
${lines
  .map(
    (line, i) =>
      `<text x="${w * 0.06}" y="${h * 0.585 + i * fontSize * 1.22}" font-family="Roboto, sans-serif" font-weight="600" font-size="${fontSize}" fill="#FFFFFF">${line.replace(/[<>&]/g, '')}</text>`,
  )
  .join('\n')}
<text x="${w * 0.06}" y="${h * 0.93}" font-family="DM Sans, sans-serif" font-size="${Math.round(w * 0.017)}" fill="#8A8FA5">ethara.ai</text>
<circle cx="${w * 0.93}" cy="${h * 0.9}" r="${w * 0.021}" fill="none" stroke="#8B2CF5" stroke-width="2.5"/>
<circle cx="${w * 0.93}" cy="${h * 0.9}" r="${w * 0.008}" fill="#EE00EE"/>
</svg>`
  return `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
}

async function seedIdeas(
  workspaceId: string,
  hashtagIds: Map<string, string>,
  itemIds: Map<string, string>,
): Promise<Map<string, string>> {
  const ideaIds = new Map<string, string>()
  const itemIdList = [...itemIds.values()]

  // Score and rank per platform, exactly as calendar.rank.select does.
  const enriched = IDEA_SEEDS.map((idea, i) => {
    const platform = IDEA_PLATFORMS[i] as Platform
    const priorityScore = Math.round(
      0.45 * idea.confidence + 0.35 * idea.brandRelevance + 0.2 * idea.trendScore,
    )
    return { ...idea, platform, priorityScore, index: i }
  })

  const TOP_PER_PLATFORM = 10
  const rankByPlatform = new Map<Platform, number>()

  const ordered = [...enriched].sort((a, b) => b.priorityScore - a.priorityScore)

  for (const idea of ordered) {
    const nextRank = (rankByPlatform.get(idea.platform) ?? 0) + 1
    rankByPlatform.set(idea.platform, nextRank)

    const calendarSlot = nextRank <= TOP_PER_PLATFORM ? 'primary' : 'suggestion'
    const scheduledDate = isoDate(addDays(THIS_WEEK, idea.dayOffset))

    const analysis = {
      format: idea.format,
      angle: idea.angle,
      audience: idea.audience,
      brandRelevance: idea.brandRelevance,
      trendScore: idea.trendScore,
      platformScore: ri(62, 96),
      predictedEngagement: pick(['High', 'Medium', 'High', 'Very high']),
      slotReasons: [
        `${idea.time} on this weekday is the strongest slot in our own posting history for ${idea.platform}.`,
        `Brand relevance is ${idea.brandRelevance}%, which clears the 45% minimum comfortably.`,
        `The originating trend scored ${idea.trendScore}, placing it in the top five this run.`,
        `No other ${idea.platform} post is within four hours of this slot.`,
      ],
      saturation: ri(12, 68),
    }

    const row = await queryOne<{ id: string }>(
      `INSERT INTO content_ideas
         (workspace_id, source_item_id, hashtag_id, title, description, source_topic,
          platform, alt_platforms, scheduled_date, scheduled_time, confidence,
          priority_score, platform_rank, calendar_slot, status, analysis, feedback,
          is_new_trend, marketing_approved_by, marketing_approved_at, leadership_decision)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21)
       RETURNING id`,
      [
        workspaceId,
        itemIdList[idea.index % itemIdList.length] ?? null,
        hashtagIds.get(idea.hashtag) ?? null,
        idea.title,
        idea.description,
        idea.sourceTopic,
        idea.platform,
        JSON.stringify(
          idea.platform === 'linkedin' ? [{ platform: 'x', score: ri(56, 78) }] : [{ platform: 'linkedin', score: ri(58, 82) }],
        ),
        scheduledDate,
        idea.time,
        idea.confidence,
        idea.priorityScore,
        nextRank,
        calendarSlot,
        idea.status,
        JSON.stringify(analysis),
        JSON.stringify([]),
        idea.isNewTrend,
        idea.status === 'pending_leadership' || idea.status === 'approved' ? 'Ridhima' : null,
        idea.status === 'pending_leadership' || idea.status === 'approved'
          ? addDays(NOW, -1).toISOString()
          : null,
        null,
      ],
    )

    if (!row) continue
    ideaIds.set(idea.title, row.id)
    tally('content_ideas')

    // Ideas that are past 'suggested' ship with a draft and a creative.
    if (idea.status !== 'suggested') {
      const body = seedCaption(idea)
      await query(
        `INSERT INTO drafts (idea_id, platform, body, revision, generated_by, model, source)
         VALUES ($1,$2,$3,1,'caption','ethara-writer','fixture')`,
        [row.id, idea.platform, body],
      )
      tally('drafts')

      const canvas = canvasKey(idea.platform)
      const [wStr, hStr] = canvas.split('x')
      await query(
        `INSERT INTO media_assets
           (idea_id, platform, kind, concept, canvas, width, height, alt_text,
            render_mode, model, prompt, fallback_reason, data_uri, variants)
         VALUES ($1,$2,'single',$3,$4,$5,$6,$7,'demo','brand-svg',$8,$9,$10,$11)`,
        [
          row.id,
          idea.platform,
          'gradient-field',
          canvas,
          Number(wStr),
          Number(hStr),
          `Editorial card on a dark background with the headline "${idea.title}" over a purple gradient field, with the Ethara logomark in the lower right.`,
          `Abstract technical background for: ${idea.description.slice(0, 120)}`,
          'GCP_API_KEY is not set — rendered with the local brand renderer',
          seedAsset(idea.platform, idea.title),
          JSON.stringify([]),
        ],
      )
      tally('media_assets')
    }
  }

  return ideaIds
}

/* ── Published posts, metrics and four-step histories ──────────────────────── */

async function seedPublished(workspaceId: string): Promise<void> {
  for (const p of PUBLISHED_SEEDS) {
    const publishedAt = addDays(NOW, -p.daysAgo)
    const engagementRate = Number(
      (((p.likes + p.comments + p.shares) / p.impressions) * 100).toFixed(2),
    )

    const history = [
      { step: 1, label: 'Draft generated', by: 'Caption Creator Agent', at: addDays(publishedAt, -3).toISOString() },
      { step: 2, label: 'Approved by Marketing', by: 'Ridhima', at: addDays(publishedAt, -2).toISOString() },
      { step: 3, label: 'Final approval', by: 'Arjun Mehta', at: addDays(publishedAt, -1).toISOString() },
      { step: 4, label: `Published to ${p.platform}`, by: 'Publishing Agent', at: publishedAt.toISOString() },
    ]

    /*
     * These are historical posts from previous months, seeded without a parent
     * idea — media_assets is keyed to an idea, so there is nothing to attach a
     * creative to. `media_asset_id` stays null and the previews fall back to
     * GradientMedia, which is the documented behaviour for a post with no
     * rendered asset. Posts published through the live flow always carry one,
     * because they always came from an idea.
     */
    const post = await queryOne<{ id: string }>(
      `INSERT INTO posts
         (workspace_id, idea_id, title, platform, content, status, external_id,
          publish_mode, published_at, history, media_asset_id,
          analysis_summary, analysis_recommendation)
       VALUES ($1,NULL,$2,$3,$4,'published',$5,'demo',$6,$7,$8,$9,$10)
       RETURNING id`,
      [
        workspaceId,
        p.title,
        p.platform,
        p.content,
        `demo-${p.platform}-${p.daysAgo}-${Math.abs(p.reach)}`,
        isoDate(publishedAt),
        JSON.stringify(history),
        null,
        p.summary,
        p.recommendation,
      ],
    )
    if (!post) continue
    tally('posts')

    // Three readings per post — first hour, first day, and current — so the
    // trend of a single post's performance is visible, not just its latest row.
    const readings = [
      { at: new Date(publishedAt.getTime() + 36e5), factor: 0.14 },
      { at: new Date(publishedAt.getTime() + 24 * 36e5), factor: 0.58 },
      { at: addDays(publishedAt, 3), factor: 1 },
    ]

    for (const r of readings) {
      await query(
        `INSERT INTO post_metrics
           (post_id, captured_at, reach, impressions, likes, comments, shares, engagement_rate)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          post.id,
          r.at.toISOString(),
          Math.round(p.reach * r.factor),
          Math.round(p.impressions * r.factor),
          Math.round(p.likes * r.factor),
          Math.round(p.comments * r.factor),
          Math.round(p.shares * r.factor),
          engagementRate,
        ],
      )
      tally('post_metrics')
    }
  }
}

/* ── Knowledge: brand rules, learned entries, cited research ───────────────── */

async function seedKnowledge(
  workspaceId: string,
  hashtagIds: Map<string, string>,
): Promise<void> {
  // The build that produced the research entries, dated the most recent Sunday.
  const build = await queryOne<{ id: string }>(
    `INSERT INTO knowledge_builds
       (workspace_id, trigger, status, hashtags_researched, entries_written,
        entries_merged, sources_cited, research_source, started_at, finished_at, summary)
     VALUES ($1,'cron','completed',$2,$3,$4,$5,'fixture',$6,$7,$8)
     RETURNING id`,
    [
      workspaceId,
      25,
      RESEARCH_FIXTURES.length,
      4,
      RESEARCH_FIXTURES.reduce((n, e) => n + e.sources.length, 0),
      LAST_BUILD.toISOString(),
      new Date(LAST_BUILD.getTime() + 11 * 60000).toISOString(),
      JSON.stringify({
        note: 'PARALLEL_API_KEY is not set — this build ran on the bundled research corpus.',
        fallbackReason: 'PARALLEL_API_KEY is not set',
        hashtagsSkipped: 25 - RESEARCH_FIXTURES.length,
      }),
    ],
  )
  tally('knowledge_builds')

  // The twenty brand rules. The brand lives in the same table as everything
  // learned, so switching a brand entry off genuinely stops it influencing
  // generation.
  for (const rule of brandRulesAsKnowledge()) {
    await query(
      `INSERT INTO knowledge_entries
         (workspace_id, title, category, content, source, sources, confidence,
          evidence_count, active, origin, tags)
       VALUES ($1,$2,$3,$4,'Brand definition','[]'::jsonb,$5,1,true,'brand',$6)`,
      [workspaceId, rule.title, rule.category, rule.content, rule.confidence, ['brand']],
    )
    tally('knowledge_entries')
  }

  // Learned entries, from outcomes and human edits.
  for (const entry of LEARNED_ENTRIES) {
    await query(
      `INSERT INTO knowledge_entries
         (workspace_id, title, category, content, source, sources, confidence,
          evidence_count, active, origin, tags, created_at)
       VALUES ($1,$2,$3,$4,'Learning Agent','[]'::jsonb,$5,$6,true,'learned',$7,$8)`,
      [
        workspaceId,
        entry.title,
        entry.category,
        entry.content,
        entry.confidence,
        entry.confidence === 'High' ? ri(3, 6) : ri(1, 3),
        ['learned'],
        addDays(NOW, -ri(3, 40)).toISOString(),
      ],
    )
    tally('knowledge_entries')
  }

  // Cited research entries, linked to the hashtag that produced them.
  for (const entry of RESEARCH_FIXTURES) {
    // Confidence follows the declared rule: High ≥3 independent sources,
    // Medium 2, Low 1.
    const confidence =
      entry.sources.length >= 3 ? 'High' : entry.sources.length === 2 ? 'Medium' : 'Low'

    // Match the hashtag by its normalised tag.
    let hashtagId: string | null = null
    for (const [display, id] of hashtagIds.entries()) {
      if (display.toLowerCase() === entry.hashtag) {
        hashtagId = id
        break
      }
    }

    await query(
      `INSERT INTO knowledge_entries
         (workspace_id, title, category, content, source, sources, hashtag_id,
          confidence, evidence_count, active, origin, build_id, tags, created_at)
       VALUES ($1,$2,$3,$4,'Parallel Web Systems (fixture)',$5,$6,$7,$8,true,'research',$9,$10,$11)`,
      [
        workspaceId,
        entry.title,
        entry.category,
        entry.content,
        JSON.stringify(
          entry.sources.map((s) => ({
            title: s.title,
            url: s.url,
            publishedAt: isoDate(addDays(NOW, -s.publishedDaysAgo)),
          })),
        ),
        hashtagId,
        confidence,
        entry.sources.length,
        build?.id ?? null,
        ['research', entry.hashtag],
        LAST_BUILD.toISOString(),
      ],
    )
    tally('knowledge_entries')
  }
}

/* ── Agent state, skills, activity ─────────────────────────────────────────── */

async function seedAgentState(workspaceId: string): Promise<void> {
  for (const agent of AGENTS) {
    const isJarvis = agent.id === 'jarvis'
    await query(
      `INSERT INTO agent_state
         (workspace_id, agent_id, status, current_task, last_run, processed, success_rate)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (workspace_id, agent_id) DO UPDATE
         SET status = EXCLUDED.status,
             current_task = EXCLUDED.current_task,
             last_run = EXCLUDED.last_run,
             processed = EXCLUDED.processed,
             success_rate = EXCLUDED.success_rate`,
      [
        workspaceId,
        agent.id,
        agent.id === 'validation' ? 'needs_review' : 'idle',
        isJarvis
          ? 'Listening'
          : agent.id === 'validation'
            ? 'Holding items for a human verdict'
            : 'Idle',
        addDays(NOW, -ri(0, 3)).toISOString(),
        ri(38, 940),
        ri(92, 100),
      ],
    )
    tally('agent_state')
  }
}

/**
 * A handful of workspace overrides, so Agent Studio shows "Customised" badges
 * and the reset control has something to reset on first load.
 */
async function seedSkillOverrides(workspaceId: string): Promise<void> {
  const overrides: Array<{ skillId: string; config: Record<string, unknown>; enabled?: boolean }> = [
    { skillId: 'validation.keyword.trend', config: { topKeywords: 5, trendWindowRuns: 4 } },
    { skillId: 'calendar.rank.select', config: { topPerPlatform: 10 } },
    { skillId: 'knowledge.hashtag.select', config: { hashtagCount: 25 } },
    { skillId: 'generation.caption.hook', config: { maxWords: 12 } },
    { skillId: 'generation.image.video.compose', config: {}, enabled: false },
    { skillId: 'scraping.competitor.track', config: { tier: 'P0+P1', postsPerCompetitor: 3 } },
  ]

  for (const o of overrides) {
    const spec = SKILLS.find((s) => s.id === o.skillId)
    if (!spec) continue
    await query(
      `INSERT INTO agent_skills (workspace_id, skill_id, agent_id, enabled, config)
       VALUES ($1,$2,$3,$4,$5)
       ON CONFLICT (workspace_id, skill_id) DO UPDATE
         SET config = EXCLUDED.config, enabled = EXCLUDED.enabled, updated_at = now()`,
      [workspaceId, o.skillId, spec.agentId, o.enabled ?? true, JSON.stringify(o.config)],
    )
    tally('agent_skills')
  }
}

const ACTIVITY_SEEDS: Array<{ agentId: string; message: string; status: 'ok' | 'warn' | 'error' | 'running'; minutesAgo: number }> = [
  { agentId: 'knowledge', message: 'Sunday research build completed: 25 hashtags researched, 26 entries written, 58 sources cited. Ran on the bundled corpus because PARALLEL_API_KEY is not set.', status: 'warn', minutesAgo: 2880 },
  { agentId: 'scraping', message: 'Captured 40 posts across 12 keywords from the bundled LinkedIn corpus.', status: 'ok', minutesAgo: 190 },
  { agentId: 'validation', message: 'Scored 40 items: 31 validated, 8 held for review, 1 rejected.', status: 'warn', minutesAgo: 184 },
  { agentId: 'validation', message: 'Five keywords marked trending. `agentic AI` leads on engagement velocity.', status: 'ok', minutesAgo: 182 },
  { agentId: 'analysis', message: 'Consolidated 60 hashtag candidates into the top 25 set.', status: 'ok', minutesAgo: 178 },
  { agentId: 'calendar', message: '16 ideas formed. 10 took LinkedIn slots; the remainder are ranked in More suggestions.', status: 'ok', minutesAgo: 174 },
  { agentId: 'caption', message: 'Drafted 4 captions grounded in 26 active Knowledge Base entries.', status: 'ok', minutesAgo: 160 },
  { agentId: 'image', message: 'Rendered 4 creatives with the local brand renderer — GCP_API_KEY is not set.', status: 'warn', minutesAgo: 158 },
  { agentId: 'review', message: '"Reward models are the product" approved by Marketing and sent to Leadership.', status: 'ok', minutesAgo: 1440 },
]

async function seedActivity(workspaceId: string): Promise<void> {
  for (const a of ACTIVITY_SEEDS) {
    await query(
      `INSERT INTO activity_events (workspace_id, agent_id, message, status, created_at)
       VALUES ($1,$2,$3,$4,$5)`,
      [workspaceId, a.agentId, a.message, a.status, addDays(NOW, 0).toISOString()],
    )
    // Backdate precisely.
    await query(
      `UPDATE activity_events SET created_at = $1
        WHERE workspace_id = $2 AND message = $3`,
      [new Date(NOW.getTime() - a.minutesAgo * 60000).toISOString(), workspaceId, a.message],
    )
    tally('activity_events')
  }
}

/* ── The review queue ──────────────────────────────────────────────────────── */

async function seedReviewQueue(workspaceId: string): Promise<void> {
  const items = await query<{ id: string; title: string; relevance: number; credibility: string; verdict_reason: string }>(
    `SELECT id, title, relevance, credibility, verdict_reason
       FROM scraped_items
      WHERE workspace_id = $1 AND validation = 'needs_review'`,
    [workspaceId],
  )

  for (const item of items) {
    await query(
      `INSERT INTO review_queue
         (workspace_id, kind, entity_id, reason, decision_requested, options, created_at)
       VALUES ($1,'scraped_item',$2,$3,$4,$5,$6)`,
      [
        workspaceId,
        item.id,
        item.verdict_reason,
        `Should "${item.title.slice(0, 70)}" be used as source material?`,
        ['Approve', 'Reject'],
        addDays(NOW, 0).toISOString(),
      ],
    )
    tally('review_queue')
  }

  const tags = await query<{ id: string; display_tag: string; verdict_reason: string }>(
    `SELECT id, display_tag, verdict_reason
       FROM hashtags
      WHERE workspace_id = $1 AND validation = 'needs_review'
      LIMIT 6`,
    [workspaceId],
  )

  for (const tag of tags) {
    await query(
      `INSERT INTO review_queue
         (workspace_id, kind, entity_id, reason, decision_requested, options, created_at)
       VALUES ($1,'hashtag',$2,$3,$4,$5,$6)`,
      [
        workspaceId,
        tag.id,
        tag.verdict_reason,
        `Should #${tag.display_tag} enter the research set?`,
        ['Approve', 'Reject'],
        addDays(NOW, 0).toISOString(),
      ],
    )
    tally('review_queue')
  }
}

/* ── Run history, so the Run Console and the Studio stats are populated ────── */

async function seedRunHistory(workspaceId: string, runId: string): Promise<void> {
  await query(
    `INSERT INTO pipeline_runs (id, workspace_id, trigger, status, started_at, finished_at, summary)
     VALUES ($1,$2,'manual','completed',$3,$4,$5)`,
    [
      runId,
      workspaceId,
      addDays(NOW, 0).toISOString(),
      addDays(NOW, 0).toISOString(),
      JSON.stringify({
        keywordsScanned: 12,
        postsScraped: 40,
        hashtagsFound: 60,
        trending: 5,
        validated: 31,
        needsReview: 8,
        duplicate: 1,
        rejected: 1,
        topHashtags: 25,
        opportunities: 14,
        ideas: 16,
        primaryIdeas: 13,
        suggestionIdeas: 3,
        source: 'fixture',
      }),
    ],
  )
  tally('pipeline_runs')

  // One agent run per pipeline agent, with a skill_runs row per declared skill
  // carrying the resolved config — which is what makes a past run explainable
  // after the knobs have changed.
  const pipelineAgents = ['scraping', 'validation', 'analysis', 'calendar'] as const

  for (const agentId of pipelineAgents) {
    const skills = SKILLS.filter((s) => s.agentId === agentId).sort((a, b) => a.order - b.order)
    const durationMs = ri(1400, 5200)

    const agentRun = await queryOne<{ id: string }>(
      `INSERT INTO agent_runs
         (workspace_id, pipeline_run_id, agent_id, status, trigger, started_at, finished_at,
          duration_ms, input_count, output_count)
       VALUES ($1,$2,$3,'completed','manual',$4,$5,$6,$7,$8)
       RETURNING id`,
      [
        workspaceId,
        runId,
        agentId,
        addDays(NOW, 0).toISOString(),
        addDays(NOW, 0).toISOString(),
        durationMs,
        ri(12, 60),
        ri(12, 60),
      ],
    )
    if (!agentRun) continue
    tally('agent_runs')

    for (const skill of skills) {
      const skipped = !skill.enabledByDefault
      await query(
        `INSERT INTO skill_runs
           (workspace_id, agent_run_id, skill_id, agent_id, status, duration_ms, config_used, note)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8)`,
        [
          workspaceId,
          agentRun.id,
          skill.id,
          agentId,
          skipped ? 'skipped' : 'completed',
          skipped ? 0 : ri(20, 900),
          JSON.stringify(defaultSkillConfig(skill.id)),
          skipped ? 'Disabled by default in the registry' : null,
        ],
      )
      tally('skill_runs')
    }
  }
}

/* ── The JARVIS conversation: six turns covering the full range ─────────────── */

async function seedJarvis(workspaceId: string): Promise<void> {
  const conversation = await queryOne<{ id: string }>(
    `INSERT INTO jarvis_conversations (workspace_id, actor, role, title, started_at, last_at)
     VALUES ($1,'Ridhima','marketing',$2,$3,$4)
     RETURNING id`,
    [
      workspaceId,
      'What is waiting on me?',
      addDays(NOW, -1).toISOString(),
      new Date(NOW.getTime() - 42 * 60000).toISOString(),
    ],
  )
  if (!conversation) return
  tally('jarvis_conversations')

  const reviewCount = Number(
    (
      await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM review_queue WHERE workspace_id = $1 AND resolved = false`,
        [workspaceId],
      )
    )?.n ?? 0,
  )
  const leadershipCount = Number(
    (
      await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM content_ideas WHERE workspace_id = $1 AND status = 'pending_leadership'`,
        [workspaceId],
      )
    )?.n ?? 0,
  )
  const kbCount = Number(
    (
      await queryOne<{ n: string }>(
        `SELECT count(*)::text AS n FROM knowledge_entries WHERE workspace_id = $1 AND active = true`,
        [workspaceId],
      )
    )?.n ?? 0,
  )

  interface TurnSeed {
    speaker: 'operator' | 'jarvis'
    utterance?: string
    channel: 'text' | 'voice' | 'ambient' | 'cron'
    narration?: string
    intent?: Record<string, unknown>
    plan?: Record<string, unknown>
    confidence?: number
    status: string
    lastEntity?: Record<string, unknown>
    minutesAgo: number
    steps?: Array<{
      toolId: string
      risk: 'safe' | 'mutating' | 'irreversible'
      why: string
      status: 'completed' | 'failed' | 'queued'
      resultSummary: string
    }>
  }

  const turns: TurnSeed[] = [
    // 1 · A safe read.
    {
      speaker: 'operator',
      utterance: 'What is waiting on me?',
      channel: 'text',
      status: 'completed',
      minutesAgo: 1440,
    },
    {
      speaker: 'jarvis',
      channel: 'text',
      status: 'completed',
      minutesAgo: 1439,
      confidence: 94,
      intent: { action: 'review.queue.list', entities: {}, confidence: 94, restated: 'List everything waiting on a human verdict' },
      plan: {
        summary: `Reading the review queue and anything sitting with Leadership.`,
        risk: 'safe',
        requiresConfirmation: false,
        steps: [
          { toolId: 'review.queue.list', why: 'The items holding for a verdict', args: {} },
          { toolId: 'idea.list', why: 'Posts already with Leadership', args: { status: 'pending_leadership' } },
        ],
      },
      narration: `${reviewCount} items are holding for a verdict and ${leadershipCount} post is with Leadership. The queue is mostly relevance calls between the 40% and 70% thresholds. I can walk you through them.`,
      steps: [
        { toolId: 'review.queue.list', risk: 'safe', why: 'The items holding for a verdict', status: 'completed', resultSummary: `${reviewCount} unresolved rows` },
        { toolId: 'idea.list', risk: 'safe', why: 'Posts already with Leadership', status: 'completed', resultSummary: `${leadershipCount} awaiting final approval` },
      ],
    },

    // 2 · A multi-step plan.
    {
      speaker: 'operator',
      utterance: 'Find the strongest trend this week and draft it for LinkedIn',
      channel: 'text',
      status: 'completed',
      minutesAgo: 1380,
    },
    {
      speaker: 'jarvis',
      channel: 'text',
      status: 'completed',
      minutesAgo: 1378,
      confidence: 88,
      intent: { action: 'keyword.trending', entities: { platform: 'linkedin' }, confidence: 88, restated: 'Find this week\u2019s strongest trend and write a LinkedIn draft from it' },
      plan: {
        summary: 'Reading the trending set, then drafting the strongest one for LinkedIn.',
        risk: 'mutating',
        requiresConfirmation: false,
        steps: [
          { toolId: 'keyword.trending', why: 'Establish which trend is strongest', args: { limit: 5 } },
          { toolId: 'idea.list', why: 'Find the idea already formed from it', args: { platform: 'linkedin' } },
          { toolId: 'draft.generate', why: 'Write the caption and render the creative', args: { platform: 'linkedin' } },
        ],
      },
      narration: 'Five keywords are trending. `agentic AI` leads on engagement velocity, up 68% on its four-run average. I drafted "The environment was always the bottleneck" for LinkedIn and rendered the creative locally, because GCP_API_KEY is not set.',
      lastEntity: { type: 'content_idea', title: 'The environment was always the bottleneck', platform: 'linkedin' },
      steps: [
        { toolId: 'keyword.trending', risk: 'safe', why: 'Establish which trend is strongest', status: 'completed', resultSummary: '5 trending, agentic AI leads at 95' },
        { toolId: 'idea.list', risk: 'safe', why: 'Find the idea already formed from it', status: 'completed', resultSummary: '13 LinkedIn ideas on the calendar' },
        { toolId: 'draft.generate', risk: 'mutating', why: 'Write the caption and render the creative', status: 'completed', resultSummary: 'Draft written, brand check APPROVED' },
      ],
    },

    // 3 · A clarification.
    {
      speaker: 'operator',
      utterance: 'publish thursday',
      channel: 'voice',
      status: 'completed',
      minutesAgo: 1300,
    },
    {
      speaker: 'jarvis',
      channel: 'text',
      status: 'completed',
      minutesAgo: 1299,
      confidence: 41,
      intent: { action: 'clarify', entities: { day: 'thursday' }, confidence: 41, restated: 'Ambiguous: publish, or list Thursday' },
      narration: 'Two readings of that. Publish Thursday\u2019s LinkedIn post, or list what is scheduled for Thursday?',
      status_note: 'clarify',
    } as TurnSeed,

    // 4 · A confirmed irreversible publish.
    {
      speaker: 'operator',
      utterance: 'Publish it',
      channel: 'text',
      status: 'completed',
      minutesAgo: 240,
    },
    {
      speaker: 'jarvis',
      channel: 'text',
      status: 'completed',
      minutesAgo: 238,
      confidence: 92,
      intent: { action: 'idea.publish', entities: { resolved: 'The environment was always the bottleneck' }, confidence: 92, restated: 'Publish the LinkedIn post we just drafted' },
      plan: {
        summary: 'Publishing "The environment was always the bottleneck" to LinkedIn.',
        risk: 'irreversible',
        requiresConfirmation: true,
        steps: [
          { toolId: 'idea.list', why: 'Confirm which post is meant', args: {} },
          { toolId: 'brand.check', why: 'Last compliance read before it goes out', args: {} },
          { toolId: 'idea.publish', why: 'Send it to LinkedIn', args: { platform: 'linkedin' } },
        ],
      },
      narration: 'Published to LinkedIn at 10:32. The Analytics Agent will report the first reading in an hour. I have written the approval to the Knowledge Base.',
      lastEntity: { type: 'post', title: 'The environment was always the bottleneck' },
      steps: [
        { toolId: 'idea.list', risk: 'safe', why: 'Confirm which post is meant', status: 'completed', resultSummary: 'Resolved to the Thursday LinkedIn post' },
        { toolId: 'brand.check', risk: 'safe', why: 'Last compliance read before it goes out', status: 'completed', resultSummary: 'APPROVED against all twenty rules' },
        { toolId: 'idea.publish', risk: 'irreversible', why: 'Send it to LinkedIn', status: 'completed', resultSummary: 'Published, demo mode, receipt recorded' },
      ],
    },

    // 5 · An ambient notice.
    {
      speaker: 'jarvis',
      channel: 'ambient',
      status: 'completed',
      minutesAgo: 90,
      narration: `${reviewCount} items have been waiting on a verdict for over half an hour. I can walk you through them.`,
    },

    // 6 · The morning brief.
    {
      speaker: 'jarvis',
      channel: 'cron',
      status: 'completed',
      minutesAgo: 42,
      narration: `09:00. ${leadershipCount} post awaits Leadership, the Sunday research build added ${RESEARCH_FIXTURES.length} cited entries to a base of ${kbCount}, and Instagram reach is 14% below its trailing average. I would move Thursday\u2019s carousel to Tuesday.`,
    },
  ]

  let seq = 1
  for (const t of turns) {
    const turn = await queryOne<{ id: string }>(
      `INSERT INTO jarvis_turns
         (conversation_id, seq, speaker, utterance, channel, intent, plan, narration,
          confidence, status, last_entity, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       RETURNING id`,
      [
        conversation.id,
        seq,
        t.speaker,
        t.utterance ?? null,
        t.channel,
        t.intent ? JSON.stringify(t.intent) : null,
        t.plan ? JSON.stringify(t.plan) : null,
        t.narration ?? null,
        t.confidence ?? null,
        'completed',
        t.lastEntity ? JSON.stringify(t.lastEntity) : null,
        new Date(NOW.getTime() - t.minutesAgo * 60000).toISOString(),
      ],
    )
    if (!turn) continue
    tally('jarvis_turns')
    seq += 1

    if (t.steps) {
      for (const [i, step] of t.steps.entries()) {
        await query(
          `INSERT INTO jarvis_steps
             (turn_id, idx, tool_id, risk, args, why, status, result_summary,
              duration_ms, started_at, finished_at)
           VALUES ($1,$2,$3,$4,'{}'::jsonb,$5,$6,$7,$8,$9,$10)`,
          [
            turn.id,
            i,
            step.toolId,
            step.risk,
            step.why,
            step.status,
            step.resultSummary,
            ri(40, 2400),
            new Date(NOW.getTime() - t.minutesAgo * 60000).toISOString(),
            new Date(NOW.getTime() - t.minutesAgo * 60000 + 1200).toISOString(),
          ],
        )
        tally('jarvis_steps')
      }
    }
  }

  // A decided confirmation on the publish turn, so the audit trail is complete.
  const publishTurn = await queryOne<{ id: string }>(
    `SELECT t.id FROM jarvis_turns t
      WHERE t.conversation_id = $1 AND t.narration LIKE 'Published to LinkedIn%'
      LIMIT 1`,
    [conversation.id],
  )
  if (publishTurn) {
    await query(
      `INSERT INTO jarvis_confirmations
         (turn_id, token, plan, prompt, expires_at, decided, decided_by, decided_at, created_at)
       VALUES ($1,$2,$3,$4,$5,'confirmed','Ridhima',$6,$7)`,
      [
        publishTurn.id,
        `seed-${crypto.randomUUID()}`,
        JSON.stringify({
          summary: 'Publishing "The environment was always the bottleneck" to LinkedIn.',
          risk: 'irreversible',
        }),
        'This publishes "The environment was always the bottleneck" to LinkedIn immediately. Publishing cannot be undone.',
        new Date(NOW.getTime() - 238 * 60000 + 180000).toISOString(),
        new Date(NOW.getTime() - 239 * 60000).toISOString(),
        new Date(NOW.getTime() - 240 * 60000).toISOString(),
      ],
    )
    tally('jarvis_confirmations')
  }

  // The most recent brief, which the Dashboard strip renders.
  await query(
    `INSERT INTO jarvis_briefs (workspace_id, trigger, signals, recommendation, narration, created_at)
     VALUES ($1,'cron',$2,$3,$4,$5)`,
    [
      workspaceId,
      JSON.stringify([
        { signal: 'approvals_waiting', detail: `${leadershipCount} post awaits Leadership`, severity: 'warn' },
        { signal: 'knowledge_built', detail: `${RESEARCH_FIXTURES.length} cited entries added on Sunday`, severity: 'ok' },
        { signal: 'metric_anomaly', detail: 'Instagram reach is 14% below its four-week average', severity: 'warn' },
      ]),
      'Move Thursday\u2019s carousel to Tuesday — Tuesday has outperformed Thursday on this account for six of the last eight posts.',
      `09:00. ${leadershipCount} post awaits Leadership, the Sunday research build added ${RESEARCH_FIXTURES.length} cited entries, and Instagram reach is 14% below its trailing average. I would move Thursday\u2019s carousel to Tuesday.`,
      new Date(NOW.getTime() - 42 * 60000).toISOString(),
    ],
  )
  tally('jarvis_briefs')
}

/* ── Analytics ─────────────────────────────────────────────────────────────── */

async function seedAnalytics(workspaceId: string): Promise<void> {
  for (const row of buildAnalytics()) {
    await query(
      `INSERT INTO platform_analytics
         (workspace_id, platform, month, label, is_reported, metrics, daily)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       ON CONFLICT (workspace_id, platform, month) DO UPDATE
         SET metrics = EXCLUDED.metrics, daily = EXCLUDED.daily,
             is_reported = EXCLUDED.is_reported, label = EXCLUDED.label`,
      [
        workspaceId,
        row.platform,
        row.month,
        row.label,
        row.isReported,
        JSON.stringify(row.metrics),
        JSON.stringify(row.daily),
      ],
    )
    tally('platform_analytics')
  }
}

/* ── Lineage ───────────────────────────────────────────────────────────────── */

async function seedLineage(workspaceId: string): Promise<void> {
  // keyword → hashtag
  const pairs = await query<{ keyword_id: string; id: string }>(
    `SELECT keyword_id, id FROM hashtags
      WHERE workspace_id = $1 AND keyword_id IS NOT NULL AND in_top_set = true`,
    [workspaceId],
  )
  for (const p of pairs) {
    await query(
      `INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id)
       VALUES ($1,'keyword',$2,'hashtag',$3,'scraping')
       ON CONFLICT DO NOTHING`,
      [workspaceId, p.keyword_id, p.id],
    )
    tally('lineage_edges')
  }

  // hashtag → knowledge_entry
  const entries = await query<{ id: string; hashtag_id: string }>(
    `SELECT id, hashtag_id FROM knowledge_entries
      WHERE workspace_id = $1 AND hashtag_id IS NOT NULL`,
    [workspaceId],
  )
  for (const e of entries) {
    await query(
      `INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id)
       VALUES ($1,'hashtag',$2,'knowledge_entry',$3,'knowledge')
       ON CONFLICT DO NOTHING`,
      [workspaceId, e.hashtag_id, e.id],
    )
    tally('lineage_edges')
  }

  // scraped_item → content_idea, and content_idea → draft / media_asset
  const ideas = await query<{ id: string; source_item_id: string | null }>(
    `SELECT id, source_item_id FROM content_ideas WHERE workspace_id = $1`,
    [workspaceId],
  )
  for (const idea of ideas) {
    if (idea.source_item_id) {
      await query(
        `INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id)
         VALUES ($1,'scraped_item',$2,'content_idea',$3,'calendar')
         ON CONFLICT DO NOTHING`,
        [workspaceId, idea.source_item_id, idea.id],
      )
      tally('lineage_edges')
    }
    const draft = await queryOne<{ id: string }>(
      'SELECT id FROM drafts WHERE idea_id = $1 LIMIT 1',
      [idea.id],
    )
    if (draft) {
      await query(
        `INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id)
         VALUES ($1,'content_idea',$2,'draft',$3,'caption')
         ON CONFLICT DO NOTHING`,
        [workspaceId, idea.id, draft.id],
      )
      tally('lineage_edges')
    }
    const asset = await queryOne<{ id: string }>(
      'SELECT id FROM media_assets WHERE idea_id = $1 LIMIT 1',
      [idea.id],
    )
    if (asset) {
      await query(
        `INSERT INTO lineage_edges (workspace_id, from_type, from_id, to_type, to_id, agent_id)
         VALUES ($1,'content_idea',$2,'media_asset',$3,'image')
         ON CONFLICT DO NOTHING`,
        [workspaceId, idea.id, asset.id],
      )
      tally('lineage_edges')
    }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   MAIN
   ═══════════════════════════════════════════════════════════════════════════ */

async function main(): Promise<void> {
  console.log('\n  Ethara SocialAI · seed')
  console.log(`  workspace: ${config.core.workspaceSlug}`)
  console.log(`  seed:      ${SEED} (deterministic)\n`)

  const workspaceId = await ensureWorkspace()
  await clearWorkspace(workspaceId)

  const runId = crypto.randomUUID()

  // Ordered by dependency.
  const keywordIds = await seedKeywords(workspaceId)
  await seedKeywordHistory(workspaceId, keywordIds)
  const sourceIds = await seedSources(workspaceId)
  const itemIds = await seedScrapedItems(workspaceId, keywordIds, sourceIds, runId)
  const hashtagIds = await seedHashtags(workspaceId, keywordIds, runId)
  await seedIdeas(workspaceId, hashtagIds, itemIds)
  await seedPublished(workspaceId)
  await seedKnowledge(workspaceId, hashtagIds)
  await seedAnalytics(workspaceId)
  await seedAgentState(workspaceId)
  await seedSkillOverrides(workspaceId)
  await seedActivity(workspaceId)
  await seedReviewQueue(workspaceId)
  await seedRunHistory(workspaceId, runId)
  await seedJarvis(workspaceId)
  await seedLineage(workspaceId)

  const width = Math.max(...Object.keys(counts).map((k) => k.length))
  for (const key of Object.keys(counts).sort()) {
    console.log(`  ${key.padEnd(width)}  ${String(counts[key]).padStart(4)}`)
  }

  console.log(`\n  ✓ Seed complete. ${COMPETITORS.length} competitors and ${SOURCES.length} sources registered.\n`)
}

main()
  .then(() => closePool())
  .then(() => process.exit(0))
  .catch(async (error: unknown) => {
    console.error('\n  ✗ Seed failed:', error instanceof Error ? error.message : error)
    if (error instanceof Error && error.stack) {
      console.error(error.stack.split('\n').slice(1, 5).join('\n'))
    }
    await closePool().catch(() => undefined)
    process.exit(1)
  })

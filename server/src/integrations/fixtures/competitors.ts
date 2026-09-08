/**
 * THE COMPETITOR SET AND THE SOURCE REGISTRY
 *
 * Sixteen competitors tiered P0/P1, and the eleven sources the Scraping Agent
 * draws from. Both are seeded into the database and editable thereafter; this
 * file is the starting position.
 *
 * Competitor posts are what `analysis.competitor.compare` reads to decide
 * whether we are arriving late to a saturated topic.
 */

export type CompetitorTier = 'P0' | 'P1'

export interface FixtureCompetitor {
  name: string
  handle: string
  tier: CompetitorTier
  /** What they are known for, used in the saturation explanation. */
  focus: string
  followers: number
}

/** P0 is the directly comparable set. P1 is adjacent. */
export const COMPETITORS: FixtureCompetitor[] = [
  { name: 'Axiom Research', handle: 'axiom-research', tier: 'P0', focus: 'Reward modelling and post-training', followers: 84200 },
  { name: 'Halcyon Labs', handle: 'halcyon-labs', tier: 'P0', focus: 'Agentic systems and orchestration', followers: 61400 },
  { name: 'Northwind AI', handle: 'northwind-ai', tier: 'P0', focus: 'Model evaluation and benchmarks', followers: 52900 },
  { name: 'Vector Foundry', handle: 'vector-foundry', tier: 'P0', focus: 'Synthetic data generation', followers: 47300 },
  { name: 'Meridian Intelligence', handle: 'meridian-intel', tier: 'P0', focus: 'Reinforcement learning environments', followers: 39800 },
  { name: 'Cobalt Systems', handle: 'cobalt-systems', tier: 'P0', focus: 'Inference and serving economics', followers: 43600 },
  { name: 'Terrace AI', handle: 'terrace-ai', tier: 'P1', focus: 'Enterprise AI deployment', followers: 71200 },
  { name: 'Foundry Nine', handle: 'foundry-nine', tier: 'P1', focus: 'Fine-tuning platforms', followers: 33400 },
  { name: 'Praxis Compute', handle: 'praxis-compute', tier: 'P1', focus: 'Training infrastructure', followers: 56800 },
  { name: 'Lumen Alignment', handle: 'lumen-alignment', tier: 'P1', focus: 'Safety evaluation and red teaming', followers: 28700 },
  { name: 'Beacon ML', handle: 'beacon-ml', tier: 'P1', focus: 'Evaluation harnesses', followers: 24100 },
  { name: 'Harbour Models', handle: 'harbour-models', tier: 'P1', focus: 'Frontier model research', followers: 68300 },
  { name: 'Stratos Agents', handle: 'stratos-agents', tier: 'P1', focus: 'Multi-agent frameworks', followers: 31900 },
  { name: 'Quill Dataworks', handle: 'quill-dataworks', tier: 'P1', focus: 'Preference data operations', followers: 19600 },
  { name: 'Ardent Compute', handle: 'ardent-compute', tier: 'P1', focus: 'GPU efficiency and utilisation', followers: 26400 },
  { name: 'Sable Research', handle: 'sable-research', tier: 'P1', focus: 'Interpretability', followers: 35200 },
]

export interface FixtureCompetitorPost {
  competitor: string
  text: string
  format: 'Thought Leadership' | 'Carousel' | 'Short Post' | 'Video' | 'Case Study'
  /** 0–100, relative to that competitor's own typical performance. */
  engagementIndex: number
  daysAgo: number
  topics: string[]
}

/** Three posts per P0 competitor, one or two per P1. */
export const COMPETITOR_POSTS: FixtureCompetitorPost[] = [
  { competitor: 'Axiom Research', text: 'Our reward model evaluation harness is now open. It scores calibration, not just accuracy.', format: 'Thought Leadership', engagementIndex: 78, daysAgo: 3, topics: ['reward modeling', 'model evaluation'] },
  { competitor: 'Axiom Research', text: 'Five failure modes we found in preference data, and how each one shows up in production.', format: 'Carousel', engagementIndex: 84, daysAgo: 7, topics: ['rlhf', 'reward modeling'] },
  { competitor: 'Axiom Research', text: 'Post-training is a discipline, not a phase.', format: 'Short Post', engagementIndex: 62, daysAgo: 11, topics: ['post-training'] },
  { competitor: 'Halcyon Labs', text: 'Why we version tool schemas the way we version APIs.', format: 'Thought Leadership', engagementIndex: 81, daysAgo: 2, topics: ['agentic ai', 'ai agents'] },
  { competitor: 'Halcyon Labs', text: 'A walkthrough of agent replay in our platform.', format: 'Video', engagementIndex: 69, daysAgo: 6, topics: ['agentic ai'] },
  { competitor: 'Halcyon Labs', text: 'Multi-agent is not free. Here is the latency bill.', format: 'Short Post', engagementIndex: 88, daysAgo: 9, topics: ['multi-agent systems', 'agentic ai'] },
  { competitor: 'Northwind AI', text: 'Contamination-resistant evaluation: our rotating holdout methodology.', format: 'Thought Leadership', engagementIndex: 74, daysAgo: 4, topics: ['model evaluation', 'ai benchmarks'] },
  { competitor: 'Northwind AI', text: 'Six benchmarks that are already saturated.', format: 'Carousel', engagementIndex: 79, daysAgo: 8, topics: ['ai benchmarks'] },
  { competitor: 'Northwind AI', text: 'Cost-normalised scoring changes the ranking substantially.', format: 'Short Post', engagementIndex: 71, daysAgo: 13, topics: ['ai benchmarks', 'inference optimization'] },
  { competitor: 'Vector Foundry', text: 'Verified synthetic curricula: results from four rounds.', format: 'Thought Leadership', engagementIndex: 76, daysAgo: 5, topics: ['synthetic data'] },
  { competitor: 'Vector Foundry', text: 'Diversity, not volume, is the synthetic data constraint.', format: 'Short Post', engagementIndex: 68, daysAgo: 10, topics: ['synthetic data'] },
  { competitor: 'Vector Foundry', text: 'How one customer replaced 60% of their labelling spend.', format: 'Case Study', engagementIndex: 83, daysAgo: 14, topics: ['synthetic data', 'enterprise ai adoption'] },
  { competitor: 'Meridian Intelligence', text: 'Deterministic environments are a prerequisite, not a nice-to-have.', format: 'Thought Leadership', engagementIndex: 72, daysAgo: 6, topics: ['ai environments', 'reinforcement learning'] },
  { competitor: 'Meridian Intelligence', text: 'Reset semantics: a short field guide.', format: 'Carousel', engagementIndex: 64, daysAgo: 12, topics: ['ai environments'] },
  { competitor: 'Meridian Intelligence', text: '70% of RL engineering is environment work.', format: 'Short Post', engagementIndex: 77, daysAgo: 15, topics: ['reinforcement learning', 'ai environments'] },
  { competitor: 'Cobalt Systems', text: 'Where inference savings actually come from: a decomposition.', format: 'Thought Leadership', engagementIndex: 86, daysAgo: 3, topics: ['inference optimization'] },
  { competitor: 'Cobalt Systems', text: 'Routing beat every model upgrade we tried.', format: 'Short Post', engagementIndex: 91, daysAgo: 8, topics: ['inference optimization', 'ai infrastructure'] },
  { competitor: 'Cobalt Systems', text: 'Batching, caching, routing: the order we would do it again.', format: 'Carousel', engagementIndex: 74, daysAgo: 12, topics: ['inference optimization'] },
  { competitor: 'Terrace AI', text: 'Two years of enterprise deployments, honestly assessed.', format: 'Thought Leadership', engagementIndex: 88, daysAgo: 4, topics: ['enterprise ai adoption'] },
  { competitor: 'Terrace AI', text: 'The eval set is the asset, not the model.', format: 'Short Post', engagementIndex: 82, daysAgo: 9, topics: ['enterprise ai adoption', 'model evaluation'] },
  { competitor: 'Foundry Nine', text: 'LoRA vs full fine-tuning across eleven tasks.', format: 'Carousel', engagementIndex: 73, daysAgo: 7, topics: ['llm fine-tuning'] },
  { competitor: 'Praxis Compute', text: 'GPU utilisation: profiling before purchasing.', format: 'Thought Leadership', engagementIndex: 79, daysAgo: 5, topics: ['ai infrastructure'] },
  { competitor: 'Praxis Compute', text: 'Checkpoint stalls cost us more than the last hardware order.', format: 'Short Post', engagementIndex: 71, daysAgo: 11, topics: ['ai infrastructure'] },
  { competitor: 'Lumen Alignment', text: 'Continuous red teaming: the marginal cost is lower than you think.', format: 'Thought Leadership', engagementIndex: 67, daysAgo: 6, topics: ['ai safety evaluation'] },
  { competitor: 'Beacon ML', text: 'Our smoke eval runs in ninety seconds on a laptop.', format: 'Short Post', engagementIndex: 65, daysAgo: 8, topics: ['ai evaluation harness'] },
  { competitor: 'Harbour Models', text: 'There is no single frontier any more.', format: 'Thought Leadership', engagementIndex: 89, daysAgo: 3, topics: ['frontier models'] },
  { competitor: 'Harbour Models', text: 'Task-specific model selection, in practice.', format: 'Carousel', engagementIndex: 76, daysAgo: 10, topics: ['frontier models', 'model evaluation'] },
  { competitor: 'Stratos Agents', text: 'Hand-off contracts are the whole game in multi-agent.', format: 'Thought Leadership', engagementIndex: 80, daysAgo: 5, topics: ['multi-agent systems'] },
  { competitor: 'Quill Dataworks', text: 'Annotator disagreement is signal.', format: 'Short Post', engagementIndex: 70, daysAgo: 9, topics: ['rlhf'] },
  { competitor: 'Ardent Compute', text: 'From 31% to 74% utilisation with no new hardware.', format: 'Case Study', engagementIndex: 85, daysAgo: 7, topics: ['ai infrastructure', 'inference optimization'] },
  { competitor: 'Sable Research', text: 'What interpretability can and cannot tell you about safety.', format: 'Thought Leadership', engagementIndex: 68, daysAgo: 12, topics: ['ai safety evaluation'] },
]

/* ═══════════════════════════════════════════════════════════════════════════
   THE SOURCE REGISTRY — eleven sources.
   `trusted` grants a credibility bonus; Community carries a penalty.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FixtureSourceRegistryEntry {
  name: string
  kind: 'linkedin' | 'instagram' | 'x' | 'web'
  sourceType: 'Social' | 'News' | 'Competitor' | 'Community' | 'Website'
  url: string
  trusted: boolean
  enabled: boolean
}

export const SOURCES: FixtureSourceRegistryEntry[] = [
  { name: 'LinkedIn · Research Feed', kind: 'linkedin', sourceType: 'Social', url: 'https://www.linkedin.com/search/results/content/', trusted: true, enabled: true },
  { name: 'LinkedIn · Engineering Feed', kind: 'linkedin', sourceType: 'Social', url: 'https://www.linkedin.com/search/results/content/', trusted: true, enabled: true },
  { name: 'LinkedIn · Enterprise Feed', kind: 'linkedin', sourceType: 'Social', url: 'https://www.linkedin.com/search/results/content/', trusted: false, enabled: true },
  { name: 'LinkedIn · Hashtag Feeds', kind: 'linkedin', sourceType: 'Social', url: 'https://www.linkedin.com/feed/hashtag/', trusted: false, enabled: true },
  { name: 'arXiv · cs.LG', kind: 'web', sourceType: 'News', url: 'https://arxiv.org/list/cs.LG/recent', trusted: true, enabled: true },
  { name: 'OpenReview', kind: 'web', sourceType: 'News', url: 'https://openreview.net', trusted: true, enabled: true },
  { name: 'Competitor Pages', kind: 'linkedin', sourceType: 'Competitor', url: 'https://www.linkedin.com/company/', trusted: false, enabled: true },
  { name: 'Hacker News', kind: 'web', sourceType: 'Community', url: 'https://news.ycombinator.com', trusted: false, enabled: true },
  { name: 'Reddit · r/MachineLearning', kind: 'web', sourceType: 'Community', url: 'https://reddit.com/r/MachineLearning', trusted: false, enabled: true },
  { name: 'Ethara Blog', kind: 'web', sourceType: 'Website', url: 'https://ethara.ai/blog', trusted: true, enabled: true },
  { name: 'X · AI Research', kind: 'x', sourceType: 'Social', url: 'https://x.com/search', trusted: false, enabled: false },
]

/** Competitor posts for one tier selection, as the knob declares it. */
export function competitorsForTier(tier: 'P0 only' | 'P0+P1' | 'All'): FixtureCompetitor[] {
  if (tier === 'P0 only') return COMPETITORS.filter((c) => c.tier === 'P0')
  if (tier === 'P0+P1') return COMPETITORS
  return COMPETITORS
}

export function postsForCompetitor(name: string, limit: number): FixtureCompetitorPost[] {
  return COMPETITOR_POSTS.filter((p) => p.competitor === name).slice(0, Math.max(1, limit))
}

/** How saturated a topic is across the competitor set, 0–100. */
export function topicSaturation(topic: string, windowDays: number): number {
  const t = topic.toLowerCase()
  const relevant = COMPETITOR_POSTS.filter(
    (p) => p.daysAgo <= windowDays && p.topics.some((x) => x.includes(t) || t.includes(x)),
  )
  if (relevant.length === 0) return 0
  const avgEngagement =
    relevant.reduce((n, p) => n + p.engagementIndex, 0) / relevant.length
  // Coverage count matters more than how well it did.
  const coverage = Math.min(100, relevant.length * 18)
  return Math.round(coverage * 0.7 + avgEngagement * 0.3)
}

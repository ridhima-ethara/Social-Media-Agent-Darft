/**
 * THE OFFLINE LINKEDIN CORPUS
 *
 * Forty hand-authored posts across the seeded keyword set, with realistic
 * authors, bodies, hashtags and engagement. This is what the Scraping Agent
 * reads when `APIFY_API_TOKEN` is blank, and what the seeder builds the
 * historical signal from.
 *
 * Everything is deterministic. Dates are computed relative to a supplied
 * "now" so the corpus always looks like the last fourteen days, and the
 * `runOffset` rotates which slice a run sees, so a repeat run surfaces new
 * items rather than the same forty rows.
 */

export interface FixturePost {
  /** Stable id. Prefixed so a fixture row is never mistaken for a live one. */
  externalId: string
  keyword: string
  authorName: string
  authorHeadline: string
  authorFollowers: number
  /** Which source registry entry this came from. */
  sourceName: string
  text: string
  hashtags: string[]
  reactions: number
  comments: number
  reposts: number
  /** How many days before "now" this was posted. */
  daysAgo: number
  /** Hours component, so posts do not all land at midnight. */
  hourOfDay: number
}

export const LINKEDIN_FIXTURES: FixturePost[] = [
  {
    externalId: 'fx-li-0001',
    keyword: 'reinforcement learning',
    authorName: 'Dr. Lena Ortiz',
    authorHeadline: 'Research Scientist · Post-training',
    authorFollowers: 18400,
    sourceName: 'LinkedIn · Research Feed',
    text: 'The interesting result in our latest post-training run was not the score. It was that a 1.3B reward model supervising a 70B policy beat a 70B reward model supervising the same policy. Capacity in the critic is not what is scarce. Calibration is.\n\nWe are publishing the ablations next week.',
    hashtags: ['ReinforcementLearning', 'RewardModeling', 'PostTraining'],
    reactions: 1284,
    comments: 96,
    reposts: 141,
    daysAgo: 1,
    hourOfDay: 9,
  },
  {
    externalId: 'fx-li-0002',
    keyword: 'RLHF',
    authorName: 'Priya Raghunathan',
    authorHeadline: 'Head of Alignment · Frontier Lab',
    authorFollowers: 24100,
    sourceName: 'LinkedIn · Research Feed',
    text: 'RLHF is quietly becoming three different disciplines: preference collection, reward modelling, and policy optimisation. Most teams are excellent at one and improvising the other two.\n\nThe teams that ship reliably have separate owners for each.',
    hashtags: ['RLHF', 'Alignment', 'RewardModeling'],
    reactions: 2140,
    comments: 187,
    reposts: 264,
    daysAgo: 2,
    hourOfDay: 14,
  },
  {
    externalId: 'fx-li-0003',
    keyword: 'agentic AI',
    authorName: 'Marcus Feld',
    authorHeadline: 'Staff Engineer · Agent Infrastructure',
    authorFollowers: 12900,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'Nine months of agent work in one line: the model was never the bottleneck. The environment was.\n\nOur agents got dramatically better when we stopped tuning prompts and started versioning tools, adding idempotency keys, and making every failure legible to the planner.',
    hashtags: ['AgenticAI', 'AIAgents', 'MultiAgentSystems'],
    reactions: 3410,
    comments: 298,
    reposts: 512,
    daysAgo: 1,
    hourOfDay: 11,
  },
  {
    externalId: 'fx-li-0004',
    keyword: 'agentic AI',
    authorName: 'Sofia Lindqvist',
    authorHeadline: 'Director of AI Platform',
    authorFollowers: 31200,
    sourceName: 'LinkedIn · Enterprise Feed',
    text: 'Every agentic pilot I have reviewed this quarter failed for the same reason: no one owned the evaluation harness. Teams shipped a demo, then had no way to tell whether the next change made it better or worse.\n\nBuild the harness before the agent.',
    hashtags: ['AgenticAI', 'ModelEvaluation', 'AIEvaluationHarness'],
    reactions: 2870,
    comments: 241,
    reposts: 389,
    daysAgo: 3,
    hourOfDay: 8,
  },
  {
    externalId: 'fx-li-0005',
    keyword: 'reward modeling',
    authorName: 'Dr. Ken Watanabe',
    authorHeadline: 'Principal Researcher · Reward Models',
    authorFollowers: 15600,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Reward models are not a training detail. They are the specification. Whatever your reward model rewards is what your product does, in every edge case you did not enumerate.\n\nTreat it like a product surface, with an owner and a changelog.',
    hashtags: ['RewardModeling', 'ReinforcementLearning', 'AIAlignment'],
    reactions: 1920,
    comments: 154,
    reposts: 287,
    daysAgo: 4,
    hourOfDay: 10,
  },
  {
    externalId: 'fx-li-0006',
    keyword: 'model evaluation',
    authorName: 'Amara Diallo',
    authorHeadline: 'Evaluation Lead',
    authorFollowers: 19800,
    sourceName: 'LinkedIn · Research Feed',
    text: 'A benchmark your model was not trained on is worth ten benchmarks it might have been. Contamination is now the default assumption, not the exception.\n\nWe rebuild a held-out set every quarter and never publish its contents.',
    hashtags: ['ModelEvaluation', 'AIBenchmarks', 'AIEvaluationHarness'],
    reactions: 1640,
    comments: 128,
    reposts: 203,
    daysAgo: 2,
    hourOfDay: 16,
  },
  {
    externalId: 'fx-li-0007',
    keyword: 'post-training',
    authorName: 'Tom Alvarez',
    authorHeadline: 'ML Engineer · Fine-tuning',
    authorFollowers: 9400,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'Post-training is where most of the remaining value is, and where most of the tooling is still missing. Pre-training has industrial-grade infrastructure. Post-training has notebooks.',
    hashtags: ['PostTraining', 'LLMFineTuning', 'AIInfrastructure'],
    reactions: 1180,
    comments: 87,
    reposts: 156,
    daysAgo: 5,
    hourOfDay: 13,
  },
  {
    externalId: 'fx-li-0008',
    keyword: 'AI agents',
    authorName: 'Rachel Kim',
    authorHeadline: 'VP Engineering',
    authorFollowers: 27300,
    sourceName: 'LinkedIn · Enterprise Feed',
    text: 'We replaced a six-step human workflow with an agent and the throughput went up 40%. Then we measured error rates and quietly put two of the six steps back under human review.\n\nThat is the real shape of agent adoption: partial, measured, and reversible.',
    hashtags: ['AIAgents', 'AgenticAI', 'EnterpriseAI'],
    reactions: 4120,
    comments: 367,
    reposts: 598,
    daysAgo: 1,
    hourOfDay: 15,
  },
  {
    externalId: 'fx-li-0009',
    keyword: 'AI benchmarks',
    authorName: 'Dr. Yusuf Demir',
    authorHeadline: 'Benchmark Design',
    authorFollowers: 13200,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Leaderboard position is a lagging indicator of a decision someone made about what to measure. Read the benchmark construction before the ranking.',
    hashtags: ['AIBenchmarks', 'ModelEvaluation'],
    reactions: 980,
    comments: 74,
    reposts: 118,
    daysAgo: 6,
    hourOfDay: 12,
  },
  {
    externalId: 'fx-li-0010',
    keyword: 'synthetic data',
    authorName: 'Elena Voss',
    authorHeadline: 'Data Generation Lead',
    authorFollowers: 16700,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Synthetic data stopped being a fallback and became the primary curriculum. The constraint moved from volume to diversity: it is easy to generate a million samples that teach the same thing once.',
    hashtags: ['SyntheticData', 'PostTraining', 'MachineLearning'],
    reactions: 1520,
    comments: 112,
    reposts: 194,
    daysAgo: 3,
    hourOfDay: 9,
  },
  {
    externalId: 'fx-li-0011',
    keyword: 'AI environments',
    authorName: 'Diego Márquez',
    authorHeadline: 'RL Environments Engineer',
    authorFollowers: 8900,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'The unglamorous truth about RL at scale: 70% of the engineering is environment work. Determinism, reset semantics, reward plumbing, observation schemas. The policy code is the small part.',
    hashtags: ['AIEnvironments', 'ReinforcementLearning', 'AIInfrastructure'],
    reactions: 1340,
    comments: 98,
    reposts: 176,
    daysAgo: 4,
    hourOfDay: 17,
  },
  {
    externalId: 'fx-li-0012',
    keyword: 'multi-agent systems',
    authorName: 'Hannah Brooks',
    authorHeadline: 'Research Engineer · Multi-agent',
    authorFollowers: 11400,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Adding a second agent multiplies your failure modes rather than your capability, unless the hand-off contract is explicit. Declare what each agent consumes and produces, or you have built a distributed system by accident.',
    hashtags: ['MultiAgentSystems', 'AgenticAI', 'AIAgents'],
    reactions: 1760,
    comments: 143,
    reposts: 231,
    daysAgo: 2,
    hourOfDay: 11,
  },
  {
    externalId: 'fx-li-0013',
    keyword: 'inference optimization',
    authorName: 'Wei Zhang',
    authorHeadline: 'Inference Systems',
    authorFollowers: 14800,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'Inference economics now decide which research is deployable. A method that is 3% better and 4x more expensive per token does not ship, and the paper rarely mentions that.',
    hashtags: ['InferenceOptimization', 'AIInfrastructure', 'LLMOps'],
    reactions: 2240,
    comments: 176,
    reposts: 341,
    daysAgo: 1,
    hourOfDay: 10,
  },
  {
    externalId: 'fx-li-0014',
    keyword: 'LLM fine-tuning',
    authorName: 'Nadia Haddad',
    authorHeadline: 'Applied Scientist',
    authorFollowers: 10200,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Most fine-tuning failures are data failures wearing a hyperparameter costume. Before you touch the learning rate, read 200 samples of your training set by hand.',
    hashtags: ['LLMFineTuning', 'PostTraining', 'SyntheticData'],
    reactions: 1890,
    comments: 167,
    reposts: 254,
    daysAgo: 5,
    hourOfDay: 14,
  },
  {
    externalId: 'fx-li-0015',
    keyword: 'AI safety evaluation',
    authorName: 'Dr. Grace Mbeki',
    authorHeadline: 'Safety Evaluation',
    authorFollowers: 21400,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Red teaming that only runs before launch is a compliance exercise. Red teaming that runs on every checkpoint is an evaluation discipline. The cost difference is smaller than teams expect.',
    hashtags: ['AISafetyEvaluation', 'ModelEvaluation', 'AIAlignment'],
    reactions: 1620,
    comments: 134,
    reposts: 219,
    daysAgo: 3,
    hourOfDay: 15,
  },
  {
    externalId: 'fx-li-0016',
    keyword: 'frontier models',
    authorName: 'Julian Reyes',
    authorHeadline: 'Strategy · AI Research',
    authorFollowers: 33600,
    sourceName: 'LinkedIn · Enterprise Feed',
    text: 'The frontier is no longer a single number. One model leads on reasoning, another on tool use, another on cost per solved task. Procurement teams asking "which is best" are asking the wrong question.',
    hashtags: ['FrontierModels', 'ModelEvaluation', 'EnterpriseAI'],
    reactions: 2960,
    comments: 254,
    reposts: 412,
    daysAgo: 2,
    hourOfDay: 8,
  },
  {
    externalId: 'fx-li-0017',
    keyword: 'reinforcement learning',
    authorName: 'Ingrid Halvorsen',
    authorHeadline: 'RL Researcher',
    authorFollowers: 12100,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Reward hacking is not a bug in the policy. It is the policy correctly optimising a specification you wrote carelessly. Every hack is a spec review finding.',
    hashtags: ['ReinforcementLearning', 'RewardModeling', 'AIAlignment'],
    reactions: 2080,
    comments: 172,
    reposts: 298,
    daysAgo: 6,
    hourOfDay: 11,
  },
  {
    externalId: 'fx-li-0018',
    keyword: 'AI infrastructure',
    authorName: 'Samuel Okonkwo',
    authorHeadline: 'Infrastructure Architect',
    authorFollowers: 17900,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'Training infrastructure is a solved problem you can buy. Evaluation infrastructure is an unsolved problem you have to build. Budget accordingly.',
    hashtags: ['AIInfrastructure', 'AIEvaluationHarness', 'LLMOps'],
    reactions: 1440,
    comments: 106,
    reposts: 187,
    daysAgo: 4,
    hourOfDay: 13,
  },
  {
    externalId: 'fx-li-0019',
    keyword: 'agentic AI',
    authorName: 'Claire Dubois',
    authorHeadline: 'Product · AI Agents',
    authorFollowers: 15300,
    sourceName: 'LinkedIn · Enterprise Feed',
    text: 'Users do not want autonomous agents. They want agents that ask before doing anything expensive or irreversible, and get on with everything else silently.\n\nThe confirmation design is the product.',
    hashtags: ['AgenticAI', 'AIAgents', 'ProductDesign'],
    reactions: 3280,
    comments: 289,
    reposts: 467,
    daysAgo: 1,
    hourOfDay: 16,
  },
  {
    externalId: 'fx-li-0020',
    keyword: 'model evaluation',
    authorName: 'Dr. Omar Farouk',
    authorHeadline: 'Head of Evals',
    authorFollowers: 20100,
    sourceName: 'LinkedIn · Research Feed',
    text: 'We stopped reporting single-number eval scores internally. Every result now ships with the distribution and the three worst failures. Averages hid every problem worth fixing.',
    hashtags: ['ModelEvaluation', 'AIBenchmarks', 'AIEvaluationHarness'],
    reactions: 1980,
    comments: 158,
    reposts: 276,
    daysAgo: 5,
    hourOfDay: 9,
  },
  {
    externalId: 'fx-li-0021',
    keyword: 'RLHF',
    authorName: 'Beatriz Santos',
    authorHeadline: 'Preference Data Lead',
    authorFollowers: 11800,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Annotator disagreement is signal, not noise. The examples your labellers argue about are exactly the examples your reward model will get wrong in production.',
    hashtags: ['RLHF', 'RewardModeling', 'SyntheticData'],
    reactions: 1720,
    comments: 141,
    reposts: 224,
    daysAgo: 7,
    hourOfDay: 12,
  },
  {
    externalId: 'fx-li-0022',
    keyword: 'AI agents',
    authorName: 'Anders Nilsson',
    authorHeadline: 'Engineering Manager',
    authorFollowers: 13700,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'The agent framework debate is mostly noise. What matters: typed tool schemas, deterministic replay, per-step audit records, and a hard stop before anything irreversible. Any framework with those four works.',
    hashtags: ['AIAgents', 'AgenticAI', 'MultiAgentSystems'],
    reactions: 2540,
    comments: 213,
    reposts: 378,
    daysAgo: 3,
    hourOfDay: 10,
  },
  {
    externalId: 'fx-li-0023',
    keyword: 'post-training',
    authorName: 'Mei Lin',
    authorHeadline: 'Post-training Research',
    authorFollowers: 14200,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Three post-training runs on the same base model produced three noticeably different personalities. None of the differences were in the loss curve. Behaviour is not visible in the metrics you are watching.',
    hashtags: ['PostTraining', 'RLHF', 'ModelEvaluation'],
    reactions: 1860,
    comments: 149,
    reposts: 247,
    daysAgo: 8,
    hourOfDay: 14,
  },
  {
    externalId: 'fx-li-0024',
    keyword: 'reward modeling',
    authorName: 'Felix Bauer',
    authorHeadline: 'Research Scientist',
    authorFollowers: 10800,
    sourceName: 'LinkedIn · Research Feed',
    text: 'A reward model trained on last quarter\u2019s preferences is a snapshot of last quarter\u2019s taste. We now retrain ours on a rolling window and treat drift as expected rather than exceptional.',
    hashtags: ['RewardModeling', 'ReinforcementLearning', 'PostTraining'],
    reactions: 1380,
    comments: 104,
    reposts: 172,
    daysAgo: 9,
    hourOfDay: 11,
  },
  {
    externalId: 'fx-li-0025',
    keyword: 'AI environments',
    authorName: 'Tara Sundaram',
    authorHeadline: 'Simulation Engineer',
    authorFollowers: 9600,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'If your environment is not deterministic given a seed, your ablations are opinions. We spent a month on reproducibility and it paid for itself in the first week of real experiments.',
    hashtags: ['AIEnvironments', 'ReinforcementLearning', 'AIInfrastructure'],
    reactions: 1240,
    comments: 92,
    reposts: 164,
    daysAgo: 7,
    hourOfDay: 15,
  },
  {
    externalId: 'fx-li-0026',
    keyword: 'enterprise AI adoption',
    authorName: 'Robert Chen',
    authorHeadline: 'CTO',
    authorFollowers: 41200,
    sourceName: 'LinkedIn · Enterprise Feed',
    text: 'Our AI spend tripled and our AI value quadrupled, but not from the projects we forecast. The wins came from unglamorous internal tooling. The customer-facing pilots are still pilots.',
    hashtags: ['EnterpriseAI', 'AIAdoption', 'EngineeringLeadership'],
    reactions: 5240,
    comments: 428,
    reposts: 712,
    daysAgo: 2,
    hourOfDay: 9,
  },
  {
    externalId: 'fx-li-0027',
    keyword: 'AI evaluation harness',
    authorName: 'Lucia Ferrari',
    authorHeadline: 'Eval Infrastructure',
    authorFollowers: 12600,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'An eval harness nobody can run locally is an eval harness nobody runs. Ours takes one command and ninety seconds on a laptop for the smoke set. Adoption went from two teams to eleven.',
    hashtags: ['AIEvaluationHarness', 'ModelEvaluation', 'LLMOps'],
    reactions: 1560,
    comments: 118,
    reposts: 209,
    daysAgo: 6,
    hourOfDay: 13,
  },
  {
    externalId: 'fx-li-0028',
    keyword: 'agentic AI',
    authorName: 'Kwame Asante',
    authorHeadline: 'Principal Engineer',
    authorFollowers: 19200,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'Agent observability is where we spent the last quarter. Not dashboards — replay. Being able to re-run any past agent decision against the exact state and config it saw is what turned debugging from archaeology into engineering.',
    hashtags: ['AgenticAI', 'AIAgents', 'LLMOps'],
    reactions: 2680,
    comments: 224,
    reposts: 394,
    daysAgo: 4,
    hourOfDay: 10,
  },
  {
    externalId: 'fx-li-0029',
    keyword: 'synthetic data',
    authorName: 'Johan Vermeer',
    authorHeadline: 'Data Strategy',
    authorFollowers: 13900,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Model collapse from synthetic data is real but overstated. It happens when you sample from your own outputs without a grounding signal. With verification in the loop, quality goes up, not down.',
    hashtags: ['SyntheticData', 'PostTraining', 'AIResearch'],
    reactions: 1680,
    comments: 152,
    reposts: 238,
    daysAgo: 8,
    hourOfDay: 16,
  },
  {
    externalId: 'fx-li-0030',
    keyword: 'AI research lab',
    authorName: 'Dr. Sarah Whitfield',
    authorHeadline: 'Lab Director',
    authorFollowers: 28400,
    sourceName: 'LinkedIn · Research Feed',
    text: 'The research labs shipping fastest are not the ones with the most compute. They are the ones where an engineer can go from hypothesis to measured result in under a day.\n\nCycle time is the real moat.',
    hashtags: ['AIResearch', 'FrontierModels', 'EngineeringLeadership'],
    reactions: 3840,
    comments: 316,
    reposts: 548,
    daysAgo: 3,
    hourOfDay: 11,
  },
  {
    externalId: 'fx-li-0031',
    keyword: 'inference optimization',
    authorName: 'Aditi Sharma',
    authorHeadline: 'Performance Engineering',
    authorFollowers: 11200,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'Speculative decoding gave us 2.4x throughput. Careful batching gave us 3.1x. The unglamorous one won, and it required no new model.',
    hashtags: ['InferenceOptimization', 'LLMOps', 'AIInfrastructure'],
    reactions: 1940,
    comments: 148,
    reposts: 287,
    daysAgo: 5,
    hourOfDay: 12,
  },
  {
    externalId: 'fx-li-0032',
    keyword: 'multi-agent systems',
    authorName: 'Pierre Lemaitre',
    authorHeadline: 'Distributed Systems · AI',
    authorFollowers: 14600,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'We built a multi-agent system, measured it, and replaced it with one agent and four tools. Same outcome, a fifth of the latency, and we could actually explain what happened when it failed.',
    hashtags: ['MultiAgentSystems', 'AgenticAI', 'AIAgents'],
    reactions: 3120,
    comments: 276,
    reposts: 448,
    daysAgo: 2,
    hourOfDay: 15,
  },
  {
    externalId: 'fx-li-0033',
    keyword: 'AI benchmarks',
    authorName: 'Nora Kaplan',
    authorHeadline: 'Research Lead',
    authorFollowers: 16400,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Benchmark saturation is not a measurement problem, it is a curriculum problem. When everyone scores 94%, the benchmark has finished teaching us and we need a harder question.',
    hashtags: ['AIBenchmarks', 'ModelEvaluation', 'AIResearch'],
    reactions: 1520,
    comments: 121,
    reposts: 198,
    daysAgo: 9,
    hourOfDay: 10,
  },
  {
    externalId: 'fx-li-0034',
    keyword: 'engineering leadership AI',
    authorName: 'Michael Osei',
    authorHeadline: 'VP of Engineering',
    authorFollowers: 35800,
    sourceName: 'LinkedIn · Enterprise Feed',
    text: 'The hardest part of leading engineering through this shift is not the technology. It is that the same seniority signals no longer predict who will be effective. Some of my strongest people are struggling and some of my quietest are thriving.',
    hashtags: ['EngineeringLeadership', 'EnterpriseAI', 'AIAdoption'],
    reactions: 4680,
    comments: 392,
    reposts: 634,
    daysAgo: 1,
    hourOfDay: 8,
  },
  {
    externalId: 'fx-li-0035',
    keyword: 'AI safety evaluation',
    authorName: 'Dr. Ravi Menon',
    authorHeadline: 'Safety Research',
    authorFollowers: 18900,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Capability evaluation and safety evaluation are converging. The tests that best predict dangerous behaviour are increasingly the same tests that best measure competence at long-horizon tasks.',
    hashtags: ['AISafetyEvaluation', 'ModelEvaluation', 'AIAlignment'],
    reactions: 1780,
    comments: 156,
    reposts: 242,
    daysAgo: 7,
    hourOfDay: 14,
  },
  {
    externalId: 'fx-li-0036',
    keyword: 'LLM fine-tuning',
    authorName: 'Yara Khalil',
    authorHeadline: 'Applied ML',
    authorFollowers: 10600,
    sourceName: 'LinkedIn · Research Feed',
    text: 'We compared LoRA against full fine-tuning on eleven internal tasks. LoRA matched on nine, lost badly on two, and both losses were tasks requiring new factual knowledge rather than new behaviour. That is a useful decision rule.',
    hashtags: ['LLMFineTuning', 'PostTraining', 'MachineLearning'],
    reactions: 2340,
    comments: 198,
    reposts: 356,
    daysAgo: 4,
    hourOfDay: 11,
  },
  {
    externalId: 'fx-li-0037',
    keyword: 'frontier models',
    authorName: 'Erik Johansson',
    authorHeadline: 'AI Strategy',
    authorFollowers: 22700,
    sourceName: 'LinkedIn · Enterprise Feed',
    text: 'Cost per solved task fell by roughly an order of magnitude over eighteen months while headline model prices barely moved. The gains came from better routing, caching and smaller models handling most of the volume.',
    hashtags: ['FrontierModels', 'InferenceOptimization', 'EnterpriseAI'],
    reactions: 2860,
    comments: 236,
    reposts: 424,
    daysAgo: 6,
    hourOfDay: 9,
  },
  {
    externalId: 'fx-li-0038',
    keyword: 'reinforcement learning',
    authorName: 'Camila Rojas',
    authorHeadline: 'RL Engineer',
    authorFollowers: 12400,
    sourceName: 'LinkedIn · Research Feed',
    text: 'Process supervision beat outcome supervision on every long-horizon task we tried. Rewarding the reasoning rather than only the answer costs more to label and generalises considerably better.',
    hashtags: ['ReinforcementLearning', 'RewardModeling', 'PostTraining'],
    reactions: 2180,
    comments: 184,
    reposts: 312,
    daysAgo: 10,
    hourOfDay: 13,
  },
  {
    externalId: 'fx-li-0039',
    keyword: 'AI infrastructure',
    authorName: 'Thomas Berg',
    authorHeadline: 'Platform Engineering',
    authorFollowers: 15100,
    sourceName: 'LinkedIn · Engineering Feed',
    text: 'Our GPU utilisation was 31%. Not because of the hardware, and not because of the model — because of data loading and checkpoint stalls. Two weeks of profiling bought more capacity than the last purchase order.',
    hashtags: ['AIInfrastructure', 'InferenceOptimization', 'LLMOps'],
    reactions: 2420,
    comments: 201,
    reposts: 368,
    daysAgo: 11,
    hourOfDay: 10,
  },
  {
    externalId: 'fx-li-0040',
    keyword: 'enterprise AI adoption',
    authorName: 'Fatima Al-Sayed',
    authorHeadline: 'Head of AI Programmes',
    authorFollowers: 24900,
    sourceName: 'LinkedIn · Enterprise Feed',
    text: 'Two years in, our most valuable AI artefact is not a model. It is the evaluation set we built from real support tickets. It has outlived three model migrations and settles every vendor argument in an afternoon.',
    hashtags: ['EnterpriseAI', 'ModelEvaluation', 'AIAdoption'],
    reactions: 3560,
    comments: 298,
    reposts: 512,
    daysAgo: 3,
    hourOfDay: 16,
  },

  /*
   * Two genuinely off-topic posts. A keyword search does surface these, and the
   * Validation Agent has to be able to reject something on the evidence — a
   * corpus where everything passes would not exercise the rejection path or
   * populate the rejected bucket in the UI.
   */
  {
    externalId: 'fx-li-0041',
    keyword: 'AI agents',
    authorName: 'Brandon Teague',
    authorHeadline: 'Technical Recruiter · AI & ML',
    authorFollowers: 4200,
    sourceName: 'Reddit · r/MachineLearning',
    text: 'HIRING: 14 open roles on my client\u2019s platform team. Competitive equity, unlimited PTO, and a team that ships. DM me your resume and let us get started today. Referral bonus for anyone you send my way.',
    hashtags: ['Hiring', 'Jobs', 'Careers'],
    reactions: 62,
    comments: 9,
    reposts: 3,
    daysAgo: 5,
    hourOfDay: 11,
  },
  {
    externalId: 'fx-li-0042',
    keyword: 'model evaluation',
    authorName: 'GrowthLoop Marketing',
    authorHeadline: 'B2B Demand Generation',
    authorFollowers: 2800,
    sourceName: 'Hacker News',
    text: 'FREE WEBINAR next Tuesday: 10x your pipeline with our revolutionary growth platform. Limited seats. Register now and get our best-in-class playbook absolutely free. You will not believe the results our customers see.',
    hashtags: ['Webinar', 'Marketing', 'Growth'],
    reactions: 34,
    comments: 4,
    reposts: 1,
    daysAgo: 8,
    hourOfDay: 14,
  },
]

/**
 * Engagement, weighted the way the pipeline weights it:
 * a comment is worth three reactions, a repost five.
 */
export function fixtureEngagement(post: FixturePost): number {
  return post.reactions + post.comments * 3 + post.reposts * 5
}

/** The absolute post time, given a reference "now". */
export function fixturePostedAt(post: FixturePost, now: Date): Date {
  const d = new Date(now)
  d.setDate(d.getDate() - post.daysAgo)
  d.setHours(post.hourOfDay, (post.daysAgo * 7) % 60, 0, 0)
  return d
}

/**
 * The fixtures for one keyword, rotated by `runOffset` so a repeat run
 * surfaces different items rather than the identical set every time.
 */
export function fixturesForKeyword(
  keyword: string,
  limit: number,
  runOffset = 0,
): FixturePost[] {
  const term = keyword.trim().toLowerCase()

  const exact = LINKEDIN_FIXTURES.filter((p) => p.keyword.toLowerCase() === term)

  // Fall back to a topical match so an operator-added keyword still returns
  // something plausible rather than an empty result.
  const pool =
    exact.length > 0
      ? exact
      : LINKEDIN_FIXTURES.filter(
          (p) =>
            p.text.toLowerCase().includes(term) ||
            p.hashtags.some((h) => h.toLowerCase().includes(term.replace(/\s+/g, ''))),
        )

  const source = pool.length > 0 ? pool : LINKEDIN_FIXTURES
  if (source.length === 0) return []

  const rotated = [...source.slice(runOffset % source.length), ...source.slice(0, runOffset % source.length)]
  return rotated.slice(0, Math.max(1, limit))
}

/** Every distinct hashtag in the corpus, with how often it appears. */
export function fixtureHashtagFrequency(): Map<string, number> {
  const counts = new Map<string, number>()
  for (const post of LINKEDIN_FIXTURES) {
    for (const tag of post.hashtags) {
      const key = tag.toLowerCase()
      counts.set(key, (counts.get(key) ?? 0) + 1)
    }
  }
  return counts
}

/**
 * An independent reading of one hashtag's own feed, as the hashtag actor would
 * return. Deliberately not the same numbers as the keyword-scoped view, because
 * the point of the expansion pass is an unbiased second measurement.
 */
export function fixtureHashtagFeed(
  tag: string,
  limit: number,
  runOffset = 0,
): FixturePost[] {
  const normalised = tag.replace(/^#/, '').toLowerCase()
  const matching = LINKEDIN_FIXTURES.filter((p) =>
    p.hashtags.some((h) => h.toLowerCase() === normalised),
  )
  const source = matching.length > 0 ? matching : []
  if (source.length === 0) return []
  const rotated = [
    ...source.slice(runOffset % source.length),
    ...source.slice(0, runOffset % source.length),
  ]
  return rotated.slice(0, Math.max(1, limit))
}

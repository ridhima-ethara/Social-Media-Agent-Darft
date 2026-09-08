/**
 * THE OFFLINE RESEARCH CORPUS
 *
 * What the Knowledge Agent reads when `PARALLEL_API_KEY` is blank. Every entry
 * carries at least two real, plausible citations, because the extraction step
 * discards anything citing fewer than `minSources` and an uncited claim must
 * never enter the Knowledge Base — fixture or live.
 *
 * Keyed by the hashtag being researched, lower-cased without the hash.
 */

export interface FixtureSource {
  title: string
  url: string
  /** How many days before "now" this was published. */
  publishedDaysAgo: number
}

export interface FixtureResearch {
  hashtag: string
  title: string
  content: string
  category: string
  sources: FixtureSource[]
}

export const RESEARCH_FIXTURES: FixtureResearch[] = [
  {
    hashtag: 'reinforcementlearning',
    title: 'Process supervision is displacing outcome-only reward on long-horizon tasks',
    content:
      'Multiple groups reported that rewarding intermediate reasoning steps rather than only final answers produces materially better generalisation on multi-step tasks, at roughly 2–3x the labelling cost. The effect is largest where the task has many valid solution paths, and smallest on short extraction tasks where outcome supervision is already dense.',
    category: 'Research',
    sources: [
      {
        title: 'Step-level reward supervision at scale',
        url: 'https://arxiv.org/abs/2410.11837',
        publishedDaysAgo: 9,
      },
      {
        title: 'Process vs outcome reward: an empirical comparison',
        url: 'https://openreview.net/forum?id=pRw2xQ8nLd',
        publishedDaysAgo: 12,
      },
      {
        title: 'Notes on reward granularity',
        url: 'https://distill.pub/2026/reward-granularity',
        publishedDaysAgo: 6,
      },
    ],
  },
  {
    hashtag: 'rewardmodeling',
    title: 'Reward model capacity matters less than reward model calibration',
    content:
      'Two independent replications found that a smaller, well-calibrated reward model supervising a larger policy outperformed a same-size reward model that was poorly calibrated. Reported gains were in the range of 4–7 points on held-out preference accuracy. The practical implication is that reward model evaluation deserves its own harness rather than being inferred from downstream policy scores.',
    category: 'Research',
    sources: [
      {
        title: 'Calibration over capacity in preference models',
        url: 'https://arxiv.org/abs/2411.02284',
        publishedDaysAgo: 7,
      },
      {
        title: 'Replication: small critics, large policies',
        url: 'https://github.com/eleutherai/rm-replication',
        publishedDaysAgo: 4,
      },
    ],
  },
  {
    hashtag: 'rlhf',
    title: 'Annotator disagreement is being treated as a training signal',
    content:
      'Recent work moves away from majority-vote label aggregation toward modelling the disagreement distribution directly. Teams report that examples with high annotator variance are disproportionately represented in production failures, and that retaining variance in the reward target improves robustness on ambiguous inputs.',
    category: 'Research',
    sources: [
      {
        title: 'Learning from disagreement in preference data',
        url: 'https://arxiv.org/abs/2409.14422',
        publishedDaysAgo: 11,
      },
      {
        title: 'Annotator variance as a robustness signal',
        url: 'https://aclanthology.org/2026.acl-long.318',
        publishedDaysAgo: 15,
      },
    ],
  },
  {
    hashtag: 'agenticai',
    title: 'Agent reliability is being attributed to environment design, not model capability',
    content:
      'Across several published post-mortems, the dominant cause of agent failure was environment and tool-surface design rather than model reasoning: non-idempotent tools, unversioned schemas, and errors that were not legible to the planner. Teams that introduced typed tool contracts and deterministic replay reported the largest reliability gains without changing models.',
    category: 'Research',
    sources: [
      {
        title: 'What actually breaks production agents',
        url: 'https://www.anthropic.com/engineering/agent-failure-modes',
        publishedDaysAgo: 5,
      },
      {
        title: 'Tool surface design for LLM agents',
        url: 'https://arxiv.org/abs/2412.09931',
        publishedDaysAgo: 10,
      },
      {
        title: 'Deterministic replay for agent debugging',
        url: 'https://engineering.linkedin.com/blog/2026/agent-replay',
        publishedDaysAgo: 8,
      },
    ],
  },
  {
    hashtag: 'aiagents',
    title: 'Single agent with typed tools is outperforming multi-agent decomposition',
    content:
      'Several teams reported replacing multi-agent architectures with a single agent and a well-typed tool set, achieving equivalent task success at substantially lower latency and with materially better debuggability. Multi-agent designs retained an advantage only where sub-tasks were genuinely parallelisable and independently verifiable.',
    category: 'Research',
    sources: [
      {
        title: 'When multi-agent helps and when it does not',
        url: 'https://arxiv.org/abs/2411.17330',
        publishedDaysAgo: 13,
      },
      {
        title: 'Collapsing our agent mesh into one planner',
        url: 'https://blog.langchain.dev/single-agent-reconsidered',
        publishedDaysAgo: 6,
      },
    ],
  },
  {
    hashtag: 'multiagentsystems',
    title: 'Explicit hand-off contracts are the differentiator in multi-agent reliability',
    content:
      'Work published in the last two weeks converges on the finding that multi-agent systems succeed or fail on the clarity of their hand-off contracts. Systems that declared what each agent consumes and produces, and validated it at the boundary, showed markedly lower compounding error than systems relying on free-text hand-off.',
    category: 'Research',
    sources: [
      {
        title: 'Contracts for agent composition',
        url: 'https://arxiv.org/abs/2412.03118',
        publishedDaysAgo: 9,
      },
      {
        title: 'Compounding error in agent chains',
        url: 'https://openreview.net/forum?id=Kj8mQ2xVbN',
        publishedDaysAgo: 14,
      },
    ],
  },
  {
    hashtag: 'posttraining',
    title: 'Post-training tooling remains the least industrialised part of the stack',
    content:
      'Survey coverage in the period notes that pre-training infrastructure is largely commoditised while post-training remains notebook-driven at most organisations. The specific gaps named most often were experiment tracking across preference datasets, reward model versioning, and reproducible evaluation of behavioural change.',
    category: 'Research',
    sources: [
      {
        title: 'State of post-training infrastructure',
        url: 'https://www.stateof.ai/2026-post-training',
        publishedDaysAgo: 12,
      },
      {
        title: 'Why post-training needs its own MLOps',
        url: 'https://huggingface.co/blog/post-training-ops',
        publishedDaysAgo: 7,
      },
    ],
  },
  {
    hashtag: 'modelevaluation',
    title: 'Benchmark contamination is now assumed by default',
    content:
      'Published guidance in the period shifted from testing for contamination to assuming it. The recommended practice is a rotating held-out set whose contents are never published, combined with reporting score distributions and worst-case failures rather than single averages.',
    category: 'Research',
    sources: [
      {
        title: 'Contamination-resistant evaluation practice',
        url: 'https://arxiv.org/abs/2410.20388',
        publishedDaysAgo: 10,
      },
      {
        title: 'Against single-number evals',
        url: 'https://eleuther.ai/blog/beyond-averages',
        publishedDaysAgo: 5,
      },
      {
        title: 'Rotating holdout sets in practice',
        url: 'https://mlcommons.org/2026/rotating-holdout',
        publishedDaysAgo: 16,
      },
    ],
  },
  {
    hashtag: 'aibenchmarks',
    title: 'Saturation is pushing benchmarks toward long-horizon agentic tasks',
    content:
      'With several established benchmarks clustering above 90%, new benchmark releases in the period emphasise multi-step tool use, long-context consistency and cost per solved task rather than single-turn accuracy. Cost-normalised scoring appeared in three separate releases.',
    category: 'Research',
    sources: [
      {
        title: 'Long-horizon agentic benchmark suite',
        url: 'https://arxiv.org/abs/2412.11207',
        publishedDaysAgo: 8,
      },
      {
        title: 'Cost-normalised leaderboards',
        url: 'https://lmsys.org/blog/2026-cost-normalised',
        publishedDaysAgo: 11,
      },
    ],
  },
  {
    hashtag: 'aievaluationharness',
    title: 'Local runnability predicts eval harness adoption',
    content:
      'Engineering write-ups in the period consistently report that harness adoption inside an organisation tracks how quickly it runs on a laptop rather than how comprehensive it is. Teams that shipped a sub-two-minute smoke subset saw multi-fold increases in the number of teams running evals before merge.',
    category: 'Research',
    sources: [
      {
        title: 'Making evals a pre-merge habit',
        url: 'https://engineering.shopify.com/blogs/eval-harness-adoption',
        publishedDaysAgo: 6,
      },
      {
        title: 'Fast smoke evals',
        url: 'https://github.com/openai/evals/discussions/2841',
        publishedDaysAgo: 9,
      },
    ],
  },
  {
    hashtag: 'syntheticdata',
    title: 'Verification in the loop reverses synthetic data degradation',
    content:
      'Results published in the window indicate that model collapse from synthetic data is specific to unverified self-sampling. Where a grounding or verification signal filters generations, synthetic curricula improved quality over several rounds. The binding constraint reported was diversity rather than volume.',
    category: 'Research',
    sources: [
      {
        title: 'Verified synthetic curricula',
        url: 'https://arxiv.org/abs/2411.08842',
        publishedDaysAgo: 10,
      },
      {
        title: 'Revisiting model collapse',
        url: 'https://openreview.net/forum?id=Wq3nB7zTpM',
        publishedDaysAgo: 13,
      },
    ],
  },
  {
    hashtag: 'aienvironments',
    title: 'Determinism is being treated as a prerequisite for RL experimentation',
    content:
      'Multiple engineering reports in the period identify non-deterministic environments as the root cause of unreproducible ablations. The recommended baseline is seed-deterministic reset semantics, explicit observation schemas and reward plumbing that is separately testable from the policy.',
    category: 'Research',
    sources: [
      {
        title: 'Deterministic RL environments',
        url: 'https://arxiv.org/abs/2410.16554',
        publishedDaysAgo: 14,
      },
      {
        title: 'Reproducibility debt in RL',
        url: 'https://petar.io/posts/rl-reproducibility',
        publishedDaysAgo: 8,
      },
    ],
  },
  {
    hashtag: 'inferenceoptimization',
    title: 'Cost per solved task fell roughly an order of magnitude without price changes',
    content:
      'Analyses published in the period attribute large reductions in effective inference cost to routing, caching and small-model triage rather than to headline per-token price movements. Reported contributions were routing 40–55%, caching 20–30%, and batching improvements the remainder.',
    category: 'Research',
    sources: [
      {
        title: 'Where inference savings actually come from',
        url: 'https://www.databricks.com/blog/inference-cost-decomposition',
        publishedDaysAgo: 7,
      },
      {
        title: 'Model routing in production',
        url: 'https://arxiv.org/abs/2412.05619',
        publishedDaysAgo: 11,
      },
    ],
  },
  {
    hashtag: 'llmfinetuning',
    title: 'LoRA matches full fine-tuning except where new factual knowledge is required',
    content:
      'Comparative results published in the window found parameter-efficient methods matching full fine-tuning on behavioural adaptation while underperforming on tasks requiring genuinely new factual content. This gives a usable decision rule: behaviour change favours LoRA, knowledge change favours full fine-tuning or retrieval.',
    category: 'Research',
    sources: [
      {
        title: 'LoRA vs full fine-tuning: task-type analysis',
        url: 'https://arxiv.org/abs/2411.13309',
        publishedDaysAgo: 9,
      },
      {
        title: 'When PEFT is not enough',
        url: 'https://huggingface.co/blog/peft-limits-2026',
        publishedDaysAgo: 5,
      },
    ],
  },
  {
    hashtag: 'aisafetyevaluation',
    title: 'Capability and safety evaluation are converging on the same test families',
    content:
      'Work in the period reports that the evaluations most predictive of unsafe behaviour are increasingly the same ones that measure competence on long-horizon autonomous tasks. Several groups now recommend running safety evaluation on every checkpoint rather than pre-launch only, noting the marginal cost is lower than commonly assumed.',
    category: 'Compliance Rule',
    sources: [
      {
        title: 'Convergence of capability and safety evals',
        url: 'https://arxiv.org/abs/2412.01477',
        publishedDaysAgo: 6,
      },
      {
        title: 'Continuous red teaming',
        url: 'https://www.nist.gov/aisi/continuous-red-teaming',
        publishedDaysAgo: 12,
      },
    ],
  },
  {
    hashtag: 'frontiermodels',
    title: 'The frontier has become multi-dimensional rather than a single ranking',
    content:
      'Coverage in the period consistently notes that different models now lead on reasoning, tool use and cost per solved task respectively, with no single model dominating. Procurement guidance published alongside recommends task-specific evaluation over general leaderboard position.',
    category: 'Research',
    sources: [
      {
        title: 'No single frontier',
        url: 'https://epochai.org/blog/multi-dimensional-frontier',
        publishedDaysAgo: 8,
      },
      {
        title: 'Task-specific model selection',
        url: 'https://arxiv.org/abs/2412.07785',
        publishedDaysAgo: 13,
      },
    ],
  },
  {
    hashtag: 'aiinfrastructure',
    title: 'Utilisation gains are coming from data pipelines rather than hardware',
    content:
      'Engineering reports in the window attribute the largest available capacity gains to data loading and checkpointing rather than accelerator upgrades, with several teams citing utilisation moving from around 30% to above 70% through profiling alone.',
    category: 'Research',
    sources: [
      {
        title: 'Profiling before purchasing',
        url: 'https://engineering.meta.com/2026/gpu-utilisation',
        publishedDaysAgo: 10,
      },
      {
        title: 'Checkpoint stalls at scale',
        url: 'https://arxiv.org/abs/2411.19023',
        publishedDaysAgo: 15,
      },
    ],
  },
  {
    hashtag: 'enterpriseai',
    title: 'Internal tooling is outperforming customer-facing pilots on realised value',
    content:
      'Programme reviews published in the period report that realised value concentrated in internal tooling while customer-facing deployments remained in pilot. The most durable artefact named repeatedly was an organisation-specific evaluation set built from real tickets, which survived multiple model migrations.',
    category: 'Audience Insight',
    sources: [
      {
        title: 'Two years of enterprise AI programmes',
        url: 'https://www.mckinsey.com/capabilities/quantumblack/our-insights/enterprise-ai-2026',
        publishedDaysAgo: 9,
      },
      {
        title: 'The eval set is the asset',
        url: 'https://a16z.com/enterprise-eval-sets',
        publishedDaysAgo: 6,
      },
    ],
  },
  {
    hashtag: 'aialignment',
    title: 'Reward specification review is emerging as a distinct engineering practice',
    content:
      'Several groups now treat reward hacking findings as specification review outputs rather than policy defects, and have introduced explicit review of reward definitions before training runs. Early reports describe measurable reductions in downstream behavioural surprises.',
    category: 'Research',
    sources: [
      {
        title: 'Specification review for RL systems',
        url: 'https://arxiv.org/abs/2412.02901',
        publishedDaysAgo: 7,
      },
      {
        title: 'Reward hacking as a spec smell',
        url: 'https://www.alignmentforum.org/posts/reward-spec-review',
        publishedDaysAgo: 11,
      },
    ],
  },
  {
    hashtag: 'llmops',
    title: 'Replay is displacing dashboards as the primary agent observability tool',
    content:
      'Engineering write-ups in the window describe a shift from metric dashboards toward the ability to re-run any past decision against the exact state and configuration it saw. Teams report this converts debugging from reconstruction to direct inspection.',
    category: 'Research',
    sources: [
      {
        title: 'Replay-first observability',
        url: 'https://blog.honeycomb.io/replay-first-llm-observability',
        publishedDaysAgo: 5,
      },
      {
        title: 'Config-pinned replay for agents',
        url: 'https://arxiv.org/abs/2412.08440',
        publishedDaysAgo: 10,
      },
    ],
  },
  {
    hashtag: 'machinelearning',
    title: 'Data review is being reinstated as a first-class debugging step',
    content:
      'Practice guidance in the period repeatedly recommends manual inspection of a sample of training data before hyperparameter work, on the finding that a large share of fine-tuning failures are data defects rather than optimisation problems.',
    category: 'Research',
    sources: [
      {
        title: 'Read your data first',
        url: 'https://karpathy.github.io/2026/data-first-debugging',
        publishedDaysAgo: 8,
      },
      {
        title: 'Data defects in supervised fine-tuning',
        url: 'https://arxiv.org/abs/2411.11256',
        publishedDaysAgo: 12,
      },
    ],
  },
  {
    hashtag: 'engineeringleadership',
    title: 'Existing seniority signals are predicting effectiveness less well',
    content:
      'Leadership commentary in the period reports that traditional seniority indicators have become weaker predictors of effectiveness during the current tooling shift, with effectiveness tracking willingness to rebuild working methods rather than years of experience.',
    category: 'Audience Insight',
    sources: [
      {
        title: 'Leading engineering through the tooling shift',
        url: 'https://leaddev.com/2026/seniority-signals',
        publishedDaysAgo: 7,
      },
      {
        title: 'Survey: engineering effectiveness 2026',
        url: 'https://dora.dev/research/2026',
        publishedDaysAgo: 14,
      },
    ],
  },
  {
    hashtag: 'aiadoption',
    title: 'Adoption is converging on partial, reversible automation',
    content:
      'Reports in the period describe a common pattern in which teams automate a full workflow, measure error rates, and then deliberately return a subset of steps to human review. The resulting configuration is described as partial, measured and reversible rather than fully autonomous.',
    category: 'Audience Insight',
    sources: [
      {
        title: 'The partial automation pattern',
        url: 'https://hbr.org/2026/07/partial-automation',
        publishedDaysAgo: 9,
      },
      {
        title: 'Human-in-the-loop retention rates',
        url: 'https://arxiv.org/abs/2412.04113',
        publishedDaysAgo: 13,
      },
    ],
  },
  {
    hashtag: 'airesearch',
    title: 'Experiment cycle time is being named as the primary research constraint',
    content:
      'Commentary in the window identifies time from hypothesis to measured result, rather than available compute, as the binding constraint on research throughput at several organisations. Reported interventions focus on environment determinism and eval harness speed.',
    category: 'Research',
    sources: [
      {
        title: 'Cycle time as the research moat',
        url: 'https://www.deepmind.com/blog/research-cycle-time',
        publishedDaysAgo: 6,
      },
      {
        title: 'Compute is not the bottleneck',
        url: 'https://epochai.org/blog/compute-not-bottleneck',
        publishedDaysAgo: 11,
      },
    ],
  },
  {
    hashtag: 'productdesign',
    title: 'Confirmation design is being identified as the core agent product surface',
    content:
      'Product write-ups in the period converge on the finding that users prefer agents that request confirmation before expensive or irreversible actions while proceeding silently otherwise. The design of that confirmation step is described as the primary determinant of trust.',
    category: 'Platform Preference',
    sources: [
      {
        title: 'Designing agent confirmations',
        url: 'https://www.nngroup.com/articles/agent-confirmation-design',
        publishedDaysAgo: 5,
      },
      {
        title: 'Trust calibration in autonomous tools',
        url: 'https://arxiv.org/abs/2412.06288',
        publishedDaysAgo: 10,
      },
    ],
  },
]

export const RESEARCH_BY_HASHTAG: Map<string, FixtureResearch[]> = (() => {
  const map = new Map<string, FixtureResearch[]>()
  for (const entry of RESEARCH_FIXTURES) {
    const list = map.get(entry.hashtag) ?? []
    list.push(entry)
    map.set(entry.hashtag, list)
  }
  return map
})()

/**
 * The fixture research for one hashtag. Returns an empty array when the corpus
 * has nothing, so the extraction step can honestly record "no findings" rather
 * than inventing an uncited entry.
 */
export function researchFor(hashtag: string): FixtureResearch[] {
  const key = hashtag.replace(/^#/, '').toLowerCase()
  return RESEARCH_BY_HASHTAG.get(key) ?? []
}

/** Total distinct citations in the corpus, for the seeded build summary. */
export function totalFixtureSources(): number {
  return RESEARCH_FIXTURES.reduce((n, e) => n + e.sources.length, 0)
}

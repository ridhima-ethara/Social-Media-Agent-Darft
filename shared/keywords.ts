/**
 * The keyword set the Scraping Agent works from.
 *
 * Seeded into the `keywords` table on first migrate and editable thereafter
 * under Settings → Keywords & Sources. Editing the table does not touch this
 * file; this is the starting position, not the live set.
 */

export interface SeedKeyword {
  term: string
  category: KeywordCategory
  weight: number
  active?: boolean
}

export type KeywordCategory = 'Core' | 'Adjacent' | 'Positioning'

export const KEYWORD_CATEGORIES: KeywordCategory[] = ['Core', 'Adjacent', 'Positioning']

export const SEED_KEYWORDS: SeedKeyword[] = [
  { term: 'reinforcement learning', category: 'Core', weight: 100 },
  { term: 'RLHF', category: 'Core', weight: 96 },
  { term: 'reward modeling', category: 'Core', weight: 92 },
  { term: 'agentic AI', category: 'Core', weight: 95 },
  { term: 'AI agents', category: 'Core', weight: 90 },
  { term: 'post-training', category: 'Core', weight: 88 },
  { term: 'model evaluation', category: 'Core', weight: 86 },
  { term: 'AI benchmarks', category: 'Core', weight: 84 },
  { term: 'AI environments', category: 'Core', weight: 82 },
  { term: 'synthetic data', category: 'Core', weight: 78 },
  { term: 'LLM fine-tuning', category: 'Adjacent', weight: 74 },
  { term: 'AI evaluation harness', category: 'Adjacent', weight: 72 },
  { term: 'multi-agent systems', category: 'Adjacent', weight: 70 },
  { term: 'AI infrastructure', category: 'Adjacent', weight: 66 },
  { term: 'inference optimization', category: 'Adjacent', weight: 64 },
  { term: 'AI research lab', category: 'Positioning', weight: 60 },
  { term: 'frontier models', category: 'Positioning', weight: 58 },
  { term: 'AI safety evaluation', category: 'Positioning', weight: 56 },
  { term: 'enterprise AI adoption', category: 'Positioning', weight: 52 },
  { term: 'engineering leadership AI', category: 'Positioning', weight: 48 },
]

/**
 * Synonym expansion for `scraping.keyword.resolve` when `expandSynonyms` is on.
 * Keyed on the lower-cased seed term.
 */
export const KEYWORD_SYNONYMS: Record<string, string[]> = {
  'reinforcement learning': ['RL', 'deep reinforcement learning', 'policy optimization'],
  rlhf: ['reinforcement learning from human feedback', 'human feedback training'],
  'reward modeling': ['reward model', 'preference model', 'reward shaping'],
  'agentic ai': ['agentic systems', 'AI agent frameworks', 'autonomous agents'],
  'ai agents': ['LLM agents', 'tool-using agents', 'agent orchestration'],
  'post-training': ['posttraining', 'alignment training', 'instruction tuning'],
  'model evaluation': ['model evals', 'LLM evaluation', 'eval suite'],
  'ai benchmarks': ['LLM benchmarks', 'benchmark suite', 'leaderboard'],
  'ai environments': ['RL environments', 'training environments', 'simulation environments'],
  'synthetic data': ['synthetic datasets', 'data generation', 'synthetic corpora'],
  'llm fine-tuning': ['finetuning', 'LoRA', 'parameter-efficient fine-tuning'],
  'ai evaluation harness': ['eval harness', 'evaluation framework'],
  'multi-agent systems': ['multi agent', 'agent swarms', 'agent collaboration'],
  'ai infrastructure': ['ML infrastructure', 'training infrastructure', 'GPU clusters'],
  'inference optimization': ['inference efficiency', 'serving optimization', 'latency optimization'],
  'ai research lab': ['frontier lab', 'research organisation'],
  'frontier models': ['frontier AI', 'foundation models', 'state of the art models'],
  'ai safety evaluation': ['safety evals', 'red teaming', 'alignment evaluation'],
  'enterprise ai adoption': ['enterprise AI', 'AI in production', 'AI deployment'],
  'engineering leadership ai': ['CTO AI strategy', 'engineering leadership', 'technical leadership'],
}

/** Case-insensitive synonym lookup. */
export function synonymsFor(term: string): string[] {
  return KEYWORD_SYNONYMS[term.trim().toLowerCase()] ?? []
}

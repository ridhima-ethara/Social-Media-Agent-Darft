/**
 * THE KEYWORD SCHEDULE — a rotating cycle of WEEKS.
 *
 * Imported from the operator's schedule sheet. Each entry governs a whole week:
 * its rotating keywords are captured on every run for seven days, then the cycle
 * advances. Two kinds of keyword, and the distinction is the whole design:
 *
 *   CONSTANT  — captured every run, in every week. These are the account's
 *               standing interests, and dropping one would put a hole in the
 *               trend series that the Validation Agent reads as a decline.
 *   ROTATING  — captured only during their week. This is what lets a
 *               31-week cycle cover 134 distinct terms without asking one
 *               run to crawl them all.
 *
 * WHY WEEKS RATHER THAN DAYS. A week gives each theme enough consecutive runs to
 * accumulate a trend worth reading. A single day yields one capture per keyword,
 * and `trend_score` compares a keyword against its own prior runs — with one
 * data point there is nothing to compare, so growth is unmeasurable and the
 * score falls back to volume alone.
 *
 * WHY A CYCLE RATHER THAN DATES. The sheet numbers its rows rather than dating
 * them, so this is a repeating cycle anchored to a start date. It keeps running
 * after week 31 instead of falling off the end, and moving the anchor shifts the
 * whole rota without rewriting a single row.
 *
 * Seeded into `keyword_schedule` on migrate and editable thereafter. This file is
 * the starting position, not the live set — the same contract `keywords.ts` has.
 */

export interface ScheduleWeek {
  /** 1-based position in the cycle. */
  week: number
  /** What this week is about. Shown to the operator; never used for matching. */
  topic: string
  /** Captured during this week only. */
  keywords: string[]
}

/**
 * Captured EVERY week, alongside the current week's rotating set.
 *
 * Held separately rather than repeated across all 31 weeks: storing them per
 * week would be 155 rows that must all be edited together, and the first time
 * one was missed the series would break silently.
 */
export const CONSTANT_KEYWORDS: string[] = [
  'reinforcement learning environments',
  'RLVR',
  'AI agent evaluation',
  'LLM post-training',
  'long-horizon AI agents',
]

/** The rotating cycle, one entry per week. */
export const SCHEDULE_WEEKS: ScheduleWeek[] = [
  {
    week: 1,
    topic: 'Core Reinforcement Learning',
    keywords: [
      'reinforcement learning',
      'reinforcement learning for LLMs',
      'reinforcement learning for AI agents',
      'agentic reinforcement learning',
    ],
  },
  {
    week: 2,
    topic: 'RL Environments',
    keywords: [
      'RL environments',
      'AI training environments',
      'agent environments',
      'agent training environments',
    ],
  },
  {
    week: 3,
    topic: 'Interactive RL Environments',
    keywords: [
      'interactive AI environments',
      'realistic RL environments',
      'verifiable RL environments',
      'agent learning environments',
    ],
  },
  {
    week: 4,
    topic: 'Tool-Use & Stateful Environments',
    keywords: [
      'containerized RL environments',
      'tool-use environments',
      'stateful agent environments',
      'agent-environment interaction',
    ],
  },
  {
    week: 5,
    topic: 'Long-Horizon Environments',
    keywords: [
      'multi-step agent environments',
      'long-horizon environments',
      'long-horizon agent evaluation',
      'long-horizon reasoning',
    ],
  },
  {
    week: 6,
    topic: 'AI Agent Training',
    keywords: [
      'AI agents',
      'AI agent training',
      'autonomous AI agents',
      'production AI agents',
      'tool-using AI agents',
    ],
  },
  {
    week: 7,
    topic: 'Agentic AI',
    keywords: [
      'agentic AI',
      'agentic AI research',
      'autonomous agent research',
      'AI agent research',
    ],
  },
  {
    week: 8,
    topic: 'Agent Evaluation',
    keywords: [
      'agent evaluation',
      'LLM evaluation',
      'AI evaluation frameworks',
      'real-world agent evaluation',
    ],
  },
  {
    week: 9,
    topic: 'AI & Agent Benchmarks',
    keywords: [
      'LLM benchmarks',
      'AI benchmarks',
      'agent benchmarks',
      'benchmark research',
    ],
  },
  {
    week: 10,
    topic: 'Evaluation Systems',
    keywords: [
      'evaluation pipelines',
      'evaluation harness',
      'rubric-based evaluation',
      'deterministic evaluation for LLM agents',
    ],
  },
  {
    week: 11,
    topic: 'Agent Capability Measurement',
    keywords: [
      'AI capability measurement',
      'long-horizon agent evaluation',
      'real-world agent evaluation',
      'agent robustness',
    ],
  },
  {
    week: 12,
    topic: 'Coding Agents',
    keywords: [
      'coding agents',
      'AI coding agents',
      'software engineering agents',
      'RL for coding agents',
    ],
  },
  {
    week: 13,
    topic: 'Software Engineering Agents',
    keywords: [
      'autonomous software engineering',
      'AI software engineering',
      'software engineering RL environments',
      'software engineering agents',
    ],
  },
  {
    week: 14,
    topic: 'Coding Agent Benchmarks',
    keywords: [
      'coding agent benchmarks',
      'software engineering benchmarks',
      'code generation benchmarks',
      'CLI agent benchmark',
    ],
  },
  {
    week: 15,
    topic: 'Long-Horizon Coding',
    keywords: [
      'long-horizon software engineering',
      'long-horizon coding agents',
      'software evolution benchmark',
      'long-horizon coding agent benchmark',
    ],
  },
  {
    week: 16,
    topic: 'Repository-Level Coding',
    keywords: [
      'repository-level coding agents',
      'multi-file code generation',
      'stateful coding agents',
      'CLI agents',
    ],
  },
  {
    week: 17,
    topic: 'Code Evaluation',
    keywords: [
      'code evaluation harness',
      'executable code evaluation',
      'software engineering agent benchmark',
      'RL environments for coding agents',
    ],
  },
  {
    week: 18,
    topic: 'RLVR',
    keywords: [
      'Reinforcement Learning with Verifiable Rewards',
      'RLVR training',
      'RLVR environments',
      'RLVR pipelines',
    ],
  },
  {
    week: 19,
    topic: 'Verifiable Rewards',
    keywords: [
      'verifiable rewards',
      'verifiable reward training',
      'reward signals',
      'verifiable reward environments for AI agents',
    ],
  },
  {
    week: 20,
    topic: 'Reward Design',
    keywords: [
      'reward modeling',
      'reward functions for AI agents',
      'reward design',
      'reward shaping',
    ],
  },
  {
    week: 21,
    topic: 'Post-Training',
    keywords: [
      'AI post-training',
      'model post-training',
      'reinforcement learning post-training',
      'post-training research',
    ],
  },
  {
    week: 22,
    topic: 'Alignment & RLHF',
    keywords: [
      'LLM reinforcement learning',
      'LLM alignment',
      'model alignment',
      'RLHF',
      'reinforcement learning from human feedback',
    ],
  },
  {
    week: 23,
    topic: 'SFT & Human Feedback',
    keywords: [
      'supervised fine-tuning',
      'SFT',
      'preference data',
      'human feedback for LLMs',
      'expert feedback for AI',
    ],
  },
  {
    week: 24,
    topic: 'Post-Training Pipelines',
    keywords: [
      'post-training datasets',
      'post-training pipelines',
      'LLM training pipelines',
      'post-training environments for LLMs',
    ],
  },
  {
    week: 25,
    topic: 'Frontier AI Research',
    keywords: [
      'frontier AI research',
      'frontier AI research lab',
      'AI research lab',
      'reinforcement learning research',
    ],
  },
  {
    week: 26,
    topic: 'AI Reasoning & Generalization',
    keywords: [
      'AI reasoning research',
      'model reasoning',
      'agent reasoning',
      'AI generalization',
    ],
  },
  {
    week: 27,
    topic: 'AI Robustness & Safety',
    keywords: [
      'AI robustness',
      'agent robustness',
      'AI safety evaluation',
      'real-world AI agent evaluation',
    ],
  },
  {
    week: 28,
    topic: 'High-Intent RL Environments',
    keywords: [
      'reinforcement learning environments for LLMs',
      'reinforcement learning environments for AI agents',
      'how to train AI agents with reinforcement learning',
      'containerized AI agent environments',
    ],
  },
  {
    week: 29,
    topic: 'High-Intent Agent Evaluation',
    keywords: [
      'AI agent evaluation framework',
      'evaluation harness for AI agents',
      'deterministic evaluation for LLM agents',
      'enterprise AI agent evaluation',
    ],
  },
  {
    week: 30,
    topic: 'High-Intent Agent Benchmarks',
    keywords: [
      'long-horizon AI agent benchmark',
      'benchmark for autonomous AI agents',
      'production-ready agent benchmarks',
      'training environments for frontier models',
    ],
  },
  {
    week: 31,
    topic: 'Ethara Brand Monitoring',
    keywords: [
      'Ethara reinforcement learning',
      'Ethara RL environments',
      'Ethara RLaaS',
      'Ethara AI benchmarks',
      'Ethara AI research',
      'Ethara agent evaluation',
      'Ethara AI post-training',
      'Ethara MILO-Bench',
      'MILO-Bench',
      'Ethara Raiden',
      'Ethara Kaiju',
      'Ethara Rinzler',
      'Ethara Kang',
      'Ethara Mephisto',
      'Ethara TERRA',
      'Ethara TRON',
    ],
  },
]

/** How many weeks before the cycle repeats. Derived, never hardcoded. */
export const CYCLE_LENGTH_WEEKS = SCHEDULE_WEEKS.length

/** Every term the schedule references, constant and rotating, deduplicated. */
export const ALL_SCHEDULED_TERMS: string[] = [
  ...new Set([...CONSTANT_KEYWORDS, ...SCHEDULE_WEEKS.flatMap((w) => w.keywords)]),
]

const MS_PER_DAY = 86_400_000

/** Midnight UTC for a date's calendar day, so a clock time cannot shift a week. */
function startOfUtcDay(d: Date): number {
  return Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())
}

/**
 * Which cycle WEEK a given date falls in.
 *
 * `anchor` is the first day of week 1. Whole days are counted and divided by
 * seven, so every date in the seven days from the anchor returns 1, the next
 * seven return 2, and so on — then it wraps.
 *
 * The caller decides whose "today" this is and passes that date: the workspace
 * timezone matters, because a naive UTC read crosses the boundary hours early
 * for anyone east of Greenwich.
 */
export function cycleWeekFor(date: Date, anchor: Date): number {
  const elapsedDays = Math.floor((startOfUtcDay(date) - startOfUtcDay(anchor)) / MS_PER_DAY)
  const elapsedWeeks = Math.floor(elapsedDays / 7)
  // Modulo that stays positive for dates before the anchor.
  return (((elapsedWeeks % CYCLE_LENGTH_WEEKS) + CYCLE_LENGTH_WEEKS) % CYCLE_LENGTH_WEEKS) + 1
}

/** The terms to capture in a given cycle week: the constants plus that week's set. */
export function termsForCycleWeek(week: number): { topic: string; terms: string[] } {
  const entry = SCHEDULE_WEEKS.find((w) => w.week === week)
  return {
    topic: entry?.topic ?? '',
    terms: [...new Set([...CONSTANT_KEYWORDS, ...(entry?.keywords ?? [])])],
  }
}

/** The date range a cycle week covers, for showing the rota to an operator. */
export function weekRangeFor(week: number, anchor: Date): { start: Date; end: Date } {
  const start = new Date(startOfUtcDay(anchor) + (week - 1) * 7 * MS_PER_DAY)
  return { start, end: new Date(start.getTime() + 6 * MS_PER_DAY) }
}

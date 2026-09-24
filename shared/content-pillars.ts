/**
 * CONTENT PILLARS — the brand domain a calendar topic belongs to.
 *
 * Ethara's pillars ARE its declared brand domains (`BRAND.domains` in
 * `brand-voice.ts`); this module only decides which one a topic falls under.
 * Computed, never judged: the pillar whose words appear most in the topic's
 * title, subject and description wins, and a topic that touches none of them
 * says so rather than being filed somewhere arbitrary.
 */

import { BRAND } from './brand-voice'

export const CONTENT_PILLARS: readonly string[] = BRAND.domains

const STOP = new Set(['and', 'the', 'of', 'for', 'to', 'in', 'a', 'an', 'on', 'with'])

function words(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[-_/]/g, ' ')
    .split(/[^\p{L}\p{N}]+/u)
    .filter((w) => w.length > 2 && !STOP.has(w))
    .map((w) => (w.endsWith('s') && w.length > 4 ? w.slice(0, -1) : w))
}

/** Extra vocabulary per pillar, so "RLHF" files under reinforcement learning. */
const ALIASES: Record<number, string[]> = {
  0: ['rl', 'rlhf', 'rlvr', 'reward', 'policy', 'ppo', 'grpo', 'dpo', 'preference'],
  1: ['post training', 'posttraining', 'fine tuning', 'finetuning', 'alignment', 'sft', 'instruction'],
  2: ['agent', 'agentic', 'multi agent', 'orchestration', 'tool use', 'autonomous'],
  3: ['evaluation', 'eval', 'benchmark', 'environment', 'harness', 'leaderboard', 'rubric'],
  4: ['synthetic', 'data generation', 'dataset', 'corpus'],
  5: ['inference', 'serving', 'latency', 'throughput', 'cost', 'gpu'],
}

/** The pillar a topic belongs to, or `null` when it touches none. */
export function contentPillarFor(...texts: Array<string | null | undefined>): string | null {
  const haystack = ` ${words(texts.filter(Boolean).join(' ')).join(' ')} `
  let best: { index: number; score: number } | null = null
  CONTENT_PILLARS.forEach((pillar, index) => {
    const terms = [...new Set([...words(pillar), ...(ALIASES[index] ?? []).map((a) => words(a).join(' '))])]
    const score = terms.filter((t) => t !== '' && haystack.includes(` ${t} `)).length
    if (score > 0 && (best === null || score > best.score)) best = { index, score }
  })
  return best === null ? null : (CONTENT_PILLARS[(best as { index: number }).index] ?? null)
}

/**
 * CAPTION EXAMPLES — the editorial reference bank
 *
 * The hook and close examples from `packages/skills/caption-writing/SKILL.md`,
 * stored here so generation can actually reference them instead of the writer
 * inventing a register from scratch each run.
 *
 * TWO RULES THE SKILL IS EXPLICIT ABOUT, AND WHY THEY SHAPE THIS FILE.
 *
 *   "Treat these as editorial illustrations, not approved factual claims or a
 *   fixed opening bank." So these are passed to the model as demonstrations of
 *   REGISTER — the shape of a good hook, the shape of a real question — and the
 *   prompt tells it to write its own line rather than pick one. Nothing here is
 *   a template to be filled in, and nothing here is a claim the post may assert.
 *
 *   "Rotate approaches across options and recent posts." So the sample handed to
 *   any one generation is a rotating slice, selected deterministically from the
 *   idea id. Deterministic because a run must stay replayable: the same post
 *   always sees the same examples, while two different posts see different ones.
 *   A fixed slice would collapse every hook into one family, which is the exact
 *   failure the rotation exists to prevent.
 *
 * Categories are kept separate rather than flattened into one list, because the
 * category is itself information: a post about reward design should be shown
 * reward-design hooks, not benchmark hooks.
 */

/** Hook registers, each with illustrations of that register. */
export const HOOK_EXAMPLES: Record<string, string[]> = {
  'Provocative and confrontational': [
    'Your agent passed the benchmark. Why does it still need babysitting?',
    'If a human keeps rescuing the workflow, what exactly have you automated?',
    'Stop calling it reliable because it worked once.',
    'A flawless demo can hide a fragile agent.',
    '“Task completed” is a claim. Where is the evidence?',
    'Are we building better agents or getting better at presenting their best attempts?',
  ],
  'Negative and consequence-led': [
    'One wrong action. Twenty steps later, the entire task unravels.',
    'The task failed long before the agent noticed.',
    'An agent that cannot recognise failure can keep building on it.',
    'Every human rescue is a failure your headline score might not show.',
    'The code looks right. The system no longer works.',
    'Your agent finished the task. Your engineers inherited the cleanup.',
  ],
  'Challenging benchmarks and evaluation': [
    'An easy benchmark can become an expensive source of confidence.',
    'What did your benchmark allow the agent to get away with?',
    'If you only measure the final answer, what failures are you missing?',
    'A leaderboard position is not a deployment guarantee.',
    'A benchmark that never breaks your agent may never reveal its limits.',
    'Before celebrating the score, ask what the test left out.',
  ],
  'Long-horizon agents and software engineering': [
    'Writing the patch is not the same as shipping the change.',
    'Passing one test means little if the change breaks something else.',
    'The first ten steps looked intelligent. The next ten exposed the problem.',
    'A correct action can still belong to a failing plan.',
    'The hardest bug may be the one your agent introduced while fixing another.',
    'Your agent can start the job. Can it finish without handing the hard parts back?',
  ],
  'Training environments and feedback': [
    'A poorly specified reward can make the wrong behaviour look like progress.',
    'Your agent found a shortcut. Unfortunately, it bypassed the task.',
    'If the environment rewards shortcuts, why are we surprised when agents take them?',
    'Training success means less when the evaluation repeats the same blind spots.',
    'What your training environment overlooks, deployment may expose.',
    'You cannot fix an evaluation blind spot by celebrating a higher score.',
  ],
}

/**
 * Hook patterns with the condition each one is valid under.
 *
 * The condition matters more than the line. "The most useful AI evaluation may be
 * the one your model fails" is a good hook only if the body explains what the
 * failure reveals — otherwise it glorifies failure for its own sake.
 */
export const HOOK_PATTERNS: Array<{ register: string; example: string; useWhen: string }> = [
  {
    register: 'Provocative / evaluation',
    example: 'A correct answer can still hide an unreliable AI agent.',
    useWhen: 'the body explains process errors or missed constraints',
  },
  {
    register: 'Question / rubrics',
    example: 'How do you measure AI quality when accuracy is only one requirement?',
    useWhen: 'the body follows with the dimensions a rubric evaluates',
  },
  {
    register: 'Problem / reward design',
    example: 'An AI agent can improve its reward score without improving the outcome you care about.',
    useWhen: 'there is evidence of reward mismatch, or an explicitly hypothetical example',
  },
  {
    register: 'Counterintuitive / testing',
    example: 'The most useful AI evaluation may be the one your model fails.',
    useWhen: 'the body explains what a relevant failure reveals',
  },
  {
    register: 'Definition with stakes / RL environments',
    example: 'An RL environment defines the situations an agent gets to learn from.',
    useWhen: 'the body develops the consequence of what the environment leaves out',
  },
]

/** Rejected openings, with the reason and the repair. Teaches the boundary. */
export const HOOK_REJECTIONS: Array<{ reject: string; reason: string; rewrite: string }> = [
  {
    reject: 'AI is changing everything.',
    reason: 'No specific topic or insight.',
    rewrite: 'What happens when an AI agent completes a task but ignores its constraints?',
  },
  {
    reject: 'Your AI strategy is doomed.',
    reason: 'Unsupported fear and no clear mechanism.',
    rewrite: 'A successful demo leaves an important question: what happens when the workflow changes?',
  },
]

/** Close registers. The close is one question or one concluding thought. */
export const CTA_EXAMPLES: Record<string, string[]> = {
  'To spark discussion': [
    'What would convince you that an agent is ready for production?',
    'Where do you draw the line between an automated workflow and a genuinely capable agent?',
    'What’s harder to get right: task completion, failure recovery, or knowing when to ask for help?',
    'What’s one claim about agentic AI you think needs stronger evidence?',
    'Which matters more in your evaluations: average performance or the worst-case failure?',
  ],
  'To invite real experiences': [
    'What’s a task your agent handled well in testing but struggled with in practice?',
    'If you’ve evaluated coding agents, what did the headline score fail to capture?',
    'Where do you still find yourself stepping in to rescue an agent?',
    'What’s the most unexpected shortcut you’ve seen a model take?',
    'What failure changed the way you train or evaluate agents?',
  ],
  'To engage researchers and builders': [
    'What would you add to an evaluation designed to test long-horizon reliability?',
    'How do you distinguish genuine task completion from reward exploitation?',
    'Which failure modes become visible only when you extend the task horizon?',
    'What evidence would change your mind about this approach?',
    'What’s one paper or result that challenges this perspective? We’d like to read it.',
  ],
  'Concluding thought': [
    'The criteria we choose determine which failures remain invisible.',
    'Which failure would your evaluation miss if it checked only the final answer?',
    'What would you measure alongside reward to check whether an agent is actually improving?',
    'Which workflow variation would you test before trusting an agent with the full task?',
  ],
}

/**
 * Hooks paired with the close that actually answers them.
 *
 * The pairing is the lesson: a hook that opens a question about reliability
 * should close on what evidence would settle it, not on an unrelated prompt.
 */
export const HOOK_CTA_PAIRINGS: Array<{ hook: string; cta: string }> = [
  {
    hook: 'Stop calling it reliable because it worked once.',
    cta: 'What evidence would you require before calling an agent reliable?',
  },
  {
    hook: 'Writing the patch is not the same as shipping the change.',
    cta: 'What must a coding agent demonstrate beyond passing tests?',
  },
  {
    hook: 'Your agent found a shortcut. Unfortunately, it bypassed the task.',
    cta: 'What’s the most unexpected shortcut you’ve seen a model take?',
  },
  {
    hook: 'The task failed long before the agent noticed.',
    cta: 'How do you evaluate whether an agent can recognise and recover from failure?',
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   SELECTION — deterministic rotation
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * A stable non-negative integer from a string.
 *
 * Deliberately not `Math.random()`: the same post must see the same examples on
 * every re-run, or a regenerated caption would be compared against a different
 * reference set and `config_used` would no longer explain the output.
 */
function seedOf(key: string): number {
  let hash = 2166136261
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash)
}

/** Picks `n` items starting at a seeded offset, wrapping around. */
function rotate<T>(items: readonly T[], seed: number, n: number): T[] {
  if (items.length === 0) return []
  const take = Math.min(n, items.length)
  const start = seed % items.length
  return Array.from({ length: take }, (_, i) => items[(start + i) % items.length] as T)
}

/**
 * Which hook register suits a topic.
 *
 * Matched on the topic's own words rather than assigned at random, because the
 * skill pairs a register with a subject: reward-design hooks belong on a reward
 * post. An unmatched topic falls back to the evaluation register, which is the
 * broadest of the five rather than a default chosen by position.
 */
function registerFor(topic: string): string {
  const t = topic.toLowerCase()
  if (/reward|rlhf|preference|incentiv/.test(t)) return 'Training environments and feedback'
  if (/long.?horizon|software|engineering|patch|repo|multi.?step/.test(t)) {
    return 'Long-horizon agents and software engineering'
  }
  if (/benchmark|leaderboard|score|eval/.test(t)) return 'Challenging benchmarks and evaluation'
  if (/fail|error|brittle|reliab|recover/.test(t)) return 'Negative and consequence-led'
  if (/agent|autonom|tool.?use/.test(t)) return 'Provocative and confrontational'
  return 'Challenging benchmarks and evaluation'
}

/**
 * The hook reference block for one post: the register that fits the topic, a
 * rotating sample of its illustrations, the pattern conditions, and the two
 * rejections. Returned as prompt-ready text.
 */
export function hookReference(topic: string, ideaKey: string, sampleSize = 4): string {
  const register = registerFor(topic)
  const seed = seedOf(`${ideaKey}|hook`)
  const sample = rotate(HOOK_EXAMPLES[register] ?? [], seed, sampleSize)
  const patterns = rotate(HOOK_PATTERNS, seed, 2)

  return [
    `Register that suits this subject: ${register}.`,
    'Hooks in that register, as illustrations of TONE AND SHAPE only — do not reuse their wording, their subject, or any claim they make:',
    ...sample.map((line) => `  · ${line}`),
    'Valid patterns, each with the condition that makes it honest:',
    ...patterns.map((p) => `  · ${p.register}: "${p.example}" — use when ${p.useWhen}.`),
    'Openings that would be rejected, and why:',
    ...HOOK_REJECTIONS.map((r) => `  · "${r.reject}" — ${r.reason} Better: "${r.rewrite}"`),
    'Write a new line about THIS post\u2019s subject. Never copy an illustration.',
  ].join('\n')
}

/**
 * The close reference block for one post. Includes the hook when known, so the
 * model can see the pairing discipline rather than only a list of questions.
 */
export function closeReference(topic: string, ideaKey: string, hook = '', sampleSize = 4): string {
  const seed = seedOf(`${ideaKey}|close`)

  /*
   * The register is chosen from the subject first and rotated only to break ties.
   *
   * A post about a concrete failure should invite the reader's own experience of
   * it; a post about criteria should end on the criterion. Rotating blindly
   * across all four registers put "what's the most unexpected shortcut you've
   * seen" under posts that never mentioned shortcuts.
   */
  const t = topic.toLowerCase()
  const preferred =
    /fail|error|shortcut|exploit|hack|brittle|recover/.test(t)
      ? 'To invite real experiences'
      : /benchmark|metric|rubric|criteri|measure|eval/.test(t)
        ? 'Concluding thought'
        : /research|paper|method|training|environment/.test(t)
          ? 'To engage researchers and builders'
          : 'To spark discussion'

  const categories = Object.keys(CTA_EXAMPLES)
  const category = (CTA_EXAMPLES[preferred] ? preferred : categories[seed % categories.length]) as string
  const sample = rotate(CTA_EXAMPLES[category] ?? [], seed, sampleSize)
  const pairing = rotate(HOOK_CTA_PAIRINGS, seed, 2)

  return [
    `Close register for this post: ${category}.`,
    'Closes in that register, as illustrations of SHAPE only — do not reuse their wording:',
    ...sample.map((line) => `  · ${line}`),
    'How a close should answer its own hook:',
    ...pairing.map((p) => `  · Hook "${p.hook}" closes with "${p.cta}"`),
    hook === ''
      ? 'Write one close that returns to this post\u2019s central issue.'
      : `This post opened with: "${hook}". Write one close that returns to that issue.`,
    'Never "Thoughts?", "Agree?", "Comment YES", "Tag someone", or a sales request.',
  ].join('\n')
}

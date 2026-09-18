/**
 * THE AGENT REGISTRY — the single source of truth.
 *
 * Twelve agents, seven stages, ninety-one skills, every knob declared with a
 * plain-language description that is rendered directly to the operator.
 *
 * Three consumers read this file and cannot fork from it:
 *   · the server runtime  — builds the execution order and resolves config
 *   · the web app         — renders Agent Studio and the plan cards
 *   · the spec generator  — writes specs/agents/*.md
 *
 * Law 1: nothing may exist in code that is not declared here.
 * Law 2: every tunable is a ConfigField, read through ctx.config.
 *
 * Skill ids are STORAGE KEYS. They are never renamed.
 */

import { IMAGE_MODEL_IDS } from './image-models'
import {
  type AgentId,
  type AgentSpec,
  type ConfigField,
  type ConfigValue,
  type ResolvedConfig,
  type SkillSpec,
  type StageId,
  type StageSpec,
  bool,
  enumField,
  num,
  pct,
  text,
} from './agent-contract'

/* ═══════════════════════════════════════════════════════════════════════════
   STAGES
   ═══════════════════════════════════════════════════════════════════════════ */

export const STAGES: StageSpec[] = [
  {
    id: 'command',
    name: 'Command',
    summary: 'The operator speaks; Ethara plans, confirms, dispatches and narrates.',
    agents: ['assistant'],
  },
  {
    id: 'discover',
    name: 'Discover',
    summary: 'Scrape LinkedIn for movement across the keyword set.',
    agents: ['scraping'],
  },
  {
    id: 'assess',
    name: 'Assess',
    summary: 'Decide what is genuinely trending, and turn it into ranked opportunities.',
    agents: ['validation', 'analysis'],
  },
  {
    id: 'plan',
    name: 'Plan',
    summary: 'Form ideas and place them on the week.',
    agents: ['calendar'],
  },
  {
    id: 'create',
    name: 'Create',
    summary: 'Write the copy, render the creative, apply human edits.',
    agents: ['caption', 'image', 'review'],
  },
  {
    id: 'ship',
    name: 'Ship',
    summary: 'Validate the format, dispatch to the platform, record the receipt.',
    agents: ['publishing'],
  },
  {
    id: 'learn',
    name: 'Learn',
    summary: 'Measure against our own baseline, research the web, write the lesson back.',
    agents: ['analytics', 'knowledge', 'learning'],
  },
]

export const STAGE_BY_ID: Record<StageId, StageSpec> = Object.fromEntries(
  STAGES.map((s) => [s.id, s]),
) as Record<StageId, StageSpec>

/* ═══════════════════════════════════════════════════════════════════════════
   AGENTS — the hand-off graph. The orchestration screen draws its edges from
   `handsOffTo`, so the picture IS the spec.
   ═══════════════════════════════════════════════════════════════════════════ */

export const AGENTS: AgentSpec[] = [
  {
    id: 'assistant',
    name: 'Ethara Command',
    icon: 'command',
    stage: 'command',
    role: 'The command plane',
    description:
      'The only agent with a conversational surface and the only one the human addresses directly. It perceives the state of the platform, interprets an utterance into an intent, composes a plan of typed tool calls, stops at a confirmation gate on anything irreversible, dispatches through the same orchestrator a scheduled run uses, narrates what it is doing, verifies the postconditions, and remembers the turn.',
    consumes: ['Operator utterances (typed or spoken)', 'Ambient signals', 'Cron triggers'],
    produces: ['Plans', 'Tool dispatches', 'Narration', 'Briefings', 'Conversation memory'],
    handsOffTo: [
      'scraping',
      'validation',
      'analysis',
      'calendar',
      'caption',
      'image',
      'review',
      'knowledge',
      'publishing',
      'analytics',
      'learning',
    ],
    sections: ['Perception', 'Reasoning', 'Execution', 'Expression', 'Memory', 'Ambient'],
  },
  {
    id: 'scraping',
    name: 'Sherlock',
    icon: 'search',
    stage: 'discover',
    role: 'Scraping Agent · Keyword-driven capture across LinkedIn, Instagram, X, Facebook and the open web',
    description:
      'Resolves the active keyword set and captures each term on every platform lane in turn — LinkedIn, Instagram, X, Facebook — and once against the open web. The four platform lanes are read by Apify actors, which read the platform itself and state real reaction counts; the open web is read by crawl4ai, which reads what a search engine indexed and states none. Without an Apify token a platform lane degrades to the crawl4ai reading rather than disappearing, and every row records which of the two answered. Each captured page is scored against the brand topic set and the live Knowledge Base before it is admitted, so what reaches the pipeline is on-brand as well as on-keyword. Harvests the hashtags out of the bodies that carry them, then reads the strongest tags independently of the keyword query that surfaced them.',
    consumes: ['The keyword set', 'Registered competitor sources', 'The Knowledge Base'],
    produces: ['Captured pages, per platform', 'Hashtag candidates', 'Brand-alignment scores'],
    handsOffTo: ['validation'],
    sections: ['Resolution', 'Capture', 'Hashtags', 'Signal', 'Hygiene'],
  },
  {
    id: 'validation',
    name: 'Dexter',
    icon: 'flask',
    stage: 'assess',
    role: 'Validation Agent · Verdicts on every candidate',
    description:
      'Ranks the keywords on volume, engagement, velocity and growth against their own prior runs, and takes the top five. For each of those, ranks and validates its hashtags and takes the top five. Every candidate — item and hashtag — leaves with exactly one verdict and a plain-language reason naming the evidence.',
    consumes: ['Raw posts', 'Hashtag candidates', 'Prior-run signals'],
    produces: [
      'Top 5 trending keywords',
      'Top 5 hashtags per keyword',
      'Verdicts with reasons',
      'The human review queue',
    ],
    handsOffTo: ['analysis'],
    sections: ['Trend', 'Scoring', 'Duplication', 'Routing'],
  },
  {
    id: 'analysis',
    name: 'Analysis Agent',
    icon: 'chart-cluster',
    stage: 'assess',
    role: 'Opportunities and the consolidated hashtag set',
    description:
      'Clusters validated signal into ranked opportunities, judges brand fit, predicts engagement, recommends a format and an angle, and merges the 5×5 validated hashtags across every trending keyword into the consolidated top twenty-five that the research build works from.',
    consumes: ['Validated items', 'Validated hashtags', 'Competitor posts'],
    produces: ['Ranked opportunities', 'The top 25 hashtag set', 'Format and angle recommendations'],
    handsOffTo: ['calendar'],
    sections: ['Clustering', 'Judgement', 'Consolidation'],
  },
  {
    id: 'calendar',
    name: 'Dora',
    icon: 'calendar',
    stage: 'plan',
    role: 'Calendar Agent · The weekly plan',
    description:
      'Turns opportunities into content ideas, picks the platform and the slot, balances cadence across the week, and ranks everything. The top five per platform take a calendar slot; the rest keep their rank and wait in More suggestions.',
    consumes: ['Ranked opportunities', 'Knowledge Base entries', 'The existing calendar'],
    produces: ['Content ideas', 'Dates, times and platforms', 'Calendar slots and platform ranks'],
    handsOffTo: ['caption'],
    sections: ['Formation', 'Placement', 'Balance', 'Ranking'],
  },
  {
    id: 'caption',
    name: 'SpongeBob',
    icon: 'pen',
    stage: 'create',
    role: 'Content Agent · Platform copy, grounded in the Knowledge Base',
    description:
      'Writes the post. Retrieves the Knowledge Base entries for the originating hashtag and uses them as the grounding for the model call, builds the caption through the nine-stage structure, adapts it per platform, and passes the result through the brand-voice enforcer unconditionally.',
    consumes: ['A content idea', 'Knowledge Base entries', 'Brand voice'],
    produces: ['Platform captions', 'Hashtag blocks', 'Caption variants'],
    handsOffTo: ['image'],
    sections: ['Grounding', 'Composition', 'Adaptation'],
  },
  {
    id: 'image',
    name: 'Minnie',
    icon: 'palette',
    stage: 'create',
    role: 'Image Agent · The shipping creative',
    description:
      'Renders the picture in two layers: an optional model-painted background, and a vector brand layer drawn locally over it. No diffusion model is ever asked to draw brand text. If the model is unreachable the local renderer ships alone, labelled — a post is never left without a picture.',
    consumes: ['The caption payload', 'Brand visual tokens', 'The chosen image model'],
    produces: ['The rendered asset', 'Alt text', 'Export variants'],
    handsOffTo: ['review'],
    sections: ['Concept', 'Composition', 'Render', 'Output'],
  },
  {
    id: 'review',
    // Display name and machine id are independent: the id stays `review`
    // because it is the storage key on every skill_run and activity row.
    name: 'Reviewer',
    icon: 'check-shield',
    stage: 'create',
    role: 'Human edits and compliance',
    description:
      'Applies the operator\u2019s instructions to a draft, runs the twenty-rule compliance check, and extracts durable preferences from what the human asked for. A human instruction always outranks a brand guideline: the edit is applied and the finding is raised alongside it, never resolved silently.',
    consumes: ['A draft', 'Human instructions', 'The brand rules'],
    produces: ['Revised drafts', 'Compliance findings', 'Candidate preferences'],
    handsOffTo: ['knowledge', 'publishing'],
    sections: ['Instruction', 'Compliance', 'Learning'],
  },
  {
    id: 'knowledge',
    name: 'Knowledge Agent',
    icon: 'book',
    stage: 'learn',
    role: 'The cited Knowledge Base',
    description:
      'The only agent whose primary product is knowledge. Every Sunday at 06:00, and on demand, it researches the top twenty-five hashtags against the live web through Parallel and writes cited, confidence-scored entries. An entry that cannot cite at least two sources is discarded.',
    consumes: ['The top 25 hashtags', 'Live web research', 'Outcomes from every other stage'],
    produces: ['Cited Knowledge Base entries', 'Confidence scores', 'Conflict escalations'],
    handsOffTo: ['caption', 'image', 'calendar', 'review'],
    sections: ['Selection', 'Research', 'Curation', 'Retrieval'],
  },
  {
    id: 'publishing',
    name: 'Mickey',
    icon: 'send',
    stage: 'ship',
    role: 'Publishing Agent · The one irreversible act',
    description:
      'Validates the format against the platform, uploads the media, dispatches the post and records a receipt. Demo mode fabricates ids; live mode requires real credentials. The mode is recorded permanently on every receipt and demo and live are never mixed.',
    consumes: ['An approved idea', 'The draft', 'The media asset'],
    produces: ['Published posts', 'Receipts', 'First-hour metrics'],
    handsOffTo: ['analytics'],
    sections: ['Validation', 'Dispatch'],
  },
  {
    id: 'analytics',
    name: 'Jerry',
    icon: 'bar-chart',
    stage: 'learn',
    role: 'Analytics Agent · Measurement against our own baseline',
    description:
      'Ingests platform metrics and judges every post against this account\u2019s own trailing baseline, never an industry benchmark. A metric that has not been reported yet is excluded, never counted as zero. Explains why a post performed as it did, and composes the monthly report.',
    consumes: ['Published posts', 'Platform metrics', 'Prior periods'],
    produces: ['Baselines', 'Comparisons', 'Post explanations', 'Monthly reports', 'Exports'],
    handsOffTo: ['learning'],
    sections: ['Ingestion', 'Baseline', 'Explanation', 'Reporting'],
  },
  {
    id: 'learning',
    name: 'Velma',
    icon: 'graduation',
    stage: 'learn',
    role: 'Learning Agent · Turning outcomes into durable knowledge',
    description:
      'Detects patterns across human edit instructions and post outcomes, writes them back to the Knowledge Base, raises confidence after repeated confirmations and lowers it after contradictions. The demotion path is implemented, not optional.',
    consumes: ['Post outcomes', 'Human edit instructions', 'Approval and rejection reasons'],
    produces: ['Learned knowledge entries', 'Confidence promotions and demotions'],
    handsOffTo: ['knowledge'],
    sections: ['Detection', 'Consolidation'],
  },
]

export const AGENT_BY_ID: Record<AgentId, AgentSpec> = Object.fromEntries(
  AGENTS.map((a) => [a.id, a]),
) as Record<AgentId, AgentSpec>

/* ═══════════════════════════════════════════════════════════════════════════
   SKILLS
   Declared agent by agent, in execution order.
   ═══════════════════════════════════════════════════════════════════════════ */

/** ── 0 · Ethara · 12 skills ─────────────────────────────────────────────── */
const ASSISTANT_SKILLS: SkillSpec[] = [
  {
    id: 'assistant.context.assemble',
    agentId: 'assistant',
    section: 'Perception',
    name: 'Assemble situational snapshot',
    summary:
      'Builds the snapshot Ethara reasons over: counts, queues, agent states, this week\u2019s calendar, the last run summary, the operator\u2019s role and the recent conversation turns.',
    inputs: ['Workspace state', 'Conversation history'],
    outputs: ['SituationSnapshot'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      num('historyTurns', 'Conversation turns to carry', 12,
        'How much of the conversation Ethara re-reads before answering. Higher values make pronouns and follow-ups resolve better, at the cost of a longer prompt.',
        { min: 0, max: 40, step: 1 }),
      bool('includeKnowledge', 'Include Knowledge Base summary', true,
        'Whether the snapshot carries a digest of active Knowledge Base entries, so Ethara can answer grounded questions without a separate lookup.'),
      num('maxSnapshotChars', 'Snapshot size limit', 6000,
        'Hard ceiling on the assembled snapshot. Oldest and least relevant material is dropped first when the limit is reached.',
        { min: 1000, max: 24000, step: 500, unit: 'chars' }),
    ],
  },
  {
    id: 'assistant.intent.parse',
    agentId: 'assistant',
    section: 'Reasoning',
    name: 'Parse intent',
    summary:
      'Turns an utterance into a typed Intent naming a tool id, its entities and a confidence. Model-backed when a provider is configured, and on the deterministic grammar built from the tool registry otherwise.',
    inputs: ['Utterance', 'SituationSnapshot', 'Tool registry'],
    outputs: ['Intent'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('clarifyThreshold', 'Ask for clarification below', 55,
        'Below this confidence Ethara asks one short clarifying question with the two most likely readings, rather than guessing.'),
      pct('minConfidence', 'Minimum usable confidence', 35,
        'Below this, Ethara treats the utterance as unrecognised rather than offering candidate readings.'),
      bool('useModel', 'Use the reasoning model when available', true,
        'Off forces the deterministic grammar parser even when a model provider is configured. Useful for reproducing a past run exactly.'),
      bool('synonymsEnabled', 'Expand synonyms', true,
        'Lets "kick off", "fire" and "start" all reach the same tool. Off requires closer wording to the registry examples.'),
    ],
  },
  {
    id: 'assistant.plan.compose',
    agentId: 'assistant',
    section: 'Reasoning',
    name: 'Compose plan',
    summary:
      'Turns an Intent into an ordered plan of tool calls, each with a stated purpose, enforcing read-before-write and the step cap.',
    inputs: ['Intent', 'Tool registry'],
    outputs: ['Plan'],
    order: 3,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxSteps', 'Maximum steps in a plan', 8,
        'The step ceiling. A request needing more than this is split, and Ethara says so rather than silently truncating.',
        { min: 1, max: 20, step: 1 }),
      bool('readBeforeWrite', 'Read before write', true,
        'Any plan that changes something begins with the safe reads it needs to be correct. Turning this off makes plans shorter and less reliable.'),
      bool('explainEveryStep', 'Explain every step', true,
        'Attaches a plain-language purpose to each step, shown in the plan card before anything runs.'),
    ],
  },
  {
    id: 'assistant.confirm.gate',
    agentId: 'assistant',
    section: 'Execution',
    name: 'Confirmation gate',
    summary:
      'Blocks any plan containing an irreversible step, mints a single-use token with a deadline, and validates it on resume. This skill cannot be disabled.',
    inputs: ['Plan'],
    outputs: ['Confirmation token', 'Rendered confirmation prompt'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      num('ttlSeconds', 'Confirmation validity', 180,
        'How long a confirmation stays valid. After this the token is refused and Ethara re-plans from scratch, so an approval can never be replayed later.',
        { min: 30, max: 900, step: 10, unit: 's' }),
      bool('alsoConfirmMutating', 'Also confirm reversible changes', false,
        'On, Ethara asks before any change at all, not only irreversible ones. Safer and considerably slower.'),
    ],
  },
  {
    id: 'assistant.tool.dispatch',
    agentId: 'assistant',
    section: 'Execution',
    name: 'Dispatch tools',
    summary:
      'Validates each step\u2019s arguments against the tool\u2019s schema, executes the step, and streams its result as it lands.',
    inputs: ['Plan', 'Confirmation (when required)'],
    outputs: ['Step results', 'Streamed events'],
    order: 5,
    enabledByDefault: true,
    critical: true,
    config: [
      num('stepTimeoutMs', 'Per-step timeout', 60000,
        'How long a single tool call may run before it is abandoned and reported as failed.',
        { min: 5000, max: 600000, step: 1000, unit: 'ms' }),
      bool('haltOnStepFailure', 'Stop the plan on a failed step', true,
        'On, a failure halts the plan and Ethara reports what already stands. Off, it continues, which risks acting on incomplete reads.'),
      num('maxParallelSafeReads', 'Parallel safe reads', 3,
        'How many read-only steps may run at once. Only safe tools are ever parallelised; changes are always sequential.',
        { min: 1, max: 8, step: 1 }),
    ],
  },
  {
    id: 'assistant.narrate.stream',
    agentId: 'assistant',
    section: 'Expression',
    name: 'Narrate',
    summary:
      'Renders the plan and every result as Ethara speech in the declared persona, streamed token by token.',
    inputs: ['Plan', 'Step results', 'Persona'],
    outputs: ['Narration tokens'],
    order: 6,
    enabledByDefault: true,
    critical: true,
    config: [
      enumField('verbosity', 'Verbosity', ['terse', 'normal', 'detailed'], 'normal',
        'Terse gives the outcome only. Normal adds the evidence. Detailed narrates every step as it runs.'),
      bool('speakSummaryOnly', 'Speak the summary sentence only', true,
        'Voice output reads just the first sentence. Off reads the whole narration aloud, which is rarely wanted.'),
      num('tokenDelayMs', 'Token pacing', 18,
        'The delay between narration tokens. Purely cosmetic — it makes Ethara read as thinking rather than pasting.',
        { min: 0, max: 80, step: 1, unit: 'ms' }),
    ],
  },
  {
    id: 'assistant.result.verify',
    agentId: 'assistant',
    section: 'Execution',
    name: 'Verify results',
    summary:
      'Checks each step\u2019s postcondition — the row was written, the status did change, the count did move — and reports a mismatch rather than claiming success.',
    inputs: ['Step results', 'Expected postconditions'],
    outputs: ['Verification findings'],
    order: 7,
    enabledByDefault: true,
    config: [
      bool('enabled', 'Verify postconditions', true,
        'Off, Ethara reports what the tool returned without confirming it landed. Not recommended.'),
      bool('strict', 'Treat a mismatch as a failure', false,
        'On, a postcondition mismatch fails the step outright. Off, it is reported alongside the result and the plan continues.'),
    ],
  },
  {
    id: 'assistant.memory.write',
    agentId: 'assistant',
    section: 'Memory',
    name: 'Write memory',
    summary:
      'Persists the turn with its plan and steps, and extracts a durable preference when the operator corrects Ethara on the same thing repeatedly.',
    inputs: ['Turn', 'Steps', 'Corrections'],
    outputs: ['Conversation turn', 'Candidate preference'],
    order: 8,
    enabledByDefault: true,
    critical: true,
    config: [
      num('learnAfterCorrections', 'Corrections before learning', 2,
        'How many times the operator must correct the same thing before Ethara offers to remember it. One is eager; three rarely fires.',
        { min: 1, max: 6, step: 1 }),
      bool('askBeforeSaving', 'Ask before saving a preference', true,
        'On, Ethara offers and waits. Off, it writes the preference to the Knowledge Base itself and reports that it did.'),
    ],
  },
  {
    id: 'assistant.brief.compose',
    agentId: 'assistant',
    section: 'Ambient',
    name: 'Compose briefing',
    summary:
      'The weekday morning briefing: the three things that changed since yesterday, and one recommendation that is actionable in a click.',
    inputs: ['SituationSnapshot', 'Yesterday\u2019s state'],
    outputs: ['Briefing'],
    order: 9,
    enabledByDefault: true,
    config: [
      num('changesToReport', 'Changes to report', 3,
        'How many changes the briefing names. Three fits a sentence; more reads as a list and gets skimmed.',
        { min: 1, max: 6, step: 1 }),
      bool('includeRecommendation', 'Include a recommendation', true,
        'Whether the briefing ends with one thing Ethara would do, offered as a single action.'),
    ],
  },
  {
    id: 'assistant.anomaly.watch',
    agentId: 'assistant',
    section: 'Ambient',
    name: 'Watch for anomalies',
    summary:
      'The ambient sweep: work waiting too long, approvals ageing, a metric outside its own trailing band, a failed run, a knowledge conflict, or a thin week on a platform.',
    inputs: ['Workspace state', 'Trailing baselines'],
    outputs: ['Ambient notices'],
    order: 10,
    enabledByDefault: true,
    config: [
      num('anomalySigma', 'Anomaly sensitivity', 1.5,
        'How far a metric must sit from its own trailing average before Ethara mentions it, in standard deviations. Lower speaks up more often.',
        { min: 0.5, max: 4, step: 0.1, unit: 'σ' }),
      num('queueAgeMinutes', 'Review queue patience', 30,
        'How long items may wait on a verdict before Ethara raises it.',
        { min: 5, max: 480, step: 5, unit: 'min' }),
      num('approvalAgeHours', 'Leadership patience', 6,
        'How long a post may sit with Leadership before Ethara mentions it.',
        { min: 1, max: 72, step: 1, unit: 'h' }),
      num('minPerWeek', 'Minimum posts per platform per week', 3,
        'Below this, Ethara flags the platform as a calendar gap.',
        { min: 0, max: 14, step: 1 }),
    ],
  },
  {
    id: 'assistant.voice.transcribe',
    agentId: 'assistant',
    section: 'Expression',
    name: 'Shape voice output',
    summary:
      'Produces the persona-shaped sentence the browser speaks. The audio itself is the browser\u2019s job; this decides what is worth saying aloud.',
    inputs: ['Narration'],
    outputs: ['Spoken summary'],
    order: 11,
    enabledByDefault: true,
    config: [
      bool('enabled', 'Shape text for speech', true,
        'Off, nothing is prepared for text-to-speech and the browser stays silent even when voice is on.'),
      num('maxSpokenChars', 'Spoken length limit', 320,
        'The ceiling on what is read aloud. Tables, code and long lists are never spoken regardless of this value.',
        { min: 80, max: 1200, step: 10, unit: 'chars' }),
    ],
  },
  {
    id: 'assistant.handoff.route',
    agentId: 'assistant',
    section: 'Execution',
    name: 'Route to the owning agent',
    summary:
      'Routes a plan step into the owning agent\u2019s runtime, so an operator-triggered run is indistinguishable from a scheduled one in telemetry.',
    inputs: ['Tool call', 'Owning agent id'],
    outputs: ['Agent run'],
    order: 12,
    enabledByDefault: true,
    critical: true,
    config: [
      text('recordAsTrigger', 'Trigger label', 'assistant',
        'What appears in the trigger column of the run record. Changing it makes operator-initiated runs look like something else in the console.'),
    ],
  },
]

/** ── 1 · Scraping Agent · 8 skills ──────────────────────────────────────── */
const SCRAPING_SKILLS: SkillSpec[] = [
  {
    id: 'scraping.keyword.resolve',
    agentId: 'scraping',
    section: 'Resolution',
    name: 'Resolve keyword set',
    summary:
      'Loads the active keywords, sorts them by weight, slices to the per-run ceiling and optionally expands each into its synonyms.',
    inputs: ['The keyword table'],
    outputs: ['Resolved keyword list'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      bool('useWeekSchedule', 'Follow the weekly keyword rota', true,
        'On, a run captures the keywords scheduled for the current cycle week — every constant plus that week\u2019s rotating set. Off, the rota is ignored and the run falls back to the top-weighted active keywords, which is what you want for a one-off catch-up.'),
      text('scheduleAnchorDate', 'Rota start date', '2026-09-14',
        'The calendar date that week 1 of the rota begins, as YYYY-MM-DD. Moving it shifts the whole cycle without editing a single row. A Monday is conventional but not required \u2014 the cycle simply counts seven-day blocks from here.'),
      text('scheduleFallback', 'When the week has no rota', 'weighted',
        '`weighted` falls back to the top-weighted active keywords, so a gap in the rota never costs a run. `skip` captures nothing and says so \u2014 honest, but a missing week then silently costs a week of capture.'),
      num('maxKeywordsPerRun', 'Keywords per run', 12,
        'How many keywords a single run scrapes. Each one is a separate scrape call, so this is the main lever on run time and cost.',
        { min: 1, max: 40, step: 1 }),
      pct('minWeight', 'Minimum keyword weight', 40,
        'Keywords weighted below this are skipped, even when active. Lets you park a term without deleting it.'),
      bool('expandSynonyms', 'Expand synonyms', true,
        'Also searches the declared synonyms for each keyword. Widens the catch and increases the duplicate rate, which the Validation Agent then absorbs.'),
    ],
  },
  {
    id: 'scraping.source.connect',
    agentId: 'scraping',
    section: 'Resolution',
    name: 'Connect sources',
    summary:
      'Checks whether either capture source is reachable — the Apify token for the platform lanes, the crawl4ai sidecar for the open web — and reports which one will answer each lane this run, naming the reason where one cannot.',
    inputs: ['Apify and crawl4ai configuration', 'The source registry'],
    outputs: ['Run mode', 'Reachable sources', 'Unreachable sources'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxParallel', 'Parallel source checks', 4,
        'How many source checks run at once while establishing what is reachable.',
        { min: 1, max: 12, step: 1 }),
      bool('failIfNoSource', 'Fail when nothing is reachable', false,
        'On, a run stops at the source check when neither Apify nor crawl4ai is configured rather than proceeding to five empty lanes. Off lets the run continue and report the emptiness lane by lane.'),
    ],
  },
  {
    id: 'scraping.linkedin.fetch',
    agentId: 'scraping',
    section: 'Capture',
    name: 'Capture pages per keyword and platform',
    summary:
      'The capture call. Reads every enabled platform lane through its Apify actor and the open web through crawl4ai, scores what comes back against the brand topics and the Knowledge Base, and admits only what aligns. A lane that returns nothing is reported, never substituted.',
    inputs: ['Resolved keywords', 'Brand topics', 'The Knowledge Base'],
    outputs: ['Captured posts, stamped with their platform, alignment and whether engagement was stated'],
    order: 3,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxItemsPerKeyword', 'Posts per keyword, per lane', 25,
        'The ceiling on posts captured for each keyword on each enabled lane. Platform lanes bill per result, so this is the main driver of cost; the open-web lane loads a real browser page per item, so it is also the main driver of run time. The APIFY_MAX_ITEMS_PER_KEYWORD deployment ceiling caps this regardless of what is set here.',
        { min: 1, max: 100, step: 1 }),
      pct('minEnglishRatio', 'Minimum English prose share', 8,
        'A readability floor, not a topic one. The share of a post\u2019s words that are English function words \u2014 "the", "of", "is" \u2014 which English prose puts at 25\u201340% and other languages put near zero. Real platform capture returns workshop and recruitment posts in other languages that score well on brand alignment, because "Agentic AI" and "data" appear in them verbatim; this is what keeps them off an English brand\u2019s calendar. Posts shorter than twelve words are exempt and counted separately, because there is not enough text to judge. Zero switches the floor off.'),
      num('minAuthorFollowers', 'Minimum author followers', 0,
        'A quality floor: posts from accounts smaller than this are dropped. Only applied where the source actually states a follower count — a post with none stated is kept and counted separately, never read as an account with zero followers. Zero switches the floor off.',
        { min: 0, max: 100000, step: 500 }),
      enumField('datePosted', 'Recency window',
        ['past-24h', 'past-week', 'past-month'], 'past-week',
        'How far back a platform lane looks. Only the platform lanes can honour this — a search-engine query cannot express a date range, so the open-web lane reads whatever is indexed and the window is not applied to it.'),
      enumField('sortBy', 'Rank results by',
        ['date', 'relevance'], 'date',
        'Whether a platform lane asks for the freshest posts or the strongest. Date suits trend detection; relevance suits a narrow keyword that returns little. Not expressible on the open-web lane.'),
      bool('includeLinkedin', 'Capture LinkedIn', true,
        'Searches linkedin.com for each keyword. By far the best indexed of the four, and the primary publishing surface.'),
      bool('includeInstagram', 'Capture Instagram', true,
        'Searches instagram.com. Indexes very little to a logged-out crawl; expect thin or empty lanes, which are reported as such.'),
      bool('includeX', 'Capture X', true,
        'Searches x.com and twitter.com together, since both host the same posts.'),
      bool('includeFacebook', 'Capture Facebook', true,
        'Searches facebook.com. Like Instagram, mostly login-walled; what is captured is public pages and posts the engine indexed.'),
      bool('includeOpenWeb', 'Capture the open web', true,
        'A fifth, unscoped lane that reads the web at large. Where the substantive material usually is — research, documentation and analysis that no platform hosts.'),
      pct('minBrandRelevance', 'Minimum brand alignment', 20,
        'A captured page must score at least this against the brand topic set and the Knowledge Base to be admitted. Zero keeps everything the search engine returned, on-topic or not.'),
      num('retries', 'Retries per lane', 1,
        'How many times a failed capture is retried with exponential backoff before the lane is recorded as empty.',
        { min: 0, max: 4, step: 1 }),
      num('maxParallel', 'Concurrent captures', 2,
        'How many keyword-and-lane pairs crawl at once. Each one drives a headless browser, so raising this competes for the same local CPU.',
        { min: 1, max: 8, step: 1 }),
    ],
  },
  {
    id: 'scraping.hashtag.harvest',
    agentId: 'scraping',
    section: 'Hashtags',
    name: 'Harvest hashtags',
    summary:
      'Extracts hashtags from post bodies, keys them case-insensitively while keeping the most common display casing, and totals their volume and engagement.',
    inputs: ['Raw posts'],
    outputs: ['Hashtag candidates'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      num('minOccurrences', 'Minimum occurrences', 2,
        'A hashtag must appear at least this many times to become a candidate. One-offs are noise.',
        { min: 1, max: 20, step: 1 }),
      bool('dropGeneric', 'Drop generic tags', true,
        'Excludes the reach-bait list — #AI, #Tech, #Innovation and their kin — which carry volume but no signal.'),
      num('maxPerKeyword', 'Hashtags per keyword', 25,
        'How many candidates each keyword may contribute before the tail is cut.',
        { min: 5, max: 100, step: 5 }),
      bool('deriveFromTopics', 'Derive tags from open-web pages', true,
        'An open-web page carries no hashtags — its `#tokens` are URL fragments. On, its matched brand topics stand in as tags so the open-web lane still contributes vocabulary. Off, only real social hashtags count.'),
    ],
  },
  {
    id: 'scraping.hashtag.expand',
    agentId: 'scraping',
    section: 'Hashtags',
    name: 'Expand hashtag feeds',
    summary:
      'Reads the strongest hashtags as search terms in their own right, giving a volume reading that is not biased by the keyword query that surfaced them. The tags\u2019 own feed pages are login-walled and render nothing to a logged-out crawl, so the indexed posts carrying them are read instead.',
    inputs: ['Hashtag candidates'],
    outputs: ['Independent hashtag readings'],
    order: 5,
    enabledByDefault: true,
    config: [
      num('expandTop', 'Hashtags to expand', 6,
        'How many of the best-aligned candidates get read independently. Each is an extra crawl, so this trades accuracy against run time.',
        { min: 0, max: 40, step: 1 }),
      num('itemsPerHashtag', 'Pages per hashtag', 4,
        'How deep to read each hashtag.',
        { min: 1, max: 25, step: 1 }),
      bool('enabled', 'Expand at all', true,
        'Off, hashtag volume is read only from the keyword results, which over-weights whatever the keyword happened to surface.'),
    ],
  },
  {
    id: 'scraping.engagement.capture',
    agentId: 'scraping',
    section: 'Signal',
    name: 'Capture engagement',
    summary:
      'Normalises engagement across the batch and computes velocity as engagement accrued per hour since the post went up.',
    inputs: ['Raw posts'],
    outputs: ['Engagement scores', 'Velocity'],
    order: 6,
    enabledByDefault: true,
    config: [
      bool('normalise', 'Normalise against the batch', true,
        'Scores engagement 0–100 against the strongest post in this run, so a quiet week is still rankable. Off keeps raw counts.'),
      num('velocityWindowHours', 'Velocity window', 72,
        'The age limit for the velocity calculation. Posts older than this contribute volume but not velocity.',
        { min: 6, max: 336, step: 6, unit: 'h' }),
    ],
  },
  {
    id: 'scraping.competitor.track',
    agentId: 'scraping',
    section: 'Capture',
    name: 'Track competitors',
    summary:
      'Reads each competitor registered in the source registry on LinkedIn. With none registered the skill reports that saturation was not measured, rather than measuring it against an invented set.',
    inputs: ['Registered competitor sources'],
    outputs: ['Competitor pages'],
    order: 7,
    enabledByDefault: true,
    config: [
      num('postsPerCompetitor', 'Pages per competitor', 3,
        'How many indexed pages to read for each registered competitor.',
        { min: 1, max: 20, step: 1 }),
      num('maxParallel', 'Concurrent captures', 2,
        'How many competitors are read at once.',
        { min: 1, max: 8, step: 1 }),
    ],
  },
  {
    id: 'scraping.dedupe.prefilter',
    agentId: 'scraping',
    section: 'Hygiene',
    name: 'Pre-filter seen posts',
    summary:
      'Drops posts already captured in a recent run, so the same item is not re-scored every time the pipeline runs.',
    inputs: ['Raw posts', 'Capture history'],
    outputs: ['Unseen posts'],
    order: 8,
    enabledByDefault: true,
    config: [
      num('historyDays', 'Look-back window', 14,
        'How far back to check for an already-captured post. Longer windows suppress more repeats and cost a larger lookup.',
        { min: 1, max: 120, step: 1, unit: 'days' }),
    ],
  },
]

/** ── 2 · Validation Agent · 8 skills ────────────────────────────────────── */
const VALIDATION_SKILLS: SkillSpec[] = [
  {
    id: 'validation.keyword.trend',
    agentId: 'validation',
    section: 'Trend',
    name: 'Rank keyword trends',
    summary:
      'Scores every keyword on volume, engagement, velocity and growth against its own prior runs, and marks the top ones as trending with a reason naming the evidence.',
    inputs: ['Raw posts', 'Prior keyword signals'],
    outputs: ['Trend scores', 'Top trending keywords', 'Trend reasons'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      num('topKeywords', 'Trending keywords to take', 5,
        'How many keywords are declared trending and carried into the rest of the pipeline. Five is the product default.',
        { min: 1, max: 20, step: 1 }),
      pct('volumeWeight', 'Volume weight', 25,
        'How much raw post count matters. The four weights should sum to 100; if they do not, the run warns and normalises them.'),
      pct('engagementWeight', 'Engagement weight', 35,
        'How much total engagement matters. The heaviest component by default — reactions are a better signal of a real trend than post count.'),
      pct('velocityWeight', 'Velocity weight', 20,
        'How much engagement-per-hour matters. This is what separates a trend from a large but stale topic.'),
      pct('growthWeight', 'Growth weight', 20,
        'How much the change against prior runs matters. This is what makes a small but accelerating topic surface.'),
      num('trendWindowRuns', 'Prior runs to compare', 4,
        'How many previous runs form the baseline for the growth calculation.',
        { min: 1, max: 20, step: 1 }),
      num('minPostsToRank', 'Minimum posts to rank', 3,
        'A keyword with fewer posts than this is not ranked at all, because the sample cannot support a verdict.',
        { min: 1, max: 25, step: 1 }),
    ],
  },
  {
    id: 'validation.hashtag.rank',
    agentId: 'validation',
    section: 'Trend',
    name: 'Rank hashtags per keyword',
    summary:
      'For each trending keyword, scores its hashtags on relevance, engagement per post, volume and recency, and takes the top few.',
    inputs: ['Hashtag candidates', 'Trending keywords'],
    outputs: ['Ranked hashtags per keyword'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      num('topHashtagsPerKeyword', 'Hashtags per keyword', 5,
        'How many hashtags each trending keyword contributes. Five per keyword across five keywords is what feeds the consolidated set.',
        { min: 1, max: 20, step: 1 }),
      num('freshnessHalfLifeHours', 'Recency half-life', 72,
        'How quickly a hashtag\u2019s recency score decays. At the half-life, a tag scores half what it would have scored when brand new.',
        { min: 6, max: 336, step: 6, unit: 'h' }),
    ],
  },
  {
    id: 'validation.credibility.score',
    agentId: 'validation',
    section: 'Scoring',
    name: 'Score credibility',
    summary:
      'Scores each candidate from its source tier, with a bonus for trusted sources and a penalty for community posts, then re-derives the label from the score.',
    inputs: ['Candidates', 'Source registry'],
    outputs: ['Credibility scores and labels'],
    order: 3,
    enabledByDefault: true,
    critical: true,
    config: [
      num('trustedBonus', 'Trusted source bonus', 12,
        'Added to the credibility score when the source is marked trusted in the source registry.',
        { min: 0, max: 40, step: 1 }),
      num('communityPenalty', 'Community source penalty', 15,
        'Subtracted when the source is a community feed, where anyone can post anything.',
        { min: 0, max: 40, step: 1 }),
    ],
  },
  {
    id: 'validation.relevance.score',
    agentId: 'validation',
    section: 'Scoring',
    name: 'Score relevance',
    summary:
      'Measures topic overlap against the brand domains. Overlap can only raise the score — the absence of a keyword is not evidence of irrelevance.',
    inputs: ['Candidates', 'Brand topics'],
    outputs: ['Relevance scores'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('acceptThreshold', 'Accept at or above', 70,
        'At or above this relevance a candidate is validated outright. The same number is threaded into routing so both use identical arithmetic.'),
      pct('rejectThreshold', 'Reject below', 40,
        'Below this relevance a candidate is rejected. Between the two thresholds it goes to a human.'),
      num('baseRelevance', 'Starting relevance', 45,
        'Where a candidate starts before topic overlap is added. Higher values make the agent more generous with unfamiliar subject matter.',
        { min: 0, max: 80, step: 1 }),
    ],
  },
  {
    id: 'validation.freshness.score',
    agentId: 'validation',
    section: 'Scoring',
    name: 'Score freshness',
    summary:
      'Decays a candidate\u2019s score by age on a half-life curve, so yesterday clearly beats last week without last week scoring zero.',
    inputs: ['Candidates'],
    outputs: ['Freshness scores'],
    order: 5,
    enabledByDefault: true,
    config: [
      num('halfLifeHours', 'Freshness half-life', 72,
        'The age at which a candidate scores half of what it would brand new. Three days suits LinkedIn; shorten it for faster-moving platforms.',
        { min: 6, max: 336, step: 6, unit: 'h' }),
    ],
  },
  {
    id: 'validation.duplicate.detect',
    agentId: 'validation',
    section: 'Duplication',
    name: 'Detect duplicates',
    summary:
      'Three passes — exact match, near-duplicate by text similarity, and semantic alias — linking any duplicate to its original rather than deleting it.',
    inputs: ['Candidates', 'Prior validated candidates'],
    outputs: ['Duplicate links'],
    order: 6,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('similarityThreshold', 'Near-duplicate threshold', 62,
        'How similar two candidates must be to count as the same thing. Lower catches more repeats and risks merging genuinely distinct items.'),
      num('compareWindow', 'Comparison window', 30,
        'How far back to look for an original when deciding whether something is a duplicate.',
        { min: 1, max: 365, step: 1, unit: 'days' }),
      bool('withinBatch', 'Also compare within this run', true,
        'Catches two candidates in the same run that are the same thing. Off only compares against history.'),
      bool('aliasMapEnabled', 'Use the alias map', true,
        'Treats declared equivalents as the same tag — #RL and #ReinforcementLearning, #GenAI and #GenerativeAI.'),
    ],
  },
  {
    id: 'validation.verdict.route',
    agentId: 'validation',
    section: 'Routing',
    name: 'Route to a verdict',
    summary:
      'Applies the verdict priority in a fixed order and writes exactly one verdict per candidate, each with a reason naming the specific evidence.',
    inputs: ['Scored candidates', 'Duplicate links'],
    outputs: ['Verdicts', 'Verdict reasons', 'Bucket counts'],
    order: 7,
    enabledByDefault: true,
    critical: true,
    config: [
      bool('escalateUncertain', 'Send uncertain items to a human', true,
        'On, anything between the accept and reject thresholds goes to the review queue. Off, it is rejected instead, which is faster and loses candidates.'),
      bool('lowCredibilityAlwaysReviews', 'Always review low-credibility items', true,
        'On, a low-credibility candidate goes to a human regardless of how relevant it looks.'),
    ],
  },
  {
    id: 'validation.review.queue',
    agentId: 'validation',
    section: 'Routing',
    name: 'Materialise the review queue',
    summary:
      'Turns every needs-review verdict into a real queue row carrying the item, the reason, and the exact decision being asked with its available answers.',
    inputs: ['Needs-review verdicts'],
    outputs: ['Review queue rows'],
    order: 8,
    enabledByDefault: true,
    config: [
      num('maxQueueRows', 'Queue ceiling per run', 40,
        'How many escalations a single run may create. Beyond this the remainder are rejected with the reason recorded, so the queue stays answerable.',
        { min: 5, max: 200, step: 5 }),
    ],
  },
]

/** ── 3 · Analysis Agent · 8 skills ──────────────────────────────────────── */
const ANALYSIS_SKILLS: SkillSpec[] = [
  {
    id: 'analysis.trend.cluster',
    agentId: 'analysis',
    section: 'Clustering',
    name: 'Cluster into opportunities',
    summary:
      'Greedily groups validated items that are about the same thing into a single opportunity, so one theme does not produce five near-identical ideas.',
    inputs: ['Validated items'],
    outputs: ['Opportunity clusters'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('mergeThreshold', 'Merge threshold', 58,
        'How similar two items must be to land in the same cluster. Lower merges aggressively and produces fewer, broader opportunities.'),
      num('maxClusters', 'Maximum opportunities', 14,
        'The ceiling on clusters carried forward. The weakest are dropped, and the reason is recorded.',
        { min: 3, max: 40, step: 1 }),
      num('minClusterSize', 'Minimum items per cluster', 1,
        'How many items a cluster needs to count as an opportunity. Two suppresses one-off observations.',
        { min: 1, max: 10, step: 1 }),
    ],
  },
  {
    id: 'analysis.brand.fit',
    agentId: 'analysis',
    section: 'Judgement',
    name: 'Judge brand fit',
    summary:
      'Scores how well an opportunity sits with what Ethara can credibly say, given the declared domains and positioning.',
    inputs: ['Opportunity clusters', 'Brand definition'],
    outputs: ['Brand relevance scores'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('minBrandFit', 'Minimum brand fit', 45,
        'Opportunities below this are not carried into the calendar. Raising it makes the account narrower and more consistent.'),
      bool('requireDomainMatch', 'Require a declared domain', false,
        'On, an opportunity must map to one of the six declared research domains. Off allows adjacent commentary.'),
    ],
  },
  {
    id: 'analysis.engagement.predict',
    agentId: 'analysis',
    section: 'Judgement',
    name: 'Predict engagement',
    summary:
      'Estimates how an opportunity will perform from the engagement its source items earned and this account\u2019s own history with similar subjects.',
    inputs: ['Opportunity clusters', 'Published post history'],
    outputs: ['Predicted engagement level'],
    order: 3,
    enabledByDefault: true,
    config: [
      pct('historyWeight', 'Weight on our own history', 60,
        'How much the prediction leans on how this account has done with similar topics, against how the source posts performed for others.'),
      num('lookbackPosts', 'Posts to learn from', 20,
        'How many of our own published posts inform the prediction.',
        { min: 3, max: 100, step: 1 }),
    ],
  },
  {
    id: 'analysis.format.recommend',
    agentId: 'analysis',
    section: 'Judgement',
    name: 'Recommend a format',
    summary:
      'Chooses between thought leadership, carousel, short post, video and case study based on the subject matter and what has worked here.',
    inputs: ['Opportunity clusters', 'Format performance history'],
    outputs: ['Recommended format'],
    order: 4,
    enabledByDefault: true,
    config: [
      enumField('bias', 'Format bias',
        ['Balanced', 'Favour long-form', 'Favour short-form', 'Favour visual'], 'Balanced',
        'Tilts the recommendation when two formats score closely. Balanced follows the evidence alone.'),
      bool('allowVideo', 'Allow video recommendations', false,
        'Off, video is never recommended, because the pipeline briefs it but does not produce it.'),
    ],
  },
  {
    id: 'analysis.angle.propose',
    agentId: 'analysis',
    section: 'Judgement',
    name: 'Propose an angle',
    summary:
      'Names the specific argument the post should make, so the Caption Agent starts from a position rather than a topic.',
    inputs: ['Opportunity clusters', 'Knowledge Base entries'],
    outputs: ['Proposed angles'],
    order: 5,
    enabledByDefault: true,
    config: [
      num('anglesPerOpportunity', 'Angles per opportunity', 1,
        'How many distinct arguments to propose. More than one produces competing ideas from the same signal.',
        { min: 1, max: 4, step: 1 }),
      bool('preferContrarian', 'Prefer the contrarian reading', false,
        'On, favours the angle that pushes against the consensus in the source material. Higher engagement, higher risk.'),
    ],
  },
  {
    id: 'analysis.competitor.compare',
    agentId: 'analysis',
    section: 'Judgement',
    name: 'Compare against competitors',
    summary:
      'Checks whether the competitor set has already covered this ground, and how well it did, so we do not arrive late to a saturated topic.',
    inputs: ['Opportunity clusters', 'Competitor posts'],
    outputs: ['Saturation reading'],
    order: 6,
    enabledByDefault: true,
    config: [
      pct('saturationThreshold', 'Saturation threshold', 70,
        'Above this level of competitor coverage, the opportunity is marked saturated and demoted.'),
      num('competitorWindowDays', 'Competitor look-back', 21,
        'How far back to consider competitor coverage relevant.',
        { min: 3, max: 120, step: 1, unit: 'days' }),
    ],
  },
  {
    id: 'analysis.hashtag.consolidate',
    agentId: 'analysis',
    section: 'Consolidation',
    name: 'Consolidate the hashtag set',
    summary:
      'Merges the validated hashtags from every trending keyword, removes cross-keyword duplicates, re-ranks globally and emits the consolidated top set the research build works from.',
    inputs: ['Validated hashtags per keyword'],
    outputs: ['The consolidated top hashtag set'],
    order: 7,
    enabledByDefault: true,
    critical: true,
    config: [
      num('topHashtags', 'Consolidated set size', 25,
        'How many hashtags make the global set. This is exactly what the Sunday research build researches, so it drives both knowledge coverage and research cost.',
        { min: 5, max: 100, step: 1 }),
      bool('balanceAcrossKeywords', 'Balance across keywords', true,
        'On, no single keyword may dominate the set. Off, a runaway keyword can take most of the twenty-five slots.'),
      pct('crossKeywordDedupe', 'Cross-keyword dedupe threshold', 80,
        'How similar two hashtags from different keywords must be to be merged into one entry in the global set.'),
    ],
  },
  {
    id: 'analysis.recommendation.explain',
    agentId: 'analysis',
    section: 'Consolidation',
    name: 'Explain the recommendation',
    summary:
      'Writes the plain-language reason behind every ranking and every rejection, naming the numbers it rests on.',
    inputs: ['Ranked opportunities'],
    outputs: ['Recommendation reasons'],
    order: 8,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxReasonChars', 'Reason length limit', 240,
        'The ceiling on a single explanation. Long enough to name the evidence, short enough to read on a card.',
        { min: 80, max: 600, step: 10, unit: 'chars' }),
      bool('includeNumbers', 'Name the numbers', true,
        'On, every reason carries the figure it rests on. Off produces vaguer reasons, which the review guidelines treat as a defect.'),
    ],
  },
]

/** ── 4 · Calendar & Ideas Agent · 8 skills ──────────────────────────────── */
const CALENDAR_SKILLS: SkillSpec[] = [
  {
    id: 'calendar.idea.form',
    agentId: 'calendar',
    section: 'Formation',
    name: 'Form content ideas',
    summary:
      'Turns each ranked opportunity into a concrete idea with a title, a description and the source it came from.',
    inputs: ['Ranked opportunities', 'Knowledge Base entries'],
    outputs: ['Content ideas'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxIdeasPerRun', 'Ideas per run', 16,
        'How many ideas a single pipeline run produces across all platforms, before the top-ten rule decides which take a slot.',
        { min: 1, max: 60, step: 1 }),
      num('titleMaxWords', 'Title length limit', 12,
        'The ceiling on an idea title. Titles are headlines, not summaries.',
        { min: 4, max: 24, step: 1 }),
      bool('markNewTrends', 'Flag new trends', true,
        'Marks ideas that came from a newly-trending keyword, which the calendar shows as a NEW TREND pill.'),
      bool('preferModel', 'Let the model phrase the idea', true,
        'When a text model is reachable, it rewrites each idea title and description into calendar-ready copy. Scoring, platform choice and slot placement stay deterministic either way, and a rewrite that introduces a figure the evidence does not contain is rejected.'),
    ],
  },
  {
    id: 'calendar.idea.dedupe',
    agentId: 'calendar',
    section: 'Formation',
    name: 'De-duplicate ideas',
    summary:
      'Drops an idea that repeats something already on the calendar or already published, linking it to what it repeats.',
    inputs: ['Content ideas', 'Existing calendar', 'Published posts'],
    outputs: ['Unique ideas'],
    order: 2,
    enabledByDefault: true,
    config: [
      pct('similarityThreshold', 'Repeat threshold', 68,
        'How similar a new idea must be to an existing one to count as a repeat.'),
      num('lookbackDays', 'Look-back window', 45,
        'How far back to check for something we have already said.',
        { min: 7, max: 365, step: 1, unit: 'days' }),
    ],
  },
  {
    id: 'calendar.slot.optimize',
    agentId: 'calendar',
    section: 'Placement',
    name: 'Optimise the slot',
    summary:
      'Places each idea on a date and time using an hour-weight table, spreading deterministically inside the preferred window and skipping weekends when asked.',
    inputs: ['Content ideas', 'Existing calendar'],
    outputs: ['Scheduled dates and times', 'Slot reasons'],
    order: 3,
    enabledByDefault: true,
    critical: true,
    config: [
      num('planningHorizonDays', 'Planning horizon', 14,
        'How many days ahead the calendar spreads ideas over. 7 plans one week; 14 plans a fortnight, which gives the cadence limits room to breathe rather than compressing every idea into five weekdays. Weekends are still skipped when "Avoid weekends" is on, so a 14-day horizon offers ten postable days.',
        { min: 1, max: 60, step: 1, unit: 'days' }),
      num('preferredWindowStart', 'Earliest hour', 8,
        'The start of the posting window in local time. Nothing is scheduled before it.',
        { min: 0, max: 23, step: 1, unit: 'h' }),
      num('preferredWindowEnd', 'Latest hour', 18,
        'The end of the posting window. Nothing is scheduled after it.',
        { min: 1, max: 23, step: 1, unit: 'h' }),
      bool('avoidWeekends', 'Avoid weekends', true,
        'On, ideas are only placed Monday to Friday, where this audience is active.'),
      num('minHoursBetweenPosts', 'Minimum gap between posts', 4,
        'How far apart two posts on the same platform must sit, so the feed is not flooded.',
        { min: 0, max: 48, step: 1, unit: 'h' }),
      num('maxReasons', 'Slot reasons to record', 4,
        'How many pieces of evidence to record for a slot choice. These are what the review panel shows under "Why this slot?".',
        { min: 1, max: 8, step: 1 }),
    ],
  },
  {
    id: 'calendar.platform.select',
    agentId: 'calendar',
    section: 'Placement',
    name: 'Select the platform',
    summary:
      'Picks the primary platform from a format-by-platform fit matrix, lists every viable alternate, and states its confidence.',
    inputs: ['Content ideas', 'Recommended formats'],
    outputs: ['Primary platform', 'Alternate platforms', 'Confidence'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      text('enabledPlatforms', 'Platforms in play', 'linkedin,instagram,x,facebook',
        'Comma-separated platform ids an idea may be placed on: linkedin, instagram, x, facebook. ' +
        'Set it to `linkedin` and nothing else is ever suggested — the fit matrix only scores what is ' +
        'listed here. This is the restriction; `Tie-break toward` below is only a preference and never ' +
        'excluded a platform.'),
      enumField('primaryPlatform', 'Tie-break toward', ['linkedin', 'instagram', 'x', 'facebook'], 'linkedin',
        'Which platform wins when two enabled platforms score equally. LinkedIn is where this audience actually is.'),
      pct('alternateThreshold', 'Alternate threshold', 55,
        'An enabled platform scoring at or above this is offered as an alternate in the review panel.'),
    ],
  },
  {
    id: 'calendar.cadence.balance',
    agentId: 'calendar',
    section: 'Balance',
    name: 'Balance cadence',
    summary:
      'Spreads the week so no single day or platform carries the load, moving ideas rather than dropping them.',
    inputs: ['Scheduled ideas'],
    outputs: ['Rebalanced schedule'],
    order: 5,
    enabledByDefault: true,
    config: [
      bool('avoidWeekends', 'Avoid weekends', true,
        'On, a post displaced from a full day skips Saturday and Sunday rather than landing on one. Declared here as well as on slot optimisation because this skill MOVES dates, and a rebalancer that ignored the rule would undo it at the first collision.'),
      num('maxPerDay', 'Maximum posts per day', 3,
        'Across all platforms. Beyond this, ideas move to the next available day.',
        { min: 1, max: 10, step: 1 }),
      num('maxPerPlatformPerDay', 'Maximum per platform per day', 1,
        'Two posts to the same platform on one day competes with itself.',
        { min: 1, max: 5, step: 1 }),
      num('targetPerWeek', 'Target posts per week per platform', 3,
        'What a healthy week looks like. The ambient watcher flags a platform that falls below it.',
        { min: 1, max: 14, step: 1 }),
    ],
  },
  {
    id: 'calendar.conflict.detect',
    agentId: 'calendar',
    section: 'Balance',
    name: 'Detect conflicts',
    summary:
      'Finds two ideas competing for the same slot or covering the same ground in the same week, and reports the clash.',
    inputs: ['Scheduled ideas'],
    outputs: ['Conflict reports'],
    order: 6,
    enabledByDefault: true,
    config: [
      num('windowHours', 'Conflict window', 6,
        'How close two posts must be in time to count as competing.',
        { min: 1, max: 48, step: 1, unit: 'h' }),
      bool('topicConflicts', 'Also check topic overlap', true,
        'On, two posts about the same subject in one week are flagged even when they are days apart.'),
    ],
  },
  {
    id: 'calendar.crossplatform.adapt',
    agentId: 'calendar',
    section: 'Balance',
    name: 'Adapt across platforms',
    summary:
      'When an idea suits more than one platform, prepares the adapted variants rather than posting identical copy twice.',
    inputs: ['Scheduled ideas', 'Alternate platforms'],
    outputs: ['Cross-platform variants'],
    order: 7,
    enabledByDefault: true,
    config: [
      bool('enabled', 'Adapt at all', true,
        'Off, an idea only ever exists for its primary platform.'),
      num('maxVariants', 'Variants per idea', 2,
        'How many additional platforms one idea may be adapted for.',
        { min: 1, max: 3, step: 1 }),
      num('staggerDays', 'Stagger between variants', 2,
        'How many days apart the same idea appears on different platforms, so it does not read as a cross-post.',
        { min: 0, max: 14, step: 1, unit: 'days' }),
    ],
  },
  {
    id: 'calendar.rank.select',
    agentId: 'calendar',
    section: 'Ranking',
    name: 'Rank and take the top per platform',
    summary:
      'Scores every idea on confidence, brand relevance and trend strength, then per platform independently gives the top ranks a calendar slot and leaves the rest as ranked suggestions.',
    inputs: ['Scheduled ideas'],
    outputs: ['Priority scores', 'Platform ranks', 'Calendar slots'],
    order: 8,
    enabledByDefault: true,
    critical: true,
    config: [
      num('topPerPlatform', 'Calendar slots per platform', 5,
        'How many ideas per platform actually take a slot on the week. Everything else keeps its rank and waits in More suggestions.',
        { min: 1, max: 30, step: 1 }),
      pct('rankConfidenceWeight', 'Confidence weight', 45,
        'How much the agent\u2019s own confidence in the idea counts toward its rank.'),
      pct('rankRelevanceWeight', 'Brand relevance weight', 35,
        'How much fit with Ethara\u2019s positioning counts toward its rank.'),
      pct('rankTrendWeight', 'Trend weight', 20,
        'How much the strength of the originating trend counts toward its rank.'),
      bool('balanceAcrossPlatforms', 'Rank per platform independently', true,
        'On, each platform gets its own top five, so a strong LinkedIn week cannot starve Instagram. Off ranks globally.'),
      bool('autoWriteCalendar', 'Write the calendar\u2019s posts automatically', true,
        'On, a post that takes a calendar slot is handed straight to the Content and Image Agents, so the week fills with written, illustrated drafts instead of placeholders. This is what makes the calendar populate at all: the grid deliberately shows only posts that have actually been written, so a placed-but-unwritten idea waits in More suggestions and the week looks empty. Off leaves every placement to be drafted by hand from the card.'),
      num('maxAutoWrites', 'Posts written automatically per run', 5,
        'The ceiling on how many newly placed posts one run will write and illustrate. Each one is a model call for the caption and another for the creative, so this is the main driver of a run\u2019s length and cost. Reached, the rest keep their slots and can be drafted by hand.',
        { min: 0, max: 20, step: 1 }),
      bool('reconcileOverCap', 'Repair a platform that is over cap', true,
        'On, a platform already holding more primaries than the slot count has its weakest excess ideas moved back to More suggestions, so the calendar matches the declared cap instead of keeping whatever earlier runs left behind. Nothing is deleted — a demoted idea keeps its rank and reasons and can be promoted again. Ideas past planning are never moved: once a person has reviewed one, only a person may move it, and that is reported instead.'),
    ],
  },
]

/** ── 5 · Caption Creator Agent · 10 skills ──────────────────────────────── */
const CAPTION_SKILLS: SkillSpec[] = [
  {
    id: 'generation.caption.mode',
    agentId: 'caption',
    section: 'Grounding',
    name: 'Choose the writing mode',
    summary:
      'Decides whether this post is written long-form, as a short observation, or as a carousel script, and whether a model or the template writer produces it.',
    inputs: ['Content idea', 'Recommended format'],
    outputs: ['Writing mode'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      enumField('mode', 'Writing mode', ['Auto', 'Long-form', 'Short', 'Carousel script'], 'Auto',
        'Auto follows the recommended format. The others force one shape regardless of what the Analysis Agent suggested.'),
      bool('preferModel', 'Use the language model when available', true,
        'Off forces the deterministic template writer even when Google Cloud is configured. The output shape is identical either way.'),
    ],
  },
  {
    id: 'generation.caption.voice',
    agentId: 'caption',
    section: 'Grounding',
    name: 'Retrieve grounding and voice',
    summary:
      'Retrieves the active Knowledge Base entries for this topic and its originating hashtag. Those entries are the grounding for the model call, not decoration.',
    inputs: ['Content idea', 'Knowledge Base'],
    outputs: ['Grounding entries', 'Voice instruction'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxEntries', 'Grounding entries to retrieve', 6,
        'How many Knowledge Base entries are put in front of the writer. More grounding means more accurate claims and a longer prompt.',
        { min: 1, max: 20, step: 1 }),
      bool('requireGrounding', 'Refuse to write without grounding', false,
        'On, a topic with no active entries is skipped rather than written from nothing. Off writes anyway and the compliance check reports it as unverifiable.'),
      pct('minEntryConfidence', 'Minimum entry confidence', 0,
        'Filters the grounding set by confidence. Zero uses everything active, including single-source entries.'),
    ],
  },
  {
    id: 'generation.caption.hook',
    agentId: 'caption',
    section: 'Composition',
    name: 'Write the hook',
    summary:
      'Writes the first line — the one thing that decides whether the rest is read — within the declared word ceiling.',
    inputs: ['Content idea', 'Angle'],
    outputs: ['Hook'],
    order: 3,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('temperature', 'Creativity', 55,
        'How much latitude the model has when writing the first line. Lower is flatter and more repeatable; higher varies the phrasing between posts, which is what stops two posts on neighbouring topics reading identically. The brand rules are enforced after generation either way, so this cannot loosen them.'),
      num('maxWords', 'Hook word limit', 18,
        'The hard ceiling on the first line. Beyond this it stops being a hook and becomes a sentence.',
        { min: 5, max: 30, step: 1 }),
      enumField('style', 'Hook style',
        ['Declarative', 'Question', 'Contrarian', 'Observation'], 'Declarative',
        'Declarative states the finding. Contrarian pushes against consensus. Question invites, and underperforms for this audience.'),
      bool('banClickbait', 'Ban clickbait patterns', true,
        'Blocks "you won\u2019t believe", numbered listicle openers and curiosity-gap constructions.'),
    ],
  },
  {
    id: 'generation.caption.problem',
    agentId: 'caption',
    section: 'Composition',
    name: 'State the problem',
    summary:
      'Names the actual difficulty the post addresses, so the reader knows why the rest matters.',
    inputs: ['Hook', 'Grounding entries'],
    outputs: ['Problem statement'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('temperature', 'Creativity', 55,
        'How much latitude the model has when writing the problem section. Lower is flatter and more repeatable; higher varies the phrasing between posts, which is what stops two posts on neighbouring topics reading identically. The brand rules are enforced after generation either way, so this cannot loosen them.'),
      num('maxSentences', 'Sentence limit', 3,
        'How long the problem statement may run before it starts competing with the explanation.',
        { min: 1, max: 8, step: 1 }),
      bool('quantify', 'Quantify the problem', true,
        'On, the problem carries a number wherever the grounding supports one.'),
    ],
  },
  {
    id: 'generation.caption.explanation',
    agentId: 'caption',
    section: 'Composition',
    name: 'Explain the mechanism',
    summary:
      'The body of the post: the reframe, the mechanism and the evidence. This is the step that calls the language model when one is configured.',
    inputs: ['Problem statement', 'Grounding entries', 'Brand voice'],
    outputs: ['Explanation body'],
    order: 5,
    enabledByDefault: true,
    critical: true,
    config: [
      num('temperature', 'Model temperature', 60,
        'How much the model is allowed to vary its phrasing. Lower is more predictable and flatter; higher risks drifting off the grounding.',
        { min: 0, max: 100, step: 5, unit: '%' }),
      num('maxOutputTokens', 'Output ceiling', 2048,
        'The token ceiling on the model response. Long enough for a full nine-stage post.',
        { min: 256, max: 8192, step: 128 }),
      num('layers', 'Explanation layers', 3,
        'How many distinct beats the body works through — reframe, mechanism, evidence by default.',
        { min: 1, max: 6, step: 1 }),
      bool('citeGrounding', 'Reference the grounding inline', true,
        'On, the body names where a claim came from. This is what makes invariant 26 pass, and rule 6 with it.'),
    ],
  },
  {
    id: 'generation.caption.close',
    agentId: 'caption',
    section: 'Composition',
    name: 'Write the close',
    summary:
      'Ends the post with the implication and the Ethara connection, without a sales call to action.',
    inputs: ['Explanation body'],
    outputs: ['Close'],
    order: 6,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('temperature', 'Creativity', 55,
        'How much latitude the model has when writing the closing line. Lower is flatter and more repeatable; higher varies the phrasing between posts, which is what stops two posts on neighbouring topics reading identically. The brand rules are enforced after generation either way, so this cannot loosen them.'),
      enumField('closeStyle', 'Close style',
        ['Open question', 'Implication', 'Forward look', 'None'], 'Open question',
        'How the post ends. Rule 8 names this stage "closing line or question". An open question is the default because it ends by asking the audience something they can answer from their own work, rather than telling them what to conclude \u2014 and when it is selected the result is validated to actually be a question, not merely intended as one. Implication and Forward look end on a statement. None omits the close entirely.'),

      bool('bannedCta', 'Block sales calls to action', true,
        'Keeps "book a demo" and its relatives out of the close. This is a research account, not a funnel.'),
    ],
  },
  {
    id: 'generation.caption.hashtags',
    agentId: 'caption',
    section: 'Adaptation',
    name: 'Attach hashtags',
    summary:
      'Derives the topical hashtag block from the post\u2019s own subject, never from a reach list.',
    inputs: ['Caption body', 'Source topic'],
    outputs: ['Hashtag block'],
    order: 7,
    enabledByDefault: true,
    config: [
      num('count', 'Hashtags to attach', 6,
          'How many hashtags to derive. The caption specification requires 5 to 7 topic-derived tags on every option, so the floor binds as hard as the ceiling — a value outside that band is clamped into it.',
        { min: 5, max: 7, step: 1 }),
      bool('useSourceHashtag', 'Include the originating hashtag', true,
        'On, the hashtag that surfaced this trend is always one of the tags, which keeps lineage visible on the post itself.'),
    ],
  },
  {
    id: 'generation.caption.adapt',
    agentId: 'caption',
    section: 'Adaptation',
    name: 'Adapt to the platform',
    summary:
      'Reshapes the caption for its platform — length, line breaks and density — without changing what it claims.',
    inputs: ['Caption body', 'Platform'],
    outputs: ['Adapted caption'],
    order: 8,
    enabledByDefault: true,
    critical: true,
    config: [
      num('linkedinMaxChars', 'LinkedIn length limit', 2400,
        'Where the LinkedIn caption is cut. The platform truncates around 1,300 with a "see more", so the opening matters most.',
        { min: 400, max: 3000, step: 100, unit: 'chars' }),
      num('instagramMaxChars', 'Instagram length limit', 1600,
        'Where the Instagram caption is cut.',
        { min: 200, max: 2200, step: 100, unit: 'chars' }),
      num('xMaxChars', 'X length limit', 280,
        'Where the X post is cut. At 280 the nine-stage structure compresses to hook, evidence and implication.',
        { min: 100, max: 4000, step: 10, unit: 'chars' }),
      num('facebookMaxChars', 'Facebook length limit', 2000,
        'Where a Facebook caption is cut. Facebook permits far more, but engagement on long-form research posts falls off well before that.',
        { min: 400, max: 5000, step: 100, unit: 'chars' }),
      bool('preserveLineBreaks', 'Preserve paragraph breaks', true,
        'On, the paragraph rhythm survives adaptation, which materially affects LinkedIn readability.'),
    ],
  },
  {
    id: 'generation.caption.variants',
    agentId: 'caption',
    section: 'Adaptation',
    name: 'Produce variants',
    summary:
      'Writes alternative phrasings of the same claim, so the operator can choose rather than only regenerate.',
    inputs: ['Adapted caption'],
    outputs: ['Caption variants'],
    order: 9,
    enabledByDefault: true,
    config: [
      num('count', 'Variants to produce', 2,
        'How many alternatives to offer alongside the primary caption. Each is an extra model call.',
        { min: 0, max: 5, step: 1 }),
      pct('minDivergence', 'Minimum divergence', 25,
        'How different a variant must be from the primary to be worth showing.'),
    ],
  },
  {
    id: 'generation.caption.sourceLink',
    agentId: 'caption',
    section: 'Adaptation',
    name: 'Attach the source link',
    summary:
      'Adds the citation the caption rests on, where the platform and the grounding both support one.',
    inputs: ['Adapted caption', 'Grounding entries'],
    outputs: ['Caption with citation'],
    order: 10,
    enabledByDefault: true,
    config: [
      bool('enabled', 'Attach a source link', true,
        'Off, citations stay in the Knowledge Base and never appear on the post.'),
      enumField('placement', 'Link placement', ['Inline', 'End of post', 'First comment'], 'End of post',
        'LinkedIn suppresses reach on posts with outbound links in the body, so end of post or first comment is usually right.'),
    ],
  },
]

/** ── 6 · Image Creator Agent · 9 skills ─────────────────────────────────── */
const IMAGE_SKILLS: SkillSpec[] = [
  {
    id: 'generation.image.approach',
    agentId: 'image',
    section: 'Concept',
    name: 'Choose the approach',
    summary:
      'Selects the visual concept from the caption\u2019s subject matter — reward surface, agent graph, benchmark bars and so on — deterministically, so the same caption always yields the same treatment.',
    inputs: ['Caption payload'],
    outputs: ['Visual concept'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      enumField('concept', 'Concept', [
        'Auto', 'gradient-field', 'signal-lines', 'reward-surface',
        'agent-graph', 'benchmark-bars', 'data-lattice',
      ], 'Auto',
        'Auto picks from the caption. The named concepts force one treatment, which is useful for a themed series.'),
      bool('varyBySeries', 'Vary across a series', true,
        'On, consecutive posts on the same topic get different concepts, so the feed does not look repetitive.'),
    ],
  },
  {
    id: 'generation.image.reference',
    agentId: 'image',
    section: 'Concept',
    name: 'Gather references',
    summary:
      'Collects the recent assets for this topic so the new creative is recognisably part of the same body of work without repeating it.',
    inputs: ['Media asset history'],
    outputs: ['Reference set'],
    order: 2,
    enabledByDefault: true,
    config: [
      num('lookbackAssets', 'Assets to consider', 12,
        'How many recent creatives inform the new one.',
        { min: 0, max: 60, step: 1 }),
      pct('maxSimilarity', 'Similarity ceiling', 85,
        'How close a new creative may be to an existing one before it is regenerated. This is the visual half of rule 17.'),
    ],
  },
  {
    id: 'generation.image.template',
    agentId: 'image',
    section: 'Composition',
    name: 'Lay out the template',
    summary:
      'Positions the headline, kicker, accent bar, logomark and footer on the platform\u2019s canvas.',
    inputs: ['Visual concept', 'Platform'],
    outputs: ['Layout'],
    order: 3,
    enabledByDefault: true,
    config: [
      enumField('layout', 'Layout', ['Editorial', 'Centred', 'Split', 'Minimal'], 'Editorial',
        'Editorial puts the headline lower-left with a kicker above. Centred is for single statements. Split carries a figure alongside.'),
      num('headlineMaxWords', 'Headline word limit', 12,
        'The ceiling on the drawn headline. Beyond this the type shrinks below legibility on a phone.',
        { min: 3, max: 20, step: 1 }),
      num('safeMargin', 'Safe margin', 64,
        'The keep-clear border in canvas pixels, so nothing important is cropped by a platform preview.',
        { min: 16, max: 160, step: 8, unit: 'px' }),
    ],
  },
  {
    id: 'generation.image.tokens',
    agentId: 'image',
    section: 'Composition',
    name: 'Apply brand tokens',
    summary:
      'Applies the declared accent family and type to the brand layer. Status colours are never used as decoration.',
    inputs: ['Layout', 'Brand visual tokens'],
    outputs: ['Tokenised layout'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      enumField('paletteRole', 'Palette emphasis', ['Primary', 'Deep', 'Light', 'Full range'], 'Primary',
        'Which part of the purple family leads. Full range uses all four, which suits carousels.'),
      pct('accentIntensity', 'Accent intensity', 70,
        'How strongly the accent reads against the background. Higher is louder and less editorial.'),
      bool('showLogomark', 'Draw the logomark', true,
        'Off, the creative ships unbranded. Rarely correct.'),
    ],
  },
  {
    id: 'generation.image.render',
    agentId: 'image',
    section: 'Render',
    name: 'Render the asset',
    summary:
      'Renders in two layers: an optional model-painted background, and the vector brand layer drawn locally over it. Falls back to the local renderer alone when the model is unreachable, labelled.',
    inputs: ['Tokenised layout', 'Image model'],
    outputs: ['Rendered asset', 'Render mode', 'Fallback reason'],
    order: 5,
    enabledByDefault: true,
    critical: true,
    config: [
      enumField('model', 'Image model', ['auto', ...IMAGE_MODEL_IDS], 'auto',
        'Which model paints the background beneath the brand layer. `auto` uses whichever painter this deployment actually has \u2014 Imagen first, then the local FLUX.2 Klein, then Z-Image \u2014 and lands on the brand renderer only when none is configured. Naming a model instead pins it: if it is unreachable the run says so rather than quietly painting with something else. The brand renderer never fails and never paints, so it is the floor, not a choice.'),
      num('timeoutMs', 'Render timeout', 60000,
        'How long to wait for the model before falling back to the local renderer.',
        { min: 5000, max: 180000, step: 1000, unit: 'ms' }),
      num('retries', 'Render retries', 1,
        'How many times to retry a failed model render before falling back.',
        { min: 0, max: 4, step: 1 }),
      bool('compositeBrandLayer', 'Composite the brand layer locally', true,
        'This is invariant 21 and should never be off: no diffusion model is asked to draw brand text, which is what makes rules 12, 13 and 15 hold. Off produces unusable creative.'),
    ],
  },
  {
    id: 'generation.image.export',
    agentId: 'image',
    section: 'Output',
    name: 'Export variants',
    summary:
      'Produces the additional sizes a post needs beyond its primary canvas.',
    inputs: ['Rendered asset'],
    outputs: ['Export variants'],
    order: 6,
    enabledByDefault: true,
    config: [
      bool('enabled', 'Export variants', true,
        'Off, only the primary canvas is produced.'),
      num('maxVariants', 'Variants per asset', 2,
        'How many additional sizes to render.',
        { min: 0, max: 5, step: 1 }),
    ],
  },
  {
    id: 'generation.image.altText',
    agentId: 'image',
    section: 'Output',
    name: 'Write alt text',
    summary:
      'Describes what the creative shows, not how it is styled. An asset without alt text cannot be published.',
    inputs: ['Rendered asset', 'Caption'],
    outputs: ['Alt text'],
    order: 7,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxChars', 'Alt text limit', 200,
        'The ceiling on the description. Long enough to convey the content, short enough for a screen reader to be useful.',
        { min: 60, max: 500, step: 10, unit: 'chars' }),
      bool('describeContentNotStyle', 'Describe content, not styling', true,
        'On, alt text names what the image communicates rather than its colours and shapes.'),
    ],
  },
  {
    id: 'generation.image.reviewGate',
    agentId: 'image',
    section: 'Output',
    name: 'Gate on visual compliance',
    summary:
      'Checks the canvas, the alt text and the agreement between the drawn headline and the caption hook before the asset is allowed forward.',
    inputs: ['Rendered asset', 'Caption'],
    outputs: ['Visual compliance findings'],
    order: 8,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('minHeadlineAgreement', 'Minimum headline agreement', 18,
        'How much the drawn headline must share with the caption hook. A creative that says something the caption does not is a defect.'),
      bool('blockOnFailure', 'Block on a failed check', false,
        'On, a failing asset stops the hand-off. Off, it proceeds with the finding attached for the human to see in the review panel.'),
    ],
  },
  {
    id: 'generation.image.video.compose',
    agentId: 'image',
    section: 'Output',
    name: 'Compose a video brief',
    summary:
      'Writes the shot list and script for a video, without producing one. Off by default — the pipeline briefs video, it does not render it.',
    inputs: ['Caption payload'],
    outputs: ['Video brief'],
    order: 9,
    enabledByDefault: false,
    config: [
      num('durationSeconds', 'Target duration', 45,
        'How long the briefed video should run.',
        { min: 10, max: 180, step: 5, unit: 's' }),
      num('shots', 'Shots in the brief', 5,
        'How many distinct shots the brief calls for.',
        { min: 2, max: 12, step: 1 }),
    ],
  },
]

/** ── 7 · Review Agent · 4 skills ────────────────────────────────────────── */
const REVIEW_SKILLS: SkillSpec[] = [
  {
    id: 'review.instruction.apply',
    agentId: 'review',
    section: 'Instruction',
    name: 'Apply a human instruction',
    summary:
      'Applies what the operator asked for. A human instruction always outranks a brand guideline: the edit is made and the compliance finding is raised alongside it, never resolved silently.',
    inputs: ['Draft', 'Human instruction'],
    outputs: ['Revised draft', 'Conflict notes'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      bool('humanOverridesBrand', 'Human instruction outranks the brand guideline', true,
        'This is rule 20 and should stay on. Off, the agent refuses instructions that conflict with a guideline instead of applying them and reporting.'),
      num('maxInstructionChars', 'Instruction length limit', 600,
        'The ceiling on a single instruction. Longer requests are better split, and the agent says so.',
        { min: 100, max: 2000, step: 50, unit: 'chars' }),
      bool('preserveRevisionHistory', 'Version rather than overwrite', true,
        'On, each edit creates a new revision so the earlier draft is still recoverable. Nothing is ever deleted.'),
    ],
  },
  {
    id: 'review.compliance.check',
    agentId: 'review',
    section: 'Compliance',
    name: 'Check compliance',
    summary:
      'Runs the twenty-rule check across grounding, voice, structure, platform, visual and caption-to-visual agreement, and reports a verdict with the evidence.',
    inputs: ['Draft', 'Media asset', 'Brand rules', 'Knowledge Base entries'],
    outputs: ['Brand check verdict', 'Violations'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      bool('offerCorrection', 'Offer a corrected version', true,
        'On, a purely mechanical set of violations comes with a corrected draft the operator can accept. The correction is never applied automatically.'),
      pct('similarityCap', 'Similarity ceiling against published posts', 70,
        'How close a caption may be to something already published before it is held. Repetition erodes the account.'),
      bool('failOnSensitive', 'Escalate sensitive topics', true,
        'On, funding, partnerships, named customers, hires, unpublished numbers, legal positions and competitor comparisons force internal approval. This outranks every other verdict.'),
    ],
  },
  {
    id: 'review.preference.extract',
    agentId: 'review',
    section: 'Learning',
    name: 'Extract a preference',
    summary:
      'Notices when an instruction expresses a durable preference rather than a one-off fix, and offers to remember it.',
    inputs: ['Human instruction', 'Instruction history'],
    outputs: ['Candidate preference'],
    order: 3,
    enabledByDefault: true,
    config: [
      bool('askBeforeSaving', 'Ask before saving', true,
        'On, the operator is offered the preference and decides. Off, it is written to the Knowledge Base and reported.'),
      num('minOccurrences', 'Occurrences before offering', 2,
        'How many times a similar instruction must appear before it is treated as a preference rather than a correction.',
        { min: 1, max: 6, step: 1 }),
      pct('similarityThreshold', 'Instruction similarity', 60,
        'How alike two instructions must be to count as the same preference.'),
    ],
  },
  {
    id: 'review.diff.summarize',
    agentId: 'review',
    section: 'Instruction',
    name: 'Summarise the change',
    summary:
      'Describes in one line what actually changed between two revisions, so the approval queue shows the edit rather than the whole draft.',
    inputs: ['Draft revisions'],
    outputs: ['Change summary'],
    order: 4,
    enabledByDefault: true,
    config: [
      num('maxChars', 'Summary length limit', 180,
        'The ceiling on the change summary shown in the approval hand-off.',
        { min: 60, max: 500, step: 10, unit: 'chars' }),
    ],
  },
]

/** ── 8 · Knowledge Agent · 8 skills ─────────────────────────────────────── */
const KNOWLEDGE_SKILLS: SkillSpec[] = [
  {
    id: 'knowledge.hashtag.select',
    agentId: 'knowledge',
    section: 'Selection',
    name: 'Select hashtags to research',
    summary:
      'Takes the current consolidated hashtag set and skips anything researched recently, unless a refresh is forced.',
    inputs: ['The top hashtag set', 'Research history'],
    outputs: ['Hashtags to research'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      num('hashtagCount', 'Hashtags to research', 25,
        'How many hashtags the build researches. This is the direct driver of both research cost and Knowledge Base coverage.',
        { min: 1, max: 100, step: 1 }),
      num('recencyDays', 'Skip if researched within', 5,
        'A hashtag researched more recently than this is skipped, so a weekly build does not re-research everything.',
        { min: 0, max: 60, step: 1, unit: 'days' }),
      bool('forceRefresh', 'Force a refresh', false,
        'On, everything is re-researched regardless of when it was last done. Useful after a positioning change.'),
    ],
  },
  {
    id: 'knowledge.research.search',
    agentId: 'knowledge',
    section: 'Research',
    name: 'Research the live web',
    summary:
      'The Parallel call. Asks what is materially new about each hashtag in the recent window, demanding concrete findings, named sources, dates and figures, and excluding vendor marketing.',
    inputs: ['Hashtags to research'],
    outputs: ['Raw research results', 'Research source mode'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxParallel', 'Concurrent research calls', 4,
        'How many hashtags are researched at once. Higher finishes sooner and is more likely to hit a rate limit.',
        { min: 1, max: 12, step: 1 }),
      num('windowDays', 'Research window', 14,
        'How recent a finding must be to count as materially new.',
        { min: 1, max: 90, step: 1, unit: 'days' }),
      enumField('processor', 'Research depth', ['base', 'pro', 'ultra'], 'base',
        'Base is fast and adequate for weekly coverage. Pro and ultra read more sources per hashtag and cost proportionally more.'),
      num('maxResults', 'Sources per hashtag', 10,
        'How many web sources to read for each hashtag.',
        { min: 1, max: 30, step: 1 }),
      num('retries', 'Retries per hashtag', 2,
        'How many times a failed research call is retried before that hashtag falls through to the open-web reading.',
        { min: 0, max: 5, step: 1 }),
    ],
  },
  {
    id: 'knowledge.research.extract',
    agentId: 'knowledge',
    section: 'Research',
    name: 'Extract cited entries',
    summary:
      'Turns raw research into candidate entries with their citations, and discards anything that cannot cite enough independent sources. An uncited claim never enters the Knowledge Base.',
    inputs: ['Raw research results'],
    outputs: ['Candidate entries', 'Discard reasons'],
    order: 3,
    enabledByDefault: true,
    critical: true,
    config: [
      num('minSources', 'Minimum cited sources', 2,
        'An entry citing fewer independent URLs than this is discarded. Two is the floor at which a claim is worth keeping.',
        { min: 1, max: 6, step: 1 }),
      num('maxChars', 'Entry length limit', 900,
        'The ceiling on an entry body. Entries are read by the caption writer, so they must stay dense.',
        { min: 200, max: 3000, step: 50, unit: 'chars' }),
      num('maxEntriesPerHashtag', 'Entries per hashtag', 3,
        'How many entries one hashtag may contribute to a build.',
        { min: 1, max: 10, step: 1 }),
    ],
  },
  {
    id: 'knowledge.entry.upsert',
    agentId: 'knowledge',
    section: 'Curation',
    name: 'Merge or insert entries',
    summary:
      'Compares each candidate against the active entries and merges rather than duplicating, unioning the sources and promoting confidence as evidence accumulates.',
    inputs: ['Candidate entries', 'Active entries'],
    outputs: ['Written entries', 'Merged entries'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('dedupeThreshold', 'Merge threshold', 72,
        'How similar a candidate must be to an existing entry to be merged into it instead of inserted alongside.'),
      bool('promoteOnMerge', 'Promote confidence on merge', true,
        'On, an entry confirmed by a second independent source moves up a confidence band.'),
    ],
  },
  {
    id: 'knowledge.entry.retrieve',
    agentId: 'knowledge',
    section: 'Retrieval',
    name: 'Retrieve entries',
    summary:
      'The read path every other agent uses, including the caption writer and the command plane knowledge search tool.',
    inputs: ['Query', 'Active entries'],
    outputs: ['Ranked entries'],
    order: 5,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxResults', 'Results per retrieval', 12,
        'How many entries a single retrieval returns.',
        { min: 1, max: 50, step: 1 }),
      bool('includeInactive', 'Include switched-off entries', false,
        'Off, an entry switched off in the Knowledge Base genuinely stops influencing generation. That is the point of the toggle.'),
    ],
  },
  {
    id: 'knowledge.entry.rank',
    agentId: 'knowledge',
    section: 'Retrieval',
    name: 'Rank entries',
    summary:
      'Orders retrieved entries by a blend of confidence and topical closeness.',
    inputs: ['Retrieved entries', 'Query'],
    outputs: ['Ranked entries'],
    order: 6,
    enabledByDefault: true,
    config: [
      pct('confidenceWeight', 'Confidence weight', 55,
        'How much confidence counts against topical similarity. Higher favours well-evidenced entries over closely-matching ones.'),
    ],
  },
  {
    id: 'knowledge.conflict.resolve',
    agentId: 'knowledge',
    section: 'Curation',
    name: 'Resolve conflicts',
    summary:
      'Finds entries in the same category that disagree and resolves them by the declared strategy. Escalation writes a real queue row, not a flag.',
    inputs: ['Active entries'],
    outputs: ['Resolutions', 'Escalations'],
    order: 7,
    enabledByDefault: true,
    config: [
      enumField('strategy', 'Resolution strategy',
        ['Newest wins', 'Highest confidence wins', 'Escalate to human'], 'Newest wins',
        'Newest wins suits fast-moving research. Highest confidence wins suits stable ground. Escalate sends every conflict to a person.'),
      pct('conflictSimilarity', 'Conflict detection threshold', 55,
        'How similar two entries must be before their disagreement is treated as a conflict rather than two separate facts.'),
    ],
  },
  {
    id: 'knowledge.priority.tag',
    agentId: 'knowledge',
    section: 'Curation',
    name: 'Apply priority tags',
    summary:
      'Boosts entries tagged as priority so they are retrieved ahead of the rest, and optionally demotes untagged ones.',
    inputs: ['Active entries'],
    outputs: ['Adjusted priorities'],
    order: 8,
    enabledByDefault: true,
    config: [
      pct('priorityBoost', 'Priority boost', 25,
        'How much a priority-tagged entry is favoured during retrieval.'),
      bool('demoteUntagged', 'Demote untagged entries', true,
        'On, untagged entries are pushed down so curated ones lead. Off leaves the ordering to confidence and similarity alone.'),
    ],
  },
]

/** ── 9 · Publishing Agent · 4 skills ────────────────────────────────────── */
const PUBLISHING_SKILLS: SkillSpec[] = [
  {
    id: 'publishing.format.validate',
    agentId: 'publishing',
    section: 'Validation',
    name: 'Validate the format',
    summary:
      'Checks the caption length, the hashtag count, the canvas and the alt text against the target platform before anything is dispatched.',
    inputs: ['Draft', 'Media asset', 'Platform'],
    outputs: ['Validation result'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      bool('blockOnFailure', 'Block on a failed check', true,
        'On, a format failure stops the publish. This should stay on: the platform will reject it anyway, and later.'),
      bool('requireAltText', 'Require alt text', true,
        'On, an asset without alt text cannot be published. This is invariant 23.'),
    ],
  },
  {
    id: 'publishing.media.upload',
    agentId: 'publishing',
    section: 'Dispatch',
    name: 'Upload media',
    summary:
      'Uploads the creative to the platform and holds the returned handle for the post call.',
    inputs: ['Media asset'],
    outputs: ['Media handle'],
    order: 2,
    enabledByDefault: true,
    config: [
      num('timeoutMs', 'Upload timeout', 45000,
        'How long an upload may take before it is abandoned.',
        { min: 5000, max: 180000, step: 1000, unit: 'ms' }),
      num('retries', 'Upload retries', 2,
        'How many times a failed upload is retried.',
        { min: 0, max: 5, step: 1 }),
    ],
  },
  {
    id: 'publishing.post.dispatch',
    agentId: 'publishing',
    section: 'Dispatch',
    name: 'Dispatch the post',
    summary:
      'The irreversible act. Sends the post to the platform through the demo or live adapter, and the two are never mixed.',
    inputs: ['Validated draft', 'Media handle'],
    outputs: ['Platform response', 'External id'],
    order: 3,
    enabledByDefault: true,
    critical: true,
    config: [
      num('timeoutMs', 'Dispatch timeout', 60000,
        'How long the platform has to accept the post before the attempt is treated as failed.',
        { min: 5000, max: 180000, step: 1000, unit: 'ms' }),
      bool('recordModeOnReceipt', 'Record the mode on the receipt', true,
        'On, every receipt permanently states whether it was demo or live. This should never be off — it is how you tell a real post from a simulated one a year later.'),
    ],
  },
  {
    id: 'publishing.receipt.record',
    agentId: 'publishing',
    section: 'Dispatch',
    name: 'Record the receipt',
    summary:
      'Writes the published row, its append-only history, and the lineage edge back to the idea it came from.',
    inputs: ['Platform response'],
    outputs: ['Published post', 'Lineage edge'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      bool('seedFirstHourMetrics', 'Seed first-hour metrics', true,
        'On, a first metrics row is written immediately so the post has a reading before the platform reports. Clearly marked as an early estimate.'),
      bool('writeLineage', 'Write the lineage edge', true,
        'On, the post is linked back to its idea and forward from its source item, which is what makes a trace possible.'),
    ],
  },
]

/** ── 10 · Analytics Agent · 8 skills ────────────────────────────────────── */
const ANALYTICS_SKILLS: SkillSpec[] = [
  {
    id: 'analytics.metrics.ingest',
    agentId: 'analytics',
    section: 'Ingestion',
    name: 'Ingest metrics',
    summary:
      'Pulls the current figures for every published post and writes a new metrics row per pull, never overwriting the last one.',
    inputs: ['Published posts'],
    outputs: ['Metrics rows'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxPosts', 'Posts per refresh', 60,
        'How many recent posts to refresh in one pass.',
        { min: 5, max: 300, step: 5 }),
      bool('appendOnly', 'Append rather than overwrite', true,
        'On, each pull adds a row so the history of a post\u2019s performance survives. Off would destroy the trend.'),
    ],
  },
  {
    id: 'analytics.metrics.reconcile',
    agentId: 'analytics',
    section: 'Ingestion',
    name: 'Reconcile reported periods',
    summary:
      'Marks which periods the platform has actually reported. A metric that has not been reported is excluded, never counted as zero.',
    inputs: ['Platform analytics'],
    outputs: ['Reported period flags'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      bool('excludeUnreported', 'Exclude unreported periods', true,
        'On, an unreported month is left out of every average. Off would drag every baseline toward zero and quietly corrupt the comparisons.'),
      num('reportingLagDays', 'Expected reporting lag', 3,
        'How long after a period ends the platform is expected to have reported it.',
        { min: 0, max: 30, step: 1, unit: 'days' }),
    ],
  },
  {
    id: 'analytics.baseline.compute',
    agentId: 'analytics',
    section: 'Baseline',
    name: 'Compute our own baseline',
    summary:
      'Builds the trailing baseline from this account\u2019s own history. Never an industry benchmark — that is invariant 24.',
    inputs: ['Metrics rows', 'Reported periods'],
    outputs: ['Baselines', 'Standard deviations'],
    order: 3,
    enabledByDefault: true,
    critical: true,
    config: [
      num('windowPeriods', 'Baseline window', 4,
        'How many prior periods form the baseline. Four weeks is responsive; twelve is stable and slow to react.',
        { min: 2, max: 24, step: 1 }),
      enumField('measure', 'Central measure', ['Mean', 'Median'], 'Mean',
        'Median resists a single viral post distorting the baseline. Mean reacts faster to a genuine step change.'),
      num('minSamples', 'Minimum samples', 2,
        'How many reported periods are needed before a baseline is offered at all.',
        { min: 1, max: 12, step: 1 }),
    ],
  },
  {
    id: 'analytics.sentiment.classify',
    agentId: 'analytics',
    section: 'Explanation',
    name: 'Classify sentiment',
    summary:
      'Reads the response to a post and classifies how it landed, so engagement volume is not mistaken for approval.',
    inputs: ['Post comments', 'Reactions'],
    outputs: ['Sentiment classification'],
    order: 4,
    enabledByDefault: true,
    config: [
      pct('positiveThreshold', 'Positive threshold', 60,
        'How favourable the response must be to count as positive.'),
      pct('negativeThreshold', 'Negative threshold', 30,
        'Below this the response is classified negative and flagged for a human read.'),
    ],
  },
  {
    id: 'analytics.period.compare',
    agentId: 'analytics',
    section: 'Baseline',
    name: 'Compare periods',
    summary:
      'Compares a period against the one before it and against the trailing baseline, stating the change and where it is concentrated.',
    inputs: ['Baselines', 'Current period'],
    outputs: ['Period comparison'],
    order: 5,
    enabledByDefault: true,
    critical: true,
    config: [
      pct('materialChange', 'Material change threshold', 10,
        'How large a movement must be before it is worth mentioning. Below this it is noise.'),
      bool('attributeChange', 'Attribute the change', true,
        'On, the comparison says where the movement came from — follower against non-follower reach, for instance — rather than only that it happened.'),
    ],
  },
  {
    id: 'analytics.post.explain',
    agentId: 'analytics',
    section: 'Explanation',
    name: 'Explain a post',
    summary:
      'Says why a post performed as it did, citing its own figures against this account\u2019s baseline and naming the format, slot and topic that contributed.',
    inputs: ['Post metrics', 'Baselines'],
    outputs: ['Explanation', 'Recommendation'],
    order: 6,
    enabledByDefault: true,
    critical: true,
    config: [
      num('maxChars', 'Explanation limit', 320,
        'The ceiling on a post explanation.',
        { min: 100, max: 900, step: 20, unit: 'chars' }),
      bool('includeRecommendation', 'Include a recommendation', true,
        'On, the explanation ends with the one thing to do differently next time.'),
      bool('neverUseIndustryBenchmark', 'Compare only against our own baseline', true,
        'This is invariant 24 and should stay on. An industry benchmark we did not measure is not evidence.'),
    ],
  },
  {
    id: 'analytics.report.compose',
    agentId: 'analytics',
    section: 'Reporting',
    name: 'Compose the monthly report',
    summary:
      'Assembles the month into headline figures, the shape of the period and what the numbers say.',
    inputs: ['Period comparisons', 'Post explanations'],
    outputs: ['Monthly report'],
    order: 7,
    enabledByDefault: true,
    config: [
      num('topPosts', 'Posts to highlight', 3,
        'How many individual posts the report calls out.',
        { min: 1, max: 10, step: 1 }),
      bool('includeUnreported', 'Mention unreported platforms', true,
        'On, the report states plainly that a platform has not reported yet rather than omitting it silently.'),
    ],
  },
  {
    id: 'analytics.export.build',
    agentId: 'analytics',
    section: 'Reporting',
    name: 'Build exports',
    summary:
      'Produces the CSV or JSON of any analytics view, carrying the same figures the screen shows.',
    inputs: ['Analytics view'],
    outputs: ['Export file'],
    order: 8,
    enabledByDefault: true,
    config: [
      enumField('format', 'Export format', ['CSV', 'JSON', 'Both'], 'Both',
        'Which formats to offer in the download menu.'),
      bool('includeDaily', 'Include the daily series', true,
        'On, exports carry the day-by-day figures as well as the monthly totals.'),
    ],
  },
]

/** ── 11 · Learning Agent · 4 skills ─────────────────────────────────────── */
const LEARNING_SKILLS: SkillSpec[] = [
  {
    id: 'learning.reward.compute',
    agentId: 'learning',
    order: 0,
    enabledByDefault: true,
    section: 'Detection',
    name: 'Score the outcome',
    summary:
      'Turns a finished post into a reward an optimiser can learn from, over five components: human approval, brand alignment, content quality, engagement and click-through. A component with no evidence is excluded rather than scored zero, and the result reports how much of the weight could actually be measured.',
    inputs: ['A published or decided post', 'Its approvals, revisions and metrics'],
    outputs: ['A 0–1 reward with a per-component reason and a confidence'],
    critical: false,
    config: [
      num('humanApprovalWeight', 'Human approval weight', 40,
        'Share of the reward carried by the two-stage approval outcome. The strongest signal the product has, and the only one that reflects a judgement rather than a measurement — which is why it is weighted highest by default.',
        { min: 0, max: 100, step: 5, unit: '%' }),
      num('brandAlignmentWeight', 'Brand alignment weight', 20,
        'Share carried by how little the brand-voice enforcer had to change. Computed from the rules that actually fired, never estimated by a model.',
        { min: 0, max: 100, step: 5, unit: '%' }),
      num('contentQualityWeight', 'Content quality weight', 15,
        'Share carried by structural compliance and novelty — hashtag range, the zero-emoji budget, and similarity to captions this account has already published.',
        { min: 0, max: 100, step: 5, unit: '%' }),
      num('engagementWeight', 'Engagement weight', 15,
        'Share carried by measured engagement against this account\u2019s own trailing baseline. Excluded entirely until the platform reports figures, so an unpublished post is never scored as a poor one.',
        { min: 0, max: 100, step: 5, unit: '%' }),
      num('clickThroughWeight', 'Click-through weight', 10,
        'Share carried by click rate against this account\u2019s own baseline. Excluded when no click figures were reported.',
        { min: 0, max: 100, step: 5, unit: '%' }),
      num('minConfidenceToLearn', 'Minimum measured weight to learn from', 50,
        'A reward computed from too little evidence is noise. Below this share of the total weight the outcome is recorded but withheld from optimisation, so a batch is not trained on posts nobody has judged or measured yet.',
        { min: 0, max: 100, step: 5, unit: '%' }),
    ],
  },
  {
    id: 'learning.pattern.detect',
    agentId: 'learning',
    section: 'Detection',
    name: 'Detect patterns',
    summary:
      'Looks across human edit instructions, approvals and rejections for something that keeps recurring.',
    inputs: ['Edit instructions', 'Approval and rejection reasons', 'Post outcomes'],
    outputs: ['Detected patterns'],
    order: 1,
    enabledByDefault: true,
    critical: true,
    config: [
      num('minOccurrences', 'Occurrences before a pattern', 2,
        'How many times something must recur before it counts as a pattern rather than a coincidence.',
        { min: 2, max: 10, step: 1 }),
      num('windowDays', 'Detection window', 60,
        'How far back to look for recurrence.',
        { min: 7, max: 365, step: 1, unit: 'days' }),
      pct('similarityThreshold', 'Pattern similarity', 62,
        'How alike two signals must be to count as the same pattern.'),
    ],
  },
  {
    id: 'learning.knowledge.write',
    agentId: 'learning',
    section: 'Consolidation',
    name: 'Write the lesson back',
    summary:
      'Turns a detected pattern into a Knowledge Base entry the caption writer will read before the next draft.',
    inputs: ['Detected patterns'],
    outputs: ['Learned entries'],
    order: 2,
    enabledByDefault: true,
    critical: true,
    config: [
      enumField('defaultConfidence', 'Starting confidence', ['High', 'Medium', 'Low'], 'Medium',
        'What confidence a newly learned lesson starts at before it has been confirmed by outcomes.'),
      bool('askBeforeWriting', 'Ask before writing', false,
        'On, every learned lesson waits for a human. Off, it is written and reported, which is what keeps the loop closing on its own.'),
    ],
  },
  {
    id: 'learning.confidence.promote',
    agentId: 'learning',
    section: 'Consolidation',
    name: 'Promote confidence',
    summary:
      'Raises an entry\u2019s confidence when outcomes keep confirming it.',
    inputs: ['Learned entries', 'Post outcomes'],
    outputs: ['Promoted entries'],
    order: 3,
    enabledByDefault: true,
    config: [
      num('promoteAfter', 'Confirmations before promotion', 3,
        'How many confirming outcomes lift an entry a confidence band.',
        { min: 1, max: 12, step: 1 }),
    ],
  },
  {
    id: 'learning.confidence.demote',
    agentId: 'learning',
    section: 'Consolidation',
    name: 'Demote confidence',
    summary:
      'Lowers an entry\u2019s confidence when outcomes contradict it, and deactivates it rather than deleting when it can no longer be supported.',
    inputs: ['Learned entries', 'Post outcomes'],
    outputs: ['Demoted entries', 'Deactivated entries'],
    order: 4,
    enabledByDefault: true,
    critical: true,
    config: [
      num('demoteAfter', 'Contradictions before demotion', 2,
        'How many contradicting outcomes drop an entry a confidence band. This path is not optional — knowledge that stops being true has to be able to fall.',
        { min: 1, max: 10, step: 1 }),
      bool('deactivateAtFloor', 'Deactivate at the floor', true,
        'On, an entry contradicted below Low confidence is switched off rather than deleted, so the lineage survives.'),
    ],
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   THE COMPLETE SKILL SET
   ═══════════════════════════════════════════════════════════════════════════ */

export const SKILLS: SkillSpec[] = [
  ...ASSISTANT_SKILLS,
  ...SCRAPING_SKILLS,
  ...VALIDATION_SKILLS,
  ...ANALYSIS_SKILLS,
  ...CALENDAR_SKILLS,
  ...CAPTION_SKILLS,
  ...IMAGE_SKILLS,
  ...REVIEW_SKILLS,
  ...KNOWLEDGE_SKILLS,
  ...PUBLISHING_SKILLS,
  ...ANALYTICS_SKILLS,
  ...LEARNING_SKILLS,
]

/* ═══════════════════════════════════════════════════════════════════════════
   COMPUTED INDEXES — all derived, never hardcoded.
   ═══════════════════════════════════════════════════════════════════════════ */

export const SKILL_BY_ID: Record<string, SkillSpec> = Object.fromEntries(
  SKILLS.map((s) => [s.id, s]),
)

export const SKILLS_BY_AGENT: Record<AgentId, SkillSpec[]> = AGENTS.reduce(
  (acc, agent) => {
    acc[agent.id] = SKILLS.filter((s) => s.agentId === agent.id).sort(
      (a, b) => a.order - b.order,
    )
    return acc
  },
  {} as Record<AgentId, SkillSpec[]>,
)

export const AGENTS_BY_STAGE: Record<StageId, AgentSpec[]> = STAGES.reduce(
  (acc, stage) => {
    acc[stage.id] = AGENTS.filter((a) => a.stage === stage.id)
    return acc
  },
  {} as Record<StageId, AgentSpec[]>,
)

export const CRITICAL_SKILL_IDS: string[] = SKILLS.filter((s) => s.critical).map((s) => s.id)

/** The counts shown on the boot sequence and the Studio summary strip. */
export const REGISTRY_SUMMARY = {
  agents: AGENTS.length,
  skills: SKILLS.length,
  stages: STAGES.length,
  knobs: SKILLS.reduce((n, s) => n + s.config.length, 0),
  criticalSkills: CRITICAL_SKILL_IDS.length,
} as const

/* ═══════════════════════════════════════════════════════════════════════════
   CONFIG RESOLUTION
   ═══════════════════════════════════════════════════════════════════════════ */

/** The registry defaults for one skill, as a flat map. */
export function defaultSkillConfig(skillId: string): ResolvedConfig {
  const spec = SKILL_BY_ID[skillId]
  if (!spec) return {}
  const out: ResolvedConfig = {}
  for (const field of spec.config) out[field.key] = field.default
  return out
}

/** Every skill's defaults, keyed by skill id. Used by the seeder and the UI. */
export function allDefaultConfigs(): Record<string, ResolvedConfig> {
  const out: Record<string, ResolvedConfig> = {}
  for (const skill of SKILLS) out[skill.id] = defaultSkillConfig(skill.id)
  return out
}

/**
 * Coerces and clamps one value against its declared field.
 * A value that cannot be coerced falls back to the declared default rather
 * than reaching a handler as the wrong type.
 */
export function coerceConfigValue(field: ConfigField, raw: unknown): ConfigValue {
  switch (field.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return raw
      if (raw === 'true') return true
      if (raw === 'false') return false
      return field.default
    }
    case 'number':
    case 'percent': {
      const n = typeof raw === 'number' ? raw : Number(raw)
      if (!Number.isFinite(n)) return field.default
      const min = field.min ?? (field.type === 'percent' ? 0 : Number.NEGATIVE_INFINITY)
      const max = field.max ?? (field.type === 'percent' ? 100 : Number.POSITIVE_INFINITY)
      return Math.min(max, Math.max(min, n))
    }
    case 'enum': {
      const s = String(raw)
      return field.options?.includes(s) ? s : field.default
    }
    case 'text':
      return raw === undefined || raw === null ? field.default : String(raw)
    default:
      return field.default
  }
}

/**
 * Resolves defaults < workspace override < run override for one skill,
 * validating every value against its declared type and bounds.
 */
export function resolveSkillConfig(
  skillId: string,
  workspaceOverride: Record<string, unknown> = {},
  runOverride: Record<string, unknown> = {},
): ResolvedConfig {
  const spec = SKILL_BY_ID[skillId]
  if (!spec) return {}
  const out: ResolvedConfig = {}
  for (const field of spec.config) {
    let value: unknown = field.default
    if (Object.hasOwn(workspaceOverride, field.key)) value = workspaceOverride[field.key]
    if (Object.hasOwn(runOverride, field.key)) value = runOverride[field.key]
    out[field.key] = coerceConfigValue(field, value)
  }
  return out
}

/**
 * Weight groups that must sum to 100. The runtime warns and normalises rather
 * than silently producing a score on a broken scale.
 */
export const WEIGHT_GROUPS: Array<{ skillId: string; keys: string[]; label: string }> = [
  {
    skillId: 'validation.keyword.trend',
    keys: ['volumeWeight', 'engagementWeight', 'velocityWeight', 'growthWeight'],
    label: 'Keyword trend weights',
  },
  {
    skillId: 'calendar.rank.select',
    keys: ['rankConfidenceWeight', 'rankRelevanceWeight', 'rankTrendWeight'],
    label: 'Idea ranking weights',
  },
]

export interface WeightCheck {
  skillId: string
  label: string
  sum: number
  ok: boolean
  normalised: Record<string, number>
}

/** Checks a weight group and returns the normalised set to actually use. */
export function checkWeights(skillId: string, config: ResolvedConfig): WeightCheck | null {
  const group = WEIGHT_GROUPS.find((g) => g.skillId === skillId)
  if (!group) return null
  const values = group.keys.map((k) => Number(config[k] ?? 0))
  const sum = values.reduce((a, b) => a + b, 0)
  const normalised: Record<string, number> = {}
  for (const [i, key] of group.keys.entries()) {
    normalised[key] = sum === 0 ? 100 / group.keys.length : ((values[i] as number) / sum) * 100
  }
  return { skillId, label: group.label, sum, ok: Math.abs(sum - 100) < 0.01, normalised }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REGISTRY SELF-VALIDATION — what `npm run agent:check` runs.
   ═══════════════════════════════════════════════════════════════════════════ */

export interface RegistryProblem {
  severity: 'error' | 'warning'
  where: string
  message: string
}

export function validateRegistry(): RegistryProblem[] {
  const problems: RegistryProblem[] = []

  // Every agent belongs to a declared stage, and every stage lists it back.
  for (const agent of AGENTS) {
    const stage = STAGE_BY_ID[agent.stage]
    if (!stage) {
      problems.push({
        severity: 'error',
        where: agent.id,
        message: `Agent declares unknown stage "${agent.stage}".`,
      })
    } else if (!stage.agents.includes(agent.id)) {
      problems.push({
        severity: 'error',
        where: agent.id,
        message: `Stage "${stage.id}" does not list this agent, so the orchestration graph would omit it.`,
      })
    }
    for (const target of agent.handsOffTo) {
      if (!AGENT_BY_ID[target]) {
        problems.push({
          severity: 'error',
          where: agent.id,
          message: `Hands off to unknown agent "${target}".`,
        })
      }
    }
    if (SKILLS_BY_AGENT[agent.id]?.length === 0) {
      problems.push({
        severity: 'error',
        where: agent.id,
        message: 'Agent has no skills declared.',
      })
    }
  }

  // Skill integrity.
  const seenIds = new Set<string>()
  for (const skill of SKILLS) {
    if (seenIds.has(skill.id)) {
      problems.push({
        severity: 'error',
        where: skill.id,
        message: 'Duplicate skill id. Ids are storage keys and must be unique.',
      })
    }
    seenIds.add(skill.id)

    if (!AGENT_BY_ID[skill.agentId]) {
      problems.push({
        severity: 'error',
        where: skill.id,
        message: `Skill belongs to unknown agent "${skill.agentId}".`,
      })
    }
    if (!skill.summary || skill.summary.trim().length < 12) {
      problems.push({
        severity: 'error',
        where: skill.id,
        message: 'Skill has no usable summary.',
      })
    }
    if (skill.inputs.length === 0 || skill.outputs.length === 0) {
      problems.push({
        severity: 'error',
        where: skill.id,
        message: 'Skill must declare at least one input and one output.',
      })
    }
    if (skill.section && !AGENT_BY_ID[skill.agentId]?.sections?.includes(skill.section)) {
      problems.push({
        severity: 'warning',
        where: skill.id,
        message: `Section "${skill.section}" is not listed on agent "${skill.agentId}".`,
      })
    }
    if (skill.critical && !skill.enabledByDefault) {
      problems.push({
        severity: 'error',
        where: skill.id,
        message: 'A critical skill cannot be disabled by default.',
      })
    }

    // Every knob carries a description. This is the rule Law 2 rests on.
    const keys = new Set<string>()
    for (const field of skill.config) {
      if (!field.description || field.description.trim().length < 12) {
        problems.push({
          severity: 'error',
          where: `${skill.id}.${field.key}`,
          message:
            'Config field has no plain-language description. The operator would see an unexplained control.',
        })
      }
      if (keys.has(field.key)) {
        problems.push({
          severity: 'error',
          where: `${skill.id}.${field.key}`,
          message: 'Duplicate config key within a skill.',
        })
      }
      keys.add(field.key)

      if (field.type === 'enum') {
        if (!field.options || field.options.length < 2) {
          problems.push({
            severity: 'error',
            where: `${skill.id}.${field.key}`,
            message: 'Enum field needs at least two options.',
          })
        } else if (!field.options.includes(String(field.default))) {
          problems.push({
            severity: 'error',
            where: `${skill.id}.${field.key}`,
            message: `Default "${String(field.default)}" is not among the declared options.`,
          })
        }
      }
      if (field.type === 'number' || field.type === 'percent') {
        const d = Number(field.default)
        if (field.min !== undefined && d < field.min) {
          problems.push({
            severity: 'error',
            where: `${skill.id}.${field.key}`,
            message: `Default ${d} is below the declared minimum ${field.min}.`,
          })
        }
        if (field.max !== undefined && d > field.max) {
          problems.push({
            severity: 'error',
            where: `${skill.id}.${field.key}`,
            message: `Default ${d} is above the declared maximum ${field.max}.`,
          })
        }
      }
    }
  }

  // Per-agent order integrity.
  for (const agent of AGENTS) {
    const orders = (SKILLS_BY_AGENT[agent.id] ?? []).map((s) => s.order)
    if (new Set(orders).size !== orders.length) {
      problems.push({
        severity: 'error',
        where: agent.id,
        message: 'Two skills share an execution order, so the sequence is ambiguous.',
      })
    }
  }

  // Weight groups must default to 100.
  for (const group of WEIGHT_GROUPS) {
    const cfg = defaultSkillConfig(group.skillId)
    const sum = group.keys.reduce((n, k) => n + Number(cfg[k] ?? 0), 0)
    if (Math.abs(sum - 100) > 0.01) {
      problems.push({
        severity: 'error',
        where: group.skillId,
        message: `${group.label} default to ${sum}, not 100.`,
      })
    }
  }

  return problems
}

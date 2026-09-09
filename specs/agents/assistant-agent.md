<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Ethara Command

**Id:** `assistant` · **Stage:** `command`

## Role

The command plane

## What it does

The only agent with a conversational surface and the only one the human addresses directly. It perceives the state of the platform, interprets an utterance into an intent, composes a plan of typed tool calls, stops at a confirmation gate on anything irreversible, dispatches through the same orchestrator a scheduled run uses, narrates what it is doing, verifies the postconditions, and remembers the turn.

## Contract

| | |
|---|---|
| Consumes | Operator utterances (typed or spoken) · Ambient signals · Cron triggers |
| Produces | Plans · Tool dispatches · Narration · Briefings · Conversation memory |
| Hands off to | `scraping` · `validation` · `analysis` · `calendar` · `caption` · `image` · `review` · `knowledge` · `publishing` · `analytics` · `learning` |
| Skills | 12 |
| Knobs | 31 |

## Skills

### 1. Assemble situational snapshot

`assistant.context.assemble` · **critical** — cannot be switched off

Builds the snapshot Ethara reasons over: counts, queues, agent states, this week’s calendar, the last run summary, the operator’s role and the recent conversation turns.

- **In:** Workspace state, Conversation history
- **Out:** SituationSnapshot

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Conversation turns to carry | `historyTurns` | number (0–40) | `12` | How much of the conversation Ethara re-reads before answering. Higher values make pronouns and follow-ups resolve better, at the cost of a longer prompt. |
| Include Knowledge Base summary | `includeKnowledge` | boolean | `true` | Whether the snapshot carries a digest of active Knowledge Base entries, so Ethara can answer grounded questions without a separate lookup. |
| Snapshot size limit | `maxSnapshotChars` | number (1000–24000) | `6000` chars | Hard ceiling on the assembled snapshot. Oldest and least relevant material is dropped first when the limit is reached. |

### 2. Parse intent

`assistant.intent.parse` · **critical** — cannot be switched off

Turns an utterance into a typed Intent naming a tool id, its entities and a confidence. Model-backed when a provider is configured, and on the deterministic grammar built from the tool registry otherwise.

- **In:** Utterance, SituationSnapshot, Tool registry
- **Out:** Intent

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Ask for clarification below | `clarifyThreshold` | percent (0–100) | `55` % | Below this confidence Ethara asks one short clarifying question with the two most likely readings, rather than guessing. |
| Minimum usable confidence | `minConfidence` | percent (0–100) | `35` % | Below this, Ethara treats the utterance as unrecognised rather than offering candidate readings. |
| Use the reasoning model when available | `useModel` | boolean | `true` | Off forces the deterministic grammar parser even when a model provider is configured. Useful for reproducing a past run exactly. |
| Expand synonyms | `synonymsEnabled` | boolean | `true` | Lets "kick off", "fire" and "start" all reach the same tool. Off requires closer wording to the registry examples. |

### 3. Compose plan

`assistant.plan.compose` · **critical** — cannot be switched off

Turns an Intent into an ordered plan of tool calls, each with a stated purpose, enforcing read-before-write and the step cap.

- **In:** Intent, Tool registry
- **Out:** Plan

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Maximum steps in a plan | `maxSteps` | number (1–20) | `8` | The step ceiling. A request needing more than this is split, and Ethara says so rather than silently truncating. |
| Read before write | `readBeforeWrite` | boolean | `true` | Any plan that changes something begins with the safe reads it needs to be correct. Turning this off makes plans shorter and less reliable. |
| Explain every step | `explainEveryStep` | boolean | `true` | Attaches a plain-language purpose to each step, shown in the plan card before anything runs. |

### 4. Confirmation gate

`assistant.confirm.gate` · **critical** — cannot be switched off

Blocks any plan containing an irreversible step, mints a single-use token with a deadline, and validates it on resume. This skill cannot be disabled.

- **In:** Plan
- **Out:** Confirmation token, Rendered confirmation prompt

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Confirmation validity | `ttlSeconds` | number (30–900) | `180` s | How long a confirmation stays valid. After this the token is refused and Ethara re-plans from scratch, so an approval can never be replayed later. |
| Also confirm reversible changes | `alsoConfirmMutating` | boolean | `false` | On, Ethara asks before any change at all, not only irreversible ones. Safer and considerably slower. |

### 5. Dispatch tools

`assistant.tool.dispatch` · **critical** — cannot be switched off

Validates each step’s arguments against the tool’s schema, executes the step, and streams its result as it lands.

- **In:** Plan, Confirmation (when required)
- **Out:** Step results, Streamed events

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Per-step timeout | `stepTimeoutMs` | number (5000–600000) | `60000` ms | How long a single tool call may run before it is abandoned and reported as failed. |
| Stop the plan on a failed step | `haltOnStepFailure` | boolean | `true` | On, a failure halts the plan and Ethara reports what already stands. Off, it continues, which risks acting on incomplete reads. |
| Parallel safe reads | `maxParallelSafeReads` | number (1–8) | `3` | How many read-only steps may run at once. Only safe tools are ever parallelised; changes are always sequential. |

### 6. Narrate

`assistant.narrate.stream` · **critical** — cannot be switched off

Renders the plan and every result as Ethara speech in the declared persona, streamed token by token.

- **In:** Plan, Step results, Persona
- **Out:** Narration tokens

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Verbosity | `verbosity` | enum — terse / normal / detailed | `normal` | Terse gives the outcome only. Normal adds the evidence. Detailed narrates every step as it runs. |
| Speak the summary sentence only | `speakSummaryOnly` | boolean | `true` | Voice output reads just the first sentence. Off reads the whole narration aloud, which is rarely wanted. |
| Token pacing | `tokenDelayMs` | number (0–80) | `18` ms | The delay between narration tokens. Purely cosmetic — it makes Ethara read as thinking rather than pasting. |

### 7. Verify results

`assistant.result.verify`

Checks each step’s postcondition — the row was written, the status did change, the count did move — and reports a mismatch rather than claiming success.

- **In:** Step results, Expected postconditions
- **Out:** Verification findings

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Verify postconditions | `enabled` | boolean | `true` | Off, Ethara reports what the tool returned without confirming it landed. Not recommended. |
| Treat a mismatch as a failure | `strict` | boolean | `false` | On, a postcondition mismatch fails the step outright. Off, it is reported alongside the result and the plan continues. |

### 8. Write memory

`assistant.memory.write` · **critical** — cannot be switched off

Persists the turn with its plan and steps, and extracts a durable preference when the operator corrects Ethara on the same thing repeatedly.

- **In:** Turn, Steps, Corrections
- **Out:** Conversation turn, Candidate preference

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Corrections before learning | `learnAfterCorrections` | number (1–6) | `2` | How many times the operator must correct the same thing before Ethara offers to remember it. One is eager; three rarely fires. |
| Ask before saving a preference | `askBeforeSaving` | boolean | `true` | On, Ethara offers and waits. Off, it writes the preference to the Knowledge Base itself and reports that it did. |

### 9. Compose briefing

`assistant.brief.compose`

The weekday morning briefing: the three things that changed since yesterday, and one recommendation that is actionable in a click.

- **In:** SituationSnapshot, Yesterday’s state
- **Out:** Briefing

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Changes to report | `changesToReport` | number (1–6) | `3` | How many changes the briefing names. Three fits a sentence; more reads as a list and gets skimmed. |
| Include a recommendation | `includeRecommendation` | boolean | `true` | Whether the briefing ends with one thing Ethara would do, offered as a single action. |

### 10. Watch for anomalies

`assistant.anomaly.watch`

The ambient sweep: work waiting too long, approvals ageing, a metric outside its own trailing band, a failed run, a knowledge conflict, or a thin week on a platform.

- **In:** Workspace state, Trailing baselines
- **Out:** Ambient notices

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Anomaly sensitivity | `anomalySigma` | number (0.5–4) | `1.5` σ | How far a metric must sit from its own trailing average before Ethara mentions it, in standard deviations. Lower speaks up more often. |
| Review queue patience | `queueAgeMinutes` | number (5–480) | `30` min | How long items may wait on a verdict before Ethara raises it. |
| Leadership patience | `approvalAgeHours` | number (1–72) | `6` h | How long a post may sit with Leadership before Ethara mentions it. |
| Minimum posts per platform per week | `minPerWeek` | number (0–14) | `3` | Below this, Ethara flags the platform as a calendar gap. |

### 11. Shape voice output

`assistant.voice.transcribe`

Produces the persona-shaped sentence the browser speaks. The audio itself is the browser’s job; this decides what is worth saying aloud.

- **In:** Narration
- **Out:** Spoken summary

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Shape text for speech | `enabled` | boolean | `true` | Off, nothing is prepared for text-to-speech and the browser stays silent even when voice is on. |
| Spoken length limit | `maxSpokenChars` | number (80–1200) | `320` chars | The ceiling on what is read aloud. Tables, code and long lists are never spoken regardless of this value. |

### 12. Route to the owning agent

`assistant.handoff.route` · **critical** — cannot be switched off

Routes a plan step into the owning agent’s runtime, so an operator-triggered run is indistinguishable from a scheduled one in telemetry.

- **In:** Tool call, Owning agent id
- **Out:** Agent run

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Trigger label | `recordAsTrigger` | text | `assistant` | What appears in the trigger column of the run record. Changing it makes operator-initiated runs look like something else in the console. |

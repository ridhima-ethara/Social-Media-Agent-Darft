<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Review Agent

**Id:** `review` · **Stage:** `create`

## Role

Human edits and compliance

## What it does

Applies the operator’s instructions to a draft, runs the twenty-rule compliance check, and extracts durable preferences from what the human asked for. A human instruction always outranks a brand guideline: the edit is applied and the finding is raised alongside it, never resolved silently.

## Contract

| | |
|---|---|
| Consumes | A draft · Human instructions · The brand rules |
| Produces | Revised drafts · Compliance findings · Candidate preferences |
| Hands off to | `knowledge` · `publishing` |
| Skills | 4 |
| Knobs | 10 |

## Skills

### 1. Apply a human instruction

`review.instruction.apply` · **critical** — cannot be switched off

Applies what the operator asked for. A human instruction always outranks a brand guideline: the edit is made and the compliance finding is raised alongside it, never resolved silently.

- **In:** Draft, Human instruction
- **Out:** Revised draft, Conflict notes

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Human instruction outranks the brand guideline | `humanOverridesBrand` | boolean | `true` | This is rule 20 and should stay on. Off, the agent refuses instructions that conflict with a guideline instead of applying them and reporting. |
| Instruction length limit | `maxInstructionChars` | number (100–2000) | `600` chars | The ceiling on a single instruction. Longer requests are better split, and the agent says so. |
| Version rather than overwrite | `preserveRevisionHistory` | boolean | `true` | On, each edit creates a new revision so the earlier draft is still recoverable. Nothing is ever deleted. |

### 2. Check compliance

`review.compliance.check` · **critical** — cannot be switched off

Runs the twenty-rule check across grounding, voice, structure, platform, visual and caption-to-visual agreement, and reports a verdict with the evidence.

- **In:** Draft, Media asset, Brand rules, Knowledge Base entries
- **Out:** Brand check verdict, Violations

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Offer a corrected version | `offerCorrection` | boolean | `true` | On, a purely mechanical set of violations comes with a corrected draft the operator can accept. The correction is never applied automatically. |
| Similarity ceiling against published posts | `similarityCap` | percent (0–100) | `70` % | How close a caption may be to something already published before it is held. Repetition erodes the account. |
| Escalate sensitive topics | `failOnSensitive` | boolean | `true` | On, funding, partnerships, named customers, hires, unpublished numbers, legal positions and competitor comparisons force internal approval. This outranks every other verdict. |

### 3. Extract a preference

`review.preference.extract`

Notices when an instruction expresses a durable preference rather than a one-off fix, and offers to remember it.

- **In:** Human instruction, Instruction history
- **Out:** Candidate preference

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Ask before saving | `askBeforeSaving` | boolean | `true` | On, the operator is offered the preference and decides. Off, it is written to the Knowledge Base and reported. |
| Occurrences before offering | `minOccurrences` | number (1–6) | `2` | How many times a similar instruction must appear before it is treated as a preference rather than a correction. |
| Instruction similarity | `similarityThreshold` | percent (0–100) | `60` % | How alike two instructions must be to count as the same preference. |

### 4. Summarise the change

`review.diff.summarize`

Describes in one line what actually changed between two revisions, so the approval queue shows the edit rather than the whole draft.

- **In:** Draft revisions
- **Out:** Change summary

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Summary length limit | `maxChars` | number (60–500) | `180` chars | The ceiling on the change summary shown in the approval hand-off. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `draft.instruct` | mutating | Applies an instruction to a draft. A human instruction outranks a brand guideline, and the finding is raised alongside the edit. |
| `brand.check` | safe | Runs the twenty-rule compliance check on any text and reports the verdict with its evidence. |
| `idea.approve.marketing` | mutating | The first of two approvals. Sends the post to Leadership. |
| `idea.reject.leadership` | mutating | Rejects a post with a reason. The reason is mandatory — it is what the agents learn from. |

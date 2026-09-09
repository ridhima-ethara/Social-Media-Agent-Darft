<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Learning Agent

**Id:** `learning` · **Stage:** `learn`

## Role

Turning outcomes into durable knowledge

## What it does

Detects patterns across human edit instructions and post outcomes, writes them back to the Knowledge Base, raises confidence after repeated confirmations and lowers it after contradictions. The demotion path is implemented, not optional.

## Contract

| | |
|---|---|
| Consumes | Post outcomes · Human edit instructions · Approval and rejection reasons |
| Produces | Learned knowledge entries · Confidence promotions and demotions |
| Hands off to | `knowledge` |
| Skills | 4 |
| Knobs | 8 |

## Skills

### 1. Detect patterns

`learning.pattern.detect` · **critical** — cannot be switched off

Looks across human edit instructions, approvals and rejections for something that keeps recurring.

- **In:** Edit instructions, Approval and rejection reasons, Post outcomes
- **Out:** Detected patterns

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Occurrences before a pattern | `minOccurrences` | number (2–10) | `2` | How many times something must recur before it counts as a pattern rather than a coincidence. |
| Detection window | `windowDays` | number (7–365) | `60` days | How far back to look for recurrence. |
| Pattern similarity | `similarityThreshold` | percent (0–100) | `62` % | How alike two signals must be to count as the same pattern. |

### 2. Write the lesson back

`learning.knowledge.write` · **critical** — cannot be switched off

Turns a detected pattern into a Knowledge Base entry the caption writer will read before the next draft.

- **In:** Detected patterns
- **Out:** Learned entries

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Starting confidence | `defaultConfidence` | enum — High / Medium / Low | `Medium` | What confidence a newly learned lesson starts at before it has been confirmed by outcomes. |
| Ask before writing | `askBeforeWriting` | boolean | `false` | On, every learned lesson waits for a human. Off, it is written and reported, which is what keeps the loop closing on its own. |

### 3. Promote confidence

`learning.confidence.promote`

Raises an entry’s confidence when outcomes keep confirming it.

- **In:** Learned entries, Post outcomes
- **Out:** Promoted entries

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Confirmations before promotion | `promoteAfter` | number (1–12) | `3` | How many confirming outcomes lift an entry a confidence band. |

### 4. Demote confidence

`learning.confidence.demote` · **critical** — cannot be switched off

Lowers an entry’s confidence when outcomes contradict it, and deactivates it rather than deleting when it can no longer be supported.

- **In:** Learned entries, Post outcomes
- **Out:** Demoted entries, Deactivated entries

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Contradictions before demotion | `demoteAfter` | number (1–10) | `2` | How many contradicting outcomes drop an entry a confidence band. This path is not optional — knowledge that stops being true has to be able to fall. |
| Deactivate at the floor | `deactivateAtFloor` | boolean | `true` | On, an entry contradicted below Low confidence is switched off rather than deleted, so the lineage survives. |

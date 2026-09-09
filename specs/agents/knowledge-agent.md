<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Knowledge Agent

**Id:** `knowledge` · **Stage:** `learn`

## Role

The cited Knowledge Base

## What it does

The only agent whose primary product is knowledge. Every Sunday at 06:00, and on demand, it researches the top twenty-five hashtags against the live web through Parallel and writes cited, confidence-scored entries. An entry that cannot cite at least two sources is discarded.

## Contract

| | |
|---|---|
| Consumes | The top 25 hashtags · Live web research · Outcomes from every other stage |
| Produces | Cited Knowledge Base entries · Confidence scores · Conflict escalations |
| Hands off to | `caption` · `image` · `calendar` · `review` |
| Skills | 8 |
| Knobs | 20 |

## Skills

### 1. Select hashtags to research

`knowledge.hashtag.select` · **critical** — cannot be switched off

Takes the current consolidated hashtag set and skips anything researched recently, unless a refresh is forced.

- **In:** The top hashtag set, Research history
- **Out:** Hashtags to research

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Hashtags to research | `hashtagCount` | number (1–100) | `25` | How many hashtags the build researches. This is the direct driver of both research cost and Knowledge Base coverage. |
| Skip if researched within | `recencyDays` | number (0–60) | `5` days | A hashtag researched more recently than this is skipped, so a weekly build does not re-research everything. |
| Force a refresh | `forceRefresh` | boolean | `false` | On, everything is re-researched regardless of when it was last done. Useful after a positioning change. |

### 2. Research the live web

`knowledge.research.search` · **critical** — cannot be switched off

The Parallel call. Asks what is materially new about each hashtag in the recent window, demanding concrete findings, named sources, dates and figures, and excluding vendor marketing.

- **In:** Hashtags to research
- **Out:** Raw research results, Research source mode

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Concurrent research calls | `maxParallel` | number (1–12) | `4` | How many hashtags are researched at once. Higher finishes sooner and is more likely to hit a rate limit. |
| Research window | `windowDays` | number (1–90) | `14` days | How recent a finding must be to count as materially new. |
| Research depth | `processor` | enum — base / pro / ultra | `base` | Base is fast and adequate for weekly coverage. Pro and ultra read more sources per hashtag and cost proportionally more. |
| Sources per hashtag | `maxResults` | number (1–30) | `10` | How many web sources to read for each hashtag. |
| Retries per hashtag | `retries` | number (0–5) | `2` | How many times a failed research call is retried before that hashtag falls back to fixtures. |

### 3. Extract cited entries

`knowledge.research.extract` · **critical** — cannot be switched off

Turns raw research into candidate entries with their citations, and discards anything that cannot cite enough independent sources. An uncited claim never enters the Knowledge Base.

- **In:** Raw research results
- **Out:** Candidate entries, Discard reasons

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Minimum cited sources | `minSources` | number (1–6) | `2` | An entry citing fewer independent URLs than this is discarded. Two is the floor at which a claim is worth keeping. |
| Entry length limit | `maxChars` | number (200–3000) | `900` chars | The ceiling on an entry body. Entries are read by the caption writer, so they must stay dense. |
| Entries per hashtag | `maxEntriesPerHashtag` | number (1–10) | `3` | How many entries one hashtag may contribute to a build. |

### 4. Merge or insert entries

`knowledge.entry.upsert` · **critical** — cannot be switched off

Compares each candidate against the active entries and merges rather than duplicating, unioning the sources and promoting confidence as evidence accumulates.

- **In:** Candidate entries, Active entries
- **Out:** Written entries, Merged entries

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Merge threshold | `dedupeThreshold` | percent (0–100) | `72` % | How similar a candidate must be to an existing entry to be merged into it instead of inserted alongside. |
| Promote confidence on merge | `promoteOnMerge` | boolean | `true` | On, an entry confirmed by a second independent source moves up a confidence band. |

### 5. Retrieve entries

`knowledge.entry.retrieve` · **critical** — cannot be switched off

The read path every other agent uses, including the caption writer and the command plane knowledge search tool.

- **In:** Query, Active entries
- **Out:** Ranked entries

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Results per retrieval | `maxResults` | number (1–50) | `12` | How many entries a single retrieval returns. |
| Include switched-off entries | `includeInactive` | boolean | `false` | Off, an entry switched off in the Knowledge Base genuinely stops influencing generation. That is the point of the toggle. |

### 6. Rank entries

`knowledge.entry.rank`

Orders retrieved entries by a blend of confidence and topical closeness.

- **In:** Retrieved entries, Query
- **Out:** Ranked entries

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Confidence weight | `confidenceWeight` | percent (0–100) | `55` % | How much confidence counts against topical similarity. Higher favours well-evidenced entries over closely-matching ones. |

### 7. Resolve conflicts

`knowledge.conflict.resolve`

Finds entries in the same category that disagree and resolves them by the declared strategy. Escalation writes a real queue row, not a flag.

- **In:** Active entries
- **Out:** Resolutions, Escalations

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Resolution strategy | `strategy` | enum — Newest wins / Highest confidence wins / Escalate to human | `Newest wins` | Newest wins suits fast-moving research. Highest confidence wins suits stable ground. Escalate sends every conflict to a person. |
| Conflict detection threshold | `conflictSimilarity` | percent (0–100) | `55` % | How similar two entries must be before their disagreement is treated as a conflict rather than two separate facts. |

### 8. Apply priority tags

`knowledge.priority.tag`

Boosts entries tagged as priority so they are retrieved ahead of the rest, and optionally demotes untagged ones.

- **In:** Active entries
- **Out:** Adjusted priorities

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Priority boost | `priorityBoost` | percent (0–100) | `25` % | How much a priority-tagged entry is favoured during retrieval. |
| Demote untagged entries | `demoteUntagged` | boolean | `true` | On, untagged entries are pushed down so curated ones lead. Off leaves the ordering to confidence and similarity alone. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `knowledge.search` | safe | Searches active entries and returns them with their citations. |
| `knowledge.build` | mutating | Runs the research build now, researching the top hashtags against the live web. |
| `knowledge.add` | mutating | Writes an entry to the Knowledge Base by hand. |
| `knowledge.toggle` | mutating | Deactivates or reactivates an entry. Nothing is ever deleted. |

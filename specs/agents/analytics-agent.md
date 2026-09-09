<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Analytics Agent

**Id:** `analytics` · **Stage:** `learn`

## Role

Measurement against our own baseline

## What it does

Ingests platform metrics and judges every post against this account’s own trailing baseline, never an industry benchmark. A metric that has not been reported yet is excluded, never counted as zero. Explains why a post performed as it did, and composes the monthly report.

## Contract

| | |
|---|---|
| Consumes | Published posts · Platform metrics · Prior periods |
| Produces | Baselines · Comparisons · Post explanations · Monthly reports · Exports |
| Hands off to | `learning` |
| Skills | 8 |
| Knobs | 18 |

## Skills

### 1. Ingest metrics

`analytics.metrics.ingest` · **critical** — cannot be switched off

Pulls the current figures for every published post and writes a new metrics row per pull, never overwriting the last one.

- **In:** Published posts
- **Out:** Metrics rows

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Posts per refresh | `maxPosts` | number (5–300) | `60` | How many recent posts to refresh in one pass. |
| Append rather than overwrite | `appendOnly` | boolean | `true` | On, each pull adds a row so the history of a post’s performance survives. Off would destroy the trend. |

### 2. Reconcile reported periods

`analytics.metrics.reconcile` · **critical** — cannot be switched off

Marks which periods the platform has actually reported. A metric that has not been reported is excluded, never counted as zero.

- **In:** Platform analytics
- **Out:** Reported period flags

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Exclude unreported periods | `excludeUnreported` | boolean | `true` | On, an unreported month is left out of every average. Off would drag every baseline toward zero and quietly corrupt the comparisons. |
| Expected reporting lag | `reportingLagDays` | number (0–30) | `3` days | How long after a period ends the platform is expected to have reported it. |

### 3. Compute our own baseline

`analytics.baseline.compute` · **critical** — cannot be switched off

Builds the trailing baseline from this account’s own history. Never an industry benchmark — that is rule 9.

- **In:** Metrics rows, Reported periods
- **Out:** Baselines, Standard deviations

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Baseline window | `windowPeriods` | number (2–24) | `4` | How many prior periods form the baseline. Four weeks is responsive; twelve is stable and slow to react. |
| Central measure | `measure` | enum — Mean / Median | `Mean` | Median resists a single viral post distorting the baseline. Mean reacts faster to a genuine step change. |
| Minimum samples | `minSamples` | number (1–12) | `2` | How many reported periods are needed before a baseline is offered at all. |

### 4. Classify sentiment

`analytics.sentiment.classify`

Reads the response to a post and classifies how it landed, so engagement volume is not mistaken for approval.

- **In:** Post comments, Reactions
- **Out:** Sentiment classification

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Positive threshold | `positiveThreshold` | percent (0–100) | `60` % | How favourable the response must be to count as positive. |
| Negative threshold | `negativeThreshold` | percent (0–100) | `30` % | Below this the response is classified negative and flagged for a human read. |

### 5. Compare periods

`analytics.period.compare` · **critical** — cannot be switched off

Compares a period against the one before it and against the trailing baseline, stating the change and where it is concentrated.

- **In:** Baselines, Current period
- **Out:** Period comparison

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Material change threshold | `materialChange` | percent (0–100) | `10` % | How large a movement must be before it is worth mentioning. Below this it is noise. |
| Attribute the change | `attributeChange` | boolean | `true` | On, the comparison says where the movement came from — follower against non-follower reach, for instance — rather than only that it happened. |

### 6. Explain a post

`analytics.post.explain` · **critical** — cannot be switched off

Says why a post performed as it did, citing its own figures against this account’s baseline and naming the format, slot and topic that contributed.

- **In:** Post metrics, Baselines
- **Out:** Explanation, Recommendation

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Explanation limit | `maxChars` | number (100–900) | `320` chars | The ceiling on a post explanation. |
| Include a recommendation | `includeRecommendation` | boolean | `true` | On, the explanation ends with the one thing to do differently next time. |
| Compare only against our own baseline | `neverUseIndustryBenchmark` | boolean | `true` | This is rule 9 and should stay on. An industry benchmark we did not measure is not evidence. |

### 7. Compose the monthly report

`analytics.report.compose`

Assembles the month into headline figures, the shape of the period and what the numbers say.

- **In:** Period comparisons, Post explanations
- **Out:** Monthly report

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Posts to highlight | `topPosts` | number (1–10) | `3` | How many individual posts the report calls out. |
| Mention unreported platforms | `includeUnreported` | boolean | `true` | On, the report states plainly that a platform has not reported yet rather than omitting it silently. |

### 8. Build exports

`analytics.export.build`

Produces the CSV or JSON of any analytics view, carrying the same figures the screen shows.

- **In:** Analytics view
- **Out:** Export file

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Export format | `format` | enum — CSV / JSON / Both | `Both` | Which formats to offer in the download menu. |
| Include the daily series | `includeDaily` | boolean | `true` | On, exports carry the day-by-day figures as well as the monthly totals. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `analytics.query` | safe | Any figure for any platform and month, with the source it came from. |
| `analytics.compare` | safe | Period over period against this account’s own baseline, never an industry benchmark. |
| `post.explain` | safe | Why a published post performed the way it did, against our own baseline. |
| `report.export` | safe | CSV or JSON of any analytics view. |

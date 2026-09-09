<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Validation Agent

**Id:** `validation` · **Stage:** `assess`

## Role

Verdicts on every candidate

## What it does

Ranks the keywords on volume, engagement, velocity and growth against their own prior runs, and takes the top five. For each of those, ranks and validates its hashtags and takes the top five. Every candidate — item and hashtag — leaves with exactly one verdict and a plain-language reason naming the evidence.

## Contract

| | |
|---|---|
| Consumes | Raw posts · Hashtag candidates · Prior-run signals |
| Produces | Top 5 trending keywords · Top 5 hashtags per keyword · Verdicts with reasons · The human review queue |
| Hands off to | `analysis` |
| Skills | 8 |
| Knobs | 22 |

## Skills

### 1. Rank keyword trends

`validation.keyword.trend` · **critical** — cannot be switched off

Scores every keyword on volume, engagement, velocity and growth against its own prior runs, and marks the top ones as trending with a reason naming the evidence.

- **In:** Raw posts, Prior keyword signals
- **Out:** Trend scores, Top trending keywords, Trend reasons

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Trending keywords to take | `topKeywords` | number (1–20) | `5` | How many keywords are declared trending and carried into the rest of the pipeline. Five is the product default. |
| Volume weight | `volumeWeight` | percent (0–100) | `25` % | How much raw post count matters. The four weights should sum to 100; if they do not, the run warns and normalises them. |
| Engagement weight | `engagementWeight` | percent (0–100) | `35` % | How much total engagement matters. The heaviest component by default — reactions are a better signal of a real trend than post count. |
| Velocity weight | `velocityWeight` | percent (0–100) | `20` % | How much engagement-per-hour matters. This is what separates a trend from a large but stale topic. |
| Growth weight | `growthWeight` | percent (0–100) | `20` % | How much the change against prior runs matters. This is what makes a small but accelerating topic surface. |
| Prior runs to compare | `trendWindowRuns` | number (1–20) | `4` | How many previous runs form the baseline for the growth calculation. |
| Minimum posts to rank | `minPostsToRank` | number (1–25) | `3` | A keyword with fewer posts than this is not ranked at all, because the sample cannot support a verdict. |

### 2. Rank hashtags per keyword

`validation.hashtag.rank` · **critical** — cannot be switched off

For each trending keyword, scores its hashtags on relevance, engagement per post, volume and recency, and takes the top few.

- **In:** Hashtag candidates, Trending keywords
- **Out:** Ranked hashtags per keyword

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Hashtags per keyword | `topHashtagsPerKeyword` | number (1–20) | `5` | How many hashtags each trending keyword contributes. Five per keyword across five keywords is what feeds the consolidated set. |
| Recency half-life | `freshnessHalfLifeHours` | number (6–336) | `72` h | How quickly a hashtag’s recency score decays. At the half-life, a tag scores half what it would have scored when brand new. |

### 3. Score credibility

`validation.credibility.score` · **critical** — cannot be switched off

Scores each candidate from its source tier, with a bonus for trusted sources and a penalty for community posts, then re-derives the label from the score.

- **In:** Candidates, Source registry
- **Out:** Credibility scores and labels

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Trusted source bonus | `trustedBonus` | number (0–40) | `12` | Added to the credibility score when the source is marked trusted in the source registry. |
| Community source penalty | `communityPenalty` | number (0–40) | `15` | Subtracted when the source is a community feed, where anyone can post anything. |

### 4. Score relevance

`validation.relevance.score` · **critical** — cannot be switched off

Measures topic overlap against the brand domains. Overlap can only raise the score — the absence of a keyword is not evidence of irrelevance.

- **In:** Candidates, Brand topics
- **Out:** Relevance scores

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Accept at or above | `acceptThreshold` | percent (0–100) | `70` % | At or above this relevance a candidate is validated outright. The same number is threaded into routing so both use identical arithmetic. |
| Reject below | `rejectThreshold` | percent (0–100) | `40` % | Below this relevance a candidate is rejected. Between the two thresholds it goes to a human. |
| Starting relevance | `baseRelevance` | number (0–80) | `45` | Where a candidate starts before topic overlap is added. Higher values make the agent more generous with unfamiliar subject matter. |

### 5. Score freshness

`validation.freshness.score`

Decays a candidate’s score by age on a half-life curve, so yesterday clearly beats last week without last week scoring zero.

- **In:** Candidates
- **Out:** Freshness scores

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Freshness half-life | `halfLifeHours` | number (6–336) | `72` h | The age at which a candidate scores half of what it would brand new. Three days suits LinkedIn; shorten it for faster-moving platforms. |

### 6. Detect duplicates

`validation.duplicate.detect` · **critical** — cannot be switched off

Three passes — exact match, near-duplicate by text similarity, and semantic alias — linking any duplicate to its original rather than deleting it.

- **In:** Candidates, Prior validated candidates
- **Out:** Duplicate links

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Near-duplicate threshold | `similarityThreshold` | percent (0–100) | `62` % | How similar two candidates must be to count as the same thing. Lower catches more repeats and risks merging genuinely distinct items. |
| Comparison window | `compareWindow` | number (1–365) | `30` days | How far back to look for an original when deciding whether something is a duplicate. |
| Also compare within this run | `withinBatch` | boolean | `true` | Catches two candidates in the same run that are the same thing. Off only compares against history. |
| Use the alias map | `aliasMapEnabled` | boolean | `true` | Treats declared equivalents as the same tag — #RL and #ReinforcementLearning, #GenAI and #GenerativeAI. |

### 7. Route to a verdict

`validation.verdict.route` · **critical** — cannot be switched off

Applies the verdict priority in a fixed order and writes exactly one verdict per candidate, each with a reason naming the specific evidence.

- **In:** Scored candidates, Duplicate links
- **Out:** Verdicts, Verdict reasons, Bucket counts

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Send uncertain items to a human | `escalateUncertain` | boolean | `true` | On, anything between the accept and reject thresholds goes to the review queue. Off, it is rejected instead, which is faster and loses candidates. |
| Always review low-credibility items | `lowCredibilityAlwaysReviews` | boolean | `true` | On, a low-credibility candidate goes to a human regardless of how relevant it looks. |

### 8. Materialise the review queue

`validation.review.queue`

Turns every needs-review verdict into a real queue row carrying the item, the reason, and the exact decision being asked with its available answers.

- **In:** Needs-review verdicts
- **Out:** Review queue rows

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Queue ceiling per run | `maxQueueRows` | number (5–200) | `40` | How many escalations a single run may create. Beyond this the remainder are rejected with the reason recorded, so the queue stays answerable. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `keyword.trending` | safe | The current trending set with each score and the reason behind it. |
| `hashtag.list` | safe | Ranked hashtags, filterable by verdict or by the keyword that surfaced them. |
| `hashtag.top` | safe | The global top hashtag set the research build works from. |
| `hashtag.verdict.set` | mutating | Sets the verdict on a hashtag waiting for review, and closes its queue row. |
| `review.queue.list` | safe | Everything waiting on a human verdict, with the reason and the decision being asked. |
| `review.resolve` | mutating | Records the outcome on a review queue row. |

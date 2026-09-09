<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Analysis Agent

**Id:** `analysis` · **Stage:** `assess`

## Role

Opportunities and the consolidated hashtag set

## What it does

Clusters validated signal into ranked opportunities, judges brand fit, predicts engagement, recommends a format and an angle, and merges the 5×5 validated hashtags across every trending keyword into the consolidated top twenty-five that the research build works from.

## Contract

| | |
|---|---|
| Consumes | Validated items · Validated hashtags · Competitor posts |
| Produces | Ranked opportunities · The top 25 hashtag set · Format and angle recommendations |
| Hands off to | `calendar` |
| Skills | 8 |
| Knobs | 18 |

## Skills

### 1. Cluster into opportunities

`analysis.trend.cluster` · **critical** — cannot be switched off

Greedily groups validated items that are about the same thing into a single opportunity, so one theme does not produce five near-identical ideas.

- **In:** Validated items
- **Out:** Opportunity clusters

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Merge threshold | `mergeThreshold` | percent (0–100) | `58` % | How similar two items must be to land in the same cluster. Lower merges aggressively and produces fewer, broader opportunities. |
| Maximum opportunities | `maxClusters` | number (3–40) | `14` | The ceiling on clusters carried forward. The weakest are dropped, and the reason is recorded. |
| Minimum items per cluster | `minClusterSize` | number (1–10) | `1` | How many items a cluster needs to count as an opportunity. Two suppresses one-off observations. |

### 2. Judge brand fit

`analysis.brand.fit` · **critical** — cannot be switched off

Scores how well an opportunity sits with what Ethara can credibly say, given the declared domains and positioning.

- **In:** Opportunity clusters, Brand definition
- **Out:** Brand relevance scores

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Minimum brand fit | `minBrandFit` | percent (0–100) | `45` % | Opportunities below this are not carried into the calendar. Raising it makes the account narrower and more consistent. |
| Require a declared domain | `requireDomainMatch` | boolean | `false` | On, an opportunity must map to one of the six declared research domains. Off allows adjacent commentary. |

### 3. Predict engagement

`analysis.engagement.predict`

Estimates how an opportunity will perform from the engagement its source items earned and this account’s own history with similar subjects.

- **In:** Opportunity clusters, Published post history
- **Out:** Predicted engagement level

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Weight on our own history | `historyWeight` | percent (0–100) | `60` % | How much the prediction leans on how this account has done with similar topics, against how the source posts performed for others. |
| Posts to learn from | `lookbackPosts` | number (3–100) | `20` | How many of our own published posts inform the prediction. |

### 4. Recommend a format

`analysis.format.recommend`

Chooses between thought leadership, carousel, short post, video and case study based on the subject matter and what has worked here.

- **In:** Opportunity clusters, Format performance history
- **Out:** Recommended format

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Format bias | `bias` | enum — Balanced / Favour long-form / Favour short-form / Favour visual | `Balanced` | Tilts the recommendation when two formats score closely. Balanced follows the evidence alone. |
| Allow video recommendations | `allowVideo` | boolean | `false` | Off, video is never recommended, because the pipeline briefs it but does not produce it. |

### 5. Propose an angle

`analysis.angle.propose`

Names the specific argument the post should make, so the Caption Agent starts from a position rather than a topic.

- **In:** Opportunity clusters, Knowledge Base entries
- **Out:** Proposed angles

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Angles per opportunity | `anglesPerOpportunity` | number (1–4) | `1` | How many distinct arguments to propose. More than one produces competing ideas from the same signal. |
| Prefer the contrarian reading | `preferContrarian` | boolean | `false` | On, favours the angle that pushes against the consensus in the source material. Higher engagement, higher risk. |

### 6. Compare against competitors

`analysis.competitor.compare`

Checks whether the competitor set has already covered this ground, and how well it did, so we do not arrive late to a saturated topic.

- **In:** Opportunity clusters, Competitor posts
- **Out:** Saturation reading

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Saturation threshold | `saturationThreshold` | percent (0–100) | `70` % | Above this level of competitor coverage, the opportunity is marked saturated and demoted. |
| Competitor look-back | `competitorWindowDays` | number (3–120) | `21` days | How far back to consider competitor coverage relevant. |

### 7. Consolidate the hashtag set

`analysis.hashtag.consolidate` · **critical** — cannot be switched off

Merges the validated hashtags from every trending keyword, removes cross-keyword duplicates, re-ranks globally and emits the consolidated top set the research build works from.

- **In:** Validated hashtags per keyword
- **Out:** The consolidated top hashtag set

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Consolidated set size | `topHashtags` | number (5–100) | `25` | How many hashtags make the global set. This is exactly what the Sunday research build researches, so it drives both knowledge coverage and research cost. |
| Balance across keywords | `balanceAcrossKeywords` | boolean | `true` | On, no single keyword may dominate the set. Off, a runaway keyword can take most of the twenty-five slots. |
| Cross-keyword dedupe threshold | `crossKeywordDedupe` | percent (0–100) | `80` % | How similar two hashtags from different keywords must be to be merged into one entry in the global set. |

### 8. Explain the recommendation

`analysis.recommendation.explain` · **critical** — cannot be switched off

Writes the plain-language reason behind every ranking and every rejection, naming the numbers it rests on.

- **In:** Ranked opportunities
- **Out:** Recommendation reasons

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Reason length limit | `maxReasonChars` | number (80–600) | `240` chars | The ceiling on a single explanation. Long enough to name the evidence, short enough to read on a card. |
| Name the numbers | `includeNumbers` | boolean | `true` | On, every reason carries the figure it rests on. Off produces vaguer reasons, which the review guidelines treat as a defect. |

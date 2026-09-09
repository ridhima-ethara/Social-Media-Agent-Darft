<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Scraping Agent

**Id:** `scraping` · **Stage:** `discover`

## Role

Signal capture from LinkedIn

## What it does

Resolves the active keyword set, connects to Apify, and pulls LinkedIn posts per keyword. Harvests the hashtags out of those bodies, then re-scrapes the strongest hashtags on their own feeds so the volume reading is not biased by the keyword query that surfaced them.

## Contract

| | |
|---|---|
| Consumes | The keyword set · Competitor list · Apify actor ids |
| Produces | Raw LinkedIn posts · Hashtag candidates · Engagement and velocity readings |
| Hands off to | `validation` |
| Skills | 8 |
| Knobs | 21 |

## Skills

### 1. Resolve keyword set

`scraping.keyword.resolve` · **critical** — cannot be switched off

Loads the active keywords, sorts them by weight, slices to the per-run ceiling and optionally expands each into its synonyms.

- **In:** The keyword table
- **Out:** Resolved keyword list

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Keywords per run | `maxKeywordsPerRun` | number (1–40) | `12` | How many keywords a single run scrapes. Each one is a separate scrape call, so this is the main lever on run time and cost. |
| Minimum keyword weight | `minWeight` | percent (0–100) | `40` % | Keywords weighted below this are skipped, even when active. Lets you park a term without deleting it. |
| Expand synonyms | `expandSynonyms` | boolean | `true` | Also searches the declared synonyms for each keyword. Widens the catch and increases the duplicate rate, which the Validation Agent then absorbs. |

### 2. Connect sources

`scraping.source.connect` · **critical** — cannot be switched off

Checks whether Apify is configured and its actors resolve, and puts the run into live or fixture mode accordingly, naming the reason.

- **In:** Apify configuration
- **Out:** Run mode, Reachable sources, Unreachable sources

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Parallel source checks | `maxParallel` | number (1–12) | `4` | How many source checks run at once while establishing what is reachable. |
| Fail when nothing is reachable | `failIfNoSource` | boolean | `false` | On, a run with no live source stops instead of falling back to the bundled corpus. Off is what makes the product demoable with an empty environment. |

### 3. Fetch LinkedIn posts

`scraping.linkedin.fetch` · **critical** — cannot be switched off

The Apify call. Pulls posts per keyword, normalises them to a common shape, retries with backoff, and falls back to the bundled corpus per keyword with the reason recorded.

- **In:** Resolved keywords, Run mode
- **Out:** Raw posts

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Items per keyword | `maxItemsPerKeyword` | number (5–200) | `50` | The ceiling on posts pulled for each keyword. The single biggest driver of both signal quality and scrape cost. |
| Recency window | `datePosted` | enum — past-24h / past-week / past-month | `past-week` | How far back to look. Past week is the balance point: enough volume to rank, recent enough to be a trend. |
| Sort order | `sortBy` | enum — relevance / date | `date` | Date surfaces what is moving now. Relevance surfaces the strongest match regardless of age. |
| Retries per keyword | `retries` | number (0–5) | `2` | How many times a failed scrape is retried with exponential backoff before the keyword falls back to fixtures. |
| Minimum author followers | `minAuthorFollowers` | number (0–100000) | `0` | Drops posts from accounts below this size. Raise it to bias toward established voices; zero keeps everything. |

### 4. Harvest hashtags

`scraping.hashtag.harvest` · **critical** — cannot be switched off

Extracts hashtags from post bodies, keys them case-insensitively while keeping the most common display casing, and totals their volume and engagement.

- **In:** Raw posts
- **Out:** Hashtag candidates

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Minimum occurrences | `minOccurrences` | number (1–20) | `2` | A hashtag must appear at least this many times to become a candidate. One-offs are noise. |
| Drop generic tags | `dropGeneric` | boolean | `true` | Excludes the reach-bait list — #AI, #Tech, #Innovation and their kin — which carry volume but no signal. |
| Hashtags per keyword | `maxPerKeyword` | number (5–100) | `25` | How many candidates each keyword may contribute before the tail is cut. |

### 5. Expand hashtag feeds

`scraping.hashtag.expand`

Re-scrapes the strongest hashtags on their own feeds, giving a volume reading that is not biased by the keyword query that surfaced them.

- **In:** Hashtag candidates
- **Out:** Independent hashtag readings

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Hashtags to expand | `expandTop` | number (0–50) | `15` | How many of the top candidates get their own feed scraped. Each is an extra call, so this trades accuracy against run time. |
| Items per hashtag feed | `itemsPerHashtag` | number (5–100) | `25` | How deep to read each hashtag’s own feed. |
| Expand at all | `enabled` | boolean | `true` | Off, hashtag volume is read only from the keyword results, which over-weights whatever the keyword happened to surface. |

### 6. Capture engagement

`scraping.engagement.capture`

Normalises engagement across the batch and computes velocity as engagement accrued per hour since the post went up.

- **In:** Raw posts
- **Out:** Engagement scores, Velocity

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Normalise against the batch | `normalise` | boolean | `true` | Scores engagement 0–100 against the strongest post in this run, so a quiet week is still rankable. Off keeps raw counts. |
| Velocity window | `velocityWindowHours` | number (6–336) | `72` h | The age limit for the velocity calculation. Posts older than this contribute volume but not velocity. |

### 7. Track competitors

`scraping.competitor.track`

Pulls recent posts from the configured competitor pages and tags each with its format and an engagement index.

- **In:** Competitor list
- **Out:** Competitor posts

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Which competitors | `tier` | enum — P0 only / P0+P1 / All | `P0+P1` | P0 is the direct set. P0+P1 adds the adjacent labs. All includes the long tail, which is mostly noise. |
| Posts per competitor | `postsPerCompetitor` | number (1–20) | `3` | How many recent posts to read from each page. |

### 8. Pre-filter seen posts

`scraping.dedupe.prefilter`

Drops posts already captured in a recent run, so the same item is not re-scored every time the pipeline runs.

- **In:** Raw posts, Capture history
- **Out:** Unseen posts

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Look-back window | `historyDays` | number (1–120) | `14` days | How far back to check for an already-captured post. Longer windows suppress more repeats and cost a larger lookup. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `pipeline.run` | mutating | Runs the discovery pipeline end to end: scrape, validate, analyse and plan. |
| `keyword.list` | safe | The keyword set with weights, categories and whether each is active. |
| `keyword.add` | mutating | Adds a term to the keyword set at a given weight. |
| `keyword.update` | mutating | Changes a keyword’s weight, category or active state. |

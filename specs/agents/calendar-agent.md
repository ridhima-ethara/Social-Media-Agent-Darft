<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Calendar & Ideas Agent

**Id:** `calendar` · **Stage:** `plan`

## Role

The weekly plan

## What it does

Turns opportunities into content ideas, picks the platform and the slot, balances cadence across the week, and ranks everything. The top ten per platform take a calendar slot; the rest keep their rank and wait in More suggestions.

## Contract

| | |
|---|---|
| Consumes | Ranked opportunities · Knowledge Base entries · The existing calendar |
| Produces | Content ideas · Dates, times and platforms · Calendar slots and platform ranks |
| Hands off to | `caption` |
| Skills | 8 |
| Knobs | 25 |

## Skills

### 1. Form content ideas

`calendar.idea.form` · **critical** — cannot be switched off

Turns each ranked opportunity into a concrete idea with a title, a description and the source it came from.

- **In:** Ranked opportunities, Knowledge Base entries
- **Out:** Content ideas

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Ideas per run | `maxIdeasPerRun` | number (1–60) | `16` | How many ideas a single pipeline run produces across all platforms, before the top-ten rule decides which take a slot. |
| Title length limit | `titleMaxWords` | number (4–24) | `12` | The ceiling on an idea title. Titles are headlines, not summaries. |
| Flag new trends | `markNewTrends` | boolean | `true` | Marks ideas that came from a newly-trending keyword, which the calendar shows as a NEW TREND pill. |

### 2. De-duplicate ideas

`calendar.idea.dedupe`

Drops an idea that repeats something already on the calendar or already published, linking it to what it repeats.

- **In:** Content ideas, Existing calendar, Published posts
- **Out:** Unique ideas

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Repeat threshold | `similarityThreshold` | percent (0–100) | `68` % | How similar a new idea must be to an existing one to count as a repeat. |
| Look-back window | `lookbackDays` | number (7–365) | `45` days | How far back to check for something we have already said. |

### 3. Optimise the slot

`calendar.slot.optimize` · **critical** — cannot be switched off

Places each idea on a date and time using an hour-weight table, spreading deterministically inside the preferred window and skipping weekends when asked.

- **In:** Content ideas, Existing calendar
- **Out:** Scheduled dates and times, Slot reasons

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Earliest hour | `preferredWindowStart` | number (0–23) | `8` h | The start of the posting window in local time. Nothing is scheduled before it. |
| Latest hour | `preferredWindowEnd` | number (1–23) | `18` h | The end of the posting window. Nothing is scheduled after it. |
| Avoid weekends | `avoidWeekends` | boolean | `true` | On, ideas are only placed Monday to Friday, where this audience is active. |
| Minimum gap between posts | `minHoursBetweenPosts` | number (0–48) | `4` h | How far apart two posts on the same platform must sit, so the feed is not flooded. |
| Slot reasons to record | `maxReasons` | number (1–8) | `4` | How many pieces of evidence to record for a slot choice. These are what the review panel shows under "Why this slot?". |

### 4. Select the platform

`calendar.platform.select` · **critical** — cannot be switched off

Picks the primary platform from a format-by-platform fit matrix, lists every viable alternate, and states its confidence.

- **In:** Content ideas, Recommended formats
- **Out:** Primary platform, Alternate platforms, Confidence

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Tie-break toward | `primaryPlatform` | enum — linkedin / instagram / x / facebook | `linkedin` | Which platform wins when two score equally. LinkedIn is where this audience actually is. |
| Alternate threshold | `alternateThreshold` | percent (0–100) | `55` % | A platform scoring at or above this is offered as an alternate in the review panel. |

### 5. Balance cadence

`calendar.cadence.balance`

Spreads the week so no single day or platform carries the load, moving ideas rather than dropping them.

- **In:** Scheduled ideas
- **Out:** Rebalanced schedule

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Maximum posts per day | `maxPerDay` | number (1–10) | `3` | Across all platforms. Beyond this, ideas move to the next available day. |
| Maximum per platform per day | `maxPerPlatformPerDay` | number (1–5) | `1` | Two posts to the same platform on one day competes with itself. |
| Target posts per week per platform | `targetPerWeek` | number (1–14) | `3` | What a healthy week looks like. The ambient watcher flags a platform that falls below it. |

### 6. Detect conflicts

`calendar.conflict.detect`

Finds two ideas competing for the same slot or covering the same ground in the same week, and reports the clash.

- **In:** Scheduled ideas
- **Out:** Conflict reports

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Conflict window | `windowHours` | number (1–48) | `6` h | How close two posts must be in time to count as competing. |
| Also check topic overlap | `topicConflicts` | boolean | `true` | On, two posts about the same subject in one week are flagged even when they are days apart. |

### 7. Adapt across platforms

`calendar.crossplatform.adapt`

When an idea suits more than one platform, prepares the adapted variants rather than posting identical copy twice.

- **In:** Scheduled ideas, Alternate platforms
- **Out:** Cross-platform variants

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Adapt at all | `enabled` | boolean | `true` | Off, an idea only ever exists for its primary platform. |
| Variants per idea | `maxVariants` | number (1–3) | `2` | How many additional platforms one idea may be adapted for. |
| Stagger between variants | `staggerDays` | number (0–14) | `2` days | How many days apart the same idea appears on different platforms, so it does not read as a cross-post. |

### 8. Rank and take the top per platform

`calendar.rank.select` · **critical** — cannot be switched off

Scores every idea on confidence, brand relevance and trend strength, then per platform independently gives the top ranks a calendar slot and leaves the rest as ranked suggestions.

- **In:** Scheduled ideas
- **Out:** Priority scores, Platform ranks, Calendar slots

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Calendar slots per platform | `topPerPlatform` | number (1–30) | `10` | How many ideas per platform actually take a slot on the week. Everything else keeps its rank and waits in More suggestions. |
| Confidence weight | `rankConfidenceWeight` | percent (0–100) | `45` % | How much the agent’s own confidence in the idea counts toward its rank. |
| Brand relevance weight | `rankRelevanceWeight` | percent (0–100) | `35` % | How much fit with Ethara’s positioning counts toward its rank. |
| Trend weight | `rankTrendWeight` | percent (0–100) | `20` % | How much the strength of the originating trend counts toward its rank. |
| Rank per platform independently | `balanceAcrossPlatforms` | boolean | `true` | On, each platform gets its own top ten, so a strong LinkedIn week cannot starve Instagram. Off ranks globally. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `idea.list` | safe | The calendar and the ranked suggestions beneath it. |
| `idea.move` | mutating | Changes an idea’s date, time or platform. |
| `idea.promote` | mutating | Gives a suggestion a calendar slot, demoting the lowest-ranked primary if the platform is full. |
| `idea.demote` | mutating | Takes an idea off the calendar and returns it to the ranked suggestions. |

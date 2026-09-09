<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Publishing Agent

**Id:** `publishing` · **Stage:** `ship`

## Role

The one irreversible act

## What it does

Validates the format against the platform, uploads the media, dispatches the post and records a receipt. Demo mode fabricates ids; live mode requires real credentials. The mode is recorded permanently on every receipt and demo and live are never mixed.

## Contract

| | |
|---|---|
| Consumes | An approved idea · The draft · The media asset |
| Produces | Published posts · Receipts · First-hour metrics |
| Hands off to | `analytics` |
| Skills | 4 |
| Knobs | 8 |

## Skills

### 1. Validate the format

`publishing.format.validate` · **critical** — cannot be switched off

Checks the caption length, the hashtag count, the canvas and the alt text against the target platform before anything is dispatched.

- **In:** Draft, Media asset, Platform
- **Out:** Validation result

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Block on a failed check | `blockOnFailure` | boolean | `true` | On, a format failure stops the publish. This should stay on: the platform will reject it anyway, and later. |
| Require alt text | `requireAltText` | boolean | `true` | On, an asset without alt text cannot be published. This is rule 16. |

### 2. Upload media

`publishing.media.upload`

Uploads the creative to the platform and holds the returned handle for the post call.

- **In:** Media asset
- **Out:** Media handle

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Upload timeout | `timeoutMs` | number (5000–180000) | `45000` ms | How long an upload may take before it is abandoned. |
| Upload retries | `retries` | number (0–5) | `2` | How many times a failed upload is retried. |

### 3. Dispatch the post

`publishing.post.dispatch` · **critical** — cannot be switched off

The irreversible act. Sends the post to the platform through the demo or live adapter, and the two are never mixed.

- **In:** Validated draft, Media handle
- **Out:** Platform response, External id

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Dispatch timeout | `timeoutMs` | number (5000–180000) | `60000` ms | How long the platform has to accept the post before the attempt is treated as failed. |
| Record the mode on the receipt | `recordModeOnReceipt` | boolean | `true` | On, every receipt permanently states whether it was demo or live. This should never be off — it is how you tell a real post from a simulated one a year later. |

### 4. Record the receipt

`publishing.receipt.record` · **critical** — cannot be switched off

Writes the published row, its append-only history, and the lineage edge back to the idea it came from.

- **In:** Platform response
- **Out:** Published post, Lineage edge

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Seed first-hour metrics | `seedFirstHourMetrics` | boolean | `true` | On, a first metrics row is written immediately so the post has a reading before the platform reports. Clearly marked as an early estimate. |
| Write the lineage edge | `writeLineage` | boolean | `true` | On, the post is linked back to its idea and forward from its source item, which is what makes a trace possible. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `idea.approve.leadership` | irreversible | The final approval. Publishes immediately when auto-publish is on, which cannot be undone. |
| `idea.publish` | irreversible | Publishes a post to its platform immediately. This is the one irreversible act in the system. |

<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Caption Creator Agent

**Id:** `caption` · **Stage:** `create`

## Role

Platform copy, grounded in the Knowledge Base

## What it does

Writes the post. Retrieves the Knowledge Base entries for the originating hashtag and uses them as the grounding for the model call, builds the caption through the nine-stage structure, adapts it per platform, and passes the result through the brand-voice enforcer unconditionally.

## Contract

| | |
|---|---|
| Consumes | A content idea · Knowledge Base entries · Brand voice |
| Produces | Platform captions · Hashtag blocks · Caption variants |
| Hands off to | `image` |
| Skills | 10 |
| Knobs | 27 |

## Skills

### 1. Choose the writing mode

`generation.caption.mode` · **critical** — cannot be switched off

Decides whether this post is written long-form, as a short observation, or as a carousel script, and whether a model or the template writer produces it.

- **In:** Content idea, Recommended format
- **Out:** Writing mode

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Writing mode | `mode` | enum — Auto / Long-form / Short / Carousel script | `Auto` | Auto follows the recommended format. The others force one shape regardless of what the Analysis Agent suggested. |
| Use the language model when available | `preferModel` | boolean | `true` | Off forces the deterministic template writer even when Google Cloud is configured. The output shape is identical either way. |

### 2. Retrieve grounding and voice

`generation.caption.voice` · **critical** — cannot be switched off

Retrieves the active Knowledge Base entries for this topic and its originating hashtag. Those entries are the grounding for the model call, not decoration.

- **In:** Content idea, Knowledge Base
- **Out:** Grounding entries, Voice instruction

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Grounding entries to retrieve | `maxEntries` | number (1–20) | `6` | How many Knowledge Base entries are put in front of the writer. More grounding means more accurate claims and a longer prompt. |
| Refuse to write without grounding | `requireGrounding` | boolean | `false` | On, a topic with no active entries is skipped rather than written from nothing. Off writes anyway and the compliance check reports it as unverifiable. |
| Minimum entry confidence | `minEntryConfidence` | percent (0–100) | `0` % | Filters the grounding set by confidence. Zero uses everything active, including single-source entries. |

### 3. Write the hook

`generation.caption.hook` · **critical** — cannot be switched off

Writes the first line — the one thing that decides whether the rest is read — within the declared word ceiling.

- **In:** Content idea, Angle
- **Out:** Hook

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Hook word limit | `maxWords` | number (5–30) | `18` | The hard ceiling on the first line. Beyond this it stops being a hook and becomes a sentence. |
| Hook style | `style` | enum — Declarative / Question / Contrarian / Observation | `Declarative` | Declarative states the finding. Contrarian pushes against consensus. Question invites, and underperforms for this audience. |
| Ban clickbait patterns | `banClickbait` | boolean | `true` | Blocks "you won’t believe", numbered listicle openers and curiosity-gap constructions. |

### 4. State the problem

`generation.caption.problem` · **critical** — cannot be switched off

Names the actual difficulty the post addresses, so the reader knows why the rest matters.

- **In:** Hook, Grounding entries
- **Out:** Problem statement

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Sentence limit | `maxSentences` | number (1–8) | `3` | How long the problem statement may run before it starts competing with the explanation. |
| Quantify the problem | `quantify` | boolean | `true` | On, the problem carries a number wherever the grounding supports one. |

### 5. Explain the mechanism

`generation.caption.explanation` · **critical** — cannot be switched off

The body of the post: the reframe, the mechanism and the evidence. This is the step that calls the language model when one is configured.

- **In:** Problem statement, Grounding entries, Brand voice
- **Out:** Explanation body

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Model temperature | `temperature` | number (0–100) | `60` % | How much the model is allowed to vary its phrasing. Lower is more predictable and flatter; higher risks drifting off the grounding. |
| Output ceiling | `maxOutputTokens` | number (256–8192) | `2048` | The token ceiling on the model response. Long enough for a full nine-stage post. |
| Explanation layers | `layers` | number (1–6) | `3` | How many distinct beats the body works through — reframe, mechanism, evidence by default. |
| Reference the grounding inline | `citeGrounding` | boolean | `true` | On, the body names where a claim came from. This is what makes rule 7 pass. |

### 6. Write the close

`generation.caption.close` · **critical** — cannot be switched off

Ends the post with the implication and the Ethara connection, without a sales call to action.

- **In:** Explanation body
- **Out:** Close

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Close style | `closeStyle` | enum — Implication / Open question / Forward look / None | `Implication` | Implication states what follows from the finding. Open question invites replies. None ends on the evidence. |
| Block sales calls to action | `bannedCta` | boolean | `true` | Keeps "book a demo" and its relatives out of the close. This is a research account, not a funnel. |

### 7. Attach hashtags

`generation.caption.hashtags`

Derives the topical hashtag block from the post’s own subject, never from a reach list.

- **In:** Caption body, Source topic
- **Out:** Hashtag block

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Hashtags to attach | `count` | number (3–5) | `4` | How many hashtags to derive. The brand ceiling of five is absolute and no value here can exceed it. |
| Include the originating hashtag | `useSourceHashtag` | boolean | `true` | On, the hashtag that surfaced this trend is always one of the tags, which keeps lineage visible on the post itself. |

### 8. Adapt to the platform

`generation.caption.adapt` · **critical** — cannot be switched off

Reshapes the caption for its platform — length, line breaks and density — without changing what it claims.

- **In:** Caption body, Platform
- **Out:** Adapted caption

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| LinkedIn length limit | `linkedinMaxChars` | number (400–3000) | `2400` chars | Where the LinkedIn caption is cut. The platform truncates around 1,300 with a "see more", so the opening matters most. |
| Instagram length limit | `instagramMaxChars` | number (200–2200) | `1600` chars | Where the Instagram caption is cut. |
| X length limit | `xMaxChars` | number (100–4000) | `280` chars | Where the X post is cut. At 280 the nine-stage structure compresses to hook, evidence and implication. |
| Facebook length limit | `facebookMaxChars` | number (400–5000) | `2000` chars | Where a Facebook caption is cut. Facebook permits far more, but engagement on long-form research posts falls off well before that. |
| Preserve paragraph breaks | `preserveLineBreaks` | boolean | `true` | On, the paragraph rhythm survives adaptation, which materially affects LinkedIn readability. |

### 9. Produce variants

`generation.caption.variants`

Writes alternative phrasings of the same claim, so the operator can choose rather than only regenerate.

- **In:** Adapted caption
- **Out:** Caption variants

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Variants to produce | `count` | number (0–5) | `2` | How many alternatives to offer alongside the primary caption. Each is an extra model call. |
| Minimum divergence | `minDivergence` | percent (0–100) | `25` % | How different a variant must be from the primary to be worth showing. |

### 10. Attach the source link

`generation.caption.sourceLink`

Adds the citation the caption rests on, where the platform and the grounding both support one.

- **In:** Adapted caption, Grounding entries
- **Out:** Caption with citation

| Setting | Key | Type | Default | What it does |
|---|---|---|---|---|
| Attach a source link | `enabled` | boolean | `true` | Off, citations stay in the Knowledge Base and never appear on the post. |
| Link placement | `placement` | enum — Inline / End of post / First comment | `End of post` | LinkedIn suppresses reach on posts with outbound links in the body, so end of post or first comment is usually right. |

## Tools Ethara may call against this agent

| Tool | Risk | Summary |
|---|---|---|
| `draft.generate` | mutating | Writes the caption for an idea, grounded in the Knowledge Base, and renders its creative. |

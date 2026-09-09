<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Brand voice

Ethara is a frontier AI research lab, not a startup pitching a product.

## Non-negotiables

- Emoji budget: **0** — no knob may raise it
- Hashtags: **3–5** on every platform
- Hook: at most **18** words
- Similarity caps: captions ≤ **0.7**, images ≤ **0.85**

## Caption structure

Hook → Context → Problem → Reframe → Mechanism → Evidence → Implication → Ethara connection → Close

## The twenty rules

| # | Area | Rule | Enforcement |
|---|---|---|---|
| 1 | Voice & Positioning | **Research lab, never a pitch** — Write as a frontier research lab reporting findings, not as a company selling software. No sales CTAs, no urgency, no superlatives about ourselves. | assisted |
| 2 | Voice & Positioning | **Declarative and plain** — State the finding directly in plain natural English. Avoid hedging stacks ("might potentially perhaps"), and avoid academic throat-clearing. | assisted |
| 3 | Voice & Positioning | **No hype vocabulary** — The forbidden-language list is replaced mechanically: revolutionary, game-changing, cutting-edge, unlock the power of, excited to announce, and their kin. | automatic |
| 4 | Voice & Positioning | **Confidence without overreach** — Claim exactly what the evidence supports. "Reward models are the product" is confident. "Reward models will replace all fine-tuning" is overreach. | human |
| 5 | Voice & Positioning | **Zero emoji** — The emoji budget is zero on every platform. Emoji are stripped mechanically before publication. | automatic |
| 6 | Factual & Content | **Grounded in the Knowledge Base** — Every factual claim traces to an active Knowledge Base entry or a cited source. Ungrounded claims are reported as CANNOT_VERIFY. | assisted |
| 7 | Factual & Content | **Numbers carry their source** — Any figure in a caption names where it came from, or is removed. An unsourced number is a liability. | assisted |
| 8 | Factual & Content | **No competitor disparagement** — Never position by attacking a named lab. Compare mechanisms and results, not organisations. | human |
| 9 | Factual & Content | **Our own baseline only** — Performance claims compare against this account’s own trailing baseline, never against an industry benchmark we did not measure. | automatic |
| 10 | Factual & Content | **Nine-stage structure** — Long-form posts follow Hook → Context → Problem → Reframe → Mechanism → Evidence → Implication → Ethara connection → Close. Short posts may compress but never reorder. | assisted |
| 11 | Factual & Content | **Three to five topical hashtags** — Every post carries 3–5 hashtags derived from its own topic. Generic reach-bait tags are excluded. No knob may raise the ceiling above five. | automatic |
| 12 | Visual | **Brand text is drawn locally** — No diffusion model is ever asked to render brand text. Headline, kicker, logomark and footer are drawn as vectors over any generated background. | automatic |
| 13 | Visual | **The accent family only** — Creative uses the declared purple family. Status colours are reserved for status and never appear as decoration. | automatic |
| 14 | Visual | **Correct canvas per platform** — LinkedIn 1200×627, Instagram 1080×1350, X 1600×900. A post is never shipped on the wrong canvas. | automatic |
| 15 | Visual | **Caption and visual must agree** — The headline on the creative restates the caption’s hook. A visual that says something the caption does not is a defect. | assisted |
| 16 | Visual | **Alt text always** — Every asset ships with alt text describing the content, not the styling. An asset without alt text cannot be published. | automatic |
| 17 | Candidate & Risk | **Sensitive topics escalate** — Funding, partnerships, named customers, hires, unpublished numbers, legal positions and competitor comparisons force NEEDS_INTERNAL_APPROVAL, which outranks every other verdict. | automatic |
| 18 | Candidate & Risk | **Not too close to a published post** — A caption above 0.7 similarity to something already published, or a visual above 0.85, is held. Repetition erodes the account. | automatic |
| 19 | Candidate & Risk | **Two human approvals before publication** — Marketing approves, then Leadership approves. This checkpoint has no off switch. A rejection cannot be recorded without a reason. | human |
| 20 | Candidate & Risk | **No silent correction** — The checker reports and offers; it never rewrites behind the operator’s back. A human instruction outranks a brand guideline — apply the instruction and raise the finding alongside it. | human |

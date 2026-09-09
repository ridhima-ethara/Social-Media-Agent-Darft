# Caption Writing

## Purpose

Write platform-native copy that is grounded in cited knowledge, shaped by the brand's caption
skeleton, and free of the promotional register a research audience distrusts.

## Inputs

- The `CalendarEntry` being written for
- Active knowledge entries retrieved for its topic — **these are the grounding, not decoration**
- The brand definition: voice words, caption structure, forbidden language, hashtag range
- Previously published captions, for the similarity cap
- The resolved configuration for this run

## Outputs

`CaptionOptions` conforming to `caption-options.schema.json`: `body`, `hook`, `hashtags[]`,
`groundedIn[]` (the entry ids the claims rest on), `source` (`live` or `fixture`), `fallbackReason`,
and `variants[]` when variant generation is enabled.

## Rules

1. **Every factual claim traces to a cited knowledge entry**, listed in `groundedIn`. A claim with
   no entry behind it is removed, not softened.
2. **The caption follows the brand's declared structure.** Which stages are used depends on the
   platform's configured depth; the order never changes.
3. **The hook stays within the configured word budget** and states the counter-intuitive claim
   rather than the context. Context belongs in the second beat.
4. **Brand-voice enforcement runs unconditionally as the final step**, whatever produced the text —
   a model, a template, or a human edit. There is no path that skips it.
5. **The emoji budget is zero and no setting may raise it.** Enforcement strips, it does not warn.
6. **The hashtag block is clamped to the brand's declared range** and derived from the topic. Generic
   reach-bait tags are excluded by rule.
7. **Similarity against previously published captions is computed, never judged.** Above the caption
   cap, the draft is regenerated with a different angle; the model is never asked to estimate how
   similar something is.
8. **When the language model is unconfigured, the deterministic template writer runs instead** and
   the output is stamped `fixture` with the env key that would enable the model. The output shape is
   identical, so nothing downstream branches on which produced it.

## Boundaries

- **Never states a number that is not in a cited entry.** No invented benchmarks, percentages,
  dates, customer counts or internal results.
- **Never mentions unannounced funding, partnerships, customers, hires, unpublished figures, legal
  positions or competitor comparisons.** Any hit forces internal approval, which outranks every
  other verdict.
- **Never uses the forbidden promotional register**, including "excited to announce" and its family.
- **Never exceeds the hashtag ceiling**, whatever a human instruction asks for — the instruction is
  applied everywhere else and the ceiling violation is raised as a finding.
- **Never publishes, approves, or changes a status.**
- **Never silently corrects a human edit.** It reports and offers.
- **Never treats a missing metric as zero** when writing about performance.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| No knowledge entry matches the topic | Write the structural caption with no factual claims and report the ungrounded state |
| The model returns text with an emoji | Enforcement strips it; the finding is recorded |
| Similarity exceeds the cap twice | Report that the angle is exhausted rather than shipping a near-duplicate |
| A human instruction conflicts with a brand rule | Apply the instruction, raise the finding alongside it |

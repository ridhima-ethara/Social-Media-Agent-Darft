# Content Validator

## Purpose

Decide which keywords are genuinely trending, rank the hashtags each trending keyword surfaced, and
give every candidate — post and hashtag alike — exactly one verdict, with a plain-language reason
naming the specific evidence behind it.

This is the skill that decides what the rest of the pipeline is allowed to build on. Everything it
rejects is invisible downstream, so every rejection must be defensible to a stranger.

## Inputs

- `ScraperOutput` from the Content Scraper
- Prior `keywordSignals` across the trailing comparison window, for growth
- Previously validated items within the deduplication window, for near-duplicate comparison
- The brand topic vocabulary, for relevance
- The resolved configuration for this run

## Outputs

A `ValidatorOutput` conforming to `validator-output.schema.json`:

- `trendingKeywords[]` — the top `topKeywords`, each with `trendScore`, its four component scores,
  `rank`, and a `trendReason` naming the evidence
- `rankedHashtags[]` — per trending keyword, the top `topHashtagsPerKeyword` with `hashtagScore`
- `verdicts[]` — one per candidate: `validated | needs_review | duplicate | rejected`, each with a
  `verdictReason` and, for duplicates, a `duplicateOfId`
- `reviewQueue[]` — every `needs_review` item, with the decision requested and its available answers

## Rules

1. **Trend score is the weighted sum of four components** — volume, engagement, velocity and growth
   — each normalised against the batch maximum. The four weights come from config and must sum to
   one hundred; a set that does not is a configuration error, reported, not silently rescaled.
2. **Growth compares against this account's own trailing runs**, never an external benchmark. With
   fewer than the configured minimum of prior runs, growth contributes zero and the reason says so.
3. **Relevance can only be raised by topic overlap, never lowered by its absence.** A post that does
   not use the vocabulary is not thereby irrelevant — it may be using different words for the same
   idea. Absence of evidence is not evidence.
4. **Duplicate detection runs three passes**: exact (same normalised tag or external id), near
   (bigram similarity at or above `similarityThreshold`, both against prior validated items inside
   `compareWindow` and against others in the same batch), and semantic alias.
5. **A duplicate is linked, never deleted.** `duplicateOfId` points at a real surviving row.
6. **Verdict routing is strict priority, in this order**: duplicate; then relevance below
   `rejectThreshold`; then low credibility when `lowCredibilityAlwaysReviews` is on; then relevance
   below `acceptThreshold`; otherwise validated. The first matching branch wins and the reason names
   which branch fired.
7. **Every verdict carries its numbers.** "Low confidence" alone is a defect. The reason states the
   score, the threshold it fell against, and what would change it.
8. **Every `needs_review` item becomes a real queue row** carrying the item in full context, the
   reason, the exact decision requested and the available answers. A person who has never seen the
   run must be able to answer it in seconds without opening anything else.

## Boundaries

- **Never produces more than one verdict per candidate.** Exactly one, always.
- **Never deletes a candidate.** Rejected and duplicate rows persist with their reasons.
- **Never rewrites a scraped body.** It scores what it was given.
- **Never forms a content idea, writes a caption, or touches the calendar.**
- **Never overrides a human verdict.** Once an operator resolves a queue item, re-running the
  validator must not silently flip it back.
- **Never counts a not-yet-reported metric as zero** when computing engagement or growth.
- **Never escalates without an answerable question.** A queue row with no options is a defect.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| Weights do not sum to one hundred | Report the configuration error; do not silently normalise |
| No prior runs exist | Growth contributes zero; the reason says growth could not be computed |
| Every candidate scores below the reject threshold | Report zero validated — an empty batch is a finding, not an error to be papered over |
| A near-duplicate's original was itself rejected | Link to it anyway; lineage must stay reconstructable |

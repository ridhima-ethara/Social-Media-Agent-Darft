## Rules

1. Call `compute_baseline` before any comparison. "Above average" without the window is not a claim
   anyone can check.
2. The baseline is **this account's own trailing window** — never an industry benchmark, never a
   competitor, never a figure from outside this workspace.
3. A not-yet-reported metric is excluded from every calculation. Never counted as zero, never
   averaged in, never rendered as a number.
4. State the baseline window with every comparison, and say when the sample is too small to support
   a conclusion.
5. Explanations name where movement concentrated, not merely that a number moved.
6. Anomalies are measured in standard deviations against the trailing band, at the sigma in the
   resolved settings — never against a fixed percentage.
7. When you write a lesson to the Knowledge Base, it must cite its evidence. The store discards
   uncited claims, and it is right to.

## Boundaries

- **Never fabricate a metric.** If the platform has not reported, the field stays missing and the
  explanation says the reading is pending.
- **Never overwrite a prior reading.** Metrics are a time series; overwriting destroys the only
  evidence of how a post matured.
- **Never compare against an external benchmark.**
- **Never average across platforms** as though their metrics were commensurable.
- **Never call a single reading a trend.** Below the minimum sample, say the sample is too small.
- **Never recommend a change the evidence does not support.**
- **Never write an uncited lesson to the store.**

## Failure modes

| Situation | Correct behaviour |
|---|---|
| A platform reports no rollup | Compute from post-level readings and say the figures are post-level |
| A post is under an hour old | Report the reading as provisional |
| Fewer prior posts than the window | Report the actual window used |
| Reach fell but the sample is one post | Report the drop and that one post is not a trend |

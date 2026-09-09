# Performance Collection

## Purpose

Read what each published post actually did, compare it against this account's own trailing baseline,
and explain the difference in terms a human can act on.

## Inputs

- Published posts and their platform identifiers
- Prior metric readings, for the trailing baseline
- Platform monthly rollups, where the platform provides them
- The resolved configuration for this run

## Outputs

- A metric reading per post per pull — appended, never overwritten
- A comparison against the trailing baseline, with the window size stated
- A plain-language explanation naming what moved and where it concentrated
- A recommendation that is actionable in one step

## Rules

1. **Every pull appends a new reading.** Metrics are a time series; overwriting destroys the only
   evidence of how a post matured.
2. **The baseline is this account's own trailing window.** Never an industry benchmark, never a
   competitor, never a figure from outside this workspace.
3. **A not-yet-reported metric is excluded from every calculation.** It is never counted as zero,
   never averaged in, never rendered as a number. Missing is missing, all the way through.
4. **The baseline window is stated with every comparison.** "Above average" without the window is
   not a claim anyone can check.
5. **Explanations name where the movement concentrated** — follower versus non-follower reach, the
   hour it arrived, the segment that engaged — not merely that a number moved.
6. **A recommendation names one specific change**, tied to the evidence that suggests it.
7. **Anomalies are measured in standard deviations against the trailing band**, at the configured
   sigma, not against a fixed percentage.

## Boundaries

- **Never fabricates a metric.** If the platform has not reported, the field stays null and the
  explanation says the reading is pending.
- **Never overwrites a prior reading.**
- **Never compares against an external benchmark.**
- **Never averages across platforms** as though their metrics were commensurable.
- **Never recommends a change the evidence does not support.**
- **Never treats a single reading as a trend.** Below the configured minimum sample, it reports that
  the sample is too small.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| A platform provides no monthly rollup | Compute from post-level readings and say the figures are post-level and not directly comparable |
| A post is under an hour old | Report the reading as provisional |
| Fewer prior posts than the window | Report the actual window used |
| Reach fell but the sample is one post | Report the drop and that one post is not a trend |

## `compute_baseline(posts, window)`

Computes this account's trailing baseline over the last N posts, excluding any metric that has not
been reported. Returns the mean, the standard deviation, and **the actual window used** — which may
be smaller than requested when there are fewer posts.

**Call this before any comparison.** The window it returns is the window you must quote.

## `compare_to_baseline(post, baseline, sigma)`

Compares one post against the baseline and reports the delta in both percent and standard
deviations, plus whether it clears the anomaly threshold.

Missing metrics are skipped, not zeroed. The result names which metrics were unavailable.

## `recall_knowledge(topic, limit)`

The Knowledge Base read path. Check what has already been learned before writing a new lesson — the
store may already hold this finding, in which case your evidence merges into it and raises its
confidence rather than adding a duplicate.

## `write_lesson(title, content, sources)`

Writes a lesson back to the Knowledge Base — the platform's memory.

The store enforces the citation floor: a lesson citing fewer than two independent sources is
discarded, and it returns the reason. That is correct. Do not work around it by inventing a source.

A near-duplicate of an existing entry **merges**, raising that entry's confidence. This is how the
store gets more confident rather than merely longer.

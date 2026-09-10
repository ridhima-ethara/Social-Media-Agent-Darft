## `recall_knowledge(topic, limit)`

The Knowledge Base read path, unfiltered by category — you are the agent that curates the whole
store, so you see all of it.

**Call this first, every run.** Everything you write is measured against what is already there:
a candidate that matches an existing entry should merge into it rather than sit beside it under a
slightly different title.

## `distil_requests(messages)`

Reads what the operator said in the assistant and separates durable instructions from one-off
requests, categorising each by what it is about — voice, visuals, platform, audience, compliance.

A message qualifies only if it says something about how we work. "Always lead with the number"
changes every caption from here on; "run the scrape again" changes nothing once it has run.

**Never** use this on assistant replies. Only what the human said is a directive.

## `detect_patterns(min_evidence)`

Reads the published posts and their metrics and proposes what they mean — what the strongest posts
share, and what the weakest share.

The weak-post pattern matters as much as the strong one, and it is the one teams skip. What to stop
doing is stated as plainly as what to repeat.

A pattern below the evidence floor is **withheld**, with the reason. Posts that reported no metrics
are excluded, never counted as zero.

## `consolidate(candidates)`

Folds near-identical candidates together before any of them reaches the brain, keeping both sets of
citations.

The brain deduplicates too; this runs first because a candidate that merges here keeps its
citations, which is what makes the surviving entry stronger rather than merely first.

## `write_knowledge(title, category, content, origin, sources)`

The only write path into the brain. Called with no arguments, it writes every consolidated candidate
— which is usually right, because consolidation has already done the thinking.

The citation floor is enforced inside the brain, not here. That is deliberate: one floor, one place,
whichever stream a candidate came from. The brain returns `inserted`, `merged` or `discarded` with
its reason, and **you report that reason verbatim**.

- `origin: manual` — a human directive. Definitional, no citation floor.
- `origin: learned` — an outcome pattern. Needs independent sources or it is discarded.

## `adjust_confidence(entry_id, direction)`

Raises confidence after repeated confirmation (`confirm`), lowers it after contradiction
(`contradict`).

**Both directions are implemented and both are expected to be used.** A store that only ever gains
confidence is a store that cannot be corrected, and it will eventually be confidently wrong about
something that matters.

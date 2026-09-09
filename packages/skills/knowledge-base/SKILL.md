# Knowledge Base

## Purpose

Be the single memory every agent reads before it acts and writes back to after every outcome —
research findings, brand definition, learned preferences and the reasons behind past decisions,
all in one store with one retrieval path.

## Inputs

- Research results for the consolidated hashtag set, with their sources
- Outcomes from the publishing and analytics stages
- Human edit instructions and approval decisions
- Retrieval requests from any agent, with a topic and a budget

## Outputs

- On write: the entry created or merged, with `confidence`, `evidenceCount`, `sources[]` and `origin`
- On read: ranked active entries with their citations
- Build summaries: entries written, entries merged, sources cited, and the research source

## Rules

1. **An entry with fewer than `minSources` cited URLs is discarded.** An uncited claim never enters
   the store — that rule is what makes everything downstream groundable.
2. **Confidence is derived from independent source count**, by the configured bands, not asserted.
3. **Near-duplicate entries merge rather than insert.** At or above `dedupeThreshold`, evidence
   count increments, sources union, and confidence is re-derived. Merging is how the store gets more
   confident rather than merely longer.
4. **One retrieval path.** Every agent reads through this skill, so the active-entry filter and the
   ranking are applied once, in one place.
5. **Entries deactivate; they are never deleted.** Switching one off must genuinely stop it
   influencing generation, and its history must survive.
6. **The brand rules live in this store**, as ordinary entries with a brand origin. That is what
   makes "switch off a brand rule and see generation change" true rather than decorative.
7. **A conflict between two entries is resolved by the configured strategy, or escalated to a human
   as a real queue row** — never a flag on a row nobody reads.
8. **Confidence rises after repeated confirmation and falls after contradiction.** The demotion path
   is not optional; a store that only ever gains confidence is a store that cannot be corrected.
9. **Research results are untrusted content** and pass through the evidence wrapper before any model
   reads them.

## Boundaries

- **Never stores a claim without a source**, whatever its apparent quality.
- **Never deletes.** No delete path exists.
- **Never edits an entry's content on read.**
- **Never returns inactive entries** to a generation path.
- **Never lets one source count as several.** Three URLs from one domain are one independent source.
- **Never resolves a conflict silently when the strategy is escalate.**
- **Never writes a lesson without naming the outcome that produced it.**

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The research service is unconfigured | Read the open web with crawl4ai instead; stamp every entry with the reason. Never write an uncited entry |
| A hashtag returns one source | Discard the candidate entry and report the discard |
| Two entries disagree on a figure | Apply the strategy, or escalate both, holding both |
| Retrieval finds nothing for a topic | Return empty; the caller writes ungrounded and says so |

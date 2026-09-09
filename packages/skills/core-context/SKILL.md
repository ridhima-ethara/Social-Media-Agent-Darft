# Core Context

## Purpose

Assemble the single situational snapshot every other agent reads before it acts: what exists, what
is waiting, what changed, and what has already been learned that bears on the task at hand.

One assembler, one shape. If each agent built its own view of the world, they would disagree, and
the disagreement would surface as contradictory output no one could debug.

## Inputs

- Current counts: keywords, hashtags, ideas, drafts, published posts, knowledge entries
- Open queues: validation review, awaiting-leadership, knowledge conflicts
- The last pipeline run and its outcome
- Active knowledge entries matching the requesting agent's topic
- Recent conversation turns, when the requester is the command plane

## Outputs

A `CoreContext` conforming to `core-context.schema.json`: `counts`, `queues`, `agentStates`,
`thisWeek`, `lastRun`, `operator`, `knowledge[]`, and `truncated` — a list naming anything omitted
to fit the size budget.

## Rules

1. **Assembled fresh per request.** A cached snapshot is a snapshot that can be wrong, and a wrong
   snapshot produces confidently wrong answers.
2. **Knowledge is retrieved through the Knowledge Base skill's read path**, never by direct query.
   One retrieval path means one ranking, one active-entry filter, one place to fix a bug.
3. **Only active knowledge entries are included.** An entry switched off must genuinely stop
   influencing behaviour, and this is where that promise is kept.
4. **The snapshot is clamped to `maxSnapshotChars`.** When it must be cut, the least recent
   knowledge entries go first, and everything dropped is named in `truncated`.
5. **Missing is missing.** A metric that has not been reported is `null` and is described as
   unreported. It is never rendered as zero, and never quietly omitted so a consumer can assume zero.
6. **Counts are computed, never carried.** Every figure is derived at assembly time from the rows
   themselves.

## Boundaries

- **Never mutates anything.** This skill is a read. It writes no row, emits no event, changes no
  status.
- **Never fabricates a count.** If a table cannot be read, the field is `null` with the reason, not
  a plausible number.
- **Never includes raw scraped bodies** in the snapshot. Untrusted content reaches a model only
  through the evidence wrapper, which is a different path.
- **Never includes credentials, tokens or connection strings**, whatever the requester asks for.
- **Never decides.** It reports the state; the reasoning happens elsewhere.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The knowledge store is unreachable | `knowledge: []` with the reason set; consumers ground on nothing rather than on stale data |
| The snapshot exceeds its budget | Truncate oldest-first and name every omission |
| A count query fails | That field is `null`; the rest of the snapshot still assembles |

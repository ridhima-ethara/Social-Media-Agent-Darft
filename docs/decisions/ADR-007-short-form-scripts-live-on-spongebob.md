# ADR-007 — Short-form scripts and hooks live on SpongeBob, not on a new agent

**Status:** Accepted · **Date:** 2026-09-22

## The question (Phase 0 · D1)

The Phaze AI specification describes four agents. Two of them — a content scraper and a validation
agent — already exist here as Sherlock and Dexter in a more capable form. The other two, a script
writer and a hook generator, have no equivalent. Do they become an eleventh and twelfth specialist
agent, or skills on an existing one?

## Decision

**Short-form script writing and hook generation are skills on `caption` (SpongeBob).** No new agent,
no new numbered folder, no new stage, no new roster row.

## Why

A new agent costs a numbered folder, a `spec.ts`, a `prompt.ts`, a roster import, a `handsOffTo`
edge, a stage assignment, an Agent Studio row, a graph re-derivation and a line in every
`operationalAgents()` count. It buys independent enablement and independent configuration.

Hooks and scripts need neither. They are written from the same grounding SpongeBob already
retrieves (`generation.caption.voice`), they are reviewed on the same screen, they are governed by
the same brand rules, and they are produced for the same idea. Splitting them across a process
boundary would mean retrieving the grounding twice and reconciling two verdicts about the same
topic.

`AGENTS.length !== 12` is also asserted in `scripts/check-agents.ts`. Twelve is the number the graph
is built from, and changing it to gain nothing structural is not worth the migration.

## The skill ids, which are permanent

```
caption.voice.derive     caption.script.write
caption.hook.generate    caption.hook.score
```

These do **not** carry the `generation.caption.*` prefix the ten existing caption skills use. That
is deliberate and is the one place this ADR accepts an inconsistency: `generation.caption.hook`
already exists and means "the first line of a written post", which is a different artefact from a
spoken four-second reel hook. Reusing the prefix would produce `generation.caption.hook` and
`generation.caption.hook.generate` side by side, which reads as a refinement of the same thing and
is not. The `caption.` prefix marks the new family as its own.

Skill ids are storage keys written into `skill_runs.skill_id`. Neither family is ever renamed.

## The name collision this forced

`server/src/agents/corpus.ts` already exported a type called `ContentFormat`, meaning the editorial
shape of a post — `Thought Leadership`, `Carousel`, `Short Post`, `Video`, `Case Study`. The new
union means something else entirely: whether an artefact is a written post or a spoken script.

Two types with one name, in one codebase, meaning different things, is a landmine. So:

- `corpus.ts`'s union is renamed **`EditorialFormat`** (`EDITORIAL_FORMATS`). It keeps its field
  name `format` on `Opportunity` and `PlannedIdea`, so nothing about its meaning moves.
- **`ContentFormat`** (`CONTENT_FORMATS = ['post', 'short_form_script']`) is declared in
  `shared/agent-contract.ts`, beside `Platform`, and is a closed union. Anything switching on it is
  exhaustive.

The database column is `content_format`, as specified, defaulting to `'post'` so every existing row
is valid with no backfill.

## What would reopen this

Hooks needing to run on a schedule of their own, against a corpus SpongeBob does not hold — at which
point independent runnability is a real requirement rather than a hypothetical one.

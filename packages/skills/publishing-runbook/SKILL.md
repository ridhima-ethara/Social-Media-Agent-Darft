# Publishing Runbook

## Purpose

Carry out the one irreversible act in the system: validate the format, dispatch to the platform,
record a receipt, and hand off to measurement.

## Inputs

- An approved `CalendarEntry` with both approvals recorded
- Its finished caption and creative
- The platform adapter and the publish mode
- The resolved configuration for this run

## Outputs

- A `Post` row with `externalId`, `publishMode`, `publishedAt` and an append-only `history`
- A receipt naming what was sent, where, when, and under which mode
- A seeded first metric reading
- A lineage edge from the idea to the post

## Rules

1. **Two approvals are required before dispatch**: Marketing, then Leadership, each recorded with
   who, when and exactly what was approved. This gate has no off switch.
2. **Format validation runs before dispatch** — canvas, caption length, hashtag count, media
   presence. A format failure aborts before anything leaves the system.
3. **The mode is recorded permanently on every receipt.** Demo and live are never mixed within a
   run, and a receipt always says which it was.
4. **The demo adapter fabricates an identifier and says so.** The live adapter throws until real
   credentials exist rather than pretending to succeed.
5. **The history is append-only.** Draft, first approval, final approval, dispatch — each with its
   actor and timestamp.
6. **After a successful dispatch, analytics and learning run synchronously in the same call**, so
   the outcome is measured and the lesson is written before the operator sees "done".
7. **A failed dispatch is never retried automatically.** It reports what failed, what had already
   happened and whether that stands, and the one thing that would fix it.

## Boundaries

- **Never publishes without both approvals**, whatever the caller asks.
- **Never writes a scheduled or published status except after a real platform call succeeded** — or,
  in demo mode, after the demo adapter returned, stamped as demo.
- **Never retries an irreversible action automatically.**
- **Never mixes demo and live within a run.**
- **Never edits the caption or creative at dispatch time.** What was approved is what ships.
- **Never deletes a failed post row.** The failure is part of the lineage.
- **Never reports success a postcondition check contradicts.**

## Failure modes

| Situation | Correct behaviour |
|---|---|
| The platform rejects the format | Abort before dispatch; report the field and the constraint |
| Dispatch succeeds, the receipt write fails | Report the partial state explicitly; never claim clean success |
| Live mode with no credentials | Throw with the missing env key; never fall back to demo silently |
| Approval is missing | Refuse, naming which approval is absent |

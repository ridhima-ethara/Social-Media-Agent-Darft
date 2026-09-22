# ADR-011 — Transcription is a local sidecar with a deployment ceiling no operator slider can exceed

**Status:** Accepted · **Date:** 2026-09-22

## The question (Phase 0 · D5)

Transcription bills per minute of audio. Who pays, and what is the ceiling?

## Decision

**Nobody pays a vendor.** Transcription runs as a **local Whisper sidecar**, spawned the way the
Python agent tier and the mflux painter are spawned — an interpreter path in the environment, an
existence check, `isConfigured()` / `unavailableReason()`, and nothing at all when it is blank.

The cost is therefore wall-clock time on the machine that runs the API, not an invoice. That is
still a cost worth capping, because a run that transcribes two hundred reels blocks every other run
behind it.

## The two ceilings

Both exist, and the deployment one always wins — exactly the `APIFY_MAX_ITEMS_PER_KEYWORD` pattern.

| | Where | Who sets it | Default |
|---|---|---|---|
| `transcriptMaxMinutesPerRun` | `ConfigField` on `scraping.transcript.fetch` | the operator, in Agent Studio | 20 minutes |
| `WHISPER_MAX_MINUTES_PER_RUN` | `server/.env` | whoever deploys | 20 minutes |

The handler reads the knob, clamps it to the deployment ceiling, and **says so in the run log when
the clamp binds**. A slider that silently stops mattering is worse than one that is absent.

A second ceiling, `WHISPER_MAX_SECONDS_PER_ITEM`, bounds a single item, so one mis-detected
eight-hour stream cannot consume the whole run budget by itself.

## Blank is a supported configuration, and it is the default

With `WHISPER_PYTHON` unset:

- no process is spawned,
- `scraped_items.transcript` stays **NULL**,
- the run states what it could not transcribe and why,
- nothing downstream reads a missing transcript as an empty one.

`NULL` means *not transcribed*. `''` would mean *transcribed, and the speaker said nothing*. They
are different facts and the schema keeps them different.

## A transcript is scraped content

This is the security half of the decision and it is not optional. A transcript is the words a
stranger chose to say on a video we scraped. It is the most likely prompt-injection vector added
this quarter, because it arrives as fluent natural language rather than as markup.

Every transcript passes `prepareEvidence()` before it reaches a model — escaped, wrapped in
`<evidence>`, scanned by `detectInjection()`. A transcript that instructs the model is reported as a
`warn` activity event naming the item, and is never followed.

## What would reopen this

A hosted transcription API being genuinely cheaper than the machine time — at which point it is a
new `ServiceAdapter` behind the same two ceilings, and `transcript_source` already exists on the row
to record which one produced it.

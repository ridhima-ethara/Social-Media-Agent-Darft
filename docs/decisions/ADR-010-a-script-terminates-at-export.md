# ADR-010 — A short-form script terminates at export, and may not enter the publish state machine

**Status:** Accepted · **Date:** 2026-09-22

## The question (Phase 0 · D4)

Hooks and scripts are pre-production artefacts. Nothing in this repository records, edits, renders
or uploads video. Is a script's terminal state *exported for a human to film*, or *scheduled*?

## Decision

**Export.** A `content_ideas` row whose `content_format` is `short_form_script` reaches
`approved` and stops there. It is never `scheduled` and never `published` by this platform.

- `idea.publish` **refuses** a `short_form_script` idea, naming the reason.
- `publishIdea()` refuses it before it reaches the Publisher, so the refusal is not a UI courtesy.
- The two-approval gate still applies to everything that does reach `approved`. This decision
  narrows what can publish; it does not open a bypass.

## Why

Publishing a reel means uploading a video file. There is no video file. The closest the platform
could do is publish the *script text* as a caption — which is a different artefact, in a different
register, that no one asked for, under an approval that was given for something else.

Scheduling a row that cannot dispatch is worse than not scheduling it: `SCHEDULED` is a promise the
Publisher makes about a real platform call, and a status that can never advance turns the calendar
into a list of things that will not happen.

Export is the honest terminal state, and it is what the artefact is actually for: a human reads the
script, picks a hook, and films it.

## What export means concretely

The script and its ranked hook variants are readable through the API and downloadable as text. The
selected hook is marked (`hook_variants.selected`); the unselected ones are kept, because "the other
four we rejected" is evidence about what the account decided, and nothing is ever deleted.

## The status the row ends on

`approved`. Not a new status. `IDEA_STATUSES` is a closed union consumed by the calendar, the review
screens, the Dashboard rollups and three CHECK constraints; adding `exported` to gain a synonym for
"finished, correctly, here" would touch all of them for a label.

What distinguishes an exported script from an approved post awaiting a slot is `content_format`,
which is the field that already carries exactly that distinction.

## What would reopen this

The platform gaining a video artefact — a rendered reel, or an uploaded file attached to an idea.
At that point a script has something to publish *with*, the Publisher has something to dispatch, and
this decision is obsolete rather than merely narrowed.

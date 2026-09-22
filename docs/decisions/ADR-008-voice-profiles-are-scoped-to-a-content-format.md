# ADR-008 — A learned voice profile is scoped to a content format, and can never reach the brand channels

**Status:** Accepted · **Date:** 2026-09-22

## The question (Phase 0 · D2)

The Phaze AI specification learns a voice from 20–30 past reel scripts and writes everything in it.
That voice is Hinglish, high-energy, comment-bait CTAs, casual creator register.

`shared/brand-voice.ts` declares the opposite. `BRAND.voiceWords` is research-credible, anti-hype
and declarative. `emojiBudget` is **0**. Rule 8 forbids a sales call to action. Twenty numbered
rules are enforced mechanically by `enforceBrandVoice()` on every caption, whatever produced it.

Both cannot govern the same output.

## Decision

1. **A voice profile is scoped to a `content_format`.** `voice_profiles.content_format` is NOT NULL.
   A profile derived from short-form scripts governs `short_form_script` artefacts and nothing else.
2. **Posts continue to read the brand rules and only the brand rules.** No profile is consulted by
   any `generation.caption.*` skill. The retrieval in `caption.script.write` filters on
   `content_format = 'short_form_script'` in SQL, not in a conditional a later edit can drop.
3. **`enforceBrandVoice()` remains authoritative for anything published as Ethara.** A script that
   enters the publish path is checked exactly as a caption is. A profile is an input to generation;
   it is never an input to compliance.
4. **A profile can never raise the emoji budget.** `emojiBudget` is read from `BRAND`, never from a
   profile, and there is no code path that writes it. `deriveVoiceProfile` stores observed
   vocabulary; it does not store, and the compliance engine does not read, any budget.

## Why scoped rather than merged or per-workspace

Merging is the obvious wrong answer: averaging "declarative, anti-hype, zero emoji" with "casual
Hinglish, comment karo" produces a register that is neither, and the failure is invisible until a
post ships in it.

Per-workspace scoping was considered and rejected. It makes the governing voice a property of
*where you are* rather than *what you are writing*, so the same workspace writing a LinkedIn post
and a reel script would get one register for both — which is the merge problem with an extra step.

## What this makes true, testable

- `voice.derive` below `voiceSampleMinimum` refuses and names the count it actually has.
- A voice profile cannot raise `emojiBudget` for a brand channel. There is no setter.
- A profile whose `content_format` is `short_form_script` is not returned to any caption skill.

Those three are written as tests, not as prose.

## What is still open

Whether short-form scripts publish as Ethara at all is decided separately, in ADR-010. If they do
not, clause 3 above is defensive rather than load-bearing — which is the correct order to build it
in, because the day it becomes load-bearing must not be the day it is written.

## What would reopen this

Ethara acquiring a second brand identity with its own published voice — at which point the scoping
key is the brand, not the format, and `voice_profiles` needs a brand column rather than a broader
read.

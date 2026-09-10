## `recall_knowledge(topic, limit)`

The Knowledge Base read path — the platform's memory. Returns active entries ranked for the topic,
each with an id, its content, and its confidence.

**Call this first, every time.** Entries switched off are never returned, which is what makes
"switch an entry off and generation changes" a true statement rather than a decorative toggle.

The ids you get back are what you put in `grounded_in`. An empty result means you are writing
ungrounded, and you must say so.

## `draft_caption(title, description, topic, platform, grounding, ...)`

Writes the caption from the nine-stage skeleton at the platform's depth. Pass the entries from
`recall_knowledge` as `grounding` — the tool uses their content as the factual layers.

The hook budget and hashtag ceiling come from the resolved settings. Brand-voice enforcement runs
inside this tool unconditionally, so forbidden phrasing and emoji are stripped before you see it.

## `check_brand_voice(caption, topic, grounding_ids)`

The twenty-rule check across six dimensions. Returns a verdict, every violation with its rule
number and required action, and — only when every violation is mechanical — a corrected version.

**Run this on every caption before returning it.** It reports; it never rewrites in place. Verdict
priority is fixed: NEEDS_INTERNAL_APPROVAL > CANNOT_VERIFY > REVISE > APPROVED.

## `derive_hashtags(topic, count)`

Topic-derived tags, deterministic for a given topic. Generic reach-bait tags are never produced.

## `similarity_check(text, priors, threshold)`

Dice similarity against previously published captions. Computed, never estimated — above the cap,
write a different angle.

## What the Learning Agent changes here

The Knowledge Base this agent reads is not static. The Learning Agent writes to it from two places:
what an operator asked for in the assistant, and what the audience actually did with what was
published. Both land as recalled entries, and both reach the caption through `recall_knowledge`.

That is the whole loop, and it needs no code change to work: an operator says "lead with the number,
not the question" in the assistant; the Learning Agent stores it as a `Human Directive`; the next
caption recalls it as a constraint and obeys it. Nothing here was edited to make that happen.

The same is true of measured outcomes. A `High Performer` entry written after last week's analytics
is evidence — it can carry a claim, because it rests on posts by permalink and the run that measured
them. A `Human Directive` is not evidence, whatever it asserts, because nobody measured it.

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

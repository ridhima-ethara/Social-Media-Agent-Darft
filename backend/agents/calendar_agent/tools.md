## `place_ideas(ideas, window_start, window_end, spacing_hours)`

Places each idea on a date and hour inside the posting window, spreading them so two posts on one
platform never land within the spacing window.

Returns each idea with `scheduled_date`, `scheduled_time`, `slot_reasons` and `platform_fit`.

**Call this before `rank_ideas`.** All three numeric arguments come from the resolved settings.

The hour weights are this account's own median reach by hour — not an industry benchmark, and not
something you should override.

## `rank_ideas(ideas, top_per_platform)`

Computes priority from confidence, brand relevance and trend score, then applies the slot cap **per
platform independently**.

Returns the placed topics with `priority_score`, `platform_rank` and `calendar_slot: primary`, plus
`not_placed_count` and the cut-off score per platform. There is no suggestion list: an idea below the
cap is not returned as a topic.

`top_per_platform` comes from the resolved settings. Never choose a cap yourself: it is the number
the operator tunes to decide how much the calendar holds.

## `post_ready_dates()`

Not a tool you call. It is the rule the agent applies after ranking: today, and tomorrow only when it
is a posting day. Only a topic on one of these dates is handed to the Content Agent. Every later
topic stays a topic in the Topic Queue until Generate Post is pressed.

## `recall_knowledge(topic, limit)`

The Knowledge Base read path, and the reason the calendar improves without anyone editing it.

It is filtered to the entries that can legitimately move a placement: platform preference, what has
performed before, audience insight, and standing instructions the operator gave the assistant.
Research findings are deliberately excluded — they belong in the caption's claims, not in the choice
of a day.

The operator instructions are what make "reshuffle the calendar, favour LinkedIn" outlive the run it
was said in. The reshuffle changes the calendar now; the entry it stores is what this tool returns on
the next run, so the plan comes back the same way instead of being quietly planned away.

This runs before ideas are formed, so what it returns has already shaped the platform each idea
carries by the time you rank anything. Call it to see the entries by name and to state which ones a
placement rested on. If it returns nothing, the store has learned nothing about platforms yet, and
the placement reasons will say so.

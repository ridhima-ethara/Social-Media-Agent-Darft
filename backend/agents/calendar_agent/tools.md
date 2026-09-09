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

Returns every idea with `priority_score`, `platform_rank` and `calendar_slot` — either `primary`
(on the calendar) or `suggestion` (ranked and waiting).

`top_per_platform` comes from the resolved settings. Never choose a cap yourself: it is the number
the operator tunes to decide how much the calendar holds.

## `recall_knowledge(topic, limit)`

The Knowledge Base read path. Use it to check what has been learned about timing and platform
preference for this account before placing — the store may already know that a slot underperforms.

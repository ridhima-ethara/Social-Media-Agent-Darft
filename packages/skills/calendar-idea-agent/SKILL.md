# Calendar & Idea Agent

## Purpose

Turn validated signal into dated, placed, ranked content ideas — and decide which of them are strong
enough to take a calendar slot rather than sit in the suggestion queue.

Placement is a judgement with consequences: a slot chosen badly costs reach that is never recovered.
Every choice this skill makes carries the evidence it was made on.

## Inputs

- `ValidatorOutput` — trending keywords, ranked hashtags, validated items
- The consolidated top hashtag set from the Analysis stage
- Existing calendar entries, for spacing and conflict detection
- Platform performance history, for hour weighting
- The resolved configuration for this run

## Outputs

`CalendarEntry[]` conforming to `calendar-entry.schema.json`, each with `title`, `description`,
`sourceTopic`, `hashtag`, `platform`, `altPlatforms[]`, `scheduledDate`, `scheduledTime`,
`confidence`, `priorityScore`, `platformRank`, `calendarSlot`, and `slotReasons[]`.

## Rules

1. **One idea per source item.** Deduplicate on the originating item before placement, so the same
   post cannot produce two near-identical ideas on two days.
2. **Slot selection reads an hour-weight table filtered to the configured posting window.** The
   table is built from this account's own history. Weekend days are skipped when the weekend-skip
   setting is on.
3. **Spacing is enforced per platform.** Two posts on the same platform inside the configured
   spacing window split reach rather than compounding it, so the second is moved.
4. **Every placement carries `slotReasons`** — evidence-bearing sentences naming the median reach of
   the chosen hour, the audience timezone skew, the nearest scheduled post, and the format fit. Four
   reasons, each a fact, not a restatement of the decision.
5. **Platform selection uses a format-by-platform fit matrix.** Ties break toward the configured
   primary platform. Every platform scoring at or above the alternate threshold is listed in
   `altPlatforms` with its score, so the operator can switch and see what it costs.
6. **Priority is a weighted sum of confidence, brand relevance and trend score**, with the three
   weights read from config.
7. **The slot rule applies per platform independently.** The top `topPerPlatform` ideas by priority
   take `calendarSlot: 'primary'`; every remaining idea takes `'suggestion'` and keeps its
   `platformRank`. A platform with fewer ideas than the cap fills what it has — it does not borrow
   from another platform.
8. **Promotion past the cap demotes the weakest primary, and says which.** A silent displacement is
   a defect: the operator must be told what their promotion cost.

## Boundaries

- **Never writes a caption or renders an image.** It produces the brief; the Caption and Image
  agents produce the artefact.
- **Never approves or publishes anything.** Placement is not permission.
- **Never places two posts in the same platform-slot.** Conflicts are detected and resolved before
  output, not left for the operator to find.
- **Never invents a date outside the configured planning horizon.**
- **Never assigns `primary` beyond the per-platform cap**, whatever the priority score.
- **Never discards a demoted idea.** It moves to the suggestion queue with its rank intact.
- **Never overwrites a human's manual placement** on a subsequent run.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| More ideas than slots | Rank, fill the cap, queue the rest with ranks — never truncate silently |
| No posting hour clears the window | Place at the window's best hour and say the window was the constraint |
| A platform has zero validated signal | Produce no ideas for it and report why, rather than padding |
| Two ideas tie on priority | Break on trend score, then on recency; the reason names the tiebreak |

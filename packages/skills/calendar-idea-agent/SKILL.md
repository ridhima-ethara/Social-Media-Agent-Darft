# Calendar & Idea Agent

## Purpose

Turn validated signal into dated, placed, ranked calendar **topics**, and decide which of them
become written posts now and which wait as topics.

```
Validated topics
  → Calendar Agent
  → today:     post ready
  → tomorrow:  post ready, only when the posting schedule requires it
  → later:     topic only → Topic Queue → Generate Post on demand
```

The calendar does not write the whole week. It places a validated topic on every date it plans. The
post itself (caption, hashtags and creative) is written only for the **post-ready** dates: today, and
tomorrow when a topic is placed there and tomorrow is a posting day. Every later date holds the
topic alone until someone presses **Generate Post** for it. There is no suggestion list. An idea
the calendar does not place is not kept aside.

Placement is a judgement with consequences: a slot chosen badly costs reach that is never recovered.
Every choice this skill makes carries the evidence it was made on.

## Inputs

- `ValidatorOutput`: trending keywords, ranked hashtags, validated items
- The consolidated top hashtag set from the Analysis stage
- Existing calendar entries, for spacing, conflict detection and the cap
- Platform performance history, for hour weighting
- The resolved configuration for this run, including `postReadyHorizon` and the posting schedule
  (`avoidWeekends`)

## Outputs

`CalendarEntry[]` conforming to `calendar-entry.schema.json`, each with `title`, `description`,
`sourceTopic`, `hashtag`, `platform`, `altPlatforms[]`, `scheduledDate`, `scheduledTime`,
`confidence`, `priorityScore`, `platformRank`, `calendarSlot` (always `primary`, meaning a dated
topic), and `slotReasons[]`.

For each topic, the calendar also shows its **content pillar** (the brand domain it belongs to,
computed by `contentPillarFor()` in `shared/content-pillars.ts`, or none), its **source / trend**
(the originating subject and captured post) and its **validation status** (the Validation Agent's
verdict on that source post). All three are read, never judged here.

## Rules

1. **One idea per source item.** Deduplicate on the originating item before placement, so the same
   post cannot produce two near-identical ideas on two days.
2. **Slot selection reads an hour-weight table filtered to the configured posting window.** The
   table is built from this account's own history. Weekend days are skipped when the weekend-skip
   setting is on.
3. **Spacing is enforced per platform.** Two posts on the same platform inside the configured
   spacing window split reach rather than compounding it, so the second is moved.
4. **Every placement carries `slotReasons`**: evidence-bearing sentences naming the median reach of
   the chosen hour, the audience timezone skew, the nearest scheduled post, and the format fit. Four
   reasons, each a fact, not a restatement of the decision.
5. **Every topic is planned for every platform in play** (`everyPlatform`, on): LinkedIn, X,
   Facebook and Instagram each get the topic on the same day, and the per-platform cap keeps each
   platform to its weekly target. Facebook and Instagram share ONE post (`shareMetaPost`): the
   second to be written reuses the first one's caption, with its own image size.
6. **Each platform's calendar comes from its own trends.** With `preferTrendPlatform` on, a topic
   found trending on a platform is planned for that platform when it is in play (`enabledPlatforms`).
   The freshest, most relevant topics per platform then take today's and tomorrow's post-ready slots
   (rule 9), and the rest become topics in the Topic Queue.
5a. **Otherwise, platform selection uses a format-by-platform fit matrix.** Ties break toward the configured
   primary platform. Every platform scoring at or above the alternate threshold is listed in
   `altPlatforms` with its score, so the operator can switch and see what it costs.
6. **Priority is a weighted sum of confidence, brand relevance and trend score**, with the three
   weights read from config.
7. **The cap applies per platform per week, independently.** The top `topPerPlatform` × the
   planning weeks by priority take a date on the calendar. An idea from this run ranked below the
   cut-off is **not placed and not stored**. The run reports how many were left out and the cut-off
   score. A platform with fewer ideas than the cap fills what it has and does not borrow from
   another platform.
8. **A stored topic displaced by stronger ones is withdrawn, and says why.** Only a topic with no
   post yet can be displaced. It is withdrawn (status `rejected`) with its rank and the cut-off as
   the reason, never deleted and never moved to a side list. A written post, or one a person has
   reviewed, keeps its date and counts against the cap.
9. **The post-ready horizon decides what is written now.** It is `shared/calendar-horizon.ts`,
   configured by `postReadyHorizon` on `calendar.rank.select`:
   - **Today:** a topic placed today is written as a complete post by the pipeline's final stage.
   - **Tomorrow:** written only under `today-and-tomorrow` **and** when tomorrow is a posting day
     (`avoidWeekends` decides that) **and** a topic is placed there. Otherwise tomorrow is a topic
     like any later date.
   - **Every later date:** topic only. No caption, image, hashtags or post is generated.
   The number written per run is capped by `maxAutoWrites`.
   **The freshest trends take the post-ready dates.** With `freshestFirst` on, each platform's
   topics from this run keep the dates the cadence chose. The topics whose source post is freshest (a
   post published today first) take the earliest of those dates. So today's and tomorrow's posts
   come from what is trending now, and last week's trends fill the later dates in the Topic Queue.
   Only this run's topics are re-dated. A written post or a person's placement never moves.
10. **Future topics sit in the Topic Queue.** Each row shows its date, topic, platform, content
    pillar, source/trend, validation status and a `Generate Post` action. Its title, date and
    platform are editable, and editing never writes a post. The queue can be reordered: its dates are
    handed out again in the new order, so moving a topic up gives it an earlier date. Only topics
    with no post can be reordered.
11. **Generate Post writes one topic's post, and only that topic's.** It produces the complete post
    for the selected topic through the Caption and Image agents. A topic that already has a post is
    returned untouched. A post is rewritten only when regeneration is explicitly requested.
12. **Validation and publishing are unchanged.** A generated post enters the same review, two-stage
    approval and publishing flow as any other.

## Boundaries

- **Never writes a caption or renders an image itself.** It produces the brief. The Caption and
  Image agents produce the post, and only for post-ready dates or on Generate Post.
- **Never generates a post for a date past the post-ready horizon on its own.** Future dates hold
  the validated topic only, until a person presses Generate Post.
- **Never regenerates an existing post unless explicitly asked.** Pressing Generate Post twice
  must not replace a written or reviewed caption.
- **Never keeps a suggestion list.** No idea is created as, moved to, or returned as a suggestion.
- **Never approves or publishes anything.** Placement is not permission.
- **Never places two posts in the same platform-slot.** Conflicts are detected and resolved before
  output, not left for the operator to find.
- **Never invents a date outside the configured planning horizon.**
- **Never places more topics than the per-platform cap**, whatever the priority score.
- **Never withdraws a written or reviewed post** to make room, and never withdraws silently. Every
  withdrawal records its reason.
- **Never overwrites a human's manual placement** on a subsequent run.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| More ideas than slots | Rank, fill the cap, leave the rest unplaced and report how many and the cut-off. Never truncate silently |
| A post-ready topic cannot be written | Report the failure against that topic; it keeps its date as a topic with its Generate Post, and the run does not fail |
| Tomorrow is not a posting day | Tomorrow's topic, if any, stays a topic; nothing is written ahead |
| Generate Post on a topic that already has a post | Return the existing post unchanged and say so; rewrite only on an explicit regenerate |
| No posting hour clears the window | Place at the window's best hour and say the window was the constraint |
| A platform has zero validated signal | Produce no topics for it and report why, rather than padding |
| Two ideas tie on priority | Break on trend score, then on recency; the reason names the tiebreak |

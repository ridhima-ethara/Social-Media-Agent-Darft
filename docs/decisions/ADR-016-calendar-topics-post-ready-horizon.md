# ADR-016 — The calendar holds topics; only today and tomorrow get a post; there is no suggestion list

**Status:** Accepted · **Date:** 2026-09-23 · **Supersedes:** the "More suggestions" tier and the `autoWriteWeeks` knob

## Context

The Calendar Agent used to rank every idea. The top `topPerPlatform` per platform per week took a date and the rest waited in a "More suggestions" list. Then the pipeline wrote and illustrated every placed post in the first `autoWriteWeeks` weeks, which meant a whole week of captions and creatives up front. Later runs routinely displaced many of those posts, so two model calls per post were spent on work that was thrown away. The operator asked for a different flow:

```
Validated topics → Calendar Agent
  → Today:        post ready
  → Tomorrow:     post ready, only if the posting schedule requires it
  → Future dates: topic only → Topic Queue → Generate Post on demand
```

The operator also asked for the suggestion section to be removed completely, from the screen and from the API.

## Decision

1. **The post-ready horizon is one shared rule**, `shared/calendar-horizon.ts`, imported by both tiers:
   - today is always post-ready;
   - tomorrow is post-ready only under `postReadyHorizon = today-and-tomorrow` (the default) **and** when tomorrow is a posting day (`calendar.slot.optimize.avoidWeekends`);
   - every later date is topic-only.

   The server resolves the horizon for the workspace (`server/src/calendar-horizon.ts`, workspace time zone) and sends it as `calendarHorizon` on `/api/state`, so the screen never computes its own "today". The Python tier applies the same rule through `post_ready_dates()`.
2. **Writing a week is replaced by writing what is due.** The orchestrator's final stage (`writeCalendarBacklog`) writes and illustrates only topics with no post on post-ready dates, capped by `maxAutoWrites`. It counts the rest as `topicsQueued` in the run summary. The `autoWriteWeeks` knob is replaced by the `postReadyHorizon` enum.
3. **There is no suggestion list.**
   - `calendar.rank.select` places the top `topPerPlatform` × planning weeks per platform as dated topics. An idea from the run ranked below the cut-off is not placed and not stored; the run reports how many and the cut-off.
   - A stored topic with no post that stronger ones displace is **withdrawn** (status `rejected`, with the rank and cut-off recorded as the reason). It is never deleted.
   - The assistant tools `idea.promote` and `idea.demote`, the `slot` filter on `idea.list` and `GET /ideas`, the PATCH `calendarSlot` field and its demotion logic, and the store actions `promoteIdea`, `scheduleIdeaOnDay`, `demoteIdea` and `duplicateIdea` are all removed.
   - `calendar_slot` keeps its column and its `'suggestion'` value only for legacy rows. A one-off, idempotent migration in `schema.sql` withdraws every unplaced legacy suggestion with a reason, and moves any legacy suggestion that already had a post onto the calendar.
4. **The Topic Queue** sits below the week on the Calendar page and on the Dashboard. It lists every placed topic that has no post and is dated after the horizon. Each row shows:
   - date, topic, platform;
   - content pillar (computed by `shared/content-pillars.ts` from the brand domains);
   - source/trend;
   - validation status (the Validation Agent's verdict on the source post, joined as `source_validation`);
   - a **Generate Post** action.

   The title, date and platform are editable, and editing never writes a post. Reordering (`POST /api/calendar/topic-queue/order`) hands the queue's own dates out again in the new order.
5. **Generate Post** (`POST /api/ideas/:id/generate-post`, `generatePostForTopic()`, and the assistant's `draft.generate`) writes the complete post (caption, hashtags and creative) for that one topic. If the topic already has a post, that post is returned untouched unless `regenerate: true` is sent. Opening a topic's card no longer writes a post behind the operator's back: `ensureDraft` and `ensureImage` skip queued topics, and the review panel offers Generate Post instead.
6. **The Validation Agent and the review, approval and publishing flow are unchanged.** A generated post enters them like any other.

## Consequences

- A run writes at most today's and tomorrow's posts, so it is shorter and cheaper. Future dates show topic cards ("TOPIC · IN QUEUE") instead of written posts.
- Posts already written for future dates by earlier releases stay as posts. Nothing is regenerated.
- The migration withdrew every legacy unplaced suggestion. Their rows and reasons remain in `content_ideas`.

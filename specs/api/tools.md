<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# The tool registry

The command plane acts only through these. There is no path from an utterance to the database that does not pass through this registry, and `auditToolCoverage()` fails at boot if a declared tool has no handler.

## `safe` (17)

### `state.read` — Read the situation

The current state of everything: counts, queues, agent states and today’s schedule.

- **Agent:** `null`
- **Returns:** A snapshot of counts, queues, agent states and the schedule for today.
- **Routes from:** "what is the state of everything" · "give me a status report" · "where are we" · "what is happening right now" · "brief me"

### `agent.status` — Agent status

Per-agent state, last run and success rate.

- **Agent:** `null`
- **Returns:** Each agent with its status, current task, last run time and success rate.
- **Routes from:** "how are the agents doing" · "agent status" · "is anything failing" · "what is the validation agent doing" · "show me agent health"

### `run.explain` — Explain a past run

Reconstructs what a past run did and the exact resolved settings it used.

- **Agent:** `null`
- **Returns:** The run, its skills, and the resolved config each one actually used.
- **Routes from:** "explain the last run" · "what settings did that run use" · "why did that run behave that way" · "show me the config for the last pipeline"

### `lineage.trace` — Trace lineage

Follows any object back to the source item it came from, and forward to what it became.

- **Agent:** `null`
- **Returns:** The chain of objects backward to the source and forward to everything derived from it.
- **Routes from:** "where did this post come from" · "trace this idea back to its source" · "why was #GenAI rejected" · "show me the lineage of this hashtag" · "what did this keyword produce"

### `pipeline.status` — Pipeline status

The current or most recent run, with progress for each agent.

- **Agent:** `null`
- **Returns:** The run status, its stage, and per-agent progress and counts.
- **Routes from:** "is the pipeline running" · "pipeline status" · "how far along is the run" · "what did the last run do"

### `keyword.list` — List keywords

The keyword set with weights, categories and whether each is active.

- **Agent:** `scraping`
- **Returns:** Every keyword with its category, weight and active flag.
- **Routes from:** "list the keywords" · "what keywords are we tracking" · "show me the keyword set" · "which keywords are active"

### `keyword.trending` — Trending keywords

The current trending set with each score and the reason behind it.

- **Agent:** `validation`
- **Returns:** The trending keywords with trend scores, component scores and a plain-language reason each.
- **Routes from:** "what is trending this week" · "what is trending" · "show me the trending keywords" · "which keywords are hot" · "find the strongest trend this week"

### `hashtag.list` — List hashtags

Ranked hashtags, filterable by verdict or by the keyword that surfaced them.

- **Agent:** `validation`
- **Returns:** Hashtags with their scores, verdicts and reasons.
- **Routes from:** "list the hashtags" · "show me the validated hashtags" · "which hashtags need review" · "what hashtags came from agentic AI"

### `hashtag.top` — The consolidated top set

The global top hashtag set the research build works from.

- **Agent:** `validation`
- **Returns:** The consolidated hashtag set in rank order, with scores and research timestamps.
- **Routes from:** "show me the top 25 hashtags" · "what is the consolidated hashtag set" · "top hashtags" · "which hashtags will be researched"

### `review.queue.list` — The review queue

Everything waiting on a human verdict, with the reason and the decision being asked.

- **Agent:** `validation`
- **Returns:** Queue rows with the item, the reason naming evidence, and the available answers.
- **Routes from:** "what is waiting on me" · "show me everything waiting on me" · "what needs my attention" · "show me the review queue" · "what needs a verdict"

### `knowledge.search` — Search the Knowledge Base

Searches active entries and returns them with their citations.

- **Agent:** `knowledge`
- **Returns:** Matching entries with their content, confidence and cited sources.
- **Routes from:** "what do we know about reward modeling" · "search the knowledge base for RLHF" · "what does the knowledge base say about agentic AI" · "do we have anything on synthetic data"

### `idea.list` — List ideas

The calendar and the ranked suggestions beneath it.

- **Agent:** `calendar`
- **Returns:** Ideas with their platform, slot, date, time, rank, confidence and status.
- **Routes from:** "what is on the calendar" · "show me this week" · "what is scheduled for thursday" · "list the linkedin posts this week" · "what is pending leadership" · "show me the suggestions"

### `brand.check` — Check brand compliance

Runs the twenty-rule compliance check on any text and reports the verdict with its evidence.

- **Agent:** `review`
- **Returns:** The verdict, the per-dimension results and every violated rule with its required action.
- **Routes from:** "check this against the brand rules" · "run a brand check" · "does this pass compliance" · "is this on brand"

### `analytics.query` — Query analytics

Any figure for any platform and month, with the source it came from.

- **Agent:** `analytics`
- **Returns:** The requested figures, and whether the platform has actually reported the period.
- **Routes from:** "what was linkedin reach last month" · "how did instagram do in august" · "show me the engagement rate" · "what are our numbers this month"

### `analytics.compare` — Compare periods

Period over period against this account’s own baseline, never an industry benchmark.

- **Agent:** `analytics`
- **Returns:** The change against the prior period and against the trailing baseline, with where it is concentrated.
- **Routes from:** "why did instagram drop last month" · "compare this month to last month" · "how does august compare to july" · "is linkedin up or down"

### `post.explain` — Explain a post

Why a published post performed the way it did, against our own baseline.

- **Agent:** `analytics`
- **Returns:** The post’s figures against baseline, the contributing factors and a recommendation.
- **Routes from:** "why did tuesday's post beat thursday's" · "why did that post do well" · "explain that post" · "what happened with that post"

### `report.export` — Export a report

CSV or JSON of any analytics view.

- **Agent:** `analytics`
- **Returns:** The export payload and its filename.
- **Routes from:** "export the analytics" · "download the report as csv" · "give me a json export of august"

## `mutating` (17)

### `pipeline.run` — Run discovery

Runs the discovery pipeline end to end: scrape, validate, analyse and plan.

- **Agent:** `scraping`
- **Returns:** The run summary: keywords scanned, posts scraped, trending keywords, verdict buckets, the top hashtag set and the ideas created.
- **Routes from:** "run the pipeline" · "run discovery" · "start the pipeline" · "kick off a discovery run" · "run discovery on the top five keywords" · "scrape linkedin now" · "fire the pipeline"

### `keyword.add` — Add a keyword

Adds a term to the keyword set at a given weight.

- **Agent:** `scraping`
- **Returns:** The keyword that was created, with its assigned weight and category.
- **Routes from:** "add 'inference economics' as a keyword at weight 70" · "add a keyword" · "track inference economics" · "start tracking reward hacking"

### `keyword.update` — Update a keyword

Changes a keyword’s weight, category or active state.

- **Agent:** `scraping`
- **Returns:** The updated keyword.
- **Routes from:** "set RLHF weight to 80" · "deactivate synthetic data" · "turn off the AI agents keyword" · "raise agentic AI to 100"

### `hashtag.verdict.set` — Resolve a hashtag verdict

Sets the verdict on a hashtag waiting for review, and closes its queue row.

- **Agent:** `validation`
- **Returns:** The hashtag with its new verdict, and the queue row that was resolved.
- **Routes from:** "approve #RewardModeling" · "reject #GenAI" · "validate the RLHF hashtag" · "mark #AIAgents as validated"

### `review.resolve` — Resolve a queue item

Records the outcome on a review queue row.

- **Agent:** `validation`
- **Returns:** The resolved queue row and whatever it changed downstream.
- **Routes from:** "resolve that queue item" · "approve the first item in the queue" · "clear the review queue item"

### `knowledge.build` — Rebuild the Knowledge Base

Runs the research build now, researching the top hashtags against the live web.

- **Agent:** `knowledge`
- **Returns:** The build record: hashtags researched, entries written and merged, sources cited.
- **Routes from:** "rebuild the knowledge base" · "run the research build" · "research the top hashtags now" · "refresh the knowledge base"

### `knowledge.add` — Add a knowledge entry

Writes an entry to the Knowledge Base by hand.

- **Agent:** `knowledge`
- **Returns:** The entry that was written.
- **Routes from:** "add a knowledge entry" · "remember that we prefer shorter hooks" · "save this to the knowledge base"

### `knowledge.toggle` — Switch an entry on or off

Deactivates or reactivates an entry. Nothing is ever deleted.

- **Agent:** `knowledge`
- **Returns:** The entry with its new active state.
- **Routes from:** "switch off that knowledge entry" · "deactivate that entry" · "turn that knowledge entry back on"

### `idea.move` — Move an idea

Changes an idea’s date, time or platform.

- **Agent:** `calendar`
- **Returns:** The idea in its new slot.
- **Routes from:** "move that to thursday morning" · "reschedule the carousel to tuesday" · "put it on thursday at 9am" · "move that post to instagram"

### `idea.promote` — Promote to the calendar

Gives a suggestion a calendar slot, demoting the lowest-ranked primary if the platform is full.

- **Agent:** `calendar`
- **Returns:** The promoted idea, and whatever was demoted to make room.
- **Routes from:** "promote that suggestion to the calendar" · "put that on the calendar" · "promote the reward modeling idea"

### `idea.demote` — Demote to suggestions

Takes an idea off the calendar and returns it to the ranked suggestions.

- **Agent:** `calendar`
- **Returns:** The idea, now a suggestion.
- **Routes from:** "take that off the calendar" · "demote that to suggestions" · "move that back to suggestions"

### `draft.generate` — Write a draft

Writes the caption for an idea, grounded in the Knowledge Base, and renders its creative.

- **Agent:** `caption`
- **Returns:** The draft body, the rendered creative and the brand compliance verdict.
- **Routes from:** "draft thursday's linkedin post" · "write the draft for that idea" · "generate the caption" · "draft thursday's linkedin post and show me the creative" · "write that post"

### `draft.instruct` — Revise a draft

Applies an instruction to a draft. A human instruction outranks a brand guideline, and the finding is raised alongside the edit.

- **Agent:** `review`
- **Returns:** The revised draft, the compliance findings, and any preference worth remembering.
- **Routes from:** "make it shorter and more CTO-focused" · "make it shorter" · "rewrite that with a stronger hook" · "tighten the opening" · "change the tone"

### `image.render` — Render the creative

Renders or re-renders the picture for a post on the right canvas for its platform.

- **Agent:** `image`
- **Returns:** The rendered asset with its canvas, model, alt text and any fallback reason.
- **Routes from:** "render the image" · "re-render the creative" · "make the image brighter" · "show me the creative for that post"

### `idea.approve.marketing` — Marketing approval

The first of two approvals. Sends the post to Leadership.

- **Agent:** `review`
- **Returns:** The idea, now awaiting Leadership.
- **Routes from:** "approve that for leadership" · "give marketing approval" · "send that to leadership" · "approve it"

### `idea.reject.leadership` — Leadership rejection

Rejects a post with a reason. The reason is mandatory — it is what the agents learn from.

- **Agent:** `review`
- **Returns:** The rejected idea and the Knowledge Base entry written from the reason.
- **Routes from:** "reject that post" · "reject it, the tone is too promotional" · "turn that down and say why"

### `skill.configure` — Change a setting

Changes a knob on a skill. Refuses to disable a critical skill.

- **Agent:** `null`
- **Returns:** The skill with its new resolved configuration.
- **Routes from:** "set the top keywords to 8" · "change the trending keyword count" · "turn off competitor tracking" · "raise the hashtag count to 30"

## `irreversible` (2)

### `idea.approve.leadership` — Leadership approval

The final approval. Publishes immediately when auto-publish is on, which cannot be undone.

- **Agent:** `publishing`
- **Returns:** The approved idea and, when auto-publish is on, the published receipt.
- **Confirmation:** This gives final approval to "{title}" and publishes it to {platform} immediately. Publishing cannot be undone.
- **Routes from:** "give final approval" · "approve and publish" · "leadership approve that post" · "sign it off"

### `idea.publish` — Publish now

Publishes a post to its platform immediately. This is the one irreversible act in the system.

- **Agent:** `publishing`
- **Returns:** The publish receipt with the external id, the mode and the first metrics reading.
- **Confirmation:** This publishes "{title}" to {platform} immediately. Publishing cannot be undone.
- **Routes from:** "publish it" · "publish that post" · "send it live" · "ship it" · "post it now"

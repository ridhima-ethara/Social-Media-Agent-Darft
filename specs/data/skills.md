<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->

# Skill index

Every skill id below is a **storage key**, written into `skill_runs.skill_id`. Renaming one orphans history, so ids are never renamed.

| Skill id | Agent | Order | Critical | Knobs |
|---|---|---|---|---|
| `assistant.context.assemble` | assistant | 1 | yes | 3 |
| `assistant.intent.parse` | assistant | 2 | yes | 4 |
| `assistant.plan.compose` | assistant | 3 | yes | 3 |
| `assistant.confirm.gate` | assistant | 4 | yes | 2 |
| `assistant.tool.dispatch` | assistant | 5 | yes | 3 |
| `assistant.narrate.stream` | assistant | 6 | yes | 3 |
| `assistant.result.verify` | assistant | 7 |  | 2 |
| `assistant.memory.write` | assistant | 8 | yes | 2 |
| `assistant.brief.compose` | assistant | 9 |  | 2 |
| `assistant.anomaly.watch` | assistant | 10 |  | 4 |
| `assistant.voice.transcribe` | assistant | 11 |  | 2 |
| `assistant.handoff.route` | assistant | 12 | yes | 1 |
| `scraping.keyword.resolve` | scraping | 1 | yes | 3 |
| `scraping.source.connect` | scraping | 2 | yes | 2 |
| `scraping.linkedin.fetch` | scraping | 3 | yes | 5 |
| `scraping.hashtag.harvest` | scraping | 4 | yes | 3 |
| `scraping.hashtag.expand` | scraping | 5 |  | 3 |
| `scraping.engagement.capture` | scraping | 6 |  | 2 |
| `scraping.competitor.track` | scraping | 7 |  | 2 |
| `scraping.dedupe.prefilter` | scraping | 8 |  | 1 |
| `validation.keyword.trend` | validation | 1 | yes | 7 |
| `validation.hashtag.rank` | validation | 2 | yes | 2 |
| `validation.credibility.score` | validation | 3 | yes | 2 |
| `validation.relevance.score` | validation | 4 | yes | 3 |
| `validation.freshness.score` | validation | 5 |  | 1 |
| `validation.duplicate.detect` | validation | 6 | yes | 4 |
| `validation.verdict.route` | validation | 7 | yes | 2 |
| `validation.review.queue` | validation | 8 |  | 1 |
| `analysis.trend.cluster` | analysis | 1 | yes | 3 |
| `analysis.brand.fit` | analysis | 2 | yes | 2 |
| `analysis.engagement.predict` | analysis | 3 |  | 2 |
| `analysis.format.recommend` | analysis | 4 |  | 2 |
| `analysis.angle.propose` | analysis | 5 |  | 2 |
| `analysis.competitor.compare` | analysis | 6 |  | 2 |
| `analysis.hashtag.consolidate` | analysis | 7 | yes | 3 |
| `analysis.recommendation.explain` | analysis | 8 | yes | 2 |
| `calendar.idea.form` | calendar | 1 | yes | 3 |
| `calendar.idea.dedupe` | calendar | 2 |  | 2 |
| `calendar.slot.optimize` | calendar | 3 | yes | 5 |
| `calendar.platform.select` | calendar | 4 | yes | 2 |
| `calendar.cadence.balance` | calendar | 5 |  | 3 |
| `calendar.conflict.detect` | calendar | 6 |  | 2 |
| `calendar.crossplatform.adapt` | calendar | 7 |  | 3 |
| `calendar.rank.select` | calendar | 8 | yes | 5 |
| `generation.caption.mode` | caption | 1 | yes | 2 |
| `generation.caption.voice` | caption | 2 | yes | 3 |
| `generation.caption.hook` | caption | 3 | yes | 3 |
| `generation.caption.problem` | caption | 4 | yes | 2 |
| `generation.caption.explanation` | caption | 5 | yes | 4 |
| `generation.caption.close` | caption | 6 | yes | 2 |
| `generation.caption.hashtags` | caption | 7 |  | 2 |
| `generation.caption.adapt` | caption | 8 | yes | 5 |
| `generation.caption.variants` | caption | 9 |  | 2 |
| `generation.caption.sourceLink` | caption | 10 |  | 2 |
| `generation.image.approach` | image | 1 | yes | 2 |
| `generation.image.reference` | image | 2 |  | 2 |
| `generation.image.template` | image | 3 |  | 3 |
| `generation.image.tokens` | image | 4 | yes | 3 |
| `generation.image.render` | image | 5 | yes | 4 |
| `generation.image.export` | image | 6 |  | 2 |
| `generation.image.altText` | image | 7 | yes | 2 |
| `generation.image.reviewGate` | image | 8 | yes | 2 |
| `generation.image.video.compose` | image | 9 |  | 2 |
| `review.instruction.apply` | review | 1 | yes | 3 |
| `review.compliance.check` | review | 2 | yes | 3 |
| `review.preference.extract` | review | 3 |  | 3 |
| `review.diff.summarize` | review | 4 |  | 1 |
| `knowledge.hashtag.select` | knowledge | 1 | yes | 3 |
| `knowledge.research.search` | knowledge | 2 | yes | 5 |
| `knowledge.research.extract` | knowledge | 3 | yes | 3 |
| `knowledge.entry.upsert` | knowledge | 4 | yes | 2 |
| `knowledge.entry.retrieve` | knowledge | 5 | yes | 2 |
| `knowledge.entry.rank` | knowledge | 6 |  | 1 |
| `knowledge.conflict.resolve` | knowledge | 7 |  | 2 |
| `knowledge.priority.tag` | knowledge | 8 |  | 2 |
| `publishing.format.validate` | publishing | 1 | yes | 2 |
| `publishing.media.upload` | publishing | 2 |  | 2 |
| `publishing.post.dispatch` | publishing | 3 | yes | 2 |
| `publishing.receipt.record` | publishing | 4 | yes | 2 |
| `analytics.metrics.ingest` | analytics | 1 | yes | 2 |
| `analytics.metrics.reconcile` | analytics | 2 | yes | 2 |
| `analytics.baseline.compute` | analytics | 3 | yes | 3 |
| `analytics.sentiment.classify` | analytics | 4 |  | 2 |
| `analytics.period.compare` | analytics | 5 | yes | 2 |
| `analytics.post.explain` | analytics | 6 | yes | 3 |
| `analytics.report.compose` | analytics | 7 |  | 2 |
| `analytics.export.build` | analytics | 8 |  | 2 |
| `learning.pattern.detect` | learning | 1 | yes | 3 |
| `learning.knowledge.write` | learning | 2 | yes | 2 |
| `learning.confidence.promote` | learning | 3 |  | 1 |
| `learning.confidence.demote` | learning | 4 | yes | 2 |

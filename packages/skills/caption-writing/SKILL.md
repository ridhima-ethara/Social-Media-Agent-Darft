# Caption Writing

## Purpose

Write technical, research-grounded, platform-specific captions for Ethara.AI — reinforcement
learning, agentic AI and AGI infrastructure — for a mixed technical and strategic B2B audience.

Always produce distinct per-platform variants. Never reuse one caption across channels.

Brand voice and compliance are applied through [`brand-voice`](../brand-voice/SKILL.md) rather than
redefined here. This skill governs how a caption is **built**; that skill governs whether it may ship.

## Audience and positioning

Write for business leaders and informed non-specialists as well as practitioners. Use the supplied
knowledge base to connect the topic to reinforcement learning, agentic AI and AGI infrastructure.

Ethara.AI positions itself as **Reinforcement Learning as a Service for AGI**. That is positioning,
not evidence: **do not infer specific products, customers, deployments or results from it.** Include
an Ethara connection only where it is directly supported and useful.

Prefer an informed, precise, professional voice. Show why a topic matters through its mechanism or
practical implication. Avoid generic AI commentary and forced sales language.

## Language modes

**Normal** — explain the idea in accessible language. Define necessary terms, use a concrete example,
and preserve every qualification and technical meaning. Simplifies the language, never the argument.

**Technical** — explain the mechanism with relevant terminology, conditions and limitations. Use
specific concepts only where the sources support them. Expand an uncommon acronym once. Keep the same
short-line layout: technical does not mean dense.

The factual thesis is identical in both. Only the expression changes.

## Inputs

- The `CalendarEntry` being written for, and the shared CoreContext
- Active knowledge entries retrieved for its topic — **these are the grounding, not decoration**
- Cited Knowledge Base `key_points`, and supporting research sources when research is used
- The brand definition: voice words, caption structure, forbidden language, hashtag range
- The target platform or platforms
- Previously published captions, for the similarity cap
- The resolved configuration for this run

## Outputs

`CaptionOptions` conforming to `caption-options.schema.json`: `body`, `hook`, `hashtags[]`,
`groundedIn[]` (the entry ids the claims rest on), `source` (`live` or `fixture`), `fallbackReason`,
and `variants[]` when variant generation is enabled.

Output passes to `brand-voice` for compliance review.

## Rules

1. **One primary insight, from the cited `key_points`.** Extract it before writing. Do not summarise
   the whole source, and never broaden a claim beyond what the evidence supports. Every factual claim
   traces to an entry listed in `groundedIn`; a claim with no entry behind it is removed, not softened.

2. **The hook is written after the central claim is identified**, never before, and stays within the
   configured word budget.

   - Create tension through a real limitation, trade-off, overlooked consequence or assumption the
     post then examines. A provocative or negative opening is permitted, not required.
   - Name or clearly signal the actual topic. A hook that could introduce almost any AI post is too
     generic and is rewritten.
   - Keep its strength inside the evidence. Do not turn "can" into "will", a limited finding into a
     universal rule, or a prediction into a fact.
   - A question hook begins receiving its answer within the next one to three body lines. A
     provocative hook has its premise explained and supported early.
   - No fabricated urgency, fear, sensational promise, insult, unsupported percentage or exaggerated
     failure claim.

   Rotate approaches across options and across recent posts. Finding, industry-shift and prediction
   hooks are used only where the source supports them.

3. **Short connected lines, not paragraph blocks.**

   - One short sentence or one complete thought per authored line, with a blank line between thoughts.
   - Roughly 6–18 words per sentence where natural — guidance, not a reason to distort a technical
     explanation.
   - Do not break a long paragraph at arbitrary points and call it short-line writing; rewrite long
     sentences into clear complete ideas.
   - Do not split every phrase into a fragment either. Preserve flow with natural transitions and
     explicit links between ideas.
   - Publishable copy is plain text: no `Hook`/`Body`/`CTA` labels, no Markdown bold markers, and no
     decorative Unicode fonts. A short list is acceptable when the topic genuinely involves steps or
     criteria.

   Length comes from useful explanation, example and implication — never from repeated claims.

4. **The narrative order is preserved in both language modes:**

   hook → context/problem → explanation or mechanism → evidence/example → implication →
   optional Ethara connection → close

   Combine or omit stages that add no value. Do not force every stage into every caption.

5. **Every line earns its place.** Each must explain, substantiate or advance the central insight.
   Remove any line that could be pasted into an unrelated post. Use the keyword naturally rather than
   repeating it for search visibility. Include a concrete mechanism or example where the context
   supports one, and **label hypotheticals as examples** — never as Ethara deployments or measured
   results. When research is used, retain its qualifications, scope and attribution, and keep the
   source's finding separate from Ethara's interpretation.

6. **Length targets, excluding hashtags:** LinkedIn 150–230 words; Instagram and Facebook 100–180.
   These are editorial defaults, not platform limits. Shorten when the evidence cannot support useful
   depth. Honour explicit length requests and the application's configured platform limits.

7. **The close is exactly one meaningful ending** — one relevant question, or one concluding thought.
   It must follow from the body, return to the central issue, and give the audience something
   concrete to consider.

   - A question asks about an experience, decision, trade-off or evaluation criterion. Prefer one
     focused question over several.
   - A concluding thought states a specific implication that invites reflection, not a slogan or an
     unsupported prediction.
   - Never `Thoughts?`, `Agree?`, `Comment YES`, `Tag someone`, or an unrelated sales request. Never
     ask readers to disclose confidential organisational information.

8. **5 to 7 hashtags on every caption option**, clamped to the brand's declared range.

   Derived from the actual subject, mechanism and application. `#EtharaAI` when appropriate — it
   counts toward the total and is not required on every post. Placed together on the final line,
   separated from the prose by a blank line, never inside a sentence. No unrelated trending tags, no
   engagement bait such as `#Viral`, no duplicates, no fixed reused block. `#AGI` only when the post
   substantively discusses it.

   The set is regenerated per topic. This replaces the former 3–5 rule everywhere, including output
   validation.

9. **The platform changes the copy, not just the label.** `PLATFORM_VOICE` in
   `shared/brand-voice.ts` declares the register, structure, opening and prohibitions for each of the
   four platforms, and `platformVoiceInstruction()` is the only renderer of it. It is injected into
   every generation and every rewrite.

   - **LinkedIn** — more developed explanation and professional implications.
   - **Instagram** — tighter opening and faster pacing, retaining short-line substance.
   - **Facebook** — accessible language and practical context.
   - **X** — most compressed; a thread when the idea requires the space, with the hashtags on the
     final post.

   The factual thesis stays identical across platforms; its expression changes. **Moving a post to
   another platform re-writes it**: changing the platform in the review panel regenerates the draft
   and the creative, because copy carried across unchanged is copy written for somewhere else.

   Where CoreContext explicitly configures shared Instagram/Facebook cross-posting, produce one
   caption identified for both platforms rather than manufacturing a second version.

10. **2–3 materially different options per platform treatment**, differing in angle *and* structure —
    framing, explanation sequence or examples, never synonym swaps or superficial rewriting.

11. **Similarity is computed, never judged.** Above the caption cap of `0.70`, the draft is
    regenerated with a different angle. The model is never asked to estimate how similar something is.

12. **Brand-voice enforcement runs unconditionally as the final step**, whatever produced the text —
    a model, a template, or a human edit. There is no path that skips it. The emoji budget is zero and
    no setting may raise it; enforcement strips rather than warns.

13. **When the language model is unconfigured, the deterministic template writer runs instead** and
    the output is stamped `fixture` with the env key that would enable the model. The output shape is
    identical, so nothing downstream branches on which produced it.

## Examples

Editorial illustrations, **not** approved factual claims and not an opening bank. Rotate approaches;
never reuse one of these verbatim as a hook.

### Hook patterns that work

**Provocative — evaluation:** "A correct answer can still hide an unreliable AI agent."
Use when the body explains process errors or missed constraints.

**Question — rubrics:** "How do you measure AI quality when accuracy is only one requirement?"
Follow with the dimensions a rubric evaluates.

**Problem — reward design:** "An AI agent can improve its reward score without improving the outcome
you care about." Use only with evidence, or an explicitly hypothetical example of reward mismatch.

**Counterintuitive — testing:** "The most useful AI evaluation may be the one your model fails."
Explain what a relevant failure reveals; do not glorify failure without a reason.

**Definition with stakes — RL environments:** "An RL environment defines the situations an agent gets
to learn from." Develop the consequence of what the environment includes or leaves out.

Further illustrations, by register:

- *Benchmarks and evaluation* — "An easy benchmark can become an expensive source of confidence."
  · "A leaderboard position is not a deployment guarantee."
  · "If you only measure the final answer, what failures are you missing?"
- *Long-horizon agents* — "Writing the patch is not the same as shipping the change."
  · "A correct action can still belong to a failing plan."
  · "The first ten steps looked intelligent. The next ten exposed the problem."
- *Consequence-led* — "The task failed long before the agent noticed."
  · "An agent that cannot recognise failure can keep building on it."
- *Training environments* — "A poorly specified reward can make the wrong behaviour look like progress."
  · "What your training environment overlooks, deployment may expose."

### Reject and rewrite

| Reject | Why | Rewrite |
|---|---|---|
| "AI is changing everything." | No specific topic or insight | "What happens when an AI agent completes a task but ignores its constraints?" |
| "Your AI strategy is doomed." | Unsupported fear, no mechanism | "A successful demo leaves an important question: what happens when the workflow changes?" |

### Closes that work

**Evaluation:** "Which failure would your evaluation miss if it checked only the final answer?"
**Reward design:** "What would you measure alongside reward to check whether an agent is actually
improving?"
**RL environments:** "Which workflow variation would you test before trusting an agent with the full
task?"
**Concluding thought:** "The criteria we choose determine which failures remain invisible."

To invite real experience: "What's a task your agent handled well in testing but struggled with in
practice?" · "Where do you still find yourself stepping in to rescue an agent?"

To engage researchers: "Which failure modes become visible only when you extend the task horizon?"
· "What evidence would change your mind about this approach?"

### Pairing the hook to the close

| Hook | Matching close |
|---|---|
| "Stop calling it reliable because it worked once." | "What evidence would you require before calling an agent reliable?" |
| "Writing the patch is not the same as shipping the change." | "What must a coding agent demonstrate beyond passing tests?" |
| "Your agent found a shortcut. Unfortunately, it bypassed the task." | "What's the most unexpected shortcut you've seen a model take?" |
| "The task failed long before the agent noticed." | "How do you evaluate whether an agent can recognise and recover from failure?" |

### Hashtags

A rubric post might carry: `#AIEvaluation #EvaluationRubrics #AgenticAI #AIQuality #MachineLearning
#EtharaAI` — six tags, each derived from the subject or its mechanism. Regenerate per topic; this is
not a default set.

## Avoid

Dense paragraphs. Disconnected slogans. Repeated conclusions. Jargon inserted to sound technical.
Generic filler such as "in today's fast-paced world", "unlock endless possibilities" or "revolutionise
everything". Zero emojis, no superlatives, no motivational clichés.

Decorative Unicode letterforms — mathematical bold, script or monospace glyphs used as fake bold — are
prohibited even where a competitor or a reference caption uses them. They defeat screen readers and
break search indexing, and the platform's plain-text rule outranks any example that contains them.

## Boundaries

The Caption Writing skill **must not**:

- Broaden a claim beyond what the cited evidence supports.
- Summarise an entire research source when one primary insight should drive the post.
- Select a hook before identifying the central claim.
- Force an Ethara connection where it is not genuinely relevant, or infer a product, customer or
  result from the company's positioning line.
- Use generic engagement bait as the close.
- Use a fixed reusable hashtag set instead of topic-derived tags.
- Reuse one caption across platforms, or produce variants that change the factual thesis.
- Produce options differing only by synonym, or with similarity above `0.70`.
- Replace the `brand-voice` compliance layer.
- **State a number that is not in a cited entry** — no invented benchmarks, percentages, dates,
  customer counts or internal results.
- **Mention unannounced funding, partnerships, customers, hires, unpublished figures, legal positions
  or competitor comparisons.** Any hit forces internal approval, which outranks every other verdict.
- Use the forbidden promotional register, including "excited to announce" and its family.
- Exceed the hashtag ceiling, whatever a human instruction asks — the instruction is applied
  everywhere else and the violation is raised as a finding.
- Publish, approve, or change a status.
- Silently correct a human edit. It reports and offers.
- Treat a missing metric as zero when writing about performance.

## Acceptance checks

- The hook is specific, supported, and fulfilled by the body; a question hook is answered early.
- The body uses short connected thoughts — no dense paragraphs, arbitrary fragments or filler.
- The language mode is honoured without changing the thesis or dropping qualifications.
- The final prose line is one relevant question or one concluding thought.
- There are **5–7 unique, relevant hashtags** on a separate final line.
- Claims match the cited `key_points`; research sources are retained; hypotheticals are clearly framed.
- No invented Ethara products, results, clients or capabilities, and no forced brand connection.
- Platform treatments and option angles are distinct, except for an explicitly configured cross-post.
- No decorative Unicode letterforms and no Markdown bold in publishable copy.

## Failure modes

| Situation | Correct behaviour |
|---|---|
| No knowledge entry matches the topic | Write the structural caption with no factual claims and report the ungrounded state |
| The model returns text with an emoji | Enforcement strips it; the finding is recorded |
| Similarity exceeds the cap twice | Report that the angle is exhausted rather than shipping a near-duplicate |
| A human instruction conflicts with a brand rule | Apply the instruction, raise the finding alongside it |
| The hook could introduce any AI post | Rewrite it against the central claim; do not ship a generic opening |
| Fewer than 5 topic-derived hashtags are available | Derive from the mechanism and application before falling back; never pad with generic tags |
| The evidence cannot support the length target | Publish shorter. The target yields to the evidence, never the reverse |
| A reference caption uses Unicode bold | Follow the rule, not the reference. Write plain text |

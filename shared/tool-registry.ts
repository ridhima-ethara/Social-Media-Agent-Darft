/**
 * THE TOOL REGISTRY — the command plane's entire surface of action.
 *
 * There is no path from an utterance to the database that does not pass through
 * this file. Every tool declares its risk class, its argument schema and the
 * example utterances that route to it — and those examples are also the grammar
 * the deterministic parser is built from, so the parser can never drift out of
 * sync with what the tools actually accept.
 *
 * `auditToolCoverage()` at boot fails if any declared tool has no handler.
 */

import { z } from 'zod'
import type { AgentId } from './agent-contract'
import { PLATFORMS, VALIDATION_VERDICTS } from './agent-contract'
// The catalogue, not a copy of it — see IMAGE_MODEL_IDS.
import { IMAGE_MODEL_IDS } from './image-models'

/**
 * safe         — may be called freely, including speculatively while composing
 *                an answer.
 * mutating     — called without asking, but always reported, naming what changed.
 * irreversible — ALWAYS stops at the confirmation gate. No setting removes this.
 */
export type ToolRisk = 'safe' | 'mutating' | 'irreversible'

export interface ToolSpec {
  id: string
  name: string
  /** Shown in the plan card, in the operator's language. */
  summary: string
  /** Which specialist actually does the work. `null` for pure cross-cutting reads. */
  agentId: AgentId | null
  risk: ToolRisk
  /** Validated before dispatch, always. */
  args: z.ZodTypeAny
  /** Plain-language description of what comes back. */
  returns: string
  /** Required when risk === 'irreversible'. Rendered into the confirm card. */
  confirmTemplate?: string
  /** Utterances that should route here — also the parser's grammar. */
  examples: string[]
  /** Optional grouping for the Capabilities accordion in the console. */
  group?: string
}

const platformEnum = z.enum(PLATFORMS)
const verdictEnum = z.enum(VALIDATION_VERDICTS)

/** A relative or absolute day reference: 'thursday', 'tomorrow', '2026-09-10'. */
const dayRef = z.string().min(3).describe('A weekday, a relative day, or an ISO date')

export const TOOLS: ToolSpec[] = [
  /* ── Situational awareness ─────────────────────────────────────────────── */
  {
    id: 'state.read',
    name: 'Read the situation',
    summary: 'The current state of everything: counts, queues, agent states and today\u2019s schedule.',
    agentId: null,
    risk: 'safe',
    args: z.object({}).strict(),
    returns: 'A snapshot of counts, queues, agent states and the schedule for today.',
    group: 'Awareness',
    examples: [
      'what is the state of everything',
      'give me a status report',
      'where are we',
      'what is happening right now',
      'brief me',
    ],
  },
  {
    id: 'agent.status',
    name: 'Agent status',
    summary: 'Per-agent state, last run and success rate.',
    agentId: null,
    risk: 'safe',
    args: z
      .object({ agentId: z.string().optional().describe('Limit to one agent') })
      .strict(),
    returns: 'Each agent with its status, current task, last run time and success rate.',
    group: 'Awareness',
    examples: [
      'how are the agents doing',
      'agent status',
      'is anything failing',
      'what is the validation agent doing',
      'show me agent health',
    ],
  },
  {
    id: 'run.explain',
    name: 'Explain a past run',
    summary: 'Reconstructs what a past run did and the exact resolved settings it used.',
    agentId: null,
    risk: 'safe',
    args: z
      .object({
        runId: z.string().optional().describe('A specific pipeline run id'),
        skillId: z.string().optional().describe('Limit to one skill'),
      })
      .strict(),
    returns: 'The run, its skills, and the resolved config each one actually used.',
    group: 'Awareness',
    examples: [
      'explain the last run',
      'what settings did that run use',
      'why did that run behave that way',
      'show me the config for the last pipeline',
    ],
  },
  {
    id: 'lineage.trace',
    name: 'Trace lineage',
    summary: 'Follows any object back to the source item it came from, and forward to what it became.',
    agentId: null,
    risk: 'safe',
    args: z
      .object({
        type: z
          .enum(['keyword', 'hashtag', 'scraped_item', 'content_idea', 'draft', 'media_asset', 'post', 'knowledge_entry'])
          .describe('What kind of object to trace from'),
        id: z.string().min(1).describe('The object id'),
      })
      .strict(),
    returns: 'The chain of objects backward to the source and forward to everything derived from it.',
    group: 'Awareness',
    examples: [
      'where did this post come from',
      'trace this idea back to its source',
      'why was #GenAI rejected',
      'show me the lineage of this hashtag',
      'what did this keyword produce',
    ],
  },

  /* ── Pipeline ──────────────────────────────────────────────────────────── */
  {
    id: 'pipeline.run',
    name: 'Run discovery',
    summary: 'Runs the discovery pipeline end to end: scrape, validate, analyse and plan.',
    agentId: 'scraping',
    risk: 'mutating',
    args: z
      .object({
        keywordIds: z.array(z.string()).optional().describe('Limit the run to these keywords'),
        keywords: z.array(z.string()).optional().describe('Limit the run to these keyword terms'),
        paceMs: z.number().int().min(0).max(5000).optional().describe('Slow the run down for watching'),
      })
      .strict(),
    returns:
      'The run summary: keywords scanned, posts scraped, trending keywords, verdict buckets, the top hashtag set and the ideas created.',
    group: 'Pipeline',
    examples: [
      'run the pipeline',
      'run discovery',
      'start the pipeline',
      'kick off a discovery run',
      'run discovery on the top five keywords',
      'scrape linkedin now',
      'fire the pipeline',
    ],
  },
  {
    id: 'pipeline.status',
    name: 'Pipeline status',
    summary: 'The current or most recent run, with progress for each agent.',
    agentId: null,
    risk: 'safe',
    args: z.object({}).strict(),
    returns: 'The run status, its stage, and per-agent progress and counts.',
    group: 'Pipeline',
    examples: [
      'is the pipeline running',
      'pipeline status',
      'how far along is the run',
      'what did the last run do',
    ],
  },

  /* ── Keywords ──────────────────────────────────────────────────────────── */
  {
    id: 'keyword.list',
    name: 'List keywords',
    summary: 'The keyword set with weights, categories and whether each is active.',
    agentId: 'scraping',
    risk: 'safe',
    args: z
      .object({ activeOnly: z.boolean().optional().describe('Only the active keywords') })
      .strict(),
    returns: 'Every keyword with its category, weight and active flag.',
    group: 'Keywords',
    examples: [
      'list the keywords',
      'what keywords are we tracking',
      'show me the keyword set',
      'which keywords are active',
    ],
  },
  {
    id: 'keyword.add',
    name: 'Add a keyword',
    summary: 'Adds a term to the keyword set at a given weight.',
    agentId: 'scraping',
    risk: 'mutating',
    args: z
      .object({
        term: z.string().min(2).describe('The keyword to add'),
        weight: z.number().int().min(0).max(100).optional().describe('Priority weight, 0 to 100'),
        category: z.enum(['Core', 'Adjacent', 'Positioning']).optional().describe('Which group it belongs to'),
      })
      .strict(),
    returns: 'The keyword that was created, with its assigned weight and category.',
    group: 'Keywords',
    examples: [
      "add 'inference economics' as a keyword at weight 70",
      'add a keyword',
      'track inference economics',
      'start tracking reward hacking',
    ],
  },
  {
    id: 'keyword.update',
    name: 'Update a keyword',
    summary: 'Changes a keyword\u2019s weight, category or active state.',
    agentId: 'scraping',
    risk: 'mutating',
    args: z
      .object({
        term: z.string().min(2).optional().describe('Which keyword, by term'),
        id: z.string().optional().describe('Which keyword, by id'),
        weight: z.number().int().min(0).max(100).optional(),
        active: z.boolean().optional(),
        category: z.enum(['Core', 'Adjacent', 'Positioning']).optional(),
      })
      .strict(),
    returns: 'The updated keyword.',
    group: 'Keywords',
    examples: [
      'set RLHF weight to 80',
      'deactivate synthetic data',
      'turn off the AI agents keyword',
      'raise agentic AI to 100',
    ],
  },
  {
    id: 'keyword.trending',
    name: 'Trending keywords',
    summary: 'The current trending set with each score and the reason behind it.',
    agentId: 'validation',
    risk: 'safe',
    args: z
      .object({ limit: z.number().int().min(1).max(20).optional() })
      .strict(),
    returns: 'The trending keywords with trend scores, component scores and a plain-language reason each.',
    group: 'Keywords',
    examples: [
      'what is trending this week',
      'what is trending',
      'show me the trending keywords',
      'which keywords are hot',
      'find the strongest trend this week',
    ],
  },

  /* ── Hashtags ──────────────────────────────────────────────────────────── */
  {
    id: 'hashtag.list',
    name: 'List hashtags',
    summary: 'Ranked hashtags, filterable by verdict or by the keyword that surfaced them.',
    agentId: 'validation',
    risk: 'safe',
    args: z
      .object({
        status: verdictEnum.optional().describe('Filter by verdict'),
        keyword: z.string().optional().describe('Only hashtags from this keyword'),
        limit: z.number().int().min(1).max(200).optional(),
      })
      .strict(),
    returns: 'Hashtags with their scores, verdicts and reasons.',
    group: 'Hashtags',
    examples: [
      'list the hashtags',
      'show me the validated hashtags',
      'which hashtags need review',
      'what hashtags came from agentic AI',
    ],
  },
  {
    id: 'hashtag.top',
    name: 'The consolidated top set',
    summary: 'The global top hashtag set the research build works from.',
    agentId: 'validation',
    risk: 'safe',
    args: z.object({ limit: z.number().int().min(1).max(100).optional() }).strict(),
    returns: 'The consolidated hashtag set in rank order, with scores and research timestamps.',
    group: 'Hashtags',
    examples: [
      'show me the top 25 hashtags',
      'what is the consolidated hashtag set',
      'top hashtags',
      'which hashtags will be researched',
    ],
  },
  {
    id: 'hashtag.verdict.set',
    name: 'Resolve a hashtag verdict',
    summary: 'Sets the verdict on a hashtag waiting for review, and closes its queue row.',
    agentId: 'validation',
    risk: 'mutating',
    args: z
      .object({
        tag: z.string().min(1).describe('The hashtag, with or without the hash'),
        validation: verdictEnum.describe('The verdict to record'),
        by: z.string().optional().describe('Who decided'),
      })
      .strict(),
    returns: 'The hashtag with its new verdict, and the queue row that was resolved.',
    group: 'Hashtags',
    examples: [
      'approve #RewardModeling',
      'reject #GenAI',
      'validate the RLHF hashtag',
      'mark #AIAgents as validated',
    ],
  },

  /* ── The human queue ───────────────────────────────────────────────────── */
  {
    id: 'review.queue.list',
    name: 'The review queue',
    summary: 'Everything waiting on a human verdict, with the reason and the decision being asked.',
    agentId: 'validation',
    risk: 'safe',
    args: z.object({ resolved: z.boolean().optional() }).strict(),
    returns: 'Queue rows with the item, the reason naming evidence, and the available answers.',
    group: 'Review',
    examples: [
      'what is waiting on me',
      'show me everything waiting on me',
      'what needs my attention',
      'show me the review queue',
      'what needs a verdict',
    ],
  },
  {
    id: 'review.resolve',
    name: 'Resolve a queue item',
    summary: 'Records the outcome on a review queue row.',
    agentId: 'validation',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().min(1).describe('The queue row id'),
        outcome: z.string().min(1).describe('The chosen answer'),
        by: z.string().optional(),
      })
      .strict(),
    returns: 'The resolved queue row and whatever it changed downstream.',
    group: 'Review',
    examples: [
      'resolve that queue item',
      'approve the first item in the queue',
      'clear the review queue item',
    ],
  },

  /* ── Knowledge ─────────────────────────────────────────────────────────── */
  {
    id: 'knowledge.search',
    name: 'Search the Knowledge Base',
    summary: 'Searches active entries and returns them with their citations.',
    agentId: 'knowledge',
    risk: 'safe',
    args: z
      .object({
        query: z.string().min(2).describe('What to search for'),
        limit: z.number().int().min(1).max(50).optional(),
      })
      .strict(),
    returns: 'Matching entries with their content, confidence and cited sources.',
    group: 'Knowledge',
    examples: [
      'what do we know about reward modeling',
      'search the knowledge base for RLHF',
      'what does the knowledge base say about agentic AI',
      'do we have anything on synthetic data',
    ],
  },
  {
    id: 'knowledge.build',
    name: 'Rebuild the Knowledge Base',
    summary: 'Runs the research build now, researching the top hashtags against the live web.',
    agentId: 'knowledge',
    risk: 'mutating',
    args: z
      .object({
        hashtagCount: z.number().int().min(1).max(100).optional().describe('How many hashtags to research'),
        forceRefresh: z.boolean().optional().describe('Re-research even recently covered hashtags'),
      })
      .strict(),
    returns: 'The build record: hashtags researched, entries written and merged, sources cited.',
    group: 'Knowledge',
    examples: [
      'rebuild the knowledge base',
      'run the research build',
      'research the top hashtags now',
      'refresh the knowledge base',
    ],
  },
  {
    id: 'knowledge.add',
    name: 'Add a knowledge entry',
    summary: 'Writes an entry to the Knowledge Base by hand.',
    agentId: 'knowledge',
    risk: 'mutating',
    args: z
      .object({
        title: z.string().min(3),
        content: z.string().min(10),
        category: z.string().optional(),
      })
      .strict(),
    returns: 'The entry that was written.',
    group: 'Knowledge',
    examples: [
      'add a knowledge entry',
      'remember that we prefer shorter hooks',
      'save this to the knowledge base',
    ],
  },
  {
    id: 'knowledge.toggle',
    name: 'Switch an entry on or off',
    summary: 'Deactivates or reactivates an entry. Nothing is ever deleted.',
    agentId: 'knowledge',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().min(1),
        active: z.boolean(),
      })
      .strict(),
    returns: 'The entry with its new active state.',
    group: 'Knowledge',
    examples: [
      'switch off that knowledge entry',
      'deactivate that entry',
      'turn that knowledge entry back on',
    ],
  },

  /* ── The calendar ──────────────────────────────────────────────────────── */
  {
    id: 'idea.list',
    name: 'List ideas',
    summary: 'The calendar and the ranked suggestions beneath it.',
    agentId: 'calendar',
    risk: 'safe',
    args: z
      .object({
        platform: platformEnum.optional(),
        status: z.string().optional().describe('Filter by idea status'),
        day: dayRef.optional().describe('Only ideas on this day'),
        slot: z.enum(['primary', 'suggestion']).optional(),
        limit: z.number().int().min(1).max(100).optional(),
      })
      .strict(),
    returns: 'Ideas with their platform, slot, date, time, rank, confidence and status.',
    group: 'Calendar',
    examples: [
      'what is on the calendar',
      'show me this week',
      'what is scheduled for thursday',
      'list the linkedin posts this week',
      'what is pending leadership',
      'show me the suggestions',
    ],
  },
  {
    id: 'idea.move',
    name: 'Move an idea',
    summary: 'Changes an idea\u2019s date, time or platform.',
    agentId: 'calendar',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().optional().describe('The idea id'),
        title: z.string().optional().describe('The idea, by title'),
        day: dayRef.optional().describe('The new day'),
        time: z.string().optional().describe('The new time, e.g. 10:30 AM'),
        platform: platformEnum.optional().describe('The new platform'),
      })
      .strict(),
    returns: 'The idea in its new slot.',
    group: 'Calendar',
    examples: [
      'move that to thursday morning',
      'reschedule the carousel to tuesday',
      'put it on thursday at 9am',
      'move that post to instagram',
    ],
  },
  {
    id: 'idea.promote',
    name: 'Promote to the calendar',
    summary: 'Gives a suggestion a calendar slot, demoting the lowest-ranked primary if the platform is full.',
    agentId: 'calendar',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
      })
      .strict(),
    returns: 'The promoted idea, and whatever was demoted to make room.',
    group: 'Calendar',
    examples: [
      'promote that suggestion to the calendar',
      'put that on the calendar',
      'promote the reward modeling idea',
    ],
  },
  {
    id: 'calendar.reshuffle',
    name: 'Reshuffle the calendar',
    summary:
      'Re-ranks the week and re-draws the top slots against a stated preference, and stores the preference so the next run honours it too.',
    agentId: 'calendar',
    risk: 'mutating',
    args: z
      .object({
        platform: platformEnum.optional().describe('Favour this platform for the calendar slots'),
        instruction: z
          .string()
          .optional()
          .describe('What the operator asked for, in their own words'),
        remember: z
          .boolean()
          .optional()
          .describe('Store the preference in the Knowledge Base. Defaults to true.'),
      })
      .strict(),
    returns: 'The new calendar slots per platform, what moved, and whether the preference was stored.',
    group: 'Calendar',
    examples: [
      'reshuffle the calendar',
      'shuffle the calendar',
      'redo the calendar for linkedin',
      'favour linkedin on the calendar',
      'rebalance the week',
      'reshuffle but do not remember it',
    ],
  },

  {
    id: 'idea.demote',
    name: 'Demote to suggestions',
    summary: 'Takes an idea off the calendar and returns it to the ranked suggestions.',
    agentId: 'calendar',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
      })
      .strict(),
    returns: 'The idea, now a suggestion.',
    group: 'Calendar',
    examples: [
      'take that off the calendar',
      'demote that to suggestions',
      'move that back to suggestions',
    ],
  },

  /* ── Drafting ──────────────────────────────────────────────────────────── */
  {
    id: 'draft.generate',
    name: 'Write a draft',
    summary: 'Writes the caption for an idea, grounded in the Knowledge Base, and renders its creative.',
    agentId: 'caption',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().optional().describe('The idea id'),
        title: z.string().optional().describe('The idea, by title'),
        day: dayRef.optional().describe('The idea scheduled on this day'),
        platform: platformEnum.optional(),
      })
      .strict(),
    returns: 'The draft body, the rendered creative and the brand compliance verdict.',
    group: 'Content',
    examples: [
      "draft thursday's linkedin post",
      'write the draft for that idea',
      'generate the caption',
      "draft thursday's linkedin post and show me the creative",
      'write that post',
    ],
  },
  {
    id: 'draft.instruct',
    name: 'Revise a draft',
    summary: 'Applies an instruction to a draft. A human instruction outranks a brand guideline, and the finding is raised alongside the edit.',
    agentId: 'review',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
        platform: platformEnum.optional(),
        instruction: z.string().min(3).describe('What to change'),
      })
      .strict(),
    returns: 'The revised draft, the compliance findings, and any preference worth remembering.',
    group: 'Content',
    examples: [
      'make it shorter and more CTO-focused',
      'make it shorter',
      'rewrite that with a stronger hook',
      'tighten the opening',
      'change the tone',
    ],
  },
  {
    id: 'image.render',
    name: 'Render the creative',
    summary: 'Renders or re-renders the picture for a post on the right canvas for its platform.',
    agentId: 'image',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
        platform: platformEnum.optional(),
        model: z.enum(IMAGE_MODEL_IDS).optional(),
        instruction: z.string().optional().describe('How to change the creative'),
      })
      .strict(),
    returns: 'The rendered asset with its canvas, model, alt text and any fallback reason.',
    group: 'Content',
    examples: [
      'render the image',
      're-render the creative',
      'make the image brighter',
      'show me the creative for that post',
    ],
  },
  {
    id: 'brand.check',
    name: 'Check brand compliance',
    summary: 'Runs the twenty-rule compliance check on any text and reports the verdict with its evidence.',
    agentId: 'review',
    risk: 'safe',
    args: z
      .object({
        text: z.string().optional().describe('The text to check'),
        id: z.string().optional().describe('Check an existing draft instead'),
        platform: platformEnum.optional(),
      })
      .strict(),
    returns: 'The verdict, the per-dimension results and every violated rule with its required action.',
    group: 'Content',
    examples: [
      'check this against the brand rules',
      'run a brand check',
      'does this pass compliance',
      'is this on brand',
    ],
  },

  /* ── Approval and publication ──────────────────────────────────────────── */
  {
    id: 'idea.approve.marketing',
    name: 'Marketing approval',
    summary: 'The first of two approvals. Sends the post to Leadership.',
    agentId: 'review',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
        by: z.string().optional(),
      })
      .strict(),
    returns: 'The idea, now awaiting Leadership.',
    group: 'Approval',
    examples: [
      'approve that for leadership',
      'give marketing approval',
      'send that to leadership',
      'approve it',
    ],
  },
  {
    id: 'idea.approve.leadership',
    name: 'Leadership approval',
    summary: 'The final approval. Publishes immediately when auto-publish is on, which cannot be undone.',
    agentId: 'publishing',
    risk: 'irreversible',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
        by: z.string().optional(),
        publish: z.boolean().optional().describe('Publish on approval'),
      })
      .strict(),
    returns: 'The approved idea and, when auto-publish is on, the published receipt.',
    confirmTemplate:
      'This gives final approval to "{title}" and publishes it to {platform} immediately. Publishing cannot be undone.',
    group: 'Approval',
    examples: [
      'give final approval',
      'approve and publish',
      'leadership approve that post',
      'sign it off',
    ],
  },
  {
    id: 'idea.reject.leadership',
    name: 'Leadership rejection',
    summary: 'Rejects a post with a reason. The reason is mandatory — it is what the agents learn from.',
    agentId: 'review',
    risk: 'mutating',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
        reason: z.string().min(4).describe('Why it was rejected'),
        by: z.string().optional(),
      })
      .strict(),
    returns: 'The rejected idea and the Knowledge Base entry written from the reason.',
    group: 'Approval',
    examples: [
      'reject that post',
      'reject it, the tone is too promotional',
      'turn that down and say why',
    ],
  },
  {
    id: 'idea.publish',
    name: 'Publish now',
    summary: 'Publishes a post to its platform immediately. This is the one irreversible act in the system.',
    agentId: 'publishing',
    risk: 'irreversible',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
        platform: platformEnum.optional(),
      })
      .strict(),
    returns: 'The publish receipt with the external id, the mode and the first metrics reading.',
    confirmTemplate:
      'This publishes "{title}" to {platform} immediately. Publishing cannot be undone.',
    group: 'Approval',
    examples: [
      'publish it',
      'publish that post',
      'send it live',
      'ship it',
      'post it now',
    ],
  },

  /* ── Analytics ─────────────────────────────────────────────────────────── */
  {
    id: 'analytics.query',
    name: 'Query analytics',
    summary: 'Any figure for any platform and month, with the source it came from.',
    agentId: 'analytics',
    risk: 'safe',
    args: z
      .object({
        /*
         * `all` is accepted and means every platform, which is what omitting it
         * already did. A model asked "how did last month perform?" answers with
         * `platform: 'all'` — the natural word — and the closed enum rejected it,
         * so the whole query failed with an enum error instead of reporting the
         * account. Normalised to `undefined` rather than adding a fifth platform
         * anywhere else: `Platform` stays a closed union of four.
         */
        platform: z
          .union([platformEnum, z.enum(['all', 'every', 'overall'])])
          .optional()
          .transform((value) => (value === undefined || value === 'all' || value === 'every' || value === 'overall' ? undefined : value)),
        month: z.string().optional().describe('YYYY-MM, a month name, or the words "last month" / "this month"'),
        metric: z.string().optional().describe('Which figure, e.g. reach or engagement rate'),
      })
      .strict(),
    returns: 'The requested figures, and whether the platform has actually reported the period.',
    group: 'Analytics',
    examples: [
      'what was linkedin reach last month',
      'how did instagram do in august',
      'show me the engagement rate',
      'what are our numbers this month',
    ],
  },
  {
    id: 'analytics.compare',
    name: 'Compare periods',
    summary: 'Period over period against this account\u2019s own baseline, never an industry benchmark.',
    agentId: 'analytics',
    risk: 'safe',
    args: z
      .object({
        platform: platformEnum.optional(),
        month: z.string().optional(),
        against: z.string().optional().describe('The comparison period'),
      })
      .strict(),
    returns: 'The change against the prior period and against the trailing baseline, with where it is concentrated.',
    group: 'Analytics',
    examples: [
      'why did instagram drop last month',
      'compare this month to last month',
      'how does august compare to july',
      'is linkedin up or down',
    ],
  },
  {
    id: 'post.explain',
    name: 'Explain a post',
    summary: 'Why a published post performed the way it did, against our own baseline.',
    agentId: 'analytics',
    risk: 'safe',
    args: z
      .object({
        id: z.string().optional(),
        title: z.string().optional(),
      })
      .strict(),
    returns: 'The post\u2019s figures against baseline, the contributing factors and a recommendation.',
    group: 'Analytics',
    examples: [
      "why did tuesday's post beat thursday's",
      'why did that post do well',
      'explain that post',
      'what happened with that post',
    ],
  },
  {
    id: 'report.export',
    name: 'Export a report',
    summary: 'CSV or JSON of any analytics view.',
    agentId: 'analytics',
    risk: 'safe',
    args: z
      .object({
        format: z.enum(['csv', 'json']).optional(),
        platform: platformEnum.optional(),
        month: z.string().optional(),
      })
      .strict(),
    returns: 'The export payload and its filename.',
    group: 'Analytics',
    examples: [
      'export the analytics',
      'download the report as csv',
      'give me a json export of august',
    ],
  },

  /* ── Configuration ─────────────────────────────────────────────────────── */
  {
    id: 'skill.configure',
    name: 'Change a setting',
    summary: 'Changes a knob on a skill. Refuses to disable a critical skill.',
    agentId: null,
    risk: 'mutating',
    args: z
      .object({
        skillId: z.string().min(3).describe('The skill to configure'),
        key: z.string().optional().describe('Which knob'),
        value: z.union([z.string(), z.number(), z.boolean()]).optional().describe('The new value'),
        enabled: z.boolean().optional().describe('Switch the skill on or off'),
      })
      .strict(),
    returns: 'The skill with its new resolved configuration.',
    group: 'Configuration',
    examples: [
      'set the top keywords to 8',
      'change the trending keyword count',
      'turn off competitor tracking',
      'raise the hashtag count to 30',
    ],
  },
]

/* ═══════════════════════════════════════════════════════════════════════════
   COMPUTED INDEXES
   ═══════════════════════════════════════════════════════════════════════════ */

export const TOOL_BY_ID: Record<string, ToolSpec> = Object.fromEntries(
  TOOLS.map((t) => [t.id, t]),
)

export const TOOL_IDS: string[] = TOOLS.map((t) => t.id)

export const TOOLS_BY_RISK: Record<ToolRisk, ToolSpec[]> = {
  safe: TOOLS.filter((t) => t.risk === 'safe'),
  mutating: TOOLS.filter((t) => t.risk === 'mutating'),
  irreversible: TOOLS.filter((t) => t.risk === 'irreversible'),
}

export const TOOLS_BY_AGENT: Record<string, ToolSpec[]> = TOOLS.reduce(
  (acc, tool) => {
    const key = tool.agentId ?? 'platform'
    acc[key] = acc[key] ?? []
    acc[key].push(tool)
    return acc
  },
  {} as Record<string, ToolSpec[]>,
)

export const TOOL_SUMMARY = {
  tools: TOOLS.length,
  safe: TOOLS_BY_RISK.safe.length,
  mutating: TOOLS_BY_RISK.mutating.length,
  irreversible: TOOLS_BY_RISK.irreversible.length,
  examples: TOOLS.reduce((n, t) => n + t.examples.length, 0),
} as const

/** The risk class of a plan is the maximum over its steps. */
const RISK_ORDER: Record<ToolRisk, number> = { safe: 0, mutating: 1, irreversible: 2 }

export function maxRisk(risks: ToolRisk[]): ToolRisk {
  let out: ToolRisk = 'safe'
  for (const r of risks) if (RISK_ORDER[r] > RISK_ORDER[out]) out = r
  return out
}

export function requiresConfirmation(risk: ToolRisk, alsoConfirmMutating = false): boolean {
  if (risk === 'irreversible') return true
  if (alsoConfirmMutating && risk === 'mutating') return true
  return false
}

/** Renders a tool's confirm template against the resolved arguments. */
export function renderConfirmTemplate(
  toolId: string,
  values: Record<string, unknown>,
): string {
  const tool = TOOL_BY_ID[toolId]
  if (!tool?.confirmTemplate) {
    return 'This cannot be undone. Confirm, or cancel.'
  }
  return tool.confirmTemplate.replace(/\{(\w+)\}/g, (whole, key: string) => {
    const v = values[key]
    return v === undefined || v === null || v === '' ? whole : String(v)
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE GRAMMAR — built from the examples, so the parser cannot drift from the
   tools. Shared by the server parser and the in-bundle standalone parser.
   ═══════════════════════════════════════════════════════════════════════════ */

/** Synonym classes. Every member normalises to the first term. */
export const SYNONYM_CLASSES: string[][] = [
  ['run', 'start', 'kick off', 'kickoff', 'fire', 'trigger', 'execute', 'launch', 'go'],
  ['publish', 'post', 'ship', 'send it live', 'send live', 'go live', 'push live'],
  ['show', 'list', 'what are', 'give me', 'display', 'tell me', 'see', 'view'],
  ['draft', 'write', 'compose', 'generate', 'create'],
  ['approve', 'sign off', 'signoff', 'accept', 'ok', 'okay'],
  ['reject', 'decline', 'turn down', 'refuse', 'kill'],
  ['move', 'reschedule', 'shift', 'put'],
  ['explain', 'why', 'how come', 'what caused'],
  ['rebuild', 'refresh', 'rerun', 'redo', 'regenerate'],
  ['delete', 'remove', 'drop'],
  ['add', 'track', 'include', 'create'],
  ['trending', 'hot', 'strongest', 'top', 'best'],
  ['waiting', 'pending', 'outstanding', 'queue', 'needs attention'],
]

/** Canonicalises a synonym to its class head. */
export function canonicalise(token: string): string {
  const lower = token.toLowerCase()
  for (const cls of SYNONYM_CLASSES) {
    if (cls.includes(lower)) return cls[0] as string
  }
  return lower
}

const GRAMMAR_STOP_WORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'to', 'for', 'of', 'in', 'on', 'at', 'is',
  'are', 'was', 'me', 'my', 'it', 'that', 'this', 'do', 'does', 'did', 'i',
  'we', 'us', 'you', 'please', 'can', 'could', 'would', 'should', 'now',
])

/** Tokenises and canonicalises an utterance for grammar matching. */
export function grammarTokens(input: string): string[] {
  let s = input.toLowerCase().trim()
  // Collapse multi-word synonyms before splitting.
  for (const cls of SYNONYM_CLASSES) {
    for (const phrase of cls) {
      if (phrase.includes(' ') && s.includes(phrase)) {
        s = s.split(phrase).join(cls[0] as string)
      }
    }
  }
  return s
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9#\s-]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .map(canonicalise)
    .filter((t) => !GRAMMAR_STOP_WORDS.has(t))
}

/** Dice similarity over token bigrams, with a unigram floor for short inputs. */
function tokenSimilarity(a: string[], b: string[]): number {
  if (a.length === 0 || b.length === 0) return 0
  const grams = (arr: string[]) => {
    const s = new Set<string>()
    for (const t of arr) s.add(t)
    for (let i = 0; i < arr.length - 1; i += 1) s.add(`${arr[i]} ${arr[i + 1]}`)
    return s
  }
  const A = grams(a)
  const B = grams(b)
  let shared = 0
  for (const g of A) if (B.has(g)) shared += 1
  return (2 * shared) / (A.size + B.size)
}

export interface GrammarMatch {
  toolId: string
  score: number
  matchedExample: string
}

/**
 * Scores every tool against an utterance using its declared examples.
 * This is the deterministic parser's core, and it ships in both tiers.
 */
export function matchTools(utterance: string): GrammarMatch[] {
  const tokens = grammarTokens(utterance)
  const results: GrammarMatch[] = []

  for (const tool of TOOLS) {
    let best = 0
    let bestExample = ''
    for (const example of tool.examples) {
      const score = tokenSimilarity(tokens, grammarTokens(example))
      if (score > best) {
        best = score
        bestExample = example
      }
    }
    // The tool id's own words are also evidence: 'pipeline run' → pipeline.run
    const idTokens = grammarTokens(tool.id.split('.').join(' '))
    const idScore = tokenSimilarity(tokens, idTokens) * 0.85
    if (idScore > best) {
      best = idScore
      bestExample = tool.id
    }
    if (best > 0) results.push({ toolId: tool.id, score: best, matchedExample: bestExample })
  }

  return results.sort((a, b) => b.score - a.score)
}

/** Every example utterance, for the command bar's placeholder cycle and tests. */
export function allExamples(): Array<{ toolId: string; utterance: string }> {
  return TOOLS.flatMap((t) => t.examples.map((utterance) => ({ toolId: t.id, utterance })))
}

/* ═══════════════════════════════════════════════════════════════════════════
   TOOL REGISTRY SELF-VALIDATION
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ToolProblem {
  severity: 'error' | 'warning'
  where: string
  message: string
}

export function validateToolRegistry(): ToolProblem[] {
  const problems: ToolProblem[] = []
  const seen = new Set<string>()

  for (const tool of TOOLS) {
    if (seen.has(tool.id)) {
      problems.push({ severity: 'error', where: tool.id, message: 'Duplicate tool id.' })
    }
    seen.add(tool.id)

    if (!tool.summary || tool.summary.trim().length < 12) {
      problems.push({
        severity: 'error',
        where: tool.id,
        message: 'Tool has no usable summary; the plan card would render blank.',
      })
    }
    if (!tool.returns || tool.returns.trim().length < 10) {
      problems.push({
        severity: 'error',
        where: tool.id,
        message: 'Tool does not describe what it returns.',
      })
    }
    if (tool.examples.length < 2) {
      problems.push({
        severity: 'error',
        where: tool.id,
        message: 'Tool needs at least two example utterances — they are the parser grammar.',
      })
    }
    if (tool.risk === 'irreversible' && !tool.confirmTemplate) {
      problems.push({
        severity: 'error',
        where: tool.id,
        message: 'An irreversible tool must declare a confirmTemplate.',
      })
    }
    if (tool.risk !== 'irreversible' && tool.confirmTemplate) {
      problems.push({
        severity: 'warning',
        where: tool.id,
        message: 'confirmTemplate is declared but the tool is not irreversible, so it will never render.',
      })
    }
  }

  // Every example must route to its own tool, or the grammar is ambiguous.
  for (const tool of TOOLS) {
    for (const example of tool.examples) {
      const [top] = matchTools(example)
      if (top && top.toolId !== tool.id) {
        problems.push({
          severity: 'warning',
          where: `${tool.id} :: "${example}"`,
          message: `This example routes to "${top.toolId}" instead. Tighten one of the two example sets.`,
        })
      }
    }
  }

  return problems
}

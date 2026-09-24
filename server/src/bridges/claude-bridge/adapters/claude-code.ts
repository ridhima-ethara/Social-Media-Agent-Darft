/**
 * `claude_code` — live acquisition through Claude Code's own web search.
 *
 * Claude Code runs a TREND-RESEARCH SESSION per batch of topics: it is given
 * the topics, the platform, the region, the window and the brand context (the
 * brief below), may run its own related searches with WebSearch, and replies
 * with a JSON trend analysis.
 *
 * TWO LAYERS COME BACK, AND THEY ARE KEPT APART.
 *
 *   1. The RAW SEARCH RESULTS of every search Claude ran (see `claude-cli.ts`):
 *      each result's URL and title. These are the observed data. They become
 *      candidates, are dated from the post id and judged for relevance by the
 *      bridge's own deterministic code — exactly as before.
 *
 *   2. CLAUDE'S ANALYSIS: its JSON trends. Kept as `claudeTrends`, a separate,
 *      labelled layer. Every evidence URL in it must have been returned by a
 *      search in that same session; one that was not is dropped and counted,
 *      so a URL Claude made up cannot get through. A trend left with no
 *      verified evidence is dropped. Its dates come from the post id where the
 *      platform encodes one, otherwise they are marked as Claude-stated.
 *
 * THE BUDGET. The brief states `max_searches_per_session`, and only that many
 * searches (the first ones run) are used, whatever the session did.
 *
 * WHAT IT CANNOT STATE, AND SAYS SO. A search result carries no engagement,
 * so `engagement` is always `null`. Claude is not asked to open the posts:
 * fetching platform pages is outside what this bridge does.
 */

import { existsSync, readFileSync } from 'node:fs'
import { isAbsolute, join } from 'node:path'
import { z } from 'zod'
import type { AdapterId, BridgeConfig } from '../config'
import { adapterLimits, REPO_ROOT } from '../config'
import { platformModule, type PlatformModule } from '../platforms'
import { BRAND } from '../../../../../shared/brand-voice'
import { resolveClaudeBinary, runClaudeSession, type ClaudeSessionResult, type ExecutedSearch } from './claude-cli'
import {
  SourceError,
  type AdapterAvailability,
  type BatchOutcome,
  type ClaudeTrend,
  type ClaudeTrendEvidence,
  type SearchRequest,
  type SourceCandidate,
  type TrendSourceAdapter,
} from './source-types'

const ID: AdapterId = 'claude_code'

/** Failures after which another session cannot succeed. */
const FATAL_PATTERNS = [
  /not logged in|authentication|unauthori[sz]ed|invalid api key|oauth|login/i,
  /credit balance|billing|quota|usage limit/i,
  /Could not start Claude Code/i,
]

/* ═══════════════════════════════════════════════════════════════════════════
   THE PROMPTS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * THE SYSTEM PROMPT — the operator's text, word for word (2026-09-24).
 * Backticks are escaped only because this is a template literal; the string at
 * run time is the text exactly as written. The three input files it names are
 * appended by `systemPromptWith()` below, labelled File 1/2/3.
 */
export const SYSTEM_PROMPT = `You are the **Trend Intelligence Acquisition Agent** for a social-media intelligence system.

Your responsibility is to **research, scrape, validate, and return current-month trend intelligence for each requested social-media platform using publicly available web/search data**.

You are an **intelligence acquisition agent**.

You are NOT a content-generation agent.

Do not generate posts, captions, content calendars, creative copy, or publishing recommendations.

---

# 1. INPUT FILES

The system will provide exactly three Markdown (\`.md\`) files as the primary input context.

These files are the source of truth for the research task:

### File 1 — Keywords

Contains:

* Target keywords
* Target topics
* Related search terms
* Potential hashtags
* Keyword priorities
* Topic categories
* Other terms that should be monitored

Use this file to determine **WHAT to search for**.

---

### File 2 — Knowledge Base

Contains the organization's:

* Industry/domain knowledge
* Products
* Technologies
* Services
* Research areas
* Relevant concepts
* Industry terminology
* Audience context
* Competitor/market context where applicable

Use this file to determine:

**WHAT IS RELEVANT TO THE ORGANIZATION.**

The Knowledge Base must NOT be treated as evidence that a topic is trending.

---

### File 3 — Brand Voice

Contains:

* Brand positioning
* Brand identity
* Tone
* Communication principles
* Audience
* Topics the brand focuses on
* Topics the brand avoids
* Messaging constraints

Use this file to understand:

**WHICH DISCOVERED TRENDS ARE RELEVANT TO THE BRAND AND HOW THEY SHOULD BE CONTEXTUALIZED.**

The Brand Voice file must NOT be treated as evidence that a topic is trending.

---

# 2. FILE PROCESSING REQUIREMENT

Before performing trend research:

1. Read all three Markdown files.
2. Extract the relevant keywords from the Keywords file.
3. Extract relevant concepts and domain terminology from the Knowledge Base.
4. Extract brand context from the Brand Voice file.
5. Build an internal research vocabulary.
6. Use that vocabulary to perform platform-specific searches.

Do not begin trend classification before understanding all three files.

---

# 3. SOURCE-OF-TRUTH HIERARCHY

Use the files in this order:

\`\`\`text
Keywords MD
     ↓
Defines WHAT to search
     ↓
Knowledge Base MD
     ↓
Defines WHAT is relevant
     ↓
Brand Voice MD
     ↓
Defines BRAND CONTEXT
     ↓
Web/Search Evidence
     ↓
Defines WHAT IS ACTUALLY TRENDING
\`\`\`

The web/search evidence is the ONLY source that can establish that something is currently trending.

The Markdown files provide context and relevance, not trend evidence.

---

# 4. CURRENT MONTH REQUIREMENT

The primary research window is ALWAYS:

\`\`\`text
FIRST DAY OF CURRENT CALENDAR MONTH
        →
CURRENT DATE
\`\`\`

Determine the current month dynamically at runtime.

Example:

If the current date is:

\`\`\`text
September 24, 2026
\`\`\`

the primary research window is:

\`\`\`text
September 1, 2026 → September 24, 2026
\`\`\`

If the agent runs on:

\`\`\`text
October 5, 2026
\`\`\`

the research window becomes:

\`\`\`text
October 1, 2026 → October 5, 2026
\`\`\`

Never hard-code the month.

---

# 5. CURRENT-MONTH DATA HAS PRIORITY

Prioritize evidence in this order:

\`\`\`text
Today
↓
Last 1–3 days
↓
Last 4–7 days
↓
Earlier current month
↓
Previous month
\`\`\`

Previous-month data may only be used as supporting historical context.

Previous-month evidence alone MUST NOT establish a current-month trend.

If no current-month evidence exists, do not return the topic as a confirmed current trend.

---

# 6. PLATFORM-BY-PLATFORM RESEARCH

Every requested platform must be researched independently.

For example, if the system requests:

\`\`\`text
LinkedIn
Instagram
Facebook
X
\`\`\`

perform separate research for:

\`\`\`text
LinkedIn
Instagram
Facebook
X
\`\`\`

Do NOT perform one generic search and assign the same results to all platforms.

A topic discovered on one platform must not automatically be considered trending on another platform.

---

# 7. PLATFORM SEARCH PRIORITY

Prioritize direct public evidence from the requested platform.

Use platform-specific searches such as:

\`\`\`text
LinkedIn → site:linkedin.com
Instagram → site:instagram.com
Facebook → site:facebook.com
X → site:x.com
\`\`\`

Also search relevant public web sources when platform-specific evidence is insufficient.

Search for:

* Recent posts
* Recent discussions
* Hashtags
* Announcements
* Emerging terminology
* Repeated conversations
* Questions
* Problems
* Industry discussions
* Product/research releases
* Current events
* Competitor discussions where relevant

---

# 8. PLATFORM TREND VS PLATFORM ACTIVITY

Do NOT confuse these two concepts.

### Platform trend

Evidence indicates broad or repeated current activity around a topic on the platform.

### Platform activity

One or more relevant posts or discussions were found, but there is not enough evidence to establish a broader platform trend.

If only platform activity can be verified, report:

\`\`\`text
platform_activity
\`\`\`

Do NOT claim:

\`\`\`text
trending_on_platform
\`\`\`

unless the evidence supports that conclusion.

Public web search does not provide guaranteed access to a platform's internal personalized trending feed.

Never claim access to internal platform trend rankings unless the available tool explicitly provides them.

---

# 9. SEARCH PROCESS

For EACH keyword/topic extracted from the Keywords MD file and EACH requested platform:

### Search 1 — Exact keyword

Search the exact keyword.

### Search 2 — Related terminology

Search:

* Synonyms
* Acronyms
* Alternate terminology
* Closely related concepts
* Emerging terminology

### Search 3 — Platform-specific content

Search the requested platform domain.

### Search 4 — Hashtags

Search related hashtags and current-month activity.

### Search 5 — Recent conversations

Search:

* Discussions
* Questions
* Problems
* Debates
* Repeated themes

### Search 6 — Current events

Search:

* Announcements
* Product launches
* Research releases
* Industry developments
* Conferences
* Regulatory developments
* Major company announcements

### Search 7 — Adjacent topics

Use the Knowledge Base to identify closely related concepts that may be emerging.

Only perform this expansion when relevant.

---

# 10. KEYWORD EXPANSION

Start with the exact keywords from the Keywords MD.

You may expand them using information from:

* Knowledge Base
* Current search results
* Emerging terminology
* Industry terminology
* Current events
* Relevant hashtags

However, do NOT expand into unrelated topics.

Every returned trend must have a clear relationship to:

* A supplied keyword, OR
* A valid closely related concept discovered through the Knowledge Base or current evidence.

---

# 11. WHAT COUNTS AS A TREND

A keyword mention is NOT a trend.

A candidate must demonstrate evidence of recent activity such as:

* Multiple recent discussions
* Repeated current-month posts
* Multiple independent sources
* Emerging terminology
* Active hashtag usage
* Increasing discussion
* Current event generating discussion
* New product/research release generating discussion
* Repeated questions/problems
* Significant current-month platform activity

The following distinction is mandatory:

\`\`\`text
Keyword mention
      ≠
Recent activity
      ≠
Active discussion
      ≠
Trend
\`\`\`

Do not classify a topic as trending merely because a search result contains the keyword.

---

# 12. TREND TYPES

Assign exactly one:

### emerging

New or increasing discussion during the current month, but not enough evidence for sustained activity.

### active

Repeated current-month activity demonstrating ongoing discussion.

### established

Recurring/high-volume discussion that is currently active but is not demonstrably new or accelerating.

### news_event

Activity primarily driven by a specific recent event, announcement, launch, release, research publication, or development.

---

# 13. TREND STATUS

Assign:

\`\`\`text
emerging
active
established
declining
\`\`\`

Only use \`declining\` when evidence indicates that activity has decreased after earlier current-month activity.

Do not infer decline without evidence.

---

# 14. EVIDENCE REQUIREMENTS

EVERY returned trend must contain evidence.

Each evidence item must contain:

* Title
* URL
* Source
* Publication/post date when available
* Evidence summary

Example:

\`\`\`json
{
  "title": "...",
  "url": "...",
  "source": "LinkedIn",
  "published_at": "2026-09-23",
  "evidence_summary": "Recent public discussion concerning..."
}
\`\`\`

Never fabricate missing values.

If a publication date is unavailable:

\`\`\`text
published_at = ""
\`\`\`

Do not guess.

---

# 15. INDEPENDENT EVIDENCE

Multiple URLs do not necessarily mean multiple independent sources.

Do not count:

* Duplicate search results
* Syndicated copies
* Reposted articles
* The same original post appearing through different URLs
* Search-engine duplicates

as independent evidence.

---

# 16. CONFIDENCE

Use:

### high

Multiple recent independent signals support the trend.

### medium

At least one strong recent signal supports the trend, but independent confirmation is limited.

### low

Evidence is weak, indirect, or incomplete.

Do not increase confidence simply because the user requested a certain number of trends.

---

# 17. MOMENTUM

Only claim:

* Growing
* Increasing
* Accelerating
* Viral
* Rapidly increasing

when evidence supports that claim.

If current activity exists but growth cannot be verified, use:

\`\`\`text
Current activity is observable, but increasing momentum could not be independently verified.
\`\`\`

Do not manufacture growth metrics.

---

# 18. HASHTAGS

Separate:

\`\`\`text
related hashtags
\`\`\`

from:

\`\`\`text
active/trending hashtags
\`\`\`

Only classify a hashtag as active/trending when current-month evidence demonstrates meaningful activity.

Never invent:

* Hashtag volume
* Hashtag ranking
* Growth percentage
* Reach
* Engagement

---

# 19. DEDUPLICATION

Cluster semantically similar topics into one canonical trend.

For example:

\`\`\`text
AI Agents
Agentic AI
Agentic Systems
AI Agent Orchestration
Agentic Workflows
\`\`\`

may represent the same underlying trend.

Return one canonical topic and put the variants in:

\`\`\`text
related_keywords
\`\`\`

Do not consume multiple trend slots with minor variations of the same trend.

---

# 20. KNOWLEDGE BASE USAGE

Use the Knowledge Base to:

* Expand search terminology
* Identify relevant technologies
* Identify relevant industry concepts
* Identify related products
* Identify relevant audience problems
* Identify adjacent trends
* Determine whether a discovered trend is relevant

Do NOT use the Knowledge Base as evidence that the trend exists.

Example:

If the Knowledge Base discusses:

\`\`\`text
AI agents
LLM evaluation
MCP
RAG
\`\`\`

this does NOT mean these topics are currently trending.

Current web evidence must independently establish current activity.

---

# 21. BRAND VOICE USAGE

Use Brand Voice to understand:

* Brand positioning
* Audience
* Communication style
* Relevant subject areas
* Topics to avoid
* Brand-specific terminology

Do NOT alter trend detection based on brand preference.

The correct sequence is:

\`\`\`text
Detect trend
      ↓
Validate evidence
      ↓
Determine relevance
      ↓
Apply brand context
\`\`\`

Never:

\`\`\`text
Brand preference
      ↓
Search for supporting evidence
      ↓
Declare trend
\`\`\`

---

# 22. BRAND RELEVANCE

If Brand Voice and Knowledge Base indicate that a trend is relevant to the organization, capture that separately.

Use:

\`\`\`text
high
medium
low
unknown
\`\`\`

Brand relevance is NOT evidence of trend status.

---

# 23. GEOGRAPHIC REGION

If a region is provided, prioritize current-month evidence relevant to that geography.

For example:

\`\`\`text
region = India
\`\`\`

prioritize:

* Indian discussions
* Indian users/audiences
* Indian companies
* Indian events
* India-specific developments
* Content explicitly relevant to India

Do not describe a global trend as an India-originated trend merely because it is accessible in India.

If the trend is global but relevant to India, clearly state that distinction.

---

# 24. COMPETITOR RESEARCH

Competitor discussions may be used to discover:

* Emerging terminology
* Industry conversations
* Audience questions
* Product developments
* Content themes
* New discussions

But:

\`\`\`text
Competitor post
≠
Platform-wide trend
\`\`\`

A competitor's activity can support discovery but cannot automatically establish a trend.

---

# 25. SOURCE PRIORITY

Prefer:

1. Direct platform content
2. Official company/organization announcements
3. Research institutions/publications
4. Industry publications
5. Reputable news sources
6. Public community discussions
7. Search snippets/aggregators

Use lower-level sources for discovery when necessary but prefer stronger sources for final evidence.

---

# 26. NO FABRICATION

Never invent:

* Posts
* URLs
* Dates
* Engagement numbers
* Likes
* Comments
* Shares
* Views
* Search volume
* Growth
* Ranking
* Trend scores
* Hashtag popularity
* Platform trend status
* Momentum

If information cannot be verified, omit it or explicitly mark it unavailable.

---

# 27. INSUFFICIENT DATA

If a platform does not provide enough publicly accessible current-month evidence:

Do NOT fabricate results.

Add the platform to:

\`\`\`text
platforms_with_insufficient_data
\`\`\`

Possible reasons:

* No current-month results
* Results too old
* Platform content unavailable to public search
* Insufficient evidence
* Search results dominated by unrelated content
* Evidence insufficient to establish a trend

---

# 28. REQUESTED NUMBER OF TRENDS

The requested number is a MAXIMUM.

If:

\`\`\`text
max_trends = 10
\`\`\`

but only 4 trends satisfy the evidence requirements:

Return 4.

Never create weak trends simply to reach the requested number.

Evidence quality is more important than quantity.

---

# 29. CURRENT-MONTH PRIORITY

For every returned trend, prioritize:

\`\`\`text
Current month
+
Requested platform
+
Keyword relevance
+
Recent activity
+
Verifiable evidence
\`\`\`

Older evidence must never override stronger current-month evidence.

---

# 30. FINAL VALIDATION CHECKLIST

Before returning a trend, verify:

\`\`\`text
[ ] Source is based on the supplied Keywords MD
    or a valid related concept.

[ ] Trend has current-month evidence.

[ ] Platform is correctly identified.

[ ] Evidence demonstrates activity rather than a simple keyword mention.

[ ] Trend is not a semantic duplicate.

[ ] Trend type is appropriate.

[ ] Trend status is supported by evidence.

[ ] Confidence matches evidence strength.

[ ] No metrics were invented.

[ ] No dates were invented.

[ ] No URLs were invented.

[ ] No unsupported momentum claims were made.

[ ] Geographic relevance is correctly represented.

[ ] Knowledge Base was used for relevance/context,
    not as trend evidence.

[ ] Brand Voice was used for brand relevance/context,
    not as trend evidence.

[ ] Competitor activity was not incorrectly treated
    as a platform-wide trend.

[ ] Platform limitations are disclosed when applicable.
\`\`\`

If a candidate fails a required check, do not return it as a confirmed trend.

---

# 31. OUTPUT

Return ONLY valid JSON.

Do not return Markdown.

Do not return explanations outside the JSON.

Use exactly:

{
"query_context": {
"keywords": [],
"platforms": [],
"region": "",
"time_window": "",
"current_month": "",
"max_trends": 0
},
"trends": [
{
"topic": "",
"trend_type": "emerging|active|established|news_event",
"trend_status": "emerging|active|established|declining",
"platform": "",
"related_keywords": [],
"hashtags": [],
"why_trending": "",
"observed_signals": [],
"evidence": [
{
"title": "",
"url": "",
"source": "",
"published_at": "",
"evidence_summary": ""
}
],
"brand_relevance": {
"relevance": "high|medium|low|unknown",
"reason": ""
},
"confidence": "high|medium|low"
}
],
"platforms_with_insufficient_data": [],
"search_limitations": []
}

---

# 32. FINAL OBJECTIVE

The goal is to identify:

**What is actually being discussed right now, during the current calendar month, on each requested platform, that is relevant to the organization's monitored keywords and knowledge domain.**

Do not optimize for the number of results.

Optimize for:

\`\`\`text
CURRENT
+
PLATFORM-SPECIFIC
+
EVIDENCE-BASED
+
RELEVANT
+
NON-DUPLICATED
+
VERIFIABLE
\`\`\`

When reliable evidence does not exist, return fewer trends rather than fabricating or inferring them.`

/* ═══════════════════════════════════════════════════════════════════════════
   REFERENCE DOCUMENTS — the brand, corpus and keyword maps Claude researches against
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ReferenceDoc {
  /** The role the system prompt gives it: "File 1 — Keywords", "File 2 — Knowledge Base", "File 3 — Brand Voice". */
  role: string
  name: string
  text: string
}

export type ReferenceFile = string | { role: string; path: string }

/** Reads the configured reference documents now — an edit takes effect on the next run. */
export function loadReferences(files: readonly ReferenceFile[]): { docs: ReferenceDoc[]; missing: string[] } {
  const docs: ReferenceDoc[] = []
  const missing: string[] = []
  files.forEach((entry, i) => {
    const f = typeof entry === 'string' ? entry : entry.path
    const role = typeof entry === 'string' ? `File ${i + 1}` : entry.role
    const path = isAbsolute(f) ? f : join(REPO_ROOT, f)
    if (!existsSync(path)) {
      missing.push(f)
      return
    }
    docs.push({ role, name: f.split('/').pop() ?? f, text: readFileSync(path, 'utf8').trim() })
  })
  return { docs, missing }
}

/**
 * The system prompt as sent: the operator's text, then — for a platform that
 * has one — its research strategy, then the three input files the prompt names,
 * each labelled with its role and wrapped in its own tag.
 */
export function systemPromptWith(docs: readonly ReferenceDoc[], strategy?: { platform: string; text: string }): string {
  const parts = [SYSTEM_PROMPT]
  if (strategy) {
    parts.push(
      '',
      '---',
      '',
      `# PLATFORM RESEARCH STRATEGY — ${strategy.platform}`,
      '',
      `This session researches ${strategy.platform}. The strategy below refines how to search ${strategy.platform}; it never relaxes the current-month requirement, the evidence requirements or the output schema above.`,
      '',
      strategy.text,
    )
  }
  if (docs.length > 0) {
    parts.push(
      '',
      '---',
      '',
      '# INPUT FILES PROVIDED',
      '',
      `The ${docs.length === 3 ? 'three' : docs.length} Markdown files named in section 1, as provided for this run:`,
      '',
      ...docs.map((d) => `* **${d.role}**: \`${d.name}\``),
      '',
      ...docs.map((d) => `<input_file role="${d.role}" name="${d.name}">\n${d.text}\n</input_file>\n`),
    )
  }
  return parts.join('\n')
}

export interface ResearchBrief {
  keywords: readonly string[]
  /** Hashtags to check, separately from the topics. */
  hashtags?: readonly string[]
  /** The current month ("September 2026"). */
  month?: string
  /** True when the system prompt carries a research strategy for this platform. */
  platformNotes?: string
  platforms: string
  region: string
  timeWindow: string
  /** The maximum number of trends (section 28: a maximum, not a target). */
  trendCount: number
  brandContext: string
  /** Stated as the session's search limit — the bridge uses no more than this many. */
  maxSearches: number
}

export function sessionPrompt(b: ResearchBrief): string {
  return `### Session Prompt

Research the following trend request using the WebSearch tool.

**Keywords/topics:**
${b.keywords.map((k) => `- ${k}`).join('\n')}
${b.hashtags && b.hashtags.length > 0 ? `\n**Hashtags to check:**\n${b.hashtags.join(', ')}\n` : ''}
**Platforms:**
${b.platforms}

**Region:**
${b.region}

**Current month:**
${b.month ?? 'the current calendar month'}

**Time window:**
${b.timeWindow}

**Maximum number of trends (max_trends):**
${b.trendCount}

**Brand/context:**
${b.brandContext}
The three input files (Keywords, Knowledge Base, Brand Voice) are provided in the system prompt.

### Instructions

For every keyword/topic:

1. Search for recent activity related to the keyword.
2. Search for related emerging topics and terminology.
3. Search the requested platforms individually where possible.
4. Search for recent hashtags associated with the topic.
5. Search recent news and industry discussions that may be driving the trend.
6. Look for evidence of momentum rather than simply keyword presence.
7. Compare multiple sources before classifying something as a trend.
8. Remove duplicate or near-duplicate topics.
9. Return only trends supported by recent evidence.
10. Include the source URL and publication date whenever available.
11. Do not invent engagement metrics.
12. Do not claim that something is an official platform trend unless the source explicitly establishes that.
13. If platform-specific trend data cannot be verified through public search, report that limitation in \`platforms_with_insufficient_data\`.

### Important

The goal is **not to find articles that contain the keyword**.

The goal is to identify **topics that are currently gaining attention or receiving significant recent discussion** and provide evidence explaining why they qualify as trends.
${b.month ? `\nPut the current month in your searches (for example: "${b.keywords[0] ?? 'agentic AI'}" ${b.month}).\n` : ''}${b.platformNotes ? `\nFollow the platform research strategy in the system prompt for this platform.\n` : ''}
Search budget: run at most ${b.maxSearches} searches in this session.

Return the final result using the JSON schema defined in the system prompt.`
}

/* ═══════════════════════════════════════════════════════════════════════════
   QUERIES
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The query as sent to the search engine: the platform's site filters first.
 * Positive filters (`site:x.com`) are OR-ed when there are several; negative
 * ones (`-site:…`, the open web's exclusions) are all applied.
 */
export function scopedQuery(platform: PlatformModule, text: string): string {
  const include = platform.siteFilters.filter((f) => !f.startsWith('-'))
  const exclude = platform.siteFilters.filter((f) => f.startsWith('-'))
  const scope = include.length === 0 ? '' : include.length === 1 ? (include[0] as string) : `(${include.join(' OR ')})`
  return [scope, text, ...exclude].filter((p) => p !== '').join(' ')
}

/** Strips the scope back off, so `matched_queries` shows the discovery query, not the operator syntax. */
function unscoped(executed: string): string {
  return executed
    .replace(/-site:\S+/gi, ' ')
    .replace(/\(?\s*(?:site:\S+\s*(?:OR\s+)?)+\)?/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

/** A planned topic without its month hint ("\"post-training\" September 2026" → "post-training"): the brief states the window itself. */
export function topicOf(queryText: string): string {
  return queryText
    .replace(/\s+(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{4}$/i, '')
    .replace(/^"(.*)"$/, '$1')
    .trim()
}

/** How two URLs are compared when verifying Claude's evidence: host without www, path without trailing slash. */
function urlKey(raw: string): string {
  try {
    const u = new URL(raw.trim())
    return `${u.hostname.toLowerCase().replace(/^www\./, '')}${u.pathname.replace(/\/+$/, '')}`
  } catch {
    return raw.trim().toLowerCase()
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CLAUDE'S ANALYSIS — parsed, then verified against the session's own results
   ═══════════════════════════════════════════════════════════════════════════ */

const str = z.preprocess((v) => (v === null || v === undefined ? '' : String(v)), z.string())
const strList = z.preprocess((v) => (Array.isArray(v) ? v.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : []), z.array(z.string()))
const analysisSchema = z.object({
  trends: z
    .array(
      z.object({
        topic: str,
        trend_type: str,
        trend_status: str,
        platform: str,
        related_keywords: strList,
        hashtags: strList,
        why_trending: str,
        observed_signals: strList,
        evidence: z
          .array(z.object({ title: str, url: str, source: str, published_at: str, evidence_summary: str }))
          .catch([]),
        brand_relevance: z
          .object({ relevance: z.enum(['high', 'medium', 'low', 'unknown']).catch('unknown'), reason: str })
          .catch({ relevance: 'unknown', reason: '' }),
        confidence: z.enum(['high', 'medium', 'low']).catch('low'),
      }),
    )
    .catch([]),
  platforms_with_insufficient_data: strList.catch([]),
  search_limitations: strList.catch([]),
})

/** The JSON object in Claude's reply — fenced or bare — or null. */
function jsonOf(text: string | null): unknown {
  if (!text) return null
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/)
  const body = fenced?.[1] ?? text.slice(text.indexOf('{'), text.lastIndexOf('}') + 1)
  try {
    return JSON.parse(body)
  } catch {
    return null
  }
}

/** The module that can date a URL: the session's platform first, then any social platform whose host it is. */
function daterFor(url: string, platform: PlatformModule): PlatformModule | null {
  if (platform.isPlatformHost(url)) return platform
  for (const id of ['linkedin', 'x', 'instagram'] as const) {
    const m = platformModule(id)
    if (m?.isPlatformHost(url)) return m
  }
  return null
}

/**
 * The submission month an arXiv identifier encodes: `2609.16816` → September
 * 2026 (the new-style id is YYMM.NNNNN). A decoding, like a post id — month
 * precision only, never a day.
 */
export function arxivMonth(url: string): string | null {
  const m = url.match(/arxiv\.org\/(?:abs|pdf|html)\/(\d{2})(\d{2})\.\d{4,5}/i)
  if (!m) return null
  const month = Number(m[2])
  return month >= 1 && month <= 12 ? `20${m[1]}-${m[2]}` : null
}

/** A date Claude stated, read only when it begins as an ISO date or month ("2026-09-23", "2026-09"). */
function statedDate(raw: string): Date | null {
  const m = raw.trim().match(/^(\d{4})-(\d{2})(?:-(\d{2}))?/)
  if (!m) return null
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, m[3] ? Number(m[3]) : 1))
  return Number.isNaN(d.getTime()) ? null : d
}

export interface VerifiedAnalysis {
  trends: ClaudeTrend[]
  insufficient: string[]
  limitations: string[]
  parsed: boolean
  /** Trends Claude returned whose every dated piece of evidence predates the window — dropped (section 5). */
  droppedOutsideWindow: number
}

export function verifiedAnalysis(
  resultText: string | null,
  searches: readonly ExecutedSearch[],
  platform: PlatformModule,
  /** The window's start. Evidence dated before it cannot establish a current-month trend. */
  windowFrom?: Date,
): VerifiedAnalysis {
  const parsed = analysisSchema.safeParse(jsonOf(resultText))
  if (!parsed.success) return { trends: [], insufficient: [], limitations: [], parsed: false, droppedOutsideWindow: 0 }

  // Every URL any search in this session returned, with the title it showed.
  const returned = new Map<string, string>()
  for (const s of searches) for (const l of s.links) returned.set(urlKey(l.url), l.title)

  const trends: ClaudeTrend[] = []
  let droppedOutsideWindow = 0
  for (const t of parsed.data.trends) {
    let dropped = 0
    const evidence: ClaudeTrendEvidence[] = []
    const dates: Array<Date | null> = []
    for (const e of t.evidence) {
      if (e.url.trim() === '' || !returned.has(urlKey(e.url))) {
        dropped += 1
        continue
      }
      const dater = daterFor(e.url, platform)
      const classified = dater?.classifyUrl(e.url) ?? null
      const decoded = dater && classified?.itemId ? dater.dateFromItemId(classified.itemId) : null
      const stated = e.published_at.trim()
      // A decoded date wins over one Claude wrote: post id first, then an arXiv id's month.
      const arxiv = decoded ? null : arxivMonth(e.url)
      dates.push(decoded ?? (arxiv ? statedDate(arxiv) : statedDate(stated)))
      evidence.push({
        title: e.title.trim() || (returned.get(urlKey(e.url)) ?? ''),
        url: e.url.trim(),
        source: e.source.trim(),
        publishedAt: decoded ? decoded.toISOString() : arxiv ?? (stated || null),
        dateSource: decoded ? 'platform_id' : arxiv ? 'arxiv_id' : stated ? 'claude_stated' : 'none',
        summary: e.evidence_summary.trim(),
      })
    }
    // "EVERY returned trend must contain evidence": one with none left is not kept.
    if (evidence.length === 0 || t.topic.trim() === '') continue

    /*
     * THE CURRENT-MONTH RULE IS CHECKED, NOT TRUSTED (sections 4–5). A trend
     * stands when some evidence is dated inside the window. When every piece of
     * evidence is dated and all of it predates the window, previous-month
     * evidence alone cannot establish it: it is dropped and counted. With no
     * readable date at all it is kept, labelled `unverified`.
     */
    let windowStatus: ClaudeTrend['windowStatus'] = 'unverified'
    if (windowFrom) {
      const inWindow = dates.some((d) => d !== null && d.getTime() >= Date.UTC(windowFrom.getUTCFullYear(), windowFrom.getUTCMonth(), windowFrom.getUTCDate()))
      const allOlder = dates.every((d) => d !== null && d.getTime() < windowFrom.getTime())
      if (inWindow) windowStatus = 'current_month'
      else if (allOlder) {
        droppedOutsideWindow += 1
        continue
      }
    }

    trends.push({
      topic: t.topic.trim(),
      trendType: t.trend_type.trim(),
      trendStatus: t.trend_status.trim(),
      platform: t.platform.trim() || platform.label,
      relatedKeywords: t.related_keywords,
      hashtags: t.hashtags,
      whyTrending: t.why_trending.trim(),
      observedSignals: t.observed_signals,
      evidence,
      brandRelevance: { relevance: t.brand_relevance.relevance, reason: t.brand_relevance.reason.trim() },
      confidence: t.confidence,
      windowStatus,
      unverifiedEvidenceDropped: dropped,
    })
  }
  return {
    trends,
    insufficient: parsed.data.platforms_with_insufficient_data,
    limitations: parsed.data.search_limitations,
    parsed: true,
    droppedOutsideWindow,
  }
}

/**
 * Parallel sessions can find the same evidence. A trend whose evidence URLs are
 * all already cited by an earlier trend is the same finding twice, so it is dropped.
 */
export function dedupeTrends(trends: readonly ClaudeTrend[]): ClaudeTrend[] {
  const seen = new Set<string>()
  const out: ClaudeTrend[] = []
  for (const t of trends) {
    const keys = t.evidence.map((e) => urlKey(e.url))
    if (keys.every((k) => seen.has(k))) continue
    for (const k of keys) seen.add(k)
    out.push(t)
  }
  return out
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE ADAPTER
   ═══════════════════════════════════════════════════════════════════════════ */

export function createClaudeCodeAdapter(platform: PlatformModule, cfg: BridgeConfig): TrendSourceAdapter {
  const limits = adapterLimits(cfg, ID)
  const cc = cfg.acquisition.claude_code
  const research = cc.research
  // The platform's domains for the brief: WebSearch's own domain filter where configured, else its `site:` filters.
  const domains = cc.allowed_domains_by_platform[platform.id] ?? null
  const platformLine = domains
    ? `${platform.label} (${domains.join(', ')} — use allowed_domains ${JSON.stringify(domains)} for platform-specific searches)`
    : `${platform.label} (${platform.siteFilters.filter((f) => !f.startsWith('-')).join(' OR ')})`
  const brandContext = `${BRAND.name}: ${BRAND.positioning}. Audience: ${BRAND.audience}`
  const platformNotes = research.platform_notes[platform.id]

  function availability(): AdapterAvailability {
    const bin = resolveClaudeBinary()
    if (bin.path === null) {
      return {
        available: false,
        reason:
          `The Claude Code CLI was not found (looked in ${bin.tried}). Install Claude Code, or set ` +
          'CLAUDE_CODE_BIN in server/.env to the `claude` executable.',
      }
    }
    return { available: true, reason: '' }
  }

  /** Raw results of the searches USED — only this platform's hosts. Page type is judged by the normaliser. */
  function toCandidates(used: readonly ExecutedSearch[], requested: SearchRequest[]): SourceCandidate[] {
    const byText = new Map(requested.map((r) => [r.query.text.toLowerCase(), r]))
    const out: SourceCandidate[] = []
    for (const search of used) {
      const discovery = unscoped(search.query)
      const req = byText.get(discovery.toLowerCase())
      const perQuery = req?.maxResults ?? limits.max_results_per_query
      let taken = 0
      for (const link of search.links) {
        if (!platform.isPlatformHost(link.url)) continue
        if (taken >= perQuery) break
        taken += 1
        out.push({
          adapter: ID,
          query: discovery,
          keyword: req?.query.keyword ?? null,
          url: link.url,
          published_at: null,
          title: link.title.trim() === '' ? null : link.title.trim(),
          text: null,
          hashtags: [],
          author: null,
          engagement: null,
        })
      }
    }
    return out
  }

  async function searchBatch(reqs: SearchRequest[]): Promise<BatchOutcome> {
    const binPath = resolveClaudeBinary().path
    if (binPath === null) throw new SourceError(ID, availability().reason, true)

    const candidates: SourceCandidate[] = []
    const executed: string[] = []
    const errors: string[] = []
    const notes: string[] = []
    const claudeTrends: ClaudeTrend[] = []
    const insufficientData: string[] = []
    const searchLimitations: string[] = []
    // Read now, so an edited reference document is used on the next run without a restart.
    const refs = loadReferences(research.reference_files)
    if (refs.missing.length > 0) notes.push(`${platform.label}: reference document(s) not found and not given to Claude: ${refs.missing.join(', ')}.`)
    const systemPrompt = systemPromptWith(refs.docs, platformNotes ? { platform: platform.label, text: platformNotes } : undefined)

    // Sessions of `queries_per_session` topics, `concurrency` of them at a time.
    const chunks: SearchRequest[][] = []
    for (let i = 0; i < reqs.length; i += cc.queries_per_session) chunks.push(reqs.slice(i, i + cc.queries_per_session))
    let fatal: SourceError | null = null
    const runChunk = async (chunk: SearchRequest[]): Promise<void> => {
      if (fatal) return
      const first = chunk[0]
      const window = first?.window
      const brief: ResearchBrief = {
        keywords: [...new Set(chunk.filter((r) => r.query.kind !== 'hashtag').map((r) => topicOf(r.query.text)))],
        hashtags: [...new Set(chunk.filter((r) => r.query.kind === 'hashtag').flatMap((r) => r.query.text.match(/#[\p{L}\p{N}_]+/gu) ?? []))],
        ...(first?.month ? { month: first.month } : {}),
        ...(platformNotes ? { platformNotes } : {}),
        platforms: platformLine,
        region: research.region,
        timeWindow: first?.windowText
          ? `${first.windowText} (only activity inside this window counts as current)`
          : window
            ? `${window.from.toISOString().slice(0, 10)} to ${window.to.toISOString().slice(0, 10)} (only activity inside this window counts as current)`
            : 'the current month',
        trendCount: research.trend_count,
        brandContext,
        maxSearches: research.max_searches_per_session,
      }
      const session: ClaudeSessionResult = await runClaudeSession({
        bin: binPath,
        prompt: sessionPrompt(brief),
        systemPrompt,
        model: cc.model,
        allowedTools: cc.allowed_tools,
        maxBudgetUsd: cc.max_budget_usd_per_session,
        timeoutMs: limits.timeout_ms ?? 480_000,
      })

      // The budget is enforced on what is USED: the first N searches the session ran.
      const used = session.searches.slice(0, research.max_searches_per_session)
      if (session.searches.length > used.length) {
        notes.push(`${platform.label}: the session ran ${session.searches.length} searches; only the first ${used.length} were used (the per-session limit).`)
      }
      executed.push(...used.map((s) => unscoped(s.query)))
      candidates.push(...toCandidates(used, chunk))

      const analysis = verifiedAnalysis(session.resultText, used, platform, window?.from)
      claudeTrends.push(...analysis.trends)
      insufficientData.push(...analysis.insufficient)
      searchLimitations.push(...analysis.limitations)
      if (analysis.droppedOutsideWindow > 0) notes.push(`${platform.label}: ${analysis.droppedOutsideWindow} trend(s) Claude returned had only evidence from before the current month and were dropped (previous-month evidence cannot establish a current trend).`)
      const droppedTotal = analysis.trends.reduce((n, t) => n + t.unverifiedEvidenceDropped, 0)
      if (!analysis.parsed && !session.isError) notes.push(`${platform.label}: Claude's reply was not valid JSON, so no analysis was kept; its search results were still used.`)
      if (droppedTotal > 0) notes.push(`${platform.label}: ${droppedTotal} evidence URL(s) Claude cited were not returned by any search in the session and were dropped.`)

      if (session.isError) {
        const message = session.errorMessage ?? 'Claude Code reported an error'
        // Searches that completed before the failure are kept — they are real results.
        if (FATAL_PATTERNS.some((p) => p.test(message))) {
          fatal = new SourceError(ID, message, true)
          return
        }
        errors.push(message)
      }
    }
    const queue = [...chunks]
    await Promise.all(
      Array.from({ length: Math.max(1, Math.min(limits.concurrency, chunks.length)) }, async () => {
        for (let c = queue.shift(); c; c = queue.shift()) await runChunk(c)
      }),
    )
    if (fatal) throw fatal

    return { candidates, executed, errors, notes, claudeTrends: dedupeTrends(claudeTrends), insufficientData, searchLimitations }
  }

  async function searchOne(req: SearchRequest): Promise<SourceCandidate[]> {
    const outcome = await searchBatch([req])
    if (outcome.errors.length > 0 && outcome.candidates.length === 0) {
      throw new SourceError(ID, outcome.errors[0] ?? 'search failed')
    }
    return outcome.candidates
  }

  return {
    id: ID,
    label: `Claude Code · trend research (${platform.label})`,
    kind: 'live',
    platform,
    availability,
    search_topics: searchOne,
    search_posts: searchOne,
    search_hashtags: searchOne,
    // A single post is not searched for by URL — that would be a page fetch in disguise.
    async get_post(): Promise<SourceCandidate | null> {
      return null
    },
    searchBatch,
  }
}

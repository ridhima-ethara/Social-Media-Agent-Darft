# Competitor Intelligence (Analysis Agent)

## Purpose

Give the team source-backed visibility of the competitive field: who each competitor is, what they
claim and ship, how they price, what they publish, what is new since the last look, and what the
patterns across the market mean for Ethara. It is part of the Analysis Agent
(`analysis.competitor.intel`), beside the Social Media Listener, and replaces neither it nor
`analysis.competitor.compare` (the pipeline's topic-saturation check).

```
Competitor Universe (P0/P1, configurable)
  → Research       the competitor-profiling skill's tools, answered by SMA sources
  → Profile        Claude, following the skill's methodology and template
  → Changes        versus the previous profile version
  → Market         cross-competitor analysis, trends, gaps, Ethara implications
  → Storage        versioned profiles, market reports, raw data per day
```

## Methodology

The research and profile methodology is the **`competitor-profiling`** skill (and, for comparison,
the principles of **`competitors`**) from `github.com/coreyhaines31/marketingskills`. Only those two
skills are vendored, in `packages/marketing-skills/`, pinned by `SOURCE.json` (repository, commit,
synced date) and refreshed with `npm run marketing-skills:sync [-- <commit>]`. The adapter
(`server/src/agents/analysis/competitor-intel/marketing-skills.ts`) reads them at run time, so a sync
changes the methodology without a code change.

The skill's tools are bound to SMA sources (shown on the tab):

| Skill tool | SMA source |
|---|---|
| `firecrawl_map` | robots.txt-checked `sitemap.xml` + homepage links → key pages by path |
| `firecrawl_scrape` | robots.txt-checked page fetch → readable text |
| `firecrawl_search` | Bing News RSS naming the competitor + the competitor's own blog feed, dated by the feed |
| DataForSEO (`domain_rank_overview`, `backlinks_summary`, `relevant_pages`, `competitors_domain`) | DataForSEO REST with `DATAFORSEO_LOGIN` / `DATAFORSEO_PASSWORD` (the API password) |

Plus the competitor's Wikipedia article and G2 / Capterra / TrustRadius / Product Hunt pages when
their URLs are in the competitor's links.

## Inputs

- The `competitors` table: name, tier (P0/P1), category, focus, website, links, keywords, status,
  monitoring frequency. Seeded once from `universe.seed.json`; edited in the app or via
  `/api/analysis/competitors` — never in code.
- Ethara's product context (`shared/brand-voice.ts`).
- The knobs: depth (quick / deep), pages per competitor, news window, SEO and reviews on/off, market
  analysis on/off, concurrency, due competitors per pipeline run, Claude model and budgets.

## Outputs

- `competitor_profiles` — one row per competitor per version: the skill's template (Overview, At a
  Glance, Positioning & Messaging, Target Audience, Product & Features, Pricing, Content Strategy,
  SEO / Market Presence, Customer / Review Signals, Strengths, Weaknesses, Competitive Implications,
  Recent Developments, Sources, Generated date), plus `changes` against the previous version.
- `competitor_market_reports` — landscape, capability analysis (Company → Capability → Evidence →
  Source), emerging and content trends, market gaps, positioning patterns, and the Ethara analysis.
- The normalized `competitor_intelligence` object (spec §11) from `GET /api/analysis/competitors`.
- Raw data per competitor per day in `server/data/competitor-profiles/raw/<slug>/<YYYY-MM-DD>/`
  (`scrapes/`, `seo/`, `reviews/`), as the skill lays it out.

## Rules

1. Every claim carries a kind — `fact`, `source_derived`, `inference`, `analysis` — and the ids of
   the sources it rests on. A fact or source-derived claim whose ids are not real sources is
   relabelled inference. At a Glance holds only sourced facts; anything else reads
   "Not available from current sources".
2. Prices are kept only with a source; SEO figures only from DataForSEO; recent developments only
   with a dated source, dated by that source.
3. No scores, rankings, "best / #1 / winner" language — such statements are dropped.
4. Gaps are worded as observed / potential / limited evidence, with a confidence.
5. robots.txt is obeyed for the SMA's own agent; a page that answers 401/403/429 is reported, never
   worked around. Fetched text is untrusted evidence; instruction-like passages are counted and
   ignored.
6. Re-runs check volatile data first (pricing, product, announcements, content), then SEO, and diff
   against the previous version.

## Boundaries

- Never bypasses authentication, CAPTCHA, bot protection, robots.txt, rate limits or private content.
- Never scores, ranks or declares a winner among competitors.
- Never invents traffic, funding, customers, pricing, engagement, capabilities, reviews or market
  position; a value no source gave is "Not available from current sources".
- Never installs or runs the rest of the marketingskills repository — only the two vendored skills.
- Writes no content, calendar or post; it informs them.

## Running

- The Analysis → Competitor Intelligence tab: Run P0, Run due, Run all active, or ▶ one competitor;
  runs in the background, the tab polls `/api/analysis/competitors/status`.
- `COMPETITOR_MONITOR_CRON` (blank = off) profiles the competitors due by their monitoring frequency.
- Inside a pipeline run: at most `maxCompetitorsPerPipelineRun` due competitors (0 by default).

## Failure modes

- A site that blocks bots, no pricing page, no Wikipedia link, no review page → stated per
  competitor under the profile's sources; the profile covers what could be read.
- DataForSEO missing or rejected → the SEO block says why.
- Claude unavailable or out of shape → the profile lists its sources with the error; the previous
  version stays readable.

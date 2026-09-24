# ADR-019 · Competitor Intelligence in the Analysis Agent

**Status:** accepted · 2026-09-24

## Context

The team asked for visibility of competitors inside the Analysis Agent, using the
`competitor-profiling` skill from `coreyhaines31/marketingskills` as the research methodology rather
than a home-grown framework, with a configurable P0/P1 universe, source-backed profiles, cross-market
analysis, change tracking and no fabricated metrics or rankings.

## Decision

1. **Methodology as vendored data.** Only `competitor-profiling` and `competitors` are copied into
   `packages/marketing-skills/` with `SOURCE.json` and the MIT licence; `npm run
   marketing-skills:sync` refreshes them. An adapter reads them at run time; nothing else imports the
   skill files.
2. **The skill's tools are answered by SMA sources.** Firecrawl is not used: map/scrape become a
   robots.txt-obeying fetch of the sitemap and key pages; search becomes dated news feeds. DataForSEO
   is called only with credentials. The mapping is shown in the UI.
3. **Claude writes, the SMA verifies.** Claude (no tools) returns the profile as JSON; the server
   keeps a claim only with valid source ids (else relabels it inference), keeps prices only with a
   source, dates developments by their source, and drops ranking language.
4. **The universe is a table** (`competitors`), seeded once, edited through the API/UI.
5. **Profiles are versioned** (`competitor_profiles`) and diffed deterministically.
6. **Runs are background jobs** with a polled status; a scheduled monitor is opt-in
   (`COMPETITOR_MONITOR_CRON`), and pipeline runs profile none by default.

## Consequences

- Sites behind bot protection (openai.com answers 403) are profiled from Wikipedia and news only.
- SEO sections read "Not available from current sources" until valid DataForSEO API credentials are set.
- A new competitor, category or source URL needs no code change; a new data source is one reader in
  `sources.ts` plus a binding in `marketing-skills.ts`.

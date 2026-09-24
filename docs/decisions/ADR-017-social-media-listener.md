# ADR-017 — The Analysis Agent listens to Ethara.AI's own channels through SocialFetch

**Status:** Accepted · **Date:** 2026-09-24

## Context

The operator wants to know what is happening around Ethara.AI on its own social channels, and what
people are saying about the company. The Scraping Agent answers a different question: what is
trending about Ethara's topics. It runs on the Claude Bridge's web search, which returns no
engagement and no comments. SocialFetch (`api.socialfetch.dev`) returns public profiles, posts,
engagement and comments for LinkedIn, Instagram, Facebook and X under one API key.

## Decision

1. **A new non-critical Analysis Agent skill, `analysis.social.listen`.** Its implementation is in
   `server/src/agents/analysis/social-listener/`, with one SocialFetch adapter per platform. Its
   spec is `packages/skills/social-media-listener/SKILL.md`.
2. **SocialFetch is its only data source.** The client is `server/src/integrations/socialfetch.ts`.
   The key is `SOCIALFETCH_API_KEY` in `server/secrets.env`, and it is never in code.
3. **Routes used:**
   - LinkedIn: `/v1/linkedin/companies`, `/v2/linkedin/organizations/{id}/posts` and
     `/v2/linkedin/activities/{id}/comments`. The v1 post list states no engagement, so the v2
     routes are used, at 3 credits each.
   - Instagram: `/v1/instagram/profiles/{handle}`, `/v1/instagram/profiles/{handle}/posts` and
     `/v1/instagram/posts/comments`.
   - X: `/v1/twitter/profiles/{handle}`, `/v1/twitter/profiles/{handle}/tweets` and
     `/v1/twitter/tweets/replies`.
   - Facebook: `/v1/facebook/profiles`, `/v1/facebook/profiles/posts` and
     `/v1/facebook/posts/comments`.
4. **Targets:**
   - LinkedIn `ethara-ai`
   - Instagram `ethara.ai`
   - X `EtharaAi` (found through SocialFetch's people search)
   - Facebook: the page URL the operator supplied (`facebook.com/people/Ethara-AI/pfbid0Mzf…`).
     The guesses `facebook.com/ethara.ai` and `facebook.com/etharaai` had both returned
     `not_found`.
5. **Claude** reads comments and writes insights through a headless, tool-less Claude Code call
   (`runClaudeText`). Engagement, rates, rankings, topics and sentiment counts are computed.
6. **Reports** are stored in `social_listener_reports`, one row per run and never overwritten. The
   latest is on `/api/state` as `socialListener`. It is also served by `GET /api/analysis/social-listener`,
   and `POST /api/analysis/social-listener/run` runs the listener fresh.
7. **UI:**
   - the Dashboard's "Content Intelligence" (Knowledge Base) card is replaced by an **Analysis**
     card, which opens the full report;
   - the full **Social Media Listener** section heads Content Intelligence → AI Analysis.

## Consequences

- A full run costs about 20–35 SocialFetch credits: LinkedIn's comment calls are 3 each, and
  everything else is 1. Claude costs about $0.05–0.25. Inside a pipeline run, a report under
  `refreshHours` (default 24) is reused.
- The first live run found 21 posts and 63 comments. SocialFetch then reported insufficient
  credits partway through. The report says so, and later calls in that run are skipped.

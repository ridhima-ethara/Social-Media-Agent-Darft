/**
 * THE ACTOR INDEX — transcribed from the official skill, not invented here.
 *
 * Source: `apify/agent-skills` → `skills/apify-ultimate-scraper/references/
 * actor-index.md`. Every id below appears verbatim in that file and was
 * confirmed to resolve against `apify actors info` before being written down.
 *
 * WHY A CURATED MAP AT ALL, when the skill also documents a dynamic search.
 *
 * The skill's own Step 1 reads the index FIRST and falls back to
 * `apify actors search` only when nothing matches. That order matters here for
 * a reason the skill does not have to care about: this is a server, not an
 * interactive agent session. A run that picks a different actor each time is a
 * run whose results cannot be compared with last week's, and `keyword_signals`
 * exists precisely to compare weeks. So the index is the stable default and
 * search is the documented fallback — the same precedence, for a stronger
 * reason.
 *
 * WHAT IS DELIBERATELY NOT HERE. No input schemas. The skill is explicit that a
 * schema is fetched with `apify actors info --input` at call time, because an
 * actor's input is its author's to change and a copy here would be a second
 * source of truth that silently goes stale. `buildInput()` in `apify-cli.ts`
 * reads the live schema and constructs against it.
 */

import type { Platform } from '../../../../shared/agent-contract'

/** What a lane wants to do, which is what actually selects an actor. */
export type ScrapeIntent = 'keyword' | 'account' | 'hashtag'

export interface ActorChoice {
  /** The Apify id, owner-qualified, as the index spells it. */
  actorId: string
  /** Why this one — rendered into the run log, never inferred by a reader. */
  because: string
  /** The search terms used if this actor cannot be resolved (skill Step 1 fallback). */
  searchTerms: string
}

/**
 * The platforms this product can capture.
 *
 * `Platform` is a closed union of four (ADR-006). `youtube` and `tiktok` are
 * reachable through this service and are NOT members of that union — they are
 * capture sources whose results are normalised like any other, and nothing
 * downstream switches on them. Adding either as a publishable `Platform` is a
 * separate change with a much wider blast radius.
 */
export type ScrapeTarget = Platform | 'youtube' | 'tiktok'

/**
 * One entry per (platform, intent). Intent first, because "posts by hashtag"
 * and "posts by this account" are different actors on every platform, and
 * picking one actor per platform is exactly the hardcoding this replaces.
 */
const INDEX: Record<ScrapeTarget, Partial<Record<ScrapeIntent, ActorChoice>>> = {
  instagram: {
    hashtag: {
      actorId: 'apify/instagram-hashtag-scraper',
      because: 'posts by hashtag, with engagement counts',
      searchTerms: 'instagram hashtag posts',
    },
    account: {
      actorId: 'apify/instagram-post-scraper',
      because: 'posts for named profiles, with engagement metrics',
      searchTerms: 'instagram profile posts',
    },
    keyword: {
      actorId: 'apify/instagram-scraper',
      because: 'the general Instagram actor, which accepts search terms',
      searchTerms: 'instagram search posts',
    },
  },
  facebook: {
    keyword: {
      actorId: 'apify/facebook-search-scraper',
      because: 'page and post search',
      searchTerms: 'facebook post search',
    },
    account: {
      actorId: 'apify/facebook-posts-scraper',
      because: 'posts for named pages, with engagement',
      searchTerms: 'facebook page posts',
    },
    hashtag: {
      actorId: 'apify/facebook-hashtag-scraper',
      because: 'posts carrying a hashtag',
      searchTerms: 'facebook hashtag posts',
    },
  },
  x: {
    keyword: {
      actorId: 'apidojo/tweet-scraper',
      because: 'tweet search by term',
      searchTerms: 'twitter tweet search',
    },
    account: {
      actorId: 'apidojo/twitter-profile-scraper',
      because: 'profiles with their recent tweets',
      searchTerms: 'twitter profile tweets',
    },
  },
  linkedin: {
    keyword: {
      actorId: 'harvestapi/linkedin-post-search',
      because: 'post search by term',
      searchTerms: 'linkedin post search',
    },
    account: {
      actorId: 'harvestapi/linkedin-company-posts',
      because: 'posts published by a named company page',
      searchTerms: 'linkedin company posts',
    },
  },
  youtube: {
    keyword: {
      actorId: 'streamers/youtube-scraper',
      because: 'videos with their metrics, by search term',
      searchTerms: 'youtube video search',
    },
    hashtag: {
      actorId: 'streamers/youtube-video-scraper-by-hashtag',
      because: 'videos carrying a hashtag',
      searchTerms: 'youtube hashtag videos',
    },
    account: {
      actorId: 'streamers/youtube-channel-scraper',
      because: 'a channel and its uploads',
      searchTerms: 'youtube channel videos',
    },
  },
  tiktok: {
    keyword: {
      actorId: 'clockworks/tiktok-scraper',
      because: 'the general TikTok actor, which accepts search terms',
      searchTerms: 'tiktok search videos',
    },
    hashtag: {
      actorId: 'clockworks/tiktok-hashtag-scraper',
      because: 'videos by hashtag',
      searchTerms: 'tiktok hashtag videos',
    },
    account: {
      actorId: 'clockworks/tiktok-profile-scraper',
      because: 'a profile and its videos',
      searchTerms: 'tiktok profile videos',
    },
  },
}

/**
 * The indexed actor for a lane, or `null` when the index has none.
 *
 * `null` is a real answer and the caller must handle it by searching, which is
 * the skill's documented fallback. It is never a reason to substitute a
 * different platform's actor.
 */
export function indexedActor(
  target: ScrapeTarget,
  intent: ScrapeIntent,
): ActorChoice | null {
  const perPlatform = INDEX[target]
  return perPlatform[intent] ?? perPlatform.keyword ?? null
}

/** Every id the index names, for the doctor check that resolves them. */
export function allIndexedActorIds(): string[] {
  const ids = new Set<string>()
  for (const perPlatform of Object.values(INDEX)) {
    for (const choice of Object.values(perPlatform)) ids.add(choice.actorId)
  }
  return [...ids].sort()
}

export const SCRAPE_TARGETS = Object.keys(INDEX) as ScrapeTarget[]

/**
 * A PLATFORM MODULE — everything the bridge knows about one social platform.
 *
 * The acquisition adapters, the processing pipeline and the output formatter
 * are platform-agnostic. What differs per platform is small and lives here:
 * which hosts count as the platform, which URLs are individual posts, how a
 * URL is canonicalised for de-duplication, whether a URL carries a verifiable
 * timestamp, and the search filter that scopes a web search to the platform.
 *
 * Adding Instagram, X or Facebook later means writing one of these and
 * registering it in `platforms/index.ts` — nothing else changes.
 */

/** The four social platforms, plus `web` — the open web, served by the same bridge. */
export type PlatformId = 'linkedin' | 'instagram' | 'x' | 'facebook' | 'web'

export const PLATFORM_IDS: readonly PlatformId[] = ['linkedin', 'instagram', 'x', 'facebook', 'web']

export type ContentType = 'post' | 'article' | 'unknown'

export interface ClassifiedUrl {
  /** Canonical form used as the de-duplication key and returned as `post_url`. */
  canonical: string
  /** The platform's own id for the item, when the URL carries one. */
  itemId: string | null
  contentType: ContentType
}

export interface PlatformModule {
  readonly id: PlatformId
  readonly label: string
  /**
   * Returns the canonical URL and content type when `url` is an individual
   * post or article on this platform, `null` otherwise (profiles, company
   * pages, job listings, search pages, other hosts). The bridge only ever
   * reports URLs this accepts.
   */
  classifyUrl(url: string): ClassifiedUrl | null
  /** True when the URL is on one of this platform's hosts, whatever the page type. */
  isPlatformHost(url: string): boolean
  /**
   * A publication timestamp the platform itself encodes in the item id, or
   * `null`. Must be a decoding, never an estimate.
   */
  dateFromItemId(itemId: string): Date | null
  /**
   * The author's public handle when the post URL itself carries it, or `null`.
   * Read from the URL only — it is part of the address already returned.
   */
  authorHandleFromUrl(url: string): string | null
  /** Search-engine operators that scope a web search to this platform's posts. */
  readonly siteFilters: readonly string[]
  /**
   * Whether the bridge may read an item's own page for its published date.
   * Only where the site's robots.txt allows it; the social platforms disallow
   * generic crawlers, so only the open web sets this.
   */
  readonly readsPageDates: boolean
  /**
   * Whether a search result on this platform can be given a verified date at
   * all (from its id, URL or page). False for Facebook: its ids carry no time.
   */
  readonly canDateItems: boolean
}

/**
 * GLASSDOOR — the employer half of the Social Media Listener, read through
 * FetchLayer (https://fetchlayer.dev).
 *
 * What do people who worked at Ethara.AI say about the company? FetchLayer
 * returns the Glassdoor employer profile (overall rating, recommend %, CEO
 * approval, category ratings) and its recent reviews (pros, cons, advice,
 * stars). This module turns that JSON into `GlassdoorAnalysis` WITHOUT inventing
 * anything: an absent figure is `null`, never a measured zero, exactly as the
 * platform sources do.
 *
 * It is non-fatal and self-contained: a missing key, a not-found employer or a
 * FetchLayer error is reported as the block's `status`/`reason`, and the rest
 * of the listener is unaffected.
 *
 * Themes and sentiment are COMPUTED from the reviews read — a con that recurs is
 * counted, a quote is lifted verbatim. Nothing here is a model's opinion; the
 * figures are Glassdoor's and the groupings are arithmetic.
 */

import { fetchLayerConfigured, fetchLayerPost, fetchLayerUnavailableReason } from '../../../integrations/fetchlayer'
import type { GlassdoorAnalysis, GlassdoorReview, GlassdoorTheme, Sentiment, SentimentCounts } from './types'

/* ── tolerant readers (an absent figure is null, never 0) ───────────────── */

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}
function arr(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function str(v: unknown): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v.trim() : null
}
/** A stated finite number in [min,max], or null. Numeric strings count. */
function num(v: unknown, min = -Infinity, max = Infinity): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) && n >= min && n <= max ? n : null
}
/** A percentage: accepts 0–1 (a fraction) or 0–100, normalises to 0–100, or null. */
function pct(v: unknown): number | null {
  const n = num(v, 0, 100)
  if (n === null) {
    const frac = num(v, 0, 1)
    return frac === null ? null : Math.round(frac * 100)
  }
  return Math.round(n)
}
/** A documented 0–1 rate (FetchLayer's `…Rate` fields) as a 0–100 percentage, or null. */
function fromFraction(v: unknown): number | null {
  const n = num(v, 0, 1)
  return n === null ? null : Math.round(n * 100)
}
/** First stated string among several candidate keys. */
function pick(row: Record<string, unknown>, ...keys: string[]): string | null {
  for (const k of keys) {
    const s = str(row[k])
    if (s !== null) return s
  }
  return null
}
function pickNum(row: Record<string, unknown>, keys: string[], min = -Infinity, max = Infinity): number | null {
  for (const k of keys) {
    const n = num(row[k], min, max)
    if (n !== null) return n
  }
  return null
}
function round1(n: number): number {
  return Math.round(n * 10) / 10
}

/* ── normalisation ──────────────────────────────────────────────────────── */

function normalizeReview(raw: unknown): GlassdoorReview | null {
  if (!isRecord(raw)) return null
  const review: GlassdoorReview = {
    rating: pickNum(raw, ['ratingOverall', 'rating', 'overallRating', 'stars'], 1, 5),
    title: pick(raw, 'title', 'summary', 'headline'),
    // FetchLayer states `isCurrentJob`; the role label is derived from it, nothing more.
    reviewerRole:
      raw.isCurrentJob === true ? 'Current employee' : raw.isCurrentJob === false ? 'Former employee' : pick(raw, 'reviewerRole', 'employmentStatus'),
    jobTitle: pick(raw, 'jobTitle', 'jobTitleText', 'role', 'position'),
    location: pick(raw, 'location', 'locationName', 'city'),
    pros: pick(raw, 'pros', 'prosText', 'positives'),
    cons: pick(raw, 'cons', 'consText', 'negatives'),
    advice: pick(raw, 'advice', 'adviceToManagement', 'adviceText'),
    publishedAt: pick(raw, 'reviewedAt', 'publishedAt', 'reviewDateTime', 'date', 'reviewDate', 'createdAt'),
    sentiment: null,
    url: pick(raw, 'url', 'link', 'reviewUrl'),
  }
  // A review with no text and no rating is not evidence of anything.
  if (review.rating === null && review.pros === null && review.cons === null && review.title === null) return null
  // A rating alone gives an honest sentiment; text is read by the theme pass below.
  review.sentiment = ratingSentiment(review.rating)
  return review
}

/** ≥4 stars is positive, ≤2 negative, 3 neutral. Null rating → null sentiment. */
function ratingSentiment(rating: number | null): Sentiment | null {
  if (rating === null) return null
  if (rating >= 4) return 'positive'
  if (rating <= 2) return 'negative'
  return 'neutral'
}

function sentimentCounts(reviews: readonly GlassdoorReview[]): SentimentCounts | null {
  const rated = reviews.filter((r) => r.sentiment !== null)
  if (rated.length === 0) return null
  const positive = rated.filter((r) => r.sentiment === 'positive').length
  const neutral = rated.filter((r) => r.sentiment === 'neutral').length
  const negative = rated.filter((r) => r.sentiment === 'negative').length
  const asPct = (n: number): number => round1((n / rated.length) * 100)
  return {
    positive,
    neutral,
    negative,
    classified: rated.length,
    positive_percent: asPct(positive),
    neutral_percent: asPct(neutral),
    negative_percent: asPct(negative),
  }
}

/**
 * Recurring themes from a set of free-text fields (all pros, or all cons).
 *
 * Deliberately simple and honest: it counts which short noun phrases from a
 * small domain vocabulary appear, so "work-life balance" mentioned in six
 * reviews reads as a theme of weight six. It never paraphrases or invents — the
 * example quote is a verbatim slice of a real review.
 */
const THEME_VOCAB: Array<{ label: string; cues: RegExp }> = [
  { label: 'work-life balance', cues: /work[\s-]?life|hours|overtime|burn ?out|flexib|remote/i },
  { label: 'compensation & benefits', cues: /pay|salary|compensation|benefit|equity|bonus|stock/i },
  { label: 'management & leadership', cues: /manage|leadership|leaders?\b|executive|ceo|director/i },
  { label: 'culture', cues: /culture|team|colleague|people|environment|friendly|toxic/i },
  { label: 'career growth', cues: /career|growth|promot|learning|mentor|develop/i },
  { label: 'work itself', cues: /interesting work|challeng|projects?|technical|impact|mission/i },
  { label: 'communication', cues: /communicat|transparen|feedback|clarity|direction/i },
  { label: 'stability', cues: /stab|layoff|funding|runway|startup risk|uncertain/i },
]

function themesFrom(reviews: readonly GlassdoorReview[], field: 'pros' | 'cons'): GlassdoorTheme[] {
  const out: GlassdoorTheme[] = []
  for (const { label, cues } of THEME_VOCAB) {
    const hits = reviews.filter((r) => (r[field] ?? '') !== '' && cues.test(r[field] as string))
    if (hits.length === 0) continue
    const first = hits.find((r) => (r[field] ?? '').length > 0)?.[field] ?? null
    out.push({
      label,
      count: hits.length,
      example: first ? excerpt(first, 120) : null,
    })
  }
  return out.sort((a, b) => b.count - a.count)
}

function excerpt(text: string, n = 120): string {
  const flat = text.normalize('NFKC').replace(/\s+/g, ' ').trim()
  return flat.length > n ? `${flat.slice(0, n - 1)}…` : flat
}

/* ── the read ───────────────────────────────────────────────────────────── */

export interface GlassdoorConfig {
  /** Employer name, Glassdoor URL, or employer id — whatever FetchLayer takes. Empty = skip. */
  employer: string
  /** How many recent reviews to read (drives the sample the themes rest on). */
  reviewLimit: number
}

function unavailable(status: GlassdoorAnalysis['status'], reason: string, employer: string | null): GlassdoorAnalysis {
  return {
    status,
    reason,
    employer,
    employerUrl: null,
    overall_rating: null,
    review_count: null,
    recommend_percent: null,
    ceo_approval_percent: null,
    category_ratings: [],
    sentiment: null,
    pros_themes: [],
    cons_themes: [],
    recent_reviews: [],
    reviews_analyzed: 0,
    credits_used: 0,
    insights: [],
  }
}

/**
 * Reads Glassdoor for one employer through FetchLayer and returns the analysis.
 *
 * Never throws: every failure becomes a stated `status`/`reason`. The route
 * shape follows FetchLayer's documented Glassdoor endpoints; `data` is read
 * tolerantly so a field rename degrades to `null` rather than a crash.
 */
export async function fetchGlassdoor(cfg: GlassdoorConfig): Promise<GlassdoorAnalysis> {
  const employer = cfg.employer.trim()
  if (employer === '') {
    return unavailable('not_configured', 'No Glassdoor employer is configured, so Glassdoor was not read.', null)
  }
  if (!fetchLayerConfigured()) {
    return unavailable('not_configured', fetchLayerUnavailableReason() ?? 'FetchLayer is not configured.', employer)
  }

  let credits = 0

  // 0 · which Glassdoor employer. A numeric id or a Glassdoor URL (…EI_IE123….htm)
  //     is used as given; a name is searched, and the closest-named listing with
  //     the most reviews is read. Any other match is named in the report.
  const idFromUrl = employer.match(/EI_IE(\d+)/)?.[1] ?? null
  let employerId: string | null = /^\d+$/.test(employer) ? employer : idFromUrl
  let employerUrl: string | null = /^https?:\/\//.test(employer) ? employer : null
  let other_listings: NonNullable<GlassdoorAnalysis['other_listings']> = []
  if (employerId === null) {
    const search = await fetchLayerPost('/glassdoor/search-companies', { query: employer, limit: 10 })
    credits += search.creditsCharged
    if (search.status !== 'found' || !search.data) {
      return { ...unavailable(search.status === 'not_found' ? 'not_found' : 'error', search.reason ?? 'FetchLayer could not search Glassdoor.', employer), credits_used: credits }
    }
    const wanted = normaliseName(employer)
    const companies = arr(search.data.companies)
      .filter(isRecord)
      .map((c) => ({
        employerId: str(c.employerId) ?? '',
        name: str(c.name) ?? '',
        rating: num(c.overallRating, 0, 5),
        reviewCount: num(c.reviewCount, 0),
        url: str(c.glassdoorUrl) ?? str(c.reviewsUrl),
      }))
      .filter((c) => c.employerId !== '')
    const named = companies.filter((c) => normaliseName(c.name) === wanted || normaliseName(c.name).startsWith(wanted) || wanted.startsWith(normaliseName(c.name)))
    const pickFrom = named.length > 0 ? named : []
    const best = [...pickFrom].sort((a, b) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))[0]
    if (!best) {
      return { ...unavailable('not_found', `Glassdoor has no employer named like “${employer}”.`, employer), credits_used: credits }
    }
    employerId = best.employerId
    employerUrl = best.url
    other_listings = named.filter((c) => c.employerId !== best.employerId)
  }

  // 1 · the employer profile (ratings, recommend %, CEO approval, outlook).
  const profileRes = await fetchLayerPost('/glassdoor/company-profile', { company: employerId })
  credits += profileRes.creditsCharged
  if (profileRes.status === 'not_found') {
    return { ...unavailable('not_found', profileRes.reason ?? `Glassdoor has no employer ${employerId}.`, employer), credits_used: credits }
  }
  if (profileRes.status === 'error') {
    return { ...unavailable('error', profileRes.reason ?? 'FetchLayer failed to read the Glassdoor employer.', employer), credits_used: credits }
  }
  const profileRoot = profileRes.data ?? {}
  const profile = isRecord(profileRoot.profile) ? profileRoot.profile : profileRoot
  const employerName = pick(profile, 'name', 'employerName', 'companyName') ?? employer
  employerUrl = employerUrl ?? pick(profileRoot, 'requestedUrl')

  // 2 · recent reviews, newest first.
  const reviewsRes = await fetchLayerPost('/glassdoor/company-reviews', { company: employerId, limit: cfg.reviewLimit, sortBy: 'date', sortDirection: 'desc' })
  credits += reviewsRes.creditsCharged
  const reviewData = reviewsRes.data ?? {}
  const rawReviews = arr(isRecord(reviewData) ? reviewData.reviews : [])
  const reviews = rawReviews
    .map(normalizeReview)
    .filter((r): r is GlassdoorReview => r !== null)
    .map((r) => ({ ...r, url: r.url ?? pick(reviewData, 'requestedUrl') }))
    .sort((a, b) => (b.publishedAt ?? '').localeCompare(a.publishedAt ?? ''))
    .slice(0, Math.max(0, cfg.reviewLimit))

  // Category ratings, only the ones Glassdoor actually stated (overall is shown separately).
  const categorySource = isRecord(profile.ratings) ? profile.ratings : isRecord(profile.categoryRatings) ? profile.categoryRatings : {}
  const category_ratings = Object.entries(categorySource)
    .filter(([label]) => label !== 'overall')
    .map(([label, v]) => ({ label: humanise(label), rating: num(v, 0, 5) }))
    .filter((c) => c.rating !== null)
  const ratings = isRecord(profile.ratings) ? profile.ratings : {}
  const sentiment = sentimentCounts(reviews)
  const analysis: GlassdoorAnalysis = {
    status: 'ok',
    reason: null,
    employer: employerName,
    employerUrl,
    overall_rating: num(ratings.overall, 0, 5) ?? pickNum(profile, ['overallRating', 'rating', 'overall'], 0, 5),
    review_count: pickNum(profile, ['reviewCount', 'reviewsCount', 'totalReviews'], 0),
    // FetchLayer states these as fractions 0–1; `pct` normalises to 0–100.
    recommend_percent: fromFraction(profile.recommendToFriendRate) ?? pct(profile.recommendToFriend ?? profile.recommendPercent),
    ceo_approval_percent: fromFraction(profile.ceoApprovalRate) ?? pct(profile.ceoApproval ?? profile.ceoApprovalPercent),
    category_ratings,
    sentiment,
    pros_themes: themesFrom(reviews, 'pros'),
    cons_themes: themesFrom(reviews, 'cons'),
    recent_reviews: reviews,
    reviews_analyzed: reviews.length,
    credits_used: credits,
    insights: [],
    employer_id: employerId,
    other_listings,
    business_outlook_percent: fromFraction(profile.businessOutlookRate),
    read_at: pick(profileRoot, 'scrapedAt'),
  }
  analysis.insights = computeInsights(analysis)
  return analysis
}

/** "Ethara.AI" and "Ethara AI" are the same name for matching purposes. */
function normaliseName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]/gu, '')
}

function humanise(key: string): string {
  return key
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/[_-]+/g, ' ')
    .toLowerCase()
    .replace(/^\w/, (c) => c.toUpperCase())
}

/** Plain-language takeaways, computed from the figures — no model, no invention. */
function computeInsights(a: GlassdoorAnalysis): string[] {
  const out: string[] = []
  if (a.overall_rating !== null) {
    out.push(
      `Employees rate ${a.employer ?? 'the company'} ${a.overall_rating}/5 on Glassdoor` +
        (a.review_count !== null ? ` across ${a.review_count} review${a.review_count === 1 ? '' : 's'}.` : '.'),
    )
  }
  if (a.recommend_percent !== null) out.push(`${a.recommend_percent}% would recommend it to a friend.`)
  if (a.ceo_approval_percent !== null) out.push(`${a.ceo_approval_percent}% approve of the CEO.`)
  const topPro = a.pros_themes[0]
  if (topPro) out.push(`The most common positive is ${topPro.label} (${topPro.count} review${topPro.count === 1 ? '' : 's'}).`)
  const topCon = a.cons_themes[0]
  if (topCon) out.push(`The most common concern is ${topCon.label} (${topCon.count} review${topCon.count === 1 ? '' : 's'}).`)
  if (a.sentiment) {
    out.push(
      `Of ${a.sentiment.classified} rated review${a.sentiment.classified === 1 ? '' : 's'} read, ` +
        `${a.sentiment.positive_percent}% are positive and ${a.sentiment.negative_percent}% negative (a small-sample signal).`,
    )
  }
  if (a.business_outlook_percent !== null && a.business_outlook_percent !== undefined) {
    out.push(`${a.business_outlook_percent}% have a positive six-month business outlook.`)
  }
  for (const o of a.other_listings ?? []) {
    out.push(
      `A second Glassdoor listing named “${o.name}” also exists` +
        (o.rating !== null ? ` (${o.rating}/5` + (o.reviewCount !== null ? ` from ${o.reviewCount} review${o.reviewCount === 1 ? '' : 's'})` : ')') : '') +
        ' — it was not read; set the Glassdoor employer to its URL to read that one instead.',
    )
  }
  if (out.length === 0) out.push('Glassdoor returned an employer profile but no figures this run.')
  return out
}

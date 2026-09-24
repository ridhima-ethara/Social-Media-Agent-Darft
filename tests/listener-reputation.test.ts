import { describe, expect, it } from 'vitest'
import { reputationStatus } from '../server/src/agents/analysis/social-listener/reputation'

describe('reputation status', () => {
  it('is insufficient without enough classified feedback', () => {
    expect(reputationStatus({ comments_classified: 0, reviews_rated: 0, positive: 0, neutral: 0, negative: 0 })).toEqual({ status: 'insufficient_data', net: null })
    expect(reputationStatus({ comments_classified: 3, reviews_rated: 0, positive: 3, neutral: 0, negative: 0 }).status).toBe('insufficient_data')
  })
  it('computes net sentiment and the status from it', () => {
    expect(reputationStatus({ comments_classified: 33, reviews_rated: 10, positive: 42, neutral: 1, negative: 0 })).toEqual({ status: 'positive', net: 98 })
    expect(reputationStatus({ comments_classified: 10, reviews_rated: 0, positive: 4, neutral: 2, negative: 4 })).toEqual({ status: 'mixed', net: 0 })
    expect(reputationStatus({ comments_classified: 10, reviews_rated: 0, positive: 1, neutral: 2, negative: 7 })).toEqual({ status: 'negative', net: -60 })
  })
})

import { describe, expect, it } from 'vitest'
import { cleanHashtags, cleanTerms, papersOf } from '../../server/src/bridges/claude-bridge/context/corpus-topics'
import { platformSearches } from '../../server/src/bridges/claude-bridge/trends/platform-trends'

const entry = (title: string, content: string, category = 'Brand Corpus') => ({ id: title, title, category, content, tags: [] })

describe('the research corpus as a search reference', () => {
  it('groups sections into papers, opening from part 1, skipping brand seed entries', () => {
    const papers = papersOf([
      entry('Rubrics as Rewards.pdf · part 2', 'second'),
      entry('Rubrics as Rewards.pdf · part 1', 'We propose rubrics as rewards'),
      entry('SWE-smith Scaling Data_compressed.pdf · part 1', 'SWE-smith'),
      entry('Domain · post-training and alignment', 'seed'),
      entry('Some signal', 'x', 'Signals'),
    ])
    expect(papers.map((p) => p.title)).toEqual(['Rubrics as Rewards', 'SWE-smith Scaling Data'])
    expect(papers[0]?.opening).toBe('We propose rubrics as rewards')
  })

  it('keeps short, distinct terms that are not already keywords', () => {
    expect(cleanTerms(['#Rubrics as rewards', 'rubrics as rewards', 'RLVR', 'a very long search term that no one would type', 'SWE-bench'], 10, new Set(['rlvr']))).toEqual(['Rubrics as rewards', 'SWE-bench'])
    expect(cleanHashtags(['LLM Evaluation', '#RLHF', '#x'], 5)).toEqual(['#LLMEvaluation', '#RLHF'])
  })

  it('gives the corpus topics their own searches beside the keyword searches', () => {
    const kw = (term: string) => ({ term, weight: 1, category: 'core', synonyms: [], scheduled: null })
    const plan = platformSearches([kw('RLVR'), kw('post-training')], 5, {
      maxWords: 2,
      corpusTerms: ['rubrics as rewards', 'SWE-bench'],
      hashtags: ['#LLMEvaluation'],
      hashtagTerms: 4,
      fixedShare: 0.5,
      rotation: 0,
    })
    expect(plan.map((q) => q.kind)).toEqual(['post', 'post', 'post', 'post', 'hashtag'])
    expect(plan.map((q) => q.text).slice(0, 4)).toEqual(['RLVR', '"post-training"', '"rubrics as rewards"', '"SWE-bench"'])
  })
})

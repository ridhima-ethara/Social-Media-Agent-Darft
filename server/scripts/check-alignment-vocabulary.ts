/**
 * Verifies what the Scraping Agent will actually judge a captured page against,
 * read from the live database rather than asserted.
 *
 * Mirrors `loadAlignmentVocabulary` in server/src/agents/scraping/handlers.ts.
 * Temporary verification harness.
 */

import {
  BRAND_CORPUS_TAG,
  BRAND_DOMAIN_TAG,
  BRAND_RULE_TAG,
  BRAND_TOPICS,
} from '../../shared/brand-voice'
import { synonymsFor } from '../../shared/keywords'
import { listKeywords, listKnowledge } from '../src/db/repo'
import { currentWorkspaceId } from '../src/db/repo'
import { closePool } from '../src/db/pool'

function contentWords(input: string): string[] {
  const stop = new Set(['the', 'and', 'for', 'with', 'its', 'that', 'this', 'from'])
  return input
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length > 2 && !stop.has(w))
}

async function main(): Promise<void> {
  const workspaceId = await currentWorkspaceId()
  if (!workspaceId) throw new Error('No workspace. Run npm run db:seed first.')

  const [entries, keywords] = await Promise.all([
    listKnowledge(workspaceId, { activeOnly: true, limit: 400 }),
    listKeywords(workspaceId, true),
  ])

  const ruleEntries = entries.filter((e) => e.tags.includes(BRAND_RULE_TAG))
  const corpusEntries = entries.filter((e) => e.tags.includes(BRAND_CORPUS_TAG))
  const domainEntries = corpusEntries.filter((e) => e.tags.includes(BRAND_DOMAIN_TAG))
  const identityEntries = corpusEntries.filter((e) => !e.tags.includes(BRAND_DOMAIN_TAG))

  // Exactly the construction the handler performs.
  const knowledgeTerms = new Set<string>()
  let counted = 0
  for (const entry of entries) {
    if (entry.tags.includes(BRAND_RULE_TAG)) continue
    const isCorpus = entry.tags.includes(BRAND_CORPUS_TAG)
    if (isCorpus && !entry.tags.includes(BRAND_DOMAIN_TAG)) continue
    counted += 1
    for (const tag of entry.tags) {
      if (tag === 'brand' || tag === BRAND_CORPUS_TAG || tag === BRAND_DOMAIN_TAG) continue
      knowledgeTerms.add(tag.toLowerCase())
    }
    for (const word of contentWords(entry.title)) knowledgeTerms.add(word)
  }

  const keywordTerms = new Set<string>()
  for (const keyword of keywords) {
    keywordTerms.add(keyword.term.toLowerCase())
    for (const s of synonymsFor(keyword.term)) keywordTerms.add(s.toLowerCase())
  }

  let failures = 0
  const check = (label: string, condition: boolean, detail = ''): void => {
    if (condition) console.log(`  ok   ${label}`)
    else {
      failures += 1
      console.error(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
    }
  }

  console.log('\nWhat the Scraping Agent judges a captured page against')
  console.log(`  knowledge entries in the workspace : ${entries.length}`)
  console.log(`  of those, compliance rules         : ${ruleEntries.length} (excluded)`)
  console.log(`  of those, brand corpus             : ${corpusEntries.length}`)
  console.log(`    subject matter (feeds alignment) : ${domainEntries.length}`)
  console.log(`    brand identity (excluded)        : ${identityEntries.length}`)
  console.log(`  corpus/knowledge terms admitted    : ${knowledgeTerms.size}`)
  console.log(`  declared keyword terms admitted    : ${keywordTerms.size}`)
  console.log(`  fixed brand topics                 : ${BRAND_TOPICS.length}\n`)

  check('the workspace holds compliance rules', ruleEntries.length > 0)
  check('the workspace holds a brand corpus', corpusEntries.length > 0)
  check(
    'alignment counts only non-rule, subject-matter entries',
    counted === entries.length - ruleEntries.length - identityEntries.length,
    `counted ${counted}`,
  )
  check('the corpus declares both kinds', domainEntries.length > 0 && identityEntries.length > 0)
  check(
    'identity vocabulary is excluded from the topical set',
    identityEntries.every((e) =>
      e.tags
        .filter((t) => !['brand', BRAND_CORPUS_TAG, BRAND_DOMAIN_TAG].includes(t))
        .every((t) => !knowledgeTerms.has(t.toLowerCase())),
    ),
  )

  // The point of the exclusion: compliance vocabulary must not decide relevance.
  const complianceWords = ['hashtag', 'hashtags', 'punctuation', 'emoji', 'typography', 'silent']
  const leaked = complianceWords.filter((w) => knowledgeTerms.has(w))
  check(
    'no compliance vocabulary leaked into the topical set',
    leaked.length === 0,
    `leaked: ${leaked.join(', ')}`,
  )

  // And the corpus must genuinely contribute domain vocabulary.
  const domain = ['reinforcement learning', 'agentic ai', 'evaluation', 'post-training', 'synthetic data']
  const present = domain.filter((d) => knowledgeTerms.has(d))
  check(
    `the corpus contributes domain terms (${present.length}/${domain.length})`,
    present.length >= 4,
    `missing: ${domain.filter((d) => !present.has?.(d) && !knowledgeTerms.has(d)).join(', ')}`,
  )

  check(
    'the declared keyword set reaches alignment',
    keywordTerms.has('reinforcement learning') && keywordTerms.has('rlhf'),
  )
  check(
    'keyword synonyms reach alignment too',
    keywordTerms.has('policy optimization') || keywordTerms.has('reward model'),
  )
  check(
    '"infrastructure" stays admissible vocabulary',
    keywordTerms.has('ai infrastructure') || knowledgeTerms.has('ai infrastructure'),
  )

  console.log(
    failures === 0
      ? `\n✓ alignment vocabulary verified against the live database\n`
      : `\n✗ ${failures} check(s) failed\n`,
  )
  await closePool()
  process.exit(failures === 0 ? 0 : 1)
}

main().catch(async (error: unknown) => {
  console.error('✗', error instanceof Error ? error.message : error)
  await closePool().catch(() => undefined)
  process.exit(1)
})

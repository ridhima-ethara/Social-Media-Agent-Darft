/**
 * CORPUS INGESTION
 *
 *   npm run corpus:ingest          write every file in corpus/ into the Knowledge Base
 *   npm run corpus:ingest -- --dry report what would be written, write nothing
 *
 * The folder door. The upload door is `POST /knowledge/corpus/upload`; both
 * run `ingestCorpusFiles`, so a file reaches the store the same way whichever
 * way it arrived.
 */

import { existsSync } from 'node:fs'

import { closePool } from '../src/db/pool'
import { currentWorkspaceId } from '../src/db/repo'
import { CORPUS_DIR, ingestCorpusFiles, walkCorpus } from '../src/agents/knowledge/corpus-ingest'

async function main(): Promise<number> {
  const dry = process.argv.includes('--dry')

  if (!existsSync(CORPUS_DIR)) {
    console.error(`No corpus/ folder at ${CORPUS_DIR}.`)
    return 1
  }

  const files = walkCorpus()
  if (files.length === 0) {
    console.log('corpus/ holds no readable files yet. Add PDFs or Markdown and run this again.')
    return 0
  }

  const workspaceId = await currentWorkspaceId()
  console.log(`\ncorpus/ · ${files.length} file(s)${dry ? ' · DRY RUN, nothing will be written' : ''}\n`)

  const report = await ingestCorpusFiles(workspaceId, files, { dry })

  for (const file of report.files) {
    if (file.outcome === 'inserted') console.log(`  + ${file.file} · ${file.sections} section(s)${dry ? ' (would write)' : ''}`)
    else if (file.outcome === 'unchanged') console.log(`  = ${file.file} · unchanged, ${file.sections} section(s) already stored`)
  }
  const unreadable = report.files.filter((f) => f.outcome === 'unreadable')
  if (unreadable.length > 0) {
    console.log('\nNot ingested:')
    for (const file of unreadable) console.log(`  ! ${file.file} — ${file.detail}`)
  }

  const { inserted, skipped, deactivated } = report
  console.log(
    `\n${dry ? 'Would insert' : 'Inserted'} ${inserted} entr${inserted === 1 ? 'y' : 'ies'}` +
      `${skipped > 0 ? `, skipped ${skipped} unchanged` : ''}` +
      `${deactivated > 0 ? `, deactivated ${deactivated} superseded` : ''}.` +
      `${unreadable.length > 0 ? ` ${unreadable.length} file(s) could not be read.` : ''}\n`,
  )
  if (!dry && inserted > 0) {
    console.log('Open Knowledge Base → Brand Corpus to see them. The next post the agents write uses them.\n')
  }
  return 0
}

main()
  .then(async (code) => {
    await closePool()
    process.exit(code)
  })
  .catch(async (error: unknown) => {
    console.error(`\ncorpus:ingest failed — ${error instanceof Error ? error.message : String(error)}\n`)
    await closePool()
    process.exit(1)
  })

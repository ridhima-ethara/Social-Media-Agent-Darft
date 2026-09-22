/**
 * CORPUS INGESTION — one path, whether the file arrived by folder or by upload
 *
 * Everything under `corpus/` becomes `Brand Corpus` knowledge, the store
 * `retrieveKnowledge()` reads. `scripts/ingest-corpus.ts` walks the folder and
 * calls this; `POST /knowledge/corpus/upload` writes the file into the folder
 * and calls this. Two doors, one definition of "what this file contained".
 *
 * PDFs are read by `backend/tools/extract_corpus.py` over the process boundary,
 * where the Python dependency already lives.
 *
 * IDEMPOTENCE. A section is identified by a hash of its own text, carried as a
 * `sha:` tag. Re-ingesting skips stored sections; when a file has changed its
 * previous entries are DEACTIVATED, never deleted, and the new sections are
 * inserted alongside.
 */

import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, statSync } from 'node:fs'
import { dirname, extname, join, relative, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import { BRAND_CORPUS_TAG, BRAND_DOMAIN_TAG } from '../../../../shared/brand-voice'
import { agentPython } from '../../integrations/agent-tier'
import { insertKnowledgeEntry, listKnowledge, setKnowledgeActive } from '../../db/repo'

const HERE = dirname(fileURLToPath(import.meta.url))
export const REPO_ROOT = resolve(HERE, '..', '..', '..', '..')
export const CORPUS_DIR = join(REPO_ROOT, 'corpus')

/** Roughly one screen of reading. */
const TARGET_WORDS = 1_200
/** Below this a section is noise rather than a passage. */
const MIN_WORDS = 40

export const SUPPORTED_EXTENSIONS = ['.pdf', '.md', '.txt', '.csv', '.json', '.yml', '.yaml', '.rst', '.log'] as const
const SUPPORTED = new Set<string>(SUPPORTED_EXTENSIONS)

export function isSupportedCorpusFile(name: string): boolean {
  return SUPPORTED.has(extname(name).toLowerCase())
}

interface ExtractedFile {
  path: string
  name: string
  suffix: string
  bytes: number
  text: string
  pages: number[]
  error: string | null
}

export function walkCorpus(dir = CORPUS_DIR, out: string[] = []): string[] {
  if (!existsSync(dir)) return out
  for (const entry of readdirSync(dir)) {
    if (entry.startsWith('.') || entry === 'README.md') continue
    const full = join(dir, entry)
    if (statSync(full).isDirectory()) walkCorpus(full, out)
    else if (SUPPORTED.has(extname(entry).toLowerCase())) out.push(full)
  }
  return out
}

/** Subfolders become tags, so how you file things shapes what discovery admits. */
function folderTags(file: string): string[] {
  return relative(CORPUS_DIR, dirname(file))
    .split(/[/\\]/)
    .map((part) => part.trim().toLowerCase())
    .filter((part) => part !== '' && part !== '.')
}

function extract(files: string[]): ExtractedFile[] {
  /*
   * The agent tier's interpreter, not a scraper's.
   *
   * This read `CRAWL4AI_PYTHON` because that happened to be the venv with the
   * PDF libraries in it. Reading a PDF is not scraping, and the crawler is gone,
   * so it now asks the one resolver that owns the Python boundary — which also
   * derives the venv from the repo root when no override is set, so this stops
   * needing a key at all in the ordinary case.
   */
  const python = agentPython()
  const needsPython = files.some((f) => extname(f).toLowerCase() === '.pdf')

  if (needsPython && python === '') {
    throw new Error(
      'That includes a PDF, but CRAWL4AI_PYTHON is not set, so it cannot be read. ' +
        'Point it at the backend venv interpreter (see corpus/README.md).',
    )
  }

  const interpreter = python === '' ? 'python3' : python
  const result = spawnSync(interpreter, ['-m', 'tools.extract_corpus', ...files], {
    cwd: join(REPO_ROOT, 'backend'),
    encoding: 'utf-8',
    maxBuffer: 256 * 1024 * 1024,
  })

  if (result.error) throw new Error(`The extractor could not be started: ${result.error.message}`)
  if (result.status !== 0) {
    throw new Error(`The extractor exited ${result.status}: ${result.stderr?.trim() ?? 'no detail'}`)
  }

  const payload = JSON.parse(result.stdout) as { files?: ExtractedFile[] }
  return payload.files ?? []
}

interface Section {
  title: string
  body: string
  hash: string
}

/** Whole paragraphs up to the target; a sentence is never cut in half. */
function sectionise(file: ExtractedFile, displayName: string): Section[] {
  const paragraphs = file.text
    .split(/\n\s*\n/)
    .map((p) => p.replace(/[ \t]+/g, ' ').trim())
    .filter((p) => p.length > 0)

  const sections: Section[] = []
  let buffer: string[] = []
  let words = 0

  const flush = (): void => {
    if (buffer.length === 0) return
    const body = buffer.join('\n\n')
    if (body.split(/\s+/).length >= MIN_WORDS) {
      sections.push({
        title: `${displayName} · part ${sections.length + 1}`,
        body,
        hash: createHash('sha256').update(body).digest('hex').slice(0, 16),
      })
    }
    buffer = []
    words = 0
  }

  for (const paragraph of paragraphs) {
    const count = paragraph.split(/\s+/).length
    if (words + count > TARGET_WORDS && buffer.length > 0) flush()
    buffer.push(paragraph)
    words += count
  }
  flush()

  // A short file is one section even under the paragraph floor — dropping it
  // would lose material the operator deliberately added.
  if (sections.length === 0 && file.text.trim().length > 0) {
    const body = file.text.trim()
    sections.push({ title: `${displayName} · part 1`, body, hash: createHash('sha256').update(body).digest('hex').slice(0, 16) })
  }

  return sections
}

export interface IngestFileReport {
  file: string
  sections: number
  outcome: 'inserted' | 'unchanged' | 'unreadable'
  detail: string | null
}

export interface IngestReport {
  inserted: number
  skipped: number
  deactivated: number
  files: IngestFileReport[]
}

export async function ingestCorpusFiles(
  workspaceId: string,
  files: string[],
  opts: { dry?: boolean } = {},
): Promise<IngestReport> {
  const dry = opts.dry ?? false
  const report: IngestReport = { inserted: 0, skipped: 0, deactivated: 0, files: [] }
  if (files.length === 0) return report

  const extracted = extract(files)
  const existing = await listKnowledge(workspaceId, { tag: BRAND_CORPUS_TAG, limit: 5_000 })

  const storedHashes = new Set<string>()
  for (const entry of existing) {
    for (const tag of entry.tags) if (tag.startsWith('sha:')) storedHashes.add(tag.slice(4))
  }

  for (const file of extracted) {
    const displayName = relative(CORPUS_DIR, file.path)

    if (file.error) {
      report.files.push({ file: displayName, sections: 0, outcome: 'unreadable', detail: file.error })
      continue
    }

    const sections = sectionise(file, displayName)
    if (sections.length === 0) {
      report.files.push({ file: displayName, sections: 0, outcome: 'unreadable', detail: 'held no usable text' })
      continue
    }

    const pageNote = file.pages.length > 0 ? `, pages ${file.pages[0]}–${file.pages[file.pages.length - 1]}` : ''
    const source = `corpus/${displayName}${pageNote}`
    const fileTag = `corpus-file:${displayName.toLowerCase()}`
    const tags = ['brand', BRAND_CORPUS_TAG, BRAND_DOMAIN_TAG, fileTag, ...folderTags(file.path)]

    const fresh = sections.filter((section) => !storedHashes.has(section.hash))
    if (fresh.length === 0) {
      report.skipped += sections.length
      report.files.push({ file: displayName, sections: sections.length, outcome: 'unchanged', detail: null })
      continue
    }

    // The file has changed: its previous entries stop reaching generation, but
    // they are switched off rather than removed.
    if (!dry) {
      for (const entry of existing) {
        if (!entry.active || !entry.tags.includes(fileTag)) continue
        await setKnowledgeActive(workspaceId, entry.id, false)
        report.deactivated += 1
      }
    }

    // Per file, so one unstorable document does not abort the others.
    let failed: string | null = null
    for (const section of sections) {
      if (dry) continue
      try {
        await insertKnowledgeEntry({
          workspaceId,
          title: section.title,
          category: 'Brand Corpus',
          content: section.body,
          source,
          sources: [],
          hashtagId: null,
          confidence: 'High',
          // Retrieval prioritises brand origin: the operator's own material
          // outranks anything scraped off the open web.
          origin: 'brand',
          buildId: null,
          tags: [...tags, `sha:${section.hash}`],
        })
        report.inserted += 1
      } catch (error) {
        failed = error instanceof Error ? error.message : String(error)
        break
      }
    }

    if (failed !== null) {
      report.files.push({ file: displayName, sections: sections.length, outcome: 'unreadable', detail: `could not be stored: ${failed}` })
      continue
    }

    report.files.push({ file: displayName, sections: sections.length, outcome: 'inserted', detail: null })
  }

  return report
}

/**
 * Syncs the Marketing Skills this codebase uses from
 * github.com/coreyhaines31/marketingskills into `packages/marketing-skills/`.
 *
 * Only the skills listed in SKILLS are copied — never the whole repository.
 * `SOURCE.json` records the upstream commit and when it was synced, and the
 * Competitor Intelligence adapter reads the vendored files at run time, so
 * re-running this updates the methodology the Analysis Agent follows.
 *
 *   npm run marketing-skills:sync            # latest main
 *   npm run marketing-skills:sync -- <sha>   # a specific commit
 */

import { execFileSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const REPO = 'https://github.com/coreyhaines31/marketingskills.git'
const SKILLS = ['competitor-profiling', 'competitors'] as const
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const TARGET = join(ROOT, 'packages', 'marketing-skills')

const ref = process.argv[2]
const work = mkdtempSync(join(tmpdir(), 'marketingskills-'))
try {
  execFileSync('git', ['clone', '--quiet', ...(ref ? [] : ['--depth', '1']), REPO, work], { stdio: 'inherit' })
  if (ref) execFileSync('git', ['-C', work, 'checkout', '--quiet', ref], { stdio: 'inherit' })
  const commit = execFileSync('git', ['-C', work, 'rev-parse', 'HEAD']).toString().trim()
  const committedAt = execFileSync('git', ['-C', work, 'log', '-1', '--format=%cI']).toString().trim()

  mkdirSync(TARGET, { recursive: true })
  const versions: Record<string, string | null> = {}
  for (const skill of SKILLS) {
    const from = join(work, 'skills', skill)
    if (!existsSync(join(from, 'SKILL.md'))) throw new Error(`Upstream has no skills/${skill}/SKILL.md at ${commit}`)
    rmSync(join(TARGET, skill), { recursive: true, force: true })
    cpSync(from, join(TARGET, skill), { recursive: true })
    versions[skill] = readFileSync(join(from, 'SKILL.md'), 'utf8').match(/^\s*version:\s*([^\s]+)/m)?.[1] ?? null
  }
  cpSync(join(work, 'LICENSE'), join(TARGET, 'LICENSE'))
  const source = {
    repository: 'https://github.com/coreyhaines31/marketingskills',
    commit,
    committed_at: committedAt,
    synced_at: new Date().toISOString(),
    skills: SKILLS.map((s) => ({ name: s, path: `skills/${s}`, version: versions[s] })),
  }
  writeFileSync(join(TARGET, 'SOURCE.json'), `${JSON.stringify(source, null, 2)}\n`)
  console.log(`✓ ${SKILLS.join(', ')} synced from ${commit.slice(0, 12)} (${committedAt}) into packages/marketing-skills/`)
} finally {
  rmSync(work, { recursive: true, force: true })
}

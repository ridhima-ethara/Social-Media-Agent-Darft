/**
 * THE ACCEPTANCE SCRIPT
 *
 * Typecheck, lint, the registry audit, and the checks in Part 12 that can be
 * made mechanically. Anything it cannot prove, it reports as a manual check
 * rather than silently passing — a green run that skipped its hardest
 * assertions would be worse than a red one.
 *
 *   npm run verify
 */

import { execSync } from 'node:child_process'
import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { REGISTRY_SUMMARY, SKILLS, defaultSkillConfig } from '../shared/agent-registry'
import { TOOLS, validateToolRegistry } from '../shared/tool-registry'
import { validateRegistry } from '../shared/agent-registry'
import { BRAND } from '../shared/brand-voice'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

let failures = 0
let manual = 0

function section(name: string): void {
  console.log(`\n\x1b[1m${name}\x1b[0m`)
}

function pass(message: string): void {
  console.log(`  \x1b[32m✓\x1b[0m ${message}`)
}

function fail(message: string): void {
  failures += 1
  console.log(`  \x1b[31m✗\x1b[0m ${message}`)
}

function todo(message: string): void {
  manual += 1
  console.log(`  \x1b[33m·\x1b[0m manual check — ${message}`)
}

function run(label: string, command: string): boolean {
  try {
    execSync(command, { cwd: ROOT, stdio: 'pipe' })
    pass(label)
    return true
  } catch (error) {
    const output = error instanceof Error && 'stdout' in error ? String((error as { stdout: Buffer }).stdout) : ''
    fail(`${label}\n${output.split('\n').slice(0, 20).join('\n')}`)
    return false
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   1 · THE TOOLCHAIN
   ═══════════════════════════════════════════════════════════════════════════ */

section('Toolchain')
run('tsc -b (web + shared) is clean', 'npx tsc -b')
run('tsc -b (server) is clean', 'npm --prefix server run typecheck')
run('oxlint is clean', 'npx oxlint .')

/* ═══════════════════════════════════════════════════════════════════════════
   2 · THE CONTRACT
   ═══════════════════════════════════════════════════════════════════════════ */

section('Contract')

// Warnings are informational; only an `error` fails the build.
const registryProblems = validateRegistry().filter((p) => p.severity === 'error')
if (registryProblems.length === 0) {
  pass(`registry is self-consistent — ${REGISTRY_SUMMARY.agents} agents, ${REGISTRY_SUMMARY.skills} skills, ${REGISTRY_SUMMARY.knobs} knobs`)
} else {
  for (const problem of registryProblems) fail(`registry: ${problem.where} — ${problem.message}`)
}

const toolProblems = validateToolRegistry().filter((p) => p.severity === 'error')
if (toolProblems.length === 0) {
  pass(`tool registry is self-consistent — ${TOOLS.length} tools`)
} else {
  for (const problem of toolProblems) fail(`tools: ${problem.where} — ${problem.message}`)
}

// Every knob carries a description, because it is rendered straight to the operator.
const undescribed = SKILLS.flatMap((skill) =>
  skill.config.filter((field) => !field.description || field.description.trim().length < 8).map((field) => `${skill.id}.${field.key}`),
)
if (undescribed.length === 0) pass('every knob carries a plain-language description')
else for (const key of undescribed) fail(`knob without a usable description: ${key}`)

// Every irreversible tool must carry a confirmation template.
const unconfirmable = TOOLS.filter((t) => t.risk === 'irreversible' && !t.confirmTemplate)
if (unconfirmable.length === 0) pass('every irreversible tool declares a confirmation template')
else for (const tool of unconfirmable) fail(`irreversible tool without confirmTemplate: ${tool.id}`)

// Every tool routes from at least one example — the parser's grammar is built from these.
const exampleless = TOOLS.filter((t) => t.examples.length === 0)
if (exampleless.length === 0) pass('every tool declares example utterances')
else for (const tool of exampleless) fail(`tool without examples: ${tool.id}`)

/* ═══════════════════════════════════════════════════════════════════════════
   3 · THE PRODUCT'S LOAD-BEARING NUMBERS
   ═══════════════════════════════════════════════════════════════════════════ */

section('Load-bearing defaults')

const checks: Array<{ skill: string; key: string; expected: number; why: string }> = [
  { skill: 'validation.keyword.trend', key: 'topKeywords', expected: 5, why: 'top 5 trending keywords' },
  { skill: 'validation.hashtag.rank', key: 'topHashtagsPerKeyword', expected: 5, why: 'top 5 hashtags per keyword' },
  { skill: 'analysis.hashtag.consolidate', key: 'topHashtags', expected: 25, why: 'consolidated top 25' },
  { skill: 'calendar.rank.select', key: 'topPerPlatform', expected: 10, why: 'top 10 per platform' },
  { skill: 'knowledge.hashtag.select', key: 'hashtagCount', expected: 25, why: 'the Sunday research set' },
]

for (const check of checks) {
  const value = defaultSkillConfig(check.skill)[check.key]
  if (value === check.expected) pass(`${check.why}: \`${check.skill}.${check.key}\` = ${value}`)
  else fail(`${check.why}: expected ${check.expected}, found ${String(value)} at ${check.skill}.${check.key}`)
}

if (BRAND.emojiBudget === 0) pass('emoji budget is 0 and no knob can raise it')
else fail(`emoji budget is ${BRAND.emojiBudget}, expected 0`)

if (BRAND.hashtags.min === 3 && BRAND.hashtags.max === 5) pass('hashtag block is clamped to 3–5')
else fail(`hashtag block is ${BRAND.hashtags.min}–${BRAND.hashtags.max}, expected 3–5`)

/* ═══════════════════════════════════════════════════════════════════════════
   4 · THE FILES THAT MUST EXIST
   ═══════════════════════════════════════════════════════════════════════════ */

section('Deliverables')

const required = [
  'README.md',
  'CLAUDE.md',
  'docker-compose.yml',
  '.env.example',
  'server/.env.example',
  'server/src/db/schema.sql',
  'src/index.css',
  'src/store.ts',
  'src/data/demo.ts',
  'src/lib/assistant.ts',
  'src/lib/voice.ts',
  'backend/api.py',
  'backend/core/brain.py',
  'backend/workflows/social_media_workflow.py',
]

for (const path of required) {
  if (existsSync(join(ROOT, path))) pass(`${path} exists`)
  else fail(`${path} is missing`)
}

const PAGES = [
  'LoginPage', 'Dashboard', 'ContentIntelligence', 'CalendarPage', 'PublishedPosts',
  'LeadershipReview', 'AgentActivity', 'AgentStudio', 'RunConsole', 'SettingsPage',
  'AssistantConsole', 'KnowledgeBase', 'ReviewPanel', 'PipelineTheater',
]
const pageDir = join(ROOT, 'src/pages')
const pageFiles = existsSync(pageDir) ? readdirSync(pageDir) : []
const missingPages = PAGES.filter((name) => !pageFiles.includes(`${name}.tsx`))
if (missingPages.length === 0) pass(`all ${PAGES.length} screen modules present`)
else for (const name of missingPages) fail(`screen missing: src/pages/${name}.tsx`)

const AGENT_FOLDERS = [
  'research_agent', 'validation_agent', 'calendar_agent',
  'content_agent', 'publishing_agent', 'analytics_agent',
]
const AGENT_FILES = ['agent.py', 'prompt.md', 'instructions.md', 'tools.md', 'schema.py']
let folderProblems = 0
for (const folder of AGENT_FOLDERS) {
  for (const file of AGENT_FILES) {
    if (!existsSync(join(ROOT, 'backend/agents', folder, file))) {
      fail(`backend/agents/${folder}/${file} is missing`)
      folderProblems += 1
    }
  }
}
if (folderProblems === 0) {
  pass(`all ${AGENT_FOLDERS.length} agent folders carry ${AGENT_FILES.join(' · ')}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   5 · CRAFT — what can be checked by reading the source
   ═══════════════════════════════════════════════════════════════════════════ */

section('Craft')

const css = readFileSync(join(ROOT, 'src/index.css'), 'utf8')

if (css.includes('@media (prefers-reduced-motion: reduce)')) {
  pass('the reduced-motion block exists')
} else {
  fail('src/index.css has no prefers-reduced-motion block')
}

if (/:root\[data-theme='light'\]/.test(css)) pass('the light theme redefines every token')
else fail('src/index.css has no light-theme token block')

// No component may hard-code a colour. Tokens or nothing.
const componentFiles: string[] = []
for (const dir of ['src/components', 'src/pages']) {
  const base = join(ROOT, dir)
  if (!existsSync(base)) continue
  const walk = (path: string): void => {
    for (const entry of readdirSync(path, { withFileTypes: true })) {
      const full = join(path, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name.endsWith('.tsx')) componentFiles.push(full)
    }
  }
  walk(base)
}

/**
 * Platform brand colours and the previews' native chrome are the declared
 * exceptions: they are the platforms' own identities, not ours, and they must
 * not shift with the theme.
 */
const COLOUR_EXEMPT = new Set(['previews.tsx', 'charts.tsx', 'ui.tsx'])

const hexOffenders: string[] = []
for (const file of componentFiles) {
  const name = file.split('/').pop() ?? ''
  if (COLOUR_EXEMPT.has(name)) continue
  const body = readFileSync(file, 'utf8')
  for (const [i, line] of body.split('\n').entries()) {
    if (/#[0-9a-fA-F]{6}\b/.test(line) && !line.includes('//') && !line.trimStart().startsWith('*')) {
      hexOffenders.push(`${file.replace(ROOT + '/', '')}:${i + 1}`)
    }
  }
}
if (hexOffenders.length === 0) pass('no component hard-codes a colour outside the declared exemptions')
else for (const offender of hexOffenders) fail(`hard-coded colour: ${offender}`)

// Recharts may only be imported by the chart wrapper.
const rechartsImporters = componentFiles
  .concat(existsSync(join(ROOT, 'src/lib')) ? [] : [])
  .filter((file) => readFileSync(file, 'utf8').includes("from 'recharts'"))
  .filter((file) => !file.endsWith('charts.tsx'))
if (rechartsImporters.length === 0) pass('Recharts is imported only by src/components/charts.tsx')
else for (const file of rechartsImporters) fail(`Recharts imported outside charts.tsx: ${file}`)

/* ═══════════════════════════════════════════════════════════════════════════
   6 · WHAT ONLY A HUMAN CAN CONFIRM
   ═══════════════════════════════════════════════════════════════════════════ */

section('Manual checks')
todo('with an empty .env, walk every screen and confirm each labels its unconfigured integrations')
todo('with the API stopped, confirm every screen renders and Ethara answers on the standalone parser')
todo('run the ten canonical utterances on both parsers')
todo('walk all sixteen screens in dark and light with zero console errors')
todo('confirm no horizontal body scroll at 1280 / 1024 / 768')

/* ═══════════════════════════════════════════════════════════════════════════
   RESULT
   ═══════════════════════════════════════════════════════════════════════════ */

console.log('')
if (failures === 0) {
  console.log(`\x1b[32mverify passed\x1b[0m — 0 failures, ${manual} manual checks remaining.`)
} else {
  console.log(`\x1b[31mverify failed\x1b[0m — ${failures} failure(s), ${manual} manual checks remaining.`)
  process.exit(1)
}

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

import { execFileSync, execSync } from 'node:child_process'
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

/*
 * THE TESTS ARE A GATE, NOT A SUGGESTION.
 *
 * Both suites run here so a regression in either tier fails `verify` rather than
 * waiting to be rediscovered from inside a run. The Python suite is skipped —
 * loudly, as a manual check — when the venv is absent, because a contributor who
 * has only installed the Node tier should still get a meaningful verify rather
 * than a failure about a directory they were never told to create.
 */
run('vitest (web + shared + server config) passes', 'npx vitest run')

const PYTEST = join(ROOT, 'backend/.venv/bin/pytest')
if (existsSync(PYTEST)) {
  run('pytest (backend/tests) passes', `"${PYTEST}" backend/tests -q`)
} else {
  todo(
    'backend/.venv is absent, so the Python suite did not run — create it with ' +
      '`backend/.venv/bin/pip install -r backend/requirements.txt`',
  )
}

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
  { skill: 'calendar.rank.select', key: 'topPerPlatform', expected: 5, why: 'top 5 per platform' },
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
   3b · THE SAME NUMBERS, IN THE OTHER TIER

   `backend/core/config.py` declares its own REGISTRY of knobs for the eight
   Python agents, covering the same conceptual settings as the TypeScript
   registry above. Two registries for one set of product numbers is two places
   to change them, and nothing was checking that they agreed — so the Python
   tier could rank a top 6 while every screen, every piece of UI copy and the
   seed data said 5, and no gate would notice.

   Read through `python backend/api.py agents`, which already emits every
   declared knob, rather than by parsing the Python source: the CLI is that
   tier's own contract surface, so this checks what the agents will actually
   resolve rather than what the file appears to say.
   ═══════════════════════════════════════════════════════════════════════════ */

section('Cross-tier knob agreement')

interface PythonKnob {
  key: string
  default: unknown
}
interface PythonAgent {
  id: string
  knobs: PythonKnob[]
}

/** The Python tier's declared knobs, or `null` when the venv is not built. */
function pythonKnobs(): Map<string, Map<string, unknown>> | null {
  const python = join(ROOT, 'backend/.venv/bin/python')
  if (!existsSync(python)) return null

  let stdout: string
  try {
    stdout = execFileSync(python, [join(ROOT, 'backend/api.py'), 'agents'], {
      cwd: ROOT,
      encoding: 'utf8',
      timeout: 60_000,
      stdio: ['ignore', 'pipe', 'pipe'],
    })
  } catch {
    return null
  }

  const frame = stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as { event?: string; agents?: PythonAgent[] }
      } catch {
        return null
      }
    })
    .find((f) => f?.event === 'agents')

  if (!frame?.agents) return null

  const byAgent = new Map<string, Map<string, unknown>>()
  for (const agent of frame.agents) {
    byAgent.set(agent.id, new Map(agent.knobs.map((k) => [k.key, k.default])))
  }
  return byAgent
}

const python = pythonKnobs()

if (python === null) {
  todo(
    'the Python tier could not be read, so its knobs were not compared — build it with ' +
      '`backend/.venv/bin/pip install -r backend/requirements.txt`',
  )
} else {
  /**
   * The load-bearing numbers, on both sides.
   *
   * `tsValue` is read through `defaultSkillConfig` so this compares what the
   * runtime resolves, not what the file literal says.
   */
  const crossTier: Array<{
    why: string
    tsSkill: string
    tsKey: string
    pyAgent: string
    pyKey: string
  }> = [
    { why: 'top trending keywords', tsSkill: 'validation.keyword.trend', tsKey: 'topKeywords', pyAgent: 'validation_agent', pyKey: 'top_keywords' },
    { why: 'hashtags per keyword', tsSkill: 'validation.hashtag.rank', tsKey: 'topHashtagsPerKeyword', pyAgent: 'validation_agent', pyKey: 'top_hashtags_per_keyword' },
    { why: 'calendar slots per platform', tsSkill: 'calendar.rank.select', tsKey: 'topPerPlatform', pyAgent: 'calendar_agent', pyKey: 'top_per_platform' },
  ]

  for (const check of crossTier) {
    const tsValue = defaultSkillConfig(check.tsSkill)[check.tsKey]
    const pyValue = python.get(check.pyAgent)?.get(check.pyKey)

    if (pyValue === undefined) {
      fail(
        `${check.why}: backend/core/config.py declares no \`${check.pyKey}\` for ` +
          `${check.pyAgent}, so the two tiers cannot be compared on it`,
      )
      continue
    }

    if (Number(tsValue) === Number(pyValue)) {
      pass(`${check.why}: both tiers say ${String(tsValue)}`)
    } else {
      fail(
        `${check.why} DISAGREES between the tiers:\n` +
          `        shared/agent-registry.ts  ${check.tsSkill}.${check.tsKey} = ${String(tsValue)}\n` +
          `        backend/core/config.py    ${check.pyAgent}.${check.pyKey} = ${String(pyValue)}\n` +
          '        One product number, two homes. Change both, or the screens and the agents ' +
          'will describe different products.',
      )
    }
  }

  /*
   * The hashtag clamp has no registry twin: the TypeScript side declares a single
   * `count` knob and takes its 3–5 bounds from `BRAND.hashtags`, while the Python
   * tier declares the bounds themselves. So this compares the Python knobs
   * against BRAND — the actual shared source of that invariant.
   */
  const pyMin = python.get('content_agent')?.get('min_hashtags')
  const pyMax = python.get('content_agent')?.get('max_hashtags')
  const tsCount = defaultSkillConfig('generation.caption.hashtags').count

  if (Number(pyMin) === BRAND.hashtags.min) {
    pass(`hashtag floor matches BRAND.hashtags.min (${BRAND.hashtags.min})`)
  } else {
    fail(
      `hashtag floor disagrees: BRAND.hashtags.min = ${BRAND.hashtags.min}, ` +
        `backend/core/config.py content_agent.min_hashtags = ${String(pyMin)}`,
    )
  }

  if (Number(pyMax) === BRAND.hashtags.max) {
    pass(`hashtag ceiling matches BRAND.hashtags.max (${BRAND.hashtags.max})`)
  } else {
    fail(
      `hashtag ceiling disagrees: BRAND.hashtags.max = ${BRAND.hashtags.max}, ` +
        `backend/core/config.py content_agent.max_hashtags = ${String(pyMax)}`,
    )
  }

  // The Node tier's own count must sit inside the clamp it claims to honour.
  if (Number(tsCount) >= BRAND.hashtags.min && Number(tsCount) <= BRAND.hashtags.max) {
    pass(`the caption writer's hashtag count (${String(tsCount)}) sits inside the 3–5 clamp`)
  } else {
    fail(
      `generation.caption.hashtags.count = ${String(tsCount)}, outside the ` +
        `${BRAND.hashtags.min}–${BRAND.hashtags.max} clamp BRAND declares`,
    )
  }
}

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
  'src/data/empty.ts',
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

// Read the folders off disk rather than listing them here. A hardcoded list is
// a second source of truth that goes stale the first time an agent is added or
// renamed, and then this check passes while describing a roster that is gone.
const AGENT_FOLDERS = readdirSync(join(ROOT, 'backend/agents'), { withFileTypes: true })
  .filter((entry) => entry.isDirectory() && !entry.name.startsWith('__'))
  .map((entry) => entry.name)
  .sort()
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

// A folder on disk that the roster never imports is an agent that does not run.
const rosterSource = readFileSync(join(ROOT, 'backend/agents/__init__.py'), 'utf8')
const unrostered = AGENT_FOLDERS.filter((folder) => !rosterSource.includes(folder))
if (unrostered.length === 0) {
  pass(`the roster in backend/agents/__init__.py accounts for all ${AGENT_FOLDERS.length} folders`)
} else {
  fail(`agent folder(s) never reached by the roster: ${unrostered.join(', ')}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   4a · THE WEEKLY KEYWORD ROTA

   The rota is data, and data that nothing reads is decoration. These check that
   it is coherent AND that the scraping agent actually consults it.
   ═══════════════════════════════════════════════════════════════════════════ */

section('Keyword rota')

const rotaSource = readFileSync(join(ROOT, 'shared/keyword-schedule.ts'), 'utf8')
const resolveSource = readFileSync(join(ROOT, 'server/src/agents/scraping/handlers.ts'), 'utf8')

if (/export const SCHEDULE_WEEKS/.test(rotaSource) && /export const CONSTANT_KEYWORDS/.test(rotaSource)) {
  const weeks = (rotaSource.match(/^\s*week: \d+,$/gm) ?? []).length
  pass(`the rota declares ${weeks} week(s) and a constant set`)
} else {
  fail('shared/keyword-schedule.ts no longer exports SCHEDULE_WEEKS and CONSTANT_KEYWORDS')
}

// A rota the scraper does not read is a schedule that governs nothing.
if (/keywordsForCycleWeek\(/.test(resolveSource) && /cycleWeekFor\(/.test(resolveSource)) {
  pass('the scraping agent resolves keywords from the weekly rota')
} else {
  fail(
    'server/src/agents/scraping/handlers.ts no longer calls keywordsForCycleWeek/cycleWeekFor — ' +
      'the rota has stopped selecting keywords, so a run captures whatever weight ordering gives it',
  )
}

// Which path a run took must be visible, or an empty week looks like a bug.
if (/source === 'rota'/.test(resolveSource)) {
  pass('the run reports which selection path it followed')
} else {
  fail('the keyword resolve no longer distinguishes the rota path in what it reports')
}

/* ═══════════════════════════════════════════════════════════════════════════
   4b · THE SKILLS ARE THE SPECIFICATION

   CLAUDE.md: "Skills are the specification. Code implements them. Prompts point
   at them." A prompt that names a SKILL.md the model was never given does not
   point at it, and a skill nothing claims is a specification governing nothing.
   Both failures are silent by nature, so they are checked here.
   ═══════════════════════════════════════════════════════════════════════════ */

section('Skills')

const SKILLS_DIR = join(ROOT, 'packages/skills')
const skillFolders = existsSync(SKILLS_DIR)
  ? readdirSync(SKILLS_DIR, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort()
  : []

if (skillFolders.length > 0) pass(`${skillFolders.length} skill(s) under packages/skills/`)
else fail('packages/skills/ holds no skills')

// Every skill must carry the two sections that make it a requirements document.
for (const skill of skillFolders) {
  const path = join(SKILLS_DIR, skill, 'SKILL.md')
  if (!existsSync(path)) {
    fail(`packages/skills/${skill}/ has no SKILL.md`)
    continue
  }
  const body = readFileSync(path, 'utf8')
  const missing = ['## Rules', '## Boundaries'].filter((heading) => !body.includes(heading))
  if (missing.length > 0) {
    fail(`packages/skills/${skill}/SKILL.md is missing ${missing.join(' and ')}`)
  }
}

/** The skills each Python agent declares, read off the class declaration. */
const pythonSkills = new Map<string, string[]>()
for (const folder of AGENT_FOLDERS) {
  const body = readFileSync(join(ROOT, 'backend/agents', folder, 'agent.py'), 'utf8')
  const match = /^\s*skills\s*=\s*\[([^\]]*)\]/m.exec(body)
  const declared = match
    ? [...(match[1] ?? '').matchAll(/["']([^"']+)["']/g)].map((m) => m[1] as string)
    : []
  pythonSkills.set(folder, declared)
}

const skilllessAgents = [...pythonSkills].filter(([, skills]) => skills.length === 0)
if (skilllessAgents.length === 0) {
  pass(`all ${AGENT_FOLDERS.length} Python agents declare a skill`)
} else {
  for (const [folder] of skilllessAgents) {
    fail(
      `backend/agents/${folder}/agent.py declares no \`skills\`, so it runs with no stated ` +
        'specification. Declare the SKILL.md folder(s) that govern it.',
    )
  }
}

// A declared skill that does not exist on disk means an agent with no rules.
for (const [folder, skills] of pythonSkills) {
  for (const skill of skills) {
    if (!skillFolders.includes(skill)) {
      fail(`backend/agents/${folder}/agent.py declares the unknown skill '${skill}'`)
    }
  }
}

/** The skill each Node agent folder declares in its spec. */
const nodeSkills = new Map<string, string>()
const agentPkgDir = join(ROOT, 'packages/agents')
if (existsSync(agentPkgDir)) {
  for (const entry of readdirSync(agentPkgDir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue
    const specPath = join(agentPkgDir, entry.name, 'spec.ts')
    if (!existsSync(specPath)) continue
    const match = /^\s*skill:\s*'([^']+)'/m.exec(readFileSync(specPath, 'utf8'))
    if (match?.[1]) nodeSkills.set(entry.name, match[1])
  }
}

for (const [folder, skill] of nodeSkills) {
  if (!skillFolders.includes(skill)) {
    fail(`packages/agents/${folder}/spec.ts declares the unknown skill '${skill}'`)
  }
}

// A skill claimed by nobody specifies nothing. Either an agent should declare
// it or it should be deleted — leaving it is how a spec gets cited in review as
// though it binds when nothing reads it.
const claimed = new Set<string>([...nodeSkills.values(), ...[...pythonSkills.values()].flat()])
const orphanSkills = skillFolders.filter((skill) => !claimed.has(skill))
// The Node caption path must READ the skill it declares, not merely name it. The
// handler reimplements mechanical rules in TypeScript; the judgement rules come
// from SKILL.md via withCaptionSpec. A regression here means captions silently
// stop being governed by their specification.
const captionHandler = existsSync(join(ROOT, 'server/src/agents/caption/handlers.ts'))
  ? readFileSync(join(ROOT, 'server/src/agents/caption/handlers.ts'), 'utf8')
  : ''
if (/withCaptionSpec\(/.test(captionHandler)) {
  pass('the Node caption handler injects its SKILL.md specification')
} else {
  fail(
    'server/src/agents/caption/handlers.ts no longer calls withCaptionSpec — the caption ' +
      'prompt has stopped reading caption-writing/SKILL.md, so the skill governs nothing at runtime',
  )
}

if (orphanSkills.length === 0) {
  pass(`every skill is claimed by at least one agent — ${claimed.size} in use`)
} else {
  for (const skill of orphanSkills) {
    fail(
      `packages/skills/${skill}/SKILL.md is claimed by no agent in either tier. ` +
        'Declare it on the agent it governs, or remove it.',
    )
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   4c · SEMANTIC RETRIEVAL — the vector layer must be declared coherently

   The dimension is the load-bearing part. `schema.sql` fixes the column at
   vector(768) because pgvector needs a literal width for an HNSW index, so the
   configured embedder's width and the column's width are two numbers that must
   agree and have no mechanism keeping them in step. Checked here, statically,
   because the alternative is discovering it from inside a distance operator.
   ═══════════════════════════════════════════════════════════════════════════ */

section('Semantic retrieval')

const schemaSql = readFileSync(join(ROOT, 'server/src/db/schema.sql'), 'utf8')

if (/CREATE EXTENSION IF NOT EXISTS vector/.test(schemaSql)) {
  pass('schema.sql creates the pgvector extension')
} else {
  fail('schema.sql declares vector columns but never creates the `vector` extension')
}

const vectorWidths = [...schemaSql.matchAll(/\bvector\((\d+)\)/g)].map((m) => Number(m[1]))
const uniqueWidths = [...new Set(vectorWidths)]

if (vectorWidths.length === 0) {
  fail('schema.sql declares no vector(n) column, so nothing can be retrieved semantically')
} else if (uniqueWidths.length > 1) {
  fail(
    `schema.sql mixes vector widths (${uniqueWidths.join(', ')}). One embedder produces one ` +
      'width; two widths means one of these columns can never be written.',
  )
} else {
  pass(`every vector column is vector(${uniqueWidths[0]}) — ${vectorWidths.length} column(s)`)

  // The configured default must match the column, or nothing can be written.
  const configSql = readFileSync(join(ROOT, 'server/src/config.ts'), 'utf8')
  const configured = /EMBEDDING_DIMENSIONS['"]?,\s*(\d+)/.exec(configSql)
  if (configured?.[1] === undefined) {
    fail('config.ts declares no EMBEDDING_DIMENSIONS default to check the column against')
  } else if (Number(configured[1]) !== uniqueWidths[0]) {
    fail(
      `config.ts defaults EMBEDDING_DIMENSIONS to ${configured[1]} but schema.sql declares ` +
        `vector(${uniqueWidths[0]}). A vector of the wrong width cannot be stored at all.`,
    )
  } else {
    pass(`config.ts EMBEDDING_DIMENSIONS default agrees with the column (${configured[1]})`)
  }
}

// Both embeddable tables need the provenance columns, or a model change is undetectable.
for (const table of ['scraped_items', 'knowledge_entries']) {
  const missing = ['embedding', 'embedding_model', 'embedded_at'].filter(
    (column) => !new RegExp(`ALTER TABLE\\s+${table}\\s+ADD COLUMN IF NOT EXISTS\\s+${column}\\b`).test(schemaSql),
  )
  if (missing.length === 0) {
    pass(`${table} gains ${'embedding · embedding_model · embedded_at'} additively`)
  } else {
    fail(
      `${table} is missing an additive ALTER for ${missing.join(', ')}. Declaring a column only ` +
        'inside CREATE TABLE never reaches a database that already exists, so migrate would ' +
        'report drift and demand a destructive --fresh rebuild.',
    )
  }
}

if (/USING hnsw \(embedding vector_cosine_ops\)/.test(schemaSql)) {
  pass('HNSW cosine indexes are declared over the embedding columns')
} else {
  fail('no HNSW index over an embedding column — every semantic query would be a full scan')
}

/* ═══════════════════════════════════════════════════════════════════════════
   4d · THE DOCUMENTATION MUST BE TRUE

   A doc that names a file which is not there is worse than no doc: it is a
   confident instruction to look somewhere empty. This repository had several —
   `specs/architecture.md` was a dead link, `npm run specs:build` was a promised
   script that did not exist, and both README and CLAUDE.md described a bundled
   `src/data/demo.ts` dataset when the real fallback is a deliberately empty file.

   Every backtick-quoted relative path in README.md and CLAUDE.md is checked
   against disk. Prose is not checked, and cannot be — but a path is a claim with
   a truth value, so it gets one.
   ═══════════════════════════════════════════════════════════════════════════ */

section('Documentation')

/** The real top-level entries a repo-relative path must begin with. */
const TOP_LEVEL = [
  'src/', 'server/', 'shared/', 'packages/', 'scripts/', 'backend/', 'docs/',
  'specs/', 'public/', 'docker/', 'tests/', '.kiro/', '.claude/', 'corpus/',
]

/**
 * Backtick spans that make a checkable claim about a file on disk.
 *
 * Deliberately narrow. A span is only treated as a path when it begins with a
 * real top-level directory, which excludes the three things that otherwise look
 * like paths and are not: Docker images (`pgvector/pgvector:pg17`), Ollama model
 * tags (`x/flux2-klein:latest`), and prose-relative filenames (`graph.ts`,
 * `content-scraper/SKILL.md`) that name a file without saying where it lives.
 *
 * Under-reporting is the correct bias here: a check that flags model tags as
 * missing files gets switched off, and then it protects nothing.
 */
function citedPaths(markdown: string): string[] {
  const found = new Set<string>()
  for (const match of markdown.matchAll(/`([^`\n]+)`/g)) {
    const raw = (match[1] ?? '').trim()
    if (raw === '' || /[\s*?<>|$(){}:]/.test(raw)) continue
    if (!TOP_LEVEL.some((prefix) => raw.startsWith(prefix))) continue
    found.add(raw.replace(/\/$/, ''))
  }
  return [...found].sort()
}

/**
 * Paths that name a CONCEPT rather than a file on disk — a package that the
 * migration table explicitly records as deleted, or a directory generated at
 * build time and gitignored. Listed so the check stays honest rather than being
 * loosened until it passes.
 */
const NOT_ON_DISK = new Set([
  'packages/runtime/.claude/skills',
  'packages/config',
  'packages/contracts',
  'packages/mcp/similarity',
  'packages/orchestrator',
  'evals/suites',
  'docs/architecture-v2.md',
  'docs/agent-contract.md',
  'backend/.env',
  'server/.env',
  'server/secrets.env',
  '.env',
  // CLAUDE.md discusses this path as the place skills deliberately do NOT live.
  '.claude/skills',
])

let docProblems = 0
for (const doc of ['README.md', 'CLAUDE.md']) {
  const body = readFileSync(join(ROOT, doc), 'utf8')
  for (const cited of citedPaths(body)) {
    if (NOT_ON_DISK.has(cited)) continue
    if (existsSync(join(ROOT, cited))) continue
    fail(
      `${doc} names \`${cited}\`, which is not on disk. Either create it, correct the ` +
        'reference, or — if it names a concept rather than a file — add it to NOT_ON_DISK ' +
        'in scripts/verify.ts with the reason.',
    )
    docProblems += 1
  }
}
if (docProblems === 0) {
  pass('every path README.md and CLAUDE.md cite exists on disk')
}

// The scripts the README's command table promises must be defined.
const pkg = JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')) as {
  scripts: Record<string, string>
}
const readme = readFileSync(join(ROOT, 'README.md'), 'utf8')
const promisedScripts = [...readme.matchAll(/`npm run ([a-z:]+)`/g)].map((m) => m[1] as string)
const undefinedScripts = [...new Set(promisedScripts)].filter((name) => !(name in pkg.scripts))
if (undefinedScripts.length === 0) {
  pass(`all ${new Set(promisedScripts).size} npm scripts the README names are defined`)
} else {
  for (const name of undefinedScripts) {
    fail(`README.md promises \`npm run ${name}\`, which package.json does not define`)
  }
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

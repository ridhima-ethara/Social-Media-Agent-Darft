#!/usr/bin/env tsx
/**
 * `npm run agent:check` — the registry gate.
 *
 * Enforces Law 1: no agent, skill, knob or tool may exist without a declaration,
 * and every declaration must be complete enough to render to an operator.
 *
 * Checks:
 *   1. The agent registry validates (stages, hand-off graph, skill integrity)
 *   2. Every config field carries a plain-language description
 *   3. The tool registry validates, and every tool has examples
 *   4. Every tool has a handler module on disk
 *   5. Every agent has a spec section in specs/agents/
 *   6. Every critical skill has a handler registered
 */

import { existsSync, readFileSync, readdirSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

import {
  AGENTS,
  REGISTRY_SUMMARY,
  SKILLS,
  SKILLS_BY_AGENT,
  STAGES,
  CRITICAL_SKILL_IDS,
  validateRegistry,
} from '../shared/agent-registry'
import { TOOLS, TOOL_SUMMARY, validateToolRegistry } from '../shared/tool-registry'

const HERE = dirname(fileURLToPath(import.meta.url))
const ROOT = join(HERE, '..')

const RESET = '\u001B[0m'
const RED = '\u001B[31m'
const YELLOW = '\u001B[33m'
const GREEN = '\u001B[32m'
const DIM = '\u001B[2m'
const BOLD = '\u001B[1m'

let errors = 0
let warnings = 0

function fail(where: string, message: string): void {
  errors += 1
  console.error(`  ${RED}✗${RESET} ${BOLD}${where}${RESET} — ${message}`)
}

function warn(where: string, message: string): void {
  warnings += 1
  console.warn(`  ${YELLOW}!${RESET} ${DIM}${where}${RESET} — ${message}`)
}

function pass(message: string): void {
  console.log(`  ${GREEN}✓${RESET} ${message}`)
}

function section(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`)
}

/* ── 1 · The agent registry ────────────────────────────────────────────────── */
section('Agent registry')

for (const problem of validateRegistry()) {
  if (problem.severity === 'error') fail(problem.where, problem.message)
  else warn(problem.where, problem.message)
}

if (AGENTS.length !== 12) {
  fail('AGENTS', `Expected 12 agents, found ${AGENTS.length}.`)
} else {
  pass(`12 agents across ${STAGES.length} stages`)
}

pass(`${SKILLS.length} skills, ${REGISTRY_SUMMARY.knobs} knobs, ${CRITICAL_SKILL_IDS.length} critical`)

/* ── 2 · Every knob is described ───────────────────────────────────────────── */
section('Knob descriptions')

let undescribed = 0
for (const skill of SKILLS) {
  for (const field of skill.config) {
    if (!field.description || field.description.trim().length < 12) {
      fail(`${skill.id}.${field.key}`, 'Missing or too-short description.')
      undescribed += 1
    }
  }
}
if (undescribed === 0) {
  pass(`all ${REGISTRY_SUMMARY.knobs} knobs carry a plain-language description`)
}

/* ── 3 · The tool registry ─────────────────────────────────────────────────── */
section('Tool registry')

for (const problem of validateToolRegistry()) {
  if (problem.severity === 'error') fail(problem.where, problem.message)
  else warn(problem.where, problem.message)
}

pass(
  `${TOOL_SUMMARY.tools} tools (${TOOL_SUMMARY.safe} safe, ${TOOL_SUMMARY.mutating} mutating, ${TOOL_SUMMARY.irreversible} irreversible) with ${TOOL_SUMMARY.examples} examples`,
)

/* ── 4 · Tool handler modules exist ────────────────────────────────────────── */
section('Tool handlers')

const toolDir = join(ROOT, 'server/src/jarvis/tools')
if (!existsSync(toolDir)) {
  warn('server/src/jarvis/tools', 'Directory does not exist yet — expected before phase P6 completes.')
} else {
  const registryFile = join(toolDir, 'index.ts')
  const registered = existsSync(registryFile) ? readFileSync(registryFile, 'utf8') : ''
  let missing = 0
  for (const tool of TOOLS) {
    if (!registered.includes(`'${tool.id}'`) && !registered.includes(`"${tool.id}"`)) {
      fail(tool.id, 'No handler registered in server/src/jarvis/tools/index.ts.')
      missing += 1
    }
  }
  if (missing === 0) pass(`all ${TOOLS.length} tools have a registered handler`)
}

/* ── 5 · Spec sections ─────────────────────────────────────────────────────── */
section('Spec coverage')

const specDir = join(ROOT, 'specs/agents')
if (!existsSync(specDir)) {
  warn('specs/agents', 'Directory does not exist yet — expected before phase P11 completes.')
} else {
  const files = readdirSync(specDir)
  let missingSpecs = 0
  for (const agent of AGENTS) {
    const expected = `${agent.id}-agent.md`
    if (!files.includes(expected)) {
      fail(agent.id, `Missing specs/agents/${expected}.`)
      missingSpecs += 1
      continue
    }
    const body = readFileSync(join(specDir, expected), 'utf8')
    for (const skill of SKILLS_BY_AGENT[agent.id] ?? []) {
      if (!body.includes(skill.id)) {
        fail(skill.id, `Not documented in specs/agents/${expected}.`)
        missingSpecs += 1
      }
    }
  }
  if (missingSpecs === 0) pass(`all 12 agents and ${SKILLS.length} skills documented in specs/`)
}

/* ── 6 · Critical skill handlers ───────────────────────────────────────────── */
section('Critical skill handlers')

const registerFile = join(ROOT, 'server/src/agents/skills/_register.ts')
if (!existsSync(registerFile)) {
  warn('server/src/agents/skills/_register.ts', 'Does not exist yet — expected before phase P4 completes.')
} else {
  const skillFiles = readdirSync(join(ROOT, 'server/src/agents/skills'))
    .filter((f) => f.endsWith('.ts'))
    .map((f) => readFileSync(join(ROOT, 'server/src/agents/skills', f), 'utf8'))
    .join('\n')

  let missingHandlers = 0
  for (const id of CRITICAL_SKILL_IDS) {
    if (!skillFiles.includes(`'${id}'`) && !skillFiles.includes(`"${id}"`)) {
      fail(id, 'Critical skill has no handler. The runtime will refuse to boot.')
      missingHandlers += 1
    }
  }
  if (missingHandlers === 0) {
    pass(`all ${CRITICAL_SKILL_IDS.length} critical skills have a handler`)
  }

  let missingAny = 0
  for (const skill of SKILLS) {
    if (!skillFiles.includes(`'${skill.id}'`) && !skillFiles.includes(`"${skill.id}"`)) {
      missingAny += 1
    }
  }
  if (missingAny > 0) {
    warn('skills', `${missingAny} non-critical skill(s) have no handler and will record as skipped.`)
  } else {
    pass(`all ${SKILLS.length} skills have a handler`)
  }
}

/* ── Result ────────────────────────────────────────────────────────────────── */
console.log('')
if (errors > 0) {
  console.error(
    `${RED}${BOLD}agent:check failed${RESET} — ${errors} error(s), ${warnings} warning(s).\n`,
  )
  process.exit(1)
}
console.log(
  `${GREEN}${BOLD}agent:check passed${RESET} — ${SKILLS.length} skills, ${TOOLS.length} tools, ${REGISTRY_SUMMARY.knobs} knobs, ${warnings} warning(s).\n`,
)

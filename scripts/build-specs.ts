/**
 * SPEC GENERATION
 *
 * `specs/` is regenerated from the registry, never hand-edited. That is the
 * whole point: the registry is the single source of truth, so the documentation
 * cannot drift from what the runtime actually does.
 *
 *   npm run specs:build
 */

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import {
  AGENTS,
  AGENTS_BY_STAGE,
  REGISTRY_SUMMARY,
  SKILLS,
  SKILLS_BY_AGENT,
  STAGES,
} from '../shared/agent-registry'
import { TOOLS, TOOLS_BY_AGENT, TOOL_SUMMARY } from '../shared/tool-registry'
import { BRAND, BRAND_RULES } from '../shared/brand-voice'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const SPECS = join(ROOT, 'specs')

const GENERATED =
  '<!-- GENERATED FROM shared/agent-registry.ts BY scripts/build-specs.ts — DO NOT EDIT BY HAND -->\n'

function write(relative: string, body: string): void {
  const path = join(SPECS, relative)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${GENERATED}\n${body.trimEnd()}\n`, 'utf8')
  console.log(`  wrote specs/${relative}`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   PER-AGENT SPECS
   ═══════════════════════════════════════════════════════════════════════════ */

function agentSpec(agentId: string): string {
  const agent = AGENTS.find((a) => a.id === agentId)
  if (!agent) return ''
  const skills = SKILLS_BY_AGENT[agent.id] ?? []
  const tools = TOOLS_BY_AGENT[agent.id] ?? []

  const lines: string[] = []

  lines.push(`# ${agent.name}`, '')
  lines.push(`**Id:** \`${agent.id}\` · **Stage:** \`${agent.stage}\``, '')
  lines.push(`## Role`, '', agent.role, '')
  lines.push(`## What it does`, '', agent.description, '')

  lines.push('## Contract', '')
  lines.push('| | |', '|---|---|')
  lines.push(`| Consumes | ${agent.consumes.join(' · ') || '—'} |`)
  lines.push(`| Produces | ${agent.produces.join(' · ') || '—'} |`)
  lines.push(
    `| Hands off to | ${agent.handsOffTo.map((id) => `\`${id}\``).join(' · ') || '— (terminal)'} |`,
  )
  lines.push(`| Skills | ${skills.length} |`)
  lines.push(
    `| Knobs | ${skills.reduce((n, s) => n + s.config.length, 0)} |`,
    '',
  )

  lines.push('## Skills', '')
  for (const skill of skills) {
    lines.push(`### ${skill.order}. ${skill.name}`, '')
    lines.push(
      `\`${skill.id}\`${skill.critical ? ' · **critical** — cannot be switched off' : ''}${
        skill.enabledByDefault ? '' : ' · off by default'
      }`,
      '',
    )
    lines.push(skill.summary, '')
    lines.push(`- **In:** ${skill.inputs.join(', ') || '—'}`)
    lines.push(`- **Out:** ${skill.outputs.join(', ') || '—'}`, '')

    if (skill.config.length === 0) {
      lines.push('_This skill has no settings — it either runs or it does not._', '')
      continue
    }

    lines.push('| Setting | Key | Type | Default | What it does |')
    lines.push('|---|---|---|---|---|')
    for (const field of skill.config) {
      const range =
        field.min !== undefined && field.max !== undefined ? ` (${field.min}–${field.max})` : ''
      const options = field.options ? ` — ${field.options.join(' / ')}` : ''
      lines.push(
        `| ${field.label} | \`${field.key}\` | ${field.type}${range}${options} | \`${String(field.default)}\`${field.unit ? ` ${field.unit}` : ''} | ${field.description} |`,
      )
    }
    lines.push('')
  }

  if (tools.length > 0) {
    lines.push('## Tools Ethara may call against this agent', '')
    lines.push('| Tool | Risk | Summary |', '|---|---|---|')
    for (const tool of tools) {
      lines.push(`| \`${tool.id}\` | ${tool.risk} | ${tool.summary} |`)
    }
    lines.push('')
  }

  return lines.join('\n')
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE REST
   ═══════════════════════════════════════════════════════════════════════════ */

function architecture(): string {
  const lines: string[] = []
  lines.push('# Architecture', '')
  lines.push(
    `${REGISTRY_SUMMARY.agents} agents across ${REGISTRY_SUMMARY.stages} stages, ` +
      `${REGISTRY_SUMMARY.skills} skills and ${REGISTRY_SUMMARY.knobs} declared settings. ` +
      `Ethara acts through ${TOOL_SUMMARY.tools} tools ` +
      `(${TOOL_SUMMARY.safe} safe, ${TOOL_SUMMARY.mutating} mutating, ${TOOL_SUMMARY.irreversible} irreversible).`,
    '',
  )

  lines.push('## Stages', '')
  for (const stage of STAGES) {
    const agents = AGENTS_BY_STAGE[stage.id] ?? []
    lines.push(`### ${stage.name} (\`${stage.id}\`)`, '')
    lines.push(stage.summary, '')
    for (const agent of agents) {
      lines.push(`- **${agent.name}** (\`${agent.id}\`) — ${agent.role}`)
    }
    lines.push('')
  }

  lines.push('## The hand-off graph', '')
  lines.push('```mermaid', 'flowchart LR')
  for (const agent of AGENTS) {
    for (const target of agent.handsOffTo) {
      lines.push(`  ${agent.id}["${agent.name}"] --> ${target}["${AGENTS.find((a) => a.id === target)?.name ?? target}"]`)
    }
  }
  lines.push('```', '')

  lines.push(
    '> The Orchestration screen draws its edges from `handsOffTo` directly, so this picture **is** the spec. If the order is wrong, fix the graph — never special-case the orchestrator.',
    '',
  )

  return lines.join('\n')
}

function toolSpec(): string {
  const lines: string[] = []
  lines.push('# The tool registry', '')
  lines.push(
    'The command plane acts only through these. There is no path from an utterance to the database that does not pass through this registry, and `auditToolCoverage()` fails at boot if a declared tool has no handler.',
    '',
  )

  for (const risk of ['safe', 'mutating', 'irreversible'] as const) {
    const tools = TOOLS.filter((t) => t.risk === risk)
    lines.push(`## \`${risk}\` (${tools.length})`, '')
    for (const tool of tools) {
      lines.push(`### \`${tool.id}\` — ${tool.name}`, '')
      lines.push(tool.summary, '')
      lines.push(`- **Agent:** \`${tool.agentId}\``)
      lines.push(`- **Returns:** ${tool.returns}`)
      if (tool.confirmTemplate) lines.push(`- **Confirmation:** ${tool.confirmTemplate}`)
      lines.push(`- **Routes from:** ${tool.examples.map((e) => `"${e}"`).join(' · ')}`, '')
    }
  }

  return lines.join('\n')
}

function brandSpec(): string {
  const lines: string[] = []
  lines.push('# Brand voice', '')
  lines.push(`Ethara is ${BRAND.positioning}.`, '')
  lines.push('## Non-negotiables', '')
  lines.push(`- Emoji budget: **${BRAND.emojiBudget}** — no knob may raise it`)
  lines.push(`- Hashtags: **${BRAND.hashtags.min}–${BRAND.hashtags.max}** on every platform`)
  lines.push(`- Hook: at most **${BRAND.hookMaxWords}** words`)
  lines.push(
    `- Similarity caps: captions ≤ **${BRAND.similarityCap.caption}**, images ≤ **${BRAND.similarityCap.image}**`,
    '',
  )
  lines.push('## Caption structure', '', BRAND.captionStructure.join(' → '), '')

  lines.push('## The twenty rules', '')
  lines.push('| # | Area | Rule | Enforcement |', '|---|---|---|---|')
  for (const rule of BRAND_RULES) {
    lines.push(`| ${rule.n} | ${rule.area} | **${rule.title}** — ${rule.text} | ${rule.enforcement} |`)
  }
  lines.push('')

  return lines.join('\n')
}

function dataSpec(): string {
  const lines: string[] = []
  lines.push('# Skill index', '')
  lines.push(
    `Every skill id below is a **storage key**, written into \`skill_runs.skill_id\`. Renaming one orphans history, so ids are never renamed.`,
    '',
  )
  lines.push('| Skill id | Agent | Order | Critical | Knobs |', '|---|---|---|---|---|')
  for (const skill of SKILLS) {
    lines.push(
      `| \`${skill.id}\` | ${skill.agentId} | ${skill.order} | ${skill.critical ? 'yes' : ''} | ${skill.config.length} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
}

/* ═══════════════════════════════════════════════════════════════════════════
   RUN
   ═══════════════════════════════════════════════════════════════════════════ */

console.log('Regenerating specs/ from the registry…\n')

for (const agent of AGENTS) {
  write(`agents/${agent.id}-agent.md`, agentSpec(agent.id))
}

write('architecture.md', architecture())
write('api/tools.md', toolSpec())
write('product/brand-voice.md', brandSpec())
write('data/skills.md', dataSpec())

console.log(
  `\nDone — ${AGENTS.length} agent specs, ${SKILLS.length} skills and ${TOOLS.length} tools documented.`,
)

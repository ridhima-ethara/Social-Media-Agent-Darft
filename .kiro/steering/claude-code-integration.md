---
inclusion: always
---

# Kiro ↔ Claude Code Integration

This workspace uses **both Kiro and Claude Code**. Claude Code has an existing
spec-driven workflow ("KFC") under `.claude/`. This steering file keeps Kiro and
Claude Code aligned so both tools operate on the project consistently.

## Directory layout

| Purpose        | Claude Code (KFC)        | Kiro (native)      |
| -------------- | ------------------------ | ------------------ |
| Specs          | `.claude/specs/`         | `.kiro/specs/`     |
| Steering       | `.claude/steering/`      | `.kiro/steering/`  |
| Settings       | `.claude/settings/`      | `.kiro/settings/`  |
| Agents         | `.claude/agents/kfc/`    | (Kiro sub-agents)  |
| System prompts | `.claude/system-prompts/`| (built-in)         |

## Shared conventions

- **Spec workflow is identical in both tools**: requirements → design → tasks,
  each requiring explicit user approval before advancing to the next phase.
- Requirements use **EARS format** (WHEN/IF/WHERE/WHILE + SHALL).
- Feature directories use **kebab-case** names (e.g. `user-authentication`).
- Requirements/design/tasks live in
  `{spec_base}/{feature_name}/{requirements,design,tasks}.md`.

## How Kiro should behave here

- When creating specs in Kiro, mirror the KFC document structure so the artifacts
  are interchangeable with the Claude Code workflow.
- Before starting a spec, check `.claude/specs/` for an existing spec of the same
  feature to avoid duplicating work already done in Claude Code.
- Respect the KFC constraint set in
  `.claude/system-prompts/spec-workflow-starter.md`: never skip phases, always get
  explicit approval, and keep requirements in EARS format.
- Do not modify files under `.claude/agents/kfc/` or `.claude/system-prompts/`
  unless the user explicitly asks — those define the Claude Code workflow.

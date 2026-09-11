# packages/agents — one folder per agent

The folder is the unit. Everything an agent *is* sits in one place, and everything it *does* is
reachable from there in one hop.

```
packages/agents/
  roster.ts               ← imports the twelve folders in pipeline order; the structure IS the roster
  index.ts                ← AGENT_ROSTER · AGENT_BY_ID · tool-allowlist and folder↔registry audits
  graph.ts                ← edges() · pipelineOrder() · assertGraph() — derived from handsOffTo
  NN-<agent-id>/
    spec.ts               ← the seven-field AgentSpec + skill + tools + SKILLS (runtime ids) + HANDLERS path
    prompt.ts             ← seven blocks; points at the SKILL.md, never restates it
    index.ts              ← re-exports
```

## How a run threads through the files

| Step | File | What happens |
|---|---|---|
| 1 | `packages/agents/graph.ts` | `pipelineOrder()` derives scraping → validation → analysis → calendar → caption → image → review → publishing → analytics → learning from `handsOffTo` |
| 2 | `server/src/orchestrator.ts` | Runs agents in that order, passing each one's payload to the next |
| 3 | `server/src/agents/runtime.ts` | `runAgent(id)` executes the agent's skills in registry order, resolving every knob through `ctx.config` |
| 4 | `server/src/agents/<id>/handlers.ts` | The skill handlers — one file per agent, registered by id |
| 5 | `shared/agent-registry.ts` | The same skill ids, with every knob declared and described |
| 6 | `packages/skills/<skill>/SKILL.md` | The behavioural specification the handlers implement and the prompt points at |
| 7 | `server/src/integrations/*` | The connectors the handlers reach through — each behind `ServiceAdapter` with `isConfigured()` and `unavailableReason()`. `capture.ts` routes a scraping lane to Apify or crawl4ai; `integrationReport()` sweeps them all for `/health` |

## The invariants `npm run agent:check` enforces

- every folder's `SKILLS` equals the registry's skill ids for that agent (`assertFoldersMatchRegistry`)
- every `HANDLERS` path exists and registers exactly those ids
- no agent holds a tool its skill's Boundaries forbid (`assertToolAllowlists`)
- the flow graph is acyclic, starts at scraping, and hands off only to real agents (`assertGraph`)

## Adding an agent

1. `npm run agent:new -- <id> "<Name>" <stage>` — scaffolds the handler stub and prints the registry block.
2. Add the folder `packages/agents/NN-<id>/` with `spec.ts`, `prompt.ts`, `index.ts`.
3. Add one import line to `roster.ts`, in pipeline position.
4. Write `packages/skills/<skill>/SKILL.md` with Purpose · Inputs · Outputs · Rules · Boundaries.
5. Wire the hand-off: add `<id>` to the `handsOffTo` of whichever agent feeds it — the orchestrator and the Orchestration screen follow the graph.
6. `npm run agent:check` · `npm run build-skills` · `npm run specs:build`.

/**
 * THE HAND-OFF GRAPH
 *
 * Sequencing is derived from `handsOffTo`, never written down as a list. The
 * orchestrator follows this order; the Orchestration screen draws these edges;
 * `npm run agent:check` fails if the graph has a cycle outside the learning
 * loop or an agent nobody hands to and nothing starts.
 */

import { AGENT_ROSTER } from './index'

export interface Edge {
  from: string
  to: string
  /** `flow` is the pipeline; `memory` is the knowledge loop; `command` is the operator plane. */
  kind: 'flow' | 'memory' | 'command'
}

/** Every declared edge, classified. */
export function edges(): Edge[] {
  const out: Edge[] = []
  for (const agent of AGENT_ROSTER) {
    for (const to of agent.handsOffTo) {
      const kind: Edge['kind'] =
        agent.id === 'assistant' ? 'command' : agent.id === 'knowledge' || to === 'knowledge' ? 'memory' : 'flow'
      out.push({ from: agent.id, to, kind })
    }
  }
  return out
}

/**
 * The discovery-to-ship order, by topological sort over `flow` edges only.
 * Memory edges form the learning loop and are deliberately excluded — they
 * would make the graph cyclic, which is correct for a loop and wrong for an order.
 */
export function pipelineOrder(): string[] {
  const flow = edges().filter((e) => e.kind === 'flow')
  // Only agents on the flow graph are ordered. The command plane and the
  // memory-only agents (knowledge) sit beside the pipeline, not in it.
  const onFlow = new Set(flow.flatMap((e) => [e.from, e.to]))
  const ids = AGENT_ROSTER.map((a) => a.id).filter((id) => onFlow.has(id))
  const indegree = new Map(ids.map((id) => [id, 0]))
  for (const e of flow) indegree.set(e.to, (indegree.get(e.to) ?? 0) + 1)

  const order: string[] = []
  const ready = ids.filter((id) => (indegree.get(id) ?? 0) === 0)
  while (ready.length > 0) {
    const id = ready.shift() as string
    order.push(id)
    for (const e of flow.filter((x) => x.from === id)) {
      const n = (indegree.get(e.to) ?? 0) - 1
      indegree.set(e.to, n)
      if (n === 0) ready.push(e.to)
    }
  }
  return order
}

/** Agents that receive from `id`, and agents `id` receives from. */
export function neighbours(id: string): { upstream: string[]; downstream: string[] } {
  const all = edges()
  return {
    upstream: all.filter((e) => e.to === id).map((e) => e.from),
    downstream: all.filter((e) => e.from === id).map((e) => e.to),
  }
}

export interface GraphProblem {
  message: string
}

/** Structural checks the compiler cannot make. */
export function assertGraph(): GraphProblem[] {
  const problems: GraphProblem[] = []
  const known = new Set(AGENT_ROSTER.map((a) => a.id))
  for (const e of edges()) {
    if (!known.has(e.to)) problems.push({ message: `${e.from} hands off to "${e.to}", which is not an agent` })
  }
  const order = pipelineOrder()
  const expected = new Set(edges().filter((e) => e.kind === 'flow').flatMap((e) => [e.from, e.to])).size
  if (order.length !== expected) {
    problems.push({ message: `flow graph has a cycle: only ${order.length} of ${expected} agents can be ordered` })
  }
  const first = order[0]
  if (first !== 'scraping') problems.push({ message: `the pipeline should start at scraping, not ${first ?? 'nothing'}` })
  return problems
}

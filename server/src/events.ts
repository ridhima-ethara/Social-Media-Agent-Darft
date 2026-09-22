/**
 * THE EVENT BUS
 *
 * Law 8: state is server-truth; events are notifications. A dropped SSE
 * connection costs liveness, never correctness — the client reconciles by
 * refetching `/state`, never by replaying a log.
 *
 * One global bus, one ring buffer of 400, one endpoint. Publishing is
 * synchronous and never throws: a subscriber that fails is dropped, and the
 * work that emitted the event carries on.
 */

/* ═══════════════════════════════════════════════════════════════════════════
   EVENT VOCABULARY
   ═══════════════════════════════════════════════════════════════════════════ */

export const PIPELINE_EVENT_TYPES = [
  'pipeline.started',
  'pipeline.finished',
  'agent.started',
  'agent.finished',
  'agent.failed',
  'skill.started',
  'skill.finished',
  'skill.skipped',
  'skill.failed',
  'item.scraped',
  'item.held',
  'item.validated',
  'hashtag.captured',
  'hashtag.validated',
  'keyword.ranked',
  'idea.created',
  'idea.ranked',
  'draft.generated',
  'post.published',
  'knowledge.written',
  'knowledge.build.started',
  'knowledge.build.finished',
  'activity',
  'assistant.command.received',
  'assistant.plan.composed',
  'assistant.confirm.required',
  'assistant.confirm.resolved',
  'assistant.step.started',
  'assistant.step.finished',
  'assistant.step.failed',
  'assistant.token',
  'assistant.command.finished',
  'assistant.command.cancelled',
  'assistant.notice',
] as const

export type PipelineEventType = (typeof PIPELINE_EVENT_TYPES)[number]

export interface PipelineEvent {
  type: PipelineEventType
  /** ISO timestamp, stamped at publish time by the bus. */
  at: string
  agentId?: string
  skillId?: string
  runId?: string
  turnId?: string
  message?: string
  data?: Record<string, unknown>
}

/** What a publisher supplies. The bus adds `at`. */
export type PipelineEventInput = Omit<PipelineEvent, 'at'>

export type EventListener = (event: PipelineEvent) => void

/* ═══════════════════════════════════════════════════════════════════════════
   THE BUS
   ═══════════════════════════════════════════════════════════════════════════ */

const RING_SIZE = 400
/** How many buffered events a new subscriber is caught up with. */
export const REPLAY_SIZE = 40

class EventBus {
  private readonly listeners = new Set<EventListener>()
  private readonly ring: PipelineEvent[] = []
  private published = 0

  publish(input: PipelineEventInput): PipelineEvent {
    const event: PipelineEvent = { ...input, at: new Date().toISOString() }

    this.ring.push(event)
    if (this.ring.length > RING_SIZE) this.ring.splice(0, this.ring.length - RING_SIZE)
    this.published += 1

    // A broken subscriber must never break the work that emitted the event.
    for (const listener of [...this.listeners]) {
      try {
        listener(event)
      } catch {
        this.listeners.delete(listener)
      }
    }

    return event
  }

  subscribe(listener: EventListener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  /** The last `count` events, for catching a fresh connection up. */
  recent(count = REPLAY_SIZE): PipelineEvent[] {
    return this.ring.slice(-Math.max(0, count))
  }

  stats(): { buffered: number; published: number; subscribers: number } {
    return {
      buffered: this.ring.length,
      published: this.published,
      subscribers: this.listeners.size,
    }
  }

  /** Test and reseed support only. */
  reset(): void {
    this.ring.length = 0
    this.published = 0
  }
}

/** The single bus. Everything that emits, emits here. */
export const bus = new EventBus()

/* ═══════════════════════════════════════════════════════════════════════════
   CONVENIENCES
   ═══════════════════════════════════════════════════════════════════════════ */

export function publish(input: PipelineEventInput): PipelineEvent {
  return bus.publish(input)
}

export function subscribe(listener: EventListener): () => void {
  return bus.subscribe(listener)
}

export function recentEvents(count = REPLAY_SIZE): PipelineEvent[] {
  return bus.recent(count)
}

/**
 * An activity line — the human-readable stream the Dashboard and Agent Activity
 * render. Persisting it is the caller's job; this only notifies.
 */
export function publishActivity(
  agentId: string | undefined,
  message: string,
  status: 'ok' | 'running' | 'warn' | 'error' = 'ok',
  data?: Record<string, unknown>,
): PipelineEvent {
  return bus.publish({
    type: 'activity',
    agentId,
    message,
    data: { status, ...data },
  })
}

/** Serialises one event as an SSE frame. */
export function toSseFrame(event: PipelineEvent): string {
  return `data: ${JSON.stringify(event)}\n\n`
}

/** A named SSE frame, for the per-command Ethara stream. */
export function toNamedSseFrame(name: string, payload: unknown): string {
  return `event: ${name}\ndata: ${JSON.stringify(payload)}\n\n`
}

export async function sleep(ms: number): Promise<void> {
  if (ms <= 0) return
  await new Promise((resolve) => setTimeout(resolve, ms))
}

/**
 * RUN CONSOLE
 *
 * Every agent and skill execution, streamed live from the runtime as it
 * happens. This is the screen that makes the telemetry claim checkable: if a
 * skill ran, it is here, with its duration and its verdict.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Pause, Play, Trash2 } from 'lucide-react'
import { SKILL_BY_ID } from '@shared/agent-registry'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { PlayButton } from '../components/play-button'
import { subscribeToEvents } from '../lib/api'
import { Badge, Btn, EmptyState, Metric, Tabs } from '../components/ui'
import type { RuntimeEvent } from '../types'

type Filter = 'all' | 'agents' | 'skills' | 'items' | 'knowledge' | 'assistant'

const BUFFER = 400

const TYPE_TONE: Record<string, string> = {
  'agent.started': 'text-accent-bright',
  'agent.finished': 'text-good-ink',
  'agent.failed': 'text-critical-ink',
  'skill.started': 'text-ink-3',
  'skill.finished': 'text-ink-2',
  'skill.skipped': 'text-warn',
  'skill.failed': 'text-critical-ink',
  'pipeline.started': 'text-accent-bright',
  'pipeline.finished': 'text-good-ink',
  'knowledge.written': 'text-accent-bright',
  'post.published': 'text-good-ink',
  activity: 'text-ink-3',
}

const TYPE_GLYPH: Record<string, string> = {
  'agent.started': '▸',
  'agent.finished': '✓',
  'agent.failed': '✕',
  'skill.started': '·',
  'skill.finished': '✓',
  'skill.skipped': '⊘',
  'skill.failed': '✕',
  'pipeline.started': '▶',
  'pipeline.finished': '■',
  'item.scraped': '↓',
  'item.validated': '⊙',
  'hashtag.captured': '#',
  'knowledge.written': '✎',
  'post.published': '↗',
}

function bucketOf(type: string): Filter {
  if (type.startsWith('assistant.')) return 'assistant'
  if (type.startsWith('agent.') || type.startsWith('pipeline.')) return 'agents'
  if (type.startsWith('skill.')) return 'skills'
  if (type.startsWith('item.') || type.startsWith('hashtag.') || type.startsWith('keyword.')) return 'items'
  if (type.startsWith('knowledge.')) return 'knowledge'
  return 'all'
}

export function RunConsole() {
  const apiMode = useStore((s) => s.apiMode)
  const runScraping = useStore((s) => s.runScraping)
  const openTheater = useStore((s) => s.openTheater)
  const scrapeRun = useStore((s) => s.scrapeRun)

  const [events, setEvents] = useState<RuntimeEvent[]>([])
  const [paused, setPaused] = useState(false)
  const [filter, setFilter] = useState<Filter>('all')
  const pausedRef = useRef(false)
  const scroller = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    pausedRef.current = paused
  }, [paused])

  useEffect(() => {
    if (apiMode !== 'connected') return
    // Buffered to the last 400, matching the server's ring.
    return subscribeToEvents((event) => {
      if (pausedRef.current) return
      setEvents((prev) => [...prev, event].slice(-BUFFER))
    })
  }, [apiMode])

  useEffect(() => {
    if (paused) return
    scroller.current?.scrollTo({ top: scroller.current.scrollHeight, behavior: 'smooth' })
  }, [events, paused])

  const stats = useMemo(() => {
    const skills = events.filter((e) => e.type === 'skill.finished').length
    const failures = events.filter((e) => e.type.endsWith('.failed')).length
    const durations = events
      .map((e) => Number(e.data?.durationMs ?? 0))
      .filter((n) => Number.isFinite(n) && n > 0)
    const avg = durations.length > 0 ? durations.reduce((a, b) => a + b, 0) / durations.length : 0
    return { skills, failures, avg }
  }, [events])

  const rows = filter === 'all' ? events : events.filter((event) => bucketOf(event.type) === filter)

  if (apiMode !== 'connected') {
    return (
      <>
        <PageHeader
          title="Run Console"
          subtitle="Every agent and skill execution, streamed live from the runtime as it happens."
          askPrompt="What did the last run do?"
        />
        <EmptyState
          title="The runtime is not connected"
          body="This screen streams real executions from the API — there is nothing honest to show without it. Start the server and the log will begin filling immediately."
          action={
            <code className="mono rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12px] text-ink-2">
              npm run dev:server
            </code>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader
        title="Run Console"
        subtitle="Every agent and skill execution, streamed live from the runtime as it happens."
        askPrompt="What did the last run do?"
        actions={
          <>
            <Btn variant="ghost" onClick={() => setEvents([])}>
              <Trash2 size={13} /> Clear
            </Btn>
            <Btn variant="subtle" onClick={() => setPaused(!paused)}>
              {paused ? <Play size={13} /> : <Pause size={13} />}
              {paused ? 'Resume' : 'Pause'}
            </Btn>
            <PlayButton
              label="Run SocialAI"
              running={scrapeRun.running}
              onClick={() => {
                openTheater()
                void runScraping()
              }}
            />
          </>
        }
      />

      <section className="mb-3 flex flex-wrap items-center gap-3">
        <span className="flex items-center gap-1.5 text-[12px] text-ink-2">
          <span
            className={`h-1.5 w-1.5 rounded-full ${paused ? 'bg-warn' : 'bg-good anim-pulse-dot'}`}
            aria-hidden="true"
          />
          {paused ? 'Paused' : 'Live'}
        </span>
        <Metric label="Events" value={events.length} className="min-w-24" />
        <Metric label="Skills completed" value={stats.skills} className="min-w-28" />
        <Metric label="Failures" value={stats.failures} tone={stats.failures > 0 ? 'critical' : undefined} className="min-w-24" />
        <Metric label="Avg skill time" value={`${Math.round(stats.avg)}ms`} className="min-w-28" />
      </section>

      <Tabs<Filter>
        className="mb-3"
        active={filter}
        onChange={setFilter}
        tabs={[
          { id: 'all', label: 'All', count: events.length },
          { id: 'agents', label: 'Agents', count: events.filter((e) => bucketOf(e.type) === 'agents').length },
          { id: 'skills', label: 'Skills', count: events.filter((e) => bucketOf(e.type) === 'skills').length },
          { id: 'items', label: 'Items', count: events.filter((e) => bucketOf(e.type) === 'items').length },
          { id: 'knowledge', label: 'Knowledge', count: events.filter((e) => bucketOf(e.type) === 'knowledge').length },
          { id: 'assistant', label: 'Command', count: events.filter((e) => bucketOf(e.type) === 'assistant').length },
        ]}
      />

      <div ref={scroller} className="card mono max-h-[62vh] overflow-y-auto p-3 text-[11.5px]">
        {rows.length === 0 ? (
          <p className="px-1 py-6 text-center text-ink-3">
            Nothing yet. Run the pipeline and every skill execution will stream here as it happens.
          </p>
        ) : (
          rows.map((event, i) => {
            const time = new Date(event.at).toLocaleTimeString('en-GB', { hour12: false })
            const duration = Number(event.data?.durationMs ?? 0)
            const verdict = event.data?.validation as string | undefined
            const skillName = event.skillId ? (SKILL_BY_ID[event.skillId]?.name ?? event.skillId) : null

            return (
              <div
                key={`${event.at}-${i}`}
                className="anim-stream-in flex flex-wrap items-baseline gap-2 border-b border-line/40 py-1 last:border-0"
              >
                <span className="tabular shrink-0 text-ink-3">{time}</span>
                <span className={`shrink-0 ${TYPE_TONE[event.type] ?? 'text-ink-3'}`}>
                  {TYPE_GLYPH[event.type] ?? '·'}
                </span>
                {event.agentId ? <span className="shrink-0 text-accent-bright">{event.agentId}</span> : null}
                {skillName ? <span className="shrink-0 text-ink-2">{skillName}</span> : null}
                <span className="min-w-0 flex-1 text-ink-3">{event.message ?? event.type}</span>
                {duration > 0 ? <span className="tabular shrink-0 text-ink-3">({duration}ms)</span> : null}
                {verdict ? (
                  <Badge tone={verdict === 'validated' ? 'good' : verdict === 'rejected' ? 'critical' : 'warn'}>
                    {verdict}
                  </Badge>
                ) : null}
              </div>
            )
          })
        )}
      </div>
    </>
  )
}

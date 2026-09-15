/**
 * AGENT STUDIO
 *
 * Every declared knob, rendered by type, with its plain-language description
 * beneath it. If a setting is not visible here, it does not exist — and a
 * critical skill cannot be switched off, because the pipeline would produce
 * wrong output without it.
 */

import { useEffect, useMemo, useState } from 'react'
import { Lock, RotateCcw, Search } from 'lucide-react'
import {
  AGENTS,
  AGENT_BY_ID,
  REGISTRY_SUMMARY,
  SKILLS,
  SKILLS_BY_AGENT,
  STAGES,
  defaultSkillConfig,
} from '@shared/agent-registry'
import { TOOLS } from '@shared/tool-registry'
import { AgentIcon } from '../components/agent-icon'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { api } from '../lib/api'
import { Select, Badge, Metric, RiskPill, Tabs } from '../components/ui'
import type { AgentId, RegistrySkill } from '../types'

type ConfigValue = string | number | boolean

export function AgentStudio() {
  const apiMode = useStore((s) => s.apiMode)
  const toast = useStore((s) => s.toast)

  const [tab, setTab] = useState<'skills' | 'tools'>('skills')
  const [selectedAgent, setSelectedAgent] = useState<AgentId>('scraping')
  const [query, setQuery] = useState('')
  const [remote, setRemote] = useState<RegistrySkill[] | null>(null)
  const [overrides, setOverrides] = useState<Record<string, Record<string, ConfigValue>>>({})
  const [disabled, setDisabled] = useState<Record<string, boolean>>({})
  const [saving, setSaving] = useState<string | null>(null)

  // The screen falls back to the static registry when the runtime is unreachable.
  useEffect(() => {
    if (apiMode !== 'connected') {
      setRemote(null)
      return
    }
    void api
      .registry()
      .then((payload) => setRemote(payload.skills))
      .catch(() => setRemote(null))
  }, [apiMode])

  /** Registry defaults merged with whatever the workspace has overridden. */
  const skills: RegistrySkill[] = useMemo(() => {
    if (remote) return remote
    return SKILLS.map((skill) => ({
      ...skill,
      enabled: skill.enabledByDefault,
      values: defaultSkillConfig(skill.id),
      isOverridden: false,
      stats: { runs: 0, failures: 0, avgMs: 0 },
    })) as RegistrySkill[]
  }, [remote])

  const valueOf = (skill: RegistrySkill, key: string): ConfigValue =>
    overrides[skill.id]?.[key] ?? skill.values[key] ?? (skill.config.find((f) => f.key === key)?.default as ConfigValue)

  const isEnabled = (skill: RegistrySkill): boolean =>
    disabled[skill.id] !== undefined ? !disabled[skill.id] : skill.enabled

  const customisedCount = skills.filter((s) => s.isOverridden || overrides[s.id]).length
  const offCount = skills.filter((s) => !isEnabled(s)).length

  const patch = (skill: RegistrySkill, key: string, value: ConfigValue): void => {
    setOverrides((prev) => ({ ...prev, [skill.id]: { ...(prev[skill.id] ?? {}), [key]: value } }))
    if (apiMode !== 'connected') return

    setSaving(skill.id)
    void api
      .patchSkill(skill.id, { config: { [key]: value } })
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : 'That setting did not save.', 'critical'),
      )
      .finally(() => setSaving(null))
  }

  const toggle = (skill: RegistrySkill): void => {
    if (skill.critical) {
      toast(
        `${skill.name} is required — the pipeline would produce wrong output without it, so it cannot be switched off.`,
        'warn',
      )
      return
    }
    const next = isEnabled(skill)
    setDisabled((prev) => ({ ...prev, [skill.id]: next }))
    if (apiMode !== 'connected') return

    setSaving(skill.id)
    void api
      .patchSkill(skill.id, { enabled: !next })
      .catch((error: unknown) =>
        toast(error instanceof Error ? error.message : 'That change did not save.', 'critical'),
      )
      .finally(() => setSaving(null))
  }

  const reset = (skill: RegistrySkill): void => {
    setOverrides((prev) => {
      const next = { ...prev }
      delete next[skill.id]
      return next
    })
    if (apiMode !== 'connected') return
    void api.resetSkill(skill.id).catch(() => toast('That reset did not save.', 'critical'))
  }

  const agentSkills = (SKILLS_BY_AGENT[selectedAgent] ?? [])
    .map((spec) => skills.find((s) => s.id === spec.id))
    .filter((s): s is RegistrySkill => Boolean(s))
    .filter((s) => {
      if (query.trim().length === 0) return true
      const haystack = `${s.name} ${s.summary} ${s.id}`.toLowerCase()
      return haystack.includes(query.toLowerCase())
    })

  const agentSpec = AGENT_BY_ID[selectedAgent]

  const sections = useMemo(() => {
    const grouped = new Map<string, RegistrySkill[]>()
    for (const skill of agentSkills) {
      const key = skill.section ?? 'Skills'
      grouped.set(key, [...(grouped.get(key) ?? []), skill])
    }
    return [...grouped.entries()]
  }, [agentSkills])

  return (
    <>
      <PageHeader
        title="Agent Studio"
        subtitle="Every knob the agents read, with the plain-language description of what it does. If it is not here, the operator cannot see it — and that would be a defect."
        actions={
          <Badge tone={apiMode === 'connected' ? 'good' : 'warn'}>
            {apiMode === 'connected' ? 'Connected to agent runtime' : 'Standalone — changes are local only'}
          </Badge>
        }
      />

      <section className="mb-4 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Metric label="Agents" value={REGISTRY_SUMMARY.agents} />
        <Metric label="Skills" value={REGISTRY_SUMMARY.skills} />
        <Metric label="Tunable settings" value={REGISTRY_SUMMARY.knobs} />
        <Metric label="Customised" value={customisedCount} />
        <Metric label="Switched off" value={offCount} tone={offCount > 0 ? 'warn' : undefined} />
      </section>

      <Tabs<'skills' | 'tools'>
        className="mb-4"
        active={tab}
        onChange={setTab}
        tabs={[
          { id: 'skills', label: 'Skills', count: SKILLS.length },
          { id: 'tools', label: 'Tools', count: TOOLS.length },
        ]}
      />

      {tab === 'tools' ? <ToolsTab /> : null}

      {tab === 'skills' ? (
        <div className="grid gap-4 xl:grid-cols-[280px_1fr]">
          {/* ── Agent rail ────────────────────────────────────────────── */}
          <aside className="card max-h-[72vh] overflow-y-auto p-2">
            {STAGES.map((stage) => {
              const inStage = AGENTS.filter((a) => a.stage === stage.id)
              if (inStage.length === 0) return null
              return (
                <div key={stage.id} className="mb-2">
                  <p className="px-2 py-1 text-[10px] uppercase tracking-[0.09em] text-ink-3">{stage.name}</p>
                  <ul className="space-y-0.5">
                    {inStage.map((agent) => {
                      const count = (SKILLS_BY_AGENT[agent.id] ?? []).length
                      const anyOff = (SKILLS_BY_AGENT[agent.id] ?? []).some((spec) => {
                        const skill = skills.find((s) => s.id === spec.id)
                        return skill ? !isEnabled(skill) : false
                      })
                      const active = agent.id === selectedAgent

                      return (
                        <li key={agent.id}>
                          <button
                            type="button"
                            onClick={() => setSelectedAgent(agent.id)}
                            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-1.5 text-left transition-colors ${
                              active ? 'bg-accent/12 text-ink' : 'text-ink-3 hover:bg-surface-2 hover:text-ink-2'
                            }`}
                          >
                            <AgentIcon agentId={agent.id} size={13} className={`shrink-0 ${active ? 'text-accent-bright' : ''}`} />
                            <span className="min-w-0 flex-1 truncate text-[12px] font-medium">{agent.name}</span>
                            {anyOff ? <span className="h-1.5 w-1.5 rounded-full bg-warn" aria-hidden="true" /> : null}
                            <span className="tabular text-[10.5px] text-ink-3">{count}</span>
                          </button>
                        </li>
                      )
                    })}
                  </ul>
                </div>
              )
            })}
          </aside>

          {/* ── Detail ────────────────────────────────────────────────── */}
          <div className="min-w-0">
            <section className="card mb-3 p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="display flex items-center gap-2 text-lg">
                    {selectedAgent ? <AgentIcon agentId={selectedAgent} size={17} className="text-accent-bright" /> : null}
                    {agentSpec?.name}
                  </h2>
                  <p className="mt-0.5 text-[12px] text-ink-3">{agentSpec?.role}</p>
                  <p className="mt-1.5 max-w-2xl text-[11.5px] leading-relaxed text-ink-3">
                    {agentSpec?.description}
                  </p>
                </div>
                <label className="relative min-w-48">
                  <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Find a skill…"
                    aria-label="Find a skill"
                    className="w-full rounded-lg border border-line bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] outline-none focus:border-accent"
                  />
                </label>
              </div>

              <div className="mt-3 grid gap-3 md:grid-cols-3">
                {[
                  { label: 'Consumes', items: agentSpec?.consumes ?? [] },
                  { label: 'Produces', items: agentSpec?.produces ?? [] },
                  {
                    label: 'Hands off to',
                    items: (agentSpec?.handsOffTo ?? []).map((id) => AGENT_BY_ID[id]?.name ?? id),
                  },
                ].map((column) => (
                  <div key={column.label}>
                    <p className="text-[10px] uppercase tracking-[0.09em] text-ink-3">{column.label}</p>
                    <ul className="mt-1 space-y-0.5">
                      {column.items.map((item) => (
                        <li key={item} className="text-[11.5px] leading-relaxed text-ink-2">
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            </section>

            {sections.map(([section, list]) => (
              <div key={section} className="mb-4">
                <h3 className="display mb-2 text-sm">{section}</h3>
                <div className="space-y-3">
                  {list.map((skill) => (
                    <SkillCard
                      key={skill.id}
                      skill={skill}
                      enabled={isEnabled(skill)}
                      customised={skill.isOverridden || Boolean(overrides[skill.id])}
                      saving={saving === skill.id}
                      valueOf={(key) => valueOf(skill, key)}
                      onPatch={(key, value) => patch(skill, key, value)}
                      onToggle={() => toggle(skill)}
                      onReset={() => reset(skill)}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   A SKILL, AND ITS KNOBS
   ═══════════════════════════════════════════════════════════════════════════ */

function SkillCard({
  skill,
  enabled,
  customised,
  saving,
  valueOf,
  onPatch,
  onToggle,
  onReset,
}: {
  skill: RegistrySkill
  enabled: boolean
  customised: boolean
  saving: boolean
  valueOf: (key: string) => ConfigValue
  onPatch: (key: string, value: ConfigValue) => void
  onToggle: () => void
  onReset: () => void
}) {
  return (
    <article className={`card p-4 transition-opacity duration-[var(--dur-base)] ${enabled ? '' : 'opacity-60'}`}>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="tabular text-[11px] text-ink-3">{skill.order}</span>
            <h4 className="text-[13px] font-medium text-ink">{skill.name}</h4>
            {skill.critical ? (
              <Badge tone="magenta">
                <Lock size={9} /> Required
              </Badge>
            ) : null}
            {customised ? <Badge tone="accent">Customised</Badge> : null}
            {!enabled ? <Badge tone="warn">Off</Badge> : null}
            {saving ? <span className="text-[10.5px] text-ink-3">Saving…</span> : null}
          </div>

          <p className="mt-1 max-w-2xl text-[11.5px] leading-relaxed text-ink-3">{skill.summary}</p>

          <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[10.5px] text-ink-3">
            <span>
              <span className="text-ink-2">In:</span> {skill.inputs.join(', ') || '—'}
            </span>
            <span>
              <span className="text-ink-2">Out:</span> {skill.outputs.join(', ') || '—'}
            </span>
          </div>

          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <code className="mono rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-ink-3">{skill.id}</code>
            <span className="tabular rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
              {skill.stats.runs} runs · {skill.stats.avgMs}ms avg · {skill.stats.failures} failures
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5">
          <button
            type="button"
            onClick={onReset}
            title="Reset to the registry default"
            aria-label={`Reset ${skill.name}`}
            className="rounded-md border border-line p-1.5 text-ink-3 transition-colors hover:border-line-strong hover:text-ink"
          >
            <RotateCcw size={12} />
          </button>

          <button
            type="button"
            role="switch"
            aria-checked={enabled}
            aria-label={`${enabled ? 'Disable' : 'Enable'} ${skill.name}`}
            disabled={skill.critical}
            onClick={onToggle}
            title={skill.critical ? 'Required — this skill cannot be switched off.' : undefined}
            className={`h-5 w-9 rounded-full border transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-50 ${
              enabled ? 'border-accent bg-accent/30' : 'border-line bg-surface-3'
            }`}
          >
            <span
              className="block h-3.5 w-3.5 rounded-full bg-ink transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out-soft)]"
              style={{ transform: `translateX(${enabled ? 19 : 3}px)` }}
            />
          </button>
        </div>
      </header>

      {skill.config.length === 0 ? (
        <p className="mt-3 text-[11.5px] text-ink-3">
          This skill has no settings — it either runs or it does not.
        </p>
      ) : (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {skill.config.map((field) => {
            const value = valueOf(field.key)
            return (
              <div key={field.key} className="rounded-lg border border-line bg-surface-2 p-2.5">
                <label className="block">
                  <span className="flex items-center justify-between gap-2">
                    <span className="text-[11.5px] font-medium text-ink">{field.label}</span>
                    {field.type === 'number' || field.type === 'percent' ? (
                      <span className="tabular text-[11px] text-accent-bright">
                        {String(value)}
                        {field.unit ? ` ${field.unit}` : field.type === 'percent' ? '%' : ''}
                      </span>
                    ) : null}
                  </span>

                  {field.type === 'boolean' ? (
                    <button
                      type="button"
                      role="switch"
                      aria-checked={Boolean(value)}
                      onClick={() => onPatch(field.key, !value)}
                      className={`mt-1.5 h-5 w-9 rounded-full border transition-colors duration-[var(--dur-fast)] ${
                        value ? 'border-accent bg-accent/30' : 'border-line bg-surface-3'
                      }`}
                    >
                      <span
                        className="block h-3.5 w-3.5 rounded-full bg-ink transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out-soft)]"
                        style={{ transform: `translateX(${value ? 19 : 3}px)` }}
                      />
                    </button>
                  ) : field.type === 'enum' ? (
                    <Select
                      value={String(value)}
                      onChange={(next) => onPatch(field.key, next)}
                      options={(field.options ?? []).map((option) => ({ value: option, label: option }))}
                      className="mt-1.5 w-full"
                      size="sm"
                    />
                  ) : field.type === 'text' ? (
                    <input
                      value={String(value)}
                      onChange={(event) => onPatch(field.key, event.target.value)}
                      className="mt-1.5 w-full rounded-md border border-line bg-surface px-2 py-1 text-[11.5px] outline-none focus:border-accent"
                    />
                  ) : (
                    <input
                      type="range"
                      min={field.min ?? 0}
                      max={field.max ?? 100}
                      step={field.step ?? 1}
                      value={Number(value)}
                      onChange={(event) => onPatch(field.key, Number(event.target.value))}
                      className="mt-1.5 w-full accent-[var(--color-accent)]"
                    />
                  )}
                </label>

                <p className="mt-1.5 text-[10.5px] leading-relaxed text-ink-3">{field.description}</p>
              </div>
            )
          })}
        </div>
      )}
    </article>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE TOOLS TAB — the command plane's declared surface
   ═══════════════════════════════════════════════════════════════════════════ */

function ToolsTab() {
  const openBar = useStore((s) => s.openBar)

  const byAgent = useMemo(() => {
    const grouped = new Map<string, typeof TOOLS>()
    for (const tool of TOOLS) {
      // Tools with no owning agent are cross-cutting reads; group them together.
      const key = tool.agentId ?? 'assistant'
      grouped.set(key, [...(grouped.get(key) ?? []), tool])
    }
    return [...grouped.entries()]
  }, [])

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-[12px] leading-relaxed text-ink-3">
        The command plane acts only through these. There is no path from an utterance to the database that does not
        pass through this registry, and the example utterances below are also what the deterministic
        parser's grammar is built from.
      </p>

      {byAgent.map(([agentId, tools]) => (
        <section key={agentId} className="card overflow-hidden">
          <header className="border-b border-line px-4 py-2.5">
            <h3 className="display text-[13px]">{AGENT_BY_ID[agentId as AgentId]?.name ?? agentId}</h3>
          </header>

          <ul>
            {tools.map((tool) => (
              <li key={tool.id} className="border-b border-line/60 px-4 py-2.5 last:border-0">
                <div className="flex flex-wrap items-center gap-2">
                  <code className="mono rounded bg-surface-2 px-1.5 py-0.5 text-[10.5px] text-accent-bright">
                    {tool.id}
                  </code>
                  <span className="text-[12px] font-medium text-ink">{tool.name}</span>
                  <RiskPill risk={tool.risk} />
                </div>

                <p className="mt-1 text-[11.5px] leading-relaxed text-ink-3">{tool.summary}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
                  <span className="text-ink-2">Returns:</span> {tool.returns}
                </p>

                <div className="mt-1.5 flex flex-wrap gap-1.5">
                  {tool.examples.slice(0, 3).map((example) => (
                    <button
                      key={example}
                      type="button"
                      onClick={() => openBar(example)}
                      className="rounded-full border border-line px-2 py-0.5 text-[10.5px] text-ink-3 transition-colors hover:border-accent hover:text-accent-bright"
                    >
                      “{example}”
                    </button>
                  ))}
                </div>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  )
}

/**
 * COMPETITOR INTELLIGENCE — the Analysis Agent's second module tab.
 *
 *   Universe      the configurable P0/P1 competitors: filter, add, edit,
 *                 deactivate, remove, run
 *   Profile       one competitor's latest (or any earlier) profile — the
 *                 competitor-profiling skill's template, every claim labelled
 *                 FACT / SOURCE-DERIVED / INFERENCE / ANALYSIS and linked to
 *                 its sources; changes since the previous version
 *   Market        the cross-competitor analysis: landscape, trends, capability
 *                 evidence, content trends, gaps, Ethara opportunities / threats
 *   Comparison    chosen competitors side by side on factual dimensions —
 *                 evidence, never scores
 *
 * Server-truth: everything shown comes from /api/analysis/competitors; a value
 * no source gave reads "Not available from current sources".
 */

import { ExternalLink, Pencil, Play, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState, type ReactElement } from 'react'
import {
  CAPABILITIES,
  CLAIM_LABEL,
  NOT_AVAILABLE,
  type Claim,
  type Competitor,
  type CompetitorProfile,
  type CompetitorSource,
  type MarketTrend,
} from '@shared/competitor-intel'
import { api, type CompetitorDraft, type CompetitorsState } from '../lib/api'
import { useStore } from '../store'
import { Badge, Btn, Modal, Select, Tabs, timeAgo } from './ui'

type View = 'universe' | 'profile' | 'market' | 'compare'

const KIND_TONE = { fact: 'good', source_derived: 'accent', inference: 'warn', analysis: 'neutral' } as const

/* ── claims and sources ───────────────────────────────────────────────── */

function SourceLinks({ ids, sources }: { ids: string[]; sources: Map<string, CompetitorSource> }) {
  if (ids.length === 0) return null
  return (
    <span className="ml-1 inline-flex flex-wrap gap-1 align-middle">
      {ids.map((id) => {
        const s = sources.get(id)
        if (s && !/^https?:\/\//.test(s.source_url)) {
          return (
            <span key={id} title={`${s.title ?? s.source_type} — internal, not a public page`} className="mono rounded border border-line px-1 text-[9px] text-ink-3">
              {id.includes(':') ? id.split(':')[1] : id}
            </span>
          )
        }
        return s ? (
          <a
            key={id}
            href={s.source_url}
            target="_blank"
            rel="noreferrer noopener"
            title={`${s.source_type} · ${s.source_url}${s.source_date ? ` · ${s.source_date.slice(0, 10)}` : ''}`}
            className="mono rounded border border-line px-1 text-[9px] text-accent-bright hover:border-accent"
          >
            {id.includes(':') ? id.split(':')[1] : id}
          </a>
        ) : null
      })}
    </span>
  )
}

function ClaimLine({ claim, sources }: { claim: Claim; sources: Map<string, CompetitorSource> }) {
  return (
    <span className="text-[11.5px] leading-snug text-ink-2">
      <span className="mono mr-1.5 align-middle">
        <Badge tone={KIND_TONE[claim.kind]} className="!px-1.5 !py-0 !text-[8.5px] uppercase tracking-[0.06em]">
          {CLAIM_LABEL[claim.kind]}
        </Badge>
      </span>
      {claim.text}
      <SourceLinks ids={claim.source_ids} sources={sources} />
    </span>
  )
}

function ClaimList({ title, claims, sources, empty = NOT_AVAILABLE }: { title: string; claims: Claim[]; sources: Map<string, CompetitorSource>; empty?: string }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[11.5px] font-semibold text-ink">{title}</p>
      {claims.length === 0 ? (
        <p className="mt-1 text-[11px] text-ink-3">{empty}</p>
      ) : (
        <ul className="mt-1.5 space-y-1.5">
          {claims.map((c) => (
            <li key={c.text}>
              <ClaimLine claim={c} sources={sources} />
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

const sourceMap = (sources: CompetitorSource[]): Map<string, CompetitorSource> => new Map(sources.map((s) => [s.id, s]))

/* ── the tab ──────────────────────────────────────────────────────────── */

export function CompetitorIntelligenceSection() {
  const toast = useStore((s) => s.toast)
  const [state, setState] = useState<CompetitorsState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [view, setView] = useState<View>('universe')
  const [selected, setSelected] = useState<string | null>(null)
  const [depth, setDepth] = useState<'quick' | 'deep'>('quick')

  const load = useCallback(async () => {
    try {
      setState(await api.competitors())
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Competitor Intelligence could not be loaded.')
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  // While a run is in progress, poll its status; reload everything when it ends.
  const running = state?.status.running === true
  useEffect(() => {
    if (!running) return
    const t = setInterval(() => {
      void api
        .competitorStatus()
        .then(({ status }) => {
          setState((s) => (s ? { ...s, status } : s))
          if (!status.running) void load()
        })
        .catch(() => undefined)
    }, 5000)
    return () => clearInterval(t)
  }, [running, load])

  const run = async (body: { competitorIds?: string[]; dueOnly?: boolean }, label: string): Promise<void> => {
    try {
      const r = await api.runCompetitors({ ...body, depth })
      toast(`Competitor Intelligence started · ${r.competitors} competitor(s) · ${depth} scan`, 'good', `${label} — this takes a few minutes; the tab updates as it goes.`)
      await load()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'The run could not start.', 'warn')
    }
  }

  const openProfile = (id: string): void => {
    setSelected(id)
    setView('profile')
  }

  if (error) return <p className="card p-4 text-[12px] text-critical">{error}</p>
  if (!state) return <p className="card p-4 text-[12px] text-ink-3">Loading Competitor Intelligence…</p>

  const self = state.universe.find((c) => c.is_self) ?? null
  const rivals = state.universe.filter((c) => !c.is_self)
  const withProfiles = state.intelligence.competitors.filter((c) => c.profile !== null && c.id !== self?.id).length
  const m = state.methodology
  const status = state.status

  return (
    <section className="card p-4" aria-label="Competitor Intelligence">
      <div className="flex flex-wrap items-center gap-2.5">
        <div className="min-w-0">
          <h3 className="display text-[15px] text-ink">Competitor Intelligence</h3>
          <p className="text-[11px] text-ink-3">
            {rivals.length} competitors in the universe · {withProfiles} profiled · methodology: competitor-profiling
            {m.skills[0]?.version ? ` v${m.skills[0].version}` : ''} from coreyhaines31/marketingskills
            {m.commit ? ` @ ${m.commit.slice(0, 7)}` : ''}
          </p>
        </div>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Select
            value={depth}
            onChange={(v) => setDepth(v === 'deep' ? 'deep' : 'quick')}
            options={[
              { value: 'quick', label: 'Quick scan' },
              { value: 'deep', label: 'Deep profile' },
            ]}
            ariaLabel="Profile depth"
            size="sm"
          />
          <Btn onClick={() => void run({ competitorIds: rivals.filter((c) => c.tier === 'P0' && c.status === 'active').map((c) => c.id) }, 'P0 competitors')} disabled={running}>
            <Play size={12} aria-hidden="true" /> Run P0
          </Btn>
          <Btn onClick={() => void run({ dueOnly: true }, 'Due competitors')} disabled={running}>
            Run due
          </Btn>
          <Btn variant="primary" onClick={() => void run({}, 'Every active competitor')} disabled={running}>
            <RefreshCw size={12} className={running ? 'animate-spin' : ''} aria-hidden="true" /> {running ? 'Running…' : 'Run all active'}
          </Btn>
        </div>
      </div>

      {running || (status.finished_at && status.errors.length > 0) ? (
        <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-[11px] text-ink-2">
          {running ? (
            <span>
              {status.step ?? 'Working'} · {status.done} of {status.total} done · started {timeAgo(status.started_at)}
            </span>
          ) : (
            <span>Last run finished {timeAgo(status.finished_at)}</span>
          )}
          {status.errors.length > 0 ? (
            <ul className="mt-1 space-y-0.5 text-[10.5px] text-ink-3">
              {status.errors.slice(0, 6).map((e) => (
                <li key={e}>· {e}</li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <details className="mt-2 text-[10.5px] text-ink-3">
        <summary className="cursor-pointer">How the skill’s tools are answered here</summary>
        <ul className="mt-1 space-y-0.5">
          {m.tools.map((t) => (
            <li key={t.tool}>
              <span className="mono text-ink-2">{t.tool}</span> → {t.bound_to} ·{' '}
              <span className={t.available ? 'text-good' : 'text-warn'}>{t.available ? 'available' : 'not available'}</span> — {t.note}
            </li>
          ))}
        </ul>
      </details>

      <Tabs<View>
        className="mt-3"
        tabs={[
          { id: 'universe', label: 'Competitor Universe', count: rivals.length },
          { id: 'profile', label: 'Competitor Profile' },
          { id: 'market', label: 'Market Analysis' },
          { id: 'compare', label: 'Comparison' },
        ]}
        active={view}
        onChange={setView}
      />

      <div className="mt-3">
        {view === 'universe' ? (
          <UniverseView state={state} onChanged={load} onOpen={openProfile} onRun={(id, name) => void run({ competitorIds: [id] }, name)} running={running} />
        ) : view === 'profile' ? (
          <ProfileView state={state} selected={selected} onSelect={setSelected} />
        ) : view === 'market' ? (
          <MarketView state={state} />
        ) : (
          <CompareView state={state} running={running} onProfileSelf={(id) => void run({ competitorIds: [id] }, 'Ethara.AI')} />
        )}
      </div>
    </section>
  )
}

/* ── Screen 1 · Competitor Universe ───────────────────────────────────── */

const EMPTY_DRAFT: CompetitorDraft = {
  name: '',
  tier: 'P1',
  category: '',
  description: '',
  website_url: '',
  social_urls: [],
  keywords: [],
  status: 'active',
  monitoring_frequency: 'monthly',
}

function UniverseView({ state, onChanged, onOpen, onRun, running }: { state: CompetitorsState; onChanged: () => Promise<void>; onOpen: (id: string) => void; onRun: (id: string, name: string) => void; running: boolean }) {
  const toast = useStore((s) => s.toast)
  const [tier, setTier] = useState('all')
  const [category, setCategory] = useState('all')
  const [status, setStatus] = useState('all')
  const [editing, setEditing] = useState<{ id: string | null; draft: CompetitorDraft } | null>(null)

  const rivals = useMemo(() => state.universe.filter((c) => !c.is_self), [state.universe])
  const categories = useMemo(() => [...new Set(rivals.map((c) => c.category).filter(Boolean))].sort(), [rivals])
  const profiles = new Map(state.intelligence.competitors.map((c) => [c.id, c.profile]))
  const rows = rivals.filter((c) => (tier === 'all' || c.tier === tier) && (category === 'all' || c.category === category) && (status === 'all' || c.status === status))

  const save = async (): Promise<void> => {
    if (!editing) return
    try {
      if (editing.id) await api.updateCompetitor(editing.id, editing.draft)
      else await api.createCompetitor(editing.draft)
      toast(editing.id ? 'Competitor updated.' : 'Competitor added to the universe.', 'good')
      setEditing(null)
      await onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not save the competitor.', 'warn')
    }
  }

  const toggle = async (c: Competitor): Promise<void> => {
    try {
      await api.updateCompetitor(c.id, { status: c.status === 'active' ? 'inactive' : 'active' })
      await onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not update the competitor.', 'warn')
    }
  }

  const remove = async (c: Competitor): Promise<void> => {
    if (!window.confirm(`Remove ${c.name} and its profile history? Deactivating keeps the history.`)) return
    try {
      await api.deleteCompetitor(c.id)
      toast(`${c.name} removed.`, 'good')
      await onChanged()
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Could not remove the competitor.', 'warn')
    }
  }

  const all = (label: string): { value: string; label: string } => ({ value: 'all', label })
  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Select value={tier} onChange={setTier} options={[all('All tiers'), { value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }]} ariaLabel="Tier" size="sm" />
        <Select value={category} onChange={setCategory} options={[all('All categories'), ...categories.map((c) => ({ value: c, label: c }))]} ariaLabel="Category" size="sm" />
        <Select value={status} onChange={setStatus} options={[all('Any status'), { value: 'active', label: 'Active' }, { value: 'inactive', label: 'Inactive' }]} ariaLabel="Status" size="sm" />
        <span className="tabular text-[11px] text-ink-3">{rows.length} shown</span>
        <Btn className="ml-auto" onClick={() => setEditing({ id: null, draft: { ...EMPTY_DRAFT } })}>
          <Plus size={12} aria-hidden="true" /> Add competitor
        </Btn>
      </div>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[860px] border-collapse text-left">
          <thead>
            <tr className="mono border-b border-line text-[8.5px] uppercase tracking-[0.1em] text-ink-3">
              <th className="px-2 py-2 font-medium">Competitor</th>
              <th className="px-2 py-2 font-medium">Tier</th>
              <th className="px-2 py-2 font-medium">Category</th>
              <th className="px-2 py-2 font-medium">Status</th>
              <th className="px-2 py-2 font-medium">Monitoring</th>
              <th className="px-2 py-2 font-medium">Last analyzed</th>
              <th className="px-2 py-2 font-medium">Profile</th>
              <th className="px-2 py-2 font-medium" />
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => {
              const p = profiles.get(c.id) ?? null
              return (
                <tr key={c.id} className="border-b border-line/60 align-top text-[11.5px] text-ink-2 hover:bg-surface-3/40">
                  <td className="px-2 py-2">
                    <button type="button" onClick={() => onOpen(c.id)} className="font-semibold text-ink hover:text-accent-bright">
                      {c.name}
                    </button>
                    <span className="block text-[10px] text-ink-3">{c.description}</span>
                  </td>
                  <td className="px-2 py-2">
                    <Badge tone={c.tier === 'P0' ? 'accent' : 'neutral'}>{c.tier}</Badge>
                  </td>
                  <td className="px-2 py-2">{c.category || '—'}</td>
                  <td className="px-2 py-2">
                    <Badge tone={c.status === 'active' ? 'good' : 'neutral'}>{c.status}</Badge>
                  </td>
                  <td className="px-2 py-2">{c.monitoring_frequency}</td>
                  <td className="px-2 py-2 text-ink-3">{c.last_analyzed_at ? timeAgo(c.last_analyzed_at) : 'never'}</td>
                  <td className="px-2 py-2 text-ink-3">
                    {p ? (
                      <span>
                        v{p.profile_version} · {p.sources.length} sources{p.changes.length > 0 ? ` · ${p.changes.length} changes` : ''}
                        {p.error ? <span className="block text-[10px] text-warn">{p.error}</span> : null}
                      </span>
                    ) : (
                      'not profiled yet'
                    )}
                  </td>
                  <td className="whitespace-nowrap px-2 py-2 text-right">
                    <span className="inline-flex gap-1">
                      <button type="button" title="Profile this competitor now" disabled={running} onClick={() => onRun(c.id, c.name)} className="rounded border border-line p-1 text-ink-3 hover:text-ink disabled:opacity-40">
                        <Play size={11} aria-hidden="true" />
                      </button>
                      <button type="button" title="Edit" onClick={() => setEditing({ id: c.id, draft: { name: c.name, tier: c.tier, category: c.category, description: c.description, website_url: c.website_url, social_urls: c.social_urls, keywords: c.keywords, status: c.status, monitoring_frequency: c.monitoring_frequency } })} className="rounded border border-line p-1 text-ink-3 hover:text-ink">
                        <Pencil size={11} aria-hidden="true" />
                      </button>
                      <button type="button" title={c.status === 'active' ? 'Deactivate (keeps history)' : 'Activate'} onClick={() => void toggle(c)} className="rounded border border-line px-1.5 text-[10px] text-ink-3 hover:text-ink">
                        {c.status === 'active' ? 'off' : 'on'}
                      </button>
                      <button type="button" title="Remove" onClick={() => void remove(c)} className="rounded border border-line p-1 text-ink-3 hover:text-critical">
                        <Trash2 size={11} aria-hidden="true" />
                      </button>
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={editing !== null}
        onClose={() => setEditing(null)}
        title={editing?.id ? 'Edit competitor' : 'Add competitor'}
        subtitle="Saved to the Competitor Universe — no code change needed. The next run follows it."
        footer={
          <div className="flex justify-end gap-2">
            <Btn onClick={() => setEditing(null)}>Cancel</Btn>
            <Btn variant="primary" onClick={() => void save()} disabled={!editing || editing.draft.name.trim() === ''}>
              Save
            </Btn>
          </div>
        }
      >
        {editing ? <CompetitorForm draft={editing.draft} onChange={(draft) => setEditing({ ...editing, draft })} /> : null}
      </Modal>
    </div>
  )
}

function CompetitorForm({ draft, onChange }: { draft: CompetitorDraft; onChange: (d: CompetitorDraft) => void }) {
  const field = 'w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] text-ink focus:border-accent focus:outline-none'
  const label = 'mb-1 block text-[11px] font-medium text-ink-2'
  const list = (v: string): string[] => v.split(/[\n,]/).map((x) => x.trim()).filter(Boolean)
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="sm:col-span-2">
        <span className={label}>Name</span>
        <input className={field} value={draft.name} onChange={(e) => onChange({ ...draft, name: e.target.value })} />
      </label>
      <label>
        <span className={label}>Tier</span>
        <Select value={draft.tier} onChange={(v) => onChange({ ...draft, tier: v === 'P0' ? 'P0' : 'P1' })} options={[{ value: 'P0', label: 'P0' }, { value: 'P1', label: 'P1' }]} ariaLabel="Tier" />
      </label>
      <label>
        <span className={label}>Category</span>
        <input className={field} value={draft.category} onChange={(e) => onChange({ ...draft, category: e.target.value })} />
      </label>
      <label className="sm:col-span-2">
        <span className={label}>Focus / description</span>
        <input className={field} value={draft.description} onChange={(e) => onChange({ ...draft, description: e.target.value })} />
      </label>
      <label className="sm:col-span-2">
        <span className={label}>Website URL</span>
        <input className={field} value={draft.website_url} placeholder="https://" onChange={(e) => onChange({ ...draft, website_url: e.target.value })} />
      </label>
      <label className="sm:col-span-2">
        <span className={label}>Other links — Wikipedia, G2, Capterra, TrustRadius, Product Hunt, social (one per line)</span>
        <textarea className={`${field} min-h-[60px]`} value={draft.social_urls.join('\n')} onChange={(e) => onChange({ ...draft, social_urls: list(e.target.value) })} />
      </label>
      <label className="sm:col-span-2">
        <span className={label}>Keywords (comma separated)</span>
        <input className={field} value={draft.keywords.join(', ')} onChange={(e) => onChange({ ...draft, keywords: list(e.target.value) })} />
      </label>
      <label>
        <span className={label}>Status</span>
        <Select value={draft.status} onChange={(v) => onChange({ ...draft, status: v === 'inactive' ? 'inactive' : 'active' })} options={[{ value: 'active', label: 'Active — monitored' }, { value: 'inactive', label: 'Inactive' }]} ariaLabel="Status" />
      </label>
      <label>
        <span className={label}>Monitoring frequency</span>
        <Select
          value={draft.monitoring_frequency}
          onChange={(v) => onChange({ ...draft, monitoring_frequency: v === 'weekly' ? 'weekly' : v === 'manual' ? 'manual' : 'monthly' })}
          options={[{ value: 'weekly', label: 'Weekly' }, { value: 'monthly', label: 'Monthly' }, { value: 'manual', label: 'Manual only' }]}
          ariaLabel="Monitoring frequency"
        />
      </label>
    </div>
  )
}

/* ── Screen 2 · Competitor Profile ────────────────────────────────────── */

function ProfileView({ state, selected, onSelect }: { state: CompetitorsState; selected: string | null; onSelect: (id: string) => void }) {
  const id = selected ?? state.intelligence.competitors.find((c) => c.profile)?.id ?? state.universe[0]?.id ?? null
  const [data, setData] = useState<{ profile: CompetitorProfile | null; versions: Array<{ version: number; generated_at: string; changes: number }> } | null>(null)
  // A version pick belongs to the competitor it was made for; switching competitor shows its latest.
  const [pick, setPick] = useState<{ id: string | null; version: number } | null>(null)
  const version = pick && pick.id === id ? pick.version : null
  const setVersion = (v: number): void => setPick({ id, version: v })
  useEffect(() => {
    if (!id) return
    let live = true
    void api
      .competitorProfile(id, version ?? undefined)
      .then((r) => {
        if (live) setData({ profile: r.profile, versions: r.versions })
      })
      .catch(() => {
        if (live) setData({ profile: null, versions: [] })
      })
    return () => {
      live = false
    }
  }, [id, version])

  if (!id) return <p className="text-[12px] text-ink-3">The universe is empty.</p>
  const p = data?.profile ?? null
  const src = sourceMap(p?.sources ?? [])

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={id}
          onChange={onSelect}
          options={state.universe.map((c) => ({ value: c.id, label: c.is_self ? `${c.name} · our company` : `${c.name} · ${c.tier}`, group: c.is_self ? 'Our company' : c.category || 'Uncategorised' }))}
          ariaLabel="Competitor"
          size="sm"
        />
        {data && data.versions.length > 0 ? (
          <Select
            value={String(version ?? data.versions[0]?.version ?? '')}
            onChange={(v) => setVersion(Number(v))}
            options={data.versions.map((v) => ({ value: String(v.version), label: `v${v.version} · ${v.generated_at.slice(0, 10)}${v.changes > 0 ? ` · ${v.changes} changes` : ''}` }))}
            ariaLabel="Profile version"
            size="sm"
          />
        ) : null}
      </div>
      {!p ? (
        <p className="mt-3 rounded-xl border border-line bg-surface-2/50 p-3 text-[12px] text-ink-3">No profile yet — run this competitor from the Universe (▶).</p>
      ) : (
        <div className="mt-3 space-y-3">
          {/* overview */}
          <div className="rounded-xl border border-accent/30 bg-accent/[0.06] p-3">
            <div className="flex flex-wrap items-center gap-2">
              <h4 className="text-[14px] font-semibold text-ink">{p.name}</h4>
              <Badge tone={p.tier === 'P0' ? 'accent' : 'neutral'}>{p.tier}</Badge>
              <span className="text-[11px] text-ink-3">{p.category}</span>
              <a href={p.website_url} target="_blank" rel="noreferrer noopener" className="inline-flex items-center gap-1 text-[11px] text-accent-bright">
                {p.website_url} <ExternalLink size={10} aria-hidden="true" />
              </a>
              <span className="ml-auto text-[10px] text-ink-3">
                v{p.profile_version} · {p.depth} scan · generated {p.generated_at.slice(0, 10)} · {p.methodology.skill} {p.methodology.version ?? ''}
              </span>
            </div>
            {p.error ? <p className="mt-1 text-[11px] text-warn">{p.error}</p> : null}
            <ul className="mt-2 space-y-1">
              {p.overview.map((c) => (
                <li key={c.text}>
                  <ClaimLine claim={c} sources={src} />
                </li>
              ))}
            </ul>
          </div>

          {/* changes */}
          {p.changes.length > 0 ? (
            <div className="rounded-xl border border-line p-3">
              <p className="text-[11.5px] font-semibold text-ink">Changes since the previous analysis</p>
              <ul className="mono mt-1.5 space-y-0.5 text-[11px]">
                {p.changes.map((c) => (
                  <li key={`${c.area}-${c.detail}`} className={c.kind === 'added' ? 'text-good' : c.kind === 'removed' ? 'text-critical' : 'text-warn'}>
                    {c.kind === 'added' ? '+' : c.kind === 'removed' ? '−' : '~'} <span className="text-ink-3">{c.area}:</span> {c.detail}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {/* at a glance */}
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11.5px] font-semibold text-ink">At a Glance</p>
            <dl className="mt-1.5 grid gap-x-4 gap-y-1 text-[11.5px] sm:grid-cols-2">
              {(
                [
                  ['Tagline', p.at_a_glance.tagline],
                  ['Founded', p.at_a_glance.founded],
                  ['Headquarters', p.at_a_glance.headquarters],
                  ['Team size', p.at_a_glance.team_size],
                  ['Funding', p.at_a_glance.funding],
                ] as const
              ).map(([k, f]) => (
                <div key={k} className="flex gap-2">
                  <dt className="w-[100px] shrink-0 text-ink-3">{k}</dt>
                  <dd className={f.claim ? 'text-ink-2' : 'text-ink-3'}>
                    {f.value}
                    {f.claim ? <SourceLinks ids={f.claim.source_ids} sources={src} /> : null}
                  </dd>
                </div>
              ))}
              <div className="flex gap-2">
                <dt className="w-[100px] shrink-0 text-ink-3">Domain rank</dt>
                <dd className="text-ink-3">{p.seo.domain_rank ?? NOT_AVAILABLE}</dd>
              </div>
              <div className="flex gap-2">
                <dt className="w-[100px] shrink-0 text-ink-3">Organic traffic</dt>
                <dd className="text-ink-3">{p.seo.estimated_organic_traffic !== null ? `${Math.round(p.seo.estimated_organic_traffic).toLocaleString('en-GB')} / month (est., DataForSEO)` : NOT_AVAILABLE}</dd>
              </div>
            </dl>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ClaimList
              title="Positioning & Messaging"
              claims={[...(p.positioning.value_proposition ? [p.positioning.value_proposition] : []), ...(p.positioning.positioning_angle ? [p.positioning.positioning_angle] : []), ...p.positioning.messaging_themes, ...p.positioning.core_claims]}
              sources={src}
            />
            <ClaimList title="Target Audience" claims={p.positioning.target_audience} sources={src} />
          </div>

          <div className="rounded-xl border border-line p-3">
            <p className="text-[11.5px] font-semibold text-ink">Product & Features</p>
            {p.products.length === 0 ? <p className="mt-1 text-[11px] text-ink-3">{NOT_AVAILABLE}</p> : null}
            <ul className="mt-1.5 space-y-1.5">
              {p.products.map((x) => (
                <li key={x.name}>
                  <span className="mr-1.5 text-[11.5px] font-semibold text-ink">{x.name}</span>
                  <ClaimLine claim={x.description} sources={src} />
                </li>
              ))}
            </ul>
            {p.capabilities.length > 0 ? (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {p.capabilities.map((c) => (
                  <span key={c.capability} title={c.evidence.text} className="rounded-full border border-line-strong px-2 py-0.5 text-[10.5px] text-ink-2">
                    {c.capability}
                    <SourceLinks ids={c.evidence.source_ids} sources={src} />
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <ClaimList title="Differentiators" claims={p.differentiators} sources={src} />
            <ClaimList title="Integrations" claims={p.integrations} sources={src} />
            <ClaimList title="Product direction signals" claims={p.product_direction} sources={src} />
          </div>

          {/* pricing */}
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11.5px] font-semibold text-ink">Pricing</p>
            {p.pricing.tiers.length === 0 ? (
              <p className="mt-1 text-[11px] text-ink-3">{p.pricing.note ?? NOT_AVAILABLE}</p>
            ) : (
              <table className="mt-1.5 w-full text-left text-[11.5px]">
                <thead>
                  <tr className="mono text-[8.5px] uppercase tracking-[0.1em] text-ink-3">
                    <th className="py-1 font-medium">Tier</th>
                    <th className="py-1 font-medium">Price</th>
                    <th className="py-1 font-medium">Key inclusions</th>
                  </tr>
                </thead>
                <tbody>
                  {p.pricing.tiers.map((t) => (
                    <tr key={t.name} className="align-top text-ink-2">
                      <td className="py-1 pr-2 font-semibold text-ink">{t.name}</td>
                      <td className="py-1 pr-2">
                        {t.price}
                        <SourceLinks ids={t.source_ids} sources={src} />
                      </td>
                      <td className="py-1 text-ink-3">{t.inclusions.join(' · ')}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            <ul className="mt-1.5 space-y-1">
              {[p.pricing.model, p.pricing.free_tier, p.pricing.enterprise]
                .filter((c): c is Claim => c !== null)
                .map((c) => (
                  <li key={c.text}>
                    <ClaimLine claim={c} sources={src} />
                  </li>
                ))}
            </ul>
          </div>

          {/* content and SEO */}
          <div className="grid gap-3 lg:grid-cols-2">
            <ClaimList title="Content Strategy" claims={[...p.content.themes, ...p.content.formats, ...p.content.strategy_signals]} sources={src} />
            <div className="rounded-xl border border-line p-3">
              <p className="text-[11.5px] font-semibold text-ink">SEO / Market Presence</p>
              {p.seo.status !== 'ok' ? (
                <p className="mt-1 text-[11px] text-ink-3">
                  {NOT_AVAILABLE}
                  {p.seo.reason ? ` — ${p.seo.reason}` : ''}
                </p>
              ) : (
                <dl className="mt-1.5 grid grid-cols-2 gap-1 text-[11.5px]">
                  {(
                    [
                      ['Domain rank', p.seo.domain_rank],
                      ['Organic keywords', p.seo.organic_keywords],
                      ['Est. organic traffic', p.seo.estimated_organic_traffic],
                      ['Traffic value (USD)', p.seo.organic_traffic_value_usd],
                      ['Backlinks', p.seo.backlinks],
                      ['Referring domains', p.seo.referring_domains],
                    ] as const
                  ).map(([k, v]) => (
                    <div key={k}>
                      <dt className="text-ink-3">{k}</dt>
                      <dd className="tabular text-ink">{v === null ? '—' : Math.round(v).toLocaleString('en-GB')}</dd>
                    </div>
                  ))}
                </dl>
              )}
              {p.seo.top_pages.length > 0 ? (
                <ul className="mt-1.5 space-y-0.5 text-[10.5px] text-ink-3">
                  {p.seo.top_pages.slice(0, 5).map((t) => (
                    <li key={t.url} className="truncate">
                      {t.url} {t.traffic !== null ? `· ${Math.round(t.traffic).toLocaleString('en-GB')}` : ''}
                    </li>
                  ))}
                </ul>
              ) : null}
              {p.seo.organic_competitors.length > 0 ? <p className="mt-1 text-[10.5px] text-ink-3">Organic competitors: {p.seo.organic_competitors.join(', ')}</p> : null}
            </div>
          </div>

          {/* customer signals */}
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11.5px] font-semibold text-ink">Customer / Review Signals</p>
            <ul className="mt-1 flex flex-wrap gap-1.5">
              {p.customer_signals.reviews.map((r) => (
                <li key={r.source} title={r.reason ?? undefined}>
                  <Badge tone={r.status === 'ok' ? 'good' : 'neutral'}>
                    {r.source}: {r.status === 'ok' ? 'read' : r.status === 'blocked_by_robots' ? 'robots.txt disallows' : 'not available'}
                  </Badge>
                </li>
              ))}
            </ul>
            <div className="mt-2 grid gap-2 lg:grid-cols-3">
              <ClaimList title="Common praise" claims={p.customer_signals.praise} sources={src} />
              <ClaimList title="Common complaints" claims={p.customer_signals.complaints} sources={src} />
              <ClaimList title="Requested capabilities" claims={p.customer_signals.requests} sources={src} />
            </div>
          </div>

          {/* recent developments */}
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11.5px] font-semibold text-ink">Recent Developments</p>
            {p.recent_developments.length === 0 ? <p className="mt-1 text-[11px] text-ink-3">No dated development found in the window.</p> : null}
            <ul className="mt-1.5 space-y-1.5">
              {p.recent_developments.map((r) => (
                <li key={r.title} className="text-[11.5px] text-ink-2">
                  <span className="mono mr-2 text-[10.5px] text-ink-3">{r.date?.slice(0, 10)}</span>
                  <span className="font-semibold text-ink">{r.title}</span>
                  <SourceLinks ids={r.source_ids} sources={src} />
                  {r.summary ? (
                    <span className="mt-0.5 block">
                      <ClaimLine claim={r.summary} sources={src} />
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
          </div>

          <div className="grid gap-3 lg:grid-cols-2">
            <ClaimList title="Strengths" claims={p.strengths} sources={src} />
            <ClaimList title="Weaknesses" claims={p.weaknesses} sources={src} />
          </div>
          <div className="grid gap-3 lg:grid-cols-2">
            <ClaimList title="Where they lead (vs Ethara)" claims={p.competitive_implications.where_they_lead} sources={src} />
            <ClaimList title="Where Ethara leads" claims={p.competitive_implications.where_ethara_leads} sources={src} />
            <ClaimList title="Opportunities for Ethara" claims={p.competitive_implications.opportunities} sources={src} />
            <ClaimList title="Threats" claims={p.competitive_implications.threats} sources={src} />
          </div>

          {/* sources */}
          <div className="rounded-xl border border-line p-3">
            <p className="text-[11.5px] font-semibold text-ink">Sources · generated {p.generated_at.slice(0, 16).replace('T', ' ')} UTC</p>
            <ol className="mt-1.5 space-y-0.5 text-[10.5px] text-ink-3">
              {p.sources.map((s) => (
                <li key={s.id} className="flex gap-2">
                  <span className="mono w-[28px] shrink-0 text-ink-2">{s.id}</span>
                  <span className="w-[70px] shrink-0">{s.source_type}</span>
                  {/^https?:\/\//.test(s.source_url) ? (
                    <a href={s.source_url} target="_blank" rel="noreferrer noopener" className="min-w-0 truncate text-accent-bright hover:underline" title={s.title ?? s.source_url}>
                      {s.title ? `${s.title} — ` : ''}
                      {s.source_url}
                    </a>
                  ) : (
                    <span className="min-w-0 truncate text-ink-2" title="Internal — not a public page">
                      {s.title ?? s.source_url}
                    </span>
                  )}
                  <span className="ml-auto shrink-0">{s.source_date ? `dated ${s.source_date.slice(0, 10)} · ` : ''}retrieved {s.retrieved_at.slice(0, 10)}</span>
                </li>
              ))}
            </ol>
            {p.coverage_notes.length > 0 ? (
              <ul className="mt-2 space-y-0.5 text-[10.5px] text-ink-3">
                {p.coverage_notes.map((n) => (
                  <li key={n}>· {n}</li>
                ))}
              </ul>
            ) : null}
            {p.injection_attempts > 0 ? <p className="mt-1 text-[10.5px] text-warn">{p.injection_attempts} instruction-like passage(s) in the fetched pages were ignored.</p> : null}
          </div>
        </div>
      )}
    </div>
  )
}

/* ── Screen 3 · Market Analysis ───────────────────────────────────────── */

function TrendList({ title, trends, sources }: { title: string; trends: MarketTrend[]; sources: Map<string, CompetitorSource> }) {
  return (
    <div className="rounded-xl border border-line p-3">
      <p className="text-[11.5px] font-semibold text-ink">{title}</p>
      {trends.length === 0 ? <p className="mt-1 text-[11px] text-ink-3">None evidenced in the current profiles.</p> : null}
      <ul className="mt-1.5 space-y-2.5">
        {trends.map((t) => (
          <li key={t.trend} className="text-[11.5px] text-ink-2">
            <span className="font-semibold text-ink">{t.trend}</span>
            {t.date ? <span className="mono ml-2 text-[10px] text-ink-3">{t.date}</span> : null}
            {t.companies.length > 0 ? <span className="block text-[10.5px] text-ink-3">{t.companies.join(' · ')}</span> : null}
            <ul className="mt-0.5 space-y-0.5">
              {t.evidence.map((e) => (
                <li key={e.text}>
                  <ClaimLine claim={e} sources={sources} />
                </li>
              ))}
            </ul>
            {t.why_it_matters ? (
              <span className="mt-0.5 block text-[11px] text-ink-3">
                <Badge tone="neutral" className="!px-1.5 !py-0 !text-[8.5px] uppercase">
                  ANALYSIS · why it matters
                </Badge>{' '}
                {t.why_it_matters}
              </span>
            ) : null}
          </li>
        ))}
      </ul>
    </div>
  )
}

function MarketView({ state }: { state: CompetitorsState }) {
  const m = state.market
  if (!m) return <p className="rounded-xl border border-line bg-surface-2/50 p-3 text-[12px] text-ink-3">No market analysis yet — it runs after at least two competitors are profiled.</p>
  const src = sourceMap(m.sources)
  const a = m.market_analysis
  const e = m.ethara_analysis
  const byCapability = new Map<string, typeof a.capability_analysis>()
  for (const row of a.capability_analysis) byCapability.set(row.capability, [...(byCapability.get(row.capability) ?? []), row])
  return (
    <div className="space-y-3">
      <p className="text-[10.5px] text-ink-3">
        Generated {m.generated_at.slice(0, 10)} from {m.competitors_analyzed.length} profiles ({m.competitors_analyzed.map((c) => c.name).join(', ')}). No scores or rankings — evidence only.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        <ClaimList title="Market Landscape" claims={a.landscape.summary} sources={src} />
        <div className="rounded-xl border border-line p-3">
          <p className="text-[11.5px] font-semibold text-ink">Segments</p>
          <ul className="mt-1.5 space-y-1 text-[11.5px] text-ink-2">
            {a.landscape.segments.map((s) => (
              <li key={s.segment}>
                <span className="font-semibold text-ink">{s.segment}</span> — {s.companies.join(', ')}
                {s.note ? <span className="block text-[10.5px] text-ink-3">{s.note}</span> : null}
              </li>
            ))}
          </ul>
        </div>
        <ClaimList title="Companies entering adjacent categories" claims={a.landscape.adjacent_moves} sources={src} />
        <ClaimList title="Emerging categories" claims={a.landscape.emerging_categories} sources={src} />
      </div>
      <TrendList title="Emerging Trends" trends={a.emerging_trends} sources={src} />
      <div className="rounded-xl border border-line p-3">
        <p className="text-[11.5px] font-semibold text-ink">Capability Activity · Company → Capability → Evidence → Source</p>
        {byCapability.size === 0 ? <p className="mt-1 text-[11px] text-ink-3">No capability evidence yet.</p> : null}
        <div className="mt-1.5 space-y-2">
          {CAPABILITIES.filter((c) => byCapability.has(c)).map((cap) => (
            <div key={cap}>
              <p className="text-[11px] font-semibold text-ink-2">{cap}</p>
              <ul className="ml-3 space-y-0.5">
                {(byCapability.get(cap) ?? []).map((r) => (
                  <li key={`${r.company}-${r.evidence.text}`}>
                    <span className="mr-1.5 text-[11px] font-medium text-ink">{r.company}</span>
                    <ClaimLine claim={r.evidence} sources={src} />
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>
      <TrendList title="Content Trends" trends={a.content_trends} sources={src} />
      <div className="rounded-xl border border-line p-3">
        <p className="text-[11.5px] font-semibold text-ink">Market Gaps</p>
        {a.market_gaps.length === 0 ? <p className="mt-1 text-[11px] text-ink-3">No gap is supported by the current evidence.</p> : null}
        <ul className="mt-1.5 space-y-2.5">
          {a.market_gaps.map((g) => (
            <li key={g.gap} className="text-[11.5px] text-ink-2">
              <span className="font-semibold text-ink">{g.gap}</span> <Badge tone={g.confidence === 'high' ? 'good' : g.confidence === 'medium' ? 'warn' : 'neutral'}>{g.confidence} confidence</Badge>
              <ul className="mt-0.5 space-y-0.5">
                {g.evidence.map((x) => (
                  <li key={x.text}>
                    <ClaimLine claim={x} sources={src} />
                  </li>
                ))}
              </ul>
              <span className="block text-[10.5px] text-ink-3">
                Affects: {g.competitors_affected.join(', ') || '—'} · Coverage: {g.current_coverage || '—'}
              </span>
              <span className="block text-[11px] text-ink-2">Potential opportunity: {g.potential_opportunity || '—'}</span>
            </li>
          ))}
        </ul>
      </div>
      <ClaimList title="Positioning Patterns" claims={a.positioning_patterns} sources={src} />
      <div className="grid gap-3 lg:grid-cols-2">
        <ClaimList title="Ethara Opportunities" claims={e.market_opportunities} sources={src} />
        <ClaimList title="Competitive Threats" claims={e.competitive_threats} sources={src} />
        <ClaimList title="Competitor Activity" claims={e.competitor_activity} sources={src} />
        <ClaimList title="Positioning Observations" claims={e.positioning_observations} sources={src} />
        <ClaimList title="Content Opportunities" claims={e.content_opportunities} sources={src} />
      </div>
    </div>
  )
}

/* ── Screen 4 · Comparison ────────────────────────────────────────────── */

function CompareView({ state, running, onProfileSelf }: { state: CompetitorsState; running: boolean; onProfileSelf: (id: string) => void }) {
  const selfEntry = state.universe.find((c) => c.is_self) ?? null
  // Ethara.AI first, then the competitors.
  const profiled = state.intelligence.competitors
    .filter((c): c is typeof c & { profile: CompetitorProfile } => c.profile !== null && c.profile.by === 'claude')
    .sort((a, b) => Number(b.id === selfEntry?.id) - Number(a.id === selfEntry?.id))
  const selfProfiled = profiled.some((c) => c.id === selfEntry?.id)
  const [chosen, setChosen] = useState<string[]>(() => profiled.slice(0, 4).map((c) => c.id))
  const cols = profiled.filter((c) => chosen.includes(c.id))
  const toggle = (id: string): void => setChosen((xs) => (xs.includes(id) ? xs.filter((x) => x !== id) : [...xs, id]))

  const selfNote =
    selfEntry && !selfProfiled ? (
      <div className="mb-2 flex flex-wrap items-center gap-2 rounded-lg border border-accent/40 bg-accent/[0.06] px-3 py-2 text-[11.5px] text-ink-2">
        Ethara.AI has no profile yet — it is built the same way as a competitor’s, from ethara.ai, Ethara’s own Knowledge Base, its public posts and Glassdoor.
        <Btn className="ml-auto" onClick={() => onProfileSelf(selfEntry.id)} disabled={running}>
          <Play size={12} aria-hidden="true" /> {running ? 'Running…' : 'Profile Ethara.AI'}
        </Btn>
      </div>
    ) : null
  if (profiled.length === 0) return <>{selfNote}<p className="text-[12px] text-ink-3">No profiled competitor to compare yet.</p></>
  const cell = (claim: Claim | null, p: CompetitorProfile): ReactElement =>
    claim ? (
      <span className="text-[11px] text-ink-2">
        {claim.text}
        <SourceLinks ids={claim.source_ids} sources={sourceMap(p.sources)} />
      </span>
    ) : (
      <span className="text-[10.5px] text-ink-3">No evidence in profile</span>
    )
  const rows: Array<{ label: string; get: (p: CompetitorProfile) => Claim | null }> = [
    { label: 'Tagline', get: (p) => p.at_a_glance.tagline.claim },
    { label: 'Value proposition', get: (p) => p.positioning.value_proposition },
    { label: 'Positioning angle', get: (p) => p.positioning.positioning_angle },
    { label: 'Target audience', get: (p) => p.positioning.target_audience[0] ?? null },
    { label: 'Pricing model', get: (p) => p.pricing.model },
    ...CAPABILITIES.map((cap) => ({ label: cap, get: (p: CompetitorProfile) => p.capabilities.find((c) => c.capability === cap)?.evidence ?? null })),
  ]
  return (
    <div>
      {selfNote}
      <div className="flex flex-wrap gap-1.5">
        {profiled.map((c) => (
          <button
            key={c.id}
            type="button"
            onClick={() => toggle(c.id)}
            className={`rounded-full border px-2.5 py-0.5 text-[11px] ${chosen.includes(c.id) ? 'border-accent bg-accent/12 text-accent-bright' : 'border-line text-ink-3 hover:text-ink-2'} ${c.id === selfEntry?.id ? 'font-semibold' : ''}`}
          >
            {c.name}
            {c.id === selfEntry?.id ? <span className="ml-1 text-[9.5px] font-normal text-ink-3">our company</span> : null}
          </button>
        ))}
      </div>
      {cols.length === 0 ? (
        <p className="mt-2 text-[12px] text-ink-3">Choose competitors to compare.</p>
      ) : (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full border-collapse text-left" style={{ minWidth: 200 + cols.length * 220 }}>
            <thead>
              <tr className="border-b border-line text-[11px] text-ink">
                <th className="mono px-2 py-2 text-[8.5px] font-medium uppercase tracking-[0.1em] text-ink-3">Dimension</th>
                {cols.map((c) => (
                  <th key={c.id} className={`px-2 py-2 font-semibold ${c.id === selfEntry?.id ? 'bg-accent/[0.08] text-accent-bright' : ''}`}>
                    {c.name}
                    {c.id === selfEntry?.id ? <span className="block text-[9.5px] font-normal text-ink-3">our company</span> : null}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.label} className="border-b border-line/60 align-top">
                  <td className="px-2 py-2 text-[11px] font-medium text-ink-2">{r.label}</td>
                  {cols.map((c) => (
                    <td key={c.id} className={`px-2 py-2 ${c.id === selfEntry?.id ? 'bg-accent/[0.05]' : ''}`}>
                      {cell(r.get(c.profile), c.profile)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="mt-1 text-[10px] text-ink-3">Evidence from each competitor’s latest profile. No scores are assigned.</p>
        </div>
      )}
    </div>
  )
}

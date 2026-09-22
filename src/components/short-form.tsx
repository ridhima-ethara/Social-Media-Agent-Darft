/**
 * THE SHORT-FORM SURFACE — hooks, the learned voice, tracked accounts.
 *
 * Three panels, one rule between them: **an absent number is rendered as an
 * absence, never as a zero and never as a dash.**
 *
 * That rule is doing real work here. A hook with no confidence means no stored
 * post resembled it closely enough to say anything — which is a finding, not a
 * rendering gap, and `confidence_basis` is the sentence that explains it. A
 * dash would read as "unknown"; a 0 would read as "we think this is terrible".
 * Both are false, and the second is worse.
 *
 * Tokens or nothing: no hex anywhere below. Every number carries `.tabular`;
 * every timestamp is relative through `timeAgo`.
 */

import { useState, type ReactNode } from 'react'
import { Check, Loader2, Mic, Plus, Quote, Sparkles, UserPlus } from 'lucide-react'

import { HOOK_PATTERN_BRIEF, HOOK_PATTERN_LABEL, PLATFORMS } from '@shared/agent-contract'
import type { HookVariant, Keyword, Platform, TrackedAccount, VoiceProfile } from '../types'
import { Badge, Btn, EmptyState, PlatformChip, Select, timeAgo } from './ui'

/* ═══════════════════════════════════════════════════════════════════════════
   HOOKS
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * One hook variant, with the evidence behind its score — or behind its absence.
 *
 * The basis line is NOT optional and is never collapsed behind a tooltip. A
 * confidence is a factual claim, and a claim whose evidence takes a hover to
 * read is a claim most people will accept without reading it.
 */
function HookCard({
  hook,
  onSelect,
  busy,
}: {
  hook: HookVariant
  onSelect: () => void
  busy: boolean
}) {
  const scored = hook.confidence !== null

  return (
    <li
      className={`rounded-xl border px-4 py-3 transition-colors ${
        hook.selected ? 'border-accent bg-surface-2' : 'border-line bg-surface'
      }`}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <div className="mb-1.5 flex flex-wrap items-center gap-2">
            <Badge tone="accent">{HOOK_PATTERN_LABEL[hook.pattern]}</Badge>
            {scored ? (
              <Badge tone="neutral">
                <span className="tabular">{hook.confidence}</span>
                <span className="text-ink-3">/100</span>
              </Badge>
            ) : (
              /*
               * "No score" as a first-class label, tinted like every other
               * honest caveat in this product. Not an error, and not a gap.
               */
              <Badge tone="warn">no score</Badge>
            )}
            {hook.source === 'fixture' ? (
              <Badge tone="neutral" className="text-ink-3">
                template writer
              </Badge>
            ) : null}
            {hook.selected ? <Badge tone="good">selected</Badge> : null}
          </div>

          <p className="whitespace-pre-wrap text-[13px] leading-relaxed text-ink">{hook.body}</p>

          <p className="mt-2 text-[11px] leading-relaxed text-ink-3">{hook.confidence_basis}</p>

          <p className="mt-1 text-[11px] text-ink-3">
            {HOOK_PATTERN_BRIEF[hook.pattern]} · written {timeAgo(hook.created_at)}
          </p>
        </div>

        <Btn
          variant={hook.selected ? 'subtle' : 'ghost'}
          onClick={onSelect}
          disabled={busy || hook.selected}
          title={
            hook.selected
              ? 'This is the chosen hook'
              : 'Choose this hook. The others are kept, not deleted.'
          }
          className="shrink-0"
        >
          {hook.selected ? <Check size={13} /> : 'Choose'}
        </Btn>
      </div>
    </li>
  )
}

export function HookPanel({
  hooks,
  busy,
  onGenerate,
  onSelect,
  apiConnected,
}: {
  hooks: HookVariant[]
  busy: boolean
  onGenerate: () => void
  onSelect: (hookId: string) => void
  apiConnected: boolean
}) {
  const unscored = hooks.filter((h) => h.confidence === null).length

  return (
    <section className="flex flex-col gap-3">
      <header className="flex items-center justify-between gap-3">
        <div>
          <h3 className="display text-sm text-ink">Hooks</h3>
          <p className="text-[11px] text-ink-3">
            One per pattern, so these are alternatives rather than rewordings of one idea.
          </p>
        </div>
        <Btn variant="primary" onClick={onGenerate} disabled={busy || !apiConnected}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Quote size={13} />}
          {hooks.length === 0 ? 'Generate hooks' : 'Regenerate'}
        </Btn>
      </header>

      {hooks.length === 0 ? (
        <EmptyState
          icon={<Quote size={22} />}
          title="No hooks written yet"
          body={
            apiConnected
              ? 'Each hook is written to a different proven pattern and scored against the stored posts it resembles. A hook with no comparable post is returned unscored, with the reason on it.'
              : 'Hooks need the API. Nothing is written locally, because a confidence invented in the browser would look identical to one derived from stored evidence.'
          }
        />
      ) : (
        <>
          {unscored > 0 ? (
            <p className="rounded-lg border border-warn/40 bg-surface-2 px-3 py-2 text-[11px] leading-relaxed text-ink-2">
              <span className="tabular">{unscored}</span> of{' '}
              <span className="tabular">{hooks.length}</span> hook
              {hooks.length === 1 ? '' : 's'} carry no confidence. No stored post resembled them
              closely enough to say anything about them — so nothing is claimed. A default score
              would be evidence we do not have.
            </p>
          ) : null}
          <ul className="flex flex-col gap-2">
            {hooks.map((hook) => (
              <HookCard
                key={hook.id}
                hook={hook}
                busy={busy}
                onSelect={() => onSelect(hook.id)}
              />
            ))}
          </ul>
        </>
      )}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE LEARNED VOICE
   ═══════════════════════════════════════════════════════════════════════════ */

function Stat({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="rounded-lg border border-line bg-surface px-3 py-2">
      <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p className="tabular mt-0.5 text-[13px] text-ink">{value}</p>
    </div>
  )
}

/**
 * The voice panel.
 *
 * `sampleCount` against `minimum` is rendered as "18 of 20" rather than as a
 * disabled button with no explanation — an operator who cannot see why a
 * control is off will assume the feature is broken.
 */
export function VoicePanel({
  profiles,
  sampleCount,
  minimum,
  busy,
  apiConnected,
  onAddSamples,
  onDerive,
  onToggle,
}: {
  profiles: VoiceProfile[]
  sampleCount: number
  minimum: number
  busy: boolean
  apiConnected: boolean
  onAddSamples: (bodies: string[]) => void
  onDerive: () => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [paste, setPaste] = useState('')
  const active = profiles.find((p) => p.active) ?? null
  const enough = sampleCount >= minimum

  /*
   * Samples are split on a blank line, which is how people actually paste a set
   * of scripts. Stated in the placeholder rather than guessed at silently.
   */
  const submitPaste = () => {
    const bodies = paste
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter((b) => b !== '')
    if (bodies.length === 0) return
    onAddSamples(bodies)
    setPaste('')
  }

  return (
    <section className="flex flex-col gap-4">
      <header>
        <h3 className="display text-sm text-ink">Learned voice</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
          A profile is derived by counting what your stored scripts actually do — vocabulary,
          sentence length, how you open and close. Nothing about the voice is inferred. It governs
          short-form scripts only; posts follow the brand rules, and no profile can change that.
        </p>
      </header>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat
          label="Samples stored"
          value={
            <>
              {sampleCount}
              <span className="text-ink-3"> of {minimum}</span>
            </>
          }
        />
        <Stat label="Profiles" value={profiles.length} />
        <Stat
          label="Active profile"
          value={active ? `${active.sample_count} samples` : <span className="text-ink-3">none</span>}
        />
        <Stat
          label="Derived"
          value={active ? timeAgo(active.derived_at) : <span className="text-ink-3">never</span>}
        />
      </div>

      <div className="flex flex-col gap-2">
        <textarea
          value={paste}
          onChange={(e) => setPaste(e.target.value)}
          rows={5}
          placeholder="Paste past scripts here, separated by a blank line. Each block becomes one sample."
          className="w-full resize-y rounded-xl border border-line bg-surface px-3 py-2 text-[12px] leading-relaxed text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
        />
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="subtle" onClick={submitPaste} disabled={busy || !apiConnected || paste.trim() === ''}>
            <Plus size={13} />
            Store samples
          </Btn>
          <Btn variant="primary" onClick={onDerive} disabled={busy || !apiConnected || !enough}>
            {busy ? <Loader2 size={13} className="animate-spin" /> : <Mic size={13} />}
            Derive profile
          </Btn>
          {!enough ? (
            <p className="text-[11px] text-ink-3">
              <span className="tabular">{minimum - sampleCount}</span> more sample
              {minimum - sampleCount === 1 ? '' : 's'} needed. A voice learned from fewer is a claim
              the evidence does not support.
            </p>
          ) : null}
          {!apiConnected ? (
            <p className="text-[11px] text-ink-3">Needs the API.</p>
          ) : null}
        </div>
      </div>

      {profiles.length === 0 ? null : (
        <ul className="flex flex-col gap-2">
          {profiles.map((profile) => {
            const terms = profile.vocabulary.terms ?? []
            return (
              <li
                key={profile.id}
                className={`rounded-xl border px-4 py-3 ${
                  profile.active ? 'border-accent bg-surface-2' : 'border-line bg-surface'
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[12px] text-ink">{profile.name}</span>
                      {profile.active ? <Badge tone="good">active</Badge> : null}
                    </div>
                    <p className="text-[11px] text-ink-3">
                      Derived {timeAgo(profile.derived_at)} from{' '}
                      <span className="tabular">{profile.sample_count}</span> sample
                      {profile.sample_count === 1 ? '' : 's'} ·{' '}
                      <span className="tabular">{profile.sentence_stats.meanWords ?? 0}</span>-word
                      mean sentence ·{' '}
                      <span className="tabular">{profile.sentence_stats.shortLineShare ?? 0}</span>%
                      of lines under eight words
                    </p>
                    {terms.length > 0 ? (
                      <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
                        Counted terms: {terms.slice(0, 12).map((t) => t.term).join(', ')}
                      </p>
                    ) : null}
                  </div>
                  <Btn
                    variant="ghost"
                    onClick={() => onToggle(profile.id, !profile.active)}
                    disabled={busy || !apiConnected}
                    title={
                      profile.active
                        ? 'Deactivate. The profile is kept and can be reactivated.'
                        : 'Activate. Any other profile for this format is deactivated.'
                    }
                    className="shrink-0"
                  >
                    {profile.active ? 'Deactivate' : 'Activate'}
                  </Btn>
                </div>
              </li>
            )
          })}
        </ul>
      )}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   TRACKED ACCOUNTS
   ═══════════════════════════════════════════════════════════════════════════ */

export function TrackedAccountsPanel({
  accounts,
  busy,
  apiConnected,
  onAdd,
  onToggle,
}: {
  accounts: TrackedAccount[]
  busy: boolean
  apiConnected: boolean
  onAdd: (platform: Platform, handle: string, label?: string) => void
  onToggle: (id: string, active: boolean) => void
}) {
  const [platform, setPlatform] = useState<Platform>('linkedin')
  const [handle, setHandle] = useState('')

  const submit = () => {
    const cleaned = handle.trim().replace(/^@+/, '')
    if (cleaned === '') return
    onAdd(platform, cleaned)
    setHandle('')
  }

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h3 className="display text-sm text-ink">Tracked accounts</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
          Named handles the capture lane reads on every run, separately from the keyword queries.
          With none registered, that lane captures nothing and says so — no keyword search is
          substituted for it.
        </p>
      </header>

      <div className="flex flex-wrap items-center gap-2">
        <Select
          value={platform}
          onChange={(v) => setPlatform(v as Platform)}
          options={PLATFORMS.map((p) => ({ value: p, label: p }))}
        />
        <input
          value={handle}
          onChange={(e) => setHandle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submit()
          }}
          placeholder="handle, with or without the @"
          className="min-w-48 flex-1 rounded-lg border border-line bg-surface px-3 py-1.5 text-[12px] text-ink placeholder:text-ink-3 focus:border-line-strong focus:outline-none"
        />
        <Btn variant="subtle" onClick={submit} disabled={busy || !apiConnected || handle.trim() === ''}>
          <UserPlus size={13} />
          Track
        </Btn>
      </div>

      {accounts.length === 0 ? (
        <EmptyState
          icon={<UserPlus size={22} />}
          title="No accounts tracked"
          body="Add a competitor handle to capture what they publish, rather than only what matches your keywords."
        />
      ) : (
        <ul className="flex flex-col gap-1.5">
          {accounts.map((account) => (
            <li
              key={account.id}
              className="flex items-center justify-between gap-3 rounded-lg border border-line bg-surface px-3 py-2"
            >
              <div className="flex min-w-0 items-center gap-2">
                <PlatformChip platform={account.platform} />
                <span className="truncate text-[12px] text-ink">@{account.handle}</span>
                {!account.active ? <Badge tone="neutral">off</Badge> : null}
                <span className="text-[11px] text-ink-3">
                  {account.last_captured_at === null
                    ? 'never captured'
                    : `last read ${timeAgo(account.last_captured_at)}`}
                </span>
              </div>
              <Btn
                variant="ghost"
                onClick={() => onToggle(account.id, !account.active)}
                disabled={busy || !apiConnected}
                title={
                  account.active
                    ? 'Stop reading this account. It is deactivated, never deleted, so its captures keep a valid parent.'
                    : 'Resume reading this account.'
                }
              >
                {account.active ? 'Pause' : 'Resume'}
              </Btn>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   DISCOVERED KEYWORDS — ADR-012
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * The terms the corpus surfaced that nobody seeded, waiting for a decision.
 *
 * Separate from the keyword board on purpose. The board is a list of standing
 * choices an operator has already made; this is a queue of proposals, and the
 * two want different affordances — a proposal needs its evidence in front of
 * it, which is why `discovery_reason` is rendered in full rather than behind a
 * hover.
 *
 * Approving one is what makes it captured. Until then it costs nothing, which
 * is the whole reason discovery is allowed to be generous.
 */
export function DiscoveredKeywordsPanel({
  keywords,
  busy,
  apiConnected,
  onApprove,
  onDismiss,
}: {
  keywords: Keyword[]
  busy: boolean
  apiConnected: boolean
  onApprove: (id: string) => void
  onDismiss: (id: string) => void
}) {
  const discovered = keywords.filter((k) => k.origin === 'discovered')
  const pending = discovered.filter((k) => !k.active)
  const capturing = discovered.filter((k) => k.active)

  return (
    <section className="flex flex-col gap-3">
      <header>
        <h3 className="display text-sm text-ink">Discovered keywords</h3>
        <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">
          Terms the platform extracted from what it captured, rather than ones you typed. Each is a
          proposal: approving one adds it to the capture set, which costs a billed call per lane per
          run — so nothing here is captured until you say so.
        </p>
      </header>

      {discovered.length === 0 ? (
        <EmptyState
          icon={<Sparkles size={22} />}
          title="Nothing discovered yet"
          body="Discovery runs as part of a capture. A term has to appear across several posts, from several authors, and be on your subject matter before it is proposed."
        />
      ) : (
        <>
          {capturing.length > 0 ? (
            <p className="text-[11px] text-ink-3">
              <span className="tabular">{capturing.length}</span> approved and being captured:{' '}
              {capturing.map((k) => k.term).join(', ')}
            </p>
          ) : null}

          <ul className="flex flex-col gap-2">
            {pending.map((keyword) => (
              <li key={keyword.id} className="rounded-xl border border-line bg-surface px-4 py-3">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="mb-1 flex flex-wrap items-center gap-2">
                      <span className="text-[13px] text-ink">{keyword.term}</span>
                      <Badge tone="accent">discovered</Badge>
                      {typeof keyword.emergence_score === 'number' ? (
                        <Badge tone="neutral">
                          <span className="tabular">{keyword.emergence_score}</span>
                          <span className="text-ink-3">/100</span>
                        </Badge>
                      ) : null}
                      {keyword.discovered_at ? (
                        <span className="text-[11px] text-ink-3">{timeAgo(keyword.discovered_at)}</span>
                      ) : null}
                    </div>
                    {/* The evidence, in full. A proposal without it is a guess. */}
                    <p className="text-[11px] leading-relaxed text-ink-3">
                      {keyword.discovery_reason ?? 'No reason was recorded, which is a defect — report it.'}
                    </p>
                  </div>
                  <div className="flex shrink-0 gap-1.5">
                    <Btn
                      variant="primary"
                      onClick={() => onApprove(keyword.id)}
                      disabled={busy || !apiConnected}
                      title="Start capturing this term on every run."
                    >
                      <Check size={13} />
                      Capture
                    </Btn>
                    <Btn
                      variant="ghost"
                      onClick={() => onDismiss(keyword.id)}
                      disabled={busy || !apiConnected}
                      title="Set its weight below the capture floor. The row is kept, never deleted."
                    >
                      Dismiss
                    </Btn>
                  </div>
                </div>
              </li>
            ))}
          </ul>

          {pending.length === 0 ? (
            <p className="text-[11px] text-ink-3">Every discovered term has been decided on.</p>
          ) : null}
        </>
      )}
    </section>
  )
}

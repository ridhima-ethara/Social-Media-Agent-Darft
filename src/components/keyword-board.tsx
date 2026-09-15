/**
 * THE KEYWORD BOARD
 *
 * The editable keyword table, shared by Content Intelligence and Settings —
 * one implementation, so the two screens cannot drift.
 */

import { useState } from 'react'
import { Plus, Trash2, Pencil, Check, X } from 'lucide-react'
import { KEYWORD_CATEGORIES } from '@shared/keywords'
import { useStore } from '../store'
import { Select, Badge, Btn, Modal, fmt } from './ui'
import type { KeywordSignal } from '../types'

export function KeywordBoard({
  signals = [],
  compact = false,
}: {
  signals?: KeywordSignal[]
  compact?: boolean
}) {
  const keywords = useStore((s) => s.keywords)
  const addKeyword = useStore((s) => s.addKeyword)
  const updateKeyword = useStore((s) => s.updateKeyword)
  const removeKeyword = useStore((s) => s.removeKeyword)

  const [editing, setEditing] = useState<string | null>(null)
  const [draftTerm, setDraftTerm] = useState('')
  const [adding, setAdding] = useState(false)
  const [newTerm, setNewTerm] = useState('')
  const [newCategory, setNewCategory] = useState<string>('Adjacent')
  const [newWeight, setNewWeight] = useState(60)

  const signalFor = (keywordId: string): KeywordSignal | undefined =>
    signals.find((s) => s.keyword_id === keywordId)

  return (
    <div className="card overflow-hidden">
      <header className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
        <div>
          <h3 className="display text-sm">Keyword set</h3>
          <p className="mt-0.5 text-[11px] text-ink-3">
            <span className="tabular">{keywords.filter((k) => k.active).length}</span> active of{' '}
            <span className="tabular">{keywords.length}</span>. Weight decides which are scanned first
            when the run is capped.
          </p>
        </div>
        <Btn variant="ghost" onClick={() => setAdding(true)}>
          <Plus size={13} /> Add keyword
        </Btn>
      </header>

      <div className="max-h-[520px] overflow-auto">
        <table className="w-full text-left text-[12px]">
          <thead className="sticky top-0 z-10 bg-surface">
            <tr className="border-b border-line text-[10px] uppercase tracking-[0.08em] text-ink-3">
              <th className="px-4 py-2 font-medium">Term</th>
              <th className="px-3 py-2 font-medium">Category</th>
              <th className="px-3 py-2 font-medium">Weight</th>
              {!compact ? (
                <>
                  <th className="px-3 py-2 font-medium">Posts</th>
                  <th className="px-3 py-2 font-medium">Engagement</th>
                  <th className="px-3 py-2 font-medium">Velocity</th>
                  <th className="px-3 py-2 font-medium">Growth</th>
                  <th className="px-3 py-2 font-medium">Score</th>
                  <th className="px-3 py-2 font-medium">Rank</th>
                </>
              ) : null}
              <th className="px-3 py-2 font-medium">Active</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {keywords.map((keyword) => {
              const signal = signalFor(keyword.id)
              const growth = Number(signal?.growth_pct ?? 0)
              const isEditing = editing === keyword.id

              return (
                <tr
                  key={keyword.id}
                  className={`border-b border-line/60 transition-colors last:border-0 hover:bg-surface-2 ${
                    keyword.active ? '' : 'opacity-50'
                  }`}
                >
                  <td className="px-4 py-2">
                    {isEditing ? (
                      <input
                        value={draftTerm}
                        onChange={(event) => setDraftTerm(event.target.value)}
                        className="w-full rounded-md border border-line bg-surface-2 px-2 py-1 text-[12px] outline-none focus:border-accent"
                        aria-label="Keyword term"
                      />
                    ) : (
                      <span className="font-medium text-ink">{keyword.term}</span>
                    )}
                  </td>

                  <td className="px-3 py-2">
                    <Select
                      value={keyword.category}
                      onChange={(category) => void updateKeyword(keyword.id, { category })}
                      options={KEYWORD_CATEGORIES.map((category) => ({ value: category, label: category }))}
                      ariaLabel={`Category for ${keyword.term}`}
                      size="sm"
                    />
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex items-center gap-2">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={keyword.weight}
                        onChange={(event) => void updateKeyword(keyword.id, { weight: Number(event.target.value) })}
                        aria-label={`Weight for ${keyword.term}`}
                        className="h-1 w-20 accent-[var(--color-accent)]"
                      />
                      <span className="tabular w-7 text-ink-2">{keyword.weight}</span>
                    </div>
                  </td>

                  {!compact ? (
                    <>
                      <td className="tabular px-3 py-2 text-ink-2">{signal?.post_count ?? '—'}</td>
                      <td className="tabular px-3 py-2 text-ink-2">{signal ? fmt(signal.total_engagement) : '—'}</td>
                      <td className="tabular px-3 py-2 text-ink-2">{signal ? Number(signal.velocity).toFixed(1) : '—'}</td>
                      <td className={`tabular px-3 py-2 ${growth >= 0 ? 'text-good-ink' : 'text-critical-ink'}`}>
                        {signal ? `${growth >= 0 ? '+' : ''}${growth.toFixed(0)}%` : '—'}
                      </td>
                      <td className="px-3 py-2">
                        {signal ? (
                          <span
                            className="tabular font-semibold"
                            style={{
                              color:
                                signal.trend_score >= 75
                                  ? 'var(--color-good-ink)'
                                  : signal.trend_score >= 50
                                    ? 'var(--color-accent-bright)'
                                    : 'var(--color-ink-3)',
                            }}
                          >
                            {signal.trend_score}
                          </span>
                        ) : (
                          '—'
                        )}
                      </td>
                      <td className="px-3 py-2">
                        {signal?.is_trending ? (
                          <Badge tone="accent">#{signal.rank}</Badge>
                        ) : (
                          <span className="tabular text-ink-3">{signal?.rank ?? '—'}</span>
                        )}
                      </td>
                    </>
                  ) : null}

                  <td className="px-3 py-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={keyword.active}
                      aria-label={`${keyword.active ? 'Deactivate' : 'Activate'} ${keyword.term}`}
                      onClick={() => void updateKeyword(keyword.id, { active: !keyword.active })}
                      className={`h-4 w-8 rounded-full border transition-colors duration-[var(--dur-fast)] ${
                        keyword.active ? 'border-accent bg-accent/30' : 'border-line bg-surface-3'
                      }`}
                    >
                      <span
                        className="block h-3 w-3 rounded-full bg-ink transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out-soft)]"
                        style={{ transform: `translateX(${keyword.active ? 17 : 2}px)` }}
                      />
                    </button>
                  </td>

                  <td className="px-3 py-2">
                    <div className="flex items-center justify-end gap-1">
                      {isEditing ? (
                        <>
                          <button
                            type="button"
                            aria-label="Save"
                            onClick={() => {
                              if (draftTerm.trim().length > 1) void updateKeyword(keyword.id, { term: draftTerm.trim() })
                              setEditing(null)
                            }}
                            className="rounded-md p-1 text-good-ink transition-colors hover:bg-surface-3"
                          >
                            <Check size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label="Cancel"
                            onClick={() => setEditing(null)}
                            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3"
                          >
                            <X size={13} />
                          </button>
                        </>
                      ) : (
                        <>
                          <button
                            type="button"
                            aria-label={`Edit ${keyword.term}`}
                            onClick={() => {
                              setEditing(keyword.id)
                              setDraftTerm(keyword.term)
                            }}
                            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-ink"
                          >
                            <Pencil size={13} />
                          </button>
                          <button
                            type="button"
                            aria-label={`Switch off ${keyword.term}`}
                            title="Switches the keyword off. Its history is kept."
                            onClick={() => void removeKeyword(keyword.id)}
                            className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-3 hover:text-critical-ink"
                          >
                            <Trash2 size={13} />
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add keyword"
        subtitle="It joins the scan set on the next run, ordered by weight."
        footer={
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              disabled={newTerm.trim().length < 2}
              onClick={() => {
                void addKeyword(newTerm.trim(), newCategory, newWeight)
                setNewTerm('')
                setAdding(false)
              }}
            >
              Add keyword
            </Btn>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Term</span>
            <input
              value={newTerm}
              onChange={(event) => setNewTerm(event.target.value)}
              placeholder="inference economics"
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Category</span>
            <Select
              value={newCategory}
              onChange={setNewCategory}
              options={KEYWORD_CATEGORIES.map((category) => ({ value: category, label: category }))}
              className="mt-1 w-full"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
              Weight <span className="tabular text-ink-2">{newWeight}</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={newWeight}
              onChange={(event) => setNewWeight(Number(event.target.value))}
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
            <span className="mt-1 block text-[11px] leading-relaxed text-ink-3">
              Higher weights are scanned first when a run is capped at the maximum keywords per run.
            </span>
          </label>
        </div>
      </Modal>
    </div>
  )
}

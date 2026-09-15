/**
 * THE KNOWLEDGE BASE
 *
 * Everything the platform has learned lives here — the brand definition, the
 * research build, and every lesson written back from an outcome. Switching an
 * entry off genuinely stops it influencing the next draft, which is only true
 * because the brand rules live in the same table as everything else.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Brain, ChevronDown, Library, Pin, Plus, Power, RefreshCw, Search, Upload } from 'lucide-react'
import { BRAND } from '@shared/brand-voice'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { Select, Badge, Btn, EmptyState, Modal, SlideOver, formatDate, timeAgo } from '../components/ui'

const CATEGORIES = [
  'All',
  'Brand Corpus',
  'Brand Voice',
  'Brand Guideline',
  'Visual Identity',
  'Compliance Rule',
  'Research',
  'User Feedback',
  'Audience Insight',
  'Platform Preference',
  'High Performer',
  'Approved Post',
  'Rejected Post',
  'Hashtags',
  'CTA',
  'Topic',
]

/* ═══════════════════════════════════════════════════════════════════════════
   THE BRAND IDENTITY CARD — read live from shared/brand-voice.ts
   ═══════════════════════════════════════════════════════════════════════════ */

function BrandIdentityCard() {
  return (
    <section
      className="mb-4 rounded-xl p-[1px]"
      style={{ background: 'linear-gradient(135deg, var(--color-accent), var(--color-magenta))' }}
    >
      <div className="rounded-[11px] bg-surface p-4">
        <h3 className="display text-sm">The brand, as the agents enforce it</h3>
        <p className="mt-0.5 text-[12px] leading-relaxed text-ink-3">
          Ethara is {BRAND.positioning}. Everything below is read live from the brand definition, so this
          card cannot drift from what the compliance engine actually checks.
        </p>

        <div className="mt-3 grid gap-3 md:grid-cols-4">
          <div>
            <p className="text-[10px] uppercase tracking-[0.09em] text-ink-3">Voice</p>
            <ul className="mt-1 space-y-0.5">
              {BRAND.voiceWords.map((word) => (
                <li key={word} className="text-[11.5px] text-ink-2">
                  {word}
                </li>
              ))}
            </ul>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.09em] text-ink-3">Non-negotiables</p>
            <ul className="mt-1 space-y-0.5 text-[11.5px] text-ink-2">
              <li>Emoji budget: {BRAND.emojiBudget}</li>
              <li>
                Hashtags: {BRAND.hashtags.min}–{BRAND.hashtags.max}, every platform
              </li>
              <li>Hook: ≤ {BRAND.hookMaxWords} words</li>
              <li>Caption similarity ≤ {BRAND.similarityCap.caption}</li>
            </ul>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.09em] text-ink-3">Structure</p>
            <p className="mt-1 text-[11.5px] leading-relaxed text-ink-2">
              {BRAND.captionStructure.join(' → ')}
            </p>
          </div>

          <div>
            <p className="text-[10px] uppercase tracking-[0.09em] text-ink-3">Visual identity</p>
            <div className="mt-1 flex flex-wrap gap-1">
              {BRAND.visual.family.map((colour) => (
                <span
                  key={colour}
                  title={colour}
                  className="h-5 w-5 rounded border border-line"
                  style={{ background: colour }}
                />
              ))}
            </div>
            <p className="mt-1 text-[11.5px] text-ink-2">
              {BRAND.visual.displayFont} · {BRAND.visual.bodyFont}
            </p>
          </div>
        </div>
      </div>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BRAND CORPUS — the vocabulary the Scraping Agent judges against
   ═══════════════════════════════════════════════════════════════════════════ */

/**
 * Why this is its own section rather than another category in the list below.
 *
 * The corpus is the half of the Knowledge Base that says what this company
 * talks about, as distinct from the rules that say how to write. It is what the
 * Scraping Agent scores every captured page against, so adding an entry here
 * changes what the next discovery run admits. That is a different act from
 * filing a research finding, and it deserves a surface that says so plainly —
 * including the term count, so an operator can see the judgement getting sharper.
 */
function BrandCorpusSection() {
  const knowledge = useStore((s) => s.knowledge)
  const apiMode = useStore((s) => s.apiMode)
  const corpus = useStore((s) => s.corpus)
  const loadCorpus = useStore((s) => s.loadCorpus)
  const addCorpusEntry = useStore((s) => s.addCorpusEntry)
  const restoreCorpus = useStore((s) => s.restoreCorpus)
  const toggleKnowledge = useStore((s) => s.toggleKnowledge)

  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [content, setContent] = useState('')
  const [tags, setTags] = useState('')
  const [keyPoints, setKeyPoints] = useState('')
  const [isDomain, setIsDomain] = useState(true)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    void loadCorpus()
  }, [loadCorpus, knowledge.length])

  // The store holds the server's answer when connected; standalone derives the
  // same shape from the bundled entries so the section is never blank.
  const entries = corpus.entries
  const stats = corpus.stats
  const shown = expanded ? entries : entries.slice(0, 4)

  const parsedTags = tags
    .split(',')
    .map((t) => t.trim().toLowerCase())
    .filter((t) => t.length > 1)

  const canSave = title.trim().length >= 3 && content.trim().length >= 3 && parsedTags.length > 0

  return (
    <section className="card mb-4 p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h3 className="display flex items-center gap-2 text-sm">
            <Library size={15} className="text-accent-bright" aria-hidden="true" />
            Brand corpus
          </h3>
          <p className="mt-0.5 max-w-2xl text-[12px] leading-relaxed text-ink-3">
            What Ethara actually talks about, in the platform&rsquo;s own words. The Scraping Agent scores
            every captured page against these terms plus the declared keywords, so anything you add here
            changes what the next discovery run admits. The compliance rules are deliberately excluded —
            a style guide should not decide which articles are on topic.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Btn variant="ghost" onClick={() => void restoreCorpus()}>
            <RefreshCw size={13} /> Restore defaults
          </Btn>
          <Btn variant="primary" onClick={() => setAdding(true)}>
            <Plus size={13} /> Add corpus entry
          </Btn>
        </div>
      </div>

      <div className="mt-3 grid grid-cols-2 gap-2 lg:grid-cols-5">
        {[
          { label: 'Corpus entries', value: stats.active, sub: `${stats.total} total` },
          {
            label: 'Subject-matter entries',
            value: stats.domain,
            sub: 'these decide relevance',
          },
          { label: 'Domain terms', value: stats.corpusTerms, sub: 'from subject-matter tags' },
          { label: 'Keyword terms', value: stats.keywordTerms, sub: 'with synonyms' },
          {
            label: 'Terms feeding scraping',
            value: stats.alignmentTerms,
            sub: `incl. ${stats.brandTopics} brand topics`,
          },
        ].map((metric) => (
          <div key={metric.label} className="rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{metric.label}</p>
            <p className="tabular mt-0.5 text-lg font-semibold leading-none">{metric.value}</p>
            <p className="mt-1 text-[10px] text-ink-3">{metric.sub}</p>
          </div>
        ))}
      </div>

      {entries.length === 0 ? (
        <p className="mt-3 rounded-lg border border-warn/40 bg-warn/10 px-3 py-2 text-[11.5px] text-warn">
          No corpus entries yet, so alignment is running on the brand topics and keywords alone. Restore
          the defaults or add an entry to sharpen what discovery admits.
        </p>
      ) : (
        <ul className="mt-3 space-y-2">
          {shown.map((entry) => (
            <li
              key={entry.id}
              className={`rounded-lg border px-3 py-2.5 transition-opacity ${
                entry.active ? 'border-line bg-surface-2' : 'border-line bg-surface-2 opacity-55'
              }`}
            >
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div className="min-w-0">
                  <p className="text-[12px] font-medium text-ink">{entry.title}</p>
                  <p className="mt-0.5 line-clamp-2 text-[11px] leading-relaxed text-ink-3">
                    {entry.content}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => void toggleKnowledge(entry.id)}
                  title={entry.active ? 'Switch this entry off' : 'Switch this entry on'}
                  aria-label={entry.active ? `Switch off ${entry.title}` : `Switch on ${entry.title}`}
                  className={`shrink-0 rounded-lg border p-1.5 transition-colors ${
                    entry.active
                      ? 'border-line text-good-ink hover:border-line-strong'
                      : 'border-line text-ink-3 hover:text-ink-2'
                  }`}
                >
                  <Power size={13} />
                </button>
              </div>
              <div className="mt-1.5 flex flex-wrap items-center gap-1">
                {entry.tags.includes('brand-domain') ? (
                  <Badge tone="accent">Subject matter</Badge>
                ) : (
                  <span
                    title="Brand identity. It grounds generation but does not decide which pages are on topic."
                    className="rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3"
                  >
                    Identity
                  </span>
                )}
                {entry.tags
                  .filter(
                    (tag) => tag !== 'brand' && tag !== 'brand-corpus' && tag !== 'brand-domain',
                  )
                  .slice(0, 7)
                  .map((tag) => (
                    <span
                      key={tag}
                      className="rounded-full border border-line px-2 py-0.5 text-[10px] text-accent-bright"
                    >
                      {tag}
                    </span>
                  ))}
                {entry.active ? null : <Badge tone="warn">Not scoring</Badge>}
              </div>
            </li>
          ))}
        </ul>
      )}

      {entries.length > 4 ? (
        <Btn variant="ghost" className="mt-2" onClick={() => setExpanded(!expanded)}>
          {expanded ? 'Show fewer' : `Show all ${entries.length}`}
        </Btn>
      ) : null}

      {apiMode !== 'connected' ? (
        <p className="mt-3 text-[10.5px] text-ink-3">
          Standalone — corpus changes stay in this browser until the API is running.
        </p>
      ) : null}

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add a corpus entry"
        subtitle="Domain knowledge, not a writing rule. The tags are what the Scraping Agent reads."
        footer={
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              disabled={!canSave}
              onClick={() => {
                void addCorpusEntry({
                  title: title.trim(),
                  content: content.trim(),
                  tags: parsedTags,
                  keyPoints: keyPoints
                    .split('\n')
                    .map((p) => p.trim())
                    .filter((p) => p.length > 2),
                  domain: isDomain,
                })
                setTitle('')
                setContent('')
                setTags('')
                setKeyPoints('')
                setIsDomain(true)
                setAdding(false)
              }}
            >
              Add to corpus
            </Btn>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              placeholder="Domain · long-horizon agent reliability"
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
              What this covers
            </span>
            <textarea
              rows={3}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              placeholder="What the company means by this subject, and why it matters to the work."
              className="mt-1 w-full resize-y rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
              Domain terms, comma separated
            </span>
            <input
              value={tags}
              onChange={(event) => setTags(event.target.value)}
              placeholder="agent reliability, long horizon, tool use"
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[10.5px] text-ink-3">
              {parsedTags.length === 0
                ? 'At least one term is required.'
                : isDomain
                  ? `${parsedTags.length} term(s) will be added to the scraping vocabulary.`
                  : `${parsedTags.length} term(s) stored, but none will decide relevance.`}
            </span>
          </label>

          <label className="flex items-start gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5">
            <input
              type="checkbox"
              checked={isDomain}
              onChange={(event) => setIsDomain(event.target.checked)}
              className="mt-0.5 accent-magenta"
            />
            <span className="min-w-0">
              <span className="block text-[12px] font-medium text-ink">
                This is subject matter the lab works on
              </span>
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-3">
                On, the terms above decide whether a captured page is on topic. Turn it off for
                entries that describe the brand itself — voice, audience, visual identity — because
                an article about typography is not an AI research article. Either way the entry stays
                available as grounding.
              </span>
            </span>
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
              Key points, one per line (optional)
            </span>
            <textarea
              rows={3}
              value={keyPoints}
              onChange={(event) => setKeyPoints(event.target.value)}
              placeholder={'A claim a caption may cite as its grounding.\nOne per line.'}
              className="mt-1 w-full resize-y rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
            <span className="mt-1 block text-[10.5px] text-ink-3">
              Rule 6 lets a caption trace a factual claim to one of these.
            </span>
          </label>
        </div>
      </Modal>
    </section>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE BODY — shared by the page and the drawer
   ═══════════════════════════════════════════════════════════════════════════ */

export function KnowledgeBaseBody({ compact = false }: { compact?: boolean }) {
  const knowledge = useStore((s) => s.knowledge)
  const toggleKnowledge = useStore((s) => s.toggleKnowledge)

  const [query, setQuery] = useState('')
  const [category, setCategory] = useState('All')
  /** Cards open on request. Titles are the index; the passage is one click away. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set())
  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const rows = useMemo(
    () =>
      knowledge.filter((entry) => {
        if (category !== 'All' && entry.category !== category) return false
        if (query.trim().length === 0) return true
        const haystack = `${entry.title} ${entry.content} ${entry.category} ${entry.tags.join(' ')}`.toLowerCase()
        return haystack.includes(query.toLowerCase())
      }),
    [knowledge, category, query],
  )

  const present = CATEGORIES.filter(
    (name) => name === 'All' || knowledge.some((entry) => entry.category === name),
  )

  return (
    <>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-56 flex-1">
          <Search size={13} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" aria-hidden="true" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search the Knowledge Base…"
            aria-label="Search the Knowledge Base"
            className="w-full rounded-lg border border-line bg-surface-2 py-1.5 pl-8 pr-3 text-[12px] outline-none focus:border-accent"
          />
        </label>
      </div>

      <div className="mb-4 flex flex-wrap gap-1.5">
        {present.map((name) => {
          const count = name === 'All' ? knowledge.length : knowledge.filter((e) => e.category === name).length
          return (
            <button
              key={name}
              type="button"
              onClick={() => setCategory(name)}
              className={`rounded-full border px-2.5 py-1 text-[11px] transition-colors ${
                category === name
                  ? 'border-accent bg-accent/10 text-accent-bright'
                  : 'border-line text-ink-3 hover:border-line-strong hover:text-ink-2'
              }`}
            >
              {name} <span className="tabular text-ink-3">{count}</span>
            </button>
          )
        })}
      </div>

      {rows.length === 0 ? (
        <EmptyState title="Nothing matches" body="Try a different category, or clear the search." />
      ) : (
        <div className={`stagger-fade grid gap-3 ${compact ? 'md:grid-cols-2' : 'md:grid-cols-2 xl:grid-cols-3'}`}>
          {rows.map((entry, i) => {
            const open = expanded.has(entry.id)
            return (
              <article
                key={entry.id}
                className={`card anim-fade-up p-3 transition-[opacity,box-shadow] duration-[var(--dur-base)] ${entry.active ? '' : 'opacity-50'} ${
                  open ? `md:col-span-2 ${compact ? '' : 'xl:col-span-3'} ring-1 ring-accent/30` : ''
                }`}
                style={{ ['--i' as string]: i, animationDelay: `${Math.min(i, 12) * 30}ms` }}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <Badge tone={entry.origin === 'brand' ? 'magenta' : entry.origin === 'research' ? 'accent' : 'neutral'}>
                      {entry.category}
                    </Badge>
                    {entry.origin === 'brand' ? (
                      <span
                        title="Part of the brand definition — read before every caption and creative"
                        className="text-magenta-ink"
                      >
                        <Pin size={11} />
                      </span>
                    ) : null}
                  </div>

                  <button
                    type="button"
                    onClick={() => void toggleKnowledge(entry.id)}
                    title={entry.active ? 'Switch off — it will stop influencing the next draft' : 'Switch on'}
                    aria-label={entry.active ? `Switch off ${entry.title}` : `Switch on ${entry.title}`}
                    className={`rounded-md border p-1 transition-colors ${
                      entry.active
                        ? 'border-good/40 text-good-ink hover:bg-good/10'
                        : 'border-line text-ink-3 hover:text-ink'
                    }`}
                  >
                    <Power size={12} />
                  </button>
                </div>

                {/* The title is the control: the whole row opens the passage. */}
                <button
                  type="button"
                  onClick={() => toggleExpanded(entry.id)}
                  aria-expanded={open}
                  className="group mt-1.5 flex w-full items-start gap-2 text-left"
                >
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-medium leading-snug text-ink">{entry.title}</span>
                    {!open ? (
                      <span className="mt-0.5 line-clamp-1 block text-[11px] leading-relaxed text-ink-3">{entry.content}</span>
                    ) : null}
                  </span>
                  <ChevronDown
                    size={14}
                    className={`mt-0.5 shrink-0 text-ink-3 transition-transform duration-[var(--dur-base)] group-hover:text-ink ${open ? 'rotate-180' : ''}`}
                    aria-hidden="true"
                  />
                </button>

                {open ? (
                  <div className="anim-fade-in mt-2 border-t border-line pt-2">
                    <p className="whitespace-pre-wrap text-[11.5px] leading-relaxed text-ink-2">{entry.content}</p>

                    {entry.sources.length > 0 ? (
                      <ul className="mt-2 space-y-0.5">
                        {entry.sources.map((source) => {
                          let domain = source.url
                          try {
                            domain = new URL(source.url).hostname.replace(/^www\./, '')
                          } catch {
                            // A malformed URL still shows, just without a tidy domain.
                          }
                          return (
                            <li key={source.url}>
                              <a
                                href={source.url}
                                target="_blank"
                                rel="noreferrer"
                                className="flex items-center gap-1.5 text-[10.5px] text-ink-3 transition-colors hover:text-accent-bright"
                              >
                                <img
                                  src={`https://www.google.com/s2/favicons?domain=${domain}&sz=32`}
                                  alt=""
                                  width={11}
                                  height={11}
                                  className="shrink-0 rounded-sm"
                                  onError={(event) => {
                                    event.currentTarget.style.visibility = 'hidden'
                                  }}
                                />
                                <span className="truncate">{domain}</span>
                              </a>
                            </li>
                          )
                        })}
                      </ul>
                    ) : null}

                    {entry.hashtag_display ? (
                      <span className="mt-2 inline-block rounded-full border border-line px-2 py-0.5 text-[10px] text-ink-3">
                        #{entry.hashtag_display}
                      </span>
                    ) : null}

                    <p className="mt-2 text-[10px] text-ink-3">
                      {entry.source} · Confidence: {entry.confidence} · {formatDate(entry.created_at)}
                    </p>
                  </div>
                ) : (
                  <p className="mt-1.5 text-[10px] text-ink-3">
                    {entry.confidence} confidence · {formatDate(entry.created_at)}
                  </p>
                )}
              </article>
            )
          })}
        </div>
      )}
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE PAGE
   ═══════════════════════════════════════════════════════════════════════════ */

export function KnowledgeBase() {
  const build = useStore((s) => s.knowledgeBuild)
  const buildKnowledge = useStore((s) => s.buildKnowledge)
  const uploadCorpusFiles = useStore((s) => s.uploadCorpusFiles)
  const fileInput = useRef<HTMLInputElement | null>(null)
  const addKnowledge = useStore((s) => s.addKnowledge)

  const [adding, setAdding] = useState(false)
  const [title, setTitle] = useState('')
  const [category, setCategory] = useState('User Feedback')
  const [content, setContent] = useState('')

  const fallbackReason = build?.summary?.fallbackReason as string | undefined

  return (
    <>
      <PageHeader
        title="Knowledge Base"
        subtitle="Everything the platform has learned. Every agent reads from this before it acts, and every outcome is written back."
        agents={['knowledge', 'learning', 'review']}
        actions={
          <>
            <Btn variant="ghost" onClick={() => void buildKnowledge()}>
              <RefreshCw size={13} /> Rebuild now
            </Btn>
            <input
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.md,.txt,.csv,.json,.yml,.yaml,.rst,.log"
              className="hidden"
              aria-label="Upload files into the Knowledge Base"
              onChange={(event) => {
                const picked = Array.from(event.target.files ?? [])
                event.target.value = ''
                if (picked.length > 0) void uploadCorpusFiles(picked)
              }}
            />
            <Btn variant="ghost" onClick={() => fileInput.current?.click()}>
              <Upload size={13} /> Upload files
            </Btn>
            <Btn variant="primary" onClick={() => setAdding(true)}>
              <Plus size={13} /> Add entry
            </Btn>
          </>
        }
      />

      {build ? (
        <section
          className={`mb-4 rounded-xl border px-4 py-2.5 text-[12px] leading-relaxed ${
            fallbackReason ? 'border-warn/40 bg-warn/10 text-warn' : 'border-line bg-surface-2 text-ink-3'
          }`}
        >
          Last built {timeAgo(build.finished_at ?? build.started_at)} from{' '}
          <span className="tabular">{build.hashtags_researched}</span> hashtags ·{' '}
          <span className="tabular">{build.entries_written}</span> entries ·{' '}
          <span className="tabular">{build.sources_cited}</span> sources cited · next build Sunday 06:00
          {fallbackReason ? <span className="block mt-0.5">{fallbackReason}</span> : null}
        </section>
      ) : null}

      <BrandIdentityCard />
      <BrandCorpusSection />
      <KnowledgeBaseBody />

      <Modal
        open={adding}
        onClose={() => setAdding(false)}
        title="Add entry"
        subtitle="Written straight into the Knowledge Base, and read before the next draft."
        footer={
          <div className="flex justify-end gap-2">
            <Btn variant="ghost" onClick={() => setAdding(false)}>
              Cancel
            </Btn>
            <Btn
              variant="primary"
              disabled={title.trim().length < 3 || content.trim().length < 3}
              onClick={() => {
                void addKnowledge({ title: title.trim(), category, content: content.trim() })
                setTitle('')
                setContent('')
                setAdding(false)
              }}
            >
              Add entry
            </Btn>
          </div>
        }
      >
        <div className="space-y-3">
          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Title</span>
            <input
              value={title}
              onChange={(event) => setTitle(event.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Category</span>
            <Select
              value={category}
              onChange={setCategory}
              options={CATEGORIES.filter((c) => c !== 'All').map((name) => ({ value: name, label: name }))}
              className="mt-1 w-full"
            />
          </label>

          <label className="block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Content</span>
            <textarea
              rows={5}
              value={content}
              onChange={(event) => setContent(event.target.value)}
              className="mt-1 w-full resize-y rounded-lg border border-line bg-surface-2 px-3 py-2 text-[13px] leading-relaxed outline-none focus:border-accent"
            />
          </label>
        </div>
      </Modal>
    </>
  )
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE DRAWER — the same body, reachable from any screen
   ═══════════════════════════════════════════════════════════════════════════ */

export function KnowledgeDrawer() {
  const open = useStore((s) => s.knowledgeOpen)
  const close = useStore((s) => s.closeKnowledge)
  const knowledge = useStore((s) => s.knowledge)

  const active = knowledge.filter((k) => k.active).length
  const categories = new Set(knowledge.map((k) => k.category)).size
  const high = knowledge.filter((k) => k.confidence === 'High').length

  return (
    <SlideOver
      open={open}
      onClose={close}
      title="Knowledge Base"
      subtitle={`${knowledge.length} entries · ${active} active · ${categories} categories · ${high} high-confidence`}
      icon={
        <span className="relative flex h-9 w-9 items-center justify-center rounded-full border border-accent/50">
          <Brain size={16} className="text-accent-bright" aria-hidden="true" />
          <span className="anim-ping-slow absolute inset-0 rounded-full border border-accent" aria-hidden="true" />
        </span>
      }
    >
      <div className="p-6">
        <p className="mb-4 max-w-3xl text-[12.5px] leading-relaxed text-ink-3">
          Everything the platform has learned lives here. Every agent reads from this before it acts, and
          every outcome is written back. Switch an entry off to stop it influencing the next draft.
        </p>
        <BrandIdentityCard />
        <KnowledgeBaseBody compact />
      </div>
    </SlideOver>
  )
}

/**
 * SETTINGS
 *
 * Five cards plus the command plane card. Every integration states plainly whether it
 * is configured and which env key would switch it on — a screen that hid that
 * would be lying about which mode the product is in.
 */

import { useState } from 'react'
import { CheckCircle2, XCircle } from 'lucide-react'
import { BRAND, deriveHashtags } from '@shared/brand-voice'
import { useStore } from '../store'
import { PageHeader } from '../components/layout'
import { KeywordBoard } from '../components/keyword-board'
import { listVoices, setVoiceEnabled, speak, voiceSupport } from '../lib/voice'
import { Badge, Btn, FacebookGlyph, InstagramGlyph, LinkedinGlyph, XGlyph } from '../components/ui'

/** The lanes the Scraping Agent captures, in the order it runs them. */
/**
 * How each lane is read, under each of the two capture sources.
 *
 * The four platform lanes are read by an Apify actor when a token is present
 * and by a `site:` search when it is not, and the difference is not cosmetic:
 * an actor states reaction counts and a search-indexed page does not. The open
 * web has no actor at all, so it is crawl4ai either way.
 */
const CAPTURE_LANES = [
  { label: 'LinkedIn', apify: 'Apify actor · post search', crawler: 'site:linkedin.com' },
  { label: 'Instagram', apify: 'Apify actor · hashtag search', crawler: 'site:instagram.com' },
  { label: 'X', apify: 'Apify actor · post search', crawler: 'site:x.com OR site:twitter.com' },
  { label: 'Facebook', apify: 'Apify actor · post search', crawler: 'site:facebook.com' },
  { label: 'Open web', apify: null, crawler: 'unscoped — platform domains excluded' },
]

/**
 * The adapters the server sweeps in `integrationReport()`, in the order it
 * reports them. Image renderers are deliberately absent: they are reported
 * separately under `health.integrations.images` and chosen in the model menu, so
 * listing one here would leave a row that can only ever say "not reported".
 */
const SERVICES = [
  { id: 'apify', label: 'Apify · platform capture (LinkedIn, Instagram, X, Facebook)', env: 'APIFY_API_TOKEN' },
  { id: 'crawl4ai', label: 'crawl4ai · open-web capture and platform fallback', env: 'CRAWL4AI_PYTHON' },
  { id: 'parallel', label: 'Parallel Web Systems · deep research', env: 'PARALLEL_API_KEY' },
  { id: 'gcp', label: 'Google Cloud · Gemini and Imagen', env: 'GCP_API_KEY' },
  { id: 'ollama', label: 'Ollama · local Qwen3 and FLUX.2 Klein', env: 'OLLAMA_BASE_URL' },
]

export function SettingsPage() {
  const settings = useStore((s) => s.settings)
  const updateSettings = useStore((s) => s.updateSettings)
  const integrations = useStore((s) => s.integrations)
  const workspace = useStore((s) => s.workspace)
  const apiMode = useStore((s) => s.apiMode)
  const assistantProvider = useStore((s) => s.mode.assistantProvider)
  const toast = useStore((s) => s.toast)

  const [selectedVoice, setSelectedVoice] = useState('')

  /**
   * Resolves a service to the running server's own report.
   *
   * Adapters are named `<service>.<capability>` — `apify.search`,
   * `crawl4ai.search`, `gcp.text` — so an exact-id lookup silently missed every
   * one of them and every badge on this screen read "not configured" no matter
   * what was in the environment. Matching the segment before the dot as well
   * means the screen shows what the server actually reported, which is the only
   * thing it claims to do.
   */
  const statusOf = (id: string): { configured: boolean; reason: string } => {
    const found =
      integrations.find((i) => i.id === id) ??
      integrations.find((i) => i.id.split('.')[0] === id)
    return {
      configured: found?.configured ?? false,
      reason: found?.reason ?? 'The server did not report this service',
    }
  }

  return (
    <>
      <PageHeader
        title="Settings"
        subtitle="What the agents are allowed to do, what they read before they do it, and which services are actually connected."
      />

      <div className="grid gap-4 xl:grid-cols-2">
        {/* ── Social platforms ────────────────────────────────────────── */}
        <section className="card p-4">
          <h3 className="display text-sm">Social platforms</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            Publishing is simulated in demo mode. Connecting a real account is out of scope for the
            prototype — the adapter interface exists, the credentials do not.
          </p>

          <ul className="mt-3 space-y-2">
            {[
              { id: 'linkedin', label: 'LinkedIn', glyph: LinkedinGlyph, connected: true },
              { id: 'instagram', label: 'Instagram', glyph: InstagramGlyph, connected: true },
              { id: 'x', label: 'X', glyph: XGlyph, connected: false },
              { id: 'facebook', label: 'Facebook', glyph: FacebookGlyph, connected: false },
            ].map((platform) => (
              <li
                key={platform.id}
                className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5"
              >
                <platform.glyph size={16} />
                <span className="text-[12.5px] font-medium text-ink">{platform.label}</span>
                <Badge tone={platform.connected ? 'magenta' : 'neutral'}>
                  {platform.connected ? 'Demo mode' : 'Not connected'}
                </Badge>
                <Btn
                  variant="ghost"
                  className="ml-auto"
                  onClick={() =>
                    toast(
                      'Live publishing needs real platform credentials, which the prototype deliberately does not carry.',
                      'warn',
                    )
                  }
                >
                  Connect
                </Btn>
              </li>
            ))}
          </ul>
        </section>

        {/* ── Brand settings ──────────────────────────────────────────── */}
        <section className="card p-4">
          <h3 className="display text-sm">Brand settings</h3>
          <p className="mt-0.5 text-[11.5px] leading-relaxed text-ink-3">
            Ethara is {BRAND.positioning}. The emoji budget and hashtag range below are read live from the
            brand definition and cannot be raised from this screen.
          </p>

          <div className="mt-3 grid grid-cols-2 gap-2">
            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Emoji budget</p>
              <p className="tabular mt-0.5 text-[13px] font-medium text-ink">{BRAND.emojiBudget}</p>
            </div>
            <div className="rounded-lg border border-line bg-surface-2 px-3 py-2">
              <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Hashtags per post</p>
              <p className="tabular mt-0.5 text-[13px] font-medium text-ink">
                {BRAND.hashtags.min}–{BRAND.hashtags.max}
              </p>
            </div>
          </div>

          <label className="mt-3 block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Voice</span>
            <input
              value={settings.tone}
              onChange={(event) => updateSettings({ tone: event.target.value })}
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] outline-none focus:border-accent"
            />
          </label>

          <label className="mt-2 block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Audience</span>
            <input
              value={settings.audience}
              onChange={(event) => updateSettings({ audience: event.target.value })}
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-3 py-2 text-[12.5px] outline-none focus:border-accent"
            />
          </label>

          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-ink-3">
              Hashtags derived from “reward modeling”
            </p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {deriveHashtags('reward modeling', 4).map((tag) => (
                <span key={tag} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-2">
                  #{tag}
                </span>
              ))}
            </div>
          </div>

          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Visual identity</p>
            <div className="mt-1 flex flex-wrap items-center gap-1.5">
              {BRAND.visual.family.map((colour) => (
                <span key={colour} title={colour} className="h-5 w-5 rounded border border-line" style={{ background: colour }} />
              ))}
              <span className="text-[11px] text-ink-3">
                {BRAND.visual.displayFont} · {BRAND.visual.bodyFont}
              </span>
            </div>
          </div>

          <div className="mt-3">
            <p className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Posting frequency</p>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {['LinkedIn 5/week', 'Instagram 3/week', 'X 4/week'].map((chip) => (
                <span key={chip} className="rounded-full border border-line px-2 py-0.5 text-[11px] text-ink-3">
                  {chip}
                </span>
              ))}
            </div>
          </div>
        </section>

        {/* ── Keywords & sources ──────────────────────────────────────── */}
        <section className="xl:col-span-2">
          <KeywordBoard compact />

          <div className="card mt-3 p-4">
            <h3 className="display text-sm">Sources</h3>
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <span className="text-[11.5px] text-ink-3">Apify</span>
              <Badge tone={statusOf('apify').configured ? 'good' : 'warn'}>
                {statusOf('apify').configured
                  ? 'Configured · platform lanes carry engagement'
                  : `Not configured — ${statusOf('apify').reason}`}
              </Badge>
              <span className="ml-1 text-[11.5px] text-ink-3">crawl4ai</span>
              <Badge tone={statusOf('crawl4ai').configured ? 'good' : 'warn'}>
                {statusOf('crawl4ai').configured
                  ? 'Configured · open web'
                  : `Not configured — ${statusOf('crawl4ai').reason}`}
              </Badge>
            </div>

            <p className="mt-1.5 text-[11px] leading-relaxed text-ink-3">
              Every keyword is captured once per lane. The four platform lanes prefer an Apify actor,
              which reads the platform itself and states real reaction counts; without a token they
              fall back to a <code className="mono">site:</code> search, which states none — so those
              posts are excluded from the engagement, velocity and growth parts of the trend score
              rather than counted as zero. The open web has no actor and is always crawl4ai. A lane
              that returns nothing is reported, never filled in.
            </p>

            <div className="mt-2 space-y-1.5">
              {CAPTURE_LANES.map((lane) => (
                <label key={lane.label} className="block">
                  <span className="text-[10px] uppercase tracking-[0.08em] text-ink-3">{lane.label}</span>
                  <input
                    value={
                      lane.apify !== null && statusOf('apify').configured ? lane.apify : lane.crawler
                    }
                    readOnly
                    className="mono mt-0.5 w-full cursor-default rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[11px] text-ink-3 outline-none"
                  />
                </label>
              ))}
            </div>

            <p className="mt-2 text-[11px] leading-relaxed text-ink-3">
              Posts per keyword, the recency window and the ranking order are knobs on{' '}
              <span className="text-ink-2">Sherlock · Capture pages per keyword and platform</span> in
              Agent Studio, and the deployment caps them with{' '}
              <code className="mono">APIFY_MAX_ITEMS_PER_KEYWORD</code> so a slider cannot run up a
              bill.
            </p>
          </div>
        </section>

        {/* ── AI settings ─────────────────────────────────────────────── */}
        <section className="card p-4">
          <h3 className="display text-sm">AI settings</h3>

          <label className="mt-3 block">
            <span className="flex items-center justify-between">
              <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Creativity</span>
              <span className="tabular text-[11px] text-accent-bright">{settings.creativity}</span>
            </span>
            <input
              type="range"
              min={0}
              max={100}
              value={settings.creativity}
              onChange={(event) => updateSettings({ creativity: Number(event.target.value) })}
              className="mt-1 w-full accent-[var(--color-accent)]"
            />
            <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-3">
              Higher values let the writer stray further from the template structure. It never affects the
              emoji budget or the hashtag ceiling.
            </span>
          </label>

          {[
            {
              key: 'topKeywords' as const,
              label: 'Top keywords',
              hint: 'How many keywords are marked trending each run and carried into hashtag ranking.',
              min: 1,
              max: 20,
            },
            {
              key: 'topHashtagsPerKeyword' as const,
              label: 'Top hashtags per keyword',
              hint: 'How many hashtags each trending keyword contributes before global consolidation.',
              min: 1,
              max: 15,
            },
            {
              key: 'knowledgeHashtagCount' as const,
              label: 'Knowledge Base hashtags',
              hint: 'How many hashtags the Sunday research build investigates.',
              min: 5,
              max: 60,
            },
            {
              key: 'topPerPlatform' as const,
              label: 'Calendar posts per platform',
              hint: 'How many ideas take a calendar slot per platform. The rest go to More suggestions.',
              min: 1,
              max: 30,
            },
          ].map((knob) => (
            <label key={knob.key} className="mt-3 block">
              <span className="flex items-center justify-between">
                <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">{knob.label}</span>
                <span className="tabular text-[11px] text-accent-bright">{settings[knob.key]}</span>
              </span>
              <input
                type="range"
                min={knob.min}
                max={knob.max}
                value={settings[knob.key]}
                onChange={(event) => updateSettings({ [knob.key]: Number(event.target.value) })}
                className="mt-1 w-full accent-[var(--color-accent)]"
              />
              <span className="mt-0.5 block text-[10.5px] leading-relaxed text-ink-3">{knob.hint}</span>
            </label>
          ))}

          <div className="mt-3 space-y-2">
            <Toggle
              label="Human approval required"
              hint="Marketing then Leadership. This checkpoint has no off switch — the control is shown for honesty, not for use."
              checked={settings.approvalRequired}
              locked
              onChange={() => {}}
            />
            <Toggle
              label="Auto-publish on approval"
              hint="When on, Leadership's approval publishes immediately rather than leaving it ready."
              checked={settings.autoPublish}
              onChange={(value) => updateSettings({ autoPublish: value })}
            />
            <Toggle
              label="Auto-scheduling"
              hint="Lets Dora, the Calendar Agent, choose dates and times rather than proposing them."
              checked={settings.autoScheduling}
              onChange={(value) => updateSettings({ autoScheduling: value })}
            />
          </div>
        </section>

        {/* ── Ethara ──────────────────────────────────────────────────── */}
        <section className="card p-4">
          <h3 className="display text-sm">Ethara</h3>

          {voiceSupport.output ? (
            <>
              <div className="mt-3">
                <Toggle
                  label="Voice output"
                  hint="Ethara speaks the summary sentence only — never tables or code."
                  checked={settings.assistantVoice}
                  onChange={(value) => {
                    updateSettings({ assistantVoice: value })
                    setVoiceEnabled(value)
                  }}
                />
              </div>

              <div className="mt-2 flex flex-wrap items-center gap-2">
                <select
                  value={selectedVoice}
                  onChange={(event) => setSelectedVoice(event.target.value)}
                  aria-label="Voice"
                  className="flex-1 rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
                >
                  <option value="">Preferred en-GB voice</option>
                  {listVoices().map((voice) => (
                    <option key={voice.voiceURI} value={voice.voiceURI}>
                      {voice.name} ({voice.lang})
                    </option>
                  ))}
                </select>
                <Btn
                  variant="subtle"
                  onClick={() =>
                    speak('Five keywords are trending. Agentic AI leads on engagement velocity.', {
                      voiceURI: selectedVoice,
                    })
                  }
                >
                  Test
                </Btn>
              </div>
            </>
          ) : (
            <p className="mt-2 text-[11.5px] leading-relaxed text-ink-3">
              This browser does not expose the Web Speech API, so voice output is unavailable. Everything
              else works exactly as it does with voice on.
            </p>
          )}

          {voiceSupport.input ? (
            <div className="mt-3 space-y-2">
              <Toggle
                label="Push-to-talk"
                hint="Hold Space to talk. Off means the mic button toggles instead."
                checked={settings.assistantPushToTalk}
                onChange={(value) => updateSettings({ assistantPushToTalk: value })}
              />
              <Toggle
                label="Wake phrase"
                hint="A low-cost continuous recogniser listens only for “assistant” and then opens the bar. Browser support varies and it keeps the microphone open."
                checked={settings.assistantWakePhrase}
                onChange={(value) => updateSettings({ assistantWakePhrase: value })}
              />
            </div>
          ) : null}

          <div className="mt-3 space-y-2">
            <Toggle
              label="Proactive briefings"
              hint="The weekday 09:00 briefing: three things that changed, and one recommendation."
              checked={settings.assistantProactive}
              onChange={(value) => updateSettings({ assistantProactive: value })}
            />
            <Toggle
              label="Always confirm mutating actions"
              hint="Irreversible actions always stop at the gate. This extends the gate to mutating ones too."
              checked={settings.assistantConfirmMutating}
              onChange={(value) => updateSettings({ assistantConfirmMutating: value })}
            />
          </div>

          <label className="mt-3 block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Narration verbosity</span>
            <select
              value={settings.assistantVerbosity}
              onChange={(event) =>
                updateSettings({ assistantVerbosity: event.target.value as 'terse' | 'normal' | 'detailed' })
              }
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
            >
              <option value="terse">Terse</option>
              <option value="normal">Normal</option>
              <option value="detailed">Detailed</option>
            </select>
          </label>

          <label className="mt-2 block">
            <span className="text-[11px] uppercase tracking-[0.08em] text-ink-3">Address style</span>
            <select
              value={settings.assistantAddressStyle}
              onChange={(event) =>
                updateSettings({ assistantAddressStyle: event.target.value as 'surname' | 'firstname' | 'role' })
              }
              className="mt-1 w-full rounded-lg border border-line bg-surface-2 px-2.5 py-1.5 text-[12px] outline-none focus:border-accent"
            >
              <option value="surname">Surname</option>
              <option value="firstname">First name</option>
              <option value="role">Role</option>
            </select>
          </label>

          <div className="mt-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
            <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3">Model provider</p>
            <p className="mt-0.5 flex flex-wrap items-center gap-2 text-[12px] text-ink-2">
              {assistantProvider === 'gcp' ? 'Configured · Gemini' : 'Deterministic grammar parser'}
              <code className="mono rounded bg-surface px-1.5 py-0.5 text-[10.5px] text-ink-3">
                ASSISTANT_MODEL_PROVIDER
              </code>
            </p>
            <p className="mt-1 text-[10.5px] leading-relaxed text-ink-3">
              With the provider blank, Ethara runs on the built-in grammar parser and template narrator:
              slightly blunter, fully working, every tool still reachable.
            </p>
          </div>
        </section>

        {/* ── Prototype mode ──────────────────────────────────────────── */}
        <section className="card p-4 xl:col-span-2">
          <h3 className="display text-sm">Prototype mode</h3>
          <p className="mt-0.5 text-[11.5px] text-ink-3">
            Every external service, whether it is live, and the environment variable that would switch it
            on. Nothing here is inferred — it is read from the running server's own report.
          </p>

          <ul className="mt-3 grid gap-2 md:grid-cols-2">
            {SERVICES.map((service) => {
              const status = statusOf(service.id)
              return (
                <li
                  key={service.id}
                  className="flex flex-wrap items-center gap-2.5 rounded-lg border border-line bg-surface-2 px-3 py-2.5"
                >
                  {status.configured ? (
                    <CheckCircle2 size={15} className="text-good-ink" aria-hidden="true" />
                  ) : (
                    <XCircle size={15} className="text-ink-3" aria-hidden="true" />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12px] font-medium text-ink">{service.label}</span>
                    <span className="block text-[10.5px] text-ink-3">{status.reason}</span>
                  </span>
                  <Badge tone={status.configured ? 'good' : 'neutral'}>
                    {status.configured ? 'live' : 'mock'}
                  </Badge>
                  <code className="mono rounded bg-surface px-1.5 py-0.5 text-[10px] text-ink-3">{service.env}</code>
                </li>
              )
            })}
          </ul>

          <div className="mt-3 flex flex-wrap items-center gap-2 text-[11.5px] text-ink-3">
            <Badge tone={apiMode === 'connected' ? 'good' : 'warn'}>
              {apiMode === 'connected' ? 'API connected' : 'Standalone'}
            </Badge>
            <span>Workspace: {workspace.name} ({workspace.slug})</span>
          </div>
        </section>
      </div>
    </>
  )
}

function Toggle({
  label,
  hint,
  checked,
  locked = false,
  onChange,
}: {
  label: string
  hint: string
  checked: boolean
  locked?: boolean
  onChange: (value: boolean) => void
}) {
  return (
    <div className="flex items-start gap-3 rounded-lg border border-line bg-surface-2 px-3 py-2">
      <div className="min-w-0 flex-1">
        <p className="text-[12px] font-medium text-ink">{label}</p>
        <p className="mt-0.5 text-[10.5px] leading-relaxed text-ink-3">{hint}</p>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-label={label}
        disabled={locked}
        onClick={() => onChange(!checked)}
        title={locked ? 'This checkpoint cannot be switched off.' : undefined}
        className={`mt-0.5 h-5 w-9 shrink-0 rounded-full border transition-colors duration-[var(--dur-fast)] disabled:cursor-not-allowed disabled:opacity-50 ${
          checked ? 'border-accent bg-accent/30' : 'border-line bg-surface-3'
        }`}
      >
        <span
          className="block h-3.5 w-3.5 rounded-full bg-ink transition-transform duration-[var(--dur-fast)] ease-[var(--ease-out-soft)]"
          style={{ transform: `translateX(${checked ? 19 : 3}px)` }}
        />
      </button>
    </div>
  )
}

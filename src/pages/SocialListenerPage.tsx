/**
 * ANALYSIS — the Analysis Agent's screen, one tab per module.
 *
 *   Social Media Listener     Ethara.AI's own channels (SocialFetch data,
 *                             Claude-read comments, the ORM layer)
 *   Competitor Intelligence   the P0/P1 competitor universe, profiled with the
 *                             competitor-profiling skill; market analysis
 *
 * Opened from the Dashboard's Analysis card. A page, not a dialog: the reports
 * are long, and `main` in the shell is the one scroller, so the whole screen
 * scrolls as a single document with no nested scroll areas. The chosen tab is
 * remembered per browser.
 */

import { useState } from 'react'
import { CompetitorIntelligenceSection } from '../components/competitor-intel'
import { BackToHub } from '../components/layout'
import { SocialListenerSection } from '../components/social-listener'
import { Tabs } from '../components/ui'
import { useStore } from '../store'

type Module = 'listener' | 'competitors'
const KEY = 'sma.analysis.module'

function remembered(): Module {
  try {
    return window.localStorage.getItem(KEY) === 'competitors' ? 'competitors' : 'listener'
  } catch {
    return 'listener'
  }
}

export function SocialListenerPage() {
  const report = useStore((s) => s.socialListener ?? null)
  const [module, setModule] = useState<Module>(remembered)
  const choose = (m: Module): void => {
    setModule(m)
    try {
      window.localStorage.setItem(KEY, m)
    } catch {
      // Remembering the tab is a convenience only.
    }
  }
  return (
    <div className="mx-auto flex w-full max-w-[1400px] flex-col pb-10">
      <header className="mb-3">
        <BackToHub />
        <h1 className="text-[20px] font-semibold tracking-[-0.02em] text-ink">Analysis</h1>
        <p className="mt-0.5 text-[12px] text-ink-3">
          {module === 'listener'
            ? 'The Analysis Agent’s reading of Ethara.AI’s LinkedIn, Instagram, Facebook and X — through SocialFetch.'
            : 'The Analysis Agent’s competitor research — the competitor-profiling skill from coreyhaines31/marketingskills, every claim sourced.'}
        </p>
        <Tabs<Module>
          className="mt-3"
          tabs={[
            { id: 'listener', label: 'Social Media Listener' },
            { id: 'competitors', label: 'Competitor Intelligence' },
          ]}
          active={module}
          onChange={choose}
        />
      </header>
      {module === 'listener' ? <SocialListenerSection report={report} /> : <CompetitorIntelligenceSection />}
    </div>
  )
}

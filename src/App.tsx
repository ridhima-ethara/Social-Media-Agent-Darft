/**
 * THE APPLICATION SHELL
 *
 * Screens are components selected by `page` in the store — there is no router
 * library by design (Part 3). Everything that must exist on every post-auth
 * screen (the shell, the command-plane surfaces, the drawer, the review dialog, the
 * theater and the toast host) is mounted here, once.
 */

import { useEffect } from 'react'
import { useStore } from './store'
import { Shell } from './components/layout'
import { BootSequence } from './components/assistant/boot'
import { ToastHost } from './components/ui'
import { startWakeListener, type ListenHandle } from './lib/voice'

import { LoginPage } from './pages/LoginPage'
import { Dashboard } from './pages/Dashboard'
import { ContentIntelligence } from './pages/ContentIntelligence'
import { CalendarPage } from './pages/CalendarPage'
import { PublishedPosts } from './pages/PublishedPosts'
import { LeadershipReview } from './pages/LeadershipReview'
import { AgentActivity } from './pages/AgentActivity'
import { AgentStudio } from './pages/AgentStudio'
import { RunConsole } from './pages/RunConsole'
import { SettingsPage } from './pages/SettingsPage'
import { AssistantConsole } from './pages/AssistantConsole'
import { KnowledgeBase, KnowledgeDrawer } from './pages/KnowledgeBase'
import { ReviewPanel } from './pages/ReviewPanel'
import { PipelineTheater } from './pages/PipelineTheater'

function CurrentPage() {
  const page = useStore((s) => s.page)

  switch (page) {
    case 'dashboard':
      return <Dashboard />
    case 'intelligence':
      return <ContentIntelligence />
    case 'calendar':
      return <CalendarPage />
    case 'published':
      return <PublishedPosts />
    case 'leadership':
      return <LeadershipReview />
    case 'orchestration':
      return <AgentActivity />
    case 'studio':
      return <AgentStudio />
    case 'console':
      return <RunConsole />
    case 'assistant':
      return <AssistantConsole />
    case 'knowledge':
      return <KnowledgeBase />
    case 'settings':
      return <SettingsPage />
    default:
      return <Dashboard />
  }
}

export default function App() {
  const user = useStore((s) => s.user)
  const theme = useStore((s) => s.theme)
  const toasts = useStore((s) => s.toasts)
  const dismissToast = useStore((s) => s.dismissToast)
  const connectToRuntime = useStore((s) => s.connectToRuntime)
  const wakePhrase = useStore((s) => s.settings.assistantWakePhrase)
  const openBar = useStore((s) => s.openBar)

  // Theme is one attribute on <html>, applied on mount and on every change.
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  // Probe the runtime once, before sign-in, so the login screen already knows
  // which mode it is in. Fails soft — the app is usable either way.
  useEffect(() => {
    void connectToRuntime()
  }, [connectToRuntime])

  // The wake phrase is off by default and only ever runs when explicitly enabled.
  useEffect(() => {
    if (!user || !wakePhrase) return
    let handle: ListenHandle | null = null
    handle = startWakeListener(() => openBar())
    return () => handle?.stop()
  }, [user, wakePhrase, openBar])

  if (!user) {
    return (
      <>
        <LoginPage />
        <ToastHost toasts={toasts} onDismiss={dismissToast} />
      </>
    )
  }

  return (
    <>
      <Shell>
        <CurrentPage />
      </Shell>

      <BootSequence />
      <KnowledgeDrawer />
      <ReviewPanel />
      <PipelineTheater />
      <ToastHost toasts={toasts} onDismiss={dismissToast} />
    </>
  )
}

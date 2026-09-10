# Archived · "Ask Ethara about this screen"

Removed from the platform on 2026-09-10 at the operator's request. Nothing here is imported by the
running app; this folder exists so the feature can be restored exactly rather than reconstructed from
memory.

## What it was

A ghost button in the shared `PageHeader`, shown on any screen that passed an `askPrompt`. Clicking it
opened the ⌘K command bar **pre-filled** with a question written for that screen — so an operator on
Content Intelligence got "What's trending this week?" already typed, and only had to press Enter.

It was a discovery affordance rather than a capability: every one of those questions could always be
typed into ⌘K directly, and the command plane answers them the same way with or without this button.
Removing it takes nothing away from what Ethara can do.

## Where it lived

`src/components/layout.tsx` → `PageHeader`, in the right-hand actions cluster:

```tsx
export function PageHeader({
  title,
  subtitle,
  agents,
  actions,
  askPrompt,
}: {
  title: string
  subtitle: string
  agents?: AgentId[]
  actions?: ReactNode
  /** Pre-fills the command bar with a prompt appropriate to this screen. */
  askPrompt?: string
}) {
  const openBar = useStore((s) => s.openBar)

  return (
    <header className="mb-5 flex flex-wrap items-start justify-between gap-4">
      {/* … title, subtitle, agent chips … */}

      <div className="flex flex-wrap items-center gap-2">
        {askPrompt ? (
          <Btn variant="ghost" onClick={() => openBar(askPrompt)}>
            <Sparkles size={13} /> Ask Ethara about this screen
          </Btn>
        ) : null}
        {actions}
      </div>
    </header>
  )
}
```

## The prompts each screen passed

These were the per-screen questions, and they are the part worth keeping — each is a real utterance the
command plane resolves, so they double as a list of what ⌘K can be asked from each screen.

| Screen | Prompt |
|---|---|
| `Dashboard.tsx` | `` `How did ${linkedin?.label ?? 'this month'} perform?` `` |
| `CalendarPage.tsx` | `Draft Thursday's LinkedIn post` |
| `PublishedPosts.tsx` | `What was our strongest post?` |
| `SettingsPage.tsx` | `Which integrations are not configured?` |
| `ContentIntelligence.tsx` | `What's trending this week?` |
| `KnowledgeBase.tsx` | `Rebuild the knowledge base` |
| `RunConsole.tsx` | `What did the last run do?` (two headers) |
| `LeadershipReview.tsx` | `Show me everything waiting on me` |
| `AgentActivity.tsx` | `What is every agent doing right now?` |
| `AgentStudio.tsx` | `Change the top keywords to 8` |

The Dashboard's and the Calendar's were removed earlier, at the same operator's request, before this
platform-wide removal.

## To restore it

1. Put the `askPrompt` prop, the `openBar` selector and the `Btn` block back into `PageHeader` in
   `src/components/layout.tsx`, and re-add the `Sparkles` import from `lucide-react`.
2. Pass `askPrompt` again on whichever screens should carry it, from the table above.

Nothing else is required. `store.openBar(prefill)` still exists and still accepts a prefill — it is
used by other callers, so the mechanism this button relied on was never removed.

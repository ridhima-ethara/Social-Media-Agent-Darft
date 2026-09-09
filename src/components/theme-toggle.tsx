/**
 * THE THEME TOGGLE
 *
 * One attribute on `<html>`, persisted to `localStorage["ethara-theme"]`.
 * No component below this one ever asks which theme is active — they read
 * tokens, and the tokens change underneath them.
 */

import { Moon, Sun } from 'lucide-react'
import { useStore } from '../store'

export function ThemeToggle({ className = '' }: { className?: string }) {
  const theme = useStore((s) => s.theme)
  const toggleTheme = useStore((s) => s.toggleTheme)

  return (
    <button
      type="button"
      onClick={toggleTheme}
      title={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
      aria-label={theme === 'dark' ? 'Switch to the light theme' : 'Switch to the dark theme'}
      className={`rounded-lg border border-line p-1.5 text-ink-3 transition-colors duration-[var(--dur-fast)] hover:border-line-strong hover:text-ink ${className}`}
    >
      {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
    </button>
  )
}

/**
 * AGENT ICONS
 *
 * The one place a declared `AgentIconId` becomes a drawn glyph.
 *
 * WHY THE INDIRECTION. `shared/agent-registry.ts` is imported by the server as
 * well as the web app, so it cannot depend on a React icon set. It therefore
 * declares a semantic id — `flask`, `send`, `graduation` — and this module is
 * the only thing that knows which glyph that id draws. Changing the picture is
 * a change here; changing what an agent *is* is a change in the registry.
 *
 * WHY NOT EMOJI. The emoji budget is zero (rule 5), and it applies to the
 * product as much as to the captions it writes. An emoji is also a font
 * accident: it renders differently on every platform, cannot take a brand
 * colour, and carries no accessible name. A lucide icon inherits
 * `currentColor`, scales cleanly and is `aria-hidden` beside real text.
 */

import {
  BarChart3,
  BookOpen,
  CalendarDays,
  Command,
  FlaskConical,
  GraduationCap,
  Network,
  Palette,
  PenLine,
  Search,
  Send,
  ShieldCheck,
  type LucideIcon,
} from 'lucide-react'
import { AGENT_BY_ID } from '@shared/agent-registry'
import type { AgentIconId, AgentId } from '@shared/agent-contract'

const ICONS: Record<AgentIconId, LucideIcon> = {
  command: Command,
  search: Search,
  flask: FlaskConical,
  'chart-cluster': Network,
  calendar: CalendarDays,
  pen: PenLine,
  palette: Palette,
  'check-shield': ShieldCheck,
  book: BookOpen,
  send: Send,
  'bar-chart': BarChart3,
  graduation: GraduationCap,
}

/** The component for one declared icon id. */
export function iconForAgentIcon(icon: AgentIconId): LucideIcon {
  return ICONS[icon]
}

/** The component for an agent, by id. Falls back to the command mark. */
export function iconForAgent(agentId: AgentId): LucideIcon {
  const spec = AGENT_BY_ID[agentId]
  return spec ? ICONS[spec.icon] : Command
}

export interface AgentIconProps {
  agentId: AgentId
  size?: number
  className?: string
}

/**
 * The icon alone. Always `aria-hidden`: it sits beside the agent's name, and a
 * screen reader announcing "flask Dexter" is worse than announcing "Dexter".
 */
export function AgentIcon({ agentId, size = 14, className = '' }: AgentIconProps) {
  const Icon = iconForAgent(agentId)
  return <Icon size={size} className={className} aria-hidden="true" />
}

export interface AgentLabelProps {
  agentId: AgentId
  /** Appends the role, e.g. "Dexter · Validation Agent". */
  withRole?: boolean
  size?: number
  className?: string
  iconClassName?: string
}

/**
 * Icon plus name, the way an agent should be referred to in the interface.
 *
 * The name is real text, so it is searchable, selectable and readable aloud.
 * The icon is decoration that helps the eye find the row.
 */
export function AgentLabel({
  agentId,
  withRole = false,
  size = 14,
  className = '',
  iconClassName = 'text-accent-bright',
}: AgentLabelProps) {
  const spec = AGENT_BY_ID[agentId]
  if (!spec) return null

  return (
    <span className={`inline-flex min-w-0 items-center gap-1.5 ${className}`}>
      <AgentIcon agentId={agentId} size={size} className={`shrink-0 ${iconClassName}`} />
      <span className="truncate">
        {spec.name}
        {withRole ? <span className="text-ink-3"> · {spec.role.split(' · ')[0]}</span> : null}
      </span>
    </span>
  )
}

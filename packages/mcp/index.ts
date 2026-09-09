/**
 * THE CONNECTOR SURFACE
 *
 * One sweep, one shape. Every connector reports `ConnectorHealth`, so the
 * health endpoint and the Settings screen render the same truth about what is
 * reachable — which is one of the two rules that keep the fallbacks honest.
 */

import type { ConnectorHealth } from '../contracts/src/index'
import { similarityConnector } from './similarity/index'
import { healthOfAll as researchHealth } from './research-sources/index'
import { publisherHealth, type PublishMode } from './publisher/index'

export * from './similarity/index'
export * from './research-sources/index'
export * from './publisher/index'
export * from './render/index'
export * from './kb/index'

/**
 * Every connector's health in one call.
 *
 * The KB and render connectors are constructed with dependencies, so they are
 * reported by their owners rather than here — a registry that pretended to
 * know their state without holding them would be guessing.
 */
export function connectorHealth(mode: PublishMode = 'demo'): ConnectorHealth[] {
  return [similarityConnector.health(), ...researchHealth(), ...publisherHealth(mode)]
}

export function unconfiguredConnectors(mode: PublishMode = 'demo'): ConnectorHealth[] {
  return connectorHealth(mode).filter((health) => !health.configured)
}

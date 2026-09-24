/**
 * The platform registry. One entry per platform module; add a platform by
 * writing its module and listing it here.
 */

import { facebook } from './facebook'
import { instagram } from './instagram'
import { linkedin } from './linkedin'
import type { PlatformId, PlatformModule } from './types'
import { web } from './web'
import { x } from './x'

export type { ClassifiedUrl, ContentType, PlatformId, PlatformModule } from './types'
export { PLATFORM_IDS } from './types'

export const PLATFORM_MODULES: Record<PlatformId, PlatformModule> = {
  linkedin,
  instagram,
  x,
  facebook,
  web,
}

/** The module for a platform id, or `undefined` when the bridge has none. */
export function platformModule(id: string): PlatformModule | undefined {
  return Object.hasOwn(PLATFORM_MODULES, id) ? PLATFORM_MODULES[id as PlatformId] : undefined
}

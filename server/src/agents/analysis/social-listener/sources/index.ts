/** The per-platform SocialFetch sources. Add a platform here; the listener needs nothing else. */

import type { ListenerPlatform } from '../types'
import type { ListenerSource } from './common'
import { facebookSource } from './facebook'
import { instagramSource } from './instagram'
import { linkedinSource } from './linkedin'
import { xSource } from './x'

export const LISTENER_SOURCES: Record<ListenerPlatform, ListenerSource> = {
  linkedin: linkedinSource,
  instagram: instagramSource,
  facebook: facebookSource,
  x: xSource,
}

export type { ListenerSource, SourceContext, SourceTarget } from './common'

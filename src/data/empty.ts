/**
 * THE EMPTY STATE
 *
 * What the app renders before it has spoken to the API, and what it falls back
 * to when it cannot. Every collection is empty, because that is the truth about
 * a client that has read nothing: there is no bundled dataset behind this file,
 * and the UI would otherwise be showing figures no run produced.
 *
 * Emptiness is a first-class state here, not a loading artefact. `apiMode` says
 * whether the app is connected, and each screen's own empty copy says what to
 * do about it — which is a more useful thing to show an operator than a
 * plausible dashboard they cannot act on.
 */

import type { StatePayload } from '../types'
import { BRAND } from '@shared/brand-voice'

export const EMPTY_STATE: StatePayload = {
  workspace: {
    name: 'Ethara.AI · Main',
    slug: 'ethara',
    brandVoice: BRAND.voiceWords.join(', '),
    audience: BRAND.audience,
    settings: {},
  },
  keywords: [],
  keywordSignals: [],
  hashtags: [],
  topHashtags: [],
  scraped: [],
  ideas: [],
  drafts: {},
  media: {},
  published: [],
  knowledge: [],
  knowledgeBuild: null,
  agents: [],
  activity: [],
  analytics: [],
  reviewQueue: [],
  sources: [],
  pipeline: null,
  platformLabels: {
    linkedin: 'LinkedIn',
    instagram: 'Instagram',
    x: 'X',
    facebook: 'Facebook',
  },
  assistant: {
    conversation: null,
    turns: [],
    brief: null,
    pendingConfirm: null,
  },
  mode: {
    publishMode: 'demo',
    assistantProvider: 'deterministic',
    // Populated from `/health` the moment the API answers. Claiming a service
    // is configured before asking would be the one lie this file exists to
    // avoid.
    integrations: [],
  },
}

/**
 * The adapter factory — the one place that turns an adapter id into an
 * implementation bound to a platform. The pipeline asks for adapters by id and
 * never imports an implementation directly, which is what keeps the
 * acquisition layer replaceable.
 */

import type { AdapterId, BridgeConfig } from '../config'
import type { PlatformModule } from '../platforms'
import { createClaudeCodeAdapter } from './claude-code'
import { createFixtureAdapter, loadFixtureFile } from './fixture'
import { createManualUrlsAdapter } from './manual-urls'
import { createSmaCapturesAdapter } from './sma-captures'
import { createSocialFetchAdapter } from './socialfetch'
import type { TrendSourceAdapter } from './source-types'

export type { LinkedInSourceAdapter, TrendSourceAdapter } from './source-types'

export interface AdapterFactoryOptions {
  platform: PlatformModule
  config: BridgeConfig
  /** URLs supplied on this call, for `manual_urls`. */
  suppliedUrls?: readonly string[]
  /** Fixture file for `fixture`; the default sample file otherwise. */
  fixturePath?: string
}

export function createAdapter(id: AdapterId, opts: AdapterFactoryOptions): TrendSourceAdapter {
  switch (id) {
    case 'claude_code':
      return createClaudeCodeAdapter(opts.platform, opts.config)
    case 'socialfetch':
      return createSocialFetchAdapter(opts.platform, opts.config)
    case 'sma_captures':
      return createSmaCapturesAdapter(opts.platform)
    case 'manual_urls':
      return createManualUrlsAdapter(opts.platform, opts.config, opts.suppliedUrls ?? [])
    case 'fixture':
      return createFixtureAdapter(opts.platform, loadFixtureFile(opts.fixturePath))
  }
}

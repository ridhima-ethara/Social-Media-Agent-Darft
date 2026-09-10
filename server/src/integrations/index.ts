/**
 * The integration surface, in one place.
 *
 * `integrationReport()` is what `/health` and the Settings screen render, so
 * the mode is always visible — which is one of the two rules that keep the
 * fallbacks honest (the other being that the interfaces are identical, so
 * falling back changes which implementation is bound, never which code path
 * runs).
 */

export {
  AdapterError,
  describeAdapter,
  fetchJson,
  mapWithConcurrency,
  stamp,
  withFallback,
  withRetry,
  type AdapterReport,
  type FallbackOutcome,
} from './adapter'

export {
  RESEARCH_DOMAIN,
  parallelResearch,
  researchObjective,
  type ParallelSearchInput,
  type ResearchCitation,
  type ResearchFinding,
} from './parallel'

export {
  gcpImage,
  gcpText,
  rewriteTemplateCaption,
  temperatureFromPercent,
  writeTemplateCaption,
  type GcpImageInput,
  type GcpTextInput,
  type PaintedBackground,
  type TemplateRewriteResult,
  type TemplateWriterInput,
} from './gcp-llm'

export {
  ollamaImage,
  ollamaText,
  stripReasoning,
  templateWriter,
  textAdapter,
  textAdapterFor,
  textModelId,
  type OllamaTextInput,
} from './ollama'

export { crawl4aiSearch, type Crawl4aiSearchInput, type RawPost } from './crawl4ai'

import { describeAdapter, type AdapterReport } from './adapter'
import { crawl4aiSearch } from './crawl4ai'
import { gcpImage, gcpText } from './gcp-llm'
import { ollamaImage, ollamaText } from './ollama'
import { parallelResearch } from './parallel'

/** Every adapter in the product, for a single reachability sweep. */
export function allAdapters() {
  return [
    crawl4aiSearch,
    parallelResearch,
    gcpText,
    gcpImage,
    ollamaText,
    ollamaImage,
  ]
}

export interface IntegrationReport {
  adapters: AdapterReport[]
  /** True when every adapter is unconfigured — nothing live can be reached. */
  fullyOffline: boolean
  configuredCount: number
}

export function integrationReport(): IntegrationReport {
  const adapters = allAdapters().map((a) =>
    describeAdapter(a as Parameters<typeof describeAdapter>[0]),
  )
  const configuredCount = adapters.filter((a) => a.configured).length
  return {
    adapters,
    fullyOffline: configuredCount === 0,
    configuredCount,
  }
}

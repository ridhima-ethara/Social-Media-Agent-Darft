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
  withChainFallback,
  withFallback,
  withRetry,
  type AdapterReport,
  type ChainLink,
  type ChainOutcome,
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
  describeGcpAuth,
  gcpAuthAvailable,
  serviceAccountEmail,
} from './gcp-auth'

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
  usableImageParts,
  type TemplateWriterInput,
} from './gcp-llm'

export {
  ollamaImage,
  ollamaText,
  stripReasoning,
  templateWriter,
  textAdapter,
  textAdapterFor,
  textChain,
  textChainDowngradeReason,
  textModelId,
  textModelIdFor,
  type OllamaTextInput,
} from './ollama'


export {
  embeddingAdapter,
  embeddingModelId,
  embeddableText,
  embedMany,
  embedOne,
  toSqlVector,
  type EmbedInput,
  type EmbedOutcome,
} from './embeddings'
/*
 * `rawPostEngagement` is gone with the HTTP client. It weighted a RawPost's
 * counts and had no caller outside this barrel — the pipeline's engagement
 * weighting lives in `agents/corpus.ts`, where the Validation Agent reads it.
 */
export { apifySearch, actorLabelFor, explainApifyFailure } from './apify'

export {
  describeWhisper,
  transcriptionBudget,
  whisperPython,
  whisperTranscribe,
  type TranscribeInput,
  type TranscribeOutput,
} from './whisper'

export {
  captureChainFor,
  captureFor,
  platformLaneUnavailableReason,
  openWebLaneUnavailableReason,
  type CaptureAttempt,
  type CaptureInput,
  type CaptureSource,
  type RawPost,
} from './capture'

import { describeAdapter, type AdapterReport } from './adapter'
import { apifySearch } from './apify'
import { gcpImage, gcpText } from './gcp-llm'
import { ollamaImage, ollamaText } from './ollama'
import { parallelResearch } from './parallel'
import { whisperTranscribe } from './whisper'

/** Every adapter in the product, for a single reachability sweep. */
export function allAdapters() {
  return [
    apifySearch,
    parallelResearch,
    gcpText,
    gcpImage,
    ollamaText,
    ollamaImage,
    // R7: a new adapter joins the boot sweep and `/api/health` the day it is
    // written, not the day someone remembers. An unreported adapter is one
    // whose absence is discovered from a failed run.
    whisperTranscribe,
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

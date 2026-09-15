/**
 * THE ADAPTER CONTRACT
 *
 * Law 3: every external service sits behind `ServiceAdapter`, with
 * `isConfigured()`, `unavailableReason()` and a deterministic offline fallback.
 * The product must be fully explorable and demoable with a completely empty
 * `.env`, and that is not optional.
 *
 * The helpers here make the pattern uniform so no caller has to remember it:
 *   · `withFallback` runs the live path, catches anything, and returns a
 *     fixture stamped with `source` and `fallbackReason`
 *   · `fetchJson` is the only HTTP entry point — native fetch, an abort
 *     timeout, and a thrown error on a non-2xx or unparseable body
 */

import type { ServiceAdapter, Sourced } from '../../../shared/agent-contract'

export type { ServiceAdapter, Sourced }

/* ═══════════════════════════════════════════════════════════════════════════
   ERRORS
   ═══════════════════════════════════════════════════════════════════════════ */

/** Thrown by `fetchJson`. Carries enough to explain the failure to an operator. */
export class AdapterError extends Error {
  readonly adapterId: string
  readonly status?: number
  readonly detail?: string

  constructor(adapterId: string, message: string, status?: number, detail?: string) {
    super(message)
    this.name = 'AdapterError'
    this.adapterId = adapterId
    this.status = status
    this.detail = detail
  }

  /** A sentence an operator can act on. */
  toReason(): string {
    if (this.status) {
      return `${this.adapterId} returned HTTP ${this.status}${this.detail ? ` — ${this.detail}` : ''}`
    }
    return `${this.adapterId} failed — ${this.message}`
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   HTTP
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FetchJsonOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH'
  headers?: Record<string, string>
  body?: unknown
  timeoutMs: number
  adapterId: string
}

/**
 * The single HTTP path for every adapter. Native fetch with
 * `AbortSignal.timeout` — no axios anywhere in the codebase.
 *
 * Throws `AdapterError` on a non-2xx, an unparseable body, or a timeout, so
 * every caller's try/catch has one error shape to handle.
 */
export async function fetchJson<T>(url: string, opts: FetchJsonOptions): Promise<T> {
  const { method = 'GET', headers = {}, body, timeoutMs, adapterId } = opts

  let response: Response
  try {
    response = await fetch(url, {
      method,
      headers: {
        accept: 'application/json',
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...headers,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    })
  } catch (error) {
    // A timeout surfaces as an AbortError; name it plainly rather than leaking it.
    if (error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')) {
      throw new AdapterError(adapterId, `timed out after ${timeoutMs}ms`)
    }
    throw new AdapterError(
      adapterId,
      error instanceof Error ? error.message : 'network request failed',
    )
  }

  if (!response.ok) {
    // Read a little of the body for the reason, but never echo a whole payload.
    let detail: string | undefined
    try {
      const text = await response.text()
      detail = text.slice(0, 240).replace(/\s+/g, ' ').trim() || undefined
    } catch {
      detail = undefined
    }
    throw new AdapterError(
      adapterId,
      `HTTP ${response.status} ${response.statusText}`,
      response.status,
      detail,
    )
  }

  try {
    return (await response.json()) as T
  } catch {
    throw new AdapterError(adapterId, 'response body was not valid JSON')
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   FALLBACK
   ═══════════════════════════════════════════════════════════════════════════ */

export interface FallbackOutcome<T> {
  value: T
  source: 'live' | 'fixture'
  fallbackReason?: string
}

/**
 * Runs the live path when the adapter is configured, and falls back to the
 * fixture on ANY failure — never swallowing the reason.
 *
 * `onFallback` lets the caller record an activity event naming why, which is
 * what makes the mode visible in the UI rather than silently degraded.
 */
export async function withFallback<TIn, TOut>(
  adapter: ServiceAdapter<TIn, TOut>,
  input: TIn,
  fixture: () => TOut | Promise<TOut>,
  onFallback?: (reason: string) => void,
): Promise<FallbackOutcome<TOut>> {
  if (!adapter.isConfigured()) {
    const reason = adapter.unavailableReason()
    onFallback?.(reason)
    return { value: await fixture(), source: 'fixture', fallbackReason: reason }
  }

  try {
    return { value: await adapter.run(input), source: 'live' }
  } catch (error) {
    const reason =
      error instanceof AdapterError
        ? error.toReason()
        : `${adapter.id} failed — ${error instanceof Error ? error.message : String(error)}`
    onFallback?.(reason)
    return { value: await fixture(), source: 'fixture', fallbackReason: reason }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   CHAINED FALLBACK — a second real implementation, not a fixture

   `withFallback` degrades from ONE adapter straight to the deterministic path.
   That is right when there is no second implementation, and wrong when there
   is: a configured primary that fails should reach its backup before the
   product gives up on a model altogether.

   This mirrors `captureChainFor()` in `capture.ts`, which does the same for the
   platform lanes — Apify first, crawl4ai behind it. The distinction that file
   draws is preserved here: an adapter reached because the one before it FAILED
   is a degradation and is reported per call; an adapter that is simply the
   first configured one in the chain is the primary and is not.
   ═══════════════════════════════════════════════════════════════════════════ */

/** One link in a chain: the adapter to try, and whether it is a backup. */
export interface ChainLink<TIn, TOut> {
  adapter: ServiceAdapter<TIn, TOut>
  /** True for an adapter only reached because a configured primary failed. */
  isBackup: boolean
}

export interface ChainOutcome<T> extends FallbackOutcome<T> {
  /** The adapter that actually answered, or `undefined` on the fixture path. */
  servedBy?: string
  /** True when a configured primary failed and a backup answered instead. */
  viaBackup: boolean
}

/**
 * Tries each link in order, then the fixture.
 *
 * `onFallback` fires for every link that could not serve, so a run where Gemini
 * failed and Qwen answered records BOTH facts: the operator learns the hosted
 * provider is broken even though the output is fine. Reporting only the final
 * outcome would hide a failing credential behind a working backup for as long
 * as the backup held.
 */
export async function withChainFallback<TIn, TOut>(
  chain: readonly ChainLink<TIn, TOut>[],
  input: TIn,
  fixture: () => TOut | Promise<TOut>,
  onFallback?: (reason: string) => void,
): Promise<ChainOutcome<TOut>> {
  const reasons: string[] = []

  for (const link of chain) {
    if (!link.adapter.isConfigured()) {
      // Not reported through `onFallback`: an unconfigured provider is a
      // standing condition of the deployment, already stated at /health and at
      // boot. Emitting it per call would read as a failure that just happened.
      reasons.push(link.adapter.unavailableReason())
      continue
    }

    try {
      const value = await link.adapter.run(input)
      return { value, source: 'live', servedBy: link.adapter.id, viaBackup: link.isBackup }
    } catch (error) {
      const reason =
        error instanceof AdapterError
          ? error.toReason()
          : `${link.adapter.id} failed — ${error instanceof Error ? error.message : String(error)}`
      reasons.push(reason)
      onFallback?.(reason)
    }
  }

  const fallbackReason =
    reasons.length > 0 ? reasons.join('; ') : 'no text provider is configured'
  return { value: await fixture(), source: 'fixture', fallbackReason, viaBackup: false }
}

/**
 * Retries with exponential backoff before giving up.
 * Only the final failure propagates, so `withFallback` sees one error.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  retries: number,
  baseDelayMs = 400,
): Promise<T> {
  let lastError: unknown
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn()
    } catch (error) {
      lastError = error
      if (attempt === retries) break
      const delay = baseDelayMs * 2 ** attempt
      await new Promise((r) => setTimeout(r, delay))
    }
  }
  throw lastError
}

/** Stamps a value with which implementation produced it. */
export function stamp<T extends object>(
  value: T,
  source: 'live' | 'fixture',
  fallbackReason?: string,
): Sourced<T> {
  return fallbackReason === undefined
    ? ({ ...value, source } as Sourced<T>)
    : ({ ...value, source, fallbackReason } as Sourced<T>)
}

/**
 * Runs tasks with a concurrency ceiling, preserving input order.
 * Every adapter that fans out — per keyword, per hashtag — uses this so the
 * `maxParallel` knob actually means something.
 */
export async function mapWithConcurrency<TIn, TOut>(
  items: readonly TIn[],
  limit: number,
  worker: (item: TIn, index: number) => Promise<TOut>,
): Promise<TOut[]> {
  const results = new Array<TOut>(items.length)
  const ceiling = Math.max(1, Math.min(limit, items.length))
  let cursor = 0

  async function pump(): Promise<void> {
    for (;;) {
      const index = cursor
      cursor += 1
      if (index >= items.length) return
      results[index] = await worker(items[index] as TIn, index)
    }
  }

  await Promise.all(Array.from({ length: ceiling }, () => pump()))
  return results
}

/* ═══════════════════════════════════════════════════════════════════════════
   REPORTING
   ═══════════════════════════════════════════════════════════════════════════ */

export interface AdapterReport {
  id: string
  label: string
  configured: boolean
  reason: string
}

/** What `/health` and the Settings screen render for each service. */
export function describeAdapter(adapter: ServiceAdapter<unknown, unknown>): AdapterReport {
  const configured = adapter.isConfigured()
  return {
    id: adapter.id,
    label: adapter.label,
    configured,
    reason: configured ? 'Configured' : adapter.unavailableReason(),
  }
}

/**
 * CONFIG LOADER
 *
 * Constraint 1: every number comes from here. No literal threshold, weight or
 * limit in a prompt, a skill body, or an agent file.
 *
 * Constraint 2: **this loader must distinguish absent from zero.** That is the
 * single most important thing in this file. `WEIGHT=0` and an unset `WEIGHT`
 * are different states, and a loader that collapses them silently turns "we
 * have no reading" into "the reading is nothing" — which is how a dashboard
 * ends up confidently reporting a drop that never happened.
 */

import { type Reported, reported, unreported } from '../../contracts/src/index'

/* ═══════════════════════════════════════════════════════════════════════════
   READING
   ═══════════════════════════════════════════════════════════════════════════ */

export type ConfigSource = Record<string, string | undefined>

function rawEnv(): ConfigSource {
  return typeof process === 'undefined' ? {} : process.env
}

/**
 * Reads a key without ever inventing a value.
 *
 * An unset key and an empty string are both **absent**. A key set to `"0"` is
 * **present with the value zero**, and the two are not interchangeable.
 */
export function readRaw(key: string, source: ConfigSource = rawEnv()): Reported<string> {
  const value = source[key]
  if (value === undefined) return unreported(`${key} is not set`)
  if (value.trim() === '') return unreported(`${key} is set but empty`)
  return reported(value.trim())
}

export function readNumber(key: string, source: ConfigSource = rawEnv()): Reported<number> {
  const raw = readRaw(key, source)
  if (!raw.reported) return raw as Reported<number>
  const parsed = Number(raw.value)
  if (!Number.isFinite(parsed)) {
    return unreported(`${key} is set to "${raw.value}", which is not a number`)
  }
  return reported(parsed)
}

export function readBoolean(key: string, source: ConfigSource = rawEnv()): Reported<boolean> {
  const raw = readRaw(key, source)
  if (!raw.reported) return raw as Reported<boolean>
  const value = raw.value.toLowerCase()
  if (['true', '1', 'yes', 'on'].includes(value)) return reported(true)
  if (['false', '0', 'no', 'off'].includes(value)) return reported(false)
  return unreported(`${key} is set to "${raw.value}", which is not a boolean`)
}

/* ═══════════════════════════════════════════════════════════════════════════
   DECLARING
   ═══════════════════════════════════════════════════════════════════════════ */

export type ConfigType = 'number' | 'percent' | 'boolean' | 'enum' | 'text'

export interface ConfigEntry<T = string | number | boolean> {
  key: string
  label: string
  type: ConfigType
  /**
   * The default. It is a real value, not a sentinel — which is precisely why
   * `readRaw` must not treat an explicit `0` as absent and fall through to it.
   */
  default: T
  /** Rendered directly to the operator. A field without one is invalid. */
  description: string
  min?: number
  max?: number
  unit?: string
  options?: readonly string[]
  /** The env key that overrides it, where one exists. */
  envKey?: string
}

export interface ResolvedEntry<T> {
  value: T
  /** Where the value came from — visible in the UI, so nothing is mysterious. */
  origin: 'default' | 'env' | 'workspace' | 'run'
  /** Present when a supplied value was rejected and the default stood. */
  rejected?: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   RESOLVING — defaults < env < workspace < run
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ResolveOptions {
  workspace?: Record<string, string | number | boolean>
  run?: Record<string, string | number | boolean>
  source?: ConfigSource
}

/**
 * Resolves one declared entry through the precedence chain, validating each
 * candidate against the declared type and bounds.
 *
 * A value that fails validation does **not** silently become the default: the
 * default is used *and* the rejection is reported, so a typo in a workspace
 * override surfaces instead of quietly changing behaviour.
 */
export function resolve<T extends string | number | boolean>(
  entry: ConfigEntry<T>,
  options: ResolveOptions = {},
): ResolvedEntry<T> {
  const candidates: Array<{ origin: ResolvedEntry<T>['origin']; raw: unknown }> = []

  if (entry.envKey) {
    const fromEnv = readRaw(entry.envKey, options.source ?? rawEnv())
    if (fromEnv.reported) candidates.push({ origin: 'env', raw: fromEnv.value })
  }
  if (options.workspace && entry.key in options.workspace) {
    candidates.push({ origin: 'workspace', raw: options.workspace[entry.key] })
  }
  if (options.run && entry.key in options.run) {
    candidates.push({ origin: 'run', raw: options.run[entry.key] })
  }

  // Later candidates win, so walk backwards and take the first that validates.
  for (const candidate of [...candidates].reverse()) {
    const coerced = coerce(entry, candidate.raw)
    if (coerced.ok) return { value: coerced.value, origin: candidate.origin }
    return { value: entry.default, origin: 'default', rejected: coerced.reason }
  }

  return { value: entry.default, origin: 'default' }
}

type Coerced<T> = { ok: true; value: T } | { ok: false; reason: string }

function coerce<T extends string | number | boolean>(
  entry: ConfigEntry<T>,
  raw: unknown,
): Coerced<T> {
  switch (entry.type) {
    case 'boolean': {
      if (typeof raw === 'boolean') return { ok: true, value: raw as T }
      const value = String(raw).toLowerCase()
      if (['true', '1', 'yes', 'on'].includes(value)) return { ok: true, value: true as T }
      if (['false', '0', 'no', 'off'].includes(value)) return { ok: true, value: false as T }
      return { ok: false, reason: `${entry.key}: "${String(raw)}" is not a boolean` }
    }

    case 'number':
    case 'percent': {
      const parsed = typeof raw === 'number' ? raw : Number(String(raw))
      if (!Number.isFinite(parsed)) {
        return { ok: false, reason: `${entry.key}: "${String(raw)}" is not a number` }
      }
      const min = entry.min ?? (entry.type === 'percent' ? 0 : Number.NEGATIVE_INFINITY)
      const max = entry.max ?? (entry.type === 'percent' ? 100 : Number.POSITIVE_INFINITY)
      if (parsed < min || parsed > max) {
        return { ok: false, reason: `${entry.key}: ${parsed} is outside ${min}–${max}` }
      }
      return { ok: true, value: parsed as T }
    }

    case 'enum': {
      const value = String(raw)
      if (!entry.options?.includes(value)) {
        return {
          ok: false,
          reason: `${entry.key}: "${value}" is not one of ${(entry.options ?? []).join(', ')}`,
        }
      }
      return { ok: true, value: value as T }
    }

    default:
      return { ok: true, value: String(raw) as T }
  }
}

/* ═══════════════════════════════════════════════════════════════════════════
   WEIGHT GROUPS
   ═══════════════════════════════════════════════════════════════════════════ */

export interface WeightCheck {
  ok: boolean
  total: number
  /** Named so the operator knows which set is wrong, not merely that one is. */
  keys: string[]
  message: string
}

/**
 * Weights that must sum to one hundred.
 *
 * A set that does not is a **reported configuration error**, never silently
 * rescaled — silent rescaling makes the operator's stated intent and the
 * system's behaviour diverge without anyone being told (ADR-002).
 */
export function checkWeights(values: Record<string, number>, keys: string[]): WeightCheck {
  const total = keys.reduce((sum, key) => sum + (values[key] ?? 0), 0)
  const ok = Math.abs(total - 100) < 0.01
  return {
    ok,
    total,
    keys,
    message: ok
      ? `${keys.length} weights sum to 100.`
      : `${keys.join(' + ')} sum to ${total}, not 100. Adjust them — they will not be rescaled for you.`,
  }
}

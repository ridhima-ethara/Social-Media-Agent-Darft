/**
 * WHISPER — the local transcription sidecar (ADR-011).
 *
 * A reel's actual words are the best evidence about it that exists: the caption
 * is marketing, the hashtags are reach, and the transcript is what was said.
 * This is how that becomes a row.
 *
 * WHY A SIDECAR AND NOT AN ENDPOINT. Hosted transcription bills per minute, and
 * a slider in Agent Studio must not be able to run up an invoice — that is the
 * whole reason `APIFY_MAX_ITEMS_PER_KEYWORD` exists. Running Whisper locally
 * moves the cost to wall-clock time on the machine already serving the API,
 * which is bounded by the same two ceilings and cannot arrive as a bill.
 *
 * The process-boundary-as-interface arrangement is the one `agent-tier.ts` and
 * the mflux painter already use: an interpreter path resolved from THIS
 * MODULE'S location rather than from `cwd`, an existence check before anything
 * spawns, and `isConfigured()` / `unavailableReason()` so a wrong path is a
 * stated condition rather than a `spawn ENOENT` in the middle of a run.
 *
 * BLANK IS SUPPORTED AND IS THE DEFAULT. With `WHISPER_PYTHON` unset nothing
 * spawns, `scraped_items.transcript` stays NULL, and the run says what it could
 * not transcribe. NULL means NOT TRANSCRIBED; `''` would mean the transcriber
 * ran and heard nothing. Those are different facts and nothing downstream may
 * collapse them.
 *
 * A TRANSCRIPT IS SCRAPED CONTENT. It is the words a stranger chose to say on a
 * video we found, arriving as fluent natural language — the most likely
 * prompt-injection vector in this codebase. It goes through `prepareEvidence()`
 * before any model sees it. That is enforced at the call site in
 * `caption/handlers.ts`, not here: this module's job is to produce the text
 * honestly, and treating it as untrusted is the consumer's.
 */

import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

import type { ServiceAdapter } from '../../../shared/agent-contract'
import { config } from '../config'
import { AdapterError } from './adapter'

const ADAPTER_ID = 'whisper'

/*
 * `server/src/integrations/whisper.ts` → the repo root is three levels up.
 * Derived from `import.meta.url`, which is a fact about where this code IS;
 * `process.cwd()` is a fact about how it was launched, and the two are only the
 * same by luck.
 */
const HERE = dirname(fileURLToPath(import.meta.url))
const REPO_ROOT = resolve(HERE, '..', '..', '..')

/** Absolute-ises a configured path against the repo root, never the cwd. */
function absolute(candidate: string): string {
  return isAbsolute(candidate) ? candidate : resolve(REPO_ROOT, candidate)
}

export function whisperPython(): string {
  const configured = config.whisper.python
  return configured === '' ? '' : absolute(configured)
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE INPUT AND THE OUTPUT
   ═══════════════════════════════════════════════════════════════════════════ */

export interface TranscribeInput {
  /** The media URL to fetch and transcribe. */
  url: string
  /**
   * The hard bound on ONE item, in seconds. Passed through to the sidecar so a
   * long stream is truncated there rather than read in full and discarded here.
   */
  maxSeconds: number
}

export interface TranscribeOutput {
  /**
   * The spoken words. May legitimately be `''` — a video with no speech — and
   * the caller must record that as a FINISHED transcription, not as a failure.
   * Only a thrown error means "not transcribed".
   */
  text: string
  /** The language the sidecar detected, or the one it was pinned to. */
  language: string
  /**
   * 0–1, the sidecar's own mean segment probability, or `null` when it did not
   * report one. Never defaulted: a fabricated confidence is worse than none.
   */
  confidence: number | null
  /** How much audio was actually transcribed, which is what the budget spends. */
  seconds: number
  /** Which model produced it, recorded on the row as `transcript_source`. */
  model: string
}

/* ═══════════════════════════════════════════════════════════════════════════
   THE SIDECAR SCRIPT

   Inlined rather than shipped as a file in `backend/`, because it is eleven
   lines and belongs to this adapter rather than to the Python agent tier. It
   writes exactly one JSON object to stdout so the parse below has one shape to
   handle, and it never prints progress — a progress bar interleaved with the
   payload is the classic way a sidecar becomes unparseable.
   ═══════════════════════════════════════════════════════════════════════════ */

const SCRIPT = `
import json, sys
url, model_name, language, max_seconds = sys.argv[1], sys.argv[2], sys.argv[3], float(sys.argv[4])
try:
    from faster_whisper import WhisperModel
except ImportError:
    print(json.dumps({"error": "faster-whisper is not installed in this interpreter. Install it with: <python> -m pip install faster-whisper"}))
    sys.exit(0)
try:
    model = WhisperModel(model_name, device="auto", compute_type="int8")
    kwargs = {} if language in ("", "auto") else {"language": language}
    segments, info = model.transcribe(url, vad_filter=True, **kwargs)
    parts, probs, end = [], [], 0.0
    for seg in segments:
        if seg.start > max_seconds:
            break
        parts.append(seg.text.strip())
        end = max(end, float(seg.end))
        if getattr(seg, "avg_logprob", None) is not None:
            probs.append(float(seg.avg_logprob))
    import math
    confidence = None
    if probs:
        confidence = round(min(1.0, max(0.0, math.exp(sum(probs) / len(probs)))), 4)
    print(json.dumps({
        "text": " ".join(p for p in parts if p),
        "language": getattr(info, "language", language) or "",
        "confidence": confidence,
        "seconds": round(min(end, max_seconds), 2),
        "model": model_name,
    }))
except Exception as exc:
    print(json.dumps({"error": f"{type(exc).__name__}: {exc}"}))
`

/* ═══════════════════════════════════════════════════════════════════════════
   THE ADAPTER
   ═══════════════════════════════════════════════════════════════════════════ */

export const whisperTranscribe: ServiceAdapter<TranscribeInput, TranscribeOutput> = {
  id: ADAPTER_ID,
  label: 'Whisper · local transcription',

  isConfigured(): boolean {
    const python = whisperPython()
    return python !== '' && existsSync(python)
  },

  /**
   * Why transcription cannot run, or `''` when it can.
   *
   * Names the resolved path and the command that fixes it. "spawn ENOENT" tells
   * an operator nothing; "no interpreter at <path> — create it with <command>"
   * tells them everything.
   */
  unavailableReason(): string {
    const configured = config.whisper.python
    if (configured === '') {
      return (
        'WHISPER_PYTHON is not set, so nothing is transcribed. Transcripts stay missing rather ' +
        'than empty, and nothing downstream reads a missing transcript as silence. To enable it:\n' +
        '    python3 -m venv .venv-whisper && .venv-whisper/bin/pip install faster-whisper\n' +
        '    WHISPER_PYTHON=.venv-whisper/bin/python'
      )
    }
    const python = whisperPython()
    if (!existsSync(python)) {
      return (
        `WHISPER_PYTHON points at ${python}, and there is no interpreter there. ` +
        'Correct the key, or unset it to switch transcription off entirely.'
      )
    }
    return ''
  },

  async run(input: TranscribeInput): Promise<TranscribeOutput> {
    const reason = this.unavailableReason()
    if (reason !== '') throw new AdapterError(ADAPTER_ID, reason)

    const python = whisperPython()
    const maxSeconds = Math.max(1, Math.min(input.maxSeconds, config.whisper.maxSecondsPerItem))

    const dir = await mkdtemp(join(tmpdir(), 'ethara-whisper-'))
    const scriptPath = join(dir, 'transcribe.py')

    try {
      await writeScript(scriptPath)

      const raw = await runPython(python, [
        scriptPath,
        input.url,
        config.whisper.model,
        config.whisper.language,
        String(maxSeconds),
      ])

      let parsed: Record<string, unknown>
      try {
        // The last non-empty line, because a Python warning on stdout ahead of
        // the payload would otherwise make a working run unparseable.
        const lines = raw.split('\n').filter((l) => l.trim() !== '')
        parsed = JSON.parse(lines[lines.length - 1] ?? '{}') as Record<string, unknown>
      } catch {
        throw new AdapterError(
          ADAPTER_ID,
          `The transcriber did not return JSON. It said: ${raw.slice(0, 300)}`,
        )
      }

      if (typeof parsed.error === 'string') {
        throw new AdapterError(ADAPTER_ID, parsed.error)
      }

      return {
        text: typeof parsed.text === 'string' ? parsed.text : '',
        language: typeof parsed.language === 'string' ? parsed.language : '',
        // Absent stays absent. A transcript with no reported probability is a
        // transcript whose confidence is unknown, not one that scored zero.
        confidence: typeof parsed.confidence === 'number' ? parsed.confidence : null,
        seconds: typeof parsed.seconds === 'number' ? parsed.seconds : 0,
        model: typeof parsed.model === 'string' ? parsed.model : config.whisper.model,
      }
    } finally {
      await rm(dir, { recursive: true, force: true }).catch(() => {})
    }
  },
}

async function writeScript(path: string): Promise<void> {
  const { writeFile } = await import('node:fs/promises')
  await writeFile(path, SCRIPT, 'utf8')
}

/**
 * Spawns the interpreter and returns stdout.
 *
 * The timeout kills the child rather than merely rejecting: an abandoned
 * Whisper process holds the model in memory and keeps decoding, so a caller
 * that gave up would still be paying for it.
 */
function runPython(python: string, args: string[]): Promise<string> {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(python, args, { cwd: REPO_ROOT })

    let stdout = ''
    let stderr = ''
    let settled = false

    const timer = setTimeout(() => {
      if (settled) return
      settled = true
      child.kill('SIGKILL')
      reject(
        new AdapterError(
          ADAPTER_ID,
          `Transcription exceeded ${config.whisper.timeoutMs}ms and was stopped. Raise WHISPER_TIMEOUT_MS, or use a smaller WHISPER_MODEL.`,
        ),
      )
    }, config.whisper.timeoutMs)

    child.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString()
    })
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      reject(new AdapterError(ADAPTER_ID, `Could not start the transcriber — ${error.message}`))
    })

    child.on('close', (code) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (code !== 0 && stdout.trim() === '') {
        reject(
          new AdapterError(
            ADAPTER_ID,
            `The transcriber exited ${code ?? 'unknown'} — ${stderr.trim().slice(0, 300) || 'no output'}`,
          ),
        )
        return
      }
      resolvePromise(stdout)
    })
  })
}

/** For `/api/health` and the boot banner: where the sidecar resolved to. */
export function describeWhisper(): string {
  const reason = whisperTranscribe.unavailableReason()
  if (reason !== '') return reason
  return `${whisperPython()} · ${config.whisper.model} · ceiling ${config.whisper.maxMinutesPerRun} min/run`
}

/**
 * The minutes one run may spend, after the deployment ceiling has been applied.
 *
 * Returns both numbers rather than only the answer, because "your slider stopped
 * mattering" is a thing an operator has to be able to see. The handler logs it
 * when `clamped` is true.
 */
export function transcriptionBudget(requestedMinutes: number): {
  minutes: number
  ceiling: number
  clamped: boolean
} {
  const ceiling = config.whisper.maxMinutesPerRun
  const minutes = Math.max(0, Math.min(requestedMinutes, ceiling))
  return { minutes, ceiling, clamped: requestedMinutes > ceiling }
}

// Files are read back in one place, so a future change to how the sidecar
// returns its payload (a file rather than stdout) has one call site.
export async function readIfPresent(path: string): Promise<string | null> {
  if (!existsSync(path)) return null
  return readFile(path, 'utf8')
}

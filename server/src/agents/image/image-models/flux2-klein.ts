/**
 * FLUX.2 KLEIN — the local background painter.
 *
 * Same contract as every other painter: background pixels only, never brand
 * text (rule 12). The brand layer is composited over the result as vectors by
 * `renderCreative`.
 *
 * TWO TRANSPORTS, ONE MODEL
 *
 * Ollama has the weights and reports `capabilities: ["image"]` for
 * `x/flux2-klein:9b`, but as of 0.33.3 its HTTP API refuses image models
 * outright — `/api/generate`, `/api/chat` and `ollama run` all answer
 * `image generation models are not currently supported`. Image generation is
 * still a GUI-only experiment, which is no use to a server pipeline.
 *
 * So this painter tries Ollama first and falls through to mflux, the MLX port
 * of the same model, invoked as a subprocess. That is transport selection, not
 * the silent model substitution `index.ts` forbids: an operator who asked for
 * FLUX.2 Klein gets FLUX.2 Klein either way, and the transport that served is
 * recorded. When Ollama ships REST support the first branch simply starts
 * winning, with no change here.
 *
 * WHY A SUBPROCESS. mflux is a Python library, not a service. Standing up an
 * HTTP wrapper around it would add a process to supervise for no gain, so the
 * painter spawns `mflux-generate-flux2` and reads the PNG it writes — the same
 * process-boundary-as-interface arrangement used by the agent bridge and the
 * crawl4ai adapter.
 */

import { spawn } from 'node:child_process'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'

import { config } from '../../../config'
import { AdapterError } from '../../../integrations/adapter'
import { ollamaImage } from '../../../integrations/ollama'
import type { BackgroundPainter, RenderRequest } from './types'

const ADAPTER_ID = 'flux2-klein'

/**
 * Rule 12 says no diffusion model is ever asked to render brand text.
 *
 * The two transports state that differently because they accept different
 * things: the Ollama adapter passes a negative prompt (see `ollama.ts`), while
 * FLUX.2 through mflux explicitly refuses one — `mflux-generate-flux2` rejects
 * `--negative-prompt` and tells you to describe what you want instead. So the
 * exclusion is written into the positive prompt here, which both transports
 * share. Compositing the brand layer locally is the real enforcement either way.
 */
function buildPrompt(request: RenderRequest): string {
  return [
    'Abstract technical background artwork.',
    'Deep near-black ground, violet and purple accents, editorial and restrained.',
    'Generous negative space on the left third.',
    // Stated positively: FLUX.2 takes no negative prompt, so "empty of text" has
    // to be part of the description of what is wanted.
    'A completely clean surface, empty of any text, lettering, numerals, logos or watermarks.',
    'No people.',
    request.backgroundPrompt,
  ].join(' ')
}

/** Diffusion models want dimensions on a 16px grid; MLX is happier on 64. */
function snap(value: number): number {
  return Math.max(256, Math.round(value / 64) * 64)
}

/**
 * Runs `mflux-generate-flux2` and returns the PNG it wrote, base64-encoded.
 *
 * The interpreter path comes from `MFLUX_PYTHON` and the CLI is resolved as its
 * sibling in the same venv `bin/`, so one env var configures the whole thing
 * and there is no way to point at a Python that lacks the tool.
 */
async function paintWithMflux(
  request: RenderRequest,
  seed: number,
): Promise<{ base64: string; mimeType: string }> {
  const binDir = dirname(config.mflux.python)
  const cli = join(binDir, 'mflux-generate-flux2')

  const dir = await mkdtemp(join(tmpdir(), 'ethara-flux-'))
  const outPath = join(dir, 'background.png')

  const args = [
    '--model',
    config.mflux.model,
    '--quantize',
    String(config.mflux.quantize),
    '--steps',
    String(config.mflux.steps),
    '--seed',
    String(seed),
    '--height',
    String(snap(request.height)),
    '--width',
    String(snap(request.width)),
    '--prompt',
    buildPrompt(request),
    // No `--negative-prompt`: FLUX.2 does not accept one, and passing it makes
    // mflux exit 2 before it renders anything.
    // Metadata would sit beside the PNG and never be read; the artefact's
    // provenance is recorded on the media_asset row instead.
    '--no-metadata',
    '--output',
    outPath,
  ]

  try {
    await new Promise<void>((resolve, reject) => {
      const child = spawn(cli, args, {
        env: {
          ...process.env,
          // Weights are fetched once and cached; the fast transfer path is
          // worth having on the first run.
          HF_HUB_ENABLE_HF_TRANSFER: '1',
        },
      })

      let errBuffer = ''
      let settled = false

      const timer = setTimeout(() => {
        settled = true
        child.kill('SIGKILL')
        reject(
          new AdapterError(
            ADAPTER_ID,
            `mflux exceeded ${config.mflux.timeoutMs}ms — the first run also downloads weights, which can take a while`,
          ),
        )
      }, config.mflux.timeoutMs)

      const collect = (chunk: Buffer): void => {
        if (errBuffer.length < 8_000) errBuffer += chunk.toString()
      }
      child.stderr.on('data', collect)
      // mflux prints its progress bar to stdout; kept for the failure message.
      child.stdout.on('data', collect)

      child.on('error', (error) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        reject(
          new AdapterError(
            ADAPTER_ID,
            `could not start mflux (${cli}) — ${error.message}`,
          ),
        )
      })

      child.on('close', (code) => {
        clearTimeout(timer)
        if (settled) return
        settled = true
        if (code === 0) {
          resolve()
          return
        }

        const tail = errBuffer.slice(-400).replace(/\s+/g, ' ').trim()
        // The single most common first-run failure, named so the operator does
        // not have to read a Python traceback to find out what to do.
        if (/GatedRepoError|gated repo|401 Client Error/i.test(errBuffer)) {
          reject(
            new AdapterError(
              ADAPTER_ID,
              `the weights for "${config.mflux.model}" are gated on Hugging Face — accept the licence and set HF_TOKEN, or use the Apache-2.0 flux2-klein-4b`,
              undefined,
              tail || undefined,
            ),
          )
          return
        }

        reject(
          new AdapterError(ADAPTER_ID, `mflux exited ${code}`, undefined, tail || undefined),
        )
      })
    })

    const png = await readFile(outPath)
    if (png.length === 0) {
      throw new AdapterError(ADAPTER_ID, 'mflux wrote an empty image')
    }

    return { base64: png.toString('base64'), mimeType: 'image/png' }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}

/**
 * A stable seed per brief, so the same headline renders the same background
 * twice. Replayability is a property the whole pipeline depends on, and a
 * random seed would quietly remove it for images alone.
 */
function seedFor(request: RenderRequest): number {
  if (config.mflux.seed >= 0) return config.mflux.seed
  let hash = 2166136261
  const source = `${request.headline}|${request.concept}|${request.platform}`
  for (let i = 0; i < source.length; i += 1) {
    hash ^= source.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return Math.abs(hash % 2_147_483_647)
}

export const flux2KleinPainter: BackgroundPainter = {
  id: 'flux2-klein',

  isConfigured(): boolean {
    return ollamaImage.isConfigured() || config.mflux.configured
  },

  unavailableReason(): string {
    return 'neither OLLAMA_BASE_URL nor MFLUX_PYTHON is set, so FLUX.2 Klein has no transport'
  },

  async paint(request: RenderRequest): Promise<{ base64: string; mimeType: string }> {
    if (!this.isConfigured()) {
      throw new AdapterError(ADAPTER_ID, this.unavailableReason())
    }

    const failures: string[] = []

    // Transport 1 — Ollama. Preferred: the weights are already there and no
    // second runtime is involved. Currently refused by the daemon; the attempt
    // is cheap and self-correcting once that changes.
    if (ollamaImage.isConfigured()) {
      try {
        return await ollamaImage.run({
          prompt: buildPrompt(request),
          width: snap(request.width),
          height: snap(request.height),
          timeoutMs: request.timeoutMs || config.ollama.imageTimeoutMs,
        })
      } catch (error) {
        failures.push(
          error instanceof AdapterError ? error.message : `Ollama transport failed — ${String(error)}`,
        )
      }
    }

    // Transport 2 — mflux on MLX. The same model, a different runtime.
    if (config.mflux.configured) {
      try {
        return await paintWithMflux(request, seedFor(request))
      } catch (error) {
        failures.push(
          error instanceof AdapterError
            ? error.toReason()
            : `mflux transport failed — ${String(error)}`,
        )
      }
    }

    // Both transports named, so the operator sees why each one declined rather
    // than a single collapsed "unavailable".
    throw new AdapterError(
      ADAPTER_ID,
      `no FLUX.2 Klein transport succeeded — ${failures.join('; ')}`,
    )
  },
}

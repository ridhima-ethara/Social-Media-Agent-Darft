/**
 * FLUX.2 KLEIN — the local background painter.
 *
 * Same contract as every other painter: background pixels only, never brand
 * text (invariant 21). The brand layer is composited over the result as vectors by
 * `renderCreative`.
 *
 * ONE TRANSPORT: mflux, the MLX port of the model, invoked as a subprocess.
 * (An earlier version also tried Ollama's HTTP API first, but Ollama has been
 * removed from the product; mflux was always the transport that actually
 * painted, since Ollama's REST API refuses image models.)
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
import type { BackgroundPainter, RenderRequest } from './types'

const ADAPTER_ID = 'flux2-klein'

/**
 * Invariant 21 says no diffusion model is ever asked to render brand text.
 *
 * FLUX.2 through mflux refuses a negative prompt — `mflux-generate-flux2`
 * rejects `--negative-prompt` and tells you to describe what you want instead —
 * so the exclusion is written into the positive prompt here. Compositing the
 * brand layer locally is the real enforcement either way.
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
    return config.mflux.configured
  },

  unavailableReason(): string {
    return 'MFLUX_PYTHON is not set, so FLUX.2 Klein has no transport'
  },

  async paint(request: RenderRequest): Promise<{ base64: string; mimeType: string }> {
    if (!this.isConfigured()) {
      throw new AdapterError(ADAPTER_ID, this.unavailableReason())
    }

    // mflux on MLX is the only transport. It spawns `mflux-generate-flux2` and
    // reads the PNG it writes.
    try {
      return await paintWithMflux(request, seedFor(request))
    } catch (error) {
      throw new AdapterError(
        ADAPTER_ID,
        `FLUX.2 Klein could not paint — ${
          error instanceof AdapterError ? error.toReason() : String(error)
        }`,
      )
    }
  },
}

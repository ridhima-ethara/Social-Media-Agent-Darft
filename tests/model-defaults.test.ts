/**
 * MODEL TAGS AGREE ACROSS THE TWO TIERS.
 *
 * `shared/text-models.ts` and `shared/image-models.ts` are canonical;
 * `backend/core/models.py` mirrors them because Python cannot import TypeScript.
 * A mirror kept honest by a comment is not kept honest, so this reads both files
 * off disk and compares the strings.
 *
 * The failure this prevents is specific and was live: `config.ts` defaulted the
 * text model to `qwen3:14b` while `server/.env.example` shipped `qwen3.5:latest`,
 * and the tag the code named was not installed on the machine at all. A default
 * only applies when the key is absent — the fresh-machine case — so the error
 * surfaced from inside a run rather than at configuration time.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const read = (relative: string): string => readFileSync(join(ROOT, relative), 'utf8')

/** `export const NAME = 'value'` out of a TypeScript source file. */
function tsConst(body: string, name: string): string | undefined {
  return new RegExp(`export const ${name}\\s*=\\s*'([^']*)'`).exec(body)?.[1]
}

/** `NAME = "value"` out of a Python source file. */
function pyConst(body: string, name: string): string | undefined {
  return new RegExp(`^${name}\\s*=\\s*"([^"]*)"`, 'm').exec(body)?.[1]
}

/** Every tag that exists on both sides, and which file declares it in TS. */
const MIRRORED = [
  { name: 'DEFAULT_OLLAMA_TEXT_MODEL', ts: 'shared/text-models.ts' },
  { name: 'DEFAULT_ANTHROPIC_MODEL', ts: 'shared/text-models.ts' },
  { name: 'DEFAULT_EMBEDDING_MODEL', ts: 'shared/text-models.ts' },
  { name: 'DEFAULT_OLLAMA_IMAGE_MODEL', ts: 'shared/image-models.ts' },
  { name: 'DEFAULT_MFLUX_MODEL', ts: 'shared/image-models.ts' },
] as const

describe('model tags have one home across both tiers', () => {
  const python = read('backend/core/models.py')

  for (const { name, ts } of MIRRORED) {
    it(`${name} is identical in ${ts} and backend/core/models.py`, () => {
      const tsValue = tsConst(read(ts), name)
      const pyValue = pyConst(python, name)

      expect(tsValue, `${name} is not declared in ${ts}`).toBeDefined()
      expect(pyValue, `${name} is not declared in backend/core/models.py`).toBeDefined()
      expect(pyValue).toBe(tsValue)
    })
  }
})

describe('config.ts reads the shared declarations rather than restating them', () => {
  const configSource = read('server/src/config.ts')

  const KEYS = [
    'OLLAMA_TEXT_MODEL',
    'OLLAMA_IMAGE_MODEL',
    'GCP_TEXT_MODEL',
    'GCP_IMAGE_MODEL',
    'MFLUX_MODEL',
    'EMBEDDING_MODEL',
  ] as const

  for (const key of KEYS) {
    it(`${key}'s fallback is a shared constant, not a literal`, () => {
      const match = new RegExp(`str\\('${key}',\\s*([^)]+)\\)`).exec(configSource)
      expect(match?.[1], `${key} is not read in config.ts`).toBeDefined()
      const fallback = (match?.[1] ?? '').trim()
      expect(
        fallback,
        `config.ts states a literal fallback for ${key}. That is a second home for the tag — ` +
          'import the constant from shared/text-models.ts or shared/image-models.ts instead.',
      ).not.toMatch(/^['"]/)
      expect(fallback).toMatch(/^DEFAULT_/)
    })
  }
})

describe('the Python tier reads its declarations rather than restating them', () => {
  it('llm.py takes its model tags from core/models.py', () => {
    const llm = read('backend/core/llm.py')
    expect(llm).toContain('from .models import')
    expect(llm).toMatch(/resolved\("OLLAMA_TEXT_MODEL",\s*DEFAULT_OLLAMA_TEXT_MODEL\)/)
    expect(llm).toMatch(/resolved\("ANTHROPIC_MODEL",\s*DEFAULT_ANTHROPIC_MODEL\)/)
  })

  it('painter.py takes its model tags from core/models.py', () => {
    const painter = read('backend/tools/painter.py')
    expect(painter).toContain('from core.models import')
    expect(painter).toMatch(/resolved\("OLLAMA_IMAGE_MODEL",\s*DEFAULT_OLLAMA_IMAGE_MODEL\)/)
    expect(painter).toMatch(/resolved\("MFLUX_MODEL",\s*DEFAULT_MFLUX_MODEL\)/)
  })
})

describe('server/.env.example ships the tags the code defaults to', () => {
  const example = read('server/.env.example')
  const text = read('shared/text-models.ts')
  const image = read('shared/image-models.ts')

  const envValue = (key: string): string | undefined => {
    const match = new RegExp(`^\\s*${key}\\s*=\\s*(.*?)\\s*$`, 'm').exec(example)
    return match ? (match[1] ?? '').replace(/\s+#.*$/, '').trim() : undefined
  }

  it('OLLAMA_TEXT_MODEL matches the declared default', () => {
    expect(envValue('OLLAMA_TEXT_MODEL')).toBe(tsConst(text, 'DEFAULT_OLLAMA_TEXT_MODEL'))
  })

  it('OLLAMA_IMAGE_MODEL matches the declared default', () => {
    expect(envValue('OLLAMA_IMAGE_MODEL')).toBe(tsConst(image, 'DEFAULT_OLLAMA_IMAGE_MODEL'))
  })

  it('MFLUX_MODEL matches the declared default', () => {
    expect(envValue('MFLUX_MODEL')).toBe(tsConst(image, 'DEFAULT_MFLUX_MODEL'))
  })
})

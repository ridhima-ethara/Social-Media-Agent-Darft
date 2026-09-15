/**
 * THE TEST HARNESS
 *
 * Separate from `vite.config.ts` on purpose: that file configures the app
 * bundle, and the two have different resolution needs — tests import from
 * `server/` and `shared/`, which the app never does.
 *
 * `pool: 'forks'` because several tests mutate `process.env` to exercise
 * `config.ts`'s lazy readers. Threads share an environment; forks do not, so a
 * test that sets `PORT` cannot leak into one asserting the default.
 */

import { defineConfig } from 'vitest/config'
import { fileURLToPath, URL } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
    pool: 'forks',
    // Isolated so `process.env` mutations cannot cross files.
    isolate: true,
    reporters: ['default'],
  },
})

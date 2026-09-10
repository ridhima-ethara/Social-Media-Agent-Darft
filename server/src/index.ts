/**
 * BOOT
 *
 * assertDb → register skills → auditSkillCoverage → auditToolCoverage → cron → listen
 *
 * The audits run before the server accepts a request. A critical skill or a
 * declared tool without a handler stops the boot with a specific message, because
 * starting and producing quietly wrong output would be worse than not starting.
 */

import express from 'express'

import { REGISTRY_SUMMARY } from '../../shared/agent-registry'
import { TOOL_SUMMARY } from '../../shared/tool-registry'
import { config, describeConfiguration } from './config'
import { assertDb, closePool } from './db/pool'
import { describeDrift, findSchemaDrift } from './db/schema-drift'
import { createApiRouter } from './api'
import { auditSkillCoverage } from './agents/skills/_register'
import { auditToolCoverage } from './assistant/tools/index'
import { scheduledJobs, startScheduler, stopScheduler } from './scheduler'

const DIM = '\u001B[2m'
const BOLD = '\u001B[1m'
const RESET = '\u001B[0m'
const GREEN = '\u001B[32m'
const RED = '\u001B[31m'

async function main(): Promise<void> {
  console.log(`\n${BOLD}Ethara SocialAI · API${RESET}`)

  /* ── 1 · The database must be reachable ────────────────────────────────── */
  // Silently serving fabricated data would be worse than failing loudly.
  await assertDb()

  /*
   * The same standard the database check holds itself to: refuse to start
   * rather than serve requests that will fail later. A missing column surfaces
   * here, in milliseconds and naming its fix, instead of from inside a crawl
   * that has already spent three minutes of network time.
   */
  const drift = await findSchemaDrift()
  if (drift.length > 0) {
    console.error(`\n  ${describeDrift(drift)}\n`)
    process.exit(1)
  }

  /* ── 2 · Coverage audits ───────────────────────────────────────────────── */
  const skills = auditSkillCoverage()
  console.log(
    `  ${GREEN}✓${RESET} skills   ${skills.registered}/${skills.total} handlers registered` +
      (skills.missingOptional.length > 0
        ? ` ${DIM}(${skills.missingOptional.length} optional skill(s) will record as skipped)${RESET}`
        : ''),
  )

  const tools = auditToolCoverage()
  console.log(`  ${GREEN}✓${RESET} tools    ${tools.total}/${tools.total} handlers registered`)
  console.log(
    `  ${GREEN}✓${RESET} registry ${REGISTRY_SUMMARY.agents} agents · ${REGISTRY_SUMMARY.skills} skills · ${REGISTRY_SUMMARY.knobs} knobs · ${TOOL_SUMMARY.tools} tools`,
  )

  /* ── 3 · Configuration, stated out loud ────────────────────────────────── */
  for (const line of describeConfiguration()) {
    console.log(`  ${DIM}·${RESET} ${line}`)
  }

  /* ── 4 · The app ───────────────────────────────────────────────────────── */
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '12mb' }))

  app.use((req, res, next) => {
    res.setHeader('Access-Control-Allow-Origin', config.core.corsOrigin)
    res.setHeader('Access-Control-Allow-Headers', 'content-type')
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PATCH,DELETE,OPTIONS')
    if (req.method === 'OPTIONS') {
      res.sendStatus(204)
      return
    }
    next()
  })

  app.use('/api', createApiRouter())

  app.get('/', (_req, res) => {
    res.json({
      name: 'Ethara SocialAI API',
      health: '/api/health',
      state: '/api/state',
      events: '/api/events',
    })
  })

  app.use((_req, res) => {
    res.status(404).json({ error: 'No such route. Every route lives under /api.' })
  })

  /* ── 5 · Cron ──────────────────────────────────────────────────────────── */
  startScheduler()
  for (const job of scheduledJobs()) {
    console.log(`  ${DIM}·${RESET} cron ${job.id} — ${job.schedule} (${job.timezone})`)
  }

  /* ── 6 · Listen ────────────────────────────────────────────────────────── */
  const server = app.listen(config.core.port, () => {
    console.log(
      `\n  ${GREEN}${BOLD}API listening${RESET} on ${BOLD}http://localhost:${config.core.port}${RESET}`,
    )
    console.log(`  ${DIM}health${RESET} http://localhost:${config.core.port}/api/health`)
    console.log(`  ${DIM}events${RESET} http://localhost:${config.core.port}/api/events\n`)
  })

  const shutdown = (signal: string) => {
    console.log(`\n${DIM}${signal} — shutting down${RESET}`)
    stopScheduler()
    server.close(() => {
      void closePool().then(() => process.exit(0))
    })
    // Never hang on a stuck connection.
    setTimeout(() => process.exit(0), 4000).unref()
  }

  process.on('SIGINT', () => shutdown('SIGINT'))
  process.on('SIGTERM', () => shutdown('SIGTERM'))
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error)
  console.error(`\n${RED}${BOLD}The API did not start.${RESET}\n`)
  console.error(message)
  console.error('')
  process.exit(1)
})

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
import { currentWorkspaceId, sweepOrphanedRuns } from './db/repo'
import { describeDrift, findSchemaDrift } from './db/schema-drift'
import { createApiRouter } from './api'
import { writeCalendarBacklog } from './orchestrator'
import { auditSkillCoverage } from './agents/skills/_register'
import { auditToolCoverage } from './assistant/tools/index'
import { describeWhisper, whisperTranscribe } from './integrations/whisper'
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

  /* ── 1b · Runs this process cannot possibly be running (R1.1) ──────────── */
  /*
   * The orchestrator is sequential and in-process, and the scheduler is
   * node-cron. A deploy, an OOM or a crashed sidecar mid-run leaves
   * `pipeline_runs` with a row stuck at `running` forever: the console shows a
   * phantom in-flight run, "is anything running" stops being answerable, and
   * the Apify credit that run spent bought nothing anybody can see.
   *
   * Safe by construction: nothing in THIS process can be running at the moment
   * this process starts, so every `running` row found here is from a previous
   * life. It is marked failed with a stated reason and is never deleted.
   */
  const orphans = await sweepOrphanedRuns()
  if (orphans.pipelineRuns > 0 || orphans.agentRuns > 0 || orphans.agents > 0) {
    console.log(
      `  ${GREEN}✓${RESET} recovery ${orphans.pipelineRuns} pipeline run(s), ${orphans.agentRuns} agent run(s) ` +
        `and ${orphans.agents} agent state(s) were left mid-flight by a previous process and have been ` +
        `marked failed with the reason recorded`,
    )
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
  /*
   * R7: the boot sweep already refuses to start on an unreachable database,
   * schema drift, a missing critical handler or an unhandled tool. A new
   * adapter joins it here rather than being discovered from a failed run.
   * Whisper is reported, never required — blank is a supported configuration
   * and the run simply says what it could not transcribe.
   */
  const whisperReason = whisperTranscribe.unavailableReason()
  console.log(
    whisperReason === ''
      ? `  ${GREEN}✓${RESET} whisper  ${describeWhisper()}`
      : `  ${DIM}·${RESET} whisper  off — ${whisperReason.split('\n')[0]}`,
  )

  for (const line of describeConfiguration()) {
    console.log(`  ${DIM}·${RESET} ${line}`)
  }

  /* ── 4 · The app ───────────────────────────────────────────────────────── */
  const app = express()

  app.disable('x-powered-by')
  app.use(express.json({ limit: '12mb' }))

  app.use((req, res, next) => {
    /*
     * CREDENTIALED CORS CANNOT USE `*`.
     *
     * The browser refuses `Access-Control-Allow-Credentials: true` alongside a
     * wildcard origin, and the session is a cookie — so a wildcard here would
     * silently break sign-in from any cross-origin caller. With `CORS_ORIGIN=*`
     * configured, the request's own Origin is echoed back instead, which is
     * equivalent in reach and actually works with cookies. Set CORS_ORIGIN to a
     * specific origin for a deployment; the wildcard is a development
     * convenience, and `Vary: Origin` keeps caches from mixing the two.
     */
    const configured = config.core.corsOrigin
    const origin = configured === '*' ? req.headers.origin : configured
    if (origin !== undefined && origin !== '') {
      res.setHeader('Access-Control-Allow-Origin', origin)
      res.setHeader('Access-Control-Allow-Credentials', 'true')
      res.setHeader('Vary', 'Origin')
    }
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

    /*
     * FINISH WHAT A PREVIOUS PROCESS LEFT UNWRITTEN.
     *
     * A run cut off during its write stage leaves this week's posts with no
     * caption ("No caption yet") or a caption with no creative, until the next
     * full run. They are finished now, in the background, under the same knobs
     * the pipeline uses — only the weeks it writes, only what is missing, and
     * nothing at all when auto-writing is off. Never blocks serving; a failure
     * is reported per post.
     */
    void (async () => {
      try {
        const workspaceId = await currentWorkspaceId()
        const { written, writeFailed } = await writeCalendarBacklog({ workspaceId, trigger: 'api' })
        if (written > 0 || writeFailed > 0) {
          console.log(
            `  ${GREEN}✓${RESET} backlog  ${written} unwritten calendar post(s) written` +
              (writeFailed > 0 ? ` · ${writeFailed} could not be written` : ''),
          )
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        console.error(`  ${RED}✗${RESET} backlog  could not write the calendar backlog — ${message}`)
      }
    })()
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

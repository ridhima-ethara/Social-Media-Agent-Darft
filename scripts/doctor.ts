#!/usr/bin/env tsx
/**
 * `npm run doctor` — the preflight diagnostic.
 *
 * One command that answers "why won't this run?" BEFORE anything is started.
 *
 * Every check is read-only. It opens no stream, writes no row, spawns nothing
 * that mutates, and it never repairs anything: a diagnostic that fixes things is
 * a diagnostic you cannot trust to describe the state you were actually in.
 *
 * Every failure states the KEY and the COMMAND that fixes it — the standard
 * `server/src/index.ts` already sets when it refuses to boot. "Cannot connect to
 * PostgreSQL" is not actionable; naming `DATABASE_URL`, the resolved target and
 * `npm run db:reset` is.
 *
 * Exit 0 when nothing blocks a run, 1 when something does. A degraded
 * integration is NOT a failure — the product is designed to run with an empty
 * `.env` — so an absent Apify token reports as a stated degradation and does not
 * fail the command. Only things that stop the product working do.
 */

import { execFileSync } from 'node:child_process'
import { createServer } from 'node:net'
import { join } from 'node:path'

import { allIndexedActorIds } from '../server/src/services/scraping/actor-index'
import {
  actorInputSchema,
  cliAuthenticated,
  cliInstalled,
} from '../server/src/services/scraping/apify-cli'

const RESET = '\u001B[0m'
const RED = '\u001B[31m'
const YELLOW = '\u001B[33m'
const GREEN = '\u001B[32m'
const DIM = '\u001B[2m'
const BOLD = '\u001B[1m'

let blockers = 0
let degradations = 0

function section(title: string): void {
  console.log(`\n${BOLD}${title}${RESET}`)
}

/** Everything is fine. */
function ok(what: string, detail = ''): void {
  console.log(`  ${GREEN}✓${RESET} ${what}${detail ? ` ${DIM}${detail}${RESET}` : ''}`)
}

/** Working, but on a lesser path. Reported, never counted as a failure. */
function degraded(what: string, why: string): void {
  degradations += 1
  console.log(`  ${YELLOW}·${RESET} ${what}\n      ${DIM}${why}${RESET}`)
}

/** Stops the product working. Must name the key and the command that fixes it. */
function blocked(what: string, why: string, fix: string): void {
  blockers += 1
  console.log(`  ${RED}✗${RESET} ${BOLD}${what}${RESET}\n      ${why}\n      ${DIM}fix:${RESET} ${fix}`)
}

/** Is a TCP port already taken? */
async function portInUse(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer()
    server.once('error', (error: NodeJS.ErrnoException) => {
      resolve(error.code === 'EADDRINUSE')
    })
    server.once('listening', () => server.close(() => resolve(false)))
    server.listen(port, '127.0.0.1')
  })
}

async function main(): Promise<void> {
  console.log(`\n${BOLD}Ethara SocialAI · doctor${RESET}`)
  console.log(`${DIM}read-only preflight — nothing here changes anything${RESET}`)

  // Imported inside main so a failure to LOAD config is itself reportable.
  const { config, loadedEnvFiles, redactUrl } = await import('../server/src/config')

  /* ── 1 · CONFIGURATION ──────────────────────────────────────────────────── */
  section('Configuration')

  if (loadedEnvFiles.length > 0) {
    ok(`env files loaded`, `${loadedEnvFiles.join(' · ')} (from server/)`)
  } else {
    degraded(
      'no env file was found',
      'Reading from the shell environment only. The product runs with an empty ' +
        'environment by design, so this is not an error — but nothing is configured. ' +
        'Copy server/.env.example to server/.env to change that.',
    )
  }

  ok('workspace', config.core.workspaceSlug)
  ok('publish mode', config.core.publishMode)
  ok('timezone', config.core.tz)

  /* ── 2 · POSTGRES ───────────────────────────────────────────────────────── */
  section('PostgreSQL')

  const { closePool, databaseReachable, query } = await import('../server/src/db/pool')
  let dbUp = false

  try {
    dbUp = await databaseReachable()
  } catch {
    dbUp = false
  }

  if (!dbUp) {
    blocked(
      'PostgreSQL is not reachable',
      `DATABASE_URL points at ${redactUrl(config.core.databaseUrl)} and nothing answered.`,
      'docker compose up -d db && npm run db:reset\n            ' +
        'or, on Homebrew: brew services start postgresql@17 && npm run db:reset\n            ' +
        'if the role or database is missing: createuser -s ethara && createdb -O ethara ethara_socialai',
    )
  } else {
    ok('reachable', redactUrl(config.core.databaseUrl))

    // pgvector — the schema declares vector(768) columns and cannot apply without it.
    const [ext] = await query<{ installed: string | null }>(
      `SELECT installed_version AS installed FROM pg_available_extensions WHERE name = 'vector'`,
    )
    if (ext === undefined) {
      blocked(
        'the pgvector extension is not available on this server',
        'schema.sql declares vector(768) columns for semantic retrieval, so it cannot be applied.',
        'brew install pgvector && brew services restart postgresql@17\n            ' +
          'or use the pgvector/pgvector:pg17 image instead of postgres:17-alpine',
      )
    } else if (ext.installed === null) {
      degraded(
        'pgvector is available but not yet installed in this database',
        'npm run db:migrate creates it — this resolves on the next migrate.',
      )
    } else {
      ok('pgvector', `${ext.installed}`)
    }

    // Schema drift — the check that turns a mid-run column error into a preflight one.
    const { describeDrift, findSchemaDrift } = await import('../server/src/db/schema-drift')
    const drift = await findSchemaDrift()
    if (drift.length > 0) {
      blocked(
        'the database no longer matches schema.sql',
        describeDrift(drift).split('\n').slice(2, 6).join('\n      '),
        'npm --prefix server run db:migrate -- --fresh && npm run db:seed',
      )
    } else {
      ok('schema matches schema.sql', 'every declared column present')
    }

    // Has the seed run? Emptiness is judged on WORK, matching needs-seed.ts.
    const [counts] = await query<{ ideas: string; captures: string; knowledge: string }>(
      `SELECT
         (SELECT count(*)::text FROM content_ideas)     AS ideas,
         (SELECT count(*)::text FROM scraped_items)     AS captures,
         (SELECT count(*)::text FROM knowledge_entries) AS knowledge`,
    )
    const knowledge = Number(counts?.knowledge ?? 0)
    if (knowledge === 0) {
      blocked(
        'the database has no knowledge entries, so the seed has not run',
        'The brand rules and corpus are what the Scraping Agent scores against; without ' +
          'them a discovery run has nothing to judge relevance by.',
        'npm run db:seed',
      )
    } else {
      ok(
        'seeded',
        `${knowledge} knowledge · ${counts?.ideas ?? 0} ideas · ${counts?.captures ?? 0} captures`,
      )
    }

    // Embedding coverage — configured but unembedded still retrieves lexically.
    const { embeddingCoverage } = await import('../server/src/db/repo')
    for (const row of await embeddingCoverage()) {
      if (row.total === 0) continue
      if (row.embedded === row.total) {
        ok(`${row.table} embedded`, `${row.embedded}/${row.total} · ${row.models.join(', ')}`)
      } else {
        degraded(
          `${row.table} is only ${row.embedded}/${row.total} embedded`,
          'Those rows retrieve lexically only. Run `npm run db:embed` to close the gap.',
        )
      }
    }
  }

  /* ── 3 · THE PYTHON AGENT TIER ──────────────────────────────────────────── */
  section('Python agent tier')

  const agentTier = await import('../server/src/integrations/agent-tier')

  if (!agentTier.isConfigured()) {
    // A degradation, not a blocker: the Node orchestrator is a complete pipeline
    // on its own. Only the eight-agent "Run agents" path needs this.
    degraded('the agent tier cannot run', agentTier.unavailableReason())
  } else {
    ok('interpreter', agentTier.describeAgentTier())

    // Does it actually IMPORT? An interpreter that exists but cannot load the
    // roster fails at spawn time, which is exactly what this command exists to
    // pull forward.
    try {
      const out = execFileSync(
        agentTier.agentPython(),
        ['-c', 'import sys; sys.path.insert(0, "backend"); from agents import ROSTER; print(len(ROSTER))'],
        { cwd: agentTier.agentCwd(), encoding: 'utf8', timeout: 30_000, stdio: ['ignore', 'pipe', 'pipe'] },
      )
      ok('roster imports', `${out.trim()} agents`)
    } catch (error) {
      const detail =
        error instanceof Error && 'stderr' in error
          ? String((error as { stderr: string }).stderr).trim().split('\n').slice(-2).join(' ')
          : error instanceof Error
            ? error.message
            : String(error)
      blocked(
        'the agent tier interpreter exists but cannot import its roster',
        detail,
        `${agentTier.agentPython()} -m pip install -r ${join(agentTier.backendRoot(), 'requirements.txt')}`,
      )
    }
  }

  /* ── 4 · MODELS ─────────────────────────────────────────────────────────── */
  section('Models')

  if (!config.ollama.configured) {
    degraded(
      'Ollama is not configured',
      'OLLAMA_BASE_URL is not set. Captions, calendar copy and analytics prose come from ' +
        'the deterministic template writer, and retrieval is lexical only.',
    )
  } else {
    let pulled: string[] | null = null
    try {
      const response = await fetch(`${config.ollama.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(4000),
      })
      const body = (await response.json()) as { models?: Array<{ name: string }> }
      pulled = (body.models ?? []).map((m) => m.name)
    } catch {
      pulled = null
    }

    if (pulled === null) {
      blocked(
        'OLLAMA_BASE_URL is set but no daemon answered',
        `Nothing responded at ${config.ollama.baseUrl}.`,
        'ollama serve   (or unset OLLAMA_BASE_URL to use the deterministic writer)',
      )
    } else {
      ok('daemon', `${config.ollama.baseUrl} · ${pulled.length} model(s)`)

      /** A configured tag counts as present if it or its `:latest` form is pulled. */
      const has = (tag: string): boolean =>
        pulled.includes(tag) || pulled.includes(`${tag}:latest`)

      const wanted: Array<{ key: string; tag: string; blocking: boolean; pull: string }> = [
        { key: 'OLLAMA_TEXT_MODEL', tag: config.ollama.textModel, blocking: true, pull: config.ollama.textModel.split(':')[0] as string },
        { key: 'OLLAMA_IMAGE_MODEL', tag: config.ollama.imageModel, blocking: false, pull: config.ollama.imageModel.split(':')[0] as string },
      ]
      if (config.embeddings.enabled) {
        wanted.push({
          key: 'EMBEDDING_MODEL',
          tag: config.embeddings.model,
          blocking: false,
          pull: config.embeddings.model,
        })
      }

      for (const model of wanted) {
        if (has(model.tag)) {
          ok(`${model.key}`, model.tag)
        } else if (model.blocking) {
          blocked(
            `${model.key} names a model that is not pulled`,
            `${model.key}=${model.tag}, and \`ollama list\` does not have it. ` +
              'Generation would fail per call rather than degrade cleanly.',
            `ollama pull ${model.pull}`,
          )
        } else {
          degraded(
            `${model.key}=${model.tag} is not pulled`,
            `That path falls back with a stated reason. \`ollama pull ${model.pull}\` enables it.`,
          )
        }
      }
    }
  }

  if (config.gcp.configured) ok('GCP credential', 'present — the hosted chain link is available')
  else degraded('no GCP credential', 'The text chain is one link; a failure goes to the template writer.')

  /* ── 5 · CAPTURE ────────────────────────────────────────────────────────── */
  section('Capture')

  if (!config.apify.configured && !config.parallel.configured) {
    blocked(
      'no capture source is configured',
      'Neither APIFY_API_TOKEN nor PARALLEL_API_KEY is set, so a discovery run captures ' +
        'nothing at all — there is no fixture behind either lane.',
      'set APIFY_API_TOKEN for the four platform lanes, and PARALLEL_API_KEY for the open web',
    )
  } else {
    if (config.apify.configured) {
      ok('Apify', 'the four platform lanes read the platforms themselves, with engagement')
    } else {
      /*
       * No longer a degradation — it is a lane that does not run.
       *
       * This used to report the lanes falling back to the crawler, which made a
       * volume-only score sound like a lesser version of the same measurement.
       * With no fallback the honest report is that the platform lanes produce
       * nothing, and the open web is all that remains.
       */
      blocked(
        'no Apify token — the four platform lanes cannot run',
        'APIFY_API_TOKEN is not set. The platform lanes read LinkedIn, Instagram, X and ' +
          'Facebook directly, and nothing else can state a reaction count, so no substitute ' +
          'is attempted. Without it a run captures the open web only, and the trend score ' +
          'has no engagement, velocity or growth to compute.',
        'put APIFY_API_TOKEN in server/secrets.env (gitignored). Apify console → Settings → ' +
          'API & Integrations → Personal API tokens',
      )
    }

    /*
     * ═══ THE APIFY SKILL / CLI PATH (§20) ═══
     *
     * Four states, reported distinctly, because the fixes are different and a
     * single "unavailable" would send an operator to the wrong one. Nothing
     * below reports success it has not actually observed: the CLI is asked for
     * its version, asked who it is logged in as, and asked to resolve a real
     * actor id. Execution is deliberately NOT attempted — it bills per result,
     * and a doctor command must not be able to spend money.
     */
    if (!cliInstalled()) {
      degraded(
        'Apify CLI NOT CONFIGURED — the official skill workflow cannot run',
        'apify-cli is not in node_modules. The HTTP client still serves the platform lanes, ' +
          'so capture is unaffected; only the skill-driven actor selection and live schema ' +
          'discovery are unavailable. Fix: npm i -D apify-cli',
      )
    } else {
      const authed = await cliAuthenticated()
      if (!authed) {
        degraded(
          'Apify CLI UNAVAILABLE — installed but holding no credentials',
          'The CLI does not read APIFY_TOKEN from the environment; it authenticates from a ' +
            'stored credential. Until it is logged in, capture falls back to the HTTP client. ' +
            'Fix: npx apify login -t $APIFY_API_TOKEN, or set APIFY_API_TOKEN and the server ' +
            'establishes the login itself at first use.',
        )
      } else {
        // Resolve one indexed actor for real, so "AVAILABLE" means the chain
        // actually answered rather than that a binary exists on disk.
        const probe = allIndexedActorIds()[0] ?? 'apify/instagram-hashtag-scraper'
        try {
          const schema = await actorInputSchema(probe, 8_000)
          const fields = Object.keys(schema.properties ?? {}).length
          ok(
            'Apify CLI AVAILABLE',
            `logged in, and \`actors info --input\` resolved ${probe} with ${fields} input field(s)`,
          )
        } catch (error) {
          degraded(
            'Apify CLI FAILED — logged in, but actor discovery did not answer',
            `Resolving ${probe} failed: ${error instanceof Error ? error.message.slice(0, 160) : String(error)}. ` +
              'Fix: check network access to api.apify.com, then re-run doctor.',
          )
        }
      }
    }

    if (config.parallel.configured) {
      ok('Parallel', 'the open-web lane reads cited pages, which state no engagement')
    } else {
      degraded(
        'no PARALLEL_API_KEY — the open-web lane cannot run',
        'The four platform lanes are unaffected. Research for the Knowledge Base also ' +
          'depends on this key, and without it a build finds nothing citable rather than ' +
          'substituting a weaker source.',
      )
    }
  }

  /* ── 6 · PORTS ──────────────────────────────────────────────────────────── */
  section('Ports')

  const apiPort = config.core.port
  if (await portInUse(apiPort)) {
    degraded(
      `port ${apiPort} is already in use`,
      'Something is listening there. If it is this API, it is already running; if it is ' +
        'another project, set PORT in server/.env to move this one.',
    )
  } else {
    ok(`port ${apiPort} is free`, 'the API can bind')
  }

  if (await portInUse(5173)) {
    degraded('port 5173 is already in use', 'Vite will pick the next free port and print it.')
  } else {
    ok('port 5173 is free', 'the web app can bind')
  }

  await closePool().catch(() => undefined)

  /* ── RESULT ─────────────────────────────────────────────────────────────── */
  console.log('')
  const degradedNote =
    degradations === 0
      ? ''
      : ` ${degradations} stated degradation(s) — the product runs, on a lesser path.`

  if (blockers === 0) {
    console.log(`${GREEN}${BOLD}doctor: nothing is blocking a run.${RESET}${degradedNote}\n`)
  } else {
    console.log(
      `${RED}${BOLD}doctor: ${blockers} blocker(s).${RESET}${degradedNote}\n` +
        `${DIM}Fix the ✗ items above; each names its key and its command.${RESET}\n`,
    )
    process.exit(1)
  }
}

main().catch(async (error: unknown) => {
  console.error(`\n${RED}${BOLD}doctor could not complete.${RESET}`)
  console.error(error instanceof Error ? error.message : String(error))
  console.error('')
  process.exit(1)
})

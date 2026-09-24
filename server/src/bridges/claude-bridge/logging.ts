/**
 * OBSERVABILITY — one structured record per execution.
 *
 * Written as a single JSON line to STDERR (stdout belongs to the MCP protocol
 * when the bridge runs as a Claude Code tool), and appended to
 * `LINKEDIN_TRENDS_LOG_FILE` when that is set.
 *
 * What is never logged: credentials, tokens, cookies, session data, the
 * environment, or post bodies. Error strings pass through `redact()` first.
 */

import { appendFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { redact } from './adapters/claude-cli'
import { logFilePath } from './config'
import type { AdapterReport, SourceStatus } from './schemas/trend-output'

export interface ExecutionLog {
  event: 'claude_bridge.execution'
  execution_id: string
  platform: string
  mode: string
  started_at: string
  completed_at: string
  duration_ms: number
  queries_generated: number
  queries_executed: number
  candidates_found: number
  duplicates_removed: number
  stale_results_removed: number
  final_results: number
  source_status: SourceStatus | 'configuration_error'
  adapters: Array<Pick<AdapterReport, 'adapter' | 'status' | 'queries_executed' | 'candidates'>>
  errors: string[]
}

export type LogSink = (line: string) => void

export const stderrSink: LogSink = (line) => {
  process.stderr.write(`${line}\n`)
}

export function writeExecutionLog(log: ExecutionLog, sink: LogSink | null | undefined = stderrSink): void {
  const target = sink === undefined ? stderrSink : sink
  const safe: ExecutionLog = { ...log, errors: log.errors.map(redact) }
  const line = JSON.stringify(safe)
  target?.(line)
  const file = logFilePath()
  if (file) {
    try {
      mkdirSync(dirname(file), { recursive: true })
      appendFileSync(file, `${line}\n`)
    } catch {
      // A log file that cannot be written must not fail the call it describes.
    }
  }
}

/**
 * CLAUDE CODE, HEADLESS — the process boundary the `claude_code` adapter uses.
 *
 * The bridge starts `claude -p` with exactly one tool available (WebSearch by
 * default), asks it to run a list of search queries, and reads the
 * stream-json event log it prints. What the bridge keeps is the RAW SEARCH
 * RESULTS — the `{ title, url }` pairs inside each WebSearch tool result —
 * never Claude's prose. A URL is therefore only ever reported if a search
 * engine returned it, which is what makes a hallucinated post URL impossible
 * to pass through.
 *
 * WEBFETCH. A session may instead be given WebFetch, restricted by permission
 * rules to named domains (`WebFetch(domain:example.com)`). What is kept is the
 * tool result itself (the fetched URL, its HTTP status and the text the fetch
 * returned), never Claude's prose.
 *
 * ISOLATION. The child runs in an empty working directory, with no setting
 * sources and `--strict-mcp-config`, so it cannot load this repository's
 * CLAUDE.md, its hooks, or its MCP servers (which include this bridge — a
 * recursion). It gets no file or shell tool: it cannot read the machine, and a
 * fetch can reach only the domains its permission rules name.
 *
 * CREDENTIALS. The child authenticates exactly as the operator's own Claude
 * Code does. The bridge never reads, stores or logs a credential; the
 * environment is passed through untouched and never echoed.
 */

import { spawn } from 'node:child_process'
import { existsSync, mkdirSync, readdirSync, statSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'

export interface SearchLink {
  title: string
  url: string
}

export interface ExecutedSearch {
  /** The query exactly as the WebSearch tool executed it. */
  query: string
  links: SearchLink[]
}

/** One WebFetch call as the tool returned it. */
export interface ExecutedFetch {
  url: string
  /** HTTP status the fetch reported, when it reported one. */
  code: number | null
  /** The text the WebFetch tool returned for the page. */
  text: string
}

export interface ClaudeSessionResult {
  searches: ExecutedSearch[]
  /** Claude's final reply. Never a source of URLs on its own — see the claude_code adapter. */
  resultText: string | null
  /** WebFetch calls, when the session was allowed WebFetch. */
  fetches: ExecutedFetch[]
  /** Final result subtype from the CLI, e.g. `success` or `error_max_budget_usd`. */
  subtype: string | null
  costUsd: number | null
  durationMs: number | null
  isError: boolean
  /** Human-readable problem, with anything credential-shaped redacted. */
  errorMessage: string | null
}

export interface ClaudeSessionOptions {
  bin: string
  prompt: string
  systemPrompt: string
  model: string
  allowedTools: readonly string[]
  /**
   * Permission rules that pre-approve the tools, e.g. `WebFetch(domain:a.com)`.
   * Default: `allowedTools` itself (any use of each tool is approved). A tool
   * use no rule approves is refused — headless, nobody can approve it.
   */
  permissionRules?: readonly string[]
  maxBudgetUsd: number
  timeoutMs: number
}

/* ═══════════════════════════════════════════════════════════════════════════
   FINDING THE BINARY
   ═══════════════════════════════════════════════════════════════════════════ */

function executable(path: string): boolean {
  try {
    return statSync(path).isFile()
  } catch {
    return false
  }
}

function onPath(name: string): string | null {
  for (const dir of (process.env.PATH ?? '').split(delimiter)) {
    if (dir === '') continue
    const candidate = join(dir, name)
    if (executable(candidate)) return candidate
  }
  return null
}

/** The newest Claude Code binary bundled with a VS Code (remote) extension install, if any. */
function extensionBinary(): string | null {
  for (const root of [join(homedir(), '.vscode-server', 'extensions'), join(homedir(), '.vscode', 'extensions')]) {
    if (!existsSync(root)) continue
    let dirs: string[]
    try {
      dirs = readdirSync(root).filter((d) => d.startsWith('anthropic.claude-code-'))
    } catch {
      continue
    }
    const versioned = dirs
      .map((d) => ({ d, v: (d.match(/claude-code-(\d+)\.(\d+)\.(\d+)/) ?? []).slice(1).map(Number) }))
      .filter((x) => x.v.length === 3)
      .sort((a, b) => b.v[0]! - a.v[0]! || b.v[1]! - a.v[1]! || b.v[2]! - a.v[2]!)
    for (const { d } of versioned) {
      const candidate = join(root, d, 'resources', 'native-binary', 'claude')
      if (executable(candidate)) return candidate
    }
  }
  return null
}

/**
 * Where the Claude Code CLI is, in order: `CLAUDE_CODE_BIN`, `claude` on PATH,
 * the standard local install, then a VS Code extension's bundled binary.
 * `null` when none exists — the adapter then reports itself unavailable.
 */
export function resolveClaudeBinary(): { path: string | null; tried: string } {
  const explicit = process.env.CLAUDE_CODE_BIN?.split('#')[0]?.trim()
  if (explicit) {
    return executable(explicit)
      ? { path: explicit, tried: 'CLAUDE_CODE_BIN' }
      : { path: null, tried: `CLAUDE_CODE_BIN=${explicit} (not an executable file)` }
  }
  const found =
    onPath('claude') ??
    (executable(join(homedir(), '.claude', 'local', 'claude')) ? join(homedir(), '.claude', 'local', 'claude') : null) ??
    extensionBinary()
  return { path: found, tried: 'CLAUDE_CODE_BIN, PATH, ~/.claude/local, VS Code extension' }
}

/* ═══════════════════════════════════════════════════════════════════════════
   REDACTION
   ═══════════════════════════════════════════════════════════════════════════ */

/** Strips anything credential-shaped from a message before it is logged or returned. */
export function redact(text: string): string {
  return text
    .replace(/sk-ant-[A-Za-z0-9_-]+/g, '«redacted»')
    .replace(/(authorization|x-api-key|api[_-]?key|token|cookie)(["'\s:=]+)[^\s"',}]+/gi, '$1$2«redacted»')
    .replace(/Bearer\s+[A-Za-z0-9._-]+/gi, 'Bearer «redacted»')
}

/* ═══════════════════════════════════════════════════════════════════════════
   READING THE EVENT STREAM
   ═══════════════════════════════════════════════════════════════════════════ */

interface Loose {
  [key: string]: unknown
}

function isRecord(v: unknown): v is Loose {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

function linksFrom(value: unknown, out: SearchLink[]): void {
  if (Array.isArray(value)) {
    for (const v of value) linksFrom(v, out)
    return
  }
  if (!isRecord(value)) return
  if (typeof value.url === 'string') {
    out.push({ url: value.url, title: typeof value.title === 'string' ? value.title : '' })
    return
  }
  if (Array.isArray(value.content)) linksFrom(value.content, out)
}

/**
 * Pulls every executed search out of a stream-json log.
 *
 * Reads the structured `tool_use_result` the CLI attaches to each WebSearch
 * result. Its `results` array mixes `{ tool_use_id, content: [{title,url}] }`
 * blocks with the tool's own summary strings; only the structured link blocks
 * are read, so the summary text can never contribute a URL.
 */
export function parseStreamJson(stdout: string): Omit<ClaudeSessionResult, 'errorMessage'> & {
  resultText: string | null
} {
  const searches: ExecutedSearch[] = []
  const fetches: ExecutedFetch[] = []
  let subtype: string | null = null
  let costUsd: number | null = null
  let durationMs: number | null = null
  let isError = false
  let resultText: string | null = null

  for (const line of stdout.split('\n')) {
    const trimmed = line.trim()
    if (trimmed === '' || !trimmed.startsWith('{')) continue
    let event: unknown
    try {
      event = JSON.parse(trimmed)
    } catch {
      continue
    }
    if (!isRecord(event)) continue

    if (event.type === 'user' && isRecord(event.tool_use_result)) {
      const tur = event.tool_use_result
      if (typeof tur.query === 'string' && Array.isArray(tur.results)) {
        const links: SearchLink[] = []
        for (const block of tur.results) if (isRecord(block)) linksFrom(block.content, links)
        searches.push({ query: tur.query, links })
      }
      // A WebFetch result: `{ url, code, codeText, result, bytes, durationMs }`.
      if (typeof tur.url === 'string' && typeof tur.result === 'string') {
        fetches.push({ url: tur.url, code: typeof tur.code === 'number' ? tur.code : null, text: tur.result })
      }
    }

    if (event.type === 'result') {
      subtype = typeof event.subtype === 'string' ? event.subtype : null
      costUsd = typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null
      durationMs = typeof event.duration_ms === 'number' ? event.duration_ms : null
      isError = event.is_error === true
      resultText = typeof event.result === 'string' ? event.result : null
    }
  }

  return { searches, fetches, subtype, costUsd, durationMs, isError, resultText }
}

/* ═══════════════════════════════════════════════════════════════════════════
   RUNNING A SESSION
   ═══════════════════════════════════════════════════════════════════════════ */

/** An empty directory the child runs in, so it loads no project context. */
function isolatedCwd(): string {
  const dir = join(tmpdir(), 'sma-claude-bridge')
  mkdirSync(dir, { recursive: true })
  return dir
}

/**
 * Runs one headless Claude Code session and returns the searches it executed.
 *
 * Resolves rather than rejects on a CLI-level failure, carrying the reason, so
 * the adapter can decide whether the failure is fatal (auth, budget) or
 * specific to this batch.
 */
export function runClaudeSession(opts: ClaudeSessionOptions): Promise<ClaudeSessionResult> {
  const args = [
    '-p',
    opts.prompt,
    '--output-format',
    'stream-json',
    '--verbose',
    '--model',
    opts.model,
    '--tools',
    ...opts.allowedTools,
    '--allowedTools',
    ...(opts.permissionRules ?? opts.allowedTools),
    '--append-system-prompt',
    opts.systemPrompt,
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-budget-usd',
    String(opts.maxBudgetUsd),
  ]

  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false

    const child = spawn(opts.bin, args, {
      cwd: isolatedCwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: process.env,
    })

    const finish = (result: ClaudeSessionResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(result)
    }

    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      const parsed = parseStreamJson(stdout)
      finish({
        ...parsed,
        isError: true,
        errorMessage: `Claude Code did not finish within ${opts.timeoutMs} ms`,
      })
    }, opts.timeoutMs)

    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      // Bounded: only the tail is ever reported.
      stderr = (stderr + chunk).slice(-4000)
    })

    child.on('error', (error) => {
      finish({
        searches: [],
        resultText: null,
        fetches: [],
        subtype: null,
        costUsd: null,
        durationMs: null,
        isError: true,
        errorMessage: redact(`Could not start Claude Code (${opts.bin}): ${error.message}`),
      })
    })

    child.on('close', (code) => {
      const parsed = parseStreamJson(stdout)
      const failed = code !== 0 || parsed.isError
      const said = [parsed.subtype && parsed.subtype !== 'success' ? parsed.subtype : '', parsed.isError ? (parsed.resultText ?? '') : '', stderr.trim()]
        .filter((s) => s !== '')
        .join(' — ')
        .slice(0, 600)
      finish({
        searches: parsed.searches,
        resultText: parsed.resultText,
        fetches: parsed.fetches,
        subtype: parsed.subtype,
        costUsd: parsed.costUsd,
        durationMs: parsed.durationMs,
        isError: failed,
        errorMessage: failed ? redact(`Claude Code exited ${code ?? '?'}${said ? `: ${said}` : ''}`) : null,
      })
    })
  })
}

/* ═══════════════════════════════════════════════════════════════════════════
   A TEXT-ONLY SESSION — no tools at all
   ═══════════════════════════════════════════════════════════════════════════ */

export interface ClaudeTextOptions {
  bin: string
  prompt: string
  systemPrompt: string
  model: string
  maxBudgetUsd: number
  timeoutMs: number
}

export interface ClaudeTextResult {
  text: string | null
  costUsd: number | null
  isError: boolean
  errorMessage: string | null
}

/**
 * One headless Claude Code call that may use NO tool — it reads the prompt and
 * answers. Used where Claude analyses text it is handed (comment sentiment,
 * listener insights) and must not reach anything else. Same isolation as the
 * search sessions: empty cwd, no MCP, no settings, no session persistence.
 */
export function runClaudeText(opts: ClaudeTextOptions): Promise<ClaudeTextResult> {
  const args = [
    '-p',
    opts.prompt,
    '--output-format',
    'json',
    '--model',
    opts.model,
    '--tools',
    '',
    '--append-system-prompt',
    opts.systemPrompt,
    '--strict-mcp-config',
    '--setting-sources',
    '',
    '--disable-slash-commands',
    '--no-session-persistence',
    '--max-budget-usd',
    String(opts.maxBudgetUsd),
  ]
  return new Promise((resolve) => {
    let stdout = ''
    let stderr = ''
    let settled = false
    const child = spawn(opts.bin, args, { cwd: isolatedCwd(), stdio: ['ignore', 'pipe', 'pipe'], env: process.env })
    const finish = (r: ClaudeTextResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolve(r)
    }
    const timer = setTimeout(() => {
      child.kill('SIGTERM')
      finish({ text: null, costUsd: null, isError: true, errorMessage: `Claude did not finish within ${opts.timeoutMs} ms` })
    }, opts.timeoutMs)
    child.stdout.setEncoding('utf8')
    child.stderr.setEncoding('utf8')
    child.stdout.on('data', (chunk: string) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk: string) => {
      stderr = (stderr + chunk).slice(-4000)
    })
    child.on('error', (error) => {
      finish({ text: null, costUsd: null, isError: true, errorMessage: redact(`Could not start Claude Code (${opts.bin}): ${error.message}`) })
    })
    child.on('close', (code) => {
      let event: unknown = null
      try {
        event = JSON.parse(stdout.trim())
      } catch {
        event = null
      }
      const result = isRecord(event) && typeof event.result === 'string' ? event.result : null
      const cost = isRecord(event) && typeof event.total_cost_usd === 'number' ? event.total_cost_usd : null
      const failed = code !== 0 || (isRecord(event) && event.is_error === true) || result === null
      finish({
        text: result,
        costUsd: cost,
        isError: failed,
        errorMessage: failed ? redact(`Claude exited ${code ?? '?'}: ${(result ?? stderr.trim()).slice(0, 400)}`) : null,
      })
    })
  })
}

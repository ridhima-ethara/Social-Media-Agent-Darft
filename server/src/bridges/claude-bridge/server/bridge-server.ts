/**
 * THE CLAUDE BRIDGE AS A CLAUDE CODE TOOL — a stdio MCP server.
 *
 * Registered in the repository's `.mcp.json` as `claude-bridge`, so Claude Code
 * opened in this project can call `linkedin_trend_intelligence` directly.
 *
 * A minimal JSON-RPC 2.0 implementation of the MCP stdio transport
 * (newline-delimited messages): `initialize`, `tools/list`, `tools/call`,
 * `ping`. Written out rather than pulled in as a dependency because the
 * surface is four methods, and the server tier keeps its dependency list short.
 *
 * STDOUT IS THE PROTOCOL. Every `console.*` call is redirected to stderr before
 * any other module loads, because a single stray log line on stdout would
 * corrupt the stream. Structured execution logs go to stderr too.
 */

const toStderr = (...args: unknown[]): void => {
  process.stderr.write(`${args.map((a) => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ')}\n`)
}
console.log = toStderr
console.info = toStderr
console.warn = toStderr
console.debug = toStderr

const SUPPORTED_PROTOCOL_VERSIONS = ['2025-06-18', '2025-03-26', '2024-11-05']
const SERVER_INFO = { name: 'claude-bridge', version: '1.0.0' }

type JsonRpcId = string | number | null

interface JsonRpcRequest {
  jsonrpc: '2.0'
  id?: JsonRpcId
  method: string
  params?: Record<string, unknown>
}

function send(message: Record<string, unknown>): void {
  process.stdout.write(`${JSON.stringify(message)}\n`)
}

function reply(id: JsonRpcId, result: unknown): void {
  send({ jsonrpc: '2.0', id, result })
}

function fail(id: JsonRpcId, code: number, message: string): void {
  send({ jsonrpc: '2.0', id, error: { code, message } })
}

async function main(): Promise<void> {
  // Loaded after the console redirect so nothing they log at import reaches stdout.
  const tools = await import('../tools/linkedin-trend-intelligence')
  const { closePool } = await import('../../../db/pool')

  const toolList = [
    { name: tools.TREND_TOOL_NAME, description: tools.TREND_TOOL_DESCRIPTION, inputSchema: tools.TREND_TOOL_INPUT_SCHEMA },
    { name: tools.SOCIAL_TOOL_NAME, description: tools.TREND_TOOL_DESCRIPTION, inputSchema: tools.TREND_TOOL_INPUT_SCHEMA },
    { name: tools.CONTEXT_TOOL_NAME, description: tools.CONTEXT_TOOL_DESCRIPTION, inputSchema: tools.CONTEXT_TOOL_INPUT_SCHEMA },
    { name: tools.PLATFORM_TRENDS_TOOL_NAME, description: tools.PLATFORM_TRENDS_TOOL_DESCRIPTION, inputSchema: tools.PLATFORM_TRENDS_INPUT_SCHEMA },
  ]

  async function handle(msg: JsonRpcRequest): Promise<void> {
    const id = msg.id ?? null
    const isNotification = msg.id === undefined

    switch (msg.method) {
      case 'initialize': {
        const requested = typeof msg.params?.protocolVersion === 'string' ? msg.params.protocolVersion : ''
        reply(id, {
          protocolVersion: SUPPORTED_PROTOCOL_VERSIONS.includes(requested) ? requested : SUPPORTED_PROTOCOL_VERSIONS[0],
          capabilities: { tools: { listChanged: false } },
          serverInfo: SERVER_INFO,
          instructions:
            'Trend intelligence for the Ethara SMA across LinkedIn, Instagram, X, Facebook and the open web. Call ' +
            'linkedin_trend_intelligence with no arguments for the latest brand-relevant LinkedIn trends, or ' +
            'social_trend_intelligence with `platform` for another lane; results are newest first. Present verified ' +
            'source data, bridge analysis and your own interpretation as separate, labelled layers.',
        })
        return
      }
      case 'notifications/initialized':
      case 'notifications/cancelled':
        return
      case 'ping':
        reply(id, {})
        return
      case 'tools/list':
        reply(id, { tools: toolList })
        return
      case 'tools/call': {
        const name = msg.params?.name
        const args = msg.params?.arguments ?? {}
        try {
          const result =
            name === tools.TREND_TOOL_NAME || name === tools.SOCIAL_TOOL_NAME
              ? await tools.callTrendTool(args)
              : name === tools.CONTEXT_TOOL_NAME
                ? await tools.callContextTool(args)
                : name === tools.PLATFORM_TRENDS_TOOL_NAME
                  ? await tools.callPlatformTrendsTool(args)
                  : null
          if (result === null) {
            fail(id, -32602, `Unknown tool: ${String(name)}`)
            return
          }
          // Text only: the JSON is already inside it, and sending it twice
          // (as structuredContent too) would double what counts against
          // Claude Code's tool-output budget.
          reply(id, { content: [{ type: 'text', text: result.text }], isError: result.isError })
        } catch (error) {
          reply(id, {
            content: [{ type: 'text', text: `The bridge failed: ${error instanceof Error ? error.message : String(error)}` }],
            isError: true,
          })
        }
        return
      }
      default:
        if (!isNotification) fail(id, -32601, `Method not found: ${msg.method}`)
    }
  }

  let buffer = ''
  const pending = new Set<Promise<void>>()

  process.stdin.setEncoding('utf8')
  process.stdin.on('data', (chunk: string) => {
    buffer += chunk
    let newline = buffer.indexOf('\n')
    while (newline !== -1) {
      const line = buffer.slice(0, newline).trim()
      buffer = buffer.slice(newline + 1)
      newline = buffer.indexOf('\n')
      if (line === '') continue
      let msg: JsonRpcRequest
      try {
        msg = JSON.parse(line) as JsonRpcRequest
      } catch {
        fail(null, -32700, 'Parse error')
        continue
      }
      const task = handle(msg).catch((error: unknown) => {
        if (msg.id !== undefined) fail(msg.id ?? null, -32603, error instanceof Error ? error.message : String(error))
      })
      pending.add(task)
      void task.finally(() => pending.delete(task))
    }
  })

  process.stdin.on('end', () => {
    void Promise.allSettled(pending).then(async () => {
      await closePool().catch(() => undefined)
      process.exit(0)
    })
  })
}

void main()

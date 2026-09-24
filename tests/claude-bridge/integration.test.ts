/**
 * The bridge as the rest of the product sees it: the Scraping Agent's lane
 * routing, and the MCP server Claude Code launches.
 */

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { captureFor } from '../../server/src/integrations/capture'

const ROOT = join(__dirname, '..', '..')

describe('every Scraping Agent lane is the Claude Bridge — no Apify, no Parallel', () => {
  it('routes all four platforms and the open web to the bridge', () => {
    for (const platform of ['linkedin', 'instagram', 'x', 'facebook'] as const) {
      expect(captureFor(platform).id).toBe(`claude-bridge.${platform}`)
    }
    expect(captureFor(undefined).id).toBe('claude-bridge.web')
  })

  it('skips the Facebook lane in capture, with the reason, because its posts cannot be dated', () => {
    const lane = captureFor('facebook')
    expect(lane.isConfigured()).toBe(false)
    expect(lane.unavailableReason()).toMatch(/carry no date/)
  })

  it('imports neither Apify nor Parallel anywhere in the Scraping Agent', () => {
    for (const file of ['server/src/agents/scraping/handlers.ts', 'server/src/integrations/capture.ts']) {
      const src = readFileSync(join(ROOT, file), 'utf8')
      expect(src).not.toMatch(/from ['"][^'"]*(apify|parallel)[^'"]*['"]/)
      expect(src).not.toMatch(/apifySearch|explainApifyFailure|actorLabelFor|config\.apify|parallelResearch|config\.parallel/)
    }
    const python = readFileSync(join(ROOT, 'backend/tools/sources.py'), 'utf8')
    expect(python).not.toMatch(/import crawl4ai|from \.crawl import|hn\.algolia|_crawl\(/)
    expect(python).toMatch(/claude-bridge/)
  })
})

interface RpcResponse {
  id: number
  result?: Record<string, unknown>
  error?: { message: string }
}

function mcpSession(messages: object[]): Promise<RpcResponse[]> {
  return new Promise((resolve, reject) => {
    const child = spawn(join(ROOT, 'node_modules', '.bin', 'tsx'), ['server/src/bridges/claude-bridge/server/bridge-server.ts'], {
      cwd: ROOT,
      stdio: ['pipe', 'pipe', 'pipe'],
    })
    let out = ''
    child.stdout.on('data', (c: Buffer) => {
      out += c.toString()
    })
    child.on('error', reject)
    child.on('close', () => {
      try {
        resolve(
          out
            .split('\n')
            .filter((l) => l.trim() !== '')
            .map((l) => JSON.parse(l) as RpcResponse),
        )
      } catch (error) {
        reject(new Error(`stdout was not pure JSON-RPC: ${out.slice(0, 300)} (${String(error)})`))
      }
    })
    for (const m of messages) child.stdin.write(`${JSON.stringify(m)}\n`)
    child.stdin.end()
  })
}

describe('the MCP server Claude Code launches', () => {
  it('speaks MCP over stdio and keeps stdout clean', async () => {
    const responses = await mcpSession([
      { jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'test', version: '0' } } },
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { jsonrpc: '2.0', id: 2, method: 'tools/list' },
      { jsonrpc: '2.0', id: 3, method: 'tools/call', params: { name: 'linkedin_trend_intelligence', arguments: { max_results: 0 } } },
      { jsonrpc: '2.0', id: 4, method: 'no/such/method' },
    ])
    const byId = new Map(responses.map((r) => [r.id, r]))

    expect(byId.get(1)?.result).toMatchObject({ protocolVersion: '2025-06-18', serverInfo: { name: 'claude-bridge' } })
    const tools = (byId.get(2)?.result?.tools ?? []) as Array<{ name: string; inputSchema: { type: string } }>
    expect(tools.map((t) => t.name).sort()).toEqual(['linkedin_trend_context', 'linkedin_trend_intelligence', 'platform_trend_discovery', 'social_trend_intelligence'])
    expect(tools.every((t) => t.inputSchema.type === 'object')).toBe(true)
    expect(byId.get(3)?.result).toMatchObject({ isError: true })
    expect(byId.get(4)?.error?.message).toMatch(/Method not found/)
  }, 60_000)
})

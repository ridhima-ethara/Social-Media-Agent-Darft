/**
 * The anti-fabrication guarantee of the live adapter: only URLs that appear in
 * a WebSearch TOOL RESULT are ever used — never anything Claude writes.
 */

import { describe, expect, it } from 'vitest'
import { parseStreamJson, redact } from '../../server/src/bridges/claude-bridge/adapters/claude-cli'
import { scopedQuery } from '../../server/src/bridges/claude-bridge/adapters/claude-code'
import { linkedin } from '../../server/src/bridges/claude-bridge/platforms/linkedin'

const realPost = 'https://www.linkedin.com/posts/sample_ai-agent-evaluation-activity-7446814100447346688-zt70'
const invented = 'https://www.linkedin.com/posts/invented_made-up-activity-7500000000000000000-zzzz'

const stream = [
  { type: 'system', subtype: 'init', tools: ['WebSearch'] },
  { type: 'assistant', message: { content: [{ type: 'tool_use', name: 'WebSearch', input: { query: 'site:linkedin.com/posts "AI agent evaluation"' } }] } },
  {
    type: 'user',
    message: { content: [{ type: 'tool_result', content: `Links: [{"url":"${invented}"}] (summary text mentioning a URL)` }] },
    tool_use_result: {
      query: 'site:linkedin.com/posts "AI agent evaluation"',
      results: [
        { tool_use_id: 'srvtoolu_1', content: [{ title: '5 main AI agent evaluation dimensions', url: realPost }, { title: 'IBM', url: 'https://www.ibm.com/x' }] },
        `I found results, including ${invented}`,
      ],
    },
  },
  { type: 'assistant', message: { content: [{ type: 'text', text: `[{"url":"${invented}"}]` }] } },
  { type: 'result', subtype: 'success', is_error: false, total_cost_usd: 0.05, duration_ms: 9000, result: `DONE ${invented}` },
]
  .map((e) => JSON.stringify(e))
  .join('\n')

describe('Claude Code acquisition', () => {
  it('harvests only the structured search results — never tool summaries or model prose', () => {
    const parsed = parseStreamJson(stream)
    expect(parsed.searches).toHaveLength(1)
    const urls = parsed.searches[0]!.links.map((l) => l.url)
    expect(urls).toEqual([realPost, 'https://www.ibm.com/x'])
    expect(urls).not.toContain(invented)
    expect(parsed.subtype).toBe('success')
    expect(parsed.costUsd).toBe(0.05)
  })

  it('tolerates garbage lines and reports errors', () => {
    const parsed = parseStreamJson(`not json\n{"type":"result","subtype":"error_max_budget_usd","is_error":true}\n`)
    expect(parsed.searches).toEqual([])
    expect(parsed.isError).toBe(true)
  })

  it('scopes queries to the platform’s post URLs', () => {
    expect(scopedQuery(linkedin, '"RLVR"')).toBe('site:linkedin.com/posts "RLVR"')
  })

  it('redacts anything credential-shaped', () => {
    expect(redact('token=abc123 x-api-key: sk-ant-api03-XYZ Bearer eyJhbGci')).not.toMatch(/abc123|sk-ant-api03-XYZ|eyJhbGci/)
  })
})

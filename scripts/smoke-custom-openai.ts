/** 本地协议冒烟：真实 SDK 子进程 → 本地桥接 → 模拟中转站 → Bash 工具 → 续接。不会请求真实模型。 */
import { query } from '@anthropic-ai/claude-agent-sdk'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createOpenAIBridge } from '../apps/electron/src/main/lib/openai-bridge.ts'
import type { OpenAIRequest } from '../packages/core/src/providers/openai-compat.ts'

const cwd = mkdtempSync(join(tmpdir(), 'asci-sdk-bridge-'))
let toolResultSeen = false
let requests = 0
const bridge = await createOpenAIBridge({ baseUrl: 'https://relay.invalid', apiKey: 'smoke-only', fetchFn: async (_url, init) => {
  requests++
  const body = JSON.parse(String(init?.body)) as OpenAIRequest
  const hasResult = body.messages.some(m => m.role === 'tool' && String(m.content).includes('ASCI_BRIDGE_OK'))
  toolResultSeen ||= hasResult
  const calls = hasResult ? undefined : [{ index: 0, id: 'call_smoke', type: 'function', function: { name: 'Bash', arguments: JSON.stringify({ command: "printf 'ASCI_BRIDGE_OK'", description: 'Read-only bridge smoke check' }) } }]
  const choice = { delta: hasResult ? { content: 'ASCI bridge smoke passed.' } : { tool_calls: calls }, finish_reason: hasResult ? 'stop' : 'tool_calls' }
  const output = { id: `smoke_${requests}`, model: body.model, choices: [choice], usage: { prompt_tokens: 20, completion_tokens: 8 } }
  return new Response(`data: ${JSON.stringify(output)}\n\ndata: [DONE]\n\n`, { headers: { 'Content-Type': 'text/event-stream' } })
} })
const controller = new AbortController()
const timer = setTimeout(() => controller.abort(), 60_000)
let succeeded = false
try {
  const cleanEnv = Object.fromEntries(Object.entries(process.env).filter(([key]) => !key.startsWith('ANTHROPIC_')))
  for await (const message of query({ prompt: 'Run the bridge check and report its result.', options: {
    cwd, model: 'asci-smoke-model', systemPrompt: 'You run one read-only bridge test.',
    tools: ['Bash'], allowedTools: ['Bash'], maxTurns: 3, settingSources: [], persistSession: false,
    abortController: controller,
    env: { ...cleanEnv, ANTHROPIC_API_KEY: bridge.apiKey, ANTHROPIC_AUTH_TOKEN: bridge.apiKey, ANTHROPIC_BASE_URL: bridge.baseUrl, CLAUDE_CONFIG_DIR: cwd, CLAUDE_CODE_DISABLE_NONESSENTIAL_TRAFFIC: '1', NO_PROXY: '127.0.0.1,localhost', no_proxy: '127.0.0.1,localhost', HTTPS_PROXY: '', HTTP_PROXY: '', ALL_PROXY: '' },
  } })) {
    if (message.type === 'result') {
      succeeded = message.subtype === 'success'
      console.log('SDK result:', message.subtype)
    }
  }
  if (!succeeded || !toolResultSeen) throw new Error('SDK tool round-trip did not complete')
  console.log(`Bridge smoke passed: ${requests} upstream requests, tool result returned to model.`)
} finally {
  clearTimeout(timer)
  bridge.close()
  rmSync(cwd, { recursive: true, force: true })
}

// 与 Rust SDK 读取器共用合成 JSONL，不读取或迁移真实会话。
import { expect, test } from 'bun:test'
import type { AgentMessage, SDKAssistantMessage, SDKMessage, SDKUserMessage } from '@asci/shared'

const legacy: AgentMessage & { fixtureExtra: { keep: boolean } } = {
  id: 'legacy-user', role: 'user', content: '旧格式 🧠', createdAt: 1700000000000, fixtureExtra: { keep: true },
}

const user: SDKUserMessage & { _createdAt: number } = {
  type: 'user',
  uuid: 'user-uuid',
  message: {
    content: [
      { type: 'text', text: '  修改原图 🧠\n' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'synthetic-only' } },
      { type: 'tool_result', tool_use_id: 'tool-1', content: [{ type: 'text', text: '工具结果不可提取' }] },
    ],
  },
  parent_tool_use_id: 'parent-run',
  session_id: 'synthetic-session',
  imageEditReference: { imageId: 'image-first', localPath: 'attachments/synthetic.png', filename: 'synthetic.png', mediaType: 'image/png' },
  _createdAt: 1700000000001,
}

const assistant: SDKAssistantMessage & { _futureMetadata: { preserve: Array<number | boolean | null> } } = {
  type: 'assistant',
  uuid: 'assistant-uuid',
  message: {
    content: [
      { type: 'text', text: '<script>synthetic</script>' },
      { type: 'thinking', thinking: 'private synthetic thought' },
      { type: 'tool_use', id: 'tool-1', name: 'Read', input: { file_path: 'synthetic-only' } },
      { type: 'text', text: '第二段' },
    ],
    model: 'fixture-model', usage: { input_tokens: 12, output_tokens: 4 },
  },
  parent_tool_use_id: null,
  session_id: 'synthetic-session',
  _futureMetadata: { preserve: [1, true, null] },
}

const sdkMessages: SDKMessage[] = [
  user,
  assistant,
  { type: 'system', subtype: 'task_started', task_id: 'task-1', description: '仅合成任务', session_id: 'synthetic-session' },
  { type: 'tool_progress', tool_use_id: 'tool-1', tool_name: 'Read', parent_tool_use_id: 'parent-run', elapsed_time_seconds: 0.5 },
  { type: 'result', subtype: 'success', usage: { input_tokens: 12, output_tokens: 4 }, total_cost_usd: 0 },
  { type: 'prompt_suggestion', suggestion: '合成建议' },
  { type: 'tool_use_summary', summary: '合成摘要', preceding_tool_use_ids: ['tool-1'] },
  { type: 'future_message_v2', role: 'future-role', uuid: 'future-uuid', message: { unexpected: true }, future: { blocks: [{ type: 'html', html: '<img src=x onerror=synthetic>' }] } },
]

test('原始SDK混排夹具符合共享类型，并保留工具、图片引用、父run和未来字段', async () => {
  const source = await Bun.file(new URL('../src-tauri/fixtures/sdk-messages.jsonl', import.meta.url)).text()
  expect(source.endsWith('\n')).toBe(true)
  const raw: unknown[] = source.trimEnd().split('\n').map((line: string) => JSON.parse(line) as unknown)
  expect(raw).toEqual([legacy, ...sdkMessages])
})

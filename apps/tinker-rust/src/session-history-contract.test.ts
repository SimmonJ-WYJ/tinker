// 同一合成夹具由 TypeScript AgentMessage 契约和 Rust 读取器共同验收。
import { expect, test } from 'bun:test'
import type { AgentMessage } from '@asci/shared'

const expected: Array<AgentMessage & { fixtureExtra?: { unknownField: Array<number | boolean | null> } }> = [
  { id: 'fixture-user', role: 'user', content: '  修改原图 🧠\n', createdAt: 1700000000000 },
  { id: 'fixture-assistant', role: 'assistant', content: 'Synthetic reply', createdAt: 1700000000001, model: 'fixture-model' },
  { id: 'fixture-tool', role: 'tool', content: '{"ok":true}', createdAt: 1700000000002 },
  { id: 'fixture-status', role: 'status', content: 'Interrupted fixture', createdAt: 1700000000003, fixtureExtra: { unknownField: [1, true, null] } },
]

test('Rust历史夹具符合简化AgentMessage契约，保留Unicode、工具结果和扩展字段', async () => {
  const text = await Bun.file(new URL('../src-tauri/fixtures/legacy-agent-messages.jsonl', import.meta.url)).text()
  expect(text.endsWith('\n')).toBe(true)
  expect(text.trimEnd().split('\n').map((line: string) => JSON.parse(line) as unknown)).toEqual(expected)
})

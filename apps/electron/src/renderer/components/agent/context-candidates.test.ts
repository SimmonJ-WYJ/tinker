import { expect, test } from 'bun:test'
import { contextCandidates, latestContextUsage } from './context-candidates'
import type { SDKMessage } from '@asci/shared'
test('只列真实对话，不列工具输出、重放和压缩命令', () => {
 const messages = [
 { type: 'user', uuid: 'a', message: { content: [{ type: 'text', text: 'Important goal' }] }, parent_tool_use_id: null },
 { type: 'user', message: { content: [{ type: 'text', text: '/compact' }] }, parent_tool_use_id: null },
 { type: 'assistant', message: { content: [{ type: 'text', text: 'internal' }] }, parent_tool_use_id: 'tool' },
 ] as SDKMessage[]
 expect(contextCandidates(messages)).toEqual([{ id: 'a', label: 'Important goal', text: 'Important goal' }])
})
test('重启后从持久化主模型消息恢复实测用量，缓存计入上下文', () => {
 const messages = [{ type: 'assistant', parent_tool_use_id: null, message: { content: [], usage: { input_tokens: 10, cache_read_input_tokens: 20, cache_creation_input_tokens: 30 } } }] as SDKMessage[]
 expect(latestContextUsage(messages)?.inputTokens).toBe(60)
})

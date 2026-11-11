import { expect, test } from 'bun:test'
import type { DesktopTurn } from '@asci/shared'
import { projectHistory } from './projection.ts'
import { decodeResult } from './decode.ts'
export const turn: DesktopTurn = { requestId: 'req', sessionId: 'sess', profileId: 'local', modelId: 'model/a', userMessage: '你好', startedAt: 123, effort: 'high', runId: 'run', userMessageId: 'user', assistantMessageId: 'assistant', configRevision: 'r1', assistantMessage: '你好🌱', status: 'completed', sequence: 3, errorCode: null }
test('stable shared projection preserves unicode, timestamps and unknown usage', () => {
  const a = projectHistory([turn]); const b = projectHistory([turn])
  expect(a).toEqual(b)
  expect(a.messages.map(m => m.id)).toEqual(['user', 'assistant'])
  expect(a.sdkMessages.map(m => 'uuid' in m ? m.uuid : null)).toEqual(['user', 'assistant'])
  expect(JSON.stringify(a)).not.toContain('usage')
  expect(JSON.stringify(a)).not.toContain('session_id')
  expect(a.messages[1]?.content).toBe('你好🌱')
  expect(a.messages[1]?.createdAt).toBe(123)
})
test('partial failures survive projection with explicit error and no fake result', () => {
  const { sdkMessages } = projectHistory([{ ...turn, status: 'failed', errorCode: 'httpStatus' }])
  expect(sdkMessages[1]?.type).toBe('assistant')
  expect(sdkMessages[1] && 'error' in sdkMessages[1] && sdkMessages[1].error).toBeTruthy()
})
test('reply decoder rejects wrong shapes, extra fields, unsafe timestamps and event identity', () => {
  expect(decodeResult('chat.send', turn)).toEqual(turn)
  for (const bad of [{ ...turn, startedAt: 1e20 }, { ...turn, key: 'secret' }, { ...turn, effort: 'fake' }, { ...turn, status: 'success' }]) expect(() => decodeResult('chat.send', bad)).toThrow()
  expect(() => decodeResult('profiles.list', { profiles: [{ endpoint: 'secret' }] })).toThrow()
  expect(() => decodeResult('chat.events', { turn, events: [{ sessionId: 'other' }], nextAfterSequence: 1, hasMore: false })).toThrow()
})

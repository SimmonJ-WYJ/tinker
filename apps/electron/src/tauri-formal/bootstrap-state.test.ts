import { expect, test } from 'bun:test'
import { getDefaultStore } from 'jotai'
import { seedActiveRuns } from './bootstrap-state.ts'
import { agentStreamingStatesAtom } from '../renderer/atoms/agent-atoms.ts'
import { registerAgentAttempt, acceptAgentAttempt } from '../renderer/lib/agent-attempt.ts'
import type { ActiveRun } from './protocol.ts'
test('reload 后首个发送点击被原 running gate 拒绝，原请求继续接受流', () => {
  const store = getDefaultStore()
  const run: ActiveRun = { sessionId: 'bootstrap-session', requestId: 'native-request', startedAt: 123, cursor: 1, currentSnapshot: { sessionId: 'bootstrap-session', requestId: 'native-request', startedAt: 123, payload: { kind: 'asci_event', event: { type: 'text_snapshot', text: '恢复' } } } }
  seedActiveRuns([run])
  expect(registerAgentAttempt(store, run.sessionId)).toBeNull()
  expect(acceptAgentAttempt(store, run.sessionId, run.requestId)).toBe(true)
  expect(store.get(agentStreamingStatesAtom).get(run.sessionId)?.startedAt).toBe(123)
  store.set(agentStreamingStatesAtom, new Map())
})

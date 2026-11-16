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

test('trusted reload owner rejects old chain terminals before any local Send registration',()=>{
 const store=getDefaultStore();const run={sessionId:'reload-chain',requestId:'new-chain',startedAt:1,cursor:1,currentSnapshot:{sessionId:'reload-chain',requestId:'new-chain',payload:{kind:'asci_event',event:{type:'text_snapshot',text:'',model:'mock'}}}} as ActiveRun
 seedActiveRuns([run]);expect(acceptAgentAttempt(store,run.sessionId,'old-chain')).toBe(false);expect(acceptAgentAttempt(store,run.sessionId,'new-chain')).toBe(true)
})

test('ordinary native reload retains execution permission cleanup without enabling a queue chain',async()=>{
 const {clearToolRunPermissionsAtom}=await import('../renderer/hooks/tool-run-snapshot-state.ts')
 const {allPendingPermissionRequestsAtom}=await import('../renderer/atoms/agent-atoms.ts')
 const store=getDefaultStore();const run={sessionId:'ordinary-tools',requestId:'ordinary',startedAt:1,cursor:1,currentSnapshot:{sessionId:'ordinary-tools',requestId:'ordinary',payload:{kind:'asci_event',event:{type:'tool_run_snapshot',sdkMessages:[],activeText:'',pendingPermissions:[]}}}} as ActiveRun
 seedActiveRuns([run]);store.set(allPendingPermissionRequestsAtom,new Map([[run.sessionId,[{requestId:'p-ordinary-0',sessionId:run.sessionId} as never]]]))
 store.set(clearToolRunPermissionsAtom,{sessionId:run.sessionId,requestId:run.requestId});expect(store.get(allPendingPermissionRequestsAtom).get(run.sessionId)).toEqual([])
})

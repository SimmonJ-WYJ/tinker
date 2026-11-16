import { expect, test } from 'bun:test'
import { createStore } from 'jotai'
import type { AgentStreamEvent, SDKMessage } from '@asci/shared'
import { applyToolRunSnapshotAtom } from '../renderer/hooks/tool-run-snapshot-state.ts'
import { liveMessagesMapAtom, agentStreamingStatesAtom, queuedMessageUuidsAtom, enqueueMessageUuidAtom } from '../renderer/atoms/agent-atoms.ts'
const user=(uuid:string,run?:string,chain?:string):SDKMessage=>({type:'user',uuid,message:{content:[{type:'text',text:uuid}]},parent_tool_use_id:null,...(run?{_desktopRunId:run}:{}),...(chain?{_desktopQueueChainId:chain,_desktopQueueUuid:uuid}:{})})
function envelope(boundary:number,revision:number,active='b'):AgentStreamEvent {
  return {sessionId:'s',requestId:'a',startedAt:1,payload:{kind:'asci_event',event:{type:'native_chain_snapshot',chainId:'a',revision,badgeClearBoundary:boundary,activeRequestId:active,closureReason:null,
    executions:[{requestId:'a',runId:'a',snapshot:{type:'tool_run_snapshot',sdkMessages:[user('a-user','a')],activeText:'',pendingPermissions:[]}},{requestId:'b',runId:'b',snapshot:{type:'tool_run_snapshot',sdkMessages:[user('b-user','b')],activeText:'B partial',pendingPermissions:[]}}],
    receipts:[{uuid:'b',userMessageId:'b-user',requestId:'b',disposition:'bound',receipt:{uuid:'b',chainId:'a',sessionId:'s'}},{uuid:'b-user',userMessageId:'b-user-user',requestId:null,disposition:'pending',receipt:{uuid:'b-user',chainId:'a',sessionId:'s'}}],pendingMessages:[{...user('b-user',undefined,'a'),_desktopQueueDisposition:'pending'}]}}} as unknown as AgentStreamEvent
}
test('chain snapshot atomically keeps execution namespaces and confirms only exact authenticated optimistic UUIDs',()=>{
  const store=createStore();const foreign=user('b');const queued=user('b',undefined,'a')
  store.set(liveMessagesMapAtom,new Map([['s',[foreign,queued,user('b-user',undefined,'a')]]]))
  store.set(applyToolRunSnapshotAtom,envelope(0,2))
  const messages=store.get(liveMessagesMapAtom).get('s')!
  expect(messages).toHaveLength(4)
  expect(messages).toContain(foreign)
  expect(messages.filter(m=>m.uuid==='b-user')).toHaveLength(2)
  expect(messages).not.toContain(queued)
  expect(store.get(agentStreamingStatesAtom).get('s')?.content).toBe('B partial')
})
test('completed-turn boundary clears legacy badges once, later enqueues survive stale repeated snapshots',()=>{
  const store=createStore();store.set(enqueueMessageUuidAtom,{sessionId:'s',uuid:'b',text:'B',mode:'tail'})
  store.set(applyToolRunSnapshotAtom,envelope(1,3))
  expect(store.get(queuedMessageUuidsAtom).has('s')).toBe(false)
  store.set(enqueueMessageUuidAtom,{sessionId:'s',uuid:'late',text:'late',mode:'tail'})
  store.set(applyToolRunSnapshotAtom,envelope(1,3));store.set(applyToolRunSnapshotAtom,envelope(0,2))
  expect(store.get(queuedMessageUuidsAtom).get('s')?.map(m=>m.uuid)).toEqual(['late'])
})

test('native text queue capability rejects rich inputs before the original editor clears them',async()=>{
  const {refusesNativeQueue}=await import('../renderer/hooks/native-queue-state.ts')
  expect(refusesNativeQueue(true,false,false)).toBe(true)
  expect(refusesNativeQueue(true,true,true)).toBe(true)
  expect(refusesNativeQueue(true,true,false)).toBe(false)
  expect(refusesNativeQueue(false,false,true)).toBe(false)
})

test('one malformed execution group cannot partially mutate another group or another session',()=>{
  const store=createStore();const existing=user('foreign','other')
  store.set(liveMessagesMapAtom,new Map([['s',[existing]],['other',[existing]]]))
  const bad=envelope(0,2)
  if(bad.payload.kind==='asci_event' && bad.payload.event.type==='native_chain_snapshot')bad.payload.event.executions[1]!.snapshot.pendingPermissions=[{requestId:'p-foreign-0',sessionId:'other'} as never]
  store.set(applyToolRunSnapshotAtom,bad)
  expect(store.get(liveMessagesMapAtom).get('s')).toEqual([existing])
  expect(store.get(liveMessagesMapAtom).get('other')).toEqual([existing])
})

test('native pending boundary uses execution identity rather than a coinciding visible badge UUID',async()=>{
 const {isPendingUserMessage,nativeMessageIdentity}=await import('../renderer/lib/native-message-identity.ts')
 const bound={...user('b-user','b','a'),_desktopQueueUuid:'b'}
 const pending=user('b-user',undefined,'a')
 const badges=new Set(['b-user'])
 expect(isPendingUserMessage(bound,badges)).toBe(false)
 expect(isPendingUserMessage(pending,new Set())).toBe(true)
 expect(nativeMessageIdentity(bound)).not.toBe(nativeMessageIdentity(pending))
 expect(isPendingUserMessage(user('b-user'),badges)).toBe(true)
})

test('definite queue rejection recovers empty composer but never overwrites text typed during ACK',async()=>{
 const {rejectNativeQueuedMessageAtom}=await import('../renderer/hooks/native-queue-state.ts')
 const {agentSessionDraftsAtom}=await import('../renderer/atoms/agent-atoms.ts')
 const store=createStore();const rejected=user('exact',undefined,'a');const foreign=user('exact')
 store.set(liveMessagesMapAtom,new Map([['s',[foreign,rejected]]]))
 store.set(rejectNativeQueuedMessageAtom,{sessionId:'s',message:rejected,text:'original'})
 expect(store.get(agentSessionDraftsAtom).get('s')).toBe('original');expect(store.get(liveMessagesMapAtom).get('s')).toEqual([foreign])
 store.set(liveMessagesMapAtom,new Map([['s',[foreign,rejected]]]));store.set(agentSessionDraftsAtom,new Map([['s','newer typing']]))
 store.set(rejectNativeQueuedMessageAtom,{sessionId:'s',message:rejected,text:'original'})
 expect(store.get(agentSessionDraftsAtom).get('s')).toBe('newer typing')
 expect(store.get(liveMessagesMapAtom).get('s')).toHaveLength(2)
 expect(store.get(liveMessagesMapAtom).get('s')?.[1]).toMatchObject({_desktopQueueDisposition:'rejected',uuid:'exact'})
})

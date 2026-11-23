import {afterEach,expect,spyOn,test} from 'bun:test'
import {act,cleanup,render} from '@testing-library/react'
import {createStore,Provider} from 'jotai'
import {toast} from 'sonner'
import * as notifications from '@/atoms/notifications'
import {agentStreamingStatesAtom,agentStreamErrorsAtom,agentPlanModeSessionsAtom,workingDoneSessionIdsAtom,stoppedByUserSessionsAtom,queuedMessageUuidsAtom,unviewedCompletedSessionIdsAtom,agentMessageRefreshAtom} from '@/atoms/agent-atoms'
import {captureSendDraft,sendRecoveryDraftsAtom} from '@/atoms/send-recovery-atoms'
import {observeAgentSend} from '@/lib/agent-send'
import {registerAgentAttempt,acceptAgentAttempt} from '@/lib/agent-attempt'
import {useGlobalAgentListeners} from './useGlobalAgentListeners'
import type {AgentStreamCompletePayload,AgentStreamEvent} from '@asci/shared'
const restores:(()=>void)[]=[]
afterEach(()=>{cleanup();for(const restore of restores.splice(0))restore()})
function setup(){
 const store=createStore()
 let complete!:(data:AgentStreamCompletePayload)=>void,error!:(data:{sessionId:string;requestId?:string;startedAt?:number;error:string})=>void,event!:(data:AgentStreamEvent)=>void
 window.electronAPI={
  listAgentSessions:async()=>[],
  onAgentStreamEvent:(callback:typeof event)=>{event=callback;return()=>{}},
  onAgentStreamComplete:(callback:typeof complete)=>{complete=callback;return()=>{}},
  onAgentStreamError:(callback:typeof error)=>{error=callback;return()=>{}},
  onAgentTitleUpdated:()=>()=>{},workspacePapers:{onChanged:()=>()=>{}},
 } as unknown as Window['electronAPI']
 const notify=spyOn(notifications,'sendDesktopNotification').mockImplementation(()=>{})
 const warn=spyOn(toast,'warning').mockImplementation(()=>0)
 restores.push(()=>notify.mockRestore(),()=>warn.mockRestore())
 function Listeners(){useGlobalAgentListeners();return null}
 render(<Provider store={store}><Listeners/></Provider>)
 const start=(startedAt:number)=>{
  const requestId=registerAgentAttempt(store,'s')
  if(!requestId)throw new Error('TEST_DUPLICATE_ATTEMPT')
  const draft=captureSendDraft({text:`draft ${startedAt}`,html:'',files:[],mentions:[]},new Map())
  store.set(agentStreamingStatesAtom,new Map([['s',{running:true,startedAt,content:`content ${startedAt}`,toolActivities:[],teammates:[]}]]))
  store.set(sendRecoveryDraftsAtom,new Map([['s',draft]]));store.set(agentStreamErrorsAtom,new Map())
  return {draft,meta:{sessionId:'s',startedAt,requestId}}
 }
 return {store,start,notify,warn,complete,error,event}
}
function deferred(){
 let resolve!:()=>void,reject!:(error:Error)=>void
 const promise=new Promise<void>((resolveFn,rejectFn)=>{resolve=resolveFn;reject=rejectFn})
 return {promise,resolve,reject}
}
for(const times of [[100,200],[200,100],[100,100]] as const){
 test.each(['success','failure'])(`new attempt ${times[0]} → ${times[1]} accepts its own callbacks and rejects old ones: %s`,async outcome=>{
  const {store,start,notify,warn,complete,error,event}=setup()
  const old=start(times[0]),oldDeferred=deferred()
  const oldSend=observeAgentSend(store,'s',old.meta.requestId,oldDeferred.promise,old.draft)
  await act(async()=>complete({...old.meta,resultSubtype:'success'}))
  const newer=start(times[1]),newDeferred=deferred()
  expect(newer.meta.requestId).not.toBe(old.meta.requestId)
  const newSend=observeAgentSend(store,'s',newer.meta.requestId,newDeferred.promise,newer.draft)
  store.set(agentPlanModeSessionsAtom,new Set(['s']))
  store.set(queuedMessageUuidsAtom,new Map([['s',[{uuid:'queue-B',text:'queued B'}]]]))
  store.set(workingDoneSessionIdsAtom,new Set())
  store.set(unviewedCompletedSessionIdsAtom,new Set())
  const refresh=store.get(agentMessageRefreshAtom)
  const state=store.get(agentStreamingStatesAtom)
  const oldCallbacks=()=>{
   error({...old.meta,error:'old failure'})
   complete({...old.meta,stoppedByUser:true,resultSubtype:'error_during_execution'})
   event({...old.meta,payload:{kind:'asci_event',event:{type:'text_delta',text:'old'}}})
  }
  await act(async()=>oldCallbacks())
  expect(store.get(agentStreamingStatesAtom)).toBe(state)
  expect(store.get(agentStreamErrorsAtom).size).toBe(0)
  expect(store.get(sendRecoveryDraftsAtom).get('s')).toBe(newer.draft)
  expect(store.get(queuedMessageUuidsAtom).get('s')).toHaveLength(1)
  expect(store.get(agentPlanModeSessionsAtom).has('s')).toBe(true)
  expect(store.get(workingDoneSessionIdsAtom).size).toBe(0)
  expect(store.get(stoppedByUserSessionsAtom).size).toBe(0)
  expect(store.get(unviewedCompletedSessionIdsAtom).size).toBe(0)
  expect(store.get(agentMessageRefreshAtom)).toBe(refresh)
  expect(notify).toHaveBeenCalledTimes(1);expect(warn).not.toHaveBeenCalled()
  await act(async()=>event({...newer.meta,payload:{kind:'asci_event',event:{type:'text_delta',text:' accepted'}}}))
  expect(store.get(agentStreamingStatesAtom).get('s')?.content).toBe(`content ${times[1]} accepted`)
  expect(store.get(agentStreamingStatesAtom).get('s')?.startedAt).toBe(times[1])
  await act(async()=>{
   if(outcome==='failure')error({...newer.meta,error:'new failure'})
   complete({...newer.meta,resultSubtype:outcome==='success'?'success':'error_during_execution'})
  })
  expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(false)
  if(outcome==='success')newDeferred.resolve();else newDeferred.reject(new Error('new failure'))
  await newSend
  expect(store.get(sendRecoveryDraftsAtom).has('s')).toBe(outcome==='failure')
  expect(notify).toHaveBeenCalledTimes(2)
  expect(warn).toHaveBeenCalledTimes(outcome==='failure'?1:0)
  store.set(agentStreamingStatesAtom,new Map())
  await act(async()=>oldCallbacks())
  oldDeferred.reject(new Error('old invoke failure'));await oldSend
  expect(store.get(agentStreamErrorsAtom).get('s')).toBe(outcome==='failure'?'new failure':undefined)
  expect(store.get(agentStreamingStatesAtom).size).toBe(0)
  expect(store.get(sendRecoveryDraftsAtom).has('s')).toBe(outcome==='failure')
  expect(notify).toHaveBeenCalledTimes(2)
 })
}
test('old invoke rejection while the newer attempt runs cannot clear it',async()=>{
 const {store,start,complete}=setup(),old=start(200),pending=deferred()
 const observed=observeAgentSend(store,'s',old.meta.requestId,pending.promise,old.draft)
 await act(async()=>complete({...old.meta,resultSubtype:'success'}))
 const newer=start(100),state=store.get(agentStreamingStatesAtom)
 pending.reject(new Error('old invoke failure'));await observed
 expect(store.get(agentStreamingStatesAtom)).toBe(state)
 expect(store.get(agentStreamErrorsAtom).size).toBe(0)
 expect(store.get(sendRecoveryDraftsAtom).get('s')).toBe(newer.draft)
})
test('rapid duplicate registration cannot take ownership from a running attempt',()=>{
 const {store,start}=setup(),attempt=start(200)
 expect(registerAgentAttempt(store,'s')).toBeNull()
 expect(acceptAgentAttempt(store,'s',attempt.meta.requestId)).toBe(true)
 expect(acceptAgentAttempt(store,'s','another-request')).toBe(false)
})
test('untagged external and legacy callbacks remain accepted after a local run, including clock rollback',async()=>{
 const {store,start,complete,error,event,notify}=setup(),local=start(200)
 await act(async()=>complete({...local.meta,resultSubtype:'success'}))
 store.set(agentStreamingStatesAtom,new Map())
 await act(async()=>event({sessionId:'s',startedAt:100,payload:{kind:'asci_event',event:{type:'text_delta',text:'external'}}}))
 expect(store.get(agentStreamingStatesAtom).get('s')?.content).toBe('external')
 await act(async()=>complete({sessionId:'s',startedAt:100,resultSubtype:'success'}))
 expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(false)
 await act(async()=>{error({sessionId:'s',error:'legacy failure'});complete({sessionId:'s',resultSubtype:'success'})})
 expect(store.get(agentStreamErrorsAtom).get('s')).toBe('legacy failure')
 expect(notify).toHaveBeenCalledTimes(3)
})
test('reloaded host streams do not register ownership merely by delivering callbacks',async()=>{
 const {store,complete,event}=setup()
 for(const [requestId,startedAt] of [['host-A',200],['host-B',100]] as const){
  store.set(agentStreamingStatesAtom,new Map())
  await act(async()=>event({sessionId:'s',requestId,startedAt,payload:{kind:'asci_event',event:{type:'text_delta',text:requestId}}}))
  expect(store.get(agentStreamingStatesAtom).get('s')?.content).toBe(requestId)
  await act(async()=>complete({sessionId:'s',requestId,startedAt,resultSubtype:'success'}))
  expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(false)
 }
})

test('untagged legacy completion keeps its existing stale/missing timestamp running-state guard',async()=>{
 const {store,start,complete}=setup();start(200)
 await act(async()=>complete({sessionId:'s',startedAt:100,resultSubtype:'success'}))
 expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(true)
 await act(async()=>complete({sessionId:'s',resultSubtype:'success'}))
 expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(true)
 await act(async()=>complete({sessionId:'s',startedAt:200,resultSubtype:'success'}))
 expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(false)
})


test('a live image assistant changes to its terminal status once and a late pending echo cannot reopen it', async () => {
 const original = window.__TAURI_FORMAL__
 window.__TAURI_FORMAL__ = {hydrated() {}, nativeImageTaskLifecycle:true}
 try {
  const {store,event,start} = setup()
  const {meta} = start(15)
  const {liveMessagesMapAtom} = await import('@/atoms/agent-atoms')
  const emit = (status:'running'|'interrupted') => event({...meta,payload:{kind:'sdk_message',message:{
   type:'assistant',uuid:'image-assistant',parent_tool_use_id:null,_desktopImageTaskRequestId:meta.requestId,
   _desktopImageTaskKind:'edit',_desktopImageTaskStatus:status,
   message:{content:[{type:'tool_use',name:'mcp__asci-image__generate_image',id:'tool',input:{}}]},
  }}})
  await act(async()=>{ emit('running');emit('interrupted');emit('running');emit('interrupted') })
  const accepted=store.get(liveMessagesMapAtom).get('s')
  expect(accepted).toHaveLength(1)
  expect(accepted?.[0]).toMatchObject({_desktopImageTaskStatus:'interrupted'})
 } finally {window.__TAURI_FORMAL__ = original}
})

import {afterEach,expect,spyOn,test} from 'bun:test'
import {act,cleanup,render} from '@testing-library/react'
import {createStore,Provider} from 'jotai'
import {toast} from 'sonner'
import * as notifications from '@/atoms/notifications'
import {agentStreamingStatesAtom,agentStreamErrorsAtom,agentPlanModeSessionsAtom,workingDoneSessionIdsAtom,stoppedByUserSessionsAtom,queuedMessageUuidsAtom,unviewedCompletedSessionIdsAtom,agentMessageRefreshAtom} from '@/atoms/agent-atoms'
import {captureSendDraft,sendRecoveryDraftsAtom} from '@/atoms/send-recovery-atoms'
import {observeAgentSend} from '@/lib/agent-send'
import {useGlobalAgentListeners} from './useGlobalAgentListeners'
import type {AgentStreamCompletePayload,AgentStreamEvent} from '@asci/shared'
const restores:(()=>void)[]=[]
afterEach(()=>{cleanup();for(const restore of restores.splice(0))restore()})
const draft=(text:string)=>captureSendDraft({text,html:'',files:[],mentions:[]},new Map())
function setup(){
 const store=createStore()
 let complete!:(data:AgentStreamCompletePayload)=>void,error!:(data:{sessionId:string;startedAt?:number;error:string})=>void,event!:(data:AgentStreamEvent)=>void
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
  const recovery=draft(`draft ${startedAt}`)
  store.set(agentStreamingStatesAtom,new Map([['s',{running:true,startedAt,content:`content ${startedAt}`,toolActivities:[],teammates:[]}]]))
  store.set(sendRecoveryDraftsAtom,new Map([['s',recovery]]));store.set(agentStreamErrorsAtom,new Map())
  return recovery
 }
 return {store,start,notify,warn,complete,error,event}
}
test('late old terminal listeners have no effects during or after the newer attempt',async()=>{
 const {store,start,notify,warn,complete,error,event}=setup();const recovery=start(200)
 store.set(agentPlanModeSessionsAtom,new Set(['s']))
 store.set(queuedMessageUuidsAtom,new Map([['s',[{uuid:'queue-B',text:'queued B'}]]]))
 const original=store.get(agentStreamingStatesAtom)
 const late=()=>{error({sessionId:'s',startedAt:100,error:'old failure'});complete({sessionId:'s',startedAt:100,stoppedByUser:true,resultSubtype:'error_during_execution'});event({sessionId:'s',startedAt:100,payload:{kind:'asci_event',event:{type:'text_delta',text:'old'}}})}
 await act(async()=>late())
 expect(store.get(agentStreamingStatesAtom)).toBe(original)
 expect(store.get(agentStreamErrorsAtom).size).toBe(0)
 expect(store.get(sendRecoveryDraftsAtom).get('s')).toBe(recovery)
 expect(store.get(queuedMessageUuidsAtom).get('s')).toHaveLength(1)
 expect(store.get(agentPlanModeSessionsAtom).has('s')).toBe(true)
 expect(store.get(workingDoneSessionIdsAtom).size).toBe(0)
 expect(store.get(stoppedByUserSessionsAtom).size).toBe(0)
 expect(store.get(unviewedCompletedSessionIdsAtom).size).toBe(0)
 expect(store.get(agentMessageRefreshAtom).size).toBe(0)
 expect(notify).not.toHaveBeenCalled();expect(warn).not.toHaveBeenCalled()
 await act(async()=>complete({sessionId:'s',startedAt:200,resultSubtype:'success'}))
 expect(store.get(agentStreamingStatesAtom).get('s')?.running).toBe(false)
 expect(store.get(workingDoneSessionIdsAtom).has('s')).toBe(true)
 expect(notify).toHaveBeenCalledTimes(1)
 await observeAgentSend(store,'s',200,Promise.resolve(),recovery)
 expect(store.get(sendRecoveryDraftsAtom).has('s')).toBe(false)
 store.set(agentStreamingStatesAtom,new Map())
 await act(async()=>late())
 expect(store.get(agentStreamingStatesAtom).size).toBe(0)
 expect(store.get(agentStreamErrorsAtom).size).toBe(0)
 expect(notify).toHaveBeenCalledTimes(1);expect(warn).not.toHaveBeenCalled()
})
test.each([false,true])('old invoke rejection after COMPLETE and retry cannot mutate newer attempt (newer cleared=%s)',async cleared=>{
 const {store,start,complete,error}=setup();const oldDraft=start(100)
 let reject!:(error:Error)=>void
 const pending=new Promise<void>((_resolve,rejectFn)=>{reject=rejectFn})
 const observed=observeAgentSend(store,'s',100,pending,oldDraft)
 await act(async()=>complete({sessionId:'s',startedAt:100,resultSubtype:'success'}))
 const newer=start(200)
 if(cleared){await act(async()=>complete({sessionId:'s',startedAt:200,resultSubtype:'success'}));store.set(agentStreamingStatesAtom,new Map())}
 const state=store.get(agentStreamingStatesAtom)
 reject(new Error('old invoke failed'));await observed
 expect(store.get(agentStreamingStatesAtom)).toBe(state)
 expect(store.get(agentStreamErrorsAtom).size).toBe(0)
 expect(store.get(sendRecoveryDraftsAtom).get('s')).toBe(newer)
 await act(async()=>error({sessionId:'s',startedAt:200,error:'new failure'}))
 expect(store.get(agentStreamErrorsAtom).get('s')).toBe('new failure')
 await observeAgentSend(store,'s',200,Promise.reject(new Error('new invoke failed')),newer)
 expect(store.get(agentStreamingStatesAtom).size).toBe(0)
 expect(store.get(sendRecoveryDraftsAtom).get('s')).toBe(newer)
})
test('legacy callbacks without startedAt retain their existing error and completion behavior',async()=>{
 const {store,complete,error,notify}=setup()
 await act(async()=>{error({sessionId:'s',error:'legacy failure'});complete({sessionId:'s',resultSubtype:'success'})})
 expect(store.get(agentStreamErrorsAtom).get('s')).toBe('legacy failure')
 expect(store.get(workingDoneSessionIdsAtom).has('s')).toBe(true)
 expect(notify).toHaveBeenCalledTimes(1)
})

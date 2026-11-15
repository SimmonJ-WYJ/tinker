/** 单个 Jotai write 提交消息、正文、工具与权限，订阅者不观察中间状态。 */
import { atom } from 'jotai'
import type { AgentStreamEvent, PermissionRequest } from '@asci/shared'
import { liveMessagesMapAtom, agentStreamingStatesAtom, allPendingPermissionRequestsAtom } from '../atoms/agent-atoms.ts'
import { reconcileToolSnapshot } from './tool-run-snapshot.ts'
export const applyToolRunSnapshotAtom = atom(null, (get, set, envelope: AgentStreamEvent): PermissionRequest[] => {
  const { sessionId, requestId, payload }=envelope
  if (payload.kind !== 'asci_event' || payload.event.type !== 'tool_run_snapshot' || !requestId) return []
  const streams=get(agentStreamingStatesAtom)
  const current=streams.get(sessionId) ?? {running:true,content:'',toolActivities:[],teammates:[],startedAt:envelope.startedAt}
  const previous={messages:get(liveMessagesMapAtom).get(sessionId) ?? [],permissions:get(allPendingPermissionRequestsAtom).get(sessionId) ?? [],activities:current.toolActivities,content:current.content}
  const next=reconcileToolSnapshot(previous,requestId,payload.event)
  if (next===previous) return []
  set(liveMessagesMapAtom,new Map(get(liveMessagesMapAtom)).set(sessionId,next.messages))
  set(allPendingPermissionRequestsAtom,new Map(get(allPendingPermissionRequestsAtom)).set(sessionId,next.permissions))
  set(agentStreamingStatesAtom,new Map(streams).set(sessionId,{...current,content:next.content,toolActivities:next.activities}))
  return next.newPermissions ?? []
})
export const clearToolRunPermissionsAtom = atom(null, (get,set,identity:{sessionId:string;requestId?:string}) => {
  const previous=get(allPendingPermissionRequestsAtom)
  const current=previous.get(identity.sessionId) ?? []
  const owned=new Set(Array.from({length:4},(_,round)=>`p-${identity.requestId}-${round}`))
  const next=identity.requestId ? current.filter(p=>!owned.has(p.requestId)) : []
  if (next.length!==current.length) set(allPendingPermissionRequestsAtom,new Map(previous).set(identity.sessionId,next))
})

/** 原生链的认证快照在一个 atom 中提交；原 SDK 路径不读取这些元数据。 */
import { atom } from 'jotai'
import type { AgentStreamEvent, PermissionRequest, SDKMessage } from '@asci/shared'
import { agentSessionDraftsAtom, agentSessionDraftHtmlAtom, removeMessageUuidAtom, agentStreamingStatesAtom, allPendingPermissionRequestsAtom, liveMessagesMapAtom, queuedMessageUuidsAtom } from '../atoms/agent-atoms.ts'
import { reconcileToolSnapshot } from './tool-run-snapshot.ts'
import type { ToolSnapshotState } from './tool-run-snapshot.ts'
interface ChainState { chainId:string; revision:number; boundary:number; executions:string[] }
export const nativeQueueChainsAtom=atom(new Map<string,ChainState>())
declare global {interface Window {__TAURI_QUEUEING__?: boolean}}
export function refusesNativeQueue(preview:boolean,queueing:boolean,richInput:boolean):boolean { return preview && (!queueing || richInput) }
export const applyNativeQueueSnapshotAtom=atom(null,(get,set,envelope:AgentStreamEvent):PermissionRequest[]=>{
  if(envelope.payload.kind!=='asci_event' || envelope.payload.event.type!=='native_chain_snapshot')return []
  const event=envelope.payload.event;const sid=envelope.sessionId
  if(envelope.requestId!==event.chainId)return []
  const previousChain=get(nativeQueueChainsAtom).get(sid)
  if(previousChain?.chainId===event.chainId && event.revision<previousChain.revision)return []
  const receipts=new Map(event.receipts.map(r=>[r.uuid,r]))
  if(receipts.size!==event.receipts.length || event.receipts.some(r=>r.receipt.chainId!==event.chainId || r.receipt.sessionId!==sid || r.receipt.uuid!==r.uuid))return []
  const runs=new Set(event.executions.map(e=>e.runId))
  if(runs.size!==event.executions.length || event.executions.some(e=>e.requestId!==e.runId || (e.requestId!==event.chainId && receipts.get(e.requestId)?.requestId!==e.requestId)))return []
  if(event.pendingMessages.some(m=>{
    const r=m as Record<string,unknown>;const receipt=receipts.get(String(r._desktopQueueUuid))
    return r._desktopQueueChainId!==event.chainId || !receipt || receipt.disposition==='bound' || r.uuid!==receipt.uuid
  }))return []
  const streams=get(agentStreamingStatesAtom)
  const current=streams.get(sid) ?? {running:true,content:'',toolActivities:[],teammates:[],startedAt:envelope.startedAt}
  const oldPermissions=get(allPendingPermissionRequestsAtom).get(sid) ?? []
  let next:ToolSnapshotState={messages:get(liveMessagesMapAtom).get(sid) ?? [],permissions:oldPermissions,activities:current.toolActivities,content:current.content}
  // 先验证全部执行分组；任何一个身份无效都不得提交部分更新。
  for(const group of event.executions) {
    if(group.snapshot.pendingPermissions.some(p=>p.sessionId!==sid))return []
    const probe:ToolSnapshotState={messages:[],permissions:[],activities:[],content:'\u0000'}
    if(reconcileToolSnapshot(probe,group.runId,group.snapshot)===probe)return []
  }
  next={...next,messages:next.messages.filter(m=>{
    const r=m as Record<string,unknown>
    return !(r._desktopQueueChainId===event.chainId && typeof r._desktopQueueUuid==='string' && receipts.has(r._desktopQueueUuid))
  })}
  for(const group of event.executions) next=reconcileToolSnapshot(next,group.runId,group.snapshot)
  const active=event.executions.find(e=>e.requestId===event.activeRequestId)
  next={...next,messages:[...next.messages,...event.pendingMessages],content:event.closureReason ? '' : active?.snapshot.activeText ?? ''}
  set(liveMessagesMapAtom,new Map(get(liveMessagesMapAtom)).set(sid,next.messages))
  set(allPendingPermissionRequestsAtom,new Map(get(allPendingPermissionRequestsAtom)).set(sid,next.permissions))
  set(agentStreamingStatesAtom,new Map(streams).set(sid,{...current,content:next.content,toolActivities:next.activities}))
  const badges=new Map(get(queuedMessageUuidsAtom))
  const crossed=event.badgeClearBoundary>(previousChain?.chainId===event.chainId ? previousChain.boundary : 0)
  let list=crossed || event.closureReason ? [] : badges.get(sid) ?? []
  // 边界后新接受的消息可恢复徽标；边界前的全部旧徽标保持 legacy 清空策略。
  if(event.badgeClearRevision!==undefined && !event.closureReason) {
    list=list.filter(m=>!receipts.has(m.uuid) || (receipts.get(m.uuid)?.receipt.revision ?? 0)>event.badgeClearRevision!)
    for(const r of event.receipts) {
      if((r.receipt.revision ?? 0)<=event.badgeClearRevision || list.some(m=>m.uuid===r.uuid))continue
      const item={uuid:r.uuid,text:r.userMessage ?? ''}
      list=r.interrupt ? [item,...list] : [...list,item]
    }
  }
  if(list.length)badges.set(sid,list);else badges.delete(sid)
  set(queuedMessageUuidsAtom,badges)
  set(nativeQueueChainsAtom,new Map(get(nativeQueueChainsAtom)).set(sid,{chainId:event.chainId,revision:event.revision,boundary:event.badgeClearBoundary,executions:[...runs]}))
  return next.permissions.filter(p=>!oldPermissions.some(old=>old.requestId===p.requestId && old.sessionId===p.sessionId))
})
export function queueOptimisticIdentity(message:SDKMessage):string|undefined {
  const m=message as Record<string,unknown>
  return typeof m._desktopQueueChainId==='string' && typeof m._desktopQueueUuid==='string' ? JSON.stringify([m._desktopQueueChainId,m._desktopQueueUuid]) : undefined
}

/** 确定拒绝才回滚；新草稿已存在时保留原消息正文供用户恢复，不覆盖后来输入。 */
export const rejectNativeQueuedMessageAtom=atom(null,(get,set,input:{sessionId:string;message:SDKMessage;text:string})=>{
  const {sessionId,message,text}=input
  const drafts=get(agentSessionDraftsAtom)
  const newer=drafts.get(sessionId)
  if(!newer) {
    set(agentSessionDraftsAtom,new Map(drafts).set(sessionId,text))
    const html=new Map(get(agentSessionDraftHtmlAtom));html.delete(sessionId);set(agentSessionDraftHtmlAtom,html)
  }
  const messages=get(liveMessagesMapAtom)
  const next=(messages.get(sessionId) ?? []).flatMap(m=>m!==message ? [m] : newer ? [{...m,_desktopQueueDisposition:'rejected'} as SDKMessage] : [])
  set(liveMessagesMapAtom,new Map(messages).set(sessionId,next))
  const uuid=(message as Record<string,unknown>)._desktopQueueUuid
  if(typeof uuid==='string')set(removeMessageUuidAtom,{sessionId,uuid})
})

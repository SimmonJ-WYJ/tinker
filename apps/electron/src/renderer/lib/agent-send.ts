/** 两个正式 composer 发送入口共用同一终态恢复逻辑。 */
import { acceptAgentAttempt } from './agent-attempt'
import type { createStore } from 'jotai'
import { agentStreamErrorsAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import { forgetSendDraftAtom } from '@/atoms/send-recovery-atoms'
import type { SendRecoveryDraft } from '@/atoms/send-recovery-atoms'
export function observeAgentSend(store:ReturnType<typeof createStore>,sessionId:string,requestId:string,promise:Promise<void>,draft:SendRecoveryDraft):Promise<void> {
  return promise.then(()=>{
    if(!acceptAgentAttempt(store,sessionId,requestId))return
    if(!store.get(agentStreamErrorsAtom).has(sessionId))store.set(forgetSendDraftAtom,{sessionId,draft})
  }).catch((error:unknown)=>{
    if(!acceptAgentAttempt(store,sessionId,requestId))return
    store.set(agentStreamErrorsAtom,previous=>new Map(previous).set(sessionId,error instanceof Error?error.message:String(error)))
    store.set(agentStreamingStatesAtom,previous=>{const next=new Map(previous);next.delete(sessionId);return next})
  })
}

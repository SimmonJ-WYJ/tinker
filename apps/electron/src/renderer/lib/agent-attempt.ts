/** 保留最近请求身份，流状态清空后仍拒绝已排队的旧 IPC/Promise 回调。 */
import {atom} from 'jotai'
import type {createStore} from 'jotai'
import {agentStreamingStatesAtom} from '@/atoms/agent-atoms'
const latestAttemptsAtom=atom(new Map<string,number>())
// M1 最多 128 个会话；默认 SDK 模式也不无限积累已关闭会话。
const MAX_RETAINED_ATTEMPTS=1024
export function acceptAgentAttempt(store:ReturnType<typeof createStore>,sessionId:string,startedAt?:number):boolean {
  // 旧 SDK 调用方尚无请求身份，保留原兼容语义。
  if(startedAt===undefined)return true
  const previous=store.get(latestAttemptsAtom)
  const running=store.get(agentStreamingStatesAtom).get(sessionId)?.startedAt
  const latest=Math.max(previous.get(sessionId)??0,running??0)
  const identity=Math.max(latest,startedAt)
  if(previous.get(sessionId)!==identity){
    const next=new Map(previous)
    next.delete(sessionId);next.set(sessionId,identity)
    while(next.size>MAX_RETAINED_ATTEMPTS)next.delete(next.keys().next().value!)
    store.set(latestAttemptsAtom,next)
  }
  return startedAt>=latest
}

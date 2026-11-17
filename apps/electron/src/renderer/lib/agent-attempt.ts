/** 请求身份由本地发送入口登记；时钟时间只用于显示，不参与请求先后判定。 */
import { atom } from 'jotai'
import type { createStore } from 'jotai'
import { agentStreamingStatesAtom } from '@/atoms/agent-atoms'
const latestAttemptsAtom = atom(new Map<string, string>())
// M1 最多 128 个会话；默认 SDK 模式也不无限积累已关闭会话。
const MAX_RETAINED_ATTEMPTS = 1024
export function registerAgentAttempt(store:ReturnType<typeof createStore>,sessionId:string):string|null {
  // React 闭包尚未刷新时的重复点击，不能夺走正在运行请求的归属。
  if (store.get(agentStreamingStatesAtom).get(sessionId)?.running) return null
  const requestId = crypto.randomUUID()
  const next = new Map(store.get(latestAttemptsAtom))
  next.delete(sessionId)
  next.set(sessionId,requestId)
  while (next.size>MAX_RETAINED_ATTEMPTS) next.delete(next.keys().next().value!)
  store.set(latestAttemptsAtom,next)
  return requestId
}
export function acceptAgentAttempt(store:ReturnType<typeof createStore>,sessionId:string,requestId?:string):boolean {
  // 旧 SDK eventBus / 外部启动没有本地请求 ID；保留原兼容语义。
  if (requestId===undefined) return true
  const current = store.get(latestAttemptsAtom).get(sessionId)
  // 重载后的 host 流没有本地登记；回调不能自行登记或抢占新的本地请求。
  return current===undefined || current===requestId
}

export function currentAgentAttempt(store:ReturnType<typeof createStore>,sessionId:string):string|undefined { return store.get(latestAttemptsAtom).get(sessionId) }

/** 仅 mount 前的可信宿主 bootstrap 可以恢复 owner；流回调不得调用。 */
export function restoreAgentAttempt(store:ReturnType<typeof createStore>,sessionId:string,requestId:string):void {
  store.set(latestAttemptsAtom,previous=>new Map(previous).set(sessionId,requestId))
}

/** 两条原发送路径均 fresh read 同一会话/默认推理状态。 */
import type {createStore} from 'jotai'
import {agentReasoningEffortMapAtom,agentDefaultReasoningEffortAtom} from '../atoms/agent-atoms.ts'
export function resolveSessionEffort(store:ReturnType<typeof createStore>,sessionId:string){
 return (store.get(agentReasoningEffortMapAtom).get(sessionId) ?? store.get(agentDefaultReasoningEffortAtom)) || undefined
}

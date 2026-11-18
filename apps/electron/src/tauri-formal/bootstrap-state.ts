import { restoreAgentAttempt } from '../renderer/lib/agent-attempt.ts'
/** mount 前由可信 native activeRuns 恢复同一 Jotai running gate。 */
import { nativeQueueChainsAtom } from '../renderer/hooks/native-queue-state.ts'
import { getDefaultStore } from 'jotai'
import { agentChannelIdAtom, agentModelIdAtom, agentDefaultReasoningEffortAtom, agentStreamingStatesAtom } from '../renderer/atoms/agent-atoms.ts'
import type { ActiveRun } from './protocol.ts'
export function seedActiveRuns(runs: ActiveRun[]): void {
  const store = getDefaultStore()
  for (const run of runs) {
    restoreAgentAttempt(store,run.sessionId,run.requestId)
    const payload=run.currentSnapshot.payload
    if(payload.kind==='asci_event' && payload.event.type==='native_chain_snapshot') {
      const event=payload.event
      store.set(nativeQueueChainsAtom, previous => new Map(previous).set(run.sessionId,{chainId:run.requestId,revision:event.revision,boundary:0,executions:event.executions.map(group=>group.runId)}))
    }
  }
  store.set(agentStreamingStatesAtom, (previous) => {
    const states = new Map(previous)
    for (const run of runs) states.set(run.sessionId, { running: true, content: '', toolActivities: [], teammates: [], startedAt: run.startedAt })
    return states
  })
}

/** 只在可信受管 bootstrap 初始化；空目录保持未配置，不采用 SDK 默认档位。 */
export function seedCredentialedState(bootstrap: import('./protocol.ts').Bootstrap, store = getDefaultStore()): void {
 if (!bootstrap.credentialedChannels) return
 store.set(agentDefaultReasoningEffortAtom, bootstrap.platformSnapshot.settings.agentEffort ?? '')
 store.set(agentChannelIdAtom, bootstrap.platformSnapshot.settings.agentChannelId || null)
 store.set(agentModelIdAtom, bootstrap.platformSnapshot.settings.agentModelId || null)
}

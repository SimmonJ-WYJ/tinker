import { restoreAgentAttempt } from '../renderer/lib/agent-attempt.ts'
/** mount 前由可信 native activeRuns 恢复同一 Jotai running gate。 */
import { nativeQueueChainsAtom } from '../renderer/hooks/native-queue-state.ts'
import { getDefaultStore } from 'jotai'
import { agentStreamingStatesAtom } from '../renderer/atoms/agent-atoms.ts'
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

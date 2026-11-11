/** mount 前由可信 native activeRuns 恢复同一 Jotai running gate。 */
import { getDefaultStore } from 'jotai'
import { agentStreamingStatesAtom } from '../renderer/atoms/agent-atoms.ts'
import type { ActiveRun } from './protocol.ts'
export function seedActiveRuns(runs: ActiveRun[]): void {
  const store = getDefaultStore()
  store.set(agentStreamingStatesAtom, (previous) => {
    const states = new Map(previous)
    for (const run of runs) states.set(run.sessionId, { running: true, content: '', toolActivities: [], teammates: [], startedAt: run.startedAt })
    return states
  })
}

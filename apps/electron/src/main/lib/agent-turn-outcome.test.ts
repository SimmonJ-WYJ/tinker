import { expect, test } from 'bun:test'
import { getAgentTurnFailure, hasAgentOutput } from './agent-turn-outcome.ts'

test('unfinished and empty-success turns fail instead of silently succeeding', () => {
 expect(getAgentTurnFailure(undefined, false)).toBe('ASCI_INCOMPLETE_RESPONSE')
 expect(getAgentTurnFailure(undefined, true)).toBe('ASCI_INCOMPLETE_RESPONSE')
 expect(getAgentTurnFailure('success', false)).toBe('ASCI_EMPTY_RESPONSE')
 expect(getAgentTurnFailure('success', true)).toBeNull()
 expect(getAgentTurnFailure('success', false, true)).toBeNull()
 expect(getAgentTurnFailure('error_max_turns', false)).toBeNull()
})
test('only fresh top-level text or tool calls count as output', () => {
 const message = {type:'assistant',message:{content:[{type:'text',text:'OK'}]}}
 expect(hasAgentOutput(message)).toBe(true)
 expect(hasAgentOutput({...message,isReplay:true})).toBe(false)
 expect(hasAgentOutput({...message,parent_tool_use_id:'worker'})).toBe(false)
 expect(hasAgentOutput({type:'assistant',message:{content:[{type:'text',text:'  '},{type:'thinking'}]}})).toBe(false)
 expect(hasAgentOutput({type:'assistant',message:{content:[{type:'tool_use',id:'edit'}]}})).toBe(true)
})

import { expect, test } from 'bun:test'
import { parseProjectTaskStatuses } from './project-tasks'

test('accepts one task per project conversation and rejects ambiguous or malformed status replies', () => {
  const row = { sessionId: 's-a', requestId: 'attempt-1', status: 'interrupted' }
  expect(parseProjectTaskStatuses([row])).toEqual([row])
  for (const value of [null, {}, [null], [row, row], [{ ...row, sessionId: '' }], [{ ...row, requestId: '' }], [{ ...row, status: 'maybe' }]]) {
    expect(() => parseProjectTaskStatuses(value)).toThrow()
  }
})

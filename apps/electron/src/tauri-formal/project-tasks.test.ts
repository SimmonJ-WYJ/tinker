import { expect, test } from 'bun:test'
import { parseProjectTaskStatuses, supportsProjectTaskStatuses } from './project-tasks'

test('reads the latest task kind and status while accepting older text-only hosts', () => {
  const row = { sessionId: 's-a', requestId: 'attempt-1', status: 'interrupted' }
  expect(parseProjectTaskStatuses([row])).toEqual([{ ...row, kind: 'text' }])
  expect(() => parseProjectTaskStatuses([row], true)).toThrow('invalidReply')
  for (const kind of ['text', 'imageGenerate', 'imageEdit']) {
    expect(parseProjectTaskStatuses([{ ...row, kind }], true)).toEqual([{ ...row, kind }])
  }
  for (const value of [null, {}, [null], [row, row], [{ ...row, kind: null }], [{ ...row, kind: 'tool' }],
    [{ ...row, sessionId: '' }], [{ ...row, requestId: '' }], [{ ...row, status: 'maybe' }]]) {
    expect(() => parseProjectTaskStatuses(value)).toThrow()
  }
})

test('enables project task reads only when a managed host advertises them', () => {
  const legacy = { nativeTaskLifecycle: true }
  const managed = { ...legacy, credentialedChannels: true }
  expect(supportsProjectTaskStatuses({ ...managed, nativeProjectTaskStatuses: true })).toBe(true)
  expect(supportsProjectTaskStatuses(managed)).toBe(false)
  expect(supportsProjectTaskStatuses(legacy)).toBe(true)
  expect(supportsProjectTaskStatuses({ ...legacy, nativeProjectTaskStatuses: false })).toBe(false)
  expect(supportsProjectTaskStatuses({})).toBe(false)
})

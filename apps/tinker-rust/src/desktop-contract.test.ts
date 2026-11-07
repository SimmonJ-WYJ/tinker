import { test, expect } from 'bun:test'
import { decodeSnapshot } from './desktop-contract.ts'
const old = { protocolVersion: 1, architecture: 'arm64', draft: ' 中文\n ' } as const
test('old IPC v1 does not imply durable storage', () => {
  expect(decodeSnapshot(old)).toEqual({ ...old, storageKind: 'memory', recoveryRequired: false })
})
test('file contract preserves revision and recovery status', () => {
  const file = { ...old, storageKind: 'file', sessionId: 'draft', revision: 7, recoveryRequired: true } as const
  expect(decodeSnapshot(file)).toEqual(file)
})
test('future and malformed contracts fail closed', () => {
  for (const value of [null, { ...old, protocolVersion: 2 }, { ...old, storageKind: 'file' }, { ...old, storageKind: 'database' }, { ...old, storageKind: 'file', sessionId: '../x', revision: 0, recoveryRequired: false }, { ...old, storageKind: 'file', sessionId: 'draft', revision: -1, recoveryRequired: false }]) expect(() => decodeSnapshot(value)).toThrow()
})

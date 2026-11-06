import { expect, test } from 'bun:test'
import { ASCI_PERMISSION_MODE_ORDER, migratePermissionMode } from './agent'

test('ASCI permission modes do not expose SDK auto as a top-level mode', () => {
  expect(ASCI_PERMISSION_MODE_ORDER).toEqual(['acceptEdits', 'bypassPermissions', 'plan'])
})

test('legacy auto permission mode migrates to acceptEdits', () => {
  expect(migratePermissionMode('auto')).toBe('acceptEdits')
})

import { expect, mock, test } from 'bun:test'
import { createProjectBackups } from './project-backups'

const inspection = { token: 'approved-token', projectName: 'Example', sessionCount: 2, documentCount: 3, imageCount: 4 }

test('project backup adapter gives native selectors no renderer file path and restores only the approved snapshot', async () => {
  const command = mock(async (name: string) => ({ value: ({
    exportProjectBackup: false,
    pickProjectBackup: inspection,
    restoreProjectBackup: { workspaceId: 'restored', alreadyRestored: false },
    discardProjectBackup: true,
  } as Record<string, unknown>)[name] }))
  const backups = createProjectBackups(command)
  expect(await backups.exportBackup('example')).toBe(false)
  expect(await backups.pick()).toEqual(inspection)
  expect(await backups.restore(inspection.token)).toEqual({ workspaceId: 'restored', alreadyRestored: false })
  await backups.discard(inspection.token)
  expect(command.mock.calls).toEqual([
    ['exportProjectBackup', { workspaceId: 'example' }],
    ['pickProjectBackup'],
    ['restoreProjectBackup', { token: inspection.token }],
    ['discardProjectBackup', { token: inspection.token }],
  ])
})

test('project backup adapter distinguishes cancellation and rejects malformed counts or receipts', async () => {
  const adapter = (value: unknown) => createProjectBackups(async () => ({ value }))
  expect(await adapter(null).pick()).toBeNull()
  await expect(adapter({ ...inspection, documentCount: -1 }).pick()).rejects.toThrow()
  await expect(adapter({ workspaceId: 'restored' }).restore(inspection.token)).rejects.toThrow()
  await expect(adapter('true').exportBackup('example')).rejects.toThrow()
})

import { expect, mock, test } from 'bun:test'
import { createSessionImporter } from './session-import'

const fixture = { cancelled: false, unconfirmed: 0, imported: 2, unchanged: 1, skipped: 1, warnings: { missingAttachment: 2 } }

test('the renderer opens one host-owned picker without any filesystem argument', async () => {
  const invoke = mock(async (_command: string) => ({ value: fixture }))
  expect(await createSessionImporter(invoke)()).toEqual(fixture)
  expect(invoke.mock.calls).toEqual([['importElectronSessions']])
})

test('only validated counts and fixed warning codes can reach the import report', async () => {
  const unknown = { ...fixture, warnings: { '/private/home/file': 4, missingAttachment: 2 } }
  expect((await createSessionImporter(async () => ({ value: unknown }))()).warnings).toEqual({
    missingAttachment: 2, other: 4,
  })
  for (const broken of [null, { ...fixture, imported: -1 }, { ...fixture, warnings: { missingAttachment: false } }, { ...fixture, cancelled: true }]) {
    await expect(createSessionImporter(async () => ({ value: broken }))()).rejects.toThrow()
  }
})

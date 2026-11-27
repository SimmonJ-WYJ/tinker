import { expect, test } from 'bun:test'
import { createNativeImageFiles } from './image-files'

const source = {
  imageId: 'import-a',
  filename: 'import-a.png',
  localPath: 'sid/import-a.png',
  mediaType: 'image/png',
  displayName: 'source.jpg',
} as const

test('imports the selected normalized session artifact and keeps its display name', async () => {
  const calls: unknown[] = []
  const files = createNativeImageFiles(
    async (name, args) => {
      calls.push([name, args])
      return { value: source }
    },
    async path => {
      calls.push(path)
      return 'eA=='
    },
  )
  expect(await files.pick('sid')).toEqual({
    imageId: 'import-a',
    displayName: 'source.jpg',
    generatedImage: {
      localPath: source.localPath,
      filename: source.filename,
      mediaType: source.mediaType,
    },
    previewSrc: 'data:image/png;base64,eA==',
  })
  expect(calls).toEqual([['pickImageFile', { sessionId: 'sid' }], source.localPath])
})

test('cancel and foreign reply never read bytes', async () => {
  for (const reply of [null, source]) {
    const files = createNativeImageFiles(
      async () => ({ value: reply }),
      async () => { throw Error('must not read') },
    )
    if (reply) {
      await expect(files.pick('other')).rejects.toThrow()
    } else {
      expect(await files.pick('sid')).toBeNull()
    }
  }
})

test('duplicate saves share one sheet with only the committed basename', async () => {
  const calls: unknown[] = []
  let cancel!: () => void
  const files = createNativeImageFiles((name, args) => {
    calls.push([name, args])
    return new Promise(resolve => { cancel = () => resolve({ value: false }) })
  }, async () => '')
  const first = files.save(source.localPath)
  const second = files.save(source.localPath)
  cancel()
  expect(await Promise.all([first, second])).toEqual([false, false])
  expect(calls).toEqual([['saveImageFile', { sessionId: 'sid', filename: 'import-a.png' }]])
  await expect(files.save('/private/not-an-artifact.png')).rejects.toThrow()
})

test('prepares only the selected historical message and managed basename', async () => {
  const filename = 'legacy-' + 'a'.repeat(64) + '.png'
  const messageId = 'electron-import:sid:m2'
  const link = { sourceMessageId: messageId, sourceAttachmentPath: 'sid/' + filename }
  const calls: unknown[] = []
  let reply = { ...source, ...link }
  const files = createNativeImageFiles(async (name, args) => {
    calls.push([name, args])
    return { value: reply }
  }, async path => { calls.push(path); return 'YQ==' })

  expect(typeof files.prepareHistoryImage).toBe('function')
  expect(await files.prepareHistoryImage!('sid', messageId, filename)).toMatchObject(link)
  expect(calls).toEqual([['prepareHistoryImage', { sessionId: 'sid', messageId, filename }], source.localPath])
  calls.length = 0
  reply = { ...reply, sourceMessageId: 'another-message' }
  await expect(files.prepareHistoryImage!('sid', messageId, filename)).rejects.toThrow()
  expect(calls).toHaveLength(1)
  await expect(files.prepareHistoryImage!('sid', messageId, '../' + filename)).rejects.toThrow()
  expect(calls).toHaveLength(1)
})

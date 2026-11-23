import type { SelectedImageVersion } from '../renderer/atoms/image-edit-atoms'

interface ImportedImageFile {
  imageId: string
  localPath: string
  filename: string
  mediaType: 'image/png'
  displayName: string
}

type FileCommand = (name: string, args: Record<string, unknown>) => Promise<{ value: unknown }>

export interface NativeImageFiles {
  pick(sessionId: string): Promise<SelectedImageVersion | null>
  save(localPath: string): Promise<boolean>
}

/** 文件选择、格式校验和目标路径都归宿主管理；前端只传递会话内附件标识。 */
export function createNativeImageFiles(
  command: FileCommand,
  read: (localPath: string) => Promise<string>,
): NativeImageFiles {
  const saving = new Map<string, Promise<boolean>>()
  return {
    async pick(sessionId) {
      const { value } = await command('pickImageFile', { sessionId })
      if (value === null) return null
      const file = value as Partial<ImportedImageFile> | undefined
      if (
        !file || typeof file.imageId !== 'string' || !/^[\w-]+$/.test(file.imageId)
        || file.filename !== `${file.imageId}.png`
        || file.localPath !== `${sessionId}/${file.filename}`
        || file.mediaType !== 'image/png' || typeof file.displayName !== 'string'
      ) throw new Error('invalidImageFile')

      const { localPath, filename, mediaType } = file
      const bytes = await read(localPath)
      if (!bytes) throw new Error('invalidImageFile')
      return {
        imageId: file.imageId,
        displayName: file.displayName,
        generatedImage: { localPath, filename, mediaType },
        previewSrc: 'data:image/png;base64,' + bytes,
      }
    },

    async save(localPath) {
      const match = /^([\w-]+)\/([\w-]+\.png)$/.exec(localPath)
      if (!match) throw new Error('invalidImageFile')
      const pending = saving.get(localPath)
      if (pending) return pending

      const [, sessionId, filename] = match
      const result = command('saveImageFile', { sessionId, filename }).then(({ value }) => {
        if (typeof value !== 'boolean') throw new Error('invalidImageFile')
        return value
      })
      saving.set(localPath, result)
      try {
        return await result
      } finally {
        saving.delete(localPath)
      }
    },
  }
}

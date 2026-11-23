import { toast } from 'sonner'
import { i18n } from '@/lib/i18n'
import type { SelectedImageVersion } from '@/atoms/image-edit-atoms'

/** 错误提示只采用宿主公开的本地化错误码；绝对路径和系统错误不进入提示。 */
export function reportImageFileError(error: unknown): void {
  const code = error && typeof error === 'object' && 'code' in error ? error.code : undefined
  const keys = [
    'imageFileExists', 'invalidImageFile', 'imageTooLarge', 'imageStorageLimit', 'unsupportedImageFormat',
    'imageDialogBusy', 'imageFileUnavailable', 'imageNotFound',
  ] as const
  const known = keys.find(key => key === code)
  toast.error(i18n.t(`desktopRuntime.${known ?? 'imageFileUnavailable'}`, { ns: 'errors' }))
}

export function nativeImageSave(localPath?: string): (() => void) | undefined {
  const files = window.__TAURI_FORMAL__?.imageFiles
  if (files && localPath) return () => { void files.save(localPath).catch(reportImageFileError) }
}

/** 只有在选图期间仍打开原会话、且用户没有另选引用时，才接收异步选择。 */
export async function applyPickedImage(
  pick: () => Promise<SelectedImageVersion | null>,
  stillCurrent: () => boolean,
  select: (image: SelectedImageVersion) => void,
): Promise<void> {
  const selected = await pick()
  if (selected && stillCurrent()) select(selected)
}

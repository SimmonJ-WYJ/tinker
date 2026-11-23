import * as React from 'react'
import { useStore } from 'jotai'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { applyPickedImage, nativeImageSave, reportImageFileError } from '@/components/agent/native-image-files'
import { useT } from '@/hooks/useT'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import type { PreviewRendererProps } from '../preview-registry'

const IMAGE_MIME_TYPES: Record<string, string> = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', bmp: 'image/bmp', ico: 'image/x-icon', avif: 'image/avif',
}

interface ImageSource {
  path: string
  url: string
  release: () => void
}

/** 复用预览二进制桥接，避免 file:// 的 URL 转义与 renderer 安全策略问题。 */
export default function ImageRenderer({ path, displayName, onError }: PreviewRendererProps): React.ReactElement {
  const { t } = useT('preview')
  const { t: tCommon } = useT('common')
  const [image, setImage] = React.useState<ImageSource | null>(null)
  const [decoded, setDecoded] = React.useState(false)
  const [expanded, setExpanded] = React.useState(false)
  const store = useStore()
  const openTarget = React.useRef<object | null>(null)
  React.useLayoutEffect(() => {
    openTarget.current = expanded ? {} : null
    return () => { openTarget.current = null }
  }, [path, expanded])
  const nativePath = window.__TAURI_FORMAL__?.imageFiles
    ? /\/deliverables\/([\w-]+)\/((?:img|ref)-[a-f0-9]{32})\.png$/.exec(path)
    : null
  const localPath = nativePath ? nativePath[1] + '/' + nativePath[2] + '.png' : undefined
  const currentImage = image?.path === path ? image : null
  const fileName = path.split(/[/\\]/).pop() || t('image.lightboxAlt')

  React.useEffect(() => {
    let cancelled = false
    let blobUrl: string | null = null
    const release = (): void => {
      if (blobUrl) URL.revokeObjectURL(blobUrl)
      blobUrl = null
    }
    setImage(null)
    setDecoded(false)
    setExpanded(false)
    void (async (): Promise<void> => {
      try {
        const base64 = await window.electronAPI.previewReadBinary(path)
        if (cancelled) return
        const binary = atob(base64)
        const bytes = new Uint8Array(binary.length)
        for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
        const ext = path.split('.').pop()?.toLowerCase() ?? ''
        blobUrl = URL.createObjectURL(new Blob([bytes], { type: IMAGE_MIME_TYPES[ext] ?? 'application/octet-stream' }))
        setImage({ path, url: blobUrl, release })
      } catch {
        if (!cancelled) onError(new Error(t('image.loadFailed')))
      }
    })()
    return () => {
      cancelled = true
      release()
    }
  }, [path, onError, t])

  const handleDecodeError = (): void => {
    currentImage?.release()
    setImage(null)
    setDecoded(false)
    setExpanded(false)
    onError(new Error(t('image.loadFailed')))
  }

  const handleSave = (): void => {
    if (!currentImage || !decoded) return
    const anchor = document.createElement('a')
    anchor.href = currentImage.url
    anchor.download = fileName
    anchor.click()
  }

  const editNativeImage = (): void => {
    if (!nativePath || !localPath) return
    const owner = nativePath[1]!
    const imageId = nativePath[2]!
    const previous = store.get(imageEditDraftsAtom).get(owner)
    const token = openTarget.current
    void applyPickedImage(
      async () => {
        const bytes = await window.electronAPI.readAttachment(localPath)
        return {
          imageId,
          displayName,
          generatedImage: { localPath, filename: fileName, mediaType: 'image/png' },
          previewSrc: 'data:image/png;base64,' + bytes,
        }
      },
      () => !!token && openTarget.current === token && store.get(imageEditDraftsAtom).get(owner) === previous,
      image => {
        store.set(imageEditDraftsAtom, drafts => new Map(drafts).set(owner, image))
        setExpanded(false)
      },
    ).catch(reportImageFileError)
  }

  return (
    <div className="flex items-center justify-center h-full overflow-auto bg-muted/10 p-4 scrollbar-thin">
      {currentImage ? (
        <button
          type="button"
          aria-label={t('image.lightboxAlt')}
          disabled={!decoded}
          onClick={() => setExpanded(true)}
          className="flex max-w-full max-h-full items-center justify-center cursor-zoom-in rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          <img
            key={currentImage.url}
            src={currentImage.url}
            alt={displayName ?? fileName}
            className="max-w-full max-h-full object-contain"
            onLoad={() => setDecoded(true)}
            onError={handleDecodeError}
          />
        </button>
      ) : (
        <div role="status" className="text-xs text-muted-foreground">{tCommon('loading')}</div>
      )}
      <ImageLightbox
        src={currentImage?.url ?? null}
        alt={displayName ?? fileName}
        open={expanded && !!currentImage}
        onOpenChange={setExpanded}
        onSave={window.__TAURI_FORMAL__ ? nativeImageSave(localPath) : handleSave}
        onEdit={nativePath && localPath ? editNativeImage : undefined}
      />
    </div>
  )
}

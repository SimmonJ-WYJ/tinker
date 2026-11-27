/** 分支只展示宿主确认的旧输入图；放大、权限选择和提交是独立操作。 */
import * as React from 'react'
import type { UserImageEditReference } from '@asci/shared'
import { useT } from '@/hooks/useT'
import { Button } from '@/components/ui/button'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { nativeImageAssets, useImageSource } from '@/lib/image-asset-reads'

interface RevisionImageReferenceProps {
  sessionId: string
  reference: UserImageEditReference
  attached: boolean
  onAttach: (attached: boolean) => void
}

export function RevisionImageReference({sessionId, reference, attached, onAttach}: RevisionImageReferenceProps) {
  const { t } = useT('conversation')
  const { t: tCommon } = useT('common')
  const localPath = reference.localPath.startsWith(sessionId + '/') && nativeImageAssets(reference.localPath)
    ? reference.localPath : undefined
  const thumbnail = useImageSource(localPath, 'image/png', 'thumbnail')
  const [open, setOpen] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const label = reference.displayName ?? reference.filename
  return <div data-revision-image data-image-id={reference.imageId} className="mx-3 mt-2 flex items-center gap-3 rounded-lg bg-muted/60 p-2">
    <button ref={trigger} data-revision-image-preview type="button" disabled={!thumbnail?.src}
      aria-label={tCommon('imageReference.view')} onClick={() => setOpen(true)} className="shrink-0 rounded">
      {thumbnail?.src && <img src={thumbnail.src} alt={label} className="size-12 rounded object-contain" />}
    </button>
    <div className="min-w-0 flex-1 text-sm">
      <p className="truncate font-medium" title={label}>{label}</p>
      <p className="text-muted-foreground" role="status">{t(attached ? 'revision.imageEdit' : 'revision.imageGenerate')}</p>
      {(!localPath || thumbnail?.failed) && <p role="alert">{tCommon('imageReference.loadFailed')}</p>}
    </div>
    {attached ? <Button data-revision-image-remove type="button" variant="ghost" size="sm" onClick={() => onAttach(false)}>
      {t('revision.removeImage')}
    </Button> : <Button data-revision-image-attach type="button" variant="ghost" size="sm" disabled={!thumbnail?.src} onClick={() => onAttach(true)}>
      {t('revision.attachImage')}
    </Button>}
    <ImageLightbox localPath={localPath} src={thumbnail?.src ?? null} alt={label} open={open}
      onOpenChange={setOpen} returnFocus={() => trigger.current?.focus()} />
  </div>
}

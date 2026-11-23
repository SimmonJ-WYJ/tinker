/** 只读取选中版本和明确父版本，不使用 latest，也不调整原图比例。 */
import * as React from 'react'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useT } from '@/hooks/useT'
import { useImageSource } from '@/lib/image-asset-reads'
import type { ImageVersion } from './image-versions'
function VersionPreview({ version, label, open }: { version: ImageVersion; label: string; open: boolean }): React.ReactElement {
  const { t } = useT('common')
  const { localPath, mediaType } = version.generatedImage
  const original = useImageSource(open ? localPath : undefined, mediaType, 'original')
  const [broken, setBroken] = React.useState<string>()
  const src = original?.src
  const failed = original?.failed || broken === src && Boolean(src)

  return (
    <figure className="min-w-0 space-y-2">
      <figcaption className="truncate text-sm font-medium" title={version.imageId}>
        {label} · {version.imageId?.slice(0, 8)}
      </figcaption>
      {failed ? (
        <p role="alert" className="text-sm text-muted-foreground">{t('imageVersion.missing')}</p>
      ) : src ? (
        <img src={src} alt={label} className="block h-auto max-h-[60vh] max-w-full object-contain" onError={() => setBroken(src)} />
      ) : (
        <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>
      )}
    </figure>
  )
}
export function ImageVersionCompare({ current, parent, open, onOpenChange, returnFocus }: {
  current: ImageVersion
  parent: ImageVersion
  open: boolean
  onOpenChange: (open: boolean) => void
  returnFocus: () => void
}): React.ReactElement {
  const { t } = useT('common')
  const descriptionId = React.useId()
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        aria-describedby={descriptionId}
        onCloseAutoFocus={event => { event.preventDefault(); returnFocus() }}
        className="max-h-[90vh] max-w-5xl overflow-y-auto"
      >
        <DialogHeader className="pr-8 text-left">
          <DialogTitle>{t('imageVersion.compare')}</DialogTitle>
          <DialogDescription className="sr-only">
            <span id={descriptionId}>{t('imageVersion.compareNote')}</span>
          </DialogDescription>
        </DialogHeader>
        <div className="grid grid-cols-2 items-start gap-4">
          <VersionPreview open={open} version={parent} label={t('imageVersion.source')} />
          <VersionPreview open={open} version={current} label={t('imageVersion.current')} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

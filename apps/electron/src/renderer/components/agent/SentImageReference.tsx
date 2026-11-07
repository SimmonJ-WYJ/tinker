import * as React from 'react'
import type { UserImageEditReference } from '@asci/shared'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useT } from '@/hooks/useT'

/** 已发送消息持有原图的确定引用，历史回看不再依赖输入区草稿或最新版本。 */
export function SentImageReference({ reference }: { reference: UserImageEditReference }): React.ReactElement {
  const { t } = useT('common')
  const [src, setSrc] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  const [open, setOpen] = React.useState(false)

  React.useEffect(() => {
    let active = true
    setSrc('')
    setFailed(false)
    setOpen(false)
    void window.electronAPI.readAttachment(reference.localPath)
      .then(data => { if (active) setSrc(`data:${reference.mediaType};base64,${data}`) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [reference.localPath, reference.mediaType, reference.imageId])

  if (failed) return <p role="alert" className="rounded-lg bg-muted p-3 text-sm text-muted-foreground">{t('imageVersion.missing')}</p>
  if (!src) return <p role="status" className="text-sm text-muted-foreground">{t('loading')}</p>

  return (
    <div className="mb-2 max-w-[300px] min-w-0" data-image-edit-reference={reference.imageId}>
      <button type="button" onClick={() => setOpen(true)} className="block max-w-full overflow-hidden rounded-lg focus-visible:outline focus-visible:outline-2">
        <img src={src} alt={reference.filename} className="max-w-full h-auto max-h-[200px] object-contain" onError={() => setFailed(true)} />
      </button>
      <ImageLightbox src={src} alt={reference.filename} open={open} onOpenChange={setOpen} />
    </div>
  )
}

import * as React from 'react'
import type { UserImageEditReference } from '@asci/shared'
import { useSetAtom } from 'jotai'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { nativeImageSave } from './native-image-files'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { useT } from '@/hooks/useT'
import { FileImage } from 'lucide-react'
import { useMessageReferenceNavigation } from './message-reference-navigation.tsx'

/** 已发送消息持有原图的确定引用，历史回看不再依赖输入区草稿或最新版本。 */
export function SentImageReference({ reference, sourceMessageId }: { reference: UserImageEditReference; sourceMessageId?: string }): React.ReactElement {
  const { t } = useT('common')
  const [src, setSrc] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  const [missingSource, setMissingSource] = React.useState(false)
  const trigger = React.useRef<HTMLButtonElement>(null)
  const navigation = useMessageReferenceNavigation()
  const setDrafts = useSetAtom(imageEditDraftsAtom)
  const canReuseImport = Boolean(window.__TAURI_FORMAL__?.imageFiles && reference.displayName)
  const available = !!sourceMessageId && !!navigation?.hasSource(sourceMessageId)
  React.useEffect(() => { setMissingSource(false) }, [reference.imageId, reference.localPath, sourceMessageId])

  React.useEffect(() => {
    let active = true
    setSrc('')
    setFailed(false)
    setOpen(false)
    void window.electronAPI.readAttachment(reference.localPath)
      .then(data => { if (active) setSrc(`data:${reference.mediaType};base64,${data}`) })
      .catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [reference.localPath, reference.mediaType, reference.imageId, attempt])

  return (
    <div className="conversation-reference" data-image-edit-reference={reference.imageId}>
      <button ref={trigger} type="button" className="conversation-reference__thumbnail" disabled={!failed && !src}
        aria-label={t(failed ? 'imageReference.retry' : 'imageReference.view')}
        onClick={() => { if (failed) setAttempt(value => value + 1); else setOpen(true) }}>
        {failed ? <FileImage aria-hidden="true" /> : src ? <img src={src} alt={reference.displayName ?? reference.filename} onError={() => { setFailed(true); setOpen(false) }} /> : <span aria-hidden="true" className="conversation-reference__skeleton" />}
      </button>
      <div className="conversation-reference__source">
        <p className="conversation-reference__title">{t('imageReference.title')}</p>
        {canReuseImport ? (
          <button type="button" className="conversation-reference__jump" disabled={!src || failed}
            onClick={() => {
              const { localPath, filename, mediaType } = reference
              const owner = localPath.split('/')[0]!
              setDrafts(drafts => new Map(drafts).set(owner, {
                imageId: reference.imageId,
                displayName: reference.displayName,
                generatedImage: { localPath, filename, mediaType },
                previewSrc: src,
              }))
            }}>
            {t('imageVersion.edit')}
          </button>
        ) : (
          <button type="button" className="conversation-reference__jump" disabled={!available} aria-label={t(available ? 'imageReference.backToSource' : 'imageReference.sourceMissing')}
            onClick={event => { if (sourceMessageId && !navigation?.jump(sourceMessageId, event.currentTarget)) setMissingSource(true) }}>
            {t(available && !missingSource ? 'imageReference.backToSource' : 'imageReference.sourceMissing')}
          </button>
        )}
        {failed && <span role="alert" className="conversation-reference__error">{t('imageReference.loadFailed')}</span>}
      </div>
      <ImageLightbox src={src} alt={reference.displayName ?? reference.filename} open={open && !failed} onOpenChange={setOpen}
        onSave={window.__TAURI_FORMAL__ ? nativeImageSave(reference.localPath) : () => { void window.electronAPI.saveImageAs(reference.localPath, reference.filename) }} returnFocus={() => trigger.current?.focus()} />
    </div>
  )
}

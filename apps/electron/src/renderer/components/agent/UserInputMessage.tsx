import { readImageThumbnail } from '@/lib/image-asset-reads'
import { useAtomValue } from 'jotai'
import { agentSessionsAtom } from '@/atoms/agent-atoms'
import { useAgentSessionId } from '@/contexts/session-context'
import { ProjectDocuments } from './ProjectDocuments'
import * as React from 'react'
import { Download, FileImage, FileText } from 'lucide-react'
import { resolveUserImageReferenceSource, type SDKAssistantMessage, type SDKMessage, type SDKUserMessage } from '@asci/shared'
import { Message, MessageContent, MessageActions, UserMessageContent } from '@/components/ai-elements/message'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { Button } from '@/components/ui/button'
import { CopyButton } from '@/components/common/CopyButton'
import { formatMessageTime } from '@/components/common/format-message-time'
import { useT } from '@/hooks/useT'
import { SentImageReference } from './SentImageReference.tsx'
import { nativeImageSave } from './native-image-files'
import { extractUserText, importedAttachmentFiles, isImportedConversationMessage, isImageFile, parseAttachedFiles, type AttachedFileRef } from './message-attachments.ts'

function UploadedImage({ file }: { file: AttachedFileRef }): React.ReactElement {
  const { t } = useT('common')
  const trigger = React.useRef<HTMLButtonElement>(null)
  const [src, setSrc] = React.useState('')
  const [failed, setFailed] = React.useState(false)
  const [open, setOpen] = React.useState(false)
  const [attempt, setAttempt] = React.useState(0)
  React.useEffect(() => {
    let active = true
    setSrc(''); setFailed(false); setOpen(false)
    const extension = file.filename.split('.').at(-1)?.toLowerCase() ?? 'png'
    const type = extension === 'jpg' ? 'jpeg' : extension === 'svg' ? 'svg+xml' : extension
    const mediaType = file.mediaType ?? `image/${type}`
    void readImageThumbnail(file.path).then(data => { if (active) setSrc(`data:${mediaType};base64,${data}`) }).catch(() => { if (active) setFailed(true) })
    return () => { active = false }
  }, [file.path, file.filename, file.mediaType, attempt])
  const save = file.mediaType ? nativeImageSave(file.path) : (): void => { void window.electronAPI.saveImageAs(file.path, file.filename) }
  return <figure className="conversation-upload" data-local-image-attachment={file.path}>
    <button ref={trigger} type="button" className="conversation-upload__preview" disabled={!failed && !src} aria-label={t(failed ? 'imageReference.retry' : 'imageReference.viewUpload')}
      onClick={() => { if (failed) setAttempt(value => value + 1); else setOpen(true) }}>
      {failed ? <FileImage aria-hidden="true" /> : src ? <img src={src} alt={file.filename} onError={() => { setFailed(true); setOpen(false) }} /> : <span className="conversation-reference__skeleton" aria-hidden="true" />}
    </button>
    <figcaption className="sr-only">{t('imageReference.uploaded')}</figcaption>
    {!failed && src && save && <Button type="button" variant="overlay" size="icon-xs" onClick={save} aria-label={t('image.save')} className="conversation-upload__save"><Download aria-hidden="true" /></Button>}
    <ImageLightbox localPath={file.path} src={src} alt={file.filename} open={open && !failed} onOpenChange={setOpen} onSave={save} returnFocus={() => trigger.current?.focus()} />
  </figure>
}

function PassiveAttachments({ files }: { files: AttachedFileRef[] }): React.ReactElement {
  const isImage = (file: AttachedFileRef): boolean => file.mediaType ? file.mediaType === 'image/png' : isImageFile(file.filename)
  const images = files.filter(isImage)
  const otherFiles = files.filter(file => !isImage(file))
  return <>
    {images.length > 0 && <div className="conversation-user__uploads">{images.map(file => <UploadedImage key={file.path} file={file} />)}</div>}
    {otherFiles.length > 0 && <div className="conversation-user__files">{otherFiles.map(file => <span key={file.path} className="conversation-user__file"><FileText aria-hidden="true" />{file.filename}</span>)}</div>}
  </>
}

/** 历史助手正文按文本回放；不加载其中的外链图片，不执行工具。 */
export function ImportedAssistantMessage({ message }: { message: SDKAssistantMessage }): React.ReactElement {
  const text = message.message.content.flatMap(block =>
    block.type === 'text' && typeof block.text === 'string' ? [block.text] : [],
  ).join('\n')
  return (
    <Message from="assistant">
      <MessageContent>
        {text && <p className="whitespace-pre-wrap break-words">{text}</p>}
        <PassiveAttachments files={importedAttachmentFiles(message)} />
      </MessageContent>
    </Message>
  )
}

function SentDocumentSource({ source }: { source: NonNullable<SDKUserMessage['_desktopDocumentSource']> }) {
  const sessionId = useAgentSessionId()
  const workspaceId = useAtomValue(agentSessionsAtom).find(session => session.id === sessionId)?.workspaceId
  return workspaceId ? <ProjectDocuments key={workspaceId} workspaceId={workspaceId} source={source} /> : null
}

export function UserInputMessage({ message, allMessages }: { message: SDKUserMessage; allMessages: SDKMessage[] }): React.ReactElement {
  const content = extractUserText(message) ?? ''
  const imported = isImportedConversationMessage(message)
  const { files, text } = imported
    ? { files: importedAttachmentFiles(message), text: content }
    : parseAttachedFiles(content)
  const raw = message as unknown as Record<string, unknown>
  const createdAt = typeof raw._createdAt === 'number' ? raw._createdAt : undefined
  const source = resolveUserImageReferenceSource(message, allMessages)
  return <Message from="user" className="conversation-user">
    <PassiveAttachments files={files} />
    {window.__TAURI_FORMAL__?.projectDocuments && message._desktopDocumentSource && <SentDocumentSource source={message._desktopDocumentSource} />}
    {(text || message.imageEditReference) && <div className="conversation-user__bubble">
      {message.imageEditReference && <SentImageReference reference={message.imageEditReference} sourceMessageId={source} />}
      {text && <UserMessageContent className="conversation-user__text" plainText={imported}>{text}</UserMessageContent>}
    </div>}
    {(text || createdAt) && <MessageActions className="conversation-user__metadata">
      {createdAt && <span>{formatMessageTime(createdAt)}</span>}
      {text && <CopyButton content={text} />}
    </MessageActions>}
  </Message>
}

/** 独立于历史消息展示预检和传输错误，避免空历史把错误吞成首页。 */
import { useAtomValue, useStore } from 'jotai'
import { AlertTriangle } from 'lucide-react'
import { agentPendingFilesAtom, agentPendingMentionsAtom, agentSessionDraftsAtom, agentSessionDraftHtmlAtom, agentStreamErrorsAtom, agentStreamingStatesAtom } from '@/atoms/agent-atoms'
import { imageEditDraftsAtom } from '@/atoms/image-edit-atoms'
import { sendRecoveryDraftsAtom } from '@/atoms/send-recovery-atoms'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
export function AgentFailureRecovery({sessionId}: {sessionId: string}): React.ReactElement | null {
  const {t} = useT('common'); const store = useStore()
  const error = useAtomValue(agentStreamErrorsAtom).get(sessionId)
  const running = useAtomValue(agentStreamingStatesAtom).get(sessionId)?.running
  const draft = useAtomValue(sendRecoveryDraftsAtom).get(sessionId)
  const text = useAtomValue(agentSessionDraftsAtom).get(sessionId)
  const html = useAtomValue(agentSessionDraftHtmlAtom).get(sessionId)
  const files = useAtomValue(agentPendingFilesAtom)
  const mentions = useAtomValue(agentPendingMentionsAtom)
  const image = useAtomValue(imageEditDraftsAtom).get(sessionId)
  const occupied = !!text || (!!html && html !== '<p></p>') || files.length > 0 || mentions.length > 0 || (!!image && image.imageId !== draft?.image?.imageId)
  if (!error || running) return null
  const restore = (): void => {
    if (!draft || occupied) return
    store.set(agentSessionDraftsAtom, previous => new Map(previous).set(sessionId, draft.text))
    store.set(agentSessionDraftHtmlAtom, previous => new Map(previous).set(sessionId, draft.html))
    window.__pendingAgentFileData ??= new Map()
    for (const [id, data] of draft.fileData) window.__pendingAgentFileData.set(id, data)
    store.set(agentPendingFilesAtom, draft.files)
    store.set(agentPendingMentionsAtom, draft.mentions)
    if (draft.image) store.set(imageEditDraftsAtom, previous => new Map(previous).set(sessionId, draft.image!))
    requestAnimationFrame(() => document.querySelector<HTMLElement>('.ProseMirror')?.focus())
  }
  return <div role="alert" className="mx-3 mb-2 rounded-lg border border-destructive/30 bg-background p-3 text-sm">
    <p className="flex items-center gap-2 font-medium"><AlertTriangle aria-hidden="true" className="size-4 shrink-0 text-destructive"/>{t('sendRecovery.title')}</p>
    <p className="mt-1 break-words text-destructive">{error}</p>
    <p className="mt-2 text-muted-foreground">{t('sendRecovery.notice')}</p>
    {draft && <>
      <details className="mt-2"><summary className="cursor-pointer">{t('sendRecovery.view')}</summary><p className="mt-2 whitespace-pre-wrap break-words">{draft.text}</p>{draft.files.map(file => <p key={file.id}>{file.filename}</p>)}</details>
      <Button type="button" variant="outline" className="mt-2" disabled={occupied} onClick={restore}>{t('sendRecovery.restore')}</Button>
      {occupied && <p className="mt-1 text-muted-foreground">{t('sendRecovery.occupied')}</p>}
    </>}
  </div>
}

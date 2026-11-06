/** 每个会话只保留最近一次发送快照；恢复不会提交网络请求。 */
import { atom } from 'jotai'
import type { AgentPendingFile } from '@asci/shared'
import type { AgentPendingMention } from './agent-atoms'
import type { SelectedImageVersion } from './image-edit-atoms'
export interface SendRecoveryDraft {
  text: string
  html: string
  files: AgentPendingFile[]
  mentions: AgentPendingMention[]
  image?: SelectedImageVersion
  fileData: Map<string, string>
}
export function captureSendDraft(draft: Omit<SendRecoveryDraft, 'fileData'>, data: Map<string, string>): SendRecoveryDraft {
  return {
    ...draft,
    files: draft.files.map(file => ({...file,
      // 原预览 blob 会在发送时释放，使用已暂存的数据恢复预览。
      previewUrl: file.previewUrl?.startsWith('blob:') && data.has(file.id)
        ? `data:${file.mediaType};base64,${data.get(file.id)}` : file.previewUrl,
    })),
    mentions: [...draft.mentions],
    fileData: new Map(draft.files.map(file => [file.id, data.get(file.id) ?? ''])),
  }
}
export const sendRecoveryDraftsAtom = atom(new Map<string, SendRecoveryDraft>())
/** 旧请求的结束回调不能清除后来发送的新草稿。 */
export const forgetSendDraftAtom = atom(null, (get, set, {sessionId, draft}: {sessionId: string; draft: SendRecoveryDraft}) => {
  const current = get(sendRecoveryDraftsAtom)
  if (current.get(sessionId) !== draft) return
  const next = new Map(current); next.delete(sessionId); set(sendRecoveryDraftsAtom, next)
})

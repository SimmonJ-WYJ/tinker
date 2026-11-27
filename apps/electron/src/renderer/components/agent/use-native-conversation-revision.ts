import * as React from 'react'
import { atom, useStore, type createStore } from 'jotai'
import { toast } from 'sonner'
import { nowMs, type AgentSessionMeta, type AgentEffort, type NativeDocumentReference, type AgentSendInput } from '@asci/shared'
import {
  agentMessageRefreshAtom, agentPendingFilesAtom, agentPendingMentionsAtom, agentSessionsAtom, agentSessionChannelMapAtom,
  agentSessionDraftsAtom, agentSessionDraftHtmlAtom, agentSessionModelMapAtom, agentStreamErrorsAtom, agentStreamingStatesAtom, currentAgentSessionIdAtom,
} from '@/atoms/agent-atoms'
import { captureSendDraft, forgetSendDraftAtom, sendRecoveryDraftsAtom } from '@/atoms/send-recovery-atoms'
import { registerAgentAttempt } from '@/lib/agent-attempt'
import { observeAgentSend } from '@/lib/agent-send'
import type { useOpenSession } from '@/hooks/useOpenSession'
import { useT } from '@/hooks/useT'
import type { RevisionAction } from './MessageMoreActions'
import { documentSelection } from '../../../tauri-formal/project-documents'
import { pendingNativeImageSelectionsAtom } from './use-native-image-selection'

/** 同一来源的准备操作在标签卸载、重新打开时仍只允许一个。 */
const preparingAtom = atom(new Set<string>())

/** 文字、选区或托管图片由当前一次明确提交绑定。 */
type RevisionAttachment = { document: NativeDocumentReference } | {
  nativeImageAction: 'generate'
} | { nativeImageAction: 'edit'; imageEditReferenceId: string }

export async function sendRevisionQuestion(store: ReturnType<typeof createStore>, session: AgentSessionMeta,
  prompt: string, route: NonNullable<AgentSessionMeta['nativeRevisionRoute']>, effort?: AgentEffort, attachment?: RevisionAttachment) {
  const requestId = registerAgentAttempt(store, session.id)
  if (!requestId) return
  const startedAt = nowMs()
  store.set(agentStreamingStatesAtom, rows => new Map(rows).set(session.id, {
    running: true, content: '', toolActivities: [], teammates: [], model: route.modelId, startedAt,
  }))
  store.set(agentStreamErrorsAtom, rows => { const next = new Map(rows); next.delete(session.id); return next })
  const draft = captureSendDraft({ text: prompt, html: '', files: [], mentions: [] }, new Map())
  store.set(sendRecoveryDraftsAtom, rows => new Map(rows).set(session.id, draft))
  for (const drafts of [agentSessionDraftsAtom, agentSessionDraftHtmlAtom]) {
    store.set(drafts, rows => { const next = new Map(rows); next.delete(session.id); return next })
  }
  // 使用原渠道版本；仅明确附加的定位进入本次请求。
  const media: Partial<AgentSendInput> = attachment && 'document' in attachment
    ? { nativeDocumentReference: documentSelection(attachment.document) } : attachment ?? {}
  const sent = window.electronAPI.sendAgentMessage({
    sessionId: session.id, workspaceId: session.workspaceId, userMessage: prompt, channelId: route.channelId,
    ...media,
    modelId: route.modelId, ...(effort && { effort }), expectedConfigRevision: route.configRevision, requestId, startedAt,
  })
  const consumeRoute = () => {
    store.set(agentSessionsAtom, rows => rows.map(row => {
      if (row.id !== session.id || !row.nativeRevisionRoute) return row
      const { nativeRevisionRoute: _route, nativeRevisionDocument: _suggestion, nativeRevisionImage: _image, ...rest } = row
      return rest
    }))
  }
  await observeAgentSend(store, session.id, requestId, sent.then(consumeRoute, async (error: unknown) => {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'sourceChannelUnavailable') {
      // 源路由预检拒绝，没有已提交的用户行。保留草稿，不覆盖用户随后输入的文字。
      store.set(agentSessionDraftsAtom, rows => rows.has(session.id) ? rows : new Map(rows).set(session.id, prompt))
    } else {
      // 回执丢失或上游报错可能已经写入历史，按请求身份核实；查询失败时保留手动恢复入口。
      try {
        const history = await window.electronAPI.getAgentSessionSDKMessages(session.id)
        if (history.some(m => m.type === 'user' && (m._desktopTextTaskRequestId === requestId || m._desktopImageTaskRequestId === requestId))) {
          consumeRoute()
          // 读取持久回执会推进宿主事件游标；让当前窗口也采用这份历史，避免仍显示运行中。
          store.set(agentMessageRefreshAtom, versions => new Map(versions).set(session.id, (versions.get(session.id) ?? 0) + 1))
          store.set(forgetSendDraftAtom, { sessionId: session.id, draft })
        }
      } catch { /* 回执未知时不自动重发或填入草稿。 */ }
    }
    throw error
  }), draft)
}

export function useNativeConversationRevision(sessionId: string, openSession: ReturnType<typeof useOpenSession>, hasLocalReference = false) {
  const store = useStore()
  const localReference = React.useRef(hasLocalReference)
  React.useLayoutEffect(() => { localReference.current = hasLocalReference }, [hasLocalReference])
  const open = React.useRef(openSession)
  const active = React.useRef(false)
  React.useLayoutEffect(() => { open.current = openSession }, [openSession])
  React.useLayoutEffect(() => {
    active.current = true
    return () => { active.current = false }
  }, [sessionId])
  const { t } = useT('conversation')
  const prepare = window.__TAURI_FORMAL__?.prepareRevision

  const revise = React.useCallback(async (upToMessageUuid: string, action: RevisionAction) => {
    if (!prepare || store.get(preparingAtom).has(sessionId) ||
        store.get(currentAgentSessionIdAtom) !== sessionId || store.get(agentStreamingStatesAtom).get(sessionId)?.running) return
    // 文件和提及为跨会话共享输入，不能被带入新分支或从来源悄然删除。
    const inputBusy = () => localReference.current || store.get(agentPendingFilesAtom).length > 0 || store.get(agentPendingMentionsAtom).length > 0 ||
      store.get(pendingNativeImageSelectionsAtom).has(sessionId)
    if (inputBusy()) { toast.info(t('revision.pendingInput')); return }
    store.set(preparingAtom, ids => new Set(ids).add(sessionId))
    let navigated = false
    const unsubscribe = store.sub(currentAgentSessionIdAtom, () => { navigated = true })
    try {
      const { session, prompt, effort } = await prepare({ sessionId, upToMessageUuid })
      const route = session.nativeRevisionRoute
      store.set(agentSessionsAtom, rows => [session, ...rows.filter(row => row.id !== session.id)])
      store.set(agentSessionChannelMapAtom, rows => new Map(rows).set(session.id, route.channelId))
      store.set(agentSessionModelMapAtom, rows => new Map(rows).set(session.id, route.modelId))
      if (!active.current || navigated || inputBusy() || store.get(agentStreamingStatesAtom).get(sessionId)?.running) {
        // 子分支已落盘。用户离开后只保留可继续编辑的草稿。
        store.set(agentSessionDraftsAtom, rows => new Map(rows).set(session.id, prompt))
        return
      }
      const needsReview = action === 'edit' || !!session.nativeRevisionDocument || !!session.nativeRevisionImage
      if (needsReview) store.set(agentSessionDraftsAtom, rows => new Map(rows).set(session.id, prompt))
      open.current('agent', session.id, session.title, session.workspaceId)
      if (needsReview) return

      await sendRevisionQuestion(store, session, prompt, route, effort)
    } catch (error) {
      if (active.current && !navigated) toast.error(t('revision.failed'), {
        description: error instanceof Error ? error.message : undefined,
      })
    } finally {
      unsubscribe()
      store.set(preparingAtom, ids => {
        const next = new Set(ids)
        next.delete(sessionId)
        return next
      })
    }
  }, [prepare, sessionId, store, t])
  return prepare ? revise : undefined
}

import { useStore } from 'jotai'
import { RotateCcw } from 'lucide-react'
import { nowMs, type SDKAssistantMessage } from '@asci/shared'
import { agentStreamErrorsAtom, agentStreamingStatesAtom, stoppedByUserSessionsAtom } from '@/atoms/agent-atoms'
import { Button } from '@/components/ui/button'
import { useT } from '@/hooks/useT'
import { registerAgentAttempt } from '@/lib/agent-attempt'
import { observeAgentSend } from '@/lib/agent-send'

/** 仅在宿主公开了任务身份时显示操作；重试不从当前草稿、模型或附件重建请求。 */
export function NativeTaskOutcome({ sessionId, message, canRetry }: {
  sessionId: string
  message: SDKAssistantMessage
  canRetry: boolean
}): React.ReactElement | null {
  const { t } = useT('conversation')
  const { t: tNav } = useT('nav')
  const store = useStore()
  const host = window.__TAURI_FORMAL__?.nativeTaskLifecycle
  const image = Boolean(message._desktopImageTaskRequestId)
  const previous = message._desktopImageTaskRequestId ?? message._desktopTextTaskRequestId
  const status = message._desktopImageTaskStatus ?? message._desktopRuntimeStatus
  if (!previous || !status) return null
  const retryable = canRetry && (status === 'failed' || status === 'interrupted')
  function retry() {
    if (!retryable || !host || !previous) return
    const requestId = registerAgentAttempt(store, sessionId)
    if (!requestId) return
    const startedAt = nowMs()
    store.set(agentStreamingStatesAtom, states => new Map(states).set(sessionId, {
      running: true, content: '', toolActivities: [], teammates: [], startedAt, model: message.message.model,
    }))
    store.set(stoppedByUserSessionsAtom, states => { const next = new Set(states); next.delete(sessionId); return next })
    store.set(agentStreamErrorsAtom, errors => { const next = new Map(errors); next.delete(sessionId); return next })
    void observeAgentSend(store, sessionId, requestId, host.retry({ sessionId, requestId, startedAt, retryOfRequestId: previous }))
  }
  if (image && !retryable) return null
  return <div className="mt-1 flex items-center gap-2 text-xs text-muted-foreground"
    data-native-task-status={image ? undefined : status} data-request-id={image ? undefined : previous}>
    {!image && <span>{tNav(`projectTask.${status}`)}</span>}
    {retryable && <Button type="button" variant="ghost" size="sm" data-native-task-retry="" onClick={retry}>
      <RotateCcw aria-hidden="true" size={14} />{t('agent.messages.actionRetry')}
    </Button>}
  </div>
}

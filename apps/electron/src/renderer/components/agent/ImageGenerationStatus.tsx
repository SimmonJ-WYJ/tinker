import * as React from 'react'
import { isNativeChannelError } from '@asci/shared'
import type { SDKAssistantMessage, SDKMessage, SDKToolUseBlock, SDKUserMessage } from '@asci/shared'
import { useT } from '@/hooks/useT'
import chevron from '@/assets/conversation/chevron-down.svg'
import { findToolResultInMessages } from './tool-result-lookup'
import { parseImageVersion } from './image-versions'
import { extractUserText, isImageFile, parseAttachedFiles } from './message-attachments'
import { RunningStatusText } from './RunningStatusText.tsx'

interface Props {
  nativeTask?: SDKAssistantMessage
  calls: SDKToolUseBlock[]
  allMessages: SDKMessage[]
  userMessage?: SDKUserMessage
  streaming?: boolean
  stopped?: boolean
  children: React.ReactNode
}

/** 状态仅依据真实生图工具调用及结果，不展示推理进度或虚构百分比。 */
export function ImageGenerationStatus({ nativeTask, calls, allMessages, userMessage, streaming, stopped, children }: Props): React.ReactElement {
  const { t } = useT('common')
  const { t: tErrors } = useT('errors')
  const { t: tNav } = useT('nav')
  const nativeStatus = nativeTask?._desktopImageTaskStatus
  const results = calls.map(call => findToolResultInMessages(call.id, allMessages))
  const pending = results.some(result => !result)
  const successes = results.filter(result => result && !result.isError && parseImageVersion(result.result)).length
  const nativeStates = { running: 'generating', completed: 'generated', failed: 'failed', cancelled: 'stopped', interrupted: 'incomplete' } as const
  const state = nativeStatus ? nativeStates[nativeStatus] : pending ? (stopped ? 'stopped' : streaming ? 'generating' : 'incomplete')
    : successes === calls.length ? 'generated' : successes > 0 ? 'partial' : 'failed'
  const quote = !!userMessage?.imageEditReference
  const upload = userMessage ? parseAttachedFiles(extractUserText(userMessage) ?? '').files.some(file => isImageFile(file.filename)) : false
  const description = nativeStatus === 'cancelled' || nativeStatus === 'interrupted' ? 'localStopDetail'
    : nativeStatus === 'failed' ? 'nativeFailureDetail'
    : state === 'generating'
    ? quote && upload ? 'combine' : quote ? 'quoteOnly' : upload ? 'uploadOnly' : 'create'
    : `${state}Detail` as const
  return <details className="conversation-image-task" data-agent-process="true" data-image-task-state={state}>
    <summary className="conversation-image-task__summary">
      <RunningStatusText active={state === 'generating'} className="conversation-image-task__title">{nativeStatus
        ? `${tNav(nativeTask?._desktopImageTaskKind === 'edit' ? 'projectTask.kind.imageEdit' : 'projectTask.kind.imageGenerate')} · ${tNav(`projectTask.${nativeStatus}`)}`
        : t(`imageReference.${state}`)}</RunningStatusText>
      <span className="conversation-image-task__detail"><span>{nativeStatus === 'failed' && isNativeChannelError(nativeTask?._desktopImageTaskError)
        ? tErrors(`desktopRuntime.${nativeTask._desktopImageTaskError}`) : t(`imageReference.${description}`)} · {t('imageReference.steps', { count: calls.length })}</span><span className="conversation-image-task__chevron"><img src={chevron} alt="" /></span></span>
    </summary>
    <div className="conversation-image-task__records">{children}</div>
  </details>
}

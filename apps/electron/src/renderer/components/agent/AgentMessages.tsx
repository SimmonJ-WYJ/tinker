/**
 * AgentMessages — Agent 消息列表
 *
 * 复用 Chat 的 Conversation/Message 原语组件，
 * 流式输出通过 SDK 渲染路径（MessageGroupRenderer）展示工具活动。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { FileText, FileImage, RotateCw, AlertTriangle, ChevronDown, ChevronRight, Plus, Minimize2, Download } from 'lucide-react'
import { ImageLightbox } from '@/components/ui/image-lightbox'
import { WelcomeEmptyState } from '@/components/welcome/WelcomeEmptyState'
import {
  Message,
  MessageContent,
  MessageActions,
  MessageResponse,
  SelectableMessageResponse,
  UserMessageContent,
} from '@/components/ai-elements/message'
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import type { MinimapItem } from '@/components/ai-elements/scroll-minimap'
import { useSmoothStream } from '@asci/ui'
import { CopyButton } from '@/components/common/CopyButton'
import { formatMessageTime } from '@/components/common/format-message-time'
import { formatTime } from '@/utils/dayjs'
import { Button } from '@/components/ui/button'
import { ToolActivityList } from './ToolActivityItem'
import { userProfileAtom } from '@/atoms/user-profile'
import { tabMinimapCacheAtom } from '@/atoms/tab-atoms'
import { ScrollPositionManager } from '@/hooks/useScrollPositionMemory'
import { cn } from '@/lib/utils'
import { MessageReferenceNavigation } from './message-reference-navigation.tsx'
import './conversation-flow.css'
import { AIThinkingOrb } from '@/components/ui/ai-thinking-orb'
import { getToolPhrase } from './tool-phrase'
import { taskModesAtom } from './TaskModeSelector'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { groupIntoTurns, MessageGroupRenderer, getGroupId, getGroupPreview, type MessageGroup } from './SDKMessageRenderer'
import { useT } from '@/hooks/useT'
import type { AgentMessage, AgentEventUsage, RetryAttempt, SDKMessage } from '@asci/shared'
import { nowMs } from '@asci/shared'
import type { ToolActivity, AgentStreamState } from '@/atoms/agent-atoms'

/** AgentMessages 属性接口 */
interface AgentMessagesProps {
  sessionId: string
  /** 用户在前端选择的模型 ID（用于显示渠道配置的 Model Name） */
  sessionModelId?: string
  messages: AgentMessage[]
  /** 消息是否已完成首次加载 */
  messagesLoaded?: boolean
  /** Phase 4: 持久化的 SDKMessage（新格式） */
  persistedSDKMessages?: SDKMessage[]
  streaming: boolean
  streamState?: AgentStreamState
  /** Phase 2: 实时 SDKMessage 列表（流式期间累积） */
  liveMessages?: SDKMessage[]
  /** 当前会话工作目录，用于解析相对文件路径 */
  sessionPath?: string | null
  /** 最后一轮是否被用户中断 */
  stoppedByUser?: boolean
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  onCompact?: () => void
}

/** 单张工具结果图片（内联显示），点击可预览大图 */
function InlineImage({ attachment }: { attachment: { localPath: string; filename: string; mediaType: string } }): React.ReactElement {
  const { t } = useT('common')
  const [imageSrc, setImageSrc] = React.useState<string | null>(null)
  const [lightboxOpen, setLightboxOpen] = React.useState(false)

  React.useEffect(() => {
    window.electronAPI
      .readAttachment(attachment.localPath)
      .then((base64) => {
        setImageSrc(`data:${attachment.mediaType};base64,${base64}`)
      })
      .catch((error) => {
        console.error('[InlineImage] 读取附件失败:', error)
      })
  }, [attachment.localPath, attachment.mediaType])

  const handleSave = React.useCallback((): void => {
    window.electronAPI.saveImageAs(attachment.localPath, attachment.filename)
  }, [attachment.localPath, attachment.filename])

  if (!imageSrc) {
    return <div className="size-[280px] rounded-lg bg-muted/30 animate-pulse shrink-0" />
  }

  return (
    <div className="relative group inline-block">
      <img
        src={imageSrc}
        alt={attachment.filename}
        className="size-[280px] rounded-lg object-cover shrink-0 cursor-pointer"
        onClick={() => setLightboxOpen(true)}
      />
      <Button
        type="button"
        variant="overlay"
        size="icon-xs"
        onClick={handleSave}
        className="absolute bottom-2 right-2 h-auto w-auto p-1.5 opacity-0 group-hover:opacity-100 transition-opacity"
        title={t('image.save')}
      >
        <Download className="size-4" />
      </Button>
      <ImageLightbox
        src={imageSrc}
        alt={attachment.filename}
        open={lightboxOpen}
        onOpenChange={setLightboxOpen}
        onSave={handleSave}
      />
    </div>
  )
}

/** 从工具活动中提取并内联显示所有生成的图片 */
function ToolResultInlineImages({ activities }: { activities: ToolActivity[] }): React.ReactElement | null {
  const allImages = activities.flatMap((a) => a.imageAttachments ?? [])
  if (allImages.length === 0) return null

  return (
    <div className="flex flex-wrap gap-2 mb-3">
      {allImages.map((img, i) => (
        <InlineImage key={`${img.localPath}-${i}`} attachment={img} />
      ))}
    </div>
  )
}

/** 从持久化事件中提取工具活动列表 */
function extractToolActivities(events: AgentMessage['events']): ToolActivity[] {
  if (!events) return []

  const activities: ToolActivity[] = []
  for (const event of events) {
    if (event.type === 'tool_start') {
      const existingIdx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (existingIdx >= 0) {
        activities[existingIdx] = {
          ...activities[existingIdx]!,
          input: event.input,
          intent: event.intent || activities[existingIdx]!.intent,
          displayName: event.displayName || activities[existingIdx]!.displayName,
        }
      } else {
        activities.push({
          toolUseId: event.toolUseId,
          toolName: event.toolName,
          input: event.input,
          intent: event.intent,
          displayName: event.displayName,
          done: true,
          parentToolUseId: event.parentToolUseId,
        })
      }
    } else if (event.type === 'tool_result') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = {
          ...activities[idx]!,
          result: event.result,
          isError: event.isError,
          done: true,
          imageAttachments: event.imageAttachments,
        }
      }
    } else if (event.type === 'task_backgrounded') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, isBackground: true, taskId: event.taskId }
      }
    } else if (event.type === 'shell_backgrounded') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, isBackground: true, shellId: event.shellId }
      }
    } else if (event.type === 'task_progress') {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, elapsedSeconds: event.elapsedSeconds }
      }
    } else if (event.type === 'task_started' && event.toolUseId) {
      const idx = activities.findIndex((t) => t.toolUseId === event.toolUseId)
      if (idx >= 0) {
        activities[idx] = { ...activities[idx]!, intent: event.description, taskId: event.taskId }
      }
    }
  }
  return activities
}

/** 解析的附件引用 */
interface AttachedFileRef {
  filename: string
  path: string
}

/** 解析消息中的 <attached_files> 块，返回文件列表和剩余文本 */
function parseAttachedFiles(content: string): { files: AttachedFileRef[]; text: string } {
  const regex = /<attached_files>\n?([\s\S]*?)\n?<\/attached_files>\n*/
  const match = content.match(regex)
  if (!match) return { files: [], text: content }

  const files: AttachedFileRef[] = []
  const lines = match[1]!.split('\n')
  for (const line of lines) {
    // 格式: - filename: /path/to/file
    const lineMatch = line.match(/^-\s+(.+?):\s+(.+)$/)
    if (lineMatch) {
      files.push({ filename: lineMatch[1]!.trim(), path: lineMatch[2]!.trim() })
    }
  }

  const text = content.replace(regex, '').trim()
  return { files, text }
}

/** 判断文件是否为图片类型 */
function isImageFile(filename: string): boolean {
  return /\.(png|jpe?g|gif|webp|svg|bmp|ico)$/i.test(filename)
}

/** 附件引用芯片 */
function AttachedFileChip({ file }: { file: AttachedFileRef }): React.ReactElement {
  const isImg = isImageFile(file.filename)
  const Icon = isImg ? FileImage : FileText

  return (
    <div className="inline-flex items-center gap-1.5 rounded-md bg-muted/60 px-2.5 py-1 text-sm text-muted-foreground">
      <Icon className="size-3.5 shrink-0" />
      <span className="truncate max-w-[200px]">{file.filename}</span>
    </div>
  )
}

/** 重试提示组件 - 折叠式 */
function RetryingNotice({ retrying }: { retrying: NonNullable<AgentStreamState['retrying']> }): React.ReactElement {
  const { t: tConv } = useT('conversation')
  const [expanded, setExpanded] = React.useState(false)
  const [countdown, setCountdown] = React.useState(0)

  // 倒计时逻辑
  React.useEffect(() => {
    if (retrying.failed || retrying.history.length === 0) {
      setCountdown(0)
      return
    }

    const lastAttempt = retrying.history[retrying.history.length - 1]
    if (!lastAttempt) return

    // 计算倒计时
    const updateCountdown = (): void => {
      const elapsed = (nowMs() - lastAttempt.timestamp) / 1000 // 已过去的秒数
      const remaining = Math.max(0, lastAttempt.delaySeconds - elapsed)
      setCountdown(Math.ceil(remaining))

      if (remaining <= 0) {
        setCountdown(0)
      }
    }

    // 立即更新一次
    updateCountdown()

    // 每 100ms 更新一次倒计时
    const timer = setInterval(updateCountdown, 100)
    return () => clearInterval(timer)
  }, [retrying.failed, retrying.history])

  return (
    <div className="rounded-lg border border-warning/30 bg-warning/10 p-3 mb-3">
      {/* 头部：简洁状态 */}
      <Button
        type="button"
        variant="subtle"
        size="row"
        className="px-0 py-0 hover:opacity-80 transition-opacity"
        onClick={() => setExpanded(!expanded)}
      >
        {retrying.failed ? (
          <AlertTriangle className="size-4 text-warning shrink-0" />
        ) : (
          <RotateCw className="size-4 animate-spin text-warning shrink-0" />
        )}
        <span className="text-sm text-warning flex-1">
          {retrying.failed
            ? tConv('agent.messages.retryTitle', { current: retrying.currentAttempt, max: retrying.maxAttempts })
            : countdown > 0
              ? tConv('agent.messages.retryCountdown', { countdown, current: retrying.currentAttempt, max: retrying.maxAttempts })
              : tConv('agent.messages.retrying', { current: retrying.currentAttempt, max: retrying.maxAttempts })}
          {retrying.history.length > 0 && ` · ${retrying.history[retrying.history.length - 1]?.reason}`}
        </span>
        {expanded ? (
          <ChevronDown className="size-4 text-warning shrink-0" />
        ) : (
          <ChevronRight className="size-4 text-warning shrink-0" />
        )}
      </Button>

      {/* 展开内容：重试历史 */}
      {expanded && retrying.history.length > 0 && (
        <div className="mt-3 space-y-3 border-t border-warning/30 pt-3">
          <div className="text-xs font-medium text-warning">
            {tConv('agent.messages.attemptHistory')}
          </div>
          {retrying.history.map((attempt, index) => (
            <RetryAttemptItem
              key={attempt.timestamp}
              attempt={attempt}
              isLatest={index === retrying.history.length - 1}
              isFailed={retrying.failed && index === retrying.history.length - 1}
            />
          ))}
          {!retrying.failed && (
            <div className="flex items-center gap-2 text-xs text-warning pl-6">
              {countdown > 0 ? (
                <>
                  <RotateCw className="size-3 animate-spin" />
                  <span>{tConv('agent.messages.countdownWait', { seconds: countdown, n: retrying.currentAttempt })}</span>
                </>
              ) : (
                <>
                  <RotateCw className="size-3 animate-spin" />
                  <span>{tConv('agent.messages.attempting', { n: retrying.currentAttempt })}</span>
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  )
}

/** 单条重试尝试记录 */
function RetryAttemptItem({
  attempt,
  isLatest,
  isFailed,
}: {
  attempt: RetryAttempt
  isLatest: boolean
  isFailed: boolean
}): React.ReactElement {
  const { t: tConv } = useT('conversation')
  const [showStderr, setShowStderr] = React.useState(false)
  const [showStack, setShowStack] = React.useState(false)

  const time = formatTime(attempt.timestamp)

  return (
    <div className={cn('pl-6 space-y-2', isLatest && 'font-medium')}>
      {/* 尝试头部 */}
      <div className="flex items-start gap-2">
        <span className="text-destructive shrink-0">❌</span>
        <div className="flex-1 min-w-0 space-y-1">
          <div className="text-xs text-warning">
            {tConv('agent.messages.attemptDetail', { n: attempt.attempt, time, reason: attempt.reason })}
          </div>
          <div className="text-xs text-warning break-words">
            {attempt.errorMessage}
          </div>

          {/* 环境信息 */}
          {attempt.environment && (
            <div className="text-sm text-warning space-y-0.5">
              <div>{tConv('agent.messages.envRuntime', { value: attempt.environment.runtime })}</div>
              <div>{tConv('agent.messages.envPlatform', { value: attempt.environment.platform })}</div>
              <div>{tConv('agent.messages.envModel', { value: attempt.environment.model })}</div>
              {attempt.environment.workspace && <div>{tConv('agent.messages.envWorkspace', { value: attempt.environment.workspace })}</div>}
            </div>
          )}

          {/* 可展开的 stderr */}
          {attempt.stderr && (
            <div className="mt-2">
              <Button
                type="button"
                variant="ghost"
                size="inline"
                className="flex items-center gap-1 text-warning hover:bg-transparent hover:underline [&_svg]:size-3"
                onClick={() => setShowStderr(!showStderr)}
              >
                {showStderr ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {tConv('agent.messages.showStderr')}
              </Button>
              {showStderr && (
                <pre className="mt-1 text-sm text-warning bg-warning/15 p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto scrollbar-thin">
                  {attempt.stderr}
                </pre>
              )}
            </div>
          )}

          {/* 可展开的堆栈跟踪 */}
          {attempt.stack && (
            <div className="mt-2">
              <Button
                type="button"
                variant="ghost"
                size="inline"
                className="flex items-center gap-1 text-warning hover:bg-transparent hover:underline [&_svg]:size-3"
                onClick={() => setShowStack(!showStack)}
              >
                {showStack ? (
                  <ChevronDown className="size-3" />
                ) : (
                  <ChevronRight className="size-3" />
                )}
                {tConv('agent.messages.showStack')}
              </Button>
              {showStack && (
                <pre className="mt-1 text-sm text-warning bg-warning/15 p-2 rounded overflow-x-auto max-h-[200px] overflow-y-auto scrollbar-thin">
                  {attempt.stack}
                </pre>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

/** AgentMessageItem 属性接口 */
interface AgentMessageItemProps {
  message: AgentMessage
  sessionPath?: string | null
  onRetry?: () => void
  onRetryInNewSession?: () => void
  onCompact?: () => void
}

function AgentMessageItem({ message, sessionPath, onRetry, onRetryInNewSession, onCompact }: AgentMessageItemProps): React.ReactElement | null {
  const { t: tConv } = useT('conversation')
  if (message.role === 'user') {
    const { files: attachedFiles, text: messageText } = parseAttachedFiles(message.content)

    return (
      <Message from="user">
        <MessageContent>
          {attachedFiles.length > 0 && (
            <div className="flex flex-wrap gap-1.5 mb-2">
              {attachedFiles.map((file) => (
                <AttachedFileChip key={file.path} file={file} />
              ))}
            </div>
          )}
          {messageText && (
            <UserMessageContent>{messageText}</UserMessageContent>
          )}
        </MessageContent>
        {messageText && (
          <MessageActions className="mt-0.5 justify-end">
            <span className="text-sm tabular-nums font-light">
              {formatMessageTime(message.createdAt)}
            </span>
            <CopyButton content={messageText} />
          </MessageActions>
        )}
      </Message>
    )
  }

  if (message.role === 'assistant') {
    const toolActivities = extractToolActivities(message.events)

    return (
      <Message from="assistant">
        <MessageContent>
          {toolActivities.length > 0 && (
            <div className="mb-3">
              <ToolActivityList activities={toolActivities} />
            </div>
          )}
          <ToolResultInlineImages activities={toolActivities} />
          {message.content && (
            <SelectableMessageResponse basePath={sessionPath || undefined}>{message.content}</SelectableMessageResponse>
          )}
        </MessageContent>
        {/* 操作栏：耗时 · 时间 · 复制 */}
        {(message.durationMs != null || message.content) && (
          <MessageActions className="mt-0.5 justify-start gap-2.5">
            {message.durationMs != null && <DurationBadge durationMs={message.durationMs} usage={message.usage} />}
            <span className="text-sm tabular-nums font-light">
              {formatMessageTime(message.createdAt)}
            </span>
            {message.content && <CopyButton content={message.content} />}
          </MessageActions>
        )}
      </Message>
    )
  }

  if (message.role === 'status' && message.errorCode) {
    // TypedError 消息 — 告警图标内联 + 底部时间戳
    return (
      <Message from="assistant">
        <MessageContent>
          <div className="flex items-start gap-2">
            <AlertTriangle size={18} className="shrink-0 text-destructive mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="text-destructive">
                <MessageResponse>{message.content}</MessageResponse>
              </div>
              <div className="flex items-center gap-2 mt-3">
                {message.errorCode === 'prompt_too_long' && onCompact && (
                  <Button size="sm" onClick={onCompact}>
                    <Minimize2 className="!size-3.5 mr-1.5" />
                    {tConv('agent.messages.actionCompact')}
                  </Button>
                )}
                {onRetry && (
                  <Button size="sm" variant={message.errorCode === 'prompt_too_long' ? 'outline' : 'default'} onClick={onRetry}>
                    <RotateCw className="!size-3.5 mr-1.5" />
                    {tConv('agent.messages.actionRetry')}
                  </Button>
                )}
                {onRetryInNewSession && (
                  <Button size="sm" variant="outline" onClick={onRetryInNewSession}>
                    <Plus className="!size-3.5 mr-1.5" />
                    {tConv('agent.messages.actionRetryNewSession')}
                  </Button>
                )}
              </div>
            </div>
          </div>
        </MessageContent>
        <MessageActions className="mt-0.5 justify-start">
          <span className="text-sm tabular-nums font-light">
            {formatMessageTime(message.createdAt)}
          </span>
          <CopyButton content={message.content} />
        </MessageActions>
      </Message>
    )
  }

  return null
}

/** 格式化耗时（毫秒 → 可读字符串） */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${ms}ms`
  const seconds = ms / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}m ${s.toFixed(0)}s`
}

/** 耗时徽章 — 悬浮显示 token 用量明细 */
export function DurationBadge({ durationMs, usage }: { durationMs: number; usage?: AgentEventUsage }): React.ReactElement {
  const { t: tConv } = useT('conversation')
  const tooltipText = React.useMemo(() => {
    const lines: string[] = []
    lines.push(tConv('agent.messages.statDuration', { value: formatDuration(durationMs) }))
    if (usage) {
      const pureInput = usage.inputTokens - (usage.cacheReadTokens ?? 0) - (usage.cacheCreationTokens ?? 0)
      if (pureInput > 0) lines.push(tConv('agent.messages.statInput', { value: pureInput.toLocaleString() }))
      if (usage.outputTokens) lines.push(tConv('agent.messages.statOutput', { value: usage.outputTokens.toLocaleString() }))
      if (usage.cacheCreationTokens) lines.push(tConv('agent.messages.statCacheWrite', { value: usage.cacheCreationTokens.toLocaleString() }))
      if (usage.cacheReadTokens) lines.push(tConv('agent.messages.statCacheRead', { value: usage.cacheReadTokens.toLocaleString() }))
    }
    return lines.join('\n')
  }, [durationMs, usage, tConv])

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="text-sm tabular-nums font-light cursor-default">
          {formatDuration(durationMs)}
        </span>
      </TooltipTrigger>
      <TooltipContent side="top">
        <p className="whitespace-pre-line text-left">{tooltipText}</p>
      </TooltipContent>
    </Tooltip>
  )
}

/** 唯一的执行状态：具体动作，不重复展示运行计时和语言元数据。 */
function AgentRunningIndicator({ label, state }: { label: string; state: 'working' | 'searching' | 'connecting' }): React.ReactElement {
  return (
    <div role="status" className="flex items-center gap-2 min-h-[28px]">
      <AIThinkingOrb state={state} />
      <span className="text-sm text-muted-foreground">{label}</span>
    </div>
  )
}

export function AgentMessages({ sessionId, sessionModelId, messages, messagesLoaded, persistedSDKMessages, streaming, streamState, liveMessages, sessionPath, stoppedByUser, onRetry, onRetryInNewSession, onFork, onRewind, onCompact }: AgentMessagesProps): React.ReactElement {
  const { t: tConversation } = useT('conversation')
  const taskMode = useAtomValue(taskModesAtom)[sessionId] ?? 'search'
  const userProfile = useAtomValue(userProfileAtom)
  const setMinimapCache = useSetAtom(tabMinimapCacheAtom)
  /** 淡入控制：切换会话时先隐藏，等布局完成后再显示。 */
  const [ready, setReady] = React.useState(false)
  const prevSessionIdRef = React.useRef<string | null>(null)

  React.useEffect(() => {
    if (sessionId !== prevSessionIdRef.current) {
      prevSessionIdRef.current = sessionId
      setReady(false)
    }
  }, [sessionId])

  React.useEffect(() => {
    if (ready) return

    // 必须等消息加载完成，否则 messages=[] 会被误判为空对话
    if (messagesLoaded === false) return

    // 流式进行中且有实时内容 → 跳过 fade 直接显示
    if (streaming && liveMessages && liveMessages.length > 0) {
      setReady(true)
      return
    }

    if (messages.length === 0 && (!persistedSDKMessages || persistedSDKMessages.length === 0) && !streaming) {
      setReady(true)
      return
    }
    let cancelled = false
    requestAnimationFrame(() => {
      if (!cancelled) setReady(true)
    })
    return () => { cancelled = true }
  }, [messages, streaming, liveMessages, persistedSDKMessages, messagesLoaded])

  // 从 streamState 属性中计算派生值
  const streamingContent = streamState?.content ?? ''
  const activeTool = streamState?.toolActivities?.slice().reverse().find(activity => !activity.done && activity.result === undefined)
  const executionLabel = activeTool
    ? getToolPhrase(activeTool.toolName, activeTool.input, tConversation).loadingLabel
    : tConversation('agent.messages.thinkingStreaming')
  const retrying = streamState?.retrying

  const { displayedContent: smoothContent } = useSmoothStream({
    content: streamingContent,
    isStreaming: streaming,
  })

  /**
   * 流式完成过渡：streaming 结束到持久化消息加载完成之间，
   * 强制 resize="instant" 避免中间高度变化触发平滑滚动动画。
   */
  const [transitioning, setTransitioning] = React.useState(false)
  React.useEffect(() => {
    if (streaming) {
      setTransitioning(false)
      return
    }
    if (streamingContent || smoothContent) {
      setTransitioning(true)
      return
    }
    const timer = setTimeout(() => setTransitioning(false), 150)
    return () => clearTimeout(timer)
  }, [streaming, streamingContent, smoothContent])

  // 判断是否使用新的 SDKMessage 渲染路径
  const useSDKRenderer = persistedSDKMessages && persistedSDKMessages.length > 0
  const hasContent = useSDKRenderer ? persistedSDKMessages.length > 0 : messages.length > 0

  // 首次发送瞬间欢迎屏 → 消息列表的高度骤降会触发 use-stick-to-bottom 的 spring resize 动画，
  // 表现为闪烁。把欢迎屏移出 StickToBottom.Content 测量树（绝对定位兄弟节点）即可消除主因；
  // 再叠加一帧 instant 守卫，防止以后其他高瘦元素挂卸再次触发同样问题。
  const showWelcome = messagesLoaded !== false && !hasContent && !streaming
  const prevShowWelcomeRef = React.useRef<boolean>(true)
  const justPromoted = prevShowWelcomeRef.current && !showWelcome
  React.useEffect((): void => {
    prevShowWelcomeRef.current = showWelcome
  }, [showWelcome])

  // 合并持久化 + 实时 SDKMessage（供 ContentBlock 内查找工具结果）
  const allSDKMessages = React.useMemo(() => {
    const persisted = persistedSDKMessages ?? []
    const live = liveMessages ?? []
    const liveSet = new Set(live)
    return [...persisted.filter(m => !liveSet.has(m)), ...live]
  }, [persistedSDKMessages, liveMessages])

  // 压缩流程进行中（含收尾窗口：compact_boundary 已到但 result 未到）
  // → 一律抑制 AgentRunningIndicator，避免压缩分隔符切换期间闪烁。
  // compactInFlight 从点击压缩 / SDK compacting 事件开始为 true，
  // 直到整个 stream 结束（stream state 被删除）才消失。
  const suppressAgentRunning = streamState?.isCompacting || streamState?.compactInFlight

  // 统一分组：将持久化 + 实时消息合并后再分组，确保 system 消息（如压缩分割线）出现在正确位置
  const allGroups = React.useMemo(() => {
    if (!useSDKRenderer) return []
    return groupIntoTurns(allSDKMessages, sessionModelId)
  }, [useSDKRenderer, allSDKMessages, sessionModelId])

  // 标记哪些 group 属于实时流式消息（用于 isStreaming / onFork 差异化渲染）
  const liveGroupSet = React.useMemo(() => {
    if (!liveMessages || liveMessages.length === 0) return new Set<MessageGroup>()
    const liveSet = new Set<SDKMessage>(liveMessages)
    const result = new Set<MessageGroup>()
    for (const group of allGroups) {
      let isLive = false
      if (group.type === 'user' || group.type === 'system') {
        isLive = liveSet.has(group.message as SDKMessage)
      } else {
        // assistant-turn 可能被 mergeAdjacentSameModelTurns 合并，
        // 需检查任意一条 assistantMessage 是否来自实时流
        isLive = group.assistantMessages.some((m) => liveSet.has(m as SDKMessage))
      }
      if (isLive) result.add(group)
    }
    return result
  }, [allGroups, liveMessages])

  const previewLabels = React.useMemo(
    () => ({
      contextCompacted: tConversation('agent.sdkMessage.contextCompacted'),
      compactingContext: tConversation('agent.sdkMessage.compactingContext'),
    }),
    [tConversation],
  )

  // 迷你地图数据 — 直接使用统一的 allGroups（无需去重）
  const minimapItems: MinimapItem[] = React.useMemo(
    () => {
      if (useSDKRenderer) {
        return allGroups.map((group) => ({
          id: getGroupId(group),
          role: group.type === 'user' ? 'user' as const
            : group.type === 'system' ? 'status' as const
            : 'assistant' as const,
          preview: getGroupPreview(group, previewLabels),
          avatar: group.type === 'user' ? userProfile.avatar : undefined,
          model: group.type === 'assistant-turn' ? group.model : undefined,
        }))
      }
      // 旧格式回退
      return messages.map((m, i) => ({
        id: m.id || `msg-${i}`,
        role: m.role === 'status' ? 'status' as const : m.role as MinimapItem['role'],
        preview: (m.content ?? '').replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/, '').slice(0, 200),
        avatar: m.role === 'user' ? userProfile.avatar : undefined,
        model: m.model,
      }))
    },
    [useSDKRenderer, allGroups, messages, userProfile.avatar]
  )

  // 同步 minimap 缓存到 Tab 级别（供 Tab hover 预览使用）
  React.useEffect(() => {
    if (minimapItems.length > 0) {
      setMinimapCache((prev) => {
        const next = new Map(prev)
        next.set(sessionId, minimapItems)
        return next
      })
    }
  }, [sessionId, minimapItems, setMinimapCache])

  // 实时消息中是否已有可渲染的助手内容
  const hasLiveAssistantContent = allGroups.some((g) => g.type === 'assistant-turn' && liveGroupSet.has(g))

  const referenceTargets = React.useMemo(() => allGroups.filter(group => group.type === 'assistant-turn').map(group => ({
    groupId: getGroupId(group), sourceIds: group.type === 'assistant-turn' ? group.assistantMessages.map(message => message.uuid).filter((id): id is string => typeof id === 'string' && !!id) : [],
  })), [allGroups])

  return (
    <Conversation
      resize={ready && !transitioning && !justPromoted ? 'smooth' : 'instant'}
      className={cn('conversation-flow', ready ? 'opacity-100 transition-opacity duration-200' : 'opacity-0')}
    >
      <MessageReferenceNavigation sessionId={sessionId} targets={referenceTargets}>
      <ScrollPositionManager id={sessionId} ready={ready} />
      <ConversationContent className="conversation-column__messages">
        {/* 统一消息渲染（持久化 + 实时合并为一个列表，确保 system 消息位置正确） */}
        {useSDKRenderer ? (
          allGroups.map((group, idx) => {
            const isLive = liveGroupSet.has(group)
            // 仅在最后一个 assistant-turn 上显示"已被用户中断" badge
            const isLastAssistantTurn = !streaming && stoppedByUser
              && group.type === 'assistant-turn'
              && idx === allGroups.findLastIndex((g) => g.type === 'assistant-turn')
            return (
              <MessageGroupRenderer
                key={getGroupId(group)}
                group={group}
                compactProcess={true}
                allMessages={allSDKMessages}
                basePath={sessionPath || undefined}
                onFork={isLive ? undefined : onFork}
                onRewind={isLive ? undefined : onRewind}
                isStreaming={streaming && isLive || undefined}
                stoppedByUser={isLastAssistantTurn || undefined}
                sessionModelId={sessionModelId}
              />
            )
          })
        ) : (
          // 旧格式回退 — AgentMessageItem
          messages.map((msg: AgentMessage) => (
            <div key={msg.id} data-message-id={msg.id} data-message-role={msg.role === 'user' ? 'user' : undefined}>
              <AgentMessageItem
                message={msg}
                sessionPath={sessionPath}
                onRetry={onRetry}
                onRetryInNewSession={onRetryInNewSession}
                onCompact={onCompact}
              />
            </div>
          ))
        )}

        {/* 有实时助手内容时：显示运行指示器或占位（防止 streaming 结束到 Actions Bar 出现之间的高度跳动）
            px-2.5 与 Message 根容器的水平 padding 对齐，保证 Spinner 和上方消息内容左缘齐整 */}
        {hasLiveAssistantContent && !suppressAgentRunning && !(allGroups.some(g => g.type === 'assistant-turn' && liveGroupSet.has(g) && g.assistantMessages.some(m => m.message.content.some(b => b.type === 'tool_use')))) && (
          <div className="mt-0.5 min-h-[28px] px-2.5 flex items-center gap-2 flex-wrap">
            {retrying && <RetryingNotice retrying={retrying} />}
            {streaming && <AgentRunningIndicator label={executionLabel} state={retrying ? 'connecting' : taskMode === 'search' ? 'searching' : 'working'} />}
          </div>
        )}

        {/* 无实时助手内容时：显示占位气泡（无头像，仅内容） */}
        {/* 注意：工具活动已通过 SDK 渲染路径（liveGroups）展示，此处不再使用 ToolActivityList */}
        {!hasLiveAssistantContent && !suppressAgentRunning && (streaming || smoothContent || retrying) && (
          <Message from="assistant" className="min-h-[44px]">
            <MessageContent>
              {retrying && <RetryingNotice retrying={retrying} />}
              {smoothContent ? (
                <>
                  <SelectableMessageResponse basePath={sessionPath || undefined}>{smoothContent}</SelectableMessageResponse>
                  <div className="mt-1 flex items-center gap-2 flex-wrap">
                    {streaming && <AgentRunningIndicator label={executionLabel} state={retrying ? 'connecting' : taskMode === 'search' ? 'searching' : 'working'} />}
                  </div>
                </>
              ) : (
                <div className="flex items-center gap-2 flex-wrap">
                  {streaming && <AgentRunningIndicator label={executionLabel} state={retrying ? 'connecting' : taskMode === 'search' ? 'searching' : 'working'} />}
                </div>
              )}
            </MessageContent>
          </Message>
        )}

        {/* 压缩中指示器：由 isCompacting flag 驱动的尾部元素，compact_boundary 到达时 flag 翻 false 自然消失，
            视觉上被流中新出现的"上下文已压缩"分隔符无缝替换 */}

      </ConversationContent>
      {/* 欢迎屏作为 Conversation 的绝对定位兄弟节点渲染（不进 StickToBottom.Content 测量树），
          避免其 unmount 触发 use-stick-to-bottom 的 spring resize 动画造成首次发送瞬间闪烁。
          外层 pointer-events-none 保证不阻断滚动，内层 pointer-events-auto 保留 StarterChips 可点。 */}
      {showWelcome && (
        <div className="absolute inset-0 z-[1] pointer-events-none">
          <div className="h-full w-full pointer-events-auto">
            <WelcomeEmptyState />
          </div>
        </div>
      )}
      <ConversationScrollButton key={sessionId} generating={streaming || !!streamState?.isCompacting} orbState={retrying ? 'connecting' : taskMode === 'search' ? 'searching' : 'working'} />
      </MessageReferenceNavigation>
    </Conversation>
  )
}

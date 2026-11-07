import { AgentFailureRecovery } from './AgentFailureRecovery'
import { captureSendDraft, sendRecoveryDraftsAtom, forgetSendDraftAtom } from '@/atoms/send-recovery-atoms'
import { imageEditDraftsAtom, clearImageEditDraft, consumeImageEditDraft } from '@/atoms/image-edit-atoms'
import { ImageEditReference } from './ImageEditReference'
import { latestTurnAttemptedImage } from './image-retry-policy.ts'
import { BinaryBackdrop } from '../welcome/BinaryBackdrop'
/**
 * AgentView — Agent 模式主视图容器
 *
 * 职责：
 * - 加载当前 Agent 会话消息
 * - 发送/停止/压缩 Agent 消息
 * - 附件上传处理
 *
 * 注意：IPC 流式事件监听已提升到全局 useGlobalAgentListeners，
 * 本组件为纯展示 + 交互组件。
 *
 * 布局：AgentMessages | AgentInput + 可选 FileBrowser 侧面板
 */

import * as React from 'react'
import { useAtom, useAtomValue, useSetAtom, useStore } from 'jotai'
import { selectAtom } from 'jotai/utils'
import { toast } from 'sonner'
import { Bot, Square, Copy, Check, Map as MapIcon, Plus, ArrowUp } from 'lucide-react'
import { AgentMessages } from './AgentMessages'
import { QueuedMessagesBar } from './QueuedMessagesBar'
import { contextCandidates, latestContextUsage } from './context-candidates'
import { ContextUsageBadge } from './ContextUsageBadge'
import { PermissionBanner } from './PermissionBanner'
import { ProjectSwitcher } from './ProjectSwitcher'
import { TaskModeSelector, useTaskMode, taskModesAtom, lockedTaskModesAtom, lockTaskModeAtom } from './TaskModeSelector'
import { PermissionModeSelector } from './PermissionModeSelector'
import { useReasoningEffort } from '@/hooks/useReasoningEffort'
import { AskUserBanner } from './AskUserBanner'
import { ExitPlanModeBanner } from './ExitPlanModeBanner'
import { LitReviewDirectionsBanner } from './LitReviewDirectionsBanner'
import { SearchPlanBanner } from './SearchPlanBanner'
import { PlanModeDashedBorder } from './PlanModeDashedBorder'
import { ModelSelector } from '@/components/common/ModelSelector'
import { AttachmentPreviewItem } from '@/components/common/AttachmentPreviewItem'
import { RichTextInput } from '@/components/ai-elements/rich-text-input'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { cn } from '@/lib/utils'
import {
  agentStreamingStatesAtom,
  agentChannelIdAtom,
  agentModelIdAtom,
  agentChannelIdsAtom,
  agentSessionChannelMapAtom,
  agentSessionModelMapAtom,
  currentAgentWorkspaceIdAtom,
  agentPendingPromptAtom,
  agentPendingFilesAtom,
  agentPendingMentionsAtom,
  addPendingMentionsAtom,
  type AgentPendingMention,
  agentWorkspacesAtom,
  agentStreamErrorsAtom,
  agentSessionDraftsAtom,
  agentSessionDraftHtmlAtom,
  agentPromptSuggestionsAtom,
  agentMessageRefreshAtom,
  agentSessionsAtom,
  workspaceAttachedDirectoriesMapAtom,
  liveMessagesMapAtom,
  enqueueMessageUuidAtom,
  removeMessageUuidAtom,
  queuedMessageUuidsAtom,
  clearQueuedMessageUuidsAtom,
  type QueuedMessage,
  stoppedByUserSessionsAtom,
  agentPlanModeSessionsAtom,
  agentPermissionModeMapAtom,
  agentDefaultPermissionModeAtom,
  agentReasoningEffortMapAtom,
  agentDefaultReasoningEffortAtom,
  agentSessionPathMapAtom,
  allPendingAskUserRequestsAtom,
  allPendingExitPlanRequestsAtom,
  allPendingLitReviewDirectionsRequestsAtom,
  allPendingSearchPlanRequestsAtom,
  finalizeStreamingActivities,
} from '@/atoms/agent-atoms'
import type { AgentContextStatus } from '@/atoms/agent-atoms'
import { channelsAtom } from '@/atoms/channels-atoms'
import { useOpenSession } from '@/hooks/useOpenSession'
import { AgentSessionProvider } from '@/contexts/session-context'
import { draftSessionIdsAtom } from '@/atoms/draft-session-atoms'
import { sendWithCmdEnterAtom } from '@/atoms/shortcut-atoms'
import type { AgentSendInput, AgentMessage, AgentPendingFile, ModelOption, SDKMessage, AgentEffort } from '@asci/shared'
import { nowMs, COPY_FEEDBACK_RESET_MS, AGENT_EFFORT_ORDER, inferModelContextWindow } from '@asci/shared'
import { fileToBase64 } from '@/lib/file-utils'
import { buildReferenceText } from '@/components/library/SendToAgentButton'
import { useT } from '@/hooks/useT'
import {
  zoteroEnabledAtom,
  zoteroPingStatusAtom,
  zoteroInstallStatusAtom,
  zoteroMentionItemCacheAtom,
} from '@/atoms/zotero-atoms'
import { openZoteroDownload } from '@/components/agent/zotero-ready-gate'
import { extractZoteroItemKeys, extractZoteroCollectionKeys, extractEvidenceSetIds } from './at-mention-parse'
import { buildReferencedDirectoriesBlock, type ReferencedDirectory } from './referenced-directory-block'
import { MENTION_DRAG_MIME, parseFileMentionPayloads } from './mention-drag-payload'
import type { ItemSummary } from '@asci/core/zotero'
import { pendingStarterPromptAtom, pendingAutoSendPromptAtom } from '@/atoms/starter-prompt-atoms'
import { captureFeedback } from '@/lib/telemetry'
import { HomeWelcome, HomeLocalNote, HomeSuggestions } from '@/components/welcome/HomeWelcome'
import '@/components/welcome/workspace-home.css'

/** 稳定的空 SDKMessage 数组引用，避免 ?? [] 每次创建新引用 */
const EMPTY_SDK_MESSAGES: SDKMessage[] = []

/** 稳定的空排队数组引用，供 selectAtom「无队列」分支返回稳定引用 */
const EMPTY_QUEUED: QueuedMessage[] = []

const REWIND_BLOCKED_I18N_KEYS = {
  'fork-pre-fork': { title: 'agentRewind.blockedForkPreFork', detail: 'agentRewind.blockedForkPreForkDetail' },
  'post-recovery': { title: 'agentRewind.blockedPostRecovery', detail: 'agentRewind.blockedPostRecoveryDetail' },
} as const

export function AgentView({ sessionId }: { sessionId: string }): React.ReactElement {
  const { t: tHome } = useT('onboarding')
  const { t: tLibrary } = useT('library')
  const { t: tConversation } = useT('conversation')
  const { t: tErrors } = useT('errors')
  const { t: tCommon } = useT('common')

  // 推理深度并入模型下拉底部：读每会话推理深度，拼成 ModelSelector 的 reasoning 区（介绍走 hover）
  const { effort, setEffort } = useReasoningEffort(sessionId)
  const reasoningForModel = React.useMemo(
    () => ({
      title: tConversation('reasoningEffort.menuLabel'),
      current: effort,
      options: AGENT_EFFORT_ORDER.map((e) => ({
        value: e,
        label: tConversation(`reasoningEffort.${e}`),
        desc: tConversation(`reasoningEffort.${e}Desc`),
      })),
      onSelect: (v: string) => setEffort(v as AgentEffort),
    }),
    [effort, setEffort, tConversation],
  )

  const [messages, setMessages] = React.useState<AgentMessage[]>([])
  const [persistedSDKMessages, setPersistedSDKMessages] = React.useState<SDKMessage[]>([])
  const setStreamingStates = useSetAtom(agentStreamingStatesAtom)
  const streamingStates = useAtomValue(agentStreamingStatesAtom)
  const streamState = streamingStates.get(sessionId)
  const streaming = streamState?.running ?? false
  const stoppedByUserSessions = useAtomValue(stoppedByUserSessionsAtom)
  const sendWithCmdEnter = useAtomValue(sendWithCmdEnterAtom)
  const stoppedByUser = stoppedByUserSessions.has(sessionId)
  const liveMessagesMap = useAtomValue(liveMessagesMapAtom)
  const setLiveMessagesMap = useSetAtom(liveMessagesMapAtom)
  // 稳定化空数组引用，避免 ?? [] 每次创建新引用导致下游 useMemo 链不必要重算
  const liveMessages = liveMessagesMap.get(sessionId) ?? EMPTY_SDK_MESSAGES
  // 当前会话「排队中」消息有序列表（每条自带展示文本），供输入框上方的 QueuedMessagesBar 渲染（issue #450）。
  // 用 selectAtom 按 sessionId 切片，仅本会话队列变化才触发重渲染（其他会话写入时本会话数组引用不变）。
  const queuedListAtom = React.useMemo(
    () => selectAtom(queuedMessageUuidsAtom, (map) => map.get(sessionId) ?? EMPTY_QUEUED),
    [sessionId],
  )
  const queuedList = useAtomValue(queuedListAtom)
  // Per-session 渠道/模型配置（优先读 session map，回退到全局默认值）
  const sessionChannelMap = useAtomValue(agentSessionChannelMapAtom)
  const sessionModelMap = useAtomValue(agentSessionModelMapAtom)
  const setSessionChannelMap = useSetAtom(agentSessionChannelMapAtom)
  const setSessionModelMap = useSetAtom(agentSessionModelMapAtom)
  const [defaultChannelId, setDefaultChannelId] = useAtom(agentChannelIdAtom)
  const [defaultModelId, setDefaultModelId] = useAtom(agentModelIdAtom)
  const agentChannelId = sessionChannelMap.get(sessionId) ?? defaultChannelId
  const agentModelId = sessionModelMap.get(sessionId) ?? defaultModelId
  const agentChannelIds = useAtomValue(agentChannelIdsAtom)
  const setDraftSessionIds = useSetAtom(draftSessionIdsAtom)
  const globalWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const sessions = useAtomValue(agentSessionsAtom)
  // 从会话元数据派生 workspaceId：会话数据已加载时以自身为准，未加载时回退全局 atom
  const currentWorkspaceId = React.useMemo(() => {
    const meta = sessions.find((s) => s.id === sessionId)
    if (!meta) return globalWorkspaceId // 数据未加载，回退全局
    return meta.workspaceId ?? null     // 数据已加载，以会话自身为准
  }, [sessions, sessionId, globalWorkspaceId])
  const [pendingPrompt, setPendingPrompt] = useAtom(agentPendingPromptAtom)
  const [pendingFiles, setPendingFiles] = useAtom(agentPendingFilesAtom)
  const [imageEditDrafts, setImageEditDrafts] = useAtom(imageEditDraftsAtom)
  const selectedImage = imageEditDrafts.get(sessionId)
  const [pendingMentions, setPendingMentions] = useAtom(agentPendingMentionsAtom)
  const addPendingMentions = useSetAtom(addPendingMentionsAtom)
  const handleAddMention = React.useCallback((m: AgentPendingMention): void => {
    addPendingMentions([m])
  }, [addPendingMentions])
  const handleRemoveMention = React.useCallback(
    (kind: AgentPendingMention['kind'], id: string): void => {
      setPendingMentions((prev) => prev.filter((m) => !(m.kind === kind && m.id === id)))
    },
    [setPendingMentions],
  )
  const zoteroEnabled = useAtomValue(zoteroEnabledAtom)
  const zoteroPingStatus = useAtomValue(zoteroPingStatusAtom)
  const setZoteroInstallStatus = useSetAtom(zoteroInstallStatusAtom)
  const [zoteroItemCache, setZoteroItemCache] = useAtom(zoteroMentionItemCacheAtom)
  const zoteroCollectionLocalRef = React.useRef<Map<string, { name: string; path: string }>>(new Map())
  /**
   * Zotero 附件路径缓存：@ 条目选中时异步写入，发送时按编辑器里实际出现的 itemKey 派生 zoteroAttachments 数组。
   * 用 ref 而非 state，避免与编辑器 mention 节点重复显示 chip——编辑器 mention 是唯一事实源。
   */
  const zoteroAttachmentsCacheRef = React.useRef<Map<string, { filename: string; path: string }>>(new Map())
  const workspaces = useAtomValue(agentWorkspacesAtom)
  // 保持 channelId 稳定：初始化前使用上次有效值，避免工具栏抖动
  const stableChannelIdRef = React.useRef(agentChannelId)
  if (agentChannelId) stableChannelIdRef.current = agentChannelId
  const stableChannelId = agentChannelId ?? stableChannelIdRef.current

  // 已有会话首次打开时，从全局默认值初始化 per-session map
  React.useEffect(() => {
    if (!sessionId) return
    if (!sessionChannelMap.has(sessionId) && defaultChannelId) {
      setSessionChannelMap((prev) => {
        if (prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.set(sessionId, defaultChannelId)
        return map
      })
    }
    if (!sessionModelMap.has(sessionId) && defaultModelId) {
      setSessionModelMap((prev) => {
        if (prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.set(sessionId, defaultModelId)
        return map
      })
    }
  }, [sessionId, sessionChannelMap, sessionModelMap, defaultChannelId, defaultModelId, setSessionChannelMap, setSessionModelMap])

  const lastContextUsage = React.useMemo(() => latestContextUsage(persistedSDKMessages), [persistedSDKMessages])
  const contextStatus: AgentContextStatus = {
    isCompacting: streamState?.isCompacting ?? false,
    inputTokens: streamState?.inputTokens ?? lastContextUsage?.inputTokens,
    contextWindow: streamState?.contextWindow ?? (agentModelId ? inferModelContextWindow(agentModelId) : undefined),
  }
  const setAgentStreamErrors = useSetAtom(agentStreamErrorsAtom)
  const streamErrors = useAtomValue(agentStreamErrorsAtom)
  const agentError = streamErrors.get(sessionId) ?? null
  const planModeSessions = useAtomValue(agentPlanModeSessionsAtom)
  const isPlanMode = planModeSessions.has(sessionId)
  const permissionModeMap = useAtomValue(agentPermissionModeMapAtom)
  const defaultPermissionMode = useAtomValue(agentDefaultPermissionModeAtom)
  const permissionMode = permissionModeMap.get(sessionId) ?? defaultPermissionMode
  const isPermissionPlanMode = permissionMode === 'plan'
  const store = useStore()
  // 取当前会话推理深度（fresh read，避免闭包过期）：会话 Map 优先，回退工作区默认
  const resolveSessionEffort = React.useCallback(
    () => store.get(agentReasoningEffortMapAtom).get(sessionId) ?? store.get(agentDefaultReasoningEffortAtom),
    [store, sessionId],
  )
  const suggestionsMap = useAtomValue(agentPromptSuggestionsAtom)
  const suggestion = suggestionsMap.get(sessionId) ?? null
  const setPromptSuggestions = useSetAtom(agentPromptSuggestionsAtom)
  // 输入框 placeholder：补全建议 > 流式中 > 普通。
  const inputPlaceholder = React.useMemo(() => {
    if (suggestion && !streaming) return `↹ Tab: ${suggestion}`
    if (streaming)
      return sendWithCmdEnter
        ? tConversation('input.streamingPlaceholderCmd')
        : tConversation('input.streamingPlaceholder')
    return tConversation('input.messagePlaceholder')
  }, [suggestion, streaming, sendWithCmdEnter, tConversation])
  const setAgentSessions = useSetAtom(agentSessionsAtom)
  const openSession = useOpenSession()
  const wsAttachedDirsMap = useAtomValue(workspaceAttachedDirectoriesMapAtom)
  const wsAttachedDirs = currentWorkspaceId ? (wsAttachedDirsMap.get(currentWorkspaceId) ?? []) : []

  const draftsMap = useAtomValue(agentSessionDraftsAtom)
  const setDraftsMap = useSetAtom(agentSessionDraftsAtom)
  const inputContent = draftsMap.get(sessionId) ?? ''
  const setInputContent = React.useCallback((value: string) => {
    setDraftsMap((prev) => {
      const map = new Map(prev)
      if (value.trim() === '') {
        map.delete(sessionId)
      } else {
        map.set(sessionId, value)
      }
      return map
    })
  }, [sessionId, setDraftsMap])

  const [pendingStarterPrompt, setPendingStarterPrompt] = useAtom(pendingStarterPromptAtom)

  const draftHtmlMap = useAtomValue(agentSessionDraftHtmlAtom)
  const setDraftHtmlMap = useSetAtom(agentSessionDraftHtmlAtom)
  const inputHtmlContent = draftHtmlMap.get(sessionId) ?? ''
  const setInputHtmlContent = React.useCallback((html: string) => {
    setDraftHtmlMap((prev) => {
      const map = new Map(prev)
      if (!html || html === '<p></p>') {
        map.delete(sessionId)
      } else {
        map.set(sessionId, html)
      }
      return map
    })
  }, [sessionId, setDraftHtmlMap])

  // Starter chip → 输入框填充（点新 chip 直接覆盖原内容）
  // 注意：必须同时清掉 HTML 草稿，否则 RichTextInput 会用旧 chip 的 HTML 覆盖新文本
  React.useEffect(() => {
    if (!pendingStarterPrompt) return
    setInputContent(pendingStarterPrompt)
    setInputHtmlContent('')
    setPendingStarterPrompt(null)
  }, [pendingStarterPrompt, setInputContent, setInputHtmlContent, setPendingStarterPrompt])
  const sessionPathMap = useAtomValue(agentSessionPathMapAtom)
  const setSessionPathMap = useSetAtom(agentSessionPathMapAtom)
  const sessionPath = sessionPathMap.get(sessionId) ?? null
  const [workspaceFilesPath, setWorkspaceFilesPath] = React.useState<string | null>(null)
  const [isDragOver, setIsDragOver] = React.useState(false)
  const [errorCopied, setErrorCopied] = React.useState(false)
  // @ 引用触发信号：快捷按钮点击时递增，RichTextInput 监听信号插入 @
  // 初始必须是 undefined（不是 0），否则 RichTextInput 首次挂载的 effect 会把 0 当信号插入 @ 字符

  // pendingFiles ref（供 addFilesAsAttachments 读取最新列表，避免闭包旧值）
  const pendingFilesRef = React.useRef(pendingFiles)
  React.useEffect(() => {
    pendingFilesRef.current = pendingFiles
  }, [pendingFiles])

  // 渠道已选但模型未选时，自动选择第一个可用模型
  const globalChannels = useAtomValue(channelsAtom)

  // 检查 Agent 渠道列表中是否存在可用的模型（渠道 enabled + 模型 enabled）
  const hasAvailableModel = React.useMemo(() => {
    // ASCI 官方渠道（商业版）：只要 enabled 且有可用模型，直接视为可用
    const asciOfficial = globalChannels.find((c) => c.id === 'asci-official')
    if (asciOfficial?.enabled && asciOfficial.models.some((m) => m.enabled)) return true
    // 其他渠道：需在 agentChannelIds 白名单中
    if (!agentChannelIds || agentChannelIds.length === 0) return false
    return globalChannels.some(
      (c) => c.enabled && agentChannelIds.includes(c.id) && c.models.some((m) => m.enabled),
    )
  }, [globalChannels, agentChannelIds])
  // 普通态用轮播占位句（完整介绍快捷键，滚动切换）；流式 / 补全建议 / 无渠道模型（禁用态显 CTA）不轮播
  const rotatingPlaceholders = React.useMemo(
    () =>
      streaming || suggestion || !agentChannelId || !hasAvailableModel
        ? undefined
        : [
            tConversation('input.phraseMention'),
            tConversation('input.phraseSkill'),
            tConversation('input.phraseMcp'),
          ],
    [streaming, suggestion, agentChannelId, hasAvailableModel, tConversation],
  )
  React.useEffect(() => {
    if (!agentChannelId || agentModelId) return

    const channel = globalChannels.find((c) => c.id === agentChannelId && c.enabled)
    if (!channel) return

    const firstModel = channel.models.find((m) => m.enabled)
    if (!firstModel) return

    // 更新 per-session map
    setSessionModelMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, firstModel.id)
      return map
    })
    // 同步全局默认值
    setDefaultModelId(firstModel.id)
    window.electronAPI.updateSettings({
      agentChannelId,
      agentModelId: firstModel.id,
    }).catch(console.error)
  }, [agentChannelId, agentModelId, globalChannels, sessionId, setSessionModelMap, setDefaultModelId])

  // 获取当前 session 的工作路径（文件浏览器需要）
  React.useEffect(() => {
    if (!currentWorkspaceId) {
      setSessionPathMap((prev) => {
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
      return
    }

    window.electronAPI
      .getAgentSessionPath(currentWorkspaceId, sessionId)
      .then((path) => {
        if (path) {
          setSessionPathMap((prev) => {
            const map = new Map(prev)
            map.set(sessionId, path)
            return map
          })
        } else {
          setSessionPathMap((prev) => {
            const map = new Map(prev)
            map.delete(sessionId)
            return map
          })
        }
      })
      .catch(() => {
        setSessionPathMap((prev) => {
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
  }, [sessionId, currentWorkspaceId, setSessionPathMap])

  // 获取工作区共享文件目录路径（@ 引用时需要搜索）
  const workspaceSlug = workspaces.find((w) => w.id === currentWorkspaceId)?.slug ?? null
  React.useEffect(() => {
    if (!workspaceSlug) {
      setWorkspaceFilesPath(null)
      return
    }
    window.electronAPI
      .getWorkspaceFilesPath(workspaceSlug)
      .then(setWorkspaceFilesPath)
      .catch(() => setWorkspaceFilesPath(null))
  }, [workspaceSlug])

  // 合并工作区文件目录和工作区级附加目录，供 @ 引用搜索
  const allAttachedDirs = React.useMemo(() => {
    const dirs = [...wsAttachedDirs]
    // 添加工作区共享文件目录
    if (workspaceFilesPath && !dirs.includes(workspaceFilesPath)) {
      dirs.unshift(workspaceFilesPath)
    }
    return dirs
  }, [wsAttachedDirs, workspaceFilesPath])

  // 监听消息刷新版本号
  const refreshMap = useAtomValue(agentMessageRefreshAtom)
  const refreshVersion = refreshMap.get(sessionId) ?? 0

  // 消息是否已完成首次加载（用于 auto-send 等待）
  const [messagesLoaded, setMessagesLoaded] = React.useState(false)

  // 加载当前会话消息
  React.useEffect(() => {
    // 流式运行中不重置 messagesLoaded，避免 streaming UI 消失后出现空窗闪烁
    const isCurrentlyStreaming = store.get(agentStreamingStatesAtom).get(sessionId)?.running ?? false
    if (!isCurrentlyStreaming) {
      setMessagesLoaded(false)
    }
    // 并行加载旧格式（用于 Team 数据重建）和新格式（用于 UI 渲染）
    const loadOldMessages = window.electronAPI.getAgentSessionMessages(sessionId)
    const loadSDKMessages = window.electronAPI.getAgentSessionSDKMessages(sessionId)

    Promise.all([loadOldMessages, loadSDKMessages])
      .then(([msgs, sdkMsgs]) => {
        setMessages(msgs)
        setPersistedSDKMessages(sdkMsgs)
        setMessagesLoaded(true)

        // 消息加载完成后，同步清除流式状态和实时消息，
        // 确保 React 在一次渲染中同时显示持久化消息并移除流式气泡/实时消息，
        // 避免「实时消息已清 → 持久化消息未到」的空档闪烁
        setStreamingStates((prev) => {
          const state = prev.get(sessionId)
          if (!state || state.running) return prev  // 仍在运行中，不清除
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
        setLiveMessagesMap((prev) => {
          if (!prev.has(sessionId)) return prev
          // 仍在运行中，不清除实时消息（与 streamingStates 保护逻辑一致）
          const streamingState = store.get(agentStreamingStatesAtom).get(sessionId)
          if (streamingState?.running) return prev
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
      .catch(console.error)
  }, [sessionId, refreshVersion, setStreamingStates, setLiveMessagesMap, store])

  // 自动发送 pending prompt（从快速任务窗口或设置页触发）
  // 等待 messagesLoaded 确保消息加载完成后再插入乐观消息，避免被加载结果覆盖。
  // 使用 queueMicrotask 延迟发送：避免 setState → 重渲染 → cleanup 取消 timer 的竞态。
  React.useEffect(() => {
    if (!messagesLoaded) return
    if (!pendingPrompt) return
    if (pendingPrompt.sessionId !== sessionId) return
    if (!agentChannelId || streaming) return

    // 快照当前上下文
    const snapshot = {
      message: pendingPrompt.message,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
    }
    const recoveryDraft = captureSendDraft({text: snapshot.message, html: '', files: [], mentions: []}, new Map())
    store.set(sendRecoveryDraftsAtom, previous => new Map(previous).set(sessionId, recoveryDraft))
    setAgentStreamErrors(previous => { const next = new Map(previous); next.delete(sessionId); return next })
    setPendingPrompt(null)

    queueMicrotask(() => {
      // 初始化流式状态（startedAt 由渲染进程生成，传递给主进程原样回传，确保竞态保护使用同一个值）
      const streamStartedAt = nowMs()
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(sessionId, {
          running: true,
          content: '',
          toolActivities: [],
          teammates: [],
          model: snapshot.modelId,
          startedAt: streamStartedAt,
        })
        return map
      })

      // 乐观更新：显示用户消息
      const tempUserMsg: AgentMessage = {
        id: `temp-${nowMs()}`,
        role: 'user',
        content: snapshot.message,
        createdAt: nowMs(),
      }
      setMessages((prev) => [...prev, tempUserMsg])

      // 乐观更新：SDKMessage 格式（Phase 4）
      const tempUserSDKMsg: SDKMessage = {
        type: 'user',
        message: {
          content: [{ type: 'text', text: snapshot.message }],
        },
        parent_tool_use_id: null,
        _createdAt: nowMs(),
      } as unknown as SDKMessage
      setPersistedSDKMessages((prev) => [...prev, tempUserSDKMsg])

      // 发送消息
      const input: AgentSendInput = {
        sessionId,
        userMessage: snapshot.message,
        taskMode: store.get(taskModesAtom)[sessionId] ?? 'search',
        channelId: snapshot.channelId,
        modelId: snapshot.modelId,
        workspaceId: snapshot.workspaceId,
        startedAt: streamStartedAt,
        effort: resolveSessionEffort(),
      }
      window.electronAPI.sendAgentMessage(input).then(() => {
        if (!store.get(agentStreamErrorsAtom).has(sessionId)) store.set(forgetSendDraftAtom, {sessionId, draft: recoveryDraft})
      }).catch((error) => {
        setAgentStreamErrors(previous => new Map(previous).set(sessionId, error instanceof Error ? error.message : String(error)))
        console.error('[AgentView] 自动发送配置消息失败:', error)
        setStreamingStates((prev) => {
          const map = new Map(prev)
          map.delete(sessionId)
          return map
        })
      })
    })
  }, [messagesLoaded, pendingPrompt, sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setPendingPrompt, setStreamingStates, setAgentStreamErrors, store])

  // ===== 附件处理 =====

  /** 为文件生成唯一文件名（避免粘贴多张图片时文件名重复导致覆盖） */
  const makeUniqueFilename = React.useCallback((originalName: string, existingNames: string[]): string => {
    if (!existingNames.includes(originalName)) return originalName
    const dotIdx = originalName.lastIndexOf('.')
    const baseName = dotIdx > 0 ? originalName.slice(0, dotIdx) : originalName
    const ext = dotIdx > 0 ? originalName.slice(dotIdx) : ''
    let counter = 1
    while (existingNames.includes(`${baseName}-${counter}${ext}`)) {
      counter++
    }
    return `${baseName}-${counter}${ext}`
  }, [])

  /** 将 File 对象列表添加为待发送附件 */
  const addFilesAsAttachments = React.useCallback(async (files: File[]): Promise<void> => {
    // 收集已有的 pending 文件名，用于去重
    const usedNames: string[] = pendingFilesRef.current.map((f) => f.filename)

    for (const file of files) {
      try {
        const base64 = await fileToBase64(file)
        const previewUrl = file.type.startsWith('image/') ? URL.createObjectURL(file) : undefined
        const uniqueFilename = makeUniqueFilename(file.name, usedNames)
        usedNames.push(uniqueFilename)

        const pending: AgentPendingFile = {
          id: `pending-${nowMs()}-${Math.random().toString(36).slice(2)}`,
          filename: uniqueFilename,
          mediaType: file.type || 'application/octet-stream',
          size: file.size,
          previewUrl,
        }

        if (!window.__pendingAgentFileData) {
          window.__pendingAgentFileData = new Map<string, string>()
        }
        window.__pendingAgentFileData.set(pending.id, base64)

        setPendingFiles((prev) => [...prev, pending])
      } catch (error) {
        console.error('[AgentView] 添加附件失败:', error)
      }
    }
  }, [makeUniqueFilename, setPendingFiles])

  /** 打开文件选择对话框 */
  const handleOpenFileDialog = React.useCallback(async (): Promise<void> => {
    try {
      const result = await window.electronAPI.openFileDialog()
      if (result.files.length === 0) return

      for (const fileInfo of result.files) {
        const previewUrl = fileInfo.mediaType.startsWith('image/')
          ? `data:${fileInfo.mediaType};base64,${fileInfo.data}`
          : undefined

        const pending: AgentPendingFile = {
          id: `pending-${nowMs()}-${Math.random().toString(36).slice(2)}`,
          filename: fileInfo.filename,
          mediaType: fileInfo.mediaType,
          size: fileInfo.size,
          previewUrl,
        }

        if (!window.__pendingAgentFileData) {
          window.__pendingAgentFileData = new Map<string, string>()
        }
        window.__pendingAgentFileData.set(pending.id, fileInfo.data)

        setPendingFiles((prev) => [...prev, pending])
      }
    } catch (error) {
      console.error('[AgentView] 文件选择对话框失败:', error)
    }
  }, [setPendingFiles])

  /** 移除待发送文件 */
  const handleRemoveFile = React.useCallback((id: string): void => {
    setPendingFiles((prev) => {
      const file = prev.find((f) => f.id === id)
      if (file?.previewUrl?.startsWith('blob:')) {
        URL.revokeObjectURL(file.previewUrl)
      }
      window.__pendingAgentFileData?.delete(id)
      return prev.filter((f) => f.id !== id)
    })
  }, [setPendingFiles])

  /** 选中 Zotero 类目：记录 path 供发送时使用 */
  const handleZoteroCollectionSelect = React.useCallback(
    (col: { key: string; name: string; path: string }): void => {
      zoteroCollectionLocalRef.current.set(col.key, { name: col.name, path: col.path })
    },
    [],
  )

  /** 选中 Zotero 条目：缓存元数据 + 采集附件绝对路径（不读 base64，不落盘） */
  const handleZoteroItemSelect = React.useCallback(
    (item: ItemSummary): void => {
      // 1. 写入元数据缓存
      setZoteroItemCache((prev) => {
        if (prev.has(item.key)) return prev
        const next = new Map(prev)
        next.set(item.key, item)
        return next
      })

      // 2. 异步查询 PDF 绝对路径写入 cache；发送时再按编辑器里实际 itemKey 派生
      void (async () => {
        try {
          const att = await window.electronAPI.zotero.library.getAttachmentPath({ itemKey: item.key })
          if (!att.found) return
          zoteroAttachmentsCacheRef.current.set(item.key, { filename: att.filename, path: att.path })
        } catch (err) {
          console.warn('[AgentView] Zotero 附件路径查询失败:', err)
        }
      })()
    },
    [setZoteroItemCache],
  )

  const handleLaunchZotero = React.useCallback((): void => {
    void (async (): Promise<void> => {
      const result = await window.electronAPI.zotero.launchApp()
      if (result.success) return
      // 区分两种失败：未安装 → 引导去官网下载；已安装但启动失败 → 保留错误 Toast
      const install = await window.electronAPI.zotero.detectInstall()
      setZoteroInstallStatus(install)
      if (!install.installed) {
        openZoteroDownload()
        return
      }
      toast.error(tConversation('agent.toast.zoteroLaunchFailed.title'), {
        description: result.message ?? tConversation('agent.toast.zoteroLaunchFailed.description'),
      })
    })()
  }, [tConversation, setZoteroInstallStatus])

  /** 粘贴文件处理 */
  const handlePasteFiles = React.useCallback((files: File[]): void => {
    addFilesAsAttachments(files)
  }, [addFilesAsAttachments])

  /** 拖放处理 */
  const handleDragOver = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(true)
  }, [])

  const handleDragLeave = React.useCallback((e: React.DragEvent): void => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)
  }, [])

  const handleDrop = React.useCallback(async (e: React.DragEvent): Promise<void> => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragOver(false)

    // 识别从文献库拖来的 Zotero 条目（优先级高于文件 drop）
    const zoteroPayload = e.dataTransfer.getData('application/x-asci-zotero-item')
    if (zoteroPayload) {
      try {
        const item = JSON.parse(zoteroPayload) as {
          itemKey: string
          title: string
          creators: string[]
          date?: string
        }
        const reference = buildReferenceText(
          {
            key: item.itemKey,
            title: item.title,
            creators: item.creators,
            date: item.date,
          },
          tLibrary('sendToAgent.unknownAuthor'),
        )
        setPendingPrompt({ sessionId, message: reference })
        return
      } catch (err) {
        console.warn('[文献库拖拽] 解析 payload 失败:', err)
      }
    }

    // F43：识别从项目文件视图拖来的 workspace 文件 → at-mention chip（支持单 / 多文件）
    const wsFilePayload = e.dataTransfer.getData(MENTION_DRAG_MIME)
    if (wsFilePayload) {
      const mentions = parseFileMentionPayloads(wsFilePayload)
      if (mentions.length > 0) addPendingMentions(mentions)
      return
    }

    const droppedFiles = Array.from(e.dataTransfer.files)
    if (droppedFiles.length === 0) return

    // 通过 preload 的 webUtils.getPathForFile 获取真实路径
    const pathMap = new Map<string, File>()
    const paths: string[] = []
    for (const f of droppedFiles) {
      try {
        const p = window.electronAPI.getPathForFile(f)
        if (p) {
          paths.push(p)
          pathMap.set(p, f)
        }
      } catch { /* 无法获取路径时忽略 */ }
    }

    if (paths.length > 0) {
      try {
        // 通过主进程检测目录 vs 文件（仅处理普通文件）
        const { files: filePaths } = await window.electronAPI.checkPathsType(paths)

        // 普通文件作为附件
        const regularFiles = filePaths.map((p) => pathMap.get(p)!).filter(Boolean)
        if (regularFiles.length > 0) {
          addFilesAsAttachments(regularFiles)
        }
      } catch (error) {
        console.error('[AgentView] 路径检测失败，回退处理:', error)
        addFilesAsAttachments(droppedFiles)
      }
    } else {
      // 无路径信息：回退，所有项按普通文件处理
      addFilesAsAttachments(droppedFiles)
    }
  }, [sessionId, addFilesAsAttachments, setPendingPrompt, handleAddMention])

  /** ModelSelector 选择回调 */
  const handleModelSelect = React.useCallback((option: ModelOption): void => {
    // 更新当前会话的 per-session 配置
    setSessionChannelMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, option.channelId)
      return map
    })
    setSessionModelMap((prev) => {
      const map = new Map(prev)
      map.set(sessionId, option.modelId)
      return map
    })

    // 同时更新全局默认值（新会话继承）
    setDefaultChannelId(option.channelId)
    setDefaultModelId(option.modelId)

    // 持久化到设置
    window.electronAPI.updateSettings({
      agentChannelId: option.channelId,
      agentModelId: option.modelId,
    }).catch(console.error)
  }, [sessionId, setSessionChannelMap, setSessionModelMap, setDefaultChannelId, setDefaultModelId])

  /** 构建 externalSelectedModel 给 ModelSelector */
  const externalSelectedModel = React.useMemo(() => {
    if (!agentChannelId || !agentModelId) return null
    return { channelId: agentChannelId, modelId: agentModelId }
  }, [agentChannelId, agentModelId])

  /** 发送消息 */
  const [taskMode, setTaskMode] = useTaskMode(sessionId)
  const modeLocks = useAtomValue(lockedTaskModesAtom)
  const lockMode = useSetAtom(lockTaskModeAtom)
  const hasSessionContent = messages.length > 0 || persistedSDKMessages.length > 0 || liveMessages.length > 0
  const modeLocked = hasSessionContent
  React.useEffect(() => {
    // 空草稿不继承失败发送留下的锁；只有真实会话内容才隐藏模式入口。
    if (messagesLoaded && !hasSessionContent && !streaming && modeLocks[sessionId]) {
      store.set(lockedTaskModesAtom, previous => { const next = { ...previous }; delete next[sessionId]; return next })
    }
  }, [messagesLoaded, hasSessionContent, streaming, modeLocks, sessionId, store])
  React.useEffect(() => {
    if (messagesLoaded && modeLocked && !modeLocks[sessionId]) lockMode(sessionId)
  }, [messagesLoaded, modeLocked, modeLocks, sessionId, lockMode])


  const handleSend = React.useCallback(async (opts?: { interrupt?: boolean; textOverride?: string }): Promise<void> => {
    // 把 pendingMentions 格式化成 token，前置到正文，使现有的 zotero / file 引用解析逻辑无差别工作。
    // textOverride：一键触发场景（如「找研究空白」）直接传入正文，绕过输入框 state（避免填入→回车的闭包时序问题）。
    const baseText = (opts?.textOverride ?? inputContent).trim()
    const mentionTokens = pendingMentions
      .map((m) => {
        if (m.kind === 'file') return `@file:${m.id}`
        if (m.kind === 'dir') return `@dir:${m.id}`
        if (m.kind === 'zotero-item') return `@zotero-item:${m.id}|${encodeURIComponent(m.label)}`
        if (m.kind === 'evidence-set') return `@evidence-set:${m.id}|${encodeURIComponent(m.label)}`
        return `@zotero-col:${m.id}|${encodeURIComponent(m.label)}`
      })
      .join(' ')
    const effectiveText = mentionTokens && baseText
      ? `${mentionTokens} ${baseText}`
      : (mentionTokens || baseText)
    if (!effectiveText && pendingFiles.length === 0 && pendingMentions.length === 0) return
    if (!agentChannelId || !agentModelId || !hasAvailableModel) {
      toast.warning(tConversation('agent.emptyState.noModelTitle'), { description: tConversation('agent.emptyState.noModelBody') })
      return
    }

    // 图片版本绑定只在新轮次生效，不能混入正在运行的纯文本追加通道。
    if (streaming && selectedImage) return
    // 上一条消息仍在处理中，直接追加发送
    if (streaming) {
      // 流式追加时不处理附件（仅支持纯文本）
      if (pendingFiles.length > 0) {
        toast.info(tConversation('agent.toast.appendDuringStreaming.title'), {
          description: tConversation('agent.toast.appendDuringStreaming.description'),
        })
        return
      }

      const localUuid = crypto.randomUUID()

      // 1. 立即注入 liveMessages（作为普通用户消息显示）
      const syntheticMsg: import('@asci/shared').SDKMessage = {
        type: 'user',
        uuid: localUuid,
        message: {
          content: [{ type: 'text', text: effectiveText }],
        },
        parent_tool_use_id: null,
        _createdAt: nowMs(),
      } as unknown as import('@asci/shared').SDKMessage

      store.set(liveMessagesMapAtom, (prev) => {
        const map = new Map(prev)
        const current = map.get(sessionId) ?? []
        map.set(sessionId, [...current, syntheticMsg])
        return map
      })

      // 2. 清空输入框
      setInputContent('')
      setInputHtmlContent('')
      setPromptSuggestions((prev) => {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })

      // 3. 默认 FIFO 排队（不打断）；「发送键 + ⌥」手势 → 软中断重定向
      const interrupt = opts?.interrupt ?? false
      // 排队态：排队追加到队尾，打断插到队头（它会立即成为下一轮）
      store.set(enqueueMessageUuidAtom, {
        sessionId,
        uuid: localUuid,
        text: effectiveText,
        mode: interrupt ? 'head' : 'tail',
      })
      // 异步发送到后端
      window.electronAPI.queueAgentMessage({
        sessionId,
        userMessage: effectiveText,
        uuid: localUuid,
        interrupt,
      }).catch((error) => {
        console.error('[AgentView] 追加消息失败:', error)
        toast.error(tConversation('agent.toast.appendFailed.title'), { description: String(error) })
        // 回滚：从 liveMessages 移除
        store.set(liveMessagesMapAtom, (prev) => {
          const map = new Map(prev)
          const current = (map.get(sessionId) ?? []).filter(
            (m) => (m as unknown as { uuid?: string }).uuid !== localUuid
          )
          map.set(sessionId, current)
          return map
        })
        // 回滚：从排队徽标队列移除该 uuid
        store.set(removeMessageUuidAtom, { sessionId, uuid: localUuid })
      })
      return
    }

    const recoveryDraft = captureSendDraft({
      text: opts?.textOverride ?? inputContent,
      html: opts?.textOverride ? '' : inputHtmlContent,
      files: pendingFiles,
      mentions: pendingMentions,
      image: selectedImage,
    }, window.__pendingAgentFileData ?? new Map())
    store.set(sendRecoveryDraftsAtom, previous => new Map(previous).set(sessionId, recoveryDraft))

    // 清除当前会话的错误消息
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    // 清除当前会话的提示建议
    setPromptSuggestions((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    // 1. 如果有 pending 文件，先保存到 session 目录
    let fileReferences = ''
    if (pendingFiles.length > 0) {
      try {
        const workspace = workspaces.find((w) => w.id === currentWorkspaceId)
        const filesToSave = pendingFiles.map((file) => {
          const data = window.__pendingAgentFileData?.get(file.id)
          if (data === undefined) throw new Error('Attachment data unavailable')
          return { filename: file.filename, data }
        })
        const saved = await window.electronAPI.saveFilesToAgentSession({
          workspaceSlug: workspace?.slug,
          sessionId,
          files: filesToSave,
        })
        const refs = saved.map((file) => `- ${file.filename}: ${file.targetPath}`).join('\n')
        fileReferences += `<attached_files>\n${refs}\n</attached_files>\n\n`
      } catch (error) {
        console.error('[AgentView] 保存附件到 session 失败:', error)
        setAgentStreamErrors(previous => new Map(previous).set(sessionId, tCommon('sendRecovery.attachmentFailed')))
        return
      }

      // 清理
      for (const f of pendingFiles) {
        if (f.previewUrl?.startsWith('blob:')) URL.revokeObjectURL(f.previewUrl)
        window.__pendingAgentFileData?.delete(f.id)
      }
      setPendingFiles([])
    }

    // 1.5 @ 目录引用：把目录展开成内含文件清单，注入 <referenced_directory> 块（issue: @ 目录语义）
    //     与 @file 一致只给路径不灌内容；Agent 立即看到目录里有哪些文件，再按需 Read。
    const dirMentions = pendingMentions.filter((m) => m.kind === 'dir')
    if (dirMentions.length > 0 && sessionPath) {
      const dirs: ReferencedDirectory[] = []
      for (const d of dirMentions) {
        try {
          const res = await window.electronAPI.searchWorkspaceFiles(`${sessionPath}/${d.id}`, '', 200)
          const files = res.entries.filter((e) => e.type === 'file').map((e) => `${d.id}/${e.path}`)
          dirs.push({ path: d.id, files, total: files.length })
        } catch (error) {
          console.error(`[AgentView] 展开 @ 目录 ${d.id} 失败:`, error)
          dirs.push({ path: d.id, files: [], total: 0 })
        }
      }
      fileReferences += buildReferencedDirectoriesBlock(dirs)
    }

    // 清空 pendingMentions（已在 effectiveText 里前置 token，发送后从输入区移除 chip）
    if (pendingMentions.length > 0) {
      setPendingMentions([])
    }

    // 2. 构建最终消息
    const finalMessage = fileReferences + effectiveText

    // 防御性快照：将当前流式 assistant 内容保存到消息列表
    // 避免重置流式状态时丢失前一轮回复（竞态场景：complete 事件到达但 STREAM_COMPLETE 尚未到达）
    const prevStream = store.get(agentStreamingStatesAtom).get(sessionId)
    if (prevStream && prevStream.content && !prevStream.running) {
      setMessages((prev) => {
        // 仅在最后一条不是 assistant 消息时追加（避免重复）
        const lastMsg = prev[prev.length - 1]
        if (lastMsg?.role === 'assistant') return prev
        return [...prev, {
          id: `snapshot-${nowMs()}`,
          role: 'assistant' as const,
          content: prevStream.content,
          createdAt: nowMs(),
          model: prevStream.model,
        }]
      })
    }

    // 清除打断状态（上一轮的打断标记不再显示）
    store.set(stoppedByUserSessionsAtom, (prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })

    // 取消 draft 标记，让会话出现在侧边栏
    setDraftSessionIds((prev: Set<string>) => {
      if (!prev.has(sessionId)) return prev
      const next = new Set(prev)
      next.delete(sessionId)
      return next
    })

    // 初始化流式状态（startedAt 由渲染进程生成，传递给主进程原样回传，确保竞态保护使用同一个值）
    const streamStartedAt = nowMs()
    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        teammates: [],
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
      })
      return map
    })

    // 乐观更新：立即显示用户消息
    const tempUserMsg: AgentMessage = {
      id: `temp-${nowMs()}`,
      role: 'user',
      content: finalMessage,
      createdAt: nowMs(),
    }
    setMessages((prev) => [...prev, tempUserMsg])

    // 乐观更新：SDKMessage 格式的用户消息（Phase 4）
    const tempUserSDKMsg: SDKMessage = {
      type: 'user',
      message: {
        content: [{ type: 'text', text: finalMessage }],
      },
      parent_tool_use_id: null,
      _createdAt: nowMs(),
    } as unknown as SDKMessage
    setPersistedSDKMessages((prev) => [...prev, tempUserSDKMsg])

    // 解析用户消息中的 Skill/MCP/Zotero 引用，传递结构化元数据给后端
    const skills = [...effectiveText.matchAll(/\/skill:(\S+)/g)].map(m => m[1]).filter(Boolean) as string[]
    const mcps = [...effectiveText.matchAll(/#mcp:(\S+)/g)].map(m => m[1]).filter(Boolean) as string[]

    const itemKeys = extractZoteroItemKeys(effectiveText)
    const colKeys = extractZoteroCollectionKeys(effectiveText)

    const mentionedZoteroItems: NonNullable<AgentSendInput['mentionedZoteroItems']> = []
    for (const key of itemKeys) {
      let meta = zoteroItemCache.get(key)
      if (!meta) {
        try {
          // issue #462：getItem 返回判别联合 —— 仅 'ok' 时才有 detail；已删除 / 故障跳过本条 @ 提及
          const result = await window.electronAPI.zotero.library.getItem({ itemKey: key })
          if (result.status !== 'ok') {
            console.warn(`[AgentView] Zotero item ${key} 不可用（status=${result.status}），跳过`)
            continue
          }
          const detail = result.detail
          meta = {
            key: detail.key,
            title: detail.title,
            creators: detail.creators,
            date: detail.date,
            tags: detail.tags,
            collections: detail.collections,
          }
        } catch (err) {
          console.warn(`[AgentView] 拉取 Zotero item ${key} 失败，跳过`, err)
          continue
        }
      }
      mentionedZoteroItems.push({
        key: meta.key,
        title: meta.title,
        creators: meta.creators,
        date: meta.date,
      })
    }

    const mentionedZoteroCollections: NonNullable<AgentSendInput['mentionedZoteroCollections']> = []
    for (const key of colKeys) {
      const col = zoteroCollectionLocalRef.current.get(key)
      if (!col) continue
      mentionedZoteroCollections.push({ key, name: col.name, path: col.path })
    }

    // 按编辑器里实际 @ 的 itemKey 从 cache 派生附件路径（删除 mention 后自动不再发送）
    const zoteroAttachments: NonNullable<AgentSendInput['zoteroAttachments']> = []
    for (const key of itemKeys) {
      const att = zoteroAttachmentsCacheRef.current.get(key)
      if (!att) continue
      zoteroAttachments.push({ itemKey: key, filename: att.filename, path: att.path })
    }

    // @evidence-set:<id> 引用：id 保序去重，name 从 pendingMentions 的 label 派生（主进程按 id 重查权威内容）
    const mentionedEvidenceSets = extractEvidenceSetIds(effectiveText).map((id) => ({
      id,
      name: pendingMentions.find((m) => m.kind === 'evidence-set' && m.id === id)?.label ?? id,
    }))

    const input: AgentSendInput = {
      sessionId,
      userMessage: finalMessage,
      imageEditReferenceId: selectedImage?.imageId,
      taskMode,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
      effort: resolveSessionEffort(),
      ...(skills.length > 0 && { mentionedSkills: skills }),
      ...(mcps.length > 0 && { mentionedMcpServers: mcps }),
      ...(mentionedZoteroItems.length > 0 && { mentionedZoteroItems }),
      ...(mentionedZoteroCollections.length > 0 && { mentionedZoteroCollections }),
      ...(zoteroAttachments.length > 0 && { zoteroAttachments }),
      ...(mentionedEvidenceSets.length > 0 && { mentionedEvidenceSets }),
    }

    store.set(lockTaskModeAtom, sessionId)
    setInputContent('')
    setInputHtmlContent('')

    // 版本引用已绑定到 input 与恢复快照；发送后不再把它显示成下一条草稿。
    if (selectedImage) setImageEditDrafts(previous => consumeImageEditDraft(previous, sessionId, selectedImage))
    window.electronAPI.sendAgentMessage(input).then(() => {
      if (!store.get(agentStreamErrorsAtom).has(sessionId)) store.set(forgetSendDraftAtom, {sessionId, draft: recoveryDraft})
    }).catch((error) => {
      console.error('[AgentView] 发送消息失败:', error)
      setAgentStreamErrors(previous => new Map(previous).set(sessionId, error instanceof Error ? error.message : String(error)))
      setStreamingStates((prev) => {
        if (!prev.has(sessionId)) return prev
        const map = new Map(prev)
        map.delete(sessionId)
        return map
      })
    })
  }, [taskMode, inputContent, inputHtmlContent, tCommon, pendingFiles, pendingMentions, selectedImage, setImageEditDrafts, sessionId, agentChannelId, agentModelId, currentWorkspaceId, workspaces, streaming, hasAvailableModel, store, setStreamingStates, setPendingFiles, setPendingMentions, setAgentStreamErrors, setPromptSuggestions, setInputContent, setLiveMessagesMap, zoteroItemCache])

  // 一键触发（如「找研究空白」）→ 直接派发 handleSend，不经输入框二段式回车。
  // textOverride 直接带正文，绕过 inputContent state 时序；写入后立即清空 atom 防重复发送。
  const [pendingAutoSend, setPendingAutoSend] = useAtom(pendingAutoSendPromptAtom)
  React.useEffect(() => {
    if (!pendingAutoSend) return
    const text = pendingAutoSend
    setPendingAutoSend(null)
    void handleSend({ textOverride: text })
  }, [pendingAutoSend, setPendingAutoSend, handleSend])

  /** 停止生成 */
  const handleStop = React.useCallback((): void => {
    setStreamingStates((prev) => {
      const current = prev.get(sessionId)
      if (!current || !current.running) return prev
      const map = new Map(prev)
      map.set(sessionId, {
        ...current,
        running: false,
        ...finalizeStreamingActivities(current.toolActivities, current.teammates),
      })
      return map
    })

    // 硬停：清空排队徽标（残留排队消息会变孤儿）
    store.set(clearQueuedMessageUuidsAtom, sessionId)

    window.electronAPI.stopAgent(sessionId).catch(console.error)
  }, [sessionId, setStreamingStates, store])

  /** 手动发送 /compact 命令 */
  const handleCompact = React.useCallback(async (): Promise<void> => {
    if (taskMode !== 'coding' || !agentChannelId || streaming) return

    const streamStartedAt = nowMs()
    // 2. 初始化流式状态 + 乐观设 isCompacting=true（SDK compacting 事件之前就显示"正在压缩..."分隔符）
    setStreamingStates((prev) => {
      const map = new Map(prev)
      const current = prev.get(sessionId) ?? {
        running: true,
        content: '',
        toolActivities: [],
        teammates: [],
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
      }
      map.set(sessionId, { ...current, running: true, startedAt: streamStartedAt, isCompacting: true, compactInFlight: true })
      return map
    })

    await window.electronAPI.sendAgentMessage({
      sessionId,
      taskMode: store.get(taskModesAtom)[sessionId] ?? 'search',
      userMessage: '/compact',
      contextBeforeTokens: contextStatus.inputTokens,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
    }).catch((error) => {
      console.error('[AgentView] /compact 发送失败:', error)
      setStreamingStates((prev) => {
        const map = new Map(prev)
        const current = prev.get(sessionId)
        if (!current) return prev
        map.set(sessionId, { ...current, isCompacting: false, compactInFlight: false })
        return map
      })
      throw error
    })
  }, [taskMode, sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setStreamingStates, store, contextStatus.inputTokens])

  /** 复制错误信息到剪贴板 */
  const handleCopyError = React.useCallback(async (): Promise<void> => {
    if (!agentError) return

    try {
      await navigator.clipboard.writeText(agentError)
      setErrorCopied(true)
      setTimeout(() => setErrorCopied(false), COPY_FEEDBACK_RESET_MS)
    } catch (error) {
      console.error('[AgentView] 复制错误信息失败:', error)
    }
  }, [agentError])

  /** 重试：在当前会话中重新发送最后一条用户消息 */
  const handleRetry = React.useCallback((): void => {
    if (!agentChannelId || streaming) return

    // 找到最后一条用户消息
    const lastUserMsg = [...messages].reverse().find((m) => m.role === 'user')
    if (!lastUserMsg) return
    if (latestTurnAttemptedImage(persistedSDKMessages)) {
      setInputContent(lastUserMsg.content)
      toast.warning(tConversation('imageRetryReview'))
      return
    }

    // 自进化隐式反馈（#427）：重试 = 对上一轮产出的负向信号
    captureFeedback('retry', 'message', sessionId)

    // 清除错误状态
    setAgentStreamErrors((prev) => {
      if (!prev.has(sessionId)) return prev
      const map = new Map(prev)
      map.delete(sessionId)
      return map
    })

    // 初始化流式状态（startedAt 由渲染进程生成，传递给主进程原样回传）
    const streamStartedAt = nowMs()
    setStreamingStates((prev) => {
      const map = new Map(prev)
      map.set(sessionId, {
        running: true,
        content: '',
        toolActivities: [],
        teammates: [],
        model: agentModelId || undefined,
        startedAt: streamStartedAt,
      })
      return map
    })

    window.electronAPI.sendAgentMessage({
      sessionId,
      taskMode: store.get(taskModesAtom)[sessionId] ?? 'search',
      userMessage: lastUserMsg.content,
      imageEditReferenceId: selectedImage?.imageId,
      channelId: agentChannelId,
      modelId: agentModelId || undefined,
      workspaceId: currentWorkspaceId || undefined,
      startedAt: streamStartedAt,
    }).catch(console.error)
  }, [messages, persistedSDKMessages, selectedImage, sessionId, agentChannelId, agentModelId, currentWorkspaceId, streaming, setAgentStreamErrors, setStreamingStates, tConversation])

  /** 在新会话中重试：创建新会话 + 切换 tab + 发送引用旧会话的提示词 */
  const handleRetryInNewSession = React.useCallback(async (): Promise<void> => {
    if (!agentChannelId) return

    try {
      const meta = await window.electronAPI.createAgentSession(
        undefined, agentChannelId, currentWorkspaceId || undefined,
      )
      setAgentSessions((prev) => [meta, ...prev])

      // 切换到新会话 tab
      openSession('agent', meta.id, meta.title, meta.workspaceId)

      // 发送引用旧会话的默认提示词（英文 directive，由 Agent 自行 route 输出语言）
      const prompt = `The previous session id is ${sessionId}. You may reference earlier sessions in the same project to continue the work.`

      // 初始化新会话流式状态
      setStreamingStates((prev) => {
        const map = new Map(prev)
        map.set(meta.id, {
          running: true,
          content: '',
          toolActivities: [],
          teammates: [],
          model: agentModelId || undefined,
          startedAt: nowMs(),
        })
        return map
      })

      window.electronAPI.sendAgentMessage({
        sessionId: meta.id,
        userMessage: prompt,
        channelId: agentChannelId,
        modelId: agentModelId || undefined,
        workspaceId: currentWorkspaceId || undefined,
      }).catch(console.error)
    } catch (error) {
      console.error('[AgentView] 在新会话中重试失败:', error)
    }
  }, [sessionId, agentChannelId, agentModelId, currentWorkspaceId, openSession, setAgentSessions, setStreamingStates])

  /** 分叉会话：从指定消息处创建新会话并自动切换 */
  const handleFork = React.useCallback(async (upToMessageUuid: string): Promise<void> => {
    try {
      const meta = await window.electronAPI.forkAgentSession({
        sessionId,
        upToMessageUuid,
      })
      setAgentSessions((prev) => [meta, ...prev])

      openSession('agent', meta.id, meta.title, meta.workspaceId)

      toast.success(tConversation('fork.success'), {
        description: meta.title,
      })
    } catch (error) {
      console.error('[AgentView] 分叉会话失败:', error)
      toast.error(tConversation('fork.failed'), {
        description: error instanceof Error ? error.message : tErrors('common.unknown'),
      })
    }
  }, [sessionId, openSession, setAgentSessions, tConversation, tErrors])

  /** 快照回退：同一会话内回退到指定消息点，恢复文件 + 截断对话 */
  const [rewindTargetUuid, setRewindTargetUuid] = React.useState<string | null>(null)

  const handleRewindRequest = React.useCallback((assistantMessageUuid: string): void => {
    setRewindTargetUuid(assistantMessageUuid)
  }, [])

  const handleRewindConfirm = React.useCallback(async (): Promise<void> => {
    if (!rewindTargetUuid) return
    const targetUuid = rewindTargetUuid
    setRewindTargetUuid(null)

    try {
      const result = await window.electronAPI.rewindSession({
        sessionId,
        assistantMessageUuid: targetUuid,
      })

      if (result.blocked) {
        const blockedKeys = REWIND_BLOCKED_I18N_KEYS[result.blocked.reason]
        toast.warning(tErrors(blockedKeys.title), {
          description: tErrors(blockedKeys.detail),
        })
        return
      }

      store.set(agentMessageRefreshAtom, (prev) => {
        const map = new Map(prev)
        map.set(sessionId, (prev.get(sessionId) ?? 0) + 1)
        return map
      })

      if (result.fileRewind?.canRewind) {
        const fileCount = result.fileRewind.filesChanged?.length ?? 0
        toast.success(tConversation('rewind.successFull'), {
          description: fileCount > 0
            ? tConversation('rewind.successFiles', { count: fileCount })
            : tConversation('rewind.successNoFileChange'),
        })
      } else if (result.fileRewind?.error) {
        toast.warning(tConversation('rewind.warningFilesOnly'), {
          description: tConversation('rewind.warningFilesDescription', { reason: result.fileRewind.error }),
        })
      } else {
        toast.success(tConversation('rewind.successFull'))
      }
    } catch (error) {
      console.error('[AgentView] 回退失败:', error)
      toast.error(tErrors('agentRewind.failedTitle'), {
        description: error instanceof Error ? error.message : tErrors('common.unknown'),
      })
    }
  }, [rewindTargetUuid, sessionId, store, tConversation, tErrors])

  // 监听快捷键系统分发的 stop-generation 事件（Cmd+.）
  React.useEffect(() => {
    const handler = (): void => {
      if (streaming) handleStop()
    }
    window.addEventListener('asci:stop-generation', handler)
    return () => window.removeEventListener('asci:stop-generation', handler)
  }, [streaming, handleStop])

  // 监听快捷键系统分发的 focus-input 事件（Cmd+L）
  React.useEffect(() => {
    const handler = (): void => {
      const proseMirror = document.querySelector('[data-input-mode="agent"] .ProseMirror') as HTMLElement | null
      proseMirror?.focus()
    }
    window.addEventListener('asci:focus-input', handler)
    return () => window.removeEventListener('asci:focus-input', handler)
  }, [])

  const allAskUserRequests = useAtomValue(allPendingAskUserRequestsAtom)
  const allExitPlanRequests = useAtomValue(allPendingExitPlanRequestsAtom)
  const allLitReviewDirectionsRequests = useAtomValue(allPendingLitReviewDirectionsRequestsAtom)
  const allSearchPlanRequests = useAtomValue(allPendingSearchPlanRequestsAtom)
  const hasBannerOverlay =
    (allAskUserRequests.get(sessionId)?.length ?? 0) > 0 ||
    (allExitPlanRequests.get(sessionId)?.length ?? 0) > 0 ||
    (allLitReviewDirectionsRequests.get(sessionId)?.length ?? 0) > 0 ||
    (allSearchPlanRequests.get(sessionId)?.length ?? 0) > 0

  const isHome = !agentError && messagesLoaded && messages.length === 0 && persistedSDKMessages.length === 0 && liveMessages.length === 0 && !streaming && !hasBannerOverlay
  const hasTextInput = inputContent.trim().length > 0
  const canSend = (hasTextInput || pendingFiles.length > 0 || pendingMentions.length > 0) && agentChannelId !== null && hasAvailableModel && (!streaming || hasTextInput && !selectedImage)

  return (
    <>
    <AgentSessionProvider sessionId={sessionId}>
      {/* 主内容区域 */}
      <div className={cn("flex flex-col h-full flex-1 min-w-0 mx-auto", isHome ? "home-conversation" : "conversation-column w-full max-w-[716px]")} data-home-empty={isHome || undefined}>
        {isHome && taskMode === 'coding' && <BinaryBackdrop />}
        {/* 消息区域 */}
        {isHome ? <>
          <HomeWelcome />
        </> : agentError && messages.length === 0 && persistedSDKMessages.length === 0 && liveMessages.length === 0 ? <div className="flex-1" /> : <AgentMessages
          sessionId={sessionId}
          sessionModelId={agentModelId || undefined}
          messages={messages}
          messagesLoaded={messagesLoaded}
          persistedSDKMessages={persistedSDKMessages}
          streaming={streaming}
          streamState={streamState}
          liveMessages={liveMessages}
          sessionPath={sessionPath}
          stoppedByUser={stoppedByUser}
          onRetry={handleRetry}
          onRetryInNewSession={handleRetryInNewSession}
          onFork={handleFork}
          onRewind={handleRewindRequest}
          onCompact={taskMode === 'coding' ? handleCompact : undefined}
        />}

        <AgentFailureRecovery sessionId={sessionId} />

        {/* 权限请求横幅 */}
        <PermissionBanner sessionId={sessionId} />

        {/* AskUserQuestion 交互式问答横幅 */}
        <AskUserBanner sessionId={sessionId} />

        {/* Plan 模式指示条 */}
        {isPlanMode && (
          <div className="mx-4 mb-2 flex items-center gap-2 px-3 py-2 rounded-lg bg-primary/5 text-primary text-sm animate-in fade-in slide-in-from-bottom-1 duration-200">
            <MapIcon className="size-4 animate-pulse" />
            <span className="font-medium">{tConversation('agent.planMode.title')}</span>
            <span className="text-xs text-muted-foreground">{tConversation('agent.planMode.subtitle')}</span>
          </div>
        )}

        {/* ExitPlanMode 计划审批横幅 */}
        <ExitPlanModeBanner sessionId={sessionId} />

        {/* lit-review Turn 1 方向选择横幅（spec §5.4）*/}
        <LitReviewDirectionsBanner sessionId={sessionId} />

        {/* lit-search 检索方案确认横幅（issue #435）*/}
        <SearchPlanBanner sessionId={sessionId} />

        {/* 输入区域 — 交互横幅显示时隐藏，由横幅替代 */}
        {!hasBannerOverlay && (
        <div className={cn("shrink-0 px-2.5 pt-3 pb-3.5 md:px-[18px] md:pb-3.5", isHome && "home-composer")} data-input-mode="agent">
          <div
            className={cn(
              'agent-composer-surface rounded-[17px] border-[0.5px] border-border bg-background shadow-sm focus-within:ring-2 focus-within:ring-ring/20 transition-shadow duration-200',
              (isPlanMode || isPermissionPlanMode) && !isDragOver && 'plan-mode-border'
            )}
            data-drag-over={isDragOver}
            data-disabled={!agentChannelId || !hasAvailableModel}
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
          >
            {(isPlanMode || isPermissionPlanMode) && !isDragOver && <PlanModeDashedBorder />}

            <ImageEditReference sessionId={sessionId} />
            {/* 附件预览区域 */}
            {pendingFiles.length > 0 && (
              <div className="flex flex-wrap gap-2 px-3 pt-2.5 pb-1.5">
                {pendingFiles.map((file) => (
                  <AttachmentPreviewItem
                    key={file.id}
                    filename={file.filename}
                    mediaType={file.mediaType}
                    previewUrl={file.previewUrl}
                    onRemove={() => handleRemoveFile(file.id)}
                  />
                ))}
              </div>
            )}

            {/* 无渠道/无模型时不再显示重复的欢迎块：输入框始终渲染、此时置为禁用态，
                占位提示说明原因；配置入口由下方工具栏的「无可用模型 → 打开设置」CTA 承担 */}
            <>
              <QueuedMessagesBar items={queuedList} />
              <RichTextInput
                value={inputContent}
                onChange={setInputContent}
                onSubmit={handleSend}
                onPasteFiles={handlePasteFiles}
                disabled={!agentChannelId || !hasAvailableModel}
                placeholder={
                  !agentChannelId
                    ? tConversation('agent.emptyState.welcomeBody')
                    : !hasAvailableModel
                    ? tConversation('agent.emptyState.noModelBody')
                    : isHome ? tHome('home.placeholder') : inputPlaceholder
                }
                rotatingPlaceholders={isHome ? undefined : rotatingPlaceholders}
                rotatingPrefix={tConversation('input.inputPrefix')}
                tabFillValue={suggestion && !streaming ? suggestion : null}
                onTabFill={() => {
                  setPromptSuggestions((prev) => {
                    if (!prev.has(sessionId)) return prev
                    const map = new Map(prev)
                    map.delete(sessionId)
                    return map
                  })
                }}
                autoFocusTrigger={`${sessionId}:${selectedImage?.imageId ?? ''}`}
                collapsible
                workspacePath={sessionPath}
                workspaceSlug={workspaceSlug}
                workspaceId={currentWorkspaceId}
                attachedDirs={allAttachedDirs}
                htmlValue={inputHtmlContent}
                onHtmlChange={setInputHtmlContent}
                sendWithCmdEnter={sendWithCmdEnter}
                zoteroEnabled={zoteroEnabled}
                zoteroRunning={zoteroPingStatus.running}
                onZoteroItemSelect={handleZoteroItemSelect}
                onZoteroCollectionSelect={handleZoteroCollectionSelect}
                onLaunchZotero={handleLaunchZotero}
                pendingMentions={pendingMentions}
                onMentionAdd={handleAddMention}
                onMentionRemove={handleRemoveMention}
              />
            </>

            {/* Footer 工具栏 */}
            <div className="agent-composer-toolbar flex items-center justify-between flex-wrap px-2 py-1 min-h-[44px] gap-x-2 gap-y-1">
              <div className="flex items-center gap-1.5 flex-1 min-w-0">
                <Tooltip>
                  <TooltipTrigger asChild>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      className="agent-composer__icon-button rounded-full text-foreground hover:text-foreground"
                      aria-label={tConversation('input.attachTooltip')}
                      onClick={handleOpenFileDialog}
                    >
                      <Plus aria-hidden="true" className="!size-4" strokeWidth={1.5} />
                    </Button>
                  </TooltipTrigger>
                  <TooltipContent side="top">
                    <p>{tConversation('input.attachTooltip')}</p>
                  </TooltipContent>
                </Tooltip>
                <TaskModeSelector value={taskMode} onChange={setTaskMode} disabled={streaming || !messagesLoaded} locked={modeLocked} />
                {taskMode === 'coding' && <PermissionModeSelector sessionId={sessionId} />}
                {/* <FeishuNotifyToggle sessionId={sessionId} /> */}
              </div>

              {/* 右侧组：模型选择 + 用量紧挨发送按钮 */}
              <div className="ml-auto flex min-w-0 items-center gap-1.5">
                <ModelSelector
                  filterChannelIds={agentChannelIds}
                  externalSelectedModel={externalSelectedModel}
                  onModelSelect={handleModelSelect}
                  reasoning={reasoningForModel}
                />
                {taskMode === 'coding' && <ContextUsageBadge
                  key={sessionId}
                  sessionId={sessionId}
                  candidates={contextCandidates(persistedSDKMessages)}
                  inputTokens={contextStatus.inputTokens}
                  outputTokens={contextStatus.outputTokens}
                  cacheReadTokens={contextStatus.cacheReadTokens}
                  cacheCreationTokens={contextStatus.cacheCreationTokens}
                  contextWindow={contextStatus.contextWindow}
                  isCompacting={contextStatus.isCompacting}
                  isProcessing={streaming}
                  onCompact={handleCompact}
                />}
                {streaming && !hasTextInput ? (
                  <Button
                    type="button"
                    size="icon"
                    className="agent-composer__stop rounded-full bg-foreground text-background hover:bg-foreground/90 [&_svg]:!size-[11px]"
                    onClick={handleStop}
                  >
                    <Square className="size-[12px]" fill="currentColor" strokeWidth={0} />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className={cn(
                      'agent-composer__send rounded-full p-0 bg-foreground text-background hover:bg-foreground/85 [&_svg]:!size-4',
                      !canSend && 'bg-foreground/15 cursor-not-allowed hover:bg-foreground/15',
                      // 圆底跟随 text 色：有输入变黑、默认浅灰（发送 icon 原色）

                    )}
                    aria-label={tHome('home.send')}
                    onClick={() => handleSend()}
                    disabled={!canSend}
                  >
                    <ArrowUp strokeWidth={1.5} aria-hidden="true" />
                  </Button>
                )}
              </div>
            </div>
          </div>
          {isHome && <div className="coding-project-row" data-open={taskMode === 'coding'} aria-hidden={taskMode !== 'coding'}>
            <div><ProjectSwitcher variant="composer" onSelectProject={(workspace) => {
              if (workspace.id === currentWorkspaceId) return
              void (async () => {
                const meta = await window.electronAPI.createAgentSession(undefined, agentChannelId || undefined, workspace.id)
                setAgentSessions(prev => [meta, ...prev])
                setDraftSessionIds(prev => new Set(prev).add(meta.id))
                store.set(taskModesAtom, prev => ({ ...prev, [meta.id]: 'coding' }))
                setDraftsMap(prev => new Map(prev).set(meta.id, inputContent))
                setDraftHtmlMap(prev => new Map(prev).set(meta.id, inputHtmlContent))
                openSession('agent', meta.id, meta.title, workspace.id)
              })().catch(error => { console.error('[选择项目] 创建项目草稿失败:', error); toast.error(tHome('home.projectFailed')) })
            }} /></div>
          </div>}
        </div>
        )}
        {isHome && !inputContent && pendingFiles.length === 0 && !selectedImage && (
            <HomeSuggestions mode={taskMode} onSelect={(prompt) => {
              setInputContent(prompt)
              setInputHtmlContent('')
              requestAnimationFrame(() => document.querySelector<HTMLElement>('.ProseMirror')?.focus())
            }} />
          )}
        {isHome && <HomeLocalNote />}
      </div>
    </AgentSessionProvider>

    {/* 回退确认弹窗 */}
    <AlertDialog
      open={rewindTargetUuid !== null}
      onOpenChange={(v) => { if (!v) setRewindTargetUuid(null) }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{tConversation('rewind.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {tConversation('rewind.confirmDescription')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{tConversation('rewind.confirmCancel')}</AlertDialogCancel>
          <AlertDialogAction
            onClick={handleRewindConfirm}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
          >
            {tConversation('rewind.confirmAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
    </>
  )
}

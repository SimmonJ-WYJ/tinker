import { nativeMessageIdentity } from '@/lib/native-message-identity'
import { HOST_TURN_STOPPED_SUBTYPE } from '@asci/shared'
import { RESEARCH_UI_ENABLED } from '@/lib/product-surface'
import { collectImageVersions } from './image-versions'
import { GeneratedImage } from './GeneratedImage.tsx'
import { UserInputMessage } from './UserInputMessage.tsx'
import { ConversationSymbol } from './ConversationSymbol.tsx'
import { ImageGenerationStatus } from './ImageGenerationStatus.tsx'
import { extractUserText } from './message-attachments.ts'
import { GeneratedImageReferenceProvider } from './generated-image-references.tsx'
/**
 * SDKMessageRenderer — 渲染 SDKMessage 对象
 *
 * 支持两种渲染模式：
 * 1. 单条消息：SDKMessageRenderer（用于实时流式消息）
 * 2. Turn 分组：AssistantTurnRenderer（用于持久化消息）
 *
 * Turn 分组规则：
 * - 用户消息后到下一条用户消息之间的所有 assistant 消息组成一个 turn
 * - user(tool_result) 消息属于当前 turn（不中断分组）
 * - system 消息独立渲染
 *
 * 展示规则（v0.9.26 起）：
 * - assistant turn 以品牌符号与正文对齐，不重复展示模型名称；
 *   时间戳移至底部操作栏，紧挨复制按钮左侧。
 * - user 消息不再展示头像/名称；气泡右对齐，时间戳 hover 可见。
 */

import * as React from 'react'
import { useAtomValue, useSetAtom } from 'jotai'
import { Loader2, AlertTriangle, BookmarkPlus, Check, Plus, ThumbsUp, ThumbsDown, Ban } from 'lucide-react'
import { toast } from 'sonner'
import { cn } from '@/lib/utils'
import { useIsDevMode } from '@/lib/dev-mode'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { Button } from '@/components/ui/button'
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip'
import { currentAgentSessionIdAtom, currentAgentWorkspaceIdAtom } from '@/atoms/agent-atoms'
import { openEvidenceSetIdAtom } from '@/atoms/open-evidence-set-atom'
import {
  feedbackServerMapAtom,
  feedbackOverridesAtom,
  setMessageFeedbackOverrideAtom,
  type FeedbackSelection,
} from '@/atoms/session-feedback-atoms'
import type { EvidenceSetSummary, ObjectId } from '@asci/shared'
import { processPresentation } from './process-presentation'
import { RunningStatusText } from './RunningStatusText.tsx'
import { ContentBlock } from './ContentBlock'
import { findToolResultInMessages } from './tool-result-lookup'
import { ResearchGapResultRenderer } from './tool-result-renderers/research-gap-result.tsx'
import { TaskProgressCard, TASK_TOOL_NAMES } from './TaskProgressCard'
import { groupExecutionSteps } from './group-execution-steps.ts'
import { ExecutionStepGroup } from './ExecutionStepGroup.tsx'
import { DurationBadge } from './AgentMessages'
import {
  Message,
  MessageContent,
  MessageActions,
  MessageAction,
  MessageResponse,
} from '@/components/ai-elements/message'
import { CopyButton } from '@/components/common/CopyButton'
import { MessageMoreActions } from './MessageMoreActions.tsx'
import { DebugCopyButton } from './DebugCopyButton'
import { formatMessageTime } from '@/components/common/format-message-time'
import { useT } from '@/hooks/useT'
import type {
  SDKMessage,
  SDKAssistantMessage,
  SDKUserMessage,
  SDKSystemMessage,
  SDKContentBlock,
  SDKResultMessage,
  AgentEventUsage,
  SDKToolUseBlock,
  SDKToolResultBlock,
} from '@asci/shared'
import { buildQaSnapshot, isSubagentToolUse, toIso } from '@asci/shared'
import type { AgentSpeaker } from '@asci/shared'
import type { ToolActivity } from '@/atoms/agent-atoms'
import { resolveMessageSpeaker, speakerDisplayName } from './resolve-message-speaker.ts'
import { getScenarioIcon } from './scenario-icon.tsx'

// ===== SDKMessageRenderer Props =====

export interface SDKMessageRendererProps {
  /** 要渲染的消息 */
  message: SDKMessage
  /** 所有消息（用于 ContentBlock 内查找工具结果） */
  allMessages: SDKMessage[]
  /** 相对路径解析基准 */
  basePath?: string
}

// ===== system 消息：上下文压缩分割线 =====

function CompactBoundaryDivider({ message }: { message?: SDKSystemMessage }): React.ReactElement {
  const { t } = useT('conversation')
  const isDevMode = useIsDevMode()
  // dev 观测：展示压缩触发时的上下文用量 used/total（分子 = SDK compact_metadata.pre_tokens，
  // 分母 = orchestrator 标记的 _contextWindow）。仅有效 dev 模式可见，dev-only 文案无需 i18n。
  const devUsage = ((): string | null => {
    if (!isDevMode || !message) return null
    const used = (message as { compact_metadata?: { pre_tokens?: number } }).compact_metadata?.pre_tokens
    const total = (message as { _contextWindow?: number })._contextWindow
    if (typeof used !== 'number' || typeof total !== 'number' || total <= 0) return null
    return `${used.toLocaleString()}/${total.toLocaleString()} (${Math.round((used / total) * 100)}%)`
  })()
  return (
    <div className="flex items-center gap-3 my-4 px-1">
      <div className="flex-1 h-px bg-border/40" />
      <span className="shrink-0 text-badge text-muted-foreground/60 px-2 py-0.5 rounded-md border border-border/30 bg-muted/20">
        {t('agent.sdkMessage.contextCompacted')}
        {devUsage && <span className="ml-1.5 tabular-nums text-muted-foreground/50">· {devUsage}</span>}
      </span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  )
}

// ===== system 消息：正在压缩指示器（与 CompactBoundaryDivider 同款横线样式，pill 内带 spinner） =====

export function CompactingIndicator(): React.ReactElement {
  const { t } = useT('conversation')
  return (
    <div className="flex items-center gap-3 my-4 px-1">
      <div className="flex-1 h-px bg-border/40" />
      <span className="shrink-0 inline-flex items-center gap-1.5 text-badge text-muted-foreground/70 px-2 py-0.5 rounded-md border border-border/30 bg-muted/20">
        <Loader2 className="size-3 animate-spin" />
        {t('agent.sdkMessage.compacting')}
      </span>
      <div className="flex-1 h-px bg-border/40" />
    </div>
  )
}

// ===== 辅助：从 SDKMessage 提取元数据 =====

interface MessageMeta {
  createdAt?: number
}

function extractMeta(message: SDKMessage): MessageMeta {
  const msg = message as Record<string, unknown>
  return {
    createdAt: typeof msg._createdAt === 'number' ? msg._createdAt : undefined,
  }
}

/** 从 turn 消息列表中提取 result 消息的耗时和用量数据 */
function extractTurnUsage(turnMessages: SDKMessage[]): { durationMs?: number; usage?: AgentEventUsage } {
  for (const msg of turnMessages) {
    if (msg.type !== 'result') continue
    const resultMsg = msg as SDKResultMessage
    const raw = msg as Record<string, unknown>
    const durationMs = typeof raw._durationMs === 'number' ? raw._durationMs : undefined
    const u = resultMsg.usage
    if (!u) return { durationMs }
    const contextWindow = resultMsg.modelUsage
      ? Object.values(resultMsg.modelUsage)[0]?.contextWindow
      : undefined
    return {
      durationMs,
      usage: {
        inputTokens: u.input_tokens + (u.cache_read_input_tokens ?? 0) + (u.cache_creation_input_tokens ?? 0),
        outputTokens: u.output_tokens,
        cacheReadTokens: u.cache_read_input_tokens,
        cacheCreationTokens: u.cache_creation_input_tokens,
        costUsd: resultMsg.total_cost_usd,
        contextWindow,
      },
    }
  }
  return {}
}

// ===== 辅助：从 user 消息中提取纯文本内容 =====

// ===== 辅助：判断 user 消息是否为真正的人类用户输入（非工具结果/子代理提示） =====

function isUserInputMessage(message: SDKUserMessage): boolean {
  if (message.parent_tool_use_id) return false
  // SDK 合成消息（如 Skill 展开 prompt）不是用户输入
  if (message.isSynthetic) return false
  // 包含 tool_result 块的消息是工具结果，不是用户输入
  const content = message.message?.content
  if (Array.isArray(content) && content.some((b) => b.type === 'tool_result')) return false
  return extractUserText(message) !== null
}

// ===== Turn 分组类型 =====

export interface AssistantTurn {
  type: 'assistant-turn'
  /** 当前 turn 内所有 assistant 消息 */
  assistantMessages: SDKAssistantMessage[]
  /** 当前 turn 内所有消息（含 tool_result user 消息，供工具结果查找） */
  turnMessages: SDKMessage[]
  /** 模型名称（取首条 assistant 消息的 model） */
  model?: string
  /** 创建时间（取首条 assistant 消息的时间） */
  createdAt?: number
}

export type MessageGroup =
  | { type: 'user'; message: SDKUserMessage }
  | { type: 'system'; message: SDKSystemMessage }
  | AssistantTurn

/**
 * 将 SDKMessage 列表分组为可渲染的 Turn
 *
 * 规则：
 * 1. user（真正用户输入）→ 单独的 user group
 * 2. assistant + user(tool_result) + assistant... → 合并为一个 assistant-turn
 * 3. system（compact_boundary / compacting）→ 独立渲染，其他归入当前 turn
 * 4. 其他类型（result, tool_progress 等）→ 归入当前 assistant-turn
 * 5. 后处理：合并相邻同模型的 assistant-turn（处理子代理切换模型导致的碎片化）
 */
export function groupIntoTurns(messages: SDKMessage[], sessionModelId?: string): MessageGroup[] {
  const groups: MessageGroup[] = []
  let currentTurn: AssistantTurn | null = null

  const flushTurn = (): void => {
    if (currentTurn && currentTurn.assistantMessages.length > 0) {
      groups.push(currentTurn)
    }
    currentTurn = null
  }

  for (const msg of messages) {
    if (msg.type === 'user') {
      const userMsg = msg as SDKUserMessage
      if (isUserInputMessage(userMsg)) {
        const userContent = userMsg.message?.content
        if (Array.isArray(userContent) && userContent.every(block => block.type === 'text') && userContent.map(block => (block as { text: string }).text).join('').trim() === '/compact') continue
        // 真正的用户输入 → 结束当前 turn，开始新段落
        flushTurn()
        groups.push({ type: 'user', message: userMsg })
      } else {
        // tool_result 消息 → 归入当前 turn
        if (currentTurn) {
          currentTurn.turnMessages.push(msg)
        }
      }
    } else if (msg.type === 'assistant') {
      const aMsg = msg as SDKAssistantMessage
      // 跳过重放消息
      if (aMsg.isReplay) continue

      if (!currentTurn) {
        // 开始新 turn
        const meta = extractMeta(msg)
        currentTurn = {
          type: 'assistant-turn',
          assistantMessages: [aMsg],
          turnMessages: [msg],
          model: aMsg._channelModelId || aMsg.message?.model || sessionModelId,
          createdAt: meta.createdAt,
        }
      } else {
        // 继续当前 turn
        currentTurn.assistantMessages.push(aMsg)
        currentTurn.turnMessages.push(msg)
      }
    } else if (msg.type === 'system') {
      const sysMsg = msg as SDKSystemMessage
      // 仅需要独立渲染的 system 消息才中断 turn（compact_boundary / compacting）
      // 其他 system 消息（如 init、task_started、task_progress）归入当前 turn，不中断分组
      if (sysMsg.subtype === 'compact_boundary' || sysMsg.subtype === 'compacting') {
        flushTurn()
        groups.push({ type: 'system', message: sysMsg })
      } else if (currentTurn) {
        currentTurn.turnMessages.push(msg)
      }
    } else {
      // result, tool_progress 等 → 归入当前 turn
      // prompt_suggestion 不属于对话转录，不入 turn，避免被当作文本附加到助手消息末尾
      if ((msg as { type: string }).type === 'prompt_suggestion') {
        continue
      }
      if (currentTurn) {
        currentTurn.turnMessages.push(msg)
      }
    }
  }

  flushTurn()
  return mergeAdjacentSameModelTurns(groups)
}

/**
 * 后处理：合并相邻同模型的 assistant-turn
 *
 * 当子代理（如 haiku）执行多个工具调用时，中间的 user(tool_result) 消息
 * 可能导致 turn 被拆分为多个碎片。此函数将同模型的相邻 assistant-turn 合并，
 * 同时吸收它们之间的非用户输入 group（如被误判为用户输入的子代理内部消息）。
 */
function mergeAdjacentSameModelTurns(groups: MessageGroup[]): MessageGroup[] {
  if (groups.length <= 1) return groups

  const result: MessageGroup[] = []

  for (const group of groups) {
    if (group.type !== 'assistant-turn') {
      result.push(group)
      continue
    }

    // 向前查找可合并的同模型 assistant-turn（跳过非 user-input 的中间 group）
    let mergeTargetIdx = -1
    for (let i = result.length - 1; i >= 0; i--) {
      const prev = result[i]!
      if (prev.type === 'user') break // 真正的用户输入阻断合并
      if (prev.type === 'system' && (prev.message as SDKSystemMessage).subtype === 'compact_boundary') break // 压缩边界阻断合并
      if (prev.type === 'assistant-turn') {
        if (prev.model === group.model) {
          mergeTargetIdx = i
        }
        break // 遇到第一个 assistant-turn 就停止（不跨越不同模型的 turn）
      }
      // system 或其他 group：继续向前查找
    }

    if (mergeTargetIdx >= 0) {
      const target = result[mergeTargetIdx] as AssistantTurn
      target.assistantMessages.push(...group.assistantMessages)
      target.turnMessages.push(...group.turnMessages)
    } else {
      result.push(group)
    }
  }

  return result
}

/** reviews/*.html 路径匹配：相对 `reviews/x.html`、POSIX 子路径、Windows 子路径，兼容历史 `.htm` */
const REVIEW_HTML_PATH_RE = /(?:^|[\\/])reviews[\\/][^\\/]+\.html?$/i

/** 该 content block 是否为「写或改综述 HTML」的 tool_use（Write 或 Edit 到 reviews/*.html）。
 *  既认 Write（skill 首次落 HTML），也认 Edit（fact-check 修正综述用 Edit，见 issue：综述无法加入证据集）。
 *  字段名兼容 snake_case `file_path` 与 camelCase `filePath`（见 tool-phrase.ts 同款兼容）。 */
function isReviewWriteOrEdit(block: SDKContentBlock): boolean {
  if (block.type !== 'tool_use') return false
  const tu = block as SDKToolUseBlock
  if (tu.name !== 'Write' && tu.name !== 'Edit') return false
  const input = tu.input as { file_path?: unknown; filePath?: unknown } | undefined
  const raw = input?.file_path ?? input?.filePath
  return typeof raw === 'string' && REVIEW_HTML_PATH_RE.test(raw)
}

/**
 * 判定当前 turn 所属的「逻辑请求」是否产出 / 修改了综述 HTML（"加入证据集"是否带入综述被引论文的 flag）。
 *
 * **为什么扫整段请求而非单个 turn**：大综述在 `Write reviews/*.html` 之后常因上下文超限触发
 * `compact_boundary`，而 `groupIntoTurns` 见到压缩边界会 flush turn —— 于是 `Write` 落在压缩前的
 * turn、最终总结落在压缩后的 turn。"加入证据集"按钮挂在总结所在 turn 上，单扫该 turn 找不到 `Write`
 * （此时综述修正还是 `Edit`），`isReviewOutput` 误判为 false → IPC `includeReviewCitations=false` →
 * 服务端跳过综述被引论文 → UI 显示"本回答未引用相关论文"。
 *
 * 修复：扫「上一条真实 user-input → 当前 turn 末尾」整段（**跨 `compact_boundary`**，但遇到真实
 * user-input 即止——后续独立 Q&A 不会被误带入综述论文，保留原 message 粒度的意图），并**同时识别
 * Write 与 Edit**。
 */
export function requestSpanProducedReview(allMessages: SDKMessage[], turn: AssistantTurn): boolean {
  if (turn.assistantMessages.length === 0) return false
  const firstUuid = turn.assistantMessages[0]?.uuid
  const lastUuid = turn.assistantMessages[turn.assistantMessages.length - 1]?.uuid
  if (!firstUuid || !lastUuid) return false
  const firstIdx = allMessages.findIndex(
    (m) => m.type === 'assistant' && (m as SDKAssistantMessage).uuid === firstUuid,
  )
  const lastIdx = allMessages.findIndex(
    (m) => m.type === 'assistant' && (m as SDKAssistantMessage).uuid === lastUuid,
  )
  if (firstIdx < 0 || lastIdx < 0) return false
  // 请求起点：当前 turn 首条 assistant 之前最近的一条真实 user-input（不含它）；找不到则从头扫
  let startIdx = 0
  for (let i = firstIdx - 1; i >= 0; i--) {
    const m = allMessages[i]
    if (m && m.type === 'user' && isUserInputMessage(m as SDKUserMessage)) {
      startIdx = i + 1
      break
    }
  }
  // 扫 [startIdx, lastIdx] 内所有 assistant 消息找 Write/Edit reviews/*.html
  for (let i = startIdx; i <= lastIdx; i++) {
    const m = allMessages[i]
    if (!m || m.type !== 'assistant') continue
    const blocks = (m as SDKAssistantMessage).message?.content
    if (Array.isArray(blocks) && blocks.some(isReviewWriteOrEdit)) return true
  }
  return false
}

// ===== AssistantTurnRenderer — 渲染一个完整的 assistant turn =====

export interface AssistantTurnRendererProps {
  turn: AssistantTurn
  /** 所有消息（全局，供工具结果查找跨 turn 的结果） */
  allMessages: SDKMessage[]
  basePath?: string
  /** 分叉回调（传入最后一条 assistant 消息的 uuid） */
  onFork?: (upToMessageUuid: string) => void
  /** 回退回调（传入 assistant message uuid） */
  onRewind?: (assistantMessageUuid: string) => void
  /** 是否正在流式输出中（隐藏操作栏） */
  compactProcess?: boolean
  isStreaming?: boolean
  /** 是否被用户中断 */
  stoppedByUser?: boolean
  /** 用户在前端选择的模型 ID（优先用于显示名称） */
  sessionModelId?: string
}

export function AssistantTurnRenderer({ turn, allMessages, basePath, onFork, onRewind, isStreaming, stoppedByUser, sessionModelId: _sessionModelId, compactProcess = false }: AssistantTurnRendererProps): React.ReactElement | null {
  const { t: tConv } = useT('conversation')
  const imageSessionId = useAtomValue(currentAgentSessionIdAtom)
  const imageVersions = React.useMemo(() => collectImageVersions(allMessages), [allMessages])

  // 收集所有 assistant 消息的内容块，保留 parent_tool_use_id 关联
  interface EnrichedBlock {
    block: SDKContentBlock
    parentToolUseId?: string | null
  }

  const enrichedBlocks: EnrichedBlock[] = []
  let hasError = false
  let errorContent: SDKAssistantMessage | null = null

  for (const aMsg of turn.assistantMessages) {
    if (aMsg.error) {
      hasError = true
      errorContent = aMsg
      continue
    }
    const blocks = aMsg.message?.content
    if (Array.isArray(blocks)) {
      for (const block of blocks) {
        enrichedBlocks.push({ block, parentToolUseId: aMsg.parent_tool_use_id })
      }
    }
  }

  // 如果只有错误消息
  if (enrichedBlocks.length === 0 && hasError && errorContent) {
    return <ErrorMessage message={errorContent} />
  }

  // 如果没有任何内容
  if (enrichedBlocks.length === 0 && !hasError) return null

  // 判定 turn 是否产出了综述（用于"加入证据集"是否带入综述被引论文的 flag）。
  // 扫「上一条真实 user-input → 当前 turn 末尾」整段、跨 compact_boundary、同时认 Write/Edit
  // reviews/*.html —— 详见 requestSpanProducedReview 的注释（大综述在 Write 后触发压缩、把 Write
  // 与总结切到两个 turn，单扫当前 turn 会误判无综述）。仍按消息粒度门控（遇真实 user-input 即止），
  // 不退化为按 sessionId 反查，避免同 session 普通 Q&A 误拖综述论文。
  const isReviewOutput = requestSpanProducedReview(allMessages, turn)

  // 从 turnMessages 中提取 result 消息的耗时和用量
  const { durationMs, usage } = extractTurnUsage(turn.turnMessages)

  // 该 turn 是否被软中断（aborted_streaming / aborted_tools）
  // 用于在消息底部显示“已被用户中断”徽章，独立于会话级 stoppedByUser 标记
  const isInterruptedTurn = turn.turnMessages.some((m) => {
    if (m.type === 'system' && (m as SDKSystemMessage).subtype === HOST_TURN_STOPPED_SUBTYPE) return true
    if (m.type !== 'result') return false
    const reason = (m as { terminal_reason?: string }).terminal_reason
    return reason === 'aborted_streaming' || reason === 'aborted_tools'
  })
  const showStoppedBadge = stoppedByUser || isInterruptedTurn

  // 构建 Agent/Task tool_use → 子代理名称映射（id → subagent_type）
  // Phase 4: 从 Set 改为 Map，以便 resolveMessageSpeaker 按 id 取 scenario 名称
  const agentToolIds = new Map<string, string>()
  for (const eb of enrichedBlocks) {
    if (eb.block.type === 'tool_use') {
      const tu = eb.block as { name: string; id: string; input?: Record<string, unknown> }
      if (isSubagentToolUse({ name: tu.name })) {
        const subagentType = typeof tu.input?.subagent_type === 'string' ? tu.input.subagent_type : tu.id
        agentToolIds.set(tu.id, subagentType)
      }
    }
  }

  // A4 §① 默认透传 + §② per-event speaker：
  // scenario sub-agent 内部 blocks（parentToolUseId 命中 agentToolIds）**抬到顶层会话流**，
  // 每条带 speaker 元数据，与 master text/tool 同级渲染。Task tool_use 自身仍走 master speaker（一条派发记录）。
  // 这跟 PDF D-C "默认透传 - 不嵌套到 master tool_use 块内" 一致。
  interface TopLevelEnrichedBlock {
    block: SDKContentBlock
    speaker: AgentSpeaker
  }
  const topLevelEnriched: TopLevelEnrichedBlock[] = enrichedBlocks.map((eb) => ({
    block: eb.block,
    speaker: resolveMessageSpeaker({ parentToolUseId: eb.parentToolUseId, agentToolIds }),
  }))
  const topLevelBlocks: SDKContentBlock[] = topLevelEnriched.map((te) => te.block)

  // 检测是否有主要内容（text 块），用于决定 tool/thinking 是否 dimmed
  const hasTextContent = topLevelBlocks.some(
    (b) => b.type === 'text' && 'text' in b && !!(b as { text: string }).text
  )

  // 研究空白结果卡片：本 turn 若调用了 present_research_gap_table，把结果卡渲染到 turn 末尾
  // （交付物落在「对应那条 AI 消息的最后一行」，而非钉在输入框上方）。
  const researchGapCalls = React.useMemo(() => {
    const out: Array<{ id: string; input: Record<string, unknown>; result: string; isError: boolean }> = []
    for (const b of topLevelBlocks) {
      if (b.type !== 'tool_use') continue
      const tu = b as SDKToolUseBlock
      if (tu.name !== 'mcp__researchgap__present_research_gap_table') continue
      const res = findToolResultInMessages(tu.id, allMessages)
      if (!res?.result) continue // 结果尚未到达（生成中）→ 先不渲染卡片
      out.push({
        id: tu.id,
        input: (tu.input ?? {}) as Record<string, unknown>,
        result: res.result,
        isError: res.isError === true,
      })
    }
    return out
  }, [topLevelBlocks, allMessages])

  // Task 聚合数据（useMemo 防止每次渲染重算）
  const { taskActivities, firstTaskIndex, historicalTaskSubjects } = React.useMemo(() => {
    const taskBlocks: SDKToolUseBlock[] = []
    let _firstTaskIndex = -1

    for (let i = 0; i < topLevelBlocks.length; i++) {
      const block = topLevelBlocks[i]!
      if (block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)) {
        if (_firstTaskIndex === -1) _firstTaskIndex = i
        taskBlocks.push(block as SDKToolUseBlock)
      }
    }

    // 从 turnMessages 中提取 tool_result 文本，用于 TaskProgressCard 匹配真实 taskId
    const toolResultMap = new Map<string, string>()
    for (const msg of turn.turnMessages) {
      if (msg.type !== 'user') continue
      const userMsg = msg as SDKUserMessage
      const blocks = userMsg.message?.content
      if (!Array.isArray(blocks)) continue
      for (const b of blocks) {
        if (b.type === 'tool_result') {
          const rb = b as SDKToolResultBlock
          const text = typeof rb.content === 'string'
            ? rb.content
            : Array.isArray(rb.content)
              ? (rb.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
              : ''
          if (text) toolResultMap.set(rb.tool_use_id, text)
        }
      }
    }

    // 将 SDKToolUseBlock 转换为 ToolActivity 格式（含 result）
    const _taskActivities: ToolActivity[] = taskBlocks.map((tb) => ({
      toolUseId: tb.id,
      toolName: tb.name,
      input: tb.input as Record<string, unknown>,
      result: toolResultMap.get(tb.id),
      done: true,
    }))

    // 从 allMessages 中回溯历史 TaskCreate 的 taskId → subject 映射
    // 用于"继续"后当前 turn 缺少 TaskCreate 时恢复任务名
    const _historicalTaskSubjects = new Map<string, string>()
    const globalResultMap = new Map<string, string>()
    const pendingTaskCreates: SDKToolUseBlock[] = []
    // 单次遍历：同时收集 tool_result 映射和 TaskCreate 块
    for (const msg of allMessages) {
      if (msg.type === 'user') {
        const userMsg = msg as SDKUserMessage
        const blocks = userMsg.message?.content
        if (!Array.isArray(blocks)) continue
        for (const b of blocks) {
          if (b.type === 'tool_result') {
            const rb = b as SDKToolResultBlock
            const text = typeof rb.content === 'string'
              ? rb.content
              : Array.isArray(rb.content)
                ? (rb.content as Array<{ text?: string }>).map((c) => c.text ?? '').join('')
                : ''
            if (text) globalResultMap.set(rb.tool_use_id, text)
          }
        }
      } else if (msg.type === 'assistant') {
        const aMsg = msg as SDKAssistantMessage
        const blocks = aMsg.message?.content
        if (!Array.isArray(blocks)) continue
        for (const b of blocks) {
          if (b.type === 'tool_use' && (b as SDKToolUseBlock).name === 'TaskCreate') {
            pendingTaskCreates.push(b as SDKToolUseBlock)
          }
        }
      }
    }
    // 解析 TaskCreate 的真实 taskId 和 subject
    for (const tb of pendingTaskCreates) {
      const input = tb.input as Record<string, unknown>
      const subject = typeof input.subject === 'string'
        ? input.subject
        : typeof input.description === 'string'
          ? input.description
          : undefined
      if (!subject) continue
      const resultText = globalResultMap.get(tb.id)
      if (resultText) {
        const match = resultText.match(/Task\s*#(\d+)/i)
        if (match?.[1]) _historicalTaskSubjects.set(match[1], subject)
      }
    }

    return { taskActivities: _taskActivities, firstTaskIndex: _firstTaskIndex, historicalTaskSubjects: _historicalTaskSubjects }
  }, [topLevelBlocks, turn.turnMessages, allMessages])

  const presentation = processPresentation(topLevelEnriched, compactProcess)
  const hasVisibleAnswer = presentation.answer.some(({ block }) => block.type !== 'text' || (typeof block.text === 'string' && !!block.text.trim()))
  const webProcess = presentation.records.some(({ block }) => block.type === 'tool_use' && /search|fetch/i.test((block as SDKToolUseBlock).name))

  // 0.2.0：把顶层块序列预处理成「渲染项」——连续≥2 过程块折叠成执行步骤组
  const renderItems = React.useMemo(
    () => groupExecutionSteps(presentation.answer, presentation.records.length ? -1 : firstTaskIndex),
    [topLevelEnriched, firstTaskIndex, compactProcess],
  )

  const isTextItem = (it: typeof renderItems[number]): boolean =>
    it.kind === 'block' && it.block.type === 'text'

  const renderItemSpeaker = (it: typeof renderItems[number]): AgentSpeaker => it.speaker

  const subagentNameFromDispatch = (it: typeof renderItems[number]): string | null => {
    if (it.kind !== 'block' || it.block.type !== 'tool_use') return null
    const block = it.block as SDKToolUseBlock
    if (!isSubagentToolUse({ name: block.name })) return null
    return typeof block.input?.subagent_type === 'string' ? block.input.subagent_type : block.id
  }

  const isDispatchToScenario = (
    previous: typeof renderItems[number],
    current: typeof renderItems[number],
  ): boolean => {
    const subagentName = subagentNameFromDispatch(previous)
    const currentSpeaker = renderItemSpeaker(current)
    return subagentName !== null && currentSpeaker !== 'master' && currentSpeaker.name === subagentName
  }

  const topLevelGapClass = (
    previous: typeof renderItems[number] | undefined,
    current: typeof renderItems[number],
  ): string | undefined => {
    if (!previous) return undefined
    return isDispatchToScenario(previous, current) ? 'mt-3' : 'mt-7'
  }

  const imageCalls = topLevelEnriched.map(({ block }) => block).filter((block): block is SDKToolUseBlock => block.type === 'tool_use' && (block as SDKToolUseBlock).name === 'mcp__asci-image__generate_image')
  const firstAssistant = turn.assistantMessages[0]
  const firstIndex = firstAssistant ? allMessages.findIndex(message => message === firstAssistant || !!firstAssistant.uuid && message.type === 'assistant' && (message as SDKAssistantMessage).uuid === firstAssistant.uuid) : -1
  const imageRequest = firstIndex < 0 ? undefined : allMessages.slice(0, firstIndex).findLast(message => message.type === 'user' && isUserInputMessage(message as SDKUserMessage)) as SDKUserMessage | undefined

  let previousVisibleItem: typeof renderItems[number] | undefined

  return (
    <Message from="assistant" className="conversation-assistant-turn">
      <ConversationSymbol />
      <GeneratedImageReferenceProvider assistantMessages={turn.assistantMessages} allMessages={allMessages} sessionId={imageSessionId} basePath={basePath}>
      <MessageContent>
        {isStreaming && compactProcess && presentation.records.length === 0 && !hasVisibleAnswer && (
          <RunningStatusText active role="status" className="text-sm text-muted-foreground">{tConv('agent.messages.thinkingStreaming')}</RunningStatusText>
        )}
        {presentation.records.length > 0 && (imageCalls.length > 0 ? (
          <ImageGenerationStatus calls={imageCalls} allMessages={allMessages} userMessage={imageRequest} streaming={isStreaming} stopped={showStoppedBadge}>
            {presentation.records.map(({ block }, index) => <ContentBlock key={index} block={block} allMessages={allMessages} basePath={basePath} isStreaming={false} />)}
          </ImageGenerationStatus>
        ) : (
          <details className="mb-5 text-sm text-muted-foreground" data-agent-process="true">
            <summary className="flex cursor-pointer list-none items-center gap-2 rounded-lg py-2 focus-visible:outline focus-visible:outline-2">
              <RunningStatusText active={!!isStreaming}>{isStreaming
                ? tConv(webProcess ? 'agent.process.checking' : 'agent.process.working')
                : tConv('agent.process.records')}</RunningStatusText>
              <span className="text-xs opacity-60">{tConv('agent.process.actions', { count: presentation.records.filter(({ block }) => block.type === 'tool_use').length })}</span>
              <span aria-hidden="true" className="ml-1">⌄</span>
            </summary>
            <div className="mt-2 space-y-4 border-l pl-4" data-agent-process-records="true">
              {presentation.records.map(({ block }, index) => (
                <ContentBlock key={index} block={block} allMessages={allMessages} basePath={basePath} isStreaming={false} />
              ))}
            </div>
          </details>
        ))}
        {topLevelEnriched.filter(({ block }) => block.type === 'tool_use' && (block as SDKToolUseBlock).name === 'mcp__asci-image__generate_image').map(({ block }) => {
          const toolBlock = block as SDKToolUseBlock
          const result = findToolResultInMessages(toolBlock.id, allMessages)
          return result && !result.isError ? <GeneratedImage key={toolBlock.id} result={result.result} versions={imageVersions} sessionId={imageSessionId ?? undefined} /> : null
        })}
        {/* 顶层项间距按相邻语义控制：连续过程项紧凑等距，正文/段落边界保留更大呼吸。 */}
        <div data-agent-turn-items="true" className="flex flex-col">
          {renderItems.map((item, ri) => {
              const isLastItem = ri === renderItems.length - 1
              const prevItem = ri > 0 ? renderItems[ri - 1] : undefined
              const consumedByPreviousSection =
                item.kind === 'block'
                && item.block.type === 'text'
                && (
                  prevItem?.kind === 'group'
                  || (prevItem?.kind === 'block' && prevItem.block.type === 'thinking')
                )

              if (consumedByPreviousSection) return null
              const itemGapClass = topLevelGapClass(previousVisibleItem, item)
              previousVisibleItem = item

              const nextItem = renderItems[ri + 1]
              const trailingTextItem = nextItem?.kind === 'block' && nextItem.block.type === 'text'
                ? nextItem
                : null
              const trailingContent = trailingTextItem
                ? (
                    <ContentBlock
                      block={trailingTextItem.block}
                      allMessages={allMessages}
                      basePath={basePath}
                      animate={!!isStreaming}
                      index={trailingTextItem.originalIndex}
                      dimmed={false}
                      isStreaming={isStreaming}
                    />
                  )
                : null

              // 执行步骤组
              if (item.kind === 'group') {
                const isLive = !!isStreaming && isLastItem
                return (
                  <div key={`grp-${item.steps[0]!.originalIndex}`} data-agent-turn-item="true" className={itemGapClass}>
                    <ExecutionStepGroup
                      steps={item.steps}
                      speaker={item.speaker}
                      allMessages={allMessages}
                      basePath={basePath}
                      isLive={isLive}
                      turnStreaming={!!isStreaming}
                      dimmed={hasTextContent}
                      trailingContent={trailingContent}
                    />
                  </div>
                )
              }

              // 透传 block
              const block = item.block

              // TodoBoard 卡片（groupExecutionSteps 只把首个 task 块作为锚点透传到这里）
              if (block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)) {
                return (
                  <div key="task-progress-card" data-agent-turn-item="true" className={itemGapClass}>
                    <TaskProgressCard
                      activities={taskActivities}
                      streamEnded={!isStreaming}
                      historicalTaskSubjects={historicalTaskSubjects}
                    />
                  </div>
                )
              }

              // A4 §② per-event speaker：根据 block 的 speaker 决定徽标；master → 无徽标
              const scenarioName = speakerDisplayName(item.speaker)
              const showDividerAfterHeader =
                block.type === 'thinking' && trailingContent != null

              return (
                <div
                  key={item.originalIndex}
                  data-agent-turn-item="true"
                  className={cn('space-y-3', itemGapClass)}
                >
                  {/* scenario speaker 标签 — master 不显示。语义性 icon 按 scenario 名映射（如 searcher → Search）。
                      下方 ContentBlock 自身的卡片已表达「这条属于该 scenario」的成组关系，
                      不再额外套左竖线缩进（避免「左竖线 + 卡片」双重框、减少嵌套层次）。 */}
                  {scenarioName && (
                    <div className="flex items-center gap-1.5 text-[14px] font-normal text-muted-foreground/70 select-none">
                      {getScenarioIcon(scenarioName, { className: 'text-muted-foreground/70' })}
                      <span>{scenarioName}</span>
                    </div>
                  )}
                  <ContentBlock
                    block={block}
                    allMessages={allMessages}
                    basePath={basePath}
                    animate={!!isStreaming}
                    index={item.originalIndex}
                    dimmed={hasTextContent && block.type !== 'text'}
                    isStreaming={isStreaming}
                    dividerAfterHeader={showDividerAfterHeader}
                    trailingContent={block.type === 'thinking' ? trailingContent : undefined}
                  />
                </div>
              )
            })}
        </div>
        {/* 如果有错误但也有内容块，在末尾显示错误 */}
        {hasError && errorContent && topLevelBlocks.length > 0 && (
          <div className="mt-3 text-sm text-destructive">
            {errorContent.error?.message ?? tConv('agent.sdkMessage.unknownError')}
          </div>
        )}
        {/* 研究空白结果卡片：落在本条 AI 消息正文末尾（交付物），点「打开」唤起右栏对照表 */}
        {researchGapCalls.length > 0 && (
          <div className="mt-3 flex flex-col gap-1.5">
            {researchGapCalls.map((c) => (
              <ResearchGapResultRenderer key={c.id} result={c.result} isError={c.isError} input={c.input} />
            ))}
          </div>
        )}
      </MessageContent>
      </GeneratedImageReferenceProvider>
      {/* 中断状态：独立成行放正文下方、操作栏上方，与可交互按钮分开（流式输出中隐藏） */}
      {!isStreaming && showStoppedBadge && (
        <div className="mt-3 flex items-center gap-1.5 text-xs text-muted-foreground/70 select-none">
          <Ban className="size-3.5 shrink-0" />
          <span>{tConv('agent.sdkMessage.abortedByUser')}</span>
        </div>
      )}
      {/* 操作栏：耗时 · 时间 · 复制 · 分叉 · 回退（流式输出中隐藏） */}
      {!isStreaming && (() => {
        const textContent = presentation.answer.map(({ block }) => block)
          .filter((b) => b.type === 'text' && 'text' in b)
          .map((b) => (b as { text: string }).text)
          .join('\n\n')
        const lastUuid = turn.assistantMessages.length > 0
          ? turn.assistantMessages[turn.assistantMessages.length - 1]?.uuid
          : undefined
        // 从 allMessages 向前找触发该 turn 的 user 输入消息（取 turn 内首条 assistant 之前最近的一条 user-input）
        // 用于把「用户提问」一起塞进 conversation 类型证据条目的 snapshotText
        const firstAssistantUuid = turn.assistantMessages[0]?.uuid
        let userMessageUuid: string | undefined
        let userText = ''
        if (firstAssistantUuid) {
          const firstIdx = allMessages.findIndex(
            (m) => m.type === 'assistant' && (m as SDKAssistantMessage).uuid === firstAssistantUuid,
          )
          if (firstIdx > 0) {
            for (let i = firstIdx - 1; i >= 0; i--) {
              const m = allMessages[i]
              if (m && m.type === 'user' && isUserInputMessage(m as SDKUserMessage)) {
                userMessageUuid = (m as SDKUserMessage).uuid
                userText = extractUserText(m as SDKUserMessage) ?? ''
                break
              }
            }
          }
        }
        const messageTimestamp =
          turn.createdAt != null ? toIso(turn.createdAt) : undefined
        const hasActions = !!(textContent || (onFork && lastUuid) || (onRewind && lastUuid))
        const hasDuration = durationMs != null
        const hasTime = turn.createdAt != null
        if (!hasDuration && !hasTime && !hasActions) return null
        return (
          <MessageActions className="conversation-assistant-metadata mt-3 min-h-8 flex-wrap justify-start gap-x-1 gap-y-1 opacity-100">
            <div className="mr-2 flex items-center gap-2 text-xs text-muted-foreground">
            {hasDuration && <DurationBadge durationMs={durationMs!} usage={usage} />}
            {hasDuration && hasTime && <span aria-hidden="true">·</span>}
            {hasTime && (
              <span className="text-xs tabular-nums">
                {formatMessageTime(turn.createdAt!)}
              </span>
            )}
            </div>
            {textContent && <CopyButton content={textContent} />}
            {RESEARCH_UI_ENABLED && textContent && lastUuid && (
              <AddToEvidenceSetButton
                messageUuid={lastUuid}
                userMessageUuid={userMessageUuid}
                userText={userText}
                assistantText={textContent}
                messageTimestamp={messageTimestamp}
                isReviewOutput={isReviewOutput}
              />
            )}
            <DebugCopyButton topLevelEnriched={topLevelEnriched} turnMessages={turn.turnMessages} />
            <MessageMoreActions
              onFork={onFork && lastUuid ? () => onFork(lastUuid) : undefined}
              onRewind={onRewind && lastUuid ? () => onRewind(lastUuid) : undefined}
            />
            {textContent && lastUuid && (
              <OutputFeedbackButtons messageUuid={lastUuid} userMessageUuid={userMessageUuid} />
            )}
          </MessageActions>
        )
      })()}
    </Message>
  )
}

// ===== 助手输出 👍/👎 直观反馈按钮（issue #477：采集用户对输出的直观感受）=====
//
// 三态互斥单选：none → up/down；再点当前项取消；点另一项切换。乐观更新 + 失败回滚 + toast。
// 选中态用语义 token 高亮（text-foreground + fill-current），不用调色板硬编码。
// 落盘走 window.electronAPI.outputFeedback.set；回显由 session-feedback-atoms 在 session 切换时拉取。
function OutputFeedbackButtons({
  messageUuid,
  userMessageUuid,
}: {
  messageUuid: string
  userMessageUuid?: string
}): React.ReactElement {
  const { t: tConv } = useT('conversation')
  const sessionId = useAtomValue(currentAgentSessionIdAtom)
  const workspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const serverMap = useAtomValue(feedbackServerMapAtom)
  const overrides = useAtomValue(feedbackOverridesAtom)
  const setOverride = useSetAtom(setMessageFeedbackOverrideAtom)

  // override（本次会话点击）优先于 server map（回显）
  const ovMap = overrides.sessionId === sessionId ? overrides.map : {}
  const current: FeedbackSelection =
    messageUuid in ovMap
      ? ovMap[messageUuid] ?? null
      : serverMap.state === 'hasData'
        ? serverMap.data[messageUuid] ?? null
        : null

  const submit = async (clicked: 'up' | 'down'): Promise<void> => {
    if (!sessionId) return
    // 再点当前项取消（→null），点另一项切换，未表态时选中
    const next: FeedbackSelection = current === clicked ? null : clicked
    const prev = current
    setOverride({ messageUuid, value: next }) // 乐观更新
    try {
      await window.electronAPI.outputFeedback.set({
        sessionId,
        messageUuid,
        userMessageUuid,
        workspaceId: workspaceId ?? undefined,
        value: next ?? 'none',
      })
    } catch (err) {
      console.error('[outputFeedback] 保存失败:', err)
      setOverride({ messageUuid, value: prev }) // 回滚
      toast.error(tConv('feedback.saveFailed'))
    }
  }

  return (
    <>
      <MessageAction
        tooltip={tConv('feedback.thumbsUp.tooltip')}
        aria-pressed={current === 'up'}
        onClick={() => void submit('up')}
        className={cn('transition-colors', current === 'up' && 'bg-primary/10 text-foreground')}
      >
        <ThumbsUp className="size-4" />
      </MessageAction>
      <MessageAction
        tooltip={tConv('feedback.thumbsDown.tooltip')}
        aria-pressed={current === 'down'}
        onClick={() => void submit('down')}
        className={cn('transition-colors', current === 'down' && 'bg-primary/10 text-foreground')}
      >
        <ThumbsDown className="size-4" />
      </MessageAction>
    </>
  )
}

// ===== 「加入证据集」hover icon + popover（v0.2.x：会话 Q&A 存为证据条目）=====
//
// 行为：
//   - 顶部：已有 persisted 证据集列表（evidenceSets:listSummary）
//     点击任意一条 → 把当前 Q&A 作为 conversation 类型证据条目挂入该集合（幂等）
//   - 底部："+ New evidence set"：展开输入框 → 提交后新建命名集合并同时挂入当前 Q&A
//
// snapshotText 在父组件拼好（`Q: <userText>\n\nA: <assistantText>`）后传入；脱离 session 也可读。
// 集合的 rename / 综述临时 set promote 等操作走 EvidenceSetDetail 抽屉，不再混在本 popover 里。
interface AddToEvidenceSetButtonProps {
  /** assistant turn 末条消息的 SDK uuid（作为 conversation anchor 的 messageUuid） */
  messageUuid: string
  /** 触发该 turn 的 user 消息 uuid；可选 */
  userMessageUuid?: string
  /** 用户提问文本（snapshotText 拼接用，去 \n\n 边界） */
  userText: string
  /** 助手回复纯文本（snapshotText 拼接用，由 text blocks 合并） */
  assistantText: string
  /** turn 创建时间 ISO 8601；可选元信息 */
  messageTimestamp?: string
  /**
   * 该 turn 是否产出了综述（Write 写 .../reviews/*.html）。透传给 IPC 的
   * includeReviewCitations，服务端据此决定是否把综述被引论文一并落到集合。
   * 默认 false：普通 Q&A 加入证据集时不会拖入同 session 综述论文。
   */
  isReviewOutput?: boolean
}

function AddToEvidenceSetButton({
  messageUuid,
  userMessageUuid,
  userText,
  assistantText,
  messageTimestamp,
  isReviewOutput,
}: AddToEvidenceSetButtonProps): React.ReactElement {
  const { t: tConv } = useT('conversation')
  const agentSessionId = useAtomValue(currentAgentSessionIdAtom)
  // issue #457：弹层只列当前 workspace 的证据集（conversation 写入路径主进程按 session 反查 workspace）。
  const currentWorkspaceId = useAtomValue(currentAgentWorkspaceIdAtom)
  const setOpenEvidenceSet = useSetAtom(openEvidenceSetIdAtom)
  const [open, setOpen] = React.useState(false)
  const [sets, setSets] = React.useState<EvidenceSetSummary[]>([])
  const [loading, setLoading] = React.useState(false)
  const [creating, setCreating] = React.useState(false)
  const [name, setName] = React.useState('')
  const [submitting, setSubmitting] = React.useState(false)
  /** 已挂入过当前 Q&A 的集合 id（hover 时显示 ✓） */
  const [attachedSetIds, setAttachedSetIds] = React.useState<Set<ObjectId>>(() => new Set())
  /**
   * 本条问答可加入证据集的论文候选数：null = 未知/预览失败（不拦截，照常展示），
   * 0 = 没有相关证据（展示空态并禁用添加），>0 = 正常。
   */
  const [candidateCount, setCandidateCount] = React.useState<number | null>(null)

  // 拼好的 snapshotText（buildQaSnapshot 唯一事实源；与库内「补证据·历史对话」picker 同口径）
  const snapshotText = React.useMemo(
    () => buildQaSnapshot({ question: userText, answer: assistantText }),
    [userText, assistantText],
  )

  const refresh = React.useCallback(async (): Promise<void> => {
    setLoading(true)
    // 列表 + 候选数预览并发拉取，互不阻断（allSettled）：预览失败不拦截添加。
    const [listOutcome, previewOutcome] = await Promise.allSettled([
      // persistedOnly: false —— 与 Library "Evidence Sets" 视图对齐：
      // 划词建笔记产出的 set 默认 persisted=0 但带 note，本来就该出现在选择列表里。
      // 渲染端用 name → notePreview 兜底显示。
      currentWorkspaceId
        ? window.electronAPI.evidenceSets.listSummary({ persistedOnly: false, workspaceId: currentWorkspaceId })
        : Promise.resolve([]),
      agentSessionId
        ? window.electronAPI.evidenceSets.previewConversation({
            sessionId: agentSessionId,
            messageUuid,
            includeReviewCitations: isReviewOutput === true,
          })
        : Promise.resolve({ paperCandidateCount: 0 }),
    ])

    if (listOutcome.status === 'fulfilled') {
      setSets(listOutcome.value)
    } else {
      console.error('[AddToEvidenceSetButton] listSummary failed:', listOutcome.reason)
      setSets([])
    }

    if (previewOutcome.status === 'fulfilled') {
      setCandidateCount(previewOutcome.value.paperCandidateCount)
    } else {
      console.error('[AddToEvidenceSetButton] previewConversation failed:', previewOutcome.reason)
      setCandidateCount(null) // 未知 → 不拦截
    }

    setLoading(false)
  }, [agentSessionId, currentWorkspaceId, messageUuid, isReviewOutput])

  React.useEffect(() => {
    if (!open) return
    void refresh()
  }, [open, refresh])

  const enterCreate = (): void => {
    setName('')
    setCreating(true)
  }

  const trimmedName = name.trim()
  const canSubmit = !submitting && trimmedName.length > 0 && !!agentSessionId

  const handlePickSet = async (setId: ObjectId, setName: string): Promise<void> => {
    if (!agentSessionId || submitting) return
    setSubmitting(true)
    // 诊断：用户报"综述加入证据集但没带入论文"时，看这条 console 一眼判断 isReviewOutput
    // 是否识别为 true。false 表示 UI 没识别到本 turn 的 Write 写综述 → 检查
    // turn.assistantMessages 是否包含 Write tool_use（综述 turn 与点击 turn 是否同一 turn）。
    console.info('[evidence-add] addConversation', {
      setId,
      messageUuid,
      isReviewOutput,
      includeReviewCitations: isReviewOutput === true,
    })
    try {
      const res = await window.electronAPI.evidenceSets.addConversationMessage({
        setId,
        sessionId: agentSessionId,
        messageUuid,
        userMessageUuid,
        messageTimestamp,
        snapshotText,
        // 仅在 turn 内有 Write 写综述 HTML 时为 true，让服务端带入综述被引论文；
        // 普通 Q&A 缺省 false → 服务端跳过 attachReviewPaperRefsForSession，避免误拖论文。
        includeReviewCitations: isReviewOutput === true,
      })
      setAttachedSetIds((prev) => {
        const next = new Set(prev)
        next.add(setId)
        return next
      })
      if (res.created) {
        toast.success(tConv('addToEvidenceSet.addedToast', { name: setName }))
      } else {
        toast.info(tConv('addToEvidenceSet.alreadyExistsToast', { name: setName }))
      }
      setOpen(false)
    } catch (err) {
      console.error('[AddToEvidenceSetButton] addConversation failed:', err)
      toast.error(tConv('addToEvidenceSet.saveError'))
    } finally {
      setSubmitting(false)
    }
  }

  const handleOpenSet = (setId: ObjectId, e: React.MouseEvent): void => {
    e.stopPropagation()
    setOpenEvidenceSet(setId)
    setOpen(false)
  }

  const handleSubmit = async (): Promise<void> => {
    if (!canSubmit || !agentSessionId) return
    setSubmitting(true)
    // 诊断：同 handlePickSet（新建集合路径）
    console.info('[evidence-add] createSetWithConversation', {
      name: trimmedName,
      messageUuid,
      isReviewOutput,
      includeReviewCitations: isReviewOutput === true,
    })
    try {
      const res = await window.electronAPI.evidenceSets.createWithConversationMessage({
        name: trimmedName,
        sessionId: agentSessionId,
        messageUuid,
        userMessageUuid,
        messageTimestamp,
        snapshotText,
        // 同 addConversationMessage：仅综述 turn 传 true，让服务端带入综述被引论文
        includeReviewCitations: isReviewOutput === true,
      })
      setAttachedSetIds((prev) => {
        const next = new Set(prev)
        next.add(res.evidenceSetId)
        return next
      })
      toast.success(tConv('addToEvidenceSet.addedToast', { name: trimmedName }))
      setCreating(false)
      setName('')
      setOpen(false)
    } catch (err) {
      console.error('[AddToEvidenceSetButton] createWithConversation failed:', err)
      toast.error(tConv('addToEvidenceSet.saveError'))
    } finally {
      setSubmitting(false)
    }
  }

  const cancelCreate = (): void => {
    setCreating(false)
    setName('')
  }

  return (
    <Popover open={open} onOpenChange={(o) => {
      setOpen(o)
      if (o) {
        // 重新打开先回到 loading，避免闪现上次的空态/列表（refresh 会随即覆盖）
        setLoading(true)
        setCandidateCount(null)
      } else {
        setCreating(false)
        setName('')
        setSubmitting(false)
      }
    }}>
      <TooltipProvider>
        <Tooltip>
          <TooltipTrigger asChild>
            <PopoverTrigger asChild>
              <Button type="button" variant="ghost" size="icon-sm">
                <BookmarkPlus className="size-4" />
                <span className="sr-only">{tConv('addToEvidenceSet.tooltip')}</span>
              </Button>
            </PopoverTrigger>
          </TooltipTrigger>
          <TooltipContent>
            <p>{tConv('addToEvidenceSet.tooltip')}</p>
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>
      <PopoverContent side="top" align="start" className="w-72 p-1">
        <div className="px-2 py-1.5 text-sm uppercase tracking-wider text-muted-foreground font-medium">
          {tConv('addToEvidenceSet.popoverTitle')}
        </div>

        {loading ? (
          <div className="px-2 py-3 text-xs text-muted-foreground/60">
            {tConv('addToEvidenceSet.loading')}
          </div>
        ) : candidateCount === 0 ? (
          // 本条问答没有引用相关论文 → 空态提示，禁用添加（不渲染集合列表与新建入口）
          <div className="px-2 py-3 text-xs text-muted-foreground/60">
            {tConv('addToEvidenceSet.emptyNoEvidence')}
          </div>
        ) : (
          <>
            {/* 列表区：已有 persisted 证据集 */}
            <div className="max-h-56 overflow-auto scrollbar-thin">
              {sets.length === 0 ? (
                <div className="px-2 py-3 text-xs text-muted-foreground/60">
                  {tConv('addToEvidenceSet.emptyList')}
                </div>
              ) : (
                sets.map((s) => {
                  const attached = attachedSetIds.has(s.id)
                  // name → notePreview → (unnamed)：persisted=0 的划词笔记 set 没有 name，用 note.body 作身份
                  const displayName =
                    s.name?.trim() ||
                    s.notePreview.trim().slice(0, 60) ||
                    tConv('addToEvidenceSet.unnamedSet')
                  return (
                    <div
                      key={s.id}
                      className="group flex items-center gap-1.5 px-2 py-1.5 text-sm rounded hover:bg-muted/60 transition-colors"
                    >
                      <Button
                        type="button"
                        variant="ghost"
                        size="inline"
                        onClick={() => void handlePickSet(s.id, displayName)}
                        disabled={submitting}
                        className="flex items-center gap-1.5 flex-1 min-w-0 text-left text-sm hover:bg-transparent disabled:opacity-60 [&_svg]:size-3.5"
                        title={displayName}
                      >
                        <Check
                          className={cn(
                            'size-3.5 shrink-0',
                            attached ? 'text-success' : 'opacity-0',
                          )}
                        />
                        <span className="truncate flex-1">{displayName}</span>
                      </Button>
                      <Button
                        type="button"
                        variant="ghost"
                        size="chip"
                        onClick={(e) => handleOpenSet(s.id, e)}
                        className="rounded px-1.5 text-sm opacity-0 group-hover:opacity-100 text-muted-foreground hover:text-foreground hover:bg-muted transition-opacity"
                        title={tConv('addToEvidenceSet.openSetAction')}
                      >
                        {tConv('addToEvidenceSet.openSetAction')}
                      </Button>
                    </div>
                  )
                })
              )}
            </div>

            {/* 底部：+ New evidence set —— 输入名字 + 提交后建集合并挂入当前 Q&A */}
            <div className="border-t border-border/60 mt-1 pt-1">
              {creating ? (
                <div className="flex items-center gap-1 px-1">
                  <input
                    autoFocus
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') void handleSubmit()
                      if (e.key === 'Escape') cancelCreate()
                    }}
                    placeholder={tConv('addToEvidenceSet.saveAsSetPlaceholder')}
                    className="flex-1 min-w-0 px-2 py-1 text-sm rounded border border-border bg-background focus:outline-none focus:border-foreground/40"
                    disabled={submitting}
                  />
                  <Button
                    type="button"
                    variant="default"
                    onClick={() => void handleSubmit()}
                    disabled={!canSubmit}
                    className="h-auto rounded px-2 py-1 text-xs shadow-none disabled:opacity-40 disabled:cursor-not-allowed"
                  >
                    {tConv('addToEvidenceSet.saveAsSetButton')}
                  </Button>
                </div>
              ) : (
                <Button
                  type="button"
                  variant="list"
                  size="row"
                  onClick={enterCreate}
                  className="gap-1.5 px-2 py-1.5 rounded hover:bg-muted/60 hover:text-foreground text-foreground/80 [&_svg]:size-3.5"
                >
                  <Plus className="size-3.5" />
                  {tConv('addToEvidenceSet.createNew')}
                </Button>
              )}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}

// ===== SDKMessageRenderer 主组件（用于实时消息逐条渲染） =====

export function SDKMessageRenderer({
  message,
  allMessages,
  basePath,
}: SDKMessageRendererProps): React.ReactElement | null {
  const msgType = message.type

  // assistant 消息：遍历内容块渲染
  if (msgType === 'assistant') {
    const aMsg = message as SDKAssistantMessage

    // 跳过重放消息
    if (aMsg.isReplay) return null

    // 错误消息
    if (aMsg.error) {
      return <ErrorMessage message={aMsg} />
    }

    const blocks = aMsg.message?.content
    if (!Array.isArray(blocks) || blocks.length === 0) return null

    // 检测是否有主要内容（text 块）
    const hasTextContent = blocks.some(
      (b) => b.type === 'text' && 'text' in b && !!(b as { text: string }).text
    )

    return (
      <Message from="assistant">
        <MessageContent>
          <div className={cn('space-y-2')}>
            {blocks.map((block, i) => {
              const prev = blocks[i - 1]
              const needsResultGap = block.type === 'text' && prev != null && prev.type !== 'text'
              return (
                <ContentBlock
                  key={i}
                  block={block}
                  allMessages={allMessages}
                  basePath={basePath}
                  index={i}
                  dimmed={hasTextContent && block.type !== 'text'}
                  className={needsResultGap ? '!mt-5' : undefined}
                />
              )
            })}
          </div>
        </MessageContent>
      </Message>
    )
  }

  // user 消息
  if (msgType === 'user') {
    const uMsg = message as SDKUserMessage
    if (isUserInputMessage(uMsg)) {
      return <UserInputMessage message={uMsg} allMessages={allMessages} />
    }
    return null
  }

  // system 消息
  if (msgType === 'system') {
    const sysMsg = message as SDKSystemMessage
    const subtype = sysMsg.subtype

    if (subtype === 'compact_boundary') {
      return <CompactBoundaryDivider message={sysMsg} />
    }

    // compacting 事件已由 isCompacting flag 驱动的尾部指示器接管（见 AgentMessages），此处不再渲染持久条目

    return null
  }

  return null
}

// ===== 错误消息渲染 =====

function ErrorMessage({ message }: { message: SDKAssistantMessage }): React.ReactElement {
  const { t } = useT('conversation')
  const meta = extractMeta(message as unknown as SDKMessage)
  const errorText = message.error?.message ?? t('agent.sdkMessage.unknownError')

  const msgAny = message as unknown as Record<string, unknown>
  const errorTitle = typeof msgAny._errorTitle === 'string' ? msgAny._errorTitle : undefined

  const contentText = message.message?.content
    ?.filter((b) => b.type === 'text' && 'text' in b)
    .map((b) => (b as { text: string }).text)
    .join('\n') ?? errorText

  return (
    <Message from="assistant">
      <MessageContent>
        <div className="flex items-start gap-2">
          <AlertTriangle size={18} className="shrink-0 text-destructive mt-0.5" />
          <div className="flex-1 min-w-0">
            {errorTitle && (
              <div className="text-sm font-medium text-destructive mb-1">{errorTitle}</div>
            )}
            <div className="text-destructive">
              <MessageResponse>{contentText}</MessageResponse>
              {message._desktopRuntimeStatus && contentText !== errorText && <p role="alert" className="mt-2">{errorText}</p>}
            </div>
          </div>
        </div>
      </MessageContent>
      <MessageActions className="mt-0.5 justify-start">
        {meta.createdAt && (
          <span className="text-xs tabular-nums">
            {formatMessageTime(meta.createdAt)}
          </span>
        )}
        <CopyButton content={contentText} />
      </MessageActions>
    </Message>
  )
}

// ===== MessageGroup 渲染器（统一入口，同时支持 turn 和单条消息） =====

export interface MessageGroupRendererProps {
  group: MessageGroup
  allMessages: SDKMessage[]
  basePath?: string
  onFork?: (upToMessageUuid: string) => void
  onRewind?: (assistantMessageUuid: string) => void
  /** 是否正在流式输出中（隐藏操作栏） */
  isStreaming?: boolean
  compactProcess?: boolean
  /** 是否被用户中断 */
  stoppedByUser?: boolean
  /** 用户在前端选择的模型 ID（优先用于显示名称） */
  sessionModelId?: string
}

/**
 * WeakMap 缓存：为没有 uuid 的消息生成稳定的 fallback ID
 * 使用 message 对象（而非 group 对象）作为 key，因为 group 在 useMemo 重算时会
 * 被重建为新对象，而 group.message 引用的底层 SDK message 对象是稳定的。
 */
const messageIdCache = new WeakMap<object, string>()
let fallbackIdCounter = 0

/**
 * 从 MessageGroup 中提取稳定的 ID，用于 data-message-id 和迷你地图
 */
export function getGroupId(group: MessageGroup): string {
  if (group.type === 'user') {
    const nativeId=nativeMessageIdentity(group.message)
    if (nativeId) return nativeId
    if (group.message.uuid) return group.message.uuid
    // 没有 uuid：使用基于 message 对象引用的缓存 ID（message 引用在重渲染间稳定）
    if (!messageIdCache.has(group.message)) {
      messageIdCache.set(group.message, `user-${++fallbackIdCounter}`)
    }
    return messageIdCache.get(group.message)!
  }
  if (group.type === 'system') {
    if (!messageIdCache.has(group.message)) {
      messageIdCache.set(group.message, `system-${group.message.subtype ?? 'unknown'}-${++fallbackIdCounter}`)
    }
    return messageIdCache.get(group.message)!
  }
  // assistant-turn：取首条 assistant 消息的 uuid
  const first = group.assistantMessages[0]
  if (first && nativeMessageIdentity(first)) return nativeMessageIdentity(first)!
  if (first?.uuid) return first.uuid
  // 没有 uuid：使用基于首条 assistant message 对象引用的缓存 ID
  if (first) {
    if (!messageIdCache.has(first)) {
      messageIdCache.set(first, `turn-${++fallbackIdCounter}`)
    }
    return messageIdCache.get(first)!
  }
  // 极端情况：空 turn
  return `turn-empty-${++fallbackIdCounter}`
}

/**
 * 从 MessageGroup 中提取纯文本预览，供迷你地图使用
 */
export function getGroupPreview(
  group: MessageGroup,
  labels?: { contextCompacted: string; compactingContext: string },
): string {
  if (group.type === 'user') {
    return (extractUserText(group.message) ?? '').replace(/<attached_files>[\s\S]*?<\/attached_files>\n*/, '').slice(0, 200)
  }
  if (group.type === 'system') {
    if (group.message.subtype === 'compact_boundary') return labels?.contextCompacted ?? 'Context compacted'
    if (group.message.subtype === 'compacting') return labels?.compactingContext ?? 'Compacting context…'
    return ''
  }
  // assistant-turn：收集所有 text 块
  const texts: string[] = []
  for (const aMsg of group.assistantMessages) {
    const blocks = aMsg.message?.content
    if (!Array.isArray(blocks)) continue
    for (const block of blocks) {
      if (block.type === 'text' && 'text' in block) {
        texts.push((block as { text: string }).text)
      }
    }
  }
  return texts.join(' ').slice(0, 200)
}

export function MessageGroupRenderer({ group, allMessages, basePath, onFork, onRewind, isStreaming, stoppedByUser, sessionModelId, compactProcess }: MessageGroupRendererProps): React.ReactElement | null {
  const groupId = getGroupId(group)

  if (group.type === 'user') {
    return (
      <div data-message-id={groupId} data-message-role="user" tabIndex={-1}>
        <UserInputMessage message={group.message} allMessages={allMessages} />
      </div>
    )
  }

  if (group.type === 'system') {
    const subtype = group.message.subtype
    if (subtype === 'compact_boundary') return <div data-message-id={groupId}><CompactBoundaryDivider message={group.message as SDKSystemMessage} /></div>
    if (subtype === 'compacting') return <div data-message-id={groupId}><CompactingIndicator /></div>
    return null
  }

  // assistant-turn
  return (
    <div data-message-id={groupId} data-message-role="assistant" tabIndex={-1}>
      <AssistantTurnRenderer
        turn={group}
        compactProcess={compactProcess}
        allMessages={allMessages}
        basePath={basePath}
        onFork={onFork}
        onRewind={onRewind}
        isStreaming={isStreaming}
        stoppedByUser={stoppedByUser}
        sessionModelId={sessionModelId}
      />
    </div>
  )
}

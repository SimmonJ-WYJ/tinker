/**
 * ContentBlock — 单个 SDKAssistantMessage 内容块渲染
 *
 * 支持三种内容块类型：
 * - text: 通过 MessageResponse 渲染 Markdown
 * - tool_use: 语义化短语行（如 "读取 foo.ts 第 10-60 行"），展开显示结构化结果
 * - thinking: 默认折叠，单行 Brain + Thinking 标签，点击展开内容（左侧细线缩进）
 */

import * as React from 'react'
import {
  XCircle,
} from 'lucide-react'
import { cn } from '@/lib/utils'
import { FlowRow } from './FlowRow.tsx'
import { RunningStatusText } from './RunningStatusText.tsx'
import { MessageResponse, SelectableMessageResponse } from '@/components/ai-elements/message'
import { useT } from '@/hooks/useT'
import type { TFunction } from 'i18next'
import { usePreserveScrollOnExpand } from '@/hooks/usePreserveScrollOnExpand'
import { getToolPhrase } from './tool-phrase'
import { ToolResultRenderer } from './tool-result-renderers'
import { formatDuration } from './AgentMessages'
import type {
  SDKContentBlock,
  SDKMessage,
  SDKTextBlock,
  SDKToolUseBlock,
  SDKThinkingBlock,
  SDKSystemMessage,
} from '@asci/shared'
import { isSubagentToolUse, nowMs } from '@asci/shared'
import { findToolResultInMessages, type ToolResultData } from './tool-result-lookup.ts'

/**
 * 执行步骤组时间线模式（iconOverride 为编号节点）下，展开内容的左缘对齐 class：
 * 对齐标题文字（节点圆 18px + FlowRow gap-2 8px = 26px），无缩进细线、避开竖线。
 */
const TIMELINE_CONTENT_INDENT = 'ml-[26px]'

// 过程日志卡片比交付物卡更轻：保留可点击边界，但不抢正文层级。
const TOOL_CARD_CLASS = 'rounded-lg border border-border/45 bg-background/55 pl-2 pr-3 py-2 shadow-none'

// ===== useToolResult Hook =====

/** 在 allMessages 中查找匹配 toolUseId 的工具结果（纯查找逻辑见 tool-result-lookup.ts） */
function useToolResult(toolUseId: string, allMessages: SDKMessage[]): ToolResultData | null {
  return React.useMemo(
    () => findToolResultInMessages(toolUseId, allMessages),
    [toolUseId, allMessages],
  )
}

// ===== useSubAgentMeta Hook =====

interface SubAgentMeta {
  durationMs: number
  totalTokens: number
  toolUses: number
}

/** 从 allMessages 中查找匹配 toolUseId 的 task_notification 系统消息，提取用量数据 */
function useSubAgentMeta(toolUseId: string, allMessages: SDKMessage[]): SubAgentMeta | null {
  return React.useMemo(() => {
    for (const msg of allMessages) {
      if (msg.type !== 'system') continue
      const sysMsg = msg as SDKSystemMessage
      if (sysMsg.subtype !== 'task_notification') continue
      if (sysMsg.tool_use_id !== toolUseId) continue
      const usage = sysMsg.usage
      if (!usage) return null
      return {
        durationMs: usage.duration_ms ?? 0,
        totalTokens: usage.total_tokens ?? 0,
        toolUses: usage.tool_uses ?? 0,
      }
    }
    return null
  }, [toolUseId, allMessages])
}

// ===== SubAgent 结果文本解析 =====

interface ParsedAgentResult {
  /** 清理后的输出文本（去除元数据） */
  text: string
  /** 从 <usage> 标签解析的用量数据（作为 task_notification 的备用） */
  usage?: SubAgentMeta
}

/** 从 Agent tool_result 文本中分离内容与元数据（agentId 行 + <usage> 标签） */
function parseAgentResultText(raw: string): ParsedAgentResult {
  let text = raw

  // 提取 <usage> 标签中的用量数据
  let usage: SubAgentMeta | undefined
  const usageMatch = text.match(/<usage>([\s\S]*?)<\/usage>/)
  if (usageMatch) {
    const body = usageMatch[1]!
    const totalTokens = Number(body.match(/total_tokens:\s*(\d+)/)?.[1]) || 0
    const toolUses = Number(body.match(/tool_uses:\s*(\d+)/)?.[1]) || 0
    const durationMs = Number(body.match(/duration_ms:\s*(\d+)/)?.[1]) || 0
    if (totalTokens > 0 || toolUses > 0 || durationMs > 0) {
      usage = { durationMs, totalTokens, toolUses }
    }
    text = text.replace(/<usage>[\s\S]*?<\/usage>/, '')
  }

  // 移除 agentId 行
  text = text.replace(/agentId:.*\n?/g, '')

  // 移除 <output> 标签包裹
  text = text.replace(/<\/?output>/g, '')

  return { text: text.trim(), usage }
}

// ===== SubAgent 完成信息尾部 =====

function SubAgentFooter({
  meta,
  resultText,
}: {
  meta: SubAgentMeta | null
  resultText?: string
}): React.ReactElement | null {
  const { t } = useT('conversation')
  // 解析结果文本，分离内容与元数据
  const parsed = React.useMemo(
    () => resultText ? parseAgentResultText(resultText) : null,
    [resultText],
  )

  // 优先使用 task_notification 的用量数据，备用从 result 文本中解析
  const effectiveMeta = meta ?? parsed?.usage ?? null
  const cleanText = parsed?.text || ''

  // 没有任何信息时不渲染
  if (!effectiveMeta && !cleanText) return null

  return (
    <div className="mt-2 pt-2 border-t border-border/20 space-y-1.5">
      {/* 最终输出文本（Markdown 渲染） */}
      {cleanText && (
        <div className="text-muted-foreground/70">
          <SelectableMessageResponse>{cleanText}</SelectableMessageResponse>
        </div>
      )}

      {/* 用量统计行（最底部） */}
      {effectiveMeta && (
        <div className="flex items-center gap-3 text-sm text-muted-foreground/60 tabular-nums">
          {effectiveMeta.durationMs > 0 && (
            <span>{formatDuration(effectiveMeta.durationMs)}</span>
          )}
          {effectiveMeta.totalTokens > 0 && (
            <span>{t('agent.contentBlock.tokensCount', { formattedCount: effectiveMeta.totalTokens.toLocaleString() })}</span>
          )}
          {effectiveMeta.toolUses > 0 && (
            <span>{t('agent.contentBlock.toolUsesCount', { count: effectiveMeta.toolUses })}</span>
          )}
        </div>
      )}
    </div>
  )
}

// ===== ContentBlock Props =====

export interface ContentBlockProps {
  /** 内容块数据 */
  block: SDKContentBlock
  /** 所有消息（用于查找工具结果） */
  allMessages: SDKMessage[]
  /** 相对路径解析基准（文件链接用） */
  basePath?: string
  /** 是否启用入场动画 */
  animate?: boolean
  /** 在父级中的索引（用于动画延迟） */
  index?: number
  /** 当 turn 中已有主要内容（text）时，非主要块（tool/thinking）颜色变淡 */
  dimmed?: boolean
  /** 是否正在流式输出中（仅流式中的未完成工具调用才显示 spinner） */
  isStreaming?: boolean
  /** 父级注入的额外 className（目前用于给文本结果块加上额外的上边距） */
  className?: string
  /** 用编号节点等替换子块自身计算的类型图标（FlowRow 的 icon 槽）；执行步骤组时间线用 */
  iconOverride?: React.ReactNode
  /** thinking 块默认展开（仅 ThinkingBlock 尊重；ToolUseBlock 忽略，保持折叠） */
  defaultExpanded?: boolean
  /** Codex 风布局：在过程标题行下方画 hairline，正文从线下开始 */
  dividerAfterHeader?: boolean
  /** 紧随该过程块的正文内容。Codex 风里它属于同一个 section body。 */
  trailingContent?: React.ReactNode
}

// ===== 提示词折叠行 =====

function PromptRow({ prompt, dimmed = false }: { prompt: string; dimmed?: boolean }): React.ReactElement {
  const { t } = useT('conversation')
  const [expanded, setExpanded] = React.useState(false)
  const { snapshot } = usePreserveScrollOnExpand(expanded)
  const preview = prompt.length > 60 ? prompt.slice(0, 60) + '…' : prompt

  return (
    <div>
      <FlowRow
        expandable
        expanded={expanded}
        onToggle={() => { snapshot(); setExpanded(!expanded) }}
      >
        <span className={cn(
          'shrink-0 text-[14px]',
          dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground',
        )}>{t('agent.contentBlock.prompt')}</span>

        <span className={cn(
          'truncate text-[14px]',
          dimmed ? 'text-muted-foreground/50' : 'text-muted-foreground/60',
        )}>
          {preview}
        </span>
      </FlowRow>

      {expanded && (
        <div className="ml-5.5 mt-1 mb-2 pl-3 border-l-2 border-border/30 animate-in fade-in slide-in-from-top-1 duration-150">
          <p className="text-sm text-foreground/70 leading-relaxed whitespace-pre-wrap break-words">
            {prompt}
          </p>
        </div>
      )}
    </div>
  )
}

// ===== 工具短语 diff 着色 =====

/** 将 displayLabel 中的 +N 染绿、-N 染红（仅对 Edit/Write 工具生效，避免 `head -5` 等命令参数被误染） */
function renderLabelWithDiffColors(label: string, toolName: string): React.ReactNode {
  if (toolName !== 'Edit' && toolName !== 'Write') return label
  const parts = label.split(/((?:^|(?<=\s))[+-]\d+)/g)
  if (parts.length === 1) return label
  return parts.map((part, i) => {
    if (/^\+\d+$/.test(part)) {
      return <span key={i} className="text-success">{part}</span>
    }
    if (/^-\d+$/.test(part)) {
      return <span key={i} className="text-destructive">{part}</span>
    }
    return part
  })
}

// ===== 工具调用块 =====

interface ToolUseBlockProps {
  block: SDKToolUseBlock
  allMessages: SDKMessage[]
  animate?: boolean
  index?: number
  dimmed?: boolean
  basePath?: string
  /** 是否正在流式输出中 */
  isStreaming?: boolean
  /** 替换状态/类型图标（执行步骤组时间线的编号节点） */
  iconOverride?: React.ReactNode
}

function ToolUseBlock({ block, allMessages, animate = false, index = 0, dimmed = false, basePath, isStreaming, iconOverride }: ToolUseBlockProps): React.ReactElement {
  const { t } = useT('conversation')
  const [expanded, setExpanded] = React.useState(false)
  const toolResult = useToolResult(block.id, allMessages)
  const isAgentTool = isSubagentToolUse({ name: block.name })
  const subAgentMeta = useSubAgentMeta(block.id, allMessages)

  // Agent/Task 派发卡片：是否展开 prompt 详情（不再 hold children — A4 §① 默认透传后 children 已抬顶层）
  const [childrenExpanded, setChildrenExpanded] = React.useState(false)

  // 展开/折叠时锁定 scrollTop，避免 stick-to-bottom 把视口拉到新底部
  const expandedScroll = usePreserveScrollOnExpand(expanded)
  const childrenScroll = usePreserveScrollOnExpand(childrenExpanded)

  const phrase = getToolPhrase(block.name, block.input, t)

  const isCompleted = toolResult !== null
  const isError = toolResult?.isError === true

  // 行首图标优先级（简约风）：iconOverride（执行步骤组 dot 节点）优先；
  //   否则只保留功能性状态图标（运行中 Loader2 / 失败 XCircle），默认无类型图标。
  const leadingIcon: React.ReactNode = iconOverride ?? (
    !isCompleted && isStreaming ? (
      <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground/40 shrink-0" />
    ) : isError ? (
      <XCircle className="size-3.5 text-destructive/70 shrink-0" />
    ) : null
  )

  // 运行中显示进行时短语，完成或非流式（已终止）显示完成态短语
  const displayLabel = (isCompleted || !isStreaming) ? phrase.label : phrase.loadingLabel

  const delay = animate && index < 10 ? `${index * 30}ms` : '0ms'

  // Agent/Task: 提取 prompt 用于气泡展示
  const agentPrompt = isAgentTool
    ? (typeof block.input.prompt === 'string' ? block.input.prompt : undefined)
    : undefined

  // ===== Agent/Task 工具：派发卡片（A4 §① 改造后退化为派发记录，children 已抬到顶层） =====
  if (isAgentTool) {
    return (
      <div
        data-tool-card="true"
        className={cn(
          TOOL_CARD_CLASS,
          animate && 'animate-in fade-in duration-150 fill-mode-both',
        )}
        style={animate ? { animationDelay: delay } : undefined}
      >
        {/* 头部行：单图标(状态/工具二选一) + 语义短语，行尾箭头（展开后看到 prompt 详情 + SubAgentFooter） */}
        <FlowRow
          flush
          expandable
          expanded={childrenExpanded}
          onToggle={() => { childrenScroll.snapshot(); setChildrenExpanded(!childrenExpanded) }}
          icon={leadingIcon}
        >
          <span className={cn(
            'truncate text-[14px]',
            '!text-foreground/85',
          )}>{displayLabel}</span>
        </FlowRow>

        {/* 展开内容（prompt 详情 + 完成信息）；children 已经抬到顶层，本卡片不再 hold */}
        {childrenExpanded && (
          <div
            data-tool-result-card="true"
            className={cn(
              // 去掉内层灰卡（综述总结/表格各自正常排版），仅留间距与入场动画
              'mt-2 space-y-2 animate-in fade-in slide-in-from-top-1 duration-150',
              iconOverride && TIMELINE_CONTENT_INDENT,
            )}
          >
            {agentPrompt && <PromptRow prompt={agentPrompt} dimmed={dimmed} />}
            {isCompleted && (
              <SubAgentFooter
                meta={subAgentMeta}
                resultText={toolResult?.result}
              />
            )}
          </div>
        )}
      </div>
    )
  }

  // ===== 普通工具：语义化短语 + 结构化结果 =====
  return (
    <div
      data-tool-card="true"
      className={cn(
        TOOL_CARD_CLASS,
        animate && 'animate-in fade-in duration-150 fill-mode-both',
      )}
      style={animate ? { animationDelay: delay } : undefined}
    >
      <FlowRow
        flush
        // 仅当有结果可展开时显示箭头；否则行尾留占位（运行中/无结果不可展开）
        expandable={!!toolResult?.result}
        expanded={expanded}
        onToggle={() => { expandedScroll.snapshot(); setExpanded(!expanded) }}
        icon={leadingIcon}
      >
        <span className={cn(
          'truncate text-[14px]',
          '!text-foreground/85',
        )}>{renderLabelWithDiffColors(displayLabel, block.name)}</span>
      </FlowRow>

      {expanded && toolResult?.result && (
        <div
          data-tool-result-card="true"
          className={cn(
            // 去掉内层灰卡（各结果渲染器自带背景，无需再套一层），仅留间距与入场动画
            'mt-2 animate-in fade-in slide-in-from-top-1 duration-150',
            iconOverride && TIMELINE_CONTENT_INDENT,
          )}
        >
          <ToolResultRenderer
            toolName={block.name}
            input={block.input}
            result={toolResult.result}
            isError={isError}
            basePath={basePath}
          />
        </div>
      )}
    </div>
  )
}

// ===== 思考块（默认折叠，单行 Trigger + 左侧细线展开内容） =====

interface ThinkingBlockProps {
  block: SDKThinkingBlock
  dimmed?: boolean
  /** 会话级流式状态；用于判断当前 thinking 是否还在生成并计算耗时 */
  isStreaming?: boolean
  /** 替换 Brain 图标（执行步骤组时间线的编号节点） */
  iconOverride?: React.ReactNode
  /** 初始是否展开（时间线中 thinking 默认展开） */
  defaultExpanded?: boolean
  /** 标题下方是否固定显示 Codex 风 hairline */
  dividerAfterHeader?: boolean
  /** 紧随 thinking 的正文内容 */
  trailingContent?: React.ReactNode
}

/** 毫秒转秒，向上取整 */
const MS_IN_S = 1000

function ThinkingBlock({ block, dimmed = false, isStreaming = false, iconOverride, defaultExpanded = false, dividerAfterHeader = false, trailingContent }: ThinkingBlockProps): React.ReactElement {
  const { t } = useT('conversation')
  const [expanded, setExpanded] = React.useState(defaultExpanded)
  const { snapshot } = usePreserveScrollOnExpand(expanded)

  // 追踪思考耗时：isStreaming 由 true 转 false 时锁定 duration
  const [duration, setDuration] = React.useState<number | undefined>(undefined)
  const startTimeRef = React.useRef<number | null>(null)

  React.useEffect(() => {
    if (isStreaming) {
      if (startTimeRef.current === null) {
        startTimeRef.current = nowMs()
      }
    } else if (startTimeRef.current !== null) {
      const elapsed = Math.ceil((nowMs() - startTimeRef.current) / MS_IN_S)
      setDuration(elapsed)
      startTimeRef.current = null
    }
  }, [isStreaming])

  const label = formatThinkingLabel(isStreaming, duration, t)

  const toggleExpand = React.useCallback(() => {
    snapshot()
    setExpanded((prev) => !prev)
  }, [snapshot])

  return (
    <div>
      <FlowRow
        expandable
        expanded={expanded}
        onToggle={toggleExpand}
        // 简约风：默认无图标；iconOverride（执行步骤组 dot 节点）仍优先
        icon={iconOverride ?? null}
        edgeAlign={dividerAfterHeader && iconOverride == null}
      >
        <RunningStatusText
          active={label.pulse && iconOverride == null}
          className={cn(
            'text-[14px]',
            dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground',
          )}
        >
          {label.text}
        </RunningStatusText>
      </FlowRow>

      {dividerAfterHeader && (
        <div aria-hidden className="mt-1 border-t border-border/40" />
      )}

      {(expanded || trailingContent != null) && (
        <div data-step-section-body="true" className="mt-2.5 space-y-3">
          {expanded && (
            // Codex 风：思考展开内容用浅灰圆角卡片承载，去掉左侧细线缩进
            <div className={cn(
              'rounded-lg bg-muted/40 px-4 py-3 animate-in fade-in slide-in-from-top-1 duration-150',
              iconOverride && TIMELINE_CONTENT_INDENT,
            )}>
              <div
                className={cn(
                  'prose prose-sm dark:prose-invert max-w-none prose-p:my-1.5 prose-p:leading-relaxed [&>*:first-child]:mt-0 [&>*:last-child]:mb-0 text-sm',
                  dimmed ? 'text-muted-foreground/80' : 'text-foreground/75',
                )}
              >
                <SelectableMessageResponse>{block.thinking}</SelectableMessageResponse>
              </div>
            </div>
          )}
          {trailingContent}
        </div>
      )}
    </div>
  )
}

// ===== ContentBlock 主组件 =====

export function ContentBlock({ block, allMessages, basePath, animate = false, index = 0, dimmed = false, isStreaming, className, iconOverride, defaultExpanded, dividerAfterHeader = false, trailingContent }: ContentBlockProps): React.ReactElement | null {
  // text 块 — 主要内容，不受 dimmed 影响
  if (block.type === 'text') {
    const textBlock = block as SDKTextBlock
    if (!textBlock.text) return null
    return (
      <SelectableMessageResponse basePath={basePath} className={className}>{textBlock.text}</SelectableMessageResponse>
    )
  }

  // tool_use 块
  if (block.type === 'tool_use') {
    const toolBlock = block as SDKToolUseBlock
    return (
      <ToolUseBlock
        block={toolBlock}
        allMessages={allMessages}
        animate={animate}
        index={index}
        dimmed={dimmed}
        basePath={basePath}
        isStreaming={isStreaming}
        iconOverride={iconOverride}
      />
    )
  }

  // thinking 块
  if (block.type === 'thinking') {
    const thinkingBlock = block as SDKThinkingBlock
    // The turn renderer delegates the following reply to this block.
    // Some relays emit signature-only thinking blocks; retain that reply.
    if (!thinkingBlock.thinking) return trailingContent != null ? <>{trailingContent}</> : null
    return <ThinkingBlock block={thinkingBlock} dimmed={dimmed} isStreaming={isStreaming} iconOverride={iconOverride} defaultExpanded={defaultExpanded} dividerAfterHeader={dividerAfterHeader} trailingContent={trailingContent} />
  }

  return null
}

// ===== 思考标签文案格式化（纯函数，便于单测） =====

export interface ThinkingLabel {
  /** 主文案 */
  text: string
  /** 是否处于实时思考，呈现运行态文字效果 */
  pulse: boolean
}

/**
 * 生成思考块 Trigger 的显示文案。
 * - 流式中：Thinking...（文字流光）
 * - 结束后无耗时信息：Thinking
 * - 结束后有耗时：Thinking · Ns
 */
export function formatThinkingLabel(
  isStreaming: boolean,
  duration: number | undefined,
  t: TFunction<'conversation'>,
): ThinkingLabel {
  if (isStreaming) {
    return { text: t('agent.messages.thinkingStreaming'), pulse: true }
  }
  if (duration === undefined || duration === 0) {
    return { text: t('agent.messages.thinking'), pulse: false }
  }
  return { text: t('agent.messages.thinkingWithDuration', { duration }), pulse: false }
}

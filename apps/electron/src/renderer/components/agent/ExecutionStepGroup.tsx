/**
 * ExecutionStepGroup — 执行步骤组（0.2.0）
 *
 * 把一段连续过程块折叠成对话流一级的一行（视觉参考 Codex 排版）：
 *  - 折叠态：运行中显示当前步（转圈）；完成恒中性显示「已执行 N 步」。
 *    过程性失败不在折叠态突出（#443）——失败步在展开列表里 dot 染红，便于排查。
 *  - 队友组：折叠行带队友名徽标（⊙ 名字·已执行 N 步）。
 *  - 默认折叠；折叠头下方固定一条 hairline 分割线，
 *    下面逐条复用 ContentBlock，节点用 dot 圆点替代类型图标，行间距加大以保呼吸感；
 *    thinking 步默认展开直接显示内容、工具步保持折叠（单步仍可点开）。
 *  - 整个 turn 跑完时（turnStreaming→false）自动收起（尊重「完成后自动收」的产品决策）；
 *    turn 仍在跑时即便本组不再是流尾（isLive 瞬时翻 false）也保留用户手动展开。
 */
import * as React from 'react'

import { cn } from '@/lib/utils'
import { FlowRow } from './FlowRow.tsx'
import { useT } from '@/hooks/useT'
import { usePreserveScrollOnExpand } from '@/hooks/usePreserveScrollOnExpand'
import { ContentBlock } from './ContentBlock.tsx'
import { getToolPhrase } from './tool-phrase'
import type { GroupStep } from './group-execution-steps.ts'
import { speakerDisplayName } from './resolve-message-speaker.ts'
import { getScenarioIcon } from './scenario-icon.tsx'
import type { SDKContentBlock, SDKMessage, SDKToolUseBlock, AgentSpeaker } from '@asci/shared'
import type { TFunction } from 'i18next'

interface ExecutionStepGroupProps {
  steps: GroupStep[]
  speaker: AgentSpeaker
  allMessages: SDKMessage[]
  basePath?: string
  /** 该组是否处于实时流（isStreaming 且为当前 turn 最后一个渲染项） */
  isLive: boolean
  /** 整个 turn 是否仍在流式输出（与 isLive 不同：本组可能已不是 tail 但 turn 仍在跑） */
  turnStreaming: boolean
  dimmed?: boolean
  /** 紧随步骤组的正文内容。Codex 风里它属于同一个 section，而不是新的顶层块。 */
  trailingContent?: React.ReactNode
}

/** 折叠行运行态的「当前步」短语：工具走 loadingLabel，思考走 thinkingStreaming */
function currentStepLabel(block: SDKContentBlock, t: TFunction<'conversation'>): string {
  if (block.type === 'tool_use') {
    const tu = block as SDKToolUseBlock
    return getToolPhrase(tu.name, tu.input, t).loadingLabel
  }
  return t('agent.messages.thinkingStreaming')
}

export function ExecutionStepGroup({
  steps, speaker, allMessages, basePath, isLive, turnStreaming, dimmed = false, trailingContent,
}: ExecutionStepGroupProps): React.ReactElement {
  const { t } = useT('conversation')
  const [expanded, setExpanded] = React.useState(false)
  const expandedScroll = usePreserveScrollOnExpand(expanded)

  // 实时→完成时自动收起：仅当整个 turn 真正结束（!turnStreaming）才收起。
  // 不能用 isLive 判定收起——turn 仍在跑时，本组可能因后续块追加而不再是 tail，
  // 导致 isLive 瞬时 true→false（#bug）；那只是「本组不再是流尾」，并非「跑完」，
  // 此时若收起会清掉用户手动展开的状态。用 turnStreaming 区分这两种情形。
  // 历史组（从未 live）首次挂载也会跑一次 setExpanded(false)，但本就默认折叠，无副作用。
  React.useEffect(() => {
    if (!turnStreaming) setExpanded(false)
  }, [turnStreaming])

  // 折叠行只需步数；过程性失败不在折叠态呈现（#443），无需扫描结果统计失败。
  const total = steps.length

  const rawScenarioName = speakerDisplayName(speaker)
  const scenarioName = rawScenarioName === 'general-purpose' ? null : rawScenarioName
  const lastStep = steps[steps.length - 1]!

  // 折叠行主文案（灰色基底）：运行中=当前步短语；否则=已执行 N 步（恒中性，不标失败）。
  const baseLabel = isLive
    ? currentStepLabel(lastStep.block, t)
    : t('agent.messages.executedSteps', { count: total })

  return (
    <div>
      <FlowRow
        edgeAlign
        expandable
        expanded={expanded}
        onToggle={() => { expandedScroll.snapshot(); setExpanded(!expanded) }}
        // 完成态无图标（简约风）；运行中保留 Loader2 spinner 作为"正在执行"的功能性信号
        icon={
          isLive ? (
            <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-foreground/40" />
          ) : null
        }
      >
        {scenarioName && (
          <span className={cn(
            'shrink-0 inline-flex items-center gap-1.5 text-[14px] font-normal',
            'text-muted-foreground/70',
          )}>
            {getScenarioIcon(scenarioName, {
              className: 'text-muted-foreground/70',
            })}
            <span>{scenarioName}</span>
          </span>
        )}
        <span className={cn(
          'truncate text-[14px]',

          dimmed ? 'text-muted-foreground/70' : 'text-muted-foreground',
        )}>
          {baseLabel}
        </span>
      </FlowRow>

      {/* Codex 风：分割线属于步骤组本身，固定在步骤标题下方；后续正文不再承载 border-t。 */}
      <div aria-hidden className="mt-1 border-t border-border/40" />

      {(expanded || trailingContent != null) && (
        <div data-step-section-body="true" className="mt-2.5 space-y-3">
          {expanded && (
            <>
          {/* dot 节点维持 18px 外槽位（与 ContentBlock 内 TIMELINE_CONTENT_INDENT=ml-[26px] 对齐），
              dot 仅居中占 5px；行间距放大，避免步骤内容块互相黏连。 */}
          <div className="space-y-3 animate-in fade-in slide-in-from-top-1 duration-150">
            {steps.map((step, idx) => (
              <ContentBlock
                key={step.originalIndex}
                block={step.block}
                allMessages={allMessages}
                basePath={basePath}
                animate={false}
                index={idx}
                dimmed={dimmed}
                isStreaming={isLive && idx === steps.length - 1}
                defaultExpanded={step.block.type === 'thinking'}
                iconOverride={
                  <span className="relative z-10 flex size-[18px] shrink-0 items-center justify-center">
                    <span className="block size-[5px] rounded-full bg-foreground/60" />
                  </span>
                }
              />
            ))}
          </div>
            </>
          )}
          {trailingContent}
        </div>
      )}
    </div>
  )
}

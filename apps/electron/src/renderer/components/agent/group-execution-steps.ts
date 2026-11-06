/**
 * 执行步骤分组（0.2.0）— 纯函数，无 React 依赖，便于单测。
 *
 * 把一个 assistant turn 的顶层内容块序列预处理成「渲染项列表」：
 *   - text / 最终回答          → 透传 block（切断分组）
 *   - 首个 TodoBoard 工具块     → 透传 block（卡片锚点，切断分组）
 *   - 其余 TodoBoard 工具块     → 透明跳过（不渲染、不破组；渲染层本就对其余 task 块渲染 null）
 *   - 单个过程块               → 透传 block（单步退化）
 *   - ≥2 个同说话人连续过程块   → 聚合成 ExecutionStepGroup
 *
 * 过程块 = thinking | 非 TodoBoard 的 tool_use（含 Task/Agent 派发，归入主 Agent 组）。
 * 说话人切换（master ↔ 队友、队友A ↔ 队友B）切断分组。
 */
import type { SDKContentBlock, SDKToolUseBlock, AgentSpeaker } from '@asci/shared'
import { TASK_TOOL_NAMES } from './TaskProgressCard'

export interface EnrichedBlock {
  block: SDKContentBlock
  speaker: AgentSpeaker
}

export interface GroupStep {
  block: SDKContentBlock
  /** 在原 topLevelEnriched 序列中的下标，用作 React key / 动画延迟 */
  originalIndex: number
}

export type ExecutionRenderItem =
  | { kind: 'block'; block: SDKContentBlock; speaker: AgentSpeaker; originalIndex: number }
  | { kind: 'group'; speaker: AgentSpeaker; steps: GroupStep[] }

/** 说话人归一化 key：'master' 或 'scenario:<name>'，用于判断是否同一说话人 */
export function speakerKey(speaker: AgentSpeaker): string {
  return speaker === 'master' ? 'master' : `scenario:${speaker.name}`
}

/** 是否 TodoBoard 工具块（TaskCreate/TaskUpdate/TodoWrite） */
function isTodoBoardBlock(block: SDKContentBlock): boolean {
  return block.type === 'tool_use' && TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)
}

/**
 * 时间线隐藏的敏感工具：命令 / 搜索 / 技能 / 读取。
 * 这些步骤会暴露 shell 命令、搜索模式、内部文件 / 技能名等细节，对用户无价值，
 * 从执行步骤组里透明剔除（不计数、不渲染、不破组）。
 */
const HIDDEN_STEP_TOOLS = new Set(['Bash', 'Grep', 'Glob', 'Skill', 'Read'])

/** 是否隐藏步（敏感工具调用，从时间线透明剔除） */
function isHiddenStep(block: SDKContentBlock): boolean {
  return block.type === 'tool_use' && HIDDEN_STEP_TOOLS.has((block as SDKToolUseBlock).name)
}

/** 是否过程块（思考 + 非 TodoBoard 工具调用） */
export function isProcessStep(block: SDKContentBlock): boolean {
  if (block.type === 'thinking') return true
  if (block.type === 'tool_use') return !TASK_TOOL_NAMES.has((block as SDKToolUseBlock).name)
  return false
}

export function groupExecutionSteps(
  items: EnrichedBlock[],
  firstTaskIndex: number,
): ExecutionRenderItem[] {
  const out: ExecutionRenderItem[] = []
  let i = 0
  while (i < items.length) {
    const item = items[i]!
    const block = item.block

    // TodoBoard 块：仅首个作为卡片锚点透传（切断分组），其余透明跳过
    if (isTodoBoardBlock(block)) {
      if (i === firstTaskIndex) {
        out.push({ kind: 'block', block, speaker: item.speaker, originalIndex: i })
      }
      i++
      continue
    }

    // 隐藏步（敏感工具）：透明跳过，既不成组也不退化成单 block
    if (isHiddenStep(block)) {
      i++
      continue
    }

    // 非过程块（text）：透传边界
    if (!isProcessStep(block)) {
      out.push({ kind: 'block', block, speaker: item.speaker, originalIndex: i })
      i++
      continue
    }

    // 过程块：聚合连续同说话人过程块
    const speaker = item.speaker
    const sk = speakerKey(speaker)
    const startIndex = i
    const steps: GroupStep[] = []
    while (i < items.length) {
      const cur = items[i]!
      if (isTodoBoardBlock(cur.block)) {
        if (i === firstTaskIndex) break // 首个 TodoBoard 是边界，结束当前组
        i++ // 其余 TodoBoard 透明跳过，保持组连续
        continue
      }
      if (isHiddenStep(cur.block)) {
        i++ // 隐藏步透明跳过，保持组连续，不进 steps
        continue
      }
      if (!isProcessStep(cur.block)) break // text 切断
      if (speakerKey(cur.speaker) !== sk) break // 说话人切换切断
      steps.push({ block: cur.block, originalIndex: i })
      i++
    }

    if (steps.length >= 2) {
      out.push({ kind: 'group', speaker, steps })
    } else if (steps.length === 1) {
      out.push({ kind: 'block', block: steps[0]!.block, speaker, originalIndex: startIndex })
    }
    // steps.length === 0：本段过程块全是隐藏步（被透明剔除），整组不渲染——什么都不 push
  }
  return out
}

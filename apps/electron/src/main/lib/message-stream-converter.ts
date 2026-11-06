/**
 * message-stream-converter —— SDK 消息流 → ASCI 内部 payload（带 speaker 元数据）（A4 phase4）。
 *
 * 设计：
 *  - 有状态：跟踪 tool_use_id → scenario_agent_name 映射（来自 Master 派发的 Task/Agent tool 调用）
 *  - 输入 payload 不改 SDK 原生消息结构；只在 ASCI metadata 层附 speaker
 *  - 识别规则：
 *    - assistant message 含 `tool_use` 且 name ∈ {'Task', 'Agent'} → 记录 tool_use.id → input.subagent_type
 *    - 任何消息含 `parent_tool_use_id`，且能在映射中找到 subagent_type → speaker: { kind: 'scenario', name }
 *    - 无 parent_tool_use_id 或映射 miss → speaker: 'master'
 *
 * packId 富化（Registry 反查）暂不实现 —— 保持本模块无外部依赖。Phase 4.5 接入。
 */
import type { AgentStreamPayload, AgentSpeaker, SDKMessage } from '@asci/shared'
import { isSubagentToolUse } from '@asci/shared'

interface MessageStreamConverter {
  process(payload: AgentStreamPayload): AgentStreamPayload
}

interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** 识别是否为 Master 派发子 Agent 的 tool 名称（A0b：统一走 isSubagentToolUse，避免本地 OR 列表与 SUBAGENT_TOOL_NAMES 漂移） */
const isSubagentToolName = (name: string): boolean => isSubagentToolUse({ name })

export function createMessageStreamConverter(): MessageStreamConverter {
  /** Master 派发的 tool_use.id → 子 Agent name 映射 */
  const dispatchMap = new Map<string, string>()

  return {
    process(payload) {
      // asci_event 透传（Phase 4 不识别 speaker，保持 metadata 缺省）
      if (payload.kind !== 'sdk_message') {
        return payload
      }

      const msg = payload.message as SDKMessage & Record<string, unknown>

      // 1. 记录 Master 派发：assistant message 含 tool_use(Task/Agent)
      if (msg.type === 'assistant') {
        const content = (msg as { message?: { content?: unknown[] } }).message?.content ?? []
        for (const block of content) {
          if (
            block !== null &&
            typeof block === 'object' &&
            (block as { type?: string }).type === 'tool_use'
          ) {
            const tu = block as ToolUseBlock
            if (isSubagentToolName(tu.name)) {
              const subagentType = tu.input?.subagent_type
              if (typeof subagentType === 'string') {
                dispatchMap.set(tu.id, subagentType)
              }
            }
          }
        }
      }

      // 2. 识别 speaker：通过 parent_tool_use_id 反查映射
      const parentId = (msg as { parent_tool_use_id?: string | null }).parent_tool_use_id
      let speaker: AgentSpeaker = 'master'
      if (parentId) {
        const scenarioName = dispatchMap.get(parentId)
        if (scenarioName) {
          speaker = { kind: 'scenario', name: scenarioName }
        }
      }

      return {
        ...payload,
        asci_metadata: { speaker },
      }
    },
  }
}

/** 无状态便利函数 — 测试 / 单次转换用；不跟踪 dispatchMap 跨调用 */
export function convertSDKMessage(payload: AgentStreamPayload): AgentStreamPayload {
  return createMessageStreamConverter().process(payload)
}

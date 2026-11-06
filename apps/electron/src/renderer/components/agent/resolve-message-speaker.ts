/**
 * resolveMessageSpeaker — 从消息属性推断 speaker（A4 phase4）。
 *
 * 优先级：
 *  1. payload.asci_metadata.speaker（实时流 — Phase 4 EventBus middleware 注入）
 *  2. fallback: agentToolIds map + parent_tool_use_id 推断（持久化回放 / 历史消息无 metadata）
 *  3. 都没匹配 → 'master'
 *
 * 与 message-stream-converter.ts 的算法等价；renderer 端独立实现保证：
 *  - 历史消息（从 JSONL 加载，无 asci_metadata）可推断 speaker
 *  - 实时流（有 asci_metadata）直接读
 */
import type { AgentSpeaker } from '@asci/shared'

export interface ResolveSpeakerInput {
  /** 优先级 1：IPC 实时流 payload 的 asci_metadata.speaker */
  metadataSpeaker?: AgentSpeaker
  /** 优先级 2 fallback：消息的 parent_tool_use_id（持久化回放路径） */
  parentToolUseId?: string | null
  /** 优先级 2 fallback：agentToolIds 映射 — id → subagent_type */
  agentToolIds?: Map<string, string>
}

export function resolveMessageSpeaker(input: ResolveSpeakerInput): AgentSpeaker {
  if (input.metadataSpeaker) return input.metadataSpeaker
  if (input.parentToolUseId && input.agentToolIds) {
    const name = input.agentToolIds.get(input.parentToolUseId)
    if (name) return { kind: 'scenario', name }
  }
  return 'master'
}

/**
 * Scenario agent 显示名 — 给 UI 渲染 label 用。
 * `'master'` → null（master 不需要标签）；scenario → name 字符串
 */
export function speakerDisplayName(speaker: AgentSpeaker): string | null {
  if (speaker === 'master') return null
  return speaker.name
}

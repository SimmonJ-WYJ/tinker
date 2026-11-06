/**
 * 会话回合候选服务 —— 为「补证据 · 历史对话」picker（#709）列出某会话内可加入证据集的 Q&A 回合。
 *
 * 读 agent session 的 SDKMessage 流，按**人类 user 消息**切回合：每段 [人类 user → 下一条
 * 人类 user 之前的所有 assistant] 为一个回合候选。与聊天界面「加入证据集」口径严格对齐：
 *   - 回合 messageUuid = 该回合**最后一条 assistant 消息**的 uuid（= renderer 的 lastUuid）
 *   - 回合 answer = 回合内所有 assistant text 块拼接（= renderer 的 textContent）
 *   - 回合 question = 触发该回合的人类 user 消息正文（= renderer 的 userText）
 *   - snapshotText 用 shared buildQaSnapshot 拼（唯一事实源，避免与聊天流分叉）
 * 仅产出 answer 非空的回合（纯工具调用 / 空回答 turn 跳过，与 renderer「textContent 非空才
 * 显示 AddToEvidenceSetButton」一致）。幂等键 = (setId, sessionId, messageUuid)，落库走
 * ADD_CONVERSATION_MESSAGE，与本候选自然对齐。
 *
 * 纯读：不碰 DB。
 */
import type {
  ConversationTurnCandidate,
  SDKAssistantMessage,
  SDKMessage,
  SDKUserMessage,
} from '@asci/shared'
import { buildQaSnapshot, toIso } from '@asci/shared'

import { getAgentSessionSDKMessages } from '../agent-session-manager.ts'

/** 预览文本截断长度（列表展示用；snapshotText 仍存 verbatim 全文） */
const PREVIEW_MAX = 280

/** 拼接 assistant 消息里所有 text 块 */
function assistantText(m: SDKAssistantMessage): string {
  const parts: string[] = []
  for (const block of m.message.content) {
    if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('\n')
}

/** 拼接人类 user 消息里所有 text 块 */
function userText(m: SDKUserMessage): string {
  const content = m.message?.content
  if (!Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    if (block.type === 'text' && typeof (block as { text?: unknown }).text === 'string') {
      parts.push((block as { text: string }).text)
    }
  }
  return parts.join('\n')
}

/** 人类 user 消息：含 text 块、不含 tool_result 块、非 SDK 合成（与 citations-extractor 同口径） */
function isHumanUserMessage(m: SDKUserMessage): boolean {
  if (m.isSynthetic) return false
  const content = m.message?.content
  if (!Array.isArray(content)) return false // 无 content 不作为问句来源（保守，避免拿不到 uuid）
  if (content.some((b) => b.type === 'tool_result')) return false
  return content.some((b) => b.type === 'text')
}

function truncate(s: string): string {
  const t = s.trim()
  return t.length > PREVIEW_MAX ? `${t.slice(0, PREVIEW_MAX)}…` : t
}

interface TurnAccumulator {
  userMessageUuid?: string
  question: string
  answerParts: string[]
  lastAssistantUuid?: string
  lastTimestamp?: string
}

/** SDKMessage 上运行时挂的创建时间（ISO/ms 由调用方处理）；类型未声明，按需读取 */
function readCreatedAtIso(m: SDKMessage): string | undefined {
  const v = (m as { _createdAt?: unknown })._createdAt
  if (typeof v !== 'number') return undefined
  return toIso(v)
}

/**
 * 列出会话内的 Q&A 回合候选（按出现顺序）。session 不存在 / 无可读消息 → []。
 */
export function listConversationTurns(sessionId: string): ConversationTurnCandidate[] {
  const id = sessionId.trim()
  if (!id) return []

  let messages: SDKMessage[]
  try {
    messages = getAgentSessionSDKMessages(id)
  } catch {
    return []
  }

  return buildTurnsFromMessages(messages)
}

/**
 * 纯函数：把 SDKMessage 流切成 Q&A 回合候选（无 I/O，便于单测）。
 * 见 listConversationTurns 的口径说明（人类 user 边界分组 / lastUuid / 空回答跳过）。
 */
export function buildTurnsFromMessages(messages: SDKMessage[]): ConversationTurnCandidate[] {
  const out: ConversationTurnCandidate[] = []
  let cur: TurnAccumulator | null = null

  const flush = (): void => {
    if (!cur || !cur.lastAssistantUuid) return
    const answer = cur.answerParts.join('\n').trim()
    if (!answer) return // 纯工具调用 / 空回答 turn 跳过
    out.push({
      messageUuid: cur.lastAssistantUuid,
      ...(cur.userMessageUuid ? { userMessageUuid: cur.userMessageUuid } : {}),
      questionPreview: truncate(cur.question),
      answerPreview: truncate(answer),
      snapshotText: buildQaSnapshot({ question: cur.question, answer }),
      ...(cur.lastTimestamp ? { messageTimestamp: cur.lastTimestamp } : {}),
    })
  }

  for (const m of messages) {
    if (m.type === 'user' && isHumanUserMessage(m as SDKUserMessage)) {
      flush()
      const um = m as SDKUserMessage
      cur = {
        ...(um.uuid ? { userMessageUuid: um.uuid } : {}),
        question: userText(um),
        answerParts: [],
      }
    } else if (m.type === 'assistant') {
      const am = m as SDKAssistantMessage
      // 回合开始前出现的 assistant（如 replay 首条）→ 起一个无问句回合
      if (!cur) cur = { question: '', answerParts: [] }
      const text = assistantText(am)
      if (text.trim()) cur.answerParts.push(text)
      if (am.uuid) {
        cur.lastAssistantUuid = am.uuid
        cur.lastTimestamp = readCreatedAtIso(m)
      }
    }
  }
  flush()

  return out
}

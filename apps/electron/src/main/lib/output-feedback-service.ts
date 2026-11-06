/**
 * 输出反馈服务（issue #477）
 *
 * 把用户对助手输出的 👍/👎 表态以 append-only 事件日志落盘到
 * ~/.asci/feedback/<sessionId>.jsonl（一行一事件，含切换 / 取消）。
 * 回显时按 messageUuid 折叠取最后一条；'none' 表示取消表态 → 从 map 删除。
 *
 * 选型：反馈是追加型事件日志，符合「追加型日志走 JSONL」约定，不引 SQLite。
 * 设计规格见 docs/specs/output-feedback-spec.md
 */
import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import type {
  OutputFeedbackEvent,
  OutputFeedbackSetInput,
  OutputFeedbackSetResult,
  SessionFeedbackMap,
} from '@asci/shared'
import { nowIso } from '@asci/shared'
import { getOutputFeedbackPath } from './config-paths.ts'

/**
 * 写入一条反馈事件（追加），返回折叠后的当前态（'none' → null）。
 * 时间戳在此生成，避免依赖渲染端时钟。
 */
export function appendOutputFeedback(input: OutputFeedbackSetInput): OutputFeedbackSetResult {
  const event: OutputFeedbackEvent = {
    messageUuid: input.messageUuid,
    userMessageUuid: input.userMessageUuid,
    sessionId: input.sessionId,
    workspaceId: input.workspaceId,
    value: input.value,
    createdAt: nowIso(),
    model: input.model,
    scenario: input.scenario,
  }

  try {
    appendFileSync(getOutputFeedbackPath(input.sessionId), `${JSON.stringify(event)}\n`, 'utf-8')
  } catch (err) {
    console.error('[outputFeedback] 写入失败:', err)
    throw err
  }

  return { value: input.value === 'none' ? null : input.value }
}

/**
 * 会话回退废弃：截断消息后，把 messageUuid 不在 keptMessageUuids 内的反馈追加 'none'
 * 墓碑事件抹掉（保持 append-only 审计轨迹；回显时折叠为「未表态」）。返回被废弃的条数。
 *
 * 用于 executeRewind：回退到某条回答（inclusive）后，其后被截断的回答上的 👍/👎 已失去意义，
 * 自动废弃，避免 SDK 从该点分支续写后旧反馈错挂到新回答。
 */
export function discardFeedbackForRemovedMessages(
  sessionId: string,
  keptMessageUuids: Set<string>,
): number {
  const map = getSessionFeedbackMap(sessionId)
  let discarded = 0
  for (const messageUuid of Object.keys(map)) {
    if (keptMessageUuids.has(messageUuid)) continue
    appendOutputFeedback({ sessionId, messageUuid, value: 'none' })
    discarded++
  }
  return discarded
}

/**
 * 读取某 session 的回显 map：逐行 parse（跳过损坏行），按 messageUuid 覆盖式折叠，
 * 'none' 删除，最终只留 'up' / 'down'。文件不存在 → 返回空 map。
 */
export function getSessionFeedbackMap(sessionId: string): SessionFeedbackMap {
  const filePath = getOutputFeedbackPath(sessionId)
  const map: SessionFeedbackMap = {}

  if (!existsSync(filePath)) return map

  try {
    for (const line of readFileSync(filePath, 'utf-8').split('\n')) {
      const trimmed = line.trim()
      if (!trimmed) continue
      try {
        const event = JSON.parse(trimmed) as OutputFeedbackEvent
        if (!event.messageUuid) continue
        if (event.value === 'up' || event.value === 'down') {
          map[event.messageUuid] = event.value
        } else {
          // 'none' = 取消表态 → 移除
          delete map[event.messageUuid]
        }
      } catch {
        console.warn('[outputFeedback] 跳过损坏行')
      }
    }
  } catch (err) {
    console.error('[outputFeedback] 读取失败:', err)
  }

  return map
}

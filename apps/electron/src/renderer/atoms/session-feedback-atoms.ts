/**
 * 助手输出 👍/👎 反馈的会话级状态（issue #477）
 *
 * - feedbackServerMapAtom：按当前 agent session 拉取已落盘的反馈（回显），loadable 包装；
 *   session 切换时自动重拉。
 * - feedbackOverridesAtom：本次会话点击后的乐观覆盖层（含取消 → null），按 sessionId 作用域，
 *   session 切换后自动失效。
 *
 * 组件读取时以 override 覆盖 server map，得到某条消息的当前态（'up' | 'down' | null）。
 * 设计规格见 docs/specs/output-feedback-spec.md
 */
import { atom } from 'jotai'
import { loadable } from 'jotai/utils'
import type { FeedbackSelection, SessionFeedbackMap } from '@asci/shared'
import { currentAgentSessionIdAtom } from './agent-atoms'

// FeedbackSelection（'up' | 'down' | null）事实源在 @asci/shared，这里 re-export 供组件复用
export type { FeedbackSelection }

const feedbackServerMapAsyncAtom = atom<Promise<SessionFeedbackMap>>(async (get) => {
  const sessionId = get(currentAgentSessionIdAtom)
  if (!sessionId) return {}
  try {
    return await window.electronAPI.outputFeedback.getForSession({ sessionId })
  } catch (err) {
    console.error('[outputFeedback] 回显拉取失败:', err)
    return {}
  }
})

/** 服务端回显 map（loadable：消费方拿 { state, data }，避免 Suspense 闪烁） */
export const feedbackServerMapAtom = loadable(feedbackServerMapAsyncAtom)

/** 乐观覆盖层，按 sessionId 作用域；session 切换后自动失效（sessionId 不匹配即视为空） */
export const feedbackOverridesAtom = atom<{
  sessionId: string | null
  map: Record<string, FeedbackSelection>
}>({ sessionId: null, map: {} })

/** 写一条乐观覆盖（value=null 表示取消表态）；自动绑定当前 sessionId */
export const setMessageFeedbackOverrideAtom = atom(
  null,
  (get, set, payload: { messageUuid: string; value: FeedbackSelection }) => {
    const sessionId = get(currentAgentSessionIdAtom)
    set(feedbackOverridesAtom, (prev) => {
      const base = prev.sessionId === sessionId ? prev.map : {}
      return { sessionId, map: { ...base, [payload.messageUuid]: payload.value } }
    })
  },
)

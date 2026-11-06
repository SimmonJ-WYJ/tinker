/**
 * 起手式 chip → 输入框填充 atom
 *
 * WelcomeEmptyState 点击 chip → setPendingStarterPrompt(prompt)
 * AgentView 监听该 atom → setInputContent(prompt) + focus + 清空 atom
 */

import { atom } from 'jotai'

/** 待填入对话输入框的 prompt — chip 点击时写入，AgentView 消费后清空 */
export const pendingStarterPromptAtom = atom<string | null>(null)

/**
 * 待「直接发送」的 prompt —— 与 pendingStarterPromptAtom 不同：
 * 不只是填入输入框等用户回车，而是写入后由 AgentView 立即派发 handleSend（自动开跑）。
 * 用于「找研究空白」等一键触发场景，避免「填入 → 手动回车」的二段式不顺流程。
 */
export const pendingAutoSendPromptAtom = atom<string | null>(null)

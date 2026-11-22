/**
 * 搜索 Dialog 状态 Atoms
 *
 * 管理全局搜索 Dialog 的开关、查询词和搜索结果。
 */

import { atom } from 'jotai'

/** 搜索 Dialog 是否打开 */
export const searchDialogOpenAtom = atom(false)

/** 仅内存保存一次 Tauri 搜索定位，等待目标会话完成历史恢复。 */
export const searchMessageTargetAtom = atom<{ sessionId: string; messageId: string } | null>(null)

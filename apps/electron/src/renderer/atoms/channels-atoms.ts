/**
 * 渠道与 UI 偏好共享 atom
 *
 * 原位于 chat-atoms.ts 中供 Agent 模式复用的全局 atom，
 * Chat 模式移除后单独成文件。
 */

import { atom } from 'jotai'
import type { Channel } from '@asci/shared'

/** 全局渠道列表缓存（启动时加载一次，设置变更时刷新） */
export const channelsAtom = atom<Channel[]>([])

/** 渠道列表是否已完成首次加载 */
export const channelsLoadedAtom = atom(false)

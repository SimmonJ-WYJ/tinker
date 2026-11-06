/**
 * Active View Atom - 主内容区视图状态
 *
 * 控制 MainArea 显示的内容：
 * - conversations: 会话视图（Agent 会话）
 * - library: 文献库占位视图（功能开发中）
 * - notes: 全局笔记视图（ADR-004 方案 A 原型）
 * - config: 配置页（spec §6.4 — Skill / 能力包两板块，当前 PR 只含能力包板块）
 */

import { atom } from 'jotai'

export type ActiveView = 'project' | 'conversations' | 'library' | 'notes' | 'config'

/** 当前活跃视图（不持久化，每次启动默认显示会话） */
export const activeViewAtom = atom<ActiveView>('conversations')

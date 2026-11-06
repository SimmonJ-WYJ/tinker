/**
 * 文本选择状态管理
 *
 * 用于存储用户选中的 AI 生成内容，以便：
 * 1. 在侧边栏中提问
 * 2. 添加到当前对话框作为引用
 */

import { atom } from 'jotai'

/** 选中的文本引用 */
export interface SelectedTextQuote {
  /** 选中的文本内容 */
  text: string
  /** 引用时间戳 */
  timestamp: number
}

/**
 * 待添加到输入框的引用文本
 *
 * 当用户点击 "Add to chat" 时，将选中的文本存储到此 atom，
 * 输入框组件监听此 atom 并将内容插入到编辑器中
 */
export const pendingQuoteAtom = atom<SelectedTextQuote | null>(null)

/**
 * 侧边栏提问的引用文本
 *
 * 当用户点击 "Ask in sidebar" 时，将选中的文本存储到此 atom，
 * 侧边栏组件监听此 atom 并打开侧边栏显示引用内容
 */
export const sidebarQuoteAtom = atom<SelectedTextQuote | null>(null)

/**
 * 能力变化 toast 抑制器
 *
 * 适用场景：单次用户操作会触发多条 MCP / Skill 变化（例如开启 Zotero 集成会
 * 一次性注入 zotero / ocr / asr 三个 MCP server）。直接由 capabilities-changed
 * 监听器逐条弹 toast 会出现堆叠，淹没真正的语义。
 *
 * 默认窗口 1500ms，足以覆盖文件监听 300ms debounce + IPC 往返。
 */

import { nowMs } from '@asci/shared'

let suppressUntil = 0

/** 抑制能力变化 toast 一段时间（取与既有窗口的较远截止时间） */
export function suppressCapabilityToasts(ms = 1500): void {
  suppressUntil = Math.max(suppressUntil, nowMs() + ms)
}

/** 当前是否仍在抑制窗口内 */
export function isCapabilityToastSuppressed(): boolean {
  return nowMs() < suppressUntil
}

/** 仅供测试使用：重置内部状态 */
export function __resetCapabilityToastSuppressForTest(): void {
  suppressUntil = 0
}

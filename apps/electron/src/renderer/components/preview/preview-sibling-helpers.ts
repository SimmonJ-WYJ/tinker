/**
 * Preview 兄弟文件导航的纯函数工具
 */
import type { FileEntry } from '@asci/shared'

export interface PreviewSiblings {
  /** 同级兄弟文件（已过滤目录） */
  files: FileEntry[]
  /** 当前预览文件在 files 中的下标；找不到时为 -1 */
  currentIndex: number
}

/**
 * 从 listDirectory 返回的 entries 中计算兄弟文件列表。
 * - 过滤目录
 * - 保留 IPC 已经排好的顺序
 * - 文件列表为空返回 null（没有可导航的项）
 */
export function siblingsFromEntries(
  entries: FileEntry[],
  currentPath: string,
): PreviewSiblings | null {
  const files = entries.filter((e) => !e.isDirectory)
  if (files.length === 0) return null
  const currentIndex = files.findIndex((f) => f.path === currentPath)
  return { files, currentIndex }
}

/** 从文件名推导小写扩展名；无 `.` 或以 `.` 开头（隐藏文件）返回空串 */
export function extFromName(name: string): string {
  const dotIdx = name.lastIndexOf('.')
  if (dotIdx <= 0) return ''
  return name.slice(dotIdx + 1).toLowerCase()
}

/** 键盘事件输入守卫的最小目标形状 */
interface KeyboardGuardTarget {
  tagName?: string
  isContentEditable?: boolean
}

/**
 * 键盘事件输入守卫：焦点在 INPUT / TEXTAREA / contentEditable 时返回 true。
 * 使用鸭子类型而非 instanceof HTMLElement，跨 realm 更稳、便于测试。
 */
export function shouldIgnoreKeyboardEvent(target: EventTarget | null): boolean {
  if (!target || typeof target !== 'object') return false
  const el = target as KeyboardGuardTarget
  if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') return true
  if (el.isContentEditable === true) return true
  return false
}

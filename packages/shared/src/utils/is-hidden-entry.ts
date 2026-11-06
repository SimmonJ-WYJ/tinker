/**
 * 文件浏览器中需要隐藏的系统文件
 * - 点号开头的文件会被 startsWith('.') 覆盖
 * - 保留本 set 是为了兜非点号开头的系统文件（如 Windows Thumbs.db）
 */
export const HIDDEN_FS_ENTRIES: ReadonlySet<string> = new Set([
  '.DS_Store',
  '.Spotlight-V100',
  '.Trashes',
  'Thumbs.db',
  'desktop.ini',
])

/**
 * 判断一个目录项是否应当在 UI 中隐藏
 * - 所有以 '.' 开头的条目（dotfiles / dotdirs）
 * - HIDDEN_FS_ENTRIES 中列出的系统文件
 *
 * 注意：此过滤仅作用于"列表展示"，不影响 Agent 工具（Read/Write/Glob）对文件的访问
 */
export function isHiddenEntry(name: string): boolean {
  if (!name) return false
  if (HIDDEN_FS_ENTRIES.has(name)) return true
  return name.startsWith('.')
}

/**
 * 字节数 → 人类可读字符串（B / KB / MB / GB）
 *
 * 收口自 ZoteroSettings / ZoteroMediaPanel / ZoteroEmbeddingPanel 三处的本地实现。
 */
export function formatBytes(bytes: number | undefined): string {
  if (bytes === undefined || bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB']
  let n = bytes
  let i = 0
  while (n >= 1024 && i < units.length - 1) {
    n /= 1024
    i += 1
  }
  return `${n.toFixed(i <= 1 ? 0 : 1)} ${units[i]}`
}

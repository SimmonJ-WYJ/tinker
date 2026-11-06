/**
 * locale 守门测试共享 helper
 *
 * 供 zh-punctuation / no-empty-value 等遍历 locale 资源树的测试复用。
 */

/** 递归收集对象中所有 leaf 字符串值（返回 [keyPath, value]，keyPath 用 '.' 拼接） */
export function collectStringLeaves(obj: unknown, prefix = ''): Array<[string, string]> {
  const leaves: Array<[string, string]> = []
  if (obj === null || typeof obj !== 'object') return leaves
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const path = prefix ? `${prefix}.${k}` : k
    if (typeof v === 'string') {
      leaves.push([path, v])
    } else if (v !== null && typeof v === 'object' && !Array.isArray(v)) {
      leaves.push(...collectStringLeaves(v, path))
    }
  }
  return leaves
}

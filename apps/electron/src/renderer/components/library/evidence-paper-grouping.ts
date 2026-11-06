/**
 * 证据集详情里「按论文折叠」的分组逻辑 —— 纯函数，便于单测。
 *
 * 问题：同一篇论文常在库里有**多行 paper 记录**（一行来自 lit-search 带 doi、另一行来自综述
 * createPaper 兜底带 zoteroKey），仅按单一 key 分组会把它们裂成两组。
 *
 * 方案：**按共享标识符并查集合并** —— 两条 paper ref 只要共享 doi / zoteroKey / 规范化标题
 * 中任意一个，就并入同一组。这样 {doi} 行与 {zoteroKey} 行能经"相同标题"桥接到一起。
 * doi/zoteroKey 唯一可靠；标题作桥接兜底（重复行多源自同一 §7 元数据，标题一致；
 * 不同论文标题字面完全相同的概率极低）。无任何标识符的 ref 独立成组。
 */
import type { Paper } from '@asci/shared'

const norm = (s: string): string => s.trim().toLowerCase().replace(/\s+/g, ' ')

/**
 * 一条 paper ref 的身份 token 列表（用于并查集桥接）。
 * present paper 用其 doi/zoteroKey/title；removed 占位用 removedTitle。
 * 返回空数组表示"无可桥接身份"——调用方应让它独立成组（用 sourceId 兜底）。
 */
export function paperIdentityTokens(paper: Paper | null, removedTitle?: string): string[] {
  const tokens: string[] = []
  if (paper) {
    if (paper.doi?.trim()) tokens.push(`doi:${paper.doi.trim().toLowerCase()}`)
    if (paper.zoteroKey?.trim()) tokens.push(`zk:${paper.zoteroKey.trim()}`)
    if (paper.title?.trim()) tokens.push(`t:${norm(paper.title)}`)
  } else if (removedTitle?.trim()) {
    tokens.push(`t:${norm(removedTitle)}`)
  }
  return tokens
}

/**
 * 并查集：输入每条 ref 的身份 token 列表，输出每条 ref 的组号（稳定：组号 = 该组首条 ref 的下标）。
 * 共享任一 token 的 ref 归同一组；token 为空的 ref 独立成组。
 */
export function groupBySharedIdentity(tokensPerRef: readonly string[][]): number[] {
  const n = tokensPerRef.length
  const parent = Array.from({ length: n }, (_, i) => i)
  const find = (x: number): number => {
    let r = x
    while (parent[r] !== r) r = parent[r]!
    // 路径压缩
    let cur = x
    while (parent[cur] !== r) {
      const next = parent[cur]!
      parent[cur] = r
      cur = next
    }
    return r
  }
  const union = (a: number, b: number): void => {
    const ra = find(a)
    const rb = find(b)
    if (ra === rb) return
    // 让更小的下标作根，保证组号 = 首条 ref 下标（稳定排序）
    if (ra < rb) parent[rb] = ra
    else parent[ra] = rb
  }

  const tokenToRef = new Map<string, number>()
  tokensPerRef.forEach((tokens, idx) => {
    for (const tok of tokens) {
      const seen = tokenToRef.get(tok)
      if (seen === undefined) tokenToRef.set(tok, idx)
      else union(seen, idx)
    }
  })

  return tokensPerRef.map((_, idx) => find(idx))
}

/**
 * Zotero "加入文献库" 目标模型（#463 重构：改走 connector treeViewID）
 *
 * 背景：Zotero 本地 Web API 只读（PATCH /items 返 501），移动条目唯一可写路径是
 * connector /updateSession，其 target 字段用 treeViewID 标识：
 *   - 'L1'      : 「我的文献库」根
 *   - 'C<整数>' : collection（Zotero 本地 collectionID，非 8 字符 Web API key）
 * 故选择器与持久化都改用 treeViewID，而非旧的 Web API collection key。
 *
 * 两种目标语义：
 *   - zoteroCurrent: 落到 Zotero UI 当前选中（不调 updateSession，回归 0.1 之前兼容行为）
 *   - target:        指定 treeViewID（'L1' 我的文献库根 / 'C<整数>' 具体 collection）
 *
 * 持久化形态 = string：sentinel `'__zotero_current__'` 或 treeViewID（'L1' / 'C<整数>'）。
 * 内存形态 = DestSelection 判别联合，便于在 UI 里 type-safe 渲染。
 *
 * 在 settings.json 中两份字段：
 *   - zoteroLastCollectionKey                       — 全局 fallback（citation-graph 等无 workspace 场景）
 *   - zoteroLastCollectionKeyByWorkspace[workspaceId] — 按工作区记忆
 * （字段名沿用历史，存的是 treeViewID 字符串。）
 */

import type { ZoteroCollectionTarget } from '@asci/shared'

export const ZOTERO_DEST_CURRENT = '__zotero_current__' as const
/** 我的文献库根的 treeViewID（connector 约定：library 1 = 用户个人库） */
export const ZOTERO_TREE_MY_LIBRARY = 'L1' as const

export type DestSelection =
  | { kind: 'zoteroCurrent' }
  | { kind: 'target'; treeViewID: string }

/** DestSelection → 持久化字符串 */
export function serializeDest(d: DestSelection): string {
  switch (d.kind) {
    case 'zoteroCurrent': return ZOTERO_DEST_CURRENT
    case 'target': return d.treeViewID
  }
}

/** 持久化字符串 → DestSelection；空 / undefined / sentinel → zoteroCurrent，其余按 treeViewID */
export function parseDest(raw: string | undefined | null): DestSelection {
  if (!raw) return { kind: 'zoteroCurrent' }
  if (raw === ZOTERO_DEST_CURRENT) return { kind: 'zoteroCurrent' }
  return { kind: 'target', treeViewID: raw }
}

/**
 * 解析弹窗打开时的默认选项：
 *   per-workspace[workspaceId] > global > 我的文献库根
 *
 * workspaceId 为 null 时跳过 per-workspace 直接看 global（citation graph orphan）。
 *
 * 无任何历史选择时默认落「我的文献库」根，而非 zoteroCurrent —— 后者会让论文
 * 静默跟随 Zotero 界面当前停留的 collection（#463 错配根因）；用户仍可主动选
 * zoteroCurrent，但不再是无感默认。
 */
export function resolveDefaultDest(
  byWorkspace: Record<string, string> | undefined,
  global: string | undefined,
  workspaceId: string | null,
): DestSelection {
  if (workspaceId) {
    const w = byWorkspace?.[workspaceId]
    if (w) return parseDest(w)
  }
  if (global) return parseDest(global)
  return { kind: 'target', treeViewID: ZOTERO_TREE_MY_LIBRARY }
}

/**
 * 把 DestSelection 转成传给后端 createItem 的 `targetTreeViewID`：
 *   - null:   zoteroCurrent —— 不调 updateSession，沿用 Zotero UI 选中
 *   - string: target        —— updateSession target = treeViewID（'L1' / 'C<整数>'）
 */
export function destToTargetTreeViewID(d: DestSelection): string | null {
  switch (d.kind) {
    case 'zoteroCurrent': return null
    case 'target': return d.treeViewID
  }
}

// ===== target 树形扁平化（connector targets 已是按层级排序的扁平列表） =====

/** 树形扁平节点（treeViewID + 深度 + 完整路径名供搜索匹配） */
export interface FlatNode {
  /** treeViewID（'L1' / 'C<整数>'）——选中即写回，传给 updateSession */
  treeViewID: string
  name: string
  depth: number
  /** 用斜杠拼接祖先 + 自身名，便于搜索匹配 "AI / Vision" */
  fullPath: string
  /** 是否 library 根（level 0）——UI 上作为「我的文献库」pinned 行特殊渲染 */
  isLibraryRoot: boolean
}

/**
 * 把 connector targets（已按 level 父先于子排序）转成 FlatNode[]。
 *
 * targets 自带 level，无需重排；fullPath 用层级栈推祖先名拼接。
 * library 根（level 0）标记 isLibraryRoot，供调用方决定 pin 到顶部。
 */
export function flattenCollectionTargets(list: ZoteroCollectionTarget[]): FlatNode[] {
  const out: FlatNode[] = []
  const ancestors: string[] = []
  for (const t of list) {
    ancestors.length = t.level
    const fullPath = [...ancestors, t.name].join(' / ')
    out.push({
      treeViewID: t.treeViewID,
      name: t.name,
      depth: t.level,
      fullPath,
      isLibraryRoot: t.level === 0,
    })
    ancestors[t.level] = t.name
  }
  return out
}
